import type {
  ObjectDigest,
  VersionApplyMergeInput,
  VersionApplyMergeOptions,
  VersionApplyMergeResolution,
  VersionApplyMergeResult,
  VersionBranchNameInput,
  VersionBranchRefReadResult,
  VersionCommitExpectedHead,
  VersionGetMergeConflictDetailRequest,
  VersionGetMergeReviewInput,
  VersionMainRefName,
  VersionMergeConflict,
  VersionMergeConflictDetailResult,
  VersionMergeConflictResolutionOptionKind,
  VersionMergeInput,
  VersionMergeResult,
  VersionMergeReview,
  VersionMergeReviewApplyOptions,
  VersionMergeReviewConflictDetailOptions,
  VersionPreviewMergeInput,
  VersionPreviewMergeOptions,
  VersionRefName,
  VersionResolvedMergeEndpoint,
  VersionResult,
  VersionSaveMergeResolutionsRequest,
  VersionSaveMergeResolutionsResult,
  VersionStoreDiagnostic,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../context';
import { computePublicMergeBase } from '../../version-merge-base-gate';
import { mergeWorkbookVersion } from '../../version-merge';
import { readWorkbookVersionFacadeGate } from '../../version-facade-gate';
import { versionFailureFromStoreDiagnostics, versionResultFromMergeEndpointDiagnostics } from '../../version-result';
import {
  expectedHeadFromActiveCheckout,
  readActiveCheckoutWriteContext,
} from '../active-checkout-write-context';
import { readActiveCheckoutHead } from '../status/version-active-checkout-head';
import { readWorkbookVersionRef } from '../refs/version-refs';
import { VERSION_MAIN_REF } from '../refs/version-refs-constants';
import {
  mergeEndpointPreflight,
  readMergePreviewArtifact,
} from './version-merge-review-endpoints-shared';
import {
  mergeReviewDiagnostic,
  openMergeReviewGraph,
  validateMergePreviewIdentity,
} from './version-merge-review-artifacts';

const VERSION_BRANCH_REF_PREFIX = 'refs/heads/';
const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;

type ReviewCallbacks = {
  readonly apply: (
    input: VersionApplyMergeInput,
    options?: VersionApplyMergeOptions,
  ) => Promise<VersionResult<VersionApplyMergeResult>>;
  readonly save: (
    input: VersionSaveMergeResolutionsRequest,
  ) => Promise<VersionResult<VersionSaveMergeResolutionsResult>>;
  readonly getConflictDetail: (
    input: VersionGetMergeConflictDetailRequest,
  ) => Promise<VersionResult<VersionMergeConflictDetailResult>>;
};

type ResolvedEndpoint = {
  readonly endpoint: VersionResolvedMergeEndpoint;
  readonly commitId: WorkbookCommitId;
  readonly targetRef?: VersionMainRefName | VersionRefName;
  readonly targetHead?: VersionCommitExpectedHead;
};

type EndpointResolution =
  | { readonly ok: true; readonly value: ResolvedEndpoint }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };

type ReviewBuildInput = {
  readonly result: VersionMergeResult;
  readonly from: VersionResolvedMergeEndpoint;
  readonly into: VersionResolvedMergeEndpoint;
  readonly targetRef?: VersionMainRefName | VersionRefName;
  readonly targetHead?: VersionCommitExpectedHead;
  readonly callbacks: ReviewCallbacks;
};

