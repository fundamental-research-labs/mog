import {
  objectDigestFromWorkbookCommitId,
  parseWorkbookCommitId,
  type WorkbookCommitId,
} from './object-digest';
import {
  createInMemoryVersionObjectStore,
  normalizeVersionGraphNamespace,
  versionGraphNamespaceKey,
  type InMemoryVersionObjectStore,
  type VersionGraphNamespace,
  type VersionObjectRecord,
  type VersionObjectStoreDiagnostic,
} from './object-store';
import {
  createInMemoryWorkbookCommitStore,
  type CreateWorkbookCommitInput,
  type InMemoryWorkbookCommitStore,
  type WorkbookCommit,
  type WorkbookCommitStoreDiagnostic,
} from './commit-store';
import {
  createInMemoryRefStore,
  refVersionsEqual,
  type InMemoryRefStore,
  type LiveRefRecord,
  type RefVersion,
  type VersionDiagnostic,
} from './ref-store';
import { parseVc04ParentCommitIds } from './commit-store-parents';

export const VERSION_GRAPH_MAIN_REF = 'refs/heads/main';

export type VersionGraphCommitContentInput = Omit<
  CreateWorkbookCommitInput,
  'documentId' | 'parentCommitIds'
>;

export type InitializeVersionGraphInput = VersionGraphCommitContentInput;

export type CommitVersionGraphInput = VersionGraphCommitContentInput & {
  readonly expectedHeadCommitId: WorkbookCommitId | string;
  readonly expectedMainRefVersion: RefVersion;
  readonly parentCommitIds?: readonly (WorkbookCommitId | string)[];
};

export type VersionGraphRef = {
  readonly name: typeof VERSION_GRAPH_MAIN_REF;
  readonly commitId: WorkbookCommitId;
  readonly revision: RefVersion;
  readonly updatedAt: string;
};

export type VersionGraphStoreDiagnosticCode =
  | 'VERSION_WRONG_NAMESPACE'
  | 'VERSION_MISSING_PARENT'
  | 'VERSION_REF_CONFLICT'
  | 'VERSION_UNSUPPORTED_PARENT_COMMIT'
  | 'VERSION_OBJECT_STORE_FAILURE'
  | 'VERSION_GRAPH_CONFLICT'
  | 'VERSION_GRAPH_UNINITIALIZED'
  | 'VERSION_INVALID_COMMIT_ID'
  | 'VERSION_INVALID_COMMIT_PAYLOAD'
  | 'VERSION_WRONG_DOCUMENT'
  | 'VERSION_MISSING_DEPENDENCY';

export type VersionGraphStoreDiagnostic = {
  readonly code: VersionGraphStoreDiagnosticCode;
  readonly severity: 'error' | 'corruption';
  readonly message: string;
  readonly refName?: typeof VERSION_GRAPH_MAIN_REF;
  readonly commitId?: WorkbookCommitId;
  readonly namespace?: VersionGraphNamespace;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
  readonly sourceDiagnostics?: readonly (
    | WorkbookCommitStoreDiagnostic
    | VersionDiagnostic
    | VersionObjectStoreDiagnostic
  )[];
};

export type VersionGraphWriteSuccess = {
  readonly status: 'success';
  readonly commit: WorkbookCommit;
  readonly main: VersionGraphRef;
  readonly diagnostics: readonly [];
};

export type VersionGraphWriteFailure = {
  readonly status: 'failed';
  readonly diagnostics: readonly VersionGraphStoreDiagnostic[];
  readonly mutationGuarantee: 'no-write-attempted' | 'ref-not-mutated';
};

export type VersionGraphWriteResult = VersionGraphWriteSuccess | VersionGraphWriteFailure;

export type VersionGraphClosureReadResult =
  | {
      readonly status: 'success';
      readonly commits: readonly WorkbookCommit[];
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: 'failed';
      readonly diagnostics: readonly VersionGraphStoreDiagnostic[];
    };

export type InMemoryVersionGraphStoreOptions = {
  readonly namespace: VersionGraphNamespace;
  readonly objectStore?: InMemoryVersionObjectStore;
  readonly commitStore?: InMemoryWorkbookCommitStore;
  readonly refStore?: InMemoryRefStore;
};

export class InMemoryVersionGraphStore {
  readonly namespace: VersionGraphNamespace;
  readonly objectStore: InMemoryVersionObjectStore;
  readonly commitStore: InMemoryWorkbookCommitStore;
  readonly refStore: InMemoryRefStore;

  private readonly namespaceKey: string;

