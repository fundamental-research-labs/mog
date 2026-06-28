import type {
  ObjectDigest,
  VersionDegradedHeadResult,
  VersionDiffEntry,
  VersionMainRefName,
  VersionPageToken,
  VersionRefName,
  VersionSemanticDiffPage,
  VersionStoreDiagnostic as PublicVersionStoreDiagnostic,
  VersionSurfaceStatus,
  VersionWorkingTreeDiffId,
  VersionWorkingTreeDiffOptions,
  WorkbookCommitId,
  WorkbookCommitRef,
} from '@mog-sdk/contracts/api';
import {
  VERSION_DIFF_PAGE_ORDER,
  VERSION_DIFF_PUBLIC_CURSOR_MAX_LENGTH,
  VERSION_DIFF_PUBLIC_CURSOR_PREFIX,
  VERSION_DIFF_RESOURCE_LIMITS,
  isPublicVersionDiffCursor,
} from '@mog-sdk/contracts/versioning';

import {
  canonicalJsonStringify,
  sha256ObjectDigest,
  utf8Encode,
} from './object-store-canonical';
import type { VersionStoreProvider } from './provider';
import type {
  SemanticMutationCaptureServices,
  SemanticMutationCaptureWorkingTreeBasis,
} from './semantic-mutation-capture';
import type { VersionSemanticStateReaderPort } from './semantic-state-reader';
import type { SemanticWorkbookStateEnvelope } from '../../bridges/compute/compute-types.gen';
import {
  degradedDiffPage,
  diagnostic,
  type DiffServiceDegradedResult,
  type DiffServiceDiagnostic,
} from './diff-service-diagnostics';
import { pageStartOffset, type MappedSemanticDiffEntry } from './diff-service-order-key';
import { parseDiffOptions } from './diff-service-pagination';
import { mapSemanticChangeSet } from './diff-service-semantic-mapping';

const VERSION_WORKING_TREE_CURSOR_CACHE_MAX_ENTRIES = 512;

export type WorkbookVersionWorkingTreeDiffServiceOptions = {
  readonly provider: VersionStoreProvider;
  readonly semanticMutationCapture: SemanticMutationCaptureServices;
  readonly semanticStateReader: VersionSemanticStateReaderPort;
  readonly readSurfaceStatus: () => Promise<VersionSurfaceStatus>;
  readonly readActiveCheckoutHead: () => Promise<WorkingTreeActiveCheckoutHeadResolution>;
};

export type WorkingTreeActiveCheckoutHeadResolution =
  | { readonly status: 'absent' }
  | {
      readonly status: 'resolved';
      readonly session: {
        readonly checkedOutCommitId: string;
        readonly branchName?: string;
        readonly refHeadAtMaterialization?: string;
        readonly detached: boolean;
      };
      readonly head: WorkbookCommitRef;
    }
  | {
      readonly status: 'degraded';
      readonly session?: {
        readonly checkedOutCommitId: string;
        readonly branchName?: string;
        readonly refHeadAtMaterialization?: string;
        readonly detached: boolean;
      };
      readonly result: VersionDegradedHeadResult;
    };

type WorkingTreeDiffSuccessPage = {
  readonly status: 'success';
  readonly kind: 'workingTree';
  readonly workingTreeDiffId: VersionWorkingTreeDiffId;
  readonly baseCommitId: WorkbookCommitId;
  readonly targetRef?: VersionMainRefName | VersionRefName;
  readonly captureRevision: number;
  readonly dirtyStatusRevision: string;
  readonly checkoutPreflightToken: string;
  readonly baseSemanticStateDigest: ObjectDigest;
  readonly currentSemanticStateDigest: ObjectDigest;
  readonly items: readonly VersionDiffEntry[];
  readonly nextPageToken?: VersionPageToken;
  readonly readRevision: VersionSemanticDiffPage['readRevision'];
  readonly order: VersionSemanticDiffPage['order'];
  readonly diagnostics: readonly (PublicVersionStoreDiagnostic | DiffServiceDiagnostic)[];
  readonly resourceLimits?: VersionSemanticDiffPage['resourceLimits'];
};

