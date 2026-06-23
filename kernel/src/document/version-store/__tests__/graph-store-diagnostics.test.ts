import { registerGraphStoreDependencyDiagnosticsScenarios } from './graph-store-diagnostics-dependency-scenarios';
import { registerGraphStoreRefDiagnosticsScenarios } from './graph-store-diagnostics-ref-scenarios';
import { registerGraphStoreWriteGuardDiagnosticsScenarios } from './graph-store-diagnostics-write-guard-scenarios';

describe('InMemoryVersionGraphStore diagnostics and validation failures', () => {
  registerGraphStoreRefDiagnosticsScenarios();
  registerGraphStoreDependencyDiagnosticsScenarios();
  registerGraphStoreWriteGuardDiagnosticsScenarios();
});
