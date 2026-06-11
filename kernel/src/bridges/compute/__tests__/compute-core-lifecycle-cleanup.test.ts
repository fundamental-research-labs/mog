import { jest } from '@jest/globals';
import type { BridgeTransport } from '@rust-bridge/client';

import { BridgeError } from '../../../errors/bridge';
import { ComputeCore } from '../compute-core';

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeMockContext() {
  return {
    eventBus: { emit: jest.fn(), on: jest.fn(() => () => {}), off: jest.fn() },
    setPendingUndoDescription: jest.fn(),
    getPendingUndoDescription: jest.fn(() => null),
    clearPendingUndoDescription: jest.fn(),
    destroy: jest.fn(),
  } as any;
}

function createStartedCore(transport: BridgeTransport): ComputeCore {
  const core = new ComputeCore(makeMockContext(), 'test-doc', transport);
  (core as any)._phase = 'STARTED';
  (core as any).engineCreated = true;
  return core;
}

describe('ComputeCore document-scoped cleanup lifecycle', () => {
  it('enters DESTROYING before compute_destroy resolves and shares repeated destroy()', async () => {
    const destroyDeferred = deferred<void>();
    const transport = {
      call: jest.fn((command: string) => {
        if (command === 'compute_destroy') return destroyDeferred.promise;
        return Promise.resolve(undefined);
      }),
    };
    const core = createStartedCore(transport as BridgeTransport);

    const first = core.destroy();
    const second = core.destroy();

    expect(core.phase).toBe('DESTROYING');

    await Promise.resolve();
    expect(transport.call).toHaveBeenCalledWith('compute_destroy', { docId: 'test-doc' });
    expect(transport.call).toHaveBeenCalledTimes(1);

    destroyDeferred.resolve();
    await Promise.all([first, second]);
    expect(core.phase).toBe('DISPOSED');
  });

  it('normal operations fail loudly during DESTROYING without hitting transport', async () => {
    const destroyDeferred = deferred<void>();
    const transport = {
      call: jest.fn((command: string) => {
        if (command === 'compute_destroy') return destroyDeferred.promise;
        return Promise.resolve(undefined);
      }),
    };
    const core = createStartedCore(transport as BridgeTransport);

    void core.destroy();

    await expect(
      core.updateViewportRegionBounds('vp-1', {
        startRow: 0,
        startCol: 0,
        endRow: 1,
        endCol: 1,
      }),
    ).rejects.toMatchObject({ code: 'BRIDGE_DISPOSED' });

    expect(transport.call).not.toHaveBeenCalledWith(
      'compute_update_viewport_bounds',
      expect.anything(),
    );

    destroyDeferred.resolve();
    await core.destroy();
  });

  it('normalizes degenerate viewport bounds before registering with Rust', async () => {
    const transport = {
      call: jest.fn(() => Promise.resolve(undefined)),
    };
    const core = createStartedCore(transport as BridgeTransport);

    await core.registerViewportRegion('frozen-corner:sheet-1', 'sheet-1' as any, {
      startRow: 0,
      startCol: 0,
      endRow: 1,
      endCol: -1,
    });

    expect(transport.call).toHaveBeenCalledWith('compute_register_viewport', {
      docId: 'test-doc',
      viewportId: 'frozen-corner:sheet-1',
      sheetId: 'sheet-1',
      startRow: 0,
      startCol: 0,
      endRow: 1,
      endCol: 0,
    });
  });

  it('viewport release operations no-op during DESTROYING', async () => {
    const destroyDeferred = deferred<void>();
    const transport = {
      call: jest.fn((command: string) => {
        if (command === 'compute_destroy') return destroyDeferred.promise;
        return Promise.resolve(undefined);
      }),
    };
    const core = createStartedCore(transport as BridgeTransport);

    const destroyPromise = core.destroy();
    await core.unregisterViewportRegion('vp-1');
    await core.resetSheetViewportRegions('sheet-1' as any);

    expect(transport.call).not.toHaveBeenCalledWith(
      'compute_unregister_viewport',
      expect.anything(),
    );
    expect(transport.call).not.toHaveBeenCalledWith(
      'compute_reset_sheet_viewports',
      expect.anything(),
    );

    destroyDeferred.resolve();
    await destroyPromise;
  });

  it('DESTROYING takes precedence over module-trapped transport errors', async () => {
    const transport = {
      call: jest.fn(() => Promise.resolve(undefined)),
    };
    const core = createStartedCore(transport as BridgeTransport);
    (core as any)._moduleTrapped = new Error('module trapped');
    (core as any)._phase = 'DESTROYING';

    expect(() => core.transport.call('compute_get_viewport_binary', {})).toThrow(BridgeError);
  });

  it('skips compute_destroy when a newer instance superseded this one for the same docId', async () => {
    const docId = 'shared-doc-id';
    const transportA = {
      call: jest.fn((command: string) => {
        if (command === 'compute_init') return Promise.resolve({ sheets: [] });
        return Promise.resolve(undefined);
      }),
    };
    const transportB = {
      call: jest.fn((command: string) => {
        if (command === 'compute_init') return Promise.resolve({ sheets: [] });
        return Promise.resolve(undefined);
      }),
    };

    // Instance A inits — registers itself as active for docId
    const coreA = new ComputeCore(makeMockContext(), docId, transportA as BridgeTransport);
    await coreA.createEngine();

    // Instance B inits with the same docId — supersedes A in the registry
    const coreB = new ComputeCore(makeMockContext(), docId, transportB as BridgeTransport);
    await coreB.createEngine();

    // A's destroy should skip compute_destroy (it would kill B's instance)
    await coreA.destroy();
    expect(transportA.call).not.toHaveBeenCalledWith('compute_destroy', { docId });

    // B's destroy should proceed normally
    await coreB.destroy();
    expect(transportB.call).toHaveBeenCalledWith('compute_destroy', { docId });
  });
});
