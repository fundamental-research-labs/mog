/**
 * ChartGallery
 *
 * A dropdown gallery showing chart variants for a specific chart category.
 * Uses GalleryDropdown/GallerySection/GalleryItem from foundation components.
 *
 * This component is used by ChartTypeButton to show available subtypes when
 * the user clicks on a chart category (Column, Line, Pie, etc.).
 *
 * @module components/charts/ChartGallery
 */

import React, { useCallback } from 'react';

import { GalleryDropdown } from '../../chrome/toolbar/galleries/GalleryDropdown';
import { GalleryItem } from '../../chrome/toolbar/galleries/GalleryItem';
import { GallerySection } from '../../chrome/toolbar/galleries/GallerySection';

import type { ChartCategory, ChartVariant } from './chart-variants';
import { ChartVariantThumbnail } from './ChartVariantThumbnail';

// =============================================================================
// Types
// =============================================================================

export interface ChartGalleryProps {
  /** Whether the gallery is open */
  open: boolean;
  /** Called when gallery should close */
  onClose: () => void;
  /** The trigger element (ChartTypeButton) */
  trigger: React.ReactNode;
  /** Chart category to show variants for */
  category: ChartCategory;
  /** Called when a variant is selected */
  onSelectVariant: (variant: ChartVariant) => void;
  /** Currently selected variant ID (if any) */
  selectedVariantId?: string;
  /** Whether chart insertion is disabled */
  disabled?: boolean;
  /** Called when "More Charts..." is clicked to open the wizard */
  onOpenWizard?: () => void;
}

// =============================================================================
// Component
// =============================================================================

/**
 * ChartGallery - Dropdown gallery for chart variant selection
 *
 * Shows thumbnails of all available variants for a chart category.
 * Uses GalleryDropdown for portal-based positioning and click-outside handling.
 */
export function ChartGallery({
  open,
  onClose,
  trigger,
  category,
  onSelectVariant,
  selectedVariantId,
  disabled = false,
  onOpenWizard,
}: ChartGalleryProps) {
  const handleVariantClick = useCallback(
    (variant: ChartVariant) => {
      if (disabled) return;
      onSelectVariant(variant);
      onClose();
    },
    [disabled, onSelectVariant, onClose],
  );

  // Determine column count based on number of variants
  const columns = category.variants.length <= 3 ? 3 : 4;

  return (
    <GalleryDropdown
      open={open}
      onClose={onClose}
      trigger={trigger}
      columns={columns as 3 | 4}
      width="md"
    >
      <GallerySection title={category.label}>
        {category.variants.map((variant) => (
          <GalleryItem
            key={variant.id}
            preview={<ChartVariantThumbnail variantId={variant.id} size={56} />}
            label={variant.label}
            title={variant.description}
            isSelected={variant.id === selectedVariantId}
            disabled={disabled}
            dataValue={variant.id}
            onClick={() => handleVariantClick(variant)}
          />
        ))}
      </GallerySection>

      {/* More Charts link at bottom */}
      {onOpenWizard && (
        <div className="mt-2 pt-2 border-t border-ss-border">
          <button
            type="button"
            className="
 w-full px-2 py-1.5 text-left
 text-dropdown text-ss-primary
 hover:bg-ss-surface-hover rounded
 transition-colors
 "
            onClick={() => {
              onClose();
              onOpenWizard();
            }}
          >
            More {category.label} Charts...
          </button>
        </div>
      )}
    </GalleryDropdown>
  );
}
