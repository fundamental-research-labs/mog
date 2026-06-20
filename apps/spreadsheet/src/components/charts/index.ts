/**
 * Chart Components
 *
 * React components for chart editing, dialogs, and toolbar integration.
 *
 * NOTE: Chart rendering now happens on canvas via ChartLayer in canvas-renderer.
 * The DOM-based ChartContainer, ChartLayer, and ChartLayerContainer have been removed.
 */

// Chart types (shared between canvas renderer and hooks)
export { type ChartDefinition } from './chart-types';

// Chart editing components
export { ChartEditor, type ChartEditorProps } from './ChartEditor';
export { ChartEditorContainer } from './ChartEditorContainer';
export { ChartTitleEditor } from './ChartTitleEditor';
export { ChartToolbar, type ChartToolbarProps } from './ChartToolbar';

// New Excel 365-style chart insertion components
export {
  AREA_VARIANTS,
  BAR_VARIANTS,
  CHART_CATEGORIES,
  COLUMN_VARIANTS,
  COMBO_VARIANTS,
  LINE_VARIANTS,
  PIE_VARIANTS,
  SCATTER_VARIANTS,
  getDefaultVariant,
  getVariantById,
  type ChartCategory,
  type ChartSubType,
  type ChartVariant,
} from './chart-variants';
export { ChartGallery, type ChartGalleryProps } from './ChartGallery';
export { ChartsGroup, type ChartsGroupProps } from './ChartsGroup';
export { ChartTypeButton, type ChartTypeButtonProps } from './ChartTypeButton';
export {
  ChartTypesDropdownButton,
  type ChartTypesDropdownButtonProps,
} from './ChartTypesDropdownButton';
export { ChartVariantThumbnail, type ChartVariantThumbnailProps } from './ChartVariantThumbnail';
