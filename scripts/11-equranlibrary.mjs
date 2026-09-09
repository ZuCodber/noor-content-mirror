// Mirrors equranlibrary.com — translations (bulk per-surah pages) and a
// curated set of tafsirs NOT already covered by the other sources in this
// mirror (per-ayah pages only; no bulk view exists for tafsir on this
// site — confirmed live 2026-09-09, /tafseer/{slug}/{surah} 404s).
//
// Scope decided live with the user: do these first, decide on the
// remaining ~36 of the site's 46 tafsirs afterward. Two of these ten don't
// exist anywhere else in this mirror as structured per-ayah data — Tafheem-
// ul-Quran (Maududi) and Tafseer-e-Usmani (Shabbir Ahmad Usmani) — per
// spa5kTafsirApi.ts's own comment, which explicitly researched and gave up
// on finding structured data for these two.
//
// No robots.txt (404), no ToS found, and the site's own About page states
// its purpose as "share them with other people" — checked before writing
// this, not assumed.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pool, Logger, ensureDirSync } from './lib/http.mjs';
import { fetchTafsirAyahVerified, fetchTranslationSurah } from './lib/equranlibrary.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data', 'quran', 'equranlibrary');

const log = new Logger(path.join(ROOT, 'logs', '11-equranlibrary.json'));

const TRANSLATIONS = ['jalandhary', 'junagarhi', 'maududi', 'maududi_en', 'sahih_en', 'taqi'];

// The 10 confirmed-new (not already in this mirror via QF/spa5k/quranapi)
// tafsirs, verified live against equranlibrary.com's own tafsir-switcher
// menu (author names shown alongside each slug there, matched below).
const TAFSIRS = [
  { slug: 'taiseerulquran',    name: 'Taiseer-ul-Quran',         author: 'Abdur Rahman Kilani' },
  { slug: 'tafheemulquran',    name: 'Tafheem-ul-Quran (Urdu)',  author: 'Syed Abul Ala Maududi' },
  { slug: 'usmani',            name: 'Tafseer-e-Usmani',         author: 'Shabbir Ahmad Usmani' },
  { slug: 'tafheemulquranen',  name: 'Tafheem-ul-Quran (English)', author: 'Syed Abul Ala Maududi' },
  { slug: 'tadabburequran',    name: 'Tadabbur-e-Quran',         author: 'Amin Ahsan Islahi' },
  { slug: 'duremansoor',       name: 'Durr-e-Mansoor',           author: 'Imam Jalal ad-Din as-Suyuti' },
  { slug: 'mazhari',           name: 'Tafsir Mazhari',           author: 'Qazi Sanaullah Panipati' },
  { slug: 'bayanulquranthanvi', name: 'Bayan-ul-Quran (Thanvi)', author: 'Ashraf Ali Thanvi' },
  { slug: 'haqqani',           name: 'Tafsir Haqqani',           author: 'Abdul Haq Haqqani' },
  { slug: 'majidi',            name: 'Tafsir Majidi',            author: 'Abdul Majid Daryabadi' },
];

