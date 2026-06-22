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
  it('rejects blocked security mutators before transport execution', async () => {
    const diagnostics: MutationAdmissionDiagnostic[] = [];
    const ctx = makeMockContext({
      versioningAdmissionDiagnostics: {
        record: (diagnostic: MutationAdmissionDiagnostic) => diagnostics.push(diagnostic),
      },
    } as unknown as Partial<IKernelContext>);
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async () => undefined),
    };
    const bridge = createStartedBridge(ctx, transport);

    await expect(bridge.wbSecurityAddPolicy({ id: 'policy-1' })).rejects.toThrow(
      "VC-02 admission blocked 'compute_wb_security_add_policy' before transport execution.",
    );
    await expect(bridge.wbSecurityRemovePolicy('policy-1')).rejects.toThrow(
      "VC-02 admission blocked 'compute_wb_security_remove_policy' before transport execution.",
    );
    await expect(bridge.wbSecurityUpdatePolicy('policy-1', { effect: 'allow' })).rejects.toThrow(
      "VC-02 admission blocked 'compute_wb_security_update_policy' before transport execution.",
    );
    await expect(bridge.wbSecurityApplyTemplate({ id: 'template-1' })).rejects.toThrow(
      "VC-02 admission blocked 'compute_wb_security_apply_template' before transport execution.",
    );
    await expect(bridge.wbSecurityRemoveTemplate('template-1')).rejects.toThrow(
      "VC-02 admission blocked 'compute_wb_security_remove_template' before transport execution.",
    );

    expect(diagnostics).toEqual([
      blockedDiagnostic('compute_wb_security_add_policy'),
      blockedDiagnostic('compute_wb_security_remove_policy'),
      blockedDiagnostic('compute_wb_security_update_policy'),
      blockedDiagnostic('compute_wb_security_apply_template'),
      blockedDiagnostic('compute_wb_security_remove_template'),
    ]);
    expect(transport.call).not.toHaveBeenCalled();
  });

  it('keeps security reads and session principal plumbing outside blocked write admission', async () => {
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

function blockedDiagnostic(command: string): unknown {
  return expect.objectContaining({
    code: 'versioning.admission.blocked-write',
    severity: 'error',
    command,
    classification: expect.objectContaining({ writeAdmissionMode: 'block' }),
  });
}