export type WorkbookVersionWorkingTreeDiffPage =
  | WorkingTreeDiffSuccessPage
  | DiffServiceDegradedResult;

type WorkingTreeObservation = {
  readonly surface: VersionSurfaceStatus;
  readonly active: Extract<WorkingTreeActiveCheckoutHeadResolution, { readonly status: 'resolved' }>;
  readonly basis: SemanticMutationCaptureWorkingTreeBasis;
  readonly currentSemanticState: SemanticWorkbookStateEnvelope;
  readonly baseSemanticStateDigest: ObjectDigest;
  readonly currentSemanticStateDigest: ObjectDigest;
  readonly targetRef?: VersionMainRefName | VersionRefName;
};

type WorkingTreeIdentity = {
  readonly workingTreeDiffId: VersionWorkingTreeDiffId;
  readonly accessFingerprint: string;
};

type WorkingTreeCursorCacheEntry = {
  readonly workingTreeDiffId: VersionWorkingTreeDiffId;
  readonly offset: number;
};

const PUBLIC_WORKING_TREE_CURSOR_CACHE = new Map<string, WorkingTreeCursorCacheEntry>();
let publicWorkingTreeCursorSequence = 0;

export class WorkbookVersionWorkingTreeDiffService {
  private readonly provider: VersionStoreProvider;
  private readonly semanticMutationCapture: SemanticMutationCaptureServices;
  private readonly semanticStateReader: VersionSemanticStateReaderPort;
  private readonly readSurfaceStatus: () => Promise<VersionSurfaceStatus>;
  private readonly readActiveCheckoutHead: () => Promise<WorkingTreeActiveCheckoutHeadResolution>;

  constructor(options: WorkbookVersionWorkingTreeDiffServiceOptions) {
    this.provider = options.provider;
    this.semanticMutationCapture = options.semanticMutationCapture;
    this.semanticStateReader = options.semanticStateReader;
    this.readSurfaceStatus = options.readSurfaceStatus;
    this.readActiveCheckoutHead = options.readActiveCheckoutHead;
  }

  async diffWorkingTree(
    options: VersionWorkingTreeDiffOptions = {},
  ): Promise<WorkbookVersionWorkingTreeDiffPage> {
    if (options.base !== undefined && options.base !== 'activeCheckoutHead') {
      return degradedDiffPage([
        diagnostic(
          'VERSION_INVALID_OPTIONS',
          'working-tree diff base must be the active checkout head.',
          {
            details: { option: 'base' },
          },
        ),
      ]);
    }

    const parsedOptions = parseDiffOptions(options);
    if (parsedOptions.diagnostics.length > 0) {
      return degradedDiffPage(parsedOptions.diagnostics);
    }

    const observation = await this.readObservation();
    if (!observation.ok) return degradedDiffPage(observation.diagnostics);

    const blockingDiagnostics = workingTreeBlockingDiagnostics(observation.observation);
    if (blockingDiagnostics.length > 0) return degradedDiffPage(blockingDiagnostics);

    const identity = await this.workingTreeIdentity(observation.observation);
    const pageToken = parseWorkingTreePageToken(
      parsedOptions.options.pageToken,
      identity.workingTreeDiffId,
    );
    if (!pageToken.ok) return degradedDiffPage(pageToken.diagnostics);

    const entries = await this.entriesForObservation(observation.observation);
    if (!entries.ok) return degradedDiffPage(entries.diagnostics);

    const offset = pageStartOffset(entries.items, { kind: 'offset', offset: pageToken.offset });
    const pageEntries = entries.items.slice(offset, offset + parsedOptions.options.pageSize);
    const pageItems = pageEntries.map((item) => item.entry);
    const nextOffset = offset + pageEntries.length;
    const nextPageToken =
      nextOffset < entries.items.length
        ? publicWorkingTreePageTokenFor({
            workingTreeDiffId: identity.workingTreeDiffId,
            offset: nextOffset,
          })
        : undefined;

    const finalObservation = await this.readObservation();
    if (!finalObservation.ok) return degradedDiffPage(finalObservation.diagnostics);
    if (!sameWorkingTreeObservation(observation.observation, finalObservation.observation)) {
      return degradedDiffPage([
        diagnostic(
          'VERSION_WORKING_TREE_DIFF_STALE',
          'Working-tree diff state changed while the page was being read.',
          {
            recoverability: 'retry',
            details: {
              category: 'midRequestStateChanged',
            },
          },
        ),
      ]);
    }

    return {
      status: 'success',
      kind: 'workingTree',
      workingTreeDiffId: identity.workingTreeDiffId,
      baseCommitId: observation.observation.active.head.id,
      ...(observation.observation.targetRef ? { targetRef: observation.observation.targetRef } : {}),
      captureRevision: observation.observation.basis.revision,
      dirtyStatusRevision: observation.observation.surface.dirty.statusRevision,
      checkoutPreflightToken: observation.observation.surface.dirty.checkoutPreflightToken,
      baseSemanticStateDigest: observation.observation.baseSemanticStateDigest,
      currentSemanticStateDigest: observation.observation.currentSemanticStateDigest,
      items: pageItems,
      ...(nextPageToken ? { nextPageToken } : {}),
      readRevision: {
        kind: 'opaque',
        value: identity.workingTreeDiffId,
      },
      order: VERSION_DIFF_PAGE_ORDER,
      diagnostics: [],
    };
  }

