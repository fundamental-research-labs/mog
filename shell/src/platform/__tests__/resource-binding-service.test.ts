import { createResourceBindingService } from '../resource-binding-service';
import type { BindingError } from '../resource-binding-service';
import type { ResourceBindingDescriptor, ResolvedResourceBinding } from '../types';

function makeDescriptor(overrides?: Partial<ResourceBindingDescriptor>): ResourceBindingDescriptor {
  return {
    resourceKind: 'mog.test.widget',
    resourceId: 'widget-1',
    accessMode: 'readwrite',
    setupPolicy: 'eager',
    label: 'Test Widget',
    ...overrides,
  };
}

function isBindingError(result: ResolvedResourceBinding | BindingError): result is BindingError {
  return 'ok' in result && result.ok === false;
}

describe('ResourceBindingService', () => {
  it('resolves a binding and assigns a lease', () => {
    const svc = createResourceBindingService();
    const result = svc.resolveBinding(makeDescriptor(), 'app-1');

    expect(isBindingError(result)).toBe(false);
    const binding = result as ResolvedResourceBinding;
    expect(binding.leaseId).toBeTruthy();
    expect(binding.grantSubject).toBe('app-1');
    expect(binding.resourceRef.kind).toBe('mog.test.widget');
    expect(binding.resourceRef.id).toBe('widget-1');
    expect(binding.resolvedAt).toBeGreaterThan(0);
  });

  it('returns error for missing resource kind', () => {
    const svc = createResourceBindingService();
    const result = svc.resolveBinding(makeDescriptor({ resourceKind: '' }), 'app-1');
    expect(isBindingError(result)).toBe(true);
    expect((result as BindingError).code).toBe('MISSING_KIND');
  });

  it('returns error for missing resource ID', () => {
    const svc = createResourceBindingService();
    const result = svc.resolveBinding(makeDescriptor({ resourceId: '' }), 'app-1');
    expect(isBindingError(result)).toBe(true);
    expect((result as BindingError).code).toBe('MISSING_ID');
  });

  it('looks up binding by lease ID', () => {
    const svc = createResourceBindingService();
    const binding = svc.resolveBinding(makeDescriptor(), 'app-1') as ResolvedResourceBinding;
    expect(svc.getBinding(binding.leaseId)).toBe(binding);
  });

  it('returns undefined for unknown lease ID', () => {
    const svc = createResourceBindingService();
    expect(svc.getBinding('nonexistent')).toBeUndefined();
  });

  describe('lease state transitions', () => {
    it('starts in active state', () => {
      const svc = createResourceBindingService();
      const binding = svc.resolveBinding(makeDescriptor(), 'app-1') as ResolvedResourceBinding;
      expect(svc.getLeaseState(binding.leaseId)).toBe('active');
    });

    it('suspend retain: active -> suspended-retain -> active', () => {
      const svc = createResourceBindingService();
      const binding = svc.resolveBinding(makeDescriptor(), 'app-1') as ResolvedResourceBinding;

      svc.suspendLease(binding.leaseId, 'retain');
      expect(svc.getLeaseState(binding.leaseId)).toBe('suspended-retain');

      svc.resumeLease(binding.leaseId);
      expect(svc.getLeaseState(binding.leaseId)).toBe('active');
    });

    it('suspend downgrade: active -> suspended-downgrade -> active', () => {
      const svc = createResourceBindingService();
      const binding = svc.resolveBinding(makeDescriptor(), 'app-1') as ResolvedResourceBinding;

      svc.suspendLease(binding.leaseId, 'downgrade');
      expect(svc.getLeaseState(binding.leaseId)).toBe('suspended-downgrade');

      svc.resumeLease(binding.leaseId);
      expect(svc.getLeaseState(binding.leaseId)).toBe('active');
    });

    it('release: active -> released', () => {
      const svc = createResourceBindingService();
      const binding = svc.resolveBinding(makeDescriptor(), 'app-1') as ResolvedResourceBinding;

      svc.releaseLease(binding.leaseId);
      expect(svc.getLeaseState(binding.leaseId)).toBe('released');
    });

    it('released lease returns undefined on getBinding', () => {
      const svc = createResourceBindingService();
      const binding = svc.resolveBinding(makeDescriptor(), 'app-1') as ResolvedResourceBinding;

      svc.releaseLease(binding.leaseId);
      expect(svc.getBinding(binding.leaseId)).toBeUndefined();
    });

    it('transfer: active -> transferred', () => {
      const svc = createResourceBindingService();
      const binding = svc.resolveBinding(makeDescriptor(), 'app-1') as ResolvedResourceBinding;

      svc.transferLease(binding.leaseId, 'app-2');
      expect(svc.getLeaseState(binding.leaseId)).toBe('transferred');
      expect(svc.getBinding(binding.leaseId)!.grantSubject).toBe('app-2');
    });

    it('cannot suspend an already-released lease', () => {
      const svc = createResourceBindingService();
      const binding = svc.resolveBinding(makeDescriptor(), 'app-1') as ResolvedResourceBinding;

      svc.releaseLease(binding.leaseId);
      expect(() => svc.suspendLease(binding.leaseId, 'retain')).toThrow();
    });

    it('cannot resume an active lease', () => {
      const svc = createResourceBindingService();
      const binding = svc.resolveBinding(makeDescriptor(), 'app-1') as ResolvedResourceBinding;

      expect(() => svc.resumeLease(binding.leaseId)).toThrow();
    });

    it('cannot release an already-released lease', () => {
      const svc = createResourceBindingService();
      const binding = svc.resolveBinding(makeDescriptor(), 'app-1') as ResolvedResourceBinding;

      svc.releaseLease(binding.leaseId);
      expect(() => svc.releaseLease(binding.leaseId)).toThrow(/terminal state/);
    });
  });

  describe('createBindingSnapshot', () => {
    it('strips internal details from binding', () => {
      const svc = createResourceBindingService();
      const binding = svc.resolveBinding(makeDescriptor(), 'app-1') as ResolvedResourceBinding;

      const snapshot = svc.createBindingSnapshot(binding);
      expect(snapshot).toEqual({
        resourceKind: 'mog.test.widget',
        resourceId: 'widget-1',
        accessMode: 'readwrite',
        label: 'Test Widget',
      });

      // Verify internal fields are NOT present
      expect(snapshot).not.toHaveProperty('leaseId');
      expect(snapshot).not.toHaveProperty('grantSubject');
      expect(snapshot).not.toHaveProperty('resolvedAt');
      expect(snapshot).not.toHaveProperty('resourceRef');
      expect(snapshot).not.toHaveProperty('descriptor');
    });
  });
});
