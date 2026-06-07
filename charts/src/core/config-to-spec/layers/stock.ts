import type {
  AxisSpec,
  ChannelSpec,
  DataRow,
  ScaleSpec,
  StockGlyphSourceRoleVisualSpec,
  UnitSpec,
} from '../../../grammar/spec';
import type {
  ChartConfig,
  ChartData,
  ChartSeriesStockRole,
  SingleAxisConfig,
  StockSubType,
} from '../../../types';
import { mapAxisConfigToAxisSpec } from '../axis';
import { resolveExcelAutoValueAxisScale } from '../../chart-ir/excel-value-axis-scale';
import {
  stockSourceCompositionFromConfig,
  stockSubTypeFromConfig,
  stockValueAxisRoles,
} from '../../stock-semantics';
import { resolveStockGlyphVisual } from '../stock-visual';
import {
  CATEGORY_FIELD,
  STOCK_CLOSE_FIELD,
  STOCK_HIGH_LOW_MAX_FIELD,
  STOCK_HIGH_LOW_MIN_FIELD,
  STOCK_HIGH_FIELD,
  STOCK_LOW_FIELD,
  STOCK_OPEN_FIELD,
  STOCK_VOLUME_FIELD,
} from '../fields';

/**
 * Build layers for stock (OHLC/candlestick) charts.
 * Stock charts show price ranges: open, high, low, close.
 *
 * Sub-type layer configurations:
 * - hlc (High-Low-Close): rule (H-L range) + tick (close marker)
 * - ohlc: rule (H-L range) + bar (O-C body) with directional color
 * - volume-hlc: volume bar layer + hlc layers
 * - volume-ohlc: volume bar layer + ohlc layers
 */
export function buildStockLayers(
  config: ChartConfig,
  data: ChartData,
  rows: DataRow[],
  categoryChannel?: ChannelSpec,
): UnitSpec[] {
  const subType = stockSubTypeFromConfig(config, data);
  const composition = stockSourceCompositionFromConfig(config, data);
  const valueAxisRoles = stockValueAxisRoles(config, data);
  const priceAxis = stockPriceAxis(config, rows, valueAxisRoles, {
    includeZero: stockPriceAxisIncludesZeroForAuto(composition, valueAxisRoles),
    defaultGridlines: composition.sourceKind !== 'modeled',
  });
  const stockVisual = resolveStockGlyphVisual({ config, rows, subType });
  const highLowMinField = stockEndpointField(rows, STOCK_HIGH_LOW_MIN_FIELD, STOCK_LOW_FIELD);
  const highLowMaxField = stockEndpointField(rows, STOCK_HIGH_LOW_MAX_FIELD, STOCK_HIGH_FIELD);
  const layers: UnitSpec[] = [];

  for (const visual of stockVisual.sourceRoleVisuals ?? []) {
    const field = fieldForStockRole(visual.role);
    if (visual.role === 'volume' && composition.volumeAxisPolicy !== 'stockValueAxis') continue;
    if (shouldRenderSourceRoleLineLayer(visual)) {
      layers.push(sourceRoleLineLayer(visual, field, categoryChannel, priceAxis?.scale));
    }
  }

  layers.push({
    mark: {
      type: 'stockGlyph',
      stockSubType: subType,
      stockVisual,
      stockOpenField: STOCK_OPEN_FIELD,
      stockHighField: highLowMaxField,
      stockLowField: highLowMinField,
      stockCloseField: STOCK_CLOSE_FIELD,
      stockVolumeAxisPolicy: composition.volumeAxisPolicy,
      stockHighLowEndpointPolicy: stockVisual.highLowEndpointPolicy,
      ...(composition.volumeAxisPolicy === 'separateVolumeAxis' && isVolumeStockSubType(subType)
        ? { stockVolumeField: STOCK_VOLUME_FIELD }
        : {}),
    },
    encoding: {
      x: cloneCategoryChannel(categoryChannel),
      y: {
        field: highLowMinField,
        type: 'quantitative',
        ...(priceAxis?.scale ? { scale: priceAxis.scale } : {}),
        ...(priceAxis?.axis ? { axis: priceAxis.axis } : {}),
      },
      y2: { field: highLowMaxField, type: 'quantitative' },
    },
  });

  for (const visual of stockVisual.sourceRoleVisuals ?? []) {
    const field = fieldForStockRole(visual.role);
    if (visual.role === 'volume' && composition.volumeAxisPolicy !== 'stockValueAxis') continue;
    if (shouldRenderSourceRoleMarkerLayer(visual)) {
      layers.push(sourceRoleMarkerLayer(visual, field, categoryChannel, priceAxis?.scale));
    }
  }

  return layers;
}

