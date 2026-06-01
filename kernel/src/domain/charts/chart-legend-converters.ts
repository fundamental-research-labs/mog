import type { LegendData, LegendEntryData } from '../../bridges/compute/compute-types.gen';

import type { LegendConfig } from '@mog-sdk/contracts/data/charts';

import { manualLayoutToWire, wireToManualLayout } from './chart-axis-converters';
import {
  chartFormatToWire,
  chartShadowToWire,
  wireToChartFormat,
  wireToChartShadow,
} from './chart-format-converters';

/** Convert a wire LegendData to the contract LegendConfig. */
export function wireToLegendConfig(w: LegendData): LegendConfig {
  const visible = w.visible === true || w.show === true;
  return {
    show: visible,
    position: w.position,
    visible,
    overlay: w.overlay,
    format: wireToChartFormat(w.format),
    entries: w.entries?.map(wireToLegendEntryConfig),
    customX: w.customX,
    customY: w.customY,
    layout: wireToManualLayout(w.layout),
    shadow: wireToChartShadow(w.shadow),
    showShadow: w.showShadow,
  };
}

function wireToLegendEntryConfig(
  entry: LegendEntryData,
): NonNullable<LegendConfig['entries']>[number] {
  return {
    idx: entry.idx,
    delete: entry.delete,
    format: wireToChartFormat(entry.format),
    visible: entry.visible,
  };
}

/** Convert contract LegendConfig to wire LegendData. */
export function legendConfigToWire(c: LegendConfig): LegendData {
  return {
    show: c.show,
    position: c.position,
    visible: c.visible ?? c.show,
    overlay: c.overlay,
    format: chartFormatToWire(c.format),
    entries: c.entries?.map(legendEntryConfigToWire),
    customX: c.customX,
    customY: c.customY,
    layout: c.layout ? manualLayoutToWire(c.layout) : undefined,
    shadow: chartShadowToWire(c.shadow),
    showShadow: c.showShadow,
  };
}

function legendEntryConfigToWire(
  entry: NonNullable<LegendConfig['entries']>[number],
): LegendEntryData {
  return {
    idx: entry.idx,
    delete: entry.delete ?? (entry.visible === false ? true : undefined),
    format: chartFormatToWire(entry.format),
    visible: entry.visible,
  };
}
