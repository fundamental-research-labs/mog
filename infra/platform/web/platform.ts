/**
 * Web platform implementation for Spreadsheet OS.
 *
 * Provides browser-based platform functionality using Web APIs:
 * - File dialogs via File System Access API (with fallbacks)
 * - Browser notifications via Notification API
 * - Clipboard via Clipboard API
 * - Shell operations (open URLs, window title)
 */

import type { IFileSystem } from '@mog-sdk/contracts/filesystem';
import type {
  AlertOptions,
  ConfirmOptions,
  IClipboard,
  IDialogs,
  INotifications,
  IPlatform,
  IShell,
  NotificationOptions,
  OpenDialogOptions,
  PlatformFileHandle,
  SaveDialogOptions,
} from '@mog-sdk/contracts/platform';

// =============================================================================
// File Handles — capability-shaped wrappers around browser file primitives.
// =============================================================================

/**
 * Read/write capable handle backed by the File System Access API
 * `FileSystemFileHandle`. Used when the browser supports `showOpenFilePicker`
 * / `showSaveFilePicker` and the user grants persistent access.
 */
class WebFsaHandle implements PlatformFileHandle {
  readonly name: string;
  readonly displayPath?: undefined;

  constructor(private readonly handle: FileSystemFileHandle) {
    this.name = handle.name;
  }

  async read(): Promise<Uint8Array> {
    const file = await this.handle.getFile();
    const buffer = await file.arrayBuffer();
    return new Uint8Array(buffer);
  }

  async write(bytes: Uint8Array): Promise<void> {
    const writable = await this.handle.createWritable();
    try {
      // Copy through a fresh ArrayBuffer to satisfy lib.dom's BufferSource
      // (which excludes SharedArrayBuffer-backed views) and to detach from
      // any wasm linear memory the bytes may have come from.
      const ab = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(ab).set(bytes);
      await writable.write(ab);
    } finally {
      await writable.close();
    }
  }
}

/**
 * Read-only handle wrapping a `File` produced by `<input type=file>` (the
 * fallback when FSA is unavailable). `write` throws — open-fallback is for
 * loading bytes only.
 */
class WebUploadHandle implements PlatformFileHandle {
  readonly name: string;
  readonly displayPath?: undefined;

  constructor(private readonly file: File) {
    this.name = file.name;
  }

  async read(): Promise<Uint8Array> {
    const buffer = await this.file.arrayBuffer();
    return new Uint8Array(buffer);
  }

  async write(_bytes: Uint8Array): Promise<void> {
    throw new Error('WebUploadHandle is read-only — cannot write through an upload picker.');
  }
}

/**
 * Write-only handle synthesised at save-dialog time when FSA is unavailable.
 * `write(bytes)` performs an anchor-tag download with the suggested name —
 * the same UX as a manual `<a download>` click. `read` throws — there is no
 * backing file resource to read.
 *
 * The MIME guess is best-effort; downstream code that needs strict typing
 * should pass an explicit MIME (future evolution). For now we map `.xlsx` /
 * `.csv` to their canonical types and fall back to `application/octet-stream`.
 */
class WebDownloadHandle implements PlatformFileHandle {
  readonly name: string;
  readonly displayPath?: undefined;

  constructor(name: string) {
    this.name = name || 'download';
  }

  async read(): Promise<Uint8Array> {
    throw new Error(
      'WebDownloadHandle is write-only — the save-dialog fallback only supports write().',
    );
  }

