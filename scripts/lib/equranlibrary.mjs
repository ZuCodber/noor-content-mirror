// Minimal scraper helpers for equranlibrary.com — a JSF/PrimeFaces (Java)
// site with no JSON API, so this parses server-rendered HTML directly.
// Structure verified live 2026-09-09 against real pages (view-source, not
// guessed): a JSESSIONID-based session (grabbed once, reused for the whole
// run — no login involved, just anonymous Java session tracking), per-ayah
// tafsir pages (/tafseer/{slug}/{surah}/{ayah}, no bulk view exists — a
// /tafseer/{slug}/{surah} request 404s), and per-surah bulk translation
// pages (/translation/{slug}/{surah}, all ayahs in one response).
import { fetchWithRetry } from './http.mjs';

const BASE = 'https://equranlibrary.com';
let _cookie = null;

async function ensureSession() {
  if (_cookie) return _cookie;
  const res = await fetchWithRetry(`${BASE}/quran/1`, {}, { retries: 3, timeoutMs: 20000 });
  const setCookie = res.headers.get('set-cookie');
  _cookie = setCookie ? setCookie.split(';')[0] : '';
  return _cookie;
}

async function getHtml(path) {
  const cookie = await ensureSession();
  const res = await fetchWithRetry(`${BASE}${path}`, { headers: { Cookie: cookie } }, { retries: 3, baseDelayMs: 1000, timeoutMs: 20000 });
  return res.text();
}

function stripTags(html) {
  return html
    .replace(/<small>[\s\S]*?<\/small>/g, '') // strip the trailing "tran-ss" ayah-number footnote marker
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parses one /tafseer/{slug}/{surah}/{ayah} page.
 * Returns null if the page has no real content (404 / empty ayah slot).
 */
export function parseTafsirPage(html) {
  // Title line, e.g. "Tafheem-ul-Quran - Al-Faatiha : 1"
  const titleMatch = html.match(/label-mr-top">\s*([^<]+?)\s*<\/div>/);
  const title = titleMatch ? titleMatch[1].trim() : null;

  // The single Arabic ayah text block for this page.
  const arabicMatch = html.match(/<div class="text center-justified"><span dir="rtl">([\s\S]*?)<\/span>/);
  const arabicText = arabicMatch ? stripTags(arabicMatch[1]) : null;

  // Plain translation paired with this ayah (short, "preformatted center-justified").
  const shortTransMatches = [...html.matchAll(/<div class="translation center-justified"><span class="preformatted" dir="rtl">([\s\S]*?)<\/span>/g)];
  const shortTranslation = shortTransMatches.length ? stripTags(shortTransMatches[shortTransMatches.length - 1][1]) : null;

  // The actual tafsir commentary body: inside its own <div class="card">,
  // a <div class="translation "> (note: NO "center-justified") containing
  // a preformatted span. This is the last such block on the page.
  const bodyMatches = [...html.matchAll(/<div class="translation "><span class="preformatted" dir="rtl">([\s\S]*?)<\/span>\s*<\/div>/g)];
  const commentary = bodyMatches.length ? stripTags(bodyMatches[bodyMatches.length - 1][1]) : null;

  if (!arabicText && !commentary) return null; // genuinely empty/missing page
  return { title, arabicText, translation: shortTranslation, commentary };
}

/**
 * Parses one /translation/{slug}/{surah} page — ALL ayahs of that surah in
 * one page, alternating Arabic-text / translation blocks in ayah order.
 *
 * Verified live 2026-09-09: every surah's translation page renders an
 * unnumbered leading Bismillah line as its own entry BEFORE ayah 1 — except
 * surah 1 (where Bismillah genuinely IS ayah 1, standard practice) and
 * surah 9 (which has no Bismillah at all, so nothing to strip). Confirmed
 * by comparing returned counts against real per-surah ayah counts: surah 2
 * returned 287 (real 286, extra leading Bismillah), surah 9 returned 129
 * (real 129, exact), surah 3 returned 201 (real 200). `surah` is required
 * so this can apply that exception correctly instead of guessing from text.
 */
export function parseTranslationPage(html, surah) {
  const arabicBlocks = [...html.matchAll(/<div class="text center-justified"><span dir="rtl">([\s\S]*?)<\/span>/g)].map(m => stripTags(m[1]));
  // English translation pages use a different class/dir than Urdu ones
  // (class="translation-english", dir="ltr" vs class="translation",
  // dir="rtl") — verified live 2026-09-09 (this is what made maududi_en and
  // sahih_en fail 114/114 on the first run). Match either.
  const transBlocks = [...html.matchAll(/<div class="translation(?:-english)? center-justified"><span class="preformatted" dir="(?:rtl|ltr)">([\s\S]*?)<\/span>/g)].map(m => stripTags(m[1]));
  let count = Math.min(arabicBlocks.length, transBlocks.length);
  let offset = 0;
  if (surah !== 1 && count > 0 && /^بِسْمِ/.test(arabicBlocks[0])) {
    offset = 1; // drop the extraneous leading Bismillah line
  }
  const ayahs = [];
  for (let i = offset; i < count; i++) {
    ayahs.push({ numberInSurah: i + 1 - offset, arabicText: arabicBlocks[i], translation: transBlocks[i] });
  }
  return ayahs;
}

export async function fetchTafsirAyah(slug, surah, ayah) {
  const html = await getHtml(`/tafseer/${slug}/${surah}/${ayah}`);
  return parseTafsirPage(html);
}

export async function fetchTranslationSurah(slug, surah) {
  const html = await getHtml(`/translation/${slug}/${surah}`);
  return parseTranslationPage(html, surah);
}
