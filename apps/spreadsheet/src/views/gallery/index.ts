/**
 * Gallery View
 *
 * Visual cards in a responsive grid, optimized for image-heavy content.
 */

// Configuration
export { CARD_DIMENSIONS, DEFAULT_GALLERY_CONFIG, createGalleryConfig } from './config';
export type { GalleryCardSize, GalleryFitMode, GalleryViewConfig } from './config';

// Adapter
export { GalleryViewAdapter } from './GalleryViewAdapter';
export type { GallerySelection, GalleryViewAdapterConfig } from './GalleryViewAdapter';

// Definition
export { galleryViewDefinition } from './definition';

// Components
export * from './components';
export { GalleryView } from './GalleryView';
export type { GalleryViewAdapterLike, GalleryViewProps } from './GalleryView';
export { GalleryViewContainer } from './GalleryViewContainer';
export type { GalleryViewContainerProps } from './GalleryViewContainer';

// State Machines
export * from './machines';

// Hooks
export * from './hooks';