  async write(bytes: Uint8Array): Promise<void> {
    const mime = guessMime(this.name);
    // Copy through a fresh ArrayBuffer so the Blob is detached from any
    // wasm linear memory backing `bytes` (lib.dom's BlobPart excludes
    // SharedArrayBuffer-backed views).
    const ab = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(ab).set(bytes);
    const blob = new Blob([ab], { type: mime });
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = this.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function guessMime(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.xlsx')) {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  if (lower.endsWith('.xls')) return 'application/vnd.ms-excel';
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

/**
 * Web-based dialogs using browser APIs.
 *
 * Uses the File System Access API when available, with fallbacks
 * to standard input elements for broader browser support.
 */
class WebDialogs implements IDialogs {
  async showOpenDialog(options: OpenDialogOptions): Promise<PlatformFileHandle | null> {
    // Use File System Access API if available — but skip when running under
    // automation (Playwright/etc). The FSA picker auto-aborts in headless
    // browsers, which would surface as "user cancelled" and silently skip
    // the download/upload that the action handler is expected to drive.
    // Detection via `navigator.webdriver`: set to `true` whenever the page
    // is controlled by a WebDriver-style automation (Playwright sets this
    // via the CDP `Emulation.setUserAgentOverride` boilerplate).
    const isAutomated =
      typeof navigator !== 'undefined' && (navigator as { webdriver?: boolean }).webdriver === true;
    if ('showOpenFilePicker' in window && !isAutomated) {
      try {
        const handles = await window.showOpenFilePicker?.({
          multiple: options.multiple ?? false,
          types: options.filters?.map((f) => ({
            description: f.name,
            accept: {
              '*/*': f.extensions.map((e) => `.${e}`),
            },
          })),
        });

        if (handles && handles.length > 0) {
          return new WebFsaHandle(handles[0]);
        }
        return null;
      } catch (e) {
        if ((e as Error).name === 'AbortError') {
          return null;
        }
        console.error('File picker error:', e);
        // Fall through to <input type=file> fallback.
      }
    }

    // Fallback: use hidden input
    return new Promise<PlatformFileHandle | null>((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept =
        options.filters?.flatMap((f) => f.extensions.map((e) => `.${e}`)).join(',') ?? '*';

      input.onchange = () => {
        const file = input.files?.[0];
        resolve(file ? new WebUploadHandle(file) : null);
      };

      input.oncancel = () => resolve(null);
      input.click();
    });
  }

  async showSaveDialog(options: SaveDialogOptions): Promise<PlatformFileHandle | null> {
    // Use File System Access API if available — but skip under automation
    // (see `showOpenDialog` rationale).
    const isAutomated =
      typeof navigator !== 'undefined' && (navigator as { webdriver?: boolean }).webdriver === true;
    if ('showSaveFilePicker' in window && !isAutomated) {
      try {
        const handle = await window.showSaveFilePicker?.({
          suggestedName: options.defaultPath,
          types: options.filters?.map((f) => ({
            description: f.name,
            accept: {
              '*/*': f.extensions.map((e) => `.${e}`),
            },
          })),
        });

        return handle ? new WebFsaHandle(handle) : null;
      } catch (e) {
        if ((e as Error).name === 'AbortError') {
          return null;
        }
        console.error('File picker error:', e);
        // Fall through to anchor-download fallback.
      }
    }

    // Fallback: synthesise a write-only handle whose `write` performs an
    // anchor-tag download with the suggested name. The "dialog" UX is
    // implicit in the browser's download manager.
    const suggested = options.defaultPath ?? 'download';
    // If the suggested name has no extension but a filter is provided, use
    // the first extension from the first filter to ensure the download is
    // recognised by the OS.
    let name = suggested;
    if (!/\.[^./]+$/.test(name) && options.filters && options.filters.length > 0) {
      const ext = options.filters[0]?.extensions[0];
      if (ext) name = `${name}.${ext}`;
    }
    return new WebDownloadHandle(name);
  }

  async showOpenFolderDialog(): Promise<string | null> {
    // Use File System Access API if available
    if ('showDirectoryPicker' in window) {
      try {
        const handle = await window.showDirectoryPicker?.();
        return handle?.name ?? null;
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          console.error('Directory picker error:', e);
        }
      }
    }

    return null;
  }

  async confirm(message: string, _options?: ConfirmOptions): Promise<boolean> {
    // Use browser confirm dialog
    return window.confirm(message);
  }

  async alert(message: string, _options?: AlertOptions): Promise<void> {
    window.alert(message);
  }
}

/**
 * Web-based notifications using Notification API.
 *
 * Uses the standard browser Notification API for system notifications.
 */
class WebNotifications implements INotifications {
  async show(notification: NotificationOptions): Promise<void> {
    if ('Notification' in window) {
      if (Notification.permission === 'granted') {
        new Notification(notification.title, {
          body: notification.body,
          icon: notification.icon,
        });
      }
    }
  }

  async requestPermission(): Promise<boolean> {
    if ('Notification' in window) {
      const result = await Notification.requestPermission();
      return result === 'granted';
    }
    return false;
  }
}

/**
 * Web-based clipboard using Clipboard API.
 *
 * Uses the standard browser Clipboard API for text and image operations.
 */
class WebClipboard implements IClipboard {
  async readText(): Promise<string> {
    try {
      return await navigator.clipboard.readText();
    } catch {
      return '';
    }
  }

  async writeText(text: string): Promise<void> {
    await navigator.clipboard.writeText(text);
  }

  async readImage(): Promise<Uint8Array | null> {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        if (item.types.includes('image/png')) {
          const blob = await item.getType('image/png');
          const buffer = await blob.arrayBuffer();
          return new Uint8Array(buffer);
        }
      }
    } catch {
      // Clipboard API not supported or permission denied
    }
    return null;
  }

