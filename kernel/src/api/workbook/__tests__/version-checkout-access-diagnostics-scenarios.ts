import { registerCheckoutAccessDiagnosticsDenialRedactionBoundaryScenarios } from './version-checkout-access-diagnostics-denial-redaction-boundary-scenarios';
import { registerCheckoutAccessDiagnosticsHistoryDenialClassificationScenarios } from './version-checkout-access-diagnostics-history-denial-classification-scenarios';
import { registerCheckoutAccessDiagnosticsPartialSnapshotFailureScenarios } from './version-checkout-access-diagnostics-partial-snapshot-failure-scenarios';
import { registerCheckoutAccessDiagnosticsSubsetRefRedactionScenarios } from './version-checkout-access-diagnostics-subset-ref-redaction-scenarios';
import { registerCheckoutAccessDiagnosticsVisibleGraphDenialScenarios } from './version-checkout-access-diagnostics-visible-graph-denial-scenarios';

export { registerCheckoutAccessDiagnosticsDenialRedactionBoundaryScenarios } from './version-checkout-access-diagnostics-denial-redaction-boundary-scenarios';
export { registerCheckoutAccessDiagnosticsHistoryDenialClassificationScenarios } from './version-checkout-access-diagnostics-history-denial-classification-scenarios';
export { registerCheckoutAccessDiagnosticsPartialSnapshotFailureScenarios } from './version-checkout-access-diagnostics-partial-snapshot-failure-scenarios';
export { registerCheckoutAccessDiagnosticsSubsetRefRedactionScenarios } from './version-checkout-access-diagnostics-subset-ref-redaction-scenarios';
export { registerCheckoutAccessDiagnosticsVisibleGraphDenialScenarios } from './version-checkout-access-diagnostics-visible-graph-denial-scenarios';

export function registerCheckoutAccessDiagnosticsScenarios(): void {
  registerCheckoutAccessDiagnosticsHistoryDenialClassificationScenarios();
  registerCheckoutAccessDiagnosticsSubsetRefRedactionScenarios();
  registerCheckoutAccessDiagnosticsVisibleGraphDenialScenarios();
  registerCheckoutAccessDiagnosticsPartialSnapshotFailureScenarios();
  registerCheckoutAccessDiagnosticsDenialRedactionBoundaryScenarios();
}
