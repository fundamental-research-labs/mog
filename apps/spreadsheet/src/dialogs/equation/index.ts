/**
 * Equation Dialog Components
 *
 * Barrel export for equation editor dialog and related components.
 *
 */

// Main dialog component
export { EquationEditorDialog } from './EquationEditorDialog';
export type { EquationEditorDialogProps } from './EquationEditorDialog';

// Preview component
export { EquationPreview, EquationPreviewSmall } from './EquationPreview';
export type { EquationPreviewProps, EquationPreviewSmallProps } from './EquationPreview';

// Template gallery
export { EquationTemplateGallery } from './EquationTemplateGallery';
export type { EquationTemplateGalleryProps } from './EquationTemplateGallery';

// Template data and utilities
export {
  ALL_EQUATION_TEMPLATES,
  CATEGORY_DISPLAY_NAMES,
  EQUATION_TEMPLATES_BY_CATEGORY,
  getRecentTemplates,
  getTemplateById,
  getTemplatesForCategory,
} from './equation-templates';
