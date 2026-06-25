import { registerProviderBackedSemanticMutationCaptureScenario } from './version-commit-snapshot-root-semantic-capture-provider-backed-commits-scenarios';
import { registerSemanticNoopWritesScenario } from './version-commit-snapshot-root-semantic-capture-noop-writes-scenarios';
import { registerContextlessSemanticMutationsScenario } from './version-commit-snapshot-root-semantic-capture-contextless-mutations-scenarios';
import { registerGroupedOperationReceiptsScenario } from './version-commit-snapshot-root-semantic-capture-grouped-operation-receipts-scenarios';

export function registerSnapshotRootSemanticCaptureScenarios(): void {
  registerProviderBackedSemanticMutationCaptureScenario();
  registerSemanticNoopWritesScenario();
  registerContextlessSemanticMutationsScenario();
  registerGroupedOperationReceiptsScenario();
}
