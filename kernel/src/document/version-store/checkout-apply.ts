import type { VersionDependencyRef } from './object-digest';
import type { VersionObjectRecord } from './object-store';
import type {
  CheckoutMaterializationDiagnostic,
  CheckoutMaterializationDiagnosticCode,
  CheckoutMaterializationErrorCode,
  CheckoutMaterializationPlan,
  CheckoutMaterializationResult,
  CheckoutResolvedMaterializationTarget,
} from './checkout-service';

type MaybePromise<T> = T | Promise<T>;

export type CheckoutMaterializationMutationGuarantee =
  | 'no-workbook-mutation'
  | 'workbook-state-materialized'
  | 'unknown-after-partial-mutation';

export interface CheckoutSnapshotReader {
  readSnapshotRoot(
    dependency: VersionDependencyRef,
  ): MaybePromise<VersionObjectRecord<unknown> | unknown>;
}

export interface CheckoutSnapshotApplyInput {
  readonly strategy: 'fullSnapshot';
  readonly resolvedTarget: CheckoutResolvedMaterializationTarget;
  readonly commitId: CheckoutMaterializationPlan['commitId'];
  readonly snapshotRoot: unknown;
  readonly plan: CheckoutMaterializationPlan;
}

export type CheckoutSnapshotApplyResult =
  | {
      readonly status: 'applied';
      readonly diagnostics?: readonly CheckoutMaterializationDiagnostic[];
    }
  | {
      readonly status: 'failed';
      readonly diagnostics: readonly CheckoutMaterializationDiagnostic[];
      readonly mutationGuarantee?: Extract<
        CheckoutMaterializationMutationGuarantee,
        'no-workbook-mutation' | 'unknown-after-partial-mutation'
      >;
    };

export interface CheckoutSnapshotMaterializer {
  applySnapshot(input: CheckoutSnapshotApplyInput): MaybePromise<CheckoutSnapshotApplyResult>;
}

export async function applyCheckoutMaterializationPlan(input: {
  readonly plan: CheckoutMaterializationPlan;
  readonly preflightDiagnostics: readonly CheckoutMaterializationDiagnostic[];
  readonly snapshotReader?: CheckoutSnapshotReader;
  readonly snapshotMaterializer?: CheckoutSnapshotMaterializer;
}): Promise<CheckoutMaterializationResult> {
  if (!input.snapshotReader || !input.snapshotMaterializer) {
    return failure(
      'checkoutMaterializerUnavailable',
      'Checkout snapshot materializer is not attached.',
      [
        diagnostic(
          'VERSION_CHECKOUT_MATERIALIZER_UNAVAILABLE',
          'Checkout snapshot materializer is not attached.',
          {
            commitId: input.plan.commitId,
            dependency: snapshotDependency(input.plan),
          },
        ),
      ],
    );
  }

  const dependency = snapshotDependency(input.plan);
  let snapshotRoot: unknown;
  try {
    snapshotRoot = snapshotPayload(await input.snapshotReader.readSnapshotRoot(dependency));
  } catch (error) {
    return failure('checkoutSnapshotReadFailed', 'Snapshot root read failed.', [
      diagnostic('VERSION_CHECKOUT_SNAPSHOT_READ_FAILED', 'Snapshot root read failed.', {
        commitId: input.plan.commitId,
        dependency,
        objectDigest: input.plan.snapshotRootDigest,
        details: { cause: errorName(error) },
      }),
    ]);
  }

  let applied: CheckoutSnapshotApplyResult;
  try {
    applied = await input.snapshotMaterializer.applySnapshot({
      strategy: 'fullSnapshot',
      resolvedTarget: input.plan.resolvedTarget,
      commitId: input.plan.commitId,
      snapshotRoot,
      plan: input.plan,
    });
  } catch (error) {
    return failure(
      'checkoutSnapshotApplyFailed',
      'Snapshot materializer failed while applying checkout.',
      [
        diagnostic(
          'VERSION_CHECKOUT_SNAPSHOT_APPLY_FAILED',
          'Snapshot materializer failed while applying checkout.',
          {
            commitId: input.plan.commitId,
            details: { cause: errorName(error) },
          },
        ),
      ],
      'unknown-after-partial-mutation',
    );
  }

  if (applied.status === 'applied') {
    return {
      ok: true,
      materialization: 'applied',
      plan: input.plan,
      diagnostics: freezeDiagnostics([
        ...input.preflightDiagnostics,
        ...(applied.diagnostics ?? []),
      ]),
      mutationGuarantee: 'workbook-state-materialized',
    };
  }

  if (applied.status === 'failed') {
    return failure(
      'checkoutSnapshotApplyFailed',
      'Snapshot materializer did not apply checkout.',
      applied.diagnostics.length > 0
        ? [...input.preflightDiagnostics, ...applied.diagnostics]
        : [
            ...input.preflightDiagnostics,
            diagnostic(
              'VERSION_CHECKOUT_SNAPSHOT_APPLY_FAILED',
              'Snapshot materializer did not apply checkout.',
              { commitId: input.plan.commitId },
            ),
          ],
      applied.mutationGuarantee ?? 'unknown-after-partial-mutation',
    );
  }

  return failure(
    'checkoutSnapshotApplyFailed',
    'Snapshot materializer returned an invalid result.',
    [
      ...input.preflightDiagnostics,
      diagnostic(
        'VERSION_CHECKOUT_SNAPSHOT_APPLY_FAILED',
        'Snapshot materializer returned an invalid result.',
        { commitId: input.plan.commitId },
      ),
    ],
    'unknown-after-partial-mutation',
  );
}

