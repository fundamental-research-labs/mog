/**
 * Kanban View Definition
 *
 * Defines the Kanban view type for the ViewRegistry.
 * This is used to register Kanban as an available view type.
 */

import type { ViewAdapter, ViewAdapterConfig, ViewDefinition } from '../types';
import type { KanbanViewConfig } from './config';
import { DEFAULT_KANBAN_CONFIG } from './config';
import { KanbanViewAdapter } from './KanbanViewAdapter';
import { KanbanViewContainer } from './KanbanViewContainer';

/**
 * Kanban view definition for the ViewRegistry.
 */
export const kanbanViewDefinition: ViewDefinition<'kanban'> = {
  type: 'kanban',
  name: 'Kanban',
  icon: 'kanban', // Icon identifier from icon library
  description: 'Display records as cards grouped by status column',

  // Kanban requires a select column for grouping
  requiredColumns: ['select'],

  /**
   * How this view is rendered.
   * 'react' mode renders directly in the React tree via KanbanViewContainer.
   */
  renderingMode: 'react' as const,

  /**
   * React component for direct rendering in the React tree.
   */
  component: KanbanViewContainer,

  /**
   * Create a new Kanban view adapter instance.
   * Still used for clipboard, toolbar, and keyboard contracts in react mode.
   */
  createAdapter(config: ViewAdapterConfig<'kanban'>): ViewAdapter {
    const kanbanConfig = config.config as KanbanViewConfig;

    return new KanbanViewAdapter({
      viewId: config.viewId,
      tableId: config.tableId!,
      config: kanbanConfig,
      workbook: config.workbook,
    });
  },

  /**
   * Default configuration for new Kanban views.
   */
  defaultConfig: DEFAULT_KANBAN_CONFIG as Partial<KanbanViewConfig>,
};
