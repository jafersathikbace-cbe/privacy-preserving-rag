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

  async rebuildIndex() {
    if (this.indexing) return;
    this.indexing = true;
    this.isIndexReady = false;
    try {
      const files = this.getUploadedFiles();
      if (!files.length) {
        this.allChunks = []; this.clusterChunks.clear(); this.kMeansResult = null; this.isIndexReady = false; return;
      }

      const chunkDrafts: Omit<ChunkItem, 'globalIdx' | 'clusterId' | 'proof' | 'rootHashHex' | 'vector' | 'id'>[] = [];
      for (const filename of files) {
        const fullPath = path.join(DATA_DIR, filename);
        const stat = fs.statSync(fullPath);
        this.fileStats.set(filename, { size: stat.size, mtimeMs: stat.mtimeMs });
        const doc = await extractDocument(fullPath);
        const pieces = chunkDocument(doc.pages);
        for (const piece of pieces) chunkDrafts.push({ text: piece.text, source: filename, pageStart: piece.pageStart, pageEnd: piece.pageEnd });
      }

      if (!chunkDrafts.length) { this.allChunks = []; this.clusterChunks.clear(); return; }

      fs.mkdirSync(VECTOR_CACHE_DIR, { recursive: true });
      let dim = EMBEDDING_DIM;
      this.transform = this.loadTransform(dim);
      const transformedVectors: Float32Array[] = new Array(chunkDrafts.length);
      const missing: number[] = [];
      for (let i = 0; i < chunkDrafts.length; i++) {
        const cacheFile = path.join(VECTOR_CACHE_DIR, `${sha256(chunkDrafts[i].text)}.json`);
        try {
          if (fs.existsSync(cacheFile)) {
            const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
            if (Array.isArray(cached) && cached.length === this.transform.perm.length) { transformedVectors[i] = new Float32Array(cached); continue; }
          }
        } catch {}
        missing.push(i);
      }
      if (missing.length) {
        const rawEmbeddings = await embedDocuments(missing.map((i) => chunkDrafts[i].text), BATCH_SIZE);
        dim = rawEmbeddings[0]?.length || EMBEDDING_DIM;
        if (dim !== this.transform.perm.length) {
          this.transform = this.loadTransform(dim);
        }
        missing.forEach((originalIndex, j) => {
          const transformed = normalizeVector(applyTransform(rawEmbeddings[j], this.transform!.perm, this.transform!.signs));
          transformedVectors[originalIndex] = transformed;
          try { fs.writeFileSync(path.join(VECTOR_CACHE_DIR, `${sha256(chunkDrafts[originalIndex].text)}.json`), JSON.stringify(Array.from(transformed))); } catch {}
        });
      }

      const kResult = runKMeans(transformedVectors, Math.min(N_CLUSTERS_MAX, Math.max(1, Math.floor(Math.sqrt(transformedVectors.length)))));
      this.kMeansResult = kResult;
      this.clusterChunks.clear();

      const items: ChunkItem[] = chunkDrafts.map((draft, i) => ({
        ...draft,
        globalIdx: i,
        id: sha256(`${draft.source}|${draft.pageStart}|${draft.pageEnd}|${draft.text}`),
        clusterId: kResult.labels[i] || 0,
        proof: { path: [], peakIdx: 0, otherPeaksHex: [] },
        rootHashHex: '',
        vector: transformedVectors[i],
      }));

      for (let c = 0; c < kResult.actualNClusters; c++) {
        const clusterItems = items.filter((item) => item.clusterId === c);
        if (!clusterItems.length) continue;
        const { rootHashHex, proofs } = buildMerkleTree(clusterItems.map((x) => x.text));
        fs.mkdirSync(MERKLE_DIR, { recursive: true });
        fs.writeFileSync(path.join(MERKLE_DIR, `cluster_${c}_root.txt`), rootHashHex);
        clusterItems.forEach((item, idx) => { item.proof = proofs[idx]; item.rootHashHex = rootHashHex; });
        this.clusterChunks.set(c, clusterItems);
      }

      this.allChunks = items;
      this.writeState();
      this.isIndexReady = true;
      console.log(`[RAG] Ready: ${items.length} chunks across ${files.length} documents.`);
    } finally {
      this.indexing = false;
    }
  }

  private writeState() {
    try {
      fs.mkdirSync(INDEX_DIR, { recursive: true });
      fs.writeFileSync(INDEX_STATE_FILE, JSON.stringify({ version: 2, documents: this.getUploadedFiles(), chunks: this.allChunks.length, updatedAt: new Date().toISOString() }));
    } catch {}
  }
