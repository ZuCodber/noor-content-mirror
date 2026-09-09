// Repairs the exact bug found live 2026-09-09: script 11 used to write a
// surah's tafsir file even when some ayahs failed mid-pool, leaving `null`
// holes — and because the file existed, later runs would skip that surah
// forever, silently locking the holes in. Fixed at the source in script 11
// (a surah file is now only written when complete), but this repairs
// whatever was already written with holes, by re-fetching just the missing
// ayahs and patching them in place — far cheaper than redownloading whole
// surahs.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Logger, ensureDirSync } from './lib/http.mjs';
import { fetchTafsirAyah } from './lib/equranlibrary.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TAFSIR_DIR = path.join(ROOT, 'data', 'quran', 'equranlibrary', 'tafsir');

const log = new Logger(path.join(ROOT, 'logs', '12-repair-equranlibrary-holes.json'));

async function main() {
  if (!fs.existsSync(TAFSIR_DIR)) { log.info('No tafsir dir yet — nothing to repair.'); return; }
  let totalHoles = 0, totalFixed = 0, totalStillBroken = 0;
  const stillBroken = [];

  for (const slug of fs.readdirSync(TAFSIR_DIR)) {
    const dir = path.join(TAFSIR_DIR, slug);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir)) {
      const p = path.join(dir, file);
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      const holeIndexes = data.ayahs.map((a, i) => (a === null ? i : -1)).filter(i => i >= 0);
      if (!holeIndexes.length) continue;

      totalHoles += holeIndexes.length;
      log.info(`${slug} surah ${data.surah} — ${holeIndexes.length} holes: ayahs ${holeIndexes.map(i => i + 1).join(',')}`);

      for (const idx of holeIndexes) {
        const ayahNo = idx + 1;
        try {
          const entry = await fetchTafsirAyah(slug, data.surah, ayahNo);
          data.ayahs[idx] = entry ? { ayah: ayahNo, ...entry } : { ayah: ayahNo, missing: true };
          totalFixed++;
        } catch (e) {
          totalStillBroken++;
          stillBroken.push({ slug, surah: data.surah, ayah: ayahNo, error: String(e?.message || e) });
        }
      }
      ensureDirSync(dir);
      fs.writeFileSync(p, JSON.stringify(data));
    }
  }

  log.info(`DONE. holes found=${totalHoles} fixed=${totalFixed} still broken=${totalStillBroken}`);
  await log.flush({ totalHoles, totalFixed, totalStillBroken, stillBroken });
}

main().catch(e => { log.error(String(e?.stack || e)); log.flush(); process.exitCode = 1; });
