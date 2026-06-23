import type {
  VersionDiffValue,
  VersionMergeChange,
  VersionMergeConflict,
  VersionMergeInput,
  VersionMergeOptions,
  VersionMergeResult,
  VersionStoreDiagnostic as PublicVersionStoreDiagnostic,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import type { WorkbookCommit } from './commit-store';
import { resolveVersionMergeBase, type VersionMergeBaseCommitRead } from './merge-base-resolution';
import {
  compareMergeChanges,
  compareMergeConflicts,
  mergeStableStructuralMetadata,
  stableMergeConflictIdentity,
  stableMergeResolutionOptions,
} from './merge-preview-evidence';
import { VersionObjectStoreError } from './object-store';
import { persistMergeAttemptIfRequested } from './merge-service-persistence';
import {
  VersionStoreProviderError,
  type VersionGraphStore,
  type VersionStoreDiagnostic,
  type VersionStoreProvider,
} from './provider';
import { namespaceForRegistry } from './registry';
import type { VersionGraphNamespace } from './object-store';
import {
  parseSemanticChangeSet,
  stableMergePairStructural,
  type SemanticValueChange,
} from './merge-service-semantic-records';

type MergeDiagnostic = PublicVersionStoreDiagnostic;

type MergeCommitRead = VersionMergeBaseCommitRead;

export type WorkbookVersionMergeServiceOptions = {
  readonly provider: VersionStoreProvider;
};

export class WorkbookVersionMergeService {
  private readonly provider: VersionStoreProvider;

  constructor(options: WorkbookVersionMergeServiceOptions) {
    this.provider = options.provider;
  }

  async merge(
    input: VersionMergeInput,
    options: VersionMergeOptions = {},
  ): Promise<VersionMergeResult> {
    if (options.mode !== undefined && options.mode !== 'preview') {
      return blocked(input, [
        diagnostic('VERSION_INVALID_OPTIONS', 'merge supports only preview mode.', {
          payload: { option: 'mode' },
        }),
      ]);
    }

    const opened = await this.openVisibleGraph();
    if (!opened.ok) return blocked(input, opened.diagnostics);

    const ours = await readPreviewCommit(opened.graph, input.ours, 'ours');
    if (!ours.ok) return blocked(input, ours.diagnostics);
    const theirs = await readPreviewCommit(opened.graph, input.theirs, 'theirs');
    if (!theirs.ok) return blocked(input, theirs.diagnostics);

    const mergeBase = resolveVersionMergeBase(input, ours.commit, theirs.commit);
    if (mergeBase.status === 'alreadyMerged') {
      return persistMergeAttemptIfRequested({
        provider: this.provider,
        graph: opened.graph,
        namespace: opened.namespace,
        result: alreadyMerged(input),
        options,
      });
    }
    if (mergeBase.status === 'fastForward') {
      return persistMergeAttemptIfRequested({
        provider: this.provider,
        graph: opened.graph,
        namespace: opened.namespace,
        result: fastForward(input),
        options,
      });
    }
    if (mergeBase.status === 'blocked') return blocked(input, [mergeBase.diagnostic]);

    const oursAncestry = directChildDiagnostic(input.base, ours.commit.commit, 'ours');
    if (oursAncestry) return blocked(input, [oursAncestry]);
    const theirsAncestry = directChildDiagnostic(input.base, theirs.commit.commit, 'theirs');
    if (theirsAncestry) return blocked(input, [theirsAncestry]);

    const oursPayload = await readSemanticChangeSet(opened.graph, ours.commit.commit);
    if (!oursPayload.ok) return blocked(input, oursPayload.diagnostics);
    const theirsPayload = await readSemanticChangeSet(opened.graph, theirs.commit.commit);
    if (!theirsPayload.ok) return blocked(input, theirsPayload.diagnostics);

    const oursChanges = parseSemanticChangeSet(oursPayload.payload, 'ours');
    if (!oursChanges.ok) return blocked(input, oursChanges.diagnostics);
    const theirsChanges = parseSemanticChangeSet(theirsPayload.payload, 'theirs');
    if (!theirsChanges.ok) return blocked(input, theirsChanges.diagnostics);

    let classified: Awaited<ReturnType<typeof classifyValueChanges>>;
    try {
      classified = await classifyValueChanges(oursChanges.changes, theirsChanges.changes);
    } catch {
      return blocked(input, [
        diagnostic(
          'VERSION_PROVIDER_ERROR',
          'Merge preview failed before producing stable public conflict evidence.',
          {
            severity: 'fatal',
            recoverability: 'retry',
          },
        ),
      ]);
    }
    if (!classified.ok) return blocked(input, classified.diagnostics);

    if (classified.conflicts.length > 0) {
      return persistMergeAttemptIfRequested({
        provider: this.provider,
        graph: opened.graph,
        namespace: opened.namespace,
        result: {
          status: 'conflicted',
          base: input.base,
          ours: input.ours,
          theirs: input.theirs,
          changes: classified.changes,
          conflicts: classified.conflicts,
          diagnostics: [],
          mutationGuarantee: 'preview-only',
        },
        options,
      });
    }

    return persistMergeAttemptIfRequested({
      provider: this.provider,
      graph: opened.graph,
      namespace: opened.namespace,
      result: {
        status: 'clean',
        base: input.base,
        ours: input.ours,
        theirs: input.theirs,
        changes: classified.changes,
        conflicts: [],
        diagnostics: [],
        mutationGuarantee: 'preview-only',
      },
      options,
    });
  }

  private async openVisibleGraph(): Promise<
    | {
        readonly ok: true;
        readonly namespace: VersionGraphNamespace;
        readonly graph: VersionGraphStore;
      }
    | {
        readonly ok: false;
        readonly diagnostics: readonly MergeDiagnostic[];
      }
  > {
    try {
      const registryRead = await this.provider.readGraphRegistry();
      if (registryRead.status !== 'ok') {
        return { ok: false, diagnostics: graphDiagnostics(registryRead.diagnostics) };
      }

      const namespace = namespaceForRegistry(registryRead.registry);
      const graph = await this.provider.openGraph(namespace, this.provider.accessContext);
      return { ok: true, namespace, graph };
    } catch (error) {
      if (error instanceof VersionStoreProviderError) {
        return { ok: false, diagnostics: graphDiagnostics(error.diagnostics) };
      }
      return {
        ok: false,
        diagnostics: [
          diagnostic(
            'VERSION_PROVIDER_ERROR',
            'Version store provider failed before returning graph state.',
            {
              severity: 'fatal',
              recoverability: 'retry',
            },
          ),
        ],
      };
    }
  }
}

export function createWorkbookVersionMergeService(
  options: WorkbookVersionMergeServiceOptions,
): WorkbookVersionMergeService {
  return new WorkbookVersionMergeService(options);
}

async function readPreviewCommit(
  graph: VersionGraphStore,
  commitId: WorkbookCommitId,
  branch: 'ours' | 'theirs',
): Promise<
  | { readonly ok: true; readonly commit: MergeCommitRead }
  | { readonly ok: false; readonly diagnostics: readonly MergeDiagnostic[] }
> {
  const closure = await graph.readCommitClosure(commitId);
  if (closure.status !== 'success') {
    return { ok: false, diagnostics: graphDiagnostics(closure.diagnostics, { branch }) };
  }

  const commit = closure.commits.find((candidate) => candidate.id === commitId);
  if (!commit) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          'VERSION_UNMATERIALIZABLE_COMMIT',
          'Merge commit is absent from its readable commit closure.',
          { payload: { branch } },
        ),
      ],
    };
  }

  return { ok: true, commit: { commit, closure: closure.commits } };
}

