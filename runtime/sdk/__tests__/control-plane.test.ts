import { CONTROL_PLANE_ENTRYPOINT_IDS } from '@mog-sdk/contracts/control-plane';
import {
  controlPlaneEntrypoints,
  createInertControlPlane,
  observeControlPlaneShadow,
} from '../src/control-plane';

describe('inert control plane', () => {
  it('publishes the stable public entrypoint inventory', () => {
    expect(CONTROL_PLANE_ENTRYPOINT_IDS).toEqual([
      'control-plane.capability-gates.read',
      'control-plane.capability-gates.dry-run',
      'control-plane.capability-gates.compare-and-swap',
      'control-plane.shadow.observe',
    ]);
    expect(controlPlaneEntrypoints.entrypoints.map((entrypoint) => entrypoint.id)).toEqual(
      CONTROL_PLANE_ENTRYPOINT_IDS,
    );
    expect(
      controlPlaneEntrypoints.entrypoints.every((entrypoint) => entrypoint.status === 'disabled'),
    ).toBe(true);
  });

  it('keeps read, dry-run, and compare-and-swap inert', async () => {
    const controlPlane = createInertControlPlane();
    const priorScope = { workbookId: 'workbook-public-id', labels: ['vc-a0'] };
    const targetScope = {
      workbookId: 'workbook-public-id',
      domainIds: ['first-slice'],
      surfaceIds: ['headless'],
      labels: ['vc-a0'],
    };
    const scopeDelta = { added: { domainIds: ['first-slice'] }, changedFields: ['domainIds'] };
    const digest = { algorithm: 'opaque' as const, value: 'public-digest' };
    const casToken = { token: 'prior-token', version: '1' };
    const artifactRuntimeRange = {
      runtimeKind: 'headless-sdk' as const,
      packageName: '@mog-sdk/sdk',
      minClientVersion: '0.9.6',
    };

    const before = await controlPlane.readCapabilityGates({ scope: priorScope });
    const dryRun = await controlPlane.dryRunCapabilityGate({
      casKey: 'capability-gate',
      expectedPriorStage: 'disabled',
      targetStage: 'shadow-only',
      priorScope,
      targetScope,
      scopeDelta,
      preflightDigest: digest,
      artifactRuntimeRange,
    });
    const compareAndSwap = await controlPlane.compareAndSwapCapabilityGate({
      casKey: 'capability-gate',
      expectedPriorStage: 'disabled',
      targetStage: 'shadow-only',
      priorScope,
      targetScope,
      scopeDelta,
      preflightDigest: digest,
      expectedPriorCasToken: casToken,
      artifactRuntimeRange,
    });
    const after = await controlPlane.readCapabilityGates({ scope: priorScope });

    expect(before).toMatchObject({
      status: 'disabled',
      scope: priorScope,
      gates: [],
    });
    expect(dryRun).toMatchObject({
      status: 'not-applied',
      reason: 'noop',
      applied: false,
      casKey: 'capability-gate',
      expectedPriorStage: 'disabled',
      targetStage: 'shadow-only',
      priorScope,
      targetScope,
      scopeDelta,
      preflightDigest: digest,
      artifactRuntimeRange,
    });
    expect(compareAndSwap).toMatchObject({
      status: 'not-applied',
      reason: 'unavailable',
      applied: false,
      casKey: 'capability-gate',
      expectedPriorStage: 'disabled',
      targetStage: 'shadow-only',
      priorScope,
      targetScope,
      scopeDelta,
      preflightDigest: digest,
      expectedPriorCasToken: casToken,
      artifactRuntimeRange,
      casReceipt: {
        applied: false,
        reason: 'unavailable',
        casKey: 'capability-gate',
        expectedPriorCasToken: casToken,
      },
    });
    expect(after).toMatchObject({
      status: 'disabled',
      scope: priorScope,
      gates: [],
    });
  });

  it('returns a no-op shadow unsubscribe', () => {
    let eventCount = 0;
    const disposable = observeControlPlaneShadow(() => {
      eventCount += 1;
    });

    disposable.dispose();
    disposable.dispose();

    expect(eventCount).toBe(0);

    const controlPlane = createInertControlPlane();
    const scopedDisposable = controlPlane.observeShadow(
      () => {
        eventCount += 1;
      },
      { scope: { featureId: 'shadow' } },
    );
    scopedDisposable.dispose();

    expect(eventCount).toBe(0);
  });
});
