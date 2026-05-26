/**
 * WorksheetFormControls — Sub-API for form controls (Checkbox, Button, ComboBox).
 *
 * Read-only access to form controls for a sheet. Controls are document-scoped
 * (managed by FormControlManager on the Workbook), but this sub-API filters
 * to the current sheet.
 *
 * Values live in linked cells (accessed via worksheet.getCell/setCell),
 * NOT on the controls themselves.
 *
 * @see contracts/src/editor/form-controls.ts — Type definitions
 */

import type {
  CheckboxControl,
  ComboBoxControl,
  CreateCheckboxOptions,
  CreateComboBoxOptions,
  FormControl,
} from '@mog/types-editor/editor/form-controls';

export type WorksheetCreateCheckboxOptions = Omit<CreateCheckboxOptions, 'sheetId'>;
export type WorksheetCreateComboBoxOptions = Omit<CreateComboBoxOptions, 'sheetId'>;

export type AddCheckboxFormControlOptions = WorksheetCreateCheckboxOptions & {
  type: 'checkbox';
};
export type AddComboBoxFormControlOptions = WorksheetCreateComboBoxOptions & {
  type: 'comboBox';
};
export type AddFormControlOptions = AddCheckboxFormControlOptions | AddComboBoxFormControlOptions;

export type FormControlUpdate = Partial<Omit<FormControl, 'id' | 'type' | 'sheetId'>>;
export type FormControlAnchorUpdate = {
  row: number;
  col: number;
  xOffset?: number;
  yOffset?: number;
};

/**
 * Form controls sub-API.
 *
 * Values live in linked cells. Creation/update calls mutate the production
 * FormControlManager for the workbook and use this worksheet as the sheet
 * scope.
 */
export interface WorksheetFormControls {
  /** Add a checkbox or comboBox form control on this sheet. */
  add(options: AddCheckboxFormControlOptions): Promise<CheckboxControl>;
  add(options: AddComboBoxFormControlOptions): Promise<ComboBoxControl>;
  add(options: AddFormControlOptions): Promise<CheckboxControl | ComboBoxControl>;

  /** Add a checkbox form control on this sheet. */
  addCheckbox(options: WorksheetCreateCheckboxOptions): Promise<CheckboxControl>;

  /** Add a comboBox form control on this sheet. */
  addComboBox(options: WorksheetCreateComboBoxOptions): Promise<ComboBoxControl>;

  /** Get all form controls on this sheet. */
  list(): FormControl[];

  /** Get a specific form control by ID. Returns undefined if not found or not on this sheet. */
  get(controlId: string): FormControl | undefined;

  /** Get form controls at a specific cell position (for hit testing). */
  getAtPosition(row: number, col: number): FormControl[];

  /** Update a control on this sheet. Returns undefined if the control is absent or on another sheet. */
  update(controlId: string, updates: FormControlUpdate): FormControl | undefined;

  /** Move a control on this sheet to a new anchor cell. */
  move(controlId: string, newAnchor: FormControlAnchorUpdate): Promise<FormControl | undefined>;

  /** Resize a control on this sheet. */
  resize(controlId: string, width: number, height: number): FormControl | undefined;

  /** Remove a control from this sheet. Returns true when a control was removed. */
  remove(controlId: string): boolean;
}
