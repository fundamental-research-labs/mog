/**
 * Shared chart clipboard operations.
 *
 * Kept outside charts.ts so clipboard.ts can route chart paste without importing
 * another dispatcher-registered handler module.
 */

import type { ActionResult, AsyncActionHandler } from '@mog-sdk/contracts/actions';
import { sheetId } from '@mog-sdk/contracts/core';

import { selectChartObject } from './chart-selection';
import { getUIStore, handled, notHandled } from './handler-utils';

export const pasteChartFromClipboard: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  const uiStore = getUIStore(deps);
  if (!uiStore) {
    return notHandled('disabled');
  }

  const state = uiStore.getState();
  const clipboard = state.chartClipboard;
  if (!clipboard?.copiedChart) {
    return { handled: false, reason: 'disabled' };
  }

  const ws = deps.workbook.activeSheet;

  const {
    anchorCellId: _ac,
    endAnchorCellId: _eac,
    createdAt: _clipCreated,
    updatedAt: _clipUpdated,
    sheetId: _clipSheet,
    ...baseConfig
  } = clipboard.copiedChart.config;
  try {
    const newChart = await ws.charts.add({
      ...baseConfig,
      anchorRow: (baseConfig.anchorRow ?? 0) + 2,
      anchorCol: (baseConfig.anchorCol ?? 0) + 2,
    });

    if (clipboard.isCut && clipboard.cutChartId) {
      const sourceSheetId = clipboard.copiedChart.sourceSheetId;
      const sourceWs = deps.workbook.getSheetById(sheetId(sourceSheetId));
      await sourceWs.charts.remove(clipboard.cutChartId);
      uiStore.getState().clearChartClipboard();
    }

    if (newChart?.id) {
      selectChartObject(deps, newChart.id);
    }
  } catch (e: any) {
    return { handled: false, error: e.message ?? String(e) };
  }

  return handled();
};
