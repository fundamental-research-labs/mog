/**
 * Lifecycle State — shared module for §6.3 `__dt.persistenceEnabled` getter.
 *
 * The flag is computed from three conditions, each owned by a different
 * subsystem:
 *   1. **`hasAppendActive` across active docs** — owned by the orchestrator
 *      and read via the per-doc `DocumentHandle` getter.
 *   2. **Lifecycle hooks registered** — owned by `useAppDocument.ts`.
 *      `markLifecycleHooksRegistered()` is called once after
 *      `registerLifecycleHooks()` runs at module load.
 *   3. **Boot resolution terminal** — owned by
 *      `dev/app/src/App.tsx`'s boot precedence table. The app calls
 *      `markBootResolutionTerminal()` when the precedence table runs to
 *      a terminal state (any of: `?doc=<id>` hydrated, `?new` doc created,
 *      `lastActiveDocId` hydrated, welcome screen shown, "doc unavailable"
 *      toast shown). It must NOT mark on a thrown hydration error.
 *
 * The `__dt.persistenceEnabled` getter (in `bridge-devtools-wrapper.ts`)
 * reads all three signals on every access — never caches. The harness
 * sees the live state, not a boot snapshot.
 *
 * **Why a shared module instead of `__SHELL__` or `__dt`?**
 * Per §6.3, the flag must live on `__dt` (correct devtools layer). But
 * the **state** behind the flag is contributed by three independent
 * subsystems, two of which live in the shell. This module is the
 * shared gathering point — the shell paths call the marker functions, and
 * the devtools-side `__dt` getter reads the gathered state.
 *
 * **Lifetime:** module-level state. Scoped to the JS realm. Lifecycle
 * hook registration is once per page load (idempotent), boot resolution
 * runs once per page load, and `hasAppendActive` is per-doc and read
 * through the active doc registry. None of these reset — that's by
 * design, because the harness only ever asks "is the system live?"
 *
 */

// =============================================================================
// Internal flags
// =============================================================================

let _lifecycleHooksRegistered = false;
let _bootResolutionTerminal = false;

// =============================================================================
// Active-doc registry (for condition 1 fan-out)
// =============================================================================

/**
 * Minimal contract the §6.3 getter, the §9 #5 persistence-state read-out,
 * AND the §6.1 unload listeners need from each active doc.
 *
 * Kept as an interface (not a `DocumentHandle` import) so this module
 * stays free of the kernel api surface; the shell passes whatever it has,
 * the getter only reads what it needs. `LifecycleDocumentHandle` (in
 * `app-document-lifecycle.ts`) is structurally compatible.
 *
 *   - `documentId` keys the per-doc `__dt.persistenceState` record.
 *   - `hasAppendActive` drives §6.3 condition 1.
 *   - `pendingUpdatesCount` / `hasFlushFailed` surface in §9 #5 AND drive
 *     the §6.1 `beforeunload` "leave site?" decision.
 *   - `flushSync()` is invoked by the §6.1 `visibilitychange` and
 *     `pagehide` listeners so each open doc's Provider can drain its
 *     queue before tab death. Optional because some test fakes may omit
 *     it; production handles always provide it.
 */
export interface LifecycleDocSnapshot {
  readonly documentId?: string;
  readonly hasAppendActive: boolean;
  readonly pendingUpdatesCount?: number;
  readonly hasFlushFailed?: boolean;
  flushSync?(): void;
  /** §7 Q1: `true` when another tab holds the Web Lock for this docId. */
  readonly isReadOnly?: boolean;
  /**
   * **`__dt`-only enumeration surface — never read by production shell code.**
   *
   * Snapshot of the doc's currently-attached Providers, ultimately sourced
   * from `RustDocument._devtoolsProviders()`. The devtools-side getter
   * (`installPersistenceProvidersGetter`) walks the snapshot and pulls
   * each Provider's dev-only inspection fields (e.g. `IndexedDBProvider`'s
   * `_devtoolsDb`) for the §6.1 flushFailed verification path the
   * Playwright spec exercises.
   *
   * Optional because some test fakes may omit it; production handles
   * always provide it.
   */
  _devtoolsProviders?(): readonly object[];
}

