import type { VersionRecordRevision, WorkbookCommitId } from '@mog-sdk/contracts/api';

import { graphDiagnostics, type DiffServiceDiagnostic } from './diff-service-diagnostics';
import { VERSION_GRAPH_HEAD_REF, VERSION_GRAPH_MAIN_REF } from './graph';
import type { VersionGraphStore } from './provider';

type NormalizedDiffCommitish =
  | {
      readonly kind: 'commit';
      readonly id: WorkbookCommitId;
    }
  | {
      readonly kind: 'ref';
      readonly name: typeof VERSION_GRAPH_HEAD_REF | typeof VERSION_GRAPH_MAIN_REF;
    };

export async function resolveCommitish(
  graph: VersionGraphStore,
  selector: NormalizedDiffCommitish,
  selectorName: 'base' | 'target',
): Promise<
  | {
      readonly ok: true;
      readonly commitId: WorkbookCommitId;
      readonly readRevision: VersionRecordRevision;
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly DiffServiceDiagnostic[];
    }
> {
  if (selector.kind === 'commit') {
    const closure = await graph.readCommitClosure(selector.id);
    if (closure.status !== 'success') {
      return {
        ok: false,
        diagnostics: graphDiagnostics(closure.diagnostics, { selector: selectorName }),
      };
    }

    const head = await graph.readHead();
    if (head.status !== 'success') {
      return {
        ok: false,
        diagnostics: graphDiagnostics(head.diagnostics, { selector: selectorName }),
      };
    }
    return { ok: true, commitId: selector.id, readRevision: head.main.revision };
  }

  const ref = await graph.readRef(selector.name);
  if (ref.status !== 'success') {
    return {
      ok: false,
      diagnostics: graphDiagnostics(ref.diagnostics, { selector: selectorName }),
    };
  }
  if (ref.ref.name === VERSION_GRAPH_HEAD_REF) {
    const head = await graph.readHead();
    if (head.status !== 'success') {
      return {
        ok: false,
        diagnostics: graphDiagnostics(head.diagnostics, { selector: selectorName }),
      };
    }
    return { ok: true, commitId: head.head.id, readRevision: head.main.revision };
  }
  return { ok: true, commitId: ref.ref.commitId, readRevision: ref.ref.revision };
}
