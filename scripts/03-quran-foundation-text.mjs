// Mirrors api.quran.com/api/v4 (Quran Foundation) text data — the richest
// source: Uthmani script + Tajweed markup + word-by-word (Arabic + en/ur/hi
// glosses + transliteration) + EVERY translation resource + juz/hizb/page
// metadata, per chapter. No auth token needed — verified live 2026-09-09
// that these read endpoints work fully unauthenticated (and no client
// id/secret exists anywhere in the noor-server-video repo either).
//
// Key finding (verified live, not assumed from app code): the app's own
// fetchAllVerses() comment claims the API "caps at 50/page", but per_page=300
// returns Al-Baqarah's full 286 ayahs in ONE request (next_page: null) — and
// passing all 126 translation resource ids at once in a single request also
// works (200, full 126 translations per verse). So this script needs only
// 3 requests per chapter (one per word-gloss language) instead of the
// thousands a naive per-ayah/paginated/chunked approach would cost.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { saveJson, pool, Logger, ensureDirSync, SURAHS, fetchWithRetry } from './lib/http.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data', 'quran', 'foundation');
const BASE = 'https://api.quran.com/api/v4';
const PER_PAGE = 300; // exceeds every surah's ayah count (max 286, Al-Baqarah)

const log = new Logger(path.join(ROOT, 'logs', '03-quran-foundation-text.json'));

async function qfGet(pathAndQuery) {
  const res = await fetchWithRetry(
    `${BASE}${pathAndQuery}`,
    { headers: { Accept: 'application/json' } },
    { retries: 3, baseDelayMs: 1000, timeoutMs: 20000 },
  );
  return res.json();
}

