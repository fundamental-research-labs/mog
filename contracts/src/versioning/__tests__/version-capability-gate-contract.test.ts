import { CONTROL_PLANE_ENTRYPOINT_IDS } from '../../control-plane';
import {
  VERSION_CAPABILITY_GATE_CAS_RESULT_REASONS,
  VERSION_CAPABILITY_GATE_CAS_RESULT_STATUSES,
  VERSION_CAPABILITY_GATE_DRY_RUN_RESULT_REASONS,
  VERSION_CAPABILITY_GATE_DRY_RUN_RESULT_STATUSES,
  VERSION_CAPABILITY_GATE_ENTRYPOINT_IDS,
  VERSIONING_CONTRACT_FIXTURES,
} from '../index';
import type {
  VersionCapabilityGate,
  VersionCapabilityGateCompareAndSwapContract,
  VersionCapabilityGateCompareAndSwapRequest,
  VersionCapabilityGateCompareAndSwapResult,
  VersionCapabilityGateCompareAndSwapResultReason,
  VersionCapabilityGateDryRunContract,
  VersionCapabilityGateDryRunRequest,
  VersionCapabilityGateDryRunResult,
  VersionCapabilityGateDryRunResultReason,
  VersionCapabilityGateEntrypointId,
} from '../index';

type Assert<T extends true> = T;
type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type ExpectedVersionCapabilityGateEntrypointId =
  | 'control-plane.capability-gates.read'
  | 'control-plane.capability-gates.dry-run'
  | 'control-plane.capability-gates.compare-and-swap';
type ExpectedDryRunReason = 'noop' | 'unavailable';
type ExpectedCasReason = 'unavailable' | 'stale-cas-token';

type _ExactEntrypointSet = Assert<
  IsEqual<VersionCapabilityGateEntrypointId, ExpectedVersionCapabilityGateEntrypointId>
>;
type _ExactDryRunReasonSet = Assert<
  IsEqual<VersionCapabilityGateDryRunResultReason, ExpectedDryRunReason>
>;
type _ExactCasReasonSet = Assert<
  IsEqual<VersionCapabilityGateCompareAndSwapResultReason, ExpectedCasReason>
>;

describe('VersionCapabilityGate public dry-run/CAS contracts', () => {
  it('pins the public capability-gate entrypoints and closed result taxonomies', () => {
    expect(VERSION_CAPABILITY_GATE_ENTRYPOINT_IDS).toEqual([
      'control-plane.capability-gates.read',
      'control-plane.capability-gates.dry-run',
      'control-plane.capability-gates.compare-and-swap',
    ]);
    for (const entrypointId of VERSION_CAPABILITY_GATE_ENTRYPOINT_IDS) {
      expect(CONTROL_PLANE_ENTRYPOINT_IDS).toContain(entrypointId);
    }
    expect(VERSION_CAPABILITY_GATE_DRY_RUN_RESULT_STATUSES).toEqual(['not-applied']);
    expect(VERSION_CAPABILITY_GATE_DRY_RUN_RESULT_REASONS).toEqual(['noop', 'unavailable']);
    expect(VERSION_CAPABILITY_GATE_CAS_RESULT_STATUSES).toEqual(['not-applied']);
    expect(VERSION_CAPABILITY_GATE_CAS_RESULT_REASONS).toEqual(['unavailable', 'stale-cas-token']);
  });

  it('models dry-run as a non-mutating preflight bound to gate scope and digest', () => {
    const gate = VERSIONING_CONTRACT_FIXTURES.versionCapabilityGate satisfies VersionCapabilityGate;
    const request =
      VERSIONING_CONTRACT_FIXTURES.controlPlanePreflight satisfies VersionCapabilityGateDryRunRequest;
    const result: VersionCapabilityGateDryRunResult = Object.freeze({
      status: 'not-applied',
      reason: 'noop',
      applied: false,
      casKey: request.casKey,
      expectedPriorStage: request.expectedPriorStage,
      targetStage: request.targetStage,
      priorScope: request.priorScope,
      targetScope: request.targetScope,
      scopeDelta: request.scopeDelta,
      diagnostics: Object.freeze([]),
      preflightDigest: request.preflightDigest,
    });
    const contract: VersionCapabilityGateDryRunContract = Object.freeze({
      entrypointId: 'control-plane.capability-gates.dry-run',
      request,
      result,
    });

    expect(contract.entrypointId).toBe('control-plane.capability-gates.dry-run');
    expect(result).toMatchObject({
      status: 'not-applied',
      reason: 'noop',
      applied: false,
      casKey: gate.gateId,
      expectedPriorStage: gate.rolloutStage,
      targetStage: 'headless-local',
    });
    expect(result.priorScope).toEqual(gate.scope);
    expect(result.targetScope).toEqual(gate.scope);
    expect(result.preflightDigest).toEqual(gate.preflightDigest);
    expect(result).not.toHaveProperty('casReceipt');
  });

  it('models stale-token CAS as not-applied with a receipt and post-CAS readback token', () => {
    const request =
      VERSIONING_CONTRACT_FIXTURES.controlPlaneCompareAndSwap satisfies VersionCapabilityGateCompareAndSwapRequest;
    const readbackCasToken = Object.freeze({
      token: 'vc11-current-fixture-token',
      version: '2',
    });
    const result: VersionCapabilityGateCompareAndSwapResult = Object.freeze({
      status: 'not-applied',
      reason: 'stale-cas-token',
      applied: false,
      casKey: request.casKey,
      expectedPriorStage: request.expectedPriorStage,
      targetStage: request.targetStage,
      priorScope: request.priorScope,
      targetScope: request.targetScope,
      scopeDelta: request.scopeDelta,
      diagnostics: Object.freeze([
        Object.freeze({
          severity: 'warning',
          code: 'VERSION_CAPABILITY_GATE_STALE_CAS_TOKEN',
          entrypointId: 'control-plane.capability-gates.compare-and-swap',
        }),
      ]),
      preflightDigest: request.preflightDigest,
      expectedPriorCasToken: request.expectedPriorCasToken,
      casReceipt: Object.freeze({
        applied: false,
        reason: 'stale-cas-token',
        casKey: request.casKey,
        expectedPriorCasToken: request.expectedPriorCasToken,
        readbackCasToken,
      }),
    });
    const contract: VersionCapabilityGateCompareAndSwapContract = Object.freeze({
      entrypointId: 'control-plane.capability-gates.compare-and-swap',
      request,
      result,
    });

    expect(contract.entrypointId).toBe('control-plane.capability-gates.compare-and-swap');
    expect(result).toMatchObject({
      status: 'not-applied',
      reason: 'stale-cas-token',
      applied: false,
      casKey: contract.request.casKey,
      expectedPriorStage: contract.request.expectedPriorStage,
      targetStage: contract.request.targetStage,
      expectedPriorCasToken: contract.request.expectedPriorCasToken,
    });
    expect(result.casReceipt).toMatchObject({
      applied: false,
      reason: 'stale-cas-token',
      casKey: contract.request.casKey,
      expectedPriorCasToken: contract.request.expectedPriorCasToken,
      readbackCasToken: {
        token: 'vc11-current-fixture-token',
        version: '2',
      },
    });
    expect(result.casReceipt.readbackCasToken).not.toEqual(contract.request.expectedPriorCasToken);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'VERSION_CAPABILITY_GATE_STALE_CAS_TOKEN',
    ]);
  });
});
