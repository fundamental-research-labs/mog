import type {
  ISheetViewOverlays,
  OverlayAnchor,
  SheetOverlayHandle,
  SheetOverlayOptions,
} from '../capability-interfaces';
import type { SheetRect } from '../public-types';

export interface SheetViewOverlaysDeps {
  getContainer: () => HTMLElement;
  resolveAnchorRects?: (anchor: OverlayAnchor) => SheetRect[];
}

interface OverlayEntry {
  wrapper: HTMLElement;
  element: HTMLElement;
  options: SheetOverlayOptions;
}

export class SheetViewOverlays implements ISheetViewOverlays {
  private readonly _deps: SheetViewOverlaysDeps;
  private readonly _overlays = new Map<number, OverlayEntry>();
  private _nextId = 0;

  constructor(deps: SheetViewOverlaysDeps) {
    this._deps = deps;
  }

  mount(element: HTMLElement, options: SheetOverlayOptions): SheetOverlayHandle {
    const id = this._nextId++;
    const wrapper = document.createElement('div');
    wrapper.style.position = 'absolute';
    wrapper.style.pointerEvents = 'auto';
    wrapper.style.zIndex = '1000';
    wrapper.style.boxSizing = 'border-box';
    wrapper.appendChild(element);
    this._deps.getContainer().appendChild(wrapper);
    this._overlays.set(id, { wrapper, element, options: { ...options } });
    this._position(id);

    return {
      update: (newOptions) => {
        const entry = this._overlays.get(id);
        if (!entry) return;
        entry.options = { ...entry.options, ...newOptions };
        this._position(id);
      },
      dispose: () => {
        const entry = this._overlays.get(id);
        if (entry) {
          entry.wrapper.remove();
          this._overlays.delete(id);
        }
      },
    };
  }

  /** @internal */
  refreshPositions(): void {
    for (const id of this._overlays.keys()) this._position(id);
  }

  /** @internal */
  handleScroll(): void {
    for (const [id, entry] of [...this._overlays]) {
      if (entry.options.dismissOnScroll) {
        entry.wrapper.remove();
        this._overlays.delete(id);
      }
    }
    this.refreshPositions();
  }

  /** @internal */
  handleSheetChange(): void {
    for (const [id, entry] of [...this._overlays]) {
      if (entry.options.dismissOnSheetChange) {
        entry.wrapper.remove();
        this._overlays.delete(id);
      }
    }
    this.refreshPositions();
  }

  /** @internal */
  disposeAll(): void {
    for (const { wrapper } of this._overlays.values()) wrapper.remove();
    this._overlays.clear();
  }

  private _position(id: number): void {
    const entry = this._overlays.get(id);
    if (!entry) return;

    const anchor = this._resolveAnchor(entry.options.anchor);
    if (!anchor) {
      entry.wrapper.style.display = 'none';
      return;
    }

    entry.wrapper.style.display = '';

    const size = this._measure(entry.wrapper);
    const nextPlacement = this._placementAfterFlip(entry.options, anchor, size);
    let point = this._pointForPlacement(anchor, size, nextPlacement);

    const containerBounds = this._containerBounds();
    if (entry.options.collision === 'hide' && this._overflows(point, size, containerBounds)) {
      entry.wrapper.style.display = 'none';
      return;
    }

    if (entry.options.collision === 'shift' || entry.options.collision === 'flip') {
      point = {
        x: clamp(point.x, 0, Math.max(0, containerBounds.width - size.width)),
        y: clamp(point.y, 0, Math.max(0, containerBounds.height - size.height)),
      };
    }

    entry.wrapper.style.left = `${point.x}px`;
    entry.wrapper.style.top = `${point.y}px`;
  }

  private _resolveAnchor(anchor: OverlayAnchor): SheetRect | null {
    if (anchor.type === 'viewport-point') {
      return { x: anchor.x, y: anchor.y, width: 0, height: 0 };
    }

    const rects = this._deps.resolveAnchorRects?.(anchor) ?? [];
    if (rects.length === 0) return null;

    let minX = rects[0].x;
    let minY = rects[0].y;
    let maxX = rects[0].x + rects[0].width;
    let maxY = rects[0].y + rects[0].height;
    for (let i = 1; i < rects.length; i++) {
      const r = rects[i];
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.width);
      maxY = Math.max(maxY, r.y + r.height);
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  private _placementAfterFlip(
    options: SheetOverlayOptions,
    anchor: SheetRect,
    size: { width: number; height: number },
  ): SheetOverlayOptions['placement'] {
    if (options.collision !== 'flip') return options.placement;

    const bounds = this._containerBounds();
    const point = this._pointForPlacement(anchor, size, options.placement);
    if (point.y < 0 && options.placement.startsWith('top')) {
      return options.placement.replace('top', 'bottom') as SheetOverlayOptions['placement'];
    }
    if (point.y + size.height > bounds.height && options.placement.startsWith('bottom')) {
      return options.placement.replace('bottom', 'top') as SheetOverlayOptions['placement'];
    }
    if (point.x < 0 && options.placement === 'left') return 'right';
    if (point.x + size.width > bounds.width && options.placement === 'right') return 'left';
    return options.placement;
  }

  private _pointForPlacement(
    anchor: SheetRect,
    size: { width: number; height: number },
    placement: SheetOverlayOptions['placement'],
  ): { x: number; y: number } {
    switch (placement) {
      case 'top':
        return { x: anchor.x + (anchor.width - size.width) / 2, y: anchor.y - size.height };
      case 'top-start':
        return { x: anchor.x, y: anchor.y - size.height };
      case 'top-end':
        return { x: anchor.x + anchor.width - size.width, y: anchor.y - size.height };
      case 'bottom':
        return { x: anchor.x + (anchor.width - size.width) / 2, y: anchor.y + anchor.height };
      case 'bottom-start':
        return { x: anchor.x, y: anchor.y + anchor.height };
      case 'bottom-end':
        return { x: anchor.x + anchor.width - size.width, y: anchor.y + anchor.height };
      case 'left':
        return { x: anchor.x - size.width, y: anchor.y + (anchor.height - size.height) / 2 };
      case 'right':
        return { x: anchor.x + anchor.width, y: anchor.y + (anchor.height - size.height) / 2 };
    }
  }

  private _measure(element: HTMLElement): { width: number; height: number } {
    const rect = element.getBoundingClientRect();
    return {
      width: rect.width || element.offsetWidth || 0,
      height: rect.height || element.offsetHeight || 0,
    };
  }

  private _containerBounds(): { width: number; height: number } {
    const container = this._deps.getContainer();
    const rect = container.getBoundingClientRect();
    return {
      width: rect.width || container.clientWidth || 0,
      height: rect.height || container.clientHeight || 0,
    };
  }

  private _overflows(
    point: { x: number; y: number },
    size: { width: number; height: number },
    bounds: { width: number; height: number },
  ): boolean {
    return (
      point.x < 0 ||
      point.y < 0 ||
      point.x + size.width > bounds.width ||
      point.y + size.height > bounds.height
    );
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
