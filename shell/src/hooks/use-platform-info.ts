/**
 * Platform Info Hook
 *
 * Derives platform information from PlatformIdentity (created at boot).
 * Used for platform-specific UI adjustments like:
 * - macOS traffic light spacer in title bar
 * - Windows window controls
 * - Desktop-only features
 *
 * @example
 * ```tsx
 * function TitleBar() {
 *   const { isDesktop, isMacOS } = usePlatformInfo();
 *
 *   return (
 *     <header>
 *       {isDesktop && isMacOS && <TrafficLightSpacer />}
 *       <Title />
 *     </header>
 *   );
 * }
 * ```
 */

import { useMemo } from 'react';

import { usePlatformIdentity } from '../context/platform-identity-context';

// =============================================================================
// Types
// =============================================================================

export interface PlatformInfo {
  /** Whether running in Tauri desktop environment */
  isDesktop: boolean;

  /** Whether running in web browser */
  isWeb: boolean;

  /** Whether the OS is macOS (for traffic light spacer) */
  isMacOS: boolean;

  /** Whether the OS is Windows (for window controls) */
  isWindows: boolean;

  /** Whether the OS is Linux */
  isLinux: boolean;

  /** Platform name for display purposes */
  platformName: 'desktop' | 'web';
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook to get platform information.
 *
 * Derives all fields from PlatformIdentity which is created once at boot.
 * Returns stable references (memoized) since platform identity never changes.
 */
export function usePlatformInfo(): PlatformInfo {
  const id = usePlatformIdentity();

  return useMemo(
    () => ({
      isDesktop: id.runtime === 'desktop',
      isWeb: id.runtime === 'web',
      isMacOS: id.os === 'macos',
      isWindows: id.os === 'windows',
      isLinux: id.os === 'linux',
      platformName: id.runtime,
    }),
    [id],
  );
}
