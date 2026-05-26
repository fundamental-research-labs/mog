import type { ScrollPosition, SheetViewportState } from './public-types';

export const SHEET_VIEW_SCROLLBAR_SIZE = 14;
const ZOOM_STRIP_WIDTH = 116;
const MIN_THUMB_SIZE = 24;

export interface SheetViewViewportChromeOptions {
  readonly scrollbars?: boolean;
  readonly zoomControls?: boolean;
}

export interface SheetViewViewportChromeCallbacks {
  readonly onScroll: (position: ScrollPosition) => void;
  readonly onZoom: (zoom: number) => void;
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(4, Math.max(0.1, Math.round(zoom * 100) / 100));
}

export function stepZoom(zoom: number, direction: -1 | 1): number {
  return clampZoom(Math.round((zoom + direction * 0.1) * 10) / 10);
}

export function clampScrollPosition(
  position: ScrollPosition,
  maxScroll: ScrollPosition,
): ScrollPosition {
  return {
    x: Math.min(Math.max(0, finiteOrZero(position.x)), Math.max(0, finiteOrZero(maxScroll.x))),
    y: Math.min(Math.max(0, finiteOrZero(position.y)), Math.max(0, finiteOrZero(maxScroll.y))),
  };
}

export function computeScrollbarThumb(
  trackLength: number,
  viewportLength: number,
  contentLength: number,
  scrollOffset: number,
): { offset: number; size: number; hidden: boolean } {
  if (trackLength <= 0 || viewportLength <= 0 || contentLength <= viewportLength) {
    return { offset: 0, size: trackLength, hidden: true };
  }

  const ratio = viewportLength / contentLength;
  const size = Math.max(MIN_THUMB_SIZE, Math.floor(trackLength * ratio));
  const maxOffset = Math.max(0, trackLength - size);
  const maxScroll = Math.max(1, contentLength - viewportLength);
  const offset = Math.round(
    (Math.min(Math.max(0, scrollOffset), maxScroll) / maxScroll) * maxOffset,
  );
  return { offset, size, hidden: false };
}

export class SheetViewViewportChrome {
  private readonly _root: HTMLDivElement;
  private readonly _verticalTrack: HTMLDivElement;
  private readonly _verticalThumb: HTMLDivElement;
  private readonly _horizontalTrack: HTMLDivElement;
  private readonly _horizontalThumb: HTMLDivElement;
  private readonly _zoomStrip: HTMLDivElement;
  private readonly _zoomOut: HTMLButtonElement;
  private readonly _zoomIn: HTMLButtonElement;
  private readonly _zoomLabel: HTMLSpanElement;
  private _state: SheetViewportState | null = null;
  private _drag: {
    axis: 'x' | 'y';
    startClient: number;
    startScroll: number;
    trackLength: number;
    thumbSize: number;
  } | null = null;

  constructor(
    container: HTMLElement,
    private readonly _options: Required<SheetViewViewportChromeOptions>,
    private readonly _callbacks: SheetViewViewportChromeCallbacks,
  ) {
    this._root = document.createElement('div');
    this._root.className = 'mog-sheet-view-viewport-chrome';
    this._root.style.cssText = [
      'position:absolute',
      'inset:0',
      'pointer-events:none',
      'z-index:20',
      'font:12px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'color:#1f2933',
    ].join(';');

    this._verticalTrack = this._createTrack('vertical');
    this._verticalThumb = this._createThumb('vertical');
    this._verticalTrack.appendChild(this._verticalThumb);

    this._horizontalTrack = this._createTrack('horizontal');
    this._horizontalThumb = this._createThumb('horizontal');
    this._horizontalTrack.appendChild(this._horizontalThumb);

    this._zoomStrip = document.createElement('div');
    this._zoomStrip.setAttribute('role', 'group');
    this._zoomStrip.setAttribute('aria-label', 'Sheet zoom controls');
    this._zoomStrip.style.cssText = [
      'position:absolute',
      `right:${this._options.scrollbars ? SHEET_VIEW_SCROLLBAR_SIZE : 0}px`,
      'bottom:0',
      `width:${ZOOM_STRIP_WIDTH}px`,
      `height:${SHEET_VIEW_SCROLLBAR_SIZE}px`,
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'gap:4px',
      'background:#f7f9fb',
      'border-top:1px solid #c8d0d8',
      'border-left:1px solid #c8d0d8',
      'box-sizing:border-box',
      'pointer-events:auto',
    ].join(';');

    this._zoomOut = this._createZoomButton('Zoom out', '-');
    this._zoomIn = this._createZoomButton('Zoom in', '+');
    this._zoomLabel = document.createElement('span');
    this._zoomLabel.setAttribute('aria-live', 'polite');
    this._zoomLabel.style.cssText =
      'min-width:38px;text-align:center;font-variant-numeric:tabular-nums';
    this._zoomStrip.append(this._zoomOut, this._zoomLabel, this._zoomIn);

    if (this._options.scrollbars) {
      this._root.append(this._verticalTrack, this._horizontalTrack);
    }
    if (this._options.zoomControls) {
      this._root.appendChild(this._zoomStrip);
    }
    container.appendChild(this._root);

    this._wireEvents();
    this._applyVisibility();
  }

