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

