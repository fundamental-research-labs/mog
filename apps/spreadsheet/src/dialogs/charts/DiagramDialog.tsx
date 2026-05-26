/**
 * Diagram Insert Dialog
 *
 * Modal dialog for inserting Diagram diagrams. Provides:
 * - Category sidebar (list, process, cycle, hierarchy, relationship, matrix, pyramid, picture)
 * - Layout gallery grid showing available layouts per category
 * - Layout preview on hover
 * - Insert on double-click or OK button
 *
 * CRITICAL: Uses dispatch() for all UIStore mutations (render isolation pattern).
 */

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { dispatch, useActionDependencies, useUIStore } from '../../internal-api';

import { Button, Dialog, DialogBody, DialogFooter, DialogHeader } from '@mog/shell';
import { getCachedPreviewSVG, getCatalog } from '@mog/diagram-engine';
import type { DiagramCategory, DiagramLayoutDefinition } from '@mog-sdk/contracts/diagram';

// =============================================================================
// Constants
// =============================================================================

/**
 * Diagram categories with display labels and descriptions.
 * Matches Excel's Diagram category organization.
 */
const CATEGORIES: { id: DiagramCategory; label: string; description: string }[] = [
  { id: 'list', label: 'List', description: 'Show non-sequential information' },
  { id: 'process', label: 'Process', description: 'Show steps in a process or timeline' },
  { id: 'cycle', label: 'Cycle', description: 'Show a continuing sequence' },
  { id: 'hierarchy', label: 'Hierarchy', description: 'Show hierarchical relationships' },
  { id: 'relationship', label: 'Relationship', description: 'Show connections between items' },
  { id: 'matrix', label: 'Matrix', description: 'Show relationship to a whole' },
  { id: 'pyramid', label: 'Pyramid', description: 'Show proportional relationships' },
  { id: 'picture', label: 'Picture', description: 'Include pictures in your diagram' },
];

/**
 * Get layouts for a specific category from the layout registry.
 *
 * Uses the real layout catalog from the diagram package.
 */
function getLayoutsByCategory(category: DiagramCategory): DiagramLayoutDefinition[] {
  const catalog = getCatalog();
  const categoryData = catalog.find((c) => c.id === category);
  return categoryData?.layouts ?? [];
}

// =============================================================================
// Component
// =============================================================================

/**
 * Diagram Insert Dialog component.
 *
 * Features:
 * - Category sidebar for filtering layouts
 * - Layout gallery with thumbnail grid
 * - Preview panel showing selected/hovered layout details
 * - Insert action via OK button or double-click
 *
 * Uses dispatch() for all state mutations following render isolation pattern.
 */
