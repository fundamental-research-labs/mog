/**
 * Namespace APIs — Low-level function-oriented access to kernel data.
 *
 * Stability classifications:
 * - Cells:   @stability experimental — cell read/write via IKernelContext
 * - Records: @stability experimental — table record CRUD via IKernelContext
 * - Sheets:  @stability experimental — sheet metadata reads + view ops
 *
 * External SDK consumers should prefer the high-level Workbook/Worksheet API.
 * These namespaces are available for advanced use cases that need direct
 * positional access. APIs may change across minor versions.
 */
export * as Cells from './cells';
export * as Records from './records';
export type { FilterExpression, RecordValues, TableRecord } from './records';
export * as Sheets from './sheets';
