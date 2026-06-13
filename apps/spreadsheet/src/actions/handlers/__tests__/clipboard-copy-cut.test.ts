import { jest } from '@jest/globals';

import type { ActionDependencies, ActionHandler } from '@mog-sdk/contracts/actions';
import type { ClipboardData } from '@mog-sdk/contracts/actors';

import { COPY, CUT } from '../clipboard';
import { waitForPendingClipboardCapture } from '../../../systems/grid-editing/coordination/pending-clipboard-capture';

if (typeof globalThis.ClipboardItem === 'undefined') {
  (globalThis as any).ClipboardItem = class ClipboardItem {
    readonly types: string[];
    private items: Record<string, Blob | Promise<Blob>>;

    constructor(items: Record<string, Blob | Promise<Blob>>) {
      this.items = items;
      this.types = Object.keys(items);
    }

    async getType(type: string): Promise<Blob> {
      return this.items[type] as Blob;
    }
  };
}

type ClipboardCommand = 'copy' | 'cut';

function resetClipboardCaptureGlobal(): void {
  delete (globalThis as { __MOG_PENDING_CLIPBOARD_CAPTURE__?: unknown })
    .__MOG_PENDING_CLIPBOARD_CAPTURE__;
}

function createDeps({
  hiddenRows = [],
  hiddenCols = [],
}: {
  hiddenRows?: number[];
  hiddenCols?: number[];
} = {}) {
  const clipboardCommands = {
    copy: jest.fn(),
    cut: jest.fn(),
  };
  const selectionRange = { startRow: 10, startCol: 0, endRow: 10, endCol: 2 };
  const ws = {
    getUsedRange: jest.fn().mockResolvedValue(selectionRange),
    getRange: jest.fn().mockResolvedValue([
      [
        { value: 'Alpha', formatted: 'Alpha' },
        { value: 'Beta', formatted: 'Beta' },
        { value: 'Gamma', formatted: 'Gamma' },
      ],
    ]),
    structure: {
      getMergedRegions: jest.fn().mockResolvedValue([]),
    },
    layout: {
      isRowHidden: jest.fn(async (row: number) => hiddenRows.includes(row)),
      isColumnHidden: jest.fn(async (col: number) => hiddenCols.includes(col)),
    },
    formats: {
      get: jest.fn().mockResolvedValue(undefined),
    },
    _internal: {
      getRangeSchemas: jest.fn().mockResolvedValue([]),
    },
    conditionalFormats: {
      list: jest.fn().mockResolvedValue([]),
    },
    comments: {
      getForCell: jest.fn().mockResolvedValue([]),
    },
  };

  const deps = {
    getActiveSheetId: jest.fn(() => 'sheet1'),
    workbook: {
      getSheetById: jest.fn(() => ws),
    },
    uiStore: {
      getState: () => ({
        announce: jest.fn(),
      }),
    },
    accessors: {
      editor: {
        isEditing: jest.fn(() => false),
        isImeComposing: jest.fn(() => false),
      },
      selection: {
        getRanges: jest.fn(() => [selectionRange]),
      },
    },
    commands: {
      clipboard: clipboardCommands,
    },
  } as unknown as ActionDependencies;

  return { deps, clipboardCommands };
}

async function runClipboardAction(
  action: ActionHandler,
  command: ClipboardCommand,
  deps: ActionDependencies,
  clipboardCommands: Record<ClipboardCommand, jest.Mock>,
): Promise<ClipboardData> {
  expect(action(deps)).toEqual({ handled: true });
  await waitForPendingClipboardCapture();

  const commandMock = clipboardCommands[command];
  expect(commandMock).toHaveBeenCalledTimes(1);
  return commandMock.mock.calls[0][1] as ClipboardData;
}

describe('clipboard copy/cut actions', () => {
  beforeEach(() => {
    resetClipboardCaptureGlobal();
    const mockWrite = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write: mockWrite },
    });
  });

  afterEach(() => {
    resetClipboardCaptureGlobal();
    jest.restoreAllMocks();
  });

  describe.each([
    ['copy', COPY, 'copy'],
    ['cut', CUT, 'cut'],
  ] as const)('%s', (_label, action, command) => {
    it('serializes selected hidden rows into system clipboard text', async () => {
      const { deps, clipboardCommands } = createDeps({ hiddenRows: [10] });

      const data = await runClipboardAction(action, command, deps, clipboardCommands);

      expect(data.textSignature).toBe('Alpha\tBeta\tGamma');
      expect(Object.keys(data.cells)).toEqual(['0,0', '0,1', '0,2']);
    });

    it('serializes selected hidden columns into system clipboard text', async () => {
      const { deps, clipboardCommands } = createDeps({ hiddenCols: [1] });

      const data = await runClipboardAction(action, command, deps, clipboardCommands);

      expect(data.textSignature).toBe('Alpha\tBeta\tGamma');
      expect(Object.keys(data.cells)).toEqual(['0,0', '0,1', '0,2']);
    });
  });
});
