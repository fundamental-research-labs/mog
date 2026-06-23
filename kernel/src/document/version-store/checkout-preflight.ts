import type {
  ReadWorkbookCommitResult,
  WorkbookCommit,
  WorkbookCommitStoreDiagnostic,
} from './commit-store';
import type { WorkbookCommitId } from './object-digest';
import {
  createMaterializationPlan,
  dependencyRefForPlan,
  materializationDependencies,
} from './checkout-materialization-plan';
import type {
  CheckoutCommitReader,
  CheckoutDependencyReader,
  CheckoutMaterializationDiagnostic,
  CheckoutMaterializationResult,
  CheckoutResolvedMaterializationTarget,
} from './checkout-service';
import {
  checkoutDiagnostic as diagnostic,
  checkoutFailure as failure,
  diagnosticsContainCode,
  errorName,
  freezeCheckoutDiagnostics as freezeDiagnostics,
} from './checkout-service-diagnostics';

export async function preflightCheckoutPlan(input: {
  readonly commitReader: CheckoutCommitReader;
  readonly dependencyReader: CheckoutDependencyReader;
  readonly resolvedTarget: CheckoutResolvedMaterializationTarget;
  readonly commitId: WorkbookCommitId;
  readonly resolutionDiagnostics: readonly CheckoutMaterializationDiagnostic[];
}): Promise<CheckoutMaterializationResult> {
  let read: ReadWorkbookCommitResult;
  try {
    read = await input.commitReader.readCommit(input.commitId);
  } catch (error) {
    return failure('checkoutCommitReadFailed', 'Commit reader failed while resolving checkout.', [
      diagnostic(
        'VERSION_CHECKOUT_COMMIT_READ_FAILED',
        'Commit reader failed while resolving checkout.',
        {
          commitId: input.commitId,
          details: { cause: errorName(error) },
        },
      ),
    ]);
  }

  if (read.status !== 'success') {
    return commitReadFailure(input.commitId, read.diagnostics);
  }

  const blockingCompletenessDiagnostics = read.commit.payload.completenessDiagnostics.filter(
    (entry) => entry.severity === 'error',
  );
  if (blockingCompletenessDiagnostics.length > 0) {
    return failure(
      'checkoutCommitUnmaterializable',
      'Target commit has blocking materialization diagnostics.',
      [
        diagnostic(
          'VERSION_CHECKOUT_UNMATERIALIZABLE_COMMIT',
          'Target commit has blocking materialization diagnostics.',
          {
            commitId: read.commit.id,
            sourceDiagnostics: blockingCompletenessDiagnostics,
          },
        ),
      ],
    );
  }

  const dependencyDiagnostics = await validateDependencies(input.dependencyReader, read.commit);
  if (dependencyDiagnostics.length > 0) {
    const hasReadFailure = dependencyDiagnostics.some(
      (entry) => entry.code === 'VERSION_CHECKOUT_DEPENDENCY_READ_FAILED',
    );
    return failure(
      hasReadFailure ? 'checkoutDependencyReadFailed' : 'checkoutDependencyMissing',
      hasReadFailure
        ? 'Dependency reader failed while preflighting checkout materialization.'
        : 'Target commit is missing required materialization dependencies.',
      dependencyDiagnostics,
    );
  }

  const plan = createMaterializationPlan(read.commit, input.resolvedTarget);
  const diagnostics = freezeDiagnostics([
    ...input.resolutionDiagnostics,
    ...nonBlockingCompletenessDiagnostics(read.commit),
  ]);

  return {
    ok: true,
    materialization: 'planned',
    plan,
    diagnostics,
    mutationGuarantee: 'no-workbook-mutation',
  };
}

async function validateDependencies(
  dependencyReader: CheckoutDependencyReader,
  commit: WorkbookCommit,
): Promise<readonly CheckoutMaterializationDiagnostic[]> {
  const diagnostics: CheckoutMaterializationDiagnostic[] = [];

  for (const dependency of materializationDependencies(commit).map(dependencyRefForPlan)) {
    try {
      if (!(await dependencyReader.hasDependency(dependency))) {
        diagnostics.push(
          diagnostic(
            'VERSION_CHECKOUT_MISSING_DEPENDENCY',
            'Target commit dependency is missing for checkout materialization.',
            {
              commitId: commit.id,
              objectDigest: dependency.digest,
              dependency,
            },
          ),
        );
      }
    } catch (error) {
      diagnostics.push(
        diagnostic(
          'VERSION_CHECKOUT_DEPENDENCY_READ_FAILED',
          'Dependency reader failed during checkout preflight.',
          {
            commitId: commit.id,
            objectDigest: dependency.digest,
            dependency,
            details: { cause: errorName(error) },
          },
        ),
      );
    }
  }

  return freezeDiagnostics(diagnostics);
}

function commitReadFailure(
  commitId: WorkbookCommitId,
  sourceDiagnostics: readonly WorkbookCommitStoreDiagnostic[],
): CheckoutMaterializationResult {
  if (diagnosticsContainCode(sourceDiagnostics, 'VERSION_OBJECT_NOT_FOUND')) {
    return failure('checkoutCommitNotFound', 'Checkout commit was not found.', [
      diagnostic('VERSION_CHECKOUT_MISSING_COMMIT', 'Checkout commit was not found.', {
        commitId,
        sourceDiagnostics,
      }),
    ]);
  }

  if (
    diagnosticsContainCode(sourceDiagnostics, 'VERSION_MISSING_DEPENDENCY') ||
    diagnosticsContainCode(sourceDiagnostics, 'VERSION_MISSING_PARENT')
  ) {
    return failure(
      'checkoutDependencyMissing',
      'Target commit is missing required materialization dependencies.',
      [
        diagnostic(
          'VERSION_CHECKOUT_MISSING_DEPENDENCY',
          'Target commit is missing required materialization dependencies.',
          {
            commitId,
            sourceDiagnostics,
          },
        ),
      ],
    );
  }

  return failure('checkoutCommitReadFailed', 'Commit reader failed while resolving checkout.', [
    diagnostic(
      'VERSION_CHECKOUT_COMMIT_READ_FAILED',
      'Commit reader failed while resolving checkout.',
      {
        commitId,
        sourceDiagnostics,
      },
    ),
  ]);
}

function nonBlockingCompletenessDiagnostics(
  commit: WorkbookCommit,
): readonly CheckoutMaterializationDiagnostic[] {
  return commit.payload.completenessDiagnostics
    .filter((entry) => entry.severity !== 'error')
    .map((entry) =>
      diagnostic(
        'VERSION_CHECKOUT_COMMIT_COMPLETENESS_DIAGNOSTIC',
        'Target commit has non-blocking completeness diagnostics.',
        {
          severity: entry.severity,
          commitId: commit.id,
          sourceDiagnostics: [entry],
        },
      ),
    );
}
