/**
 * TextEffect Rendering Bridge Implementation
 *
 * Thin coordination layer that:
 * 1. Fetches TextEffect object from store
 * 2. Measures glyphs (simple estimation)
 * 3. Calls warpToDrawingObjects() from @mog/text-effects-engine
 * 4. Caches the DrawingObject[] result
 *
 * Rendering is NOT done here — the bridge provides DrawingObject[],
 * and the scene graph renders them.
 *
 * @see contracts/src/bridges/text-effect-rendering-bridge.ts - Interface
 */

import type { ITextEffectRenderingBridge } from '@mog-sdk/contracts/bridges';
import type { DrawingObject } from '@mog-sdk/contracts/drawing';
import type {
  FloatingObjectResizedEvent,
  FloatingObjectUpdatedEvent,
  TextEffectConvertedEvent,
  TextEffectCreatedEvent,
  TextEffectRemovedEvent,
  TextEffectUpdatedEvent,
} from '@mog-sdk/contracts/events';
import type { IKernelContext } from '@mog-sdk/contracts/kernel';
import type { TextEffectConfig, TextEffectFill } from '@mog-sdk/contracts/text-effects';
import type { GlyphBox, TextEffectStyle } from '@mog/text-effects-engine';
import { warpToDrawingObjects } from '@mog/text-effects-engine';
import type { DocumentContext } from '../../context/types';

// =============================================================================
// Types
// =============================================================================

/** Cache entry storing DrawingObject[] with change-detection metadata. */
interface CacheEntry {
  drawingObjects: DrawingObject[];
  configHash: string;
  text: string;
  bounds: { width: number; height: number };
  timestamp: number;
}

/** TextBox object with optional TextEffect config. */
interface TextBoxWithTextEffect {
  [key: string]: unknown;
  id: string;
  type: 'textbox';
  sheetId: string;
  text?: {
    content?: string;
    format?: {
      fontFamily?: string;
      fontSize?: number;
      fontWeight?: string | number;
      fontStyle?: string;
    };
  };
  position?: { width?: number; height?: number; x?: number; y?: number };
  textEffects?: TextEffectConfig;
}

// =============================================================================
// Helpers
// =============================================================================

/** Stable hash of a TextEffectConfig for cache comparison. */
function hashConfig(config: TextEffectConfig): string {
  return JSON.stringify(config, (_, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.keys(value)
        .sort()
        .reduce(
          (sorted, key) => {
            sorted[key] = value[key];
            return sorted;
          },
          {} as Record<string, unknown>,
        );
    }
    return value;
  });
}

/** Create GlyphBox[] from text using simple width estimation. */
function measureGlyphs(text: string, fontSize: number): GlyphBox[] {
  const glyphs: GlyphBox[] = [];
  let x = 0;
  const ascent = fontSize * 0.8;
  const descent = fontSize * 0.2;
  for (const ch of text) {
    const width = fontSize * 0.6;
    glyphs.push({ x, y: ascent, width, height: fontSize, ascent, descent, char: ch });
    x += width;
  }
  return glyphs;
}

/** Map TextEffectConfig fill to TextEffectStyle (engine format). */
function mapConfigFill(fill: TextEffectFill): TextEffectStyle['fill'] {
  switch (fill.type) {
    case 'solid':
      return { type: 'solid', color: fill.color };
    case 'gradient':
      return {
        type: 'gradient',
        gradient: {
          type: fill.gradientType === 'radial' ? 'radial' : 'linear',
          angle: fill.angle,
          stops: fill.stops.map((s) => ({ position: s.position, color: s.color })),
        },
      };
    case 'none':
      return { type: 'none' };
    default:
      // pattern fills fall through to solid black
      return { type: 'solid', color: '#000000' };
  }
}

/** Map TextEffectConfig to engine's TextEffectStyle. */
function mapToTextEffectStyle(config: TextEffectConfig): TextEffectStyle {
  return {
    fill: mapConfigFill(config.fill),
    outline: config.outline
      ? { color: config.outline.color, width: config.outline.width ?? 1 }
      : undefined,
    shadow: undefined, // Shadows handled via ooxmlEffects
  };
}

// =============================================================================
// TextEffect Rendering Bridge
// =============================================================================

export class TextEffectRenderingBridge implements ITextEffectRenderingBridge {
  private readonly ctx: IKernelContext;
  private readonly cache: Map<string, CacheEntry> = new Map();
  private readonly eventUnsubscribers: Array<() => void> = [];
  private readonly cacheMaxAge = 5000;
  private readonly cacheMaxSize = 100;
  private started = false;

