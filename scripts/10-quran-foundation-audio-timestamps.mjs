// Word-level audio-sync TIMESTAMPS only — pure JSON metadata (verse_key +
// millisecond offsets), NOT audio bytes. Split out from script 05 so it can
// run independently of actually downloading recitation audio (which is
// explicitly out of scope for git / not currently being pursued — see
// README's "Audio" section). This is small and text-only, so it's mirrored
// regardless of the audio decision.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveJson, pool, Logger, SURAHS } from './lib/http.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data', 'quran', 'foundation');
const BASE = 'https://api.quran.com/api/v4';

const log = new Logger(path.join(ROOT, 'logs', '10-quran-foundation-audio-timestamps.json'));

// Mirrored from RECITATION_IDS in src/services/quranFoundationApi.ts — the
// reciters the app actually offers word-level audio-sync timestamps for.
const RECITATION_IDS = [7, 3, 6, 9, 4, 5];

async function main() {
  let tsOk = 0, tsFailed = 0;
  const allFailures = [];
  for (const reciterId of RECITATION_IDS) {
    const { ok, failed, failures } = await pool(SURAHS, 6, async (chapter) => {
      const dest = path.join(DATA, 'audio', 'timestamps', String(reciterId), `${chapter}.json`);
      await saveJson(`${BASE}/recitations/${reciterId}/by_chapter/${chapter}`, dest);
    });
    tsOk += ok; tsFailed += failed;
    if (failed) allFailures.push({ reciterId, failed, failures });
    log.info(`timestamps reciter ${reciterId} — ok=${ok} failed=${failed}`);
  }
  log.info(`DONE. ok=${tsOk} failed=${tsFailed}`);
  await log.flush({ tsOk, tsFailed, allFailures });
}

main().catch(e => { log.error(String(e?.stack || e)); log.flush(); process.exitCode = 1; });
