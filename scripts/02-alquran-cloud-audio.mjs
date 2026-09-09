// Mirrors per-surah recitation audio from cdn.islamic.network for a curated
// list of well-known reciters (scope narrowed 2026-09-09 on explicit user
// request — the raw catalog has 190 "audio editions" across ~180 distinct
// people, which at this environment's measured ~1.4MB/s aggregate throughput
// is a ~23-hour, ~115GB job; also, audio this size has no business being
// tracked in git, so a curated top-20 is both faster and matches what's
// actually going to be wired into the app).
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { saveBinary, pool, Logger, ensureDirSync, SURAHS } from './lib/http.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data', 'quran', 'alquran-cloud');
const CDN = 'https://cdn.islamic.network/quran';
const BITRATE = 128;

const log = new Logger(path.join(ROOT, 'logs', '02-alquran-cloud-audio.json'));

// The "famous 20" — verified live against editions.json 2026-09-09 (all 20
// identifiers confirmed to exist in the catalog). Mix of Murattal/Mujawwad
// styles across the most widely-recognized reciters; overlaps heavily with
// EDITIONS in src/services/quranApi.ts and CHAPTER_RECITERS in
// quranFoundationApi.ts so it matches what the app already references.
const FAMOUS_20 = [
  'abdulbasitmurattal', 'abdurrahmaansudais', 'alafasy', 'husary', 'minshawi',
  'muhammadayyoub', 'mahermuaiqly', 'hanirifai', 'saoodshuraym', 'hudhaify',
  'shaatree', 'ahmedajamy', 'abdullahbasfar', 'muhammadjibreel',
  'abdulbasitmujawwad', 'husarymujawwad', 'minshawimujawwad',
  'yasseraldossari', 'nasseralqatami', 'muhammadalluhaidan',
];

async function main() {
  const cataloguePath = path.join(DATA, 'editions.json');
  if (!fs.existsSync(cataloguePath)) {
    throw new Error('Run 01-alquran-cloud-text.mjs first (needs editions.json)');
  }
  const catalogue = JSON.parse(fs.readFileSync(cataloguePath, 'utf8'));
  const audioEditions = catalogue.data.filter(e => e.format === 'audio');
  const curated = FAMOUS_20.map(name => {
    const ed = audioEditions.find(e => e.identifier === `ar.${name}`);
    if (!ed) throw new Error(`Curated reciter ar.${name} not found in editions.json`);
    return ed;
  });
  log.info(`Curated famous reciters: ${curated.length} (of ${audioEditions.length} raw audio editions)`);
  fs.writeFileSync(path.join(DATA, 'audio-reciters-curated.json'), JSON.stringify(curated, null, 2));

  let totalOk = 0, totalFailed = 0;
  const allFailures = [];

  for (const ed of curated) {
    const jobs = SURAHS.map(n => ({ n, ed }));
    const { ok, failed, failures } = await pool(jobs, 8, async ({ n, ed }) => {
      const url = `${CDN}/audio-surah/${BITRATE}/${ed.identifier}/${n}.mp3`;
      const dest = path.join(DATA, 'audio', ed.identifier, String(BITRATE), `${n}.mp3`);
      await saveBinary(url, dest);
    });
    totalOk += ok; totalFailed += failed;
    if (failed) allFailures.push({ reciter: ed.identifier, failed, failures });
    log.info(`${ed.identifier} (${ed.englishName}) — ok=${ok} failed=${failed}`);
    ensureDirSync(path.join(ROOT, 'logs'));
    fs.writeFileSync(path.join(ROOT, 'logs', '02-alquran-cloud-audio.progress.json'),
      JSON.stringify({ lastReciter: ed.identifier, totalOk, totalFailed }, null, 2));
  }

  log.info(`ALL DONE. totalOk=${totalOk} totalFailed=${totalFailed}`);
  await log.flush({ curatedReciters: curated.length, totalOk, totalFailed, allFailures });
}

main().catch(e => { log.error(String(e?.stack || e)); log.flush(); process.exitCode = 1; });
