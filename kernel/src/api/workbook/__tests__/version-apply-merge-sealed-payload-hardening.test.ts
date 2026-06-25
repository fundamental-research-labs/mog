import { registerWrongArtifactBindingScenario } from './version-apply-merge-sealed-payload-hardening-artifact-binding';
import { registerAuthorityBindingScenario } from './version-apply-merge-sealed-payload-hardening-authority-binding';
import { registerDuplicateRefsScenario } from './version-apply-merge-sealed-payload-hardening-duplicate-refs';
import { registerMissingConflictDigestScenario } from './version-apply-merge-sealed-payload-hardening-missing-conflict-digest';
import { registerPrincipalMetadataScenario } from './version-apply-merge-sealed-payload-hardening-principal-metadata';
import { registerStaleConflictDigestScenario } from './version-apply-merge-sealed-payload-hardening-stale-conflict-digest';

describe('WorkbookVersion applyMerge sealed payload hardening', () => {
  registerStaleConflictDigestScenario();
  registerWrongArtifactBindingScenario();
  registerPrincipalMetadataScenario();
  registerMissingConflictDigestScenario();
  registerAuthorityBindingScenario();
  registerDuplicateRefsScenario();
});
