/**
 * Fields that represent position/layout-only changes on a floating object.
 * Updates containing only these fields do not affect compiled chart marks
 * (data, axes, series, legends, etc.) and should not trigger cache invalidation.
 */
const POSITION_ONLY_FIELDS = new Set([
  'anchorRow',
  'anchorCol',
  'anchorRowOffset',
  'anchorColOffset',
  'anchorRowOffsetEmu',
  'anchorColOffsetEmu',
  'endRow',
  'endCol',
  'endRowOffset',
  'endColOffset',
  'endRowOffsetEmu',
  'endColOffsetEmu',
  'extentCx',
  'extentCy',
  'extentCxEmu',
  'extentCyEmu',
  'width',
  'height',
  'offsetX',
  'offsetY',
  'rotation',
  'zIndex',
]);

/**
 * Returns true if changedFields contains only position/layout fields.
 * Returns false for empty or undefined fields (safe default: invalidate on unknown changes).
 */
export function isPositionOnlyUpdate(fields: string[]): boolean {
  return fields.length > 0 && fields.every((field) => POSITION_ONLY_FIELDS.has(field));
}
