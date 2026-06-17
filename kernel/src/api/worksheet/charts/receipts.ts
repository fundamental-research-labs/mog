import type {
  Chart,
  ChartActivateReceipt,
  ChartAddReceipt,
  ChartDuplicateReceipt,
  ChartRemoveReceipt,
  ChartUpdateReceipt,
  OperationEffect,
  SheetId,
} from '@mog-sdk/contracts/api';

function chartObjectEffect(
  type: 'createdObject' | 'updatedObject' | 'removedObject',
  sheetId: SheetId,
  chartId: string,
  details: Record<string, unknown> = {},
): OperationEffect {
  return {
    type,
    sheetId,
    objectId: chartId,
    details: { objectType: 'chart', ...details },
  };
}

function chartCacheInvalidatedEffect(sheetId: SheetId, chartId: string): OperationEffect {
  return {
    type: 'invalidatedCache',
    sheetId,
    objectId: chartId,
    details: { objectType: 'chart', cache: 'chartRender' },
  };
}

export function buildChartAddReceipt(sheetId: SheetId, chart: Chart): ChartAddReceipt {
  return {
    kind: 'chart.add',
    status: 'applied',
    effects: [
      chartObjectEffect('createdObject', sheetId, chart.id),
      chartCacheInvalidatedEffect(sheetId, chart.id),
    ],
    diagnostics: [],
    chart,
  };
}

export function buildChartUpdateReceipt(
  sheetId: SheetId,
  chart: Chart,
  changedFields: readonly string[],
): ChartUpdateReceipt {
  return {
    kind: 'chart.update',
    status: 'applied',
    effects: [
      chartObjectEffect('updatedObject', sheetId, chart.id, { changedFields }),
      chartCacheInvalidatedEffect(sheetId, chart.id),
    ],
    diagnostics: [],
    chart,
    changedFields,
  };
}

export function buildChartRemoveReceipt(sheetId: SheetId, chartId: string): ChartRemoveReceipt {
  return {
    kind: 'chart.remove',
    status: 'applied',
    effects: [
      chartObjectEffect('removedObject', sheetId, chartId),
      chartCacheInvalidatedEffect(sheetId, chartId),
    ],
    diagnostics: [],
    chartId,
  };
}

export function buildChartDuplicateReceipt(
  sheetId: SheetId,
  sourceChartId: string,
  chart: Chart,
): ChartDuplicateReceipt {
  return {
    kind: 'chart.duplicate',
    status: 'applied',
    effects: [
      chartObjectEffect('createdObject', sheetId, chart.id, { sourceObjectId: sourceChartId }),
      chartCacheInvalidatedEffect(sheetId, chart.id),
    ],
    diagnostics: [],
    sourceChartId,
    chart,
  };
}

export function buildChartActivateReceipt(sheetId: SheetId, chartId: string): ChartActivateReceipt {
  return {
    kind: 'chart.activate',
    status: 'applied',
    effects: [
      {
        type: 'changedSelectionTarget',
        sheetId,
        objectId: chartId,
        details: { objectType: 'chart' },
      },
    ],
    diagnostics: [],
    chartId,
  };
}
