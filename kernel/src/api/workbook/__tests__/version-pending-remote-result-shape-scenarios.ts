import { registerPendingRemoteResultShapeFilterOutcomesScenarios } from './version-pending-remote-result-shape-filter-outcomes-scenarios';
import { registerPendingRemoteResultShapePromotionAliasScenarios } from './version-pending-remote-result-shape-promotion-alias-scenarios';

export function registerPendingRemoteResultShapeScenarios(): void {
  registerPendingRemoteResultShapePromotionAliasScenarios();
  registerPendingRemoteResultShapeFilterOutcomesScenarios();
}
