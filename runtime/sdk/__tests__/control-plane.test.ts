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
    const scope = { workbookId: 'workbook-public-id', labels: ['vc-a0'] };
    const digest = { algorithm: 'opaque' as const, value: 'public-digest' };

    const before = await controlPlane.readCapabilityGates({ scope });
    const dryRun = await controlPlane.dryRunCapabilityGate({
      gateId: 'capability-gate',
      scope,
      expectedDigest: digest,
    });
    const compareAndSwap = await controlPlane.compareAndSwapCapabilityGate({
      gateId: 'capability-gate',
      scope,
      expectedDigest: digest,
    });
    const after = await controlPlane.readCapabilityGates({ scope });

    expect(before).toMatchObject({
      status: 'disabled',
      scope,
      gates: [],
    });
    expect(dryRun).toMatchObject({
      status: 'not-applied',
      reason: 'noop',
      applied: false,
      scope,
      preflightDigest: digest,
    });
    expect(compareAndSwap).toMatchObject({
      status: 'not-applied',
      reason: 'unavailable',
      applied: false,
      scope,
      currentDigest: digest,
    });
    expect(after).toMatchObject({
      status: 'disabled',
      scope,
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