export const DiagramDialog = memo(function DiagramDialog() {
  // Get UIStore state
  // Note: Diagram UI state is currently flat on the UIStore (not nested under 'diagram')
  // This follows the DiagramUISlice structure in ui-store/slices/diagram-engine.ts
  const isOpen = useUIStore((s) => s.dialogOpen);
  const deps = useActionDependencies();

  // Local state for dialog
  const [selectedCategory, setSelectedCategory] = useState<DiagramCategory>('list');
  const [selectedLayout, setSelectedLayout] = useState<DiagramLayoutDefinition | null>(null);
  const [hoveredLayout, setHoveredLayout] = useState<DiagramLayoutDefinition | null>(null);

  // Get layouts for the selected category
  const layouts = useMemo(() => {
    return getLayoutsByCategory(selectedCategory);
  }, [selectedCategory]);

  // The preview shows hovered layout if any, otherwise selected layout
  const previewLayout = hoveredLayout ?? selectedLayout;

  // Handle dialog close - use dispatch() instead of direct UIStore call
  const handleClose = useCallback(() => {
    dispatch('CLOSE_DIAGRAM_DIALOG', deps);
  }, [deps]);

  // Handle insert - use dispatch() for Diagram insertion
  const handleInsert = useCallback(() => {
    if (selectedLayout?.id) {
      dispatch('DIAGRAM_INSERT', deps, { layoutId: selectedLayout.id });
      dispatch('CLOSE_DIAGRAM_DIALOG', deps);
    }
  }, [deps, selectedLayout]);

  // Handle double-click on layout - insert immediately
  const handleDoubleClick = useCallback(
    (layout: DiagramLayoutDefinition) => {
      dispatch('DIAGRAM_INSERT', deps, { layoutId: layout.id });
      dispatch('CLOSE_DIAGRAM_DIALOG', deps);
    },
    [deps],
  );

  // Handle category change - reset selection
  const handleCategoryChange = useCallback((categoryId: DiagramCategory) => {
    setSelectedCategory(categoryId);
    setSelectedLayout(null);
  }, []);

  // Don't render if not open
  if (!isOpen) return null;

  return (
    <Dialog
      onEnterKeyDown={handleInsert}
      open={isOpen}
      onClose={handleClose}
      dialogId="diagram-insert-dialog"
      width={900}
    >
      <DialogHeader onClose={handleClose}>Choose a diagram</DialogHeader>

      <DialogBody>
        <div className="flex h-[500px]">
          {/* Category sidebar */}
          <div className="w-48 border-r border-ss-border overflow-y-auto shrink-0">
            <div className="p-2">
              <div className="text-caption text-ss-text-secondary font-medium mb-2 px-2">
                Categories
              </div>
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  className={`w-full text-left px-2 py-1.5 rounded text-body-sm ${
                    selectedCategory === cat.id
                      ? 'bg-ss-primary text-ss-text-inverse'
                      : 'hover:bg-ss-surface-hover text-ss-text'
                  }`}
                  onClick={() => handleCategoryChange(cat.id)}
                  title={cat.description}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* Layout gallery and preview */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Category description */}
            <div className="px-4 py-2 border-b border-ss-border">
              <div className="text-body-sm font-medium">
                {CATEGORIES.find((c) => c.id === selectedCategory)?.label}
              </div>
              <div className="text-caption text-ss-text-secondary">
                {CATEGORIES.find((c) => c.id === selectedCategory)?.description}
              </div>
            </div>

            {/* Layout gallery grid */}
            <div className="flex-1 overflow-y-auto p-4">
              <div className="grid grid-cols-4 gap-3">
                {layouts.map((layout) => (
                  <button
                    key={layout.id}
                    type="button"
                    className={`p-2 border rounded-ss-lg text-left transition-colors ${
                      selectedLayout?.id === layout.id
                        ? 'border-ss-primary bg-ss-primary/5'
                        : 'border-ss-border hover:border-ss-primary/50 hover:bg-ss-surface-hover'
                    }`}
                    onClick={() => setSelectedLayout(layout)}
                    onDoubleClick={() => handleDoubleClick(layout)}
                    onMouseEnter={() => setHoveredLayout(layout)}
                    onMouseLeave={() => setHoveredLayout(null)}
                    title={layout.name}
                    aria-label={layout.name}
                  >
                    {/* Thumbnail - actual SVG preview */}
                    <div className="aspect-square bg-ss-surface-secondary rounded flex items-center justify-center mb-2 overflow-hidden">
                      <LayoutThumbnail layout={layout} />
                    </div>
                    <div className="text-caption text-center truncate">{layout.name}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Preview panel */}
            {previewLayout && (
              <div className="border-t border-ss-border p-4 bg-ss-surface-secondary shrink-0">
                <div className="flex gap-4">
                  {/* Large preview thumbnail */}
                  <div className="w-32 h-32 bg-ss-surface border border-ss-border rounded flex items-center justify-center shrink-0 overflow-hidden">
                    <LayoutThumbnail layout={previewLayout} size="large" />
                  </div>
                  {/* Layout details */}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{previewLayout.name}</div>
                    <div className="text-body-sm text-ss-text-secondary mt-1">
                      {previewLayout.description}
                    </div>
                    <div className="text-caption text-ss-text-tertiary mt-2">
                      Max items: {previewLayout.maxNodes ?? 'Unlimited'} | Max levels:{' '}
                      {previewLayout.maxLevels}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={handleClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleInsert} disabled={!selectedLayout}>
          OK
        </Button>
      </DialogFooter>
    </Dialog>
  );
});

// =============================================================================
// Helper Components
// =============================================================================

/**
 * Layout thumbnail component.
 *
 * Renders actual SVG preview using the layout algorithm and renderer,
 * falling back to a category icon if preview generation fails.
 */
const LayoutThumbnail = memo(function LayoutThumbnail({
  layout,
  size = 'small',
}: {
  layout: DiagramLayoutDefinition;
  size?: 'small' | 'large';
}) {
  const [svgPreview, setSvgPreview] = useState<string | null>(null);

  const previewSize = size === 'large' ? 120 : 64;

  // Generate preview on mount
  useEffect(() => {
    const svg = getCachedPreviewSVG(layout, {
      width: previewSize,
      height: previewSize,
    });
    setSvgPreview(svg);
  }, [layout, previewSize]);

  // If we have an SVG preview, render it
  if (svgPreview) {
    return (
      <div
        className="w-full h-full flex items-center justify-center"
        dangerouslySetInnerHTML={{ __html: svgPreview }}
      />
    );
  }

  // Fallback: category-specific icons
  const iconSize = size === 'large' ? 'text-4xl' : 'text-2xl';
  const icons: Record<DiagramCategory, string> = {
    list: '\u2630', // Trigram for heaven (list-like)
    process: '\u2192', // Right arrow
    cycle: '\u21BB', // Clockwise open circle arrow
    hierarchy: '\u25B3', // White up-pointing triangle
    relationship: '\u2B55', // Heavy large circle
    matrix: '\u25A6', // Square with orthogonal crosshatch
    pyramid: '\u25B2', // Black up-pointing triangle
    picture: '\u{1F5BC}', // Frame with picture emoji
  };

  return (
    <span className={`${iconSize} text-ss-text-tertiary`}>
      {layout.category ? icons[layout.category] : '\u25A1'}
    </span>
  );
});
