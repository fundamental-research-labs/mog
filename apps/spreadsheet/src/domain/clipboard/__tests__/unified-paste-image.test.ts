/**
 * Tests for unifiedPaste image routing.
 *
 * Verifies that when the system clipboard contains image MIME types
 * (image/png, image/jpeg, etc.), unifiedPaste routes to the optional
 * `pasteImage` callback instead of dropping the data on the floor.
 *
 */

import { jest } from '@jest/globals';

import { EXTERNAL_SOURCE_SHEET_ID } from '@mog-sdk/contracts/actors';
import { unifiedPaste, type UnifiedPasteDeps } from '../unified-paste';
import type { CellCoord } from '@mog-sdk/contracts/rendering';

// =============================================================================
// FIXTURE: build a minimal ClipboardCommands stub
// =============================================================================

function makeCommands() {
  return {
    copy: jest.fn(),
    cut: jest.fn(),
    paste: jest.fn(),
    pasteSpecial: jest.fn(),
    externalPaste: jest.fn(),
    triggerCopy: jest.fn(),
    triggerCut: jest.fn(),
    triggerPaste: jest.fn(),
    showPastePreview: jest.fn(),
    hidePastePreview: jest.fn(),
    pasteComplete: jest.fn(),
    clear: jest.fn(),
    pasteWithOption: jest.fn(),
    editModeCopy: jest.fn(),
    cancelPaste: jest.fn(),
    tickMarchingAnts: jest.fn(),
  } as unknown as UnifiedPasteDeps['commands'];
}

function makeSnapshot() {
  // Empty internal clipboard — none of the routing tests touch internal data.
  return {
    context: { data: null, isCut: false },
    value: 'idle',
    matches: () => false,
  } as ReturnType<UnifiedPasteDeps['getClipboardSnapshot']>;
}

// =============================================================================
// MOCK: navigator.clipboard.read returning ClipboardItem-shaped objects
// =============================================================================

interface BlobLike {
  type: string;
  text(): Promise<string>;
}

interface ClipItemStub {
  types: string[];
  getType: (type: string) => Promise<BlobLike>;
}

/**
 * Build a Blob-shaped object with a guaranteed `.text()` implementation.
 * jsdom's Blob doesn't reliably implement `.text()` so we ship our own
 * to avoid the test depending on undefined polyfill behavior.
 */
function blobLike(text: string, type: string): BlobLike {
  return {
    type,
    text: async () => text,
  };
}

function imageBlobLike(type: string): BlobLike {
  return {
    type,
    // Image blobs aren't read as text by the paste loop. The text method
    // is present for shape symmetry; it would fail at runtime if called
    // but the production code only calls it for text/html and text/plain.
    text: async () => '',
  };
}

function makeClipItem(parts: Record<string, BlobLike>): ClipItemStub {
  return {
    types: Object.keys(parts),
    getType: async (type: string) => {
      const blob = parts[type];
      if (!blob) throw new Error(`no ${type}`);
      return blob;
    },
  };
}

function installClipboard(items: ClipItemStub[]) {
  Object.defineProperty(navigator, 'clipboard', {
    value: {
      read: jest.fn().mockImplementation(async () => items),
      readText: jest.fn().mockImplementation(async () => ''),
    },
    writable: true,
    configurable: true,
  });
}

// =============================================================================
// TESTS
// =============================================================================

const ACTIVE_CELL: CellCoord = { row: 4, col: 2 };

