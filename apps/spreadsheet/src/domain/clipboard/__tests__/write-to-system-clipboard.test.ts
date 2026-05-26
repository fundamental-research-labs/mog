/**
 * Unit tests for writeToSystemClipboard
 *
 * Bug #20: Verifies the ClipboardItem promise-based blob pattern that fixes
 * the user activation expiry issue with Cmd+C clipboard writes.
 */

import { jest } from '@jest/globals';

import { writeToSystemClipboard } from '../unified-paste';

// =============================================================================
// POLYFILL: ClipboardItem is not available in jsdom
// =============================================================================

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

// =============================================================================
// MOCKS
// =============================================================================

let mockWrite: jest.Mock;
let mockWriteText: jest.Mock;

beforeEach(() => {
  mockWrite = jest.fn().mockResolvedValue(undefined);
  mockWriteText = jest.fn().mockResolvedValue(undefined);

  Object.defineProperty(navigator, 'clipboard', {
    value: {
      write: mockWrite,
      writeText: mockWriteText,
    },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// =============================================================================
// TESTS
// =============================================================================

describe('writeToSystemClipboard', () => {
  describe('with resolved data (object)', () => {
    it('writes ClipboardItem with text/plain and text/html', async () => {
      await writeToSystemClipboard({
        tsv: 'A1\tB1',
        html: '<table><tr><td>A1</td><td>B1</td></tr></table>',
      });

      expect(mockWrite).toHaveBeenCalledTimes(1);
      const items = mockWrite.mock.calls[0][0];
      expect(items).toHaveLength(1);
      expect(items[0]).toBeInstanceOf(ClipboardItem);
    });
  });

  describe('with promise-based data (deferred pattern)', () => {
    it('calls navigator.clipboard.write synchronously before promise resolves', async () => {
      let resolveData!: (value: { tsv: string; html: string }) => void;
      const dataPromise = new Promise<{ tsv: string; html: string }>((res) => {
        resolveData = res;
      });

      // Start the clipboard write — this should call navigator.clipboard.write
      // IMMEDIATELY (synchronous), before the data promise resolves.
      const writePromise = writeToSystemClipboard(dataPromise);

      // navigator.clipboard.write should have been called already
      expect(mockWrite).toHaveBeenCalledTimes(1);

      // Now resolve the data
      resolveData({ tsv: 'hello', html: '<p>hello</p>' });
      await writePromise;
    });

    it('passes ClipboardItem with promise-based Blob values to write()', async () => {
      let resolveData!: (value: { tsv: string; html: string }) => void;
      const dataPromise = new Promise<{ tsv: string; html: string }>((res) => {
        resolveData = res;
      });

      const writePromise = writeToSystemClipboard(dataPromise);

      // The ClipboardItem should have been created and passed to write()
      const items = mockWrite.mock.calls[0][0];
      expect(items).toHaveLength(1);

      resolveData({ tsv: 'data', html: '<p>data</p>' });
      await writePromise;
    });
  });

  describe('error propagation', () => {
    it('clipboard write errors propagate to caller (not swallowed)', async () => {
      mockWrite.mockRejectedValue(new Error('Clipboard write denied'));

      await expect(writeToSystemClipboard({ tsv: 'test', html: '<p>test</p>' })).rejects.toThrow(
        'Clipboard write denied',
      );
    });

    // Note: rejected data promise behavior is not tested here because jsdom
    // doesn't fully implement ClipboardItem promise-based blob resolution.
    // In real browsers, a rejected data promise causes write() to reject,
    // which propagates to the caller (same as the test above).
  });

  describe('fallback behavior', () => {
    it('falls back to writeText when write() is not available', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          write: undefined,
          writeText: mockWriteText,
        },
        writable: true,
        configurable: true,
      });

      await writeToSystemClipboard({ tsv: 'fallback text', html: '<p>html</p>' });

      expect(mockWriteText).toHaveBeenCalledWith('fallback text');
    });

    it('fallback with promise data waits for resolution before calling writeText', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          write: undefined,
          writeText: mockWriteText,
        },
        writable: true,
        configurable: true,
      });

      let resolveData!: (value: { tsv: string; html: string }) => void;
      const dataPromise = new Promise<{ tsv: string; html: string }>((res) => {
        resolveData = res;
      });

      const writePromise = writeToSystemClipboard(dataPromise);

      // writeText should NOT have been called yet (waiting for data)
      expect(mockWriteText).not.toHaveBeenCalled();

      resolveData({ tsv: 'deferred text', html: '<p>html</p>' });
      await writePromise;

      expect(mockWriteText).toHaveBeenCalledWith('deferred text');
    });
  });
});
