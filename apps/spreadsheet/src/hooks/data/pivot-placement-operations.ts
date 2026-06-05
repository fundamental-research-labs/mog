import type {
  AggregateFunction,
  PivotFieldArea,
  PivotFieldPlacementFlat as PivotFieldPlacement,
  PivotTableConfig,
  SortOrder,
} from '@mog-sdk/contracts/pivot';

export interface PivotPlacementAddSpec {
  fieldId: string;
  area: PivotFieldArea;
  position?: number;
  aggregateFunction?: AggregateFunction;
  sortOrder?: SortOrder;
  displayName?: string;
}

export type PivotValueSortOrder = Exclude<SortOrder, 'none'>;

const PIVOT_AREAS: PivotFieldArea[] = ['filter', 'column', 'row', 'value'];

function orderedAreaPlacements(
  placements: PivotFieldPlacement[],
  area: PivotFieldArea,
): PivotFieldPlacement[] {
  return placements
    .filter((placement) => placement.area === area)
    .sort((a, b) => a.position - b.position);
}

function renumberPlacementPositions(placements: PivotFieldPlacement[]): PivotFieldPlacement[] {
  const nextPosition: Record<PivotFieldArea, number> = {
    filter: 0,
    column: 0,
    row: 0,
    value: 0,
  };

  return placements.map((placement) => ({
    ...placement,
    position: nextPosition[placement.area]++,
  }));
}

function makeClientPlacementId(
  config: PivotTableConfig,
  area: PivotFieldArea,
  fieldId: string,
): PivotFieldPlacement['placementId'] {
  const existingIds = new Set(config.placements.map((placement) => String(placement.placementId)));
  const existingForField = config.placements.filter(
    (placement) => placement.area === area && placement.fieldId === fieldId,
  ).length;
  let suffix = existingForField;
  let candidate = `${area}:${fieldId}:${suffix}`;
  while (existingIds.has(candidate)) {
    suffix += 1;
    candidate = `${area}:${fieldId}:${suffix}`;
  }
  return candidate as PivotFieldPlacement['placementId'];
}

function findPlacementById(
  config: PivotTableConfig,
  placementId: string,
): PivotFieldPlacement | null {
  return config.placements.find((placement) => String(placement.placementId) === placementId) ?? null;
}

export function addPlacementToConfig(
  config: PivotTableConfig,
  spec: PivotPlacementAddSpec,
): PivotFieldPlacement[] {
  const targetAreaPlacements = orderedAreaPlacements(config.placements, spec.area);
  const otherPlacements = PIVOT_AREAS.filter((area) => area !== spec.area).flatMap((area) =>
    orderedAreaPlacements(config.placements, area),
  );
  const position = Math.max(
    0,
    Math.min(spec.position ?? targetAreaPlacements.length, targetAreaPlacements.length),
  );
  const sortOrder = spec.sortOrder && spec.sortOrder !== 'none' ? spec.sortOrder : undefined;
  const newPlacement: PivotFieldPlacement = {
    placementId: makeClientPlacementId(config, spec.area, spec.fieldId),
    fieldId: spec.fieldId,
    area: spec.area,
    position,
    aggregateFunction:
      spec.area === 'value' ? (spec.aggregateFunction ?? 'sum') : spec.aggregateFunction,
    sortOrder,
    displayName: spec.displayName,
  };

  targetAreaPlacements.splice(position, 0, newPlacement);
  return renumberPlacementPositions([...otherPlacements, ...targetAreaPlacements]);
}

export function movePlacementInConfig(
  config: PivotTableConfig,
  placementId: string,
  toArea: PivotFieldArea,
  toPosition: number,
): PivotFieldPlacement[] {
  const moving = findPlacementById(config, placementId);
  if (!moving) return config.placements;

  const remainingPlacements = config.placements.filter(
    (placement) => String(placement.placementId) !== placementId,
  );
  const targetAreaPlacements = orderedAreaPlacements(remainingPlacements, toArea);
  const otherPlacements = PIVOT_AREAS.filter((area) => area !== toArea).flatMap((area) =>
    orderedAreaPlacements(remainingPlacements, area),
  );
  const position = Math.max(0, Math.min(toPosition, targetAreaPlacements.length));
  const movedPlacement: PivotFieldPlacement = {
    ...moving,
    area: toArea,
    position,
  };

  targetAreaPlacements.splice(position, 0, movedPlacement);
  return renumberPlacementPositions([...otherPlacements, ...targetAreaPlacements]);
}

export function removePlacementFromConfig(
  config: PivotTableConfig,
  placementId: string,
): PivotFieldPlacement[] {
  const remainingPlacements = config.placements.filter(
    (placement) => String(placement.placementId) !== placementId,
  );
  return renumberPlacementPositions(
    PIVOT_AREAS.flatMap((area) => orderedAreaPlacements(remainingPlacements, area)),
  );
}

export function setPlacementAggregateInConfig(
  config: PivotTableConfig,
  placementId: string,
  aggregateFunction: AggregateFunction,
): PivotFieldPlacement[] {
  return config.placements.map((placement) =>
    String(placement.placementId) === placementId && placement.area === 'value'
      ? { ...placement, aggregateFunction }
      : placement,
  );
}

export function setPlacementSortOrderInConfig(
  config: PivotTableConfig,
  placementId: string,
  sortOrder: SortOrder,
): PivotFieldPlacement[] {
  return config.placements.map((placement) => {
    if (
      String(placement.placementId) !== placementId ||
      (placement.area !== 'row' && placement.area !== 'column')
    ) {
      return placement;
    }
    return {
      ...placement,
      sortOrder: sortOrder === 'none' ? undefined : sortOrder,
    };
  });
}

export function setSortByValueInConfig(
  config: PivotTableConfig,
  axisPlacementId: string,
  valuePlacementId: string,
  valueSortConfig: { order: PivotValueSortOrder; columnKey?: string } | null,
): PivotFieldPlacement[] {
  const axisPlacement = findPlacementById(config, axisPlacementId);
  const valuePlacement = findPlacementById(config, valuePlacementId);
  if (
    !axisPlacement ||
    !valuePlacement ||
    valuePlacement.area !== 'value' ||
    (axisPlacement.area !== 'row' && axisPlacement.area !== 'column')
  ) {
    return config.placements;
  }

  return config.placements.map((placement) => {
    if (String(placement.placementId) !== axisPlacementId) return placement;

    if (!valueSortConfig) {
      const current = placement.sortByValue;
      const targetsValuePlacement =
        current?.valuePlacementId === valuePlacementId ||
        (!current?.valuePlacementId && current?.valueFieldId === valuePlacement.fieldId);
      return targetsValuePlacement ? { ...placement, sortByValue: undefined } : placement;
    }

    return {
      ...placement,
      sortByValue: {
        valueFieldId: valuePlacement.fieldId,
        valuePlacementId: valuePlacement.placementId,
        order: valueSortConfig.order,
        columnKey: valueSortConfig.columnKey,
      },
    };
  });
}
