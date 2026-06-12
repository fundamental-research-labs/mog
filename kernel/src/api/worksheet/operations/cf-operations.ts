/**
 * Conditional Formatting Operations Module
 *
 * Functions with real business logic for conditional formatting: range
 * intersection, format-painter clone, wire-to-public type conversion,
 * and multi-step orchestration (clear-all, get-by-id).
 *
 * Trivial one-liner bridge delegations (addCfRule, deleteCfRule, etc.)
 * have been inlined into their callers.
 */

import type { ConditionalFormat as PublicConditionalFormat } from '@mog-sdk/contracts/api';
import type { SheetId } from '@mog-sdk/contracts/core';

import type { DocumentContext } from './shared';

// =============================================================================
// Format Painter: Clone conditional formats for paste
// =============================================================================

/**
 * Relative conditional format for clipboard/format-painter storage.
 * Positions are relative to clipboard origin.
 */
export interface RelativeConditionalFormat {
  /** The actual rule definitions */
  rules: any[];
  /** Range offsets relative to clipboard origin */
  rangeOffsets: Array<{
    startRowOffset: number;
    startColOffset: number;
    endRowOffset: number;
    endColOffset: number;
  }>;
}

/**
 * Clone conditional formats for paste/format-painter operation.
 * Adjusts ranges for new location based on origin and offsets.
 *
 * @param ctx - Store context
 * @param sourceSheetId - Source sheet ID (for cut operation reference removal)
 * @param targetSheetId - Target sheet ID
 * @param formats - Relative CF formats with range offsets
 * @param origin - Target paste origin (row, col)
 * @param isCut - Whether this is a cut operation (deletes originals)
 */
export async function cloneConditionalFormatsForPaste(
  ctx: DocumentContext,
  sourceSheetId: SheetId,
  targetSheetId: SheetId,
  formats: RelativeConditionalFormat[],
  origin: { row: number; col: number },
  isCut: boolean = false,
): Promise<void> {
  for (const cf of formats) {
    // Translate relative range offsets to absolute target ranges
    const targetRanges = cf.rangeOffsets.map((offset) => ({
      startRow: origin.row + offset.startRowOffset,
      startCol: origin.col + offset.startColOffset,
      endRow: origin.row + offset.endRowOffset,
      endCol: origin.col + offset.endColOffset,
    }));

    const cfFormat = {
      id: generateFormatId(),
      sheetId: targetSheetId,
      ranges: targetRanges,
      rules: cf.rules.map((rule, i) => ({
        ...rule,
        id: generateRuleId(),
        priority: i,
      })),
    };
    await ctx.computeBridge.addCfRule(targetSheetId, cfFormat);
  }

  // For cut: delete originals from source sheet
  // (caller would need to pass originalFormatId to support this fully;
  //  for format-painter isCut is always false)
  void sourceSheetId;
  void isCut;
}

// =============================================================================
// Clear CF Rules in Ranges (range intersection logic)
// =============================================================================

/**
 * Clear conditional formatting rules that intersect any of the given ranges.
 *
 * Gets all CF rules, checks if their ranges intersect any of the selection
 * ranges, and deletes those that do.
 */
export async function clearCFRulesInRanges(
  ctx: DocumentContext,
  sheetId: SheetId,
  ranges: Array<{ startRow: number; startCol: number; endRow: number; endCol: number }>,
): Promise<void> {
  const allRules = await ctx.computeBridge.getAllCfRules(sheetId);

  const toDelete: string[] = [];
  for (const rule of allRules) {
    const ruleRanges: Array<{
      startRow: number;
      startCol: number;
      endRow: number;
      endCol: number;
    }> = rule.ranges ?? [];

    let shouldDelete = false;
    for (const selRange of ranges) {
      for (const cfRange of ruleRanges) {
        if (
          !(
            selRange.endRow < cfRange.startRow ||
            selRange.startRow > cfRange.endRow ||
            selRange.endCol < cfRange.startCol ||
            selRange.startCol > cfRange.endCol
          )
        ) {
          shouldDelete = true;
          break;
        }
      }
      if (shouldDelete) break;
    }

    if (shouldDelete && rule.id) {
      toDelete.push(rule.id);
    }
  }

  await Promise.all(toDelete.map((id) => ctx.computeBridge.deleteCfRule(sheetId, id)));
}

// =============================================================================
// Style Normalization — flatten nested { fill, font, border } to flat CFStyle
// =============================================================================

