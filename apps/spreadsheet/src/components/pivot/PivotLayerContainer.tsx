/**
 * Pivot Layer Container
 *
 * Pivot table output is materialized into sheet cells by the compute engine.
 * Imported workbooks and ribbon-created pivots must therefore share the same
 * visible surface: the grid cells themselves. Contextual tools are driven by
 * overlays anchored to those materialized cells, not by a floating DOM table.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { SortOrder } from '@mog-sdk/contracts/pivot';
import { useCoordinator, useRendererActions, useRendererStatus } from '../../hooks';
import { useActiveSheetId, useUIStore } from '../../infra/context';
import { usePivotTables } from '../../hooks/data/use-pivot-tables';
import { PivotLayerOverlay } from './PivotLayerOverlay';
import {
  getPivotMarker,
  hasPivotOutputPlacements,
  type PivotFieldHeaderControlLayout,
  type PivotMarker,
} from './pivot-layer-layout';

type Coordinator = ReturnType<typeof useCoordinator>;

function usePivotLayerInvalidation(
  coordinator: Coordinator,
  isReady: boolean,
  pivotCount: number,
  closeTransientOverlays: (reason: 'scroll') => void,
): number {
  const [scrollTick, setScrollTick] = useState(0);

  useEffect(() => {
    const inputCoordinator = coordinator.input.inputCoordinator;
    return inputCoordinator.onScrollChange(() => {
      setScrollTick((value) => value + 1);
      closeTransientOverlays('scroll');
    });
  }, [coordinator, closeTransientOverlays]);

  useEffect(() => {
    if (!isReady) return;

    const sheetViewEvents = coordinator.renderer.getSheetView()?.events.subscribe((event) => {
      if (
        event.type === 'geometry-change' ||
        event.type === 'visible-range-change' ||
        event.type === 'scroll-position-reset' ||
        event.type === 'zoom-change'
      ) {
        setScrollTick((value) => value + 1);
        closeTransientOverlays('scroll');
      }
    });

    return () => {
      sheetViewEvents?.dispose();
    };
  }, [coordinator, closeTransientOverlays, isReady]);

  useEffect(() => {
    if (!isReady || pivotCount === 0) return;
    const intervalId = window.setInterval(() => {
      setScrollTick((value) => value + 1);
    }, 100);
    return () => window.clearInterval(intervalId);
  }, [isReady, pivotCount]);

  return scrollTick;
}

function HiddenPivotMarker({ marker }: { marker: PivotMarker }) {
  return (
    <div
      data-pivot-target="wrapper"
      data-pivot-marker="cell-backed"
      data-pivot-id={marker.id}
      data-pivot-name={marker.name}
      data-testid={`pivot-marker-${marker.id}`}
      data-pivot-anchor-row={marker.bounds.startRow}
      data-pivot-anchor-col={marker.bounds.startCol}
      data-pivot-end-row={marker.bounds.endRow}
      data-pivot-end-col={marker.bounds.endCol}
      style={{
        position: 'fixed',
        left: marker.rect.x,
        top: marker.rect.y,
        width: marker.rect.width,
        height: marker.rect.height,
        visibility: 'hidden',
        pointerEvents: 'none',
      }}
    />
  );
}

/**
 * The component remains mounted from the grid overlay composition point, but it
 * intentionally renders no pivot output. Pivot ranges are registered in the
 * workbook and rendered through the viewport cell buffer.
 *
 * It does render hidden DOM markers for tooling that needs a stable, observable
 * anchor for cell-backed pivots. The markers are non-interactive and invisible,
 * so they do not resurrect the old floating PivotTable surface.
 */
