import { useEffect, useRef, useState } from 'react';

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

interface RestorableSessionViewState {
  readonly activeCell?: { readonly row: number; readonly col: number };
  readonly ranges?: ReadonlyArray<{
    readonly startRow: number;
    readonly startCol: number;
    readonly endRow: number;
    readonly endCol: number;
  }>;
}

function normalizeRestoredCellIndex(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function isFinitePixel(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function isDefaultA1SessionViewState(sessionViewState: RestorableSessionViewState | undefined) {
  if (!sessionViewState) return false;
  const activeCell = sessionViewState.activeCell;
  if (!activeCell || activeCell.row !== 0 || activeCell.col !== 0) {
    return false;
  }

  return (
    sessionViewState.ranges?.length === 1 &&
    sessionViewState.ranges[0]?.startRow === 0 &&
    sessionViewState.ranges[0]?.startCol === 0 &&
    sessionViewState.ranges[0]?.endRow === 0 &&
    sessionViewState.ranges[0]?.endCol === 0
  );
}

export function shouldRestoreImportedSelection(options: {
  readonly sessionViewState: RestorableSessionViewState | undefined;
  readonly restoredImportedSelection: boolean;
  readonly savedSelectionIsValid: boolean;
}): boolean {
  const { sessionViewState, restoredImportedSelection, savedSelectionIsValid } = options;
  return (
    (!sessionViewState || isDefaultA1SessionViewState(sessionViewState)) &&
    !restoredImportedSelection &&
    savedSelectionIsValid
  );
}

export function isActiveSheetViewSelectionChange(event: unknown, activeSheetId: SheetId): boolean {
  return (
    event !== null &&
    typeof event === 'object' &&
    'sheetId' in event &&
    (event as { readonly sheetId?: unknown }).sheetId === activeSheetId
  );
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
  const [viewSelectionVersion, setViewSelectionVersion] = useState(0);

  useEffect(() => {
    restoredImportedSelectionSheetsRef.current.clear();
  }, [wb]);

  useEffect(() => {
    return wb.on('view:selection-changed', (event: unknown) => {
      if (isActiveSheetViewSelectionChange(event, activeSheetId)) {
        setViewSelectionVersion((version) => version + 1);
      }
    });
  }, [activeSheetId, wb]);

  useEffect(() => {
    if (!isReady || rendererSheetId !== activeSheetId) return;
    let cancelled = false;
    let restoreFrame: number | null = null;

    const viewOpts = wb.mirror.getViewOptions(activeSheetId);
    const scrollPos = wb.mirror.getScrollPosition(activeSheetId);
    const frozenPanes = wb.mirror.getFrozenPanes(activeSheetId);
    const sessionViewState = uiStoreApi.getState().getSheetViewState(activeSheetId);
    const savedSelection = wb.mirror.getViewSelection(activeSheetId);
    const restorableSelection =
      savedSelection != null && isValidRestoredSelection(savedSelection) ? savedSelection : null;
    const activeCell = coordinator.grid.access.accessors.selection.getActiveCell();
    const hasPersistedScrollPosition = scrollPos.topRow > 0 || scrollPos.leftCol > 0;
    const restoredImportedSelection = restoredImportedSelectionSheetsRef.current.has(activeSheetId);
    const savedSelectionIsValid = restorableSelection != null;
    const savedSelectionAlreadyActive =
      restorableSelection != null &&
      activeCell?.row === restorableSelection.activeCell.row &&
      activeCell?.col === restorableSelection.activeCell.col;
    const sessionStateIsOnlyInitialDefault = isDefaultA1SessionViewState(sessionViewState);
    const shouldRestoreSavedSelection = shouldRestoreImportedSelection({
      sessionViewState,
      restoredImportedSelection,
      savedSelectionIsValid,
    });
    const shouldAlignSavedSelectionViewport =
      !restoredImportedSelection &&
      !hasPersistedScrollPosition &&
      savedSelectionIsValid &&
      (!sessionViewState || sessionStateIsOnlyInitialDefault || savedSelectionAlreadyActive);
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
        ranges: restorableSelection!.ranges,
        activeCell: restorableSelection!.activeCell,
        anchor: null,
        anchorCol: null,
        anchorRow: null,
        source: 'restore',
      });
    }

    if (shouldAlignSavedSelectionViewport && restorableSelection) {
      restoredImportedSelectionSheetsRef.current.add(activeSheetId);
      const selectionToAlign = restorableSelection;
      const alignViewport = () => {
        const scrollTarget = coordinator.renderer
          .getSheetView()
          ?.viewport.getScrollToCell(selectionToAlign.activeCell);
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
  }, [activeSheetId, coordinator, isReady, rendererSheetId, uiStoreApi, viewSelectionVersion, wb]);

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
