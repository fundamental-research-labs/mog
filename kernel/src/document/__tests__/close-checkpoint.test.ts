import { jest } from '@jest/globals';
import { RustDocument } from '../rust-document';
import type { Provider, ProviderDoc } from '../providers/provider';
import { WriteGate } from '../write-gate';

// ---------------------------------------------------------------------------
// Stub bridge
// ---------------------------------------------------------------------------

interface StubBridge {
  subscribeUpdateV1(cb: (u: Uint8Array) => void): { unsubscribe: () => void };
  createEngine(snapshot?: Record<string, unknown>): Promise<unknown>;
  createEngineFromYrsState(state: Uint8Array): Promise<unknown>;
  flushUndoCapture(): Promise<unknown>;
  syncApply(u: Uint8Array): Promise<unknown>;
  encodeDiff(sv: Uint8Array): Promise<Uint8Array>;
  currentStateVector(): Promise<Uint8Array>;
  flushPendingUpdateV1(): Promise<void>;
  writeGate: WriteGate | undefined;
  emit(update: Uint8Array): void;
  subscriberCount(): number;
}

function makeStubBridge(): StubBridge {
  const subscribers = new Set<(u: Uint8Array) => void>();
  const emit = (update: Uint8Array) => {
    for (const cb of subscribers) cb(update);
  };
  return {
    subscribeUpdateV1(cb) {
      subscribers.add(cb);
      let unsubbed = false;
      return {
        unsubscribe: () => {
          if (unsubbed) return;
          unsubbed = true;
          subscribers.delete(cb);
        },
      };
    },
    createEngine: async () => ({ recalc: { changedCells: [] } }),
    createEngineFromYrsState: async () => ({ recalc: { changedCells: [] } }),
    flushUndoCapture: async () => ({ recalc: { changedCells: [] } }),
    syncApply: async () => ({ recalc: { changedCells: [] } }),
    encodeDiff: async () => new Uint8Array(),
    currentStateVector: async () => new Uint8Array(),
    flushPendingUpdateV1: async () => {},
    writeGate: undefined,
    emit(update) {
      emit(update);
    },
    subscriberCount() {
      return subscribers.size;
    },
  };
}

// ---------------------------------------------------------------------------
// Stub provider
// ---------------------------------------------------------------------------

function makeStubProvider(
  overrides: {
    name?: string;
    refId?: string;
    flushFn?: () => Promise<void>;
    detachFn?: () => Promise<void>;
  } = {},
): Provider {
  const name = overrides.name ?? 'stub-provider';
  const refId = overrides.refId ?? name;
  return {
    name,
    flushFailed: false,
    async attach(_doc: ProviderDoc) {
      return { status: 'ready' as const, mode: 'normal' as const };
    },
    appendUpdate: jest.fn<(u: Uint8Array) => void>(),
    flush: overrides.flushFn ?? (async () => {}),
    checkpointFullState: async () => ({ status: 'committed' as const, mode: 'normal' as const }),
    flushSync: () => {},
    detach: overrides.detachFn ?? (async () => {}),
    stateVector: async () => new Uint8Array(),
    getIdentity: () => ({
      providerRefId: refId,
      storageScope: { kind: 'explicit-no-scope' as const, reason: 'ephemeral-memory' as const },
      contractVersion: '1.0',
      providerProtocolVersion: '1.0',
    }),
    getCapabilities: () => ({
      durableWrite: true,
      incrementalAppend: true,
      fullStateCheckpoint: true,
      fullStateReplay: true,
      storageCursor: false,
      yrsStateVectorDiff: false,
      concurrentTabIsolation: false,
      assetStorage: false,
    }),
  };
}

