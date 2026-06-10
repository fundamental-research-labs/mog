import type { ISheetViewGeometry, ISheetViewViewport } from '@mog-sdk/sheet-view';
import type { Point } from '@mog-sdk/contracts/viewport';

type FrozenPaneLike = {
  readonly rows?: number | null;
  readonly cols?: number | null;
};

type NormalizedFrozenPanes = {
  readonly rows: number;
  readonly cols: number;
};

type DimensionPosition = 'top' | 'left';

export interface CellLevelScrollPositionArgs {
  readonly geometry: Pick<ISheetViewGeometry, 'getDimensions'>;
  readonly viewport?: Pick<ISheetViewViewport, 'getFrozenPanes'> | null;
  readonly topRow: number;
  readonly leftCol: number;
  readonly frozenPanes?: FrozenPaneLike | null;
}

function normalizeIndex(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function normalizeFrozenPaneCount(value: number | null | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value as number)) : 0;
}

function hasDimensionPosition(
  candidate: unknown,
  key: DimensionPosition,
): candidate is Partial<Record<DimensionPosition, number>> {
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    key in candidate &&
    typeof (candidate as Record<string, unknown>)[key] === 'number'
  );
}

function getDimensionPosition(
  geometry: Pick<ISheetViewGeometry, 'getDimensions'>,
  row: number,
  col: number,
  key: DimensionPosition,
): number | null {
  const dimension = geometry
    .getDimensions({ row, col })
    .find((candidate) => hasDimensionPosition(candidate, key));

  if (!dimension) return null;
  const position = (dimension as Partial<Record<DimensionPosition, number>>)[key];
  return typeof position === 'number' && Number.isFinite(position) ? position : null;
}

function resolveFrozenPanes(args: CellLevelScrollPositionArgs): NormalizedFrozenPanes {
  const frozenPanes = args.frozenPanes ?? args.viewport?.getFrozenPanes() ?? { rows: 0, cols: 0 };
  return {
    rows: normalizeFrozenPaneCount(frozenPanes.rows),
    cols: normalizeFrozenPaneCount(frozenPanes.cols),
  };
}

export function resolveCellLevelScrollPosition(args: CellLevelScrollPositionArgs): Point | null {
  const topRow = normalizeIndex(args.topRow);
  const leftCol = normalizeIndex(args.leftCol);
  const frozenPanes = resolveFrozenPanes(args);

  const rowTop = getDimensionPosition(args.geometry, topRow, 0, 'top');
  const colLeft = getDimensionPosition(args.geometry, 0, leftCol, 'left');
  if (rowTop === null || colLeft === null) return null;

  const frozenRowTop =
    frozenPanes.rows > 0 ? getDimensionPosition(args.geometry, frozenPanes.rows, 0, 'top') : 0;
  const frozenColLeft =
    frozenPanes.cols > 0 ? getDimensionPosition(args.geometry, 0, frozenPanes.cols, 'left') : 0;
  if (frozenRowTop === null || frozenColLeft === null) return null;

  return {
    x: Math.max(0, colLeft - frozenColLeft),
    y: Math.max(0, rowTop - frozenRowTop),
  };
}
