import type { WorkbookSettings } from '@mog-sdk/contracts/core';

import type { WorkbookSettings as ComputeWorkbookSettings } from '../../bridges/compute/compute-types.gen';
import { DEFAULT_WORKBOOK_SETTINGS } from './core-defaults';

/**
 * Materialize the public workbook settings contract into the full Rust compute
 * snapshot shape. Public settings may omit fields that Rust always returns with
 * serde defaults; full replacement calls must send the materialized form.
 */
export function toComputeWorkbookSettings(settings: WorkbookSettings): ComputeWorkbookSettings {
  const defaults = DEFAULT_WORKBOOK_SETTINGS;
  const automaticConversionPolicy = {
    ...defaults.automaticConversionPolicy,
    ...settings.automaticConversionPolicy,
  };
  const calculationSettings =
    settings.calculationSettings !== undefined
      ? {
          ...defaults.calculationSettings,
          ...settings.calculationSettings,
        }
      : undefined;

  return {
    showHorizontalScrollbar: settings.showHorizontalScrollbar ?? defaults.showHorizontalScrollbar,
    showVerticalScrollbar: settings.showVerticalScrollbar ?? defaults.showVerticalScrollbar,
    autoHideScrollBars: settings.autoHideScrollBars ?? defaults.autoHideScrollBars,
    showTabStrip: settings.showTabStrip ?? defaults.showTabStrip,
    showFormulaBar: settings.showFormulaBar ?? defaults.showFormulaBar,
    allowSheetReorder: settings.allowSheetReorder ?? defaults.allowSheetReorder,
    autoFitOnDoubleClick: settings.autoFitOnDoubleClick ?? defaults.autoFitOnDoubleClick,
    showCutCopyIndicator: settings.showCutCopyIndicator ?? defaults.showCutCopyIndicator,
    allowDragFill: settings.allowDragFill ?? defaults.allowDragFill,
    enterKeyDirection: settings.enterKeyDirection ?? defaults.enterKeyDirection,
    allowCellDragDrop: settings.allowCellDragDrop ?? defaults.allowCellDragDrop,
    themeId: settings.themeId ?? defaults.themeId,
    ...(settings.themeFontsId !== undefined ? { themeFontsId: settings.themeFontsId } : {}),
    culture: settings.culture ?? defaults.culture,
    ...(settings.selectedSheetIds !== undefined
      ? { selectedSheetIds: [...settings.selectedSheetIds] }
      : {}),
    isWorkbookProtected: settings.isWorkbookProtected ?? defaults.isWorkbookProtected ?? false,
    ...(settings.workbookProtectionPasswordHash !== undefined
      ? { workbookProtectionPasswordHash: settings.workbookProtectionPasswordHash }
      : {}),
    ...(settings.workbookProtectionOptions !== undefined
      ? { workbookProtectionOptions: settings.workbookProtectionOptions }
      : {}),
    ...(calculationSettings !== undefined ? { calculationSettings } : {}),
    date1904: settings.date1904 ?? defaults.date1904 ?? false,
    ...(settings.defaultTableStyleId !== undefined
      ? { defaultTableStyleId: settings.defaultTableStyleId }
      : {}),
    automaticConversionPolicy,
  };
}
