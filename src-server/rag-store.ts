import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  DATA_DIR, INDEX_DIR, MERKLE_DIR, TRANSFORM_DIR, CONVERSATIONS_FILE, FEEDBACK_LOG,
  N_CLUSTERS_MAX, TOP_K, BATCH_SIZE, EMBEDDING_DIM,
} from './config';
import { extractDocument, chunkDocument } from './extractor';
import { generateTransform, applyTransform, normalizeVector, dotProduct, MaskTransform } from './masking';
import { buildMerkleTree, verifyMerkleProof, MerkleProof } from './merkle';
import { runKMeans, KMeansResult } from './clustering';
import { embedDocuments, embedQuery } from './gemini';

export interface ChunkItem {
  globalIdx: number;
  id: string;
  text: string;
  source: string;
  pageStart: number;
  pageEnd: number;
  clusterId: number;
  proof: MerkleProof;
  rootHashHex: string;
  vector: Float32Array;
}

export interface ConversationMessage { role: 'user' | 'assistant'; content: string; }
export interface Conversation { id: string; title: string; messages: ConversationMessage[]; timestamp: string; }

interface Candidate extends ChunkItem { score: number; semantic: number; lexical: number; exact: number; }

const INDEX_STATE_FILE = path.join(INDEX_DIR, 'index-state.json');
const TRANSFORM_FILE = path.join(TRANSFORM_DIR, 'transform.json');
const VECTOR_CACHE_DIR = path.join(INDEX_DIR, 'vector-cache');
const MAX_CONTEXT_CHUNKS = 8;

function sha256(value: string | Buffer): string { return crypto.createHash('sha256').update(value).digest('hex'); }
function tokens(text: string): string[] {
  return Array.from(new Set((text.toLowerCase().match(/[a-z0-9][a-z0-9'_-]*/g) || []).filter((t) => t.length > 1)));
}

export class RagStore {
  transform: MaskTransform | null = null;
  kMeansResult: KMeansResult | null = null;
  allChunks: ChunkItem[] = [];
  clusterChunks = new Map<number, ChunkItem[]>();
  isIndexReady = false;
  indexing = false;
  conversations: Conversation[] = [];
  conversationMetadata: any[] = [];
  private fileStats = new Map<string, { size: number; mtimeMs: number }>();

  constructor() { this.loadConversations(); }

  loadConversations() {
    try {
      if (fs.existsSync(CONVERSATIONS_FILE)) this.conversations = JSON.parse(fs.readFileSync(CONVERSATIONS_FILE, 'utf8')) || [];
    } catch { this.conversations = []; }
  }

  saveConversations() {
    try { fs.mkdirSync(INDEX_DIR, { recursive: true }); fs.writeFileSync(CONVERSATIONS_FILE, JSON.stringify(this.conversations, null, 2)); } catch (err) { console.error(err); }
  }

  getUploadedFiles(): string[] {
    if (!fs.existsSync(DATA_DIR)) return [];
    return fs.readdirSync(DATA_DIR).filter((f) => { try { return fs.statSync(path.join(DATA_DIR, f)).isFile(); } catch { return false; } });
  }

  getStats() {
    const sources = new Set(this.allChunks.map((c) => c.source));
    return { ready: this.isIndexReady, indexing: this.indexing, documents: this.getUploadedFiles().length, indexedDocuments: sources.size, chunks: this.allChunks.length };
  }

  private loadTransform(dim: number): MaskTransform {
    try {
      if (fs.existsSync(TRANSFORM_FILE)) {
        const t = JSON.parse(fs.readFileSync(TRANSFORM_FILE, 'utf8'));
        if (Array.isArray(t.perm) && t.perm.length === dim && Array.isArray(t.signs) && t.signs.length === dim) return t;
      }
    } catch {}
    const t = generateTransform(dim);
    fs.mkdirSync(TRANSFORM_DIR, { recursive: true });
    fs.writeFileSync(TRANSFORM_FILE, JSON.stringify(t));
    return t;
  }

  async loadOrBuildIndex() { await this.rebuildIndex(); }

