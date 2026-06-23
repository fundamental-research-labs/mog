import type {
  VersionDiagnosticPublicPayload,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';
import {
  PUBLIC_VERSION_DOMAIN_EXPORT_REQUIRED_MATRIX_ROW_IDS,
  PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY,
  PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY_EXPORT_SUPPORTS_REQUIRED_ROWS,
  type DomainCapabilityPolicyManifest,
  type VersionDomainCapabilityKey,
} from '@mog-sdk/contracts/versioning';

import type { DocumentContext } from '../../context';
import {
  REQUIRED_FIRST_SLICE_MATRIX_ROW_IDS,
  validateDomainSupportManifest,
  type DomainSupportDetectorRow,
  type DomainSupportManifestDiagnostic,
  type DomainSupportManifestValidationOptions,
} from '../../document/version-store/domain-support-manifest-validator';
import {
  isMaterializableMergeDomainReference,
  unsupportedDetectedMergeDomainDiagnostic,
} from './version-merge-materializer-support';

type MaybePromise<T> = T | Promise<T>;
type VersionDomainSupportManifestGateOperation =
  | 'commit'
  | 'checkout'
  | 'merge'
  | 'applyMerge'
  | 'export';

type MaybeDomainSupportManifestContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

type DomainSupportDetectionResult = {
  readonly detectorRows: readonly DomainSupportDetectorRow[];
  readonly diagnostics: readonly VersionStoreDiagnostic[];
};

type WorkbookMutableDomainDetector = {
  readonly matrixRowId: string;
  readonly domainId: string;
  readonly detectorId: string;
  readonly isPresent: (ctx: DocumentContext) => MaybePromise<boolean | null>;
};

type AttachedDomainSupportManifestGate = {
  readonly hasManifestSource: boolean;
  readonly manifest?: unknown;
  readonly readManifest?: () => MaybePromise<unknown>;
  readonly options?: DomainSupportManifestValidationOptions;
};

const REQUIRED_MANIFEST_CAPABILITY_KEYS_BY_OPERATION = Object.freeze({
  commit: ['capture', 'persistence'],
  checkout: ['checkout'],
  merge: ['merge'],
  applyMerge: ['merge', 'persistence'],
  export: ['export'],
} satisfies Readonly<
  Record<VersionDomainSupportManifestGateOperation, readonly VersionDomainCapabilityKey[]>
>);

const REQUIRED_MANIFEST_MATRIX_ROW_IDS_BY_OPERATION = Object.freeze({
  commit: REQUIRED_FIRST_SLICE_MATRIX_ROW_IDS,
  checkout: REQUIRED_FIRST_SLICE_MATRIX_ROW_IDS,
  merge: REQUIRED_FIRST_SLICE_MATRIX_ROW_IDS,
  applyMerge: REQUIRED_FIRST_SLICE_MATRIX_ROW_IDS,
  export: PUBLIC_VERSION_DOMAIN_EXPORT_REQUIRED_MATRIX_ROW_IDS,
} satisfies Readonly<Record<VersionDomainSupportManifestGateOperation, readonly string[]>>);

const EVAL_ONLY_EXPECTED_FAILING_STATE = 'expected-failing';
const PUBLIC_DIAGNOSTIC_VALUE_RE = /^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/;
const MAX_PUBLIC_DIAGNOSTIC_VALUE_LENGTH = 128;

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

export async function validateVersionDomainSupportManifestGate(
  ctx: DocumentContext,
  operation: VersionDomainSupportManifestGateOperation,
): Promise<readonly VersionStoreDiagnostic[]> {
  const gate = getAttachedDomainSupportManifestGate(ctx);
  if (!gate) {
    return isVersionDomainSupportManifestRequired(ctx, operation)
      ? domainSupportManifestMissingDiagnostics(operation)
      : [];
  }

  let manifest: unknown;
  if (gate.readManifest) {
    try {
      manifest = await gate.readManifest();
    } catch {
      return domainSupportManifestReadFailedDiagnostics(operation);
    }
  } else if (gate.hasManifestSource) {
    manifest = gate.manifest;
  }

  if (manifest === undefined || manifest === null) {
    return domainSupportManifestMissingDiagnostics(operation);
  }

  const {
    domainPolicyRegistry: _ignoredCallerDomainPolicyRegistry,
    requiredCapabilityKeys: callerRequiredCapabilityKeys,
    requiredMatrixRowIds: callerRequiredMatrixRowIds,
    requiredDomainIds: callerRequiredDomainIds,
    ...callerOptions
  } = gate.options ?? {};
  const detected = await detectWorkbookMutableDomainRows(ctx, operation);
  if (detected.diagnostics.length > 0) return detected.diagnostics;

  const detectorRows = mergeDomainSupportDetectorRows(
    callerOptions.detectorRows,
    detected.detectorRows,
  );
  const options: DomainSupportManifestValidationOptions = {
    ...callerOptions,
    domainPolicyRegistry: PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY,
    now: gate.options?.now instanceof Date ? gate.options.now : new Date(),
    operation,
    requiredCapabilityKeys: requiredManifestCapabilityKeys(operation, callerRequiredCapabilityKeys),
    requiredMatrixRowIds: requiredManifestMatrixRowIds(
      operation,
      callerRequiredMatrixRowIds,
      detectorRows,
    ),
    requiredDomainIds: requiredManifestDomainIds(callerRequiredDomainIds, detectorRows),
    ...(detectorRows ? { detectorRows } : {}),
  };
  const validation = validateDomainSupportManifest(manifest, options);
  if (validation.ok) {
    const exportDiagnostics = publicExportRegistryUnsupportedDiagnostics(operation);
    if (exportDiagnostics.length > 0) return exportDiagnostics;
    return mergeDetectedDomainDiagnostics(operation, options);
  }

  return validation.diagnostics.map((diagnostic) =>
    domainSupportManifestInvalidDiagnostic(operation, diagnostic),
  );
}

async function detectWorkbookMutableDomainRows(
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

function mergeDomainSupportDetectorRows(
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
  if (namedRangeCount) {
    const count = await namedRangeCount();
    return typeof count === 'number' && count > 0;
  }

  const getAllNamedRangesWire = bindMethod(ctx.computeBridge as unknown, 'getAllNamedRangesWire');
  if (!getAllNamedRangesWire) return null;

  const names = await getAllNamedRangesWire();
  return Array.isArray(names) && names.length > 0;
}

async function hasTablesPresent(ctx: DocumentContext): Promise<boolean | null> {
  const getAllTablesInSheet = bindMethod(ctx.computeBridge as unknown, 'getAllTablesInSheet');
  if (!getAllTablesInSheet) return null;
  return hasAnySheetScopedRows(ctx, (sheetId) => getAllTablesInSheet(sheetId));
}

async function hasFiltersPresent(ctx: DocumentContext): Promise<boolean | null> {
  const getFiltersInSheet = bindMethod(ctx.computeBridge as unknown, 'getFiltersInSheet');
  if (!getFiltersInSheet) return null;
  return hasAnySheetScopedRows(ctx, (sheetId) => getFiltersInSheet(sheetId));
}

async function hasHyperlinksPresent(ctx: DocumentContext): Promise<boolean | null> {
  const getHyperlinks = bindMethod(ctx.computeBridge as unknown, 'getHyperlinks');
  if (!getHyperlinks) return null;
  return hasAnySheetScopedRows(ctx, (sheetId) => getHyperlinks(sheetId));
}

async function hasDataValidationPresent(ctx: DocumentContext): Promise<boolean | null> {
  const getRangeSchemasForSheet = bindMethod(
    ctx.computeBridge as unknown,
    'getRangeSchemasForSheet',
  );
  if (!getRangeSchemasForSheet) return null;
  return hasAnySheetScopedRows(ctx, (sheetId) => getRangeSchemasForSheet(sheetId));
}

async function hasAnySheetScopedRows(
  ctx: DocumentContext,
  readRows: (sheetId: string) => MaybePromise<unknown>,
): Promise<boolean | null> {
  const getAllSheetIds = bindMethod(ctx.computeBridge as unknown, 'getAllSheetIds');
  if (!getAllSheetIds) return null;

  const sheetIds = await getAllSheetIds();
  if (!Array.isArray(sheetIds)) return false;

  for (const sheetId of sheetIds) {
    if (typeof sheetId !== 'string' || sheetId === '') continue;
    const rows = await readRows(sheetId);
    if (Array.isArray(rows) && rows.length > 0) return true;
  }
  return false;
}

function mergeDetectedDomainDiagnostics(
  operation: VersionDomainSupportManifestGateOperation,
  options: DomainSupportManifestValidationOptions | undefined,
): readonly VersionStoreDiagnostic[] {
  if (operation !== 'merge' && operation !== 'applyMerge') return [];
  if (!Array.isArray(options?.detectorRows)) return [];

  const diagnostics: VersionStoreDiagnostic[] = [];
  options.detectorRows.forEach((row, itemIndex) => {
    if (!row.present) return;
    if (!isMaterializableMergeDomainReference(row)) {
      diagnostics.push(unsupportedDetectedMergeDomainDiagnostic(operation, itemIndex, row));
    }
  });
  return diagnostics;
}

function requiredManifestMatrixRowIds(
  operation: VersionDomainSupportManifestGateOperation,
  callerRequiredMatrixRowIds: readonly string[] | undefined,
  detectorRows: readonly DomainSupportDetectorRow[] | undefined,
): readonly string[] {
  return uniquePublicIds(
    REQUIRED_MANIFEST_MATRIX_ROW_IDS_BY_OPERATION[operation],
    callerRequiredMatrixRowIds,
    detectorRows?.filter((row) => row.present).map((row) => row.matrixRowId),
  );
}

function requiredManifestDomainIds(
  callerRequiredDomainIds: readonly string[] | undefined,
  detectorRows: readonly DomainSupportDetectorRow[] | undefined,
): readonly string[] | undefined {
  const requiredDomainIds = uniquePublicIds(
    callerRequiredDomainIds,
    detectorRows?.filter((row) => row.present).map((row) => row.domainId),
  );
  return requiredDomainIds.length > 0 ? requiredDomainIds : undefined;
}

function publicExportRegistryUnsupportedDiagnostics(
  operation: VersionDomainSupportManifestGateOperation,
): readonly VersionStoreDiagnostic[] {
  if (
    operation !== 'export' ||
    PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY_EXPORT_SUPPORTS_REQUIRED_ROWS
  ) {
    return [];
  }

  return PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY.domains
    .filter(isRequiredPublicExportRow)
    .filter(
      (row) =>
        row.capabilityStates.export !== 'supported' && row.capabilityStates.export !== 'derived',
    )
    .map((row) =>
      publicDiagnostic(
        operation,
        'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
        'The public version domain policy registry does not yet support export for every required domain row.',
        {
          diagnosticCode: 'public-export-registry-not-supported',
          matrixRowId: row.matrixRowId,
          domainId: row.domainId,
          capabilityKey: 'export',
          capabilityState: row.capabilityStates.export,
          policyField: 'capabilityStates.export',
          policyValue: row.capabilityStates.export,
        },
      ),
    );
}

function isRequiredPublicExportRow(row: DomainCapabilityPolicyManifest): boolean {
  return (PUBLIC_VERSION_DOMAIN_EXPORT_REQUIRED_MATRIX_ROW_IDS as readonly string[]).includes(
    row.matrixRowId,
  );
}

function getAttachedDomainSupportManifestGate(
  ctx: DocumentContext,
): AttachedDomainSupportManifestGate | null {
  const runtime = ctx as MaybeDomainSupportManifestContext;
  for (const candidate of [runtime.versioning, runtime.versionStore, runtime.version, ctx]) {
    const gate = gateFromRecord(candidate);
    if (gate) return gate;
  }
  return null;
}

function isVersionDomainSupportManifestRequired(
  ctx: DocumentContext,
  operation: VersionDomainSupportManifestGateOperation,
): boolean {
  const runtime = ctx as MaybeDomainSupportManifestContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  if (!isRecord(services)) return false;

  switch (operation) {
    case 'commit':
      return hasCommitService(services);
    case 'checkout':
      return hasCheckoutService(services);
    case 'merge':
      return hasMergeService(services);
    case 'applyMerge':
      return hasApplyMergeService(services) || hasMergeService(services);
    case 'export':
      return hasVersionOperationService(services);
  }
}

function hasVersionOperationService(services: Readonly<Record<string, unknown>>): boolean {
  if (
    hasCommitService(services) ||
    hasCheckoutService(services) ||
    hasMergeService(services) ||
    hasApplyMergeService(services)
  ) {
    return true;
  }

  for (const candidate of [
    services.provider,
    services.readService,
    services.refService,
    services.refsService,
    services.branchService,
    services.publicService,
    services.graphService,
    services.graphStore,
    services.graph,
    services,
  ]) {
    if (isRawGraphStore(candidate)) return true;
    if (
      hasMethod(candidate, 'getHead') ||
      hasMethod(candidate, 'listCommits') ||
      hasMethod(candidate, 'listRefs') ||
      hasMethod(candidate, 'readCommit') ||
      hasMethod(candidate, 'readCommitClosure') ||
      hasMethod(candidate, 'getCommit')
    ) {
      return true;
    }
  }

  return false;
}

function requiredManifestCapabilityKeys(
  operation: VersionDomainSupportManifestGateOperation,
  callerRequiredCapabilityKeys: readonly VersionDomainCapabilityKey[] | undefined,
): readonly VersionDomainCapabilityKey[] {
  return uniquePublicIds(
    REQUIRED_MANIFEST_CAPABILITY_KEYS_BY_OPERATION[operation],
    callerRequiredCapabilityKeys,
  ) as readonly VersionDomainCapabilityKey[];
}

function uniquePublicIds(
  ...groups: readonly (readonly (string | undefined)[] | undefined)[]
): readonly string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const value of group ?? []) {
      if (typeof value !== 'string' || value === '' || seen.has(value)) continue;
      seen.add(value);
      ids.push(value);
    }
  }
  return ids;
}

