import { registerAbsentMetadataImportRootScenario } from './version-xlsx-external-change-branch-import-root-absent-metadata-scenario';
import { registerDigestMismatchImportRootScenario } from './version-xlsx-external-change-branch-import-root-digest-mismatch-scenario';
import { registerMissingTrustedBaseImportRootScenario } from './version-xlsx-external-change-branch-import-root-missing-base-scenario';
import { registerTrustedMissingHeadImportRootScenario } from './version-xlsx-external-change-branch-import-root-missing-head-scenario';
import { registerUntrustedCandidateImportRootScenario } from './version-xlsx-external-change-branch-import-root-untrusted-candidate-scenario';

describe('VC-10 XLSX external-change branch routing: import-root fallbacks', () => {
  registerAbsentMetadataImportRootScenario();
  registerMissingTrustedBaseImportRootScenario();
  registerDigestMismatchImportRootScenario();
  registerUntrustedCandidateImportRootScenario();
  registerTrustedMissingHeadImportRootScenario();
});
