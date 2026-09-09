// api.quran.com's /verses/by_chapter is intermittently 503ing right now
// (confirmed live 2026-09-09: even trivial single-field requests for
// chapters that succeeded minutes earlier fail, then later succeed again —
// a flaky/degraded backend, not a query-shape problem). Script 03 is
// resumable (skips chapters it already has), so brute-force re-running it
// converges as the backend recovers between attempts, without needing a
// human to babysit each pass.
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const VERSES_DIR = path.join(ROOT, 'data', 'quran', 'foundation', 'verses');
const TARGET = 114;
const MAX_PASSES = 25;
const PAUSE_MS = 15000; // let the backend breathe between passes

function countDone() {
  if (!fs.existsSync(VERSES_DIR)) return 0;
  return fs.readdirSync(VERSES_DIR).filter(f => f.endsWith('.json')).length;
}

function runOnce() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, '03-quran-foundation-text.mjs')], {
      stdio: 'inherit',
    });
    child.on('exit', () => resolve());
  });
}

async function main() {
  for (let pass = 1; pass <= MAX_PASSES; pass++) {
    const before = countDone();
    console.log(`\n=== Pass ${pass}/${MAX_PASSES} — ${before}/${TARGET} chapters done before this pass ===`);
    if (before >= TARGET) { console.log('All chapters done — also re-running once more to pick up the alt-script/resource tail if needed.'); }
    await runOnce();
    const after = countDone();
    console.log(`=== Pass ${pass} finished — ${after}/${TARGET} chapters done ===`);
    if (after >= TARGET) { console.log('ALL 114 CHAPTERS COMPLETE.'); return; }
    await new Promise(r => setTimeout(r, PAUSE_MS));
  }
  console.log(`Gave up after ${MAX_PASSES} passes — ${countDone()}/${TARGET} done. Re-run scripts/03-quran-foundation-text.mjs manually later to finish.`);
}

main();