function hasCommitService(services: Readonly<Record<string, unknown>>): boolean {
  for (const candidate of [
    services.writeService,
    services.commitService,
    services.versionWriteService,
    services.publicService,
    services.graphService,
    services,
  ]) {
    if (isRawGraphStore(candidate)) continue;
    if (hasMethod(candidate, 'commit') || hasMethod(candidate, 'commitVersion')) return true;
  }
  return false;
}

function hasCheckoutService(services: Readonly<Record<string, unknown>>): boolean {
  for (const candidate of [
    services.checkoutService,
    services.checkoutMaterializationService,
    services.materializationService,
    services.versionCheckoutService,
    services.publicCheckoutService,
    services,
  ]) {
    if (hasMethod(candidate, 'planCheckout') || hasMethod(candidate, 'checkout')) return true;
  }
  return false;
}

function hasMergeService(services: Readonly<Record<string, unknown>>): boolean {
  for (const candidate of [
    services.mergeService,
    services.versionMergeService,
    services.publicService,
    services.readService,
    services.graphService,
    services.graphStore,
    services.graph,
    services,
  ]) {
    if (
      hasMethod(candidate, 'merge') ||
      hasMethod(candidate, 'mergeVersions') ||
      hasMethod(candidate, 'mergeCommits')
    ) {
      return true;
    }
  }
  return false;
}