  private async readObservation(): Promise<
    | { readonly ok: true; readonly observation: WorkingTreeObservation }
    | { readonly ok: false; readonly diagnostics: readonly DiffServiceDiagnostic[] }
  > {
    let surface: VersionSurfaceStatus;
    let active: WorkingTreeActiveCheckoutHeadResolution;
    let currentSemanticState: SemanticWorkbookStateEnvelope;
    try {
      surface = await this.readSurfaceStatus();
      active = await this.readActiveCheckoutHead();
      currentSemanticState = await this.semanticStateReader.readCurrentSemanticState();
    } catch (error) {
      return {
        ok: false,
        diagnostics: [
          diagnostic(
            'VERSION_WORKING_TREE_DIFF_UNAVAILABLE',
            error instanceof Error ? error.message : 'Working-tree diff state read failed.',
            {
              recoverability: 'retry',
              details: { category: 'stateReadFailed' },
            },
          ),
        ],
      };
    }

    if (active.status !== 'resolved') {
      return {
        ok: false,
        diagnostics: [
          diagnostic(
            'VERSION_WORKING_TREE_DIFF_UNAVAILABLE',
            active.status === 'absent'
              ? 'Working-tree diff requires an active checkout base commit.'
              : 'Active checkout HEAD could not be resolved for working-tree diff.',
            {
              recoverability: 'retry',
              details: {
                category: active.status === 'absent' ? 'activeCheckoutAbsent' : 'activeHeadDegraded',
                ...(active.status === 'degraded'
                  ? { sourceDiagnosticCount: active.result.diagnostics.length }
                  : {}),
              },
            },
          ),
        ],
      };
    }

    const basis = this.semanticMutationCapture.readWorkingTreeBasis();
    const baseSemanticStateDigest =
      surface.dirty.hasUncommittedLocalChanges && basis.beforeSemanticState
        ? publicObjectDigest(basis.beforeSemanticState.stateDigest)
        : publicObjectDigest(currentSemanticState.stateDigest);
    const targetRef = active.session.detached ? undefined : active.head.refName;

    return {
      ok: true,
      observation: {
        surface,
        active,
        basis,
        currentSemanticState,
        baseSemanticStateDigest,
        currentSemanticStateDigest: publicObjectDigest(currentSemanticState.stateDigest),
        ...(targetRef ? { targetRef } : {}),
      },
    };
  }

