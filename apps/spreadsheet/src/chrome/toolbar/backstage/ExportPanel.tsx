/**
 * ExportPanel Component
 *
 * Export to different formats (PDF, CSV, XLSX).
 *
 * CSV/XLSX dispatch through the Unified Action System (the kernel emits
 * bytes synchronously via toCSV()/toXlsx() so the action handler can
 * trigger a download). PDF goes through `usePdfExport` directly: the
 * SpreadsheetPdfExporter is React-hook-mediated (DocumentProvider's
 * Workbook + a per-sheet DimensionCache) and must mount in a component
 * tree to render. EXPORT_AS_PDF the action stays as the file-menu nav
 * surface that opens this panel — kicking the renderer from the action
 * handler isn't possible without the hook context.
 *
 * Issue #115: every leaf must produce an observable side effect.
 */

import { useCallback } from 'react';
import { Button } from '@mog/shell';
import { dispatch, useActionDependencies } from '../../../internal-api';
import { useActiveSheetId } from '../../../infra/context';
import { usePdfExport } from '../../../hooks/file-io/use-pdf-export';
import { BackstagePanel } from './BackstagePanel';

export function ExportPanel() {
  const deps = useActionDependencies();
  const activeSheetId = useActiveSheetId();
  const { exportPdf, state: pdfState } = usePdfExport(activeSheetId);

  const handleExportPdf = useCallback(() => {
    // Drive the production renderer (`@mog/print-export`) directly so
    // clicking Export as PDF actually writes a PDF, rather than only
    // re-opening the panel via the action dispatcher.
    void exportPdf();
  }, [exportPdf]);
  const handleExportCsv = useCallback(() => dispatch('EXPORT_AS_CSV', deps), [deps]);
  const handleExportXlsx = useCallback(() => dispatch('EXPORT_AS_XLSX', deps), [deps]);

  return (
    <BackstagePanel title="Export" description="Export your spreadsheet to different formats">
      <div className="space-y-4">
        <div className="space-y-3">
          <Button
            variant="secondary"
            size="md"
            className="w-full justify-start"
            data-testid="file-menu-item-export-pdf"
            onClick={handleExportPdf}
            disabled={pdfState.isExporting}
          >
            {pdfState.isExporting ? 'Exporting…' : 'Export as PDF'}
          </Button>
          {/* Surface the renderer's error state when present so the leaf
 isn't a silent failure on web (issue #115). The web bytes-out
 path through `pdf_get_document_bytes` is pending follow-up
 #8; until then `usePdfExport` populates `state.error` which
 we render inline next to the button. */}
          {pdfState.error && (
            <p
              data-testid="file-menu-item-export-pdf-error"
              className="text-caption text-ss-error"
              role="status"
            >
              {pdfState.error}
            </p>
          )}
          <Button
            variant="secondary"
            size="md"
            className="w-full justify-start"
            data-testid="file-menu-item-export-csv"
            onClick={handleExportCsv}
          >
            Export as CSV
          </Button>
          <Button
            variant="secondary"
            size="md"
            className="w-full justify-start"
            data-testid="file-menu-item-export-xlsx"
            onClick={handleExportXlsx}
          >
            Export as XLSX
          </Button>
        </div>
      </div>
    </BackstagePanel>
  );
}
