import {
  parseVc04ParentCommitIds,
  parseWorkbookMergeParentCommitId,
} from '../commit-store/parents';
import type { WorkbookCommitStoreDiagnostic } from '../commit-store';
import type { WorkbookCommitId } from '../object-digest';
import type { LiveRefRecord } from '../refs/ref-store';
import type { VersionGraphStoreDiagnostic } from './graph-store-types';
import { graphRefNameFromRefName } from './graph-store-refs';

export type GraphCommitParentPlan =
  | {
      readonly kind: 'normal';
      readonly parentCommitIds?: readonly (WorkbookCommitId | string)[];
    }
  | { readonly kind: 'merge'; readonly mergeParentCommitId: WorkbookCommitId | string };

type GraphDiagnosticFactory = (
  code: VersionGraphStoreDiagnostic['code'],
  message: string,
  options?: Omit<VersionGraphStoreDiagnostic, 'code' | 'severity' | 'message'>,
) => VersionGraphStoreDiagnostic;

type CommitDiagnosticMapper = (
  diagnostics: readonly WorkbookCommitStoreDiagnostic[],
) => readonly VersionGraphStoreDiagnostic[];

type RefConflictDiagnosticFactory = (
  currentRef: LiveRefRecord,
  expectedHead: WorkbookCommitId,
) => VersionGraphStoreDiagnostic;

export function parseGraphCommitParentPlan(
  parentPlan: GraphCommitParentPlan,
  currentRef: LiveRefRecord,
  helpers: {
    readonly diagnostic: GraphDiagnosticFactory;
    readonly mapCommitDiagnostics: CommitDiagnosticMapper;
    readonly refConflictDiagnostic: RefConflictDiagnosticFactory;
  },
):
  | { readonly ok: true; readonly parentCommitIds: readonly WorkbookCommitId[] }
  | { readonly ok: false; readonly diagnostics: readonly VersionGraphStoreDiagnostic[] } {
  if (parentPlan.kind === 'merge') {
    return parseMergeCommitParents(parentPlan.mergeParentCommitId, currentRef, helpers);
  }
  return parseNormalCommitParents(parentPlan.parentCommitIds, currentRef, helpers);
}

function parseNormalCommitParents(
  value: readonly (WorkbookCommitId | string)[] | undefined,
  currentRef: LiveRefRecord,
  helpers: {
    readonly mapCommitDiagnostics: CommitDiagnosticMapper;
    readonly refConflictDiagnostic: RefConflictDiagnosticFactory;
  },
):
  | { readonly ok: true; readonly parentCommitIds: readonly WorkbookCommitId[] }
  | { readonly ok: false; readonly diagnostics: readonly VersionGraphStoreDiagnostic[] } {
  if (value === undefined) {
    return { ok: true, parentCommitIds: [currentRef.targetCommitId] };
  }

  const parsed = parseVc04ParentCommitIds(value);
  if (!parsed.ok) {
    return { ok: false, diagnostics: helpers.mapCommitDiagnostics(parsed.diagnostics) };
  }
  if (
    parsed.parentCommitIds.length !== 1 ||
    parsed.parentCommitIds[0] !== currentRef.targetCommitId
  ) {
    return {
      ok: false,
      diagnostics: [
        helpers.refConflictDiagnostic(
          currentRef,
          parsed.parentCommitIds[0] ?? currentRef.targetCommitId,
        ),
      ],
    };
  }
  return { ok: true, parentCommitIds: parsed.parentCommitIds };
}

function parseMergeCommitParents(
  value: WorkbookCommitId | string,
  currentRef: LiveRefRecord,
  helpers: {
    readonly diagnostic: GraphDiagnosticFactory;
    readonly mapCommitDiagnostics: CommitDiagnosticMapper;
  },
):
  | { readonly ok: true; readonly parentCommitIds: readonly WorkbookCommitId[] }
  | { readonly ok: false; readonly diagnostics: readonly VersionGraphStoreDiagnostic[] } {
  const parsed = parseWorkbookMergeParentCommitId(value);
  if (!parsed.ok) {
    return { ok: false, diagnostics: helpers.mapCommitDiagnostics(parsed.diagnostics) };
  }

  const mergeParentCommitId = parsed.parentCommitIds[0];
  if (mergeParentCommitId === currentRef.targetCommitId) {
    return {
      ok: false,
      diagnostics: [
        helpers.diagnostic(
          'VERSION_UNSUPPORTED_PARENT_COMMIT',
          'Merge commits require a second parent distinct from the current ref head.',
          {
            refName: graphRefNameFromRefName(currentRef.name),
            commitId: currentRef.targetCommitId,
            details: { mergeParentCommitId },
          },
        ),
      ],
    };
  }
  return { ok: true, parentCommitIds: [currentRef.targetCommitId, mergeParentCommitId] };
}
