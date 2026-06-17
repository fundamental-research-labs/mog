import { jest } from '@jest/globals';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';

import { pasteChartFromClipboard } from '../chart-clipboard';
import { createChartAddReceipt } from './test-helpers';

function createPasteDeps({
  activeCell = { row: 20, col: 3 },
  isCut = false,
}: {
  activeCell?: { row: number; col: number } | null;
  isCut?: boolean;
} = {}) {
  const addChart = jest.fn().mockResolvedValue(createChartAddReceipt('pasted-chart-id'));
  const removeChart = jest.fn().mockResolvedValue(undefined);
  const selectObject = jest.fn();
  const clearChartClipboard = jest.fn();

  const deps = {
    uiStore: {
      getState: () => ({
        chartClipboard: {
          copiedChart: {
            config: {
              type: 'column',
              dataRange: 'A1:B4',
              anchorRow: 5,
              anchorCol: 2,
              width: 8,
              height: 15,
              leftPt: 40,
              topPt: 60,
              createdAt: 100,
              updatedAt: 200,
              sheetId: 'sheet1',
            },
            sourceSheetId: 'sheet1',
            copiedAt: Date.now(),
          },
          cutChartId: isCut ? 'source-chart-id' : null,
          isCut,
        },
        clearChartClipboard,
      }),
    },
    workbook: {
      activeSheet: {
        charts: {
          add: addChart,
        },
      },
      getSheetById: jest.fn(() => ({
        charts: {
          remove: removeChart,
        },
      })),
    },
    accessors: {
      selection: {
        getActiveCell: () => activeCell,
      },
    },
    commands: {
      object: {
        selectObject,
      },
    },
  } as unknown as ActionDependencies;

  return { deps, addChart, clearChartClipboard, removeChart, selectObject };
}

describe('pasteChartFromClipboard', () => {
  it('pastes copied charts at the active cell without stale point offsets', async () => {
    const { deps, addChart, selectObject } = createPasteDeps();

    const result = await pasteChartFromClipboard(deps);

    expect(result.handled).toBe(true);
    expect(addChart).toHaveBeenCalledTimes(1);
    const pastedConfig = addChart.mock.calls[0][0] as Record<string, unknown>;
    expect(pastedConfig).toEqual(
      expect.objectContaining({
        type: 'column',
        dataRange: 'A1:B4',
        anchorRow: 20,
        anchorCol: 3,
        width: 8,
        height: 15,
      }),
    );
    expect(pastedConfig).not.toHaveProperty('leftPt');
    expect(pastedConfig).not.toHaveProperty('topPt');
    expect(pastedConfig).not.toHaveProperty('createdAt');
    expect(pastedConfig).not.toHaveProperty('updatedAt');
    expect(pastedConfig).not.toHaveProperty('sheetId');
    expect(selectObject).toHaveBeenCalledWith('pasted-chart-id', false, false);
  });

  it('falls back to offset paste when there is no active cell', async () => {
    const { deps, addChart } = createPasteDeps({ activeCell: null });

    const result = await pasteChartFromClipboard(deps);

    expect(result.handled).toBe(true);
    expect(addChart).toHaveBeenCalledWith(
      expect.objectContaining({
        anchorRow: 7,
        anchorCol: 4,
      }),
    );
  });
});
