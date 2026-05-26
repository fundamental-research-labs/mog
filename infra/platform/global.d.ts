/**
 * Global type declarations for platform package.
 *
 * Extends Window and Navigator interfaces with APIs not yet in standard lib.dom.d.ts:
 * - File System Access API (showOpenFilePicker, showSaveFilePicker, showDirectoryPicker)
 * - User-Agent Client Hints API (navigator.userAgentData)
 */

// ── File System Access API ──────────────────────────────────────────────

interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}

interface OpenFilePickerOptions {
  multiple?: boolean;
  types?: FilePickerAcceptType[];
  excludeAcceptAllOption?: boolean;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: FilePickerAcceptType[];
}

// ── User-Agent Client Hints API ─────────────────────────────────────────

interface NavigatorUAData {
  platform: string;
  brands?: Array<{ brand: string; version: string }>;
  mobile?: boolean;
}

declare global {
  interface Window {
    showOpenFilePicker?(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>;
    showSaveFilePicker?(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>;
    showDirectoryPicker?(): Promise<FileSystemDirectoryHandle>;
  }

  interface Navigator {
    userAgentData?: NavigatorUAData;
  }
}

export {};