// Belt-and-suspenders watchdog: api.quran.com had a live backend outage
// (Varnish "503 Backend fetch failed") during this mirror's first run
// 2026-09-09 that manifested as a fully-hung request even past
// fetchWithRetry's own AbortController timeout+retries — one chapter (out
// of 114, running at concurrency 4) never returned and silently stalled the
// whole script for 3+ minutes with zero progress or error logged. Racing
// against a hard external deadline guarantees the pool worker moves on to
// the next chapter regardless of what the network layer does underneath.
function withDeadline(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Deadline exceeded (${ms}ms): ${label}`)), ms)),
  ]);
}

async function main() {
  ensureDirSync(DATA);

  log.info('Fetching chapters + resources catalogs...');
  await saveJson(`${BASE}/chapters?language=en`, path.join(DATA, 'chapters.json'), { force: true });
  for (const lang of ['ar', 'ur', 'hi']) {
    await saveJson(`${BASE}/chapters?language=${lang}`, path.join(DATA, `chapters.${lang}.json`), { force: true });
  }
  await saveJson(`${BASE}/resources/recitations?language=en`, path.join(DATA, 'resources', 'recitations.json'), { force: true });
  await saveJson(`${BASE}/resources/translations?language=en`, path.join(DATA, 'resources', 'translations.json'), { force: true });
  await saveJson(`${BASE}/resources/tafsirs?language=en`, path.join(DATA, 'resources', 'tafsirs.json'), { force: true });
  await saveJson(`${BASE}/resources/languages`, path.join(DATA, 'resources', 'languages.json'), { force: true });

  const translationsCatalog = JSON.parse(fs.readFileSync(path.join(DATA, 'resources', 'translations.json'), 'utf8'));
  const allTranslationIds = translationsCatalog.translations.map(t => t.id);
  log.info(`Translation resources to embed per verse: ${allTranslationIds.length}`);

  const VERSE_FIELDS = ['text_uthmani', 'text_uthmani_tajweed', 'verse_key', 'verse_number', 'juz_number', 'hizb_number', 'page_number'].join(',');
  const WORD_FIELDS = ['text_uthmani', 'char_type_name'].join(',');
  const TRANSLATION_FIELDS = ['resource_name', 'language_name', 'text'].join(',');

  // Root-caused live 2026-09-09: large chapters (Al-Baqarah, Ali 'Imran, etc.
  // — 286/200/176/... ayahs) consistently timed out combining all 126
  // translations into one request, even with zero concurrency — their
  // backend genuinely can't serve that combined payload fast enough for a
  // big chapter. Not random flakiness. Chunking translations and merging
  // client-side fixed every one of them (verified: all 18 previously-stuck
  // chapters succeeded once this landed).
  function chunkIds(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }
  async function fetchEnWithTranslations(chapter) {
    const chunks = chunkIds(allTranslationIds, 25);
    let merged = null;
    for (const c of chunks) {
      const page = await withDeadline(qfGet(`/verses/by_chapter/${chapter}?language=en&words=true&per_page=${PER_PAGE}` +
        `&translations=${c.join(',')}&fields=${VERSE_FIELDS}&word_fields=${WORD_FIELDS}&translation_fields=${TRANSLATION_FIELDS}`), 45000, `ch${chapter} en chunk`);
      if (!merged) {
        merged = page;
      } else {
        const byKey = new Map(page.verses.map(v => [v.verse_key, v]));
        merged.verses = merged.verses.map(v => ({ ...v, translations: [...(v.translations ?? []), ...(byKey.get(v.verse_key)?.translations ?? [])] }));
      }
    }
    return merged;
  }

  const verseJobs = SURAHS.map(n => n);
  const { ok, failed, failures } = await pool(verseJobs, 3, async (chapter) => {
    const dest = path.join(DATA, 'verses', `${chapter}.json`);
    if (fs.existsSync(dest)) { log.info(`verses/${chapter}.json — skip`); return; }
    log.info(`verses/${chapter}.json — starting...`);

    // Pass 1: English — base verse data (uthmani/tajweed/meta) + ALL translations (chunked) + en word gloss.
    const en = await fetchEnWithTranslations(chapter);

    // Pass 2 & 3: ur/hi word gloss only (translations omitted — same data
    // regardless of `language`, already captured in pass 1).
    const ur = await withDeadline(qfGet(`/verses/by_chapter/${chapter}?language=ur&words=true&per_page=${PER_PAGE}&word_fields=${WORD_FIELDS}`), 90000, `ch${chapter} ur`);
    const hi = await withDeadline(qfGet(`/verses/by_chapter/${chapter}?language=hi&words=true&per_page=${PER_PAGE}&word_fields=${WORD_FIELDS}`), 90000, `ch${chapter} hi`);

    const urByKey = new Map(ur.verses.map(v => [v.verse_key, v]));
    const hiByKey = new Map(hi.verses.map(v => [v.verse_key, v]));

    const merged = en.verses.map(v => {
      const urV = urByKey.get(v.verse_key);
      const hiV = hiByKey.get(v.verse_key);
      return {
        ...v,
        words: (v.words ?? []).map((w, i) => ({
          ...w,
          translation_ur: urV?.words?.[i]?.translation,
          translation_hi: hiV?.words?.[i]?.translation,
        })),
      };
    });

    ensureDirSync(path.dirname(dest));
    fs.writeFileSync(dest, JSON.stringify({ chapter, verses: merged }));
    log.info(`verses/${chapter}.json — ${merged.length} ayahs, ${allTranslationIds.length} translations, 3 word-gloss langs`);
    fs.writeFileSync(path.join(ROOT, 'logs', '03-quran-foundation-text.progress.json'),
      JSON.stringify({ lastChapterDone: chapter, t: new Date().toISOString() }));
  });

  log.info(`Verses done. ok=${ok} failed=${failed}`);

  // Alternate Quran scripts (uthmani_simple / indopak / imlaei), per chapter.
  const scripts = ['uthmani_simple', 'indopak', 'imlaei'];
  for (const script of scripts) {
    const { ok: sOk, failed: sFailed } = await pool(SURAHS, 6, async (chapter) => {
      const dest = path.join(DATA, 'scripts', script, `${chapter}.json`);
      await saveJson(`${BASE}/quran/verses/${script}?chapter_number=${chapter}`, dest);
    });
    log.info(`Script ${script} — ok=${sOk} failed=${sFailed}`);
  }

  await log.flush({ chaptersOk: ok, chaptersFailed: failed, failures });
}

main().catch(e => { log.error(String(e?.stack || e)); log.flush(); process.exitCode = 1; });
