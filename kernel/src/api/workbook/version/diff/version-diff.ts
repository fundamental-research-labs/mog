import type {
  VersionCommitish,
  VersionDiffOptions,
  WorkbookDiffPage,
} from '@mog-sdk/contracts/api';
import type { DocumentContext } from '../../../../context';
import {
  degradedDiffPage,
  providerErrorDiagnostic,
  semanticDiffUnavailableDiagnostic,
  serviceUnavailableDiagnostic,
} from './version-diff-diagnostics';
import { mapDiffPageResult } from './version-diff-projection';
import { getAttachedVersionDiffService, getAttachedVersionServices } from './version-diff-service';
import { validateDiffRequest } from './version-diff-validation';

export async function diffWorkbookVersion(
  ctx: DocumentContext,
  base: VersionCommitish,
  target: VersionCommitish,
  options: VersionDiffOptions = {},
): Promise<WorkbookDiffPage> {
  const validated = validateDiffRequest(base, target, options);
  if (!validated.ok) return degradedDiffPage(validated.diagnostics);

  const services = getAttachedVersionServices(ctx);
  if (!services) {
    return degradedDiffPage([serviceUnavailableDiagnostic()]);
  }

  const diffService = getAttachedVersionDiffService(services);
  if (!diffService) {
    return degradedDiffPage([semanticDiffUnavailableDiagnostic()]);
  }

  try {
    const result = await diffService.diff(validated.base, validated.target, validated.options);
    return mapDiffPageResult(result);
  } catch {
    return degradedDiffPage([providerErrorDiagnostic()]);
  }
}