  async writeImage(data: Uint8Array): Promise<void> {
    // Create a new ArrayBuffer copy to avoid SharedArrayBuffer compatibility issues
    const arrayBuffer = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    ) as ArrayBuffer;
    const blob = new Blob([arrayBuffer], { type: 'image/png' });
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }
}

/**
 * Web-based shell operations.
 *
 * Provides web-compatible shell operations:
 * - Opening URLs in new tabs
 * - Setting document title
 *
 * Note: Desktop-specific operations (minimize, maximize, close) are not available.
 */
class WebShell implements IShell {
  async openExternal(url: string): Promise<void> {
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async revealInFileManager(_path: string): Promise<void> {
    // Not supported in web
    console.warn('revealInFileManager not supported in web');
  }

  setWindowTitle(title: string): void {
    document.title = title;
  }
}

/**
 * Web platform implementation with an injected filesystem.
 *
 * Provides browser-based platform functionality:
 * - Filesystem backend (provided externally)
 * - Browser dialogs via WebDialogs
 * - Browser notifications via WebNotifications
 * - Browser clipboard via WebClipboard
 * - Shell operations via WebShell
 *
 * Note: Requires a filesystem implementation to be provided,
 * as the web platform cannot access the local filesystem directly.
 *
 * @example
 * ```ts
 * import { WebPlatform } from './platform/web';
 * import type { IFileSystem } from '@mog-sdk/contracts/filesystem';
 *
 * declare const filesystem: IFileSystem;
 * const platform = new WebPlatform(filesystem);
 *
 * // Show file open dialog
 * const fileName = await platform.dialogs.showOpenDialog({
 *   title: 'Open Spreadsheet',
 *   filters: [{ name: 'Spreadsheets', extensions: ['xlsx', 'xls'] }],
 * });
 *
 * // Set window title
 * platform.shell.setWindowTitle('My Spreadsheet - Spreadsheet OS');
 * ```
 */
export class WebPlatform implements IPlatform {
  readonly name = 'web' as const;
  readonly filesystem: IFileSystem;
  readonly dialogs: IDialogs;
  readonly notifications: INotifications;
  readonly clipboard: IClipboard;
  readonly shell: IShell;

  constructor(filesystem: IFileSystem) {
    this.filesystem = filesystem;
    this.dialogs = new WebDialogs();
    this.notifications = new WebNotifications();
    this.clipboard = new WebClipboard();
    this.shell = new WebShell();
  }
}
