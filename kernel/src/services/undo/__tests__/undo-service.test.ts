import { jest } from '@jest/globals';

import { createUndoService } from '../undo-service';

function createComputeBridgeMock() {
  const withPivotUpdateOptions = jest.fn(async (_options, fn: () => Promise<unknown>) => fn());
  const bridge = {
    undo: jest.fn(async () => undefined),
    redo: jest.fn(async () => undefined),
    getUndoState: jest.fn(async () => ({
      canUndo: true,
      canRedo: true,
      undoDepth: 1,
      redoDepth: 1,
    })),
    getMutationHandler: jest.fn(() => ({
      withPivotUpdateOptions,
    })),
    forceRefreshAllViewports: jest.fn(async () => undefined),
  };
  return { bridge, withPivotUpdateOptions };
}

async function flushInitialState(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('UndoService pivot history replay metadata', () => {
  it('wraps undo in historyReplay pivot update options', async () => {
    const { bridge, withPivotUpdateOptions } = createComputeBridgeMock();
    const service = createUndoService(bridge as any);
    await flushInitialState();

    const result = await service.undo();

    expect(result.ok).toBe(true);
    expect(bridge.undo).toHaveBeenCalledTimes(1);
    expect(withPivotUpdateOptions).toHaveBeenCalledWith(
      { reason: 'historyReplay', refreshPolicy: 'refreshAndMaterialize' },
      expect.any(Function),
    );
    expect(bridge.forceRefreshAllViewports).not.toHaveBeenCalled();
  });

  it('wraps redo in historyReplay pivot update options', async () => {
    const { bridge, withPivotUpdateOptions } = createComputeBridgeMock();
    const service = createUndoService(bridge as any);
    await flushInitialState();

    const result = await service.redo();

    expect(result.ok).toBe(true);
    expect(bridge.redo).toHaveBeenCalledTimes(1);
    expect(withPivotUpdateOptions).toHaveBeenCalledWith(
      { reason: 'historyReplay', refreshPolicy: 'refreshAndMaterialize' },
      expect.any(Function),
    );
    expect(bridge.forceRefreshAllViewports).not.toHaveBeenCalled();
  });

  it('does not issue a service-level viewport refresh after replay', async () => {
    const { bridge } = createComputeBridgeMock();
    bridge.forceRefreshAllViewports.mockRejectedValueOnce(new Error('refresh failed'));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const service = createUndoService(bridge as any);
    await flushInitialState();

    const result = await service.undo();

    expect(result.ok).toBe(true);
    expect(bridge.undo).toHaveBeenCalledTimes(1);
    expect(bridge.forceRefreshAllViewports).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});
