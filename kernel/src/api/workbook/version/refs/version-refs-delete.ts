import type { VersionDeleteRefOptions, VersionRefMutationResult } from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { DocumentContext } from '../../../../context';
import {
  deleteUnsupportedDiagnostic,
  protectedMainDiagnostic,
  providerExceptionDiagnostics,
} from './version-refs-delete-diagnostics';
import { preflightDeleteRef } from './version-refs-delete-preflight';
import { validateDeleteRefOptions } from './version-refs-delete-options';
import { mapBranchMutationResult, degradedMutation } from './version-refs-delete-results';
import { getDeleteCapableVersionRefLifecycleService } from './version-refs-delete-service';
import type { DeleteRefOperation } from './version-refs-delete-types';

export async function deleteWorkbookVersionBranchRef(input: {
  readonly ctx: DocumentContext;
  readonly options: VersionDeleteRefOptions;
  readonly operation: DeleteRefOperation;
  readonly author: VersionAuthor;
}): Promise<VersionRefMutationResult> {
  const validated = validateDeleteRefOptions(input.options, input.operation);
  if (!validated.ok) return degradedMutation(null, validated.diagnostics);

  if (validated.branchName === 'main') {
    return degradedMutation(null, [protectedMainDiagnostic(input.operation)]);
  }

  const service = getDeleteCapableVersionRefLifecycleService(input.ctx);
  if (!service?.deleteBranch) {
    return degradedMutation(null, [deleteUnsupportedDiagnostic(input.operation)]);
  }

  const preflightDiagnostics = await preflightDeleteRef(
    input.ctx,
    service,
    validated,
    input.operation,
  );
  if (preflightDiagnostics.length > 0) {
    return degradedMutation(null, preflightDiagnostics);
  }

  try {
    return mapBranchMutationResult(
      await service.deleteBranch({
        name: validated.branchName,
        ...(validated.expectedHead ? { expectedHead: validated.expectedHead } : {}),
        expectedRefVersion: validated.expectedRefVersion,
        deletedBy: input.author,
      }),
      input.operation,
    );
  } catch (error) {
    return degradedMutation(null, providerExceptionDiagnostics(error, input.operation));
  }
}
