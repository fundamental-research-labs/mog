/**
 * ExtensionPanelContainer
 *
 * Container component that orchestrates extension panel state and renders ExtensionPanel.
 * Extracts extension panel logic from SpreadsheetContent.tsx for better separation of concerns.
 *
 * This container:
 * - Uses the useExtensionPanel hook for panel state management
 * - Uses the extension store for extension state callbacks
 * - Renders ExtensionPanel with ExtensionHostContainer as child
 *
 * Extract Panel Containers
 */

import { useCallback, useEffect } from 'react';
import { ExtensionHostContainer } from '../../dialogs/coordinator-dialogs';
import { ExtensionPanel } from '../../extensions/components';
import type { ExtensionLifecycleState } from '../../extensions/types';
import { useExtensionPanel } from '../../hooks/settings/use-extension-panel';
import { useExtensionStore } from '../../infra/state/extension-store';

// =============================================================================
// Types
// =============================================================================

export interface ExtensionPanelContainerProps {
  /**
   * Whether to show the extension panel feature.
   * When true, the panel can be toggled via keyboard shortcut.
   */
  showExtensionPanel: boolean;
}

// =============================================================================
// Component
// =============================================================================

/**
 * Container component that manages extension panel state and rendering.
 * Must be rendered inside SpreadsheetCoordinatorProvider for ExtensionHostContainer.
 */
export function ExtensionPanelContainer({
  showExtensionPanel,
}: ExtensionPanelContainerProps): React.JSX.Element | null {
  // Extension panel hook (Plugin Support)
  const {
    isVisible: extensionPanelVisible,
    panelWidth: extensionPanelWidth,
    isResizing: extensionPanelResizing,
    extensions,
    activeExtensionId,
    showPanel: showExtensionPanelFn,
    hidePanel: hideExtensionPanelFn,
    setPanelWidth: setExtensionPanelWidth,
    setIsResizing: setExtensionPanelResizing,
    selectExtension,
  } = useExtensionPanel();

  // Extension store actions for ExtensionHost callbacks
  const setExtensionState = useExtensionStore((s) => s.setExtensionState);
  const setExtensionSession = useExtensionStore((s) => s.setExtensionSession);

  // Get active extension instance for ExtensionHost
  const activeExtension = extensions.find((ext) => ext.manifest.id === activeExtensionId);

  // Extension state change handler
  const handleExtensionStateChange = useCallback(
    (state: ExtensionLifecycleState, error?: string | null) => {
      if (activeExtensionId) {
        setExtensionState(activeExtensionId, state, error);
      }
    },
    [activeExtensionId, setExtensionState],
  );

  // Extension session established handler
  const handleExtensionSessionEstablished = useCallback(
    (sessionId: string) => {
      if (activeExtensionId) {
        setExtensionSession(activeExtensionId, sessionId);
      }
    },
    [activeExtensionId, setExtensionSession],
  );

  // Show extension panel when prop changes
  useEffect(() => {
    if (showExtensionPanel && extensions.length > 0) {
      showExtensionPanelFn();
    }
  }, [showExtensionPanel, extensions.length, showExtensionPanelFn]);

  // Don't render if extension panel feature is disabled
  if (!showExtensionPanel) {
    return null;
  }

  return (
    <ExtensionPanel
      visible={extensionPanelVisible}
      width={extensionPanelWidth}
      isResizing={extensionPanelResizing}
      extensions={extensions}
      activeExtensionId={activeExtensionId}
      onVisibilityChange={(visible) => (visible ? showExtensionPanelFn() : hideExtensionPanelFn())}
      onWidthChange={setExtensionPanelWidth}
      onResizeChange={setExtensionPanelResizing}
      onSelectExtension={selectExtension}
    >
      {/* ExtensionHost renders the iframe and handles handshake */}
      {activeExtension && (
        <ExtensionHostContainer
          extension={activeExtension}
          onStateChange={handleExtensionStateChange}
          onSessionEstablished={handleExtensionSessionEstablished}
        />
      )}
    </ExtensionPanel>
  );
}
