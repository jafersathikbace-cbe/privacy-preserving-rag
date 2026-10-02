import { GoogleGenAI } from '@google/genai';
import crypto from 'crypto';
import { GEMINI_API_KEY, EMBEDDING_MODEL, LLM_MODEL, EMBEDDING_DIM, REFUSAL } from './config';

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI | null {
  const key = process.env.GEMINI_API_KEY || GEMINI_API_KEY;
  if (!key) return null;
  if (!client) client = new GoogleGenAI({ apiKey: key });
  return client;
}

function fallbackEmbedding(text: string, dim = EMBEDDING_DIM): Float32Array {
  const v = new Float32Array(dim);
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const hash = crypto.createHash('sha256').update(`${words[i]}:${i}`).digest();
    for (let j = 0; j < 16; j++) v[(j * 31 + i * 17) % dim] += (hash[j] - 128) / 128;
  }
  return normalize(v);
}
function normalize(v: Float32Array): Float32Array {
  let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1;
  const out = new Float32Array(v.length); for (let i = 0; i < v.length; i++) out[i] = v[i] / n; return out;
}
function extractValues(res: any): number[] | null { return res?.embedding?.values || res?.embeddings?.[0]?.values || null; }

async function embedOne(ai: GoogleGenAI, text: string): Promise<Float32Array> {
  try {
    const res = await ai.models.embedContent({ model: EMBEDDING_MODEL, contents: text, config: { outputDimensionality: EMBEDDING_DIM } });
    const values = extractValues(res);
    return values?.length ? new Float32Array(values) : fallbackEmbedding(text);
  } catch (err) { console.warn('[Embedding] fallback:', (err as any)?.message || err); return fallbackEmbedding(text); }
}

export async function embedDocuments(texts: string[], concurrency = 6): Promise<Float32Array[]> {
  const ai = getClient();
  if (!ai) return texts.map((t) => fallbackEmbedding(t));
  const output = new Array<Float32Array>(texts.length);
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const i = cursor++;
      if (i >= texts.length) return;
      output[i] = await embedOne(ai, texts[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, texts.length)) }, worker));
  return output;
}

export async function embedQuery(text: string): Promise<Float32Array> {
  const ai = getClient();
  return ai ? embedOne(ai, text) : fallbackEmbedding(text);
}

function parseJson(text: string): any {
  const cleaned = (text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try { return JSON.parse(cleaned); } catch {
    const match = cleaned.match(/\{[\s\S]*\}/); if (!match) return null;
    try { return JSON.parse(match[0]); } catch { return null; }
  }
}
function normalizeSpace(text: string): string { return (text || '').replace(/\s+/g, ' ').trim(); }
function evidenceIsFromContext(evidence: string[], context: string): boolean {
  if (!Array.isArray(evidence) || evidence.length < 1 || evidence.length > 4) return false;
  const normalized = normalizeSpace(context).toLowerCase();
  const stripped = normalized.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ');
  return evidence.every((raw) => {
    const q = normalizeSpace(String(raw)).replace(/^['"]|['"]$/g, '').toLowerCase();
    if (q.length < 3) return false;
    if (normalized.includes(q)) return true;
    const sq = q.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    return stripped.includes(sq);
  });
}
async function generateWithRetry(ai: GoogleGenAI, params: any) {
  const models = [params.model, 'gemini-flash-latest', 'gemini-3.1-flash-lite'].filter(Boolean);
  let last: any;
  for (const model of models) {
    try { return await ai.models.generateContent({ ...params, model }); }
    catch (err: any) {
      last = err;
      const msg = String(err?.message || err);
      if (!/429|503|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand/i.test(msg)) throw err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw last;
}

export async function generateCloudAnswer(query: string, context: string, history: any[] = []): Promise<{ answer: string; verification: 'passed' | 'refused'; evidence: string[] }> {
  const ai = getClient();
  if (!ai) return { answer: 'Gemini API key is not configured. Add GEMINI_API_KEY to the server environment.', verification: 'refused', evidence: [] };
  const historyText = history.slice(-4).map((m) => `${String(m.role).toUpperCase()}: ${m.content}`).join('\n');
  const prompt = `You are the answer engine for a private document intelligence system.\n\nSTRICT RULES:\n- Answer ONLY from VERIFIED CONTEXT.\n- Never use web knowledge, training knowledge, guesses, or assumptions.\n- If the context does not directly support the answer, grounded=false and answer exactly: "${REFUSAL}".\n- If multiple documents contain relevant facts, synthesize only what the verified excerpts support.\n- Preserve names, numbers, dates and terminology exactly.\n- Conversation history may resolve pronouns only; it is never evidence.\n- Evidence must be short verbatim excerpts from CONTEXT.\n- Return JSON only.\n\nJSON: {"grounded":true,"answer":"...","evidence":["..."]}\nOr: {"grounded":false,"answer":"${REFUSAL}","evidence":[]}\n\nVERIFIED CONTEXT:\n${context}\n\nRECENT CONVERSATION:\n${historyText}\n\nQUESTION:\n${query}`;

  try {
    const draftRes = await generateWithRetry(ai, { model: LLM_MODEL, contents: prompt, config: { temperature: 0, maxOutputTokens: 500, responseMimeType: 'application/json' } });
    const draft = parseJson(draftRes.text || '');
    if (!draft?.grounded) return { answer: REFUSAL, verification: 'refused', evidence: [] };
    const answer = String(draft.answer || '').trim();
    const evidence = Array.isArray(draft.evidence) ? draft.evidence.map(String) : [];
    if (!answer || !evidenceIsFromContext(evidence, context)) return { answer: REFUSAL, verification: 'refused', evidence: [] };

    const verifyPrompt = `Verify this document-grounded answer. PASS only when every factual claim in the answer is directly supported by VERIFIED CONTEXT and every evidence quote is an exact excerpt. Do not use outside knowledge. Return JSON only: {"verdict":"PASS"} or {"verdict":"FAIL"}.\n\nQUESTION: ${query}\n\nVERIFIED CONTEXT:\n${context}\n\nANSWER:\n${answer}\n\nEVIDENCE:\n${JSON.stringify(evidence)}`;
    const verifyRes = await generateWithRetry(ai, { model: LLM_MODEL, contents: verifyPrompt, config: { temperature: 0, maxOutputTokens: 80, responseMimeType: 'application/json' } });
    const verdict = parseJson(verifyRes.text || '');
    if (String(verdict?.verdict || '').toUpperCase() !== 'PASS') return { answer: REFUSAL, verification: 'refused', evidence: [] };
    return { answer, verification: 'passed', evidence };
  } catch (err) {
    console.error('[Answer] verification error:', err);
    return { answer: REFUSAL, verification: 'refused', evidence: [] };
  }
}
