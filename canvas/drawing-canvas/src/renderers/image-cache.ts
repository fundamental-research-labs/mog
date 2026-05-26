/**
 * Image Cache for Picture Rendering
 *
 * Caches loaded images to avoid re-fetching on every frame.
 * Triggers a dirty callback when images finish loading so the layer re-renders.
 *
 * Ported from grid-canvas/src/layers/overlay/utils/image-cache.ts.
 *
 * @module @mog/drawing-canvas/renderers/image-cache
 */

// =============================================================================
// Image Cache
// =============================================================================

export class ImageCache {
  private readonly cache = new Map<string, HTMLImageElement>();
  private readonly loading = new Map<string, Promise<HTMLImageElement>>();
  private readonly onLoad: () => void;

  constructor(onImageLoaded: () => void) {
    this.onLoad = onImageLoaded;
  }

  /**
   * Get an image from cache, or start loading it.
   * Returns null while the image is loading.
   */
  getImage(src: string): HTMLImageElement | null {
    const cached = this.cache.get(src);
    if (cached) return cached;

    if (this.loading.has(src)) return null;

    const loadPromise = this.loadImage(src);
    this.loading.set(src, loadPromise);

    loadPromise
      .then((img) => {
        this.cache.set(src, img);
        this.loading.delete(src);
        this.onLoad();
      })
      .catch(() => {
        this.loading.delete(src);
      });

    return null;
  }

  isLoading(src: string): boolean {
    return this.loading.has(src);
  }

  isCached(src: string): boolean {
    return this.cache.has(src);
  }

  private loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      if (src.startsWith('http') && !src.startsWith('data:')) {
        img.crossOrigin = 'anonymous';
      }
      img.src = src;
    });
  }

  clear(): void {
    this.cache.clear();
    this.loading.clear();
  }

  invalidate(src: string): void {
    this.cache.delete(src);
    this.loading.delete(src);
  }

  get size(): number {
    return this.cache.size;
  }
}
