import { createDeterministicTestHost } from './deterministic-test-host';
import type { TrustedDocumentHostContext } from '../trusted';
import type { UntrustedHostClient } from '../untrusted';

describe('TrustedDocumentHostContext brand', () => {
  it('can be created through the deterministic test host factory', () => {
    const host = createDeterministicTestHost();
    expect(host.context.hostSurface).toBe('document-host');
    expect(host.context.kind).toBe('test');
    expect(host.context.kernel.session.sessionId).toBe('test-session-00000000');
    expect(host.context.kernel.principal.actorKind).toBe('test');
    expect(host.context.kernel.timezone.processTimezoneMayBeUsed).toBe(false);
    host.dispose();
  });

  it('uses fixed clock and timezone', () => {
    const host = createDeterministicTestHost();
    expect(host.context.kernel.clock.now()).toBe(1700000000000);
    expect(host.context.kernel.clock.dateNow()).toBe(1700000000000);
    expect(host.context.kernel.timezone.userTimezone).toBe('UTC');
    expect(host.context.kernel.timezone.source).toBe('test-fixture');
    host.dispose();
  });

  it('captures diagnostics', () => {
    const host = createDeterministicTestHost();
    host.context.kernel.diagnostics.emit({
      kind: 'hostConstruction.invalid',
      correlationId: 'test-corr',
      timestamp: 1700000000000,
      code: 'TEST_INVALID',
      phase: 'trusted-context',
      invariant: 'test-invariant',
      reason: 'test reason',
    });
    expect(host.diagnostics).toHaveLength(1);
    expect(host.diagnostics[0].kind).toBe('hostConstruction.invalid');
    host.dispose();
  });

  it('sorts principal tags canonically', () => {
    const host = createDeterministicTestHost({
      principalTags: ['z-tag', 'a-tag', 'm-tag'],
    });
    expect(host.context.kernel.principal.tags).toEqual(['a-tag', 'm-tag', 'z-tag']);
    host.dispose();
  });

  it('uses ephemeral storage by default', () => {
    const host = createDeterministicTestHost();
    expect(host.context.kernel.storage.storageConstraint).toBe('ephemeral');
    expect(host.context.kernel.storage.storage.durability).toBe('ephemeral');
    host.dispose();
  });

  it('accepts custom session and principal options', () => {
    const host = createDeterministicTestHost({
      sessionId: 'custom-session',
      tenantId: 'custom-tenant',
      principalSubjectId: 'custom-user',
    });
    expect(host.context.kernel.session.sessionId).toBe('custom-session');
    expect(host.context.kernel.session.tenantId).toBe('custom-tenant');
    expect(host.context.kernel.principal.subjectId).toBe('custom-user');
    host.dispose();
  });

  it('capability lookup returns allowed by default', async () => {
    const host = createDeterministicTestHost();
    const decision = await host.context.kernel.capabilities.decide({
      correlationId: 'test',
      subject: {
        scope: { kind: 'workspace' },
        resourceContext: {
          tenantId: 'test-tenant',
          workspaceId: 'test-workspace',
          resolutionSource: 'test-fixture',
        },
        actor: host.context.kernel.principal,
        sourceHostId: 'test-host',
        capability: 'mog:test' as any,
        provenance: 'test-fixture',
      },
      operation: 'read',
    });
    expect(decision.allowed).toBe(true);
    host.dispose();
  });

  it('capability lookup returns denied when configured', async () => {
    const host = createDeterministicTestHost({
      capabilityDecisions: new Map([['mog:test', false]]),
    });
    const decision = await host.context.kernel.capabilities.decide({
      correlationId: 'test',
      subject: {
        scope: { kind: 'workspace' },
        resourceContext: {
          tenantId: 'test-tenant',
          workspaceId: 'test-workspace',
          resolutionSource: 'test-fixture',
        },
        actor: host.context.kernel.principal,
        sourceHostId: 'test-host',
        capability: 'mog:test' as any,
        provenance: 'test-fixture',
      },
      operation: 'read',
    });
    expect(decision.allowed).toBe(false);
    host.dispose();
  });

  it('UntrustedHostClient is structurally different from TrustedDocumentHostContext', () => {
    const untrusted: UntrustedHostClient = {
      clientKind: 'http-client',
      protocolVersion: '1.0',
    };
    // Type system prevents assigning untrusted to trusted — verified at compile time.
    // At runtime, we verify the shapes are structurally disjoint.
    expect('hostSurface' in untrusted).toBe(false);
    expect('kernel' in untrusted).toBe(false);
    expect(untrusted.clientKind).toBe('http-client');
  });
});
