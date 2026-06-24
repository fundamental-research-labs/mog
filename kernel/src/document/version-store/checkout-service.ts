import {
  type ObjectDigest,
  type VersionDependencyRef,
  type VersionObjectType,
  type WorkbookCommitId,
} from './object-digest';
import type {
  ReadWorkbookCommitResult,
  WorkbookCommitCompletenessDiagnostic,
  WorkbookCommitStoreDiagnostic,
} from './commit-store';
import type { VersionGraphStoreDiagnostic } from './graph';
import type { RefName, RefNameDiagnostic } from './refs/ref-name';
import type { GetRefResult, RefVersion, VersionDiagnostic } from './refs/ref-store';
import type { VersionObjectStoreDiagnostic } from './object-store';
import type { VersionStoreDiagnostic as ProviderVersionStoreDiagnostic } from './provider';
import {
  applyCheckoutMaterializationPlan,
  type CheckoutMaterializationMutationGuarantee,
  type CheckoutSnapshotMaterializer,
  type CheckoutSnapshotReader,
} from './checkout-apply';
import { preflightCheckoutPlan } from './checkout-preflight';
import {
  parseCheckoutMaterializationRequest,
  resolveCheckoutTarget,
} from './checkout-target-resolution';

type MaybePromise<T> = T | Promise<T>;

export type CheckoutMaterializationRequest =
  | {
      readonly target: 'commit';
      readonly commitId: WorkbookCommitId | string;
    }
  | {
      readonly target: 'ref';
      readonly refName: RefName | 'HEAD' | string;
    };

export type CheckoutMaterializationErrorCode =
  | 'invalidCheckoutTarget'
  | 'unsupportedCheckoutTarget'
  | 'checkoutAccessDenied'
  | 'checkoutRefNotFound'
  | 'checkoutCommitNotFound'
  | 'checkoutCommitUnmaterializable'
  | 'checkoutDependencyMissing'
  | 'checkoutCommitReadFailed'
  | 'checkoutRefReadFailed'
  | 'checkoutDependencyReadFailed'
  | 'checkoutProviderUnavailable'
  | 'checkoutSnapshotReadFailed'
  | 'checkoutMaterializerUnavailable'
  | 'checkoutSnapshotApplyFailed';

export type CheckoutMaterializationDiagnosticCode =
  | 'VERSION_CHECKOUT_INVALID_TARGET'
  | 'VERSION_CHECKOUT_UNSUPPORTED_TARGET'
  | 'VERSION_CHECKOUT_DETACHED_TARGET_UNSUPPORTED'
  | 'VERSION_CHECKOUT_DETACHED_HEAD_UNSUPPORTED'
  | 'VERSION_CHECKOUT_MISSING_REF_READER'
  | 'VERSION_CHECKOUT_MISSING_HEAD_READER'
  | 'VERSION_CHECKOUT_REF_READ_FAILED'
  | 'VERSION_CHECKOUT_MISSING_REF'
  | 'VERSION_CHECKOUT_MISSING_COMMIT'
  | 'VERSION_CHECKOUT_COMMIT_READ_FAILED'
  | 'VERSION_CHECKOUT_COMMIT_COMPLETENESS_DIAGNOSTIC'
  | 'VERSION_CHECKOUT_DIRTY_WORKING_STATE'
  | 'VERSION_CHECKOUT_UNMATERIALIZABLE_COMMIT'
  | 'VERSION_CHECKOUT_MISSING_DEPENDENCY'
  | 'VERSION_CHECKOUT_DEPENDENCY_READ_FAILED'
  | 'VERSION_CHECKOUT_PROVIDER_ERROR'
  | 'VERSION_CHECKOUT_SNAPSHOT_READ_FAILED'
  | 'VERSION_CHECKOUT_MATERIALIZER_UNAVAILABLE'
  | 'VERSION_CHECKOUT_SNAPSHOT_APPLY_FAILED'
  | 'VERSION_CHECKOUT_WRITE_FENCE_STALE'
  | 'VERSION_CHECKOUT_WRITE_FENCE_UNAVAILABLE'
  | 'VERSION_PERMISSION_DENIED';

