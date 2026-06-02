import { calculateLayout, type LayoutDimensions } from './layout';
import {
  isLayerSpec,
  type AxisSpec,
  type ChannelSpec,
  type ChartSpec,
  type ConfigSpec,
  type DataRow,
  type EncodingSpec,
  type Layout,
} from './spec';

type LayoutResult<T extends ChartSpec> = {
  spec: T;
  layout: Layout;
};

const DEFAULT_LABEL_GAP_PX = 8;
const MAX_RECONCILE_PASSES = 2;

export function calculatePathReconciledLayout<T extends ChartSpec>(
  spec: T,
  data: DataRow[],
  dimensions: LayoutDimensions,
): LayoutResult<T> {
  let resolvedSpec = spec;
  let layout = calculateLayout(resolvedSpec, dimensions);

  for (let pass = 0; pass < MAX_RECONCILE_PASSES; pass += 1) {
    const nextSpec = reconcilePathCartesianSpec(resolvedSpec, data, layout);
    if (nextSpec === resolvedSpec) break;
    resolvedSpec = nextSpec;
    layout = calculateLayout(resolvedSpec, dimensions);
  }

  return { spec: resolvedSpec, layout };
}

export function reconcilePathCartesianSpec<T extends ChartSpec>(
  spec: T,
  data: DataRow[],
  layout: Layout,
): T {
  if (isLayerSpec(spec)) {
    let changed = false;
    const topLevel = reconcileEncoding(spec.encoding, dataRowsForSpec(spec, data), layout);
    if (topLevel.encoding !== spec.encoding) changed = true;

    const layers = spec.layer.map((layer) => {
      const rows = dataRowsForSpec(layer, dataRowsForSpec(spec, data));
      const reconciled = reconcileEncoding(layer.encoding, rows, layout);
      if (reconciled.encoding === layer.encoding) return layer;
      changed = true;
      return { ...layer, encoding: reconciled.encoding };
    });

    const config = reconcilePathLayoutHints(
      spec.config,
      changed,
      [topLevel.encoding, ...layers.map((layer) => layer.encoding)],
    );
    if (config !== spec.config) changed = true;

    return changed ? ({ ...spec, encoding: topLevel.encoding, layer: layers, config } as T) : spec;
  }

  const rows = dataRowsForSpec(spec, data);
  const reconciled = reconcileEncoding(spec.encoding, rows, layout);
  const config = reconcilePathLayoutHints(spec.config, reconciled.changed, [reconciled.encoding]);
  if (reconciled.encoding === spec.encoding && config === spec.config) return spec;
  return { ...spec, encoding: reconciled.encoding, config } as T;
}

function reconcileEncoding(
  encoding: EncodingSpec | undefined,
  data: DataRow[],
  layout: Layout,
): { encoding: EncodingSpec | undefined; changed: boolean } {
  if (!encoding) return { encoding, changed: false };

  const x = reconcileChannel(encoding.x, data, layout, 'x');
  const y = reconcileChannel(encoding.y, data, layout, 'y');
  if (x.channel === encoding.x && y.channel === encoding.y) {
    return { encoding, changed: false };
  }

  return {
    encoding: {
      ...encoding,
      ...(x.channel !== encoding.x ? { x: x.channel } : {}),
      ...(y.channel !== encoding.y ? { y: y.channel } : {}),
    },
    changed: true,
  };
}

function reconcileChannel(
  channel: ChannelSpec | undefined,
  data: DataRow[],
  layout: Layout,
  channelName: 'x' | 'y',
): { channel: ChannelSpec | undefined; changed: boolean } {
  if (!channel) return { channel, changed: false };

  const axisLength = channelName === 'x' ? layout.plotArea.width : layout.plotArea.height;
  const pointCount = pointCountForChannel(channel, data);
  const axis = reconcileAxis(channel.axis, axisLength, pointCount);
  const secondaryAxis = reconcileAxis(channel.secondaryAxis, axisLength, pointCount);
  if (axis === channel.axis && secondaryAxis === channel.secondaryAxis) {
    return { channel, changed: false };
  }

  return {
    channel: {
      ...channel,
      ...(axis !== channel.axis ? { axis } : {}),
      ...(secondaryAxis !== channel.secondaryAxis ? { secondaryAxis } : {}),
    },
    changed: true,
  };
}

