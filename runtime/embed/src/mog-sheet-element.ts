/**
 * <mog-sheet> -- Web Component for embedding a read-only Mog spreadsheet.
 *
 * Usage:
 *   <script type="module" src="https://assets.sheetmog.ai/v/0.1.0/embed.js"></script>
 *   const sheet = document.querySelector('mog-sheet');
 *   sheet.config = config;
 *   sheet.hostPolicy = hostPolicy;
 *
 * Boolean attributes use the no-* pattern (opt-out):
 *   <mog-sheet no-headers no-gridlines></mog-sheet>
 */

import { createEmbedRenderer } from './renderer/index';
import type { EmbedRenderOrchestrator } from './renderer/index';
import {
  createWebComponentEmbedHost,
  type WebComponentEmbedHostResult,
} from './host-adapters/web-component-same-page-host';
import type {
  EmbedMode,
  MogEmbedConfig,
  MogEmbedEffectiveState,
  MogEmbedHostPolicy,
} from './config';
import { assertValidMogEmbedConfig } from './config';

// ---------------------------------------------------------------------------
// MogSheetElement
// ---------------------------------------------------------------------------

export class MogSheetElement extends HTMLElement {
  static observedAttributes = [
    'src',
    'sheet',
    'width',
    'height',
    'no-headers',
    'no-gridlines',
    'no-sheet-tabs',
    'no-formula-bar',
    'no-scroll',
    'no-scrollbars',
    'no-zoom-controls',
    'mode',
    'locale',
  ];

  private _host: WebComponentEmbedHostResult | null = null;
  private _client: WebComponentEmbedHostResult['client'] | null = null;
  private _renderer: EmbedRenderOrchestrator | null = null;
  private _shadow: ShadowRoot;
  private _container: HTMLDivElement;
  private _readyResolve!: () => void;
  private _readyReject!: (err: Error) => void;
  private _config: MogEmbedConfig | null = null;
  private _hostPolicy: MogEmbedHostPolicy | null = null;
  private _effectiveState: MogEmbedEffectiveState | null = null;
  private _dirty = false;
  private _saveState: 'idle' | 'saving' | 'saved' | 'error' = 'idle';
  private _bootGeneration = 0;
  private _disposed = false;
  private _listenerDisposers: Array<() => void> = [];
  private _ownedFallbackHeight = false;

