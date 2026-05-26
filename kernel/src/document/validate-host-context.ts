import type { KernelHostContext } from '@mog-sdk/types-host/kernel';
import { HostContextValidationError } from '../errors/document';

export function validateHostContext(ctx: KernelHostContext): void {
  if (!ctx.session) throw new HostContextValidationError('KernelHostContext.session is required');
  if (!ctx.principal)
    throw new HostContextValidationError('KernelHostContext.principal is required');
  if (!ctx.storage) throw new HostContextValidationError('KernelHostContext.storage is required');
  if (!ctx.runtime) throw new HostContextValidationError('KernelHostContext.runtime is required');
  if (!ctx.diagnostics)
    throw new HostContextValidationError('KernelHostContext.diagnostics is required');
  if (!ctx.clock) throw new HostContextValidationError('KernelHostContext.clock is required');
  if (!ctx.timezone) throw new HostContextValidationError('KernelHostContext.timezone is required');

  const sessionTenant = ctx.session.tenantId;
  const principalTenant = ctx.principal.tenantId;
  if (JSON.stringify(sessionTenant) !== JSON.stringify(principalTenant)) {
    throw new HostContextValidationError(
      `Session/principal tenant mismatch: session=${JSON.stringify(sessionTenant)}, principal=${JSON.stringify(principalTenant)}`,
    );
  }

  const sessionWorkspace = ctx.session.workspaceId;
  const principalWorkspace = ctx.principal.workspaceId;
  if (JSON.stringify(sessionWorkspace) !== JSON.stringify(principalWorkspace)) {
    throw new HostContextValidationError(
      `Session/principal workspace mismatch: session=${JSON.stringify(sessionWorkspace)}, principal=${JSON.stringify(principalWorkspace)}`,
    );
  }

  if (ctx.storage.sessionId !== ctx.session.sessionId) {
    throw new HostContextValidationError(
      `Storage handoff session mismatch: storage=${ctx.storage.sessionId}, session=${ctx.session.sessionId}`,
    );
  }

  if (ctx.storage.expiresAt <= ctx.clock.now()) {
    throw new HostContextValidationError(
      `Storage handoff expired: expiresAt=${ctx.storage.expiresAt}, now=${ctx.clock.now()}`,
    );
  }

  if (ctx.session.userTimezone !== ctx.timezone.userTimezone) {
    throw new HostContextValidationError(
      `Session/timezone mismatch: session=${ctx.session.userTimezone}, timezone=${ctx.timezone.userTimezone}`,
    );
  }
}
