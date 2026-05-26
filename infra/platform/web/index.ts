/**
 * Web platform module for Spreadsheet OS.
 *
 * Provides browser-based platform functionality:
 * - File dialogs via File System Access API
 * - Browser notifications
 * - Clipboard operations
 * - Shell operations (URLs, window title)
 *
 * @example
 * ```ts
 * import { WebPlatform } from './platform/web';
 * import type { IFileSystem } from '@mog-sdk/contracts/filesystem';
 *
 * declare const filesystem: IFileSystem;
 * const platform = new WebPlatform(filesystem);
 *
 * // Use platform APIs
 * await platform.dialogs.showOpenDialog({ title: 'Open File' });
 * await platform.notifications.show({ title: 'Done!' });
 * ```
 */

export { WebPlatform } from './platform';
