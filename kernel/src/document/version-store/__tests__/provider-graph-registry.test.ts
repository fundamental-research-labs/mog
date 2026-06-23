import { registerProviderGraphRegistryConflictScenarios } from './provider-graph-registry-conflict-scenarios';
import { registerProviderGraphRegistryIntegrityScenarios } from './provider-graph-registry-integrity-scenarios';
import { registerProviderGraphRegistryLifecycleScenarios } from './provider-graph-registry-lifecycle-scenarios';
import { registerProviderGraphRegistryNamespaceScenarios } from './provider-graph-registry-namespace-scenarios';
import { registerProviderGraphRegistryReadScenarios } from './provider-graph-registry-read-scenarios';

describe('InMemoryVersionStoreProvider graph registry', () => {
  registerProviderGraphRegistryReadScenarios();
  registerProviderGraphRegistryLifecycleScenarios();
  registerProviderGraphRegistryConflictScenarios();
  registerProviderGraphRegistryNamespaceScenarios();
  registerProviderGraphRegistryIntegrityScenarios();
});
