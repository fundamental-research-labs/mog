import {
  projectPrincipal,
  projectAndVerifyPrincipal,
  PrincipalProjectionError,
} from '../principal-projection';
import type { PrincipalProjectionContext } from '../principal-projection';
import type { VerifiedPrincipal, KernelPrincipalHandoff } from '@mog-sdk/types-host/identity';
import type { HostDiagnosticsSink, HostDiagnosticEvent } from '@mog-sdk/types-host/diagnostics';
import { createHostPrincipalLock, HostPrincipalMutationError } from '../host-principal-lock';

// =============================================================================
// Test helpers
// =============================================================================

const makeVerified = (overrides: Partial<VerifiedPrincipal> = {}): VerifiedPrincipal => ({
  issuer: { issuerId: 'test-issuer', issuerKind: 'test' },
  subjectId: 'test-user',
  tenantId: 'test-tenant',
  workspaceId: 'test-workspace',
  actorKind: 'user',
  tags: ['role:editor'],
  ...overrides,
});

function createDiagnosticsSink(): HostDiagnosticsSink & { events: HostDiagnosticEvent[] } {
  const events: HostDiagnosticEvent[] = [];
  return {
    events,
    emit(event: HostDiagnosticEvent) {
      events.push(event);
    },
  };
}

function makeCtx(
  overrides: Partial<PrincipalProjectionContext> = {},
): PrincipalProjectionContext & { diagnostics: ReturnType<typeof createDiagnosticsSink> } {
  const diagnostics = createDiagnosticsSink();
  return {
    principal: makeVerified(),
    sessionTenantId: 'test-tenant',
    sessionWorkspaceId: 'test-workspace',
    documentId: 'doc-1',
    diagnostics,
    ...overrides,
    // Always use our diagnostics sink for introspection unless explicitly overridden
    ...(overrides.diagnostics ? {} : { diagnostics }),
  } as PrincipalProjectionContext & { diagnostics: ReturnType<typeof createDiagnosticsSink> };
}

/**
 * Assert that `projectAndVerifyPrincipal` throws a `PrincipalProjectionError`
 * with the expected error code. Returns the caught error for further assertions.
 */
function expectProjectionError(
  ctx: PrincipalProjectionContext,
  expectedCode: string,
): PrincipalProjectionError {
  try {
    projectAndVerifyPrincipal(ctx);
    throw new Error(
      `Expected PrincipalProjectionError with code '${expectedCode}' but no error was thrown`,
    );
  } catch (err) {
    expect(err).toBeInstanceOf(PrincipalProjectionError);
    expect((err as PrincipalProjectionError).code).toBe(expectedCode);
    return err as PrincipalProjectionError;
  }
}

// =============================================================================
// Legacy projectPrincipal (backward compatibility)
// =============================================================================