function hasApplyMergeService(services: Readonly<Record<string, unknown>>): boolean {
  for (const candidate of [
    services.applyMergeService,
    services.versionApplyMergeService,
    services.writeService,
    services.versionWriteService,
    services.commitService,
    services.publicService,
    services,
  ]) {
    if (
      hasMethod(candidate, 'mergeCommit') ||
      hasMethod(candidate, 'applyMerge') ||
      hasMethod(candidate, 'applyMergeVersion') ||
      hasMethod(candidate, 'applyMergeCommit') ||
      hasMethod(candidate, 'fastForwardMerge') ||
      hasMethod(candidate, 'fastForward') ||
      hasMethod(candidate, 'fastForwardApplyMerge') ||
      hasMethod(candidate, 'applyMergeFastForward') ||
      hasMethod(candidate, 'applyFastForwardMerge')
    ) {
      return true;
    }
  }
  return false;
}

function gateFromRecord(value: unknown): AttachedDomainSupportManifestGate | null {
  if (!isRecord(value)) return null;

  const hasManifestSource = Object.prototype.hasOwnProperty.call(value, 'domainSupportManifest');
  const readManifest =
    bindManifestReader(value, 'readDomainSupportManifest') ??
    bindManifestReader(value, 'getDomainSupportManifest');
  const required = value.requireDomainSupportManifest === true;

  if (!hasManifestSource && !readManifest && !required) return null;

  return {
    hasManifestSource,
    manifest: value.domainSupportManifest,
    ...(readManifest ? { readManifest } : {}),
    ...(isRecord(value.domainSupportManifestOptions)
      ? { options: value.domainSupportManifestOptions as DomainSupportManifestValidationOptions }
      : {}),
  };
}

