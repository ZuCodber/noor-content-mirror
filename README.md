# Noor Content Mirror

A complete local mirror of every Quran/Hadith data source that
[`noor-server-video`](../noor-server-video) pulls from at runtime — so the
app never breaks if `api.alquran.cloud`, `api.quran.com`, GitHub, jsDelivr,
or `hadeethenc.com` ever go away, rate-limit, or change shape.

Everything here is free/public data (no API keys required — every source
below works fully unauthenticated, verified live 2026-09-09). Nothing under
`data/` is meant to be hand-edited; re-run the matching script in `scripts/`
to refresh it.

## Layout

```
data/
  quran/
    alquran-cloud/
      editions.json              # full catalog: all 331 editions (text+audio) — unwrapped array
      text/{identifier}.json     # full mushaf, ONE file per text edition (141)
                                  # shape: { surahs: SurahFull[], edition } — unwrapped
                                  # (see "Shape notes" below re: the {code,status,data} envelope)
      audio/{identifier}/128/{surah}.mp3   # per-surah audio, curated "famous 20" reciters
    foundation/                  # api.quran.com/api/v4 — richer per-ayah data
      chapters.json              # 114 chapters, full metadata
      resources/                 # recitations.json, translations.json, tafsirs.json, languages.json
      verses/{chapter}.json      # per-chapter: uthmani + tajweed markup + word-by-word
                                  # (en/ur/hi glosses) + ALL translation resources + juz/hizb/page
      scripts/{script}/{chapter}.json   # uthmani_simple / indopak / imlaei text
      tafsir/{tafsirId}/{chapter}.json  # every QF tafsir resource, full chapter each
      footnotes/footnotes.json   # every footnote referenced by any downloaded translation
      audio/chapter/{reciterId}/{chapter}.mp3     # continuous per-chapter recitation
      audio/timestamps/{reciterId}/{chapter}.json # word-level segment timing
    tafsir-extra/
      ibnkathir-quranapi/{surah}.json    # quranapi.pages.dev (Ibn Kathir + others), per surah
      spa5k/{slug}/{surah}.json          # spa5k/tafsir_api — 12 curated tafsirs
    morphology/
      quran-morphology.txt       # raw source TSV
      chapters/{chapter}.json    # pre-parsed, same shape morphologyService.ts writes
    sajda.json                   # the 14 sajda ayahs
  hadith/
    fawaz/
      info.json                  # book/section metadata for all editions
      editions/{lang}-{book}.json   # FULL book, one file, all hadiths (en/ur/ar)
    hadeethenc/
      categories/{lang}.json     # full category tree
      hadeeths/{lang}/{id}.json  # every hadeeth: text, grade, explanation, hints

logs/                             # one JSON summary per script run + failure lists
scripts/                          # the downloaders (Node 20+, no dependencies)
  lib/search.mjs                  # local search — see "Local search" below
```

## Sources mirrored

| Source | What | Auth |
|---|---|---|
| `api.alquran.cloud` / `cdn.islamic.network` | Full Quran text, all 141 text editions; per-surah audio for curated reciters | none |
| `api.quran.com/api/v4` (Quran Foundation) | Chapters, verses (uthmani + tajweed + word-by-word + all translations), tafsirs, footnotes, chapter audio, audio timestamps | none — public read endpoints work unauthenticated (verified live; no client id/secret found in the app repo either) |
| `raw.githubusercontent.com/fawazahmed0/hadith-api` | Bukhari, Muslim, Tirmidhi, Abu Dawud, Nasa'i, Ibn Majah, Muwatta Malik, 40 Nawawi/Qudsi/Dehlawi — en/ur/ar, one file per full book | none |
| `hadeethenc.com/api/v1` | Topical hadith encyclopedia: categories + full hadeeth text/grade/explanation | none |
| `mustafa0x/quran-morphology` (GitHub raw) | Word-by-word Arabic morphology (root, lemma, POS) | none |
| `quranapi.pages.dev` | Ibn Kathir (+ other authors) tafsir, per surah | none |
| `cdn.jsdelivr.net/gh/spa5k/tafsir_api` | 12 curated tafsirs (en/ur/hi), per surah | none |

**Not mirrored — out of scope by choice** (video lectures, not Quran/Hadith
scripture data): YouTube lecture videos, the Cloudflare-hosted audio-lecture
proxy, and the Baseerat insights' archive.org audio links. Also deferred:
individual **word-audio** files (tens of thousands of tiny per-word mp3s
referenced inside the word-by-word JSON) — the JSON already records each
word's remote `audio_url`; only the files themselves aren't bulk-downloaded.

