import { registerNoCommitBoundIdentityScenario } from './version-apply-merge-persisted-artifact-hardening-no-commit-bound-identity';
import { registerResolutionDigestMismatchScenario } from './version-apply-merge-persisted-artifact-hardening-resolution-digest-mismatch';

describe('WorkbookVersion persisted merge artifact hardening', () => {
  registerResolutionDigestMismatchScenario();
  registerNoCommitBoundIdentityScenario();
});