function directChildDiagnostic(
  baseCommitId: WorkbookCommitId,
  commit: WorkbookCommit,
  branch: 'ours' | 'theirs',
): MergeDiagnostic | null {
  if (
    commit.payload.parentCommitIds.length === 1 &&
    commit.payload.parentCommitIds[0] === baseCommitId
  ) {
    return null;
  }

  return diagnostic(
    'VERSION_MERGE_UNSUPPORTED_ANCESTRY',
    'Merge preview requires non-ancestral divergent commits to be direct children of base.',
    {
      payload: {
        branch,
        parentCount: commit.payload.parentCommitIds.length,
        parentMatchesBase: commit.payload.parentCommitIds[0] === baseCommitId,
      },
    },
  );
}

function fastForward(input: VersionMergeInput): VersionMergeResult {
  return {
    status: 'fastForward',
    base: input.base,
    ours: input.ours,
    theirs: input.theirs,
    changes: [],
    conflicts: [],
    diagnostics: [],
    mutationGuarantee: 'preview-only',
  };
}

function alreadyMerged(input: VersionMergeInput): VersionMergeResult {
  return {
    status: 'alreadyMerged',
    base: input.base,
    ours: input.ours,
    theirs: input.theirs,
    changes: [],
    conflicts: [],
    diagnostics: [],
    mutationGuarantee: 'preview-only',
  };
}

