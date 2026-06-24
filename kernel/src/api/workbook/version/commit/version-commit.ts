import type {
  VersionCommitOptions,
  VersionResult,
  WorkbookCommitSummary,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../context';
import { validateVersionDomainSupportManifestGate } from '../domain-support/version-domain-support-gate';
import { validateVersionOperationGate } from '../../version-operation-gate';
import { serviceUnavailableDiagnostic } from './version-commit-diagnostics';
import {
  getAttachedVersionWriteService,
  normalCommitCaptureAdmissionDiagnostics,
} from './version-commit-service';
import { validateCommitOptions } from './version-commit-options';
import { diagnosticsFromThrownError, mapCommitWriteResult } from './version-commit-results';
import { versionFailureFromStoreDiagnostics } from '../../version-result';

export { hasAttachedVersionWriteService } from './version-commit-service';

export async function commitWorkbookVersion(
  ctx: DocumentContext,
  options: VersionCommitOptions = {},
): Promise<VersionResult<WorkbookCommitSummary>> {
  const validated = validateCommitOptions(options);
  if (!validated.ok) {
    return versionFailureFromStoreDiagnostics('commit', validated.diagnostics);
  }

  const operationGateDiagnostics = validateVersionOperationGate(ctx, 'commit', 'version:commit', {
    mutates: true,
  });
  if (operationGateDiagnostics.length > 0) {
    return versionFailureFromStoreDiagnostics('commit', operationGateDiagnostics);
  }

  const gateDiagnostics = await validateVersionDomainSupportManifestGate(ctx, 'commit');
  if (gateDiagnostics.length > 0) {
    return versionFailureFromStoreDiagnostics('commit', gateDiagnostics);
  }

  const writeService = getAttachedVersionWriteService(ctx);
  if (!writeService?.commit) {
    return versionFailureFromStoreDiagnostics('commit', [serviceUnavailableDiagnostic()]);
  }

  const admissionDiagnostics = await normalCommitCaptureAdmissionDiagnostics(ctx);
  if (admissionDiagnostics.length > 0) {
    return versionFailureFromStoreDiagnostics('commit', admissionDiagnostics);
  }

  let result: unknown;
  try {
    result = await writeService.commit(validated.options);
  } catch (error) {
    return versionFailureFromStoreDiagnostics('commit', diagnosticsFromThrownError(error));
  }

  return mapCommitWriteResult(result);
}