function reconcileAxis(
  axis: AxisSpec | null | undefined,
  axisLength: number,
  pointCount: number,
): AxisSpec | null | undefined {
  if (!axis || axis === null || !hasPathAxisEvidence(axis)) return axis;

  const categoryPitch = pointCount > 0 && axisLength > 0 ? axisLength / pointCount : undefined;
  const labelBudget = positiveNumber(axis.pathLabelBudget) ?? labelBudgetFromProjection(axis);
  const importedAuto =
    axis.tickLabelSkipSource === 'importedAuto' ||
    axis.tickMarkSkipSource === 'importedAuto' ||
    axis.pathAxisReservationStatusReason === 'importedAutoPathPlotFrameReservationEstimate' ||
    axis.pathAxisReservationStatusReason === 'importedAutoPathAxisReservationEstimate';
  const skip =
    importedAuto && categoryPitch !== undefined && labelBudget !== undefined
      ? importedAutoTickSkip(labelBudget, axis.pathProjectedLabelWidth, categoryPitch, pointCount)
      : undefined;
  const reconciled = {
    ...axis,
    pathAxisLength: roundLayout(axisLength),
    ...(categoryPitch !== undefined ? { pathCategoryPitch: roundLayout(categoryPitch) } : {}),
    ...(skip !== undefined
      ? {
          tickLabelSkip: skip,
          tickMarkSkip: axis.tickMarkSkipSource === 'importedAuto' ? skip : axis.tickMarkSkip,
          pathVisibleLabelCount: Math.ceil(pointCount / skip),
          axisLayoutStatus: axis.axisLayoutStatus ?? ('approximate' as const),
          axisLayoutStatusReason:
            axis.axisLayoutStatusReason ?? 'importedAutoPathCategoryTickSkipHeuristic',
          pathCategoryAxisLayoutStatus:
            axis.pathCategoryAxisLayoutStatus ?? axis.axisLayoutStatus ?? ('approximate' as const),
          pathCategoryAxisLayoutStatusReason:
            axis.pathCategoryAxisLayoutStatusReason ??
            axis.axisLayoutStatusReason ??
            'importedAutoPathCategoryTickSkipHeuristic',
          pathAxisReservationStatus: axis.pathAxisReservationStatus ?? ('approximate' as const),
          pathAxisReservationStatusReason:
            axis.pathAxisReservationStatusReason ??
            'importedAutoPathPlotFrameReservationEstimate',
        }
      : pointCount > 0 && positiveInteger(axis.tickLabelSkip) !== undefined
        ? { pathVisibleLabelCount: Math.ceil(pointCount / positiveInteger(axis.tickLabelSkip)!) }
        : {}),
  };

  return axisEquivalent(axis, reconciled) ? axis : reconciled;
}

function reconcilePathLayoutHints(
  config: ConfigSpec | undefined,
  _axisChanged: boolean,
  _encodings: Array<EncodingSpec | undefined>,
): ConfigSpec | undefined {
  return config;
}

function dataRowsForSpec(spec: Pick<ChartSpec, 'data'>, fallback: DataRow[]): DataRow[] {
  return spec.data && 'values' in spec.data ? spec.data.values : fallback;
}

function hasPathAxisEvidence(axis: AxisSpec): boolean {
  return (
    axis.pathAxisLength !== undefined ||
    axis.pathCategoryPitch !== undefined ||
    axis.pathLabelBudget !== undefined ||
    axis.pathProjectedLabelWidth !== undefined ||
    axis.pathVisibleLabelCount !== undefined ||
    axis.pathAxisReservationStatus !== undefined ||
    axis.pathCategoryAxisLayoutStatusReason === 'importedAutoPathCategoryTickSkipHeuristic' ||
    axis.axisLayoutStatusReason === 'importedAutoPathCategoryTickSkipHeuristic' ||
    axis.pathAxisReservationStatusReason === 'importedAutoPathPlotFrameReservationEstimate' ||
    axis.pathAxisReservationStatusReason === 'importedAutoPathAxisReservationEstimate'
  );
}

function pointCountForChannel(channel: ChannelSpec, data: DataRow[]): number {
  const domain = Array.isArray(channel.scale?.domain) ? channel.scale.domain : undefined;
  if (domain && domain.length > 0) return domain.length;
  if (!channel.field) return 0;

  const values = new Set<unknown>();
  for (const datum of data) {
    const value = datum[channel.field];
    if (value !== undefined) values.add(value);
  }
  return values.size;
}

function importedAutoTickSkip(
  labelBudget: number,
  projectedLabelWidth: number | undefined,
  categoryPitch: number,
  pointCount: number,
): number {
  const projectedWidth = positiveNumber(projectedLabelWidth) ?? labelBudget;
  if (projectedWidth <= categoryPitch) return 1;
  return clamp(
    Math.ceil(labelBudget / categoryPitch),
    1,
    Math.max(1, Math.ceil(pointCount / 2)),
  );
}

function labelBudgetFromProjection(axis: AxisSpec): number | undefined {
  const projected = positiveNumber(axis.pathProjectedLabelWidth);
  return projected === undefined ? undefined : projected + DEFAULT_LABEL_GAP_PX;
}

function axisEquivalent(left: AxisSpec, right: AxisSpec): boolean {
  return (
    left.tickLabelSkip === right.tickLabelSkip &&
    left.tickMarkSkip === right.tickMarkSkip &&
    left.axisLayoutStatus === right.axisLayoutStatus &&
    left.axisLayoutStatusReason === right.axisLayoutStatusReason &&
    left.pathCategoryAxisLayoutStatus === right.pathCategoryAxisLayoutStatus &&
    left.pathCategoryAxisLayoutStatusReason === right.pathCategoryAxisLayoutStatusReason &&
    left.pathValueAxisLayoutStatus === right.pathValueAxisLayoutStatus &&
    left.pathValueAxisLayoutStatusReason === right.pathValueAxisLayoutStatusReason &&
    left.pathAxisLength === right.pathAxisLength &&
    left.pathCategoryPitch === right.pathCategoryPitch &&
    left.pathVisibleLabelCount === right.pathVisibleLabelCount &&
    left.pathAxisReservationStatus === right.pathAxisReservationStatus &&
    left.pathAxisReservationStatusReason === right.pathAxisReservationStatusReason
  );
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundLayout(value: number): number {
  if (!Number.isFinite(value)) return value;
  if (Math.abs(value) < 1e-9) return 0;
  return Number.parseFloat(value.toFixed(6));
}