  private async entriesForObservation(
    observation: WorkingTreeObservation,
  ): Promise<
    | {
        readonly ok: true;
        readonly items: readonly MappedSemanticDiffEntry[];
      }
    | { readonly ok: false; readonly diagnostics: readonly DiffServiceDiagnostic[] }
  > {
    if (!observation.surface.dirty.hasUncommittedLocalChanges) {
      return { ok: true, items: [] };
    }

    const beforeSemanticState = observation.basis.beforeSemanticState;
    if (!beforeSemanticState) {
      return {
        ok: false,
        diagnostics: [
          diagnostic(
            'VERSION_WORKING_TREE_DIFF_UNAVAILABLE',
            'Working-tree diff requires a captured semantic preimage.',
            {
              details: { category: 'semanticPreimageMissing' },
            },
          ),
        ],
      };
    }

    let semanticDiff: Awaited<ReturnType<VersionSemanticStateReaderPort['diffSemanticStates']>>;
    try {
      semanticDiff = await this.semanticStateReader.diffSemanticStates(
        beforeSemanticState.state,
        observation.currentSemanticState.state,
      );
    } catch (error) {
      return {
        ok: false,
        diagnostics: [
          diagnostic(
            'VERSION_WORKING_TREE_DIFF_UNAVAILABLE',
            error instanceof Error ? error.message : 'Working-tree semantic diff failed.',
            {
              recoverability: 'retry',
              details: { category: 'semanticDiffFailed' },
            },
          ),
        ],
      };
    }

    if (
      !sameDigest(semanticDiff.beforeDigest, beforeSemanticState.stateDigest) ||
      !sameDigest(semanticDiff.afterDigest, observation.currentSemanticState.stateDigest)
    ) {
      return {
        ok: false,
        diagnostics: [
          diagnostic(
            'VERSION_WORKING_TREE_DIFF_DIGEST_MISMATCH',
            'Working-tree semantic diff digests did not match the captured states.',
            {
              recoverability: 'retry',
              details: {
                category: 'semanticDigestMismatch',
                beforeDigestMatches: sameDigest(
                  semanticDiff.beforeDigest,
                  beforeSemanticState.stateDigest,
                ),
                afterDigestMatches: sameDigest(
                  semanticDiff.afterDigest,
                  observation.currentSemanticState.stateDigest,
                ),
              },
            },
          ),
        ],
      };
    }

    const entries = mapSemanticChangeSet({
      schemaVersion: 1,
      source: {
        kind: 'rustSemanticDiff',
        beforeStateDigest: semanticDiff.beforeDigest,
        afterStateDigest: semanticDiff.afterDigest,
      },
      changes: semanticDiff.changes,
      semanticDiff,
    });
    return entries.ok ? entries : { ok: false, diagnostics: entries.diagnostics };
  }

  private async workingTreeIdentity(
    observation: WorkingTreeObservation,
  ): Promise<WorkingTreeIdentity> {
    const accessFingerprint = canonicalJsonStringify({
      principalScope: this.provider.accessContext.principalScope ?? null,
      capabilityIds: [...(this.provider.accessContext.capabilityIds ?? [])].sort(),
      diagnosticsAllowed: this.provider.accessContext.diagnosticsAllowed ?? null,
    });
    const identityDigest = await sha256ObjectDigest(
      utf8Encode(
        canonicalJsonStringify({
          schemaVersion: 1,
          kind: 'workingTreeDiff',
          documentScope: this.provider.documentScope,
          accessFingerprint,
          activeCheckout: activeCheckoutIdentity(observation.active),
          dirtyStatusRevision: observation.surface.dirty.statusRevision,
          checkoutPreflightToken: observation.surface.dirty.checkoutPreflightToken,
          captureRevision: observation.basis.revision,
          baseSemanticStateDigest: observation.baseSemanticStateDigest,
          currentSemanticStateDigest: observation.currentSemanticStateDigest,
        }),
      ),
    );
    return {
      accessFingerprint,
      workingTreeDiffId:
        `working-tree-diff:sha256:${identityDigest.digest}` as VersionWorkingTreeDiffId,
    };
  }
}

