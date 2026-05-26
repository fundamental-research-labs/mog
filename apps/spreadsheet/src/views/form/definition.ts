/**
 * Form View Definition
 *
 * Registers the Form view type with the view registry.
 */

import type { ViewConfig, ViewDefinition } from '../types';
import { FormViewAdapter } from './FormViewAdapter';
import { FormViewContainer } from './FormViewContainer';
import { DEFAULT_FORM_CONFIG } from './config';

/**
 * Form view definition for registration in ViewRegistry.
 */
export const formViewDefinition: ViewDefinition<'form'> = {
  type: 'form',
  name: 'Form',
  icon: 'form',
  description: 'Data entry form for creating and editing records',
  requiredColumns: undefined, // Works with any columns

  renderingMode: 'react',
  component: FormViewContainer,

  createAdapter: (config) => new FormViewAdapter(config),

  defaultConfig: {
    ...DEFAULT_FORM_CONFIG,
  } as ViewConfig<'form'>,
};
