/**
 * Global type declarations for pdf-graphics package.
 *
 * Extends Window with the Tauri IPC global, present when running
 * inside a Tauri webview.
 */

interface Window {
  __TAURI__?: {
    invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown>;
  };
}