function workingTreeBlockingDiagnostics(
  observation: WorkingTreeObservation,
): readonly DiffServiceDiagnostic[] {
  const diagnostics: DiffServiceDiagnostic[] = [];
  const dirty = observation.surface.dirty;
  const hasDirtyChanges = dirty.hasUncommittedLocalChanges;

  if (observation.surface.current.stale) {
    diagnostics.push(
      diagnostic(
        'VERSION_WORKING_TREE_DIFF_STALE',
        'Working-tree diff is blocked while the active checkout is stale.',
        {
          recoverability: 'retry',
          details: {
            category: 'activeCheckoutStale',
            staleReason: observation.surface.current.staleReason ?? null,
          },
        },
      ),
    );
  }

  if (dirty.pendingProviderWrites) {
    diagnostics.push(
      diagnostic(
        'VERSION_WORKING_TREE_DIFF_PENDING_WRITES',
        'Working-tree diff is blocked while version provider writes are pending.',
        {
          recoverability: 'retry',
          details: { category: 'pendingProviderWrites' },
        },
      ),
    );
  }
  if (dirty.pendingRecalc) {
    diagnostics.push(
      diagnostic(
        'VERSION_WORKING_TREE_DIFF_PENDING_RECALC',
        'Working-tree diff is blocked until workbook recalculation is settled.',
        {
          recoverability: 'retry',
          details: { category: 'pendingRecalc' },
        },
      ),
    );
  }

  const liveCollaboration = dirty.liveCollaboration;
  if (
    liveCollaboration &&
    (liveCollaboration.state === 'active' ||
      liveCollaboration.state === 'unknown' ||
      (liveCollaboration.inFlightRemoteUpdateCount ?? 0) > 0 ||
      (liveCollaboration.syncApplyRemoteQueueDepth ?? 0) > 0)
  ) {
    diagnostics.push(
      diagnostic(
        'VERSION_WORKING_TREE_DIFF_LIVE_COLLABORATION',
        'Working-tree diff is blocked while live collaboration state is ambiguous.',
        {
          recoverability: 'retry',
          details: {
            category: 'liveCollaboration',
            state: liveCollaboration.state,
            inFlightRemoteUpdateCount: liveCollaboration.inFlightRemoteUpdateCount ?? 0,
            syncApplyRemoteQueueDepth: liveCollaboration.syncApplyRemoteQueueDepth ?? 0,
          },
        },
      ),
    );
  }

  if (!hasDirtyChanges && observation.basis.hasPendingNormalMutations) {
    diagnostics.push(
      diagnostic(
        'VERSION_WORKING_TREE_DIFF_STALE',
        'Working-tree dirty status does not match the semantic capture buffer.',
        {
          recoverability: 'retry',
          details: {
            category: 'dirtyStatusCaptureMismatch',
            pendingCapturedNormalMutationCount:
              observation.basis.pendingCapturedNormalMutationCount,
            pendingUncapturedNormalMutationCount:
              observation.basis.pendingUncapturedNormalMutationCount,
          },
        },
      ),
    );
  }

  if (hasDirtyChanges && observation.basis.semanticStateCaptureFailure) {
    diagnostics.push(
      diagnostic(
        'VERSION_WORKING_TREE_DIFF_UNAVAILABLE',
        observation.basis.semanticStateCaptureFailure,
        {
          recoverability: 'retry',
          details: { category: 'semanticPreimageCaptureFailed' },
        },
      ),
    );
  }

  if (hasDirtyChanges && observation.basis.hasUncapturedNormalMutations) {
    const first = observation.basis.pendingUncapturedNormalMutationSummaries[0];
    diagnostics.push(
      diagnostic(
        'VERSION_WORKING_TREE_DIFF_UNCAPTURED',
        'Working-tree diff is blocked by local mutations that were not semantically captured.',
        {
          details: {
            category: 'uncapturedNormalMutation',
            pendingUncapturedNormalMutationCount:
              observation.basis.pendingUncapturedNormalMutationCount,
            ...(first
              ? {
                  firstOperation: first.operation,
                  firstReason: first.reason,
                }
              : {}),
          },
        },
      ),
    );
  }

  if (
    hasDirtyChanges &&
    observation.basis.pendingCapturedNormalMutationCount === 0 &&
    observation.basis.pendingUncapturedNormalMutationCount === 0
  ) {
    diagnostics.push(
      diagnostic(
        'VERSION_WORKING_TREE_DIFF_UNAVAILABLE',
        'Working-tree diff has dirty workbook state but no captured mutation basis.',
        {
          recoverability: 'retry',
          details: { category: 'semanticBasisMissing' },
        },
      ),
    );
  }

  if (hasDirtyChanges && !observation.basis.beforeSemanticState) {
    diagnostics.push(
      diagnostic(
        'VERSION_WORKING_TREE_DIFF_UNAVAILABLE',
        'Working-tree diff requires a captured semantic preimage.',
        {
          recoverability: 'retry',
          details: { category: 'semanticPreimageMissing' },
        },
      ),
    );
  }

  return diagnostics;
}

