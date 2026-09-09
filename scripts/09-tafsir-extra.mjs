// Mirrors the two extra tafsir sources, both fetched per-surah in bulk
// (verified live 2026-09-09 — quranapi.pages.dev's /tafsir/{surah}.json
// returns the whole surah's tafsir across all its authors in one request,
// same shape confirmed for Al-Fatihah: {surahName, totalVerse, tafsirs:
// [[{author,groupVerse,content}], ...]} indexed by ayah).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveJson, pool, Logger, SURAHS } from './lib/http.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data', 'quran', 'tafsir-extra');

const log = new Logger(path.join(ROOT, 'logs', '09-tafsir-extra.json'));

// Mirrored from src/services/spa5kTafsirApi.ts SPA5K_TAFSIRS — EXCEPT
// 'ur-tafsir-fe-zalul-quran-syed-qatab', which is a genuine bug in that file
// (and thus in the live app itself): verified live 2026-09-09 that path
// 404s, while the real directory in spa5k/tafsir_api is
// 'tafsir-fe-zalul-quran-syed-qatab' (no 'ur-' prefix) — confirmed via the
// GitHub contents API and a live 200 fetch. Worth a fix upstream in the app.
const SPA5K_SLUGS = [
  'en-tafsir-maarif-ul-quran', 'en-al-jalalayn', 'en-tafisr-ibn-kathir',
  'en-tazkirul-quran', 'en-tafsir-ibn-abbas', 'en-tafsir-al-mukhtasar',
  'tafsir-fe-zalul-quran-syed-qatab', 'ur-tafsir-bayan-ul-quran',
  'ur-tafseer-ibn-e-kaseer', 'ur-tazkirul-quran', 'ur-tafsir-as-saadi-urdu',
  'hindi-mokhtasar',
];

async function main() {
  log.info('Fetching quranapi.pages.dev (Ibn Kathir + others) per surah...');
  const { ok: ikOk, failed: ikFailed } = await pool(SURAHS, 6, async (surah) => {
    const dest = path.join(DATA, 'ibnkathir-quranapi', `${surah}.json`);
    await saveJson(`https://quranapi.pages.dev/api/tafsir/${surah}.json`, dest);
  });
  log.info(`quranapi.pages.dev — ok=${ikOk} failed=${ikFailed}`);

  log.info('Fetching spa5k/tafsir_api (12 curated tafsirs) per surah...');
  let spa5kOk = 0, spa5kFailed = 0;
  for (const slug of SPA5K_SLUGS) {
    const { ok, failed } = await pool(SURAHS, 6, async (surah) => {
      const dest = path.join(DATA, 'spa5k', slug, `${surah}.json`);
      await saveJson(`https://cdn.jsdelivr.net/gh/spa5k/tafsir_api@main/tafsir/${slug}/${surah}.json`, dest);
    });
    spa5kOk += ok; spa5kFailed += failed;
    log.info(`spa5k ${slug} — ok=${ok} failed=${failed}`);
  }

  log.info(`ALL DONE. ibnKathir ok=${ikOk} failed=${ikFailed}; spa5k ok=${spa5kOk} failed=${spa5kFailed}`);
  await log.flush({ ikOk, ikFailed, spa5kOk, spa5kFailed });
}

main().catch(e => { log.error(String(e?.stack || e)); log.flush(); process.exitCode = 1; });
