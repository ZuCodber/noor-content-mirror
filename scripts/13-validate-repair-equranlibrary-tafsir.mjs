// Scans every already-downloaded eQuranLibrary tafsir surah file for the
// content-corruption bug found live 2026-09-09 (this site intermittently
// returns a DIFFERENT ayah's content for the URL actually requested — see
// fetchTafsirAyahVerified's comment in lib/equranlibrary.mjs) and re-fetches
// (with the now-validating fetch) only the ayahs that are actually wrong —
// far cheaper than redownloading everything blind.
//
// An entry is flagged wrong when its own title's trailing ayah number
// doesn't match its array position, OR (for entries genuinely marked
// {missing:true}) trivially skipped — those are legitimate "no content on
// this ayah" markers, not corruption.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Logger, ensureDirSync } from './lib/http.mjs';
import { fetchTafsirAyahVerified, titleAyahNumber } from './lib/equranlibrary.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TAFSIR_DIR = path.join(ROOT, 'data', 'quran', 'equranlibrary', 'tafsir');

const log = new Logger(path.join(ROOT, 'logs', '13-validate-repair-equranlibrary-tafsir.json'));

async function main() {
  if (!fs.existsSync(TAFSIR_DIR)) { log.info('No tafsir dir yet.'); return; }

  let filesScanned = 0, entriesScanned = 0, wrongFound = 0, fixed = 0, stillWrong = 0;
  const stillWrongList = [];

  for (const slug of fs.readdirSync(TAFSIR_DIR)) {
    const dir = path.join(TAFSIR_DIR, slug);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir).sort((a, b) => Number(a.replace('.json', '')) - Number(b.replace('.json', '')))) {
      const p = path.join(dir, file);
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      filesScanned++;
      let changed = false;
      const wrongIdx = [];

      data.ayahs.forEach((entry, i) => {
        entriesScanned++;
        if (!entry || entry.missing) return; // legitimate "no content" marker, not corruption
        const expected = i + 1;
        const got = titleAyahNumber(entry.title);
        if (got !== null && got !== expected) wrongIdx.push(i);
      });

      if (!wrongIdx.length) continue;
      wrongFound += wrongIdx.length;
      log.info(`${slug} surah ${data.surah} — ${wrongIdx.length} wrong entr${wrongIdx.length === 1 ? 'y' : 'ies'} (ayahs ${wrongIdx.map(i => i + 1).join(',')})`);

      for (const idx of wrongIdx) {
        const ayahNo = idx + 1;
        try {
          const entry = await fetchTafsirAyahVerified(slug, data.surah, ayahNo);
          data.ayahs[idx] = entry ? { ayah: ayahNo, ...entry } : { ayah: ayahNo, missing: true };
          fixed++;
          changed = true;
        } catch (e) {
          stillWrong++;
          stillWrongList.push({ slug, surah: data.surah, ayah: ayahNo, error: String(e?.message || e) });
        }
      }

      if (changed) {
        ensureDirSync(dir);
        fs.writeFileSync(p, JSON.stringify(data));
      }
    }
  }

  log.info(`DONE. files=${filesScanned} entries=${entriesScanned} wrongFound=${wrongFound} fixed=${fixed} stillWrong=${stillWrong}`);
  await log.flush({ filesScanned, entriesScanned, wrongFound, fixed, stillWrong, stillWrongList: stillWrongList.slice(0, 100) });
}

main().catch(e => { log.error(String(e?.stack || e)); log.flush(); process.exitCode = 1; });
