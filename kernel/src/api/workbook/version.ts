import type {
  WorkbookVersion,
  WorkbookVersionCapabilityStatus,
  WorkbookVersionDiagnostic,
  WorkbookVersionHead,
  WorkbookVersionHeadStatus,
  WorkbookVersionRolloutStage,
  WorkbookVersionStatus,
} from '@mog-sdk/contracts/api';

import { observeMutationAdmission } from '../../bridges/compute/mutation-admission';
import type { DocumentContext } from '../../context';
import { REF_NAME_STORAGE_PREFIX } from '../../document/version-store/ref-name';
import { VERSION_OBJECT_SCHEMA_VERSION } from '../../document/version-store/object-store';

type AttachedVersionHeadService = {
  getHead(): Promise<WorkbookVersionHead | WorkbookVersionHeadStatus | null>;
};

type AttachedVersionServices = {
  readonly objectStore?: unknown;
  readonly refStore?: unknown;
  readonly headService?: AttachedVersionHeadService;
  readonly getHead?: AttachedVersionHeadService['getHead'];
};

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: AttachedVersionServices;
  readonly versionStore?: AttachedVersionServices;
  readonly version?: AttachedVersionServices;
};

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

function getAttachedVersionServices(ctx: DocumentContext): AttachedVersionServices | null {
  const runtime = ctx as MaybeVersionRuntimeContext;
  return runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
}

function getHeadReader(
  services: AttachedVersionServices | null,
): AttachedVersionHeadService['getHead'] | null {
  if (services?.headService?.getHead) {
    return services.headService.getHead.bind(services.headService);
  }
  if (services?.getHead) {
    return services.getHead.bind(services);
  }
  return null;
}

function getRolloutStage(provenanceAdmissionPresent: boolean): WorkbookVersionRolloutStage {
  return provenanceAdmissionPresent ? 'shadow-only' : 'disabled';
}

function normalizeHeadResult(
  result: WorkbookVersionHead | WorkbookVersionHeadStatus | null,
  rolloutStage: WorkbookVersionRolloutStage,
): WorkbookVersionHeadStatus {
  if (result === null) {
    return {
      schemaVersion: 1,
      rolloutStage,
      head: null,
      diagnostics: [],
    };
  }

  if ('head' in result) {
    return {
      schemaVersion: 1,
      rolloutStage: result.rolloutStage,
      head: result.head,
      diagnostics: result.diagnostics,
    };
  }

  return {
    schemaVersion: 1,
    rolloutStage,
    head: result,
    diagnostics: [],
  };
}

export class WorkbookVersionImpl implements WorkbookVersion {
  constructor(private readonly ctx: DocumentContext) {}

  async getStatus(): Promise<WorkbookVersionStatus> {
    const services = getAttachedVersionServices(this.ctx);
    const provenanceAdmissionPresent = typeof observeMutationAdmission === 'function';
    const rolloutStage = getRolloutStage(provenanceAdmissionPresent);

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
      'Public commit APIs are pending and are not exposed by this read-only slice.',
      'VC-04',
    );
    const checkoutPending = diagnostic(
      'version.checkout.pending',
      'warning',
      'Checkout materialization APIs are pending and are not exposed by this read-only slice.',
      'VC-05',
    );
    const mergePending = diagnostic(
      'version.merge.pending',
      'warning',
      'Merge APIs are pending and are not exposed by this read-only slice.',
      'VC-07',
    );
    const provenanceAdmission = diagnostic(
      provenanceAdmissionPresent
        ? 'version.provenanceAdmission.present'
        : 'version.provenanceAdmission.unavailable',
      provenanceAdmissionPresent ? 'info' : 'warning',
      provenanceAdmissionPresent
        ? 'Mutation provenance admission foundation is present.'
        : 'Mutation provenance admission foundation is unavailable.',
      'VC-02',
    );

    const objectStoreDiagnostics = services?.objectStore
      ? [objectStoreFoundation]
      : [objectStoreFoundation, objectStoreServiceUnavailable];
    const refLifecycleDiagnostics = services?.refStore
      ? [refLifecycleFoundation]
      : [refLifecycleFoundation, refLifecycleServiceUnavailable];

    const diagnostics = [
      ...objectStoreDiagnostics,
      ...refLifecycleDiagnostics,
      commitApiPending,
      checkoutPending,
      mergePending,
      provenanceAdmission,
    ];

    return {
      schemaVersion: 1,
      rolloutStage,
      objectStoreFoundation: capability('present', true, 'VC-04', objectStoreDiagnostics),
      refLifecycleFoundation: capability('present', true, 'VC-05', refLifecycleDiagnostics),
      commitApi: capability('pending', false, 'VC-04', [commitApiPending]),
      checkout: capability('pending', false, 'VC-05', [checkoutPending]),
      merge: capability('pending', false, 'VC-07', [mergePending]),
      provenanceAdmission: capability(
        provenanceAdmissionPresent ? 'present' : 'unavailable',
        provenanceAdmissionPresent,
        'VC-02',
        [provenanceAdmission],
      ),
      diagnostics,
    };
  }

  async getHead(): Promise<WorkbookVersionHeadStatus> {
    const provenanceAdmissionPresent = typeof observeMutationAdmission === 'function';
    const rolloutStage = getRolloutStage(provenanceAdmissionPresent);
    const services = getAttachedVersionServices(this.ctx);
    const getHead = getHeadReader(services);

    if (!getHead) {
      return {
        schemaVersion: 1,
        rolloutStage,
        head: null,
        diagnostics: [
          diagnostic(
            'version.head.serviceUnavailable',
            'warning',
            'No commit/ref head service is attached yet; no commit history is fabricated.',
            'version-service',
          ),
        ],
      };
    }

    return normalizeHeadResult(await getHead(), rolloutStage);
  }
}
