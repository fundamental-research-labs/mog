import { jest } from '@jest/globals';

import type { ActionDependencies, AsyncActionHandler } from '@mog-sdk/contracts/actions';
import type { PasteSpecialOptions } from '@mog-sdk/contracts/actors';

import {
  CLEAR_CLIPBOARD,
  PASTE,
  PASTE_FORMATTING,
  PASTE_FORMULAS,
  PASTE_LINK,
  PASTE_TRANSPOSE,
  PASTE_VALUES,
} from '../clipboard-paste';
import { trackPendingClipboardPaste } from '../../../systems/grid-editing/coordination/pending-clipboard-paste';

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function resetClipboardPasteGlobals(): void {
  delete (globalThis as { __MOG_PENDING_CLIPBOARD_PASTE__?: unknown })
    .__MOG_PENDING_CLIPBOARD_PASTE__;
  delete (globalThis as { __MOG_ACTIVE_CLIPBOARD_PASTE__?: unknown })
    .__MOG_ACTIVE_CLIPBOARD_PASTE__;
}

function createClipboardState() {
  return {
    context: {
      sourceRanges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }],
      data: {
        sourceSheetId: 'sheet1',
        sourceRanges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }],
        cells: { '0,0': { raw: 'A' } },
        textSignature: 'A',
      },
      isCut: false,
      pastePreviewTarget: null,
      marchingAntsPhase: 0,
      errorMessage: null,
      pasteOptions: null,
      skipSizeCheck: false,
      isStale: false,
      suppressedTextSignature: null,
    },
    matches: (state: string) => state === 'hasCopy',
  };
}

function createDeps(): {
  deps: ActionDependencies;
  clipboardCommands: {
    clear: jest.Mock;
    paste: jest.Mock;
    pasteSpecial: jest.Mock;
    showPastePreview: jest.Mock;
    hidePastePreview: jest.Mock;
  };
  selectionCommands: { exitAllModes: jest.Mock };
} {
  const clipboardCommands = {
    clear: jest.fn(),
    paste: jest.fn(),
    pasteSpecial: jest.fn(),
    showPastePreview: jest.fn(),
    hidePastePreview: jest.fn(),
  };
  const selectionCommands = {
    exitAllModes: jest.fn(),
    cancelResize: jest.fn(),
  };
  const uiState = {
    announce: jest.fn(),
    hasChartInClipboard: jest.fn(() => false),
    suppressNextUndo: jest.fn(),
  };

  const deps = {
    getActiveSheetId: jest.fn(() => 'sheet1'),
    workbook: {
      getSheetById: jest.fn(() => ({
        pictures: { add: jest.fn() },
      })),
    },
    uiStore: {
      getState: () => uiState,
    },
    accessors: {
      editor: {
        isEditing: jest.fn(() => false),
        isImeComposing: jest.fn(() => false),
      },
      selection: {
        getActiveCell: jest.fn(() => ({ row: 2, col: 3 })),
        getRanges: jest.fn(() => [{ startRow: 2, startCol: 3, endRow: 2, endCol: 3 }]),
        isResizingHeader: jest.fn(() => false),
      },
      clipboard: {
        getSnapshot: jest.fn(createClipboardState),
      },
    },
    commands: {
      clipboard: clipboardCommands,
      selection: selectionCommands,
    },
  } as unknown as ActionDependencies;

  return { deps, clipboardCommands, selectionCommands };
}

async function expectClearDeferredUntilPasteSettles(args: {
  handler: AsyncActionHandler;
  expectedSpecialOptions?: PasteSpecialOptions;
  expectedCommand?: 'paste' | 'pasteSpecial';
}): Promise<void> {
  const pasteCommit = createDeferred();
  trackPendingClipboardPaste(pasteCommit.promise);
  const { deps, clipboardCommands, selectionCommands } = createDeps();

  const pasteResult = args.handler(deps);
  expect(CLEAR_CLIPBOARD(deps)).toEqual({ handled: true });

  expect(selectionCommands.exitAllModes).toHaveBeenCalledTimes(1);
  expect(clipboardCommands.clear).not.toHaveBeenCalled();

  await flushAsync();

  if (args.expectedCommand === 'pasteSpecial') {
    expect(clipboardCommands.pasteSpecial).toHaveBeenCalledWith(
      { row: 2, col: 3 },
      args.expectedSpecialOptions,
      undefined,
      undefined,
      { startRow: 2, startCol: 3, endRow: 2, endCol: 3 },
    );
  } else if (args.expectedCommand === 'paste') {
    expect(clipboardCommands.paste).toHaveBeenCalledWith({ row: 2, col: 3 }, undefined, undefined, {
      startRow: 2,
      startCol: 3,
      endRow: 2,
      endCol: 3,
    });
  } else {
    expect(
      clipboardCommands.paste.mock.calls.length + clipboardCommands.pasteSpecial.mock.calls.length,
    ).toBe(1);
  }
  expect(clipboardCommands.clear).not.toHaveBeenCalled();

  pasteCommit.resolve();
  await pasteResult;
  await flushAsync();

  expect(clipboardCommands.clear).toHaveBeenCalledTimes(1);
}

describe('clipboard paste action tracking', () => {
  let originalClipboardDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    resetClipboardPasteGlobals();
    originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
  });

  afterEach(() => {
    resetClipboardPasteGlobals();
    if (originalClipboardDescriptor) {
      Object.defineProperty(navigator, 'clipboard', originalClipboardDescriptor);
    } else {
      delete (navigator as { clipboard?: unknown }).clipboard;
    }
  });

  test.each([
    ['default paste', PASTE, undefined],
    ['paste values', PASTE_VALUES, { values: true }],
    ['paste formulas', PASTE_FORMULAS, { formulas: true }],
    ['paste formatting', PASTE_FORMATTING, { formats: true }],
    ['paste transpose', PASTE_TRANSPOSE, { transpose: true }],
    ['paste link', PASTE_LINK, { pasteLink: true }],
  ] as const)(
    'defers Escape clipboard clear until %s settles',
    async (_label, handler, options) => {
      await expectClearDeferredUntilPasteSettles({
        handler,
        expectedSpecialOptions: options,
        expectedCommand: options ? 'pasteSpecial' : undefined,
      });
    },
  );
});
