/**
 * Platform abstraction module for Spreadsheet OS.
 *
 * Provides a unified platform API that abstracts over desktop (Tauri) and
 * web environments. Use the `createPlatform` factory to get the appropriate
 * implementation for the current runtime environment.
 *
 * @example
 * ```ts
 * import { createPlatform, isTauri } from './platform';
 *
 * // Auto-detect and create platform
 * const platform = await createPlatform(filesystem);
 *
 * // Use platform APIs uniformly
 * const filePath = await platform.dialogs.showOpenDialog({
 *   title: 'Open Spreadsheet',
 *   filters: [{ name: 'Spreadsheets', extensions: ['xlsx'] }],
 * });
 *
 * if (filePath) {
 *   const content = await platform.filesystem.read(filePath as FilePath);
 * }
 *
 * // Check platform type
 * if (platform.name === 'desktop') {
 *   platform.shell.minimize?.();
 * }
 * ```
 */

import type { IFileSystem } from '@mog-sdk/contracts/filesystem';
import type { IPlatform } from '@mog-sdk/contracts/platform';
import { isTauri } from './tauri/detection';

/**
 * Create the appropriate platform for the current environment.
 *
 * Automatically detects whether running in Tauri (desktop) or browser (web)
 * and returns the corresponding platform implementation.
 *
 * @param webFilesystem - Required for web platform. Not used for desktop platform.
 * @returns Platform instance appropriate for the current environment
 * @throws Error if running in web without providing a filesystem
 *
 * @example
 * ```ts
 * // Desktop (Tauri)
 * const platform = await createPlatform();
 * // Returns TauriPlatform with native filesystem
 *
 * // Web (requires an injected filesystem)
 * const platform = await createPlatform(filesystem);
 * // Returns WebPlatform with the provided filesystem
 * ```
 */
export async function createPlatform(webFilesystem?: IFileSystem): Promise<IPlatform> {
  if (isTauri()) {
    const { TauriPlatform } = await import('./tauri/platform');
    return new TauriPlatform();
  }

  if (!webFilesystem) {
    throw new Error('Filesystem required for web platform');
  }

  const { WebPlatform } = await import('./web/platform');
  return new WebPlatform(webFilesystem);
}

/**
 * Get the current platform name.
 *
 * @returns 'desktop' for Tauri, 'web' for browser
 */
export function getPlatformName(): 'desktop' | 'web' {
  return isTauri() ? 'desktop' : 'web';
}

/**
 * Platform-owned wall-clock source for production code that needs Unix ms.
 *
 * Keep direct wall-clock reads at platform boundaries; application and domain
 * modules should receive this as an injected dependency.
 */
export function wallClockNow(): number {
  return Date.now();
}

// Re-exports for convenience
export type { IPlatform } from '@mog-sdk/contracts/platform';
export { isTauri, isWeb } from './tauri/detection';

// Platform identity
export { createPlatformIdentity, createTestPlatformIdentity } from './identity';
export type { PlatformIdentity } from '@mog-sdk/contracts/platform';

// SDK / platform errors
export {
  AddonNotFoundError,
  EngineInitError,
  HydrationError,
  SdkError,
  UnsupportedPlatformError,
} from './errors';
