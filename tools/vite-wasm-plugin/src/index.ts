/**
 * Shared Vite plugin that ensures WASM crates are built before the dev server
 * starts and provides the `@mog-sdk/wasm` resolve alias.
 *
 * Extracted from `dev/app/vite.config.ts` to eliminate duplication across Vite
 * hosts that need the local `@mog-sdk/wasm` package during development.
 *
 * Concurrency model: uses an atomic O_EXCL lockfile at `<crateDir>/.wasm-pack.lock`
 * so exactly one Vite process builds; others poll for the artifact. Stale locks
 * (>10 min) are reclaimed atomically. See inline comments for details.
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Return type is `any[]` rather than `Plugin[]` to avoid @types/node version
// skew — Vite parameterizes Plugin on @types/node, and different monorepo
// packages pin different versions, producing nominally incompatible types.

// ---------------------------------------------------------------------------
// Workspace layout resolution
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_ROOT = path.resolve(__dirname, '..', '..', '..');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * WASM crates that must be built before the dev server starts.
 * Each entry: [display name, crate directory relative to the public mog root].
 */
const REQUIRED_WASM_CRATES = [['@mog-sdk/wasm', 'compute/wasm']] as const;

/**
 * How long a lockfile may persist before we treat it as abandoned. Covers a cold
 * wasm-pack build (typically 30-120s) plus generous slack for slow machines.
 */
const LOCK_STALE_MS = 10 * 60_000;

/** Upper bound on how long we will wait for another process to finish the build. */
const WAIT_MAX_MS = 5 * 60_000;

/** Poll cadence while waiting for the WASM artifact to materialize. */
const POLL_MS = 250;

// ---------------------------------------------------------------------------
// Lock primitives
// ---------------------------------------------------------------------------

/**
 * Atomically acquire the lock via POSIX O_EXCL (`wx` flag). Returns null if another
 * process already holds the lock. Never blocks.
 *
 * Exported so tests can race this primitive from worker threads without spinning
 * up a real Vite build. Not part of any public API.
 */
export function tryAcquireLock(lockFile: string): number | null {
  try {
    // 'wx' = O_WRONLY | O_CREAT | O_EXCL -- fails atomically if the file exists.
    const fd = fs.openSync(lockFile, 'wx');
    try {
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
    } finally {
      fs.closeSync(fd);
    }
    return process.pid;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return null;
    throw err;
  }
}

/**
 * If an existing lockfile is older than LOCK_STALE_MS or points at a dead owner
 * PID, unlink it and try to re-acquire atomically. If another process beats us
 * to the re-acquire, we return false and the caller falls back to the wait path.
 * Two processes cannot both "win" this race because the re-acquisition still
 * goes through `openSync('wx')`.
 */
function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

