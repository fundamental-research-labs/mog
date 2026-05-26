import type { HostSession } from './kernel';
import type { HostCapabilityRequest, HostCapabilityDecision } from './capabilities';
import type { HostDiagnosticsSink } from './diagnostics';

export interface ShellRouteContext {
  readonly tenantId: string | { readonly kind: 'single-tenant' };
  readonly workspaceId: string | { readonly kind: 'no-workspace' };
  readonly projectId?: string;
  readonly routeId: string;
}

export interface ShellAppLifecycleService {
  launch(appId: string, options: { readonly correlationId: string }): Promise<void>;
  suspend(appId: string, options: { readonly correlationId: string }): Promise<void>;
  resume(appId: string, options: { readonly correlationId: string }): Promise<void>;
  close(appId: string, options: { readonly correlationId: string }): Promise<void>;
}

export interface ShellContributionService {
  registerCommand(commandId: string, contribution: unknown): void | (() => void);
  registerPanel(panelId: string, contribution: unknown): void | (() => void);
  registerMenu(menuId: string, contribution: unknown): void | (() => void);
}

export interface ShellHostContext {
  readonly session: HostSession;
  readonly route: ShellRouteContext;
  readonly appLifecycle: ShellAppLifecycleService;
  readonly contributions: ShellContributionService;
  readonly navigation: {
    navigate(target: string, options?: { readonly correlationId?: string }): void | Promise<void>;
  };
  readonly globalClipboardPolicy: 'host-owned' | 'disabled' | 'app-scoped';
  readonly capabilityUx: {
    requestCapabilityGrant(request: HostCapabilityRequest): Promise<HostCapabilityDecision>;
  };
  readonly diagnostics: HostDiagnosticsSink;
}
