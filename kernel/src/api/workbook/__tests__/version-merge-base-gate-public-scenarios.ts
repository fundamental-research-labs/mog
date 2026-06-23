import { registerPublicMergeBaseGateAlreadyMergedAncestorScenarios } from './version-merge-base-gate-public-already-merged-ancestor-scenarios';
import { registerPublicMergeBaseGateAmbiguousHistoriesScenarios } from './version-merge-base-gate-public-ambiguous-histories-scenarios';
import { registerPublicMergeBaseGateBaseProofScenarios } from './version-merge-base-gate-public-base-proof-scenarios';
import { registerPublicMergeBaseGateClosureRefMismatchScenarios } from './version-merge-base-gate-public-closure-ref-mismatch-scenarios';
import { registerPublicMergeBaseGateMissingObjectScenarios } from './version-merge-base-gate-public-missing-object-scenarios';
import { registerPublicMergeBaseGateUnrelatedHistoriesScenarios } from './version-merge-base-gate-public-unrelated-histories-scenarios';
import { registerPublicMergeBaseGateUnsupportedAncestryScenarios } from './version-merge-base-gate-public-unsupported-ancestry-scenarios';

export { registerPublicMergeBaseGateAlreadyMergedAncestorScenarios } from './version-merge-base-gate-public-already-merged-ancestor-scenarios';
export { registerPublicMergeBaseGateAmbiguousHistoriesScenarios } from './version-merge-base-gate-public-ambiguous-histories-scenarios';
export { registerPublicMergeBaseGateBaseProofScenarios } from './version-merge-base-gate-public-base-proof-scenarios';
export { registerPublicMergeBaseGateClosureRefMismatchScenarios } from './version-merge-base-gate-public-closure-ref-mismatch-scenarios';
export { registerPublicMergeBaseGateMissingObjectScenarios } from './version-merge-base-gate-public-missing-object-scenarios';
export { registerPublicMergeBaseGateUnrelatedHistoriesScenarios } from './version-merge-base-gate-public-unrelated-histories-scenarios';
export { registerPublicMergeBaseGateUnsupportedAncestryScenarios } from './version-merge-base-gate-public-unsupported-ancestry-scenarios';

export function describePublicMergeBaseGateScenarios() {
  registerPublicMergeBaseGateUnrelatedHistoriesScenarios();
  registerPublicMergeBaseGateAmbiguousHistoriesScenarios();
  registerPublicMergeBaseGateMissingObjectScenarios();
  registerPublicMergeBaseGateBaseProofScenarios();
  registerPublicMergeBaseGateUnsupportedAncestryScenarios();
  registerPublicMergeBaseGateClosureRefMismatchScenarios();
  registerPublicMergeBaseGateAlreadyMergedAncestorScenarios();
}
