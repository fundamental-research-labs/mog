import type { VersionGraphBranchRefName } from '../graph';
import { isObjectDigest, type WorkbookCommitId } from '../object-digest';
import type { VersionGraphNamespace } from '../object-store';
import { versionStoreDiagnostic, type VersionGraphStore } from '../provider';
import type { VersionRecordRevision } from '../registry';
import {
  XLSX_EXTERNAL_CHANGE_BRANCH_PREFIX,
  XLSX_IMPORT_CHANGE_AUTHOR,
  XLSX_IMPORT_NEW_ROOT_BRANCH_PREFIX,
  XLSX_IMPORT_ROOT_AUTHOR,
} from './constants';
import type { XlsxVersionExistingGraphImportResult } from './results';

type XlsxImportRootBranchReadResult =
  | {
      readonly status: 'success';
      readonly branch: {
        readonly refName: VersionGraphBranchRefName;
        readonly ref: { readonly refVersion: VersionRecordRevision };
      };
      readonly diagnostics: readonly [];
    }
  | Extract<XlsxVersionExistingGraphImportResult, { readonly status: 'failed' }>;

export async function createOrReadExternalChangeBranch(input: {
  readonly graph: VersionGraphStore;
  readonly namespace: VersionGraphNamespace;
  readonly baseCommitId: WorkbookCommitId;
  readonly branchName: string;
}): Promise<XlsxImportRootBranchReadResult> {
  const created = await input.graph.createBranch({
    name: input.branchName,
    targetCommitId: input.baseCommitId,
    expectedAbsent: true,
    baseCommitId: input.baseCommitId,
    createdBy: XLSX_IMPORT_CHANGE_AUTHOR,
  });
  if (created.ok) {
    return { status: 'success', branch: created.branch, diagnostics: [] };
  }

  const existing = await input.graph.readBranch(input.branchName);
  if (
    existing.ok &&
    existing.branch !== null &&
    existing.branch.ref.targetCommitId === input.baseCommitId
  ) {
    return { status: 'success', branch: existing.branch, diagnostics: [] };
  }

  return {
    status: 'failed',
    diagnostics: [
      versionStoreDiagnostic('VERSION_REF_CONFLICT', {
        operation: 'commitGraphWrite',
        namespace: input.namespace,
        safeMessage: 'Trusted XLSX reimport external-change branch could not be created.',
        recoverability: 'retry',
        mutationGuarantee: 'no-write-attempted',
        details: {
          source: 'xlsx-import-change',
          branchNamespace: XLSX_EXTERNAL_CHANGE_BRANCH_PREFIX,
        },
      }),
    ],
  };
}

export async function createOrReadImportNewRootBranch(input: {
  readonly graph: VersionGraphStore;
  readonly namespace: VersionGraphNamespace;
  readonly rootCommitId: WorkbookCommitId;
  readonly branchName: string;
}): Promise<XlsxImportRootBranchReadResult> {
  const created = await input.graph.createBranch({
    name: input.branchName,
    targetCommitId: input.rootCommitId,
    expectedAbsent: true,
    createdBy: XLSX_IMPORT_ROOT_AUTHOR,
  });
  if (created.ok) {
    return { status: 'success', branch: created.branch, diagnostics: [] };
  }

  const existing = await input.graph.readBranch(input.branchName);
  if (
    existing.ok &&
    existing.branch !== null &&
    existing.branch.ref.targetCommitId === input.rootCommitId
  ) {
    return { status: 'success', branch: existing.branch, diagnostics: [] };
  }

  return {
    status: 'failed',
    diagnostics: [
      versionStoreDiagnostic('VERSION_REF_CONFLICT', {
        operation: 'commitGraphWrite',
        namespace: input.namespace,
        safeMessage: 'XLSX reimport import-root branch could not be created.',
        recoverability: 'retry',
        mutationGuarantee: 'no-write-attempted',
        details: {
          source: 'xlsx-import-root',
          branchNamespace: XLSX_IMPORT_NEW_ROOT_BRANCH_PREFIX,
        },
      }),
    ],
  };
}

export function externalChangeBranchName(
  baseCommitId: WorkbookCommitId,
  afterDigest: unknown,
): string {
  const baseSegment = baseCommitId.slice('commit:sha256:'.length, 'commit:sha256:'.length + 16);
  const afterSegment = digestBranchSegment(afterDigest);
  return `${XLSX_EXTERNAL_CHANGE_BRANCH_PREFIX}/${baseSegment}/${afterSegment}`;
}

export function importNewRootBranchName(
  rootCommitId: WorkbookCommitId,
  trustStatus: string,
): string {
  const rootSegment = rootCommitId.slice('commit:sha256:'.length, 'commit:sha256:'.length + 16);
  return `${XLSX_IMPORT_NEW_ROOT_BRANCH_PREFIX}/${safeBranchSegment(trustStatus)}/${rootSegment}`;
}

function digestBranchSegment(value: unknown): string {
  if (isObjectDigest(value)) return value.digest.slice(0, 16);
  if (isRecord(value) && typeof value.value === 'string') {
    return safeBranchSegment(value.value);
  }
  if (isRecord(value) && typeof value.digest === 'string') {
    return safeBranchSegment(value.digest);
  }
  return 'unknown-digest';
}

function safeBranchSegment(value: string): string {
  const segment = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .slice(0, 16);
  return segment.length > 0 ? segment : 'unknown-digest';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