function bindManifestReader(
  value: Readonly<Record<string, unknown>>,
  name: string,
): (() => MaybePromise<unknown>) | null {
  const method = bindMethod(value, name);
  return method ? () => method() : null;
}

function hasMethod(value: unknown, name: string): boolean {
  return isRecord(value) && typeof value[name] === 'function';
}

function bindMethod(
  value: unknown,
  name: string,
): ((...args: readonly unknown[]) => MaybePromise<unknown>) | null {
  if (!isRecord(value)) return null;
  const method = value[name];
  if (typeof method !== 'function') return null;
  return (...args) => Reflect.apply(method, value, args) as MaybePromise<unknown>;
}

function isRawGraphStore(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.commit === 'function' &&
    typeof value.initializeGraph === 'function' &&
    typeof value.readCommitClosure === 'function'
  );
}

function domainSupportManifestMissingDiagnostics(
  operation: VersionDomainSupportManifestGateOperation,
  callerRequiredCapabilityKeys?: readonly VersionDomainCapabilityKey[],
): readonly VersionStoreDiagnostic[] {
  return requiredManifestCapabilityKeys(operation, callerRequiredCapabilityKeys).map(
    (capabilityKey) => domainSupportManifestMissingDiagnostic(operation, capabilityKey),
  );
}

