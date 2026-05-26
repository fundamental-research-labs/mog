/**
 * Public cell style contracts.
 *
 * DEFAULT_CELL_STYLE is a public runtime contract value used by render and
 * spreadsheet utility packages, so it is owned by @mog-sdk/contracts at runtime.
 */
export type * from '@mog/types-core/cell-style';

/** Default cell styling values. */
export const DEFAULT_CELL_STYLE = {
  fontSize: 12,
  fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
  fontColor: '#000000',
  padding: 4,
  horizontalAlign: 'left' as const,
  verticalAlign: 'bottom' as const,
  backgroundColor: undefined as string | undefined,
} as const;