export async function previewMergeWorkbookVersionPorcelain(
  ctx: DocumentContext,
  input: VersionPreviewMergeInput,
  options: VersionPreviewMergeOptions = {},
  callbacks: ReviewCallbacks,
): Promise<VersionResult<VersionMergeReview>> {
  const readGate = readWorkbookVersionFacadeGate(ctx, 'previewMerge', 'version:read');
  if (readGate) return versionFailureFromStoreDiagnostics('previewMerge', readGate);

  const from = await resolveMergeEndpoint(ctx, input.from, 'from');
  if (!from.ok) return versionFailureFromStoreDiagnostics('previewMerge', from.diagnostics);

  const into = await resolveMergeIntoEndpoint(ctx, input.into);
  if (!into.ok) return versionFailureFromStoreDiagnostics('previewMerge', into.diagnostics);

  const base = input.base === undefined ? null : toCommitId(input.base);
  if (input.base !== undefined && !base) {
    return versionFailureFromStoreDiagnostics('previewMerge', [
      invalidPreviewMergeDiagnostic('base', 'previewMerge base must be a commit id.'),
    ]);
  }

  const mergeBase =
    base ??
    (await computePublicMergeBase(getAttachedVersionServices(ctx), into.value.commitId, from.value.commitId));
  if (typeof mergeBase !== 'string' && !mergeBase.ok) {
    return {
      ok: true,
      value: buildMergeReview({
        result: blockedReviewMergeResult(null, into.value.commitId, from.value.commitId, mergeBase.diagnostics),
        from: from.value.endpoint,
        into: into.value.endpoint,
        targetRef: into.value.targetRef,
        targetHead: into.value.targetHead,
        callbacks,
      }),
    };
  }

  const result = await mergeWorkbookVersion(
    ctx,
    {
      base: typeof mergeBase === 'string' ? mergeBase : mergeBase.base,
      ours: into.value.commitId,
      theirs: from.value.commitId,
    },
    {
      mode: 'preview',
      ...(options.includeDiagnostics === undefined
        ? {}
        : { includeDiagnostics: options.includeDiagnostics }),
      ...(into.value.targetRef ? { targetRef: into.value.targetRef } : {}),
      ...(into.value.targetHead ? { expectedTargetHead: into.value.targetHead } : {}),
      persistReviewRecord: options.persistReviewRecord ?? true,
    },
  );

  return {
    ok: true,
    value: buildMergeReview({
      result,
      from: from.value.endpoint,
      into: into.value.endpoint,
      targetRef: into.value.targetRef,
      targetHead: into.value.targetHead,
      callbacks,
    }),
  };
}

export async function getMergeReviewWorkbookVersionPorcelain(
  ctx: DocumentContext,
  input: VersionGetMergeReviewInput,
  callbacks: ReviewCallbacks,
): Promise<VersionResult<VersionMergeReview>> {
  const preflight = mergeEndpointPreflight<VersionMergeReview>(ctx, 'getMergeReview');
  if (preflight) return preflight;

  const identityDiagnostics = validateMergePreviewIdentity(
    'getMergeReview',
    input.resultId,
    input.resultDigest,
  );
  if (identityDiagnostics.length > 0) {
    return versionResultFromMergeEndpointDiagnostics('getMergeReview', identityDiagnostics);
  }

  const opened = await openMergeReviewGraph(ctx, 'getMergeReview');
  if (!opened.ok) return versionResultFromMergeEndpointDiagnostics('getMergeReview', opened.diagnostics);

  const artifact = await readMergePreviewArtifact(opened.graph, 'getMergeReview', input.resultDigest);
  if (!artifact.ok) {
    return versionResultFromMergeEndpointDiagnostics('getMergeReview', artifact.diagnostics);
  }

  return {
    ok: true,
    value: buildMergeReview({
      result: {
        status: artifact.payload.status,
        base: artifact.payload.base,
        ours: artifact.payload.ours,
        theirs: artifact.payload.theirs,
        changes: artifact.payload.changes,
        conflicts:
          artifact.payload.status === 'conflicted'
            ? artifact.payload.conflicts
            : ([] as readonly VersionMergeConflict[]),
        diagnostics: [],
        mutationGuarantee: 'preview-only',
        resultId: input.resultId,
        resultDigest: input.resultDigest,
        previewArtifactDigest: input.resultDigest,
        redactionPolicyDigest: input.redactionPolicyDigest,
        ...(input.targetRef ? { targetRef: input.targetRef } : {}),
        ...(input.targetHead ? { expectedTargetHead: input.targetHead } : {}),
      } as VersionMergeResult,
      from: input.from ?? { kind: 'commit', commitId: artifact.payload.theirs },
      into: input.into ?? endpointFromTarget(input.targetRef, artifact.payload.ours),
      targetRef: input.targetRef,
      targetHead: input.targetHead,
      callbacks,
    }),
  };
}

function buildMergeReview(input: ReviewBuildInput): VersionMergeReview {
  return new VersionMergeReviewHandle(input);
}