function snapshotDependency(plan: CheckoutMaterializationPlan): VersionDependencyRef {
  return Object.freeze({
    kind: 'object',
    objectType: 'workbook.snapshotRoot.v1',
    digest: Object.freeze({
      algorithm: plan.snapshotRootDigest.algorithm,
      digest: plan.snapshotRootDigest.digest,
    }),
  });
}

function snapshotPayload(value: VersionObjectRecord<unknown> | unknown): unknown {
  if (!isRecord(value)) return value;
  const preimage = value.preimage;
  if (!isRecord(preimage) || preimage.objectType !== 'workbook.snapshotRoot.v1') return value;
  return preimage.payload;
}

function failure(
  code: CheckoutMaterializationErrorCode,
  message: string,
  diagnostics: readonly CheckoutMaterializationDiagnostic[],
  mutationGuarantee: Extract<
    CheckoutMaterializationMutationGuarantee,
    'no-workbook-mutation' | 'unknown-after-partial-mutation'
  > = 'no-workbook-mutation',
): CheckoutMaterializationResult {
  const frozenDiagnostics = freezeDiagnostics(diagnostics);
  return {
    ok: false,
    error: Object.freeze({
      code,
      message,
      diagnostics: frozenDiagnostics,
    }),
    diagnostics: frozenDiagnostics,
    mutationGuarantee,
  };
}

function diagnostic(
  code: CheckoutMaterializationDiagnosticCode,
  message: string,
  options: Omit<CheckoutMaterializationDiagnostic, 'code' | 'severity' | 'message'> & {
    readonly severity?: CheckoutMaterializationDiagnostic['severity'];
  } = {},
): CheckoutMaterializationDiagnostic {
  const { severity = 'error', ...rest } = options;
  return Object.freeze({
    code,
    severity,
    message,
    ...rest,
  });
}

function freezeDiagnostics(
  diagnostics: readonly CheckoutMaterializationDiagnostic[],
): readonly CheckoutMaterializationDiagnostic[] {
  return Object.freeze([...diagnostics]);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function errorName(error: unknown): string {
  if (error instanceof Error) return error.name;
  return typeof error;
}
