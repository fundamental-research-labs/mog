/**
 * WorkbookNamesImpl — Implementation of the WorkbookNames sub-API.
 *
 * Delegates to the NamedRanges domain module for actual operations.
 * Dependencies are injected from WorkbookImpl to avoid exposing internals.
 *
 * No JS-side sheet cache — all metadata reads go through Rust (single source of truth).
 */
import type {
  CellRange,
  CellValue,
  CreateNamesFromSelectionOptions,
  CreateNamesResult,
  NameAddReceipt,
  NamedItemType,
  NamedRangeInfo,
  NamedRangeReference,
  NamedRangeUpdateOptions,
  NameRemoveReceipt,
  WorkbookNames,
} from '@mog-sdk/contracts/api';
import { RangeValueType } from '@mog-sdk/contracts/api';
import { type SheetId, sheetId } from '@mog-sdk/contracts/core';
import { KernelError } from '../../errors';

import type { DocumentContext } from '../../context';
import * as NamedRanges from '../../domain/formulas/named-ranges';
import { validateName } from '@mog/spreadsheet-utils/data/named-ranges';
import { isApiVisibleNamedRangeReference, stripFormulaPrefix } from '../named-range-visibility';

/**
 * Dependencies injected from WorkbookImpl.
 */
export interface WorkbookNamesDeps {
  ctx: DocumentContext;
  /** Get the currently active sheet ID. */
  getActiveSheetId: () => SheetId;
  /** Resolve a sheet name (lowercase) to its ID. ASYNC — reads from Rust. */
  resolveSheetNameToId: (nameLower: string) => Promise<SheetId | undefined>;
  /** Get sheet name by sheetId. ASYNC — reads from Rust. */
  getSheetName: (sheetId: SheetId) => Promise<string | undefined>;
}

export class WorkbookNamesImpl implements WorkbookNames {
  constructor(private readonly deps: WorkbookNamesDeps) {}

  private _ensureWritable(op: string): void {
    this.deps.ctx.writeGate.assertWritable(op);
  }

  /**
   * Resolve an optional sheet-name scope to a SheetId.
   * Returns undefined when scope is omitted; throws when the name doesn't match any sheet.
   */
  private async _resolveScope(scope?: string): Promise<SheetId | undefined> {
    if (!scope) return undefined;
    const resolved = await this.deps.resolveSheetNameToId(scope.toLowerCase());
    if (resolved) return resolved;
    throw new KernelError('API_SHEET_NOT_FOUND', `Sheet not found: ${scope}`, {
      context: { target: scope },
    });
  }

  private async _getName(
    name: string,
    scope?: string,
  ): Promise<{
    defined: NonNullable<Awaited<ReturnType<typeof NamedRanges.getByName>>>;
    reference: string;
    scopeSheetId: SheetId | undefined;
  } | null> {
    const scopeSheetId = await this._resolveScope(scope);
    const defined = await NamedRanges.getByName(this.deps.ctx, name, scopeSheetId);
    if (!defined) return null;

    const a1 = await NamedRanges.getRefersToA1(this.deps.ctx, defined);
    const reference = stripFormulaPrefix(a1);

    return { defined, reference, scopeSheetId };
  }

  async add(
    name: string,
    reference: string,
    comment?: string,
    scope?: string,
  ): Promise<NameAddReceipt> {
    this._ensureWritable('names.add');
    const { ctx, getActiveSheetId } = this.deps;
    const scopeSheetId = await this._resolveScope(scope);

    // Validate name format (syntax, reserved words, cell-reference collisions)
    const validation = validateName(name, new Set(), scopeSheetId);
    if (!validation.valid) {
      throw new KernelError('COMPUTE_ERROR', validation.message ?? 'Invalid named range name.');
    }

    // Check for duplicates
    const existing = await NamedRanges.getByName(ctx, name, scopeSheetId);
    if (existing) {
      throw new KernelError(
        'COMPUTE_ERROR',
        `Named range "${name}" already exists. Remove it first with names.remove("${name}").`,
      );
    }

    // Ensure reference starts with = for IdentityFormula conversion
    const refersToA1 = reference.startsWith('=') ? reference : `=${reference}`;
    const contextSheet = getActiveSheetId();

    await NamedRanges.create(
      ctx,
      { name, refersToA1, comment, scope: scopeSheetId },
      contextSheet,
      'api',
    );
    return { kind: 'nameAdd', name, reference };
  }

