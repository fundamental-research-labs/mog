import type { VersionCapability, VersionStoreDiagnostic } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../context';
import { getVersionHostCapabilityDecisions } from '../merge/version-merge-capability';
import { REQUIRED_PROMOTION_CAPABILITIES } from './remote-constants';
import { noWriteDiagnostic } from './remote-diagnostics';
import type { MaybeVersionRuntimeContext } from './remote-types';
import { isRecord } from './remote-utils';
import { validateVersionOperationGate } from '../../version-operation-gate';

export function validatePendingRemotePromotionApiGate(
  ctx: DocumentContext,
): readonly VersionStoreDiagnostic[] {
  const operationGateDiagnostics = validateVersionOperationGate(
    ctx,
    'promotePendingRemote',
    'version:remotePromote',
    { mutates: true },
  );
  if (operationGateDiagnostics.length > 0) return operationGateDiagnostics;

  const hostDecisions = getVersionHostCapabilityDecisions(ctx);
  const diagnostics: VersionStoreDiagnostic[] = [];
  for (const capability of REQUIRED_PROMOTION_CAPABILITIES) {
    if (hostDecisions[capability] !== 'allowed') {
      diagnostics.push(requiredCapabilityDiagnostic(capability));
    }
  }
  if (!hasCompleteVc09ProvenanceTruth(ctx)) {
    diagnostics.push(
      noWriteDiagnostic(
        'VERSION_PENDING_REMOTE_PROMOTION_PROVENANCE_UNAVAILABLE',
        'Pending remote promotion requires complete VC-09 provenance truth.',
        'none',
        {
          operation: 'promotePendingRemote',
          capability: 'version:remotePromote',
          requiredCapability: 'version:provenance',
          reason: 'provenanceUnavailable',
        },
      ),
    );
  }
  return diagnostics;
}

function hasCompleteVc09ProvenanceTruth(ctx: DocumentContext): boolean {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  if (!isRecord(services)) return false;
  return [
    services.provenanceAdmissionService,
    services.provenanceTruthService,
    services.provenanceStatusService,
    services,
  ].some(hasExplicitCompleteVc09ProvenanceTruth);
}

function hasExplicitCompleteVc09ProvenanceTruth(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    value.vc09ProvenanceTruthComplete === true ||
    value.completeVc09ProvenanceAdmission === true ||
    hasExplicitCompleteVc09ProvenanceTruth(value.vc09ProvenanceTruth) ||
    hasExplicitCompleteVc09ProvenanceTruth(value.provenanceAdmissionTruth)
  );
}

function requiredCapabilityDiagnostic(capability: VersionCapability): VersionStoreDiagnostic {
  return noWriteDiagnostic(
    'VERSION_CAPABILITY_DISABLED',
    `Pending remote promotion requires host policy to explicitly allow ${capability}.`,
    'none',
    {
      operation: 'promotePendingRemote',
      capability: 'version:remotePromote',
      requiredCapability: capability,
      reason: 'hostCapabilityExplicitGrantRequired',
    },
  );
}
