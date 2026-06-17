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
  NameClearReceipt,
  NameReceiptItem,
  NamedItemType,
  NamedRangeInfo,
  NamedRangeReference,
  NamedRangeUpdateOptions,
  NameRemoveReceipt,
  NameUpdateReceipt,
  OperationEffect,
  WorkbookNames,
} from '@mog-sdk/contracts/api';
import { RangeValueType } from '@mog-sdk/contracts/api';
import { type SheetId, sheetId } from '@mog-sdk/contracts/core';
import { KernelError } from '../../errors';

import type { DocumentContext } from '../../context';
import * as NamedRanges from '../../domain/formulas/named-ranges';
import { createSheetNotFoundError } from '../internal/sheet-lookup-diagnostics';
import { validateName } from '@mog/spreadsheet-utils/data/named-ranges';
import { isApiVisibleNamedRangeReference, stripFormulaPrefix } from '../named-range-visibility';

type DefinedName = NonNullable<Awaited<ReturnType<typeof NamedRanges.getByName>>>;

function nameEffectDetails(item: NameReceiptItem, action: string): Record<string, unknown> {
  return {
    objectType: 'definedName',
    action,
    name: item.name,
    scope: item.scope ?? 'workbook',
    scopeSheetId: item.scopeSheetId,
  };
}

function nameObjectEffect(
  type: 'createdObject' | 'updatedObject' | 'removedObject',
  item: NameReceiptItem,
  action: string,
): OperationEffect {
  let effect: OperationEffect = {
    type,
    objectId: item.id,
    details: nameEffectDetails(item, action),
  };
  if (item.scopeSheetId) effect = { ...effect, sheetId: item.scopeSheetId };
  if (isApiVisibleNamedRangeReference(item.reference)) {
    effect = { ...effect, range: item.reference };
  }
  return effect;
}

function nameRangeEffect(item: NameReceiptItem, action: string): OperationEffect | null {
  if (!isApiVisibleNamedRangeReference(item.reference)) return null;
  let effect: OperationEffect = {
    type: 'changedRange',
    range: item.reference,
    details: nameEffectDetails(item, action),
  };
  if (item.scopeSheetId) effect = { ...effect, sheetId: item.scopeSheetId };
  return effect;
}

function nameWorksheetUnchangedEffect(item?: NameReceiptItem): OperationEffect {
  let effect: OperationEffect = {
    type: 'worksheetUnchanged',
    details: item ? nameEffectDetails(item, 'noOp') : { objectType: 'definedName' },
  };
  if (item?.scopeSheetId) effect = { ...effect, sheetId: item.scopeSheetId };
  return effect;
}

