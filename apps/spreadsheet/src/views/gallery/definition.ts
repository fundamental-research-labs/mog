/**
 * Gallery View Definition
 *
 * Registers the Gallery view type with the view registry.
 */

import type { ViewConfig, ViewDefinition } from '../types';
import { GalleryViewAdapter } from './GalleryViewAdapter';
import { GalleryViewContainer } from './GalleryViewContainer';
import { DEFAULT_GALLERY_CONFIG } from './config';

/**
 * Gallery view definition for registration in ViewRegistry.
 */
export const galleryViewDefinition: ViewDefinition<'gallery'> = {
  type: 'gallery',
  name: 'Gallery',
  icon: 'gallery',
  description: 'Visual cards in a responsive grid, ideal for images and inventory',
  requiredColumns: undefined, // Optional: 'file' column for cover images

  renderingMode: 'react',
  component: GalleryViewContainer,

  createAdapter: (config) => new GalleryViewAdapter(config),

  defaultConfig: {
    ...DEFAULT_GALLERY_CONFIG,
  } as ViewConfig<'gallery'>,
};
