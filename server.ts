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

