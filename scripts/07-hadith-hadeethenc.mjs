// Mirrors hadeethenc.com's topical hadith encyclopedia: full category tree
// + every hadeeth's text/grade/explanation/hints, for the languages the app
// actually supports (en/ur/ar/hi — matching hadithBooksApi.ts's FAWAZ_LANG
// and translationService.ts's LangCode). Root categories total ~2,776
// hadeeths in English (verified live 2026-09-09), so this is a modest,
// finite dataset — not thousands of pages.
//
// Root-caused live in the app (see hadeethencApi.ts's own comment):
// /categories/list/?parent_id=X IGNORES parent_id server-side and always
// returns the full ~452-category flat tree. We fetch that ONCE per language
// (getAllCategoriesFlat), matching the app's own fix, instead of re-fetching
// per category.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fetchWithRetry, pool, Logger, ensureDirSync } from './lib/http.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data', 'hadith', 'hadeethenc');
const BASE = 'https://hadeethenc.com/api/v1';
const LANGS = ['en', 'ur', 'ar', 'hi'];

const log = new Logger(path.join(ROOT, 'logs', '07-hadith-hadeethenc.json'));

async function getJson(url) {
  const res = await fetchWithRetry(url, { headers: { Accept: 'application/json' } });
  return res.json();
}

async function main() {
  const summary = {};

  for (const lang of LANGS) {
    ensureDirSync(path.join(DATA, 'categories'));
    const catDest = path.join(DATA, 'categories', `${lang}.json`);
    let categories;
    if (fs.existsSync(catDest)) {
      categories = JSON.parse(fs.readFileSync(catDest, 'utf8'));
      log.info(`categories/${lang}.json — skip (${categories.length} categories)`);
    } else {
      categories = await getJson(`${BASE}/categories/list/?language=${lang}&parent_id=1`);
      fs.writeFileSync(catDest, JSON.stringify(categories));
      log.info(`categories/${lang}.json — ${categories.length} categories`);
    }

    // Walk every category, page through its hadeeths, collect unique ids.
    const ids = new Set();
    for (const cat of categories) {
      let pageNum = 1;
      for (;;) {
        const res = await getJson(`${BASE}/hadeeths/list/?language=${lang}&category_id=${cat.id}&page=${pageNum}&per_page=100`);
        for (const item of res.data ?? []) ids.add(item.id);
        if (pageNum >= (res.meta?.last_page ?? 1)) break;
        pageNum++;
      }
    }
    log.info(`${lang}: ${ids.size} unique hadeeth ids across ${categories.length} categories`);

    const detailDir = path.join(DATA, 'hadeeths', lang);
    const { ok, failed, failures } = await pool([...ids], 10, async (id) => {
      const dest = path.join(detailDir, `${id}.json`);
      if (fs.existsSync(dest)) return;
      const detail = await getJson(`${BASE}/hadeeths/one/?id=${id}&language=${lang}`);
      ensureDirSync(detailDir);
      fs.writeFileSync(dest, JSON.stringify(detail));
    });
    log.info(`${lang}: hadeeth details ok=${ok} failed=${failed}`);
    summary[lang] = { categories: categories.length, ids: ids.size, ok, failed, failures: failures.slice(0, 20) };
  }

  await log.flush({ summary });
}

main().catch(e => { log.error(String(e?.stack || e)); log.flush(); process.exitCode = 1; });
