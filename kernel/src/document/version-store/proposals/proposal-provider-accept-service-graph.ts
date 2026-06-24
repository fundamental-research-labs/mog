import type { WorkbookCommitId } from '@mog-sdk/contracts/api';

import {
  actualHeadFromDiagnostics,
  graphFailure,
  isStaleFastForwardDiagnostic,
  targetUnavailable,
} from './proposal-provider-accept-service-results';
import type {
  FastForwardTargetResult,
  ProposalGraphProvider,
} from './proposal-provider-accept-service-types';
import type { ResolvedBranchHead } from './proposal-provider-service-types';
import { namespaceForRegistry } from '../registry';

export async function fastForwardTargetRef(
  graphProvider: ProposalGraphProvider | undefined,
  input: {
    readonly targetRef: string;
    readonly nextCommitId: WorkbookCommitId;
    readonly expectedHeadCommitId: WorkbookCommitId;
    readonly expectedRefVersion: ResolvedBranchHead['refVersion'];
  },
): Promise<FastForwardTargetResult> {
  if (!graphProvider) {
    return {
      ok: false,
      result: targetUnavailable(
        'VERSION_GRAPH_UNAVAILABLE',
        'Provider-backed proposal accept requires a visible version graph provider.',
      ),
    };
  }

  try {
    const registryRead = await graphProvider.readGraphRegistry();
    if (registryRead.status !== 'ok') {
      return { ok: false, result: graphFailure(registryRead.diagnostics) };
    }
    const graph = await graphProvider.openGraph(
      namespaceForRegistry(registryRead.registry),
      graphProvider.accessContext,
    );
    const advanced = await graph.fastForwardRef({
      targetRef: input.targetRef,
      expectedHeadCommitId: input.expectedHeadCommitId,
      expectedTargetRefVersion: input.expectedRefVersion,
      nextCommitId: input.nextCommitId,
      updatedBy: {
        authorId: 'version-proposal-service',
        actorKind: 'system',
        displayName: 'Version Proposal Service',
      },
    });
    if (advanced.status === 'success') return { ok: true };
    return {
      ok: false,
      stale: advanced.diagnostics.some((item) => isStaleFastForwardDiagnostic(item.code)),
      actualTargetHeadId: actualHeadFromDiagnostics(advanced.diagnostics),
      result: graphFailure(advanced.diagnostics),
    };
  } catch {
    return {
      ok: false,
      result: targetUnavailable(
        'VERSION_PROVIDER_ERROR',
        'Visible version graph could not accept the proposal.',
      ),
    };
  }
}
