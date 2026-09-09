// Local, offline replacement for the two live search endpoints
// (AlQuran Cloud's GET /search/:keyword/:surah/:edition and Quran
// Foundation's GET /search) — both go away if their servers do, since a
// search endpoint can't be "downloaded" the way a fixed resource can. This
// module gets the same job done against the full text we already mirrored.
//
// AlQuran Cloud's own search is a plain case-insensitive substring match
// (confirmed by their docs / behavior, not a fuzzy/ranked engine) — so a
// substring scan over the local edition file reproduces it exactly, same
// result set, same Ayah shape the app already expects.
//
// Quran Foundation's search IS a real ranked/fuzzy engine (Elasticsearch-
// backed) — this is deliberately NOT byte-for-byte reproduced (that engine
// itself is what would be gone), but scanning uthmani text + all
// translations for the query locally covers the common "find this phrase"
// case, just without their ranking/stemming.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

// ─── AlQuran Cloud–equivalent: SearchAPI.search(keyword, surah, edition) ────

let _editionCache = new Map();
function loadEdition(identifier) {
  if (_editionCache.has(identifier)) return _editionCache.get(identifier);
  const p = path.join(ROOT, 'data', 'quran', 'alquran-cloud', 'text', `${identifier}.json`);
  const data = JSON.parse(fs.readFileSync(p, 'utf8')); // { surahs: SurahFull[], edition }
  _editionCache.set(identifier, data);
  return data;
}

/**
 * Mirrors SearchAPI.search(keyword, surah, edition) from quranApi.ts.
 * @param {string} keyword
 * @param {number|'all'} surah
 * @param {string} edition default 'en.sahih' (matches the app's own default)
 * @returns {{count: number, matches: object[]}}
 */
export function searchAlQuranCloud(keyword, surah = 'all', edition = 'en.sahih') {
  const { surahs, edition: editionMeta } = loadEdition(edition);
  const needle = keyword.toLowerCase();
  const matches = [];
  for (const s of surahs) {
    if (surah !== 'all' && s.number !== Number(surah)) continue;
    for (const ayah of s.ayahs) {
      if (ayah.text.toLowerCase().includes(needle)) {
        matches.push({
          ...ayah,
          surah: { number: s.number, name: s.name, englishName: s.englishName, englishNameTranslation: s.englishNameTranslation, revelationType: s.revelationType },
        });
      }
    }
  }
  return { count: matches.length, matches, edition: editionMeta };
}

// ─── Quran Foundation–equivalent: SearchAPI.search(q, size, page) ───────────
// Approximate: substring match over Uthmani text + every downloaded
// translation for a chapter. Not ranked/stemmed like the real engine.

let _versesCache = new Map();
function loadChapterVerses(chapter) {
  if (_versesCache.has(chapter)) return _versesCache.get(chapter);
  const p = path.join(ROOT, 'data', 'quran', 'foundation', 'verses', `${chapter}.json`);
  if (!fs.existsSync(p)) return null;
  const data = JSON.parse(fs.readFileSync(p, 'utf8')); // { chapter, verses: QFVerse[] }
  _versesCache.set(chapter, data);
  return data;
}

/**
 * Mirrors (approximately) SearchAPI.search(q, size, page) from
 * quranFoundationApi.ts. Searches Uthmani text and every translation's
 * text across all 114 chapters that have been downloaded.
 * @param {string} q
 * @param {number} size page size, default 20 (matches the live default)
 * @param {number} page 0-indexed, matches the live API
 */
export function searchQuranFoundation(q, size = 20, page = 0) {
  const needle = q.toLowerCase();
  const results = [];
  for (let chapter = 1; chapter <= 114; chapter++) {
    const data = loadChapterVerses(chapter);
    if (!data) continue;
    for (const verse of data.verses) {
      const hitUthmani = verse.text_uthmani?.toLowerCase().includes(needle);
      const hitTranslation = (verse.translations ?? []).some(t => t.text?.toLowerCase().includes(needle));
      if (hitUthmani || hitTranslation) {
        results.push({
          verse_key: verse.verse_key,
          text: verse.text_uthmani,
          words: (verse.words ?? []).filter(w => w.char_type_name === 'word').map(w => ({ text: w.text_uthmani ?? w.text })),
        });
      }
    }
  }
  const total_results = results.length;
  const start = page * size;
  return { query: q, total_results, results: results.slice(start, start + size) };
}