function sameWorkingTreeObservation(left: WorkingTreeObservation, right: WorkingTreeObservation): boolean {
  return (
    left.surface.current.headCommitId === right.surface.current.headCommitId &&
    left.surface.current.checkedOutCommitId === right.surface.current.checkedOutCommitId &&
    left.surface.current.currentRefHeadId === right.surface.current.currentRefHeadId &&
    left.surface.current.refHeadAtMaterialization === right.surface.current.refHeadAtMaterialization &&
    left.surface.current.branchName === right.surface.current.branchName &&
    left.surface.current.detached === right.surface.current.detached &&
    left.surface.current.stale === right.surface.current.stale &&
    left.surface.dirty.statusRevision === right.surface.dirty.statusRevision &&
    left.surface.dirty.checkoutPreflightToken === right.surface.dirty.checkoutPreflightToken &&
    left.surface.dirty.hasUncommittedLocalChanges ===
      right.surface.dirty.hasUncommittedLocalChanges &&
    left.basis.revision === right.basis.revision &&
    left.basis.pendingCapturedNormalMutationCount ===
      right.basis.pendingCapturedNormalMutationCount &&
    left.basis.pendingUncapturedNormalMutationCount ===
      right.basis.pendingUncapturedNormalMutationCount &&
    left.basis.semanticStateCaptureFailure === right.basis.semanticStateCaptureFailure &&
    sameOptionalDigest(left.basis.beforeSemanticState?.stateDigest, right.basis.beforeSemanticState?.stateDigest) &&
    sameDigest(left.currentSemanticStateDigest, right.currentSemanticStateDigest) &&
    sameActiveCheckoutIdentity(left.active, right.active)
  );
}

function sameActiveCheckoutIdentity(
  left: Extract<WorkingTreeActiveCheckoutHeadResolution, { readonly status: 'resolved' }>,
  right: Extract<WorkingTreeActiveCheckoutHeadResolution, { readonly status: 'resolved' }>,
): boolean {
  return canonicalJsonStringify(activeCheckoutIdentity(left)) === canonicalJsonStringify(activeCheckoutIdentity(right));
}

function activeCheckoutIdentity(
  active: Extract<WorkingTreeActiveCheckoutHeadResolution, { readonly status: 'resolved' }>,
): Readonly<Record<string, unknown>> {
  return {
    checkedOutCommitId: active.session.checkedOutCommitId,
    branchName: active.session.branchName ?? null,
    refHeadAtMaterialization: active.session.refHeadAtMaterialization ?? null,
    detached: active.session.detached,
    headCommitId: active.head.id,
    headRefName: active.head.refName ?? null,
    headResolvedFrom: active.head.resolvedFrom ?? null,
    headRefRevision: active.head.refRevision ?? null,
  };
}

function parseWorkingTreePageToken(
  token: VersionPageToken | string | undefined,
  workingTreeDiffId: VersionWorkingTreeDiffId,
):
  | { readonly ok: true; readonly offset: number }
  | { readonly ok: false; readonly diagnostics: readonly DiffServiceDiagnostic[] } {
  if (token === undefined) return { ok: true, offset: 0 };
  if (typeof token !== 'string') {
    return staleWorkingTreeCursor('diff pageToken is malformed or unsupported.', {
      category: 'malformedCursor',
    });
  }
  if (token.length > VERSION_DIFF_PUBLIC_CURSOR_MAX_LENGTH) {
    return staleWorkingTreeCursor('diff pageToken exceeds the public cursor size limit.', {
      category: 'oversizedCursor',
      max: VERSION_DIFF_RESOURCE_LIMITS.maxPublicCursorBytes,
      receivedCursorBytes: token.length,
    });
  }
  if (!isPublicVersionDiffCursor(token)) {
    return staleWorkingTreeCursor('diff pageToken uses an unsupported public cursor order or version.', {
      category: 'unsupportedCursor',
    });
  }
  const entry = PUBLIC_WORKING_TREE_CURSOR_CACHE.get(token);
  if (!entry) {
    return staleWorkingTreeCursor('diff pageToken is stale or no longer available.', {
      category: 'staleCursor',
    });
  }
  if (entry.workingTreeDiffId !== workingTreeDiffId) {
    return staleWorkingTreeCursor('diff pageToken does not match this working-tree diff request.', {
      category: 'identityMismatch',
    });
  }
  return { ok: true, offset: entry.offset };
}