export function tryReclaimStaleLock(lockFile: string): boolean {
  let startedAt: number;
  let pid: number | undefined;
  try {
    const raw = fs.readFileSync(lockFile, 'utf8');
    const parsed = JSON.parse(raw);
    startedAt = parsed.startedAt;
    pid = parsed.pid;
  } catch {
    // Lockfile unreadable or vanished between existence-check and read -- the
    // cleanest response is to let the next tryAcquireLock attempt resolve it.
    return tryAcquireLock(lockFile) !== null;
  }
  const lockIsOld = typeof startedAt === 'number' && Date.now() - startedAt >= LOCK_STALE_MS;
  const ownerIsDead = typeof pid === 'number' && !isProcessAlive(pid);
  if (!lockIsOld && !ownerIsDead) {
    return false;
  }
  try {
    fs.unlinkSync(lockFile);
  } catch {
    // Another process may have beaten us to the unlink; keep going -- the
    // subsequent tryAcquireLock will sort out who holds the lock.
  }
  return tryAcquireLock(lockFile) !== null;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * Vite plugin that ensures all WASM crates are built before the dev server starts.
 * Runs `build.sh` for any crate whose npm/ WASM artifact is missing.
 *
 * Uses an atomic O_EXCL lockfile for concurrency: exactly one process acquires the
 * lock and runs `build.sh`; the others poll for the artifact to appear. If the
 * lock-holder's build crashes, the lockfile is removed in a `finally` so the next
 * process can try again. Lockfiles older than LOCK_STALE_MS are reclaimed atomically.
 */
function ensureWasmBuilt() {
  return {
    name: 'ensure-wasm-built',
    async buildStart() {
      for (const [name, relDir] of REQUIRED_WASM_CRATES) {
        const crateDir = path.resolve(PUBLIC_ROOT, relDir);
        const wasmArtifact = path.join(crateDir, 'npm', 'compute_core_wasm_bg.wasm');
        const lockFile = path.join(crateDir, '.wasm-pack.lock');
        if (fs.existsSync(wasmArtifact)) continue;

        let haveLock = tryAcquireLock(lockFile) !== null;
        if (!haveLock) haveLock = tryReclaimStaleLock(lockFile);

        if (haveLock) {
          console.log(`\n[ensure-wasm-built] ${name} WASM artifact not found, building...`);
          try {
            // Delegate to compute/wasm/build.sh -- single source of truth for
            // profile selection (cargo profile.wasm-dev, skip wasm-opt/brotli).
            // MOG_WASM_PROFILE env var lets a developer override (e.g.
            // `MOG_WASM_PROFILE=release pnpm dev` to test the production blob).
            // build.sh sets CARGO_TARGET_DIR itself.
            const profile = process.env.MOG_WASM_PROFILE ?? 'dev';
            execSync(`bash build.sh --profile ${profile}`, {
              cwd: crateDir,
              stdio: 'inherit',
            });
            console.log(`[ensure-wasm-built] ${name} build complete.\n`);
          } catch {
            console.error(
              `[ensure-wasm-built] ${name} wasm-pack build failed. WASM features will not work.`,
            );
          } finally {
            // Always remove the lock -- even on build failure, so the next process
            // is free to retry. Ignore unlink errors (another process could have
            // stale-reclaimed us, though that is extremely unlikely within 10 min).
            try {
              fs.unlinkSync(lockFile);
            } catch {
              /* no-op */
            }
          }
        } else {
          // Another process owns the lock -- wait for the WASM artifact to appear.
          console.log(
            `[ensure-wasm-built] ${name} WASM artifact not found, waiting for peer build to complete...`,
          );
          const deadline = Date.now() + WAIT_MAX_MS;
          while (Date.now() < deadline) {
            if (fs.existsSync(wasmArtifact)) break;
            await new Promise((r) => setTimeout(r, POLL_MS));
          }
          if (!fs.existsSync(wasmArtifact)) {
            throw new Error(
              `[ensure-wasm-built] Timed out after ${WAIT_MAX_MS}ms waiting for peer to build ${name}`,
            );
          }
          console.log(`[ensure-wasm-built] ${name} WASM artifact is ready (built by peer).`);
        }
      }
    },
  };
}

/**
 * Vite plugin that injects the `@mog-sdk/wasm` resolve alias so every consumer
 * resolves to `compute/wasm/npm`.
 */
function wasmAlias() {
  const wasmNpmDir = path.resolve(PUBLIC_ROOT, 'compute', 'wasm', 'npm');

  return {
    name: 'mog-wasm-alias',
    config() {
      return {
        resolve: {
          alias: {
            '@mog-sdk/wasm': wasmNpmDir,
          },
        },
      };
    },
  };
}

/**
 * Returns an array of Vite plugins that:
 * 1. Ensure the WASM crate is built (with O_EXCL lockfile concurrency)
 * 2. Provide the resolve alias for `@mog-sdk/wasm` -> `compute/wasm/npm`
 *
 * Usage in a Vite config:
 * ```ts
 * plugins: [
 *   ...mogWasmPlugin(),
 *   // other plugins...
 * ]
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mogWasmPlugin(): any[] {
  return [ensureWasmBuilt(), wasmAlias()];
}