async function main() {
  const chapters = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'quran', 'foundation', 'chapters.json'), 'utf8')).chapters;
  const versesCount = new Map(chapters.map(c => [c.id, c.verses_count]));

  ensureDirSync(DATA);
  fs.writeFileSync(path.join(DATA, 'tafsirs-catalog.json'), JSON.stringify(TAFSIRS, null, 2));

  // ─── Translations: bulk per-surah, cheap ──────────────────────────────
  let transOk = 0, transFailed = 0;
  for (const slug of TRANSLATIONS) {
    const { ok, failed, failures } = await pool(chapters.map(c => c.id), 5, async (surah) => {
      const dest = path.join(DATA, 'translation', slug, `${surah}.json`);
      if (fs.existsSync(dest)) return;
      const ayahs = await fetchTranslationSurah(slug, surah);
      const expected = versesCount.get(surah);
      if (ayahs.length !== expected) {
        throw new Error(`ayah count mismatch for ${slug} surah ${surah}: got ${ayahs.length}, expected ${expected}`);
      }
      ensureDirSync(path.dirname(dest));
      fs.writeFileSync(dest, JSON.stringify({ surah, ayahs }));
    });
    transOk += ok; transFailed += failed;
    log.info(`translation ${slug} — ok=${ok} failed=${failed}`);
  }

  // ─── Tafsirs: per-ayah only, the expensive part ───────────────────────
  // Per user request 2026-09-09: (1) a failed ayah gets 3 immediate
  // attempts right then, not a single try; (2) whatever surahs still
  // failed after a full pass get retried again at the end of that SAME
  // tafsir — self-healing within one script run — before moving to the
  // next tafsir, instead of requiring a separate manual re-run.
  // Attempts one surah; returns true if it completed and was written.
  // fetchTafsirAyahVerified (lib/equranlibrary.mjs) does the 3-attempt/2s-gap
  // retry AND validates each page's own title against the ayah we asked
  // for, retrying as a failure on any mismatch — see that function's
  // comment for why (a real, confirmed data-corruption bug, not a
  // hypothetical one).
  async function processSurah(slug, surah) {
    const dest = path.join(DATA, 'tafsir', slug, `${surah}.json`);
    if (fs.existsSync(dest)) return true;
    const total = versesCount.get(surah);
    const ayahNums = Array.from({ length: total }, (_, i) => i + 1);
    const results = new Array(total).fill(null);
    const { ok, failed, failures } = await pool(ayahNums, 2, async (ayahNo) => {
      const entry = await fetchTafsirAyahVerified(slug, surah, ayahNo);
      results[ayahNo - 1] = entry ? { ayah: ayahNo, ...entry } : { ayah: ayahNo, missing: true };
    });
    tafsirOk += ok; tafsirFailed += failed;
    if (failed) {
      allTafsirFailures.push({ slug, surah, failed, sample: failures.slice(0, 3) });
      return false;
    }
    ensureDirSync(path.dirname(dest));
    fs.writeFileSync(dest, JSON.stringify({ surah, tafsir: slug, ayahs: results }));
    return true;
  }

  let tafsirOk = 0, tafsirFailed = 0;
  const allTafsirFailures = [];
  for (const { slug, name } of TAFSIRS) {
    let pending = chapters.map(c => c.id);
    // Initial pass over every surah, then up to 3 cleanup passes over
    // whatever's still missing — bounded so a genuinely broken slug can't
    // loop forever, but a normal transient-failure tail (a handful of
    // surahs) gets healed automatically before moving on.
    for (let round = 0; round <= 3 && pending.length; round++) {
      if (round > 0) log.info(`${slug} — cleanup round ${round}, ${pending.length} surah(s) left: ${pending.join(',')}`);
      const stillFailed = [];
      for (const surah of pending) {
        const ok = await processSurah(slug, surah);
        if (!ok) stillFailed.push(surah);
        else if (round > 0) log.info(`${slug} surah ${surah} — recovered on cleanup round ${round}`);
      }
      pending = stillFailed;
    }
    if (pending.length) log.info(`${slug} — gave up on ${pending.length} surah(s) after cleanup rounds: ${pending.join(',')}`);
    log.info(`tafsir ${slug} (${name}) — all ${chapters.length} surahs done. running totals: ok=${tafsirOk} failed=${tafsirFailed}`);
  }

  log.info(`ALL DONE. translations ok=${transOk} failed=${transFailed}; tafsirs ok=${tafsirOk} failed=${tafsirFailed}`);
  await log.flush({ transOk, transFailed, tafsirOk, tafsirFailed, allTafsirFailures: allTafsirFailures.slice(0, 50) });
}

main().catch(e => { log.error(String(e?.stack || e)); log.flush(); process.exitCode = 1; });
