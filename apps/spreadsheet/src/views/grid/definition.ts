import type { ViewConfig, ViewDefinition } from '../types';
import { GridViewAdapter } from './GridViewAdapter';

export const gridViewDefinition: ViewDefinition<'grid'> = {
  type: 'grid',
  name: 'Grid',
  icon: 'grid',
  description: 'Classic spreadsheet grid view',
  requiredColumns: undefined, // Works with any data

  renderingMode: 'imperative', // Grid uses canvas rendering

  createAdapter: (config) => new GridViewAdapter(config),

  defaultConfig: {
    frozenRows: 0,
    frozenColumns: 0,
    rowHeight: 'medium',
    showRowNumbers: true,
    showGridlines: true,
  } as ViewConfig<'grid'>,
};