  update(state: SheetViewportState): void {
    this._state = state;
    this._applyVisibility();
    this._syncScrollbars(state);
    this._syncZoom(state.zoom);
  }

  dispose(): void {
    document.removeEventListener('pointermove', this._onPointerMove);
    document.removeEventListener('pointerup', this._onPointerUp);
    this._root.remove();
  }

  private _createTrack(axis: 'horizontal' | 'vertical'): HTMLDivElement {
    const el = document.createElement('div');
    el.dataset.mogSheetScrollbar = axis;
    el.setAttribute('role', 'scrollbar');
    el.setAttribute('aria-orientation', axis);
    el.setAttribute(
      'aria-label',
      axis === 'horizontal' ? 'Horizontal sheet scrollbar' : 'Vertical sheet scrollbar',
    );
    el.tabIndex = 0;
    const position =
      axis === 'horizontal'
        ? [
            'left:0',
            'bottom:0',
            `right:${this._options.zoomControls ? ZOOM_STRIP_WIDTH + SHEET_VIEW_SCROLLBAR_SIZE : SHEET_VIEW_SCROLLBAR_SIZE}px`,
            `height:${SHEET_VIEW_SCROLLBAR_SIZE}px`,
            'border-top:1px solid #c8d0d8',
          ]
        : [
            'top:0',
            'right:0',
            `bottom:${SHEET_VIEW_SCROLLBAR_SIZE}px`,
            `width:${SHEET_VIEW_SCROLLBAR_SIZE}px`,
            'border-left:1px solid #c8d0d8',
          ];
    el.style.cssText = [
      'position:absolute',
      'box-sizing:border-box',
      'background:#f7f9fb',
      'pointer-events:auto',
      'touch-action:none',
      ...position,
    ].join(';');
    return el;
  }

  private _createThumb(axis: 'horizontal' | 'vertical'): HTMLDivElement {
    const el = document.createElement('div');
    el.dataset.mogSheetScrollbarThumb = axis;
    el.style.cssText = [
      'position:absolute',
      'border-radius:7px',
      'background:#9aa6b2',
      'min-width:0',
      'min-height:0',
      'touch-action:none',
      axis === 'horizontal' ? 'height:8px;top:2px' : 'width:8px;left:2px',
    ].join(';');
    return el;
  }

  private _createZoomButton(label: string, text: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.setAttribute('aria-label', label);
    button.style.cssText = [
      'width:18px',
      'height:12px',
      'border:1px solid #b8c2cc',
      'border-radius:2px',
      'background:#fff',
      'color:#1f2933',
      'line-height:8px',
      'padding:0',
      'font:12px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'cursor:pointer',
    ].join(';');
    return button;
  }

  private _wireEvents(): void {
    this._horizontalThumb.addEventListener('pointerdown', (event) => this._startDrag(event, 'x'));
    this._verticalThumb.addEventListener('pointerdown', (event) => this._startDrag(event, 'y'));
    this._horizontalTrack.addEventListener('pointerdown', (event) => this._page(event, 'x'));
    this._verticalTrack.addEventListener('pointerdown', (event) => this._page(event, 'y'));
    this._horizontalTrack.addEventListener('keydown', (event) => this._keyScroll(event, 'x'));
    this._verticalTrack.addEventListener('keydown', (event) => this._keyScroll(event, 'y'));
    this._zoomOut.addEventListener('click', () => {
      this._callbacks.onZoom(stepZoom(this._state?.zoom ?? 1, -1));
    });
    this._zoomIn.addEventListener('click', () => {
      this._callbacks.onZoom(stepZoom(this._state?.zoom ?? 1, 1));
    });
    document.addEventListener('pointermove', this._onPointerMove);
    document.addEventListener('pointerup', this._onPointerUp);
  }

  private _startDrag(event: PointerEvent, axis: 'x' | 'y'): void {
    const state = this._state;
    if (!state) return;
    event.preventDefault();
    event.stopPropagation();
    const track = axis === 'x' ? this._horizontalTrack : this._verticalTrack;
    const thumb = axis === 'x' ? this._horizontalThumb : this._verticalThumb;
    const trackLength = axis === 'x' ? track.clientWidth : track.clientHeight;
    const thumbSize = axis === 'x' ? thumb.offsetWidth : thumb.offsetHeight;
    this._drag = {
      axis,
      startClient: axis === 'x' ? event.clientX : event.clientY,
      startScroll: axis === 'x' ? state.scrollPosition.x : state.scrollPosition.y,
      trackLength,
      thumbSize,
    };
  }

