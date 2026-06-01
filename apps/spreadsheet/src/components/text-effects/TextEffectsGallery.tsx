/**
 * TextEffect Gallery
 *
 * Gallery component for selecting and inserting TextEffect.
 * Shows all warp presets organized by category with thumbnails.
 *
 * ARCHITECTURE:
 * - Uses dispatch() for all state mutations (render isolation pattern)
 * - Uses useUIStore() for reading gallery state
 * - Follows design token patterns (ss-* classes)
 *
 * TextEffect Gallery Component
 */

import type { ReactElement } from 'react';
import { useCallback, useMemo, useState } from 'react';

import { renderDrawingObjectToSVG } from '@mog/drawing-engine';
import type {
  TextWarpPreset,
  WarpCategory,
  WarpPresetDefinition,
} from '@mog-sdk/contracts/text-effects';
import type { GlyphBox } from '@mog/text-effects-engine';
import { warpToDrawingObjects } from '@mog/text-effects-engine';
import { dispatch } from '../../actions';
import { useActionDependencies } from '../../hooks/toolbar/use-action-dependencies';
import { useUIStore } from '../../infra/context';
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Input,
  TabPanel,
  Tabs,
} from '@mog/shell/components/ui';
import { getPresetsByCategory } from './preset-definitions';

// =============================================================================
// Gallery Categories (simplified for gallery tabs)
// =============================================================================

/**
 * Warp preset categories with display labels for gallery tabs.
 * Uses the shared WARP_CATEGORIES but with simplified labels.
 */
const CATEGORIES: { id: WarpCategory; label: string }[] = [
  { id: 'basic', label: 'Basic' },
  { id: 'follow-path', label: 'Follow Path' },
  { id: 'warp', label: 'Warp' },
  { id: 'perspective', label: 'Perspective' },
];

// =============================================================================
// PresetThumbnail Component
// =============================================================================

interface PresetThumbnailProps {
  preset: WarpPresetDefinition;
  isSelected: boolean;
  onClick: () => void;
  previewText: string;
}

/**
 * Generate SVG preview for a warp preset.
 *
 * Uses the actual TextEffect SVG renderer to create accurate warp previews.
 * Each preset shows the text with its warp transformation applied.
 */
function generatePreviewSVG(presetId: string, text: string): string {
  try {
    const truncated = text.slice(0, 6);
    const fontSize = 14;
    const width = 80;
    const height = 40;

    // Create GlyphBox[] from text (simple monospace estimation)
    const glyphs: GlyphBox[] = [];
    let x = 0;
    const charWidth = fontSize * 0.6;
    const ascent = fontSize * 0.8;
    const descent = fontSize * 0.2;
    for (const char of truncated) {
      glyphs.push({ x, y: ascent, width: charWidth, height: fontSize, ascent, descent, char });
      x += charWidth;
    }

    // Warp glyphs into DrawingObjects
    const drawingObjects = warpToDrawingObjects(
      glyphs,
      presetId as TextWarpPreset,
      width,
      height,
      undefined, // default adjustment
      { fill: { type: 'solid', color: '#1a1a1a' } },
    );

    if (drawingObjects.length === 0) {
      throw new Error('No drawing objects produced');
    }

    // If multiple glyph objects, wrap in a container for batch rendering
    const target =
      drawingObjects.length === 1
        ? drawingObjects[0]
        : {
            geometry: { segments: [] as never[], closed: false },
            children: drawingObjects,
          };

    return renderDrawingObjectToSVG(target, { width, height });
  } catch {
    // Fallback to plain text if rendering fails
    return `<svg viewBox="0 0 80 40" width="80" height="40"><text x="40" y="24" text-anchor="middle" font-size="14" font-weight="bold" fill="#1a1a1a">${text.slice(0, 6)}</text></svg>`;
  }
}

/**
 * Single preset thumbnail with selection state.
 *
 * Renders an actual SVG warp preview using the TextEffect renderer.
 * This shows the accurate warp transformation for each preset.
 */
function PresetThumbnail({
  preset,
  isSelected,
  onClick,
  previewText,
}: PresetThumbnailProps): ReactElement {
  // Generate actual SVG preview with warp applied
  const svgPreview = useMemo(
    () => generatePreviewSVG(preset.id, previewText),
    [preset.id, previewText],
  );

  return (
    <button
      type="button"
      className={`
 relative flex flex-col items-center justify-center gap-1
 w-full aspect-[4/3] rounded border-2 transition-colors overflow-hidden
 ${
   isSelected
     ? 'border-ss-primary bg-ss-primary/10'
     : 'border-ss-border bg-ss-surface hover:bg-ss-surface-hover hover:border-ss-primary/50'
 }
 `}
      onClick={onClick}
      title={preset.description}
    >
      {/* SVG warp preview */}
      <div
        className="flex-1 flex items-center justify-center w-full overflow-hidden p-1"
        dangerouslySetInnerHTML={{ __html: svgPreview }}
      />

      {/* Preset name label */}
      <span className="text-ribbon-group text-ss-text-secondary text-center px-1 truncate w-full pb-1">
        {preset.name}
      </span>

      {/* Selection indicator */}
      {isSelected && (
        <div className="absolute top-1 right-1 w-4 h-4 bg-ss-primary rounded-full flex items-center justify-center">
          <svg
            className="w-3 h-3 text-ss-text-inverse"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        </div>
      )}
    </button>
  );
}

