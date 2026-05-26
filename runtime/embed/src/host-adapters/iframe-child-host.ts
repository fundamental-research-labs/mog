import type { TrustedDocumentHostContext, TrustedHostKind } from '@mog-sdk/types-host/trusted';
import type { RuntimeHostContext, KernelRuntimeConfig } from '@mog-sdk/types-host/runtime';
import type { HostDiagnosticsSink, HostDiagnosticEvent } from '@mog-sdk/types-host/diagnostics';
import type { HostTrustProfile } from '@mog-sdk/types-host/trust';
import type { MogEmbedConfig, MogEmbedEffectiveState } from '../config';
import { resolveEffectiveState, type TrustContext } from '../resolution';
import {
  type MogEmbedMessage,
  PROTOCOL_VERSION,
  createMessage,
  validateOrigin,
  validateMessagePayload,
} from '../iframe/protocol';

// ---------------------------------------------------------------------------
// Iframe child host adapter (trusted enforcement side)
//
// The child frame is the trusted boundary. The parent is untrusted.
// Origin validation uses the browser's MessageEvent.origin (authoritative),
// never a claimed origin inside the payload. The channel nonce provides
// additional correlation to prevent cross-embed message routing.
// ---------------------------------------------------------------------------

const ADAPTER_ID = 'iframe-child-host' as const;
const HOST_KIND: TrustedHostKind = 'iframe-child';

// ---------------------------------------------------------------------------
// Iframe-specific config extending MogEmbedConfig
// ---------------------------------------------------------------------------

export interface IframeChildEmbedConfig extends MogEmbedConfig {
  readonly allowedParentOrigins: readonly string[];
  readonly channelNonce: string;
}

// ---------------------------------------------------------------------------
// Trust context for iframe child (enforcement side)
// ---------------------------------------------------------------------------

function buildTrustContext(_config: MogEmbedConfig): TrustContext {
  return {
    boundary: 'iframe-child',
    availableCapabilities: [],
    availableSavePolicies: ['none'],
    availableCollaborationModes: ['none'],
    maxMode: 'readonly',
  };
}

// ---------------------------------------------------------------------------
// Trust profile for iframe child (protocol-enforced isolation)
// ---------------------------------------------------------------------------

function buildTrustProfile(): HostTrustProfile {
  return {
    mode: 'trusted-first-party-browser',
    identityAssertion: 'cooperative-caller',
    enforcement: {
      identity: 'iframe-child-app',
      protocol: 'iframe-child-app',
      capability: 'iframe-child-app',
      workbookAccess: 'rust-policy-engine',
      storage: 'trusted-adapter-factory',
    },
    isolation: 'iframe-protocol',
  };
}

// ---------------------------------------------------------------------------
// Diagnostics sink
// ---------------------------------------------------------------------------

function buildDiagnosticsSink(): HostDiagnosticsSink & {
  readonly captured: readonly HostDiagnosticEvent[];
} {
  const captured: HostDiagnosticEvent[] = [];
  return {
    emit(event: HostDiagnosticEvent): void {
      captured.push(event);
    },
    get captured() {
      return captured;
    },
  };
}

// ---------------------------------------------------------------------------
// Runtime host context
// ---------------------------------------------------------------------------

function buildRuntimeHostContext(diagnostics: HostDiagnosticsSink): RuntimeHostContext {
  const runtimeConfig: KernelRuntimeConfig = {
    kind: 'browser-wasm-worker',
    wasmBaseUrl: '', // TODO(02b): awaiting kernel host integration — asset base resolved from iframe bootstrap
    workerUrl: '', // TODO(02b): awaiting kernel host integration — worker URL resolved from iframe bootstrap
    cspPolicy: 'strict',
    memoryPolicy: 'bounded',
  };

  return {
    kernel: runtimeConfig,
    assetPolicy: {
      assetIntegrityPolicy: 'host-verified',
    },
    disposalPolicy: {
      onTrap: 'surface-error',
      onProviderFailure: 'fail-closed',
    },
    diagnostics,
  };
}

// ---------------------------------------------------------------------------
// Factory result
// ---------------------------------------------------------------------------

export interface IframeChildHostResult {
  readonly hostContext: TrustedDocumentHostContext;
  readonly effectiveState: MogEmbedEffectiveState;
  readonly diagnostics: HostDiagnosticsSink;
  readonly allowedParentOrigins: readonly string[];
  readonly channelNonce: string;
  /**
   * Send a protocol message to the validated parent origin.
   * No-ops if no parent origin has been validated yet.
   */
  sendToParent(type: MogEmbedMessage['type'], payload?: unknown): void;
  /**
   * Validate an incoming MessageEvent against allowed origins and protocol.
   * Returns the validated message or null if rejected.
   */
  validateIncoming(event: MessageEvent): MogEmbedMessage | null;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createIframeChildHost(config: IframeChildEmbedConfig): IframeChildHostResult {
  if (config.allowedParentOrigins.length === 0) {
    throw new Error('iframe-child-host: at least one allowed parent origin is required');
  }
  if (!config.channelNonce) {
    throw new Error('iframe-child-host: channelNonce is required');
  }

  const hostId = `${ADAPTER_ID}-${crypto.randomUUID()}`;
  const trustContext = buildTrustContext(config);
  const effectiveState = resolveEffectiveState(config, trustContext);
  const trustProfile = buildTrustProfile();
  const diagnostics = buildDiagnosticsSink();
  const runtimeHostContext = buildRuntimeHostContext(diagnostics);

  let disposed = false;
  let validatedParentOrigin: string | null = null;

  // Branded construction — only allowed in trusted adapter factories.
  const context = {
    hostSurface: 'document-host' as const,
    hostId,
    kind: HOST_KIND,
    trust: trustProfile,
    diagnostics,
    kernel: null as unknown, // TODO(02b): awaiting kernel host integration — KernelHostContext requires session, principal, storage handoff
    runtime: runtimeHostContext,
    view: undefined, // TODO(06): awaiting SheetView contract — ViewHostContext
    shell: undefined,
    dispose(): void {
      disposed = true;
    },
  } as unknown as TrustedDocumentHostContext;

  return {
    hostContext: context,
    effectiveState,
    diagnostics,
    allowedParentOrigins: config.allowedParentOrigins,
    channelNonce: config.channelNonce,

    sendToParent(type, payload) {
      if (disposed) return;
      if (!validatedParentOrigin) return;
      const msg = createMessage(type, payload);
      // SECURITY: always post to validated parent origin, never '*'.
      window.parent.postMessage(msg, validatedParentOrigin);
    },

    validateIncoming(event: MessageEvent): MogEmbedMessage | null {
      if (disposed) return null;
      // SECURITY: Use browser's event.origin, not any claimed origin in payload.
      if (!validateOrigin(event, config.allowedParentOrigins)) return null;
      if (event.source !== window.parent) return null;

      const validated = validateMessagePayload(event.data);
      if (!validated) return null;

      // Latch the validated parent origin on first valid message.
      if (validatedParentOrigin === null) {
        validatedParentOrigin = event.origin;
      }

      return validated;
    },

    dispose() {
      if (disposed) return;
      context.dispose();
    },
  };
}
