export type {
  MergeDomainReference,
  MergeMaterializationOperation,
  MergeMaterializationSupport,
} from './version-merge-materializer-support-types';

export {
  DEFAULT_MERGE_COMMIT_MATERIALIZER_KIND,
  isMaterializableMergeDomainReference,
} from './version-merge-materializer-support-domains';
export { unsupportedDetectedMergeDomainDiagnostic } from './version-merge-materializer-support-diagnostics';
export { inspectMaterializableMergeChange } from './version-merge-materializer-support-inspection';
export { materializableMergePlanDiagnostics } from './version-merge-materializer-support-plan-diagnostics';
