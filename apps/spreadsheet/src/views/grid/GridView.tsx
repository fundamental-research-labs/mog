/**
 * GridView / GridCanvas Component
 *
 * React component that renders the Grid view using GridCoordinator.
 * Adapted from SpreadsheetContent.tsx for the Shell architecture.
 *
 * Configurable via feature flags.
 * Apps configure which features are enabled via `preset` and `features` props.
 *
 * Key differences from SpreadsheetContent:
 * - Uses GridCoordinator instead of SheetCoordinator
 * - Implements ViewAdapter lifecycle (mount/unmount via coordinator)
 * - Receives configuration via ViewAdapterConfig prop
 * - Minimal UI - just the canvas container
 * - Configurable features via preset + flags
 *
 * Responsibilities:
 * - Create and mount GridCoordinator
 * - Provide container element for canvas
 * - Handle cleanup on unmount
 * - Notify parent when coordinator is ready
 *
 * @see engine/src/components/SpreadsheetContent.tsx (original)
 */

import type { GridCanvasFeatures, GridCanvasPreset } from '@mog-sdk/contracts/grid-canvas';
import { resolveGridCanvasFeatures } from '../../utils/grid-canvas-viewport';
import { useEffect, useRef } from 'react';
import type { ViewAdapterConfig } from '../types';
import { GridCoordinator } from './coordinator/grid-coordinator';
import type { SheetCoordinatorConfig } from './coordinator/types';
// =============================================================================
// Props Interface
// =============================================================================

/**
 * Props for GridView component (ViewAdapter integration).
 * Used when GridView is rendered as a view type via ViewAdapter.
 */
export interface GridViewProps {
  /** View configuration from ViewAdapter */
  config: ViewAdapterConfig<'grid'>;
  /** Unified Workbook API — required for coordinator initialization */
  workbook: import('@mog-sdk/contracts/api').WorkbookInternal;
  /** Callback when coordinator is created and ready */
  onCoordinatorReady?: (coordinator: GridCoordinator) => void;
}

/**
 * Props for GridCanvas component (direct usage by apps).
 * Apps use this interface when embedding GridCanvas directly.
 *
 * @example
 * ```tsx
 * // Full spreadsheet experience
 * <GridCanvas
 * kernel={kernel}
 * sheetId={activeSheet}
 * preset="full"
 * onSelectionChange={handleSelection}
 * />
 *
 * // Embedded table (minimal)
 * <GridCanvas
 * kernel={kernel}
 * sheetId={tableSheet}
 * preset="embedded"
 * features={{ contextMenu: false }}
 * />
 *
 * // Read-only display
 * <GridCanvas
 * kernel={kernel}
 * sheetId={dataSheet}
 * preset="readonly"
 * />
 * ```
 */
export interface GridCanvasProps {
  /** View configuration from ViewAdapter (internal - use kernel + sheetId) */
  config?: ViewAdapterConfig<'grid'>;
  /** Unified Workbook API — required for coordinator initialization */
  workbook: import('@mog-sdk/contracts/api').WorkbookInternal;

  /**
   * Preset for common configurations.
   * - 'full': All features enabled (Spreadsheet app)
   * - 'embedded': Basic editing + selection (tables in Slides)
   * - 'readonly': No interaction (dashboards)
   *
   * @default 'embedded'
   */
  preset?: GridCanvasPreset;

  /**
   * Feature flag overrides.
   * Merged over preset defaults.
   * Explicit values here take precedence.
   */
  features?: GridCanvasFeatures;

  /** Callback when coordinator is created and ready */
  onCoordinatorReady?: (coordinator: GridCoordinator) => void;

  /** Callback when selection changes */
  onSelectionChange?: (selection: {
    ranges: Array<{
      startRow: number;
      startCol: number;
      endRow: number;
      endCol: number;
    }>;
    activeCell: { row: number; col: number } | null;
  }) => void;

  /** Callback when a cell is double-clicked */
  onCellDoubleClick?: (cell: { row: number; col: number }) => void;