function compactEffects(effects: readonly (OperationEffect | null)[]): OperationEffect[] {
  return effects.filter((effect): effect is OperationEffect => effect !== null);
}

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
  /** Get all known sheet names in display order. ASYNC — reads from Rust. */
  getKnownSheetNames: () => Promise<string[]>;
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
    throw createSheetNotFoundError({
      target: scope,
      knownSheetNames: await this.deps.getKnownSheetNames(),
      context: {
        lookupKind: 'namedRangeScope',
      },
    });
  }

  private async _getName(
    name: string,
    scope?: string,
  ): Promise<{
    defined: DefinedName;
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

  private async _toReceiptItem(defined: DefinedName): Promise<NameReceiptItem> {
    const reference = stripFormulaPrefix(await NamedRanges.getRefersToA1(this.deps.ctx, defined));
    const item: NameReceiptItem = {
      id: defined.id,
      name: defined.name,
      reference,
    };
    let result = item;
    if (defined.scope) {
      result = {
        ...result,
        scopeSheetId: defined.scope,
      };
      const scope = await this.deps.getSheetName(defined.scope);
      if (scope) result = { ...result, scope };
    }
    if (defined.comment !== undefined) result = { ...result, comment: defined.comment };
    if (defined.visible !== undefined) result = { ...result, visible: defined.visible };
    return result;
  }

  private nameAddReceipt(created: NameReceiptItem, reference: string): NameAddReceipt {
    return {
      kind: 'nameAdd',
      status: 'applied',
      effects: compactEffects([
        nameObjectEffect('createdObject', created, 'add'),
        nameRangeEffect(created, 'name.add'),
      ]),
      diagnostics: [],
      name: created.name,
      reference,
      created,
    };
  }

  private nameRemoveReceipt(removed: NameReceiptItem): NameRemoveReceipt {
    return {
      kind: 'nameRemove',
      status: 'applied',
      effects: compactEffects([
        nameObjectEffect('removedObject', removed, 'remove'),
        nameRangeEffect(removed, 'name.remove'),
      ]),
      diagnostics: [],
      name: removed.name,
      removed,
    };
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
    const created = await NamedRanges.getByName(ctx, name, scopeSheetId);
    if (!created) {
      throw new KernelError(
        'DOMAIN_DEFINED_NAME_NOT_FOUND',
        `Created named range "${name}" could not be read back.`,
      );
    }

    return this.nameAddReceipt(await this._toReceiptItem(created), reference);
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
    this._ensureWritable('names.remove');
    const { ctx } = this.deps;

    const scopeSheetId = await this._resolveScope(scope);

    const defined = await NamedRanges.getByName(ctx, name, scopeSheetId);
    if (!defined) {
      throw new KernelError('COMPUTE_ERROR', `Named range "${name}" not found.`);
    }

    const removed = await this._toReceiptItem(defined);
    await NamedRanges.remove(ctx, defined.id, 'api');
    return this.nameRemoveReceipt(removed);
  }

  async removeById(id: string): Promise<NameRemoveReceipt> {
    this._ensureWritable('names.removeById');
    const { ctx } = this.deps;
    const defined = await NamedRanges.getById(ctx, id);
    if (!defined) {
      throw new KernelError('COMPUTE_ERROR', `Named range with ID "${id}" not found.`);
    }

    const removed = await this._toReceiptItem(defined);
    await NamedRanges.remove(ctx, defined.id, 'api');
    return this.nameRemoveReceipt(removed);
  }

  async update(
    name: string,
    updates: NamedRangeUpdateOptions,
    scope?: string,
  ): Promise<NameUpdateReceipt> {
    this._ensureWritable('names.update');
    const { ctx, getActiveSheetId } = this.deps;
    const contextSheet = getActiveSheetId();
    const scopeSheetId = await this._resolveScope(scope);

    // Resolve name to internal ID — NamedRanges.update() expects an ID, not a name
    const defined = await NamedRanges.getByName(ctx, name, scopeSheetId);
    if (!defined) {
      throw new KernelError('COMPUTE_ERROR', `Named range "${name}" not found.`);
    }

    const previous = await this._toReceiptItem(defined);
    const hasUpdates =
      updates.name !== undefined ||
      updates.reference !== undefined ||
      updates.comment !== undefined ||
      updates.visible !== undefined;
    if (!hasUpdates) {
      return {
        kind: 'nameUpdate',
        status: 'noOp',
        effects: [nameWorksheetUnchangedEffect(previous)],
        diagnostics: [],
        name,
        previous,
        updated: previous,
      };
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
    const updatedDefined =
      (await NamedRanges.getById(ctx, defined.id)) ??
      (updates.name ? await NamedRanges.getByName(ctx, updates.name, scopeSheetId) : undefined);
    if (!updatedDefined) {
      throw new KernelError(
        'DOMAIN_DEFINED_NAME_NOT_FOUND',
        `Updated named range "${name}" could not be read back.`,
      );
    }
    const updated = await this._toReceiptItem(updatedDefined);
    return {
      kind: 'nameUpdate',
      status: 'applied',
      effects: compactEffects([
        {
          ...nameObjectEffect('updatedObject', updated, 'update'),
          details: {
            ...nameEffectDetails(updated, 'update'),
            previousName: previous.name,
            previousReference: previous.reference,
          },
        },
        nameRangeEffect(updated, 'name.update'),
      ]),
      diagnostics: [],
      name,
      previous,
      updated,
    };
  }

  async clear(): Promise<NameClearReceipt> {
    this._ensureWritable('names.clear');
    const items = await this.list();
    const removed: NameReceiptItem[] = [];
    for (const item of items) {
      removed.push((await this.remove(item.name, item.scope)).removed);
    }
    if (removed.length === 0) {
      return {
        kind: 'nameClear',
        status: 'noOp',
        effects: [nameWorksheetUnchangedEffect()],
        diagnostics: [],
        removed,
        removedCount: 0,
      };
    }

    return {
      kind: 'nameClear',
      status: 'applied',
      effects: compactEffects([
        {
          type: 'removedObject',
          count: removed.length,
          details: { objectType: 'definedName', action: 'clear' },
        },
        ...removed.map((item) => nameRangeEffect(item, 'name.clear')),
      ]),
      diagnostics: [],
      removed,
      removedCount: removed.length,
    };
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
