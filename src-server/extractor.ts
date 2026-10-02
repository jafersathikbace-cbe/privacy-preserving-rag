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

