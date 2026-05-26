/**
 * Platform Identity Context
 *
 * Provides the static PlatformIdentity to React components.
 * PlatformIdentity is created once at boot and never changes —
 * it answers "what OS?" and "desktop or web?" without sniffing
 * navigator.platform at render time.
 *
 * Usage:
 * ```tsx
 * import { PlatformIdentityProvider, usePlatformIdentity } from './context';
 *
 * // At app root (value created during shell bootstrap)
 * <PlatformIdentityProvider value={platformIdentity}>
 *   <App />
 * </PlatformIdentityProvider>
 *
 * // In any component
 * const id = usePlatformIdentity();
 * if (id.os === 'macos') { ... }
 * ```
 *
 * @see contracts/src/platform/identity.ts for PlatformIdentity interface
 * @see infra/platform/identity.ts for createPlatformIdentity() factory
 */

import { createContext, useContext } from 'react';
import type { PlatformIdentity } from '@mog-sdk/contracts/platform';

const PlatformIdentityContext = createContext<PlatformIdentity | null>(null);

export const PlatformIdentityProvider = PlatformIdentityContext.Provider;

/**
 * Hook to access the platform identity.
 *
 * @returns The frozen PlatformIdentity created at boot
 * @throws Error if used outside of PlatformIdentityProvider
 */
export function usePlatformIdentity(): PlatformIdentity {
  const id = useContext(PlatformIdentityContext);
  if (!id) {
    throw new Error('usePlatformIdentity: missing PlatformIdentityProvider');
  }
  return id;
}
