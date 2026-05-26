/**
 * Tauri IPC transport — wraps @tauri-apps/api invoke.
 *
 * Used on desktop (Tauri) environments. Lazy-loads the Tauri API
 * on first call so the module can be imported in non-Tauri environments
 * without exploding.
 */
import type { BridgeTransport } from '@rust-bridge/client';
import { TransportError } from './errors';

/**
 * Create a BridgeTransport that dispatches to Tauri's IPC invoke.
 *
 * Lazy-loads `@tauri-apps/api/core` on first call so the module can be
 * imported in non-Tauri environments without exploding.
 */
export function createTauriTransport(): BridgeTransport {
  let invokeFunc: ((cmd: string, args: Record<string, unknown>) => Promise<unknown>) | null = null;

  return {
    async call<T = unknown>(command: string, args: Record<string, unknown>): Promise<T> {
      let fn = invokeFunc;
      if (!fn) {
        const { invoke } = await import('@tauri-apps/api/core');
        fn = invoke;
        invokeFunc = fn;
      }
      try {
        const result = await fn(command, args);
        // Tauri returns ArrayBuffer for commands using tauri::ipc::Response
        // (binary data). Normalize to Uint8Array for the TS client.
        if (result instanceof ArrayBuffer) {
          return new Uint8Array(result) as T;
        }
        return result as T;
      } catch (err) {
        throw TransportError.fromCommand(err, command);
      }
    },
  };
}
