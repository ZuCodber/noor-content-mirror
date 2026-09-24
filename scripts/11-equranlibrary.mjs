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
import { fetchTafsirAyahVerified, fetchTranslationSurah, titleAyahNumber } from './lib/equranlibrary.mjs';

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

  // Batch 2 — per user request 2026-09-10 ("continue next batch of 10 once
  // this is done"), appended so the run continues automatically rather than
  // needing a manual restart. Picked from the 25 still-remaining slugs (46
  // total minus the 11 already covered elsewhere in this mirror minus
  // batch 1 above), verified against the live site's own listing.
  { slug: 'aasantarjumaquran', name: 'Aasan Quran',              author: 'Mufti Muhammad Taqi Usmani' },
  { slug: 'mazharulquran',     name: 'Mazhar-ul-Quran',          author: null },
  { slug: 'jawahirulquran',    name: 'Jawahir-ul-Quran',         author: 'Ghulam Ullah Khan' },
  { slug: 'fahmulquran',       name: 'Fahm-ul-Quran',            author: 'Mian Muhammad Jameel' },
  { slug: 'mutaliyaquran',     name: 'Mutalia-e-Quran',          author: 'Professor Hafiz Ahmad Yar' },
  { slug: 'maarifulqurankandhalwi', name: "Ma'arif-ul-Quran (Kandhalwi)", author: 'Muhammad Idrees Kandhlawi' },
  { slug: 'mufradatulquran',   name: 'Mufradat-ul-Quran',        author: null }, // lexicon/word-meanings, not prose commentary
  { slug: 'ruhulquran',        name: 'Ruh-ul-Quran',             author: 'Dr. Muhammad Aslam Siddiqui' },
  { slug: 'sirajulbayan',      name: 'Siraj-ul-Bayan',           author: null },
  { slug: 'tibyanulquran',     name: 'Tibyan-ul-Quran',          author: 'Ghulam Rasool Saeedi' },

  // Batch 3 — per user request 2026-09-10 ("keep the next batches ready
  // till we have all tafseers available"). This is the LAST batch: covers
  // every one of the site's 46 tafsirs except the 11 already mirrored
  // elsewhere (see top-of-file comment) — names/authors verified against
  // /alltafaseer/1's own listing, not guessed.
  { slug: 'ahkamulquran',      name: 'Ahkam-ul-Quran',           author: 'Imam Abu Bakr al-Jassas' },
  { slug: 'ahsanuttafaseer',   name: 'Ahsan-ut-Tafaseer',        author: 'Hafiz Muhammad Syed Ahmad Hasan' },
  { slug: 'alquranalkareem',   name: 'Al-Quran-al-Kareem',       author: 'Maulana Abdus Salam Bhatvi' },
  { slug: 'anwarulbayan',      name: 'Anwar-ul-Bayan',           author: 'Maulana Ashiq Ilahi Madani' },
  { slug: 'anwarulbayanali',   name: 'Anwar-ul-Bayan (Ali)',     author: 'Muhammad Ali PCS' }, // distinct slug/work from anwarulbayan above, despite the shared title
  { slug: 'ashrafulhawashi',   name: 'Ashraf-ul-Hawashi',        author: 'Sheikh Muhammad Abdul Falah' },
  { slug: 'asratuttanzil',     name: 'Asrar-ut-Tanzil',          author: 'Maulana Muhammad Akram Awan' },
  { slug: 'baseeratequran',    name: 'Baseerat-e-Quran',         author: 'Maulana Muhammad Asif Qasmi' },
  { slug: 'kashfurrahman',     name: 'Kashf-ur-Rahman',          author: 'Maulana Ahmad Saeed Dehlvi' },
  { slug: 'madani',            name: 'Tafseer-e-Madani',         author: 'Maulana Ishaq Madani' },
  { slug: 'madarikuttanzil',   name: 'Madarik-ut-Tanzil',        author: null }, // Urdu translation credited to Fateh Muhammad Jalandhry, original author unlisted on-site
  { slug: 'mafhoomulquran',    name: 'Mafhoom-ul-Quran',         author: 'Rafat Ejaz' },
  { slug: 'mualimulirfan',     name: "Mu'alim-ul-Irfan",         author: 'Maulana Abdul Hameed Swati' },
  { slug: 'tafseeralkitaab',   name: 'Tafseer-al-Kitaab',        author: 'Dr. Muhammad Usman' },
  { slug: 'urwatulwusqa',      name: 'Urwatul-Wusqaa',           author: 'Allama Abdul Kareem Asri' },
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
  // FORCE_REFETCH=1 re-downloads every tafsir surah even if the file
  // already exists — used once, 2026-09-23, to fix a real bug: stripTags()
  // used to collapse the site's genuine embedded newlines (separating
  // distinct commentary points/paragraphs) into single spaces, discarding
  // real structure the user wants preserved exactly. Fixed in
  // lib/equranlibrary.mjs; every already-downloaded tafsir needs
  // re-fetching to recover the newlines, since the flattening already
  // happened and can't be un-done from what's on disk. Deliberately an
  // overwrite-in-place (fs.writeFileSync on an existing path), not a
  // delete-then-refetch — git already holds the pre-fix content in
  // history, so nothing is destroyed, only superseded.
  const FORCE = process.env.FORCE_REFETCH === '1';
  // REFETCH_SINCE (ISO timestamp, optional): lets a restarted run skip any
  // surah file already overwritten by a PREVIOUS invocation of this same
  // FORCE_REFETCH pass (mtime >= this cutoff), while still force-refetching
  // everything else that's still on old pre-fix data. Added 2026-09-23 so
  // killing and restarting the re-scrape (e.g. to pick up the surah-level
  // retry-granularity fix below) doesn't have to redo tafsirs/surahs that
  // were already correctly re-fetched — only the untouched remainder.
  const REFETCH_SINCE = process.env.REFETCH_SINCE ? new Date(process.env.REFETCH_SINCE).getTime() : null;

  // resultsCache persists each surah's in-progress ayah array ACROSS
  // cleanup rounds (keyed by surah, reset per tafsir) so a retry only
  // re-fetches the specific ayah(s) that failed — not the whole surah.
  // Found necessary live 2026-09-23: without this, one flaky ayah near the
  // end of Al-Baqara (286 ayahs) forced re-fetching all 286 on every
  // cleanup round, wasting real time/effort across 35 tafsirs for no
  // reason — the other 285 had already succeeded and didn't need re-work.
  async function processSurah(slug, surah, resultsCache) {
    const dest = path.join(DATA, 'tafsir', slug, `${surah}.json`);
    if (fs.existsSync(dest)) {
      if (!FORCE) return true;
      if (REFETCH_SINCE && fs.statSync(dest).mtimeMs >= REFETCH_SINCE) return true;
    }
    const total = versesCount.get(surah);
    let results = resultsCache.get(surah);
    if (!results) {
      results = new Array(total).fill(null);
      resultsCache.set(surah, results);
    }
    const missingAyahNums = [];
    for (let i = 0; i < total; i++) if (!results[i]) missingAyahNums.push(i + 1);
    const { ok, failed, failures } = await pool(missingAyahNums, 2, async (ayahNo) => {
      const entry = await fetchTafsirAyahVerified(slug, surah, ayahNo);
      results[ayahNo - 1] = entry ? { ayah: ayahNo, ...entry } : { ayah: ayahNo, missing: true };
    });
    tafsirOk += ok; tafsirFailed += failed;
    if (failed) {
      allTafsirFailures.push({ slug, surah, failed, sample: failures.slice(0, 3) });
      return false;
    }
    resultsCache.delete(surah);
    ensureDirSync(path.dirname(dest));
    fs.writeFileSync(dest, JSON.stringify({ surah, tafsir: slug, ayahs: results }));
    return true;
  }

  // Post-completion spot-check: added 2026-09-23 per user request, after
  // the real "wrong ayah's content returned for this URL" corruption bug
  // (see fetchTafsirAyahVerified's comment) was found live. That bug is
  // already guarded against AT FETCH TIME (every fetch verifies the page's
  // own title against the ayah requested before accepting it) — this is a
  // SEPARATE, independent check on top: after each tafsir finishes, it
  // re-reads a handful of random already-written surah files straight off
  // disk (no network calls, so it's cheap enough to run after every single
  // tafsir) and re-validates the same title/ayah-number invariant, to
  // catch anything that could somehow reach disk wrong regardless of root
  // cause (a bug in this script's own write path, a corrupted write, etc.)
  // — not just re-trusting that the live check already covered it.
  function spotCheckTafsir(slug, chapterIds, sampleSurahs = 5, sampleAyahsPerSurah = 3) {
    const surahPool = [...chapterIds];
    const chosenSurahs = [];
    for (let i = 0; i < sampleSurahs && surahPool.length; i++) {
      chosenSurahs.push(surahPool.splice(Math.floor(Math.random() * surahPool.length), 1)[0]);
    }
    let checked = 0, mismatches = 0;
    for (const surah of chosenSurahs) {
      const dest = path.join(DATA, 'tafsir', slug, `${surah}.json`);
      if (!fs.existsSync(dest)) continue;
      let data;
      try { data = JSON.parse(fs.readFileSync(dest, 'utf8')); } catch (e) {
        mismatches++;
        log.error(`SPOT-CHECK: ${slug} surah ${surah} — file unreadable/corrupt JSON: ${e.message}`);
        continue;
      }
      const ayahPool = (data.ayahs || []).filter(a => a && !a.missing);
      const sample = [];
      for (let i = 0; i < sampleAyahsPerSurah && ayahPool.length; i++) {
        sample.push(ayahPool.splice(Math.floor(Math.random() * ayahPool.length), 1)[0]);
      }
      for (const a of sample) {
        checked++;
        const gotAyah = titleAyahNumber(a.title);
        if (gotAyah !== a.ayah) {
          mismatches++;
          log.error(`SPOT-CHECK MISMATCH: ${slug} surah ${surah} ayah ${a.ayah} — title says "${a.title}" (ayah ${gotAyah}), stored under ayah ${a.ayah}`);
        }
      }
    }
    log.info(`${slug} — post-completion spot-check: ${checked} random ayah(s) across ${chosenSurahs.length} surah(s), ${mismatches} mismatch(es)`);
    return mismatches;
  }

  let tafsirOk = 0, tafsirFailed = 0;
  const allTafsirFailures = [];
  for (const { slug, name } of TAFSIRS) {
    let pending = chapters.map(c => c.id);
    const resultsCache = new Map();
    // Initial pass over every surah, then up to 3 cleanup passes over
    // whatever's still missing — bounded so a genuinely broken slug can't
    // loop forever, but a normal transient-failure tail (a handful of
    // surahs) gets healed automatically before moving on.
    for (let round = 0; round <= 3 && pending.length; round++) {
      if (round > 0) log.info(`${slug} — cleanup round ${round}, ${pending.length} surah(s) left: ${pending.join(',')}`);
      const stillFailed = [];
      for (const surah of pending) {
        const ok = await processSurah(slug, surah, resultsCache);
        if (!ok) stillFailed.push(surah);
        else if (round > 0) log.info(`${slug} surah ${surah} — recovered on cleanup round ${round}`);
      }
      pending = stillFailed;
    }
    if (pending.length) log.info(`${slug} — gave up on ${pending.length} surah(s) after cleanup rounds: ${pending.join(',')}`);
    log.info(`tafsir ${slug} (${name}) — all ${chapters.length} surahs done. running totals: ok=${tafsirOk} failed=${tafsirFailed}`);
    spotCheckTafsir(slug, chapters.map(c => c.id));
  }

  log.info(`ALL DONE. translations ok=${transOk} failed=${transFailed}; tafsirs ok=${tafsirOk} failed=${tafsirFailed}`);
  await log.flush({ transOk, transFailed, tafsirOk, tafsirFailed, allTafsirFailures: allTafsirFailures.slice(0, 50) });
}

main().catch(e => { log.error(String(e?.stack || e)); log.flush(); process.exitCode = 1; });
