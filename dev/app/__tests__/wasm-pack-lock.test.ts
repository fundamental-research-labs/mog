/**
 * Unit tests for the atomic O_EXCL lock primitives used by the ensureWasmBuilt
 * plugin in tools/vite-wasm-plugin/src/index.ts.
 *
 * These tests race a throwaway lockfile under an OS tempdir to prove the
 * invariants the plugin relies on:
 *
 *   1. `openSync(path, 'wx')` fails with EEXIST if the path already exists —
 *      this is the kernel-level atomic primitive that the lock stands on.
 *   2. `tryAcquireLock` returns a pid to exactly one caller when many race for
 *      the same file, and returns null to every other caller.
 *   3. `tryReclaimStaleLock` reclaims a lockfile older than LOCK_STALE_MS or
 *      owned by a dead PID, but refuses to clobber a fresh live one.
 *
 * We intentionally re-declare `tryAcquireLock` / `tryReclaimStaleLock` in this
 * file rather than importing them from `../vite.config.ts`. Reasons:
 *
 *   - vite.config.ts's top-level imports (`@vitejs/plugin-react`, `vite-plugin-svgr`,
 *     workspace packages) require a fully installed workspace
 *     to resolve. This test must run in any checkout, including fresh worktrees
 *     where `pnpm install` hasn't happened yet.
 *   - The primitives are ~20 lines of stdlib `fs` calls. Duplicating them keeps
 *     the test a true unit test of the lock contract, not an integration test of
 *     the Vite plugin graph.
 *
 * Any change to the primitives in tools/vite-wasm-plugin/src/index.ts MUST be
 * mirrored here. A snapshot-style assertion below reads the plugin and fails
 * loudly if the source drifts from this test's copy of the logic.
 *
 * Run with:
 *   node --experimental-strip-types --test dev/app/__tests__/wasm-pack-lock.test.ts
 * (Node 24+; uses built-in type stripping — no tsx or package.json needed.)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  openSync,
  writeFileSync,
  closeSync,
  unlinkSync,
  existsSync,
  readFileSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

const LOCK_STALE_MS = 10 * 60_000;

/** Mirror of ensureWasmBuilt's `tryAcquireLock`. Keep in sync. */
function tryAcquireLock(lockFile: string): number | null {
  try {
    const fd = openSync(lockFile, 'wx');
    try {
      writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
    } finally {
      closeSync(fd);
    }
    return process.pid;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return null;
    throw err;
  }
}

/** Mirror of ensureWasmBuilt's `tryReclaimStaleLock`. Keep in sync. */
function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function tryReclaimStaleLock(lockFile: string): boolean {
  let startedAt: number;
  let pid: number | undefined;
  try {
    const parsed = JSON.parse(readFileSync(lockFile, 'utf8'));
    startedAt = parsed.startedAt;
    pid = parsed.pid;
  } catch {
    return tryAcquireLock(lockFile) !== null;
  }
  const lockIsOld = typeof startedAt === 'number' && Date.now() - startedAt >= LOCK_STALE_MS;
  const ownerIsDead = typeof pid === 'number' && !isProcessAlive(pid);
  if (!lockIsOld && !ownerIsDead) {
    return false;
  }
  try {
    unlinkSync(lockFile);
  } catch {
    /* no-op */
  }
  return tryAcquireLock(lockFile) !== null;
}

function mkScratch(): string {
  return mkdtempSync(path.join(tmpdir(), 'wasm-pack-lock-test-'));
}

function findDeadPid(): number {
  let pid = 999_999;
  while (true) {
    try {
      process.kill(pid, 0);
      pid++;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ESRCH') return pid;
      pid++;
    }
  }
}

