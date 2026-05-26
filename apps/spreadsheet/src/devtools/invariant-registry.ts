/**
 * I-0 — thin facade over the test-harness invariant registry.
 *
 * App-side debug code that wants to register an invariant (e.g. a
 * temporary check while chasing a bug) imports from here so it does NOT
 * take a build-time dependency on `dev/app-eval/**` (which lives outside
 * apps/spreadsheet's `rootDir`). This file therefore declares the type
 * surface locally — kept in lockstep with
 * `dev/app-eval/capture/invariants/registry.ts` — and provides a
 * `registerInvariant` shim that delegates to a global registrar
 * installed by the test-harness on page load.
 *
 * HARD RULE: this file holds NO behavior of its own. Registrations
 * before the test-harness loads are buffered into a holding queue and
 * flushed when the registrar appears (so app-load-time registrations
 * are never lost). The buffering is the only logic — there is no
 * evaluation, no ranking, no DOM reads here.
 */

// ── Types (mirror of dev/app-eval/capture/invariants/registry.ts) ──

export type InvariantSeverity = 'error' | 'warn';

export type InvariantResult =
  | { ok: true }
  | { ok: false; message: string; evidence: Record<string, unknown> };

export interface InvariantContext {
  dt: unknown;
  document: Document;
  coordinator: unknown;
  workbook: unknown;
  uiStore: unknown;
  kernel: unknown;
}

export interface InvariantSpec {
  id: string;
  severity: InvariantSeverity;
  enabled?: () => boolean;
  evaluate: (ctx: InvariantContext) => InvariantResult;
}

export interface InvariantsRunOutput {
  results: Array<{ id: string; severity: InvariantSeverity } & InvariantResult>;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
}

// ── Facade ──
//
// The test-harness registry installs a global registrar at module load
// (`window.__INVARIANT_REGISTRAR__`). Until then, registrations queue
// here and are flushed once the registrar is observed.

interface Registrar {
  register(spec: InvariantSpec): void;
}

const QUEUE: InvariantSpec[] = [];

function getInstalledRegistrar(): Registrar | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { __INVARIANT_REGISTRAR__?: Registrar };
  return w.__INVARIANT_REGISTRAR__ ?? null;
}

export function registerInvariant(spec: InvariantSpec): void {
  const registrar = getInstalledRegistrar();
  if (registrar) {
    registrar.register(spec);
    return;
  }
  // Hold until the test harness installs the registrar.
  QUEUE.push(spec);
  // Probe once on the next microtask in case the registrar is being
  // installed concurrently (matches the harness's import-time install
  // path). No timer leak — `setTimeout(0)` runs once, doesn't recur.
  if (typeof window !== 'undefined') {
    setTimeout(() => {
      const r = getInstalledRegistrar();
      if (!r) return;
      while (QUEUE.length > 0) {
        const next = QUEUE.shift();
        if (next) r.register(next);
      }
    }, 0);
  }
}