  constructor(options: InMemoryVersionGraphStoreOptions) {
    this.namespace = normalizeVersionGraphNamespace(options.namespace);
    this.namespaceKey = versionGraphNamespaceKey(this.namespace);
    this.objectStore = options.objectStore ?? createInMemoryVersionObjectStore(this.namespace);
    this.commitStore = options.commitStore ?? createInMemoryWorkbookCommitStore(this.objectStore);
    this.refStore =
      options.refStore ?? createInMemoryRefStore({ versionDocumentId: this.namespace.documentId });
  }

  async initializeGraph(input: InitializeVersionGraphInput): Promise<VersionGraphWriteResult> {
    const namespaceDiagnostics = validateInputNamespaces(this.namespaceKey, input);
    if (namespaceDiagnostics.length > 0) {
      return failedWrite(namespaceDiagnostics, 'no-write-attempted');
    }

    const created = await this.commitStore.createWorkbookCommit({
      ...input,
      documentId: this.namespace.documentId,
      parentCommitIds: [],
    });
    if (created.status !== 'success') {
      return failedWrite(mapCommitDiagnostics(created.diagnostics), 'no-write-attempted');
    }

    const initialized = this.refStore.initializeMain({
      targetCommitId: created.commit.id,
      createdBy: input.author,
      protected: true,
    });
    if (initialized.ok) {
      return successWrite(created.commit, initialized.ref);
    }

    const existing = this.refStore.getRef('main');
    if (existing.ok && existing.ref?.targetCommitId === created.commit.id) {
      return successWrite(created.commit, existing.ref);
    }

    return failedWrite(
      [
        diagnostic('VERSION_GRAPH_CONFLICT', 'Graph main ref is already initialized.', {
          refName: VERSION_GRAPH_MAIN_REF,
          commitId: existing.ok && existing.ref ? existing.ref.targetCommitId : undefined,
          sourceDiagnostics: initialized.diagnostics,
        }),
      ],
      'ref-not-mutated',
    );
  }

  async commit(input: CommitVersionGraphInput): Promise<VersionGraphWriteResult> {
    const namespaceDiagnostics = validateInputNamespaces(this.namespaceKey, input);
    if (namespaceDiagnostics.length > 0) {
      return failedWrite(namespaceDiagnostics, 'no-write-attempted');
    }

    const current = this.readMainRef();
    if (!current.ok) {
      return failedWrite(current.diagnostics, 'no-write-attempted');
    }

    const expectedHead = parseExpectedHead(input.expectedHeadCommitId);
    if (!expectedHead.ok) {
      return failedWrite(expectedHead.diagnostics, 'no-write-attempted');
    }
    const parentResult = parseNormalCommitParents(input.parentCommitIds, current.ref);
    if (!parentResult.ok) {
      return failedWrite(parentResult.diagnostics, 'no-write-attempted');
    }
    if (
      current.ref.targetCommitId !== expectedHead.commitId ||
      !refVersionsEqual(current.ref.refVersion, input.expectedMainRefVersion)
    ) {
      return failedWrite(
        [refConflictDiagnostic(current.ref, expectedHead.commitId)],
        'no-write-attempted',
      );
    }

    const created = await this.commitStore.createWorkbookCommit({
      ...input,
      documentId: this.namespace.documentId,
      parentCommitIds: [current.ref.targetCommitId],
    });
    if (created.status !== 'success') {
      return failedWrite(mapCommitDiagnostics(created.diagnostics), 'ref-not-mutated');
    }

    const advanced = this.refStore.advanceRefForGraphWrite({
      name: 'main',
      nextCommitId: created.commit.id,
      expectedHead: current.ref.targetCommitId,
      expectedRefVersion: current.ref.refVersion,
      updatedBy: input.author,
    });
    if (!advanced.ok) {
      return failedWrite(
        [refConflictDiagnostic(current.ref, expectedHead.commitId, advanced.diagnostics)],
        'ref-not-mutated',
      );
    }

    return successWrite(created.commit, advanced.ref);
  }

  async readCommitClosure(
    commitIdInput: WorkbookCommitId | string,
  ): Promise<VersionGraphClosureReadResult> {
    const start = parseExpectedHead(commitIdInput);
    if (!start.ok) {
      return { status: 'failed', diagnostics: start.diagnostics };
    }

    const commits: WorkbookCommit[] = [];
    const seen = new Set<WorkbookCommitId>();
    const diagnostics: VersionGraphStoreDiagnostic[] = [];
    await this.readCommitClosureInto(start.commitId, seen, commits, diagnostics);
    if (diagnostics.length > 0) {
      return { status: 'failed', diagnostics };
    }
    return { status: 'success', commits, diagnostics: [] };
  }

