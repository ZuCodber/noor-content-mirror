// Mirrors continuous per-chapter recitation audio (one mp3 per chapter,
// hours-long for some reciters) from Quran Foundation's chapter_recitations
// endpoint, for every reciter in CHAPTER_RECITERS (mirrored from
// quranFoundationApi.ts — verified ids 1-23 via CDN probing there, id 16
// absent), plus word-level audio timestamp/segment data for the reciters
// wired into the app's RECITATION_IDS.
//
// Includes the known audio_url override for reciter 8 (Mohamed Siddiq
// al-Minshawi, Mujawwad) — the API's own metadata 404s; the real file lives
// under a different relative_path, root-caused in quranFoundationApi.ts.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveBinary, saveJson, pool, Logger, ensureDirSync, SURAHS } from './lib/http.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data', 'quran', 'foundation');
const BASE = 'https://api.quran.com/api/v4';

const log = new Logger(path.join(ROOT, 'logs', '05-quran-foundation-audio.json'));

// Mirrored from src/services/quranFoundationApi.ts CHAPTER_RECITERS.
const CHAPTER_RECITERS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 18, 19, 20, 21, 22, 23,
];

// Mirrored from CHAPTER_RECITER_AUDIO_OVERRIDE.
function overrideUrl(reciterId, chapterNumber) {
  if (reciterId === 8) {
    return `https://download.quranicaudio.com/quran/minshawi_mujawwad/${String(chapterNumber).padStart(3, '0')}.mp3`;
  }
  return null;
}

// Mirrored from RECITATION_IDS — the reciters the app actually offers
// word-level audio-sync timestamps for.
const RECITATION_IDS = [7, 3, 6, 9, 4, 5];

async function main() {
  let audioOk = 0, audioFailed = 0;
  const audioFailures = [];

  for (const reciterId of CHAPTER_RECITERS) {
    const { ok, failed, failures } = await pool(SURAHS, 4, async (chapter) => {
      const dest = path.join(DATA, 'audio', 'chapter', String(reciterId), `${chapter}.mp3`);
      const override = overrideUrl(reciterId, chapter);
      if (override) {
        await saveBinary(override, dest);
        return;
      }
      const res = await fetch(`${BASE}/chapter_recitations/${reciterId}/${chapter}`, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`metadata HTTP ${res.status}`);
      const json = await res.json();
      const audioUrl = json.audio_file?.audio_url;
      if (!audioUrl) throw new Error('no audio_url in response');
      await saveBinary(audioUrl, dest);
    });
    audioOk += ok; audioFailed += failed;
    if (failed) audioFailures.push({ reciterId, failed, failures });
    log.info(`chapter audio reciter ${reciterId} — ok=${ok} failed=${failed}`);
  }

  log.info('Fetching audio timestamps (word-level segments)...');
  let tsOk = 0, tsFailed = 0;
  for (const reciterId of RECITATION_IDS) {
    const { ok, failed } = await pool(SURAHS, 6, async (chapter) => {
      const dest = path.join(DATA, 'audio', 'timestamps', String(reciterId), `${chapter}.json`);
      await saveJson(`${BASE}/recitations/${reciterId}/by_chapter/${chapter}`, dest);
    });
    tsOk += ok; tsFailed += failed;
    log.info(`timestamps reciter ${reciterId} — ok=${ok} failed=${failed}`);
  }

  log.info(`ALL DONE. audioOk=${audioOk} audioFailed=${audioFailed} tsOk=${tsOk} tsFailed=${tsFailed}`);
  await log.flush({ audioOk, audioFailed, audioFailures, tsOk, tsFailed });
}

main().catch(e => { log.error(String(e?.stack || e)); log.flush(); process.exitCode = 1; });
