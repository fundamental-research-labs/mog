import type * as ContractsApi from '@mog-sdk/contracts/api';

type WorkbookVersionBasicFlowContractFixtureSurface = {
  readonly commitOptions: readonly ContractsApi.VersionCommitOptions[];
  readonly commitSummary: ContractsApi.WorkbookCommitSummary;
  readonly branchCreateOptions: readonly ContractsApi.VersionCreateBranchOptions[];
  readonly branchFastForwardOptions: ContractsApi.VersionFastForwardBranchOptions;
  readonly branchUpdateOptions: ContractsApi.VersionUpdateBranchOptions;
  readonly branchRef: ContractsApi.VersionRef;
  readonly refDeleteOptions: ContractsApi.VersionDeleteRefOptions;
  readonly refReadResults: readonly ContractsApi.VersionRefReadResult[];
  readonly refsPage: ContractsApi.Paged<ContractsApi.VersionRef>;
  readonly refMutationResults: readonly ContractsApi.VersionRefMutationResult[];
  readonly mergeInput: ContractsApi.VersionMergeInput;
  readonly mergeOptions: ContractsApi.VersionMergeOptions;
  readonly mergeResult: ContractsApi.VersionMergeResult;
  readonly applyMergeInput: ContractsApi.VersionApplyMergeInput;
  readonly applyMergeOptions: ContractsApi.VersionApplyMergeOptions;
  readonly applyMergeResult: ContractsApi.VersionApplyMergeResult;
  readonly revertInputs: readonly ContractsApi.VersionRevertInput[];
  readonly revertOptions: readonly ContractsApi.VersionRevertOptions[];
  readonly revertResults: readonly ContractsApi.VersionRevertResult[];
};

const baseCommitId = 'commit:sha256:version-basic-flow-base' as ContractsApi.WorkbookCommitId;
const oursCommitId = 'commit:sha256:version-basic-flow-ours' as ContractsApi.WorkbookCommitId;
const theirsCommitId = 'commit:sha256:version-basic-flow-theirs' as ContractsApi.WorkbookCommitId;
const mergeCommitId = 'commit:sha256:version-basic-flow-merge' as ContractsApi.WorkbookCommitId;
const revertCommitId = 'commit:sha256:version-basic-flow-revert' as ContractsApi.WorkbookCommitId;
const mainRefName: ContractsApi.VersionMainRefName = 'refs/heads/main';
const branchName = 'basic-flow' as ContractsApi.VersionBranchName;
const branchRefName = 'refs/heads/basic-flow' as ContractsApi.VersionRefName;
const mergeResultId = 'merge-result:version-basic-flow' as ContractsApi.VersionMergeResultId;

const counterRevision = {
  kind: 'counter',
  value: '12',
} satisfies ContractsApi.VersionCounterRecordRevision;
const digest = {
  algorithm: 'sha256',
  digest: 'version-basic-flow-digest',
  byteLength: 128,
} satisfies ContractsApi.ObjectDigest;
const author = {
  actorKind: 'user',
  displayName: 'Version basic flow fixture author',
  redacted: false,
} satisfies ContractsApi.RedactedVersionAuthor;
const diagnostic = {
  issueCode: 'VERSION_REF_CONFLICT',
  severity: 'error',
  recoverability: 'retry',
  messageTemplateId: 'version.basicFlow.refConflict',
  safeMessage: 'Version basic flow fixture ref conflict.',
  payload: { targetRef: mainRefName },
  redacted: false,
  mutationGuarantee: 'ref-not-mutated',
} satisfies ContractsApi.VersionStoreDiagnostic;
const expectedHead = {
  commitId: oursCommitId,
  revision: counterRevision,
  symbolicHeadRevision: counterRevision,
} satisfies ContractsApi.VersionCommitExpectedHead;
const branchRef = {
  name: branchRefName,
  commitId: oursCommitId,
  revision: counterRevision,
  updatedAt: '2026-06-24T00:00:00.000Z',
} satisfies ContractsApi.VersionRef;
const mergeChange = {
  structural: {
    kind: 'metadata',
    changeId: 'change:version-basic-flow',
    domain: 'cells.values',
    entityId: 'sheet:fixture!A1',
    propertyPath: ['value'],
  },
  base: { kind: 'value', value: null },
  ours: { kind: 'value', value: 1 },
  theirs: { kind: 'value', value: 2 },
  merged: { kind: 'value', value: 2 },
  diagnostics: [],
} satisfies ContractsApi.VersionMergeChange;
const mergeResolution = {
  conflictId: 'conflict:version-basic-flow',
  expectedConflictDigest: 'conflict-digest:version-basic-flow',
  optionId: 'resolution:accept-theirs',
  kind: 'acceptTheirs',
} satisfies ContractsApi.VersionApplyMergeResolution;