  async has(name: string, scope?: string): Promise<boolean> {
    return (await this.get(name, scope)) !== null;
  }

  async getCount(): Promise<number> {
    return (await this.list()).length;
  }

  async get(name: string, scope?: string): Promise<NamedRangeInfo | null> {
    const { getSheetName } = this.deps;
    const item = await this._getName(name, scope);
    if (!item) return null;

    // Resolve scope sheetId to sheet name
    let scopeName: string | undefined;
    if (item.defined.scope) {
      scopeName = (await getSheetName(item.defined.scope)) ?? undefined;
    }

    return {
      name: item.defined.name,
      reference: item.reference,
      scope: scopeName,
      comment: item.defined.comment ?? undefined,
      visible: item.defined.visible,
    };
  }

  async getRange(name: string, scope?: string): Promise<NamedRangeReference | null> {
    const item = await this._getName(name, scope);
    if (!item) return null;
    const ref = item.reference;
    if (!isApiVisibleNamedRangeReference(ref)) return null;

    // Parse sheet!range format
    const bangIndex = ref.indexOf('!');
    if (bangIndex === -1) {
      // No sheet prefix — try to infer from the named range's scope
      if (item.defined.scope) {
        const scopeSheetName = await this.deps.getSheetName(item.defined.scope);
        if (scopeSheetName) {
          return { sheetName: scopeSheetName, range: ref };
        }
      }
      return null;
    }

    const sheetName = ref.substring(0, bangIndex);
    const range = ref.substring(bangIndex + 1);

    return { sheetName, range };
  }

  async remove(name: string, scope?: string): Promise<NameRemoveReceipt> {
    const { ctx } = this.deps;

    const scopeSheetId = await this._resolveScope(scope);

    const defined = await NamedRanges.getByName(ctx, name, scopeSheetId);
    if (!defined) {
      throw new KernelError('COMPUTE_ERROR', `Named range "${name}" not found.`);
    }

    await NamedRanges.remove(ctx, defined.id, 'api');
    return { kind: 'nameRemove', name };
  }

  async update(name: string, updates: NamedRangeUpdateOptions, scope?: string): Promise<void> {
    const { ctx, getActiveSheetId } = this.deps;
    const contextSheet = getActiveSheetId();
    const scopeSheetId = await this._resolveScope(scope);

    // Resolve name to internal ID — NamedRanges.update() expects an ID, not a name
    const defined = await NamedRanges.getByName(ctx, name, scopeSheetId);
    if (!defined) {
      throw new KernelError('COMPUTE_ERROR', `Named range "${name}" not found.`);
    }

    // Ensure reference starts with = for IdentityFormula conversion (same as add)
    const refersToA1 = updates.reference
      ? updates.reference.startsWith('=')
        ? updates.reference
        : `=${updates.reference}`
      : undefined;

    // Rust's `mutation_named_range_update` performs the rename atomically
    // with the formula-text rewrite (`update_formula_templates_on_named_range_rename`
    // + `update_mirror_formulas_on_named_range_rename`). The kernel must not
    // duplicate that scan in TS.
    await NamedRanges.update(
      ctx,
      defined.id,
      {
        name: updates.name,
        refersToA1,
        comment: updates.comment,
        visible: updates.visible,
      },
      contextSheet,
    );
  }

  async clear(): Promise<void> {
    const items = await this.list();
    for (const item of items) {
      await this.remove(item.name, item.scope);
    }
  }

