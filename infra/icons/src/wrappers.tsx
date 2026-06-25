/**
 * Icon Wrapper Utilities
 *
 * These utilities create consistently-sized icon components from raw SVGs.
 * Used to wrap icons from @mog/icons with standard toolbar sizing.
 *
 * Usage:
 *   import { BoldSvg } from '@mog/icons';
 *   import { wrapIcon } from '@mog/icons/wrappers';
 *
 *   export const BoldIcon = wrapIcon(BoldSvg);
 */

import type { ComponentType, CSSProperties, SVGProps } from 'react';

// Standard icon sizes used across the application
export const ICON_SIZES = {
  toolbar: 14,
  toolbarLarge: 20,
  menu: 20,
  dialog: 24,
} as const;

export type IconSize = keyof typeof ICON_SIZES;

type SvgComponent = ComponentType<SVGProps<SVGSVGElement>>;

/**
 * Creates a sized icon component from a raw SVG component.
 *
 * @param SvgComponent - The raw SVG component from icons/src
 * @param size - The target size (defaults to 'toolbar' = 16px)
 * @returns A React component that renders the SVG at the specified size
 */
export function wrapIcon(SvgComponent: SvgComponent, size: IconSize = 'toolbar') {
  const dimension = ICON_SIZES[size];
  const style: CSSProperties = { width: dimension, height: dimension };

  return function WrappedIcon() {
    return <SvgComponent style={style} />;
  };
}

/**
 * Creates a sized icon component with custom style support.
 *
 * @param SvgComponent - The raw SVG component from icons/src
 * @param defaultStyle - Default styles to apply
 * @returns A React component that renders the SVG with merged styles
 */
export function wrapIconWithStyle(SvgComponent: SvgComponent, defaultStyle: CSSProperties) {
  return function WrappedIcon({ style }: { style?: CSSProperties }) {
    return <SvgComponent style={{ ...defaultStyle, ...style }} />;
  };
}
