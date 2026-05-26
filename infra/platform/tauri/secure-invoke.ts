/**
 * Unified secure invocation layer for Tauri IPC commands.
 *
 * This module provides a single entry point for all Tauri command invocations
 * with automatic security handling based on command security levels.
 *
 * Security is enforced in layers:
 * 1. TypeScript: Request signing (HMAC) for Signed+ levels
 * 2. Rust middleware: All security checks (signature, window, rate limit, audit, biometric)
 *
 * IMPORTANT: Biometric verification is handled by Rust middleware, NOT here.
 * This prevents bypassing via direct IPC calls.
 *
 * @example
 * ```ts
 * import { secureInvoke, SecurityLevel } from './secure-invoke';
 *
 * // Simple invocation - security handled automatically
 * const result = await secureInvoke<string>('credential_get', { key: 'my_key' });
 *
 * // Check if a command requires biometric (for UI hints)
 * if (commandRequiresBiometric('credential_store')) {
 *   showBiometricPrepPrompt();
 * }
 * ```
 */

import { invoke } from '@tauri-apps/api/core';
import { isDev } from '@mog/env';
import { ensureSessionInitialized, signRequest } from './security';

/**
 * Security levels matching Rust SecurityLevel enum.
 *
 * Each level includes all checks from lower levels:
 * - Public: No checks
 * - Signed: HMAC signature
 * - Verified: + Window verification
 * - Protected: + Rate limiting
 * - Sensitive: + Audit logging
 * - Critical: + Biometric confirmation
 */
export enum SecurityLevel {
  /** No authentication - public read-only info only */
  Public = 0,
  /** HMAC signature verification required */
  Signed = 1,
  /** Signed + window label verification */
  Verified = 2,
  /** Verified + rate limiting */
  Protected = 3,
  /** Protected + audit logging */
  Sensitive = 4,
  /** Sensitive + biometric confirmation */
  Critical = 5,
}

/**
 * Command security level registry - MUST match Rust definitions.
 *
 * When adding new commands, ensure the level here matches the
 * secure_command! macro level in Rust.
 */
const COMMAND_LEVELS: Record<string, SecurityLevel> = {
  // Credentials
  credential_store: SecurityLevel.Critical,
  credential_delete: SecurityLevel.Critical,
  credential_get: SecurityLevel.Sensitive,
  credential_exists: SecurityLevel.Protected,
  credential_list: SecurityLevel.Protected,
  credential_list_keys: SecurityLevel.Protected,
  credential_store_temp: SecurityLevel.Verified,
  credential_delete_temp: SecurityLevel.Verified,

  // File operations (levels must match Rust definitions in file.rs and file_ops.rs)
  read_file: SecurityLevel.Verified,
  write_file: SecurityLevel.Sensitive,
  delete_path: SecurityLevel.Critical,
  rename_path: SecurityLevel.Sensitive,
  copy_file: SecurityLevel.Verified, // Verified in Rust
  create_folder: SecurityLevel.Verified,
  create_empty_spreadsheet: SecurityLevel.Sensitive,
  generate_unique_folder_name: SecurityLevel.Verified,
  generate_unique_filename: SecurityLevel.Verified,
  import_files: SecurityLevel.Sensitive,
  show_open_dialog: SecurityLevel.Public, // UI operation, path validated on read
  show_save_dialog: SecurityLevel.Public, // UI operation, path validated on write

  // XLSX operations (hand-written Tauri wrappers for file I/O)
  import_xlsx: SecurityLevel.Sensitive,
  export_xlsx: SecurityLevel.Sensitive,

  // XLSX operations (bridge-generated parser commands)
  xlsx_parse_full: SecurityLevel.Sensitive,
  xlsx_parse_full_profiled: SecurityLevel.Sensitive,
  xlsx_parse_lazy: SecurityLevel.Sensitive,
  xlsx_parse_lazy_with_mode: SecurityLevel.Sensitive,
  xlsx_version: SecurityLevel.Sensitive,
  xlsx_export: SecurityLevel.Sensitive,

  // Public commands
  get_app_version: SecurityLevel.Public,
  init_security_session: SecurityLevel.Public,
  biometric_status: SecurityLevel.Public,
};

