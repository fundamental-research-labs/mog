/**
 * ShellHost - Main layout component for the Spreadsheet OS
 *
 * Provides the top-level layout structure with:
 * - Header (app title, document info)
 * - Toolbar (formatting, etc.) - placeholder for future
 * - Sidebar with App Logo Switcher and File Explorer
 * - Main app slot for rendering the active app
 *
 * Layout:
 * ┌─────────────────────────────────────────────┐
 * │ Header (app title, document info)           │
 * ├─────────────────────────────────────────────┤
 * │ Toolbar (formatting, etc.)                  │
 * ├──────────┬──────────────────────────────────┤
 * │ [Logo]   │                                  │
 * │ ────────-│                                  │
 * │ File     │  AppSlot (active app)            │
 * │ Explorer │                                  │
 * │          │                                  │
 * └──────────┴──────────────────────────────────┘
 *
 * The App Logo shows the current app's icon. On hover, it expands to show
 * all available apps for quick switching.
 *
 */

import React, { useState } from 'react';

import type { IAppKernelAPI } from '@mog-sdk/contracts/apps';
import type { FeatureGates } from '@mog-sdk/contracts/feature-gates';
import { ChevronLeft, ChevronRight, Settings } from 'lucide-react';
import type { AppAppearanceMode } from '../apps/types';
import { AppLogoSwitcher } from '../apps/AppLogoSwitcher';
import { FileExplorer, type ProjectFileEntry } from '../components/files';
import { TitleBar } from '../components/titlebar';
import { useShellStore } from '../context';
import { PortalContainerProvider } from '../contexts/PortalContainerContext';
import { AppSlot } from './AppSlot';

/** Props for the FileExplorer in the sidebar */
export interface FileExplorerConfig {
  /** Project/workspace name shown at top */
  projectName: string | null;
  /** Project root path */
  projectPath: string | null;
  /** File tree to display */
  fileTree: ProjectFileEntry[];
  /** Currently active file path */
  activeFilePath: string | null;
  /** Called when a file is clicked */
  onFileClick: (path: string) => void;
  /** Called when a folder is toggled */
  onToggleFolder: (path: string) => void;
  /** Called to refresh the file tree */
  onRefresh: () => void;
  /** Optional: Called when rename is requested */
  onRename?: (path: string, newName: string) => Promise<void>;
  /** Optional: Called when delete is requested */
  onDelete?: (path: string) => Promise<void>;
  /** Optional: Called when new file is requested */
  onNewSpreadsheet?: (folderPath: string | null) => Promise<void>;
  /** Optional: Called when new folder is requested */
  onNewFolder?: (parentPath: string) => Promise<void>;
  /** Optional: Called to reveal in system file manager */
  onRevealInFinder?: (path: string) => Promise<void>;
}

export interface ShellHostProps {
  /**
   * App Kernel API instance for data operations.
   * NOTE: Some apps (like SpreadsheetApp) manage their own documents and
   * will ignore this kernel. Other apps (CRM, etc.) use this kernel.
   */
  kernel: IAppKernelAPI;

  /** Optional custom header component (renders default if not provided, pass null to hide) */
  header?: React.ReactNode;

  /** Callback when user clicks the settings gear button */
  onOpenSettings?: () => void;

  /** Whether to show the app switcher sidebar (default: true) */
  showAppSwitcher?: boolean;

  /** Whether to show the file explorer in sidebar (default: true) */
  showFileExplorer?: boolean;

  /** File explorer configuration - required if showFileExplorer is true */
  fileExplorer?: FileExplorerConfig;

  /** Additional chrome components (toolbar, etc.) */
  children?: React.ReactNode;

  /**
   * Custom loading fallback passed to AppSlot. Replaces the default
   * AppLoading spinner so embedders can show a seamless skeleton
   * (e.g. SpreadsheetSkeleton) without a jarring visual transition.
   */
  loadingFallback?: React.ReactNode;

  /**
   * Feature gates config passed through to the active app.
   * Controls which UI features (tabs, groups, capabilities) are shown/hidden.
   */
  featureGates?: FeatureGates;

  /** Host-owned app chrome appearance mode. */
  appearanceMode?: AppAppearanceMode;

  /** Called when the active app changes the host-owned appearance mode. */
  onAppearanceModeChange?: (mode: AppAppearanceMode) => void;
}

// =============================================================================
// Default Header Component
// =============================================================================

interface DefaultHeaderProps {
  onOpenSettings?: () => void;
}

/**
 * SettingsButton - Gear icon button for opening settings
 */
function SettingsButton({ onClick }: { onClick?: () => void }): React.JSX.Element | null {
  if (!onClick) return null;

  return (
    <button
      className="flex h-7 w-7 items-center justify-center rounded text-ss-text-secondary transition-colors hover:bg-ss-surface-hover hover:text-ss-text"
      onClick={onClick}
      aria-label="Settings"
      title="Settings"
    >
      <Settings className="h-4 w-4" />
    </button>
  );
}