/**
 * The shell registers one or more getters the §6.3 condition-1 evaluator
 * can call to iterate over currently-attached docs. Lazy-evaluated — each
 * getter is called fresh on every read so the live set is observed.
 *
 * Multi-source rationale (UX-FIX-PRINCIPLES §3 generalisation): two
 * shell-side document caches exist today —
 *   - `useAppDocument`'s `documentCache` (per-app CRM/finance docs)
 *   - `DocumentManager`'s `documents` map (user-visible spreadsheet docs
 *     opened via `?doc=<id>`, `?new`, or `lastActiveDocId`)
 * — and the §6.3 flag must consider both. A single `_activeDocsProvider`
 * slot would force one cache to overwrite the other; a registry composes
 * cleanly. Future caches (e.g. websocket-collab session pool) plug in
 * without touching this module.
 */
const _activeDocsProviders = new Set<() => Iterable<LifecycleDocSnapshot>>();

/**
 * Register a source of "currently attached docs" for §6.3 condition 1
 * AND §9 #5 per-doc state read-out. Returns an unregister function.
 *
 * Idempotent under repeated registration of the same callable: a duplicate
 * registration replaces the prior entry (Set semantics).
 */
export function setActiveDocsProvider(
  provider: (() => Iterable<LifecycleDocSnapshot>) | null,
): () => void {
  if (provider === null) {
    // Back-compat: passing null wipes everything. Used by
    // `__resetLifecycleStateForTests` and HMR teardown paths.
    _activeDocsProviders.clear();
    return () => undefined;
  }
  _activeDocsProviders.add(provider);
  return () => {
    _activeDocsProviders.delete(provider);
  };
}

// =============================================================================
// Marker functions
// =============================================================================

/**
 * The lifecycle hook module calls this once `registerLifecycleHooks()` has installed the three
 * unload listeners. Idempotent — second call is a no-op.
 */
export function markLifecycleHooksRegistered(): void {
  _lifecycleHooksRegistered = true;
}

/**
 * The app boot path calls this when the boot precedence table reaches a terminal
 * state. Idempotent — second call is a no-op.
 *
 * "Terminal state" per §6.3: any of:
 *   - `?doc=<id>` hydrated successfully
 *   - `?new` doc created
 *   - `lastActiveDocId` hydrated successfully
 *   - welcome screen shown (no recent doc)
 *   - "doc unavailable" toast on welcome (evicted/foreign id)
 *
 * **Not** terminal: a thrown error during hydration leaves this `false`,
 * so the harness keeps the flag off and the PENDING markers stay accurate.
 */
export function markBootResolutionTerminal(): void {
  _bootResolutionTerminal = true;
}

/**
 * Test-only: clear all flags. Used by the lifecycle test fixture between
 * scenarios. Not part of the production surface.
 */
export function __resetLifecycleStateForTests(): void {
  _lifecycleHooksRegistered = false;
  _bootResolutionTerminal = false;
  _activeDocsProviders.clear();
}

// =============================================================================
// Read path (used by the `__dt.persistenceEnabled` getter)
// =============================================================================

/**
 * Read condition 1 of §6.3: at least one currently-attached doc has fanned
 * out an `update_v1` payload to its Providers (`hasAppendActive === true`).
 *
 * Iterates the live registry on every call. If no provider has been wired
 * (e.g. very early in boot, before the shell mounts), returns `false`.
 */
export function readHasAnyAppendActive(): boolean {
  for (const provider of _activeDocsProviders) {
    for (const doc of provider()) {
      if (doc.hasAppendActive) return true;
    }
  }
  return false;
}

/** Read condition 2 of §6.3 — see {@link markLifecycleHooksRegistered}. */
export function readLifecycleHooksRegistered(): boolean {
  return _lifecycleHooksRegistered;
}

