import type { VersionStoreDiagnostic } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../context';
import type { DomainSupportDetectorRow } from '../../../../document/version-store/domain-support-manifest-validator';
import {
  domainSupportDetectorReadFailedDiagnostic,
  domainSupportDetectorUnavailableDiagnostic,
} from './version-domain-support-gate-diagnostics';
import {
  bindMethod,
  isRecord,
  type DomainSupportDetectionResult,
  type MaybePromise,
  type VersionDomainSupportManifestGateOperation,
  type WorkbookMutableDomainDetector,
} from './version-domain-support-gate-types';

const WORKBOOK_MUTABLE_DOMAIN_DETECTORS = Object.freeze([
  {
    matrixRowId: 'tables',
    domainId: 'tables',
    detectorId: 'detector.tables',
    isPresent: hasTablesPresent,
  },
  {
    matrixRowId: 'filters.auto-filter',
    domainId: 'filters',
    detectorId: 'detector.filters.auto-filter',
    isPresent: hasFiltersPresent,
  },
  {
    matrixRowId: 'named-ranges',
    domainId: 'named-ranges',
    detectorId: 'detector.named-ranges',
    isPresent: hasNamedRangesPresent,
  },
  {
    matrixRowId: 'external-links',
    domainId: 'external-links',
    detectorId: 'detector.external-links',
    isPresent: hasHyperlinksPresent,
  },
  {
    matrixRowId: 'data-validation',
    domainId: 'data-validation',
    detectorId: 'detector.data-validation',
    isPresent: hasDataValidationPresent,
  },
] satisfies readonly WorkbookMutableDomainDetector[]);

export async function detectWorkbookMutableDomainRows(
  ctx: DocumentContext,
  operation: VersionDomainSupportManifestGateOperation,
): Promise<DomainSupportDetectionResult> {
  if (!isRecord((ctx as Partial<DocumentContext>).computeBridge)) {
    return { detectorRows: [], diagnostics: [] };
  }

  const results = await Promise.all(
    WORKBOOK_MUTABLE_DOMAIN_DETECTORS.map(async (detector) => {
      try {
        const present = await detector.isPresent(ctx);
        return { detector, present, diagnostic: null };
      } catch {
        return {
          detector,
          present: null,
          diagnostic: domainSupportDetectorReadFailedDiagnostic(operation, detector),
        };
      }
    }),
  );

  const detectorRows: DomainSupportDetectorRow[] = [];
  const diagnostics: VersionStoreDiagnostic[] = [];
  for (const result of results) {
    if (result.diagnostic) {
      diagnostics.push(result.diagnostic);
      continue;
    }
    if (result.present === null) {
      diagnostics.push(domainSupportDetectorUnavailableDiagnostic(operation, result.detector));
      continue;
    }
    detectorRows.push({
      matrixRowId: result.detector.matrixRowId,
      domainId: result.detector.domainId,
      present: result.present,
      detectorId: result.detector.detectorId,
    });
  }

  return { detectorRows, diagnostics };
}

export function mergeDomainSupportDetectorRows(
  callerRows: readonly DomainSupportDetectorRow[] | undefined,
  detectedRows: readonly DomainSupportDetectorRow[],
): readonly DomainSupportDetectorRow[] | undefined {
  const rows: DomainSupportDetectorRow[] = [];
  const rowIndexes = new Map<string, number>();

  for (const row of [...(callerRows ?? []), ...detectedRows]) {
    const key = domainSupportDetectorRowKey(row);
    const existingIndex = rowIndexes.get(key);
    if (existingIndex === undefined) {
      rowIndexes.set(key, rows.length);
      rows.push(row);
      continue;
    }

    const existing = rows[existingIndex];
    if (existing.present || !row.present) continue;
    rows[existingIndex] = {
      ...existing,
      ...row,
      detectorId: existing.detectorId ?? row.detectorId,
      present: true,
    };
  }

  return rows.length > 0 ? rows : undefined;
}

