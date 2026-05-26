import type {
  ISheetViewDecorations,
  OverlayAnchor,
  SheetDecorationHandle,
  SheetDecorationSpec,
} from '../capability-interfaces';
import type { SheetRect } from '../public-types';

export interface SheetViewDecorationsDeps {
  getContainer: () => HTMLElement;
  resolveAnchorRects: (anchor: OverlayAnchor) => SheetRect[];
}

interface DecorationEntry {
  spec: SheetDecorationSpec;
  elements: HTMLElement[];
}

export class SheetViewDecorations implements ISheetViewDecorations {
  private readonly _decorations = new Map<string, DecorationEntry>();
  private _nextId = 0;
  private readonly _layer: HTMLElement | null = null;

  constructor(private readonly _deps?: SheetViewDecorationsDeps) {
    if (_deps) {
      const layer = document.createElement('div');
      layer.setAttribute('data-mog-sheet-decorations', 'true');
      layer.style.position = 'absolute';
      layer.style.inset = '0';
      layer.style.pointerEvents = 'none';
      layer.style.zIndex = '900';
      _deps.getContainer().appendChild(layer);
      this._layer = layer;
    }
  }

  add(spec: SheetDecorationSpec): SheetDecorationHandle {
    const id = `dec_${this._nextId++}`;
    this._decorations.set(id, { spec: cloneSpec(spec), elements: [] });
    this._renderDecoration(id);

    return {
      id,
      update: (partial) => {
        const entry = this._decorations.get(id);
        if (entry) {
          if (partial.kind !== undefined) entry.spec.kind = partial.kind;
          if (partial.style !== undefined)
            entry.spec.style = { ...entry.spec.style, ...partial.style };
          if (partial.animation !== undefined) entry.spec.animation = partial.animation;
          if (partial.group !== undefined) entry.spec.group = partial.group;
          this._renderDecoration(id);
        }
      },
      dispose: () => {
        this._removeEntry(id);
      },
    };
  }

  remove(id: string): void {
    this._removeEntry(id);
  }

  removeGroup(group: string): void {
    for (const [id, { spec }] of this._decorations) {
      if (spec.group === group) this._removeEntry(id);
    }
  }

  clear(): void {
    for (const id of [...this._decorations.keys()]) this._removeEntry(id);
  }

  /** @internal */
  refresh(): void {
    for (const id of this._decorations.keys()) this._renderDecoration(id);
  }

  /** @internal */
  disposeAll(): void {
    this._decorations.clear();
    this._layer?.remove();
  }

  /** @internal — expose snapshot for renderer integration. */
  getSnapshot(): ReadonlyMap<string, { spec: SheetDecorationSpec }> {
    return this._decorations;
  }

  private _removeEntry(id: string): void {
    const entry = this._decorations.get(id);
    if (!entry) return;
    for (const el of entry.elements) el.remove();
    this._decorations.delete(id);
  }

  private _renderDecoration(id: string): void {
    const entry = this._decorations.get(id);
    if (!entry || !this._deps || !this._layer) return;

    for (const el of entry.elements) el.remove();
    entry.elements = [];

    const rects = this._deps.resolveAnchorRects(entry.spec.anchor);
    for (const rect of rects) {
      const el = document.createElement('div');
      el.setAttribute('data-mog-sheet-decoration-id', id);
      el.setAttribute('data-mog-sheet-decoration-kind', entry.spec.kind);
      el.style.position = 'absolute';
      el.style.left = `${rect.x}px`;
      el.style.top = `${rect.y}px`;
      el.style.width = `${rect.width}px`;
      el.style.height = `${rect.height}px`;
      el.style.boxSizing = 'border-box';
      this._applyStyle(el, entry.spec, rect);
      this._layer.appendChild(el);
      entry.elements.push(el);
    }
  }

  private _applyStyle(el: HTMLElement, spec: SheetDecorationSpec, rect: SheetRect): void {
    const style = spec.style ?? {};
    const color = style.color ?? style.borderColor ?? '#3b82f6';
    const opacity = style.opacity ?? 1;
    el.style.opacity = `${opacity}`;

    switch (spec.kind) {
      case 'fill':
        el.style.background = color;
        break;
      case 'border':
        el.style.border = `${style.borderWidth ?? 2}px solid ${style.borderColor ?? color}`;
        break;
      case 'underline':
        el.style.borderBottom = `${style.borderWidth ?? 2}px solid ${style.borderColor ?? color}`;
        break;
      case 'stripe':
        el.style.background = `repeating-linear-gradient(135deg, ${color} 0 4px, transparent 4px 8px)`;
        break;
      case 'glow':
        el.style.border = `${style.borderWidth ?? 1}px solid ${style.borderColor ?? color}`;
        el.style.boxShadow = `0 0 8px ${color}`;
        break;
      case 'badge':
        this._applyBadgeStyle(el, spec, rect);
        break;
    }

    if (spec.animation?.preset && spec.animation.preset !== 'none') {
      el.style.animationName = `mog-sheet-decoration-${spec.animation.preset}`;
      el.style.animationDuration = `${spec.animation.durationMs ?? 600}ms`;
      el.style.animationIterationCount =
        spec.animation.iterations === undefined ? '1' : `${spec.animation.iterations}`;
    }
  }

  private _applyBadgeStyle(el: HTMLElement, spec: SheetDecorationSpec, rect: SheetRect): void {
    const style = spec.style ?? {};
    el.textContent = style.badgeText ?? '';
    el.style.width = 'auto';
    el.style.height = 'auto';
    el.style.minWidth = '16px';
    el.style.minHeight = '16px';
    el.style.padding = '1px 4px';
    el.style.borderRadius = '8px';
    el.style.background = style.color ?? '#2563eb';
    el.style.color = '#fff';
    el.style.font = '11px sans-serif';
    el.style.lineHeight = '14px';

    const position = style.badgePosition ?? 'top-right';
    if (position.includes('right')) {
      el.style.left = `${rect.x + rect.width}px`;
      el.style.transform = 'translateX(-100%)';
    }
    if (position.includes('bottom')) {
      el.style.top = `${rect.y + rect.height}px`;
      el.style.transform = `${el.style.transform} translateY(-100%)`.trim();
    }
  }
}

function cloneSpec(spec: SheetDecorationSpec): SheetDecorationSpec {
  return {
    ...spec,
    anchor: { ...spec.anchor },
    style: spec.style ? { ...spec.style } : undefined,
    animation: spec.animation ? { ...spec.animation } : undefined,
  };
}
