import {
  createInMemoryWorkbookCommitStore,
  type InMemoryWorkbookCommitStore,
} from '../../../document/version-store/commit-store';
import { InMemoryVersionObjectStore } from '../../../document/version-store/object-store';
import { NAMESPACE } from './version-checkout-helpers-version-constants';

export type Stores = {
  readonly objectStore: InMemoryVersionObjectStore;
  readonly commitStore: InMemoryWorkbookCommitStore;
};

export function createStores(): Stores {
  const objectStore = new InMemoryVersionObjectStore(NAMESPACE);
  return {
    objectStore,
    commitStore: createInMemoryWorkbookCommitStore(objectStore),
  };
}
