import type { ExternalLinkStatusSnapshot } from '../../bridges/compute/compute-types.gen';
import type { DocumentContext } from '../../context';

export function buildWorkbookDiagnosticExternalLinkSnapshot(
  ctx: DocumentContext,
): ExternalLinkStatusSnapshot {
  const scope = ctx.workbookLinkScope();
  const records = ctx.workbookLinks.list().map((link) => {
    const status = ctx.workbookLinks.getStatus(link.linkId, scope);
    return {
      linkId: link.linkId,
      status: status.status,
      statusReason: status.statusReason,
      safeDisplayName: link.displayName || link.linkId,
    };
  });
  const version = records
    .map((record) => `${record.linkId}:${record.status}:${record.statusReason ?? ''}`)
    .sort()
    .join('|');
  return { version: version || 'empty', records };
}
