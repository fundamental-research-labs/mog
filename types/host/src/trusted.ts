import type { KernelHostContext } from './kernel';
import type { ViewHostContext } from './view';
import type { ShellHostContext } from './shell';
import type { RuntimeHostContext } from './runtime';
import type { HostTrustProfile } from './trust';
import type { HostDiagnosticsSink } from './diagnostics';

declare const trustedHostBrand: unique symbol;

export type TrustedHostKind =
  | 'standalone-shell'
  | 'hosted-workspace'
  | 'self-hosted-workspace'
  | 'react-embed'
  | 'web-component-embed'
  | 'iframe-child'
  | 'node-sdk'
  | 'http-service'
  | 'tauri-desktop'
  | 'test';

export interface TrustedHostBase {
  readonly [trustedHostBrand]: true;
  readonly hostId: string;
  readonly kind: TrustedHostKind;
  readonly trust: HostTrustProfile;
  readonly diagnostics: HostDiagnosticsSink;
  dispose(): void | Promise<void>;
}

export interface TrustedDocumentHostContext extends TrustedHostBase {
  readonly hostSurface: 'document-host';
  readonly kernel: KernelHostContext;
  readonly runtime: RuntimeHostContext;
  readonly view?: ViewHostContext;
  readonly shell?: ShellHostContext;
}
