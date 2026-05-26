/**
 * Native XLSX operations via Tauri
 *
 * Low-level wrappers around Tauri IPC commands for XLSX import/export.
 * For high-level usage, prefer transport.call('xlsx_parse_full') via BridgeTransport.
 */

import type { ImportXlsxResult } from './contracts';
import { export_xlsx, import_xlsx } from './ipc/ipc';

/**
 * Import an XLSX file using native Rust parser via Tauri IPC.
 *
 * @param filePath - Absolute path to the XLSX file
 * @returns Parsed workbook (FullParseResult JSON shape)
 */
export async function importXlsxNative(filePath: string): Promise<ImportXlsxResult> {
  return import_xlsx({ filePath });
}

/**
 * Export a workbook to XLSX format using the unified Rust export path via Tauri IPC.
 *
 * The compute engine reads its internal state directly — no JSON serialization needed.
 *
 * @param filePath - Absolute path for the output XLSX file
 * @param docId - Document ID identifying the compute engine instance to export
 */
export async function exportXlsxNative(filePath: string, docId: string): Promise<void> {
  return export_xlsx({ filePath, docId });
}
