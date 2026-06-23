import type {
  VersionCapabilityDependency,
  VersionDiagnostic,
  VersionDiagnosticPublicPayload,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import { validateVersionDomainSupportManifestGate } from './version-domain-support-gate';
import type { SurfaceVersionCapability } from './version-surface-status-service';

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly featureGates?: unknown;
  readonly hostFeatureGates?: unknown;
  readonly gates?: unknown;
  readonly lowerGateEvidence?: unknown;
  readonly rolloutEvidence?: unknown;
  readonly surfaceStatusEvidence?: unknown;
  readonly surfaceStatusLowerGateEvidence?: unknown;
};

type CapabilityArea = 'reads' | 'writes';
type VersionDomainSupportOperation = 'commit' | 'checkout' | 'merge' | 'applyMerge';
type LowerGateIssue = {
  readonly diagnostic: VersionDiagnostic;
};

const LOWER_ROLLOUT_STAGES = new Set(['disabled', 'shadow-only', 'headless-local', 'ui-beta']);
const HIGHER_SURFACE_CAPABILITIES = [
  'version:commit',
  'version:branch',
  'version:checkout',
  'version:reviewWrite',
  'version:proposal',
  'version:mergePreview',
  'version:mergeApply',
  'version:refAdmin',
  'version:provenance',
  'version:remotePromote',
] as const satisfies readonly SurfaceVersionCapability[];
const PUBLIC_DIAGNOSTIC_VALUE_RE = /^[A-Za-z0-9]+(?:[._:-][A-Za-z0-9]+)*$/;
const MAX_PUBLIC_DIAGNOSTIC_VALUE_LENGTH = 160;

export type VersionSurfaceCapabilityAvailability = {
  readonly read: boolean;
  readonly diff: boolean;
  readonly commit: boolean;
  readonly branch: boolean;
  readonly checkout: boolean;
  readonly reviewRead: boolean;
  readonly reviewWrite: boolean;
  readonly proposal: boolean;
  readonly mergePreview: boolean;
  readonly mergeApply: boolean;
  readonly refAdmin: boolean;
  readonly provenance: boolean;
  readonly remotePromote: boolean;
};

export type VersionSurfaceCapabilityBlock = {
  readonly dependency: VersionCapabilityDependency;
  readonly reason: string;
  readonly retryable: boolean;
  readonly code: VersionDiagnostic['code'];
  readonly diagnostics?: readonly VersionDiagnostic[];
};

export type VersionSurfaceCapabilityBlocks = Partial<
  Record<SurfaceVersionCapability, VersionSurfaceCapabilityBlock>
>;

export type VersionSurfaceOperationFeatureGates = {
  readonly checkoutEnabled: boolean;
  readonly checkoutDiscovered: boolean;
  readonly revertEnabled: boolean;
  readonly revertDiscovered: boolean;
};

export async function deriveVersionSurfaceCapabilityBlocks(input: {
  readonly ctx: DocumentContext;
  readonly services: unknown;
  readonly availability: VersionSurfaceCapabilityAvailability;
}): Promise<VersionSurfaceCapabilityBlocks> {
  const blocks: VersionSurfaceCapabilityBlocks = {
    ...deriveProviderCapabilityBlocks(input.services, input.availability),
  };
  const domainBlocks = await deriveDomainSupportCapabilityBlocks(input.ctx, input.availability);
  return {
    ...blocks,
    ...domainBlocks,
    ...deriveLowerGateCapabilityBlocks(input.ctx, input.services, input.availability),
  };
}

export function getVersionSurfaceOperationFeatureGates(
  ctx: DocumentContext,
): VersionSurfaceOperationFeatureGates {
  const runtime = ctx as MaybeVersionRuntimeContext;
  let checkout: boolean | undefined;
  let revert: boolean | undefined;
  for (const candidate of [runtime.featureGates, runtime.hostFeatureGates, runtime.gates]) {
    checkout ??= readOperationFeatureGate(candidate, 'checkout');
    revert ??= readOperationFeatureGate(candidate, 'revert');
  }
  return {
    checkoutEnabled: checkout ?? true,
    checkoutDiscovered: checkout !== undefined,
    revertEnabled: revert ?? true,
    revertDiscovered: revert !== undefined,
  };
}

