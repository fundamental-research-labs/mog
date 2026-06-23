import type {
  FormulaReferenceDiagnosticsOptions,
  FormulaReferenceDiagnosticsPage,
  WorkbookExternalReferenceCheckOptions,
  WorkbookValidationFinding,
  WorkbookValidationResult,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import { diagnoseTrackedExternalFormulaReferences } from './external-reference-diagnostics';
import {
  normalizeWorkbookDiagnosticLimit,
  workbookValidationResult,
} from './diagnostics-validation-helpers';

const ERROR_REFERENCE_KINDS = new Set([
  'unresolved-external-reference',
  'external-reference-warning',
]);
const BAD_LINK_STATUSES = new Set(['unresolved', 'stale', 'denied', 'broken', 'ambiguous']);

type FormulaReferencesGetter = (
  options?: FormulaReferenceDiagnosticsOptions,
) => Promise<FormulaReferenceDiagnosticsPage>;

export async function checkWorkbookExternalReferences(
  ctx: DocumentContext,
  getFormulaReferences: FormulaReferencesGetter,
  options: WorkbookExternalReferenceCheckOptions = {},
): Promise<WorkbookValidationResult> {
  const check = 'external-references';
  const limit = normalizeWorkbookDiagnosticLimit(options.limit);
  const findings: WorkbookValidationFinding[] = [];
  let truncated = false;

  const page = await getFormulaReferences({
    includeWarnings: options.includeWarnings ?? true,
    limit,
  });
  for (const diagnostic of page.diagnostics) {
    if (diagnostic.type !== 'reference-edge' || !ERROR_REFERENCE_KINDS.has(diagnostic.kind)) {
      continue;
    }
    findings.push({
      id: `${check}:formula:${diagnostic.id}`,
      check,
      severity: diagnostic.severity,
      code: diagnostic.kind,
      message:
        diagnostic.edge.reason ||
        `External reference ${diagnostic.edge.text} is ${diagnostic.edge.status}.`,
      sheetId: diagnostic.location.sheetId,
      address: diagnostic.location.address,
      row: diagnostic.location.row,
      col: diagnostic.location.col,
      formula: diagnostic.formula ?? null,
      suggestedNextApiCall: 'await wb.diagnostics.getFormulaReferences({ includeWarnings: true })',
      details: {
        edgeId: diagnostic.edge.edgeId,
        text: diagnostic.edge.text,
        status: diagnostic.edge.status,
        linkId: diagnostic.edge.linkId,
        targetDisplay: diagnostic.edge.targetDisplay,
      },
    });
    if (findings.length >= limit) {
      truncated = true;
      break;
    }
  }

  if (!truncated) {
    const tracked = await diagnoseTrackedExternalFormulaReferences(
      ctx,
      check,
      limit - findings.length,
    );
    findings.push(...tracked.findings);
    truncated = tracked.truncated;
  }

  if (!truncated && ctx.workbookLinks) {
    const scope = ctx.workbookLinkScope();
    for (const link of ctx.workbookLinks.list()) {
      const status = ctx.workbookLinks.getStatus(link.linkId, scope);
      if (!BAD_LINK_STATUSES.has(status.status)) continue;
      findings.push({
        id: `${check}:link:${link.linkId}`,
        check,
        severity: status.status === 'stale' ? 'warning' : 'error',
        code: `EXTERNAL_LINK_${status.status.toUpperCase()}`,
        message: `External link "${link.displayName || link.linkId}" is ${status.status}.`,
        suggestedNextApiCall: `await wb.links.getStatus(${JSON.stringify(link.linkId)})`,
        details: {
          linkId: link.linkId,
          sourceKind: link.sourceKind,
          status: status.status,
          statusReason: status.statusReason,
          canRefresh: status.canRefresh,
        },
      });
      if (findings.length >= limit) {
        truncated = true;
        break;
      }
    }
  }

  return workbookValidationResult(check, findings, {
    checkedRanges: 0,
    truncated: truncated || Boolean(page.nextCursor),
  });
}