/**
 * Normalize a CF rule's `style` property from nested OfficeJS-style format
 * (`{ fill: { backgroundColor }, font: { bold, color }, border: { color, style } }`)
 * to the flat CFStyle expected by the Rust engine
 * (`{ backgroundColor, bold, fontColor, borderColor, borderStyle }`).
 *
 * If the style is already flat (no fill/font/border sub-objects), it is returned
 * unchanged. Mixed input (some flat keys plus nested objects) is merged with
 * flat keys taking precedence.
 */
function flattenCfStyle(style: Record<string, any> | undefined): Record<string, any> | undefined {
  if (!style || typeof style !== 'object') return style;

  const result: Record<string, any> = {};

  // Copy all flat (non-nested) keys first.
  for (const [k, v] of Object.entries(style)) {
    if (k !== 'fill' && k !== 'font' && k !== 'border') {
      result[k] = v;
    }
  }

  // Flatten `fill` sub-object.
  if (style.fill && typeof style.fill === 'object') {
    const fill = style.fill as Record<string, any>;
    if (fill.backgroundColor != null && result.backgroundColor == null) {
      result.backgroundColor = fill.backgroundColor;
    }
    // Also accept `color` as alias for `backgroundColor` inside fill.
    if (fill.color != null && result.backgroundColor == null) {
      result.backgroundColor = fill.color;
    }
  }

  // Flatten `font` sub-object.
  if (style.font && typeof style.font === 'object') {
    const font = style.font as Record<string, any>;
    if (font.color != null && result.fontColor == null) result.fontColor = font.color;
    if (font.fontColor != null && result.fontColor == null) result.fontColor = font.fontColor;
    if (font.bold != null && result.bold == null) result.bold = font.bold;
    if (font.italic != null && result.italic == null) result.italic = font.italic;
    if (font.strikethrough != null && result.strikethrough == null)
      result.strikethrough = font.strikethrough;
    if (font.underlineType != null && result.underlineType == null)
      result.underlineType = font.underlineType;
  }

  // Flatten `border` sub-object.
  if (style.border && typeof style.border === 'object') {
    const border = style.border as Record<string, any>;
    if (border.color != null && result.borderColor == null) result.borderColor = border.color;
    if (border.borderColor != null && result.borderColor == null)
      result.borderColor = border.borderColor;
    if (border.style != null && result.borderStyle == null) result.borderStyle = border.style;
    if (border.borderStyle != null && result.borderStyle == null)
      result.borderStyle = border.borderStyle;
    // Per-side borders
    for (const side of ['Top', 'Bottom', 'Left', 'Right'] as const) {
      const sideKey = side.toLowerCase();
      if (border[sideKey] && typeof border[sideKey] === 'object') {
        const sideObj = border[sideKey] as Record<string, any>;
        if (sideObj.color != null && result[`border${side}Color`] == null)
          result[`border${side}Color`] = sideObj.color;
        if (sideObj.style != null && result[`border${side}Style`] == null)
          result[`border${side}Style`] = sideObj.style;
      }
      // Also support flat borderTopColor etc. inside border object
      if (border[`${sideKey}Color`] != null && result[`border${side}Color`] == null)
        result[`border${side}Color`] = border[`${sideKey}Color`];
      if (border[`${sideKey}Style`] != null && result[`border${side}Style`] == null)
        result[`border${side}Style`] = border[`${sideKey}Style`];
    }
  }

  return result;
}

/**
 * Normalize a CF color point from the public API shape
 * (`{ type, value?, color, ... }`, where `type` is a `CFValueType` token) to
 * the Rust wire shape (`{ value: { kind, value? | source? }, color, ... }`).
 *
 * The normalized CFVO contract collapsed the former `value_type: CfvoType` + `value:
 * Option<Value>` pair on the Rust `CFColorPoint` into a single tagged enum
 * `CFValueRef { kind, value? }`. The public TS contract still uses the flat
 * `{ type, value? }` shape, so we translate here at the kernel→Rust boundary.
 *
 * Leaves the input unchanged if it already looks typed (has a nested
 * `value.kind`), so manual callers that pre-construct the wire shape still
 * work.
 */