export type CheckoutMaterializationDiagnosticSource =
  | CheckoutMaterializationDiagnostic
  | WorkbookCommitCompletenessDiagnostic
  | WorkbookCommitStoreDiagnostic
  | RefNameDiagnostic
  | VersionDiagnostic
  | VersionObjectStoreDiagnostic
  | VersionGraphStoreDiagnostic
  | ProviderVersionStoreDiagnostic;

export interface CheckoutMaterializationDiagnostic {
  readonly code: CheckoutMaterializationDiagnosticCode;
  readonly severity: 'info' | 'warning' | 'error' | 'corruption';
  readonly message: string;
  readonly refName?: string;
  readonly commitId?: WorkbookCommitId;
  readonly refVersion?: RefVersion;
  readonly refIncarnationId?: string;
  readonly objectDigest?: ObjectDigest;
  readonly dependency?: VersionDependencyRef;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
  readonly sourceDiagnostics?: readonly CheckoutMaterializationDiagnosticSource[];
}

export interface CheckoutMaterializationError {
  readonly code: CheckoutMaterializationErrorCode;
  readonly message: string;
  readonly diagnostics?: readonly CheckoutMaterializationDiagnostic[];
}

export interface CheckoutCommitReader {
  readCommit(commitId: WorkbookCommitId): MaybePromise<ReadWorkbookCommitResult>;
}

export interface CheckoutDependencyReader {
  hasDependency(dependency: VersionDependencyRef): MaybePromise<boolean>;
}

export type CheckoutHeadState =
  | {
      readonly mode: 'attached';
      readonly refName: RefName | string;
      readonly commitId: WorkbookCommitId | string;
      readonly refVersion?: RefVersion;
      readonly refIncarnationId?: string;
    }
  | {
      readonly mode: 'detached';
      readonly commitId: WorkbookCommitId | string;
      readonly materializationId: string;
    };

export type CheckoutHeadReadResult =
  | {
      readonly ok: true;
      readonly head: CheckoutHeadState;
      readonly diagnostics?: readonly CheckoutMaterializationDiagnostic[];
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly CheckoutMaterializationDiagnostic[];
    };

export interface CheckoutHeadReader {
  readHead(): MaybePromise<CheckoutHeadReadResult>;
}

export interface CheckoutRefReader {
  readRef(refName: RefName): MaybePromise<GetRefResult>;
}

export interface CheckoutMaterializationServiceOptions {
  readonly commitReader: CheckoutCommitReader;
  readonly dependencyReader: CheckoutDependencyReader;
  readonly headReader?: CheckoutHeadReader;
  readonly refReader?: CheckoutRefReader;
  readonly snapshotReader?: CheckoutSnapshotReader;
  readonly snapshotMaterializer?: CheckoutSnapshotMaterializer;
}

export type CheckoutMaterializationDependencyRole =
  | 'snapshotRoot'
  | 'semanticChangeSet'
  | 'mutationSegment'
  | 'redactionSummary'
  | 'verificationSummary';

export interface CheckoutMaterializationDependency {
  readonly role: CheckoutMaterializationDependencyRole;
  readonly objectType: VersionObjectType;
  readonly digest: ObjectDigest;
  readonly index?: number;
}

export type CheckoutResolvedMaterializationTarget =
  | {
      readonly kind: 'commit';
      readonly commitId: WorkbookCommitId;
    }
  | {
      readonly kind: 'ref';
      readonly refName: RefName;
      readonly commitId: WorkbookCommitId;
      readonly refVersion: RefVersion;
      readonly refIncarnationId: string;
    }
  | {
      readonly kind: 'head';
      readonly refName: RefName;
      readonly commitId: WorkbookCommitId;
      readonly refVersion?: RefVersion;
      readonly refIncarnationId?: string;
    };

