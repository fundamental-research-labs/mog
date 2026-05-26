/**
 * Shell Host Infrastructure - Public Exports
 *
 * Provides the core hosting infrastructure for apps:
 * - ShellHost: Main layout component
 * - AppSlot: App rendering with error isolation
 * - Hooks: useAppComponent, useAppManifests
 * - Setup: ensureAppTables
 *
 */

// Components
export { AppBindingEditor } from './AppBindingEditor';
export { AppCrashedState } from './AppCrashedState';
export { AppLoader } from './AppLoader';
export { AppLoading } from './AppLoading';
export { AppSetupDialog } from './AppSetupDialog';
export { AppSlot } from './AppSlot';
export { ColumnMapper } from './ColumnMapper';
export { ErrorBoundary } from './ErrorBoundary';
export { ShellHost } from './ShellHost';
export { TablePicker } from './TablePicker';

// Hooks
export { useAppComponent } from './hooks/useAppComponent';
export { useAppManifest, useAppManifests } from './hooks/useAppManifests';

// Setup utilities
export { createManagedTables, ensureAppTables, resolveBindings } from './app-setup';

// Types (re-export from props)
export type { AppBindingEditorProps } from './AppBindingEditor';
export type { AppCrashedStateProps } from './AppCrashedState';
export type { AppLoaderProps } from './AppLoader';
export type { AppLoadingProps } from './AppLoading';
export type { AppSetupDialogProps, SetupMode } from './AppSetupDialog';
export type { AppSlotProps } from './AppSlot';
export type { ColumnMapperProps } from './ColumnMapper';
export type { ErrorBoundaryProps } from './ErrorBoundary';
export type { FileExplorerConfig, ShellHostProps } from './ShellHost';
export type { TablePickerProps } from './TablePicker';