function normalizeColorPoint(
  point: Record<string, any> | undefined,
): Record<string, any> | undefined {
  if (!point || typeof point !== 'object') return point;

  // Already in the typed wire shape — pass through.
  if (point.value && typeof point.value === 'object' && typeof point.value.kind === 'string') {
    return point;
  }

  // Copy all fields except `type` and `value` (which fold into `value.kind`
  // / `value.value` / `value.source`).
  const { type, value, ...rest } = point;

  let valueRef: Record<string, any>;
  switch (type) {
    case 'min':
      valueRef = { kind: 'min' };
      break;
    case 'max':
      valueRef = { kind: 'max' };
      break;
    case 'autoMin':
      valueRef = { kind: 'autoMin' };
      break;
    case 'autoMax':
      valueRef = { kind: 'autoMax' };
      break;
    case 'number':
    case 'num':
      valueRef = { kind: 'num', value: typeof value === 'string' ? Number(value) : (value ?? 0) };
      break;
    case 'percent':
      valueRef = {
        kind: 'percent',
        value: typeof value === 'string' ? Number(value) : (value ?? 0),
      };
      break;
    case 'percentile':
      valueRef = {
        kind: 'percentile',
        value: typeof value === 'string' ? Number(value) : (value ?? 0),
      };
      break;
    case 'formula':
      valueRef = { kind: 'formula', source: value == null ? '' : String(value) };
      break;
    default:
      // Unknown token — fall back to a numeric default so Rust doesn't reject
      // the whole payload. `type=undefined` usually means the caller forgot
      // the field; a zero-valued `num` is the same shape the old
      // `CfvoType::default()` + `value: None` pair produced.
      valueRef = { kind: 'num', value: 0 };
      break;
  }

  return { ...rest, value: valueRef };
}

function normalizeIconSet(
  iconSet: Record<string, any> | undefined,
): Record<string, any> | undefined {
  if (!iconSet || typeof iconSet !== 'object') return iconSet;

  const normalized: Record<string, any> = {
    ...iconSet,
    iconSetName: iconSet.iconSetName ?? iconSet.icon_set_name,
  };
  delete normalized.icon_set_name;

  if (Array.isArray(iconSet.thresholds)) {
    normalized.thresholds = iconSet.thresholds.map((threshold: any) => {
      if (!threshold || typeof threshold !== 'object') return threshold;
      if (threshold.type === 'number') {
        return { ...threshold, type: 'num' };
      }
      return threshold;
    });
  }

  return normalized;
}

/**
 * Normalize all rules in an array: flatten nested styles and translate
 * color-scale / data-bar color points to the Rust wire shape.
 *
 * Exported so `conditional-formats.ts` (update / changeRuleType /
 * clearRuleStyle paths) can share the same normalization as `add`.
 */
export function normalizeRulesForWire<T extends Record<string, any>>(rules: T[]): T[] {
  return normalizeRules(rules);
}

/**
 * Apply non-semantic shape adjustments only: nested style flattening and
 * color-point translation. Semantic rule-shape promotions
 * (`notContainsBlanks` → `containsBlanks{blanks:false}`, `cellValue` + text
 * operator → `containsText`, `expression` → `formula`, etc.) live in Rust
 * (`domain_types::domain::conditional_format::normalize_cf_rule_input`)
 * and run inside `compute_add_cf_rule` / `compute_update_cf_rule`. Keeping
 * the TS-side normalization to *shape* (not *type*) avoids duplicating the
 * canonical schema in two places.
 */
function normalizeRules<T extends Record<string, any>>(rules: T[]): T[] {
  return rules.map((rule) => {
    let out: Record<string, any> = { ...rule };
    if ('style' in out) {
      out = { ...out, style: flattenCfStyle(out.style) };
    }
    // Accept both camelCase public (`colorScale` / `dataBar` / `iconSet` /
    // `timePeriod`) and historical snake_case scenario/bridge aliases, then
    // always send the canonical camelCase fields that the tagged Rust enum
    // deserializes at the N-API boundary.
    const colorScale = out.colorScale ?? out.color_scale;
    if (colorScale && typeof colorScale === 'object') {
      const normalized: Record<string, any> = { ...colorScale };
      if (colorScale.minPoint) normalized.minPoint = normalizeColorPoint(colorScale.minPoint);
      if (colorScale.midPoint) normalized.midPoint = normalizeColorPoint(colorScale.midPoint);
      if (colorScale.maxPoint) normalized.maxPoint = normalizeColorPoint(colorScale.maxPoint);
      out = { ...out, colorScale: normalized };
      delete out.color_scale;
    }
    const dataBar = out.dataBar ?? out.data_bar;
    if (dataBar && typeof dataBar === 'object') {
      const normalized: Record<string, any> = { ...dataBar };
      if (dataBar.minPoint) normalized.minPoint = normalizeColorPoint(dataBar.minPoint);
      if (dataBar.maxPoint) normalized.maxPoint = normalizeColorPoint(dataBar.maxPoint);
      out = { ...out, dataBar: normalized };
      delete out.data_bar;
    }
    const iconSet = out.iconSet ?? out.icon_set;
    if (iconSet && typeof iconSet === 'object') {
      out = { ...out, iconSet: normalizeIconSet(iconSet) };
      delete out.icon_set;
    }
    if (out.timePeriod == null && out.time_period != null) {
      out = { ...out, timePeriod: out.time_period };
      delete out.time_period;
    }
    // Map public CFTextOperator 'contains' → Rust CfOperator 'containsText'.
    // The OOXML ST_ConditionalFormattingOperator uses 'containsText' for the
    // text-contains variant; TypeScript CFTextOperator uses 'contains'. Promote
    // at the kernel boundary so callers use the short public name.
    if (out.type === 'containsText' && out.operator === 'contains') {
      out = { ...out, operator: 'containsText' };
    }
    return out as T;
  });
}

