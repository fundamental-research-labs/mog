import type { BarGeometrySpec, ChannelSpec, EncodingSpec } from '../../grammar/spec';
import type { ChartConfig, ChartData } from '../../types';
import { effectiveBarGeometry, hasExcelBarGeometryConfig } from './bar-geometry';

export function applyBarColumnAxisLayout(
  config: ChartConfig,
  data: ChartData,
  encoding: EncodingSpec,
): void {
  if (!hasExcelBarGeometryConfig(config)) return;
  const geometry = effectiveBarGeometry(config, data);
  if (!geometry) return;

  const categoryChannel = geometry.categoryAxisRole === 'y' ? encoding.y : encoding.x;
  const valueChannel = geometry.valueAxisRole === 'x' ? encoding.x : encoding.y;
  applyBarGeometryCategoryAxisLayout(categoryChannel, geometry);
  applyBarGeometryValueAxisLayout(valueChannel, geometry);
}

export function applyBarGeometryCategoryAxisLayout(
  channel: ChannelSpec | undefined,
  geometry: BarGeometrySpec,
): void {
  if (!channel || channel.axis === null) return;
  if (
    geometry.categoryTickLabelSkip === undefined &&
    geometry.categoryTickMarkSkip === undefined &&
    geometry.categoryTickSkipSource === undefined
  ) {
    return;
  }

  channel.axis = {
    ...(channel.axis ?? {}),
    ...(geometry.categoryTickLabelSkip !== undefined
      ? { tickLabelSkip: geometry.categoryTickLabelSkip }
      : {}),
    ...(geometry.categoryTickMarkSkip !== undefined
      ? { tickMarkSkip: geometry.categoryTickMarkSkip }
      : {}),
    ...(geometry.categoryTickSkipSource && geometry.categoryTickLabelSkip !== undefined
      ? {
          tickLabelSkipSource: geometry.categoryTickSkipSource,
        }
      : {}),
    ...(geometry.categoryTickSkipSource && geometry.categoryTickMarkSkip !== undefined
      ? { tickMarkSkipSource: geometry.categoryTickSkipSource }
      : {}),
  };
  if (channel.secondaryAxis !== null && channel.secondaryAxis !== undefined) {
    channel.secondaryAxis = {
      ...channel.secondaryAxis,
      ...(geometry.categoryTickLabelSkip !== undefined
        ? { tickLabelSkip: geometry.categoryTickLabelSkip }
        : {}),
      ...(geometry.categoryTickMarkSkip !== undefined
        ? { tickMarkSkip: geometry.categoryTickMarkSkip }
        : {}),
      ...(geometry.categoryTickSkipSource && geometry.categoryTickLabelSkip !== undefined
        ? {
            tickLabelSkipSource: geometry.categoryTickSkipSource,
          }
        : {}),
      ...(geometry.categoryTickSkipSource && geometry.categoryTickMarkSkip !== undefined
        ? { tickMarkSkipSource: geometry.categoryTickSkipSource }
        : {}),
    };
  }
}

export function applyBarGeometryValueAxisLayout(
  channel: ChannelSpec | undefined,
  geometry: BarGeometrySpec,
): void {
  if (!channel || channel.type !== 'quantitative') return;
  if (geometry.valueAxisDomain) {
    channel.scale = {
      ...(channel.scale ?? {}),
      domain: geometry.valueAxisDomain,
      nice: false,
      zero: true,
    };
  }
  if (
    channel.axis !== null &&
    (geometry.valueAxisTickStep !== undefined ||
      geometry.valueAxisTickCount !== undefined ||
      geometry.percentAxisLabelPolicy !== undefined ||
      geometry.axisLayoutStatus !== undefined ||
      geometry.axisLayoutStatusReason !== undefined)
  ) {
    channel.axis = {
      ...(channel.axis ?? {}),
      ...(geometry.valueAxisTickStep !== undefined
        ? { tickStep: channel.axis?.tickStep ?? geometry.valueAxisTickStep }
        : {}),
      ...(geometry.valueAxisTickCount !== undefined
        ? { tickCount: channel.axis?.tickCount ?? geometry.valueAxisTickCount }
        : {}),
      ...(geometry.percentAxisLabelPolicy
        ? { percentAxisLabelPolicy: geometry.percentAxisLabelPolicy }
        : {}),
      ...(geometry.axisLayoutStatus ? { axisLayoutStatus: geometry.axisLayoutStatus } : {}),
      ...(geometry.axisLayoutStatusReason
        ? { axisLayoutStatusReason: geometry.axisLayoutStatusReason }
        : {}),
    };
  }
}
