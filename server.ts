import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { DATA_DIR, MAX_FILE_MB, REFUSAL } from './src-server/config';
import { ragStore } from './src-server/rag-store';
import { generateCloudAnswer } from './src-server/gemini';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = '0.0.0.0';

app.use(cors());
app.use(express.json({ limit: '1mb' }));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, DATA_DIR),
  filename: (_req, file, cb) => cb(null, path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_')),
});
const allowed = new Set(['.pdf', '.docx', '.txt', '.jpg', '.jpeg', '.png', '.bmp', '.tiff']);
const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.has(ext));
  },
});

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'NEXUS RAG', ...ragStore.getStats() }));
app.get('/stats', (_req, res) => res.json(ragStore.getStats()));

app.get('/files', (_req, res) => res.json({ files: ragStore.getUploadedFiles(), ...ragStore.getStats() }));

app.post('/upload', upload.array('files', 10) as any, async (req: any, res: any) => {
  try {
    const files = (req.files || []) as Express.Multer.File[];
    if (!files.length) return res.status(400).json({ detail: 'No supported files were uploaded.' });
    await ragStore.rebuildIndex();
    res.json({ status: 'success', message: `Indexed ${files.length} document${files.length === 1 ? '' : 's'}.`, files: ragStore.getUploadedFiles(), stats: ragStore.getStats() });
  } catch (err: any) {
    console.error('[Upload]', err);
    res.status(500).json({ detail: err?.message || 'Indexing failed.' });
  }
});

app.delete('/delete_file/:filename', async (req, res) => {
  const filename = path.basename(req.params.filename);
  const target = path.join(DATA_DIR, filename);
  if (!fs.existsSync(target)) return res.status(404).json({ detail: 'File not found.' });
  try {
    await fs.promises.unlink(target);
    await ragStore.rebuildIndex();
    res.json({ status: 'success', message: `Removed ${filename}.`, files: ragStore.getUploadedFiles(), stats: ragStore.getStats() });
  } catch (err: any) {
    console.error('[Delete]', err);
    res.status(500).json({ detail: err?.message || 'Failed to remove the document.' });
  }
});

app.post('/chat', async (req, res) => {
  const query = String(req.body?.message || '').trim();
  const conversationId = String(req.body?.conversation_id || '');
  const sourceFilter = String(req.body?.source || 'all');
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  const send = (payload: any) => res.write(`${JSON.stringify(payload)}\n`);

  if (!query) { send({ type: 'answer', content: 'Please enter a question.' }); send({ type: 'done', verification: 'not-needed', query_id: '' }); return res.end(); }
  if (!ragStore.isIndexReady || !ragStore.allChunks.length) { send({ type: 'answer', content: REFUSAL }); send({ type: 'done', verification: 'unavailable', query_id: '' }); return res.end(); }

  let conv = ragStore.conversations.find((c) => c.id === conversationId);
  if (!conv) {
    conv = { id: conversationId || crypto.randomUUID(), title: query.slice(0, 48), messages: [], timestamp: new Date().toISOString() };
    ragStore.conversations.push(conv);
  }

  try {
    const recentUser = [...conv.messages].reverse().find((m) => m.role === 'user')?.content || '';
    const needsContext = /\b(he|she|they|it|this|that|these|those|there|then|same)\b/i.test(query);
    const retrievalQuery = needsContext && recentUser ? `${query} ${recentUser}` : query;
    const retrieved = await ragStore.retrieveAndVerify(retrievalQuery, sourceFilter);
    if (!retrieved.chunks.length) {
      send({ type: 'answer', content: REFUSAL });
      send({ type: 'done', verification: 'refused', query_id: '' });
      return res.end();
    }

    const citations = retrieved.chunks.map((chunk, i) => ({ id: i + 1, source: retrieved.sources[i], page: retrieved.pages[i], chunk: chunk.slice(0, 240) }));
    send({ type: 'citations', citations });

    const context = retrieved.chunks.map((chunk, i) => `[${i + 1}] ${retrieved.sources[i]} (${retrieved.pages[i]})\n${chunk}`).join('\n\n');
    const result = await generateCloudAnswer(query, context, conv.messages);
    const queryId = crypto.randomUUID();
    send({ type: 'answer', content: result.answer, verification: result.verification, evidence: result.evidence });

    ragStore.conversationMetadata.push({ query_id: queryId, query, chunks: retrieved.chunks, sources: retrieved.sources, pages: retrieved.pages, answer: result.answer, timestamp: new Date().toISOString(), verification: result.verification });
    conv.messages.push({ role: 'user', content: query });
    conv.messages.push({ role: 'assistant', content: result.answer });
    conv.timestamp = new Date().toISOString();
    ragStore.saveConversations();
    send({ type: 'done', verification: result.verification, query_id: queryId });
  } catch (err: any) {
    console.error('[Chat]', err);
    send({ type: 'answer', content: REFUSAL, verification: 'refused' });
    send({ type: 'done', verification: 'refused', query_id: '' });
  }
  res.end();
});

