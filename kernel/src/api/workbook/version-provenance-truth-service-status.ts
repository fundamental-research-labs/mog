import type { WorkbookVersionDiagnostic } from '@mog-sdk/contracts/api';

import type {
  WorkbookVersionProvenanceStatusClassification,
  WorkbookVersionProvenanceStatusProjection,
  WorkbookVersionProvenanceStatusProjectionItem,
} from './version-provenance-truth-service-types';
import { isRecord } from './version-provenance-truth-service-utils';

export const WORKBOOK_VERSION_PROVENANCE_STATUS_PROJECTION = Object.freeze({
  schemaVersion: 1,
  source: 'provider-backed-sync-provenance-status',
  redaction: 'classification-only',
  classifications: Object.freeze([
    statusProjectionItem('blockedBatchFailure', {
      commitGrouping: 'blockedBatchFailure',
    }),
    statusProjectionItem('mixedRemote', {
      commitGrouping: 'blockedMixedRemote',
    }),
    statusProjectionItem('legacyRawUnknown', {
      sourceKind: 'legacyRawUnknown',
    }),
    statusProjectionItem('quarantine', {
      lifecycleClassification: 'quarantine',
    }),
    statusProjectionItem('disconnect', {
      lifecycleClassification: 'disconnect',
    }),
  ]),
}) satisfies WorkbookVersionProvenanceStatusProjection;

const WORKBOOK_VERSION_PROVENANCE_STATUS_PROJECTION_BY_CLASSIFICATION = new Map(
  WORKBOOK_VERSION_PROVENANCE_STATUS_PROJECTION.classifications.map((item) => [
    item.classification,
    item,
  ]),
);

export function readWorkbookVersionProvenanceStatusProjection(
  value: unknown,
): WorkbookVersionProvenanceStatusProjection | null {
  const projection = findWorkbookVersionProvenanceStatusProjection(value);
  if (!projection) return null;
  const classifications = normalizeStatusProjectionItems(projection.classifications);
  if (classifications.length === 0) return null;

  return Object.freeze({
    schemaVersion: 1,
    source: 'provider-backed-sync-provenance-status',
    redaction: 'classification-only',
    classifications: Object.freeze(classifications),
  });
}

export function projectWorkbookVersionProvenanceStatusDiagnostics(
  candidates: readonly unknown[],
): readonly WorkbookVersionDiagnostic[] {
  for (const candidate of candidates) {
    const projection = readWorkbookVersionProvenanceStatusProjection(candidate);
    if (!projection) continue;
    return Object.freeze(projection.classifications.map(provenanceStatusDiagnostic));
  }
  return [];
}

function statusProjectionItem(
  classification: WorkbookVersionProvenanceStatusClassification,
  projection: Pick<
    WorkbookVersionProvenanceStatusProjectionItem,
    'commitGrouping' | 'sourceKind' | 'lifecycleClassification'
  >,
): WorkbookVersionProvenanceStatusProjectionItem {
  return Object.freeze({
    classification,
    publicStatusCode: `version.provenanceAdmission.status.${classification}`,
    safe: false,
    complete: false,
    projectedSafety: 'unsafe',
    projectedCompleteness: 'blocked',
    redaction: 'classification-only',
    rawProviderMaterialIncluded: false,
    rawClientMaterialIncluded: false,
    ...projection,
  });
}

function findWorkbookVersionProvenanceStatusProjection(
  value: unknown,
): WorkbookVersionProvenanceStatusProjection | null {
  if (isWorkbookVersionProvenanceStatusProjection(value)) return value;
  if (!isRecord(value)) return null;

  for (const candidate of [
    value.vc09ProvenanceStatusProjection,
    value.provenanceStatusProjection,
    value.statusProjection,
  ]) {
    if (isWorkbookVersionProvenanceStatusProjection(candidate)) return candidate;
  }

  for (const candidate of [value.vc09ProvenanceTruth, value.provenanceAdmissionTruth]) {
    if (!isRecord(candidate)) continue;
    if (isWorkbookVersionProvenanceStatusProjection(candidate.statusProjection)) {
      return candidate.statusProjection;
    }
  }

  return null;
}

function isWorkbookVersionProvenanceStatusProjection(
  value: unknown,
): value is WorkbookVersionProvenanceStatusProjection {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    value.redaction === 'classification-only' &&
    Array.isArray(value.classifications)
  );
}

function normalizeStatusProjectionItem(
  value: unknown,
): WorkbookVersionProvenanceStatusProjectionItem | null {
  if (!isRecord(value) || typeof value.classification !== 'string') return null;
  return (
    WORKBOOK_VERSION_PROVENANCE_STATUS_PROJECTION_BY_CLASSIFICATION.get(
      value.classification as WorkbookVersionProvenanceStatusClassification,
    ) ?? null
  );
}

function normalizeStatusProjectionItems(
  values: readonly unknown[],
): readonly WorkbookVersionProvenanceStatusProjectionItem[] {
  const seen = new Set<WorkbookVersionProvenanceStatusClassification>();
  const normalized: WorkbookVersionProvenanceStatusProjectionItem[] = [];
  for (const value of values) {
    const item = normalizeStatusProjectionItem(value);
    if (!item || seen.has(item.classification)) continue;
    seen.add(item.classification);
    normalized.push(item);
  }
  return normalized;
}

function provenanceStatusDiagnostic(
  item: WorkbookVersionProvenanceStatusProjectionItem,
): WorkbookVersionDiagnostic {
  return Object.freeze({
    code: item.publicStatusCode,
    severity: 'warning',
    message: provenanceStatusDiagnosticMessage(item.classification),
    dependency: 'version-service',
    data: provenanceStatusDiagnosticData(item),
  });
}

function provenanceStatusDiagnosticMessage(
  classification: WorkbookVersionProvenanceStatusClassification,
): string {
  switch (classification) {
    case 'blockedBatchFailure':
      return 'VC-09 provenance status projects sync batch failures as a blocked batch-failure classification.';
    case 'mixedRemote':
      return 'VC-09 provenance status projects aggregate remote authorship as a mixed remote classification.';
    case 'legacyRawUnknown':
      return 'VC-09 provenance status projects unclassified raw sync bytes as legacy raw unknown.';
    case 'quarantine':
      return 'VC-09 provenance status projects provider quarantine decisions without exposing provider material.';
    case 'disconnect':
      return 'VC-09 provenance status projects provider disconnect decisions without exposing client material.';
  }
}

function provenanceStatusDiagnosticData(
  item: WorkbookVersionProvenanceStatusProjectionItem,
): NonNullable<WorkbookVersionDiagnostic['data']> {
  return {
    requiredSlice: 'VC-09',
    classification: item.classification,
    safe: item.safe,
    complete: item.complete,
    projectedSafety: item.projectedSafety,
    projectedCompleteness: item.projectedCompleteness,
    redaction: item.redaction,
    rawProviderMaterialIncluded: item.rawProviderMaterialIncluded,
    rawClientMaterialIncluded: item.rawClientMaterialIncluded,
    ...(item.commitGrouping ? { commitGrouping: item.commitGrouping } : {}),
    ...(item.sourceKind ? { sourceKind: item.sourceKind } : {}),
    ...(item.lifecycleClassification
      ? { lifecycleClassification: item.lifecycleClassification }
      : {}),
  };
}
