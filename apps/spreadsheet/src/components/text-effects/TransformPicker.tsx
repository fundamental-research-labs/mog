/**
 * Transform Picker
 *
 * Panel for selecting TextEffect warp presets.
 * Shows all 35+ presets organized by category:
 * - No Transform (basic/textPlain)
 * - Follow Path (arch, circle, ring, etc.)
 * - Warp (wave, inflate, deflate, triangle, etc.)
 * - Perspective (fade, slant, cascade)
 *
 * ARCHITECTURE:
 * - This is a pure content component for use with Popover
 * - Uses useSelectedTextEffectDebounced() for displaying current preset
 * - Uses dispatch() + deps.accessors.object.getSelectedIds() for on-demand reads
 * - Follows render isolation pattern (Architecture Checklist Section 15)
 *
 * Transform Picker Panel
 */

import type { ReactElement } from 'react';
import { useCallback, useMemo } from 'react';

import type { TextWarpPreset, WarpPresetDefinition } from '@mog-sdk/contracts/text-effects';
import { dispatch } from '../../actions';
import { useSelectedTextEffectDebounced } from '../../hooks/objects/useSelectedTextEffects';
import { useActionDependencies } from '../../hooks/toolbar/use-action-dependencies';
import { getPresetsByCategory, WARP_CATEGORIES } from './preset-definitions';

// =============================================================================
// PresetButton Component
// =============================================================================

interface PresetButtonProps {
  preset: WarpPresetDefinition;
  isSelected: boolean;
  onClick: () => void;
}

/**
 * Single preset button in the grid.
 * Shows preset name and selection state.
 */
function PresetButton({ preset, isSelected, onClick }: PresetButtonProps): ReactElement {
  return (
    <button
      type="button"
      className={`
 aspect-square rounded border transition-colors
 flex items-center justify-center p-0.5
 ${
   isSelected
     ? 'border-ss-primary bg-ss-primary/10 ring-1 ring-ss-primary'
     : 'border-ss-border hover:bg-ss-surface-hover hover:border-ss-primary/50'
 }
 `}
      onClick={onClick}
      title={preset.description}
      aria-pressed={isSelected}
    >
      {/* Thumbnail preview placeholder - would render actual warp preview */}
      <span className="text-ribbon-group text-ss-text-secondary text-center leading-tight">
        {preset.name.length > 8 ? preset.name.substring(0, 7) + '...' : preset.name}
      </span>
    </button>
  );
}

// =============================================================================
// PresetCategorySection Component
// =============================================================================

interface PresetCategorySectionProps {
  title: string;
  presets: WarpPresetDefinition[];
  currentPreset: string;
  onSelect: (presetId: string) => void;
}

/**
 * Section showing presets for a single category.
 */
function PresetCategorySection({
  title,
  presets,
  currentPreset,
  onSelect,
}: PresetCategorySectionProps): ReactElement | null {
  if (presets.length === 0) {
    return null;
  }

  return (
    <div className="mb-3">
      <h4 className="text-caption text-ss-text-secondary mb-1.5 font-medium">{title}</h4>
      <div className="grid grid-cols-4 gap-1">
        {presets.map((preset) => (
          <PresetButton
            key={preset.id}
            preset={preset}
            isSelected={currentPreset === preset.id}
            onClick={() => onSelect(preset.id)}
          />
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// TransformPicker Component
// =============================================================================

export interface TransformPickerProps {
  /**
   * Optional callback when a preset is selected.
   * Used by parent components to close popover after selection.
   */
  onSelect?: () => void;
}

/**
 * Transform Picker panel for selecting TextEffect warp presets.
 *
 * This component is designed to be used as content within a Popover.
 * It displays all warp presets organized by category and handles
 * preset selection via the dispatch pattern.
 *
 * Usage with Popover:
 * ```tsx
 * <Popover open={isOpen} onOpenChange={setIsOpen}>
 * <PopoverTrigger asChild>
 * <RibbonButton label="Transform" />
 * </PopoverTrigger>
 * <PopoverContent>
 * <TransformPicker onSelect={ => setIsOpen(false)} />
 * </PopoverContent>
 * </Popover>
 * ```
 */
export function TransformPicker({ onSelect }: TransformPickerProps): ReactElement {
  const deps = useActionDependencies();

  // Use debounced selection for display (prevents re-renders during drag)
  const selectedTextEffect = useSelectedTextEffectDebounced();

  // Memoize presets by category
  const presetsByCategory = useMemo(() => {
    return {
      basic: getPresetsByCategory('basic'),
      'follow-path': getPresetsByCategory('follow-path'),
      warp: getPresetsByCategory('warp'),
      perspective: getPresetsByCategory('perspective'),
    };
  }, []);

  // Get current preset from selected TextEffect (debounced for display)
  const currentPreset = selectedTextEffect?.textEffects?.warpPreset ?? 'textPlain';

  /**
   * Handle preset selection.
   * Reads current selection on-demand via deps.accessors (not from debounced hook).
   */
  const handleSelect = useCallback(
    (presetId: string) => {
      // Read current selection on-demand via deps.accessors
      const selectedIds = deps.accessors.object.getSelectedIds();
      if (selectedIds.length !== 1) {
        return;
      }

      const objectId = selectedIds[0];

      // Dispatch the action to update the warp preset
      dispatch('UPDATE_TEXT_EFFECT_WARP', deps, {
        objectId,
        warpPreset: presetId as TextWarpPreset,
      });

      // Notify parent to close popover
      onSelect?.();
    },
    [deps, onSelect],
  );

  return (
    <div className="p-3 w-72 bg-ss-surface">
      <h3 className="text-body-sm font-medium text-ss-text mb-3">Transform</h3>

      {/* No Transform Option (Basic/Plain) */}
      <div className="mb-3">
        <button
          type="button"
          className={`
 w-full px-3 py-2 text-left text-body-sm rounded border transition-colors
 ${
   currentPreset === 'textPlain'
     ? 'border-ss-primary bg-ss-primary/10 text-ss-primary'
     : 'border-ss-border hover:bg-ss-surface-hover'
 }
 `}
          onClick={() => handleSelect('textPlain')}
          aria-pressed={currentPreset === 'textPlain'}
        >
          No Transform
        </button>
      </div>

      {/* Category Sections */}
      {WARP_CATEGORIES.filter((cat) => cat.id !== 'basic').map((category) => (
        <PresetCategorySection
          key={category.id}
          title={category.label}
          presets={presetsByCategory[category.id]}
          currentPreset={currentPreset}
          onSelect={handleSelect}
        />
      ))}
    </div>
  );
}
