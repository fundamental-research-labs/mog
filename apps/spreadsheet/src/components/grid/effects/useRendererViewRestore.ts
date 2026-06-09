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
    let restoreFrame: number | null = null;

    const viewOpts = wb.mirror.getViewOptions(activeSheetId);
    const scrollPos = wb.mirror.getScrollPosition(activeSheetId);
    const sessionViewState = uiStoreApi.getState().getSheetViewState(activeSheetId);
    const savedSelection = wb.mirror.getViewSelection(activeSheetId);
    const activeCell = coordinator.grid.access.accessors.selection.getActiveCell();
    const savedSelectionIsValid =
      savedSelection != null && isValidRestoredSelection(savedSelection);
    const savedSelectionAlreadyActive =
      savedSelectionIsValid &&
      activeCell?.row === savedSelection.activeCell.row &&
      activeCell?.col === savedSelection.activeCell.col;
    const shouldRestoreSavedSelection =
      !sessionViewState &&
      !restoredImportedSelectionSheetsRef.current.has(activeSheetId) &&
      savedSelectionIsValid;
    const shouldAlignSavedSelectionViewport =
      !restoredImportedSelectionSheetsRef.current.has(activeSheetId) &&
      savedSelectionIsValid &&
      (!sessionViewState || savedSelectionAlreadyActive);

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

    if (
      !sessionViewState &&
      !shouldAlignSavedSelectionViewport &&
      (scrollPos.topRow > 0 || scrollPos.leftCol > 0)
    ) {
      coordinator.renderer.applyCellLevelScroll(scrollPos.topRow, scrollPos.leftCol);
    }

    if (shouldRestoreSavedSelection) {
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
