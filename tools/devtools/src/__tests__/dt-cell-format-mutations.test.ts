/**
 * `__dt.setCellFormat` mutation-boundary regression coverage.
 *
 * Run via:
 * `bun test tools/devtools/src/__tests__/dt-cell-format-mutations.test.ts`.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { createConsoleAPI } from '../console/api';
import { EventStore } from '../event-store';
import { ActorRecorder } from '../recorders/actor-recorder';
import type { DevToolsConsoleAPI } from '../types';

interface SetRangesCall {
  ranges: Array<{ startRow: number; startCol: number; endRow: number; endCol: number }>;
  format: Record<string, unknown>;
}

interface RuntimeBundle {
  api: DevToolsConsoleAPI;
  setRangesCalls: SetRangesCall[];
  formatGetCalls: number;
  clearRangesCalls: number;
  autoFitRowsCalls: number[][];
  resetRowHeightCalls: number[];
  cleanup(): void;
}

function setupRuntime(): RuntimeBundle {
  const g = globalThis as { window?: Record<string, unknown>; document?: unknown };
  const setRangesCalls: SetRangesCall[] = [];
  const autoFitRowsCalls: number[][] = [];
  const resetRowHeightCalls: number[] = [];
  const callCounts = { formatGet: 0, clearRanges: 0 };

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      addEventListener: () => {},
      removeEventListener: () => {},
      __COORDINATOR__: {
        workbook: {
          activeSheet: {
            formats: {
              async setRanges(
                ranges: SetRangesCall['ranges'],
                format: Record<string, unknown>,
              ): Promise<void> {
                setRangesCalls.push({ ranges, format });
              },
              async get(): Promise<Record<string, unknown>> {
                callCounts.formatGet++;
                return {};
              },
              async clearRanges(): Promise<void> {
                callCounts.clearRanges++;
              },
            },
            layout: {
              async autoFitRows(rows: number[]): Promise<void> {
                autoFitRowsCalls.push(rows);
              },
              async resetRowHeight(row: number): Promise<void> {
                resetRowHeightCalls.push(row);
              },
            },
          },
        },
      },
    },
  });

  const store = new EventStore();
  store.enable();
  const api = createConsoleAPI(store, new ActorRecorder(store));
  (g.window as any).__dt = api;

  return {
    api,
    setRangesCalls,
    get formatGetCalls() {
      return callCounts.formatGet;
    },
    get clearRangesCalls() {
      return callCounts.clearRanges;
    },
    autoFitRowsCalls,
    resetRowHeightCalls,
    cleanup() {
      delete g.window;
      delete g.document;
    },
  };
}

describe('__dt.setCellFormat mutation boundary', () => {
  let runtime: RuntimeBundle | null = null;

  afterEach(() => {
    runtime?.cleanup();
    runtime = null;
  });

  test('forwards canonical backgroundColor without adding fillColor', async () => {
    runtime = setupRuntime();

    await runtime.api.setCellFormat(2, 3, {
      bold: true,
      backgroundColor: '#D9EAF7',
    });

    expect(runtime.setRangesCalls).toEqual([
      {
        ranges: [{ startRow: 2, startCol: 3, endRow: 2, endCol: 3 }],
        format: { bold: true, backgroundColor: '#D9EAF7' },
      },
    ]);
  });

  test('delegates compatibility aliases unchanged to the worksheet format API', async () => {
    runtime = setupRuntime();

    await runtime.api.setCellFormat(0, 1, {
      fillColor: '#FFE699',
      horizontalAlignment: 'center',
      verticalAlignment: 'center',
    });

    expect(runtime.setRangesCalls).toEqual([
      {
        ranges: [{ startRow: 0, startCol: 1, endRow: 0, endCol: 1 }],
        format: {
          fillColor: '#FFE699',
          horizontalAlignment: 'center',
          verticalAlignment: 'center',
        },
      },
    ]);
  });

  test('delegates null clears directly instead of rebuilding the resolved format', async () => {
    runtime = setupRuntime();

    await runtime.api.setCellFormat(4, 5, {
      backgroundColor: null,
      fontColor: null,
      bold: true,
    });

    expect(runtime.setRangesCalls).toEqual([
      {
        ranges: [{ startRow: 4, startCol: 5, endRow: 4, endCol: 5 }],
        format: { backgroundColor: null, fontColor: null, bold: true },
      },
    ]);
    expect(runtime.formatGetCalls).toBe(0);
    expect(runtime.clearRangesCalls).toBe(0);
  });

  test('keeps the devtools indent clamp and row auto-fit behavior', async () => {
    runtime = setupRuntime();
    const input = { indent: -2, fontSize: 16, wrapText: true };

    await runtime.api.setCellFormat(6, 7, input);

    expect(input.indent).toBe(-2);
    expect(runtime.setRangesCalls[0]?.format).toEqual({
      indent: 0,
      fontSize: 16,
      wrapText: true,
    });
    expect(runtime.autoFitRowsCalls).toEqual([[6]]);
    expect(runtime.resetRowHeightCalls).toEqual([]);
  });

  test('keeps the wrapped-row reset behavior when wrap is disabled', async () => {
    runtime = setupRuntime();

    await runtime.api.setCellFormat(8, 9, { wrapText: false });

    expect(runtime.resetRowHeightCalls).toEqual([8]);
    expect(runtime.autoFitRowsCalls).toEqual([]);
  });
});