describe('projectPrincipal (legacy)', () => {
  it('projects a verified user to AccessPrincipal with sorted tags', () => {
    const handoff = projectPrincipal(makeVerified({ tags: ['z-tag', 'a-tag'] }));

    expect(handoff.accessPrincipal).not.toBeNull();
    expect(handoff.accessPrincipal!.tags).toEqual(['a-tag', 'z-tag']);
    expect(handoff.canonicalTags).toEqual(['a-tag', 'z-tag']);
  });

  it('projects anonymous principal to null AccessPrincipal', () => {
    const handoff = projectPrincipal(makeVerified({ actorKind: 'anonymous' }));

    expect(handoff.accessPrincipal).toBeNull();
  });

  it('deduplicates tags', () => {
    const handoff = projectPrincipal(
      makeVerified({ tags: ['dup', 'dup', 'alpha', 'alpha', 'beta'] }),
    );

    expect(handoff.accessPrincipal).not.toBeNull();
    expect(handoff.accessPrincipal!.tags).toEqual(['alpha', 'beta', 'dup']);
    expect(handoff.canonicalTags).toEqual(['alpha', 'beta', 'dup']);
  });

  it('handles empty tags', () => {
    const handoff = projectPrincipal(makeVerified({ tags: [] }));

    expect(handoff.accessPrincipal).not.toBeNull();
    expect(handoff.accessPrincipal!.tags).toEqual([]);
    expect(handoff.canonicalTags).toEqual([]);
  });

  it('preserves verified principal reference', () => {
    const verified = makeVerified();
    const handoff = projectPrincipal(verified);

    expect(handoff.verified).toBe(verified);
  });

  it('returns canonicalTags matching accessPrincipal tags for non-anonymous', () => {
    const handoff = projectPrincipal(makeVerified({ tags: ['c', 'a', 'b'] }));

    expect(handoff.canonicalTags).toEqual(handoff.accessPrincipal!.tags);
  });

  it('returns canonicalTags for anonymous (tags are still sorted)', () => {
    const handoff = projectPrincipal(makeVerified({ actorKind: 'anonymous' }));

    expect(handoff.canonicalTags).toEqual(['role:editor']);
    expect(handoff.accessPrincipal).toBeNull();
  });

  it('handles test actor kind', () => {
    const handoff = projectPrincipal(makeVerified({ actorKind: 'test' }));
    expect(handoff.accessPrincipal).not.toBeNull();
  });

  it('handles service-account actor kind', () => {
    const handoff = projectPrincipal(makeVerified({ actorKind: 'service-account' }));
    expect(handoff.accessPrincipal).not.toBeNull();
  });

  it('handles app actor kind', () => {
    const handoff = projectPrincipal(makeVerified({ actorKind: 'app' }));
    expect(handoff.accessPrincipal).not.toBeNull();
  });

  it('handles plugin actor kind', () => {
    const handoff = projectPrincipal(makeVerified({ actorKind: 'plugin' }));
    expect(handoff.accessPrincipal).not.toBeNull();
  });

  it('handles agent actor kind', () => {
    const handoff = projectPrincipal(makeVerified({ actorKind: 'agent' }));
    expect(handoff.accessPrincipal).not.toBeNull();
  });

  it('returns a handoff conforming to KernelPrincipalHandoff', () => {
    const handoff: KernelPrincipalHandoff = projectPrincipal(makeVerified());

    expect(handoff).toHaveProperty('verified');
    expect(handoff).toHaveProperty('accessPrincipal');
    expect(handoff).toHaveProperty('canonicalTags');
  });

  it('does not mutate the input tags array', () => {
    const tags = ['z', 'a', 'm'] as const;
    const verified = makeVerified({ tags });
    projectPrincipal(verified);

    expect(verified.tags).toEqual(['z', 'a', 'm']);
  });
});

// =============================================================================
// Enhanced projectAndVerifyPrincipal
// =============================================================================