  private async readCommitClosureInto(
    commitId: WorkbookCommitId,
    seen: Set<WorkbookCommitId>,
    commits: WorkbookCommit[],
    diagnostics: VersionGraphStoreDiagnostic[],
  ): Promise<void> {
    if (seen.has(commitId)) return;
    seen.add(commitId);

    const read = await this.commitStore.readCommit(commitId);
    if (read.status !== 'success') {
      diagnostics.push(...mapCommitDiagnostics(read.diagnostics));
      return;
    }

    commits.push(read.commit);
    for (const parentCommitId of read.commit.payload.parentCommitIds) {
      await this.readCommitClosureInto(parentCommitId, seen, commits, diagnostics);
    }
  }

  private readMainRef():
    | { readonly ok: true; readonly ref: LiveRefRecord }
    | { readonly ok: false; readonly diagnostics: readonly VersionGraphStoreDiagnostic[] } {
    const result = this.refStore.getRef('main');
    if (!result.ok) {
      return { ok: false, diagnostics: [refStoreDiagnostic(result.diagnostics)] };
    }
    if (result.ref === null) {
      return {
        ok: false,
        diagnostics: [
          diagnostic('VERSION_GRAPH_UNINITIALIZED', 'Graph main ref is not initialized.', {
            refName: VERSION_GRAPH_MAIN_REF,
          }),
        ],
      };
    }
    return { ok: true, ref: result.ref };
  }
}

export function createInMemoryVersionGraphStore(
  options: InMemoryVersionGraphStoreOptions,
): InMemoryVersionGraphStore {
  return new InMemoryVersionGraphStore(options);
}

function parseExpectedHead(
  value: WorkbookCommitId | string,
):
  | { readonly ok: true; readonly commitId: WorkbookCommitId }
  | { readonly ok: false; readonly diagnostics: readonly VersionGraphStoreDiagnostic[] } {
  try {
    return { ok: true, commitId: parseWorkbookCommitId(value) };
  } catch {
    return {
      ok: false,
      diagnostics: [
        diagnostic('VERSION_INVALID_COMMIT_ID', 'Commit id must be commit:sha256:<64 hex>.'),
      ],
    };
  }
}

function parseNormalCommitParents(
  value: readonly (WorkbookCommitId | string)[] | undefined,
  currentRef: LiveRefRecord,
):
  | { readonly ok: true }
  | { readonly ok: false; readonly diagnostics: readonly VersionGraphStoreDiagnostic[] } {
  if (value === undefined) return { ok: true };

  const parsed = parseVc04ParentCommitIds(value);
  if (!parsed.ok) return { ok: false, diagnostics: mapCommitDiagnostics(parsed.diagnostics) };
  if (
    parsed.parentCommitIds.length !== 1 ||
    parsed.parentCommitIds[0] !== currentRef.targetCommitId
  ) {
    return {
      ok: false,
      diagnostics: [
        refConflictDiagnostic(currentRef, parsed.parentCommitIds[0] ?? currentRef.targetCommitId),
      ],
    };
  }
  return { ok: true };
}

function validateInputNamespaces(
  expectedNamespaceKey: string,
  input: VersionGraphCommitContentInput,
): readonly VersionGraphStoreDiagnostic[] {
  const diagnostics: VersionGraphStoreDiagnostic[] = [];
  for (const [path, record] of collectInputRecords(input)) {
    if (!hasNamespace(record)) continue;
    try {
      if (versionGraphNamespaceKey(record.namespace) !== expectedNamespaceKey) {
        diagnostics.push(
          diagnostic('VERSION_WRONG_NAMESPACE', 'Object record namespace is outside this graph.', {
            namespace: record.namespace,
            details: { path },
          }),
        );
      }
    } catch {
      diagnostics.push(
        diagnostic('VERSION_WRONG_NAMESPACE', 'Object record namespace is invalid.', {
          details: { path },
        }),
      );
    }
  }
  return diagnostics;
}

function collectInputRecords(
  input: VersionGraphCommitContentInput,
): readonly (readonly [string, VersionObjectRecord<unknown> | undefined])[] {
  return [
    ['snapshotRootRecord', input.snapshotRootRecord],
    ['semanticChangeSetRecord', input.semanticChangeSetRecord],
    ...(input.mutationSegmentRecords ?? []).map(
      (record, index) => [`mutationSegmentRecords[${index}]`, record] as const,
    ),
    ['redactionSummaryRecord', input.redactionSummaryRecord],
    ['verificationSummaryRecord', input.verificationSummaryRecord],
  ];
}

