import { useEffect, useRef } from 'react';

import type { WorkbookInternal } from '@mog-sdk/contracts/api';
import type { SheetId } from '@mog-sdk/contracts/core';
import type { ResolvedSheetViewSkin } from '@mog-sdk/contracts/rendering/sheet-view-skin';
import type { StoreApi } from 'zustand';
import type { SheetCoordinator } from '../../../coordinator/sheet-coordinator';
import { isValidRestoredSelection } from '../utils/restored-selection';

interface UseRendererViewRestoreOptions {
  activeSheetId: SheetId;
  coordinator: SheetCoordinator;
  isReady: boolean;
  rendererSkin: ResolvedSheetViewSkin;
  rendererSheetId: string | null;
  uiStoreApi: StoreApi<any>;
  wb: WorkbookInternal;
}

function normalizeRestoredCellIndex(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function isFinitePixel(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

async function resolvePersistedCellScrollPosition(
  wb: WorkbookInternal,
  sheetId: SheetId,
  topRow: number,
  leftCol: number,
  frozenRows: number,
  frozenCols: number,
): Promise<{ readonly x: number; readonly y: number } | null> {
  const worksheet = wb.getSheetById(sheetId);
  const normalizedTopRow = normalizeRestoredCellIndex(topRow);
  const normalizedLeftCol = normalizeRestoredCellIndex(leftCol);
  const normalizedFrozenRows = normalizeRestoredCellIndex(frozenRows);
  const normalizedFrozenCols = normalizeRestoredCellIndex(frozenCols);

  const [rowTop, colLeft, frozenRowTop, frozenColLeft] = await Promise.all([
    worksheet.layout.getRowPosition(normalizedTopRow),
    worksheet.layout.getColPosition(normalizedLeftCol),
    normalizedFrozenRows > 0
      ? worksheet.layout.getRowPosition(normalizedFrozenRows)
      : Promise.resolve(0),
    normalizedFrozenCols > 0
      ? worksheet.layout.getColPosition(normalizedFrozenCols)
      : Promise.resolve(0),
  ]);

  if (
    !isFinitePixel(rowTop) ||
    !isFinitePixel(colLeft) ||
    !isFinitePixel(frozenRowTop) ||
    !isFinitePixel(frozenColLeft)
  ) {
    return null;
  }

  return {
    x: Math.max(0, colLeft - frozenColLeft),
    y: Math.max(0, rowTop - frozenRowTop),
  };
}

export function useRendererViewRestore({
  activeSheetId,
  coordinator,
  isReady,
  rendererSkin,
  rendererSheetId,
  uiStoreApi,
  wb,
}: UseRendererViewRestoreOptions): void {
  const restoredImportedSelectionSheetsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    restoredImportedSelectionSheetsRef.current.clear();
  }, [wb]);

  useEffect(() => {
    if (!isReady || rendererSheetId !== activeSheetId) return;
    let cancelled = false;
    let restoreFrame: number | null = null;

    const viewOpts = wb.mirror.getViewOptions(activeSheetId);
    const scrollPos = wb.mirror.getScrollPosition(activeSheetId);
    const frozenPanes = wb.mirror.getFrozenPanes(activeSheetId);
    const sessionViewState = uiStoreApi.getState().getSheetViewState(activeSheetId);
    const savedSelection = wb.mirror.getViewSelection(activeSheetId);
    const activeCell = coordinator.grid.access.accessors.selection.getActiveCell();
    const hasPersistedScrollPosition = scrollPos.topRow > 0 || scrollPos.leftCol > 0;
    const restoredImportedSelection = restoredImportedSelectionSheetsRef.current.has(activeSheetId);
    const savedSelectionIsValid =
      savedSelection != null && isValidRestoredSelection(savedSelection);
    const savedSelectionAlreadyActive =
      savedSelectionIsValid &&
      activeCell?.row === savedSelection.activeCell.row &&
      activeCell?.col === savedSelection.activeCell.col;
    const shouldRestoreSavedSelection =
      !sessionViewState && !restoredImportedSelection && savedSelectionIsValid;
    const shouldAlignSavedSelectionViewport =
      !restoredImportedSelection &&
      !hasPersistedScrollPosition &&
      savedSelectionIsValid &&
      (!sessionViewState || savedSelectionAlreadyActive);
    const shouldRestorePersistedCellScroll =
      !sessionViewState && hasPersistedScrollPosition && !shouldAlignSavedSelectionViewport;

    const renderCap = coordinator.renderer.getRenderCapability();
    if (renderCap && renderCap.getCurrentSheetId() === activeSheetId) {
      const renderState = coordinator.renderer.getRenderState();
      renderState?.update({
        viewOptions: {
          showGridlines: viewOpts.showGridlines,
          showRowHeaders: viewOpts.showRowHeaders,
          showColumnHeaders: viewOpts.showColumnHeaders,
        },
      });
    }

    if (shouldRestorePersistedCellScroll) {
      void resolvePersistedCellScrollPosition(
        wb,
        activeSheetId,
        scrollPos.topRow,
        scrollPos.leftCol,
        frozenPanes.rows,
        frozenPanes.cols,
      )
        .then((scrollTarget) => {
          if (
            cancelled ||
            !scrollTarget ||
            coordinator.renderer.getRenderCapability()?.getCurrentSheetId() !== activeSheetId
          ) {
            return;
          }

          coordinator.renderer.setScrollPosition(scrollTarget);
          coordinator.input.inputCoordinator.resetScrollPosition(scrollTarget.x, scrollTarget.y);
        })
        .catch(() => undefined);
    }

    if (shouldRestoreSavedSelection) {
      restoredImportedSelectionSheetsRef.current.add(activeSheetId);
      coordinator.grid.access.actors.selection.send({
        type: 'SET_SELECTION',
        ranges: savedSelection.ranges,
        activeCell: savedSelection.activeCell,
        anchor: null,
        anchorCol: null,
        anchorRow: null,
        source: 'restore',
      });
    }

    if (shouldAlignSavedSelectionViewport) {
      restoredImportedSelectionSheetsRef.current.add(activeSheetId);
      const alignViewport = () => {
        const scrollTarget = coordinator.renderer
          .getSheetView()
          ?.viewport.getScrollToCell(savedSelection.activeCell);
        if (scrollTarget) {
          coordinator.renderer.setScrollPosition(scrollTarget);
          coordinator.input.inputCoordinator.resetScrollPosition(scrollTarget.x, scrollTarget.y);
        }
      };
      alignViewport();
      restoreFrame = window.requestAnimationFrame(alignViewport);
    }

    return () => {
      cancelled = true;
      if (restoreFrame != null) {
        window.cancelAnimationFrame(restoreFrame);
      }
    };
  }, [activeSheetId, coordinator, isReady, rendererSheetId, uiStoreApi, wb]);

  useEffect(() => {
    if (!isReady || rendererSheetId !== activeSheetId) return;
    const renderCap = coordinator.renderer.getRenderCapability();
    if (!renderCap || renderCap.getCurrentSheetId() !== activeSheetId) return;
    coordinator.renderer.updateContext({
      sheetViewSkin: rendererSkin,
      chromeTheme: rendererSkin.chromeTheme,
    });
  }, [activeSheetId, coordinator, isReady, rendererSheetId, rendererSkin]);
}
