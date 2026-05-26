/**
 * Recent Docs zustand slice — current implementation §6.2.
 *
 * Mirrors the IndexedDB Meta API (`kernel/src/document/providers/indexeddb-meta.ts`)
 * into observable shell state so React components can render the "recent
 * documents" UI and the boot precedence table (§6.2) can pick a doc to
 * reopen on refresh.
 *
 * **Layering note (per §5.1.1).** This slice talks to the **Meta API**
 * (free functions over the `meta` IDB store), not to any `Provider`. Boot
 * needs meta *before* any docId is known — there is no Provider yet to
 * route through. The orchestrator is what calls `touchDoc()` from
 * inside `attachProvider`, so this slice does **not** invoke `touchDoc`
 * itself — it only observes the meta layer.
 *
 * **Multi-tab eventual consistency.** Tab A's
 * `touchDoc()` writes IDB; tab B doesn't see the change until it
 * re-reads. Current uses a polling approach: re-read meta on
 * `visibilitychange → visible`. Sufficient for single-tab UX; the
 * Q1 "two-tab read-only banner" case is a separate scenario.
 *
 * **Lifetime + bootstrap.** The shell creates one slice per realm and
 * calls `hydrate()` from `createShell()` in parallel with WASM init —
 * `loaded: false` until meta read resolves. Components that need to wait
 * (e.g. the welcome screen's recent-docs list) gate on `loaded === true`.
 * Other components can render best-effort against the empty initial state
 * without blocking first paint.
 *
 */

import { create, type StoreApi, type UseBoundStore } from 'zustand';
import {
  forgetDoc as metaForgetDoc,
  readMeta,
  touchDoc as metaTouchDoc,
  type RecentDoc,
} from '@mog-sdk/kernel/storage';

// =============================================================================
// State + Actions
// =============================================================================

export interface RecentDocsState {
  /**
   * LRU list of doc descriptors, newest first. Mirrors the `recentDocs`
   * value from `readMeta()`. Empty until `hydrate()` resolves.
   */
  recentDocs: RecentDoc[];

  /**
   * The most recently attached doc id, used by the §6.2 boot precedence
   * table to reopen on refresh. `null` until either `hydrate()` resolves
   * (and meta has a value) or until `touch()` is called.
   */
  lastActiveDocId: string | null;

  /**
   * `true` once the initial `hydrate()` has resolved. Components that
   * need to wait — e.g. the welcome-screen "open last doc" branch —
   * gate on this flag. Stays `true` after first hydration; subsequent
   * re-reads (§6.2 multi-tab polling) keep it `true`.
   */
  loaded: boolean;

  /**
   * Read meta from IDB once and populate the slice. Called by
   * `createShell()` in parallel with WASM init. Resolves after the slice
   * reflects the current meta state. Best-effort — IDB errors are logged
   * and `loaded` still flips to `true` (the welcome screen falls through
   * to "no recent doc" cleanly).
   */
  hydrate: () => Promise<void>;

  /**
   * Touch a doc — proxies to the Meta API and re-reads to update
   * the slice. The orchestrator already calls `touchDoc` from
   * inside `attachProvider`, so this is the path for the few shell
   * code-paths that touch a doc *outside* an `attachProvider` (e.g. an
   * explicit "pin" or "rename" UI). Current callers
   * are limited; the method exists for completeness.
   *
   * Re-reads meta after the write so observers see consistent state.
   */
  touch: (docId: string) => Promise<void>;

  /**
   * Forget (evict) a doc from the recent list. Proxies to the
   * Meta API. Used by:
   *   - The shell's "delete this doc" UI.
   *   - Tests that need to drive eviction directly.
   *
   * Re-reads meta after the write.
   */
  forget: (docId: string) => Promise<void>;
}

// =============================================================================
// Slice factory
// =============================================================================

/**
 * Create a fresh recent-docs zustand store. The shell creates one of these
 * per realm at bootstrap; tests create per-`describe`.
 *
 * Returned shape is `UseBoundStore<StoreApi<RecentDocsState>>` — same as
 * `create<T>()(...)` returns from zustand v5. Components consume via
 * `const { recentDocs } = useRecentDocs()`; non-React callers use
 * `useRecentDocs.getState()`.
 */
export function createRecentDocsStore(): UseBoundStore<StoreApi<RecentDocsState>> {
  return create<RecentDocsState>((set, get) => {
    /**
     * Re-read meta and patch the slice. Used by `hydrate`, `touch`, and
     * `forget` after their write so observers always see the post-write
     * state. Errors are logged; the slice keeps its prior state.
     */
    const refresh = async (): Promise<void> => {
      try {
        const meta = await readMeta();
        set({
          recentDocs: meta.recentDocs,
          lastActiveDocId: meta.lastActiveDocId,
        });
      } catch (err) {
        console.error('[recentDocs] readMeta failed:', err);
      }
    };

    return {
      recentDocs: [],
      lastActiveDocId: null,
      loaded: false,

      hydrate: async () => {
        await refresh();
        // Flip `loaded` even if the read errored — boot precedence
        // (§6.2) tolerates an empty `recentDocs` (falls through to the
        // welcome screen). Blocking forever on a transient IDB hiccup
        // would defeat the whole "off the first-paint path" point.
        if (!get().loaded) {
          set({ loaded: true });
        }
      },

      touch: async (docId: string) => {
        await metaTouchDoc(docId);
        await refresh();
      },

      forget: async (docId: string) => {
        await metaForgetDoc(docId);
        await refresh();
      },
    };
  });
}

/** Convenience type alias for callers that need to type-prop the store. */
export type RecentDocsStore = ReturnType<typeof createRecentDocsStore>;
