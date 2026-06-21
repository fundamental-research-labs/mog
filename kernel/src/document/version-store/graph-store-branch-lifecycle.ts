import { createInMemoryBranchService } from './branch-service';
import type { InMemoryRefStore } from './ref-store';

export type GraphBranchLifecycle = ReturnType<typeof createInMemoryBranchService>;

export function createGraphBranchLifecycle(refStore: InMemoryRefStore): GraphBranchLifecycle {
  return createInMemoryBranchService({ refStore });
}
