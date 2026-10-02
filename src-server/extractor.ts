import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { createWorker } from 'tesseract.js';
import { CHUNK_SIZE, CHUNK_OVERLAP } from './config';

export interface ExtractedPage {
  page: number;
  text: string;
}

export interface ExtractedDocument {
  text: string;
  pages: ExtractedPage[];
}

function cleanText(text: string): string {
  return (text || '')
    .replace(/\u0000/g, ' ')
    .replace(/\r\n|\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/([.!?])(?=\d)/g, '$1 ')
    .replace(/(\d)([A-Z])/g, '$1 $2')
    .trim();
}

let ocrWorker: any = null;
async function ocrImage(filePath: string): Promise<string> {
  if (!ocrWorker) ocrWorker = await createWorker('eng');
  const result = await ocrWorker.recognize(filePath);
  return cleanText(result?.data?.text || '');
}

export async function extractDocument(filePath: string): Promise<ExtractedDocument> {
  const ext = path.extname(filePath).toLowerCase();
  try {
    if (ext === '.txt') {
      const text = cleanText(fs.readFileSync(filePath, 'utf8'));
      return { text, pages: [{ page: 1, text }] };
    }

    if (ext === '.pdf') {
      const buffer = fs.readFileSync(filePath);
      const pages: ExtractedPage[] = [];
      const pageTexts: string[] = [];
      const data = await pdfParse(buffer, {
        pagerender: async (pageData: any) => {
          const content = await pageData.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false });
          const pageText = content.items.map((item: any) => item.str || '').join(' ');
          pageTexts.push(pageText);
          return pageText;
        },
      } as any);

      pageTexts.forEach((text, i) => pages.push({ page: i + 1, text: cleanText(text) }));
      const text = cleanText(data.text || '');
      if (!pages.length) {
        // Reliable fallback when the installed pdf-parse version does not expose page text.
        pages.push({ page: 1, text });
      }
      return { text, pages };
    }

    if (ext === '.docx') {
      const buffer = fs.readFileSync(filePath);
      const result = await mammoth.extractRawText({ buffer });
      const text = cleanText(result.value || '');
      return { text, pages: [{ page: 1, text }] };
    }

    if (['.jpg', '.jpeg', '.png', '.bmp', '.tiff'].includes(ext)) {
      const text = await ocrImage(filePath);
      return { text, pages: [{ page: 1, text }] };
    }
  } catch (err) {
    console.error(`[Extractor] Failed for ${filePath}:`, err);
  }

  return { text: '', pages: [] };
}

export async function extractTextFromFile(filePath: string): Promise<string> {
  const result = await extractDocument(filePath);
  return result.text;
}

function sentenceAwarePieces(text: string): string[] {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const pieces: string[] = [];
  for (const paragraph of paragraphs) {
    const sentences = paragraph.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [paragraph];
    pieces.push(...sentences.map((s) => s.trim()).filter(Boolean));
  }
  return pieces;
}

export function chunkText(text: string, chunkSize: number = CHUNK_SIZE, overlap: number = CHUNK_OVERLAP): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const chunks: string[] = [];
  const step = Math.max(1, chunkSize - overlap);
  for (let i = 0; i < words.length; i += step) {
    const slice = words.slice(i, i + chunkSize);
    if (!slice.length) break;
    chunks.push(slice.join(' ').trim());
    if (i + chunkSize >= words.length) break;
  }
  return chunks;
}

export interface TextChunk {
  text: string;
  pageStart: number;
  pageEnd: number;
}

export function chunkDocument(pages: ExtractedPage[], chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP): TextChunk[] {
  const chunks: TextChunk[] = [];
  let bufferWords: string[] = [];
  let startPage = pages[0]?.page || 1;
  let lastPage = startPage;

  const flush = () => {
    if (!bufferWords.length) return;
    chunks.push({ text: bufferWords.join(' ').trim(), pageStart: startPage, pageEnd: lastPage });
    const keep = Math.min(overlap, bufferWords.length);
    bufferWords = bufferWords.slice(-keep);
    startPage = lastPage;
  };

  for (const page of pages) {
    const pieces = sentenceAwarePieces(page.text);
    const pageWords = (pieces.length ? pieces.join(' ') : page.text).split(/\s+/).filter(Boolean);
    if (!pageWords.length) continue;
    lastPage = page.page;
    let cursor = 0;
    while (cursor < pageWords.length) {
      const remaining = chunkSize - bufferWords.length;
      const take = Math.min(remaining, pageWords.length - cursor);
      bufferWords.push(...pageWords.slice(cursor, cursor + take));
      cursor += take;
      if (bufferWords.length >= chunkSize) flush();
    }
  }
  if (bufferWords.length) {
    chunks.push({ text: bufferWords.join(' ').trim(), pageStart: startPage, pageEnd: lastPage });
  }

  return chunks.filter((c) => c.text.length >= 3);
}
