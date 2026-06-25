import type { WorkbookCommitId } from '../object-digest';
import type { RefName } from '../refs/ref-name';
import type { LiveRefRecord, RefVersion } from '../refs/ref-store';
import { VERSION_GRAPH_HEAD_REF, graphRefFromLiveRef } from './graph-store-refs';
import type { VersionGraphRef, VersionGraphStoreDiagnostic } from './graph-store-types';
import type { ParsedListCommitsTarget } from './graph-store-list-options';

type GraphRefReadResult =
  | { readonly ok: true; readonly ref: LiveRefRecord }
  | { readonly ok: false; readonly diagnostics: readonly VersionGraphStoreDiagnostic[] };

export type VersionGraphListCommitsRoot =
  | {
      readonly ok: true;
      readonly commitId: WorkbookCommitId;
      readonly readRevision: RefVersion;
      readonly ref?: VersionGraphRef;
    }
  | { readonly ok: false; readonly diagnostics: readonly VersionGraphStoreDiagnostic[] };

export type VersionGraphListCommitsRootReaders = {
  readonly readMainRef: () => GraphRefReadResult;
  readonly readBranchRef: (refName: RefName) => GraphRefReadResult;
};

export function resolveListCommitsRoot(
  target: ParsedListCommitsTarget,
  readers: VersionGraphListCommitsRootReaders,
): VersionGraphListCommitsRoot {
  if (target.kind === 'pageCursor') {
    return {
      ok: true,
      commitId: target.cursor.root.commitId,
      readRevision: target.cursor.root.readRevision,
    };
  }

  if (target.kind === 'commit') {
    const current = readers.readMainRef();
    if (!current.ok) return current;
    return {
      ok: true,
      commitId: target.commitId,
      readRevision: current.ref.refVersion,
    };
  }

  if (target.selector.name === VERSION_GRAPH_HEAD_REF) {
    const current = readers.readMainRef();
    if (!current.ok) return current;
    return {
      ok: true,
      commitId: current.ref.targetCommitId,
      readRevision: current.ref.refVersion,
      ref: graphRefFromLiveRef(current.ref),
    };
  }

  const current =
    target.selector.refName === 'main'
      ? readers.readMainRef()
      : readers.readBranchRef(target.selector.refName);
  if (!current.ok) return current;

  return {
    ok: true,
    commitId: current.ref.targetCommitId,
    readRevision: current.ref.refVersion,
    ref: graphRefFromLiveRef(current.ref),
  };
}