async function makeOrchestrator(opts?: {
  writeGate?: boolean;
}): Promise<{ doc: RustDocument; bridge: StubBridge }> {
  const bridge = makeStubBridge();
  if (opts?.writeGate) {
    bridge.writeGate = new WriteGate();
  }
  const doc = new RustDocument({
    docId: 'close-checkpoint-test',
    computeBridge: bridge as unknown as any,
    internal: true,
    skipPersistenceLoad: true,
  });
  await doc.ready;
  return { doc, bridge };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RustDocument.checkpointStructured', () => {
  it('returns committed status with provider results', async () => {
    const { doc, bridge } = await makeOrchestrator({ writeGate: true });
    const provider = makeStubProvider({ name: 'p1', refId: 'ref-p1' });
    bridge.writeGate = new WriteGate();

    await doc.attachProvider(provider, { suppressInitialBaseline: true, suppressTouch: true });

    const result = await doc.checkpointStructured();

    expect(result.status).toBe('committed');
    expect(result.providerResults).toHaveLength(1);
    expect(result.providerResults[0].providerRefId).toBe('ref-p1');
    expect(result.providerResults[0].status).toBe('committed');
    expect(result.highWaterMark).toBeDefined();
    expect(result.highWaterMark.mark).toMatch(/^hwm-/);
    expect(typeof result.timestamp).toBe('number');

    await doc.destroy();
  });

  it('returns partial when one provider fails', async () => {
    const { doc, bridge } = await makeOrchestrator({ writeGate: true });
    bridge.writeGate = new WriteGate();

    const goodProvider = makeStubProvider({ name: 'good', refId: 'ref-good' });
    const badProvider = makeStubProvider({
      name: 'bad',
      refId: 'ref-bad',
      flushFn: async () => {
        throw new Error('flush failed');
      },
    });

    await doc.attachProvider(goodProvider, { suppressInitialBaseline: true, suppressTouch: true });
    await doc.attachProvider(badProvider, { suppressInitialBaseline: true, suppressTouch: true });

    const result = await doc.checkpointStructured();

    expect(result.status).toBe('partial');
    expect(result.providerResults).toHaveLength(2);
    expect(result.providerResults[0].status).toBe('committed');
    expect(result.providerResults[1].status).toBe('failed');
    expect(result.providerResults[1].failureReason).toBe('flush failed');

    await doc.destroy();
  });

  it('returns failed when all providers fail', async () => {
    const { doc, bridge } = await makeOrchestrator({ writeGate: true });
    bridge.writeGate = new WriteGate();

    const badProvider = makeStubProvider({
      name: 'bad',
      refId: 'ref-bad',
      flushFn: async () => {
        throw new Error('boom');
      },
    });

    await doc.attachProvider(badProvider, { suppressInitialBaseline: true, suppressTouch: true });

    const result = await doc.checkpointStructured();

    expect(result.status).toBe('failed');

    await doc.destroy();
  });

  it('captures high-water marks accurately', async () => {
    const { doc, bridge } = await makeOrchestrator();
    const gate = new WriteGate();
    bridge.writeGate = gate;

    gate.recordMutation();
    gate.recordMutation();

    const result = await doc.checkpointStructured();

    expect(result.highWaterMark.pendingMutationCount).toBe(0);
    expect(result.highWaterMark.mark).toBe('hwm-2');

    await doc.destroy();
  });

  it('returns failed for destroyed document', async () => {
    const { doc } = await makeOrchestrator();
    await doc.destroy();

    const result = await doc.checkpointStructured();

    expect(result.status).toBe('failed');
    expect(result.providerResults).toHaveLength(0);
  });
});

describe('RustDocument.close', () => {
  it('transitions through closing phases correctly', async () => {
    const { doc, bridge } = await makeOrchestrator();
    const gate = new WriteGate();
    bridge.writeGate = gate;

    const detachOrder: string[] = [];
    const p1 = makeStubProvider({
      name: 'p1',
      refId: 'ref-p1',
      detachFn: async () => {
        detachOrder.push('p1');
      },
    });
    const p2 = makeStubProvider({
      name: 'p2',
      refId: 'ref-p2',
      detachFn: async () => {
        detachOrder.push('p2');
      },
    });

    await doc.attachProvider(p1, { suppressInitialBaseline: true, suppressTouch: true });
    await doc.attachProvider(p2, { suppressInitialBaseline: true, suppressTouch: true });

    const result = await doc.close();

    expect(result.status).toBe('closed');
    expect(result.detachedProviders).toContain('ref-p1');
    expect(result.detachedProviders).toContain('ref-p2');
    expect(result.errors).toHaveLength(0);
    expect(result.finalCheckpoint).toBeDefined();
    expect(result.finalCheckpoint!.status).toBe('committed');
    expect(typeof result.timestamp).toBe('number');

    expect(detachOrder).toEqual(['p2', 'p1']);

    expect(gate.mode).toBe('closed');
  });

  it('close after close is idempotent', async () => {
    const { doc, bridge } = await makeOrchestrator();
    bridge.writeGate = new WriteGate();

    const first = await doc.close();
    expect(first.status).toBe('closed');

    const second = await doc.close();
    expect(second.status).toBe('closed');
    expect(second.detachedProviders).toHaveLength(0);
  });

  it('surfaces failed provider detach in errors', async () => {
    const { doc, bridge } = await makeOrchestrator();
    bridge.writeGate = new WriteGate();

    const badProvider = makeStubProvider({
      name: 'bad',
      refId: 'ref-bad',
      detachFn: async () => {
        throw new Error('detach failed');
      },
    });

    await doc.attachProvider(badProvider, { suppressInitialBaseline: true, suppressTouch: true });

    const result = await doc.close();

    expect(result.status).toBe('closedWithWarnings');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe('STORAGE_CLOSE_DETACH_FAILED');
    expect(result.errors[0].providerRefId).toBe('ref-bad');
    expect(result.detachedProviders).toContain('ref-bad');
  });

  it('surfaces failed checkpoint in close result', async () => {
    const { doc, bridge } = await makeOrchestrator();
    bridge.writeGate = new WriteGate();

    const badProvider = makeStubProvider({
      name: 'bad',
      refId: 'ref-bad',
      flushFn: async () => {
        throw new Error('flush failed');
      },
    });

    await doc.attachProvider(badProvider, { suppressInitialBaseline: true, suppressTouch: true });

    const result = await doc.close();

    expect(result.status).toBe('closeFailed');
    expect(result.finalCheckpoint).toBeDefined();
    expect(result.finalCheckpoint!.status).toBe('failed');
  });

  it('close without providers returns clean closed', async () => {
    const { doc, bridge } = await makeOrchestrator();
    bridge.writeGate = new WriteGate();

    const result = await doc.close();

    expect(result.status).toBe('closed');
    expect(result.finalCheckpoint).toBeUndefined();
    expect(result.detachedProviders).toHaveLength(0);
  });
});
