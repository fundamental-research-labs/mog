import type { DataRow, Layout, MarkSpec } from '../spec';

type Axis = 'x' | 'y';

export function directPosition(
  datum: DataRow,
  field: string | undefined,
  layout: Layout,
  axis: Axis,
  coordinateSystem: MarkSpec['coordinateSystem'],
): number | undefined {
  const value = datumNumber(datum, field);
  if (value === undefined) return undefined;
  if (coordinateSystem === 'chartFraction') {
    return axis === 'x' ? value * layout.width : value * layout.height;
  }
  if (coordinateSystem === 'dataTableFraction') {
    const table = layout.dataTable;
    if (!table) return undefined;
    return axis === 'x' ? table.x + value * table.width : table.y + value * table.height;
  }
  if (coordinateSystem === 'plotRadiusFraction') {
    const diameter = Math.min(layout.plotArea.width, layout.plotArea.height);
    const center =
      axis === 'x'
        ? layout.plotArea.x + layout.plotArea.width / 2
        : layout.plotArea.y + layout.plotArea.height / 2;
    return center + (value - 0.5) * diameter;
  }
  if (coordinateSystem !== 'plotFraction') return value;
  return axis === 'x'
    ? layout.plotArea.x + value * layout.plotArea.width
    : layout.plotArea.y + value * layout.plotArea.height;
}

function datumNumber(datum: DataRow, field: string | undefined): number | undefined {
  if (!field) return undefined;
  const value = datum[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