async function readSemanticChangeSet(
  graph: VersionGraphStore,
  commit: WorkbookCommit,
): Promise<
  | { readonly ok: true; readonly payload: unknown }
  | { readonly ok: false; readonly diagnostics: readonly MergeDiagnostic[] }
> {
  try {
    const record = await graph.getObjectRecord<unknown>({
      kind: 'object',
      objectType: 'workbook.semanticChangeSet.v1',
      digest: commit.payload.semanticChangeSetDigest,
    });
    return { ok: true, payload: record.preimage.payload };
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          error instanceof VersionObjectStoreError &&
            error.diagnostic.code === 'VERSION_OBJECT_NOT_FOUND'
            ? 'VERSION_MISSING_OBJECT'
            : 'VERSION_PROVIDER_ERROR',
          'Merge preview semantic change-set object could not be read.',
          {
            recoverability: error instanceof VersionObjectStoreError ? 'repair' : 'retry',
          },
        ),
      ],
    };
  }
}

async function classifyValueChanges(
  ours: readonly SemanticValueChange[],
  theirs: readonly SemanticValueChange[],
): Promise<
  | {
      readonly ok: true;
      readonly changes: readonly VersionMergeChange[];
      readonly conflicts: readonly VersionMergeConflict[];
    }
  | { readonly ok: false; readonly diagnostics: readonly MergeDiagnostic[] }
> {
  const changes: VersionMergeChange[] = [];
  const conflicts: VersionMergeConflict[] = [];
  const oursByKey = new Map(ours.map((change) => [change.key, change]));
  const consumedTheirs = new Set<string>();

  for (const oursChange of ours) {
    const theirsChange = theirs.find((candidate) => candidate.key === oursChange.key);
    if (!theirsChange) {
      changes.push({
        structural: oursChange.structural,
        base: oursChange.before,
        ours: oursChange.after,
        merged: oursChange.after,
        ...(oursChange.display ? { display: oursChange.display } : {}),
      });
      continue;
    }

    consumedTheirs.add(theirsChange.key);
    if (!semanticValuesEqual(oursChange.before, theirsChange.before)) {
      return {
        ok: false,
        diagnostics: [
          diagnostic(
            'VERSION_INVALID_COMMIT_PAYLOAD',
            'Merge preview found inconsistent base values for the same property.',
            { recoverability: 'repair' },
          ),
        ],
      };
    }

    const display = oursChange.display ?? theirsChange.display;
    const stablePairChange = {
      ...oursChange,
      structural: stableMergePairStructural(oursChange.structural, theirsChange.structural),
    };
    if (semanticValuesEqual(oursChange.after, theirsChange.after)) {
      changes.push({
        structural: await mergeStableStructuralMetadata(stablePairChange, theirsChange, 'clean'),
        base: oursChange.before,
        ours: oursChange.after,
        theirs: theirsChange.after,
        merged: oursChange.after,
        ...(display ? { display } : {}),
      });
      continue;
    }

    const structural = await mergeStableStructuralMetadata(
      stablePairChange,
      theirsChange,
      'conflict',
    );
    const identity = await stableMergeConflictIdentity(
      structural,
      oursChange.before,
      oursChange.after,
      theirsChange.after,
    );
    conflicts.push({
      conflictId: identity.conflictId,
      conflictDigest: identity.conflictDigest,
      conflictKind: 'same-property',
      structural,
      base: oursChange.before,
      ours: oursChange.after,
      theirs: theirsChange.after,
      resolutionOptions: await stableMergeResolutionOptions(
        identity,
        oursChange.before,
        oursChange.after,
        theirsChange.after,
      ),
      ...(display ? { display } : {}),
    });
  }

  for (const theirsChange of theirs) {
    if (oursByKey.has(theirsChange.key) || consumedTheirs.has(theirsChange.key)) continue;
    changes.push({
      structural: theirsChange.structural,
      base: theirsChange.before,
      theirs: theirsChange.after,
      merged: theirsChange.after,
      ...(theirsChange.display ? { display: theirsChange.display } : {}),
    });
  }

  changes.sort(compareMergeChanges);
  conflicts.sort(compareMergeConflicts);

  return { ok: true, changes, conflicts };
}