function hasNamespace(
  record: VersionObjectRecord<unknown> | undefined,
): record is VersionObjectRecord<unknown> {
  return typeof record === 'object' && record !== null && 'namespace' in record;
}

function mapCommitDiagnostics(
  diagnostics: readonly WorkbookCommitStoreDiagnostic[],
): readonly VersionGraphStoreDiagnostic[] {
  return diagnostics.map((item) => {
    const wrongNamespace = item.sourceDiagnostics?.find(
      (source) => source.code === 'VERSION_WRONG_NAMESPACE',
    );
    if (wrongNamespace) {
      return diagnostic(
        'VERSION_WRONG_NAMESPACE',
        'Object record namespace is outside this graph.',
        {
          sourceDiagnostics: [wrongNamespace],
        },
      );
    }

    const code = graphDiagnosticCodeFromCommit(item.code);
    return diagnostic(code, item.message, {
      commitId: item.commitId,
      sourceDiagnostics: [item],
    });
  });
}

function graphDiagnosticCodeFromCommit(
  code: WorkbookCommitStoreDiagnostic['code'],
): VersionGraphStoreDiagnosticCode {
  if (code === 'VERSION_OBJECT_STORE_FAILURE') return 'VERSION_OBJECT_STORE_FAILURE';
  if (code === 'VERSION_MISSING_PARENT') return 'VERSION_MISSING_PARENT';
  if (code === 'VERSION_UNSUPPORTED_PARENT_COMMIT') return 'VERSION_UNSUPPORTED_PARENT_COMMIT';
  if (code === 'VERSION_INVALID_COMMIT_ID') return 'VERSION_INVALID_COMMIT_ID';
  if (code === 'VERSION_INVALID_COMMIT_PAYLOAD') return 'VERSION_INVALID_COMMIT_PAYLOAD';
  if (code === 'VERSION_WRONG_DOCUMENT') return 'VERSION_WRONG_DOCUMENT';
  return 'VERSION_MISSING_DEPENDENCY';
}

function refConflictDiagnostic(
  currentRef: LiveRefRecord,
  expectedHead: WorkbookCommitId,
  sourceDiagnostics: readonly VersionDiagnostic[] = [],
): VersionGraphStoreDiagnostic {
  return diagnostic('VERSION_REF_CONFLICT', 'Graph main ref no longer matches expected head.', {
    refName: VERSION_GRAPH_MAIN_REF,
    commitId: currentRef.targetCommitId,
    details: {
      expectedHead,
      actualHead: currentRef.targetCommitId,
      expectedDigest: objectDigestFromWorkbookCommitId(expectedHead).digest,
      actualDigest: objectDigestFromWorkbookCommitId(currentRef.targetCommitId).digest,
    },
    sourceDiagnostics,
  });
}

function refStoreDiagnostic(
  sourceDiagnostics: readonly VersionDiagnostic[],
): VersionGraphStoreDiagnostic {
  return diagnostic('VERSION_REF_CONFLICT', 'Graph ref store rejected the operation.', {
    refName: VERSION_GRAPH_MAIN_REF,
    sourceDiagnostics,
  });
}

function successWrite(commit: WorkbookCommit, ref: LiveRefRecord): VersionGraphWriteSuccess {
  return {
    status: 'success',
    commit,
    main: mainRefFromLiveRef(ref),
    diagnostics: [],
  };
}

function failedWrite(
  diagnostics: readonly VersionGraphStoreDiagnostic[],
  mutationGuarantee: VersionGraphWriteFailure['mutationGuarantee'],
): VersionGraphWriteFailure {
  return { status: 'failed', diagnostics, mutationGuarantee };
}

function mainRefFromLiveRef(ref: LiveRefRecord): VersionGraphRef {
  return {
    name: VERSION_GRAPH_MAIN_REF,
    commitId: ref.targetCommitId,
    revision: ref.refVersion,
    updatedAt: ref.updatedAt,
  };
}

function diagnostic(
  code: VersionGraphStoreDiagnosticCode,
  message: string,
  options: Omit<VersionGraphStoreDiagnostic, 'code' | 'severity' | 'message'> = {},
): VersionGraphStoreDiagnostic {
  return {
    code,
    severity: code === 'VERSION_OBJECT_STORE_FAILURE' ? 'corruption' : 'error',
    message,
    ...options,
  };
}
