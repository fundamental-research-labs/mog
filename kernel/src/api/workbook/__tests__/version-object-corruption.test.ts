import { registerVersionObjectCorruptionDiagnosticScenarios } from './version-object-corruption-diagnostic-scenarios';
import { registerVersionObjectCorruptionPersistedArtifactScenarios } from './version-object-corruption-persisted-artifact-scenarios';
import { registerVersionObjectCorruptionSurfaceScenarios } from './version-object-corruption-surface-scenarios';

describe('WorkbookVersion version object corruption public boundaries', () => {
  registerVersionObjectCorruptionDiagnosticScenarios();
  registerVersionObjectCorruptionPersistedArtifactScenarios();
  registerVersionObjectCorruptionSurfaceScenarios();
});
