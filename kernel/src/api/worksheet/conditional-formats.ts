/**
 * WorksheetConditionalFormattingImpl — Implementation of the
 * WorksheetConditionalFormatting sub-API.
 *
 * Calls computeBridge directly for simple operations and delegates to
 * cf-operations.ts for operations with real business logic (multi-step
 * transforms, range intersection, format-level grouping).
 */
import type {
  CellRange,
  CFRule,
  CFRuleInput,
  ConditionalFormat,
  ConditionalFormatUpdate,
  SheetId,
  WorksheetConditionalFormatting,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import { KernelError } from '../../errors';
import { resolveRange } from '../internal/address-resolver';
import * as CFOps from './operations/cf-operations';

// ---------------------------------------------------------------------------
// Style normalization helper (shared between add / update / changeRuleType)
// ---------------------------------------------------------------------------

function receivedType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function invalidConditionalFormatArrayError(
  value: unknown,
  path: string[],
  methodName: string,
  expected: string,
  issueCode: string,
  suggestion: string,
): KernelError {
  return new KernelError(
    'API_INVALID_ARGUMENT',
    `${methodName}: ${path.join('.')} must be ${expected}.`,
    {
      context: {
        issueCode,
        path,
        expected,
        receivedType: receivedType(value),
      },
      path,
      suggestion,
    },
  );
}

function assertCfRangeArray(
  value: unknown,
  path: string[],
  methodName: string,
  expected = 'an array of range strings or CellRange objects',
  suggestion = 'Use ["A1:A10"].',
): asserts value is (string | CellRange)[] {
  if (!Array.isArray(value)) {
    throw invalidConditionalFormatArrayError(
      value,
      path,
      methodName,
      expected,
      'CF_RANGES_MUST_BE_ARRAY',
      suggestion,
    );
  }
}

function assertCfRuleArray(
  value: unknown,
  path: string[],
  methodName: string,
): asserts value is CFRuleInput[] {
  if (!Array.isArray(value)) {
    throw invalidConditionalFormatArrayError(
      value,
      path,
      methodName,
      'an array of conditional format rules',
      'CF_RULES_MUST_BE_ARRAY',
      'Use an array of rule objects, for example [{ type: "formula", formula: "=A1>0", style: {} }].',
    );
  }
}

function assertCfRelativeFormatArray(
  value: unknown,
  path: string[],
  methodName: string,
): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw invalidConditionalFormatArrayError(
      value,
      path,
      methodName,
      'an array of relative conditional format objects',
      'CF_RELATIVE_FORMATS_MUST_BE_ARRAY',
      'Use an array of relative conditional format objects.',
    );
  }
}

function assertCfRangeOffsetArray(
  value: unknown,
  path: string[],
  methodName: string,
): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw invalidConditionalFormatArrayError(
      value,
      path,
      methodName,
      'an array of conditional format range offsets',
      'CF_RANGE_OFFSETS_MUST_BE_ARRAY',
      'Use an array of range offset objects.',
    );
  }
}

/**
 * Flatten nested CF style `{ fill, font, border }` to the flat CFStyle the
 * Rust engine expects.  No-op when the style is already flat.
 */
function flattenStyle(style: any): any {
  if (!style || typeof style !== 'object') return style;

  const result: Record<string, any> = {};

  // Copy all scalar keys (everything except fill/font/border sub-objects).
  for (const [k, v] of Object.entries(style)) {
    if (k !== 'fill' && k !== 'font' && k !== 'border') {
      result[k] = v;
    }
  }

  // Flatten `fill` sub-object.
  if (style.fill && typeof style.fill === 'object') {
    const fill = style.fill as Record<string, any>;
    if (fill.backgroundColor != null && result.backgroundColor == null)
      result.backgroundColor = fill.backgroundColor;
    if (fill.color != null && result.backgroundColor == null) result.backgroundColor = fill.color;
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
    for (const side of ['Top', 'Bottom', 'Left', 'Right'] as const) {
      const sideKey = side.toLowerCase();
      if (border[sideKey] && typeof border[sideKey] === 'object') {
        const sideObj = border[sideKey] as Record<string, any>;
        if (sideObj.color != null && result[`border${side}Color`] == null)
          result[`border${side}Color`] = sideObj.color;
        if (sideObj.style != null && result[`border${side}Style`] == null)
          result[`border${side}Style`] = sideObj.style;
      }
    }
  }

  return result;
}

/**
 * Normalize rules for the Rust wire: flatten any nested style objects AND
 * translate color-scale / data-bar color points to the typed `CFValueRef`
 * shape via the shared `CFOps.normalizeRulesForWire` helper. The local
 * `flattenStyle` is applied first so its nested-fill/font/border handling
 * (which is richer than the shared version) still runs; the shared helper
 * is a no-op on styles that already match the flat Rust shape.
 */
function normalizeRules<T extends Record<string, any>>(rules: T[]): T[] {
  const flattened = rules.map((rule) => {
    if ('style' in rule && rule.style) {
      return { ...rule, style: flattenStyle(rule.style) };
    }
    return rule;
  }) as T[];
  return CFOps.normalizeRulesForWire(flattened);
}

export class WorksheetConditionalFormattingImpl implements WorksheetConditionalFormatting {
  constructor(
    private readonly ctx: DocumentContext,
    private readonly sheetId: SheetId,
  ) {}

  private _ensureWritable(op: string): void {
    this.ctx.writeGate.assertWritable(op);
  }