/**
 * §7 Q1 — `true` when at least one currently-attached doc is in read-only
 * mode (another tab holds the Web Lock). Read by `__dt.providerState.readOnly`
 * via `installProviderStateGetter`.
 */
export function readHasAnyDocReadOnly(): boolean {
  for (const provider of _activeDocsProviders) {
    for (const doc of provider()) {
      if (doc.isReadOnly === true) return true;
    }
  }
  return false;
}

/** Read condition 3 of §6.3 — see {@link markBootResolutionTerminal}. */
export function readBootResolutionTerminal(): boolean {
  return _bootResolutionTerminal;
}

/**
 * Iterate every currently-attached doc across all registered active-docs
 * providers, deduplicated by `documentId`. Used by the §6.1
 * `visibilitychange → hidden` / `pagehide` / `beforeunload` listeners so
 * each open doc — regardless of which shell-side cache owns it —
 * participates in the unload flush.
 *
 * Yields the full `LifecycleDocSnapshot` (including the optional
 * `flushSync` callable), not just the read-only fields.
 */
export function* iterateActiveDocsForFlush(): Iterable<LifecycleDocSnapshot> {
  const seen = new Set<string>();
  for (const provider of _activeDocsProviders) {
    for (const doc of provider()) {
      const id = doc.documentId;
      // Anonymous handles (no documentId, e.g. lightweight test fakes) are
      // still flush-eligible but can't be deduplicated; emit each one.
      if (id) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      yield doc;
    }
  }
}

/**
 * Per-doc persistence-state snapshot iterator for the §9 #5
 * `__dt.persistenceState[docId]` getter (installed by the devtools-side
 * `installPersistenceStateGetter`). Iterates the live registry on every
 * call — never caches.
 *
 * Skips entries whose `documentId` is missing (defensive against partially-
 * constructed handles during shell teardown).
 *
 * Generalisation rationale (UX-FIX-PRINCIPLES §3): the active-docs
 * provider already enumerates the orchestrator-attached doc set; we read
 * `pendingUpdatesCount` / `hasFlushFailed` / `hasAppendActive` from each
 * snapshot in one pass instead of adding a second registry.
 */
/**
 * **`__dt`-only enumeration — never read by production shell code.**
 *
 * Per-doc snapshot of the live attached Providers for the
 * `__dt.persistenceProviders` getter (installed via
 * `installPersistenceProvidersGetter` in
 * `@mog/devtools/shell-persistence`). Yields one entry per
 * registered docId; the Provider list inside is whatever
 * `LifecycleDocSnapshot._devtoolsProviders()` returned at iteration time.
 *
 * Used by the Current §6.1 flushFailed Playwright scenario so a spec can
 * shadow `IndexedDBProvider._devtoolsDb.transaction()` directly — the same
 * mechanism `FailingIndexedDBProvider` uses in the kernel-side conformance
 * suite, lifted across the Playwright boundary instead of needing a
 * production behavior knob.
 */
export function* readPersistenceProvidersSnapshots(): Iterable<
  readonly [string, { providers: readonly object[] }]
> {
  const seen = new Set<string>();
  for (const provider of _activeDocsProviders) {
    for (const doc of provider()) {
      const id = doc.documentId;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const providers = doc._devtoolsProviders?.() ?? [];
      yield [id, { providers }];
    }
  }
}

export function* readPersistenceStateSnapshots(): Iterable<
  readonly [string, { pendingUpdates: number; hasFlushFailed: boolean; hasAppendActive: boolean }]
> {
  // Track docIds we've already yielded — multiple providers (e.g.
  // useAppDocument + DocumentManager) may both register a handle for the
  // same docId during transitional code paths; the first yield wins so
  // the consumer sees a stable snapshot.
  const seen = new Set<string>();
  for (const provider of _activeDocsProviders) {
    for (const doc of provider()) {
      const id = doc.documentId;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      yield [
        id,
        {
          pendingUpdates: doc.pendingUpdatesCount ?? 0,
          hasFlushFailed: doc.hasFlushFailed ?? false,
          hasAppendActive: doc.hasAppendActive,
        },
      ];
    }
  }
}
