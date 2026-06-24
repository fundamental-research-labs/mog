import type { InMemoryVersionGraphStoreSnapshot } from '../graph';
import type { MergeApplyIntentApplyKind } from '../merge-apply-intent-store';
import type { WorkbookCommitId } from '../object-digest';
import type { VersionDocumentScope } from '../registry';
import type { RefVersion } from '../refs/ref-store';

export type PersistGraphSnapshotOptions = {
  readonly db: IDBDatabase;
  readonly snapshot: InMemoryVersionGraphStoreSnapshot;
  readonly documentScope: VersionDocumentScope;
  readonly mode:
    | { readonly kind: 'initialize' }
    | {
        readonly kind: 'createBranch';
        readonly targetRefName: string;
        readonly expectedRefStoreNextGeneratedId: number;
      }
    | {
        readonly kind: 'commit';
        readonly targetRefName: string;
        readonly expectedHeadCommitId: WorkbookCommitId;
        readonly expectedRefVersion: RefVersion;
        readonly refCasProof?: {
          readonly applyKind: MergeApplyIntentApplyKind;
        };
      }
    | {
        readonly kind: 'deleteBranch';
        readonly targetRefName: string;
        readonly expectedHeadCommitId?: WorkbookCommitId;
        readonly expectedRefVersion: RefVersion;
        readonly expectedRefStoreLiveRefCount: number;
      };
};

export type PersistGraphSnapshotMode = PersistGraphSnapshotOptions['mode'];
