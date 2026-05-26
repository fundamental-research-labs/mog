/**
 * Web platform file-handle tests (web platform verification gate).
 *
 * Exercises:
 * - `WebUploadHandle.read()` returns the bytes of the underlying `File`.
 * - `WebDownloadHandle.write()` triggers an anchor-tag download
 *   (createObjectURL + click + revokeObjectURL).
 * - The contractual semantics: upload is read-only, download is write-only.
 *
 * The classes are NOT exported from `@mog/platform` (they're private to the
 * `WebDialogs` implementation), so the tests reach in through the dialog
 * surface — driving FSA detection off and asserting on the round-tripped
 * handle. This mirrors the production wire-up.
 */

import { jest } from '@jest/globals';

// We need a fresh `WebPlatform` import per test so we can toggle FSA
// availability via deletion of `window.showOpenFilePicker` /
// `window.showSaveFilePicker`. Module reset isn't strictly needed because
// `WebDialogs` reads `'showOpenFilePicker' in window` at call time.
import { WebPlatform } from '../platform';
import type { IFileSystem } from '@mog-sdk/contracts/filesystem';

// Tiny in-memory FS stub — the platform constructor requires it but the
// dialog tests don't exercise it.
const stubFs = {} as IFileSystem;

/**
 * Build a `File` whose `arrayBuffer()` resolves to the given bytes. jsdom
 * ships a `File` constructor but does not implement the `arrayBuffer()`
 * Blob method — every test that needs to read bytes through the standard
 * Blob API must polyfill it locally.
 */
function makeFile(bytes: Uint8Array, name: string, type = ''): File {
  const file = new File([bytes], name, { type });
  // Copy the bytes into a fresh ArrayBuffer for the polyfill so the
  // returned promise resolves to a buffer that's independent of `bytes`.
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  Object.defineProperty(file, 'arrayBuffer', {
    configurable: true,
    value: () => Promise.resolve(buffer),
  });
  return file;
}

function ensureNoFsa(): void {
  // jsdom doesn't ship FSA; assert defensively in case a polyfill leaks in.
  // We delete via cast because the lib.dom types declare these as required
  // on Window.
  delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  delete (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;
}

describe('WebUploadHandle (no-FSA open fallback)', () => {
  beforeEach(() => {
    ensureNoFsa();
  });

  it('read() returns the bytes of the chosen file', async () => {
    const platform = new WebPlatform(stubFs);

    const expectedBytes = new Uint8Array([1, 2, 3, 4, 5, 0xff, 0xfe]);
    const file = makeFile(
      expectedBytes,
      'data.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

    // Drive the `<input type=file>` fallback. We can't simulate a real
    // browser file-chooser, so we monkey-patch HTMLInputElement.click() to
    // immediately set `files` and dispatch `change`.
    const realClick = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function (this: HTMLInputElement) {
      Object.defineProperty(this, 'files', {
        configurable: true,
        get: () =>
          ({
            0: file,
            length: 1,
            item: (i: number) => (i === 0 ? file : null),
          }) as unknown as FileList,
      });
      // Synchronously dispatch a `change` event the picker installed.
      this.dispatchEvent(new Event('change'));
    };

    try {
      const handle = await platform.dialogs.showOpenDialog({
        title: 'Open',
        filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      });

      expect(handle).not.toBeNull();
      expect(handle!.name).toBe('data.xlsx');
      // Upload handle has no desktop path.
      expect(handle!.displayPath).toBeUndefined();

      const bytes = await handle!.read();
      expect(Array.from(bytes)).toEqual(Array.from(expectedBytes));
    } finally {
      HTMLInputElement.prototype.click = realClick;
    }
  });

  it('write() throws (read-only)', async () => {
    const platform = new WebPlatform(stubFs);

    const realClick = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function (this: HTMLInputElement) {
      const file = makeFile(new Uint8Array([1]), 'x.xlsx');
      Object.defineProperty(this, 'files', {
        configurable: true,
        get: () => ({ 0: file, length: 1, item: () => file }) as unknown as FileList,
      });
      this.dispatchEvent(new Event('change'));
    };

    try {
      const handle = await platform.dialogs.showOpenDialog({ title: 'Open' });
      expect(handle).not.toBeNull();
      await expect(handle!.write(new Uint8Array([0]))).rejects.toThrow(/read-only/i);
    } finally {
      HTMLInputElement.prototype.click = realClick;
    }
  });
});

describe('WebDownloadHandle (no-FSA save fallback)', () => {
  beforeEach(() => {
    ensureNoFsa();
  });

  it('write() triggers an anchor-tag download with createObjectURL + click + revokeObjectURL', async () => {
    const platform = new WebPlatform(stubFs);

    // Capture URL.createObjectURL / revokeObjectURL — jsdom provides
    // these as no-ops; we wrap them to assert call ordering.
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    const createSpy = jest.fn((blob: Blob) => `blob:test/${blob.size}`);
    const revokeSpy = jest.fn();
    URL.createObjectURL = createSpy as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeSpy as unknown as typeof URL.revokeObjectURL;

    // Capture the anchor click.
    const clickSpy = jest.fn();
    const realAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clickSpy(this.href, this.download);
    };

    try {
      const handle = await platform.dialogs.showSaveDialog({
        title: 'Save',
        defaultPath: 'export.xlsx',
        filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      });

      expect(handle).not.toBeNull();
      expect(handle!.name).toBe('export.xlsx');

      // read() must throw — write-only handle.
      await expect(handle!.read()).rejects.toThrow(/write-only/i);

      const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]); // "PK\x03\x04" (XLSX magic)
      await handle!.write(bytes);

      // Order: createObjectURL → click → revokeObjectURL
      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(revokeSpy).toHaveBeenCalledTimes(1);

      // The anchor was given the download attr matching the suggested name.
      const [href, download] = clickSpy.mock.calls[0]!;
      expect(typeof href).toBe('string');
      expect(href).toMatch(/^blob:/);
      expect(download).toBe('export.xlsx');

      // Createable Blob carries the right MIME (xlsx).
      const blobArg = createSpy.mock.calls[0]![0] as Blob;
      expect(blobArg.type).toBe(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect(blobArg.size).toBe(bytes.byteLength);
    } finally {
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
      HTMLAnchorElement.prototype.click = realAnchorClick;
    }
  });

  it('appends extension from filter when defaultPath has none', async () => {
    const platform = new WebPlatform(stubFs);

    const handle = await platform.dialogs.showSaveDialog({
      title: 'Save',
      defaultPath: 'untitled',
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    });

    expect(handle).not.toBeNull();
    expect(handle!.name).toBe('untitled.xlsx');
  });
});
