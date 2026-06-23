import type {
  VersionMergeInput,
  VersionMergeOptions,
  VersionMergeResult,
} from '@mog-sdk/contracts/api';

import { classifyValueChanges } from './merge-service-classification';
import { diagnostic } from './merge-service-diagnostics';
import {
  directChildDiagnostic,
  openVisibleMergeGraph,
  readPreviewCommit,
  readSemanticChangeSet,
} from './merge-service-graph';
import { persistMergeAttemptIfRequested } from './merge-service-persistence';
import { alreadyMerged, blocked, fastForward } from './merge-service-results';
import { parseSemanticChangeSet } from './merge-service-semantic-records';
import { resolveVersionMergeBase } from './merge-base-resolution';
import type { VersionStoreProvider } from './provider';

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

    const opened = await openVisibleMergeGraph(this.provider);
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
}

export function createWorkbookVersionMergeService(
  options: WorkbookVersionMergeServiceOptions,
): WorkbookVersionMergeService {
  return new WorkbookVersionMergeService(options);
}
