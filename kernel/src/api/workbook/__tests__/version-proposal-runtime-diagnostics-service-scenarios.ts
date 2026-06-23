import { registerProposalRuntimeDiagnosticsServiceAcceptScenarios } from './version-proposal-runtime-diagnostics-service-accept-scenarios';
import { registerProposalRuntimeDiagnosticsServiceCreateScenarios } from './version-proposal-runtime-diagnostics-service-create-scenarios';
import { registerProposalRuntimeDiagnosticsServiceWorkspaceScenarios } from './version-proposal-runtime-diagnostics-service-workspace-scenarios';

export function registerProposalRuntimeDiagnosticsServiceScenarios(): void {
  registerProposalRuntimeDiagnosticsServiceWorkspaceScenarios();
  registerProposalRuntimeDiagnosticsServiceCreateScenarios();
  registerProposalRuntimeDiagnosticsServiceAcceptScenarios();
}
