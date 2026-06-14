/**
 * WorksheetNamesImpl — Sheet-scoped named ranges.
 *
 * Delegates to the NamedRanges domain module with scope pre-filled to current sheet.
 */
import type {
  NamedRangeInfo,
  NamedRangeReference,
  NamedRangeUpdateOptions,
  SheetId,
  WorksheetNames,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import * as NamedRanges from '../../domain/formulas/named-ranges';
import { KernelError } from '../../errors';
import { isApiVisibleNamedRangeReference, stripFormulaPrefix } from '../named-range-visibility';

export class WorksheetNamesImpl implements WorksheetNames {
  constructor(
    private readonly ctx: DocumentContext,
    private readonly sheetId: SheetId,
  ) {}

  private _ensureWritable(op: string): void {
    this.ctx.writeGate.assertWritable(op);
  }

  private async getSheetName(): Promise<string> {
    const name = await this.ctx.computeBridge.getSheetName(this.sheetId);
    return name ?? '';
  }

  async add(name: string, reference: string, comment?: string): Promise<NamedRangeInfo> {
    this._ensureWritable('names.add');
    const refersToA1 = reference.startsWith('=') ? reference : `=${reference}`;
    await NamedRanges.create(
      this.ctx,
      { name, refersToA1, comment, scope: this.sheetId },
      this.sheetId,
      'api',
    );

    // Read back the created named range to return full info.
    const created = await this.get(name);
    if (created) return created;

    // Fallback: construct from input if read-back fails.
    const ref = reference.startsWith('=') ? reference.slice(1) : reference;
    const sheetName = await this.getSheetName();
    return { name, reference: ref, scope: sheetName, comment, visible: true };
  }

  async has(name: string): Promise<boolean> {
    return (await this.get(name)) !== null;
  }

  async getCount(): Promise<number> {
    return (await this.list()).length;
  }

  async get(name: string): Promise<NamedRangeInfo | null> {
    const defined = await NamedRanges.getByName(this.ctx, name, this.sheetId);
    if (!defined) return null;

    const a1 = await NamedRanges.getRefersToA1(this.ctx, defined);
    const reference = stripFormulaPrefix(a1);
    const sheetName = await this.getSheetName();

    return {
      name: defined.name,
      reference,
      scope: sheetName,
      comment: defined.comment ?? undefined,
      visible: defined.visible,
    };
  }

  async getRange(name: string): Promise<NamedRangeReference | null> {
    const defined = await NamedRanges.getByName(this.ctx, name, this.sheetId);
    if (!defined) return null;

    const a1 = await NamedRanges.getRefersToA1(this.ctx, defined);
    const ref = stripFormulaPrefix(a1);
    if (!isApiVisibleNamedRangeReference(ref)) return null;
    const bangIndex = ref.indexOf('!');
    if (bangIndex === -1) {
      // No sheet prefix — use the scope's sheet name
      const sheetName = await this.getSheetName();
      return { sheetName, range: ref };
    }

    return {
      sheetName: ref.substring(0, bangIndex),
      range: ref.substring(bangIndex + 1),
    };
  }

  async remove(name: string): Promise<void> {
    const defined = await NamedRanges.getByName(this.ctx, name, this.sheetId);
    if (!defined) {
      throw new KernelError(
        'COMPUTE_ERROR',
        `Named range "${name}" not found in this sheet's scope.`,
      );
    }
    await NamedRanges.remove(this.ctx, defined.id, 'api');
  }

  async update(name: string, updates: NamedRangeUpdateOptions): Promise<void> {
    const defined = await NamedRanges.getByName(this.ctx, name, this.sheetId);
    if (!defined) {
      throw new KernelError(
        'COMPUTE_ERROR',
        `Named range "${name}" not found in this sheet's scope.`,
      );
    }

    const refersToA1 = updates.reference
      ? updates.reference.startsWith('=')
        ? updates.reference
        : `=${updates.reference}`
      : undefined;

    await NamedRanges.update(
      this.ctx,
      defined.id,
      { name: updates.name, refersToA1, comment: updates.comment, visible: updates.visible },
      this.sheetId,
    );
  }

  async clear(): Promise<void> {
    const items = await this.list();
    for (const item of items) {
      await this.remove(item.name);
    }
  }

  async list(): Promise<NamedRangeInfo[]> {
    const exported = await NamedRanges.exportNames(this.ctx);
    const sheetName = await this.getSheetName();

    return exported
      .filter((entry) => entry.scope === this.sheetId)
      .map((entry) => ({
        name: entry.name,
        reference: stripFormulaPrefix(entry.refersToA1),
        scope: sheetName,
        comment: entry.comment ?? undefined,
        visible: entry.visible,
      }));
  }
}
