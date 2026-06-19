import type {
  PivotFieldArea,
  PivotFieldPlacementFlat as PivotFieldPlacement,
} from '@mog-sdk/contracts/pivot';

export type DragState =
  | { kind: 'field'; fieldId: string }
  | {
      kind: 'placement';
      placementId: string;
      fieldId: string;
      fromArea: PivotFieldArea;
      fromIndex: number;
    };

export interface DropIndicator {
  area: PivotFieldArea;
  position: number;
}

export type PointerDropTarget =
  | { kind: 'available' }
  | { kind: 'position'; area: PivotFieldArea; position: number; indicatorPosition: number };

export const PIVOT_FIELD_LIST_AREAS: PivotFieldArea[] = ['filter', 'column', 'row', 'value'];
export const DROP_PAYLOAD_TYPE = 'application/x-mog-pivot-field-pane';
export const POINTER_DRAG_THRESHOLD_PX = 4;

export function placementId(placement: Pick<PivotFieldPlacement, 'placementId'>): string {
  return String(placement.placementId);
}

export function serializeDragState(state: DragState): string {
  return JSON.stringify(state);
}

export function parseDragState(value: string): DragState | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<DragState>;
    if (parsed.kind === 'field' && typeof parsed.fieldId === 'string') {
      return { kind: 'field', fieldId: parsed.fieldId };
    }
    if (
      parsed.kind === 'placement' &&
      typeof parsed.placementId === 'string' &&
      typeof parsed.fieldId === 'string' &&
      typeof parsed.fromArea === 'string' &&
      PIVOT_FIELD_LIST_AREAS.includes(parsed.fromArea as PivotFieldArea) &&
      typeof parsed.fromIndex === 'number'
    ) {
      return {
        kind: 'placement',
        placementId: parsed.placementId,
        fieldId: parsed.fieldId,
        fromArea: parsed.fromArea as PivotFieldArea,
        fromIndex: parsed.fromIndex,
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function resolvePointerDropTarget(options: {
  clientX: number;
  clientY: number;
  state: DragState;
  canRemoveFields: boolean;
  placementsByArea: Record<PivotFieldArea, Array<{ placement: PivotFieldPlacement }>>;
}): PointerDropTarget | null {
  const { clientX, clientY, state, canRemoveFields, placementsByArea } = options;
  const elements = document
    .elementsFromPoint(clientX, clientY)
    .filter((element): element is HTMLElement => element instanceof HTMLElement);
  if (elements.length === 0) return null;

  if (
    state.kind === 'placement' &&
    canRemoveFields &&
    elements.some((element) => element.closest('[data-pivot-target="available-fields"]'))
  ) {
    return { kind: 'available' };
  }

  const chip =
    elements
      .map((element) =>
        element.closest<HTMLElement>('[data-pivot-target="field-chip"][data-pivot-area]'),
      )
      .find((candidate) => candidate?.dataset.pivotArea !== 'available') ?? null;
  const chipArea = chip?.dataset.pivotArea as PivotFieldArea | undefined;
  if (chip && chipArea && PIVOT_FIELD_LIST_AREAS.includes(chipArea)) {
    const targetIndex = placementsByArea[chipArea].findIndex(
      (item) => placementId(item.placement) === chip.dataset.pivotPlacementId,
    );
    if (targetIndex >= 0) {
      const rect = chip.getBoundingClientRect();
      const dropAfter = rect.height > 0 ? clientY > rect.top + rect.height / 2 : false;
      const insertionBeforeRemoval = targetIndex + (dropAfter ? 1 : 0);
      const adjustedPosition =
        state.kind === 'placement' &&
        state.fromArea === chipArea &&
        state.fromIndex < insertionBeforeRemoval
          ? insertionBeforeRemoval - 1
          : insertionBeforeRemoval;
      return {
        kind: 'position',
        area: chipArea,
        position: adjustedPosition,
        indicatorPosition: insertionBeforeRemoval,
      };
    }
  }

  const zone =
    elements
      .map((element) =>
        element.closest<HTMLElement>('[data-pivot-target="field-zone"][data-pivot-zone]'),
      )
      .find(Boolean) ?? null;
  const zoneArea = zone?.dataset.pivotZone as PivotFieldArea | undefined;
  if (zoneArea && PIVOT_FIELD_LIST_AREAS.includes(zoneArea)) {
    const appendPosition =
      state.kind === 'placement' && state.fromArea === zoneArea
        ? Math.max(0, placementsByArea[zoneArea].length - 1)
        : placementsByArea[zoneArea].length;
    return {
      kind: 'position',
      area: zoneArea,
      position: appendPosition,
      indicatorPosition: placementsByArea[zoneArea].length,
    };
  }

  return null;
}

export function dragStateFromPoint(options: {
  clientX: number;
  clientY: number;
  placementsByArea: Record<PivotFieldArea, Array<{ placement: PivotFieldPlacement }>>;
}): DragState | null {
  const { clientX, clientY, placementsByArea } = options;
  const chip =
    document
      .elementsFromPoint(clientX, clientY)
      .filter((element): element is HTMLElement => element instanceof HTMLElement)
      .map((element) =>
        element.closest<HTMLElement>('[data-pivot-target="field-chip"][data-pivot-area]'),
      )
      .find(Boolean) ?? null;
  if (!chip) return null;

  const area = chip.dataset.pivotArea as PivotFieldArea | 'available' | undefined;
  const fieldId = chip.dataset.pivotFieldId;
  if (!area || !fieldId) return null;
  if (area === 'available') return { kind: 'field', fieldId };
  if (!PIVOT_FIELD_LIST_AREAS.includes(area)) return null;

  const placementIdValue = chip.dataset.pivotPlacementId;
  const fromIndex = placementsByArea[area].findIndex(
    (item) => placementId(item.placement) === placementIdValue,
  );
  if (!placementIdValue || fromIndex < 0) return null;
  return {
    kind: 'placement',
    placementId: placementIdValue,
    fieldId,
    fromArea: area,
    fromIndex,
  };
}
