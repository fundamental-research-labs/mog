import type {
  VersionCommitish,
  VersionDiffGroupDetailOptions,
  VersionDiffOptions,
  VersionDiffOverview,
  VersionDiffOverviewOptions,
  WorkbookDiffPage,
} from '@mog-sdk/contracts/api';
import type { DocumentContext } from '../../../../context';
import {
  degradedDiffPage,
  mapGraphDiagnostics,
  providerErrorDiagnostic,
  publicDiagnostic,
  semanticDiffUnavailableDiagnostic,
  serviceUnavailableDiagnostic,
} from './version-diff-diagnostics';
import { mapDiffPageResult } from './version-diff-projection';
import { getAttachedVersionDiffService, getAttachedVersionServices } from './version-diff-service';
import { validateDiffRequest } from './version-diff-validation';
import { isRecord } from './version-diff-utils';

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

export async function diffWorkbookVersionOverview(
  ctx: DocumentContext,
  base: VersionCommitish,
  target: VersionCommitish,
  options: VersionDiffOverviewOptions = {},
): Promise<VersionDiffOverview | WorkbookDiffPage> {
  const validated = validateDiffRequest(base, target, {
    includeDiagnostics: options.includeDiagnostics,
  });
  if (!validated.ok) return degradedDiffPage(validated.diagnostics);

  const services = getAttachedVersionServices(ctx);
  if (!services) return degradedDiffPage([serviceUnavailableDiagnostic()]);

  const diffService = getAttachedVersionDiffService(services);
  if (!diffService?.diffOverview) {
    return degradedDiffPage([semanticDiffUnavailableDiagnostic()]);
  }

  try {
    return mapDiffOverviewResult(
      await diffService.diffOverview(validated.base, validated.target, options),
    );
  } catch {
    return degradedDiffPage([providerErrorDiagnostic()]);
  }
}

export async function diffWorkbookVersionGroupDetail(
  ctx: DocumentContext,
  base: VersionCommitish,
  target: VersionCommitish,
  options: VersionDiffGroupDetailOptions,
): Promise<WorkbookDiffPage> {
  const validated = validateDiffRequest(base, target, {
    pageSize: options.pageSize,
    pageToken: options.pageToken,
    includeDerivedImpact: options.includeDerivedImpact,
    includeDiagnostics: options.includeDiagnostics,
  });
  if (!validated.ok) return degradedDiffPage(validated.diagnostics);
  if (!options.groupId) {
    return degradedDiffPage([
      publicDiagnostic('VERSION_INVALID_OPTIONS', 'diff groupId is required.', {
        payload: { option: 'groupId' },
      }),
    ]);
  }

  const services = getAttachedVersionServices(ctx);
  if (!services) return degradedDiffPage([serviceUnavailableDiagnostic()]);

  const diffService = getAttachedVersionDiffService(services);
  if (!diffService?.diffGroupDetail) {
    return degradedDiffPage([semanticDiffUnavailableDiagnostic()]);
  }

  try {
    return mapDiffPageResult(
      await diffService.diffGroupDetail(validated.base, validated.target, {
        ...validated.options,
        groupId: options.groupId,
        ...(options.filters ? { filters: options.filters } : {}),
      }),
    );
  } catch {
    return degradedDiffPage([providerErrorDiagnostic()]);
  }
}

function mapDiffOverviewResult(value: unknown): VersionDiffOverview | WorkbookDiffPage {
  if (!isRecord(value)) return degradedDiffPage([providerErrorDiagnostic()]);
  if (value.status === 'failed' || value.status === 'degraded') {
    return degradedDiffPage(mapGraphDiagnostics(value.diagnostics));
  }
  if (
    typeof value.baseCommitId !== 'string' ||
    typeof value.targetCommitId !== 'string' ||
    !isRecord(value.readRevision) ||
    value.order !== 'semantic-change-order' ||
    !isRecord(value.summary) ||
    !isRecord(value.groups) ||
    !Array.isArray(value.groups.items)
  ) {
    return degradedDiffPage([
      publicDiagnostic(
        'VERSION_INVALID_COMMIT_PAYLOAD',
        'The version diff service did not return a valid public diff overview.',
        { severity: 'error', recoverability: 'repair' },
      ),
    ]);
  }
  return value as VersionDiffOverview;
}
