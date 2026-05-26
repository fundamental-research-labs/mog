/**
 * Shell Service Context
 *
 * Provides the {@link ShellService} document-lifecycle facade to React
 * components. The shell-service facade introduces this context as the typed
 * replacement for the `window.__SHELL__` documentManager /
 * projectService reach-arounds in app handler code.
 *
 * Composition order at app root:
 * ```tsx
 * <ShellProvider store={store}>
 *   <PlatformProvider platform={platform}>
 *     <DocumentManagerProvider documentManager={documentManager}>
 *       <ProjectServiceProvider projectService={projectService}>
 *         <ShellServiceProvider shellService={shellService}>
 *           <App />
 *         </ShellServiceProvider>
 *       </ProjectServiceProvider>
 *     </DocumentManagerProvider>
 *   </PlatformProvider>
 * </ShellProvider>
 * ```
 *
 * @see services/shell-service.ts for `createShellService()`.
 */

import { createContext, useContext, type ReactNode } from 'react';
import type { ShellService } from '@mog-sdk/types-document/shell/types';

const ShellServiceContext = createContext<ShellService | null>(null);

export interface ShellServiceProviderProps {
  /** Shell service instance from `createShellService()`. */
  shellService: ShellService;

  children: ReactNode;
}

/**
 * Provider that makes the shell service available to all descendants.
 */
export function ShellServiceProvider({
  shellService,
  children,
}: ShellServiceProviderProps): React.JSX.Element {
  return (
    <ShellServiceContext.Provider value={shellService}>{children}</ShellServiceContext.Provider>
  );
}

/**
 * Hook to access the shell service.
 *
 * @throws Error if used outside of `ShellServiceProvider`.
 */
export function useShellService(): ShellService {
  const service = useContext(ShellServiceContext);
  if (!service) {
    throw new Error('useShellService must be used within ShellServiceProvider');
  }
  return service;
}

/**
 * Optional variant — returns `null` outside the provider. Useful for code
 * that can degrade gracefully (e.g. test harnesses).
 */
export function useShellServiceOptional(): ShellService | null {
  return useContext(ShellServiceContext);
}