function deriveProviderCapabilityBlocks(
  services: unknown,
  availability: VersionSurfaceCapabilityAvailability,
): VersionSurfaceCapabilityBlocks {
  const provider = readProviderCapabilities(services);
  if (!provider) return {};

  const blocks: VersionSurfaceCapabilityBlocks = {};
  const readGraph = providerCapability(provider, 'reads', 'graphRegistry');
  const readObjects = providerCapability(provider, 'reads', 'objects');
  const readRefs = providerCapability(provider, 'reads', 'refs');
  const readCommits = providerCapability(provider, 'reads', 'commits');
  const writeCommits =
    !provider.readOnlyHistory &&
    providerCapability(provider, 'writes', 'commitGraphWrite') &&
    providerCapability(provider, 'writes', 'putObjects');
  const writeRefs = !provider.readOnlyHistory && providerCapability(provider, 'writes', 'updateRefs');

  if (availability.diff && (!readGraph || !readCommits || !readObjects)) {
    blocks['version:diff'] = providerBlock(
      'version.surfaceStatus.diffUnavailable',
      'Semantic diff requires provider graph, commit, and object reads.',
      true,
    );
  }
  if (availability.commit && (!readGraph || !writeCommits)) {
    blocks['version:commit'] = providerBlock(
      'version.surfaceStatus.commitUnavailable',
      readGraph
        ? 'The attached version storage provider is read-only for commit writes.'
        : 'Version commits require provider graph reads.',
      !readGraph,
    );
  }
  if (availability.branch && (!readGraph || !readRefs || !writeRefs)) {
    blocks['version:branch'] = providerBlock(
      'version.surfaceStatus.branchUnavailable',
      writeRefs
        ? 'Version branch lifecycle requires provider graph and ref reads.'
        : 'The attached version storage provider is read-only for ref writes.',
      !readGraph || !readRefs,
    );
  }
  if (availability.checkout && (!readGraph || !readCommits)) {
    blocks['version:checkout'] = providerBlock(
      'version.surfaceStatus.checkoutUnavailable',
      'Version checkout requires provider graph and commit reads.',
      true,
    );
  }
  if (availability.mergePreview && (!readGraph || !readCommits || !readObjects)) {
    blocks['version:mergePreview'] = providerBlock(
      'version.surfaceStatus.mergePreviewUnavailable',
      'Version merge preview requires provider graph, commit, and object reads.',
      true,
    );
  }
  if (availability.mergeApply && (!readGraph || !writeCommits)) {
    blocks['version:mergeApply'] = providerBlock(
      'version.surfaceStatus.mergeApplyUnavailable',
      readGraph
        ? 'The attached version storage provider is read-only for merge-apply writes.'
        : 'Version merge apply requires provider graph reads.',
      !readGraph,
    );
  }
  if (availability.refAdmin && (!readGraph || !readRefs || !writeRefs)) {
    blocks['version:refAdmin'] = providerBlock(
      'version.surfaceStatus.refAdminUnavailable',
      writeRefs
        ? 'Version ref admin requires provider graph and ref reads.'
        : 'The attached version storage provider is read-only for ref-admin writes.',
      !readGraph || !readRefs,
    );
  }
  if (availability.remotePromote && (!readGraph || !writeCommits)) {
    blocks['version:remotePromote'] = providerBlock(
      'version.surfaceStatus.remotePromoteUnavailable',
      readGraph
        ? 'The attached version storage provider is read-only for pending remote promotion.'
        : 'Pending remote promotion requires provider graph reads.',
      !readGraph,
    );
  }
  return blocks;
}

