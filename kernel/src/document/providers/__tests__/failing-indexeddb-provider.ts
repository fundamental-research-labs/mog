/**
 * Test-only IndexedDBProvider variant that fails `flushSync` deterministically.
 *
 * Used by `runProviderConformance(...)` row 8 to assert that a Provider
 * which encounters a tx-open failure sets `flushFailed = true` instead of
 * throwing. The production class no longer carries a `_testFailFlushSync`
 * option (UX-FIX-PRINCIPLES §1: no test-only seams in production code) —
 * instead, this subclass simulates the same failure by replacing the open
 * `IDBDatabase`'s `transaction()` with a thrower before `flushSync` runs.
 *
 * Because the production `flushSync` already wraps `this.db.transaction(...)`
 * in `try { ... } catch { this._flushFailed = true; return; }`, simulating
 * the throw exercises exactly the same code path the conformance row is
 * meant to lock.
 */

import { IndexedDBProvider } from '../indexeddb-provider';

export class FailingIndexedDBProvider extends IndexedDBProvider {
  override flushSync(): void {
    // Walk the prototype chain to grab the live `db` field set by the base
    // class on `attach()`. We don't rely on TypeScript visibility here —
    // the test suite is allowed to peek into Provider state to simulate a
    // tx-open error; production code never does.
    const self = this as unknown as { db: IDBDatabase | null };
    const realDb = self.db;
    if (realDb) {
      const realTransaction = realDb.transaction.bind(realDb);
      Object.defineProperty(realDb, 'transaction', {
        configurable: true,
        value: () => {
          throw new DOMException('forced for conformance row 8', 'InvalidStateError');
        },
      });
      try {
        super.flushSync();
      } finally {
        Object.defineProperty(realDb, 'transaction', {
          configurable: true,
          value: realTransaction,
        });
      }
      return;
    }
    // No db handle yet — the base class already records flushFailed in
    // that branch, so just delegate.
    super.flushSync();
  }
}