  private _page(event: PointerEvent, axis: 'x' | 'y'): void {
    if ((event.target as HTMLElement).dataset.mogSheetScrollbarThumb) return;
    const state = this._state;
    if (!state) return;
    event.preventDefault();
    const track = axis === 'x' ? this._horizontalTrack : this._verticalTrack;
    const rect = track.getBoundingClientRect();
    const pointer = axis === 'x' ? event.clientX - rect.left : event.clientY - rect.top;
    const thumb = axis === 'x' ? this._horizontalThumb : this._verticalThumb;
    const thumbStart = axis === 'x' ? thumb.offsetLeft : thumb.offsetTop;
    const pageSize = axis === 'x' ? state.viewportSize.width : state.viewportSize.height;
    const current = state.scrollPosition;
    const next =
      pointer < thumbStart
        ? {
            x: current.x - (axis === 'x' ? pageSize : 0),
            y: current.y - (axis === 'y' ? pageSize : 0),
          }
        : {
            x: current.x + (axis === 'x' ? pageSize : 0),
            y: current.y + (axis === 'y' ? pageSize : 0),
          };
    this._callbacks.onScroll(clampScrollPosition(next, state.maxScroll));
  }

  private _keyScroll(event: KeyboardEvent, axis: 'x' | 'y'): void {
    const state = this._state;
    if (!state) return;
    const current = state.scrollPosition;
    const small = 40;
    const page = axis === 'x' ? state.viewportSize.width : state.viewportSize.height;
    let delta = 0;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') delta = -small;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') delta = small;
    if (event.key === 'PageUp') delta = -page;
    if (event.key === 'PageDown') delta = page;
    if (event.key === 'Home') delta = -Number.MAX_SAFE_INTEGER;
    if (event.key === 'End') delta = Number.MAX_SAFE_INTEGER;
    if (delta === 0) return;
    event.preventDefault();
    this._callbacks.onScroll(
      clampScrollPosition(
        axis === 'x'
          ? { x: current.x + delta, y: current.y }
          : { x: current.x, y: current.y + delta },
        state.maxScroll,
      ),
    );
  }

  private readonly _onPointerMove = (event: PointerEvent): void => {
    const drag = this._drag;
    const state = this._state;
    if (!drag || !state) return;
    event.preventDefault();
    const client = drag.axis === 'x' ? event.clientX : event.clientY;
    const delta = client - drag.startClient;
    const maxThumbOffset = Math.max(1, drag.trackLength - drag.thumbSize);
    const maxScroll = drag.axis === 'x' ? state.maxScroll.x : state.maxScroll.y;
    const nextOffset = drag.startScroll + (delta / maxThumbOffset) * maxScroll;
    const next =
      drag.axis === 'x'
        ? { x: nextOffset, y: state.scrollPosition.y }
        : { x: state.scrollPosition.x, y: nextOffset };
    this._callbacks.onScroll(clampScrollPosition(next, state.maxScroll));
  };

  private readonly _onPointerUp = (): void => {
    this._drag = null;
  };

  private _syncScrollbars(state: SheetViewportState): void {
    if (!this._options.scrollbars) return;

    const h = computeScrollbarThumb(
      this._horizontalTrack.clientWidth,
      state.viewportSize.width,
      state.contentSize.width,
      state.scrollPosition.x,
    );
    const v = computeScrollbarThumb(
      this._verticalTrack.clientHeight,
      state.viewportSize.height,
      state.contentSize.height,
      state.scrollPosition.y,
    );

    this._horizontalTrack.style.display = h.hidden ? 'none' : 'block';
    this._verticalTrack.style.display = v.hidden ? 'none' : 'block';
    this._horizontalThumb.style.left = `${h.offset}px`;
    this._horizontalThumb.style.width = `${h.size}px`;
    this._verticalThumb.style.top = `${v.offset}px`;
    this._verticalThumb.style.height = `${v.size}px`;

    this._horizontalTrack.setAttribute('aria-valuemin', '0');
    this._horizontalTrack.setAttribute('aria-valuemax', String(Math.round(state.maxScroll.x)));
    this._horizontalTrack.setAttribute('aria-valuenow', String(Math.round(state.scrollPosition.x)));
    this._verticalTrack.setAttribute('aria-valuemin', '0');
    this._verticalTrack.setAttribute('aria-valuemax', String(Math.round(state.maxScroll.y)));
    this._verticalTrack.setAttribute('aria-valuenow', String(Math.round(state.scrollPosition.y)));
  }

  private _syncZoom(zoom: number): void {
    if (!this._options.zoomControls) return;
    this._zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
    this._zoomOut.disabled = zoom <= 0.1;
    this._zoomIn.disabled = zoom >= 4;
  }

  private _applyVisibility(): void {
    this._horizontalTrack.style.display = this._options.scrollbars ? 'block' : 'none';
    this._verticalTrack.style.display = this._options.scrollbars ? 'block' : 'none';
    this._zoomStrip.style.display = this._options.zoomControls ? 'flex' : 'none';
  }
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