describe('unifiedPaste — image routing', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('routes image-only clipboard to pasteImage callback', async () => {
    const pngBlob = imageBlobLike('image/png');
    installClipboard([makeClipItem({ 'image/png': pngBlob })]);

    const pasteImage = jest.fn(async () => undefined);
    const commands = makeCommands();

    await unifiedPaste(ACTIVE_CELL, {
      getClipboardSnapshot: () => makeSnapshot(),
      commands,
      pasteImage: pasteImage as any,
    });

    expect(pasteImage).toHaveBeenCalledTimes(1);
    expect(pasteImage.mock.calls[0][0]).toBe(pngBlob);
    expect(pasteImage.mock.calls[0][1]).toEqual(ACTIVE_CELL);
    expect((commands as any).externalPaste).not.toHaveBeenCalled();
    expect((commands as any).paste).not.toHaveBeenCalled();
  });

  it('image-only clipboard with no pasteImage callback no-ops (no error)', async () => {
    const pngBlob = imageBlobLike('image/png');
    installClipboard([makeClipItem({ 'image/png': pngBlob })]);

    const commands = makeCommands();

    await expect(
      unifiedPaste(ACTIVE_CELL, {
        getClipboardSnapshot: () => makeSnapshot(),
        commands,
      }),
    ).resolves.toBeUndefined();

    expect((commands as any).externalPaste).not.toHaveBeenCalled();
    expect((commands as any).paste).not.toHaveBeenCalled();
  });

  it('clipboard with both image and text/HTML routes to text/HTML, not image', async () => {
    const pngBlob = imageBlobLike('image/png');
    const tsv = blobLike('A\tB\n1\t2', 'text/plain');
    const html = blobLike('<table><tr><td>A</td></tr></table>', 'text/html');
    installClipboard([
      makeClipItem({
        'image/png': pngBlob,
        'text/plain': tsv,
        'text/html': html,
      }),
    ]);

    const pasteImage = jest.fn(async () => undefined);
    const commands = makeCommands();

    await unifiedPaste(ACTIVE_CELL, {
      getClipboardSnapshot: () => makeSnapshot(),
      commands,
      pasteImage: pasteImage as any,
    });

    expect(pasteImage).not.toHaveBeenCalled();
    expect((commands as any).externalPaste).toHaveBeenCalledTimes(1);
    expect((commands as any).externalPaste).toHaveBeenCalledWith({
      text: 'A\tB\n1\t2',
      html: '<table><tr><td>A</td></tr></table>',
      targetCell: ACTIVE_CELL,
      options: expect.objectContaining({ values: false, formats: false, skipHiddenRows: true }),
    });
  });

  it('detects image/jpeg in addition to image/png', async () => {
    const jpegBlob = imageBlobLike('image/jpeg');
    installClipboard([makeClipItem({ 'image/jpeg': jpegBlob })]);

    const pasteImage = jest.fn(async () => undefined);

    await unifiedPaste(ACTIVE_CELL, {
      getClipboardSnapshot: () => makeSnapshot(),
      commands: makeCommands(),
      pasteImage: pasteImage as any,
    });

    expect(pasteImage).toHaveBeenCalledTimes(1);
    expect(pasteImage.mock.calls[0][0]).toBe(jpegBlob);
  });

  it('applies saved defaults to internal copy normal paste', async () => {
    installClipboard([makeClipItem({ 'text/plain': blobLike('A', 'text/plain') })]);
    const commands = makeCommands();

    await unifiedPaste(ACTIVE_CELL, {
      getClipboardSnapshot: () =>
        ({
          context: {
            isCut: false,
            data: {
              textSignature: 'A',
              sourceRanges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }],
              sourceSheetId: 'sheet-1',
              cells: { '0,0': { raw: 'A' } },
            },
          },
          matches: () => true,
        }) as any,
      commands,
      readPasteDefaultsPreference: () => ({
        version: 1,
        defaultPasteType: 'values',
        skipBlanks: true,
        transpose: false,
      }),
    });

    expect((commands as any).paste).not.toHaveBeenCalled();
    expect((commands as any).pasteSpecial).toHaveBeenCalledWith(
      ACTIVE_CELL,
      expect.objectContaining({ values: true, skipBlanks: true, skipHiddenRows: true }),
    );
  });

  it('forwards the selected target range captured before async clipboard read', async () => {
    installClipboard([makeClipItem({ 'text/plain': blobLike('A\tB\nC\tD', 'text/plain') })]);
    const commands = makeCommands();
    const targetRange = { startRow: 4, startCol: 2, endRow: 7, endCol: 5 };

    await unifiedPaste(ACTIVE_CELL, {
      getClipboardSnapshot: () =>
        ({
          context: {
            isCut: false,
            data: {
              textSignature: 'A\tB\nC\tD',
              sourceRanges: [{ startRow: 0, startCol: 0, endRow: 1, endCol: 1 }],
              sourceSheetId: 'sheet-1',
              cells: {
                '0,0': { raw: 'A' },
                '0,1': { raw: 'B' },
                '1,0': { raw: 'C' },
                '1,1': { raw: 'D' },
              },
            },
          },
          matches: () => true,
        }) as any,
      commands,
      getTargetRange: () => targetRange,
      readPasteDefaultsPreference: () => null,
    });

    expect((commands as any).paste).toHaveBeenCalledWith(
      ACTIVE_CELL,
      undefined,
      undefined,
      targetRange,
    );
  });

  it('preserves internal cut normal paste even when a saved default exists', async () => {
    installClipboard([makeClipItem({ 'text/plain': blobLike('A', 'text/plain') })]);
    const commands = makeCommands();

    await unifiedPaste(ACTIVE_CELL, {
      getClipboardSnapshot: () =>
        ({
          context: {
            isCut: true,
            data: {
              textSignature: 'A',
              sourceRanges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }],
              sourceSheetId: 'sheet-1',
              cells: { '0,0': { raw: 'A' } },
            },
          },
          matches: () => true,
        }) as any,
      commands,
      readPasteDefaultsPreference: () => ({
        version: 1,
        defaultPasteType: 'formats',
        skipBlanks: false,
        transpose: false,
      }),
    });

    expect((commands as any).paste).toHaveBeenCalledWith(ACTIVE_CELL);
    expect((commands as any).pasteSpecial).not.toHaveBeenCalled();
  });

  it('routes changed system clipboard text through external paste', async () => {
    installClipboard([makeClipItem({ 'text/plain': blobLike('system-only', 'text/plain') })]);
    const commands = makeCommands();

    await unifiedPaste(ACTIVE_CELL, {
      getClipboardSnapshot: () =>
        ({
          context: {
            isCut: false,
            data: {
              textSignature: 'Hello World',
              sourceRanges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }],
              sourceSheetId: 'sheet-1',
              cells: { '0,0': { raw: 'Hello World' } },
            },
          },
          matches: () => true,
        }) as any,
      commands,
    });

    expect((commands as any).paste).not.toHaveBeenCalled();
    expect((commands as any).externalPaste).toHaveBeenCalledWith({
      text: 'system-only',
      targetCell: ACTIVE_CELL,
      html: undefined,
      options: expect.objectContaining({ values: false, formats: false, skipHiddenRows: true }),
    });
  });

  it('keeps fresh internal clipboard when exported HTML has no cells', async () => {
    installClipboard([
      makeClipItem({
        'text/html': blobLike('<table><tbody><tr></tr></tbody></table>', 'text/html'),
      }),
    ]);
    const commands = makeCommands();

    await unifiedPaste(ACTIVE_CELL, {
      getClipboardSnapshot: () =>
        ({
          context: {
            isCut: false,
            isStale: false,
            data: {
              textSignature: '',
              sourceRanges: [{ startRow: 6, startCol: 27, endRow: 6, endCol: 27 }],
              sourceSheetId: 'sheet-1',
              cells: {
                '0,0': { raw: '103,188 ', formula: '=407039-AA7-Z7-Y7' },
              },
            },
          },
          matches: () => true,
        }) as any,
      commands,
      readPasteDefaultsPreference: () => null,
    });

    expect((commands as any).paste).toHaveBeenCalledWith(ACTIVE_CELL);
    expect((commands as any).externalPaste).not.toHaveBeenCalled();
  });

  it('no-ops external plain text when the saved default is formats only', async () => {
    installClipboard([makeClipItem({ 'text/plain': blobLike('A', 'text/plain') })]);
    const commands = makeCommands();

    await unifiedPaste(ACTIVE_CELL, {
      getClipboardSnapshot: () =>
        ({
          context: {
            isCut: false,
            data: {
              textSignature: 'different',
              sourceRanges: [],
              sourceSheetId: EXTERNAL_SOURCE_SHEET_ID,
              cells: {},
            },
          },
          matches: () => true,
        }) as any,
      commands,
      readPasteDefaultsPreference: () => ({
        version: 1,
        defaultPasteType: 'formats',
        skipBlanks: false,
        transpose: false,
      }),
    });

    expect((commands as any).externalPaste).not.toHaveBeenCalled();
    expect((commands as any).paste).not.toHaveBeenCalled();
  });

  it('suppresses canceled internal clipboard text instead of pasting it as external text', async () => {
    installClipboard([makeClipItem({ 'text/plain': blobLike('One\tTwo', 'text/plain') })]);
    const commands = makeCommands();
    const suppressNextUndo = jest.fn();

    await unifiedPaste(ACTIVE_CELL, {
      getClipboardSnapshot: () =>
        ({
          context: {
            isCut: false,
            data: null,
            suppressedTextSignature: 'One\tTwo',
          },
          matches: () => false,
        }) as any,
      commands,
      suppressNextUndo,
    });

    expect((commands as any).externalPaste).not.toHaveBeenCalled();
    expect((commands as any).paste).not.toHaveBeenCalled();
    expect(suppressNextUndo).toHaveBeenCalledTimes(1);
  });
});
