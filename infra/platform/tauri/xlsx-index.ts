/**
 * XLSX Import/Export Public API
 *
 * Low-level Tauri IPC wrappers. For high-level usage, prefer
 * transport.call('xlsx_parse_full') via BridgeTransport.
 */

export { exportXlsxNative, importXlsxNative } from './xlsx';
