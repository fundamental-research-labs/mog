import 'fake-indexeddb/auto';

import { installSyncBatchStatusIndexedDbCleanup } from './sync-batch-status-store-test-helpers';
import { registerSyncBatchStatusStoreMemoryPersistenceTests } from './sync-batch-status-store-memory-persistence-scenarios';
import { registerSyncBatchStatusStoreMemoryTerminalSemanticsTests } from './sync-batch-status-store-memory-terminal-semantics-scenarios';
import { registerSyncBatchStatusStoreMemoryValidationTests } from './sync-batch-status-store-memory-validation-scenarios';

installSyncBatchStatusIndexedDbCleanup();

registerSyncBatchStatusStoreMemoryPersistenceTests();
registerSyncBatchStatusStoreMemoryTerminalSemanticsTests();
registerSyncBatchStatusStoreMemoryValidationTests();
