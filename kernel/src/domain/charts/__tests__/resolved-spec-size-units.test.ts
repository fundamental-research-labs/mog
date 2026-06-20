import type { ChartConfig, ChartData } from '@mog/charts';
import { sheetId as toSheetId } from '@mog-sdk/contracts/core';

import type { ChartFloatingObject } from '../../../bridges/compute/compute-bridge';
import type { ResolvedChartRangeReferences } from '../chart-range-references';
import {
  buildResolvedChartSpecSnapshot,
  defaultExportOptionsForSize,
} from '../bridge/resolved-spec-snapshot';

describe('resolved chart spec size units', () => {
  it('reports chart object size from point/pixel geometry ahead of stale cell spans', () => {
    const sheetId = toSheetId('sheet-1');
    const config: ChartConfig = {
      type: 'column',
      anchorRow: 0,
      anchorCol: 0,
      width: 480,
      height: 225,
    };
    const chartData: ChartData = {
      categories: ['A'],
      series: [{ name: 'Series 1', data: [{ x: 'A', y: 1 }] }],
    };
    const resolvedRanges: ResolvedChartRangeReferences = {
      dataRange: null,
      categoryRange: null,
      seriesRange: null,
      seriesReferences: [],
      diagnostics: [],
    };

    const snapshot = buildResolvedChartSpecSnapshot({
      chart: {
        id: 'chart-1',
        sheetId,
        type: 'chart',
        chartType: 'column',
        anchor: { anchorRow: 0, anchorCol: 0 },
        width: 640,
        height: 300,
        widthCells: 4,
        heightCells: 5,
      } as unknown as ChartFloatingObject,
      sheetId,
      config,
      chartData,
      resolvedRanges,
      exportOptions: defaultExportOptionsForSize(640, 300),
      compilerPathId: 'ts-grammar',
      compilerInputHash: 'input-hash',
    });

    expect(snapshot.chartObject).toMatchObject({
      width: 480,
      height: 225,
      widthPt: 480,
      heightPt: 225,
    });
  });
});
