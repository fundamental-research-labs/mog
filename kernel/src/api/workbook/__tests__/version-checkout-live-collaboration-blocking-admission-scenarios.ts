import { registerLiveCollaborationBlockingAdmissionKnownStateScenarios } from './version-checkout-live-collaboration-blocking-admission-known-state-scenarios';
import { registerLiveCollaborationBlockingAdmissionMalformedStateScenario } from './version-checkout-live-collaboration-blocking-admission-malformed-state-scenario';

export function registerLiveCollaborationBlockingAdmissionScenarios() {
  registerLiveCollaborationBlockingAdmissionKnownStateScenarios();
  registerLiveCollaborationBlockingAdmissionMalformedStateScenario();
}