class VersionMergeReviewHandle implements VersionMergeReview {
  readonly schemaVersion = 1 as const;
  readonly status: VersionMergeReview['status'];
  readonly baseCommitId?: WorkbookCommitId;
  readonly mergeInput?: VersionMergeInput;
  readonly resultId?: VersionMergeReview['resultId'];
  readonly resultDigest?: ObjectDigest;
  readonly previewArtifactDigest?: ObjectDigest;
  readonly redactionPolicyDigest?: ObjectDigest;
  readonly attemptKind?: VersionMergeReview['attemptKind'];
  readonly attemptPersistence?: VersionMergeReview['attemptPersistence'];
  readonly changes: VersionMergeReview['changes'];
  readonly conflicts: VersionMergeReview['conflicts'];
  readonly diagnostics: VersionMergeReview['diagnostics'];
  readonly targetRef?: VersionMainRefName | VersionRefName;
  readonly targetHead?: VersionCommitExpectedHead;
  private resolutions: readonly VersionApplyMergeResolution[] = [];
  private resolutionSetDigestValue?: ObjectDigest;
  private resolvedAttemptDigestValue?: ObjectDigest;

  constructor(private readonly build: ReviewBuildInput) {
    const { result } = build;
    this.status = result.status;
    if (result.base) this.baseCommitId = result.base;
    if (result.base && result.ours && result.theirs) {
      this.mergeInput = { base: result.base, ours: result.ours, theirs: result.theirs };
    }
    this.resultId = result.resultId;
    this.resultDigest = result.resultDigest;
    this.previewArtifactDigest = result.previewArtifactDigest;
    this.redactionPolicyDigest =
      (result as { readonly redactionPolicyDigest?: ObjectDigest }).redactionPolicyDigest ??
      result.resultDigest;
    this.resolutionSetDigestValue = result.resolutionSetDigest;
    this.resolvedAttemptDigestValue = result.resolvedAttemptDigest;
    this.attemptKind = result.attemptKind;
    this.attemptPersistence = result.attemptPersistence;
    this.changes = result.changes;
    this.conflicts = result.conflicts;
    this.diagnostics = result.diagnostics;
    this.targetRef = result.targetRef ?? build.targetRef;
    this.targetHead = result.expectedTargetHead ?? build.targetHead;
  }

  get from(): VersionResolvedMergeEndpoint {
    return this.build.from;
  }

  get into(): VersionResolvedMergeEndpoint {
    return this.build.into;
  }

  get selectedResolutions(): readonly VersionApplyMergeResolution[] {
    return this.resolutions;
  }

  get resolutionSetDigest(): ObjectDigest | undefined {
    return this.resolutionSetDigestValue;
  }

  get resolvedAttemptDigest(): ObjectDigest | undefined {
    return this.resolvedAttemptDigestValue;
  }

  choose(conflictId: string, kind: VersionMergeConflictResolutionOptionKind): VersionMergeReview {
    const conflict = this.conflicts.find((candidate) => candidate.conflictId === conflictId);
    const option = conflict?.resolutionOptions.find((candidate) => candidate.kind === kind);
    if (!conflict || !option) return this;

    const next: VersionApplyMergeResolution = {
      conflictId: conflict.conflictId,
      expectedConflictDigest: conflict.conflictDigest as never,
      optionId: option.optionId,
      kind: option.kind,
    };
    this.resolutions = [
      ...this.resolutions.filter((candidate) => candidate.conflictId !== conflictId),
      next,
    ];
    this.resolutionSetDigestValue = undefined;
    this.resolvedAttemptDigestValue = undefined;
    return this;
  }

  chooseAll(kind: VersionMergeConflictResolutionOptionKind): VersionMergeReview {
    for (const conflict of this.conflicts) this.choose(conflict.conflictId, kind);
    return this;
  }

  async save(): Promise<VersionResult<VersionSaveMergeResolutionsResult>> {
    const persisted = this.persistedPreviewIdentity('saveMergeResolutions');
    if (!persisted.ok) return persisted.result;
    const target = this.previewTarget('saveMergeResolutions');
    if (!target.ok) return target.result;

    const result = await this.build.callbacks.save({
      resultId: persisted.resultId,
      resultDigest: persisted.resultDigest,
      redactionPolicyDigest: persisted.redactionPolicyDigest,
      targetRef: target.targetRef,
      expectedTargetHead: target.targetHead,
      resolutions: this.resolutions,
    });
    if (result.ok) {
      this.resolutionSetDigestValue = result.value.resolutionSetDigest;
      this.resolvedAttemptDigestValue = result.value.resolvedAttemptDigest;
    }
    return result;
  }

