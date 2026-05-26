/**
 * PanelLayer Component
 *
 * Renders all side panel components for the SpreadsheetApp.
 * Panels are UI elements that slide in from the side and overlay
 * the main grid content without blocking it entirely.
 *
 * Architecture:
 * - Apps own their chrome - panels ARE chrome
 * - Single source of truth - all panels in one place
 * - Panels overlay the grid content (rendered inside grid container)
 * - Most panels self-manage visibility via internal state
 *
 * Panel Categories:
 * 1. Self-subscribing panels (handle their own visibility state):
 * - ChartEditorContainer - Chart editing when a chart is selected
 * - PivotFieldPanelContainer - Pivot table field management
 * - AccessibilityCheckerPanelContainer - Accessibility issue review
 *
 * 2. Registered panel contributions:
 * - Dev/test panels registered by trusted hosts
 * - Other workspace-private panels that should not be static production imports
 *
 * 3. Externally-controlled panels (visibility controlled via props):
 * - ExtensionPanelContainer - Add-in/extension hosting
 *
 */

import React from 'react';

// =============================================================================
// Chart Editor Panel
// =============================================================================
import { ChartEditorContainer } from '../../components/charts';

// =============================================================================
// Feature Panels
// =============================================================================
import {
  AccessibilityCheckerPanelContainer,
  ExtensionPanelContainer,
  PivotFieldPanelContainer,
  SchemaBrowserContainer,
  WorkbookLinksPanelContainer,
} from '../../components/panels';

// =============================================================================
// Chrome-symmetry side panels (issue #116)
// =============================================================================
import { CommentsPanel } from '../comments/CommentsPanel';
import { SidePanel } from '../side-panel/SidePanel';
import { useUIStore } from '../../infra/context';
import { useSpreadsheetPanelContributions } from './panel-contributions';

// =============================================================================
// Types
// =============================================================================

export interface PanelLayerProps {
  /**
   * Whether to show the extension panel.
   * Enables the side panel for hosting add-ins/extensions.
   * @default false
   */
  showExtensionPanel?: boolean;
}

// =============================================================================
// Component
// =============================================================================

/**
 * PanelLayer - Renders all side panel components
 *
 * Panels that require props are controlled via PanelLayerProps.
 * Self-subscribing panels (ChartEditor, PivotField, AccessibilityChecker)
 * manage their own visibility via internal state/context.
 *
 * Rendering order matters for z-index stacking:
 * 1. Registered contributions (dev-only panels, trusted host tools)
 * 2. Chart editor (slides from right)
 * 3. Pivot field panel (slides from right)
 * 4. Extension panel (controlled visibility)
 * 5. Accessibility checker panel (self-manages)
 */
export function PanelLayer({ showExtensionPanel = false }: PanelLayerProps): React.JSX.Element {
  // Chrome-symmetry panels: side panel host + comments pane. Each renders
  // only when its toggle is true so the panel root detaches from the DOM
  // when closed (the contract requires `state: 'hidden'`).
  const sidePanelVisible = useUIStore((s) => s.sidePanelVisible);
  const commentsPanelVisible = useUIStore((s) => s.commentsPanelVisible);
  const panelContributions = useSpreadsheetPanelContributions();

  return (
    <>
      {/* ===================================================================== */}
      {/* Chrome-symmetry: Side Panel Host (issue #116) */}
      {/* ===================================================================== */}
      {sidePanelVisible && (
        <div className="absolute right-0 top-0 bottom-0 z-ss-overlay">
          <SidePanel />
        </div>
      )}

      {/* ===================================================================== */}
      {/* Chrome-symmetry: Comments Pane (issue #116) */}
      {/* ===================================================================== */}
      {commentsPanelVisible && (
        <div className="absolute right-0 top-0 bottom-0 z-ss-overlay">
          <CommentsPanel />
        </div>
      )}

      {panelContributions.map(({ id, Component }) => (
        <Component key={id} />
      ))}

      {/* ===================================================================== */}
      {/* Chart Editor Panel */}
      {/* ===================================================================== */}
      {/* Chart editor panel for editing chart properties */}
      {/* Container handles conditional rendering based on editing state */}
      <ChartEditorContainer />

      {/* ===================================================================== */}
      {/* Pivot Field Panel */}
      {/* ===================================================================== */}
      {/* Pivot table field list panel */}
      {/* Container handles conditional rendering based on pivot editing state */}
      <PivotFieldPanelContainer />

      {/* ===================================================================== */}
      {/* Extension Panel */}
      {/* ===================================================================== */}
      {/* Plugin Support: Extension/add-in panel container */}
      <ExtensionPanelContainer showExtensionPanel={showExtensionPanel} />

      {/* ===================================================================== */}
      {/* Accessibility Checker Panel */}
      {/* ===================================================================== */}
      {/* Container handles conditional rendering based on checker state */}
      <AccessibilityCheckerPanelContainer />

      {/* ===================================================================== */}
      {/* Schema Browser Panel */}
      {/* ===================================================================== */}
      {/* Data tab: schema browser for database connection inspection */}
      {/* Container subscribes to schemaBrowser.isOpen and renders conditionally */}
      <SchemaBrowserContainer />

      {/* Data tab: workbook external link discovery */}
      <WorkbookLinksPanelContainer />
    </>
  );
}
