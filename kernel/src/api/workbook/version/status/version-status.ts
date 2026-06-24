import type {
  WorkbookVersionCapabilityStatus,
  WorkbookVersionDiagnostic,
  WorkbookVersionRolloutStage,
  WorkbookVersionStatus,
} from '@mog-sdk/contracts/api';

import { observeMutationAdmission } from '../../../../bridges/compute/mutation-admission';
import type { DocumentContext } from '../../../../context';
import { VERSION_OBJECT_SCHEMA_VERSION } from '../../../../document/version-store/object-store';
import { REF_NAME_STORAGE_PREFIX } from '../../../../document/version-store/refs/ref-name';
import { hasAttachedVersionCheckoutService } from '../../version-checkout';
import { hasAttachedVersionWriteService } from '../commit/version-commit';
import { hasAttachedVersionMergeService } from '../../version-merge';
import { hasAttachedPendingRemotePromotionService } from '../pending/remote';
import { projectWorkbookVersionProvenanceStatusDiagnostics } from '../provenance/version-provenance-truth-service';
import { hasAttachedVersionRefLifecycleService } from '../refs/version-refs';
import {
  getAttachedVersionServices,
  hasCompleteVc09ProvenanceTruth,
} from './version-service-attachments';

export function getWorkbookVersionStatus(ctx: DocumentContext): WorkbookVersionStatus {
  const services = getAttachedVersionServices(ctx);
  const writeServiceAttached = hasAttachedVersionWriteService(ctx);
  const refLifecycleServiceAttached = hasAttachedVersionRefLifecycleService(ctx);
  const checkoutServiceAttached = hasAttachedVersionCheckoutService(ctx);
  const mergeServiceAttached = hasAttachedVersionMergeService(ctx);
  const mutationAdmissionFoundationPresent = typeof observeMutationAdmission === 'function';
  const pendingRemotePromotionServiceAttached = hasAttachedPendingRemotePromotionService(ctx);
  const provenanceTruthComplete = hasCompleteVc09ProvenanceTruth(services);
  const rolloutStage = getRolloutStage(provenanceTruthComplete);

  const objectStoreFoundation = diagnostic(
    'version.objectStore.foundationPresent',
    'info',
    'Version object store foundation is present.',
    'VC-04',
    { schemaVersion: VERSION_OBJECT_SCHEMA_VERSION },
  );
  const objectStoreServiceUnavailable = diagnostic(
    'version.objectStore.serviceUnavailable',
    'warning',
    'No document-scoped version object store service is attached yet.',
    'version-service',
  );
  const refLifecycleFoundation = diagnostic(
    'version.refLifecycle.foundationPresent',
    'info',
    'Version ref lifecycle foundation is present.',
    'VC-05',
    { storagePrefix: REF_NAME_STORAGE_PREFIX },
  );
  const refLifecycleServiceUnavailable = diagnostic(
    'version.refLifecycle.serviceUnavailable',
    'warning',
    'No document-scoped ref lifecycle service is attached yet.',
    'version-service',
  );
  const commitApiPending = diagnostic(
    'version.commitApi.pending',
    'warning',
    'Public commit API is exposed but no document-scoped version write service is attached yet.',
    'VC-04',
  );
  const commitApiServiceAttached = diagnostic(
    'version.commitApi.serviceAttached',
    'info',
    'Document-scoped public version commit service is attached.',
    'version-service',
  );
  const checkoutPending = diagnostic(
    'version.checkout.pending',
    'warning',
    'Public checkout facade is exposed, but no production materializer lifecycle attachment is reported yet.',
    'VC-05',
  );
  const checkoutServiceAttachedDiagnostic = diagnostic(
    'version.checkout.serviceAttached',
    'info',
    'Document-scoped public checkout materialization service is attached.',
    'version-service',
  );
  const mergePending = diagnostic(
    'version.merge.pending',
    'warning',
    'Public merge preview API is exposed, but no document-scoped merge service is attached yet.',
    'VC-07',
  );
  const mergeServiceAttachedDiagnostic = diagnostic(
    'version.merge.serviceAttached',
    'info',
    'Document-scoped public merge preview service is attached.',
    'version-service',
  );
  const provenanceAdmission = provenanceTruthComplete
    ? diagnostic(
        'version.provenanceAdmission.present',
        'info',
        'Complete VC-09 provenance admission truth is attached.',
        'version-service',
        { requiredSlice: 'VC-09' },
      )
    : diagnostic(
        'version.provenanceAdmission.vc09TruthUnavailable',
        'warning',
        'Complete VC-09 provenance admission truth is not attached; broad mutation admission and pending remote promotion plumbing are insufficient.',
        'version-service',
        {
          requiredSlice: 'VC-09',
          mutationAdmissionFoundationPresent,
          pendingRemotePromotionServiceAttached,
        },
      );
  const mutationAdmissionFoundation = diagnostic(
    mutationAdmissionFoundationPresent
      ? 'version.provenanceAdmission.mutationAdmissionFoundationPresent'
      : 'version.provenanceAdmission.mutationAdmissionFoundationUnavailable',
    mutationAdmissionFoundationPresent ? 'info' : 'warning',
    mutationAdmissionFoundationPresent
      ? 'VC-02 mutation admission plumbing is present but does not prove complete VC-09 provenance truth.'
      : 'VC-02 mutation admission plumbing is unavailable.',
    'VC-02',
    { sufficientForVc09Truth: false },
  );
  const provenancePromotionServiceAttached = diagnostic(
    'version.provenancePromotion.serviceAttached',
    'info',
    'Document-scoped pending remote provenance promotion service is attached but does not prove complete VC-09 provenance truth.',
    'version-service',
    { sufficientForVc09Truth: false },
  );
  const provenanceStatusProjectionDiagnostics = provenanceTruthComplete
    ? projectWorkbookVersionProvenanceStatusDiagnostics([
        services?.provenanceStatusService,
        services?.provenanceTruthService,
        services?.provenanceAdmissionService,
        services,
      ])
    : [];

  const objectStoreDiagnostics = services?.objectStore
    ? [objectStoreFoundation]
    : [objectStoreFoundation, objectStoreServiceUnavailable];
  const refLifecycleDiagnostics =
    refLifecycleServiceAttached || services?.refStore
      ? [refLifecycleFoundation]
      : [refLifecycleFoundation, refLifecycleServiceUnavailable];
  const commitApiDiagnostics = writeServiceAttached
    ? [commitApiServiceAttached]
    : [commitApiPending];
  const checkoutDiagnostics = checkoutServiceAttached
    ? [checkoutServiceAttachedDiagnostic]
    : [checkoutPending];
  const provenanceDiagnostics = [
    provenanceAdmission,
    ...provenanceStatusProjectionDiagnostics,
    mutationAdmissionFoundation,
    ...(pendingRemotePromotionServiceAttached ? [provenancePromotionServiceAttached] : []),
  ];
  const checkoutStage = checkoutServiceAttached ? 'present' : 'pending';
  const checkoutDependency = checkoutServiceAttached ? 'version-service' : 'VC-05';
  const diagnostics = [
    ...objectStoreDiagnostics,
    ...refLifecycleDiagnostics,
    ...commitApiDiagnostics,
    ...checkoutDiagnostics,
    mergeServiceAttached ? mergeServiceAttachedDiagnostic : mergePending,
    ...provenanceDiagnostics,
  ];
  return {
    schemaVersion: 1,
    rolloutStage,
    objectStoreFoundation: capability('present', true, 'VC-04', objectStoreDiagnostics),
    refLifecycleFoundation: capability('present', true, 'VC-05', refLifecycleDiagnostics),
    commitApi: capability(
      writeServiceAttached ? 'present' : 'pending',
      writeServiceAttached,
      'VC-04',
      commitApiDiagnostics,
    ),
    checkout: capability(
      checkoutStage,
      checkoutServiceAttached,
      checkoutDependency,
      checkoutDiagnostics,
    ),
    merge: capability(
      mergeServiceAttached ? 'present' : 'pending',
      mergeServiceAttached,
      mergeServiceAttached ? 'version-service' : 'VC-07',
      [mergeServiceAttached ? mergeServiceAttachedDiagnostic : mergePending],
    ),
    provenanceAdmission: capability(
      provenanceTruthComplete ? 'present' : 'unavailable',
      provenanceTruthComplete,
      'version-service',
      provenanceDiagnostics,
    ),
    diagnostics,
  };
}

function diagnostic(
  code: WorkbookVersionDiagnostic['code'],
  severity: WorkbookVersionDiagnostic['severity'],
  message: string,
  dependency: WorkbookVersionDiagnostic['dependency'],
  data?: WorkbookVersionDiagnostic['data'],
): WorkbookVersionDiagnostic {
  return {
    code,
    severity,
    message,
    dependency,
    ...(data ? { data } : {}),
  };
}

function capability(
  stage: WorkbookVersionCapabilityStatus['stage'],
  available: boolean,
  dependency: WorkbookVersionCapabilityStatus['dependency'],
  diagnostics: readonly WorkbookVersionDiagnostic[],
): WorkbookVersionCapabilityStatus {
  return {
    stage,
    available,
    dependency,
    diagnostics,
  };
}

function getRolloutStage(provenanceAdmissionPresent: boolean): WorkbookVersionRolloutStage {
  return provenanceAdmissionPresent ? 'shadow-only' : 'disabled';
}
