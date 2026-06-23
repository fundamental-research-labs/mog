import { registerSelectorRefAllowedScenarios } from './version-diff-selector-ref-allowed-scenarios';
import { registerSelectorRefAuthorizationScenarios } from './version-diff-selector-ref-authorization-scenarios';
import { registerSelectorRefPassThroughScenarios } from './version-diff-selector-ref-pass-through-scenarios';
import { registerSelectorRefProviderScenarios } from './version-diff-selector-ref-provider-scenarios';
import { registerSelectorRefStaleScenarios } from './version-diff-selector-ref-stale-scenarios';

export function registerSelectorRefScenarios(): void {
  registerSelectorRefPassThroughScenarios();
  registerSelectorRefAuthorizationScenarios();
  registerSelectorRefAllowedScenarios();
  registerSelectorRefStaleScenarios();
  registerSelectorRefProviderScenarios();
}
