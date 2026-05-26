/**
 * Equation Schema - Type Definitions Only
 *
 * Runtime schema objects, defaults, validation constants, and utility functions have been moved to:
 * @see @mog-sdk/kernel/defaults/equation
 *
 * This file retains only the type exports for the contracts layer.
 */

/**
 * Type for equation style defaults derived from schema.
 * The actual EQUATION_STYLE_SCHEMA and getEquationStyleDefaults() live in kernel.
 */
export type EquationStyleDefaults = {
  readonly fontFamily: 'Cambria Math';
  readonly fontSize: 11;
  readonly color: '#000000';
  readonly backgroundColor: 'transparent';
  readonly justification: 'center';
  readonly displayMode: true;
  readonly smallFractions: false;
};
