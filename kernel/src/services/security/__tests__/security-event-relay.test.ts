/**
 * Security Event Relay Tests — Fix 4 for future privacy/access-control.
 *
 * Verifies the relay drains raw Rust `SecurityEvent` payloads from a
 * stub compute bridge, adapts them into kernel event-bus shapes, and
 * emits them through the event bus. The unknown-kind fallback is
 * tested separately — a Rust-side variant added before contracts
 * catches up must degrade to a console warning, not a crash.
 */
import type { IEventBus, SpreadsheetEvent } from '@mog-sdk/contracts/events';
import type { RawSecurityEvent } from '@mog-sdk/contracts/events';

import { createSecurityEventRelay } from '../security-event-relay';

function createRecordingBus(): {
  bus: IEventBus;
  events: SpreadsheetEvent[];
} {
  const events: SpreadsheetEvent[] = [];
  const bus: IEventBus = {
    on() {
      return () => {};
    },
    onMany() {
      return () => {};
    },
    onAll() {
      return () => {};
    },
    emit(event) {
      events.push(event);
    },
    emitBatch(batch) {
      events.push(...batch);
    },
    clear() {
      events.length = 0;
    },
  };
  return { bus, events };
}

function createStubBridge(queue: RawSecurityEvent[][]): {
  wbSecurityDrainEvents: () => Promise<RawSecurityEvent[]>;
  drainCalls: number;
} {
  let drainCalls = 0;
  return {
    get drainCalls() {
      return drainCalls;
    },
    wbSecurityDrainEvents: async () => {
      drainCalls++;
      return queue.shift() ?? [];
    },
  };
}

