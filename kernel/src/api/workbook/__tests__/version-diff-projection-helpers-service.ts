import { createWorkbookVersionDiffService } from '../../../document/version-store/diff-service';
import type { VersionStoreProvider } from '../../../document/version-store/provider';
import { WorkbookVersionImpl } from '../version';

export function createVersion(provider: VersionStoreProvider): WorkbookVersionImpl {
  return new WorkbookVersionImpl({
    versioning: {
      diffService: createWorkbookVersionDiffService({ provider }),
    },
  } as any);
}
