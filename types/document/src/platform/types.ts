/**
 * Platform abstraction contracts for Spreadsheet OS.
 *
 * This module defines the unified platform API that abstracts over
 * desktop (Tauri) and web environments, providing consistent access to:
 * - Filesystem operations
 * - Native dialogs (open/save)
 * - System notifications
 * - Clipboard
 * - Shell operations (open URLs, reveal files)
 */

import type { IFileSystem } from '../filesystem';

// ============================================================
// Platform Interface
// ============================================================

/**
 * Unified platform abstraction for desktop and web.
 *
 * Implementations:
 * - TauriPlatform: Desktop via Tauri APIs
 * - WebPlatform: Browser with web APIs and fallbacks
 *
 * @example
 * ```ts
 * function createPlatform(): IPlatform {
 *   if (isTauri()) {
 *     return new TauriPlatform();
 *   }
 *   return new WebPlatform();
 * }
 * ```
 */
export interface IPlatform {
  /**
   * Platform identifier.
   */
  readonly name: 'desktop' | 'web';

  /**
   * Filesystem for app file operations.
   * Apps typically receive a sandboxed version scoped to their app ID.
   */
  readonly filesystem: IFileSystem;

  /**
   * Native dialog operations (file open/save, confirmations).
   */
  readonly dialogs: IDialogs;

  /**
   * System notification operations.
   */
  readonly notifications: INotifications;

  /**
   * System clipboard operations.
   */
  readonly clipboard: IClipboard;

  /**
   * Shell operations (open URLs, reveal in file manager).
   */
  readonly shell: IShell;
}

// ============================================================
// Dialogs
// ============================================================

/**
 * Capability-shaped handle to a file resource picked or named through a
 * dialog. Replaces the previous `string | null` return shape that discarded
 * the underlying FSA handle / OS path and forced callers to reach for inline
 * `<input type=file>` / anchor-download workarounds.
 *
 * Implementations:
 * - Desktop (Tauri): `name = basename(path)`, `displayPath = path`,
 *   `read`/`write` route through Tauri filesystem invokes.
 * - Web (FSA available): wraps `FileSystemFileHandle`; `read` via `getFile()`,
 *   `write` via `createWritable()`.
 * - Web (open fallback): wraps a `File` from `<input type=file>`; `read`
 *   returns its bytes; `write` throws (read-only).
 * - Web (save fallback): synthesised at dialog time; `read` throws (write-only);
 *   `write` performs an anchor-tag download with the suggested name.
 */
export interface PlatformFileHandle {
  /** Display name (basename only). */
  readonly name: string;

  /** Full path on desktop; `undefined` on web. Display-only. */
  readonly displayPath?: string;

  /** Throws on a write-only handle (web download fallback). */
  read(): Promise<Uint8Array>;

  /** Throws on a read-only handle (web upload fallback). */
  write(bytes: Uint8Array): Promise<void>;
}

/**
 * Native dialogs for file operations and confirmations.
 *
 * Desktop: Uses native OS dialogs via Tauri
 * Web: Uses browser dialogs and File System Access API
 */
export interface IDialogs {
  /**
   * Show a file open dialog.
   *
   * @param options - Dialog configuration
   * @returns A {@link PlatformFileHandle} for the selected file, or null if cancelled.
   *          Caller invokes `handle.read()` to obtain bytes.
   *
   * @example
   * ```ts
   * const handle = await dialogs.showOpenDialog({
   *   title: 'Open Spreadsheet',
   *   filters: [{ name: 'Spreadsheets', extensions: ['xlsx', 'xls'] }],
   * });
   * if (handle) {
   *   const bytes = await handle.read();
   *   await shellService.loadDocument(handle.name, bytes);
   * }
   * ```
   */
  showOpenDialog(options: OpenDialogOptions): Promise<PlatformFileHandle | null>;

  /**
   * Show a file save dialog.
   *
   * @param options - Dialog configuration
   * @returns A {@link PlatformFileHandle} for the selected destination, or null if cancelled.
   *          Caller invokes `handle.write(bytes)` to persist.
   *
   * @example
   * ```ts
   * const handle = await dialogs.showSaveDialog({
   *   title: 'Save As',
   *   defaultPath: 'Untitled.xlsx',
   *   filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
   * });
   * if (handle) {
   *   await handle.write(bytes);
   * }
   * ```
   */
  showSaveDialog(options: SaveDialogOptions): Promise<PlatformFileHandle | null>;

  /**
   * Show a folder selection dialog.
   *
   * @returns Selected folder path, or null if cancelled
   */
  showOpenFolderDialog(): Promise<string | null>;

  /**
   * Show a confirmation dialog.
   *
   * @param message - The message to display
   * @param options - Dialog configuration
   * @returns true if confirmed, false if cancelled
   *
   * @example
   * ```ts
   * const confirmed = await dialogs.confirm(
   *   'Save changes before closing?',
   *   { title: 'Unsaved Changes', okLabel: 'Save', cancelLabel: 'Discard' }
   * );
   * ```
   */
  confirm(message: string, options?: ConfirmOptions): Promise<boolean>;

