/**
 * Form View
 *
 * Data entry form for creating and editing records.
 */

// Configuration
export { DEFAULT_FORM_CONFIG, createFormConfig } from './config';
export type { FormFieldConfig, FormLayout, FormViewConfig } from './config';

// Adapter
export { FormViewAdapter } from './FormViewAdapter';
export type { FormFieldState, FormSelection } from './FormViewAdapter';

// Definition
export { formViewDefinition } from './definition';

// Components
export * from './components';
export { FormView } from './FormView';
export type { FormViewAdapterLike, FormViewProps } from './FormView';
export { FormViewContainer } from './FormViewContainer';
export type { FormViewContainerProps } from './FormViewContainer';

// Hooks
export * from './hooks';

// Utils
export * from './utils';
