/**
 * Transport abstraction for rust-bridge generated clients.
 *
 * Implementations handle the actual IPC mechanism (Tauri invoke, WASM calls, etc.)
 * while the generated client code remains transport-agnostic.
 */
export interface BridgeTransport {
  /**
   * Call a remote command with the given arguments.
   *
   * @param command - The command name (snake_case, e.g. "kv_store_get")
   * @param args - The arguments object (keys in camelCase, matching Tauri 2 convention)
   * @returns Promise resolving to the command's return value
   */
  call<T = unknown>(command: string, args: Record<string, unknown>): Promise<T>;
}
