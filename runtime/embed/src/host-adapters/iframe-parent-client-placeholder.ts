import type { UntrustedHostClient } from '@mog-sdk/types-host/untrusted';

// 02c-A: Non-exported compile-only placeholder for the iframe parent untrusted client.
// This is NOT a trusted host. It is an untrusted protocol client.
// public embed protocol owns protocol event names, payload schemas, and public messaging API.
// This placeholder MUST NOT:
// - be exported through @mog-sdk/embed or any public subpath
// - carry raw source bytes, raw URLs as authority, raw Yrs state, provider configs
// - import @mog-sdk/types-host/trusted, /kernel, /runtime, /storage
// - construct TrustedDocumentHostContext

interface IframeParentUntrustedEnvelope {
  readonly protocolVersion: string;
  readonly messageId: string;
  readonly correlationId: string;
  readonly claimedParentOrigin: string; // diagnostics only, non-authoritative
  readonly nonce: string;
  readonly requestedOperation: string;
  readonly opaqueSourceRef?: string;
  readonly opaqueAuthRef?: string;
  readonly opaqueCapabilityRef?: string;
}

const CLIENT_KIND: UntrustedHostClient['clientKind'] = 'iframe-parent';

function _compileCheck_untrustedClient(): UntrustedHostClient {
  return {
    clientKind: CLIENT_KIND,
    protocolVersion: '0.0.0',
  };
}

function _compileCheck_envelope(): IframeParentUntrustedEnvelope {
  return {
    protocolVersion: '0.0.0',
    messageId: '',
    correlationId: '',
    claimedParentOrigin: '',
    nonce: '',
    requestedOperation: '',
  };
}

void _compileCheck_untrustedClient;
void _compileCheck_envelope;
void CLIENT_KIND;

export {};