  /** Callback when a cell value changes */
  onCellValueChange?: (cell: { row: number; col: number }, value: unknown) => void;
}

// =============================================================================
// Component
// =============================================================================

/**
 * GridView - The visual Grid component (ViewAdapter integration).
 *
 * This component:
 * 1. Creates a GridCoordinator with the provided configuration
 * 2. Mounts the coordinator to a container element
 * 3. Provides the coordinator reference to the parent (for ViewAdapter)
 * 4. Cleans up on unmount (disposes coordinator)
 *
 * The GridCoordinator handles all state management, rendering, and interactions.
 * This component is just a thin React wrapper.
 */
export function GridView({ config, workbook, onCoordinatorReady }: GridViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const coordinatorRef = useRef<GridCoordinator | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Create coordinator config from ViewAdapterConfig
    const coordinatorConfig: SheetCoordinatorConfig = {
      initialSheetId: config.config.sheetId,
      workbook,
    };

    // Create coordinator
    const coordinator = new GridCoordinator(coordinatorConfig);

    // Mount coordinator renderer to container
    coordinator.renderer.mount(containerRef.current);

    // Store reference and notify parent
    coordinatorRef.current = coordinator;
    onCoordinatorReady?.(coordinator);

    // Cleanup: dispose coordinator on unmount
    return () => {
      coordinator.renderer.unmount();
      coordinator.dispose();
      coordinatorRef.current = null;
    };
  }, [config, onCoordinatorReady]);

  return <div ref={containerRef} className="flex-1 w-full h-full relative overflow-hidden" />;
}

/**
 * GridCanvas - Configurable Grid component for apps.
 *
 * This is the public API for apps that want to embed a grid.
 * Use `preset` for ergonomic defaults, `features` for overrides.
 *
 * This is the primary export for apps.
 *
 * @example
 * ```tsx
 * // Spreadsheet app (full features)
 * <GridCanvas
 * config={viewConfig}
 * preset="full"
 * onCoordinatorReady={setCoordinator}
 * />
 *
 * // Embedded table in Slides
 * <GridCanvas
 * config={viewConfig}
 * preset="embedded"
 * features={{ contextMenu: false }}
 * />
 *
 * // Dashboard preview
 * <GridCanvas
 * config={viewConfig}
 * preset="readonly"
 * />
 * ```
 */
export function GridCanvas({
  config,
  workbook,
  preset,
  features,
  onCoordinatorReady,
  onSelectionChange: _onSelectionChange,
  onCellDoubleClick: _onCellDoubleClick,
  onCellValueChange: _onCellValueChange,
}: GridCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const coordinatorRef = useRef<GridCoordinator | null>(null);

  // Resolve feature flags from preset + overrides
  const resolvedFeatures = resolveGridCanvasFeatures(preset, features);

  useEffect(() => {
    if (!containerRef.current || !config) return;

    // Create coordinator config with resolved features
    // NOTE: SheetCoordinatorConfig doesn't support a features property.
    // Feature flags would need to be handled by extending the coordinator.
    const coordinatorConfig: SheetCoordinatorConfig = {
      initialSheetId: config.config.sheetId,
      workbook,
      enableKeyboard: resolvedFeatures.keyboard,
    };

    // Create coordinator
    const coordinator = new GridCoordinator(coordinatorConfig);

    // Mount coordinator renderer to container
    coordinator.renderer.mount(containerRef.current);

    // Store reference and notify parent
    coordinatorRef.current = coordinator;
    onCoordinatorReady?.(coordinator);

    // TODO: Wire up callbacks (onSelectionChange, onCellDoubleClick, onCellValueChange)
    // These will be wired when the coordinator exposes the necessary subscription APIs

    // Cleanup: dispose coordinator on unmount
    return () => {
      coordinator.renderer.unmount();
      coordinator.dispose();
      coordinatorRef.current = null;
    };
  }, [config, resolvedFeatures, onCoordinatorReady]);

  return <div ref={containerRef} className="flex-1 w-full h-full relative overflow-hidden" />;
}

// Default export for convenience
export default GridCanvas;