function semanticValuesEqual(left: VersionDiffValue, right: VersionDiffValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function blocked(
  input: VersionMergeInput,
  diagnostics: readonly MergeDiagnostic[],
): VersionMergeResult {
  return {
    status: 'blocked',
    base: input.base,
    ours: input.ours,
    theirs: input.theirs,
    changes: [],
    conflicts: [],
    diagnostics,
    mutationGuarantee: 'preview-only',
  };
}

function mergeInputFromResult(result: VersionMergeResult): VersionMergeInput | null {
  return result.base && result.ours && result.theirs
    ? { base: result.base, ours: result.ours, theirs: result.theirs }
    : null;
}

function graphDiagnostics(
  diagnostics: readonly unknown[],
  payload: Readonly<Record<string, string | number | boolean | null>> = {},
): readonly MergeDiagnostic[] {
  if (diagnostics.length === 0) {
    return [
      diagnostic(
        'VERSION_GRAPH_UNINITIALIZED',
        'The workbook version graph is not initialized for this document.',
        { recoverability: 'unsupported', payload },
      ),
    ];
  }
  return diagnostics.map((item) => {
    if (!isRecord(item)) {
      return diagnostic('VERSION_PROVIDER_ERROR', 'Version graph read failed.', {
        severity: 'fatal',
        recoverability: 'retry',
        payload,
      });
    }
    const issueCode = item.issueCode ?? item.code ?? 'VERSION_PROVIDER_ERROR';
    const severity = item.severity;
    return diagnostic(
      typeof issueCode === 'string' ? issueCode : 'VERSION_PROVIDER_ERROR',
      typeof item.safeMessage === 'string'
        ? item.safeMessage
        : typeof item.message === 'string'
          ? item.message
          : 'Version graph read failed.',
      {
        severity: severity === 'fatal' ? 'fatal' : severity === 'warning' ? 'warning' : 'error',
        recoverability: recoverabilityForIssue(
          typeof issueCode === 'string' ? issueCode : 'VERSION_PROVIDER_ERROR',
        ),
        payload,
      },
    );
  });
}

function diagnostic(
  issueCode: string,
  safeMessage: string,
  options: {
    readonly severity?: MergeDiagnostic['severity'];
    readonly recoverability?: MergeDiagnostic['recoverability'];
    readonly payload?: Readonly<Record<string, string | number | boolean | null>>;
  } = {},
): MergeDiagnostic {
  return {
    issueCode,
    severity: options.severity ?? (issueCode === 'VERSION_PROVIDER_ERROR' ? 'fatal' : 'error'),
    recoverability: options.recoverability ?? recoverabilityForIssue(issueCode),
    messageTemplateId: `version.merge.${issueCode}` as MergeDiagnostic['messageTemplateId'],
    safeMessage,
    ...(options.payload ? { payload: { operation: 'merge', ...options.payload } } : {}),
    redacted: true,
  };
}

function recoverabilityForIssue(issueCode: string): MergeDiagnostic['recoverability'] {
  switch (issueCode) {
    case 'VERSION_PROVIDER_ERROR':
    case 'VERSION_REF_CONFLICT':
    case 'VERSION_STALE_PAGE_CURSOR':
      return 'retry';
    case 'VERSION_DANGLING_REF':
    case 'VERSION_INVALID_COMMIT_PAYLOAD':
    case 'VERSION_MISSING_OBJECT':
    case 'VERSION_MISSING_PARENT':
    case 'VERSION_OBJECT_STORE_FAILURE':
      return 'repair';
    case 'VERSION_GRAPH_UNINITIALIZED':
    case 'VERSION_MERGE_UNSUPPORTED_ANCESTRY':
    case 'VERSION_MERGE_UNSUPPORTED_DOMAIN':
    case 'VERSION_PERMISSION_DENIED':
    case 'VERSION_REDACTION_VIOLATION':
    case 'VERSION_UNMATERIALIZABLE_COMMIT':
    case 'VERSION_UNSUPPORTED_SCHEMA':
      return 'unsupported';
    default:
      return 'none';
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