export function hasStockVolumeLayer(config: ChartConfig, rows: DataRow[]): boolean {
  const subType = stockSubType(config, rows);
  return (
    isVolumeStockSubType(subType) &&
    stockSourceCompositionFromConfig({ ...config, subType }).volumeAxisPolicy ===
      'separateVolumeAxis'
  );
}

function stockSubType(config: ChartConfig, rows: DataRow[]): StockSubType {
  if (
    config.subType === 'hlc' ||
    config.subType === 'ohlc' ||
    config.subType === 'volume-hlc' ||
    config.subType === 'volume-ohlc'
  ) {
    return config.subType;
  }

  const hasOpen = rows.some((row) => finite(row[STOCK_OPEN_FIELD]) !== undefined);
  const hasVolume = rows.some((row) => finite(row[STOCK_VOLUME_FIELD]) !== undefined);
  if (hasVolume) return hasOpen ? 'volume-ohlc' : 'volume-hlc';
  return hasOpen ? 'ohlc' : 'hlc';
}

function isVolumeStockSubType(subType: string): boolean {
  return subType === 'volume-hlc' || subType === 'volume-ohlc';
}

function cloneCategoryChannel(channel: ChannelSpec | undefined): ChannelSpec {
  return channel
    ? { ...channel, scale: channel.scale ? { ...channel.scale } : channel.scale }
    : { field: CATEGORY_FIELD, type: 'nominal' };
}

interface StockPriceAxisResolution {
  scale: ScaleSpec;
  axis: AxisSpec;
}

interface StockPriceScaleAuthority {
  scaleAuthorityStatus: NonNullable<ScaleSpec['scaleAuthorityStatus']>;
  scaleAuthority: string;
  scaleAuthorityReason?: string;
  zeroBaselinePolicy: string;
  zeroBaselineReason?: string;
}

function stockPriceAxis(
  config: ChartConfig,
  rows: DataRow[],
  roles: readonly ChartSeriesStockRole[],
  options: { includeZero: boolean; defaultGridlines: boolean },
): StockPriceAxisResolution | undefined {
  const values = rows.flatMap((row) =>
    roles
      .map(fieldForStockRole)
      .map((field) => finite(row[field]))
      .filter((value): value is number => value !== undefined),
  );
  if (values.length === 0) return undefined;
  const valueAxis = stockValueAxisConfig(config);
  const resolved = resolveExcelAutoValueAxisScale({
    values,
    includeZero: shouldIncludeZero(values, options.includeZero, valueAxis),
    explicitMin: finite(valueAxis?.min),
    explicitMax: finite(valueAxis?.max),
    explicitTickStep: positive(valueAxis?.majorUnit),
  });
  if (!resolved) return undefined;

  const axis = valueAxis ? mapAxisConfigToAxisSpec(valueAxis, config, 'valueAxis') : {};
  if (options.defaultGridlines && axis.grid === undefined) axis.grid = true;
  const authority = stockPriceScaleAuthority({
    values,
    resolvedDomain: resolved.domain,
    explicitAxis:
      finite(valueAxis?.min) !== undefined ||
      finite(valueAxis?.max) !== undefined ||
      positive(valueAxis?.majorUnit) !== undefined,
    includeZeroForAuto: options.includeZero,
  });

  return {
    scale: {
      domain: resolved.domain,
      nice: false,
      zero: resolved.domain[0] <= 0 && resolved.domain[1] >= 0,
      scaleAuthorityStatus: authority.scaleAuthorityStatus,
      scaleAuthority: authority.scaleAuthority,
      ...(authority.scaleAuthorityReason !== undefined
        ? { scaleAuthorityReason: authority.scaleAuthorityReason }
        : {}),
      zeroBaselinePolicy: authority.zeroBaselinePolicy,
      ...(authority.zeroBaselineReason !== undefined
        ? { zeroBaselineReason: authority.zeroBaselineReason }
        : {}),
    },
    axis: {
      ...axis,
      tickStep: resolved.tickStep,
      tickCount: resolved.tickCount,
    },
  };
}

