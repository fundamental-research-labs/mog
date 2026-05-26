/**
 * GallerySection
 *
 * A titled section within a GalleryDropdown. Groups related items with an
 * optional header and provides grid layout for GalleryItems.
 *
 * Uses the --gallery-columns CSS variable from parent GalleryDropdown for grid layout.
 * Uses design tokens from globals.css for consistent styling.
 *
 * @example
 * ```tsx
 * <GalleryDropdown open={isOpen} onClose={onClose} trigger={...}>
 * <GallerySection title="Good, Bad and Neutral">
 * <GalleryItem preview={...} label="Good" onClick={...} />
 * <GalleryItem preview={...} label="Bad" onClick={...} />
 * </GallerySection>
 * <GallerySection title="Data and Model">
 * <GalleryItem preview={...} label="Calculation" onClick={...} />
 * </GallerySection>
 * </GalleryDropdown>
 * ```
 */

import type { ReactNode } from 'react';

interface GallerySectionProps {
  /** Section title (optional - omit for untitled section) */
  title?: string;
  /** GalleryItem children */
  children: ReactNode;
  /** Additional class names */
  className?: string;
}

/**
 * GallerySection - Groups gallery items with an optional title.
 *
 * Features:
 * - Optional titled header with subtle styling
 * - Grid layout using --gallery-columns from parent
 * - Consistent spacing via design tokens
 */
export function GallerySection({ title, children, className = '' }: GallerySectionProps) {
  return (
    <div className={`mb-2 last:mb-0 ${className}`}>
      {/* Section title */}
      {title && (
        <div
          className="
 px-1 py-1.5
 text-dropdown-header text-ss-text-tertiary
 font-medium uppercase tracking-wide select-none
 "
        >
          {title}
        </div>
      )}

      {/* Grid of items - uses CSS variable from parent GalleryDropdown */}
      <div
        className="grid gap-1"
        style={{
          gridTemplateColumns: 'repeat(var(--gallery-columns, 4), minmax(0, 1fr))',
        }}
      >
        {children}
      </div>
    </div>
  );
}
