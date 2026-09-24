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

// Two bugs found live 2026-09-23 (both caught by the user comparing our
// output against a raw copy-paste from the site itself), same root cause —
// being too aggressive about "cleaning up" text that actually carries real
// structure:
//
// 1. The site's commentary blocks contain REAL, meaningful line breaks —
//    not markup (no <br> tags anywhere; confirmed by grep), just literal
//    newlines in the raw HTML — separating distinct points/paragraphs
//    within a single ayah's commentary, and separating each ayah's own
//    heading+text when several are grouped under one page. `\s+` -> ' ' was
//    collapsing all of that into one run-on blob. Fixed to only collapse
//    horizontal whitespace (spaces/tabs) per line, keep newlines as real
//    line breaks, and only trim redundant *blank* lines (3+ in a row -> 2).
//
// 2. The inline <small><font class="tran-ss">N</font></small> markers are
//    NOT redundant ayah-number noise (what they were originally added for,
//    on a single-ayah detail page) — on the bulk grouped translation/
//    commentary blocks this same markup carries real footnote-style
//    reference numbers (e.g. "...ہے۔278نہ وہ سوتا..." in the translation,
//    "سورة الْبَقَرَة 278" as a commentary heading) that link a specific
//    phrase in the translation to its own commentary paragraph — deleting
//    the whole tag deleted real reference numbers the user wants kept
//    exactly. Fixed by no longer special-casing <small> at all: the
//    generic tag-stripper below already does the right thing on its own
//    (strips the <small>/<font> wrapper tags, keeps the enclosed number as
//    plain inline text, exactly matching a raw copy-paste from the page).
function stripTags(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n') // not observed on this site, but handle it if it ever appears
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
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
  // English-language tafsirs (e.g. Tafheem-ul-Quran (English)) use
  // class="translation-english ..." + dir="ltr" instead of Urdu's
  // class="translation ..." + dir="rtl" — same distinction found and fixed
  // in parseTranslationPage, but this function needed its own fix (found
  // live 2026-09-09: Tafheem-ul-Quran English had translation+commentary
  // BOTH null for every ayah of surah 102 — arabicText alone isn't enough
  // to catch this, since that's always present).
  const shortTransMatches = [...html.matchAll(/<div class="translation(?:-english)? center-justified"><span class="preformatted" dir="(?:rtl|ltr)">([\s\S]*?)<\/span>/g)];
  const shortTranslation = shortTransMatches.length ? stripTags(shortTransMatches[shortTransMatches.length - 1][1]) : null;

  // The actual tafsir commentary body: inside its own <div class="card">,
  // a <div class="translation "> or <div class="translation-english "> (NO
  // "center-justified") containing a preformatted span. Last such block on
  // the page.
  const bodyMatches = [...html.matchAll(/<div class="translation(?:-english)? "><span class="preformatted" dir="(?:rtl|ltr)">([\s\S]*?)<\/span>\s*<\/div>/g)];
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

// Content-integrity check found necessary live 2026-09-09: this site
// (JSF/PrimeFaces, stateful, one shared session cookie across all our
// requests) intermittently returns a DIFFERENT ayah's content for the URL
// actually requested — confirmed by inspecting already-stored files (e.g.
// taiseerulquran surah 1, ayahs 1-4 all held ayah 2's title/text verbatim).
// Didn't reproduce reliably in isolated concurrency tests, so lowering
// concurrency alone isn't something to trust blindly — the page's own
// title line states which ayah it actually rendered, so every fetch
// verifies that against what was asked for and retries as a failure on
// any mismatch, catching it regardless of root cause. Used by both the
// downloader (script 11) and the repair tool (script 13) so they can't
// drift out of sync with each other.
export function titleAyahNumber(title) {
  const m = title?.match(/:\s*(\d+)\s*$/);
  return m ? Number(m[1]) : null;
}

export async function fetchTafsirAyahVerified(slug, surah, ayahNo, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const entry = await fetchTafsirAyah(slug, surah, ayahNo);
      const gotAyah = titleAyahNumber(entry?.title);
      if (entry && gotAyah !== null && gotAyah !== ayahNo) {
        throw new Error(`content mismatch: requested ayah ${ayahNo}, page title says ayah ${gotAyah}`);
      }
      return entry;
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise(r => setTimeout(r, 2000)); // flat 2s gap per user request
    }
  }
  throw lastErr;
}

export async function fetchTranslationSurah(slug, surah) {
  const html = await getHtml(`/translation/${slug}/${surah}`);
  return parseTranslationPage(html, surah);
}