export function PivotLayerContainer() {
  const activeSheetId = useActiveSheetId();
  const { pivotTables, startEditingPivot, setPlacementSortOrder } = usePivotTables({
    sheetId: activeSheetId,
  });
  const { isReady } = useRendererStatus();
  const { getGeometry, getViewport } = useRendererActions();
  const coordinator = useCoordinator();
  const editingPivotId = useUIStore((s) => s.pivot.editingPivotId);
  const openTransientOverlay = useUIStore((s) => s.pivot.openTransientOverlay);
  const openPivotOverlay = useUIStore((s) => s.openPivotOverlay);
  const closePivotOverlays = useUIStore((s) => s.closePivotOverlays);
  const restoreGridFocus = useCallback(() => {
    coordinator.input.focusGrid();
  }, [coordinator]);
  const closeTransientForViewportChange = useCallback(() => {
    closePivotOverlays('scroll');
  }, [closePivotOverlays]);
  const scrollTick = usePivotLayerInvalidation(
    coordinator,
    isReady,
    pivotTables.length,
    closeTransientForViewportChange,
  );

  const geometry = getGeometry();
  const markers = useMemo<PivotMarker[]>(() => {
    void scrollTick;
    if (!isReady || !geometry || pivotTables.length === 0) return [];

    const viewport = getViewport();
    return pivotTables
      .map((pivot) => getPivotMarker(pivot, geometry, viewport))
      .filter((marker): marker is PivotMarker => marker != null);
  }, [geometry, getViewport, isReady, pivotTables, scrollTick]);

  const followedEditingPivotKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isReady || editingPivotId == null) {
      followedEditingPivotKeyRef.current = null;
      return;
    }
    const marker = markers.find(
      (candidate) =>
        candidate.id === editingPivotId ||
        candidate.pivot.alternateIds?.includes(editingPivotId) === true,
    );
    if (!marker) return;
    const followCol = hasPivotOutputPlacements(marker.pivot.config)
      ? Math.min(marker.bounds.endCol, marker.bounds.startCol + 3)
      : marker.bounds.startCol + 3;
    const followCell = {
      row: marker.bounds.startRow,
      col: followCol,
    };
    const followKey = [
      marker.id,
      followCell.row,
      followCell.col,
      marker.pivot.config.placements.map((placement) => String(placement.placementId)).join(','),
    ].join(':');
    if (followedEditingPivotKeyRef.current === followKey) return;
    followedEditingPivotKeyRef.current = followKey;
    coordinator.renderer.scrollToActiveCell(followCell);
  }, [coordinator, editingPivotId, isReady, markers]);

  const applyHeaderSort = (
    marker: PivotMarker,
    control: PivotFieldHeaderControlLayout,
    sortOrder: SortOrder | null,
  ) => {
    setPlacementSortOrder(marker.id, control.placementId, sortOrder);
    closePivotOverlays('command-applied');
  };

  const openPivotEditor = (pivotId: string) => {
    startEditingPivot(pivotId);
  };

  useEffect(() => {
    closePivotOverlays('sheet-change');
  }, [activeSheetId, closePivotOverlays]);

  useEffect(() => {
    if (!openTransientOverlay) return;
    const marker = markers.find((candidate) => candidate.id === openTransientOverlay.pivotId);
    if (!marker) {
      closePivotOverlays('pivot-deleted');
      return;
    }
    if (
      openTransientOverlay.kind === 'field-header-menu' &&
      !marker.fieldHeaderControls.some(
        (control) => control.placementId === openTransientOverlay.placementId,
      )
    ) {
      closePivotOverlays('placement-changed');
      return;
    }
    if (
      openTransientOverlay.kind === 'report-filter-menu' &&
      !marker.reportFilterControls.some(
        (control) => control.placementId === openTransientOverlay.placementId,
      )
    ) {
      closePivotOverlays('placement-changed');
    }
  }, [closePivotOverlays, markers, openTransientOverlay]);

  useEffect(() => {
    if (!openTransientOverlay) return;
    const handleWheel = (event: WheelEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('.pivot-report-filter-picker')) return;
      closePivotOverlays('scroll');
    };
    document.addEventListener('wheel', handleWheel, { capture: true, passive: true });
    return () => document.removeEventListener('wheel', handleWheel, true);
  }, [closePivotOverlays, openTransientOverlay]);

  useEffect(() => {
    if (!openTransientOverlay) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closePivotOverlays('escape');
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [closePivotOverlays, openTransientOverlay]);

  if (markers.length === 0) {
    return null;
  }

  return (
    <div
      data-testid="pivot-layer-markers"
      style={{
        position: 'fixed',
        width: 0,
        height: 0,
        overflow: 'visible',
        pointerEvents: 'none',
      }}
    >
      <div aria-hidden="true">
        {markers.map((marker) => (
          <HiddenPivotMarker key={marker.id} marker={marker} />
        ))}
      </div>
      {markers.map((marker) => (
        <PivotLayerOverlay
          key={`${marker.id}-visible-overlay`}
          marker={marker}
          openTransientOverlay={openTransientOverlay}
          onOpenPivotOverlay={openPivotOverlay}
          onClosePivotOverlays={closePivotOverlays}
          onApplyHeaderSort={applyHeaderSort}
          onStartEditingPivot={openPivotEditor}
          onRestoreGridFocus={restoreGridFocus}
        />
      ))}
    </div>
  );
}
