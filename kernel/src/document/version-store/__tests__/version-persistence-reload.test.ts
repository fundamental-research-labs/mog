import { registerVersionPersistenceReloadCompatibilityDiagnosticsScenarios } from './version-persistence-reload-compat-diagnostics-scenarios';
import { registerVersionPersistenceReloadFreshLifecycleScenarios } from './version-persistence-reload-fresh-lifecycle-scenarios';

describe('VersionPersistence', () => {
  registerVersionPersistenceReloadFreshLifecycleScenarios();
  registerVersionPersistenceReloadCompatibilityDiagnosticsScenarios();
});
