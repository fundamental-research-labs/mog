import { jest } from '@jest/globals';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';
import { ENTER_NAVIGATE } from '../tab-enter';
import { trackPendingClipboardPaste } from '../../../../systems/grid-editing/coordination/pending-clipboard-paste';

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

describe('ENTER_NAVIGATE clipboard behavior', () => {
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

  it('publishes an active paste barrier until Enter-paste commits and clears copy state', async () => {
    const pasteCommit = createDeferred();
    const clipboardCommands = {
      clear: jest.fn(),
      paste: jest.fn(() => trackPendingClipboardPaste(pasteCommit.promise)),
      pasteSpecial: jest.fn(() => trackPendingClipboardPaste(pasteCommit.promise)),
      showPastePreview: jest.fn(),
      hidePastePreview: jest.fn(),
    };
    const selectionCommands = {
      keyEnter: jest.fn(),
    };
    const deps = {
      accessors: {
        clipboard: {
          hasCopy: jest.fn(() => true),
          getSnapshot: jest.fn(createClipboardState),
        },
        selection: {
          getActiveCell: jest.fn(() => ({ row: 2, col: 3 })),
        },
      },
      commands: {
        clipboard: clipboardCommands,
        selection: selectionCommands,
      },
    } as unknown as ActionDependencies;

    const result = ENTER_NAVIGATE(deps);
    await flushAsync();

    expect(
      (globalThis as { __MOG_ACTIVE_CLIPBOARD_PASTE__?: Promise<unknown> })
        .__MOG_ACTIVE_CLIPBOARD_PASTE__,
    ).toBeDefined();
    expect(selectionCommands.keyEnter).not.toHaveBeenCalled();
    expect(
      clipboardCommands.paste.mock.calls.length + clipboardCommands.pasteSpecial.mock.calls.length,
    ).toBe(1);
    expect(clipboardCommands.clear).not.toHaveBeenCalled();

    pasteCommit.resolve();
    await result;
    await flushAsync();

    expect(clipboardCommands.clear).toHaveBeenCalledTimes(1);
  });
});