function domainSupportDetectorRowKey(row: DomainSupportDetectorRow): string {
  return row.matrixRowId ? `matrix:${row.matrixRowId}` : `domain:${row.domainId}`;
}

async function hasNamedRangesPresent(ctx: DocumentContext): Promise<boolean | null> {
  const namedRangeCount = bindMethod(ctx.computeBridge as unknown, 'namedRangeCount');
  const getAllNamedRangesWire = bindMethod(ctx.computeBridge as unknown, 'getAllNamedRangesWire');
  if (namedRangeCount) {
    try {
      const count = await namedRangeCount();
      if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) {
        throw new Error('namedRangeCount returned a malformed count.');
      }
      return count > 0;
    } catch (error) {
      if (!getAllNamedRangesWire || !isNamedRangeCountTransportUnavailable(error)) {
        throw error;
      }
    }
  }

  if (!getAllNamedRangesWire) return null;

  const names = await getAllNamedRangesWire();
  return expectArrayResult(names, 'getAllNamedRangesWire').length > 0;
}

function isNamedRangeCountTransportUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /compute_named_range_count|namedRangeCount.*(unavailable|unsupported|not implemented|not registered|not found|unknown)/i.test(
    message,
  );
}

async function hasTablesPresent(ctx: DocumentContext): Promise<boolean | null> {
  const getAllTablesInSheet = bindMethod(ctx.computeBridge as unknown, 'getAllTablesInSheet');
  if (!getAllTablesInSheet) return null;
  return hasAnySheetScopedRows(ctx, 'getAllTablesInSheet', (sheetId) =>
    getAllTablesInSheet(sheetId),
  );
}

async function hasFiltersPresent(ctx: DocumentContext): Promise<boolean | null> {
  const getFiltersInSheet = bindMethod(ctx.computeBridge as unknown, 'getFiltersInSheet');
  if (!getFiltersInSheet) return null;
  return hasAnySheetScopedRows(ctx, 'getFiltersInSheet', (sheetId) => getFiltersInSheet(sheetId));
}

async function hasHyperlinksPresent(ctx: DocumentContext): Promise<boolean | null> {
  const getHyperlinks = bindMethod(ctx.computeBridge as unknown, 'getHyperlinks');
  if (!getHyperlinks) return null;
  return hasAnySheetScopedRows(ctx, 'getHyperlinks', (sheetId) => getHyperlinks(sheetId));
}

async function hasDataValidationPresent(ctx: DocumentContext): Promise<boolean | null> {
  const getRangeSchemasForSheet = bindMethod(
    ctx.computeBridge as unknown,
    'getRangeSchemasForSheet',
  );
  if (!getRangeSchemasForSheet) return null;
  return hasAnySheetScopedRows(ctx, 'getRangeSchemasForSheet', (sheetId) =>
    getRangeSchemasForSheet(sheetId),
  );
}

async function hasAnySheetScopedRows(
  ctx: DocumentContext,
  readRowsMethodName: string,
  readRows: (sheetId: string) => MaybePromise<unknown>,
): Promise<boolean | null> {
  const getAllSheetIds = bindMethod(ctx.computeBridge as unknown, 'getAllSheetIds');
  if (!getAllSheetIds) return null;

  const sheetIds = expectStringArrayResult(await getAllSheetIds(), 'getAllSheetIds');

  for (const sheetId of sheetIds) {
    const rows = expectArrayResult(await readRows(sheetId), readRowsMethodName);
    if (rows.length > 0) return true;
  }
  return false;
}

function expectArrayResult(value: unknown, methodName: string): readonly unknown[] {
  if (Array.isArray(value)) return value;
  throw new Error(`${methodName} returned a malformed non-array result.`);
}

function expectStringArrayResult(value: unknown, methodName: string): readonly string[] {
  const values = expectArrayResult(value, methodName);
  for (const item of values) {
    if (typeof item !== 'string' || item === '') {
      throw new Error(`${methodName} returned a malformed string array result.`);
    }
  }
  return values as readonly string[];
}