  toApplyInput(): VersionApplyMergeInput {
    if (this.resultId && this.resultDigest) {
      return {
        resultId: this.resultId,
        resultDigest: this.resultDigest,
        ...(this.previewArtifactDigest ? { previewArtifactDigest: this.previewArtifactDigest } : {}),
        ...(this.resolutionSetDigestValue ? { resolutionSetDigest: this.resolutionSetDigestValue } : {}),
        ...(this.resolvedAttemptDigestValue
          ? { resolvedAttemptDigest: this.resolvedAttemptDigestValue }
          : {}),
        resolutions: this.resolutions,
      };
    }
    if (!this.mergeInput) {
      throw new Error('Merge review does not have an applyable merge input.');
    }
    return { ...this.mergeInput, resolutions: this.resolutions };
  }

  async apply(
    options: VersionMergeReviewApplyOptions = {},
  ): Promise<VersionResult<VersionApplyMergeResult>> {
    if (this.status === 'blocked') {
      return versionResultFromMergeEndpointDiagnostics('applyMerge', this.diagnostics);
    }
    const target = this.previewTarget('applyMerge');
    if (!target.ok) return target.result;

    if (this.resultId && this.resultDigest && this.resolutions.length > 0) {
      const saved = await this.save();
      if (!saved.ok) return saved as VersionResult<VersionApplyMergeResult>;
    }

    let applyInput: VersionApplyMergeInput;
    try {
      applyInput = this.toApplyInput();
    } catch {
      return versionResultFromMergeEndpointDiagnostics('applyMerge', [
        mergeReviewDiagnostic(
          'applyMerge',
          'VERSION_INVALID_OPTIONS',
          'Merge review is not applyable because no merge input or persisted preview identity is available.',
          { payload: { option: 'review' } },
        ),
      ]);
    }

    return this.build.callbacks.apply(applyInput, {
      mode: 'apply',
      targetRef: target.targetRef,
      expectedTargetHead: target.targetHead,
      ...(options.includeDiagnostics === undefined
        ? {}
        : { includeDiagnostics: options.includeDiagnostics }),
      ...(options.materializeActiveCheckout === undefined
        ? {}
        : { materializeActiveCheckout: options.materializeActiveCheckout }),
    });
  }

  async getConflictDetail(
    conflictId: string,
    options: VersionMergeReviewConflictDetailOptions,
  ): Promise<VersionResult<VersionMergeConflictDetailResult>> {
    const persisted = this.persistedPreviewIdentity('getMergeConflictDetail');
    if (!persisted.ok) return persisted.result;
    const conflict = this.conflicts.find((candidate) => candidate.conflictId === conflictId);
    if (!conflict) {
      return versionResultFromMergeEndpointDiagnostics('getMergeConflictDetail', [
        mergeReviewDiagnostic(
          'getMergeConflictDetail',
          'VERSION_INVALID_OPTIONS',
          'Merge review conflictId does not exist in this preview.',
          { payload: { option: 'conflictId' } },
        ),
      ]);
    }

    return this.build.callbacks.getConflictDetail({
      resultId: persisted.resultId,
      resultDigest: persisted.resultDigest,
      redactionPolicyDigest: persisted.redactionPolicyDigest,
      conflictId,
      expectedConflictDigest: conflict.conflictDigest as never,
      valueRole: options.valueRole,
      purpose: options.purpose ?? 'review',
      ...(options.pageToken ? { pageToken: options.pageToken } : {}),
      ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
      ...(options.optionId ? { optionId: options.optionId } : {}),
      ...(options.kind ? { kind: options.kind } : {}),
      ...(this.resolutionSetDigestValue ? { resolutionSetDigest: this.resolutionSetDigestValue } : {}),
      ...(this.resolvedAttemptDigestValue
        ? { resolvedAttemptDigest: this.resolvedAttemptDigestValue }
        : {}),
      ...(this.targetRef ? { targetRef: this.targetRef } : {}),
      ...(this.targetHead ? { expectedTargetHead: this.targetHead } : {}),
    });
  }

