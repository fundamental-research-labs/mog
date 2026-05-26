/**
 * Current §6.1 lifecycle hook registration for app documents.
 *
 * Extracted from `useAppDocument.ts` so the registration logic can be
 * tested without dragging the full `@mog-sdk/kernel/api` import graph (which
 * pulls in the napi loader and trips Jest's CommonJS `import.meta.url`
 * limitation under jsdom). The shape we need from a doc handle is just
 * three fields — declared here as `LifecycleDocumentHandle` so neither
 * this module nor its tests touch the kernel api.
 *
 * Production: `useAppDocument.ts` builds a `getActiveDocs()` over its
 * `documentCache` (whose values are `DocumentHandle`, structurally
 * compatible with `LifecycleDocumentHandle`) and calls
 * `registerLifecycleHooks(getActiveDocs)` once at module load.
 *
 */

import {
  iterateActiveDocsForFlush,
  markLifecycleHooksRegistered,
  setActiveDocsProvider,
  type LifecycleDocSnapshot,
} from '../../services/lifecycle-state';

// =============================================================================
// Doc handle shape the lifecycle hooks read
// =============================================================================

/**
 * Minimal `DocumentHandle` surface the §6.1 hooks read. Decoupled from
 * the full `DocumentHandle` so tests can synthesize fakes without the
 * kernel api graph in the require chain.
 *
 * Production `DocumentHandle` (defined in
 * `kernel/src/api/document/document-factory.ts`) is structurally
 * compatible — TypeScript widens it to `LifecycleDocumentHandle` at the
 * call site.
 */
export interface LifecycleDocumentHandle {
  /**
   * The doc's stable ID. Surfaced to `__dt.persistenceState[docId]`
   * (current implementation §9 #5) so a Playwright spec can read per-doc state without
   * having to know the kernel's internal handle indexing.
   */
  readonly documentId: string;
  flushSync(): void;
  readonly pendingUpdatesCount: number;
  readonly hasFlushFailed: boolean;
  /**
   * `true` once the orchestrator has fanned ≥1 `update_v1` payload out
   * to attached Providers. Read by the §9 #5 persistence-state getter
   * and by §6.3 condition 1.
   */
  readonly hasAppendActive: boolean;

  /**
   * `true` when the doc is in §7 Q1 read-only mode (another tab holds the
   * Web Lock). Read by `readHasAnyDocReadOnly()` → `__dt.providerState`.
   */
  readonly isReadOnly?: boolean;

  /**
   * **`__dt`-only enumeration surface — never read by production shell code.**
   *
   * Returns the doc's currently-attached Providers (proxies to
   * `RustDocument._devtoolsProviders()`). Read by the
   * `__dt.persistenceProviders` getter so a Playwright spec can pull the
   * live `IDBDatabase` handle out of `IndexedDBProvider._devtoolsDb` and
   * shadow `db.transaction()` to drive the §6.1 flushFailed safety-net
   * contract.
   */
  _devtoolsProviders?(): readonly object[];
}

// =============================================================================
// Idempotent registration
// =============================================================================

let lifecycleHooksRegistered = false;
let beforeUnloadPromptEnabled = true;

/**
 * Configure whether the `beforeunload` handler shows the browser's
 * "leave site?" prompt. The flush itself always runs; only the prompt
 * is gated. Calling this after hooks are already registered updates
 * the live flag (the handler reads it on every invocation).
 */
export function setBeforeUnloadPrompt(enabled: boolean): void {
  beforeUnloadPromptEnabled = enabled;
}

/**
 * Tracker for the actually-attached DOM listeners. Used by the test
 * reset path to detach them before the next registration so a single
 * shared jsdom window doesn't accumulate listeners across tests.
 *
 * Production: never read — the listeners live for the page's lifetime.
 */
let installedListeners: {
  visibilityChange: EventListener;
  pageHide: EventListener;
  beforeUnload: EventListener;
} | null = null;

/**
 * Install the §6.1 three-hook pattern at the document level. Idempotent —
 * second call is a no-op (HMR-safe).
 *
 * Hooks installed:
 *   1. **`visibilitychange → hidden` (PRIMARY).** Fans `flushSync()` to
 *      every active doc. The most reliable pre-tab-death signal across
 *      mobile-Safari + aggressive desktop tab suspenders.
 *   2. **`pagehide` (SECONDARY).** Same flush call. bfcache-aware backup
 *      for browsers where `visibilitychange` doesn't fire first.
 *      Idempotent against the primary trigger via §3.3 `flushSync()`
 *      idempotency.
 *   3. **`beforeunload` (SAFETY NET).** Runs the same synchronous
 *      `flushSync()` fan-out, then sets `event.returnValue = ''` and
 *      calls `preventDefault()` ONLY when at least one active doc still
 *      has `pendingUpdatesCount > 0` or `hasFlushFailed === true`.
 *      Stays silent on the all-clear case so reloads don't gate on
 *      spurious "leave site?" prompts.
 *
 * Also wires §6.3 condition 2: marks `lifecycleHooksRegistered` true and
 * publishes the `getDocs` callback as the §6.3 condition-1 active-doc
 * source (each handle's `hasAppendActive` becomes readable).
 */
