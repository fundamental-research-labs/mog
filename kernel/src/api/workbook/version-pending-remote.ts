import type {
  VersionPromotePendingRemoteOptions,
  VersionPromotePendingRemoteResult,
  VersionResult,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import { publicDiagnostic } from './version-pending-remote-diagnostics';
import { validatePendingRemotePromotionApiGate } from './version-pending-remote-gate';
import { validatePendingRemotePromotionOptions } from './version-pending-remote-options';
import { mapPromotionResult } from './version-pending-remote-results';
import { getAttachedPendingRemotePromotionService } from './version-pending-remote-service';
import { versionFailureFromStoreDiagnostics } from './version-result';

export { hasAttachedPendingRemotePromotionService } from './version-pending-remote-service';

export async function promotePendingRemoteWorkbookVersion(
  ctx: DocumentContext,
  options: VersionPromotePendingRemoteOptions = {},
): Promise<VersionResult<VersionPromotePendingRemoteResult>> {
  const optionDiagnostics = validatePendingRemotePromotionOptions(options);
  if (optionDiagnostics.length > 0) {
    return versionFailureFromStoreDiagnostics('promotePendingRemote', optionDiagnostics);
  }

  const gateDiagnostics = validatePendingRemotePromotionApiGate(ctx);
  if (gateDiagnostics.length > 0) {
    return versionFailureFromStoreDiagnostics('promotePendingRemote', gateDiagnostics);
  }

  const service = getAttachedPendingRemotePromotionService(ctx);
  if (!service) {
    return versionFailureFromStoreDiagnostics('promotePendingRemote', [
      publicDiagnostic(
        'VERSION_PENDING_REMOTE_PROMOTION_SERVICE_UNAVAILABLE',
        'No document-scoped pending remote promotion service is attached.',
        'warning',
        'unsupported',
      ),
    ]);
  }

  try {
    return mapPromotionResult(await service.promotePendingRemoteSegments(), options);
  } catch {
    return versionFailureFromStoreDiagnostics('promotePendingRemote', [
      publicDiagnostic(
        'VERSION_PENDING_REMOTE_PROMOTION_PROVIDER_ERROR',
        'The pending remote promotion service failed before returning a result.',
        'error',
        'retry',
      ),
    ]);
  }
}
