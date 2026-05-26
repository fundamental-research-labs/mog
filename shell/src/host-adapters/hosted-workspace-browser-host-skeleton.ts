import type { TrustedDocumentHostContext, TrustedHostKind } from '@mog-sdk/types-host/trusted';
import type { HostSession } from '@mog-sdk/types-host/kernel';
import type { VerifiedPrincipal } from '@mog-sdk/types-host/identity';
import type { HostDiagnosticsSink } from '@mog-sdk/types-host/diagnostics';

// 02c-A: Skeleton for hosted workspace / SaaS browser host.
// Compliance blocked on runtime services (runtime services), shell/app/plugin platform (shell/app/plugin platform),
// the storage provider lifecycle (storage provider lifecycle), verification contracts (verification contracts).
// This adapter must NOT fall back to standalone-shell defaults.

const ADAPTER_ID = 'hosted-workspace-browser-host' as const;
const HOST_KIND: TrustedHostKind = 'hosted-workspace';

interface HostedWorkspaceConfig {
  readonly controlPlaneManifest: {
    readonly sessionToken: string;
    readonly tenantId: string;
    readonly workspaceId: string;
  };
  // Browser route/options are non-authoritative hints only
  readonly routeHints?: {
    readonly documentId?: string;
    readonly appId?: string;
  };
}

// Compile check only — blocked
function _compileCheck(_config: HostedWorkspaceConfig): TrustedDocumentHostContext {
  throw new Error('02c-A skeleton: blocked on runtime services/09/03/11');
}

void _compileCheck;
void ADAPTER_ID;
void HOST_KIND;

export {};
