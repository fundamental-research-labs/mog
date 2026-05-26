/**
 * Bridge Registry
 *
 * Holds references to all rendering bridges. Bridges are injected at construction
 * via the DrawingBridgeConfig. Late-binding setters are provided for bridges that
 * may be lazily loaded (e.g., chart library loaded after initial render).
 *
 * Required bridges (chartBridge) throw on first render attempt if still null.
 * Optional bridges (diagram, textEffect, equation, ink) return null — renderers
 * draw placeholders.
 *
 * @module @mog/drawing-canvas/bridges/bridge-registry
 */

import type {
  AstToLatexFn,
  DrawingBridgeConfig,
  IChartRenderBridge,
  IInkAccessorForRendering,
  IDiagramRenderBridge,
  ITextEffectBridge,
} from './types';

export class BridgeRegistry {
  private _chartBridge: IChartRenderBridge | null;
  private _diagramBridge: IDiagramRenderBridge | null;
  private _textEffectBridge: ITextEffectBridge | null;
  private _astToLatexFn: AstToLatexFn | null;
  private _inkAccessor: IInkAccessorForRendering | null;

  constructor(config: DrawingBridgeConfig) {
    this._chartBridge = config.chartBridge;
    this._diagramBridge = config.diagramBridge;
    this._textEffectBridge = config.textEffectBridge;
    this._astToLatexFn = config.astToLatexFn;
    this._inkAccessor = config.inkAccessor;
  }

  // ===========================================================================
  // Required bridges — fail-fast
  // ===========================================================================

  /**
   * Get chart render bridge.
   * Throws if null — charts cannot render without it.
   */
  getChartBridge(): IChartRenderBridge {
    if (!this._chartBridge) {
      throw new Error(
        'ChartRenderBridge is required but not yet provided. ' +
          'Call setChartBridge() before rendering charts.',
      );
    }
    return this._chartBridge;
  }

  /** Check if chart bridge is available without throwing. */
  hasChartBridge(): boolean {
    return this._chartBridge !== null;
  }

  // ===========================================================================
  // Optional bridges — return null (renderers draw placeholders)
  // ===========================================================================

  getDiagramBridge(): IDiagramRenderBridge | null {
    return this._diagramBridge;
  }

  getTextEffectBridge(): ITextEffectBridge | null {
    return this._textEffectBridge;
  }

  getAstToLatexFn(): AstToLatexFn | null {
    return this._astToLatexFn;
  }

  getInkAccessor(): IInkAccessorForRendering | null {
    return this._inkAccessor;
  }

  // ===========================================================================
  // Late-binding setters (for lazily loaded bridges)
  // ===========================================================================

  setChartBridge(bridge: IChartRenderBridge): void {
    this._chartBridge = bridge;
  }

  setDiagramBridge(bridge: IDiagramRenderBridge): void {
    this._diagramBridge = bridge;
  }

  setTextEffectBridge(bridge: ITextEffectBridge): void {
    this._textEffectBridge = bridge;
  }

  setAstToLatexFn(fn: AstToLatexFn): void {
    this._astToLatexFn = fn;
  }

  setInkAccessor(accessor: IInkAccessorForRendering): void {
    this._inkAccessor = accessor;
  }
}
