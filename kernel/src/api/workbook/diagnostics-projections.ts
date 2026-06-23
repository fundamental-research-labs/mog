import type {
  FormulaReferenceDiagnostic,
  RuntimeOperationDiagnostic,
} from '@mog-sdk/contracts/api';
import type { ChartExportOptionsSnapshot } from '@mog-sdk/contracts/data/charts';
import type { normalizeImageExportOptions } from '@mog/charts/export';

import type {
  FormulaReferenceDiagnostic as BridgeFormulaReferenceDiagnostic,
  RuntimeOperationDiagnostic as BridgeRuntimeOperationDiagnostic,
} from '../../bridges/compute/compute-types.gen';

export function projectRuntimeOperationDiagnostic(
  diagnostic: BridgeRuntimeOperationDiagnostic,
): RuntimeOperationDiagnostic {
  return {
    ...diagnostic,
    severity: diagnostic.severity === 'error' ? 'error' : 'warning',
    filterKind: projectRuntimeFilterKind(diagnostic.filterKind),
  };
}

export function projectFormulaReferenceDiagnostic(
  diagnostic: BridgeFormulaReferenceDiagnostic,
): FormulaReferenceDiagnostic {
  return diagnostic as unknown as FormulaReferenceDiagnostic;
}

export function toChartExportOptionsSnapshot(
  normalized: ReturnType<typeof normalizeImageExportOptions>,
): ChartExportOptionsSnapshot {
  if (normalized.kind === 'vector') {
    return {
      kind: normalized.kind,
      format: normalized.format,
      width: normalized.width,
      height: normalized.height,
      backgroundColor: normalized.backgroundColor,
      fittingMode: normalized.fittingMode,
      frame: normalized.frame,
    };
  }

  return {
    kind: normalized.kind,
    format: normalized.format,
    width: normalized.width,
    height: normalized.height,
    pixelRatio: normalized.pixelRatio,
    physicalWidth: normalized.physicalWidth,
    physicalHeight: normalized.physicalHeight,
    backgroundColor: normalized.backgroundColor,
    quality: normalized.quality,
    fittingMode: normalized.fittingMode,
    frame: normalized.frame,
  };
}

function projectRuntimeFilterKind(
  value: string | undefined,
): RuntimeOperationDiagnostic['filterKind'] {
  if (value === 'autoFilter' || value === 'tableFilter' || value === 'advancedFilter') {
    return value;
  }
  return undefined;
}
