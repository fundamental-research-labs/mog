/**
 * Extension Panel Hook
 *
 * Manages the extension panel state and provides keyboard shortcuts.
 * Integrates with the extension store for state persistence.
 *
 * Features:
 * - Panel visibility toggle
 * - Panel width management with min/max constraints
 * - Persistence via extension store
 *
 * Note: Keyboard shortcut (Ctrl/Cmd+Shift+E) is now handled by the
 * KeyboardCoordinator via the TOGGLE_EXTENSION_PANEL action.
 *
 * @module hooks/use-extension-panel
 */

import { useCallback, useMemo } from 'react';

import { useExtensionStore } from '../../infra/state/extension-store';

// =============================================================================
// Types
// =============================================================================

export interface UseExtensionPanelReturn {
  /** Whether the panel is currently visible */
  isVisible: boolean;
  /** Current panel width in pixels */
  panelWidth: number;
  /** Whether the panel is currently being resized */
  isResizing: boolean;
  /** List of all registered extensions */
  extensions: ReturnType<typeof useExtensionStore.getState>['extensions'] extends Map<
    string,
    infer T
  >
    ? T[]
    : never;
  /** Currently active extension ID */
  activeExtensionId: string | null;
  /** Show the extension panel */
  showPanel: () => void;
  /** Hide the extension panel */
  hidePanel: () => void;
  /** Toggle panel visibility */
  togglePanel: () => void;
  /** Set the panel width (clamped to min/max) */
  setPanelWidth: (width: number) => void;
  /** Set whether the panel is being resized */
  setIsResizing: (isResizing: boolean) => void;
  /** Select an extension to display */
  selectExtension: (extensionId: string | null) => void;
}

// =============================================================================
// Hook Implementation
// =============================================================================

export function useExtensionPanel(): UseExtensionPanelReturn {
  // Store state
  const isVisible = useExtensionStore((s) => s.panelVisible);
  const panelWidth = useExtensionStore((s) => s.panelWidth);
  const isResizing = useExtensionStore((s) => s.isResizing);
  const activeExtensionId = useExtensionStore((s) => s.activeExtensionId);

  // Get extensions as array - use stable reference to avoid infinite loop
  // The extensions Map is stable, so we memoize the array conversion
  const extensionsMap = useExtensionStore((s) => s.extensions);
  const extensions = useMemo(() => Array.from(extensionsMap.values()), [extensionsMap]);

  // Store actions
  const showPanel = useExtensionStore((s) => s.showPanel);
  const hidePanel = useExtensionStore((s) => s.hidePanel);
  const togglePanel = useExtensionStore((s) => s.togglePanel);
  const setPanelWidth = useExtensionStore((s) => s.setPanelWidth);
  const setIsResizing = useExtensionStore((s) => s.setIsResizing);
  const setActiveExtension = useExtensionStore((s) => s.setActiveExtension);

  // Wrap setActiveExtension for consistent naming
  const selectExtension = useCallback(
    (extensionId: string | null) => {
      setActiveExtension(extensionId);
    },
    [setActiveExtension],
  );

  // Keyboard shortcut (Ctrl/Cmd+Shift+E) is now handled by the KeyboardCoordinator
  // via the TOGGLE_EXTENSION_PANEL action registered in the shortcut registry.

  return {
    isVisible,
    panelWidth,
    isResizing,
    extensions,
    activeExtensionId,
    showPanel,
    hidePanel,
    togglePanel,
    setPanelWidth,
    setIsResizing,
    selectExtension,
  };
}