/**
 * DefaultHeader - Window title bar with drag support
 *
 * Features:
 * - Click and drag to move window (Tauri desktop)
 * - Double-click to maximize/restore (Tauri desktop)
 * - macOS: Leaves space for traffic lights
 * - Settings button on the right
 */
function DefaultHeader({ onOpenSettings }: DefaultHeaderProps): React.JSX.Element {
  return <TitleBar trailing={<SettingsButton onClick={onOpenSettings} />} />;
}

/**
 * ShellHost - Top-level layout for Spreadsheet OS
 *
 * Architecture:
 * - Header renders at top (custom or default)
 * - Children render between header and content (for toolbar)
 * - Sidebar renders AppSwitcher for app navigation
 * - Main slot renders the active app based on ShellStore.activeAppId
 * - Apps are loaded lazily and isolated with error boundaries
 *
 * @example
 * ```tsx
 * <ShellHost kernel={kernel} header={<MyHeader />}>
 *   <Toolbar />
 * </ShellHost>
 * ```
 */
export function ShellHost({
  kernel,
  header,
  onOpenSettings,
  showAppSwitcher = true,
  showFileExplorer = true,
  fileExplorer,
  children,
  loadingFallback,
  featureGates,
  appearanceMode,
  onAppearanceModeChange,
}: ShellHostProps): React.JSX.Element {
  const activeAppId = useShellStore((s) => s.activeAppId);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => !prev);
  };

  // Determine what header to render:
  // - If header is explicitly null, render nothing
  // - If header is provided (ReactNode), render it
  // - Otherwise render DefaultHeader with settings callback
  const headerElement =
    header === null ? null : header !== undefined ? (
      header
    ) : (
      <DefaultHeader onOpenSettings={onOpenSettings} />
    );

  return (
    <div className="shell-host flex h-full w-full flex-col bg-white" data-mog-engine="">
      <PortalContainerProvider>
        {/* Header */}
        {headerElement}

        {/* Chrome components (toolbar, etc.) */}
        {children}

        {/* Content area: sidebar + main */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar with FileExplorer and/or AppSwitcher */}
          {(showFileExplorer || showAppSwitcher) && (
            <div className="flex flex-shrink-0">
              <aside
                className={`flex flex-shrink-0 flex-col overflow-visible border-r border-ss-border bg-ss-surface-secondary transition-[width] duration-200 ease-in-out ${sidebarCollapsed ? 'w-0 overflow-hidden border-r-0' : 'w-[220px]'}`}
              >
                <div className="flex h-full flex-col overflow-visible">
                  {/* App Logo Switcher - always at top when apps are enabled */}
                  {showAppSwitcher && <AppLogoSwitcher />}

                  {/* File Explorer - takes remaining space */}
                  {showFileExplorer && (
                    <div className="min-h-0 flex-1 overflow-auto">
                      <FileExplorer
                        projectName={fileExplorer?.projectName ?? null}
                        projectPath={fileExplorer?.projectPath ?? null}
                        fileTree={fileExplorer?.fileTree ?? []}
                        activeFilePath={fileExplorer?.activeFilePath ?? null}
                        onFileClick={fileExplorer?.onFileClick ?? (() => {})}
                        onToggleFolder={fileExplorer?.onToggleFolder ?? (() => {})}
                        onRefresh={fileExplorer?.onRefresh ?? (() => {})}
                        onRename={fileExplorer?.onRename}
                        onDelete={fileExplorer?.onDelete}
                        onNewSpreadsheet={fileExplorer?.onNewSpreadsheet}
                        onNewFolder={fileExplorer?.onNewFolder}
                        onRevealInFinder={fileExplorer?.onRevealInFinder}
                        isCollapsed={sidebarCollapsed}
                        onCollapse={toggleSidebar}
                      />
                    </div>
                  )}
                </div>
              </aside>
              <div
                className="flex w-5 flex-shrink-0 items-center"
                data-testid="shell-sidebar-collapse-rail"
              >
                <button
                  type="button"
                  className="flex h-10 w-5 cursor-pointer items-center justify-center rounded-r border border-l-0 border-ss-border bg-ss-surface-secondary text-ss-text-secondary transition-colors hover:bg-ss-surface-hover hover:text-ss-text active:bg-ss-surface-active"
                  onClick={toggleSidebar}
                  aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                  title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                >
                  {sidebarCollapsed ? (
                    <ChevronRight className="h-3 w-3" aria-hidden="true" />
                  ) : (
                    <ChevronLeft className="h-3 w-3" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Main content area */}
          <main className="shell-main relative min-h-0 min-w-0 flex-1 flex flex-col">
            <AppSlot
              kernel={kernel}
              appId={activeAppId}
              loadingFallback={loadingFallback}
              featureGates={featureGates}
              appearanceMode={appearanceMode}
              onAppearanceModeChange={onAppearanceModeChange}
            />
          </main>
        </div>
      </PortalContainerProvider>
    </div>
  );
}
