import { WorkbookVersionImpl } from '../version';

export function createVersionWithBranchService(branchService: unknown): WorkbookVersionImpl {
  return new WorkbookVersionImpl({ versioning: { branchService } } as any);
}
