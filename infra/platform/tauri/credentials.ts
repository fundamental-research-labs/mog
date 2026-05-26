/**
 * OS Keychain credential management for Tauri desktop app.
 *
 * Credentials are stored in the system keychain:
 * - macOS: Keychain
 * - Windows: Credential Manager
 * - Linux: Secret Service (GNOME Keyring, KWallet)
 *
 * Secrets are stored in the Rust layer and retrieved only through secure IPC.
 *
 * SECURITY: All operations use secureInvoke which handles:
 * - HMAC request signing
 * - Window verification
 * - Rate limiting (for Protected+ levels)
 * - Audit logging (for Sensitive+ levels)
 * - Biometric confirmation (for Critical level - store/delete)
 *
 * Biometric enforcement is in Rust middleware, NOT in TypeScript.
 * This prevents bypass via direct IPC calls.
 *
 * @example
 * ```ts
 * import { credentials } from './credentials';
 *
 * // Store credentials (Critical level - triggers biometric in Rust)
 * await credentials.store('api_token', 'secret');
 *
 * // Check existence (Protected level - rate limited)
 * const hasToken = await credentials.exists('api_token');
 *
 * // Get credential (Sensitive level - audited)
 * const token = await credentials.get('api_token');
 *
 * // Delete credentials (Critical level - triggers biometric in Rust)
 * await credentials.delete('api_token');
 * ```
 */

import { secureInvoke } from './secure-invoke';

/**
 * Credential info returned by list().
 */
export interface CredentialInfo {
  key: string;
  exists: boolean;
}

/**
 * Credential management API.
 *
 * Security is handled by secureInvoke + Rust middleware:
 * - HMAC signing for all operations
 * - Biometric/password for store/delete (Critical level)
 * - Rate limiting for existence checks (Protected level)
 * - Audit logging for get operations (Sensitive level)
 */
export const credentials = {
  /**
   * Store a credential in the OS keychain.
   *
   * SECURITY: Critical level - requires biometric authentication
   * (Touch ID / Windows Hello / system password fallback).
   *
   * @param key - Unique credential identifier
   * @param value - The secret value to store
   */
  store: (key: string, value: string): Promise<void> =>
    secureInvoke('credential_store', { key, value }),

  /**
   * Retrieve a credential from the OS keychain.
   *
   * SECURITY: Sensitive level - audited but no biometric required.
   *
   * @param key - The credential key to retrieve
   * @returns The credential value, or null if not found
   */
  get: (key: string): Promise<string | null> => secureInvoke('credential_get', { key }),

  /**
   * Delete a credential from the OS keychain.
   *
   * SECURITY: Critical level - requires biometric authentication
   * (Touch ID / Windows Hello / system password fallback).
   *
   * @param key - The credential key to delete
   */
  delete: (key: string): Promise<void> => secureInvoke('credential_delete', { key }),

  /**
   * Check if a credential exists in the OS keychain.
   *
   * SECURITY: Protected level - rate limited to prevent enumeration.
   *
   * @param key - The credential key to check
   * @returns true if the credential exists
   */
  exists: (key: string): Promise<boolean> => secureInvoke('credential_exists', { key }),

  /**
   * List all tracked credentials with their status.
   *
   * SECURITY: Protected level - rate limited.
   *
   * Note: This returns keys tracked by the application,
   * not all keys in the system keychain.
   *
   * @returns Array of credential info objects
   */
  list: (): Promise<CredentialInfo[]> => secureInvoke('credential_list', {}),

  /**
   * List all tracked credential keys.
   *
   * SECURITY: Protected level - rate limited.
   *
   * @returns Array of credential key names
   */
  listKeys: (): Promise<string[]> => secureInvoke('credential_list_keys', {}),
};