async function deriveDomainSupportCapabilityBlocks(
  ctx: DocumentContext,
  availability: VersionSurfaceCapabilityAvailability,
): Promise<VersionSurfaceCapabilityBlocks> {
  const entries: readonly {
    readonly capability: SurfaceVersionCapability;
    readonly operation: VersionDomainSupportOperation;
    readonly available: boolean;
  }[] = [
    { capability: 'version:commit', operation: 'commit', available: availability.commit },
    { capability: 'version:checkout', operation: 'checkout', available: availability.checkout },
    { capability: 'version:mergePreview', operation: 'merge', available: availability.mergePreview },
    { capability: 'version:mergeApply', operation: 'applyMerge', available: availability.mergeApply },
  ];
  const blocks: VersionSurfaceCapabilityBlocks = {};
  await Promise.all(
    entries
      .filter((entry) => entry.available)
      .map(async (entry) => {
        const diagnostics = await validateVersionDomainSupportManifestGate(ctx, entry.operation);
        if (diagnostics.length === 0) return;
        blocks[entry.capability] = domainSupportBlock(entry.operation, diagnostics);
      }),
  );
  return blocks;
}

function deriveLowerGateCapabilityBlocks(
  ctx: DocumentContext,
  services: unknown,
  availability: VersionSurfaceCapabilityAvailability,
): VersionSurfaceCapabilityBlocks {
  const issues = readLowerGateIssues(ctx, services);
  if (issues.length === 0) return {};

  const block = lowerGateBlock(issues);
  const blocks: VersionSurfaceCapabilityBlocks = {};
  for (const capability of HIGHER_SURFACE_CAPABILITIES) {
    if (availabilityForCapability(availability, capability)) blocks[capability] = block;
  }
  return blocks;
}

function readLowerGateIssues(ctx: DocumentContext, services: unknown): readonly LowerGateIssue[] {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const candidates = [
    nested(services, 'surfaceStatusLowerGateEvidence'),
    nested(services, 'lowerGateEvidence'),
    nested(services, 'rolloutEvidence'),
    nested(services, 'surfaceStatusEvidence'),
    nested(services, 'defaultOnEvidence'),
    runtime.surfaceStatusLowerGateEvidence,
    runtime.lowerGateEvidence,
    runtime.rolloutEvidence,
    runtime.surfaceStatusEvidence,
  ];
  return candidates.flatMap((candidate) => lowerGateIssuesFromEvidence(candidate));
}

function lowerGateIssuesFromEvidence(evidence: unknown): readonly LowerGateIssue[] {
  if (!isRecord(evidence) || !looksLikeLowerGateEvidence(evidence)) return [];
  const issues: LowerGateIssue[] = [];
  appendStageIssue(issues, evidence, ['rolloutStage', 'readbackStage', 'targetStage']);
  appendStatusIssue(issues, evidence, ['promotionStatus', 'status']);
  appendSourceRepoIssues(issues, arrayValue(evidence.sourceRepos));
  appendSourceRepoIssues(issues, arrayValue(nested(evidence, 'target')?.sourceRepos));

  const rolloutGate = isRecord(evidence.rolloutGate) ? evidence.rolloutGate : null;
  if (rolloutGate) {
    appendStageIssue(issues, rolloutGate, ['rolloutStage', 'readbackStage', 'targetStage']);
    appendStatusIssue(issues, rolloutGate, ['status']);
  }
  const capabilityGateCas = isRecord(evidence.capabilityGateCas)
    ? evidence.capabilityGateCas
    : null;
  if (capabilityGateCas) {
    appendStageIssue(issues, capabilityGateCas, ['readbackStage', 'rolloutStage', 'targetStage']);
    appendStatusIssue(issues, capabilityGateCas, ['status']);
  }

  const lowerGateResults = arrayValue(evidence.lowerGateResults);
  if (lowerGateResults) appendLowerGateResultIssues(issues, lowerGateResults);
  appendMissingLowerGateIssues(issues, lowerGateResults, arrayValue(evidence.requiredLowerGates));
  appendMissingLowerGateIssues(
    issues,
    lowerGateResults,
    arrayValue(nested(evidence, 'thresholds')?.requiredLowerGates),
  );
  return issues;
}

