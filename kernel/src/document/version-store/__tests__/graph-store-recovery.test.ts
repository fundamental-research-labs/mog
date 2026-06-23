import { registerGraphStoreRecoveryDanglingRefTests } from './graph-store-recovery-dangling-ref-scenarios';
import { registerGraphStoreRecoveryDependencyTests } from './graph-store-recovery-dependency-scenarios';
import { registerGraphStoreRecoveryWriteGuardTests } from './graph-store-recovery-write-guard-scenarios';

describe('InMemoryVersionGraphStore recovery diagnostics', () => {
  registerGraphStoreRecoveryDanglingRefTests();
  registerGraphStoreRecoveryDependencyTests();
  registerGraphStoreRecoveryWriteGuardTests();
});
