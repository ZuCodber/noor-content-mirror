// Mirrors https://api.alquran.cloud/v1 — full Quran text, every text edition,
// in ONE request per edition (GET /quran/{identifier} returns the entire
// mushaf), plus the edition catalog and the 14 sajda ayahs.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveJson, pool, Logger, ensureDirSync } from './lib/http.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data', 'quran', 'alquran-cloud');
const BASE = 'https://api.alquran.cloud/v1';

const log = new Logger(path.join(ROOT, 'logs', '01-alquran-cloud-text.json'));

async function main() {
  ensureDirSync(DATA);
  log.info('Fetching edition catalog...');
  const cataloguePath = path.join(DATA, 'editions.json');
  await saveJson(`${BASE}/edition`, cataloguePath, { force: true, transform: j => j.data });
  const editions = JSON.parse(await (await import('node:fs/promises')).readFile(cataloguePath, 'utf8'));
  const textEditions = editions.filter(e => e.format === 'text');
  log.info(`Total editions: ${editions.length}. Text editions to mirror: ${textEditions.length}`);

  // NOTE: AlQuran Cloud wraps every response as {code, status, data: ...} —
  // the app's own apiFetch() helper unwraps this before returning to
  // callers, so for a genuine drop-in local mirror we store the unwrapped
  // `data` payload directly (transform below), not the raw envelope.
  // Also worth flagging: the real /quran/{edition} shape is
  // { surahs: SurahFull[], edition } (grouped by surah, each with its own
  // ayahs[]) — NOT the flat { ayahs, edition } that QuranAPI.getFull()'s own
  // TypeScript signature in quranApi.ts declares. Harmless in practice
  // (nothing in the app currently calls getFull()), but a real mismatch if
  // anyone ever does.
  const { ok, failed, failures } = await pool(textEditions, 6, async (ed) => {
    const dest = path.join(DATA, 'text', `${ed.identifier}.json`);
    const r = await saveJson(`${BASE}/quran/${ed.identifier}`, dest, { transform: j => j.data });
    log.info(`${ed.identifier} (${ed.englishName}) — ${r.skipped ? 'skip' : `${r.bytes}B`}`);
  });

  log.info('Fetching sajda ayahs (quran-uthmani)...');
  await saveJson(`${BASE}/sajda/quran-uthmani`, path.join(ROOT, 'data', 'quran', 'sajda.json'), { transform: j => j.data });

  log.info(`Done. ok=${ok} failed=${failed}`);
  if (failed) log.error(JSON.stringify(failures, null, 2));
  await log.flush({ totalTextEditions: textEditions.length, ok, failed, failures });
}

main().catch(e => { log.error(String(e?.stack || e)); log.flush(); process.exitCode = 1; });