export interface CheckoutMaterializationPlan {
  readonly strategy: 'fullSnapshot';
  readonly resolvedTarget: CheckoutResolvedMaterializationTarget;
  readonly commitId: WorkbookCommitId;
  readonly parentCommitIds: readonly WorkbookCommitId[];
  readonly snapshotRootDigest: ObjectDigest;
  readonly semanticChangeSetDigest: ObjectDigest;
  readonly mutationSegmentDigests: readonly ObjectDigest[];
  readonly requiredDependencies: readonly CheckoutMaterializationDependency[];
  readonly requiredDependencyDigests: readonly ObjectDigest[];
}

export type CheckoutMaterializationResult =
  | {
      readonly ok: true;
      readonly materialization: 'planned';
      readonly plan: CheckoutMaterializationPlan;
      readonly diagnostics: readonly CheckoutMaterializationDiagnostic[];
      readonly mutationGuarantee: 'no-workbook-mutation';
    }
  | {
      readonly ok: true;
      readonly materialization: 'applied';
      readonly plan: CheckoutMaterializationPlan;
      readonly diagnostics: readonly CheckoutMaterializationDiagnostic[];
      readonly mutationGuarantee: 'workbook-state-materialized';
    }
  | {
      readonly ok: false;
      readonly error: CheckoutMaterializationError;
      readonly diagnostics: readonly CheckoutMaterializationDiagnostic[];
      readonly mutationGuarantee: Extract<
        CheckoutMaterializationMutationGuarantee,
        'no-workbook-mutation' | 'unknown-after-partial-mutation'
      >;
    };

export class CheckoutMaterializationService {
  private readonly commitReader: CheckoutCommitReader;
  private readonly dependencyReader: CheckoutDependencyReader;
  private readonly headReader?: CheckoutHeadReader;
  private readonly refReader?: CheckoutRefReader;
  private readonly snapshotReader?: CheckoutSnapshotReader;
  private readonly snapshotMaterializer?: CheckoutSnapshotMaterializer;

  constructor(options: CheckoutMaterializationServiceOptions) {
    this.commitReader = options.commitReader;
    this.dependencyReader = options.dependencyReader;
    this.headReader = options.headReader;
    this.refReader = options.refReader;
    this.snapshotReader = options.snapshotReader;
    this.snapshotMaterializer = options.snapshotMaterializer;
  }

  async planCheckout(
    request: CheckoutMaterializationRequest,
  ): Promise<CheckoutMaterializationResult> {
    const parsed = parseCheckoutMaterializationRequest(request);
    if (!parsed.ok) return parsed.result;

    const resolved = await this.resolveTarget(parsed);
    if (!resolved.ok) return resolved.result;

    return preflightCheckoutPlan({
      commitReader: this.commitReader,
      dependencyReader: this.dependencyReader,
      resolvedTarget: resolved.target,
      commitId: resolved.commitId,
      resolutionDiagnostics: resolved.diagnostics,
    });
  }

  async checkout(request: CheckoutMaterializationRequest): Promise<CheckoutMaterializationResult> {
    const planned = await this.planCheckout(request);
    if (!planned.ok) return planned;
    return this.applyPlan(planned.plan, planned.diagnostics);
  }

  private async applyPlan(
    plan: CheckoutMaterializationPlan,
    preflightDiagnostics: readonly CheckoutMaterializationDiagnostic[],
  ): Promise<CheckoutMaterializationResult> {
    return applyCheckoutMaterializationPlan({
      plan,
      preflightDiagnostics,
      snapshotReader: this.snapshotReader,
      snapshotMaterializer: this.snapshotMaterializer,
    });
  }

  private resolveTarget(
    parsed: Parameters<typeof resolveCheckoutTarget>[0],
  ): ReturnType<typeof resolveCheckoutTarget> {
    return resolveCheckoutTarget(parsed, {
      headReader: this.headReader,
      refReader: this.refReader,
    });
  }
}

export function createCheckoutMaterializationService(
  options: CheckoutMaterializationServiceOptions,
): CheckoutMaterializationService {
  return new CheckoutMaterializationService(options);
}