function domainSupportManifestMissingDiagnostic(
  operation: VersionDomainSupportManifestGateOperation,
  capabilityKey: VersionDomainCapabilityKey,
): VersionStoreDiagnostic {
  return publicDiagnostic(
    operation,
    'VERSION_DOMAIN_SUPPORT_MANIFEST_MISSING',
    'A required document domain support manifest is not attached for this durable version operation.',
    { capabilityKey },
  );
}

function domainSupportManifestReadFailedDiagnostics(
  operation: VersionDomainSupportManifestGateOperation,
  callerRequiredCapabilityKeys?: readonly VersionDomainCapabilityKey[],
): readonly VersionStoreDiagnostic[] {
  return requiredManifestCapabilityKeys(operation, callerRequiredCapabilityKeys).map(
    (capabilityKey) => domainSupportManifestReadFailedDiagnostic(operation, capabilityKey),
  );
}

function domainSupportManifestReadFailedDiagnostic(
  operation: VersionDomainSupportManifestGateOperation,
  capabilityKey: VersionDomainCapabilityKey,
): VersionStoreDiagnostic {
  return publicDiagnostic(
    operation,
    'VERSION_DOMAIN_SUPPORT_MANIFEST_READ_FAILED',
    'The document domain support manifest could not be read before the durable version operation.',
    { capabilityKey },
    'retry',
  );
}

