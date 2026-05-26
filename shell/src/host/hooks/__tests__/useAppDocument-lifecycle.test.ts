/**
 * §6.1 lifecycle-hook conformance tests for `useAppDocument.ts`.
 *
 * Covers the three layered hooks the current implementation plan installs:
 *   - `visibilitychange → hidden` (PRIMARY) — fires `flushSync()` on every
 *      active doc.
 *   - `pagehide` (SECONDARY) — same flush call; idempotent.
 *   - `beforeunload` (SAFETY NET) — runs `flushSync()`, then sets
 *     `event.returnValue = ''` only when at least one doc still has
 *     `pendingUpdatesCount > 0` or `hasFlushFailed === true`. Stays
 *     silent on the all-clear case so reloads aren't gated by spurious
 *     "leave site?" prompts.
 *
 * Per `feedback_e2e_real_path`: the tests dispatch real DOM events via
 * `document.dispatchEvent(new Event('visibilitychange'))` etc. — no
 * mocking of `addEventListener`. The fake docs implement just the
 * `LifecycleDocumentHandle` surface the hooks read (`flushSync`,
 * `pendingUpdatesCount`, `hasFlushFailed`).
 *
 * Tests share the same module-level `lifecycleHooksRegistered` flag, so
 * each test resets it via `__resetLifecycleHooksRegistrationForTests` and
 * re-registers with its own `getDocs`.
 *
 */

// The lifecycle-hook registration logic is extracted into
// `app-document-lifecycle.ts` so it can be tested without dragging in
// `useAppDocument.ts`'s `@mog-sdk/kernel/api` imports (which transitively
// load the napi loader and trip Jest's CommonJS `import.meta.url`
// limitation). The shape used by these tests is just `{ flushSync,
// pendingUpdatesCount, hasFlushFailed }` — declared inline to keep the
// test independent of the live `LifecycleDocumentHandle` type.
import {
  __registerLifecycleHooksForTests,
  __resetLifecycleHooksRegistrationForTests,
  type LifecycleDocumentHandle,
} from '../app-document-lifecycle';

// ============================================================================
// Test fakes
// ============================================================================

interface FakeDoc extends Pick<LifecycleDocumentHandle, 'pendingUpdatesCount' | 'hasFlushFailed'> {
  /** Spy: number of times `flushSync()` has been invoked. */
  flushSyncCalls: number;
  flushSync(): void;
}

function makeFakeDoc(opts?: {
  pending?: number;
  failed?: boolean;
  throwOnFlush?: boolean;
}): FakeDoc {
  const doc: FakeDoc = {
    flushSyncCalls: 0,
    pendingUpdatesCount: opts?.pending ?? 0,
    hasFlushFailed: opts?.failed ?? false,
    flushSync() {
      this.flushSyncCalls += 1;
      if (opts?.throwOnFlush) throw new Error('flushSync threw (contract violation)');
    },
  };
  return doc;
}

/**
 * Fresh visibilitychange Event. jsdom's `Event` constructor doesn't carry
 * a `visibilityState` payload — the spec says the listener reads
 * `document.visibilityState` directly, so we patch the document field
 * before dispatch.
 */
function dispatchVisibilityChange(state: 'hidden' | 'visible'): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

function dispatchPageHide(): void {
  window.dispatchEvent(new Event('pagehide'));
}

function dispatchBeforeUnload(): BeforeUnloadEvent {
  // `BeforeUnloadEvent` constructor isn't in jsdom — fall back to `Event`
  // and add the `returnValue` property the handler will mutate. The
  // `cancelable: true` is required so `event.preventDefault()` can flip
  // `defaultPrevented`, which is the spec contract for triggering the
  // browser prompt.
  const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
  // Initialize returnValue to a sentinel so we can tell whether the
  // handler mutated it.
  Object.defineProperty(event, 'returnValue', {
    configurable: true,
    writable: true,
    value: 'SENTINEL',
  });
  window.dispatchEvent(event);
  return event;
}

// ============================================================================
// Test setup
// ============================================================================

beforeEach(() => {
  __resetLifecycleHooksRegistrationForTests();
});

// ============================================================================
// PRIMARY — visibilitychange → hidden
// ============================================================================

describe('§6.1 visibilitychange → hidden (PRIMARY)', () => {
  it('triggers flushSync() on every active doc', () => {
    const a = makeFakeDoc();
    const b = makeFakeDoc();
    __registerLifecycleHooksForTests(() => [a, b] as unknown as LifecycleDocumentHandle[]);

    dispatchVisibilityChange('hidden');

    expect(a.flushSyncCalls).toBe(1);
    expect(b.flushSyncCalls).toBe(1);
  });

  it('does NOT fire flushSync on visibilitychange → visible', () => {
    const a = makeFakeDoc();
    __registerLifecycleHooksForTests(() => [a] as unknown as LifecycleDocumentHandle[]);

    dispatchVisibilityChange('visible');

    expect(a.flushSyncCalls).toBe(0);
  });

  it('continues to flush remaining docs when one throws (contract violation)', () => {
    const a = makeFakeDoc({ throwOnFlush: true });
    const b = makeFakeDoc();
    __registerLifecycleHooksForTests(() => [a, b] as unknown as LifecycleDocumentHandle[]);

    // `a.flushSync()` throws — `b.flushSync()` must still be called.
    expect(() => dispatchVisibilityChange('hidden')).not.toThrow();
    expect(a.flushSyncCalls).toBe(1);
    expect(b.flushSyncCalls).toBe(1);
  });
});

