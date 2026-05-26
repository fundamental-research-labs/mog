import type { AccessPrincipal } from '@mog-sdk/types-document/security/types';

export interface PrincipalIssuer {
  readonly issuerId: string;
  readonly issuerKind:
    | 'mog-hosted'
    | 'self-hosted'
    | 'tauri-desktop'
    | 'trusted-node-process'
    | 'test';
}

export interface VerifiedPrincipal {
  readonly issuer: PrincipalIssuer;
  readonly subjectId: string;
  readonly tenantId: string | { readonly kind: 'single-tenant' };
  readonly workspaceId: string | { readonly kind: 'no-workspace' };
  readonly actorKind:
    | 'user'
    | 'service-account'
    | 'app'
    | 'plugin'
    | 'agent'
    | 'anonymous'
    | 'test';
  readonly tags: readonly string[];
}

export interface KernelPrincipalHandoff {
  readonly verified: VerifiedPrincipal;
  readonly accessPrincipal: AccessPrincipal | null;
  readonly canonicalTags: readonly string[];
}