  async list(): Promise<NamedRangeInfo[]> {
    const { ctx, getSheetName } = this.deps;
    const exported = await NamedRanges.exportNames(ctx);
    const results: NamedRangeInfo[] = [];

    for (const entry of exported) {
      const ref = stripFormulaPrefix(entry.refersToA1);

      // Resolve scope sheetId to sheet name via Rust
      let scopeName: string | undefined;
      if (entry.scope) {
        scopeName = (await getSheetName(entry.scope)) ?? undefined;
      }

      results.push({
        name: entry.name,
        reference: ref,
        scope: scopeName,
        comment: entry.comment ?? undefined,
        visible: entry.visible,
      });
    }

    return results;
  }

  async createFromSelection(
    sheet: string | SheetId,
    range: CellRange,
    options: CreateNamesFromSelectionOptions,
  ): Promise<CreateNamesResult> {
    // Resolve sheet name to SheetId when a plain string is provided.
    // Since SheetId is a branded string, we try name resolution first;
    // if it fails we assume the caller passed a SheetId directly.
    let resolvedId: SheetId;
    const nameMatch = await this.deps.resolveSheetNameToId(sheet.toLowerCase());
    if (nameMatch) {
      resolvedId = nameMatch;
    } else {
      // Treat as raw SheetId (branded string passthrough — public-API entry brand).
      resolvedId = sheetId(sheet);
    }

    const domainOptions: NamedRanges.CreateFromSelectionOptions = {
      topRow: options.top ?? false,
      leftColumn: options.left ?? false,
      bottomRow: options.bottom ?? false,
      rightColumn: options.right ?? false,
    };

    const result = await NamedRanges.createFromSelection(
      this.deps.ctx,
      resolvedId,
      range,
      domainOptions,
    );

    return {
      success: result.success,
      skipped: result.skipped,
    };
  }

  async getValue(name: string, scope?: string): Promise<string | null> {
    const { ctx } = this.deps;
    const item = await this._getName(name, scope);
    if (!item) return null;
    const currentSheet = item.scopeSheetId ?? null;
    return ctx.computeBridge.getNamedRangeDisplayValue(name, currentSheet);
  }

  async getType(name: string, scope?: string): Promise<NamedItemType | null> {
    const { ctx } = this.deps;
    const item = await this._getName(name, scope);
    if (!item) return null;
    const currentSheet = item.scopeSheetId ?? null;
    const type = await ctx.computeBridge.getNamedRangeType(name, currentSheet);
    return type as NamedItemType | null;
  }

  async getArrayValues(name: string, scope?: string): Promise<CellValue[][] | null> {
    const { ctx } = this.deps;
    const item = await this._getName(name, scope);
    if (!item) return null;
    const currentSheet = item.scopeSheetId ?? null;
    return ctx.computeBridge.getNamedRangeArrayValues(name, currentSheet);
  }

  async getArrayTypes(name: string, scope?: string): Promise<RangeValueType[][] | null> {
    const { ctx } = this.deps;
    const item = await this._getName(name, scope);
    if (!item) return null;
    const currentSheet = item.scopeSheetId ?? null;
    const values = await ctx.computeBridge.getNamedRangeArrayValues(name, currentSheet);
    if (!values) return null;

    return values.map((row) =>
      row.map((cell): RangeValueType => {
        if (cell === null || cell === undefined) return RangeValueType.Empty;
        if (typeof cell === 'boolean') return RangeValueType.Boolean;
        if (typeof cell === 'number') return RangeValueType.Double;
        if (typeof cell === 'string') return RangeValueType.String;
        // Error objects come through as { type: 'error', value: '...' }
        if (typeof cell === 'object' && cell !== null && 'type' in cell)
          return RangeValueType.Error;
        return RangeValueType.String;
      }),
    );
  }

  async getValueAsJson(name: string, scope?: string): Promise<CellValue | null> {
    const { ctx } = this.deps;
    const item = await this._getName(name, scope);
    if (!item) return null;
    const currentSheet = item.scopeSheetId ?? null;
    return ctx.computeBridge.getNamedRangeTypedValue(name, currentSheet);
  }

  recalculateDependents(_name: string, _sheetId: SheetId, _origin: string = 'user'): void {
    // No-op: all recalculation handled by Rust compute-core
  }
}
