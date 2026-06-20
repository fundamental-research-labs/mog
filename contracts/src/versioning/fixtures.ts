import type {
  ControlPlaneCompareAndSwapRequest,
  ControlPlaneDryRunRequest,
} from '../control-plane';
import type {
  CapturePolicy,
  DomainCapabilityPolicyManifest,
  ObjectDigest,
  VersionCapabilityGate,
  VersionDomainCapabilityState,
  VersionDomainClass,
} from './index';

type Assert<T extends true> = T;
type IsNever<T> = [T] extends [never] ? true : false;

type _NoExpectedFailingDomainCapabilityState = Assert<
  IsNever<Extract<VersionDomainCapabilityState, 'expected-failing'>>
>;
type _CapabilityStateIsSeparateFromDomainClass = Assert<
  IsNever<Extract<VersionDomainCapabilityState, VersionDomainClass>>
>;
type _CapabilityStateIsSeparateFromCapturePolicy = Assert<
  IsNever<Extract<VersionDomainCapabilityState, CapturePolicy>>
>;

const digest: ObjectDigest = Object.freeze({
  algorithm: 'sha256',
  value: 'sha256:vc02-batch-a-public-contract-spine',
});

const versionCapabilityGate: VersionCapabilityGate = Object.freeze({
  gateId: 'versioning.batch-a',
  capabilityId: 'versioning.public-contract-spine',
  rolloutStage: 'shadow-only',
  scope: Object.freeze({
    domainIds: Object.freeze(['grid-data']),
    featureId: 'versioning',
  }),
  preflightDigest: Object.freeze({
    algorithm: 'sha256',
    value: digest.value,
  }),
  casToken: Object.freeze({
    token: 'vc02-fixture-token',
    version: '1',
  }),
});

const domainPolicy: DomainCapabilityPolicyManifest = Object.freeze({
  domainId: 'grid-data',
  domainClass: 'grid-data',
  capabilityState: 'shadow-only',
  capturePolicy: 'capture-shadow-only',
  writeAdmissionMode: 'shadow-only',
  rolloutStage: versionCapabilityGate.rolloutStage,
  historyAccess: Object.freeze({
    readMode: 'metadata-only',
    writeMode: 'shadow-only',
    redactionPolicy: 'metadata-only',
  }),
  redactionPolicy: 'metadata-only',
});

const controlPlanePreflight: ControlPlaneDryRunRequest = Object.freeze({
  casKey: versionCapabilityGate.gateId,
  expectedPriorStage: versionCapabilityGate.rolloutStage,
  targetStage: 'headless-local',
  priorScope: versionCapabilityGate.scope ?? Object.freeze({}),
  targetScope: versionCapabilityGate.scope ?? Object.freeze({}),
  scopeDelta: Object.freeze({
    summary: 'VC-02 Batch A public contract preflight fixture',
  }),
  preflightDigest: versionCapabilityGate.preflightDigest ?? Object.freeze({
    algorithm: 'opaque',
    value: 'missing',
  }),
  clientRequestId: 'vc02-preflight-fixture',
});

const controlPlaneCompareAndSwap: ControlPlaneCompareAndSwapRequest = Object.freeze({
  ...controlPlanePreflight,
  expectedPriorCasToken: versionCapabilityGate.casToken ?? Object.freeze({
    token: 'missing',
    version: '0',
  }),
});

export const VERSIONING_CONTRACT_FIXTURES = Object.freeze({
  digest,
  versionCapabilityGate,
  domainPolicy,
  controlPlanePreflight,
  controlPlaneCompareAndSwap,
});
