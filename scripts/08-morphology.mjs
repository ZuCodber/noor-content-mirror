// Mirrors mustafa0x/quran-morphology's TSV and pre-parses it into the exact
// per-chapter JSON shape src/services/morphologyService.ts already produces
// on-device (ChapterMorphMap keyed by "verse:wordPosition") — so this can be
// dropped straight into the app's document directory / bundled as-is.
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { saveText, Logger, ensureDirSync } from './lib/http.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data', 'quran', 'morphology');
const TSV_URL = 'https://raw.githubusercontent.com/mustafa0x/quran-morphology/master/quran-morphology.txt';

const log = new Logger(path.join(ROOT, 'logs', '08-morphology.json'));

function parseSegType(raw) {
  if (raw.includes('PREF')) return 'PREF';
  if (raw.includes('SUFF')) return 'SUFF';
  return 'STEM';
}

function parseFeatures(rawFeatures) {
  const parts = rawFeatures.split('|');
  let root, lemma;
  const features = [];
  for (const p of parts) {
    if (!p) continue;
    if (p.startsWith('ROOT:')) { root = p.slice(5); continue; }
    if (p.startsWith('LEM:')) { lemma = p.slice(4); continue; }
    if (p === 'PREF' || p === 'STEM' || p === 'SUFF') continue;
    features.push(p);
  }
  return { root, lemma, features };
}

async function main() {
  ensureDirSync(DATA);
  const tsvPath = path.join(DATA, 'quran-morphology.txt');
  const r = await saveText(TSV_URL, tsvPath);
  log.info(`TSV — ${r.skipped ? 'skip' : `${r.bytes}B`}`);

  const text = await fsp.readFile(tsvPath, 'utf8');
  const lines = text.split('\n');
  const chapters = {};

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const tab1 = line.indexOf('\t');
    const tab2 = line.indexOf('\t', tab1 + 1);
    const tab3 = line.indexOf('\t', tab2 + 1);
    if (tab1 < 0 || tab2 < 0) continue;

    const ref = line.slice(0, tab1);
    const wordText = line.slice(tab1 + 1, tab2);
    const pos = line.slice(tab2 + 1, tab3 > 0 ? tab3 : undefined);
    const featRaw = tab3 > 0 ? line.slice(tab3 + 1) : '';

    const [s, v, w] = ref.split(':').map(Number);
    if (!s || !v || !w) continue;

    const { root, lemma, features } = parseFeatures(featRaw);
    const seg = { text: wordText, type: parseSegType(featRaw), pos: pos.trim(), ...(root ? { root } : {}), ...(lemma ? { lemma } : {}), features };

    if (!chapters[s]) chapters[s] = {};
    const key = `${v}:${w}`;
    if (!chapters[s][key]) chapters[s][key] = [];
    chapters[s][key].push(seg);
  }

  const chaptersDir = path.join(DATA, 'chapters');
  ensureDirSync(chaptersDir);
  for (const [ch, map] of Object.entries(chapters)) {
    fs.writeFileSync(path.join(chaptersDir, `${ch}.json`), JSON.stringify(map));
  }
  log.info(`Parsed ${Object.keys(chapters).length} chapters of morphology data.`);
  await log.flush({ chapters: Object.keys(chapters).length });
}

main().catch(e => { log.error(String(e?.stack || e)); log.flush(); process.exitCode = 1; });