describe('wasm-pack bootstrap lock', () => {
  it('openSync with "wx" flag throws EEXIST if the file exists', () => {
    const dir = mkScratch();
    try {
      const lockFile = path.join(dir, '.wasm-pack.lock');
      const fd = openSync(lockFile, 'wx');
      closeSync(fd);
      let err: NodeJS.ErrnoException | undefined;
      try {
        openSync(lockFile, 'wx');
      } catch (e) {
        err = e as NodeJS.ErrnoException;
      }
      assert.ok(err, 'expected second openSync to throw');
      assert.equal(err!.code, 'EEXIST');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('tryAcquireLock returns null when the lockfile already exists', () => {
    const dir = mkScratch();
    try {
      const lockFile = path.join(dir, '.wasm-pack.lock');
      const first = tryAcquireLock(lockFile);
      assert.equal(typeof first, 'number', 'first caller should win and get a pid');
      const second = tryAcquireLock(lockFile);
      assert.equal(second, null, 'second caller must see EEXIST and get null');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('tryAcquireLock writes valid JSON with pid and startedAt', () => {
    const dir = mkScratch();
    try {
      const lockFile = path.join(dir, '.wasm-pack.lock');
      tryAcquireLock(lockFile);
      const parsed = JSON.parse(readFileSync(lockFile, 'utf8'));
      assert.equal(typeof parsed.pid, 'number');
      assert.equal(typeof parsed.startedAt, 'number');
      assert.ok(Date.now() - parsed.startedAt < 5_000, 'startedAt should be within the last 5s');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('tryReclaimStaleLock refuses to clobber a fresh lock', () => {
    const dir = mkScratch();
    try {
      const lockFile = path.join(dir, '.wasm-pack.lock');
      tryAcquireLock(lockFile);
      assert.equal(tryReclaimStaleLock(lockFile), false);
      assert.ok(existsSync(lockFile), 'fresh lockfile must remain intact');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('tryReclaimStaleLock reclaims a stale lock (startedAt > 10 min ago)', () => {
    const dir = mkScratch();
    try {
      const lockFile = path.join(dir, '.wasm-pack.lock');
      // Write a lockfile dated 11 minutes ago.
      const staleAt = Date.now() - 11 * 60_000;
      writeFileSync(lockFile, JSON.stringify({ pid: 99999, startedAt: staleAt }));
      const reclaimed = tryReclaimStaleLock(lockFile);
      assert.equal(reclaimed, true, 'stale lock must be reclaimable');
      // After reclaim we should own the lock (file exists, content is ours).
      assert.ok(existsSync(lockFile));
      const parsed = JSON.parse(readFileSync(lockFile, 'utf8'));
      assert.equal(parsed.pid, process.pid);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('tryReclaimStaleLock reclaims a fresh lock owned by a dead pid', () => {
    const dir = mkScratch();
    try {
      const lockFile = path.join(dir, '.wasm-pack.lock');
      writeFileSync(lockFile, JSON.stringify({ pid: findDeadPid(), startedAt: Date.now() }));
      const reclaimed = tryReclaimStaleLock(lockFile);
      assert.equal(reclaimed, true, 'dead-owner lock must be reclaimable even before stale age');
      assert.ok(existsSync(lockFile));
      const parsed = JSON.parse(readFileSync(lockFile, 'utf8'));
      assert.equal(parsed.pid, process.pid);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('N concurrent workers race: exactly one wins the lock', async () => {
    const dir = mkScratch();
    const lockFile = path.join(dir, '.wasm-pack.lock');
    const N = 16;
    try {
      // Spawn N workers in parallel, each calling tryAcquireLock against the
      // same lockfile. Only ONE should get a non-null result.
      const workers: Promise<{ won: boolean; err?: string }>[] = [];
      for (let i = 0; i < N; i++) {
        workers.push(
          new Promise((resolve) => {
            const w = new Worker(
              `
              const { parentPort, workerData } = require('node:worker_threads');
              const { openSync, writeFileSync, closeSync } = require('node:fs');
              function tryAcquireLock(lockFile) {
                try {
                  const fd = openSync(lockFile, 'wx');
                  try { writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: Date.now() })); }
                  finally { closeSync(fd); }
                  return process.pid;
                } catch (err) {
                  if (err.code === 'EEXIST') return null;
                  throw err;
                }
              }
              const result = tryAcquireLock(workerData.lockFile);
              parentPort.postMessage({ won: result !== null });
              `,
              { eval: true, workerData: { lockFile } },
            );
            w.once('message', (msg) => resolve(msg));
            w.once('error', (e) => resolve({ won: false, err: String(e) }));
          }),
        );
      }
      const results = await Promise.all(workers);
      const winners = results.filter((r) => r.won).length;
      const losers = results.filter((r) => !r.won && !r.err).length;
      const errored = results.filter((r) => r.err);
      assert.equal(errored.length, 0, `no worker should error, got: ${JSON.stringify(errored)}`);
      assert.equal(winners, 1, `exactly one worker must win the lock, got ${winners}`);
      assert.equal(losers, N - 1, `remaining ${N - 1} workers must see EEXIST, got ${losers}`);
    } finally {
      try {
        unlinkSync(lockFile);
      } catch {
        /* no-op */
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('@mog/vite-wasm-plugin source still defines both primitives with O_EXCL semantics', () => {
    // Canary: if someone refactors the plugin and this test's inline copy drifts
    // from reality, fail loudly here so we remember to update both.
    // The lock primitives live in tools/vite-wasm-plugin/src/index.ts.
    const pluginPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      '..',
      'tools',
      'vite-wasm-plugin',
      'src',
      'index.ts',
    );
    const src = readFileSync(pluginPath, 'utf8');
    assert.match(
      src,
      /export function tryAcquireLock\b/,
      'vite-wasm-plugin must export tryAcquireLock',
    );
    assert.match(
      src,
      /export function tryReclaimStaleLock\b/,
      'vite-wasm-plugin must export tryReclaimStaleLock',
    );
    assert.match(
      src,
      /openSync\(lockFile,\s*['"]wx['"]\)/,
      'vite-wasm-plugin must use openSync(lockFile, "wx") for atomic O_EXCL acquisition',
    );
    assert.match(
      src,
      /LOCK_STALE_MS\s*=\s*10\s*\*\s*60_000/,
      'vite-wasm-plugin must define LOCK_STALE_MS as 10 minutes',
    );
    assert.match(
      src,
      /process\.kill\(pid,\s*0\)/,
      'vite-wasm-plugin must test lock owner liveness before waiting on a fresh lock',
    );
    assert.match(
      src,
      /async buildStart\(\)/,
      'buildStart must be async so it can await the wait loop',
    );
    assert.match(
      src,
      /finally\s*\{[\s\S]*?unlinkSync\(lockFile\)/,
      'lockfile must be removed in a finally block so build failures do not wedge the lock',
    );
  });
});