export function registerLifecycleHooks(getDocs: () => LifecycleDocumentHandle[]): void {
  if (typeof window === 'undefined') return;

  // Always register the caller's `getDocs` as an active-docs provider
  // (multi-source registry — see lifecycle-state.ts). This MUST run on
  // every call, not just the first, so each shell-side cache (useAppDocument
  // + DocumentManager) participates in §6.3 condition 1 and §9 #5
  // persistence-state read-out.
  setActiveDocsProvider(() => {
    const docs = getDocs() as Array<LifecycleDocumentHandle & LifecycleDocSnapshot>;
    return docs;
  });

  // The DOM listener install is the part that is idempotent — we only
  // want one set of `visibilitychange` / `pagehide` / `beforeunload`
  // listeners on the window, regardless of how many caches register.
  if (lifecycleHooksRegistered) {
    // Even on a no-op listener-install, mark the flag so the §6.3 getter
    // correctly reports condition 2 satisfied — the listeners ARE
    // registered, just by a prior caller.
    markLifecycleHooksRegistered();
    return;
  }
  lifecycleHooksRegistered = true;

  // PRIMARY: visibilitychange → hidden. Listener lives on `document`,
  // not `window` — the `visibilitychange` event is dispatched on the
  // document per the Page Visibility spec.
  //
  // The listener iterates the GLOBAL active-docs registry (not just the
  // `getDocs` callable from this registration) so every shell-side
  // cache — useAppDocument, DocumentManager, and any future cache —
  // participates in the unload flush.
  const visibilityChange: EventListener = () => {
    if (document.visibilityState !== 'hidden') return;
    for (const doc of iterateActiveDocsForFlush()) {
      try {
        doc.flushSync?.();
      } catch (err) {
        // Per §6.1, flushSync() must not throw — if a Provider violates
        // the contract, log and continue so other docs still flush.
        console.error('[app-document-lifecycle] doc.flushSync() threw on visibilitychange:', err);
      }
    }
  };
  document.addEventListener('visibilitychange', visibilityChange);

  // SECONDARY: pagehide. Same flush call; idempotent per §3.3.
  const pageHide: EventListener = () => {
    for (const doc of iterateActiveDocsForFlush()) {
      try {
        doc.flushSync?.();
      } catch (err) {
        console.error('[app-document-lifecycle] doc.flushSync() threw on pagehide:', err);
      }
    }
  };
  window.addEventListener('pagehide', pageHide);

  // SAFETY NET: beforeunload. Only prompt when there's truly unflushed
  // data. Per §6.1, the prompt comes from setting `returnValue` (or
  // calling `preventDefault()`); modern browsers no longer honor custom
  // messages. Avoid setting `returnValue` in the all-clear case so the
  // user gets no spurious "leave site?" dialog on every reload.
  const beforeUnload: EventListener = (event) => {
    for (const doc of iterateActiveDocsForFlush()) {
      try {
        doc.flushSync?.();
      } catch (err) {
        console.error('[app-document-lifecycle] doc.flushSync() threw on beforeunload:', err);
      }
    }

    if (!beforeUnloadPromptEnabled) return;

    for (const doc of iterateActiveDocsForFlush()) {
      const pending = doc.pendingUpdatesCount ?? 0;
      const failed = doc.hasFlushFailed ?? false;
      if (pending > 0 || failed) {
        event.preventDefault();
        // Some browsers still require returnValue assignment for the
        // dialog to fire. Empty string is conventional.
        (event as unknown as { returnValue: string }).returnValue = '';
        return;
      }
    }
  };
  window.addEventListener('beforeunload', beforeUnload);

  installedListeners = { visibilityChange, pageHide, beforeUnload };

  // §6.3 wiring: mark condition 2 satisfied (this very registration just
  // installed the §6.1 listeners). The active-docs provider was
  // registered above, before the idempotency check, so multi-source
  // registration composes correctly.
  markLifecycleHooksRegistered();
}

// =============================================================================
// Test handles
// =============================================================================

/** @internal — exposed for tests. Production code should never call this. */
export function __resetLifecycleHooksRegistrationForTests(): void {
  // Detach the previously-installed DOM listeners so a single shared
  // jsdom window doesn't accumulate listeners across test cases. (The
  // multi-source registry behavior means a leaked listener also leaks
  // every active-docs source registered with it; explicit detach makes
  // the per-test boundary clean.)
  if (installedListeners && typeof window !== 'undefined') {
    document.removeEventListener('visibilitychange', installedListeners.visibilityChange);
    window.removeEventListener('pagehide', installedListeners.pageHide);
    window.removeEventListener('beforeunload', installedListeners.beforeUnload);
    installedListeners = null;
  }
  lifecycleHooksRegistered = false;
  beforeUnloadPromptEnabled = true;
  // Also clear the multi-source active-docs registry so a prior test's
  // `getDocs` callable doesn't bleed into the next test's
  // `iterateActiveDocsForFlush()` iteration. setActiveDocsProvider(null)
  // wipes the entire registry per its `null`-back-compat contract.
  setActiveDocsProvider(null);
}

/** @internal — exposed for tests, lets specs drive the registration. */
export const __registerLifecycleHooksForTests = registerLifecycleHooks;
