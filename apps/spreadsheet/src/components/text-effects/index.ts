/**
 * TextEffect UI Components
 *
 * React components for TextEffect interactions.
 *
 * UI Components
 *
 * Component Exports
 * - All TextEffect components exported from this index
 * - TextEffectFormatTab re-exported from toolbar for convenience
 */

// Core TextEffect Components
export { EffectsPicker } from './EffectsPicker';
export { FillPicker, type FillPickerProps } from './FillPicker';
export { GradientEditor, type GradientEditorProps } from './GradientEditor';
export { PatternSelector, type PatternSelectorProps } from './PatternSelector';
export { TransformPicker, type TransformPickerProps } from './TransformPicker';
export { TextEffectGallery } from './TextEffectsGallery';
export { TextEffectTextEditor } from './TextEffectsTextEditor';

// Shared preset definitions
export {
  PRESET_DEFINITIONS,
  WARP_CATEGORIES,
  getPresetById,
  getPresetsByCategory,
} from './preset-definitions';

// Re-export TextEffectFormatTab from toolbar for convenience
// Note: TextEffectFormatTab is in toolbar/ as it's part of the contextual ribbon system
export { TextEffectFormatTab } from '../../chrome/toolbar/tabs/TextEffectsFormatTab';
