/**
 * Platform abstraction contracts for Spreadsheet OS.
 *
 * Provides a unified API for platform-specific operations:
 * - IPlatform: Main platform interface (filesystem, dialogs, etc.)
 * - IDialogs: Native file dialogs and confirmations
 * - INotifications: System notifications
 * - IClipboard: System clipboard
 * - IShell: Shell operations (open URLs, reveal files)
 */

// Platform identity
export type { Platform, PlatformIdentity } from './identity';

// Main platform interface
export type { IPlatform } from './types';

// Dialog interfaces
export type {
  AlertOptions,
  ConfirmOptions,
  FileFilter,
  IDialogs,
  OpenDialogOptions,
  SaveDialogOptions,
} from './types';

// Notification interfaces
export type { INotifications, NotificationOptions } from './types';

// Clipboard interface
export type { IClipboard } from './types';

// Shell interface
export type { IShell } from './types';
