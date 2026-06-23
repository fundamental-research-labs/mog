import { registerPendingRemoteDiagnosticsRedactionAuthorityScenarios } from './version-pending-remote-diagnostics-redaction-authority-scenarios';
import { registerPendingRemoteDiagnosticsRedactionCursorScenarios } from './version-pending-remote-diagnostics-redaction-cursor-scenarios';

export { registerPendingRemoteDiagnosticsRedactionAuthorityScenarios } from './version-pending-remote-diagnostics-redaction-authority-scenarios';
export { registerPendingRemoteDiagnosticsRedactionCursorScenarios } from './version-pending-remote-diagnostics-redaction-cursor-scenarios';

export function registerPendingRemoteDiagnosticsRedactionScenarios(): void {
  registerPendingRemoteDiagnosticsRedactionCursorScenarios();
  registerPendingRemoteDiagnosticsRedactionAuthorityScenarios();
}