function domainSupportDetectorReadFailedDiagnostic(
  operation: VersionDomainSupportManifestGateOperation,
  detector: Pick<WorkbookMutableDomainDetector, 'matrixRowId' | 'domainId' | 'detectorId'>,
): VersionStoreDiagnostic {
  return publicDiagnostic(
    operation,
    'VERSION_DOMAIN_SUPPORT_DETECTOR_READ_FAILED',
    'Workbook mutable domain detection failed before the durable version operation.',
    {
      detectorId: detector.detectorId,
      matrixRowId: detector.matrixRowId,
      domainId: detector.domainId,
    },
    'retry',
  );
}

function domainSupportDetectorUnavailableDiagnostic(
  operation: VersionDomainSupportManifestGateOperation,
  detector: Pick<WorkbookMutableDomainDetector, 'matrixRowId' | 'domainId' | 'detectorId'>,
): VersionStoreDiagnostic {
  return publicDiagnostic(
    operation,
    'VERSION_DOMAIN_SUPPORT_DETECTOR_UNAVAILABLE',
    'Workbook mutable domain detection is unavailable before the durable version operation.',
    {
      detectorId: detector.detectorId,
      matrixRowId: detector.matrixRowId,
      domainId: detector.domainId,
    },
  );
}

function domainSupportManifestInvalidDiagnostic(
  operation: VersionDomainSupportManifestGateOperation,
  diagnostic: DomainSupportManifestDiagnostic,
): VersionStoreDiagnostic {
  const payload: Record<string, string | number | boolean | null> = {
    diagnosticCode: diagnostic.code,
  };
  appendPublicSafePayloadValue(payload, 'matrixRowId', diagnostic.matrixRowId);
  appendPublicSafePayloadValue(payload, 'domainId', diagnostic.domainId);
  appendPublicSafePayloadValue(payload, 'capabilityKey', diagnostic.capabilityKey);
  appendPublicSafePayloadValue(payload, 'capabilityState', diagnostic.capabilityState);
  appendPublicSafePayloadValue(payload, 'policyField', diagnostic.policyField);
  appendPublicSafePayloadValue(payload, 'policyValue', diagnostic.policyValue);

  return publicDiagnostic(
    operation,
    'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
    'The document domain support manifest is invalid for durable version operations.',
    payload,
  );
}

function appendPublicSafePayloadValue(
  payload: Record<string, string | number | boolean | null>,
  key: string,
  value: string | undefined,
): void {
  const safeValue = publicSafeDiagnosticValue(value);
  if (safeValue) payload[key] = safeValue;
}

function publicSafeDiagnosticValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value === EVAL_ONLY_EXPECTED_FAILING_STATE) return undefined;
  if (value.length > MAX_PUBLIC_DIAGNOSTIC_VALUE_LENGTH) return undefined;
  if (!PUBLIC_DIAGNOSTIC_VALUE_RE.test(value)) return undefined;
  return value;
}

function publicDiagnostic(
  operation: VersionDomainSupportManifestGateOperation,
  issueCode: string,
  safeMessage: string,
  payload: VersionDiagnosticPublicPayload = {},
  recoverability: VersionStoreDiagnostic['recoverability'] = 'none',
): VersionStoreDiagnostic {
  return {
    issueCode,
    severity: 'error',
    recoverability,
    messageTemplateId: `version.${operation}.${issueCode}`,
    safeMessage,
    payload: {
      operation,
      ...payload,
    },
    redacted: true,
    mutationGuarantee: 'no-write-attempted',
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
