import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
} from 'react';

import type {
  AggregateFunction,
  PivotField,
  PivotFieldArea,
  PivotFieldPlacementFlat as PivotFieldPlacement,
  SortOrder,
} from '@mog-sdk/contracts/pivot';
import {
  setupAutoScroll,
  type AutoScrollController,
} from '../../systems/input/coordination/auto-scroll-service';
import {
  AggregateSelector,
  DataTypeIcon,
  LabelSortSelector,
  ValueSortSelector,
} from './PivotFieldListControls';
import { PivotFieldDropZone, type PlacedField } from './PivotFieldListDropZone';
import {
  defaultAggregate,
  defaultAreaForField,
  displayName,
  type PendingAutoActivatedMove,
} from './PivotFieldListModel';
import {
  DROP_PAYLOAD_TYPE,
  dragStateFromPoint,
  nativePositionDropTargetFromPoint,
  POINTER_DRAG_THRESHOLD_PX,
  parseDragState,
  placementId,
  resolvePointerDropTarget,
  serializeDragState,
  type DragState,
  type DropIndicator,
  type NativePositionDropTarget,
  type PointerDropTarget,
} from './PivotFieldListDrag';

export interface PivotFieldListProps {
  fields: PivotField[];
  placements: PivotFieldPlacement[];
  onAddField: (
    fieldId: string,
    area: PivotFieldArea,
    options?: { position?: number; aggregateFunction?: AggregateFunction },
  ) => void;
  onRemovePlacement: (placementId: string) => void;
  onMovePlacement: (placementId: string, toArea: PivotFieldArea, position: number) => void;
  onAggregateChange?: (placementId: string, aggregate: AggregateFunction) => void;
  onSortOrderChange?: (placementId: string, sortOrder: SortOrder) => void;
  onValueSortChange?: (valuePlacementId: string, sortOrder: SortOrder) => void;
  disabled?: boolean;
  canAddFields?: boolean;
  canReorderFields?: boolean;
  canRemoveFields?: boolean;
  canChangeAggregate?: boolean;
  canSortLabels?: boolean;
  canSortByValue?: boolean;
  getDragScrollContainer?: () => HTMLElement | null;
}

const DRAG_SCROLL_EDGE_PX = 48;
const POINTER_DRAG_IGNORED_SELECTOR =
  'button, select, input, textarea, [data-pivot-target="placement-controls"], [data-pivot-target="remove-field"]';

