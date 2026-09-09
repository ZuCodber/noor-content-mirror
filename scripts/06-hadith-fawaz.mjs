// Mirrors github.com/fawazahmed0/hadith-api — one JSON file per full book
// per language (confirmed live 2026-09-09: /editions/{lang}-{book}.json
// returns the ENTIRE book's hadiths in one request, not just one section),
// which is drastically fewer requests than paging through every chapter.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveJson, pool, Logger, ensureDirSync } from './lib/http.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data', 'hadith', 'fawaz');
const BASE = 'https://raw.githubusercontent.com/fawazahmed0/hadith-api/1';

const log = new Logger(path.join(ROOT, 'logs', '06-hadith-fawaz.json'));

// Matches HADITH_BOOKS / URD_SUPPORTED in src/services/hadithBooksApi.ts
const SEVEN_MAJOR = ['bukhari', 'muslim', 'tirmidhi', 'abudawud', 'nasai', 'ibnmajah', 'malik'];
const FORTY_COLLECTIONS = ['nawawi', 'qudsi', 'dehlawi'];
const LANG_PREFIX = { en: 'eng', ur: 'urd', ar: 'ara' };

async function main() {
  ensureDirSync(DATA);
  log.info('Fetching info.json (book/section metadata)...');
  await saveJson(`${BASE}/info.json`, path.join(DATA, 'info.json'), { force: true });

  const jobs = [];
  for (const book of SEVEN_MAJOR) {
    for (const lang of ['en', 'ur', 'ar']) {
      jobs.push({ book, lang, prefix: LANG_PREFIX[lang] });
    }
  }
  for (const book of FORTY_COLLECTIONS) {
    jobs.push({ book, lang: 'en', prefix: 'eng' });
    jobs.push({ book, lang: 'ar', prefix: 'ara' }); // Arabic originals exist for all editions per hadithBooksApi.ts comment
  }

  const { ok, failed, failures } = await pool(jobs, 5, async ({ book, lang, prefix }) => {
    const editionId = `${prefix}-${book}`;
    const dest = path.join(DATA, 'editions', `${editionId}.json`);
    const r = await saveJson(`${BASE}/editions/${editionId}.json`, dest);
    log.info(`${editionId} — ${r.skipped ? 'skip' : `${r.bytes}B`}`);
  });

  log.info(`Done. ok=${ok} failed=${failed}`);
  if (failed) log.error(JSON.stringify(failures, null, 2));
  await log.flush({ totalJobs: jobs.length, ok, failed, failures });
}

main().catch(e => { log.error(String(e?.stack || e)); log.flush(); process.exitCode = 1; });
