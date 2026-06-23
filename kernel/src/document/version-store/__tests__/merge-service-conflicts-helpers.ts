import { createWorkbookVersionMergeService } from '../merge-service';

import {
  graphWithRootAndDetachedChildren,
  validSemanticPayload,
  valueChange,
} from './merge-service-fixtures';

export { validSemanticPayload, valueChange };

export async function createMergeServiceConflictGraph(
  options: Parameters<typeof graphWithRootAndDetachedChildren>[0],
) {
  const graph = await graphWithRootAndDetachedChildren(options);
  const service = createWorkbookVersionMergeService({ provider: graph.provider });

  return { graph, service };
}