function appendStageIssue(
  issues: LowerGateIssue[],
  source: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): void {
  for (const key of keys) {
    const stage = stringValue(source[key]);
    if (!stage || !LOWER_ROLLOUT_STAGES.has(stage)) continue;
    issues.push(
      lowerGateIssue(
        'Version surface status cannot claim promoted capabilities while attached lower-gate evidence is below default-on.',
        { evidenceKind: key, rolloutStage: stage },
      ),
    );
  }
}

function appendStatusIssue(
  issues: LowerGateIssue[],
  source: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): void {
  for (const key of keys) {
    const status = stringValue(source[key]);
    if (!status || status === 'pass') continue;
    issues.push(
      lowerGateIssue(
        'Version surface status cannot claim promoted capabilities while lower-gate evidence is not passing.',
        { evidenceKind: key, status },
      ),
    );
  }
}

function appendLowerGateResultIssues(
  issues: LowerGateIssue[],
  lowerGateResults: readonly unknown[],
): void {
  for (const result of lowerGateResults) {
    if (!isRecord(result)) continue;
    const status = stringValue(result.status);
    const currentForTarget = typeof result.currentForTarget === 'boolean'
      ? result.currentForTarget
      : true;
    if (status === 'pass' && currentForTarget) continue;
    issues.push(
      lowerGateIssue(
        'Version surface status cannot claim promoted capabilities while a lower gate is blocked, stale, or missing current target evidence.',
        {
          gateId: stringValue(result.gateId),
          status,
          currentForTarget,
        },
      ),
    );
  }
}

function appendMissingLowerGateIssues(
  issues: LowerGateIssue[],
  lowerGateResults: readonly unknown[] | null,
  requiredLowerGates: readonly unknown[] | null,
): void {
  if (!requiredLowerGates) return;
  const observed = new Set(
    (lowerGateResults ?? [])
      .map((entry) => (isRecord(entry) ? stringValue(entry.gateId) : undefined))
      .filter((gateId): gateId is string => Boolean(gateId)),
  );
  for (const gateId of requiredLowerGates) {
    const normalized = stringValue(gateId);
    if (!normalized || observed.has(normalized)) continue;
    issues.push(
      lowerGateIssue(
        'Version surface status cannot claim promoted capabilities while required lower-gate evidence is missing.',
        { gateId: normalized, status: 'missing' },
      ),
    );
  }
}

function appendSourceRepoIssues(
  issues: LowerGateIssue[],
  sourceRepos: readonly unknown[] | null,
): void {
  for (const repo of sourceRepos ?? []) {
    if (!isRecord(repo)) continue;
    const status = stringValue(repo.status);
    if (status !== 'dirtyBlocked') continue;
    issues.push(
      lowerGateIssue(
        'Version surface status cannot claim promoted capabilities while source evidence is dirty and blocked.',
        { repoId: stringValue(repo.repoId), status },
      ),
    );
  }
}

function lowerGateIssue(
  message: string,
  data: Readonly<Record<string, unknown>>,
): LowerGateIssue {
  return {
    diagnostic: {
      code: 'version.surfaceStatus.lowerGateEvidenceBlocked',
      severity: 'warning',
      message,
      dependency: 'VC-09',
      data: sanitizePublicDiagnosticPayload(data),
    },
  };
}

function lowerGateBlock(issues: readonly LowerGateIssue[]): VersionSurfaceCapabilityBlock {
  return {
    dependency: 'VC-09',
    reason:
      'Promoted version surfaces require current, clean, passing lower-gate evidence.',
    retryable: true,
    code: 'version.surfaceStatus.lowerGateEvidenceBlocked',
    diagnostics: issues.map((issue) => issue.diagnostic),
  };
}

