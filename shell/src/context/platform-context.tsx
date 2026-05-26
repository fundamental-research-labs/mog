/**
 * Platform Context
 *
 * Provides the platform abstraction (IPlatform) to React components.
 * The platform provides access to:
 * - Filesystem operations
 * - Native dialogs
 * - System notifications
 * - Clipboard
 * - Shell operations (open URLs, reveal in file manager, window control)
 *
 * Usage:
 * ```tsx
 * import { PlatformProvider, usePlatform } from './context';
 * import { TauriPlatform } from '@mog/platform';
 *
 * // At app root
 * const platform = new TauriPlatform();
 * <PlatformProvider platform={platform}>
 *   <App />
 * </PlatformProvider>
 *
 * // In any component
 * const platform = usePlatform();
 * await platform.dialogs.showOpenDialog({ title: 'Open File' });
 * ```
 *
 * @see contracts/src/platform/types.ts for IPlatform interface
 * @see infra/platform/tauri/platform.ts for TauriPlatform implementation
 */

import { createContext, useContext, type ReactNode } from 'react';
import type { IPlatform } from '@mog-sdk/contracts/platform';

// =============================================================================
// Context
// =============================================================================

const PlatformContext = createContext<IPlatform | null>(null);

// =============================================================================
// Provider
// =============================================================================

export interface PlatformProviderProps {
  /**
   * Platform instance to provide.
   * Create using TauriPlatform (desktop) or WebPlatform (browser).
   */
  platform: IPlatform;

  /**
   * Children to render.
   */
  children: ReactNode;
}

/**
 * Provider component that makes the platform available to all descendants.
 *
 * @example
 * ```tsx
 * import { TauriPlatform } from '@mog/platform';
 *
 * const platform = new TauriPlatform();
 *
 * function App() {
 *   return (
 *     <PlatformProvider platform={platform}>
 *       <MainLayout />
 *     </PlatformProvider>
 *   );
 * }
 * ```
 */
export function PlatformProvider({ platform, children }: PlatformProviderProps): React.JSX.Element {
  return <PlatformContext.Provider value={platform}>{children}</PlatformContext.Provider>;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook to access the platform abstraction.
 *
 * @returns The IPlatform instance
 * @throws Error if used outside of PlatformProvider
 *
 * @example
 * ```tsx
 * function FileOpenButton() {
 *   const platform = usePlatform();
 *
 *   const handleOpen = async () => {
 *     const path = await platform.dialogs.showOpenDialog({
 *       title: 'Open Spreadsheet',
 *       filters: [{ name: 'Spreadsheets', extensions: ['xlsx', 'xls'] }]
 *     });
 *     if (path) {
 *       // Open the file...
 *     }
 *   };
 *
 *   return <button onClick={handleOpen}>Open</button>;
 * }
 * ```
 */
export function usePlatform(): IPlatform {
  const platform = useContext(PlatformContext);
  if (!platform) {
    throw new Error('usePlatform must be used within PlatformProvider');
  }
  return platform;
}

// =============================================================================
// Optional Platform Hook
// =============================================================================

/**
 * Hook to optionally access the platform.
 * Returns null if not within a PlatformProvider.
 *
 * Useful for components that can work with or without platform functionality.
 *
 * @returns The IPlatform instance or null
 *
 * @example
 * ```tsx
 * function RevealButton({ path }: { path: string }) {
 *   const platform = usePlatformOptional();
 *
 *   if (!platform || platform.name !== 'desktop') {
 *     return null; // Only show on desktop
 *   }
 *
 *   return (
 *     <button onClick={() => platform.shell.revealInFileManager(path)}>
 *       Reveal in Finder
 *     </button>
 *   );
 * }
 * ```
 */
export function usePlatformOptional(): IPlatform | null {
  return useContext(PlatformContext);
}
