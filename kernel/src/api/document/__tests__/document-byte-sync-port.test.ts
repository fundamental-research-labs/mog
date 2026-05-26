import { jest } from '@jest/globals';
import { _createDocumentHandleInternal } from '../document-factory';
import type { ISpreadsheetKernelContext } from '@mog-sdk/contracts/kernel';
import type { SheetId } from '@mog-sdk/contracts/core';

function createBridge(label: number) {
  return {
    syncApply: jest.fn(async () => ({ recalc: { changedCells: [] } })),
    encodeDiff: jest.fn(async () => new Uint8Array([label, 2])),
    currentStateVector: jest.fn(async () => new Uint8Array([label])),
  };
}

function createHandleFixture() {
  let bridge = createBridge(1);
  const lifecycle = {
    initialSheetId: 'sheet-1' as SheetId,
    get computeBridge() {
      return bridge;
    },
    setComputeBridge(next: typeof bridge) {
      bridge = next;
    },
    dispose: jest.fn(async () => undefined),
  };
  const context = {
    eventBus: {},
    services: {},
  } as ISpreadsheetKernelContext;

  const handle = _createDocumentHandleInternal('doc-byte-sync', lifecycle as never, context);

  return { handle, lifecycle, bridge };
}

describe('DocumentHandle.createSyncPort', () => {
  it('returns one stable document byte-sync port', () => {
    const { handle } = createHandleFixture();

    const first = handle.createSyncPort();
    const second = handle.createSyncPort();

    expect(first).toBe(second);
    expect(first.docId).toBe('doc-byte-sync');
  });

  it('delegates through the current lifecycle bridge lazily', async () => {
    const { handle, lifecycle, bridge } = createHandleFixture();
    const port = handle.createSyncPort();

    await expect(port.currentStateVector()).resolves.toEqual(new Uint8Array([1]));
    await expect(port.encodeDiff(new Uint8Array([9]))).resolves.toEqual(new Uint8Array([1, 2]));
    await expect(port.applyUpdate(new Uint8Array([7]))).resolves.toBeUndefined();
    expect(bridge.currentStateVector).toHaveBeenCalledTimes(1);
    expect(bridge.encodeDiff).toHaveBeenCalledWith(new Uint8Array([9]));
    expect(bridge.syncApply).toHaveBeenCalledWith(new Uint8Array([7]));

    const recoveredBridge = createBridge(3);
    lifecycle.setComputeBridge(recoveredBridge);

    await expect(port.currentStateVector()).resolves.toEqual(new Uint8Array([3]));
    expect(recoveredBridge.currentStateVector).toHaveBeenCalledTimes(1);
  });

  it('guards creation and use after handle disposal', async () => {
    const { handle } = createHandleFixture();
    const port = handle.createSyncPort();

    await handle.dispose();

    expect(() => handle.createSyncPort()).toThrow(
      'DocumentHandle.createSyncPort: handle is disposed',
    );
    await expect(port.applyUpdate(new Uint8Array([1]))).rejects.toThrow(
      'DocumentHandle.syncPort.applyUpdate: handle is disposed',
    );
    expect(() => port.encodeDiff(new Uint8Array([1]))).toThrow(
      'DocumentHandle.syncPort.encodeDiff: handle is disposed',
    );
    expect(() => port.currentStateVector()).toThrow(
      'DocumentHandle.syncPort.currentStateVector: handle is disposed',
    );
  });
});