  /** Resolves when the spreadsheet is loaded and rendered. */
  ready: Promise<void>;

  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: 'open' });

    // Scoped styles
    const style = document.createElement('style');
    style.textContent = `
      :host {
        display: block;
        position: relative;
        overflow: hidden;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      }
      :host([hidden]) { display: none; }
      .mog-container {
        width: 100%;
        height: 100%;
        position: relative;
        display: flex;
        flex-direction: column;
      }
      .mog-loading {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #FAFAFA;
        font-size: 14px;
        color: #999;
      }
    `;
    this._shadow.appendChild(style);

    // Container for renderer
    this._container = document.createElement('div');
    this._container.className = 'mog-container';
    this._shadow.appendChild(this._container);

    // Ready promise
    this.ready = new Promise<void>((resolve, reject) => {
      this._readyResolve = resolve;
      this._readyReject = reject;
    });
  }

  // -------------------------------------------------------------------------
  // Public DOM properties
  // -------------------------------------------------------------------------

  get status(): string {
    return this._client?.status ?? 'loading';
  }

  get sheet(): string {
    return this.getAttribute('sheet') ?? '';
  }
  set sheet(value: string) {
    this.setAttribute('sheet', value);
  }

  get mode(): EmbedMode {
    return (this.getAttribute('mode') as EmbedMode) ?? 'readonly';
  }
  set mode(value: EmbedMode) {
    this.setAttribute('mode', value);
  }

  get locale(): string {
    return this.getAttribute('locale') ?? '';
  }
  set locale(value: string) {
    this.setAttribute('locale', value);
  }

  /**
   * Full configuration object. When set, overrides individual attribute values.
   * If `src` is set and `config` is not, a legacy source ref is created internally.
   */
  get config(): MogEmbedConfig | null {
    return this._config;
  }
  set config(value: MogEmbedConfig | null) {
    const prev = this._config;
    if (value) {
      assertValidMogEmbedConfig(value);
    }
    this._config = value;
    if (!this._disposed && value && value !== prev && this._hostPolicy) {
      this._teardown();
      this._resetReadyPromise();
      void this._bootFromConfig(value);
    }
  }

  get hostPolicy(): MogEmbedHostPolicy | null {
    return this._hostPolicy;
  }
  set hostPolicy(value: MogEmbedHostPolicy | null) {
    const prev = this._hostPolicy;
    this._hostPolicy = value;
    if (!this._disposed && value && value !== prev && this._config) {
      this._teardown();
      this._resetReadyPromise();
      void this._bootFromConfig(this._config);
    }
  }

  /** Read-only effective state snapshot (null before ready). */
  get effectiveState(): MogEmbedEffectiveState | null {
    return this._effectiveState;
  }

  getEffectiveState(): MogEmbedEffectiveState | null {
    return this._effectiveState;
  }

  // -------------------------------------------------------------------------
  // Public methods
  // -------------------------------------------------------------------------

  /** Focus the embedded sheet view. */
  focus(): void {
    this._container?.focus();
    (this._renderer as any)?.focus?.();
  }

  /** Request save through the host policy. */
  async requestSave(): Promise<boolean> {
    if (!this._host?.canRequestSave(this._effectiveState)) {
      this._emitCapabilityDenied('save', 'Save is not granted by the host policy');
      return false;
    }
    this._setSaveState('saving');
    try {
      const saved = await this._host.requestSave(this._effectiveState);
      this._setSaveState(saved ? 'saved' : 'error');
      if (saved) this._setDirty(false);
      return saved;
    } catch {
      this._setSaveState('error');
      return false;
    }
  }

  /** Request export through the host policy in the given format. */
  async requestExport(format: string): Promise<Blob | null> {
    if (!this._host?.canRequestExport(this._effectiveState)) {
      this._emitCapabilityDenied('export', 'Export is not granted by the host policy');
      return null;
    }
    return this._host.requestExport(format, this._effectiveState);
  }

  async setSheet(indexOrName: number | string): Promise<void> {
    if (!this._client || this._client.status !== 'ready') return;
    const ws = await this._client.setActiveSheet(indexOrName);
    this._renderer?.updateSheet(ws.getSheetId());
    // Update sheet tabs
    this._updateSheetTabs();
  }

  resize(): void {
    this._updateSize();
    this._renderer?.resize(this._container.clientWidth, this._container.clientHeight);
  }

  navigateToRange(range: string): void {
    if (!this._client || this._client.status !== 'ready') return;
    this._renderer?.navigateToRange?.(range);
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._teardown();
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  connectedCallback(): void {
    this._disposed = false;
    if (this._config && this._hostPolicy) {
      void this._bootFromConfig(this._config);
    } else if (this.getAttribute('src')) {
      const error = new Error(
        'Raw src attributes are no longer accepted; set config and hostPolicy.',
      );
      this._readyReject(error);
      this.dispatchEvent(new CustomEvent('mog-error', { detail: error }));
    }
  }

  disconnectedCallback(): void {
    this._teardown();
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue === newValue) return;

    switch (name) {
      case 'src':
        if (newValue) {
          const error = new Error(
            'Raw src attributes are no longer accepted; set config and hostPolicy.',
          );
          this._readyReject(error);
          this.dispatchEvent(new CustomEvent('mog-error', { detail: error }));
        }
        break;
      case 'sheet':
        if (newValue && this._client && this._client.status === 'ready') {
          const parsed = Number(newValue);
          this.setSheet(Number.isNaN(parsed) ? newValue : parsed);
        }
        break;
      case 'width':
      case 'height':
        this._updateSize();
        break;
      case 'no-headers':
      case 'no-gridlines':
      case 'no-sheet-tabs':
      case 'no-formula-bar':
      case 'no-scroll':
      case 'no-scrollbars':
      case 'no-zoom-controls': {
        // These require a full reboot to change renderer options
        if (this._client && this._config && this._hostPolicy) {
          this._teardown();
          this._resetReadyPromise();
          void this._bootFromConfig(this._config);
        }
        break;
      }
      case 'mode':
        // Mode change is recorded; effective state update is deferred to
        // the trusted adapter (public embed protocol). For now, update the local snapshot.
        this._updateEffectiveState();
        break;
      case 'locale':
        // Locale stored as attribute; no runtime effect yet.
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private _resetReadyPromise(): void {
    this.ready = new Promise<void>((resolve, reject) => {
      this._readyResolve = resolve;
      this._readyReject = reject;
    });
  }

  private async _bootFromConfig(config: MogEmbedConfig): Promise<void> {
    if (this._disposed) return;
    assertValidMogEmbedConfig(config);
    if (!this._hostPolicy) {
      throw new Error('A hostPolicy is required to resolve embed sources.');
    }
    const bootGeneration = this._bootGeneration;
    // Apply chrome overrides from config onto attributes (non-destructive)
    if (config.chrome) {
      if (config.chrome.headers === false && !this.hasAttribute('no-headers'))
        this.setAttribute('no-headers', '');
      if (config.chrome.gridlines === false && !this.hasAttribute('no-gridlines'))
        this.setAttribute('no-gridlines', '');
      if (config.chrome.sheetTabs === false && !this.hasAttribute('no-sheet-tabs'))
        this.setAttribute('no-sheet-tabs', '');
      if (config.chrome.formulaBar === false && !this.hasAttribute('no-formula-bar'))
        this.setAttribute('no-formula-bar', '');
      if (config.chrome.scrollbars === false && !this.hasAttribute('no-scrollbars'))
        this.setAttribute('no-scrollbars', '');
      if (config.chrome.zoomControls === false && !this.hasAttribute('no-zoom-controls'))
        this.setAttribute('no-zoom-controls', '');
    }
    if (config.requestedMode) this.setAttribute('mode', config.requestedMode);
    if (config.locale) this.setAttribute('locale', config.locale);
    if (config.sheet !== undefined) {
      this.setAttribute('sheet', String(config.sheet));
    }
    try {
      const sheetAttr = this.getAttribute('sheet') ?? undefined;
      const sheet = sheetAttr
        ? Number.isNaN(Number(sheetAttr))
          ? sheetAttr
          : Number(sheetAttr)
        : undefined;
      const host = await createWebComponentEmbedHost(config, this._hostPolicy, sheet);
      if (this._disposed || bootGeneration !== this._bootGeneration || this._config !== config) {
        host.dispose();
        return;
      }
      this._boot(host);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this._readyReject(error);
      this.dispatchEvent(new CustomEvent('mog-error', { detail: error }));
    }
  }

  private _boot(host: WebComponentEmbedHostResult): void {
    // Show loading indicator
    const loading = document.createElement('div');
    loading.className = 'mog-loading';
    loading.textContent = 'Loading spreadsheet\u2026';
    this._container.appendChild(loading);

    // Resolve renderer options from no-* attributes
    const rendererOpts = {
      headers: !this.hasAttribute('no-headers'),
      gridlines: !this.hasAttribute('no-gridlines'),
      formulaBar: !this.hasAttribute('no-formula-bar'),
      sheetTabs: !this.hasAttribute('no-sheet-tabs'),
      scrollable: !this.hasAttribute('no-scroll'),
      scrollbars: !this.hasAttribute('no-scrollbars'),
      zoomControls: !this.hasAttribute('no-zoom-controls'),
    };

    this._host = host;
    const client = host.client;
    this._client = client;

    // Create renderer (orchestrator)
    const renderer = createEmbedRenderer(this._container, rendererOpts);
    this._renderer = renderer;
    this._updateSize();

    // Wire client ready -> attach renderer
    const offReady = client.on('ready', () => {
      loading.remove();
      renderer.attach(client);
      this._updateSheetTabs();
      this._readyResolve();
      this.dispatchEvent(new CustomEvent('mog-ready'));
    });

    const offError = client.on('error', (err) => {
      loading.textContent = 'Failed to load spreadsheet';
      this._readyReject(err);
      this.dispatchEvent(new CustomEvent('mog-error', { detail: err }));
    });

    // Wire renderer events -> client + DOM events
    const offSheetChange = renderer.on('sheetChange', (index: number) => {
      this.setSheet(index);
      this.dispatchEvent(new CustomEvent('mog-sheet-change', { detail: { index } }));
    });

    const offCellSelect = renderer.on('cellSelect', (cell: { row: number; col: number }) => {
      renderer.setSelectedCell(cell.row, cell.col);
      this.dispatchEvent(new CustomEvent('mog-selection-change', { detail: cell }));
    });
    const offScrollChange = renderer.on('scrollChange', (event) => {
      this.dispatchEvent(new CustomEvent('mog-scroll-change', { detail: event }));
    });
    const offZoomChange = renderer.on('zoomChange', (event) => {
      this.dispatchEvent(new CustomEvent('mog-zoom-change', { detail: event }));
    });

    // Build initial effective state once ready
    const offEffectiveReady = client.on('ready', () => {
      this._updateEffectiveState();
    });
    this._listenerDisposers.push(
      offReady,
      offError,
      offSheetChange,
      offCellSelect,
      offScrollChange,
      offZoomChange,
      offEffectiveReady,
    );
  }

  private async _updateSheetTabs(): Promise<void> {
    if (!this._client || !this._renderer || this._client.status !== 'ready') return;
    try {
      const names = await this._client.getSheets();
      const activeIndex = this._client.getActiveSheet().getIndex();
      const sheets = names.map((name, i) => ({ name, index: i }));
      this._renderer.setSheets(sheets, activeIndex);
    } catch {
      // Ignore errors
    }
  }

  private _updateEffectiveState(): void {
    const dirty = this._dirty;
    const saveState = this._saveState;
    const config = this._config;
    if (!config || !this._hostPolicy) return;

    void this._host
      ?.resolveEffectiveState(dirty, saveState)
      .then((state) => {
        this._effectiveState = state;
        this.dispatchEvent(new CustomEvent('mog-effective-state-change', { detail: state }));
      })
      .catch((err) => {
        const error = err instanceof Error ? err : new Error(String(err));
        this.dispatchEvent(new CustomEvent('mog-error', { detail: error }));
      });
  }

  /** Update dirty flag and dispatch `mog-dirty-change` if it changed. */
  private _setDirty(dirty: boolean): void {
    if (this._dirty === dirty) return;
    this._dirty = dirty;
    this._updateEffectiveState();
    this.dispatchEvent(new CustomEvent('mog-dirty-change', { detail: { dirty } }));
  }

  /** Update save state and dispatch `mog-save-state-change` if it changed. */
  private _setSaveState(state: 'idle' | 'saving' | 'saved' | 'error'): void {
    if (this._saveState === state) return;
    this._saveState = state;
    this._updateEffectiveState();
    this.dispatchEvent(new CustomEvent('mog-save-state-change', { detail: { state } }));
  }

  /** Dispatch `mog-capability-denied` event. */
  private _emitCapabilityDenied(capability: string, reason?: string): void {
    this.dispatchEvent(
      new CustomEvent('mog-capability-denied', {
        detail: { capability, reason },
      }),
    );
  }

  private _teardown(): void {
    this._bootGeneration += 1;
    this._removeEventListeners();
    this._renderer?.dispose();
    this._renderer = null;
    this._host?.dispose();
    this._host = null;
    this._client = null;
    // Clear container children (keep the <style> in shadow root)
    while (this._container.firstChild) {
      this._container.removeChild(this._container.firstChild);
    }
  }

  private _removeEventListeners(): void {
    for (const off of this._listenerDisposers.splice(0)) {
      off();
    }
  }

  private _updateSize(): void {
    const w = this.getAttribute('width');
    const h = this.getAttribute('height');
    if (w) {
      this.style.width = toCssDimension(w);
    } else {
      this.style.width = '100%';
    }
    if (h) {
      this.style.height = toCssDimension(h);
      this._ownedFallbackHeight = false;
    } else if (this._ownedFallbackHeight || !this._hasResolvedAuthorHeight()) {
      // Keep the standalone default for bare <mog-sheet>, but do not override
      // host-authored CSS such as .sheet { height: 100%; } in framework hosts.
      this.style.height = '400px';
      this._ownedFallbackHeight = true;
    }
  }

  private _hasResolvedAuthorHeight(): boolean {
    if (!this.isConnected || typeof window === 'undefined') return false;
    const computed = window.getComputedStyle(this).height;
    if (!computed || computed === 'auto') return false;
    const height = Number.parseFloat(computed);
    return Number.isFinite(height) && height > 0;
  }
}

function toCssDimension(value: string): string {
  return /^-?\d+(\.\d+)?$/.test(value.trim()) ? `${value}px` : value;
}

// ---------------------------------------------------------------------------
// Auto-register
// ---------------------------------------------------------------------------

if (!customElements.get('mog-sheet')) {
  customElements.define('mog-sheet', MogSheetElement);
}
