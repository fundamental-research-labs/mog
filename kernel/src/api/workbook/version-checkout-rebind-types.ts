export type CheckoutRebindIdentity = {
  readonly schemaVersion: 1;
  readonly providerDocumentScopeKey: string;
  readonly providerWorkspaceId?: string;
  readonly providerDocumentId: string;
  readonly providerPrincipalScope?: string;
};

export type RebindIdentityErrorReason =
  | 'currentIdentityInvalid'
  | 'materializationIdentityStale'
  | 'priorCheckoutRefInvalid'
  | 'priorCheckoutRefStale'
  | 'providerDocumentMismatch'
  | 'providerIdentityEnvelopeMismatch'
  | 'providerScopeInvalid'
  | 'providerScopeMismatch';

export type ProviderIdentityClass =
  | 'workspace'
  | 'document'
  | 'principal'
  | 'ref'
  | 'scope'
  | 'provider'
  | 'materialization';
