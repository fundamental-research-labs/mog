/**
 * Fill Module - Types Only
 *
 * Custom lists types and fill operation types.
 * Runtime constant (BUILT_IN_LISTS) has been moved to
 * @mog-sdk/kernel/domain/fill/custom-lists.
 */

export type { CustomList, CustomListRegistry } from './custom-lists';

// Fill types (shared across zones)
export type {
  AutoFillChange,
  AutoFillMode,
  AutoFillResult,
  AutoFillWarning,
  AutoFillWarningKind,
  DateUnit,
  FillDirection,
  FillOptions,
  FillPatternType,
  FillSeriesOptions,
  AutoFillContentType,
  FlashFillPreviewValue,
  SeriesType,
} from './types';

export { DEFAULT_FILL_OPTIONS } from './types';
