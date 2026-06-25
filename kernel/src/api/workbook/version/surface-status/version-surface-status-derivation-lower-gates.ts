import type { DocumentContext } from '../../../../context';
import { sanitizePublicDiagnosticPayload } from './version-surface-status-derivation-diagnostics';
import type {
  LowerGateIssue,
  MaybeVersionRuntimeContext,
  VersionSurfaceCapabilityAvailability,
  VersionSurfaceCapabilityBlock,
  VersionSurfaceCapabilityBlocks,
} from './version-surface-status-derivation-types';
import {
  arrayValue,
  isRecord,
  nested,
  stringValue,
} from './version-surface-status-derivation-utils';
import type { SurfaceVersionCapability } from './version-surface-status-service';

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
  'version:revert',
  'version:provenance',
  'version:remotePromote',
] as const satisfies readonly SurfaceVersionCapability[];

export function deriveLowerGateCapabilityBlocks(
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
    const currentForTarget =
      typeof result.currentForTarget === 'boolean' ? result.currentForTarget : true;
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

function lowerGateIssue(message: string, data: Readonly<Record<string, unknown>>): LowerGateIssue {
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
    reason: 'Promoted version surfaces require current, clean, passing lower-gate evidence.',
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
    case 'version:revert':
      return availability.revert;
    case 'version:provenance':
      return availability.provenance;
    case 'version:remotePromote':
      return availability.remotePromote;
    default:
      return false;
  }
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
