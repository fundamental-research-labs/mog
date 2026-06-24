import type {
  Paged,
  VersionListCommitsOptions,
  VersionResult,
  WorkbookCommitSummary,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../context';
import {
  degradedCommitPage,
  providerErrorDiagnostic,
  serviceUnavailableDiagnostic,
} from './version-list-commits-diagnostics';
import {
  normalizedLimit,
  toPageToken,
  validateListCommitsOptions,
} from './version-list-commits-options';
import { mapCommitPageResult } from './version-list-commits-projection';
import { getAttachedListCommitsService } from './version-list-commits-service';
import { versionResultFromCommitPage } from '../../version-result';

export async function listWorkbookVersionCommits(
  ctx: DocumentContext,
  options: VersionListCommitsOptions = {},
): Promise<VersionResult<Paged<WorkbookCommitSummary>>> {
  const optionDiagnostics = validateListCommitsOptions(options);
  const limit = normalizedLimit(options);
  if (optionDiagnostics.length > 0) {
    return versionResultFromCommitPage(degradedCommitPage(optionDiagnostics), limit);
  }

  const readService = getAttachedListCommitsService(ctx);
  if (!readService?.listCommits) {
    return versionResultFromCommitPage(degradedCommitPage([serviceUnavailableDiagnostic()]), limit);
  }

  const pageToken = options.pageToken === undefined ? undefined : toPageToken(options.pageToken);
  try {
    const result = await readService.listCommits({
      ...(options.ref === undefined ? {} : { ref: options.ref }),
      ...(options.from === undefined ? {} : { from: options.from }),
      ...(options.pageSize === undefined ? {} : { pageSize: options.pageSize }),
      ...(pageToken === undefined ? {} : { pageToken }),
    });
    return versionResultFromCommitPage(
      mapCommitPageResult(result, {
        requestedRootCommitId: options.from,
        isFollowUpPage: pageToken !== undefined,
      }),
      limit,
    );
  } catch {
    return versionResultFromCommitPage(degradedCommitPage([providerErrorDiagnostic()]), limit);
  }
}
