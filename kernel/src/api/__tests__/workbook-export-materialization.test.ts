import { jest } from '@jest/globals';

import {
  installWorksheetImplEsmMocks,
  worksheetCheckpointMock,
} from './helpers/worksheet-impl-esm-mocks';

installWorksheetImplEsmMocks();

const { NO_HOST_OPERATION_GATE } = await import('../../document/host-operation-gate');
const { WorkbookImpl } = await import('../workbook/workbook-impl');

function createMockEventBus() {
  return {
    on: jest.fn().mockReturnValue(jest.fn()),
    onAll: jest.fn().mockReturnValue(jest.fn()),
    onMany: jest.fn(),
    emit: jest.fn(),
    emitBatch: jest.fn(),
    clear: jest.fn(),
  };
}

function createMockUndoService() {
  return {
    undo: jest.fn().mockResolvedValue({ ok: true, value: undefined }),
    redo: jest.fn().mockResolvedValue({ ok: true, value: undefined }),
    canUndo: jest.fn().mockReturnValue(false),
    canRedo: jest.fn().mockReturnValue(false),
    subscribe: jest.fn().mockReturnValue(Object.assign(() => {}, { dispose: () => {} })),
    setNextDescription: jest.fn(),
    notifyForwardMutation: jest.fn(),
    getState: jest.fn().mockReturnValue({
      canUndo: false,
      canRedo: false,
      undoStackSize: 0,
      redoStackSize: 0,
      nextUndoDescription: null,
      nextRedoDescription: null,
    }),
    getNextUndoDescription: jest.fn().mockReturnValue(null),
    getNextRedoDescription: jest.fn().mockReturnValue(null),
    clear: jest.fn(),
    stopCapturing: jest.fn(),
    dispose: jest.fn(),
  };
}

describe('WorkbookImpl XLSX export materialization', () => {
  beforeEach(() => {
    worksheetCheckpointMock.createCheckpointManager.mockReturnValue({
      clear: jest.fn(),
      dispose: jest.fn(),
    });
  });

  it('awaits full workbook materialization before exporting XLSX bytes', async () => {
    const bytes = new Uint8Array([
      0x50, 0x4b, 0x05, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    const exportToXlsxBytes = jest.fn().mockResolvedValue(bytes);
    const awaitMaterialized = jest.fn().mockResolvedValue(undefined);
    const eventBus = createMockEventBus();
    const ctx = {
      computeBridge: {
        exportToXlsxBytes,
      },
      eventBus,
      writeGate: {
        assertWritable: jest.fn(),
        captureHighWaterMark: jest.fn(),
      },
      operationGate: NO_HOST_OPERATION_GATE,
      services: {
        undo: createMockUndoService(),
      },
      floatingObjectManager: {
        setPositionLookup: jest.fn(),
        dispose: jest.fn(),
      },
      awaitMaterialized,
    };

    const workbook = new WorkbookImpl({ ctx, eventBus } as any);

    await expect(workbook.toXlsx()).resolves.toBe(bytes);
    expect(awaitMaterialized).toHaveBeenCalledWith('allSheets');
    expect(exportToXlsxBytes).toHaveBeenCalledTimes(1);

    workbook.dispose();
  });
});