  constructor(ctx: IKernelContext) {
    this.ctx = ctx;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  start(): () => void {
    if (this.started) return () => this.stop();
    this.started = true;
    this.setupEventListeners();
    return () => this.stop();
  }

  stop(): void {
    this.eventUnsubscribers.forEach((fn) => fn());
    this.eventUnsubscribers.length = 0;
    this.cache.clear();
    this.started = false;
  }

  destroy(): void {
    this.stop();
  }

  // ---------------------------------------------------------------------------
  // Computation
  // ---------------------------------------------------------------------------

  async computeDrawingObjects(
    objectId: string,
    bounds?: { width: number; height: number },
  ): Promise<DrawingObject[] | null> {
    const object = await this.getTextEffectObject(objectId);
    if (!object?.textEffects) return null;

    const text = object.text?.content ?? '';
    const config = object.textEffects;
    const renderBounds = bounds ?? this.getObjectBounds(object);

    // Check cache
    const cached = this.cache.get(objectId);
    const currentHash = hashConfig(config);
    if (
      cached &&
      cached.configHash === currentHash &&
      cached.text === text &&
      cached.bounds.width === renderBounds.width &&
      cached.bounds.height === renderBounds.height &&
      Date.now() - cached.timestamp < this.cacheMaxAge
    ) {
      return cached.drawingObjects;
    }

    // Build inputs for the engine
    const fontSize = object.text?.format?.fontSize ?? 36;
    const glyphs = measureGlyphs(text, fontSize);
    const style = mapToTextEffectStyle(config);
    const adj = config.warpAdjustments?.adj1;

    // Compute DrawingObjects via the engine
    const drawingObjects = warpToDrawingObjects(
      glyphs,
      config.warpPreset,
      renderBounds.width,
      renderBounds.height,
      adj,
      style,
      config.effects,
    );

    // Cache result
    this.cache.set(objectId, {
      drawingObjects,
      configHash: currentHash,
      text,
      bounds: renderBounds,
      timestamp: Date.now(),
    });
    this.evictOldEntries();

    return drawingObjects;
  }

  // ---------------------------------------------------------------------------
  // Cache Management
  // ---------------------------------------------------------------------------

  invalidateCache(objectId: string): void {
    this.cache.delete(objectId);
  }

  clearCache(): void {
    this.cache.clear();
  }

  private evictOldEntries(): void {
    if (this.cache.size <= this.cacheMaxSize) return;
    const entries = Array.from(this.cache.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toRemove = entries.slice(0, this.cache.size - this.cacheMaxSize);
    for (const [key] of toRemove) {
      this.cache.delete(key);
    }
  }

  // ---------------------------------------------------------------------------
  // Event Listeners
  // ---------------------------------------------------------------------------

  private setupEventListeners(): void {
    const { eventBus } = this.ctx;

    const unsubCreated = eventBus.on('textEffectsCreated', (event) => {
      this.invalidateCache((event as TextEffectCreatedEvent).payload.objectId);
    });
    this.eventUnsubscribers.push(unsubCreated);

    const unsubUpdated = eventBus.on('textEffectsUpdated', (event) => {
      this.invalidateCache((event as TextEffectUpdatedEvent).payload.objectId);
    });
    this.eventUnsubscribers.push(unsubUpdated);

    const unsubRemoved = eventBus.on('textEffectsRemoved', (event) => {
      this.invalidateCache((event as TextEffectRemovedEvent).payload.objectId);
    });
    this.eventUnsubscribers.push(unsubRemoved);

    const unsubConverted = eventBus.on('textEffectsConverted', (event) => {
      this.invalidateCache((event as TextEffectConvertedEvent).payload.objectId);
    });
    this.eventUnsubscribers.push(unsubConverted);

    const unsubFloatingUpdated = eventBus.on('floatingObject:updated', (event) => {
      this.invalidateCache((event as FloatingObjectUpdatedEvent).objectId);
    });
    this.eventUnsubscribers.push(unsubFloatingUpdated);

    const unsubFloatingResized = eventBus.on('floatingObject:resized', (event) => {
      this.invalidateCache((event as FloatingObjectResizedEvent).objectId);
    });
    this.eventUnsubscribers.push(unsubFloatingResized);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async getTextEffectObject(objectId: string): Promise<TextBoxWithTextEffect | undefined> {
    try {
      const allSheetIds = await (this.ctx as DocumentContext).computeBridge.getAllSheetIds();
      for (const sheetId of allSheetIds) {
        const obj = await (this.ctx as DocumentContext).computeBridge.getFloatingObject(
          sheetId,
          objectId,
        );
        if (!obj || typeof obj !== 'object') continue;

        const typedObj = obj as Record<string, unknown>;
        if (typedObj['type'] !== 'textbox') continue;

        const textEffects = typedObj['textEffects'];
        if (textEffects) {
          return {
            ...typedObj,
            textEffects: textEffects as TextEffectConfig,
          } as TextBoxWithTextEffect;
        }

        return typedObj as TextBoxWithTextEffect;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  private getObjectBounds(object: TextBoxWithTextEffect): { width: number; height: number } {
    const pos = object.position;
    if (pos?.width !== undefined && pos?.height !== undefined) {
      return { width: pos.width, height: pos.height };
    }
    return { width: 200, height: 50 };
  }

  getFillColor(config: TextEffectConfig): string {
    const fill = config.fill;
    if (!fill) return '#000000';
    if (fill.type === 'solid' && fill.color) return fill.color;
    if (fill.type === 'gradient' && fill.stops?.length > 0) return fill.stops[0].color;
    return '#000000';
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createTextEffectRenderingBridge(ctx: IKernelContext): TextEffectRenderingBridge {
  return new TextEffectRenderingBridge(ctx);
}
