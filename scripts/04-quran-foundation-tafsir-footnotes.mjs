// Mirrors every Quran Foundation tafsir resource (full chapter per request —
// per_page=300 exceeds any surah's ayah count, confirmed live) and every
// footnote referenced inside the translations already downloaded by script
// 03 (parsed out of the <sup foot_note="N"> markup the app's own
// parseTranslationText() knows how to read).
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { saveJson, pool, Logger, ensureDirSync, SURAHS } from './lib/http.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data', 'quran', 'foundation');
const BASE = 'https://api.quran.com/api/v4';

const log = new Logger(path.join(ROOT, 'logs', '04-quran-foundation-tafsir-footnotes.json'));

function extractFootnoteIds(text) {
  const ids = [];
  const re = /<sup foot_note="?(\d+)"?>/gi;
  let m;
  while ((m = re.exec(text))) ids.push(Number(m[1]));
  return ids;
}

async function main() {
  const tafsirsCatalog = JSON.parse(fs.readFileSync(path.join(DATA, 'resources', 'tafsirs.json'), 'utf8'));
  const tafsirIds = tafsirsCatalog.tafsirs.map(t => t.id);
  log.info(`Tafsir resources: ${tafsirIds.length}`);

  let tafsirOk = 0, tafsirFailed = 0;
  for (const tafsirId of tafsirIds) {
    const { ok, failed } = await pool(SURAHS, 6, async (chapter) => {
      const dest = path.join(DATA, 'tafsir', String(tafsirId), `${chapter}.json`);
      await saveJson(`${BASE}/tafsirs/${tafsirId}/by_chapter/${chapter}?per_page=300`, dest);
    });
    tafsirOk += ok; tafsirFailed += failed;
    log.info(`tafsir ${tafsirId} — ok=${ok} failed=${failed}`);
  }

  // Collect every footnote id referenced across all downloaded translations.
  log.info('Scanning downloaded verses for footnote references...');
  const footnoteIds = new Set();
  for (const chapter of SURAHS) {
    const p = path.join(DATA, 'verses', `${chapter}.json`);
    if (!fs.existsSync(p)) continue;
    const { verses } = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const v of verses) {
      for (const t of v.translations ?? []) {
        for (const id of extractFootnoteIds(t.text ?? '')) footnoteIds.add(id);
      }
    }
  }
  log.info(`Unique footnote ids referenced: ${footnoteIds.size}`);

  const footnotesDest = path.join(DATA, 'footnotes', 'footnotes.json');
  ensureDirSync(path.dirname(footnotesDest));
  const existing = fs.existsSync(footnotesDest) ? JSON.parse(fs.readFileSync(footnotesDest, 'utf8')) : {};

  const remaining = [...footnoteIds].filter(id => !(id in existing));
  const { ok: fOk, failed: fFailed, failures } = await pool(remaining, 10, async (id) => {
    const res = await fetch(`${BASE}/foot_notes/${id}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} foot_note ${id}`);
    const json = await res.json();
    existing[id] = json.foot_note;
  });
  fs.writeFileSync(footnotesDest, JSON.stringify(existing));
  log.info(`Footnotes done. ok=${fOk} failed=${fFailed} totalStored=${Object.keys(existing).length}`);

  await log.flush({ tafsirOk, tafsirFailed, footnotesOk: fOk, footnotesFailed: fFailed, footnoteFailures: failures });
}

main().catch(e => { log.error(String(e?.stack || e)); log.flush(); process.exitCode = 1; });