  /**
   * Show an alert dialog.
   *
   * @param message - The message to display
   * @param options - Dialog configuration
   *
   * @example
   * ```ts
   * await dialogs.alert('File saved successfully.', { type: 'info' });
   * ```
   */
  alert(message: string, options?: AlertOptions): Promise<void>;
}

/**
 * Options for the file open dialog.
 */
export interface OpenDialogOptions {
  /**
   * Dialog title.
   */
  title?: string;

  /**
   * Default path to open the dialog at.
   */
  defaultPath?: string;

  /**
   * File type filters.
   */
  filters?: FileFilter[];

  /**
   * Allow selecting multiple files.
   * @default false
   */
  multiple?: boolean;
}

/**
 * Options for the file save dialog.
 */
export interface SaveDialogOptions {
  /**
   * Dialog title.
   */
  title?: string;

  /**
   * Default file path/name.
   */
  defaultPath?: string;

  /**
   * File type filters.
   */
  filters?: FileFilter[];
}

/**
 * File type filter for dialogs.
 *
 * @example
 * ```ts
 * const filter: FileFilter = {
 *   name: 'Spreadsheets',
 *   extensions: ['xlsx', 'xls', 'csv'],
 * };
 * ```
 */
export interface FileFilter {
  /**
   * Display name for the filter (e.g., "Spreadsheets").
   */
  name: string;

  /**
   * File extensions without the leading dot (e.g., ['xlsx', 'xls']).
   */
  extensions: string[];
}

/**
 * Options for confirmation dialogs.
 */
export interface ConfirmOptions {
  /**
   * Dialog title.
   */
  title?: string;

  /**
   * Label for the confirm/OK button.
   * @default 'OK'
   */
  okLabel?: string;

  /**
   * Label for the cancel button.
   * @default 'Cancel'
   */
  cancelLabel?: string;
}

/**
 * Options for alert dialogs.
 */
export interface AlertOptions {
  /**
   * Dialog title.
   */
  title?: string;

  /**
   * Alert type (affects icon/styling).
   * @default 'info'
   */
  type?: 'info' | 'warning' | 'error';
}

// ============================================================
// Notifications
// ============================================================

/**
 * System notification operations.
 *
 * Desktop: Uses native OS notifications
 * Web: Uses the Notifications API
 */
export interface INotifications {
  /**
   * Show a system notification.
   *
   * @param notification - Notification configuration
   *
   * @example
   * ```ts
   * await notifications.show({
   *   title: 'Export Complete',
   *   body: 'Your file has been exported to Downloads.',
   * });
   * ```
   */
  show(notification: NotificationOptions): Promise<void>;

  /**
   * Request permission to show notifications.
   *
   * @returns true if permission was granted, false otherwise
   */
  requestPermission(): Promise<boolean>;
}

/**
 * Options for system notifications.
 */
export interface NotificationOptions {
  /**
   * Notification title.
   */
  title: string;

  /**
   * Notification body text.
   */
  body?: string;

  /**
   * Icon to display (URL or path).
   */
  icon?: string;
}

// ============================================================
// Clipboard
// ============================================================

/**
 * System clipboard operations.
 *
 * Provides read/write access to the system clipboard
 * for both text and image data.
 */
export interface IClipboard {
  /**
   * Read text from the clipboard.
   *
   * @returns Clipboard text content
   * @throws Error if clipboard is empty or access denied
   */
  readText(): Promise<string>;

  /**
   * Write text to the clipboard.
   *
   * @param text - Text to write
   */
  writeText(text: string): Promise<void>;

  /**
   * Read image data from the clipboard.
   *
   * @returns Image data as PNG bytes, or null if no image
   */
  readImage(): Promise<Uint8Array | null>;

  /**
   * Write image data to the clipboard.
   *
   * @param data - Image data as PNG bytes
   */
  writeImage(data: Uint8Array): Promise<void>;
}

// ============================================================
// Shell
// ============================================================

/**
 * Shell operations for interacting with the OS.
 *
 * Desktop-specific operations (minimize, maximize, close)
 * are optional and only available on desktop platforms.
 */
export interface IShell {
  /**
   * Open a URL in the default browser.
   *
   * @param url - URL to open
   *
   * @example
   * ```ts
   * await shell.openExternal('https://docs.example.com');
   * ```
   */
  openExternal(url: string): Promise<void>;

  /**
   * Reveal a file in the system file manager.
   *
   * Desktop: Opens Finder/Explorer with file selected
   * Web: May download the file or show a path
   *
   * @param path - Path to the file to reveal
   */
  revealInFileManager(path: string): Promise<void>;

  /**
   * Set the window title.
   *
   * Desktop: Sets the native window title
   * Web: Sets document.title
   *
   * @param title - Window title
   */
  setWindowTitle(title: string): void;

  // Desktop-only operations (optional)

  /**
   * Minimize the window.
   * Only available on desktop.
   */
  minimize?(): void;

  /**
   * Maximize or restore the window.
   * Only available on desktop.
   */
  maximize?(): void;

  /**
   * Close the window.
   * Only available on desktop.
   */
  close?(): void;
}