  private persistedPreviewIdentity(
    operation: 'applyMerge' | 'saveMergeResolutions' | 'getMergeConflictDetail',
  ):
    | {
        readonly ok: true;
        readonly resultId: NonNullable<VersionMergeReview['resultId']>;
        readonly resultDigest: ObjectDigest;
        readonly redactionPolicyDigest: ObjectDigest;
      }
    | { readonly ok: false; readonly result: VersionResult<never> } {
    if (this.resultId && this.resultDigest) {
      return {
        ok: true,
        resultId: this.resultId,
        resultDigest: this.resultDigest,
        redactionPolicyDigest: this.redactionPolicyDigest ?? this.resultDigest,
      };
    }
    return {
      ok: false,
      result: versionResultFromMergeEndpointDiagnostics(operation, [
        mergeReviewDiagnostic(
          operation,
          'VERSION_INVALID_OPTIONS',
          'Merge review helper requires a persisted preview resultId and resultDigest.',
          { payload: { option: 'resultId' } },
        ),
      ]),
    };
  }

  private previewTarget(
    operation: 'applyMerge' | 'saveMergeResolutions',
  ):
    | {
        readonly ok: true;
        readonly targetRef: VersionMainRefName | VersionRefName;
        readonly targetHead: VersionCommitExpectedHead;
      }
    | { readonly ok: false; readonly result: VersionResult<never> } {
    if (this.targetRef && this.targetHead) {
      return { ok: true, targetRef: this.targetRef, targetHead: this.targetHead };
    }
    return {
      ok: false,
      result: versionResultFromMergeEndpointDiagnostics(operation, [
        mergeReviewDiagnostic(
          operation,
          'VERSION_INVALID_OPTIONS',
          'Merge review helper requires a previewed branch target head.',
          { payload: { option: 'targetRef' } },
        ),
      ]),
    };
  }
}

async function resolveMergeIntoEndpoint(
  ctx: DocumentContext,
  endpoint: VersionPreviewMergeInput['into'],
): Promise<EndpointResolution> {
  if (endpoint === undefined) {
    const active = await readActiveCheckoutWriteContext(ctx, 'applyMergeGraphWrite');
    if (active.status === 'attached') {
      return {
        ok: true,
        value: {
          endpoint: {
            kind: 'current',
            commitId: active.commitId,
            refName: active.refName,
            detached: false,
          },
          commitId: active.commitId,
          targetRef: active.refName,
          targetHead: expectedHeadFromActiveCheckout(active),
        },
      };
    }
    if (active.status === 'blocked' || active.status === 'stale') {
      return { ok: false, diagnostics: active.diagnostics };
    }
    if (active.status === 'detached') {
      return {
        ok: false,
        diagnostics: [
          invalidPreviewMergeDiagnostic(
            'into',
            'previewMerge cannot infer into from detached HEAD; pass a branch target.',
          ),
        ],
      };
    }
    return resolveBranchEndpoint(ctx, 'main');
  }
  return resolveMergeEndpoint(ctx, endpoint, 'into');
}

async function resolveMergeEndpoint(
  ctx: DocumentContext,
  endpoint: VersionPreviewMergeInput['from'],
  role: 'from' | 'into',
): Promise<EndpointResolution> {
  if (typeof endpoint === 'string') {
    if (endpoint === 'current') return resolveCurrentEndpoint(ctx, role);
    const commitId = toCommitId(endpoint);
    return commitId ? resolvedCommit(commitId) : resolveBranchEndpoint(ctx, endpoint);
  }

  if (!endpoint || typeof endpoint !== 'object') {
    return {
      ok: false,
      diagnostics: [invalidPreviewMergeDiagnostic(role, `previewMerge ${role} is required.`)],
    };
  }

  switch (endpoint.kind) {
    case 'current':
      return resolveCurrentEndpoint(ctx, role);
    case 'commit': {
      const commitId = toCommitId(endpoint.id);
      return commitId
        ? resolvedCommit(commitId)
        : {
            ok: false,
            diagnostics: [
              invalidPreviewMergeDiagnostic(role, `previewMerge ${role} commit id is invalid.`),
            ],
          };
    }
    case 'branch':
      return resolveBranchEndpoint(ctx, endpoint.name);
    case 'ref':
      return resolveBranchEndpoint(ctx, endpoint.name);
    default:
      return {
        ok: false,
        diagnostics: [invalidPreviewMergeDiagnostic(role, `previewMerge ${role} is invalid.`)],
      };
  }
}

