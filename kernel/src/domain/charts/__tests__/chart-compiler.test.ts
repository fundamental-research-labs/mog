import { jest } from '@jest/globals';
import type { ChartConfig, ChartData } from '@mog/charts';
import { sheetId as toSheetId } from '@mog-sdk/contracts/core';

import type { ChartFloatingObject } from '../../../bridges/compute/compute-bridge';
import type { ResolvedChartRangeReferences } from '../chart-range-references';
import type { ChartWasmExports } from '../bridge/chart-compiler';
import { defaultExportOptionsForSize, hashJson } from '../bridge/resolved-spec-snapshot';

type ChartCompilerModule = typeof import('../bridge/chart-compiler');
type LayeredCompileInput = {
  data?: { values?: unknown[] };
  layer?: Array<{ data?: { values?: unknown[] }; transform?: unknown[] }>;
};

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

  it('includes rendered manual plot, title, and legend layout in resolved snapshots', async () => {
    await withFreshCompiler(({ compileChartRenderSnapshotAtSize }) => {
      const sheetId = toSheetId('sheet-1');
      const chart = {
        id: 'chart-1',
        name: 'Chart 1',
        width: 4,
        height: 3,
      } as unknown as ChartFloatingObject;
      const config: ChartConfig = {
        type: 'column',
        width: 4,
        height: 3,
        title: 'Manual Layout',
        plotLayout: { x: 0.1, y: 0.2, w: 0.5, h: 0.4 },
        titleLayout: { x: 0.2, y: 0.05, w: 0.5, h: 0.1 },
        legend: {
          show: true,
          visible: true,
          position: 'right',
          layout: {
            xMode: 'edge',
            yMode: 'edge',
            wMode: 'edge',
            hMode: 'edge',
            x: 0.65,
            y: 0.1,
            w: 0.95,
            h: 0.3,
          },
        },
      };
      const chartData: ChartData = {
        categories: ['A', 'B'],
        series: [
          { name: 'North', data: [10, 20] },
          { name: 'South', data: [12, 22] },
        ],
      };

      const snapshot = compileChartRenderSnapshotAtSize({
        chart,
        sheetId,
        chartId: 'chart-1',
        config,
        chartData,
        resolvedRanges,
        exportOptions: defaultExportOptionsForSize(320, 180),
        width: 320,
        height: 180,
      });

      const layout = snapshot.resolvedChartSpec.resolved.layout;
      expect(layout?.plotArea).toEqual({
        left: 0.1,
        top: 0.2,
        width: 0.5,
        height: 0.4,
      });
      expect(layout?.title).toEqual({
        left: 0.2,
        top: 0.05,
        width: 0.5,
        height: 0.1,
      });
      expect(layout?.legend?.left).toBeCloseTo(0.65, 5);
      expect(layout?.legend?.top).toBeCloseTo(0.1, 5);
      expect(layout?.legend?.width).toBeCloseTo(0.3, 5);
      expect(layout?.legend?.height).toBeCloseTo(0.2, 5);
    });
  });

  it('uses injected WASM transforms before the TypeScript grammar compiler when available', async () => {
    await withFreshCompiler(({ compileChartMarks, initChartWasm }) => {
      const calls: Array<{ data: unknown; transforms: unknown }> = [];
      const transformedTrendlineRows = [
        { __mogScatterX: 1, __mogValue: 2, series: 'Points' },
        { __mogScatterX: 2, __mogValue: 4, series: 'Points' },
      ];
      initChartWasm(
        createWasmExports({
          chart_apply_transforms: (data, transforms) => {
            calls.push({ data, transforms });
            return transformedTrendlineRows;
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
      const compileInput = result.compileInput as LayeredCompileInput;
      expect(calls[0]?.data).toBe(compileInput.data?.values);
      expect(compileInput.layer?.[1]?.transform).toBeUndefined();
      expect(compileInput.layer?.[1]?.data?.values).toBe(transformedTrendlineRows);
      expect(result.marks.length).toBeGreaterThan(0);
    });
  });

  it('falls back to the original layered TypeScript spec when a child WASM transform fails', async () => {
    await withFreshCompiler(({ compileChartMarks, initChartWasm }) => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      initChartWasm(
        createWasmExports({
          chart_apply_transforms: () => {
            throw new Error('regression unavailable');
          },
        }),
      );

      try {
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

        expect(result.compilerPathId).toBe('ts-grammar');
        expect((result.compileInput as LayeredCompileInput).layer?.[1]?.transform).toBeDefined();
        expect(warnSpy).toHaveBeenCalledWith(
          '[ChartBridge] WASM transform failed, falling back to TS:',
          expect.any(Error),
        );
      } finally {
        warnSpy.mockRestore();
      }
    });
  });
});
