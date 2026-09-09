// One-off local fixup: strips AlQuran Cloud's {code, status, data} envelope
// from files already downloaded before scripts 01/02 were updated to do
// this at fetch time. Pure local read-transform-write, no network calls.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data', 'quran', 'alquran-cloud');

function unwrapFile(p) {
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (raw && typeof raw === 'object' && 'code' in raw && 'status' in raw && 'data' in raw) {
    fs.writeFileSync(p, JSON.stringify(raw.data));
    return true;
  }
  return false;
}

let fixed = 0, alreadyClean = 0;

// editions.json
const editionsPath = path.join(DATA, 'editions.json');
if (fs.existsSync(editionsPath)) (unwrapFile(editionsPath) ? fixed++ : alreadyClean++);

// sajda.json
const sajdaPath = path.join(ROOT, 'data', 'quran', 'sajda.json');
if (fs.existsSync(sajdaPath)) (unwrapFile(sajdaPath) ? fixed++ : alreadyClean++);

// every text edition
const textDir = path.join(DATA, 'text');
if (fs.existsSync(textDir)) {
  for (const f of fs.readdirSync(textDir)) {
    if (!f.endsWith('.json')) continue;
    (unwrapFile(path.join(textDir, f)) ? fixed++ : alreadyClean++);
  }
}

console.log(`Unwrapped ${fixed} files (${alreadyClean} were already clean).`);