/**
 * Check if we're in development mode.
 * In dev mode, we skip security requirements to avoid HMR issues.
 *
 * Detection strategy (in order):
 * 1. Vite's import.meta.env.DEV (most reliable in Vite context)
 * 2. import.meta.env.MODE === 'development'
 * 3. Check if URL contains localhost or 127.0.0.1 (fallback for HMR edge cases)
 * 4. Node.js NODE_ENV (for SSR/test contexts)
 */
const isDevelopment: boolean = (() => {
  // Vite injects import.meta.env at build time
  try {
    // Use indirect eval to defer import.meta access, preventing Jest parse errors
    const getImportMeta = new Function('return import.meta');
    const meta = getImportMeta() as ImportMeta & { env?: { DEV?: boolean; MODE?: string } };
    if (meta.env?.DEV === true) return true;
    if (meta.env?.MODE === 'development') return true;
  } catch {
    // import.meta may not be available in all contexts (e.g., Jest, SSR)
  }

  // Fallback: check if running on localhost (dev server)
  if (typeof window !== 'undefined' && window.location) {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.')) {
      return true;
    }
  }

  // Node.js fallback
  if (isDev()) {
    return true;
  }

  return false;
})();

/**
 * Invoke a Tauri command with automatic security handling.
 *
 * - Ensures session is initialized (handles cold start race condition)
 * - Signs requests for Signed+ levels
 * - Biometric is handled by Rust middleware (NOT here!)
 * - In development mode, security is bypassed to avoid HMR issues
 *
 * @param command - The Tauri command name
 * @param params - Command parameters (passed directly to Rust)
 * @returns The command result
 * @throws Error if session initialization fails or command fails
 */
export async function secureInvoke<T, P extends Record<string, unknown> = Record<string, unknown>>(
  command: string,
  params: P = {} as P,
): Promise<T> {
  const level = COMMAND_LEVELS[command] ?? SecurityLevel.Verified;

  // Public commands don't need session initialization
  if (level === SecurityLevel.Public) {
    return invoke<T>(command, params as Record<string, unknown>);
  }

  // In development mode, skip security to avoid HMR session issues
  // The Rust backend keeps running while frontend reloads, causing
  // "Session already initialized" errors
  if (isDevelopment) {
    return invoke<T>(command, params as Record<string, unknown>);
  }

  // Ensure session is ready (handles race condition on cold start)
  await ensureSessionInitialized();

  // Add signature for Signed+ commands
  let invokeParams: Record<string, unknown> = { ...params };
  if (level >= SecurityLevel.Signed) {
    const { timestamp, nonce, signature } = await signRequest(command);
    invokeParams = { ...invokeParams, timestamp, nonce, signature };
  }

  // Pass params directly to Rust command
  return invoke<T>(command, invokeParams);
}

/**
 * Get the security level for a command.
 *
 * Useful for UI hints (e.g., showing a lock icon for Critical commands).
 *
 * @param command - The Tauri command name
 * @returns The security level (defaults to Verified for unknown commands)
 */
export function getCommandSecurityLevel(command: string): SecurityLevel {
  return COMMAND_LEVELS[command] ?? SecurityLevel.Verified;
}

/**
 * Check if a command requires biometric authentication.
 *
 * Use this for UI pre-prompts to prepare users for biometric verification.
 * Note: Actual enforcement is in Rust, this is just for UX.
 *
 * @param command - The Tauri command name
 * @returns true if the command requires biometric (Critical level)
 */
export function commandRequiresBiometric(command: string): boolean {
  return getCommandSecurityLevel(command) >= SecurityLevel.Critical;
}

/**
 * Check if a command requires audit logging.
 *
 * @param command - The Tauri command name
 * @returns true if the command is audited (Sensitive+ level)
 */
export function commandIsAudited(command: string): boolean {
  return getCommandSecurityLevel(command) >= SecurityLevel.Sensitive;
}

/**
 * Get human-readable description of a security level.
 */
export function getSecurityLevelDescription(level: SecurityLevel): string {
  switch (level) {
    case SecurityLevel.Public:
      return 'Public - no authentication required';
    case SecurityLevel.Signed:
      return 'Signed - request signature required';
    case SecurityLevel.Verified:
      return 'Verified - signature + window verification';
    case SecurityLevel.Protected:
      return 'Protected - verified + rate limiting';
    case SecurityLevel.Sensitive:
      return 'Sensitive - protected + audit logging';
    case SecurityLevel.Critical:
      return 'Critical - sensitive + biometric confirmation';
    default:
      return 'Unknown security level';
  }
}
