import 'fake-indexeddb/auto';

import { resetIndexedDbVersionStoreForTesting } from './provider-indexeddb-test-utils';

export { captureNormalCommit } from './provider-indexeddb-lifecycle-test-utils-commits';
export {
  createLifecycleDocumentHandle,
  DocumentFactory,
  openLifecycleWorkbook,
} from './provider-indexeddb-lifecycle-test-utils-document';
export { putRegistryEnvelope } from './provider-indexeddb-lifecycle-test-utils-indexeddb';
export { FULL_STATE_BYTES } from './provider-indexeddb-lifecycle-test-utils-mocks';
export {
  objectRecord,
  resetIndexedDbVersionStoreForTesting,
  rootWrite,
  updateFirstByNamespace,
} from './provider-indexeddb-test-utils';

beforeEach(async () => {
  await resetIndexedDbVersionStoreForTesting();
});

afterEach(async () => {
  await resetIndexedDbVersionStoreForTesting();
});