function availabilityForCapability(
  availability: VersionSurfaceCapabilityAvailability,
  capability: SurfaceVersionCapability,
): boolean {
  switch (capability) {
    case 'version:commit':
      return availability.commit;
    case 'version:branch':
      return availability.branch;
    case 'version:checkout':
      return availability.checkout;
    case 'version:reviewWrite':
      return availability.reviewWrite;
    case 'version:proposal':
      return availability.proposal;
    case 'version:mergePreview':
      return availability.mergePreview;
    case 'version:mergeApply':
      return availability.mergeApply;
    case 'version:refAdmin':
      return availability.refAdmin;
    case 'version:provenance':
      return availability.provenance;
    case 'version:remotePromote':
      return availability.remotePromote;
    default:
      return false;
  }
}

function providerBlock(
  code: VersionDiagnostic['code'],
  reason: string,
  retryable: boolean,
): VersionSurfaceCapabilityBlock {
  return { dependency: 'storage', reason, retryable, code };
}

function domainSupportBlock(
  operation: VersionDomainSupportOperation,
  diagnostics: readonly VersionStoreDiagnostic[],
): VersionSurfaceCapabilityBlock {
  const issueCodes = new Set(diagnostics.map((diagnostic) => diagnostic.issueCode));
  const invalidDiagnosticCodes = new Set(
    diagnostics
      .map((diagnostic) => diagnostic.payload?.diagnosticCode)
      .filter((code): code is string => typeof code === 'string'),
  );
  const readFailed = issueCodes.has('VERSION_DOMAIN_SUPPORT_MANIFEST_READ_FAILED');
  const missing = issueCodes.has('VERSION_DOMAIN_SUPPORT_MANIFEST_MISSING');
  const stale = invalidDiagnosticCodes.has('manifest-stale');
  return {
    dependency: 'storage',
    reason: domainSupportBlockReason({ readFailed, missing, stale }),
    retryable: readFailed || missing || stale,
    code: readFailed
      ? 'version.surfaceStatus.domainSupportManifestReadFailed'
      : missing
        ? 'version.surfaceStatus.domainSupportManifestMissing'
        : 'version.surfaceStatus.domainSupportManifestInvalid',
    diagnostics: diagnostics.map((diagnostic) =>
      projectDomainSupportDiagnostic(operation, diagnostic),
    ),
  };
}

function domainSupportBlockReason(input: {
  readonly readFailed: boolean;
  readonly missing: boolean;
  readonly stale: boolean;
}): string {
  if (input.readFailed) {
    return 'The document domain support manifest could not be read for this version capability.';
  }
  if (input.missing) {
    return 'A required document domain support manifest is not attached for this version capability.';
  }
  if (input.stale) {
    return 'The attached document domain support manifest is stale for this version capability.';
  }
  return 'The attached document domain support manifest is invalid for this version capability.';
}

function projectDomainSupportDiagnostic(
  operation: VersionDomainSupportOperation,
  diagnostic: VersionStoreDiagnostic,
): VersionDiagnostic {
  return {
    code: 'version.surfaceStatus.domainSupportManifestDiagnostic',
    severity: diagnostic.severity === 'fatal' ? 'error' : diagnostic.severity,
    message: diagnostic.safeMessage,
    dependency: 'storage',
    data: {
      operation,
      issueCode: diagnostic.issueCode,
      recoverability: diagnostic.recoverability,
      redacted: diagnostic.redacted,
      ...(diagnostic.mutationGuarantee
        ? { mutationGuarantee: diagnostic.mutationGuarantee }
        : {}),
      ...(diagnostic.payload
        ? { payload: sanitizePublicDiagnosticPayload(diagnostic.payload) }
        : {}),
    },
  };
}

function readProviderCapabilities(services: unknown): Readonly<Record<string, unknown>> | null {
  if (!isRecord(services)) return null;
  const provider = [
    services.provider,
    services.storageProvider,
    services.objectStore,
    services.refStore,
    services.graphStore,
    services.graphService,
    services.graph,
    services.publicService,
    services,
  ].find((candidate) => isRecord(candidate) && isRecord(candidate.capabilities));
  return isRecord(provider) && isRecord(provider.capabilities) ? provider.capabilities : null;
}

function providerCapability(
  capabilities: Readonly<Record<string, unknown>>,
  area: CapabilityArea,
  key: string,
): boolean {
  const scoped = isRecord(capabilities[area]) ? capabilities[area] : null;
  return scoped?.[key] !== false;
}

