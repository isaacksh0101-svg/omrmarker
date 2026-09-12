import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// server/src/config.js -> project2/
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

export const config = {
  port: Number(process.env.PORT) || 4000,
  projectRoot: PROJECT_ROOT,
  dataDir: path.resolve(PROJECT_ROOT, 'server', 'data'),
  dbPath: path.resolve(PROJECT_ROOT, 'server', 'data', 'omr.sqlite3'),
  uploadsDir: path.resolve(PROJECT_ROOT, 'server', 'data', 'uploads'),
  clientDistDir: path.resolve(PROJECT_ROOT, 'client', 'dist'),
  curriculumStandardsPath: path.resolve(PROJECT_ROOT, 'curriculum', 'curriculum-standards.json'),
  aiProvider: process.env.AI_PROVIDER || 'gemini',
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
  },
  anticheatDebounceMs: Number(process.env.ANTICHEAT_DEBOUNCE_MS) || 2000,
};
