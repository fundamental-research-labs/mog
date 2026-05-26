/**
 * Tauri platform implementation for Spreadsheet OS.
 *
 * Provides desktop platform functionality through Tauri APIs:
 * - Native dialogs (open/save file, folder selection, confirm, alert)
 * - System notifications
 * - Clipboard operations
 * - Shell operations (open URLs, reveal in file manager, window control)
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
import { TauriFileSystem } from './filesystem';

/**
 * Capability handle wrapping a desktop OS path. Reads/writes route through
 * the Tauri filesystem plugin so callers don't need to know whether they are
 * on desktop or web — they just call `handle.read()` / `handle.write(bytes)`.
 */
class TauriFileHandle implements PlatformFileHandle {
  readonly name: string;
  readonly displayPath: string;

  constructor(private readonly path: string) {
    this.displayPath = path;
    // Basename: split on either / or \ to handle both Unix and Windows paths.
    const lastSep = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    this.name = lastSep >= 0 ? path.slice(lastSep + 1) : path;
  }

  async read(): Promise<Uint8Array> {
    const { readFile } = await import('@tauri-apps/plugin-fs');
    const bytes = await readFile(this.path);
    return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  }

  async write(bytes: Uint8Array): Promise<void> {
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    await writeFile(this.path, bytes);
  }
}

/**
 * Tauri-based dialogs using native OS dialogs.
 *
 * Uses @tauri-apps/plugin-dialog for native file dialogs, confirmations, and alerts.
 */
class TauriDialogs implements IDialogs {
  async showOpenDialog(options: OpenDialogOptions): Promise<PlatformFileHandle | null> {
    const { open } = await import('@tauri-apps/plugin-dialog');

    const result = await open({
      title: options.title,
      defaultPath: options.defaultPath,
      filters: options.filters?.map((f) => ({
        name: f.name,
        extensions: f.extensions,
      })),
      multiple: options.multiple ?? false,
      directory: false,
    });

    const path = Array.isArray(result) ? (result[0] ?? null) : result;
    return path ? new TauriFileHandle(path) : null;
  }

  async showSaveDialog(options: SaveDialogOptions): Promise<PlatformFileHandle | null> {
    const { save } = await import('@tauri-apps/plugin-dialog');

    const path = await save({
      title: options.title,
      defaultPath: options.defaultPath,
      filters: options.filters?.map((f) => ({
        name: f.name,
        extensions: f.extensions,
      })),
    });

    return path ? new TauriFileHandle(path) : null;
  }

  async showOpenFolderDialog(): Promise<string | null> {
    console.log('[TauriDialogs] showOpenFolderDialog called');
    const { open } = await import('@tauri-apps/plugin-dialog');
    console.log('[TauriDialogs] plugin-dialog imported, calling open()...');

    const result = (await open({
      directory: true,
      multiple: false,
    })) as string | null;
    console.log('[TauriDialogs] Dialog result:', result);
    return result;
  }

  async confirm(message: string, options?: ConfirmOptions): Promise<boolean> {
    const { confirm } = await import('@tauri-apps/plugin-dialog');

    return confirm(message, {
      title: options?.title,
      okLabel: options?.okLabel,
      cancelLabel: options?.cancelLabel,
    });
  }

  async alert(message: string, options?: AlertOptions): Promise<void> {
    const { message: showMessage } = await import('@tauri-apps/plugin-dialog');

    await showMessage(message, {
      title: options?.title,
      kind: options?.type,
    });
  }
}

/**
 * Tauri-based notifications using OS notifications.
 *
 * Uses @tauri-apps/plugin-notification for native system notifications.
 */
class TauriNotifications implements INotifications {
  async show(notification: NotificationOptions): Promise<void> {
    const { sendNotification, isPermissionGranted, requestPermission } =
      await import('@tauri-apps/plugin-notification');

    let hasPermission = await isPermissionGranted();
    if (!hasPermission) {
      hasPermission = (await requestPermission()) === 'granted';
    }

    if (hasPermission) {
      sendNotification({
        title: notification.title,
        body: notification.body,
        icon: notification.icon,
      });
    }
  }

  async requestPermission(): Promise<boolean> {
    const { requestPermission, isPermissionGranted } =
      await import('@tauri-apps/plugin-notification');

    const granted = await isPermissionGranted();
    if (granted) return true;

    return (await requestPermission()) === 'granted';
  }
}

/**
 * Tauri-based clipboard using OS clipboard.
 *
 * Uses @tauri-apps/plugin-clipboard-manager for system clipboard operations.
 */
class TauriClipboard implements IClipboard {
  async readText(): Promise<string> {
    const { readText } = await import('@tauri-apps/plugin-clipboard-manager');
    return (await readText()) ?? '';
  }

  async writeText(text: string): Promise<void> {
    const { writeText } = await import('@tauri-apps/plugin-clipboard-manager');
    await writeText(text);
  }

  async readImage(): Promise<Uint8Array | null> {
    // Clipboard image reading requires additional plugin support
    return null;
  }

  async writeImage(_data: Uint8Array): Promise<void> {
    // Clipboard image writing requires additional plugin support
    console.warn('Clipboard image writing not implemented');
  }
}

/**
 * Tauri-based shell operations.
 *
 * Provides shell operations including:
 * - Opening URLs in default browser
 * - Revealing files in system file manager
 * - Window control (title, minimize, maximize, close)
 */
class TauriShell implements IShell {
  async openExternal(url: string): Promise<void> {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(url);
  }

  async revealInFileManager(path: string): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('reveal_in_file_manager', { path });
  }

  setWindowTitle(title: string): void {
    // Use Tauri window API
    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => {
        getCurrentWindow().setTitle(title);
      })
      .catch(console.error);
  }

  minimize(): void {
    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => {
        getCurrentWindow().minimize();
      })
      .catch(console.error);
  }

  maximize(): void {
    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => {
        getCurrentWindow().toggleMaximize();
      })
      .catch(console.error);
  }

  close(): void {
    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => {
        getCurrentWindow().close();
      })
      .catch(console.error);
  }
}

/**
 * Tauri desktop platform implementation.
 *
 * Provides full desktop platform functionality using Tauri APIs:
 * - Native filesystem via TauriFileSystem
 * - Native dialogs via TauriDialogs
 * - System notifications via TauriNotifications
 * - System clipboard via TauriClipboard
 * - Shell operations via TauriShell
 *
 * @example
 * ```ts
 * import { TauriPlatform } from './platform/tauri';
 *
 * const platform = new TauriPlatform();
 *
 * // Show file open dialog
 * const filePath = await platform.dialogs.showOpenDialog({
 *   title: 'Open Spreadsheet',
 *   filters: [{ name: 'Spreadsheets', extensions: ['xlsx', 'xls'] }],
 * });
 *
 * // Read file using filesystem
 * if (filePath) {
 *   const content = await platform.filesystem.read(filePath as FilePath);
 * }
 * ```
 */
export class TauriPlatform implements IPlatform {
  readonly name = 'desktop' as const;
  readonly filesystem: IFileSystem;
  readonly dialogs: IDialogs;
  readonly notifications: INotifications;
  readonly clipboard: IClipboard;
  readonly shell: IShell;

  constructor(basePath?: string) {
    this.filesystem = new TauriFileSystem(basePath);
    this.dialogs = new TauriDialogs();
    this.notifications = new TauriNotifications();
    this.clipboard = new TauriClipboard();
    this.shell = new TauriShell();
  }
}
