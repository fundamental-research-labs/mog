/**
 * Recent Docs service barrel — current implementation §6.2.
 *
 * Exposes the zustand slice that mirrors the IndexedDB Meta API. The
 * shell hydrates this in `createShell()` (in parallel with WASM init)
 * so the welcome screen and boot precedence table can read recent docs
 * without their own IDB calls.
 *
 */

export {
  createRecentDocsStore,
  type RecentDocsState,
  type RecentDocsStore,
} from './recent-docs-slice';
