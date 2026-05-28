import { useCallback, useState } from 'react';

import { GalleryDropdown } from '../../chrome/toolbar/galleries/GalleryDropdown';
import { GalleryItem } from '../../chrome/toolbar/galleries/GalleryItem';
import { GallerySection } from '../../chrome/toolbar/galleries/GallerySection';
import { RibbonButton } from '../../chrome/toolbar/primitives/RibbonButton';
import { ChartIcon } from '../../chrome/toolbar/primitives/ToolbarIcons';
import { RibbonVisibilityItem } from '../../chrome/toolbar/visibility/RibbonVisibilityContext';

import { ChartVariantThumbnail } from './ChartVariantThumbnail';
import type { ChartCategory, ChartVariant } from './chart-variants';

export interface ChartTypesDropdownButtonProps {
  categories: readonly ChartCategory[];
  onSelectVariant: (variant: ChartVariant) => void;
  disabled?: boolean;
  onOpenWizard?: () => void;
}

export function ChartTypesDropdownButton({
  categories,
  onSelectVariant,
  disabled = false,
  onOpenWizard,
}: ChartTypesDropdownButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  const handleToggle = useCallback(() => {
    if (disabled) return;
    setIsOpen((prev) => !prev);
  }, [disabled]);

  const handleClose = useCallback(() => {
    setIsOpen(false);
  }, []);

  const handleVariantClick = useCallback(
    (variant: ChartVariant) => {
      if (disabled) return;
      onSelectVariant(variant);
      handleClose();
    },
    [disabled, handleClose, onSelectVariant],
  );

  const triggerButton = (
    <RibbonButton
      layout="vertical"
      height="full"
      icon={<ChartIcon />}
      label="Charts"
      hasDropdown
      dropdownPosition="inline"
      isOpen={isOpen}
      disabled={disabled}
      onClick={handleToggle}
      title={disabled ? 'Select cells to insert a chart' : 'Insert chart'}
      aria-label="Charts"
      data-testid="ribbon-chart-types-dropdown"
      visibilityKey="charts"
    />
  );

  return (
    <GalleryDropdown
      open={isOpen}
      onClose={handleClose}
      trigger={triggerButton}
      columns={4}
      width="xl"
      className="max-h-[calc(100vh-180px)] overflow-y-auto"
    >
      {categories.map((category) => (
        <GallerySection key={category.id} title={category.label}>
          {category.variants.map((variant) => (
            <GalleryItem
              key={variant.id}
              preview={<ChartVariantThumbnail variantId={variant.id} size={56} />}
              label={variant.label}
              title={variant.description}
              disabled={disabled}
              dataValue={variant.id}
              onClick={() => handleVariantClick(variant)}
            />
          ))}
        </GallerySection>
      ))}

      {onOpenWizard && (
        <div className="mt-2 pt-2 border-t border-ss-border">
          <RibbonVisibilityItem item="moreCharts">
            <button
              type="button"
              className="
 w-full px-2 py-1.5 text-left
 text-dropdown text-ss-primary
 hover:bg-ss-surface-hover rounded
 transition-colors
 "
              onClick={() => {
                handleClose();
                onOpenWizard();
              }}
            >
              More Charts...
            </button>
          </RibbonVisibilityItem>
        </div>
      )}
    </GalleryDropdown>
  );
}
