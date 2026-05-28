/**
 * @mog/shell - OS Shell Layer
 *
 * The Shell provides two categories of functionality:
 *
 * 1. OS Infrastructure (app loading, host, focus, navigation):
 *    - App Loading: App registry, lifecycle, manifest loading
 *    - Host Infrastructure: ShellHost, AppSlot, ErrorBoundary
 *    - Generic UI: Dialog, Button, Input, Select, and other primitives
 *    - Focus Machine: Window-level focus management
 *    - Shell Store: App-wide navigation state
 *
 * 2. Reusable View Components (shared across apps):
 *    - Views: Grid (SheetView), Kanban, Timeline, Calendar, Gallery, Form (planned)
 *    - Views are imperative, framework-agnostic rendering components
 *    - Apps and embed both consume views from shell
 *
 * Spreadsheet-specific interactive state (coordinator, actions, XState machines,
 * selection, editor, clipboard) lives in @mog/spreadsheet, NOT here.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// Generic UI Components
// ═══════════════════════════════════════════════════════════════════════════════
export * from './components/ui';

// ═══════════════════════════════════════════════════════════════════════════════
// Shell Components
// ═══════════════════════════════════════════════════════════════════════════════
// NOTE: Shell, ViewSwitcher, CommandPalette moved to @mog/spreadsheet
// Shell package now only provides generic UI primitives

// ═══════════════════════════════════════════════════════════════════════════════
// App Infrastructure
// ═══════════════════════════════════════════════════════════════════════════════
export type { AppComponent, AppLoader, AppProps, AppRegistry, AppRegistryEntry } from './apps';

// ═══════════════════════════════════════════════════════════════════════════════
// Host Infrastructure
// ═══════════════════════════════════════════════════════════════════════════════
export {
  AppCrashedState,
  AppLoader as AppLoaderComponent,
  AppLoading,
  AppSlot,
  ErrorBoundary,
  ShellHost,
  ensureAppTables,
  useAppComponent,
  useAppManifest,
  useAppManifests,
} from './host';
export type {
  AppCrashedStateProps,
  AppLoaderProps,
  AppLoadingProps,
  AppSlotProps,
  ErrorBoundaryProps,
  FileExplorerConfig,
  ShellHostProps,
} from './host';

// ═══════════════════════════════════════════════════════════════════════════════
// File Explorer Components
// ═══════════════════════════════════════════════════════════════════════════════
export {
  DeleteConfirmDialog,
  FileContextMenu,
  FileExplorer,
  FileIcon,
  FileTree,
  FileTreeItem,
} from './components/files';
export type {
  DeleteConfirmDialogProps,
  FileContextMenuProps,
  FileExplorerProps,
  FileTreeContextMenuProps,
  FileTreeItemProps,
  ProjectFileEntry,
} from './components/files';

// ═══════════════════════════════════════════════════════════════════════════════
// Settings Components
// ═══════════════════════════════════════════════════════════════════════════════
export { AppPermissionsSettings, SettingsDialog } from './components/settings';
export type { AppPermissionsSettingsProps, SettingsDialogProps } from './components/settings';

// ═══════════════════════════════════════════════════════════════════════════════
// Capability Components
// ═══════════════════════════════════════════════════════════════════════════════
export {
  CapabilityConsentDialog,
  CapabilityItem,
  RISK_CONFIGS,
  RiskBadge,
  RuntimeConsentDialog,
  getCapabilityIcon,
} from './components/capabilities';
export type {
  CapabilityItemProps,
  ConsentDialogProps,
  RuntimeConsentDialogProps,
} from './components/capabilities';

// ═══════════════════════════════════════════════════════════════════════════════
// App Launcher
// ═══════════════════════════════════════════════════════════════════════════════
export {
  TRUSTED_FIRST_PARTY_APPS,
  canLaunchWithoutConsent,
  getCapabilitiesRequiringConsent,
  launchApp,
} from './app-launcher';
export type {
  AppLaunchResult,
  ConsentRequest,
  ConsentResult,
  CreateGatedApiFn,
  LaunchAppOptions,
  ShowConsentDialogFn,
} from './app-launcher';

// ═══════════════════════════════════════════════════════════════════════════════
// TitleBar Components
// ═══════════════════════════════════════════════════════════════════════════════
export { TitleBar } from './components/titlebar';
export type { TitleBarProps } from './components/titlebar';

// App Switcher
export { AppSwitcher } from './apps/AppSwitcher';

// ═══════════════════════════════════════════════════════════════════════════════
// Focus Machine
// ═══════════════════════════════════════════════════════════════════════════════
export {
  FocusEvents,
  MAX_STACK_DEPTH,
  focusMachine,
  getCurrentLayerType,
  getFocusSnapshot,
} from './machines/focus-machine';
export type {
  FocusActor,
  FocusContext,
  FocusEvent,
  FocusLayer,
  FocusLayerType,
  FocusMachine,
  FocusSnapshot,
  FocusState,
} from './machines/focus-machine';

// ═══════════════════════════════════════════════════════════════════════════════
// Shell Store (App-wide navigation state)
// ═══════════════════════════════════════════════════════════════════════════════
export { createShellStore } from './ui-store/shell-store';
export type { ShellStoreApi, ShellUIState } from './ui-store/shell-store';

// ═══════════════════════════════════════════════════════════════════════════════
// Portal Container (CSS scoping boundary for portaled content)
// ═══════════════════════════════════════════════════════════════════════════════
export { PortalContainerProvider, usePortalContainer } from './contexts/PortalContainerContext';

// ═══════════════════════════════════════════════════════════════════════════════
// Shell Context (App-wide state access)
// ═══════════════════════════════════════════════════════════════════════════════
export {
  CapabilityContext,
  CapabilityProvider,
  DocumentManagerProvider,
  PlatformProvider,
  ProjectServiceProvider,
  ShellServiceProvider,
  ShellStoreContext,
  useAppCapabilities,
  useCapabilityContext,
  useCapabilityContextOptional,
  useDocumentManager,
  useDocumentManagerOptional,
  useHasCapability,
  usePlatform,
  usePlatformOptional,
  useProjectService,
  useProjectServiceOptional,
  useShellService,
  useShellServiceOptional,
  useShellStore,
  useShellStoreApi,
  PlatformIdentityProvider,
  usePlatformIdentity,
  type CapabilityContextValue,
  type CapabilityProviderProps,
  type DocumentManagerProviderProps,
  type PlatformProviderProps,
  type ProjectServiceProviderProps,
  type ShellServiceProviderProps,
} from './context';

// ═══════════════════════════════════════════════════════════════════════════════
// Collab Services
// ═══════════════════════════════════════════════════════════════════════════════
export {
  resolveCollabRoom,
  type CollabConfig,
  type CollabRoomConfig,
  type CollabUserIdentity,
} from './services/collab-room';

// ═══════════════════════════════════════════════════════════════════════════════
// Capability Runtime
// ═══════════════════════════════════════════════════════════════════════════════
export {
  InMemoryShellCapabilityAuditLog,
  InMemoryShellCapabilityRegistry,
  createPermissiveShellCapabilityRegistry,
  createShellCapabilityAuditLog,
  createShellCapabilityRegistry,
  type ShellCapabilityAuditLog,
  type ShellCapabilityAuditOptions,
  type ShellCapabilityRegistry,
  type ShellCapabilityRegistryOptions,
} from './services/capabilities';

// ═══════════════════════════════════════════════════════════════════════════════
// Shell Service (shell-service facade)
// ═══════════════════════════════════════════════════════════════════════════════
export { createShellService } from './services/shell-service';
export type { ShellServiceDeps } from './services/shell-service';

// ═══════════════════════════════════════════════════════════════════════════════
// Hooks
// ═══════════════════════════════════════════════════════════════════════════════
export {
  CapabilityRequesterContext,
  useAppKernel,
  useCapabilityRequester,
  useCapabilityRequesterContext,
  useDocument,
  useFileExplorerConfig,
  useNativeMenu,
  useOpenProjectDialog,
  usePlatformInfo,
  type PlatformInfo,
  type UseAppKernelDeps,
  type UseAppKernelResult,
  type UseCapabilityRequesterOptions,
  type UseCapabilityRequesterResult,
  type UseDocumentResult,
  type UseFileExplorerConfigOptions,
} from './hooks';
export type { MenuAction, MenuHandlers } from './hooks/use-native-menu';

// ═══════════════════════════════════════════════════════════════════════════════
// Shell Bootstrap (initializes shell BEFORE React)
// ═══════════════════════════════════════════════════════════════════════════════
export { createEventDispatcher, createShell } from './bootstrap';
export type {
  EventDispatcher,
  EventDispatcherDeps,
  ShellBootstrapCapabilityRegistry,
  ShellBootstrapConfig,
  ShellBootstrapResult,
  ShellEventHandlers,
} from './bootstrap';

// ═══════════════════════════════════════════════════════════════════════════════
// Lifecycle state.
// ═══════════════════════════════════════════════════════════════════════════════
export {
  markBootResolutionTerminal,
  markLifecycleHooksRegistered,
  setActiveDocsProvider,
  readBootResolutionTerminal,
  readLifecycleHooksRegistered,
  readHasAnyAppendActive,
  type LifecycleDocSnapshot,
} from './services/lifecycle-state';

export {
  attachImportedPivotMetadata,
  extractImportedPivotMetadata,
  getImportedPivotMetadata,
} from './services/document/imported-pivot-metadata';
export type {
  ImportedPivotFieldMetadata,
  ImportedPivotMetadataSet,
  ImportedPivotRange,
  ImportedPivotTableMetadata,
} from './services/document/imported-pivot-metadata';
