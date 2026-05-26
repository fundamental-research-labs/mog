/**
 * Form Controls Domain Module
 *
 * Provides CRUD operations for interactive form controls (Checkbox, Button, ComboBox)
 * that overlay the cell grid and read/write values from linked cells.
 *
 * The linked cell is the SINGLE SOURCE OF TRUTH for control values.
 * Controls read from the cell at render time and write to the cell on interaction.
 *
 * @see contracts/src/editor/form-controls.ts - Type contracts
 */

export { FormControlManager, generateFormControlId } from './form-control-manager';
