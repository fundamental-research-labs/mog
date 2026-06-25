import { registerVersionHistoryAccessDenialDomainRedactionScenarios } from './version-history-diagnostic-projection-access-denial-domain-redaction-scenarios';
import { registerVersionHistoryAccessDenialPayloadRedactionScenarios } from './version-history-diagnostic-projection-access-denial-payload-redaction-scenarios';
import { registerVersionHistoryAccessDenialPublicSummaryScenarios } from './version-history-diagnostic-projection-access-denial-public-summary-scenarios';

export function registerVersionHistoryAccessDenialProjectionScenarios(): void {
  registerVersionHistoryAccessDenialPublicSummaryScenarios();
  registerVersionHistoryAccessDenialPayloadRedactionScenarios();
  registerVersionHistoryAccessDenialDomainRedactionScenarios();
}
