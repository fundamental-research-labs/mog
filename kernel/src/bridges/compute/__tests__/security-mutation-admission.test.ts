import { jest } from '@jest/globals';

(globalThis as any).window = {};

import type { BridgeTransport } from '@rust-bridge/client';
import type { IKernelContext } from '@mog-sdk/contracts/kernel';
import { ComputeBridge } from '../compute-bridge';
import type { MutationAdmissionDiagnostic } from '../mutation-admission';

function makeMockContext(overrides: Partial<IKernelContext> = {}): IKernelContext {
  return {
    eventBus: { emit: jest.fn(), on: jest.fn(() => () => {}), off: jest.fn() },
    setPendingUndoDescription: jest.fn(),
    getPendingUndoDescription: jest.fn(() => null),
    clearPendingUndoDescription: jest.fn(),
    destroy: jest.fn(),
    services: {
      undo: {
        notifyForwardMutation: jest.fn(async () => undefined),
      },
    },
    ...overrides,
  } as unknown as IKernelContext;
}

function createStartedBridge(ctx: IKernelContext, transport: BridgeTransport): ComputeBridge {
  const bridge = new ComputeBridge(ctx, 'test-doc', transport);
  (bridge as any).core._phase = 'STARTED';
  (bridge as any).core.engineCreated = true;
  return bridge;
}

describe('security mutation admission', () => {
  it('admits security mutators to transport without version-history capture', async () => {
    const diagnostics: MutationAdmissionDiagnostic[] = [];
    const ctx = makeMockContext({
      versioningAdmissionDiagnostics: {
        record: (diagnostic: MutationAdmissionDiagnostic) => diagnostics.push(diagnostic),
      },
    } as unknown as Partial<IKernelContext>);
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async (command: string) => {
        if (command === 'compute_wb_security_add_policy') return 'policy-1';
        if (command === 'compute_wb_security_apply_template') return ['policy-2'];
        return undefined;
      }),
    };
    const bridge = createStartedBridge(ctx, transport);

    await expect(bridge.wbSecurityAddPolicy({ id: 'policy-1' })).resolves.toBe('policy-1');
    await expect(bridge.wbSecurityRemovePolicy('policy-1')).resolves.toBeUndefined();
    await expect(
      bridge.wbSecurityUpdatePolicy('policy-1', { effect: 'allow' }),
    ).resolves.toBeUndefined();
    await expect(bridge.wbSecurityApplyTemplate({ id: 'template-1' })).resolves.toEqual([
      'policy-2',
    ]);
    await expect(bridge.wbSecurityRemoveTemplate('template-1')).resolves.toBeUndefined();

    expect(diagnostics).toEqual([
      noHistoryDiagnostic('compute_wb_security_add_policy'),
      noHistoryDiagnostic('compute_wb_security_remove_policy'),
      noHistoryDiagnostic('compute_wb_security_update_policy'),
      noHistoryDiagnostic('compute_wb_security_apply_template'),
      noHistoryDiagnostic('compute_wb_security_remove_template'),
    ]);
    expect(transport.call).toHaveBeenCalledTimes(5);
    expect(transport.call).toHaveBeenCalledWith('compute_wb_security_add_policy', {
      docId: 'test-doc',
      policy: { id: 'policy-1' },
    });
    expect(transport.call).toHaveBeenCalledWith('compute_wb_security_remove_policy', {
      docId: 'test-doc',
      id: 'policy-1',
    });
    expect(transport.call).toHaveBeenCalledWith('compute_wb_security_update_policy', {
      docId: 'test-doc',
      id: 'policy-1',
      patch: { effect: 'allow' },
    });
    expect(transport.call).toHaveBeenCalledWith('compute_wb_security_apply_template', {
      docId: 'test-doc',
      template: { id: 'template-1' },
    });
    expect(transport.call).toHaveBeenCalledWith('compute_wb_security_remove_template', {
      docId: 'test-doc',
      templateId: 'template-1',
    });
  });

  it('keeps security reads and session principal plumbing outside write admission', async () => {
    const ctx = makeMockContext();
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async (command: string) => {
        if (command === 'compute_wb_security_list_policies') return [];
        if (command === 'compute_wb_security_effective_access') return 'allow';
        if (command === 'compute_wb_security_explain_access') return { decision: 'allow' };
        if (command === 'compute_wb_security_drain_events') return [];
        if (command === 'compute_set_active_principal') return undefined;
        if (command === 'compute_active_principal') return ['user:1'];
        if (command === 'compute_security_active') return true;
        if (command === 'compute_make_principal') return ['user:1'];
        throw new Error(`unexpected command: ${command}`);
      }),
    };
    const bridge = createStartedBridge(ctx, transport);

    await expect(bridge.wbSecurityListPolicies()).resolves.toEqual([]);
    await expect(
      bridge.wbSecurityEffectiveAccess({ kind: 'workbook' }, { tags: ['user:1'] }),
    ).resolves.toBe('allow');
    await expect(
      bridge.wbSecurityExplainAccess({ kind: 'workbook' }, { tags: ['user:1'] }),
    ).resolves.toEqual({ decision: 'allow' });
    await expect(bridge.wbSecurityDrainEvents()).resolves.toEqual([]);
    await expect(bridge.setActivePrincipal({ tags: ['user:1'] })).resolves.toBeUndefined();
    await expect(bridge.activePrincipal()).resolves.toEqual({ tags: ['user:1'] });
    await expect(bridge.securityActive()).resolves.toBe(true);
    await expect(bridge.makePrincipal(['user:1'])).resolves.toEqual({ tags: ['user:1'] });

    expect(transport.call).toHaveBeenCalledWith('compute_wb_security_list_policies', {
      docId: 'test-doc',
    });
    expect(transport.call).toHaveBeenCalledWith('compute_wb_security_drain_events', {
      docId: 'test-doc',
    });
  });
});

function noHistoryDiagnostic(command: string): unknown {
  return expect.objectContaining({
    code: 'versioning.admission.missing-context',
    severity: 'warning',
    command,
    classification: expect.objectContaining({
      capturePolicy: 'excluded',
      domainClass: 'secret',
      writeAdmissionMode: 'captureDisabledNoHistory',
    }),
  });
}
