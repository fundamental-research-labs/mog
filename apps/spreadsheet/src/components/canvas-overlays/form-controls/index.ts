/**
 * Form Control Overlays
 *
 * Interactive HTML overlay components for form controls (Checkbox, Button, ComboBox).
 * These render on top of the spreadsheet canvas as DOM elements, providing
 * native accessibility, keyboard navigation, and proper interaction handling.
 *
 * Architecture:
 * - FormControlLayerContainer: Data fetching, position resolution, scroll sync
 * - FormControlLayer: Renders controls in document space
 * - Individual controls: CheckboxOverlayControl, ButtonOverlayControl, ComboBoxOverlayControl
 *
 * The linked cell is the SINGLE SOURCE OF TRUTH for all control values.
 *
 * @see contracts/src/editor/form-controls.ts - Type contracts
 * @see kernel/src/domain/form-controls/ - FormControlManager
 * @module components/canvas-overlays/form-controls
 */

// Container (handles data, positioning, scroll sync)
export { FormControlLayerContainer } from './FormControlLayerContainer';

// Layer (renders all controls)
export { FormControlLayer } from './FormControlLayer';
export type { FormControlLayerProps, ResolvedFormControl } from './FormControlLayer';

// Individual control overlays
export { CheckboxOverlayControl } from './CheckboxOverlayControl';
export type { CheckboxOverlayControlProps } from './CheckboxOverlayControl';

export { ButtonOverlayControl } from './ButtonOverlayControl';
export type { ButtonOverlayControlProps } from './ButtonOverlayControl';

export { ComboBoxOverlayControl } from './ComboBoxOverlayControl';
export type { ComboBoxOverlayControlProps } from './ComboBoxOverlayControl';
