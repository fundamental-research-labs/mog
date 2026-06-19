/**
 * Pivot Layer Container
 *
 * Pivot table output is materialized into sheet cells by the compute engine.
 * Imported workbooks and ribbon-created pivots must therefore share the same
 * visible surface: the grid cells themselves. Contextual tools are driven by
 * overlays anchored to those materialized cells, not by a floating DOM table.
 */

import { useEffect, useMemo, useState } from 'react';

import type { SortOrder } from '@mog-sdk/contracts/pivot';
import { useCoordinator, useRendererActions, useRendererStatus } from '../../hooks';
import { useActiveSheetId } from '../../internal-api';
import { usePivotTables } from '../../hooks/data/use-pivot-tables';
import { PivotLayerOverlay, type OpenPivotHeaderMenu } from './PivotLayerOverlay';
import {
  getPivotMarker,
  type PivotFieldHeaderControlLayout,
  type PivotMarker,
} from './pivot-layer-layout';

type Coordinator = ReturnType<typeof useCoordinator>;

function usePivotLayerInvalidation(
  coordinator: Coordinator,
  isReady: boolean,
  pivotCount: number,
): number {
  const [scrollTick, setScrollTick] = useState(0);

  useEffect(() => {
    const inputCoordinator = coordinator.input.inputCoordinator;
    return inputCoordinator.onScrollChange(() => {
      setScrollTick((value) => value + 1);
    });
  }, [coordinator]);

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
      }
    });

    return () => {
      sheetViewEvents?.dispose();
    };
  }, [coordinator, isReady]);

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
  const scrollTick = usePivotLayerInvalidation(coordinator, isReady, pivotTables.length);
  const [openHeaderMenu, setOpenHeaderMenu] = useState<OpenPivotHeaderMenu | null>(null);

  const geometry = getGeometry();
  const markers = useMemo<PivotMarker[]>(() => {
    void scrollTick;
    if (!isReady || !geometry || pivotTables.length === 0) return [];

    const viewport = getViewport();
    return pivotTables
      .map((pivot) => getPivotMarker(pivot, geometry, viewport))
      .filter((marker): marker is PivotMarker => marker != null);
  }, [geometry, getViewport, isReady, pivotTables, scrollTick]);

  const applyHeaderSort = (
    marker: PivotMarker,
    control: PivotFieldHeaderControlLayout,
    sortOrder: SortOrder | null,
  ) => {
    setPlacementSortOrder(marker.id, control.placementId, sortOrder);
    setOpenHeaderMenu(null);
  };

  const openPivotEditor = (pivotId: string) => {
    startEditingPivot(pivotId);
    setOpenHeaderMenu(null);
  };

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
          openHeaderMenu={openHeaderMenu}
          onToggleHeaderMenu={setOpenHeaderMenu}
          onApplyHeaderSort={applyHeaderSort}
          onStartEditingPivot={openPivotEditor}
        />
      ))}
    </div>
  );
}
