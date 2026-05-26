import { jest } from '@jest/globals';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';

import { APPLY_PAGE_SETUP } from '../dialog-handlers';

function createMockDeps() {
  const closePageSetupDialog = jest.fn();
  const setSettings = jest.fn(async () => undefined);
  const clearPrintTitles = jest.fn(async () => undefined);
  const setPrintTitleRows = jest.fn(async () => undefined);
  const setPrintTitleColumns = jest.fn(async () => undefined);

  const deps = {
    uiStore: {
      getState: () => ({
        activeSheetId: 'sheet-1',
        closePageSetupDialog,
      }),
    },
    workbook: {
      getSheetById: jest.fn(() => ({
        print: {
          setSettings,
          clearPrintTitles,
          setPrintTitleRows,
          setPrintTitleColumns,
        },
      })),
    },
  } as unknown as ActionDependencies;

  return {
    deps,
    closePageSetupDialog,
    setSettings,
    clearPrintTitles,
    setPrintTitleRows,
    setPrintTitleColumns,
  };
}

describe('APPLY_PAGE_SETUP', () => {
  it('persists print titles separately from print settings', async () => {
    const mocks = createMockDeps();

    const result = await APPLY_PAGE_SETUP(mocks.deps, {
      orientation: 'landscape',
      gridlines: true,
      printTitles: {
        repeatRows: [0, 1],
        repeatCols: [0, 1],
      },
    });

    expect(result.handled).toBe(true);
    expect(mocks.closePageSetupDialog).toHaveBeenCalledTimes(1);
    expect(mocks.setSettings).toHaveBeenCalledWith({
      orientation: 'landscape',
      gridlines: true,
    });
    expect(mocks.clearPrintTitles).toHaveBeenCalledTimes(1);
    expect(mocks.setPrintTitleRows).toHaveBeenCalledWith(0, 1);
    expect(mocks.setPrintTitleColumns).toHaveBeenCalledWith(0, 1);
  });
});
