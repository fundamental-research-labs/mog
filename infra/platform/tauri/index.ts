/**
 * Tauri platform module for Spreadsheet OS.
 *
 * Provides native desktop functionality through Tauri:
 * - Full platform implementation (dialogs, notifications, clipboard, shell)
 * - File system access via native Rust commands
 * - Platform detection utilities
 * - Secure IPC invocation with automatic security handling
 * - Credential management via OS keychain
 *
 * SECURITY: All IPC commands use the unified `secureInvoke()` function which
 * handles HMAC signing, window verification, rate limiting, audit logging,
 * and biometric confirmation based on command security level.
 *
 * Biometric enforcement is in Rust middleware, NOT TypeScript.
 *
 * @example
 * ```ts
 * import {
 *   TauriPlatform,
 *   isTauri,
 *   secureInvoke,
 *   SecurityLevel,
 *   credentials,
 * } from './platform/tauri';
 *
 * if (isTauri()) {
 *   // Platform operations
 *   const platform = new TauriPlatform();
 *   const filePath = await platform.dialogs.showOpenDialog({ ... });
 *
 *   // Secure command invocation (automatic security handling)
 *   await secureInvoke('credential_store', { key: 'my_key', value: 'secret' });
 *
 *   // High-level APIs (use secureInvoke internally)
 *   await credentials.store('my_key', 'secret');
 * }
 * ```
 */

// Platform implementation
export { TauriPlatform } from './platform';

// Filesystem implementation
export { TauriFileSystem } from './filesystem';

// Platform detection
export { getPlatformName, isTauri, isWeb } from './detection';

// Secure invocation layer (primary API for IPC)
export {
  SecurityLevel,
  commandIsAudited,
  commandRequiresBiometric,
  getCommandSecurityLevel,
  getSecurityLevelDescription,
  secureInvoke,
} from './secure-invoke';

// Credentials (OS keychain)
export { credentials, type CredentialInfo } from './credentials';

// Security session (HMAC-based request signing)
export {
  createSecureApi,
  ensureSessionInitialized,
  initSecureSession,
  isSessionInitialized,
  signRequest,
  type SecureApi,
} from './security';

// Biometric authentication (for UI hints and custom flows)
export {
  BiometryType,
  biometric,
  checkStatus as biometricCheckStatus,
  isAvailable as biometricIsAvailable,
  type BiometricStatus,
} from './biometric';

// IPC contract types
export type {
  CopyFileParams,
  // Spreadsheet operations
  CreateEmptySpreadsheetParams,
  // Directory operations
  CreateFolderParams,
  DeletePathParams,
  DirectoryEntry,
  // Dialog types
  FileFilter,
  // Metadata types
  FileMetadata,
  GenerateUniqueFilenameParams,
  GenerateUniqueFolderNameParams,
  ImportFilesParams,
  OpenDialogParams,
  // File operations
  ReadFileParams,
  // Recent files
  RecentFile,
  RenamePathParams,
  SaveDialogParams,
  WriteFileParams,
} from './contracts';
