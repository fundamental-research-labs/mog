import type {
  ControlPlaneCompareAndSwapRequest,
  ControlPlaneDryRunRequest,
} from '../control-plane';
import type {
  CapturePolicy,
  DomainCapabilityPolicyManifest,
  ObjectDigest,
  VersionWriteAdmissionMode,
  VersionCapabilityGate,
  VersionDomainCapabilityState,
  VersionDomainClass,
} from './index';

type Assert<T extends true> = T;
type IsNever<T> = [T] extends [never] ? true : false;
type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type ExpectedDomainClass =
  | 'authored'
  | 'derived'
  | 'transient'
  | 'packageFidelity'
  | 'secret'
  | 'external';
type ExpectedDomainCapabilityState =
  | 'not-started'
  | 'contracted'
  | 'supported'
  | 'derived'
  | 'excluded'
  | 'opaque-preserved'
  | 'opaque-blocking';
type ExpectedCapturePolicy =
  | 'commitEligible'
  | 'excluded'
  | 'derivedOnly'
  | 'rootCreation'
  | 'historyGap'
  | 'shadowOnly';
type ExpectedWriteAdmissionMode =
  | 'capture'
  | 'shadowOnly'
  | 'captureDisabledNoHistory'
  | 'captureSuspendedWithGap'
  | 'block';

type _NoExpectedFailingDomainCapabilityState = Assert<
  IsNever<Extract<VersionDomainCapabilityState, 'expected-failing'>>
>;
type _ExactDomainClassSet = Assert<IsEqual<VersionDomainClass, ExpectedDomainClass>>;
type _ExactDomainCapabilityStateSet = Assert<
  IsEqual<VersionDomainCapabilityState, ExpectedDomainCapabilityState>
>;
type _ExactCapturePolicySet = Assert<IsEqual<CapturePolicy, ExpectedCapturePolicy>>;
type _ExactWriteAdmissionModeSet = Assert<
  IsEqual<VersionWriteAdmissionMode, ExpectedWriteAdmissionMode>
>;
type _CapabilityStateFieldUsesCapabilityUnion = Assert<
  IsEqual<DomainCapabilityPolicyManifest['capabilityState'], VersionDomainCapabilityState>
>;
type _DomainClassFieldUsesDomainClassUnion = Assert<
  IsEqual<DomainCapabilityPolicyManifest['domainClass'], VersionDomainClass>
>;
type _CapturePolicyFieldUsesCapturePolicyUnion = Assert<
  IsEqual<DomainCapabilityPolicyManifest['capturePolicy'], CapturePolicy>
>;
type _CapabilityStateUnionIsNotDomainClassUnion = Assert<
  IsEqual<VersionDomainCapabilityState, VersionDomainClass> extends true ? false : true
>;
type _CapabilityStateUnionIsNotCapturePolicyUnion = Assert<
  IsEqual<VersionDomainCapabilityState, CapturePolicy> extends true ? false : true
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
    domainIds: Object.freeze(['authored-grid']),
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
  domainId: 'authored-grid',
  domainClass: 'authored',
  capabilityState: 'contracted',
  capturePolicy: 'shadowOnly',
  writeAdmissionMode: 'shadowOnly',
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