function staleWorkingTreeCursor(
  safeMessage: string,
  details: Readonly<Record<string, string | number | boolean | null>>,
): { readonly ok: false; readonly diagnostics: readonly DiffServiceDiagnostic[] } {
  return {
    ok: false,
    diagnostics: [
      diagnostic('VERSION_STALE_PAGE_CURSOR', safeMessage, {
        recoverability: 'retry',
        details,
      }),
    ],
  };
}

function publicWorkingTreePageTokenFor(entry: WorkingTreeCursorCacheEntry): VersionPageToken {
  evictPublicWorkingTreeCursorCache();
  const publicToken =
    `${VERSION_DIFF_PUBLIC_CURSOR_PREFIX}${nextPublicWorkingTreeCursorHandle()}` as VersionPageToken;
  PUBLIC_WORKING_TREE_CURSOR_CACHE.set(publicToken, entry);
  return publicToken;
}

function nextPublicWorkingTreeCursorHandle(): string {
  publicWorkingTreeCursorSequence =
    (publicWorkingTreeCursorSequence + 1) % Number.MAX_SAFE_INTEGER;
  return `wt.${randomCursorSegment()}.${Date.now().toString(36)}.${publicWorkingTreeCursorSequence.toString(36)}`;
}

function randomCursorSegment(): string {
  const bytes = new Uint8Array(16);
  const cryptoLike = (
    globalThis as { readonly crypto?: { getRandomValues?: <T extends Uint8Array>(array: T) => T } }
  ).crypto;
  if (cryptoLike?.getRandomValues) {
    cryptoLike.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index++) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function evictPublicWorkingTreeCursorCache(): void {
  while (PUBLIC_WORKING_TREE_CURSOR_CACHE.size >= VERSION_WORKING_TREE_CURSOR_CACHE_MAX_ENTRIES) {
    const oldest = PUBLIC_WORKING_TREE_CURSOR_CACHE.keys().next().value;
    if (!oldest) return;
    PUBLIC_WORKING_TREE_CURSOR_CACHE.delete(oldest);
  }
}

function publicObjectDigest(value: unknown): ObjectDigest {
  const record = isRecord(value) ? value : {};
  const algorithm = record.algorithm === 'sha256' ? 'sha256' : 'sha256';
  const digest =
    typeof record.digest === 'string'
      ? record.digest
      : typeof record.value === 'string'
        ? record.value
        : '';
  return {
    algorithm,
    digest,
    ...(typeof record.byteLength === 'number' ? { byteLength: record.byteLength } : {}),
  };
}

function sameOptionalDigest(left: unknown, right: unknown): boolean {
  if (!left || !right) return left === right;
  return sameDigest(left, right);
}

function sameDigest(left: unknown, right: unknown): boolean {
  return digestKey(left) === digestKey(right);
}

function digestKey(value: unknown): string {
  if (!isRecord(value)) return '';
  const algorithm = typeof value.algorithm === 'string' ? value.algorithm : '';
  const digest =
    typeof value.digest === 'string'
      ? value.digest
      : typeof value.value === 'string'
        ? value.value
        : '';
  return `${algorithm}:${digest}`;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

export function createWorkbookVersionWorkingTreeDiffService(
  options: WorkbookVersionWorkingTreeDiffServiceOptions,
): WorkbookVersionWorkingTreeDiffService {
  return new WorkbookVersionWorkingTreeDiffService(options);
}