describe('projectAndVerifyPrincipal', () => {
  // ---------------------------------------------------------------------------
  // Successful projections by role
  // ---------------------------------------------------------------------------

  it('projects owner principal (trusted issuer, mog:owner tag) successfully', () => {
    const ctx = makeCtx({
      principal: makeVerified({
        issuer: { issuerId: 'mog-cloud', issuerKind: 'mog-hosted' },
        tags: ['mog:owner'],
      }),
    });

    const handoff = projectAndVerifyPrincipal(ctx);

    expect(handoff.accessPrincipal).not.toBeNull();
    expect(handoff.accessPrincipal!.tags).toEqual(['mog:owner']);
    expect(handoff.canonicalTags).toEqual(['mog:owner']);
  });

  it('projects admin principal successfully', () => {
    const ctx = makeCtx({
      principal: makeVerified({
        issuer: { issuerId: 'mog-cloud', issuerKind: 'mog-hosted' },
        tags: ['mog:admin'],
      }),
    });

    const handoff = projectAndVerifyPrincipal(ctx);

    expect(handoff.accessPrincipal).not.toBeNull();
    expect(handoff.accessPrincipal!.tags).toEqual(['mog:admin']);
  });

  it('projects writer principal successfully', () => {
    const ctx = makeCtx({
      principal: makeVerified({
        issuer: { issuerId: 'mog-cloud', issuerKind: 'mog-hosted' },
        tags: ['mog:writer'],
      }),
    });

    const handoff = projectAndVerifyPrincipal(ctx);

    expect(handoff.accessPrincipal).not.toBeNull();
    expect(handoff.accessPrincipal!.tags).toEqual(['mog:writer']);
  });

  it('projects reader principal successfully', () => {
    const ctx = makeCtx({
      principal: makeVerified({
        issuer: { issuerId: 'mog-cloud', issuerKind: 'mog-hosted' },
        tags: ['mog:reader'],
      }),
    });

    const handoff = projectAndVerifyPrincipal(ctx);

    expect(handoff.accessPrincipal).not.toBeNull();
    expect(handoff.accessPrincipal!.tags).toEqual(['mog:reader']);
  });

  it('projects anonymous principal with null accessPrincipal', () => {
    const ctx = makeCtx({
      principal: makeVerified({
        actorKind: 'anonymous',
        tags: [],
      }),
    });

    const handoff = projectAndVerifyPrincipal(ctx);

    expect(handoff.accessPrincipal).toBeNull();
    expect(handoff.canonicalTags).toEqual([]);
  });

  it('projects test principal successfully', () => {
    const ctx = makeCtx({
      principal: makeVerified({
        actorKind: 'test',
        tags: ['test:fixture'],
      }),
    });

    const handoff = projectAndVerifyPrincipal(ctx);

    expect(handoff.accessPrincipal).not.toBeNull();
    expect(handoff.accessPrincipal!.tags).toEqual(['test:fixture']);
  });

  // ---------------------------------------------------------------------------
  // All trusted issuer kinds project mog:* tags successfully
  // ---------------------------------------------------------------------------

  const trustedIssuerKinds = [
    'mog-hosted',
    'self-hosted',
    'tauri-desktop',
    'trusted-node-process',
    'test',
  ] as const;

  for (const issuerKind of trustedIssuerKinds) {
    it(`allows mog:owner tag from trusted issuerKind '${issuerKind}'`, () => {
      const ctx = makeCtx({
        principal: makeVerified({
          issuer: { issuerId: `issuer-${issuerKind}`, issuerKind },
          tags: ['mog:owner'],
        }),
      });

      const handoff = projectAndVerifyPrincipal(ctx);
      expect(handoff.accessPrincipal!.tags).toEqual(['mog:owner']);
    });
  }

  // ---------------------------------------------------------------------------
  // Forged/untrusted tag rejection
  // ---------------------------------------------------------------------------

  it('REJECTS forged owner (external issuer + mog:owner tag)', () => {
    const ctx = makeCtx({
      principal: makeVerified({
        // Force an untrusted issuer kind (cast to bypass type checking - simulating
        // a malicious or future extension issuer kind not in the trusted set)
        issuer: { issuerId: 'attacker-sso', issuerKind: 'external' as never },
        tags: ['mog:owner'],
      }),
    });

    expectProjectionError(ctx, 'PRINCIPAL_FORGED_RESERVED_TAG');
  });

  it('REJECTS forged admin (external issuer + mog:admin tag)', () => {
    const ctx = makeCtx({
      principal: makeVerified({
        issuer: { issuerId: 'attacker-sso', issuerKind: 'external' as never },
        tags: ['mog:admin'],
      }),
    });

    expectProjectionError(ctx, 'PRINCIPAL_FORGED_RESERVED_TAG');
  });

  it('REJECTS forged mog:writer from untrusted issuer', () => {
    const ctx = makeCtx({
      principal: makeVerified({
        issuer: { issuerId: 'unknown', issuerKind: 'unknown-external' as never },
        tags: ['mog:writer', 'custom:legit'],
      }),
    });

    expectProjectionError(ctx, 'PRINCIPAL_FORGED_RESERVED_TAG');
  });

  it('allows non-mog tags from untrusted issuers', () => {
    const ctx = makeCtx({
      principal: makeVerified({
        issuer: { issuerId: 'partner-idp', issuerKind: 'external' as never },
        tags: ['custom:role', 'team:finance'],
      }),
    });

    const handoff = projectAndVerifyPrincipal(ctx);
    expect(handoff.accessPrincipal!.tags).toEqual(['custom:role', 'team:finance']);
  });

  // ---------------------------------------------------------------------------
  // Tenant/workspace mismatch
  // ---------------------------------------------------------------------------

  it('REJECTS wrong tenant mismatch (string vs string)', () => {
    const ctx = makeCtx({
      principal: makeVerified({ tenantId: 'tenant-A' }),
      sessionTenantId: 'tenant-B',
    });

    expectProjectionError(ctx, 'PRINCIPAL_TENANT_MISMATCH');
  });

  it('REJECTS wrong tenant mismatch (string vs single-tenant marker)', () => {
    const ctx = makeCtx({
      principal: makeVerified({ tenantId: 'tenant-A' }),
      sessionTenantId: { kind: 'single-tenant' },
    });

    expectProjectionError(ctx, 'PRINCIPAL_TENANT_MISMATCH');
  });

  it('matches single-tenant marker on both sides', () => {
    const ctx = makeCtx({
      principal: makeVerified({ tenantId: { kind: 'single-tenant' } }),
      sessionTenantId: { kind: 'single-tenant' },
    });

    const handoff = projectAndVerifyPrincipal(ctx);
    expect(handoff.accessPrincipal).not.toBeNull();
  });

  it('REJECTS wrong workspace mismatch (string vs string)', () => {
    const ctx = makeCtx({
      principal: makeVerified({ workspaceId: 'ws-A' }),
      sessionWorkspaceId: 'ws-B',
    });

    expectProjectionError(ctx, 'PRINCIPAL_WORKSPACE_MISMATCH');
  });

  it('REJECTS wrong workspace mismatch (string vs no-workspace marker)', () => {
    const ctx = makeCtx({
      principal: makeVerified({ workspaceId: 'ws-A' }),
      sessionWorkspaceId: { kind: 'no-workspace' },
    });

    expectProjectionError(ctx, 'PRINCIPAL_WORKSPACE_MISMATCH');
  });

  it('matches no-workspace marker on both sides', () => {
    const ctx = makeCtx({
      principal: makeVerified({ workspaceId: { kind: 'no-workspace' } }),
      sessionWorkspaceId: { kind: 'no-workspace' },
    });

    const handoff = projectAndVerifyPrincipal(ctx);
    expect(handoff.accessPrincipal).not.toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Anonymous semantics enforcement
  // ---------------------------------------------------------------------------

  it('REJECTS anonymous principal with non-empty tags', () => {
    const ctx = makeCtx({
      principal: makeVerified({
        actorKind: 'anonymous',
        tags: ['should:not-be-here'],
      }),
    });

    expectProjectionError(ctx, 'PRINCIPAL_ANONYMOUS_WITH_TAGS');
  });

  // ---------------------------------------------------------------------------
  // Tag deduplication and sorting
  // ---------------------------------------------------------------------------

  it('deduplicates and sorts tags', () => {
    const ctx = makeCtx({
      principal: makeVerified({
        tags: ['z-tag', 'a-tag', 'z-tag', 'm-tag', 'a-tag'],
      }),
    });

    const handoff = projectAndVerifyPrincipal(ctx);

    expect(handoff.accessPrincipal!.tags).toEqual(['a-tag', 'm-tag', 'z-tag']);
    expect(handoff.canonicalTags).toEqual(['a-tag', 'm-tag', 'z-tag']);
  });

  it('does not mutate the input tags array', () => {
    const tags = ['z', 'a', 'm'] as const;
    const principal = makeVerified({ tags });
    const ctx = makeCtx({ principal });
    projectAndVerifyPrincipal(ctx);

    expect(principal.tags).toEqual(['z', 'a', 'm']);
  });

  // ---------------------------------------------------------------------------
  // Diagnostic emission
  // ---------------------------------------------------------------------------

  it('emits success diagnostic on successful projection', () => {
    const ctx = makeCtx();
    projectAndVerifyPrincipal(ctx);

    expect(ctx.diagnostics.events).toHaveLength(1);
    const event = ctx.diagnostics.events[0]!;
    expect(event.kind).toBe('hostConstruction.invalid');
    expect(event).toHaveProperty('code', 'PRINCIPAL_PROJECTION_OK');
    expect(event).toHaveProperty('phase', 'principal-projection');
  });

  it('emits failure diagnostic on projection failure', () => {
    const ctx = makeCtx({
      principal: makeVerified({ tenantId: 'wrong-tenant' }),
      sessionTenantId: 'correct-tenant',
    });

    expect(() => projectAndVerifyPrincipal(ctx)).toThrow(PrincipalProjectionError);

    expect(ctx.diagnostics.events).toHaveLength(1);
    const event = ctx.diagnostics.events[0]!;
    expect(event.kind).toBe('hostConstruction.invalid');
    expect(event).toHaveProperty('code', 'PRINCIPAL_TENANT_MISMATCH');
    expect(event).toHaveProperty('phase', 'principal-projection');
  });

  it('emits success diagnostic for anonymous projection', () => {
    const ctx = makeCtx({
      principal: makeVerified({
        actorKind: 'anonymous',
        tags: [],
      }),
    });

    projectAndVerifyPrincipal(ctx);

    expect(ctx.diagnostics.events).toHaveLength(1);
    const event = ctx.diagnostics.events[0]!;
    expect(event).toHaveProperty('code', 'PRINCIPAL_PROJECTION_OK');
  });

  // ---------------------------------------------------------------------------
  // Issuer validation
  // ---------------------------------------------------------------------------

  it('REJECTS principal with missing issuer', () => {
    const ctx = makeCtx({
      principal: makeVerified({
        issuer: undefined as never,
      }),
    });

    expectProjectionError(ctx, 'PRINCIPAL_MISSING_ISSUER');
  });

  it('REJECTS principal with empty issuerId', () => {
    const ctx = makeCtx({
      principal: makeVerified({
        issuer: { issuerId: '', issuerKind: 'test' },
      }),
    });

    expectProjectionError(ctx, 'PRINCIPAL_MISSING_ISSUER_ID');
  });

  it('REJECTS principal with empty issuerKind', () => {
    const ctx = makeCtx({
      principal: makeVerified({
        issuer: { issuerId: 'test', issuerKind: '' as never },
      }),
    });

    expectProjectionError(ctx, 'PRINCIPAL_MISSING_ISSUER_KIND');
  });

  // ---------------------------------------------------------------------------
  // Actor kind validation
  // ---------------------------------------------------------------------------

  it('REJECTS unknown actor kind', () => {
    const ctx = makeCtx({
      principal: makeVerified({
        actorKind: 'robot' as never,
      }),
    });

    expectProjectionError(ctx, 'PRINCIPAL_UNKNOWN_ACTOR_KIND');
  });

  // ---------------------------------------------------------------------------
  // PrincipalProjectionError structure
  // ---------------------------------------------------------------------------

  it('PrincipalProjectionError carries code and message', () => {
    const ctx = makeCtx({
      principal: makeVerified({ tenantId: 'wrong' }),
      sessionTenantId: 'right',
    });

    const err = expectProjectionError(ctx, 'PRINCIPAL_TENANT_MISMATCH');
    expect(err.name).toBe('PrincipalProjectionError');
    expect(err.message).toContain('tenantId');
  });
});

// =============================================================================
// Host principal lock
// =============================================================================

describe('HostPrincipalLock', () => {
  const handoff: KernelPrincipalHandoff = {
    verified: makeVerified({
      issuer: { issuerId: 'mog-cloud', issuerKind: 'mog-hosted' },
      tags: ['mog:owner'],
    }),
    accessPrincipal: { tags: ['mog:owner'] },
    canonicalTags: ['mog:owner'],
  };

  it('creates a locked principal lock', () => {
    const lock = createHostPrincipalLock(handoff);

    expect(lock.isLocked).toBe(true);
    expect(lock.lockedPrincipal).toBe(handoff);
  });

  it('assertNotLocked throws HostPrincipalMutationError', () => {
    const lock = createHostPrincipalLock(handoff);

    expect(() => lock.assertNotLocked('setActivePrincipal')).toThrow(HostPrincipalMutationError);
  });

  it('error message includes the operation name for setActivePrincipal', () => {
    const lock = createHostPrincipalLock(handoff);

    expect(() => lock.assertNotLocked('setActivePrincipal')).toThrow(
      /Cannot setActivePrincipal on a host-backed workbook/,
    );
  });

  it('error message includes the operation name for makePrincipal', () => {
    const lock = createHostPrincipalLock(handoff);

    expect(() => lock.assertNotLocked('makePrincipal')).toThrow(
      /Cannot makePrincipal on a host-backed workbook/,
    );
  });

  it('HostPrincipalMutationError has correct name', () => {
    const lock = createHostPrincipalLock(handoff);

    try {
      lock.assertNotLocked('setActivePrincipal');
      throw new Error('Expected HostPrincipalMutationError');
    } catch (err) {
      expect(err).toBeInstanceOf(HostPrincipalMutationError);
      expect((err as HostPrincipalMutationError).name).toBe('HostPrincipalMutationError');
    }
  });

  it('preserves the locked principal reference', () => {
    const lock = createHostPrincipalLock(handoff);

    expect(lock.lockedPrincipal.verified).toBe(handoff.verified);
    expect(lock.lockedPrincipal.accessPrincipal).toBe(handoff.accessPrincipal);
    expect(lock.lockedPrincipal.canonicalTags).toBe(handoff.canonicalTags);
  });
});
