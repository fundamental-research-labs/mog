/**
 * FormControlLayerContainer
 *
 * Container component that manages form control data and scroll synchronization.
 * Uses imperative CSS transform updates for 60fps GPU-accelerated scrolling.
 *
 * Architecture:
 * - Gets controls from Worksheet.formControls sub-API
 * - Resolves CellId anchors to pixel positions via CoordinateSystem
 * - Reads linked cell values via Worksheet.getCell()
 * - Handles scroll sync via imperative CSS transform (no React re-render on scroll)
 * - Writes cell values via Worksheet.setCell() on control interaction
 *
 * @see FormControlLayer - Rendering layer
 * @see contracts/src/editor/form-controls.ts - Type contracts
 * @module components/canvas-overlays/form-controls
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { FormControl } from '@mog-sdk/contracts/form-controls';

import { useCoordinator, useRendererActions, useRendererStatus } from '../../../hooks';
import { useWorksheet } from '../../../infra/context';

import type { ResolvedFormControl } from './FormControlLayer';
import { FormControlLayer } from './FormControlLayer';

function scheduleFrame(callback: () => void): () => void {
  if (typeof requestAnimationFrame === 'function' && typeof cancelAnimationFrame === 'function') {
    const frameId = requestAnimationFrame(callback);
    return () => cancelAnimationFrame(frameId);
  }

  const timerId = setTimeout(callback, 0);
  return () => clearTimeout(timerId);
}

// =============================================================================
// Component
// =============================================================================

export function FormControlLayerContainer() {
  const overlayRef = useRef<HTMLDivElement>(null);
  const { isReady } = useRendererStatus();
  const { getGeometry, getViewport } = useRendererActions();
  const coordinator = useCoordinator();
  const ws = useWorksheet();

  const [resolvedControls, setResolvedControls] = useState<ResolvedFormControl[]>([]);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const cancelGeometryRefreshRef = useRef<(() => void) | null>(null);

  const sheetId = ws.getSheetId();

  const refreshNow = useCallback(() => {
    setRefreshVersion((version) => version + 1);
  }, []);

  const scheduleGeometryRefresh = useCallback(() => {
    if (cancelGeometryRefreshRef.current !== null) return;

    cancelGeometryRefreshRef.current = scheduleFrame(() => {
      cancelGeometryRefreshRef.current = null;
      refreshNow();
    });
  }, [refreshNow]);

  // ═══════════════════════════════════════════════════════════════════════════
  // RESOLVE POSITIONS AND VALUES
  // ═══════════════════════════════════════════════════════════════════════════

  useEffect(() => {
    const geometry = getGeometry();
    const viewport = getViewport();
    const controls = ws.formControls.list();

    if (!geometry || !isReady || controls.length === 0) {
      setResolvedControls([]);
      return;
    }

    let cancelled = false;
    void resolveControlPositions(controls, geometry, viewport, ws).then((positions) => {
      if (!cancelled) setResolvedControls(positions);
    });

    return () => {
      cancelled = true;
    };
  }, [getGeometry, getViewport, isReady, refreshVersion, sheetId, ws]);

  // Form controls are managed below the React state tree. Subscribe to the
  // manager events so creates/updates immediately re-resolve DOM overlays.
  useEffect(() => {
    const disposers = [
      ws.on('formControl:created', refreshNow),
      ws.on('formControl:updated', refreshNow),
      ws.on('formControl:deleted', refreshNow),
      ws.on('cellChanged', refreshNow),
      ws.on('row:height-changed', scheduleGeometryRefresh),
      ws.on('column:width-changed', scheduleGeometryRefresh),
    ];

    return () => {
      for (const dispose of disposers) dispose();
    };
  }, [refreshNow, scheduleGeometryRefresh, sheetId, ws]);

  // Row/column dimension events can fire before SheetView has rebuilt its
  // position index. Refresh from view geometry events as well, which are emitted
  // after the renderer has applied the updated coordinates.
  useEffect(() => {
    if (!isReady) return;

    const sheetViewEvents = coordinator.renderer.getSheetView()?.events.subscribe((event) => {
      if (
        event.type === 'geometry-change' ||
        event.type === 'visible-range-change' ||
        event.type === 'scroll-position-reset' ||
        event.type === 'zoom-change'
      ) {
        scheduleGeometryRefresh();
      }
    });

    return () => {
      sheetViewEvents?.dispose();
    };
  }, [coordinator, isReady, scheduleGeometryRefresh, sheetId]);

  useEffect(() => {
    return () => {
      cancelGeometryRefreshRef.current?.();
      cancelGeometryRefreshRef.current = null;
    };
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // CELL VALUE CHANGE HANDLER
  // ═══════════════════════════════════════════════════════════════════════════

  const handleCellValueChange = useCallback(
    (controlId: string, value: unknown) => {
      const controls = ws.formControls.list();
      const control = controls.find((c) => c.id === controlId);
      if (!control) return;

      const linkedCellId = getLinkedCellId(control);

      if (!linkedCellId) return;

      void (async () => {
        const position = await ws._internal.getCellPosition(linkedCellId);
        if (!position) return;
        await ws.setCell(position.row, position.col, toWritableCellValue(value));
      })();
    },
    [ws],
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // SCROLL TRANSFORM - 60fps GPU-accelerated scrolling
  // ═══════════════════════════════════════════════════════════════════════════

  const syncScrollTransform = useCallback(() => {
    const viewport = getViewport();
    if (!viewport || !isReady || !overlayRef.current) return;

    const pos = viewport.getScrollPosition();
    overlayRef.current.style.transform = `translate3d(${-pos.x}px, ${-pos.y}px, 0)`;
  }, [getViewport, isReady]);

  useLayoutEffect(() => {
    syncScrollTransform();
  }, [resolvedControls.length, syncScrollTransform]);

  useEffect(() => {
    if (!isReady) return;

    syncScrollTransform();

    const inputCoordinator = coordinator.input.inputCoordinator;
    const unsubscribe = inputCoordinator.onScrollChange(syncScrollTransform);

    return unsubscribe;
  }, [coordinator, isReady, syncScrollTransform]);

  // ═══════════════════════════════════════════════════════════════════════════
  // EARLY RETURNS - After all hooks have been called
  // ═══════════════════════════════════════════════════════════════════════════

  if (!isReady || !getGeometry()) {
    return null;
  }

  if (resolvedControls.length === 0) {
    return null;
  }

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0"
      style={{ willChange: 'transform', zIndex: 2, pointerEvents: 'auto' }}
      data-testid="form-control-layer-scroll-container"
    >
      <FormControlLayer controls={resolvedControls} onCellValueChange={handleCellValueChange} />
    </div>
  );
}

// =============================================================================
// Async Position Resolution
// =============================================================================

interface GeometryLike {
  toViewportPoint: (cell: { row: number; col: number }) => { x: number; y: number } | null;
  getCellRect?: (cell: { row: number; col: number }) => {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
}

interface ViewportLike {
  getScrollPosition: () => { x: number; y: number };
}

interface WorksheetLike {
  _internal: { getCellPosition(cellId: string): Promise<{ row: number; col: number } | null> };
  getCell(row: number, col: number): Promise<{ value: unknown }>;
}

type WritableCellValue = string | number | boolean | null | Date;

function getLinkedCellId(control: FormControl): string | undefined {
  if ('linkedCellId' in control) {
    return control.linkedCellId;
  }
  return undefined;
}

function isListControl(
  control: FormControl,
): control is Extract<FormControl, { type: 'comboBox' | 'listBox' }> {
  return control.type === 'comboBox' || control.type === 'listBox';
}

function toWritableCellValue(value: unknown): WritableCellValue {
  if (value == null) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return String(value);
}

async function resolveControlPositions(
  controls: FormControl[],
  geometry: GeometryLike,
  viewport: ViewportLike | null,
  ws: WorksheetLike,
): Promise<ResolvedFormControl[]> {
  const resolved: ResolvedFormControl[] = [];
  const scrollPosition = viewport?.getScrollPosition() ?? { x: 0, y: 0 };

  for (const control of controls) {
    const anchorPosition = await ws._internal.getCellPosition(control.anchor.cellId);
    if (!anchorPosition) continue;

    const viewportPoint = geometry.toViewportPoint({
      row: anchorPosition.row,
      col: anchorPosition.col,
    });
    if (!viewportPoint) continue;
    const anchorRect = geometry.getCellRect?.({
      row: anchorPosition.row,
      col: anchorPosition.col,
    });

    let x = viewportPoint.x + scrollPosition.x + (control.anchor.xOffset ?? 0);
    let y = viewportPoint.y + scrollPosition.y + (control.anchor.yOffset ?? 0);
    let width = anchorRect?.width ?? control.width;
    let height = anchorRect?.height ?? control.height;

    let cellValue: unknown;
    let linkedCellPosition: { row: number; col: number } | undefined;
    let resolvedItems: string[] | undefined;

    const linkedCellId = getLinkedCellId(control);
    if (linkedCellId) {
      const linkedPosition = await ws._internal.getCellPosition(linkedCellId);
      if (linkedPosition) {
        linkedCellPosition = linkedPosition;
        const cell = await ws.getCell(linkedPosition.row, linkedPosition.col);
        cellValue = cell.value;
      }

      if (isListControl(control)) {
        resolvedItems = await resolveListItems(control, ws);
      }
    }

    if (control.type === 'checkbox' && !control.label) {
      if (anchorRect) {
        x = anchorRect.x + scrollPosition.x;
        y = anchorRect.y + scrollPosition.y;
        width = anchorRect.width;
        height = anchorRect.height;
      }
    }

    resolved.push({
      control,
      x,
      y,
      width,
      height,
      cellValue,
      linkedCellPosition,
      resolvedItems,
    });
  }

  return resolved;
}

async function resolveListItems(
  control: Extract<FormControl, { type: 'comboBox' | 'listBox' }>,
  ws: WorksheetLike,
): Promise<string[]> {
  if (!control.itemsSourceRef) {
    return control.items ?? [];
  }

  const [startPosition, endPosition] = await Promise.all([
    ws._internal.getCellPosition(control.itemsSourceRef.startId),
    ws._internal.getCellPosition(control.itemsSourceRef.endId),
  ]);

  if (!startPosition || !endPosition) {
    return control.items ?? [];
  }

  const startRow = Math.min(startPosition.row, endPosition.row);
  const endRow = Math.max(startPosition.row, endPosition.row);
  const startCol = Math.min(startPosition.col, endPosition.col);
  const endCol = Math.max(startPosition.col, endPosition.col);
  const items: string[] = [];

  for (let row = startRow; row <= endRow; row++) {
    for (let col = startCol; col <= endCol; col++) {
      const cell = await ws.getCell(row, col);
      if (cell.value == null || cell.value === '') continue;
      items.push(String(cell.value));
    }
  }

  return items;
}
