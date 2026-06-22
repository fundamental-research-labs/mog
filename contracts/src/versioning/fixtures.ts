import type {
  ControlPlaneCompareAndSwapRequest,
  ControlPlaneDryRunRequest,
} from '../control-plane';
import type {
  CapturePolicy,
  DomainCapabilityPolicyManifest,
  DomainPresenceDetector,
  ObjectDigest,
  VersionWriteAdmissionMode,
  VersionCapabilityGate,
  VersionDomainCapabilityKey,
  VersionDomainCapabilityState,
  VersionDomainCapabilityStateMap,
  VersionDomainClass,
  VersionHistoryReadMode,
  VersionHistoryWriteMode,
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
type ExpectedDomainCapabilityKey =
  | 'capture'
  | 'replay'
  | 'diff'
  | 'reviewAccess'
  | 'checkout'
  | 'merge'
  | 'persistence'
  | 'import'
  | 'export';
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
type ExpectedHistoryReadMode = 'none' | 'metadata-only' | 'full';
type ExpectedHistoryWriteMode = 'none' | 'shadow-only' | 'gated' | 'full';

type _NoExpectedFailingDomainCapabilityState = Assert<
  IsNever<Extract<VersionDomainCapabilityState, 'expected-failing'>>
>;
type _ExactDomainClassSet = Assert<IsEqual<VersionDomainClass, ExpectedDomainClass>>;
type _ExactDomainCapabilityStateSet = Assert<
  IsEqual<VersionDomainCapabilityState, ExpectedDomainCapabilityState>
>;
type _ExactDomainCapabilityKeySet = Assert<
  IsEqual<VersionDomainCapabilityKey, ExpectedDomainCapabilityKey>
>;
type _ExactCapturePolicySet = Assert<IsEqual<CapturePolicy, ExpectedCapturePolicy>>;
type _ExactWriteAdmissionModeSet = Assert<
  IsEqual<VersionWriteAdmissionMode, ExpectedWriteAdmissionMode>
>;
type _ExactHistoryReadModeSet = Assert<IsEqual<VersionHistoryReadMode, ExpectedHistoryReadMode>>;
type _ExactHistoryWriteModeSet = Assert<IsEqual<VersionHistoryWriteMode, ExpectedHistoryWriteMode>>;
type _CapabilityStatesFieldUsesCapabilityMap = Assert<
  IsEqual<DomainCapabilityPolicyManifest['capabilityStates'], VersionDomainCapabilityStateMap>
>;
type _MatrixRowIdFieldUsesString = Assert<
  IsEqual<DomainCapabilityPolicyManifest['matrixRowId'], string>
>;
type _DetectorMatrixRowIdFieldUsesString = Assert<
  IsEqual<DomainPresenceDetector['matrixRowId'], string>
>;
type _LegacyCapabilityStateFieldUsesCapabilityUnion = Assert<
  IsEqual<
    Exclude<DomainCapabilityPolicyManifest['capabilityState'], undefined>,
    VersionDomainCapabilityState
  >
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

const contractedCapabilityStates: VersionDomainCapabilityStateMap = Object.freeze({
  capture: 'contracted',
  replay: 'contracted',
  diff: 'contracted',
  reviewAccess: 'contracted',
  checkout: 'contracted',
  merge: 'contracted',
  persistence: 'contracted',
  import: 'contracted',
  export: 'contracted',
});

const historyReadModes: readonly VersionHistoryReadMode[] = Object.freeze([
  'none',
  'metadata-only',
  'full',
]);
const historyWriteModes: readonly VersionHistoryWriteMode[] = Object.freeze([
  'none',
  'shadow-only',
  'gated',
  'full',
]);

const domainPolicy: DomainCapabilityPolicyManifest = Object.freeze({
  domainPolicyId: 'authored-grid',
  matrixRowId: 'authored-grid',
  domainId: 'authored-grid',
  domainClass: 'authored',
  capabilityStates: contractedCapabilityStates,
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

const domainPresenceDetector: DomainPresenceDetector = Object.freeze({
  detectorId: 'detector.authored-grid',
  matrixRowId: domainPolicy.matrixRowId,
  domainId: domainPolicy.domainId,
  domainClass: domainPolicy.domainClass,
  detectsObjectKinds: Object.freeze(['worksheet.cell']),
  capabilityStatesWhenPresent: contractedCapabilityStates,
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
  preflightDigest:
    versionCapabilityGate.preflightDigest ??
    Object.freeze({
      algorithm: 'opaque',
      value: 'missing',
    }),
  clientRequestId: 'vc02-preflight-fixture',
});

const controlPlaneCompareAndSwap: ControlPlaneCompareAndSwapRequest = Object.freeze({
  ...controlPlanePreflight,
  expectedPriorCasToken:
    versionCapabilityGate.casToken ??
    Object.freeze({
      token: 'missing',
      version: '0',
    }),
});

export const VERSIONING_CONTRACT_FIXTURES = Object.freeze({
  digest,
  historyReadModes,
  historyWriteModes,
  versionCapabilityGate,
  domainPolicy,
  domainPresenceDetector,
  controlPlanePreflight,
  controlPlaneCompareAndSwap,
});
