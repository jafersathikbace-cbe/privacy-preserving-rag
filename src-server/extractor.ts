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