export function PivotFieldList({
  fields,
  placements,
  onAddField,
  onRemovePlacement,
  onMovePlacement,
  onAggregateChange,
  onSortOrderChange,
  onValueSortChange,
  disabled = false,
  canAddFields = !disabled,
  canReorderFields = !disabled,
  canRemoveFields = !disabled,
  canChangeAggregate = !disabled,
  canSortLabels = !disabled,
  canSortByValue = !disabled,
  getDragScrollContainer,
}: PivotFieldListProps) {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dragOverArea, setDragOverArea] = useState<PivotFieldArea | null>(null);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);
  const [selectedItem, setSelectedItem] = useState<DragState | null>(null);
  const dragPointRef = useRef<{ x: number; y: number } | null>(null);
  const autoScrollRef = useRef<AutoScrollController | null>(null);
  const autoActivatedFieldRef = useRef<{ fieldId: string; area: PivotFieldArea } | null>(null);
  const pendingAutoActivatedMoveRef = useRef<PendingAutoActivatedMove | null>(null);
  const pointerDragCancelRef = useRef<(() => void) | null>(null);
  const nativeDragStateRef = useRef<DragState | null>(null);
  const nativeDropTargetRef = useRef<NativePositionDropTarget | null>(null);

  const fieldById = useMemo(() => new Map(fields.map((field) => [field.id, field])), [fields]);
  const placedFieldIds = useMemo(
    () => new Set(placements.map((placement) => placement.fieldId)),
    [placements],
  );
  const placementsByArea = useMemo<Record<PivotFieldArea, PlacedField[]>>(() => {
    const byArea: Record<PivotFieldArea, PlacedField[]> = {
      filter: [],
      column: [],
      row: [],
      value: [],
    };

    for (const placement of [...placements].sort((a, b) => a.position - b.position)) {
      const field = fieldById.get(placement.fieldId);
      if (field) byArea[placement.area].push({ field, placement });
    }

    return byArea;
  }, [fieldById, placements]);

  const firstAxisPlacement =
    placementsByArea.row[0]?.placement ?? placementsByArea.column[0]?.placement ?? null;

  const currentValueSortOrder = useCallback(
    (valuePlacement: PivotFieldPlacement): SortOrder => {
      const sortByValue = firstAxisPlacement?.sortByValue;
      if (!sortByValue) return 'none';
      if (sortByValue.valuePlacementId === valuePlacement.placementId) return sortByValue.order;
      if (!sortByValue.valuePlacementId && sortByValue.valueFieldId === valuePlacement.fieldId) {
        return sortByValue.order;
      }
      return 'none';
    },
    [firstAxisPlacement],
  );

  const canDragState = useCallback(
    (state: DragState | null) => {
      if (!state || disabled) return false;
      return state.kind === 'field' ? canAddFields : canReorderFields;
    },
    [canAddFields, canReorderFields, disabled],
  );

  const dragStateFromEvent = useCallback(
    (event: DragEvent): DragState | null => {
      if (dragState) return dragState;
      const parsed = parseDragState(event.dataTransfer.getData(DROP_PAYLOAD_TYPE));
      if (parsed) return parsed;
      const fieldId = event.dataTransfer.getData('text/plain');
      return fieldId ? { kind: 'field', fieldId } : null;
    },
    [dragState],
  );

  const getScrollElement = useCallback(
    () => getDragScrollContainer?.() ?? null,
    [getDragScrollContainer],
  );

  const ensureAutoScroll = useCallback((): AutoScrollController => {
    if (autoScrollRef.current) return autoScrollRef.current;

    autoScrollRef.current = setupAutoScroll({
      getMousePosition: () => dragPointRef.current,
      getViewportBounds: () => {
        const element = getScrollElement();
        const rect = element?.getBoundingClientRect();
        return rect
          ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
          : { left: 0, top: 0, right: 0, bottom: 0 };
      },
      applyScrollDelta: (_dx, dy) => {
        const element = getScrollElement();
        if (element) element.scrollTop += dy;
      },
      threshold: DRAG_SCROLL_EDGE_PX,
    });

    return autoScrollRef.current;
  }, [getScrollElement]);

  const stopAutoScroll = useCallback(() => {
    dragPointRef.current = null;
    autoScrollRef.current?.stop();
  }, []);

  useEffect(() => {
    return () => {
      pointerDragCancelRef.current?.();
      pointerDragCancelRef.current = null;
      autoScrollRef.current?.cleanup();
      autoScrollRef.current = null;
    };
  }, []);

  useEffect(() => {
    const pending = pendingAutoActivatedMoveRef.current;
    if (!pending) return;

    const activatedPlacement = [...placementsByArea[pending.fromArea]]
      .reverse()
      .find((item) => item.field.id === pending.fieldId);
    if (!activatedPlacement) return;

    pendingAutoActivatedMoveRef.current = null;
    const position = Math.max(
      0,
      Math.min(pending.position, placementsByArea[pending.toArea].length),
    );
    onMovePlacement(placementId(activatedPlacement.placement), pending.toArea, position);
  }, [onMovePlacement, placementsByArea]);

  const applyDragStateToPosition = useCallback(
    (state: DragState, toArea: PivotFieldArea, toPosition: number) => {
      if (!canDragState(state)) return;
      if (state.kind === 'field') {
        const field = fieldById.get(state.fieldId);
        onAddField(state.fieldId, toArea, {
          position: Math.max(0, Math.min(toPosition, placementsByArea[toArea].length)),
          aggregateFunction: defaultAggregate(toArea, field),
        });
        return;
      }
      const maxPosition =
        state.fromArea === toArea
          ? Math.max(0, placementsByArea[toArea].length - 1)
          : placementsByArea[toArea].length;
      const finalPosition = Math.max(0, Math.min(toPosition, maxPosition));
      if (state.fromArea !== toArea || finalPosition !== state.fromIndex) {
        onMovePlacement(state.placementId, toArea, finalPosition);
      }
    },
    [canDragState, fieldById, onAddField, onMovePlacement, placementsByArea],
  );

  const clearDragFeedback = useCallback(() => {
    setDragState(null);
    setDragOverArea(null);
    setDropIndicator(null);
    setSelectedItem(null);
    stopAutoScroll();
  }, [stopAutoScroll]);

  const finishNativeDrag = useCallback(() => {
    const pendingDropTarget = nativeDropTargetRef.current;
    const resolvedDropTarget =
      pendingDropTarget ??
      nativePositionDropTargetFromPoint({
        dragPoint: dragPointRef.current,
        state: nativeDragStateRef.current,
        canRemoveFields,
        placementsByArea,
      });
    nativeDropTargetRef.current = null;
    nativeDragStateRef.current = null;
    if (resolvedDropTarget) {
      pointerDragCancelRef.current?.();
      pointerDragCancelRef.current = null;
      applyDragStateToPosition(
        resolvedDropTarget.state,
        resolvedDropTarget.area,
        resolvedDropTarget.position,
      );
    }
    clearDragFeedback();
  }, [applyDragStateToPosition, canRemoveFields, clearDragFeedback, placementsByArea]);

  const handleDragStart = useCallback(
    (event: DragEvent, state: DragState) => {
      if (!canDragState(state)) return;
      if (pointerDragCancelRef.current) {
        event.preventDefault();
        return;
      }
      nativeDropTargetRef.current = null;
      nativeDragStateRef.current = state;
      setDragState(state);
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData(DROP_PAYLOAD_TYPE, serializeDragState(state));
      event.dataTransfer.setData(
        'text/plain',
        state.kind === 'field' ? state.fieldId : state.placementId,
      );
      document.addEventListener('dragend', finishNativeDrag, { capture: true, once: true });
    },
    [canDragState, finishNativeDrag],
  );

  const handleDragEnd = finishNativeDrag;

  const resolvePositionDropTarget = useCallback(
    (event: DragEvent, state: DragState, area?: PivotFieldArea) => {
      if (state.kind !== 'placement') return null;
      const target = resolvePointerDropTarget({
        clientX: event.clientX,
        clientY: event.clientY,
        state,
        canRemoveFields,
        placementsByArea,
      });
      if (target?.kind !== 'position') return null;
      if (area !== undefined && target.area !== area) return null;
      return target;
    },
    [canRemoveFields, placementsByArea],
  );

  const setNativePositionDropTarget = useCallback(
    (state: DragState, target: NonNullable<ReturnType<typeof resolvePositionDropTarget>>) => {
      nativeDropTargetRef.current = {
        state,
        area: target.area,
        position: target.position,
      };
      setDragOverArea(target.area);
      setDropIndicator({ area: target.area, position: target.indicatorPosition });
    },
    [],
  );

  const handleListDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      const state = dragStateFromEvent(event);
      if (state?.kind === 'placement' && canDragState(state)) {
        const target = resolvePositionDropTarget(event, state);
        if (target) setNativePositionDropTarget(state, target);
      }
      if (!canDragState(state) || !getScrollElement()) {
        stopAutoScroll();
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      dragPointRef.current = { x: event.clientX, y: event.clientY };
      ensureAutoScroll().start();
    },
    [
      canDragState,
      dragStateFromEvent,
      ensureAutoScroll,
      getScrollElement,
      resolvePositionDropTarget,
      setNativePositionDropTarget,
      stopAutoScroll,
    ],
  );

  const handleListDragLeave = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      const relatedTarget = event.relatedTarget;
      if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) return;
      nativeDropTargetRef.current = null;
      stopAutoScroll();
      setDropIndicator(null);
    },
    [stopAutoScroll],
  );

  const handleDragOver = useCallback(
    (event: DragEvent, area: PivotFieldArea) => {
      const state = dragStateFromEvent(event);
      if (!state || !canDragState(state)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';

      const target = resolvePositionDropTarget(event, state, area);
      if (target) {
        setNativePositionDropTarget(state, target);
        return;
      }

      nativeDropTargetRef.current = {
        state,
        area,
        position:
          state.kind === 'placement' && state.fromArea === area
            ? Math.max(0, placementsByArea[area].length - 1)
            : placementsByArea[area].length,
      };
      setDragOverArea(area);
      setDropIndicator(null);
    },
    [
      canDragState,
      dragStateFromEvent,
      placementsByArea,
      resolvePositionDropTarget,
      setNativePositionDropTarget,
    ],
  );

  const handlePlacementDragOver = useCallback(
    (event: DragEvent, item: PlacedField, targetIndex: number) => {
      const state = dragStateFromEvent(event);
      if (!state || !canDragState(state)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'move';

      const target =
        state.kind === 'placement' && state.placementId === placementId(item.placement)
          ? resolvePositionDropTarget(event, state)
          : null;
      if (target) {
        setNativePositionDropTarget(state, target);
        return;
      }

      const rect = event.currentTarget.getBoundingClientRect();
      const dropAfter = rect.height > 0 ? event.clientY > rect.top + rect.height / 2 : false;
      const insertionBeforeRemoval = targetIndex + (dropAfter ? 1 : 0);
      const adjustedPosition =
        state.kind === 'placement' &&
        state.fromArea === item.placement.area &&
        state.fromIndex < insertionBeforeRemoval
          ? insertionBeforeRemoval - 1
          : insertionBeforeRemoval;
      nativeDropTargetRef.current = {
        state,
        area: item.placement.area,
        position: adjustedPosition,
      };
      setDragOverArea(item.placement.area);
      setDropIndicator({
        area: item.placement.area,
        position: insertionBeforeRemoval,
      });
    },
    [canDragState, dragStateFromEvent, resolvePositionDropTarget, setNativePositionDropTarget],
  );

  const handleDropAtPosition = useCallback(
    (event: DragEvent, toArea: PivotFieldArea, toPosition: number) => {
      event.preventDefault();
      event.stopPropagation();
      const state = dragStateFromEvent(event);
      if (!state || !canDragState(state)) {
        stopAutoScroll();
        return;
      }

      nativeDropTargetRef.current = null;
      nativeDragStateRef.current = null;
      pointerDragCancelRef.current?.();
      pointerDragCancelRef.current = null;
      applyDragStateToPosition(state, toArea, toPosition);
      clearDragFeedback();
    },
    [canDragState, dragStateFromEvent, applyDragStateToPosition, clearDragFeedback, stopAutoScroll],
  );

  const dropTargetFromPoint = useCallback(
    (clientX: number, clientY: number, state: DragState) =>
      resolvePointerDropTarget({ clientX, clientY, state, canRemoveFields, placementsByArea }),
    [canRemoveFields, placementsByArea],
  );

  const handleMouseDragStart = useCallback(
    (event: MouseEvent<HTMLElement>, state: DragState) => {
      if (event.button !== 0 || !canDragState(state)) return;
      const start = { x: event.clientX, y: event.clientY };
      let active = false;
      let lastDropTarget: PointerDropTarget | null = null;

      const updateFeedback = (clientX: number, clientY: number) => {
        const target = dropTargetFromPoint(clientX, clientY, state);
        lastDropTarget = target;
        if (target?.kind === 'position') {
          setDragOverArea(target.area);
          setDropIndicator({ area: target.area, position: target.indicatorPosition });
        } else {
          setDragOverArea(null);
          setDropIndicator(null);
        }
      };

      const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
        const dx = moveEvent.clientX - start.x;
        const dy = moveEvent.clientY - start.y;
        if (!active && Math.hypot(dx, dy) < POINTER_DRAG_THRESHOLD_PX) return;
        if (!active) {
          active = true;
          setDragState(state);
          setSelectedItem(null);
        }
        dragPointRef.current = { x: moveEvent.clientX, y: moveEvent.clientY };
        ensureAutoScroll().start();
        updateFeedback(moveEvent.clientX, moveEvent.clientY);
      };

      const handleMouseUp = (upEvent: globalThis.MouseEvent) => {
        cleanup();
        if (!active) return;
        const currentTarget = dropTargetFromPoint(upEvent.clientX, upEvent.clientY, state);
        const target =
          currentTarget?.kind === 'available' ? currentTarget : (lastDropTarget ?? currentTarget);
        if (target?.kind === 'available' && state.kind === 'placement' && canRemoveFields) {
          onRemovePlacement(state.placementId);
        } else if (target?.kind === 'position') {
          applyDragStateToPosition(state, target.area, target.position);
        }
        clearDragFeedback();
      };

      const cleanup = () => {
        document.removeEventListener('mousemove', handleMouseMove, true);
        document.removeEventListener('mouseup', handleMouseUp, true);
        if (pointerDragCancelRef.current === cleanup) {
          pointerDragCancelRef.current = null;
        }
      };

      document.addEventListener('mousemove', handleMouseMove, true);
      document.addEventListener('mouseup', handleMouseUp, true);
      pointerDragCancelRef.current = cleanup;
    },
    [
      applyDragStateToPosition,
      canDragState,
      canRemoveFields,
      clearDragFeedback,
      dropTargetFromPoint,
      ensureAutoScroll,
      onRemovePlacement,
    ],
  );

  const handleListMouseDownCapture = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest(POINTER_DRAG_IGNORED_SELECTOR)
      ) {
        return;
      }
      const state = dragStateFromPoint({
        clientX: event.clientX,
        clientY: event.clientY,
        placementsByArea,
      });
      if (state) handleMouseDragStart(event, state);
    },
    [handleMouseDragStart, placementsByArea],
  );

  const handleDropOnZone = useCallback(
    (event: DragEvent, toArea: PivotFieldArea) => {
      const state = dragStateFromEvent(event);
      const target = state ? resolvePositionDropTarget(event, state, toArea) : null;
      if (target) {
        handleDropAtPosition(event, target.area, target.position);
        return;
      }
      const appendPosition =
        state?.kind === 'placement' && state.fromArea === toArea
          ? Math.max(0, placementsByArea[toArea].length - 1)
          : placementsByArea[toArea].length;
      handleDropAtPosition(event, toArea, appendPosition);
    },
    [dragStateFromEvent, handleDropAtPosition, placementsByArea, resolvePositionDropTarget],
  );

  const handleAvailableDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      const state = dragStateFromEvent(event);
      if (!state || state.kind !== 'placement' || !canDragState(state) || !canRemoveFields) {
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      nativeDropTargetRef.current = null;
      nativeDragStateRef.current = null;
      setDragOverArea(null);
      setDropIndicator(null);
    },
    [canDragState, canRemoveFields, dragStateFromEvent],
  );

  const handleDropOnAvailable = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      const state = dragStateFromEvent(event);
      if (!state || state.kind !== 'placement' || !canDragState(state) || !canRemoveFields) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      nativeDropTargetRef.current = null;
      nativeDragStateRef.current = null;
      pointerDragCancelRef.current?.();
      pointerDragCancelRef.current = null;
      onRemovePlacement(state.placementId);
      clearDragFeedback();
    },
    [canDragState, canRemoveFields, clearDragFeedback, dragStateFromEvent, onRemovePlacement],
  );

  const handleDropOnPlacement = useCallback(
    (event: DragEvent, item: PlacedField, targetIndex: number) => {
      const state = dragStateFromEvent(event);
      if (!state) return;

      if (state.kind === 'placement' && state.placementId === placementId(item.placement)) {
        const target = resolvePointerDropTarget({
          clientX: event.clientX,
          clientY: event.clientY,
          state,
          canRemoveFields,
          placementsByArea,
        });
        if (target?.kind === 'position') {
          handleDropAtPosition(event, target.area, target.position);
          return;
        }
      }

      const rect = event.currentTarget.getBoundingClientRect();
      const dropAfter = rect.height > 0 ? event.clientY > rect.top + rect.height / 2 : false;
      const insertionBeforeRemoval = targetIndex + (dropAfter ? 1 : 0);
      const adjustedPosition =
        state.kind === 'placement' &&
        state.fromArea === item.placement.area &&
        state.fromIndex < insertionBeforeRemoval
          ? insertionBeforeRemoval - 1
          : insertionBeforeRemoval;

      handleDropAtPosition(event, item.placement.area, adjustedPosition);
    },
    [canRemoveFields, dragStateFromEvent, handleDropAtPosition, placementsByArea],
  );

  const consumeAutoActivatedField = useCallback(
    (fieldId: string, toArea: PivotFieldArea, position: number): boolean => {
      const autoActivated = autoActivatedFieldRef.current;
      if (!autoActivated || autoActivated.fieldId !== fieldId) return false;

      autoActivatedFieldRef.current = null;
      setSelectedItem(null);

      if (autoActivated.area === toArea) {
        return true;
      }

      const activatedPlacement = [...placementsByArea[autoActivated.area]]
        .reverse()
        .find((item) => item.field.id === fieldId);
      if (activatedPlacement) {
        const finalPosition = Math.max(0, Math.min(position, placementsByArea[toArea].length));
        onMovePlacement(placementId(activatedPlacement.placement), toArea, finalPosition);
        return true;
      }

      pendingAutoActivatedMoveRef.current = {
        fieldId,
        fromArea: autoActivated.area,
        toArea,
        position,
      };
      return true;
    },
    [onMovePlacement, placementsByArea],
  );

  const handleZoneClick = useCallback(
    (toArea: PivotFieldArea) => {
      if (!selectedItem || !canDragState(selectedItem)) return;
      const appendPosition =
        selectedItem.kind === 'placement' && selectedItem.fromArea === toArea
          ? Math.max(0, placementsByArea[toArea].length - 1)
          : placementsByArea[toArea].length;

      if (selectedItem.kind === 'field') {
        if (consumeAutoActivatedField(selectedItem.fieldId, toArea, appendPosition)) return;
        const field = fieldById.get(selectedItem.fieldId);
        onAddField(selectedItem.fieldId, toArea, {
          position: appendPosition,
          aggregateFunction: defaultAggregate(toArea, field),
        });
      } else if (selectedItem.fromArea !== toArea || selectedItem.fromIndex !== appendPosition) {
        onMovePlacement(selectedItem.placementId, toArea, appendPosition);
      }

      autoActivatedFieldRef.current = null;
      setSelectedItem(null);
    },
    [
      canDragState,
      consumeAutoActivatedField,
      fieldById,
      onAddField,
      onMovePlacement,
      placementsByArea,
      selectedItem,
    ],
  );

  const activateSourceField = useCallback(
    (field: PivotField) => {
      const state: DragState = { kind: 'field', fieldId: field.id };
      if (!canDragState(state)) return;
      const area = defaultAreaForField(field);
      onAddField(field.id, area, {
        position: placementsByArea[area].length,
        aggregateFunction: defaultAggregate(area, field),
      });
      autoActivatedFieldRef.current = { fieldId: field.id, area };
      setSelectedItem(state);
    },
    [canDragState, onAddField, placementsByArea],
  );

  const applySelectedItemAtPosition = useCallback(
    (toArea: PivotFieldArea, position: number) => {
      if (!selectedItem || !canDragState(selectedItem)) return false;

      if (selectedItem.kind === 'field') {
        if (consumeAutoActivatedField(selectedItem.fieldId, toArea, position)) return true;
        const field = fieldById.get(selectedItem.fieldId);
        onAddField(selectedItem.fieldId, toArea, {
          position: Math.max(0, Math.min(position, placementsByArea[toArea].length)),
          aggregateFunction: defaultAggregate(toArea, field),
        });
        setSelectedItem(null);
        return true;
      }

      const maxPosition =
        selectedItem.fromArea === toArea
          ? Math.max(0, placementsByArea[toArea].length - 1)
          : placementsByArea[toArea].length;
      const finalPosition = Math.max(0, Math.min(position, maxPosition));
      if (selectedItem.fromArea !== toArea || selectedItem.fromIndex !== finalPosition) {
        onMovePlacement(selectedItem.placementId, toArea, finalPosition);
      }
      setSelectedItem(null);
      return true;
    },
    [
      canDragState,
      consumeAutoActivatedField,
      fieldById,
      onAddField,
      onMovePlacement,
      placementsByArea,
      selectedItem,
    ],
  );

  const renderSourceFieldRow = (field: PivotField) => {
    const state: DragState = { kind: 'field', fieldId: field.id };
    const isDragging = dragState?.kind === 'field' && dragState.fieldId === field.id;
    const isSelected = selectedItem?.kind === 'field' && selectedItem.fieldId === field.id;
    const isChecked = isSelected || placedFieldIds.has(field.id);
    const canDrag = canDragState(state);

    return (
      <div
        key={`available-${field.id}`}
        className={`flex w-full max-w-full min-w-0 items-center gap-2 px-2 py-1.5 rounded text-body-sm select-none transition-colors ${
          canDrag ? 'cursor-grab' : 'cursor-default'
        } ${isDragging ? 'opacity-50' : ''} ${
          isSelected ? 'ring-2 ring-ss-primary' : ''
        } hover:bg-ss-surface-hover`}
        draggable={canDrag}
        role="checkbox"
        aria-checked={isChecked}
        aria-disabled={!canDrag}
        tabIndex={canDrag ? 0 : -1}
        title={field.name}
        aria-label={field.name}
        onDragStart={(event) => handleDragStart(event, state)}
        onDragEnd={handleDragEnd}
        onClick={(event) => {
          event.stopPropagation();
          activateSourceField(field);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          event.stopPropagation();
          activateSourceField(field);
        }}
        data-pivot-target="field-chip"
        data-pivot-field-id={field.id}
        data-pivot-field-name={field.name}
        data-pivot-display-name={field.name}
        data-pivot-placement-id={field.id}
        data-pivot-area="available"
        data-pivot-selected={isSelected ? 'true' : 'false'}
        data-pivot-checked={isChecked ? 'true' : 'false'}
      >
        <span
          aria-hidden="true"
          className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border text-[10px] leading-none ${
            isChecked
              ? 'border-ss-primary bg-ss-primary text-white'
              : 'border-ss-border bg-ss-surface text-transparent'
          }`}
        >
          ✓
        </span>
        <DataTypeIcon dataType={field.dataType} />
        <span className="min-w-0 flex-1 truncate" title={field.name}>
          {field.name}
        </span>
      </div>
    );
  };

  const renderPlacementChip = (item: PlacedField, index: number) => {
    const { field, placement } = item;
    const id = placementId(placement);
    const label = displayName(field, placement);
    const state: DragState = {
      kind: 'placement',
      placementId: id,
      fieldId: field.id,
      fromArea: placement.area,
      fromIndex: index,
    };
    const isDragging = dragState?.kind === 'placement' && dragState.placementId === id;
    const isSelected = selectedItem?.kind === 'placement' && selectedItem.placementId === id;
    const canDrag = canDragState(state);
    const isValueField = placement.area === 'value';
    const canRenderLabelSort = placement.area === 'row' || placement.area === 'column';
    const canRenderValueSort = isValueField && firstAxisPlacement != null;
    const showControls =
      (isValueField && onAggregateChange) ||
      (canRenderLabelSort && onSortOrderChange) ||
      (canRenderValueSort && onValueSortChange);

    return (
      <div
        key={id}
        className={`relative flex w-full max-w-full min-w-0 flex-col gap-1.5 px-2 py-1.5 rounded text-body-sm select-none transition-colors ${
          canDrag ? 'cursor-grab' : 'cursor-default'
        } ${isDragging ? 'opacity-50' : ''} ${isSelected ? 'ring-2 ring-ss-primary' : ''} ${
          isValueField ? 'bg-ss-primary-light' : 'bg-ss-surface-hover'
        }`}
        draggable={canDrag}
        title={label}
        aria-label={label}
        onDragStart={(event) => handleDragStart(event, state)}
        onDragEnd={handleDragEnd}
        onDragOver={(event) => handlePlacementDragOver(event, item, index)}
        onDrop={(event) => handleDropOnPlacement(event, item, index)}
        onClick={(event) => {
          event.stopPropagation();
          if (selectedItem && canDragState(selectedItem)) {
            if (selectedItem.kind === 'field') {
              if (applySelectedItemAtPosition(placement.area, index + 1)) return;
            } else if (selectedItem.placementId !== id) {
              const insertionBeforeRemoval = index + 1;
              const adjustedPosition =
                selectedItem.fromArea === placement.area &&
                selectedItem.fromIndex < insertionBeforeRemoval
                  ? insertionBeforeRemoval - 1
                  : insertionBeforeRemoval;
              if (applySelectedItemAtPosition(placement.area, adjustedPosition)) return;
            }
          }
          if (canDrag) setSelectedItem(state);
        }}
        data-pivot-target="field-chip"
        data-pivot-field-id={field.id}
        data-pivot-field-name={field.name}
        data-pivot-display-name={label}
        data-pivot-placement-id={id}
        data-pivot-area={placement.area}
        data-pivot-selected={isSelected ? 'true' : 'false'}
      >
        <div className="flex w-full min-w-0 items-center gap-1.5">
          <DataTypeIcon dataType={field.dataType} />
          <span
            className="min-w-0 flex-1 truncate"
            title={label}
            aria-label={label}
            draggable={false}
            onDragStart={(event) => handleDragStart(event, state)}
            onDragEnd={handleDragEnd}
          >
            {label}
          </span>
          {canRemoveFields && (
            <button
              type="button"
              className="flex shrink-0 items-center justify-center w-5 h-5 p-0 border-none rounded-full bg-transparent cursor-pointer text-ss-text-secondary text-caption leading-none hover:bg-ss-surface-active disabled:cursor-default disabled:opacity-50"
              onClick={(event) => {
                event.stopPropagation();
                onRemovePlacement(id);
              }}
              title="Remove field"
              aria-label={`Remove ${label}`}
              disabled={disabled || !canRemoveFields}
              data-pivot-target="remove-field"
              data-pivot-field-id={field.id}
              data-pivot-placement-id={id}
              data-pivot-area={placement.area}
            >
              ×
            </button>
          )}
        </div>
        {showControls && (
          <div className="flex w-full min-w-0 gap-1" data-pivot-target="placement-controls">
            {isValueField && placement.aggregateFunction && onAggregateChange && (
              <AggregateSelector
                value={placement.aggregateFunction}
                disabled={disabled || !canChangeAggregate}
                onChange={(aggregate) => onAggregateChange(id, aggregate)}
              />
            )}
            {canRenderLabelSort && onSortOrderChange && (
              <LabelSortSelector
                value={placement.sortOrder ?? 'none'}
                label={label}
                disabled={disabled || !canSortLabels}
                onChange={(sortOrder) => onSortOrderChange(id, sortOrder)}
              />
            )}
            {canRenderValueSort && onValueSortChange && (
              <ValueSortSelector
                value={currentValueSortOrder(placement)}
                label={label}
                disabled={disabled || !canSortByValue || !firstAxisPlacement}
                onChange={(sortOrder) => onValueSortChange(id, sortOrder)}
              />
            )}
          </div>
        )}
      </div>
    );
  };

  const renderDropZone = (area: PivotFieldArea, label: string) => (
    <PivotFieldDropZone
      area={area}
      label={label}
      placedFields={placementsByArea[area]}
      dragOverArea={dragOverArea}
      dropIndicator={dropIndicator}
      acceptsSelected={selectedItem != null}
      renderPlacementChip={renderPlacementChip}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragOverArea(null)}
      onDrop={handleDropOnZone}
      onClick={handleZoneClick}
    />
  );

  return (
    <div
      className="flex flex-col gap-4 p-4 bg-ss-surface-secondary rounded-ss-lg text-body-sm"
      data-pivot-target="field-list"
      onMouseDownCapture={handleListMouseDownCapture}
      onDragOver={handleListDragOver}
      onDragLeave={handleListDragLeave}
    >
      <div className="flex flex-col gap-2">
        <div className="font-semibold text-caption text-ss-text-secondary uppercase tracking-wide">
          Available Fields
        </div>
        <div
          className="flex max-h-60 min-h-9 flex-col gap-0.5 overflow-y-auto p-1 bg-ss-surface border border-ss-border rounded"
          role="group"
          aria-label="Available fields"
          onDragOver={handleAvailableDragOver}
          onDrop={handleDropOnAvailable}
          data-pivot-target="available-fields"
          data-pivot-zone="available"
        >
          {fields.length === 0 ? (
            <span className="text-caption text-ss-text-disabled italic p-1">No fields</span>
          ) : (
            fields.map(renderSourceFieldRow)
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {renderDropZone('filter', 'Filters')}
        {renderDropZone('column', 'Columns')}
        {renderDropZone('row', 'Rows')}
        {renderDropZone('value', 'Values')}
      </div>
    </div>
  );
}
