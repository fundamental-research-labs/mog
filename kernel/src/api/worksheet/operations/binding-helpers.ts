/**
 * Binding response shape mapper.
 *
 * Both NAPI and WASM transports normalise snake_case → camelCase at the
 * boundary (see infra/transport/src/case-normalize.ts), so this helper
 * just maps the wire-shape Record<string, unknown> to the typed contract.
 */

import type { SheetDataBindingInfo } from '@mog-sdk/contracts/api';

/**
 * Normalize a raw binding response from the compute bridge.
 * Bridge responses arrive camelCased; this helper applies defaults for
 * optional fields the contract requires.
 */
export function normalizeBindingResponse(b: any): SheetDataBindingInfo {
  return {
    id: b.id,
    connectionId: b.connectionId,
    columnMappings: b.columnMappings ?? [],
    autoGenerateRows: b.autoGenerateRows ?? true,
    headerRow: b.headerRow ?? 0,
    dataStartRow: b.dataStartRow ?? 1,
    preserveHeaderFormatting: b.preserveHeaderFormatting ?? true,
    lastRefresh: b.lastRefresh,
  };
}
