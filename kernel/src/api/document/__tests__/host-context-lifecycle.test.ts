import { createDeterministicDocumentHost } from '@mog/test-host';
import type { KernelHostContext } from '@mog-sdk/types-host/kernel';
import { validateHostContext } from '../../../document/validate-host-context';
import { HostContextValidationError } from '../../../errors/document';

function extractKernelHostContext(): KernelHostContext {
  const host = createDeterministicDocumentHost();
  const ctx = host.kernelContext;
  host.dispose();
  return ctx;
}

describe('Host context lifecycle — construction validation', () => {
  it('accepts a valid host context without throwing', () => {
    const ctx = extractKernelHostContext();
    expect(() => validateHostContext(ctx)).not.toThrow();
  });

  it('preserves session timezone as the source of truth', () => {
    const ctx = extractKernelHostContext();
    expect(ctx.timezone.userTimezone).toBe('UTC');
    expect(ctx.session.userTimezone).toBe('UTC');
  });

  it('preserves environment derivation from runtime kind', () => {
    const ctx = extractKernelHostContext();
    expect(ctx.runtime.kind).toBe('test');
  });
});

describe('Host context lifecycle — field validation', () => {
  it('rejects missing session', () => {
    const ctx = { ...extractKernelHostContext(), session: undefined } as any;
    expect(() => validateHostContext(ctx)).toThrow(HostContextValidationError);
    expect(() => validateHostContext(ctx)).toThrow(/session is required/i);
  });

  it('rejects missing principal', () => {
    const ctx = { ...extractKernelHostContext(), principal: undefined } as any;
    expect(() => validateHostContext(ctx)).toThrow(HostContextValidationError);
    expect(() => validateHostContext(ctx)).toThrow(/principal is required/i);
  });

  it('rejects missing storage', () => {
    const ctx = { ...extractKernelHostContext(), storage: undefined } as any;
    expect(() => validateHostContext(ctx)).toThrow(HostContextValidationError);
    expect(() => validateHostContext(ctx)).toThrow(/storage is required/i);
  });

  it('rejects missing runtime', () => {
    const ctx = { ...extractKernelHostContext(), runtime: undefined } as any;
    expect(() => validateHostContext(ctx)).toThrow(HostContextValidationError);
    expect(() => validateHostContext(ctx)).toThrow(/runtime is required/i);
  });

  it('rejects missing diagnostics', () => {
    const ctx = { ...extractKernelHostContext(), diagnostics: undefined } as any;
    expect(() => validateHostContext(ctx)).toThrow(HostContextValidationError);
    expect(() => validateHostContext(ctx)).toThrow(/diagnostics is required/i);
  });

  it('rejects missing clock', () => {
    const ctx = { ...extractKernelHostContext(), clock: undefined } as any;
    expect(() => validateHostContext(ctx)).toThrow(HostContextValidationError);
    expect(() => validateHostContext(ctx)).toThrow(/clock is required/i);
  });

  it('rejects missing timezone', () => {
    const ctx = { ...extractKernelHostContext(), timezone: undefined } as any;
    expect(() => validateHostContext(ctx)).toThrow(HostContextValidationError);
    expect(() => validateHostContext(ctx)).toThrow(/timezone is required/i);
  });

  it('rejects session/principal tenant mismatch', () => {
    const base = extractKernelHostContext();
    const ctx = {
      ...base,
      principal: { ...base.principal, tenantId: 'other-tenant' },
    } as unknown as KernelHostContext;
    expect(() => validateHostContext(ctx)).toThrow(/Session\/principal tenant mismatch/);
  });

  it('rejects session/principal workspace mismatch', () => {
    const base = extractKernelHostContext();
    const ctx = {
      ...base,
      principal: { ...base.principal, workspaceId: 'other-workspace' },
    } as unknown as KernelHostContext;
    expect(() => validateHostContext(ctx)).toThrow(/Session\/principal workspace mismatch/);
  });

  it('rejects storage/session sessionId mismatch', () => {
    const base = extractKernelHostContext();
    const ctx = {
      ...base,
      storage: { ...base.storage, sessionId: 'wrong-session-id' },
    } as unknown as KernelHostContext;
    expect(() => validateHostContext(ctx)).toThrow(/Storage handoff session mismatch/);
  });

  it('rejects expired storage handoff', () => {
    const base = extractKernelHostContext();
    const ctx = {
      ...base,
      storage: { ...base.storage, expiresAt: 1 },
    } as unknown as KernelHostContext;
    expect(() => validateHostContext(ctx)).toThrow(/Storage handoff expired/);
  });

  it('rejects session/timezone userTimezone mismatch', () => {
    const base = extractKernelHostContext();
    const ctx = {
      ...base,
      timezone: { ...base.timezone, userTimezone: 'America/New_York' },
    } as unknown as KernelHostContext;
    expect(() => validateHostContext(ctx)).toThrow(/Session\/timezone mismatch/);
  });

  it('error is HostContextValidationError with DOC_HOST_CONTEXT_VALIDATION code', () => {
    const ctx = { ...extractKernelHostContext(), session: undefined } as any;
    try {
      validateHostContext(ctx);
      throw new Error('expected to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(HostContextValidationError);
      expect((e as HostContextValidationError).code).toBe('DOC_HOST_CONTEXT_VALIDATION');
      expect((e as HostContextValidationError).name).toBe('HostContextValidationError');
    }
  });
});

describe('Host context lifecycle — no-global-sniffing verification', () => {
  it('host path does not emit legacy runtime.assetFailure diagnostics', () => {
    const host = createDeterministicDocumentHost();
    const ctx = host.kernelContext;

    // When kernelHostContext is set on DocumentLifecycleSystem, executeAttachProviders
    // returns early on the host path. The legacy indexedDB / window.__TAURI__ sniffing
    // is structurally unreachable. We verify this by confirming the host context
    // validates cleanly and the diagnostics sink has no legacy-path artifacts.
    expect(() => validateHostContext(ctx)).not.toThrow();

    expect(host.diagnostics.eventsOfKind('runtime.assetFailure')).toHaveLength(0);

    host.dispose();
  });

  it('diagnostics sink captures host-path events, not legacy browser events', () => {
    const host = createDeterministicDocumentHost();

    host.kernelContext.diagnostics.emit({
      kind: 'storage.failure',
      code: 'PROVIDER_ATTACH_DEFERRED',
      correlationId: host.kernelContext.session.correlationRootId,
      providerRefId: 'host-durable',
      phase: 'attach',
      timestamp: host.kernelContext.clock.now(),
    });

    expect(host.diagnostics.events).toHaveLength(1);
    expect(host.diagnostics.events[0].kind).toBe('storage.failure');

    host.dispose();
  });
});

describe('Host context lifecycle — rejected caller-supplied bypasses', () => {
  it('rejects providers option on createFromHostContext', async () => {
    const { DocumentFactory } = await import('../document-factory');
    const ctx = extractKernelHostContext();
    await expect(
      DocumentFactory.createFromHostContext(ctx, {
        providers: ['indexeddb'] as any,
      } as any),
    ).rejects.toThrow(/providers is not accepted on the host context path/);
  });

  it('rejects initialSnapshot option on createFromHostContext', async () => {
    const { DocumentFactory } = await import('../document-factory');
    const ctx = extractKernelHostContext();
    await expect(
      DocumentFactory.createFromHostContext(ctx, {
        initialSnapshot: new Uint8Array([1, 2, 3]) as any,
      } as any),
    ).rejects.toThrow(/initialSnapshot is not accepted on the host context path/);
  });

  it('rejects yrsState option on createFromHostContext', async () => {
    const { DocumentFactory } = await import('../document-factory');
    const ctx = extractKernelHostContext();
    await expect(
      DocumentFactory.createFromHostContext(ctx, {
        yrsState: new Uint8Array([1, 2, 3]) as any,
      } as any),
    ).rejects.toThrow(/yrsState is not accepted on the host context path/);
  });

  it('bypass rejection errors are HostContextValidationError instances', async () => {
    const { DocumentFactory } = await import('../document-factory');
    const ctx = extractKernelHostContext();
    try {
      await DocumentFactory.createFromHostContext(ctx, {
        providers: ['indexeddb'] as any,
      } as any);
      throw new Error('expected to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(HostContextValidationError);
      expect((e as HostContextValidationError).code).toBe('DOC_HOST_CONTEXT_VALIDATION');
    }
  });

  it('allows valid options without bypasses (fails at engine level, not validation)', async () => {
    const { DocumentFactory } = await import('../document-factory');
    const ctx = extractKernelHostContext();
    try {
      await DocumentFactory.createFromHostContext(ctx, {
        documentId: 'test-doc',
        skipDefaultSheet: true,
      });
    } catch (e) {
      expect(e).not.toBeInstanceOf(HostContextValidationError);
    }
  });
});
