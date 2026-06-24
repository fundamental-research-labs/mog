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
  filterHiddenRows = [],
  filterSummaries = [],
  selectionRange = { startRow: 10, startCol: 0, endRow: 10, endCol: 2 },
  rangeData = [
    [
      { value: 'Alpha', formatted: 'Alpha' },
      { value: 'Beta', formatted: 'Beta' },
      { value: 'Gamma', formatted: 'Gamma' },
    ],
  ],
  mergedRegions = [],
  formatByCell = new Map<string, unknown>(),
}: {
  hiddenRows?: number[];
  hiddenCols?: number[];
  filterHiddenRows?: number[];
  filterSummaries?: Array<{
    id: string;
    filterKind: 'autoFilter';
    range: { startRow: number; startCol: number; endRow: number; endCol: number };
    activeColumnCount: number;
    hasActiveCriteria: boolean;
  }>;
  selectionRange?: { startRow: number; startCol: number; endRow: number; endCol: number };
  rangeData?: Array<Array<{ value?: unknown; formatted?: string; formula?: string } | undefined>>;
  mergedRegions?: Array<{ startRow: number; startCol: number; endRow: number; endCol: number }>;
  formatByCell?: Map<string, unknown>;
} = {}) {
  const clipboardCommands = {
    copy: jest.fn(),
    cut: jest.fn(),
  };
  const ws = {
    getUsedRange: jest.fn().mockResolvedValue(selectionRange),
    getRange: jest.fn().mockResolvedValue(rangeData),
    structure: {
      getMergedRegions: jest.fn().mockResolvedValue(mergedRegions),
    },
    layout: {
      isRowHidden: jest.fn(async (row: number) => hiddenRows.includes(row)),
      isColumnHidden: jest.fn(async (col: number) => hiddenCols.includes(col)),
      getFilterHiddenRowsBitmap: jest.fn(async () => new Set(filterHiddenRows)),
    },
    filters: {
      listSummaries: jest.fn().mockResolvedValue(filterSummaries),
    },
    formats: {
      get: jest.fn(async (row: number, col: number) => formatByCell.get(`${row},${col}`)),
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

async function readSystemClipboardPayload(): Promise<{ text: string; html: string }> {
  const writeMock = navigator.clipboard.write as jest.Mock;
  expect(writeMock).toHaveBeenCalledTimes(1);
  const item = writeMock.mock.calls[0][0][0] as ClipboardItem;
  const [textBlob, htmlBlob] = await Promise.all([
    item.getType('text/plain'),
    item.getType('text/html'),
  ]);
  return {
    text: await blobToText(textBlob),
    html: await blobToText(htmlBlob),
  };
}

function blobToText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') {
    return blob.text();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
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

    it('skips rows hidden by active filters while preserving manual hidden copy semantics', async () => {
      const { deps, clipboardCommands } = createDeps({
        selectionRange: { startRow: 0, startCol: 0, endRow: 4, endCol: 1 },
        hiddenRows: [1],
        filterHiddenRows: [2, 4],
        filterSummaries: [
          {
            id: 'filter-1',
            filterKind: 'autoFilter',
            range: { startRow: 0, startCol: 0, endRow: 4, endCol: 1 },
            activeColumnCount: 1,
            hasActiveCriteria: true,
          },
        ],
        rangeData: [
          [
            { value: 'Name', formatted: 'Name' },
            { value: 'Status', formatted: 'Status' },
          ],
          [
            { value: 'Manual', formatted: 'Manual' },
            { value: 'hidden but selected', formatted: 'hidden but selected' },
          ],
          [
            { value: 'Filtered', formatted: 'Filtered' },
            { value: 'hide', formatted: 'hide' },
          ],
          [
            { value: 'Visible', formatted: 'Visible' },
            { value: 'keep', formatted: 'keep' },
          ],
          [
            { value: 'Filtered 2', formatted: 'Filtered 2' },
            { value: 'hide', formatted: 'hide' },
          ],
        ],
      });

      const data = await runClipboardAction(action, command, deps, clipboardCommands);
      const systemClipboard = await readSystemClipboardPayload();

      expect(systemClipboard.text).toBe('Name\tStatus\nManual\thidden but selected\nVisible\tkeep');
      expect(data.textSignature).toBe(systemClipboard.text);
      expect(Object.values(data.cells).map((cell) => cell.raw)).toEqual([
        'Name',
        'Status',
        'Manual',
        'hidden but selected',
        'Visible',
        'keep',
      ]);
    });

    it('preserves all selected rows when filter-hidden rows are outside the copied columns', async () => {
      const { deps, clipboardCommands } = createDeps({
        selectionRange: { startRow: 1, startCol: 3, endRow: 3, endCol: 3 },
        filterHiddenRows: [2, 4],
        filterSummaries: [
          {
            id: 'filter-1',
            filterKind: 'autoFilter',
            range: { startRow: 0, startCol: 0, endRow: 5, endCol: 1 },
            activeColumnCount: 1,
            hasActiveCriteria: true,
          },
        ],
        rangeData: [
          [{ value: 's1', formatted: 's1' }],
          [{ value: 's2', formatted: 's2' }],
          [{ value: 's3', formatted: 's3' }],
        ],
      });

      const data = await runClipboardAction(action, command, deps, clipboardCommands);
      const systemClipboard = await readSystemClipboardPayload();

      expect(systemClipboard.text).toBe('s1\ns2\ns3');
      expect(data.textSignature).toBe(systemClipboard.text);
      expect(Object.values(data.cells).map((cell) => cell.raw)).toEqual(['s1', 's2', 's3']);
    });

    it('serializes merged covered cells as blank TSV fields', async () => {
      const { deps, clipboardCommands } = createDeps({
        selectionRange: { startRow: 0, startCol: 0, endRow: 0, endCol: 1 },
        rangeData: [
          [
            { value: 'Merged', formatted: 'Merged' },
            { value: 'Merged', formatted: 'Merged' },
          ],
        ],
        mergedRegions: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 1 }],
      });

      const data = await runClipboardAction(action, command, deps, clipboardCommands);
      const systemClipboard = await readSystemClipboardPayload();

      expect(systemClipboard.text).toBe('Merged\t');
      expect(data.textSignature).toBe('Merged\t');
      expect(systemClipboard.html).toContain('colspan="2"');
    });

    it('serializes fetched cell formats into rich HTML', async () => {
      const { deps, clipboardCommands } = createDeps({
        selectionRange: { startRow: 0, startCol: 0, endRow: 0, endCol: 0 },
        rangeData: [[{ value: 'Styled', formatted: 'Styled' }]],
        formatByCell: new Map([
          ['0,0', { bold: true, backgroundColor: '#ffff00', fontColor: '#ff0000' }],
        ]),
      });

      const data = await runClipboardAction(action, command, deps, clipboardCommands);
      const systemClipboard = await readSystemClipboardPayload();

      expect(systemClipboard.html).toContain('font-weight:bold');
      expect(systemClipboard.html).toContain('background-color:#ffff00');
      expect(systemClipboard.html).toContain('color:#ff0000');
      expect(data.cells['0,0']?.format).toEqual({
        bold: true,
        backgroundColor: '#ffff00',
        fontColor: '#ff0000',
      });
    });
  });
});
