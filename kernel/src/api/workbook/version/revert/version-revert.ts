import type {
  VersionRevertInput,
  VersionRevertOptions,
  VersionRevertResult,
  VersionResult,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../context';
import {
  readVersionCheckoutAdmissionBlock,
  type VersionCheckoutAdmissionBlock,
} from '../checkout/version-checkout-admission';
import { validateVersionOperationGate } from '../../version-operation-gate';
import {
  revertAdmissionDiagnostic,
  revertDisabledDiagnostics,
  revertPreflightDiagnostics,
} from './version-revert-diagnostics';
import {
  prepareRevertTargetRefPreconditions,
  validateRevertTargetRefCas,
} from './version-revert-planning';
import {
  getAttachedVersionRevertService,
  mapRevertProviderResult,
  providerErrorDiagnostic,
} from './version-revert-provider';
import { versionFailureFromRevertDiagnostics } from './version-revert-results';
import { validateRevertRequest } from './version-revert-validation';

export {
  VERSION_REVERT_CAS_UNAVAILABLE_DIAGNOSTIC_CODE,
  VERSION_REVERT_HISTORY_GAP_DIAGNOSTIC_CODE,
  VERSION_REVERT_OPAQUE_DOMAIN_DIAGNOSTIC_CODE,
  VERSION_REVERT_PENDING_PROVIDER_WRITES_DIAGNOSTIC_CODE,
  VERSION_REVERT_REVIEW_INVALIDATION_DIAGNOSTIC_CODE,
  VERSION_REVERT_STALE_HEAD_DIAGNOSTIC_CODE,
  VERSION_REVERT_TARGET_REJECTED_DIAGNOSTIC_CODE,
  VERSION_REVERT_UNAVAILABLE_DIAGNOSTIC_CODE,
  VERSION_REVERT_UNSUPPORTED_DOMAIN_DIAGNOSTIC_CODE,
  VERSION_REVERT_WRITE_FENCE_UNAVAILABLE_DIAGNOSTIC_CODE,
} from './version-revert-diagnostics';
export {
  VERSION_REVERT_INVALID_PROVIDER_PAYLOAD_DIAGNOSTIC_CODE,
  VERSION_REVERT_PROVIDER_ERROR_DIAGNOSTIC_CODE,
} from './version-revert-provider';

export async function revertWorkbookVersion(
  ctx: DocumentContext,
  input: VersionRevertInput,
  options: VersionRevertOptions = {},
): Promise<VersionResult<VersionRevertResult>> {
  const validated = validateRevertRequest(input, options);
  if (!validated.ok) return versionFailureFromRevertDiagnostics(validated.diagnostics);

  const gateDiagnostics = validateVersionOperationGate(ctx, 'revert', 'version:revert', {
    mutates: true,
  });
  if (gateDiagnostics.length > 0) {
    return versionFailureFromRevertDiagnostics(gateDiagnostics);
  }

  const service = getAttachedVersionRevertService(ctx);
  if (!service) {
    return versionFailureFromRevertDiagnostics(
      revertDisabledDiagnostics(validated.input, validated.options),
    );
  }

  const preflightDiagnostics = revertPreflightDiagnostics(validated.input);
  if (preflightDiagnostics.length > 0) {
    return versionFailureFromRevertDiagnostics(preflightDiagnostics);
  }

  const admissionBlock = await readVersionCheckoutAdmissionBlock(ctx);
  if (admissionBlock && !canBypassRevertAdmissionBlock(validated.input, admissionBlock)) {
    return versionFailureFromRevertDiagnostics([
      revertAdmissionDiagnostic(admissionBlock, validated.input),
    ]);
  }

  const preconditioned = await prepareRevertTargetRefPreconditions(
    ctx,
    validated.input,
    validated.options,
  );
  if (!preconditioned.ok) {
    return versionFailureFromRevertDiagnostics(preconditioned.diagnostics);
  }

  if (validated.options.dryRun !== true) {
    const cas = await validateRevertTargetRefCas(ctx, preconditioned.input);
    if (!cas.ok) return versionFailureFromRevertDiagnostics(cas.diagnostics);
  }

  try {
    const result = mapRevertProviderResult(
      await service.revert(preconditioned.input, validated.options),
      preconditioned.input,
      validated.options,
    );
    return result.ok
      ? { ok: true, value: result.value }
      : versionFailureFromRevertDiagnostics(result.diagnostics);
  } catch {
    return versionFailureFromRevertDiagnostics([providerErrorDiagnostic()]);
  }
}

function canBypassRevertAdmissionBlock(
  input: VersionRevertInput,
  block: VersionCheckoutAdmissionBlock,
): boolean {
  return input.targetRef !== undefined && block.reason === 'staleWorkspaceHead';
}
