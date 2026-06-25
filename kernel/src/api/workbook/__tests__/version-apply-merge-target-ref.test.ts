import { registerTargetRefDiagnosticRedactionScenario } from './version-apply-merge-target-ref-diagnostic-redaction-scenario';
import { registerTargetRefMissingRevisionScenario } from './version-apply-merge-target-ref-missing-revision-scenario';
import { registerTargetRefSymbolicMismatchScenario } from './version-apply-merge-target-ref-symbolic-mismatch-scenario';

describe('validateApplyMergeTargetRefCasProof target ref resolution', () => {
  registerTargetRefSymbolicMismatchScenario();
  registerTargetRefMissingRevisionScenario();
  registerTargetRefDiagnosticRedactionScenario();
});
