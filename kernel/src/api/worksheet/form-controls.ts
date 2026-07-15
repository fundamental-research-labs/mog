/**
 * WorksheetFormControlsImpl — Implementation of the WorksheetFormControls sub-API.
 *
 * Delegates to FormControlManager (document-scoped, in-memory storage).
 * Filters controls to the current sheet.
 */

import type { SheetId } from '@mog-sdk/contracts/core';
import type { WorksheetFormControls } from '@mog-sdk/contracts/api';
import type {
  CheckboxControl,
  ComboBoxControl,
  CreateCheckboxOptions,
  CreateComboBoxOptions,
  FormControl,
  IFormControlManager,
} from '@mog-sdk/contracts/form-controls';
import type { DocumentContext } from '../../context';
import { targetNotFoundError } from '../../errors';
import { assertSheetOperationAllowed, assertSheetOperationAllowedSync } from './protection-guards';

type WorksheetCreateCheckboxOptions = Omit<CreateCheckboxOptions, 'sheetId'>;
type WorksheetCreateComboBoxOptions = Omit<CreateComboBoxOptions, 'sheetId'>;
type AddCheckboxFormControlOptions = WorksheetCreateCheckboxOptions & { type: 'checkbox' };
type AddComboBoxFormControlOptions = WorksheetCreateComboBoxOptions & { type: 'comboBox' };
type AddFormControlOptions = AddCheckboxFormControlOptions | AddComboBoxFormControlOptions;
type FormControlUpdate = Partial<Omit<FormControl, 'id' | 'type' | 'sheetId'>>;
type FormControlAnchorUpdate = {
  row: number;
  col: number;
  xOffset?: number;
  yOffset?: number;
};

export class WorksheetFormControlsImpl implements WorksheetFormControls {
  constructor(
    private readonly ctx: DocumentContext,
    private readonly manager: IFormControlManager,
    private readonly sheetId: SheetId,
  ) {}

  async add(options: AddCheckboxFormControlOptions): Promise<CheckboxControl>;
  async add(options: AddComboBoxFormControlOptions): Promise<ComboBoxControl>;
  async add(options: AddFormControlOptions): Promise<CheckboxControl | ComboBoxControl>;
  async add(options: AddFormControlOptions): Promise<CheckboxControl | ComboBoxControl> {
    switch (options.type) {
      case 'checkbox': {
        const { type: _type, ...createOptions } = options;
        return this.addCheckbox(createOptions);
      }
      case 'comboBox': {
        const { type: _type, ...createOptions } = options;
        return this.addComboBox(createOptions);
      }
    }
  }

  async addCheckbox(options: WorksheetCreateCheckboxOptions): Promise<CheckboxControl> {
    await assertSheetOperationAllowed(this.ctx, this.sheetId, 'editObject');
    return this.manager.createCheckbox({ ...options, sheetId: this.sheetId });
  }

  async addComboBox(options: WorksheetCreateComboBoxOptions): Promise<ComboBoxControl> {
    await assertSheetOperationAllowed(this.ctx, this.sheetId, 'editObject');
    return this.manager.createComboBox({ ...options, sheetId: this.sheetId });
  }

  list(): FormControl[] {
    return this.manager.getControlsForSheet(this.sheetId);
  }

  get(controlId: string): FormControl | undefined {
    const control = this.manager.getControl(controlId);
    if (control && control.sheetId === this.sheetId) {
      return control;
    }
    return undefined;
  }

  getAtPosition(row: number, col: number): FormControl[] {
    return this.manager.getControlsAtPosition(this.sheetId, row, col);
  }

  private async requireControl(controlId: string, operation: string): Promise<FormControl> {
    await this.manager.hydrateControlsForSheet(this.sheetId);
    const control = this.get(controlId);
    if (!control) {
      throw targetNotFoundError({
        code: 'FORM_CONTROL_NOT_FOUND',
        resourceType: 'formControl',
        resourceId: controlId,
        operation,
        sheetId: this.sheetId,
        path: ['controlId'],
      });
    }
    return control;
  }

  async update(controlId: string, updates: FormControlUpdate): Promise<FormControl> {
    await this.requireControl(controlId, 'formControls.update');
    assertSheetOperationAllowedSync(this.ctx, this.sheetId, 'editObject');
    await this.manager.updateControl(controlId, updates);
    return this.get(controlId)!;
  }

  async move(controlId: string, newAnchor: FormControlAnchorUpdate): Promise<FormControl> {
    await this.requireControl(controlId, 'formControls.move');
    await assertSheetOperationAllowed(this.ctx, this.sheetId, 'editObject');
    await this.manager.moveControl(controlId, newAnchor);
    return this.get(controlId)!;
  }

  async resize(controlId: string, width: number, height: number): Promise<FormControl> {
    await this.requireControl(controlId, 'formControls.resize');
    assertSheetOperationAllowedSync(this.ctx, this.sheetId, 'editObject');
    await this.manager.resizeControl(controlId, width, height);
    return this.get(controlId)!;
  }

  async remove(controlId: string): Promise<boolean> {
    await this.requireControl(controlId, 'formControls.remove');
    assertSheetOperationAllowedSync(this.ctx, this.sheetId, 'editObject');
    await this.manager.deleteControl(controlId);
    return true;
  }
}
