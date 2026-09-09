// Shared helpers for every downloader script in this repo.
// Design goals: resumable (skip files that already exist), polite to free
// APIs (bounded concurrency + retry/backoff), and loud about failures (every
// script writes a JSON log of what failed so a re-run or a human can follow
// up instead of a silent gap in the mirror).

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export function ensureDirSync(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export async function exists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

// Simple bounded-concurrency pool. `items` is an array, `worker` is called
// for each item; returns when all are settled. Never throws — failures are
// collected and returned so callers can log + continue.
export async function pool(items, concurrency, worker) {
  let i = 0;
  let ok = 0;
  const failures = [];
  async function runOne() {
    while (i < items.length) {
      const idx = i++;
      const item = items[idx];
      try {
        await worker(item, idx);
        ok++;
      } catch (e) {
        failures.push({ item, error: String(e?.message || e) });
      }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, runOne);
  await Promise.all(workers);
  return { ok, failed: failures.length, failures };
}

// Fetch with retry + exponential backoff. Treats 404 as a non-retryable
// "not found" (throws immediately) since retrying won't help and these
// mirrors hit thousands of speculative URLs (e.g. probing reciter ids).
export async function fetchWithRetry(url, opts = {}, { retries = 4, baseDelayMs = 800, timeoutMs = 30000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...opts, signal: controller.signal });
      clearTimeout(timer);
      if (res.status === 404) {
        const err = new Error(`404 Not Found: ${url}`);
        err.status = 404;
        throw err;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${url}`);
      }
      return res;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (e?.status === 404) throw e;
      if (attempt < retries) {
        const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 300;
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

// Downloads JSON to disk, skipping if the file already exists (resumable).
// `force` re-downloads regardless.
export async function saveJson(url, destPath, { force = false, transform, retryOpts } = {}) {
  if (!force && await exists(destPath)) return { skipped: true };
  const res = await fetchWithRetry(url, { headers: { Accept: 'application/json' } }, retryOpts);
  let json = await res.json();
  if (transform) json = transform(json);
  ensureDirSync(path.dirname(destPath));
  await fsp.writeFile(destPath, JSON.stringify(json), 'utf8');
  return { skipped: false, bytes: Buffer.byteLength(JSON.stringify(json)) };
}

// Downloads text (used for translate-endpoint / TSV style raw text) to disk.
export async function saveText(url, destPath, { force = false, retryOpts } = {}) {
  if (!force && await exists(destPath)) return { skipped: true };
  const res = await fetchWithRetry(url, {}, retryOpts);
  const text = await res.text();
  ensureDirSync(path.dirname(destPath));
  await fsp.writeFile(destPath, text, 'utf8');
  return { skipped: false, bytes: Buffer.byteLength(text) };
}

// Streams a binary file (audio/images) to disk. Skips if the destination
// already exists AND is non-empty (guards against a previous truncated run).
export async function saveBinary(url, destPath, { force = false, retryOpts } = {}) {
  if (!force && await exists(destPath)) {
    const st = await fsp.stat(destPath);
    if (st.size > 0) return { skipped: true, bytes: st.size };
  }
  const res = await fetchWithRetry(url, {}, retryOpts);
  const buf = Buffer.from(await res.arrayBuffer());
  ensureDirSync(path.dirname(destPath));
  const tmp = destPath + '.part';
  await fsp.writeFile(tmp, buf);
  await fsp.rename(tmp, destPath);
  return { skipped: false, bytes: buf.length };
}

export class Logger {
  constructor(logPath) {
    this.logPath = logPath;
    ensureDirSync(path.dirname(logPath));
    this.startedAt = new Date().toISOString();
    this.events = [];
  }
  info(msg) {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    this.events.push({ level: 'info', msg, t: Date.now() });
  }
  error(msg) {
    const line = `[${new Date().toISOString()}] ERROR ${msg}`;
    console.error(line);
    this.events.push({ level: 'error', msg, t: Date.now() });
  }
  async flush(extra = {}) {
    const summary = { startedAt: this.startedAt, finishedAt: new Date().toISOString(), events: this.events, ...extra };
    ensureDirSync(path.dirname(this.logPath));
    await fsp.writeFile(this.logPath, JSON.stringify(summary, null, 2), 'utf8');
  }
}

export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export const SURAHS = Array.from({ length: 114 }, (_, i) => i + 1);
