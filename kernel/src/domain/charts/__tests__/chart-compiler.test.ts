import { jest } from '@jest/globals';
import type { ChartConfig, ChartData } from '@mog/charts';
import { sheetId as toSheetId } from '@mog-sdk/contracts/core';

import type { ChartFloatingObject } from '../../../bridges/compute/compute-bridge';
import type { ResolvedChartRangeReferences } from '../chart-range-references';
import type { ChartWasmExports } from '../bridge/chart-compiler';
import { defaultExportOptionsForSize, hashJson } from '../bridge/resolved-spec-snapshot';

type ChartCompilerModule = typeof import('../bridge/chart-compiler');

const baseConfig: ChartConfig = {
  type: 'bar',
  width: 4,
  height: 3,
  title: 'Sales',
};

const baseChartData: ChartData = {
  categories: ['Jan', 'Feb'],
  series: [
    {
      name: 'Sales',
      data: [
        { x: 'Jan', y: 10 },
        { x: 'Feb', y: 20 },
      ],
    },
  ],
};

const resolvedRanges: ResolvedChartRangeReferences = {
  dataRange: null,
  categoryRange: null,
  seriesRange: null,
  seriesReferences: [],
  diagnostics: [],
};

async function withFreshCompiler<T>(
  run: (compiler: ChartCompilerModule) => T | Promise<T>,
): Promise<T> {
  let result: T | undefined;
  await jest.isolateModulesAsync(async () => {
    result = await run(await import('../bridge/chart-compiler'));
  });
  return result as T;
}

function createWasmExports(overrides: Partial<ChartWasmExports>): ChartWasmExports {
  return {
    chart_apply_transforms: (data: unknown) => data,
    chart_compute_regression: () => [],
    chart_compute_stacking: () => [],
    chart_compute_bins: () => [],
    chart_compute_statistics: () => ({}),
    chart_compute_density: () => [],
    ...overrides,
  } as ChartWasmExports;
}

describe('chart compiler bridge module', () => {
  it('compiles marks and normalized layout without owning bridge cache state', async () => {
    await withFreshCompiler(({ compileChartMarks }) => {
      const result = compileChartMarks({
        config: baseConfig,
        chartData: baseChartData,
        size: { width: 320, height: 180 },
      });

      expect(result.compilerPathId).toBe('ts-grammar');
      expect(result.marks.length).toBeGreaterThan(0);
      expect(result.layout?.plotArea).toMatchObject({
        left: expect.any(Number),
        top: expect.any(Number),
        width: expect.any(Number),
        height: expect.any(Number),
      });
      expect(result.layout?.plotArea.width).toBeGreaterThan(0);
      expect(result.compileInput.data).toBeDefined();
    });
  });

  it('builds export-sized render snapshots with the compiled input hash', async () => {
    await withFreshCompiler(({ compileChartMarks, compileChartRenderSnapshotAtSize }) => {
      const sheetId = toSheetId('sheet-1');
      const chart = {
        id: 'chart-1',
        name: 'Chart 1',
        width: 4,
        height: 3,
      } as unknown as ChartFloatingObject;
      const exportOptions = defaultExportOptionsForSize(320, 180);
      const compiled = compileChartMarks({
        config: baseConfig,
        chartData: baseChartData,
        size: { width: 320, height: 180 },
      });

      const snapshot = compileChartRenderSnapshotAtSize({
        chart,
        sheetId,
        chartId: 'chart-1',
        config: baseConfig,
        chartData: baseChartData,
        resolvedRanges,
        exportOptions,
        width: 320,
        height: 180,
      });

      expect(snapshot.marks.length).toBeGreaterThan(0);
      expect(snapshot.resolvedChartSpec.implementation).toMatchObject({
        renderAuthority: 'chartBridge',
        renderStatus: 'renderable',
        compilerPathId: 'ts-grammar',
        compilerInputHash: hashJson({
          chartId: 'chart-1',
          sheetId,
          config: baseConfig,
          chartData: baseChartData,
          resolvedRanges,
          compileInput: compiled.compileInput,
        }),
      });
      expect(snapshot.resolvedChartSpec.export).toEqual(exportOptions);
    });
  });

  it('uses injected WASM transforms before the TypeScript grammar compiler when available', async () => {
    await withFreshCompiler(({ compileChartMarks, initChartWasm }) => {
      const calls: Array<{ data: unknown; transforms: unknown }> = [];
      initChartWasm(
        createWasmExports({
          chart_apply_transforms: (data, transforms) => {
            calls.push({ data, transforms });
            return data;
          },
        }),
      );

      const result = compileChartMarks({
        config: {
          type: 'scatter',
          trendline: { show: true, type: 'linear' },
        },
        chartData: {
          categories: [1, 2],
          series: [
            {
              name: 'Points',
              data: [
                { x: 1, y: 2 },
                { x: 2, y: 4 },
              ],
            },
          ],
        },
      });

      expect(calls).toHaveLength(1);
      expect(result.compilerPathId).toBe('wasm-transforms+ts-grammar');
      expect(result.compileInput.transform).toBeUndefined();
      expect(result.marks.length).toBeGreaterThan(0);
    });
  });
});