**Not mirrored — blocked upstream, not a choice**: `AudioCDN.ayahImage()`
(rendered PNG of an ayah's Arabic text, `cdn.islamic.network/quran/images/…`)
currently returns `403 AccessDenied` straight from their storage bucket —
verified live 2026-09-09, not a rate limit. This may already be broken in
the live app too, independent of this mirror. Nothing to download until
their infra is fixed; re-run `scripts/01` to pick it up whenever it is.

## Local search (no data to download — a code gap, now closed)

Both live search endpoints (`AlQuran Cloud GET /search/:keyword/:surah/:edition`
and `Quran Foundation GET /search`) return results computed on demand — there's
no fixed resource to download for arbitrary future keywords. `scripts/lib/search.mjs`
closes this with real local implementations against the text already mirrored:

- `searchAlQuranCloud(keyword, surah, edition)` — exact drop-in: AlQuran
  Cloud's own search is a plain case-insensitive substring match (not
  fuzzy/ranked), so scanning the local edition file reproduces identical
  results, in the same `{ count, matches }` shape `SearchAPI.search` returns.
- `searchQuranFoundation(q, size, page)` — approximate: Quran Foundation's
  real search is a ranked/fuzzy Elasticsearch-backed engine, which can't be
  faithfully reproduced offline (the engine itself is what would be gone).
  This scans Uthmani text + every downloaded translation for a substring
  match instead — covers "find this phrase" but without their
  ranking/stemming.

Both verified live against real queries (2026-09-09) — `searchAlQuranCloud('mercy')`
returns 143 real matches, `searchQuranFoundation('mercy')` returns 222.

## Shape notes (for whoever wires this in)

- AlQuran Cloud's raw API wraps every response as `{code, status, data}` —
  pure transport boilerplate once a file has downloaded successfully. All
  files under `data/quran/alquran-cloud/` are stored **already unwrapped**
  (just the `data` payload), matching what the app's own `apiFetch()` helper
  returns to callers — not the raw HTTP response.
- The real `/quran/{edition}` shape is `{ surahs: SurahFull[], edition }`
  (grouped by surah, each with its own `ayahs[]`) — **not** the flat
  `{ ayahs, edition }` that `QuranAPI.getFull()`'s own TypeScript signature
  in `quranApi.ts` declares. Harmless today (nothing in the app currently
  calls `getFull()`), but a real mismatch if anyone ever does — worth a
  one-line fix upstream.
- Quran Foundation (`data/quran/foundation/`) files are stored in their
  real, natural single-key-wrapped shape (`{chapters: [...]}`,
  `{translations: [...]}`, etc.) exactly as the live API returns them —
  the app's own `ResourcesAPI`/`ChaptersAPI` unwrap this with a plain
  `.then(r => r.chapters)`, so a local reader does the same one-line thing.

## Audio

Downloaded locally to `data/quran/alquran-cloud/audio/` and
`data/quran/foundation/audio/` for a curated "famous 20" reciter list (see
`FAMOUS_20` in `scripts/02-alquran-cloud-audio.mjs`), but **not tracked in
this git repo**, and `.gitignore`'d accordingly:

- Individual per-surah files routinely exceed GitHub's 100MB hard per-file
  limit even at 128kbps (e.g. Al-A'raf is ~137MB) — a plain `git push`
  rejects these outright, LFS or not.
- Full scope at 128kbps is ~2.2GB *per reciter* — GitHub's free LFS tier is
  1GB storage total for the whole account (not per-repo), so even one
  reciter doesn't fit, let alone 20. Decided live 2026-09-09: skip pushing
  audio to git entirely rather than fight that quota. The files stay on disk
  as part of the local mirror; re-run `scripts/02` / `scripts/05` to
  regenerate them, or push them somewhere with real object storage (S3,
  Cloudflare R2, a paid LFS data pack, etc.) if you want them off this
  machine too.

## Wiring this into the app later

Every file's shape matches exactly what the corresponding service in
`noor-server-video/src/services/*.ts` already parses from the live API
(`SurahFull`, `QFVerse`, `ChapterResponse`, etc.) — so a future "local file
first, network fallback" layer is a thin read-from-disk wrapper in front of
the existing `fetch` calls, not a data-model rewrite.

## Re-running / resuming

Every script is resumable — it skips any file that already exists on disk,
so killing a script partway through and re-running it later just fills in
what's missing.

```
node scripts/01-alquran-cloud-text.mjs
node scripts/02-alquran-cloud-audio.mjs
node scripts/03-quran-foundation-text.mjs
node scripts/04-quran-foundation-tafsir-footnotes.mjs
node scripts/05-quran-foundation-audio.mjs
node scripts/06-hadith-fawaz.mjs
node scripts/07-hadith-hadeethenc.mjs
node scripts/08-morphology.mjs
node scripts/09-tafsir-extra.mjs
node scripts/10-quran-foundation-audio-timestamps.mjs
```

## Status

See `PROGRESS.md` for the current run's status.
