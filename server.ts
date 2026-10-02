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