export const CONTRACTS_WORKBOOK_VERSION_BASIC_FLOW_CONTRACT_FIXTURES = Object.freeze({
  commitOptions: [
    { message: 'Capture branch edits.', targetRef: branchName, expectedHead },
    { message: 'Create workbook root.', targetRef: mainRefName, mode: { kind: 'root' } },
  ],
  commitSummary: {
    id: oursCommitId,
    parents: [baseCommitId],
    createdAt: '2026-06-24T00:00:00.000Z',
    author,
    annotation: { title: { kind: 'text', value: 'Basic flow' } },
  },
  branchCreateOptions: [
    { name: branchName, targetCommitId: oursCommitId, baseCommitId, expectedAbsent: true },
    { name: branchRefName, targetCommitId: theirsCommitId },
  ],
  branchFastForwardOptions: {
    name: branchName,
    nextCommitId: theirsCommitId,
    expectedHead: oursCommitId,
    expectedRefRevision: counterRevision,
  },
  branchUpdateOptions: {
    name: branchRefName,
    nextCommitId: mergeCommitId,
    expectedHead: oursCommitId,
    expectedRefRevision: counterRevision,
  },
  branchRef,
  refDeleteOptions: {
    name: branchRefName,
    expectedHead: oursCommitId,
    expectedRefRevision: counterRevision,
  },
  refReadResults: [
    {
      status: 'success',
      ref: { name: 'HEAD', target: mainRefName, revision: counterRevision },
      diagnostics: [],
    },
    { status: 'success', ref: branchRef, diagnostics: [] },
    { status: 'degraded', ref: null, diagnostics: [diagnostic] },
  ],
  refsPage: { items: [branchRef], limit: 50, totalEstimate: 1 },
  refMutationResults: [
    { status: 'success', ref: branchRef, diagnostics: [] },
    { status: 'degraded', ref: null, diagnostics: [diagnostic] },
  ],
  mergeInput: { base: baseCommitId, ours: oursCommitId, theirs: theirsCommitId },
  mergeOptions: { mode: 'preview', targetRef: mainRefName, expectedTargetHead: expectedHead },
  mergeResult: {
    status: 'clean',
    base: baseCommitId,
    ours: oursCommitId,
    theirs: theirsCommitId,
    changes: [mergeChange],
    conflicts: [],
    diagnostics: [],
    mutationGuarantee: 'preview-only',
    resultId: mergeResultId,
    resultDigest: digest,
  },
  applyMergeInput: {
    base: baseCommitId,
    ours: oursCommitId,
    theirs: theirsCommitId,
    resolutions: [mergeResolution],
  },
  applyMergeOptions: {
    mode: 'apply',
    targetRef: mainRefName,
    expectedTargetHead: expectedHead,
    materializeActiveCheckout: true,
  },
  applyMergeResult: {
    status: 'applied',
    base: baseCommitId,
    ours: oursCommitId,
    theirs: theirsCommitId,
    commitRef: {
      id: mergeCommitId,
      refName: mainRefName,
      resolvedFrom: mainRefName,
      refRevision: counterRevision,
    },
    changes: [mergeChange],
    conflicts: [],
    diagnostics: [],
    resolutionCount: 1,
    mutationGuarantee: 'merge-commit-created',
  },
  revertInputs: [
    {
      target: { kind: 'commit', commitId: theirsCommitId },
      targetRef: mainRefName,
      expectedTargetHead: expectedHead,
      preflight: { cas: { refName: mainRefName, expectedRevision: counterRevision } },
    },
    {
      target: { kind: 'range', baseCommitId, headCommitId: theirsCommitId },
      targetRef: branchName,
    },
    {
      target: { kind: 'mergeCommit', commitId: mergeCommitId, mainlineParent: 1 },
      targetRef: mainRefName,
    },
  ],
  revertOptions: [{ dryRun: true, includeDiagnostics: true }, { includeDiagnostics: true }],
  revertResults: [
    {
      schemaVersion: 1,
      status: 'planned',
      target: { kind: 'commit', commitId: theirsCommitId },
      diagnostics: [],
      mutationGuarantee: 'no-write-attempted',
    },
    {
      schemaVersion: 1,
      status: 'applied',
      target: { kind: 'commit', commitId: theirsCommitId },
      commitRef: {
        id: revertCommitId,
        refName: mainRefName,
        resolvedFrom: mainRefName,
        refRevision: counterRevision,
      },
      diagnostics: [],
      mutationGuarantee: 'revert-commit-created',
    },
    {
      schemaVersion: 1,
      status: 'rejected',
      target: { kind: 'mergeCommit', commitId: mergeCommitId, mainlineParent: 1 },
      diagnostics: [diagnostic],
      mutationGuarantee: 'ref-not-mutated',
    },
  ],
} satisfies WorkbookVersionBasicFlowContractFixtureSurface);
