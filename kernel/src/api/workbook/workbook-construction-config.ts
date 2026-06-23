import type { WorkbookStateProvider } from '@mog-sdk/contracts/api';
import type { DocumentContext } from '../../context';
import type { WriteGate } from '../../document/write-gate';
import { slog } from '../../lib/slog';
import type { WorkbookConfig } from './types';
import { bindWorkbookFeatureGates } from './workbook-feature-gates-context';

export type WorkbookFeatureGateBinder = (ctx: DocumentContext) => DocumentContext;

export function createWorkbookFeatureGateBinder(
  config: Pick<WorkbookConfig, 'featureGates' | 'readFeatureGates'>,
): WorkbookFeatureGateBinder {
  const initialFeatureGates = config.featureGates;
  const readFeatureGates = config.readFeatureGates;
  return (ctx) => {
    if (!initialFeatureGates && !readFeatureGates) return ctx;
    return bindWorkbookFeatureGates(ctx, () => readFeatureGates?.() ?? initialFeatureGates);
  };
}

export function createWorkbookStateProvider(
  stateProvider: WorkbookConfig['stateProvider'],
): WorkbookStateProvider {
  if (stateProvider) {
    slog('workbook.activeSheet.mode', { mode: 'external-provider' });
    return stateProvider;
  }

  let activeSheetId = '';
  const headlessProvider: WorkbookStateProvider = {
    getActiveSheetId: () => activeSheetId,
    setActiveSheetId: (id: string) => {
      slog('workbook.activeSheet.set', { sheetId: id });
      activeSheetId = id;
    },
    getActiveCell: () => null,
    getSelectedRanges: () => [],
    getActiveObjectId: () => null,
    getActiveObjectType: () => null,
  };
  slog('workbook.activeSheet.mode', { mode: 'internal-tracking' });
  return headlessProvider;
}

export function applyWorkbookReadOnlyMode(ctx: DocumentContext, readOnly: boolean): void {
  if (!readOnly) return;
  (ctx.writeGate as WriteGate).setMode('closed');
}
