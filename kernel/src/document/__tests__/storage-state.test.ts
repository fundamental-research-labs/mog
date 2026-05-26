import { StorageState, type StorageError } from '../providers/storage-state';

describe('storage state', () => {
  it('reflects current phase', () => {
    const state = new StorageState();
    expect(state.phase).toBe('idle');

    state.setPhase('attaching');
    expect(state.phase).toBe('attaching');

    state.setPhase('ready');
    expect(state.phase).toBe('ready');

    state.setPhase('disposed');
    expect(state.phase).toBe('disposed');
  });

  it('reports correct durability mode', () => {
    const state = new StorageState();
    expect(state.durabilityMode).toBe('ephemeral');

    state.setDurabilityMode('durableLocal');
    expect(state.durabilityMode).toBe('durableLocal');

    state.setDurabilityMode('localFirst');
    expect(state.durabilityMode).toBe('localFirst');

    state.setDurabilityMode('remoteBacked');
    expect(state.durabilityMode).toBe('remoteBacked');

    state.setDurabilityMode('readOnly');
    expect(state.durabilityMode).toBe('readOnly');
  });

  it('reports readOnly correctly', () => {
    const state = new StorageState();
    expect(state.readOnly).toBe(false);

    state.setReadOnly(true);
    expect(state.readOnly).toBe(true);

    state.setReadOnly(false);
    expect(state.readOnly).toBe(false);
  });

  it('degraded providers listed when optional provider fails', () => {
    const state = new StorageState();
    state.setPhase('ready');

    state.addDegradedProvider('websocket');
    expect(state.degradedProviders).toContain('websocket');
    expect(state.phase).toBe('degraded');

    state.addDegradedProvider('rest-api');
    expect(state.degradedProviders).toEqual(['websocket', 'rest-api']);
  });

  it('adding the same degraded provider twice is idempotent', () => {
    const state = new StorageState();
    state.setPhase('ready');

    state.addDegradedProvider('websocket');
    state.addDegradedProvider('websocket');
    expect(state.degradedProviders).toEqual(['websocket']);
  });

  it('errors accumulated in storage state', () => {
    const state = new StorageState();

    const err1: StorageError = {
      provider: 'indexeddb',
      message: 'QuotaExceededError',
      timestamp: 1000,
    };
    const err2: StorageError = {
      provider: 'websocket',
      message: 'Connection refused',
      timestamp: 2000,
    };

    state.addError(err1);
    state.addError(err2);

    expect(state.errors).toHaveLength(2);
    expect(state.errors[0]).toEqual(err1);
    expect(state.errors[1]).toEqual(err2);
  });

  it('snapshot returns a frozen copy of state', () => {
    const state = new StorageState();
    state.setPhase('ready');
    state.setDurabilityMode('durableLocal');
    state.setReadOnly(false);

    const snap = state.snapshot();
    expect(snap.phase).toBe('ready');
    expect(snap.durabilityMode).toBe('durableLocal');
    expect(snap.readOnly).toBe(false);
    expect(snap.degradedProviders).toEqual([]);
    expect(snap.errors).toEqual([]);

    state.setPhase('error');
    state.addError({ provider: 'test', message: 'fail', timestamp: 0 });
    expect(snap.phase).toBe('ready');
    expect(snap.errors).toEqual([]);
  });
});
