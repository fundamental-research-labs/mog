import { jest } from '@jest/globals';
import type { BridgeTransport } from '@rust-bridge/client';

import { ComputeBridge } from '../compute-bridge';

function makeMockContext() {
  return {
    eventBus: { emit: jest.fn(), on: jest.fn(() => () => {}), off: jest.fn() },
    setPendingUndoDescription: jest.fn(),
    getPendingUndoDescription: jest.fn(() => null),
    clearPendingUndoDescription: jest.fn(),
    destroy: jest.fn(),
  } as any;
}

function createBridge() {
  const calls: Array<{ command: string; args: Record<string, unknown> }> = [];
  const transport: BridgeTransport = {
    call: jest.fn((command: string, args: Record<string, unknown>) => {
      calls.push({ command, args });
      if (command === 'compute_active_principal') return Promise.resolve(['role:analyst']);
      if (command === 'compute_security_active') return Promise.resolve(true);
      if (command === 'compute_make_principal') return Promise.resolve(['a', 'b']);
      return Promise.resolve(undefined);
    }) as BridgeTransport['call'],
  };

  return {
    bridge: new ComputeBridge(makeMockContext(), 'doc-session-1', transport),
    calls,
  };
}

describe('ComputeBridge session/security document scoping', () => {
  it('sends docId when setting the active principal', async () => {
    const { bridge, calls } = createBridge();

    await bridge.setActivePrincipal({ tags: ['role:analyst'] });

    expect(calls).toEqual([
      {
        command: 'compute_set_active_principal',
        args: { docId: 'doc-session-1', tags: ['role:analyst'] },
      },
    ]);
  });

  it('sends docId when clearing the active principal', async () => {
    const { bridge, calls } = createBridge();

    await bridge.setActivePrincipal(null);

    expect(calls).toEqual([
      {
        command: 'compute_set_active_principal',
        args: { docId: 'doc-session-1', tags: null },
      },
    ]);
  });

  it('sends docId when reading the active principal', async () => {
    const { bridge, calls } = createBridge();

    await expect(bridge.activePrincipal()).resolves.toEqual({ tags: ['role:analyst'] });

    expect(calls).toEqual([
      {
        command: 'compute_active_principal',
        args: { docId: 'doc-session-1' },
      },
    ]);
  });

  it('sends docId when reading whether security is active', async () => {
    const { bridge, calls } = createBridge();

    await expect(bridge.securityActive()).resolves.toBe(true);

    expect(calls).toEqual([
      {
        command: 'compute_security_active',
        args: { docId: 'doc-session-1' },
      },
    ]);
  });

  it('sends docId when interning principals', async () => {
    const { bridge, calls } = createBridge();

    await expect(bridge.makePrincipal(['b', 'a'])).resolves.toEqual({ tags: ['a', 'b'] });

    expect(calls).toEqual([
      {
        command: 'compute_make_principal',
        args: { docId: 'doc-session-1', tags: ['b', 'a'] },
      },
    ]);
  });
});
