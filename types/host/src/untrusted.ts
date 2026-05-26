export interface UntrustedHostClient {
  readonly clientKind: 'iframe-parent' | 'http-client' | 'plugin' | 'agent' | 'external-api-client';
  readonly protocolVersion: string;
}