// ============================================================================
// SECONDARY — pagehide (bfcache backup)
// ============================================================================

describe('§6.1 pagehide (SECONDARY)', () => {
  it('triggers flushSync() on every active doc', () => {
    const a = makeFakeDoc();
    const b = makeFakeDoc();
    __registerLifecycleHooksForTests(() => [a, b] as unknown as LifecycleDocumentHandle[]);

    dispatchPageHide();

    expect(a.flushSyncCalls).toBe(1);
    expect(b.flushSyncCalls).toBe(1);
  });

  it('idempotent against visibilitychange — both events run flushSync independently', () => {
    // Per §3.3, individual Providers treat the second flushSync with an
    // empty queue as a no-op. The orchestrator-level fan-out from this
    // hook layer is NOT idempotent — it dispatches each event. Idempotency
    // is the Provider's contract, not the hooks'. This test just verifies
    // the hooks fire on both events without crosstalk.
    const a = makeFakeDoc();
    __registerLifecycleHooksForTests(() => [a] as unknown as LifecycleDocumentHandle[]);

    dispatchVisibilityChange('hidden');
    dispatchPageHide();

    expect(a.flushSyncCalls).toBe(2);
  });
});

// ============================================================================
// SAFETY NET — beforeunload
// ============================================================================

describe('§6.1 beforeunload (SAFETY NET)', () => {
  it('does NOT prompt when all docs are clean', () => {
    const a = makeFakeDoc({ pending: 0, failed: false });
    __registerLifecycleHooksForTests(() => [a] as unknown as LifecycleDocumentHandle[]);

    const event = dispatchBeforeUnload();

    expect(a.flushSyncCalls).toBe(1);
    // returnValue stayed at the sentinel — handler did not mutate.
    expect((event as unknown as { returnValue: string }).returnValue).toBe('SENTINEL');
    expect(event.defaultPrevented).toBe(false);
  });

  it('prompts when at least one doc has pendingUpdatesCount > 0', () => {
    const clean = makeFakeDoc({ pending: 0 });
    const dirty = makeFakeDoc({ pending: 3 });
    __registerLifecycleHooksForTests(() => [clean, dirty] as unknown as LifecycleDocumentHandle[]);

    const event = dispatchBeforeUnload();

    expect(clean.flushSyncCalls).toBe(1);
    expect(dirty.flushSyncCalls).toBe(1);
    expect((event as unknown as { returnValue: string }).returnValue).toBe('');
    expect(event.defaultPrevented).toBe(true);
  });

  it('prompts when at least one doc has hasFlushFailed === true', () => {
    const failed = makeFakeDoc({ pending: 0, failed: true });
    __registerLifecycleHooksForTests(() => [failed] as unknown as LifecycleDocumentHandle[]);

    const event = dispatchBeforeUnload();

    expect(failed.flushSyncCalls).toBe(1);
    expect((event as unknown as { returnValue: string }).returnValue).toBe('');
    expect(event.defaultPrevented).toBe(true);
  });
});

// ============================================================================
// Registration semantics
// ============================================================================

describe('§6.1 registerLifecycleHooks listener-install idempotency + multi-source registry', () => {
  it('second registration adds another active-docs source — both caches participate in flush', () => {
    // Follow-up: the user-visible spreadsheet doc flow opens
    // documents through `DocumentManager`, while `useAppDocument` opens
    // per-app CRM/finance docs through its own cache. Both call
    // `registerLifecycleHooks` — both must fan flushSync. The §6.1 DOM
    // listener install stays idempotent (only the first call attaches
    // window listeners) but the active-docs registry is multi-source so
    // BOTH `getDocs` callables iterate on every event.
    const a = makeFakeDoc();
    const b = makeFakeDoc();

    const getA = () => [a] as unknown as LifecycleDocumentHandle[];
    __registerLifecycleHooksForTests(getA);

    const getB = () => [b] as unknown as LifecycleDocumentHandle[];
    __registerLifecycleHooksForTests(getB);

    dispatchVisibilityChange('hidden');

    // Both docs flushed exactly once. Listener install was idempotent
    // (only one DOM listener), but the registry composes — both `getA`
    // and `getB` iterate on every visibilitychange.
    expect(a.flushSyncCalls).toBe(1);
    expect(b.flushSyncCalls).toBe(1);
  });
});