// =============================================================================
// Format-Level Operations (wire-to-public conversion + multi-step)
// =============================================================================

/** Monotonic counter to guarantee unique, sortable format IDs even within the same millisecond. */
let cfSeq = 0;

/** Generate a unique format ID. */
function generateFormatId(): string {
  return `cf-${Date.now()}-${String(cfSeq++).padStart(5, '0')}`;
}

/** Generate a unique rule ID. */
function generateRuleId(): string {
  return `rule-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Convert a wire-format CF rule (from computeBridge.getAllCfRules) to
 * the public ConditionalFormat type (with CellRange[]).
 */
function toPublicFormat(wireRule: any): PublicConditionalFormat {
  const ranges = (wireRule.ranges ?? []).map((r: any) => ({
    startRow: r.startRow,
    startCol: r.startCol,
    endRow: r.endRow,
    endCol: r.endCol,
  }));
  return { id: wireRule.id, ranges, rules: (wireRule.rules ?? []).map(toPublicRule) };
}

function toPublicRule(rule: any): any {
  if (!rule || typeof rule !== 'object') return rule;

  let out = { ...rule };
  if (out.type === 'containsText' && out.operator === 'containsText') {
    out = { ...out, operator: 'contains' };
  }
  return out;
}

/**
 * Add a new conditional format with ranges and rules. Persists via
 * `computeBridge.addCfRule()`, which owns:
 * - Wire-shape normalization (`notContainsBlanks`, `expression`, `cellValue`
 *   + text-operator promotion, etc.) via
 *   `domain_types::domain::conditional_format::normalize_conditional_format_input`.
 * - Priority insertion: new formats are placed at the front (Excel semantics —
 *   later-added wins), and existing formats' priorities are bumped to follow.
 *
 * IDs are generated client-side so the caller can return the new format id
 * synchronously without a read-back round trip.
 */
export async function addConditionalFormat(
  ctx: DocumentContext,
  sheetId: SheetId,
  ranges: Array<{ startRow: number; startCol: number; endRow: number; endCol: number }>,
  rules: any[],
): Promise<string> {
  const formatId = generateFormatId();
  const cfFormat = {
    id: formatId,
    sheetId,
    ranges: ranges.map((r) => ({
      startRow: r.startRow,
      startCol: r.startCol,
      endRow: r.endRow,
      endCol: r.endCol,
    })),
    rules: normalizeRules(rules).map((ruleInput) => ({
      ...ruleInput,
      id: generateRuleId(),
      // Priority is assigned by Rust (`compute_add_cf_rule` puts the new
      // format at the front; rules are renumbered sequentially). Send a
      // placeholder of 0 so the wire schema stays satisfied — Rust
      // overwrites it before persisting.
      priority: 0,
    })),
  };
  await ctx.computeBridge.addCfRule(sheetId, cfFormat);
  return formatId;
}

/**
 * Get a conditional format by its ID.
 * Queries all rules from Rust and filters by formatId.
 */
export async function getConditionalFormat(
  ctx: DocumentContext,
  sheetId: SheetId,
  formatId: string,
): Promise<PublicConditionalFormat | null> {
  const allRules = await ctx.computeBridge.getAllCfRules(sheetId);
  const match = allRules.find((r: any) => r.id === formatId || r.formatId === formatId);
  if (!match) return null;
  return toPublicFormat(match);
}

/**
 * Get all conditional formats for a sheet.
 * Reads directly from Rust via computeBridge.getAllCfRules().
 */
export async function getConditionalFormats(
  ctx: DocumentContext,
  sheetId: SheetId,
): Promise<PublicConditionalFormat[]> {
  const allRules = await ctx.computeBridge.getAllCfRules(sheetId);
  return allRules.map(toPublicFormat);
}

/**
 * Clear all conditional formats from a sheet.
 * Retrieves all rules from Rust and deletes them in parallel.
 */
export async function clearAllConditionalFormats(
  ctx: DocumentContext,
  sheetId: SheetId,
): Promise<void> {
  const allRules = await ctx.computeBridge.getAllCfRules(sheetId);
  await Promise.all(allRules.map((rule) => ctx.computeBridge.deleteCfRule(sheetId, rule.id)));
}
