import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config({ override: true });

export const BASE_DIR = process.cwd();
export const DATA_DIR = path.join(BASE_DIR, 'data', 'raw');
export const INDEX_DIR = path.join(BASE_DIR, 'indexes');
export const CLUSTER_DIR = path.join(INDEX_DIR, 'clusters');
export const MERKLE_DIR = path.join(INDEX_DIR, 'merkles');
export const TRANSFORM_DIR = path.join(INDEX_DIR, 'transform');
export const CONVERSATIONS_FILE = path.join(INDEX_DIR, 'conversations.json');
export const FEEDBACK_LOG = path.join(INDEX_DIR, 'feedback_log.csv');

export const CHUNK_SIZE = Math.max(120, parseInt(process.env.CHUNK_SIZE || '360', 10));
export const CHUNK_OVERLAP = Math.max(20, parseInt(process.env.CHUNK_OVERLAP || '60', 10));
export const N_CLUSTERS_MAX = Math.max(1, parseInt(process.env.N_CLUSTERS_MAX || '8', 10));
export const TOP_K = Math.max(4, parseInt(process.env.TOP_K || '8', 10));
export const BATCH_SIZE = Math.max(1, parseInt(process.env.BATCH_SIZE || '6', 10));
export const EMBEDDING_DIM = Math.max(128, parseInt(process.env.EMBEDDING_DIM || '768', 10));
export const MAX_FILE_MB = Math.max(5, parseInt(process.env.MAX_FILE_MB || '25', 10));

export const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2-preview';
export const LLM_MODEL = process.env.GEMINI_LLM_MODEL || 'gemini-3.5-flash-lite';
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
export const REFUSAL = "I don't know based on the uploaded documents.";

for (const dir of [DATA_DIR, INDEX_DIR, CLUSTER_DIR, MERKLE_DIR, TRANSFORM_DIR]) fs.mkdirSync(dir, { recursive: true });
