import type { DocumentContext } from '../../context';
import { createHandleLiveness, type HandleLiveness } from '../lifecycle/handle-liveness';
import type { WorkbookConfig } from './types';

function resolveWorkbookLivenessMetadata(ctx: DocumentContext): {
  readonly label: string;
  readonly documentId?: string;
  readonly sessionId?: string;
} {
  const maybeScope = (ctx as { workbookLinkScope?: DocumentContext['workbookLinkScope'] })
    .workbookLinkScope;
  const scope = typeof maybeScope === 'function' ? maybeScope.call(ctx) : undefined;
  return {
    label: 'Workbook',
    ...(scope?.requestingDocumentId ? { documentId: scope.requestingDocumentId } : {}),
    ...(scope?.requestingSessionId ? { sessionId: scope.requestingSessionId } : {}),
  };
}

export function createWorkbookLiveness(
  config: Pick<WorkbookConfig, 'liveness'>,
  ctx: DocumentContext,
): HandleLiveness {
  return (
    config.liveness ??
    createHandleLiveness({
      label: 'Workbook',
      code: 'BRIDGE_DISPOSED',
      metadata: resolveWorkbookLivenessMetadata(ctx),
    })
  );
}
