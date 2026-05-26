/**
 * Factory function for creating a SpreadsheetPdfExporter with the
 * production Rust-backed PDF pipeline.
 *
 * Wires up: PdfCanvas + TauriFontBridge → SpreadsheetPdfExporter
 *
 * This keeps the app layer from needing to import @mog/pdf-graphics
 * directly — the backend creation is encapsulated here.
 */

import { PdfCanvas, TauriFontBridge } from '@mog/pdf-graphics';
import type { PdfDataProvider } from './exporter';
import { SpreadsheetPdfExporter } from './exporter';

/**
 * Create a SpreadsheetPdfExporter wired to the Rust PDF pipeline
 * via TauriFontBridge (Tauri IPC) and PdfCanvas (command buffer).
 *
 * Usage:
 *   const exporter = createPdfExporter(dataProvider);
 *   const result = await exporter.export({ sheetIds: ['sheet1'] });
 */
export function createPdfExporter(dataProvider: PdfDataProvider): SpreadsheetPdfExporter {
  const bridge = new TauriFontBridge();
  const backend = new PdfCanvas(bridge);
  return new SpreadsheetPdfExporter(dataProvider, backend);
}
