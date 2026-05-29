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

import { useCallback, useEffect, useRef, useState } from 'react';

import type { FormControl } from '@mog-sdk/contracts/form-controls';

import { useCoordinator, useRendererActions, useRendererStatus } from '../../../hooks';
import { useWorksheet } from '../../../infra/context';

import type { ResolvedFormControl } from './FormControlLayer';
import { FormControlLayer } from './FormControlLayer';

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

  const geometry = getGeometry();
  const viewport = getViewport();
  const sheetId = ws.getSheetId();

  // ═══════════════════════════════════════════════════════════════════════════
  // RESOLVE POSITIONS AND VALUES
  // ═══════════════════════════════════════════════════════════════════════════

  useEffect(() => {
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
  }, [geometry, isReady, refreshVersion, sheetId, viewport, ws]);

  // Form controls are managed below the React state tree. Subscribe to the
  // manager events so creates/updates immediately re-resolve DOM overlays.
  useEffect(() => {
    const bump = () => setRefreshVersion((version) => version + 1);
    const disposers = [
      ws.on('formControl:created', bump),
      ws.on('formControl:updated', bump),
      ws.on('formControl:deleted', bump),
      ws.on('cellChanged', bump),
      ws.on('row:height-changed', bump),
      ws.on('column:width-changed', bump),
    ];

    return () => {
      for (const dispose of disposers) dispose();
    };
  }, [sheetId, ws]);

  // ═══════════════════════════════════════════════════════════════════════════
  // CELL VALUE CHANGE HANDLER
  // ═══════════════════════════════════════════════════════════════════════════

  const handleCellValueChange = useCallback(
    (controlId: string, value: unknown) => {
      const controls = ws.formControls.list();
      const control = controls.find((c) => c.id === controlId);
      if (!control) return;

      const linkedCellId =
        control.type === 'checkbox' || control.type === 'comboBox'
          ? control.linkedCellId
          : control.type === 'button'
            ? control.linkedCellId
            : undefined;

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

  useEffect(() => {
    if (!viewport || !isReady) return;

    const syncScroll = () => {
      const pos = viewport.getScrollPosition();
      if (overlayRef.current) {
        overlayRef.current.style.transform = `translate3d(${-pos.x}px, ${-pos.y}px, 0)`;
      }
    };

    syncScroll();

    const inputCoordinator = coordinator.input.inputCoordinator;
    const unsubscribe = inputCoordinator.onScrollChange(syncScroll);

    return unsubscribe;
  }, [viewport, coordinator, isReady]);

  // ═══════════════════════════════════════════════════════════════════════════
  // EARLY RETURNS - After all hooks have been called
  // ═══════════════════════════════════════════════════════════════════════════

  if (!isReady || !geometry) {
    return null;
  }

  if (resolvedControls.length === 0) {
    return null;
  }

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 overflow-hidden pointer-events-none"
      style={{ willChange: 'transform' }}
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
  getCellRect?: (cell: {
    row: number;
    col: number;
  }) => { x: number; y: number; width: number; height: number } | null;
}

interface ViewportLike {
  getScrollPosition: () => { x: number; y: number };
}

interface WorksheetLike {
  _internal: { getCellPosition(cellId: string): Promise<{ row: number; col: number } | null> };
  getCell(row: number, col: number): Promise<{ value: unknown }>;
}

type WritableCellValue = string | number | boolean | null | Date;

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

    const x = viewportPoint.x + scrollPosition.x + (control.anchor.xOffset ?? 0);
    const y = viewportPoint.y + scrollPosition.y + (control.anchor.yOffset ?? 0);
    const width = anchorRect?.width ?? control.width;
    const height = anchorRect?.height ?? control.height;

    let cellValue: unknown;
    let resolvedItems: string[] | undefined;

    if (control.type === 'checkbox' || control.type === 'comboBox') {
      const linkedPosition = await ws._internal.getCellPosition(control.linkedCellId);
      if (linkedPosition) {
        const cell = await ws.getCell(linkedPosition.row, linkedPosition.col);
        cellValue = cell.value;
      }

      if (control.type === 'comboBox') {
        resolvedItems = await resolveComboBoxItems(control, ws);
      }
    } else if (control.type === 'button' && control.linkedCellId) {
      const linkedPosition = await ws._internal.getCellPosition(control.linkedCellId);
      if (linkedPosition) {
        const cell = await ws.getCell(linkedPosition.row, linkedPosition.col);
        cellValue = cell.value;
      }
    }

    resolved.push({ control, x, y, width, height, cellValue, resolvedItems });
  }

  return resolved;
}

async function resolveComboBoxItems(
  control: Extract<FormControl, { type: 'comboBox' }>,
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