describe('security-event-relay', () => {
  test('adapts every known RawSecurityEvent kind to its kernel shape', async () => {
    const { bus, events } = createRecordingBus();
    const raw: RawSecurityEvent[] = [
      {
        kind: 'policy_added',
        policy: {
          id: 'policy-1',
          principalTag: 'agent:*',
          target: { kind: 'workbook' },
          level: 'read',
          priority: 0,
          enabled: true,
          metadata: { createdBy: 'test', createdAt: 0 },
        },
      } as RawSecurityEvent,
      { kind: 'policy_removed', id: 'policy-2' } as RawSecurityEvent,
      { kind: 'policy_updated', id: 'policy-3' } as RawSecurityEvent,
      {
        kind: 'access_denied',
        principal_tags: ['agent:copilot'],
        target: { kind: 'workbook' },
        operation: 'set_cell',
      } as RawSecurityEvent,
      {
        // ambiguity_detected round-trip — pins the nested
        // `warning` field shape (principal_tags / target /
        // conflicting_policies / resolved_level) so a Rust-side rename
        // would surface here before it reaches consumer code.
        kind: 'ambiguity_detected',
        warning: {
          principal_tags: ['agent:copilot'],
          target: { kind: 'workbook' },
          conflicting_policies: ['policy-ambig-a', 'policy-ambig-b'],
          resolved_level: 'read',
        },
      } as RawSecurityEvent,
      {
        kind: 'policies_reloaded',
        policyVersionBefore: 1,
        policyVersionAfter: 2,
        active: true,
      } as RawSecurityEvent,
    ];
    const relay = createSecurityEventRelay(createStubBridge([raw]), bus, {
      intervalMs: 1_000_000, // effectively disabled; we drive drains manually
    });
    await relay.drainOnce();

    expect(events.map((e) => e.type)).toEqual([
      'security:policy-added',
      'security:policy-removed',
      'security:policy-updated',
      'security:access-denied',
      'security:ambiguity-detected',
      'security:policies-reloaded',
    ]);

    const reloaded = events.find((e) => e.type === 'security:policies-reloaded');
    expect(reloaded).toMatchObject({
      policyVersionAfter: 2,
      active: true,
    });

    // flatten-and-rename round-trip. The raw `warning.*` nested
    // keys land on the top level of the kernel event as
    // camelCase-renamed fields; verifying the full shape here guards
    // against silent drift between the Rust `AmbiguityWarning` serde
    // emission (snake_case inside a nested `warning`) and the kernel
    // `AmbiguityDetectedEvent` interface.
    const ambiguity = events.find((e) => e.type === 'security:ambiguity-detected');
    expect(ambiguity).toMatchObject({
      principalTags: ['agent:copilot'],
      target: { kind: 'workbook' },
      conflictingPolicies: ['policy-ambig-a', 'policy-ambig-b'],
      resolvedLevel: 'read',
    });
  });

  test('drainOnce is re-entrant-safe under concurrent invocation', async () => {
    // Simulate a slow bridge. Two concurrent drainOnce() calls must
    // produce one drain, not two — re-entrancy would double-emit when
    // events arrive on a fast subsequent tick.
    let resolve!: (v: RawSecurityEvent[]) => void;
    const slowBridge = {
      wbSecurityDrainEvents: () =>
        new Promise<RawSecurityEvent[]>((r) => {
          resolve = r;
        }),
    };
    const { bus, events } = createRecordingBus();
    const relay = createSecurityEventRelay(slowBridge, bus, {
      intervalMs: 1_000_000,
    });

    const a = relay.drainOnce();
    const b = relay.drainOnce(); // should no-op while a is in flight
    resolve([{ kind: 'policy_removed', id: 'policy-9' } as RawSecurityEvent]);
    await Promise.all([a, b]);

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('security:policy-removed');
  });

  test('drainOnce skips silently when source.isInitialized === false', async () => {
    // Regression: app-eval real-files — the
    // DocumentLifecycleSystem starts the relay during `executeWireContext`
    // (CONTEXT_SET phase), but `wbSecurityDrainEvents` requires STARTED
    // and throws `BRIDGE_PHASE_INSUFFICIENT` if called any earlier. Without
    // this guard, every premature drain logs a warning AND pollutes
    // `recentErrors` (mis-routing app-eval failure classification).
    const { bus, events } = createRecordingBus();
    let drainCalls = 0;
    let isInit = false;
    const source = {
      get isInitialized() {
        return isInit;
      },
      wbSecurityDrainEvents: async () => {
        drainCalls++;
        return [{ kind: 'policy_removed', id: 'policy-late' } as RawSecurityEvent];
      },
    };
    const relay = createSecurityEventRelay(source, bus, { intervalMs: 1_000_000 });

    // First drain while bridge is not yet STARTED → no transport call,
    // no events emitted, no crash.
    await relay.drainOnce();
    expect(drainCalls).toBe(0);
    expect(events).toHaveLength(0);

    // Bridge transitions to STARTED → drain proceeds normally.
    isInit = true;
    await relay.drainOnce();
    expect(drainCalls).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('security:policy-removed');
  });

  test('unknown kinds are logged once and skipped (no crash)', async () => {
    const { bus, events } = createRecordingBus();
    const observedWarnings: Array<{ kind: string; raw: unknown }> = [];
    const relay = createSecurityEventRelay(
      createStubBridge([
        [
          { kind: 'brand_new_variant', payload: 1 } as unknown as RawSecurityEvent,
          { kind: 'brand_new_variant', payload: 2 } as unknown as RawSecurityEvent,
          { kind: 'policy_removed', id: 'policy-5' } as RawSecurityEvent,
        ],
      ]),
      bus,
      {
        intervalMs: 1_000_000,
        onUnknownKind: (kind, raw) => observedWarnings.push({ kind, raw }),
      },
    );
    await relay.drainOnce();

    // Known event still emitted; unknown ones dropped.
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('security:policy-removed');
    // Warning fires once per-kind, not per-event.
    expect(observedWarnings).toHaveLength(1);
    expect(observedWarnings[0]?.kind).toBe('brand_new_variant');
  });
});