async function resolveCurrentEndpoint(
  ctx: DocumentContext,
  role: 'from' | 'into',
): Promise<EndpointResolution> {
  if (role === 'into') {
    const active = await readActiveCheckoutWriteContext(ctx, 'applyMergeGraphWrite');
    if (active.status === 'attached') {
      return {
        ok: true,
        value: {
          endpoint: {
            kind: 'current',
            commitId: active.commitId,
            refName: active.refName,
            detached: false,
          },
          commitId: active.commitId,
          targetRef: active.refName,
          targetHead: expectedHeadFromActiveCheckout(active),
        },
      };
    }
    if (active.status === 'blocked' || active.status === 'stale') {
      return { ok: false, diagnostics: active.diagnostics };
    }
    return {
      ok: false,
      diagnostics: [
        invalidPreviewMergeDiagnostic(
          'into',
          'previewMerge into current requires an attached active checkout.',
        ),
      ],
    };
  }

  const active = await readActiveCheckoutHead(ctx);
  if (active.status === 'resolved') {
    return {
      ok: true,
      value: {
        endpoint: {
          kind: 'current',
          commitId: active.head.id,
          ...(active.head.refName ? { refName: active.head.refName } : {}),
          detached: active.session.detached,
        },
        commitId: active.head.id,
      },
    };
  }
  if (active.status === 'degraded') return { ok: false, diagnostics: active.result.diagnostics };
  return {
    ok: false,
    diagnostics: [
      invalidPreviewMergeDiagnostic(
        'from',
        'previewMerge from current requires an active checkout head.',
      ),
    ],
  };
}

async function resolveBranchEndpoint(
  ctx: DocumentContext,
  name: VersionBranchNameInput,
): Promise<EndpointResolution> {
  const refName = branchRefName(name);
  const result = (await readWorkbookVersionRef(ctx, refName)) as VersionBranchRefReadResult;
  if (result.status === 'degraded' || !result.ref) {
    return { ok: false, diagnostics: result.diagnostics };
  }
  return {
    ok: true,
    value: {
      endpoint: {
        kind: 'branch',
        name: branchNameFromRefName(result.ref.name),
        refName: result.ref.name,
        commitId: result.ref.commitId,
      },
      commitId: result.ref.commitId,
      targetRef: result.ref.name,
      targetHead: {
        commitId: result.ref.commitId,
        revision: result.ref.revision,
      },
    },
  };
}

function resolvedCommit(commitId: WorkbookCommitId): EndpointResolution {
  return { ok: true, value: { endpoint: { kind: 'commit', commitId }, commitId } };
}

function endpointFromTarget(
  targetRef: VersionMainRefName | VersionRefName | undefined,
  commitId: WorkbookCommitId,
): VersionResolvedMergeEndpoint {
  return targetRef
    ? {
        kind: 'branch',
        name: branchNameFromRefName(targetRef),
        refName: targetRef,
        commitId,
      }
    : { kind: 'commit', commitId };
}

function branchRefName(value: VersionBranchNameInput): VersionMainRefName | VersionRefName {
  const text = String(value);
  if (text.startsWith(VERSION_BRANCH_REF_PREFIX)) {
    return text as VersionMainRefName | VersionRefName;
  }
  return text === 'main'
    ? VERSION_MAIN_REF
    : (`${VERSION_BRANCH_REF_PREFIX}${text}` as VersionRefName);
}

function branchNameFromRefName(refName: VersionMainRefName | VersionRefName): VersionBranchNameInput {
  return refName === VERSION_MAIN_REF ? 'main' : refName.slice(VERSION_BRANCH_REF_PREFIX.length);
}

function toCommitId(value: unknown): WorkbookCommitId | null {
  return typeof value === 'string' && WORKBOOK_COMMIT_ID_RE.test(value)
    ? (value as WorkbookCommitId)
    : null;
}

function blockedReviewMergeResult(
  base: WorkbookCommitId | null,
  ours: WorkbookCommitId | null,
  theirs: WorkbookCommitId | null,
  diagnostics: readonly VersionStoreDiagnostic[],
): VersionMergeResult {
  return {
    status: 'blocked',
    base,
    ours,
    theirs,
    changes: [],
    conflicts: [],
    diagnostics,
    mutationGuarantee: 'preview-only',
  };
}

function invalidPreviewMergeDiagnostic(option: string, safeMessage: string): VersionStoreDiagnostic {
  return mergeReviewDiagnostic('previewMerge', 'VERSION_INVALID_OPTIONS', safeMessage, {
    payload: { option },
  });
}

function getAttachedVersionServices(ctx: DocumentContext): unknown {
  const runtime = ctx as {
    readonly versioning?: unknown;
    readonly versionStore?: unknown;
    readonly version?: unknown;
  };
  return runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
}
