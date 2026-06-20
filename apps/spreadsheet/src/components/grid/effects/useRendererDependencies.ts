/**
 * useRendererDependencies Effect Hook
 *
 * Provides viewport + data callbacks to the coordinator, which distributes
 * them to all systems that need them:
 * - Renderer: drives SheetView's viewport reader resolver and layout state
 * - Object system: for CellAnchorResolver to compute floating object bounds
 *
 * The `rendererFactory` dep was removed during the `@mog-sdk/sheet-view`
 * extraction — SheetView now owns grid-renderer creation directly (Option B).
 * ViewportReader is still wired through because SheetView's
 * `getViewportReader` resolver pulls from this slot.
 *
 * Must run before MOUNT so dependencies are available when machine needs them.
 *
 * @see 09-SPREADSHEET-GRID-DECOMPOSITION.md
 */

import { useEffect, useRef } from 'react';

import type { ViewportReader } from '@mog-sdk/contracts/api';
import type { CellCoord } from '@mog-sdk/contracts/rendering';

import type { CellFormat, SheetId } from '@mog-sdk/contracts/core';
import { MAX_COLS, MAX_ROWS } from '@mog-sdk/contracts/core';
import type { ResolvedSheetViewSkin } from '@mog-sdk/contracts/rendering/sheet-view-skin';
import type { SheetCoordinator } from '../../../coordinator/sheet-coordinator';
import type { SheetStateProvider } from '../../../coordinator/types';
import { lifecycleDebug } from '../../../systems/renderer/debug/debug-lifecycle';
import { getGridViewportInset, type GridViewportLayoutSettings } from '../layout/viewport-size';

/**
 * Options for the useRendererDependencies hook.
 */
export interface UseRendererDependenciesOptions {
  /** The sheet coordinator instance */
  coordinator: SheetCoordinator;
  /** ViewportReader for sync dimension data (replaces dimensionProvider) */
  viewport: ViewportReader;
  /** Callback to get cell display value */
  getCellValue: (sheetId: SheetId, cell: CellCoord) => unknown;
  /** Callback to get cell format */
  getCellFormat: (sheetId: SheetId, cell: CellCoord) => CellFormat | undefined;
  /** The active sheet ID */
  activeSheetId: string;
  /** Host layout contract for renderer viewport insets. */
  viewportLayout: GridViewportLayoutSettings;
  /** Provider for sheet state (frozen panes, view options) */
  sheetStateProvider: SheetStateProvider;
  /** Initial renderer skin for first paint. */
  rendererSkin: ResolvedSheetViewSkin;
  /** UI store API for scroll position restoration */
  uiStoreApi: {
    getState: () => {
      getSheetViewState: (sheetId: string) => { scrollLeft: number; scrollTop: number } | undefined;
    };
  };
}

/**
 * Sets up renderer dependencies via the coordinator (composition root).
 *
 * Calls coordinator.setRendererDependencies() — NOT coordinator.renderer directly —
 * so the coordinator can distribute shared dependencies to all
 * systems that need them. This is the proper composition-root pattern.
 *
 * Passes ViewportReader. The renderer execution creates VPI+VMI
 * from the ViewportReader.
 *
 * @param options - Configuration options
 */
export function useRendererDependencies(options: UseRendererDependenciesOptions): void {
  // Store options in a ref so callback wrappers always read the latest values.
  // This reduces the dependency array to only meaningful changes:
  // coordinator (new document), viewport (layout change), activeSheetId (sheet switch).
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const { coordinator, viewport, activeSheetId, rendererSkin } = options;

  useEffect(() => {
    lifecycleDebug.effectRun('setRendererDependencies', { activeSheetId });
    coordinator.setRendererDependencies({
      viewport,
      getCellValue: (sheetId: string, cell: CellCoord) =>
        optionsRef.current.getCellValue(sheetId as SheetId, cell),
      getCellFormat: (sheetId: string, cell: CellCoord) =>
        optionsRef.current.getCellFormat(sheetId as SheetId, cell),
      initialSheetId: activeSheetId,
      getViewportInset: () => getGridViewportInset(optionsRef.current.viewportLayout),
      totalRows: MAX_ROWS,
      totalCols: MAX_COLS,
      sheetStateProvider: optionsRef.current.sheetStateProvider,
      sheetViewSkin: optionsRef.current.rendererSkin,
      // Per-sheet scroll position restoration from UIStore (pixel-level, session-only).
      // renderer-execution falls back to workbook-persisted cell scroll when this is origin.
      getInitialScrollPosition: (sheetId) => {
        const viewState = optionsRef.current.uiStoreApi.getState().getSheetViewState(sheetId);
        return viewState ? { x: viewState.scrollLeft, y: viewState.scrollTop } : { x: 0, y: 0 };
      },
      // Sync InputCoordinator's physics engine when scroll position is restored.
      // Called during sheet switch and initial load after renderer.setScroll() applies
      // the restored position. Without this, the physics engine retains the previous
      // sheet's scroll position and the next gesture causes a jump.
      onScrollPositionReset: (position) => {
        coordinator.input.inputCoordinator.resetScrollPosition(position.x, position.y);
      },
    });
  }, [coordinator, viewport, activeSheetId, rendererSkin]);
}