// =============================================================================
// PresetGrid Component
// =============================================================================

interface PresetGridProps {
  presets: WarpPresetDefinition[];
  selectedPreset: string | null;
  onSelect: (presetId: string) => void;
  previewText: string;
}

/**
 * Grid of preset thumbnails for a category.
 */
function PresetGrid({
  presets,
  selectedPreset,
  onSelect,
  previewText,
}: PresetGridProps): ReactElement {
  return (
    <div className="grid grid-cols-5 gap-2 max-h-64 overflow-y-auto p-1">
      {presets.map((preset) => (
        <PresetThumbnail
          key={preset.id}
          preset={preset}
          isSelected={selectedPreset === preset.id}
          onClick={() => onSelect(preset.id)}
          previewText={previewText}
        />
      ))}
    </div>
  );
}

// =============================================================================
// TextEffectGallery Component
// =============================================================================

/**
 * TextEffect Gallery component.
 *
 * Shows all warp presets organized by category tabs.
 * Allows text input and preset selection before inserting.
 *
 * Uses dispatch pattern for all state mutations:
 * - INSERT_TEXT_EFFECT: Insert the TextEffect object
 * - CLOSE_TEXT_EFFECT_GALLERY: Close the gallery dialog
 */
export function TextEffectGallery(): ReactElement | null {
  // UIStore state
  const isOpen = useUIStore((s) => s.isTextEffectGalleryOpen);
  const selectedPreset = useUIStore((s) => s.gallerySelectedPreset);

  // Local state
  const [text, setText] = useState('');
  const [activeCategory, setActiveCategory] = useState<WarpCategory>('follow-path');

  // Action dependencies for dispatch
  const deps = useActionDependencies();

  // Memoize presets by category
  const presetsByCategory = useMemo(() => {
    const result: Record<WarpCategory, WarpPresetDefinition[]> = {
      basic: [],
      'follow-path': [],
      warp: [],
      perspective: [],
    };

    for (const category of CATEGORIES) {
      result[category.id] = getPresetsByCategory(category.id);
    }

    return result;
  }, []);

  // Convert categories to Tab format
  const tabs = useMemo(
    () =>
      CATEGORIES.map((cat) => ({
        id: cat.id,
        label: cat.label,
      })),
    [],
  );

  // Handle insert action
  const handleInsert = useCallback(() => {
    if (!selectedPreset || !text.trim()) return;

    // Use dispatch for inserting TextEffect
    dispatch('INSERT_TEXT_EFFECT', deps, {
      text: text.trim(),
      warpPreset: selectedPreset as TextWarpPreset,
    });

    // Use dispatch for closing gallery
    dispatch('CLOSE_TEXT_EFFECT_GALLERY', deps);

    // Reset text for next time
    setText('');
  }, [deps, selectedPreset, text]);

  // Handle cancel action
  const handleCancel = useCallback(() => {
    // Use dispatch for closing gallery
    dispatch('CLOSE_TEXT_EFFECT_GALLERY', deps);

    // Reset text for next time
    setText('');
  }, [deps]);

  // Handle category change
  const handleCategoryChange = useCallback((tabId: string) => {
    setActiveCategory(tabId as WarpCategory);
  }, []);

  // Handle preset selection
  const handlePresetSelect = useCallback(
    (presetId: string) => {
      dispatch('SET_TEXT_EFFECT_GALLERY_PRESET', deps, { presetId });
    },
    [deps],
  );

  // Don't render if gallery is closed
  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onClose={handleCancel} dialogId="text-effects-gallery-dialog" width={640}>
      <DialogHeader onClose={handleCancel}>Insert text effects</DialogHeader>

      <DialogBody>
        <div className="space-y-4">
          {/* Text Input */}
          <div>
            <label
              htmlFor="text-effects-text-input"
              className="text-body-sm font-medium text-ss-text-secondary mb-1 block"
            >
              Text
            </label>
            <Input
              id="text-effects-text-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Enter your text"
              className="text-section font-bold"
              autoFocus
            />
          </div>

          {/* Category Tabs with Preset Grids */}
          <Tabs tabs={tabs} activeTab={activeCategory} onTabChange={handleCategoryChange}>
            {CATEGORIES.map((cat) => (
              <TabPanel key={cat.id} tabId={cat.id}>
                <div className="pt-3">
                  <PresetGrid
                    presets={presetsByCategory[cat.id]}
                    selectedPreset={selectedPreset}
                    onSelect={handlePresetSelect}
                    previewText={text}
                  />
                </div>
              </TabPanel>
            ))}
          </Tabs>
        </div>
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={handleCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleInsert} disabled={!selectedPreset || !text.trim()}>
          Insert
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