  async add(ranges: (string | CellRange)[], rules: CFRuleInput[]): Promise<ConditionalFormat> {
    this._ensureWritable('conditionalFormats.add');
    assertCfRangeArray(ranges, ['ranges'], 'conditionalFormats.add');
    assertCfRuleArray(rules, ['rules'], 'conditionalFormats.add');
    const resolved = ranges.map((r) => resolveRange(r));
    const formatId = await CFOps.addConditionalFormat(this.ctx, this.sheetId, resolved, rules);

    // Read back the full entity.
    const full = await this.get(formatId);
    if (full) return full;

    // Fallback: construct minimal entity from inputs if read-back fails.
    return {
      id: formatId,
      ranges: resolved,
      rules: rules.map((r, i) => ({ ...r, id: '', priority: i })) as CFRule[],
    };
  }

  async get(formatId: string): Promise<ConditionalFormat | null> {
    return CFOps.getConditionalFormat(this.ctx, this.sheetId, formatId);
  }

  async has(formatId: string): Promise<boolean> {
    return (await this.get(formatId)) !== null;
  }

  async getCount(): Promise<number> {
    return (await this.list()).length;
  }

  async update(formatId: string, updates: ConditionalFormatUpdate): Promise<void> {
    const { ranges, stopIfTrue, ...ruleUpdates } = updates;

    if (ranges !== undefined) {
      assertCfRangeArray(
        ranges,
        ['updates', 'ranges'],
        'conditionalFormats.update',
        'an array of CellRange objects',
        'Use [{ startRow: 0, startCol: 0, endRow: 9, endCol: 0 }].',
      );
    }
    if (ruleUpdates.rules !== undefined) {
      assertCfRuleArray(ruleUpdates.rules, ['updates', 'rules'], 'conditionalFormats.update');
    }

    // If stopIfTrue is provided, apply it to all rules in the update payload
    if (stopIfTrue !== undefined && ruleUpdates.rules) {
      ruleUpdates.rules = ruleUpdates.rules.map((r) => ({ ...r, stopIfTrue }));
    }

    // Route ranges through the dedicated updateCfRanges bridge for CRDT safety
    if (ranges) {
      await this.ctx.computeBridge.updateCfRanges(this.sheetId, formatId, ranges);
    }

    // Route rule/property updates through updateCfRule (JSON merge)
    if (ruleUpdates.rules) {
      ruleUpdates.rules = normalizeRules(ruleUpdates.rules);
      await this.ctx.computeBridge.updateCfRule(this.sheetId, formatId, ruleUpdates);
    }
  }

  async clearRuleStyle(formatId: string, ruleId: string): Promise<void> {
    const format = await CFOps.getConditionalFormat(this.ctx, this.sheetId, formatId);
    if (!format) return;

    const updatedRules = format.rules.map((rule) => {
      if (rule.id !== ruleId) return rule;
      // Reset style to empty object (all properties unset)
      if ('style' in rule) {
        return { ...rule, style: {} };
      }
      return rule;
    });

    await this.ctx.computeBridge.updateCfRule(this.sheetId, formatId, { rules: updatedRules });
  }

  async changeRuleType(formatId: string, ruleId: string, newRule: CFRuleInput): Promise<void> {
    const format = await CFOps.getConditionalFormat(this.ctx, this.sheetId, formatId);
    if (!format) return;

    const updatedRules = format.rules.map((rule) => {
      if (rule.id !== ruleId) return rule;
      return { ...newRule, id: rule.id, priority: rule.priority };
    });

    await this.ctx.computeBridge.updateCfRule(this.sheetId, formatId, {
      rules: normalizeRules(updatedRules),
    });
  }

  async getItemAt(index: number): Promise<ConditionalFormat | null> {
    const all = await this.list();
    return all[index] ?? null;
  }

  async remove(formatId: string): Promise<void> {
    await this.ctx.computeBridge.deleteCfRule(this.sheetId, formatId);
  }

  async removeRule(formatId: string, ruleId: string): Promise<void> {
    await this.ctx.computeBridge.deleteRuleFromCf(this.sheetId, formatId, ruleId);
  }

  async list(): Promise<ConditionalFormat[]> {
    return CFOps.getConditionalFormats(this.ctx, this.sheetId);
  }

  async clear(): Promise<void> {
    return CFOps.clearAllConditionalFormats(this.ctx, this.sheetId);
  }

  async clearInRanges(ranges: (string | CellRange)[]): Promise<void> {
    assertCfRangeArray(ranges, ['ranges'], 'conditionalFormats.clearInRanges');
    const resolved = ranges.map((r) => resolveRange(r));
    await CFOps.clearCFRulesInRanges(this.ctx, this.sheetId, resolved);
  }

  async reorder(formatIds: string[]): Promise<void> {
    await this.ctx.computeBridge.reorderCfRules(this.sheetId, formatIds);
  }

  async cloneForPaste(
    sourceSheetId: SheetId,
    relativeCFs: Array<{
      rules: any[];
      rangeOffsets: Array<{
        startRowOffset: number;
        startColOffset: number;
        endRowOffset: number;
        endColOffset: number;
      }>;
    }>,
    origin: { row: number; col: number },
    isCut: boolean,
  ): Promise<void> {
    assertCfRelativeFormatArray(relativeCFs, ['relativeCFs'], 'conditionalFormats.cloneForPaste');
    relativeCFs.forEach((cf, index) => {
      assertCfRuleArray(
        cf?.rules,
        ['relativeCFs', String(index), 'rules'],
        'conditionalFormats.cloneForPaste',
      );
      assertCfRangeOffsetArray(
        cf?.rangeOffsets,
        ['relativeCFs', String(index), 'rangeOffsets'],
        'conditionalFormats.cloneForPaste',
      );
    });
    await CFOps.cloneConditionalFormatsForPaste(
      this.ctx,
      sourceSheetId,
      this.sheetId,
      relativeCFs,
      origin,
      isCut,
    );
  }
}
