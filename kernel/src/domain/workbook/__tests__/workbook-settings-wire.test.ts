import { sheetId } from '@mog-sdk/contracts/core';
import type { WorkbookSettings } from '@mog-sdk/contracts/core';

import { toComputeWorkbookSettings } from '../workbook-settings-wire';

describe('workbook settings wire mapper', () => {
  it('materializes public workbook settings into the full compute snapshot shape', () => {
    const publicSettings = {
      showHorizontalScrollbar: true,
      showVerticalScrollbar: true,
      autoHideScrollBars: false,
      showTabStrip: true,
      showFormulaBar: true,
      allowSheetReorder: true,
      autoFitOnDoubleClick: true,
      showCutCopyIndicator: true,
      allowDragFill: true,
      enterKeyDirection: 'down',
      allowCellDragDrop: false,
      themeId: 'office',
      culture: 'en-US',
      selectedSheetIds: [sheetId('sheet-a')],
      automaticConversionPolicy: {
        convertDateLikeText: false,
      },
    } as WorkbookSettings;

    expect(toComputeWorkbookSettings(publicSettings)).toEqual({
      showHorizontalScrollbar: true,
      showVerticalScrollbar: true,
      autoHideScrollBars: false,
      showTabStrip: true,
      showFormulaBar: true,
      allowSheetReorder: true,
      autoFitOnDoubleClick: true,
      showCutCopyIndicator: true,
      allowDragFill: true,
      enterKeyDirection: 'down',
      allowCellDragDrop: false,
      themeId: 'office',
      culture: 'en-US',
      selectedSheetIds: ['sheet-a'],
      isWorkbookProtected: false,
      date1904: false,
      automaticConversionPolicy: {
        convertDateLikeText: false,
        convertTimeLikeText: true,
        convertFractionLikeText: true,
        convertScientificNotation: true,
        convertLeadingZeroNumbers: true,
        convertLongDigitNumbers: true,
        convertPercentSuffix: true,
        convertCurrencySymbol: true,
        convertFormattedNumbers: true,
      },
    });
  });
});
