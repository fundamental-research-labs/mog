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
    return this.manager.createCheckbox({ ...options, sheetId: this.sheetId });
  }

  async addComboBox(options: WorksheetCreateComboBoxOptions): Promise<ComboBoxControl> {
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

  update(controlId: string, updates: FormControlUpdate): FormControl | undefined {
    if (!this.get(controlId)) return undefined;
    this.manager.updateControl(controlId, updates);
    return this.get(controlId);
  }

  async move(
    controlId: string,
    newAnchor: FormControlAnchorUpdate,
  ): Promise<FormControl | undefined> {
    if (!this.get(controlId)) return undefined;
    await this.manager.moveControl(controlId, newAnchor);
    return this.get(controlId);
  }

  resize(controlId: string, width: number, height: number): FormControl | undefined {
    if (!this.get(controlId)) return undefined;
    this.manager.resizeControl(controlId, width, height);
    return this.get(controlId);
  }

  remove(controlId: string): boolean {
    if (!this.get(controlId)) return false;
    this.manager.deleteControl(controlId);
    return true;
  }
}