function stockPriceScaleAuthority(input: {
  values: readonly number[];
  resolvedDomain: [number, number];
  explicitAxis: boolean;
  includeZeroForAuto: boolean;
}): StockPriceScaleAuthority {
  const zeroBaseline = input.resolvedDomain[0] <= 0 && input.resolvedDomain[1] >= 0;
  const hasNegative = input.values.some((value) => value < 0);
  const hasPositive = input.values.some((value) => value > 0);
  const mixedSignData = hasNegative && hasPositive;

  if (input.explicitAxis) {
    return {
      scaleAuthorityStatus: 'exact',
      scaleAuthority: 'explicitAxis',
      zeroBaselinePolicy: zeroBaseline ? 'explicitAxisIncludesZero' : 'explicitAxis',
    };
  }

  if (input.includeZeroForAuto) {
    return {
      scaleAuthorityStatus: 'verifiedDefault',
      scaleAuthority: 'excelAutoSameAxisVolume',
      zeroBaselinePolicy: 'sameAxisVolumeRequiresZeroBaseline',
    };
  }

  if (zeroBaseline && !mixedSignData) {
    return {
      scaleAuthorityStatus: 'verifiedDefault',
      scaleAuthority: 'excelAutoPriceOnly',
      scaleAuthorityReason: 'excelAutoPriceOnlyZeroBaselineVerified',
      zeroBaselinePolicy: 'priceOnlyZeroBaselineVerified',
      zeroBaselineReason: 'excelAutoPriceOnlyResolvedZeroBaseline',
    };
  }

  return {
    scaleAuthorityStatus: 'verifiedDefault',
    scaleAuthority: 'excelAutoPriceOnly',
    zeroBaselinePolicy: mixedSignData ? 'mixedSignDataIncludesZero' : 'priceOnlyNoZeroBaseline',
  };
}

function stockPriceAxisIncludesZeroForAuto(
  composition: ReturnType<typeof stockSourceCompositionFromConfig>,
  roles: readonly ChartSeriesStockRole[],
): boolean {
  return composition.volumeAxisPolicy === 'stockValueAxis' && roles.includes('volume');
}

function stockValueAxisConfig(config: ChartConfig): SingleAxisConfig | undefined {
  return config.axis?.valueAxis ?? config.axis?.yAxis;
}

function shouldIncludeZero(
  values: readonly number[],
  includeZeroForAuto: boolean,
  valueAxis: SingleAxisConfig | undefined,
): boolean {
  if (explicitAxisIncludesZero(valueAxis)) return true;
  if (values.some((value) => value < 0) && values.some((value) => value > 0)) return true;
  if (!includeZeroForAuto) return false;
  return values.every((value) => value >= 0) || values.every((value) => value <= 0);
}

function explicitAxisIncludesZero(valueAxis: SingleAxisConfig | undefined): boolean {
  const min = finite(valueAxis?.min);
  const max = finite(valueAxis?.max);
  if (min !== undefined && max !== undefined) return min <= 0 && max >= 0;
  return min === 0 || max === 0;
}

function positive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function sourceRoleLineLayer(
  visual: StockGlyphSourceRoleVisualSpec,
  field: string,
  categoryChannel: ChannelSpec | undefined,
  priceScale: ScaleSpec | undefined,
): UnitSpec {
  return {
    mark: {
      type: 'line',
      stroke: visual.line.stroke,
      strokeWidth: visual.line.strokeWidth,
      strokeDash: visual.line.strokeDash,
      strokeOpacity: visual.line.strokeOpacity,
      line: visual.line.line,
      pathOrder: 'source',
    },
    encoding: {
      x: cloneCategoryChannel(categoryChannel),
      y: { field, type: 'quantitative', scale: priceScale },
    },
  };
}

function sourceRoleMarkerLayer(
  visual: StockGlyphSourceRoleVisualSpec,
  field: string,
  categoryChannel: ChannelSpec | undefined,
  priceScale: ScaleSpec | undefined,
): UnitSpec {
  return {
    mark: {
      type: 'point',
      fill: visual.marker.fill,
      stroke: visual.marker.stroke,
      strokeWidth: visual.marker.strokeWidth,
      shape: visual.marker.shape,
      size: visual.marker.size,
      skipInvalidPositions: true,
    },
    encoding: {
      x: cloneCategoryChannel(categoryChannel),
      y: { field, type: 'quantitative', scale: priceScale },
    },
  };
}

function shouldRenderSourceRoleLineLayer(visual: StockGlyphSourceRoleVisualSpec): boolean {
  return visual.layerMode === 'overlayLayer' && visual.lineVisible;
}

function shouldRenderSourceRoleMarkerLayer(visual: StockGlyphSourceRoleVisualSpec): boolean {
  return visual.layerMode === 'overlayLayer' && visual.markerVisible;
}

function fieldForStockRole(role: ChartSeriesStockRole): string {
  switch (role) {
    case 'volume':
      return STOCK_VOLUME_FIELD;
    case 'open':
      return STOCK_OPEN_FIELD;
    case 'high':
      return STOCK_HIGH_FIELD;
    case 'low':
      return STOCK_LOW_FIELD;
    case 'close':
      return STOCK_CLOSE_FIELD;
  }
}

function stockEndpointField(
  rows: DataRow[],
  preferredField: string,
  fallbackField: string,
): string {
  return rows.some((row) => finite(row[preferredField]) !== undefined)
    ? preferredField
    : fallbackField;
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
