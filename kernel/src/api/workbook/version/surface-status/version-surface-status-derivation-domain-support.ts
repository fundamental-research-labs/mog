import type { VersionDiagnostic, VersionStoreDiagnostic } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../context';
import { validateVersionDomainSupportManifestGate } from '../domain-support/version-domain-support-gate';
import { sanitizePublicDiagnosticPayload } from './version-surface-status-derivation-diagnostics';
import type {
  VersionDomainSupportOperation,
  VersionSurfaceCapabilityAvailability,
  VersionSurfaceCapabilityBlock,
  VersionSurfaceCapabilityBlocks,
} from './version-surface-status-derivation-types';
import type { SurfaceVersionCapability } from './version-surface-status-service';

export async function deriveDomainSupportCapabilityBlocks(
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
    {
      capability: 'version:mergePreview',
      operation: 'merge',
      available: availability.mergePreview,
    },
    {
      capability: 'version:mergeApply',
      operation: 'applyMerge',
      available: availability.mergeApply,
    },
    { capability: 'version:revert', operation: 'revert', available: availability.revert },
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
      ...(diagnostic.mutationGuarantee ? { mutationGuarantee: diagnostic.mutationGuarantee } : {}),
      ...(diagnostic.payload
        ? { payload: sanitizePublicDiagnosticPayload(diagnostic.payload) }
        : {}),
    },
  };
}