function readOperationFeatureGate(value: unknown, operation: 'checkout' | 'revert'): boolean | undefined {
  if (!isRecord(value)) return undefined;
  const pascal = operation[0].toUpperCase() + operation.slice(1);
  const keys = [`versionControl${pascal}`, `versionControl.${operation}`];
  const capabilities = isRecord(value.capabilities) ? value.capabilities : null;
  const capabilityGate = readBoolean(capabilities, keys);
  if (capabilityGate !== undefined) return capabilityGate;
  const directGate = readBoolean(value, keys);
  if (directGate !== undefined) return directGate;
  const versionControl = isRecord(value.versionControl) ? value.versionControl : null;
  const nestedVersionGate = readBoolean(versionControl, [operation, `${operation}Enabled`]);
  if (nestedVersionGate !== undefined) return nestedVersionGate;
  const operationGate = isRecord(value[operation]) ? value[operation] : null;
  const nestedOperationGate = readBoolean(operationGate, ['enabled']);
  if (nestedOperationGate !== undefined) return nestedOperationGate;
  const disabled = readBoolean(value, [`versionControl${pascal}Disabled`]);
  return disabled === undefined ? undefined : !disabled;
}

function readBoolean(
  value: Readonly<Record<string, unknown>> | null,
  keys: readonly string[],
): boolean | undefined {
  if (!value) return undefined;
  for (const key of keys) {
    if (typeof value[key] === 'boolean') return value[key] as boolean;
  }
  return undefined;
}

function looksLikeLowerGateEvidence(value: Readonly<Record<string, unknown>>): boolean {
  return Boolean(
    value.lowerGateResults ||
      value.requiredLowerGates ||
      value.rolloutGate ||
      value.capabilityGateCas ||
      value.promotionStatus ||
      value.rolloutStage ||
      value.readbackStage ||
      value.sourceRepos ||
      isRecord(value.target),
  );
}

function nested(
  value: unknown,
  key: string,
): Readonly<Record<string, unknown>> | null {
  if (!isRecord(value)) return null;
  const child = value[key];
  return isRecord(child) ? child : null;
}

function arrayValue(value: unknown): readonly unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function sanitizePublicDiagnosticPayload(
  payload: Readonly<Record<string, unknown>>,
): VersionDiagnosticPublicPayload {
  const sanitized: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!isPublicDiagnosticValue(value)) continue;
    sanitized[key] = sanitizePublicDiagnosticValue(key, value);
  }
  return sanitized;
}

function isPublicDiagnosticValue(
  value: unknown,
): value is string | number | boolean | null {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function sanitizePublicDiagnosticValue(
  key: string,
  value: string | number | boolean | null,
): string | number | boolean | null {
  if (typeof value !== 'string') return value;
  const normalizedKey = key.toLowerCase();
  if (
    normalizedKey.includes('secret') ||
    normalizedKey.includes('credential') ||
    normalizedKey.includes('password') ||
    normalizedKey.includes('authorization') ||
    normalizedKey.includes('token') ||
    normalizedKey.includes('cursor') ||
    normalizedKey.includes('trace') ||
    normalizedKey.includes('opaque') ||
    normalizedKey.includes('hidden') ||
    normalizedKey.includes('deleted') ||
    normalizedKey.includes('protected')
  ) {
    return 'redacted';
  }
  const normalizedValue = value.toLowerCase();
  if (
    normalizedValue.includes('secret') ||
    normalizedValue.includes('credential') ||
    normalizedValue.includes('password') ||
    normalizedValue.includes('authorization') ||
    normalizedValue.includes('token') ||
    normalizedValue.includes('cursor') ||
    normalizedValue.includes('trace')
  ) {
    return 'redacted';
  }
  if (value.length > MAX_PUBLIC_DIAGNOSTIC_VALUE_LENGTH) return 'redacted';
  return PUBLIC_DIAGNOSTIC_VALUE_RE.test(value) ? value : 'redacted';
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
