/**
 * Shell Context
 *
 * Provides shell-level (app-wide) state and service access.
 * This is separate from document-level context in @mog/spreadsheet.
 *
 * Available contexts:
 * - ShellStoreContext: App-wide UI state (navigation, record detail, project)
 * - PlatformContext: Platform abstraction (dialogs, filesystem, shell)
 * - ProjectServiceContext: Project management business logic
 *
 * Usage:
 * ```tsx
 * // At app root
 * <ShellProvider store={store}>
 *   <PlatformProvider platform={platform}>
 *     <ProjectServiceProvider>
 *       <App />
 *     </ProjectServiceProvider>
 *   </PlatformProvider>
 * </ShellProvider>
 *
 * // In components
 * const projectPath = useShellStore((s) => s.projectPath);
 * const platform = usePlatform();
 * const projectService = useProjectService();
 * ```
 */

// =============================================================================
// Shell Store Context
// =============================================================================

export { ShellStoreContext, useShellStore, useShellStoreApi } from './shell-store-context';

// =============================================================================
// Platform Context
// =============================================================================

export {
  PlatformProvider,
  usePlatform,
  usePlatformOptional,
  type PlatformProviderProps,
} from './platform-context';

// =============================================================================
// Project Service Context
// =============================================================================

export {
  ProjectServiceProvider,
  useProjectService,
  useProjectServiceOptional,
  type ProjectServiceProviderProps,
} from './project-service-context';

// =============================================================================
// DocumentManager Context
// =============================================================================

export {
  DocumentManagerProvider,
  useDocumentManager,
  useDocumentManagerOptional,
  type DocumentManagerProviderProps,
} from './document-manager-context';

// =============================================================================
// Shell Service Context (shell-service facade)
// =============================================================================

export {
  ShellServiceProvider,
  useShellService,
  useShellServiceOptional,
  type ShellServiceProviderProps,
} from './shell-service-context';

// =============================================================================
// Platform Identity Context
// =============================================================================

export { PlatformIdentityProvider, usePlatformIdentity } from './platform-identity-context';

// =============================================================================
// Capability Context
// =============================================================================

export {
  CapabilityContext,
  CapabilityProvider,
  useAppCapabilities,
  useCapabilityContext,
  useCapabilityContextOptional,
  useHasCapability,
  type CapabilityContextValue,
  type CapabilityProviderProps,
} from './capability-context';
