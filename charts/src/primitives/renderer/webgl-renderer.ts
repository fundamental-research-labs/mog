/**
 * WebGL Renderer - High-performance rendering for large datasets
 *
 * Optimized for rendering 50K+ points efficiently using WebGL.
 * Falls back to Canvas2D if WebGL is unavailable.
 *
 * Primary use case: Scatter plots with many data points.
 *
 * No framework dependencies - pure WebGL operations.
 */

import type { AnyMark, SymbolMark } from '../types';
import type { Renderer } from './canvas-renderer';
import { CanvasRenderer } from './canvas-renderer';

// =============================================================================
// WebGL Shader Sources
// =============================================================================

const VERTEX_SHADER_SOURCE = `
  attribute vec2 a_position;
  attribute float a_size;
  attribute vec4 a_color;

  uniform vec2 u_resolution;

  varying vec4 v_color;

  void main() {
    // Convert from pixels to clip space
    vec2 clipSpace = ((a_position / u_resolution) * 2.0 - 1.0) * vec2(1, -1);
    gl_Position = vec4(clipSpace, 0, 1);
    gl_PointSize = a_size;
    v_color = a_color;
  }
`;

const FRAGMENT_SHADER_SOURCE = `
  precision mediump float;

  varying vec4 v_color;

  void main() {
    // Create circular points
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord);

    if (dist > 0.5) {
      discard;
    }

    // Smooth edge for anti-aliasing
    float alpha = 1.0 - smoothstep(0.4, 0.5, dist);
    gl_FragColor = vec4(v_color.rgb, v_color.a * alpha);
  }
`;

// =============================================================================
// Color Parsing
// =============================================================================

/** Default gray fallback color */
const DEFAULT_GRAY: [number, number, number, number] = [0.5, 0.5, 0.5, 1.0];

/**
 * Named CSS colors mapped to their hex values.
 * Includes the 17 standard CSS colors plus commonly used extended colors.
 */
const CSS_NAMED_COLORS: Record<string, string> = {
  // 17 standard CSS colors
  aqua: '#00ffff',
  black: '#000000',
  blue: '#0000ff',
  fuchsia: '#ff00ff',
  gray: '#808080',
  green: '#008000',
  lime: '#00ff00',
  maroon: '#800000',
  navy: '#000080',
  olive: '#808000',
  orange: '#ffa500',
  purple: '#800080',
  red: '#ff0000',
  silver: '#c0c0c0',
  teal: '#008080',
  white: '#ffffff',
  yellow: '#ffff00',
  // Common extended colors
  aliceblue: '#f0f8ff',
  antiquewhite: '#faebd7',
  aquamarine: '#7fffd4',
  azure: '#f0ffff',
  beige: '#f5f5dc',
  bisque: '#ffe4c4',
  blanchedalmond: '#ffebcd',
  blueviolet: '#8a2be2',
  brown: '#a52a2a',
  burlywood: '#deb887',
  cadetblue: '#5f9ea0',
  chartreuse: '#7fff00',
  chocolate: '#d2691e',
  coral: '#ff7f50',
  cornflowerblue: '#6495ed',
  cornsilk: '#fff8dc',
  crimson: '#dc143c',
  cyan: '#00ffff',
  darkblue: '#00008b',
  darkcyan: '#008b8b',
  darkgoldenrod: '#b8860b',
  darkgray: '#a9a9a9',
  darkgreen: '#006400',
  darkgrey: '#a9a9a9',
  darkkhaki: '#bdb76b',
  darkmagenta: '#8b008b',
  darkolivegreen: '#556b2f',
  darkorange: '#ff8c00',
  darkorchid: '#9932cc',
  darkred: '#8b0000',
  darksalmon: '#e9967a',
  darkseagreen: '#8fbc8f',
  darkslateblue: '#483d8b',
  darkslategray: '#2f4f4f',
  darkslategrey: '#2f4f4f',
  darkturquoise: '#00ced1',
  darkviolet: '#9400d3',
  deeppink: '#ff1493',
  deepskyblue: '#00bfff',
  dimgray: '#696969',
  dimgrey: '#696969',
  dodgerblue: '#1e90ff',
  firebrick: '#b22222',
  floralwhite: '#fffaf0',
  forestgreen: '#228b22',
  gainsboro: '#dcdcdc',
  ghostwhite: '#f8f8ff',
  gold: '#ffd700',
  goldenrod: '#daa520',
  greenyellow: '#adff2f',
  grey: '#808080',
  honeydew: '#f0fff0',
  hotpink: '#ff69b4',
  indianred: '#cd5c5c',
  indigo: '#4b0082',
  ivory: '#fffff0',
  khaki: '#f0e68c',
  lavender: '#e6e6fa',
  lavenderblush: '#fff0f5',
  lawngreen: '#7cfc00',
  lemonchiffon: '#fffacd',
  lightblue: '#add8e6',
  lightcoral: '#f08080',
  lightcyan: '#e0ffff',
  lightgoldenrodyellow: '#fafad2',
  lightgray: '#d3d3d3',
  lightgreen: '#90ee90',
  lightgrey: '#d3d3d3',
  lightpink: '#ffb6c1',
  lightsalmon: '#ffa07a',
  lightseagreen: '#20b2aa',
  lightskyblue: '#87cefa',
  lightslategray: '#778899',
  lightslategrey: '#778899',
  lightsteelblue: '#b0c4de',
  lightyellow: '#ffffe0',
  limegreen: '#32cd32',
  linen: '#faf0e6',
  magenta: '#ff00ff',
  mediumaquamarine: '#66cdaa',
  mediumblue: '#0000cd',
  mediumorchid: '#ba55d3',
  mediumpurple: '#9370db',
  mediumseagreen: '#3cb371',
  mediumslateblue: '#7b68ee',
  mediumspringgreen: '#00fa9a',
  mediumturquoise: '#48d1cc',
  mediumvioletred: '#c71585',
  midnightblue: '#191970',
  mintcream: '#f5fffa',
  mistyrose: '#ffe4e1',
  moccasin: '#ffe4b5',
  navajowhite: '#ffdead',
  oldlace: '#fdf5e6',
  olivedrab: '#6b8e23',
  orangered: '#ff4500',
  orchid: '#da70d6',
  palegoldenrod: '#eee8aa',
  palegreen: '#98fb98',
  paleturquoise: '#afeeee',
  palevioletred: '#db7093',
  papayawhip: '#ffefd5',
  peachpuff: '#ffdab9',
  peru: '#cd853f',
  pink: '#ffc0cb',
  plum: '#dda0dd',
  powderblue: '#b0e0e6',
  rosybrown: '#bc8f8f',
  royalblue: '#4169e1',
  saddlebrown: '#8b4513',
  salmon: '#fa8072',
  sandybrown: '#f4a460',
  seagreen: '#2e8b57',
  seashell: '#fff5ee',
  sienna: '#a0522d',
  skyblue: '#87ceeb',
  slateblue: '#6a5acd',
  slategray: '#708090',
  slategrey: '#708090',
  snow: '#fffafa',
  springgreen: '#00ff7f',
  steelblue: '#4682b4',
  tan: '#d2b48c',
  thistle: '#d8bfd8',
  tomato: '#ff6347',
  turquoise: '#40e0d0',
  violet: '#ee82ee',
  wheat: '#f5deb3',
  whitesmoke: '#f5f5f5',
  yellowgreen: '#9acd32',
};

/**
 * Clamp a number to the [0, 1] range.
 */
function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Parse a CSS color string to RGBA values (0-1 range).
 *
 * Supports:
 * - Hex colors: #rgb, #rrggbb, #rrggbbaa
 * - rgb()/rgba() functional notation
 * - Named CSS colors (e.g., "red", "steelblue", "coral")
 * - "transparent" keyword
 *
 * Returns default gray [0.5, 0.5, 0.5, 1.0] for undefined/empty/unrecognized input.
 * All channel values are clamped to [0, 1]. Invalid hex digits fall back to default gray.
 */
export function parseColor(color: string | undefined): [number, number, number, number] {
  if (!color) {
    return [...DEFAULT_GRAY] as [number, number, number, number];
  }

  // Handle "transparent" keyword
  if (color === 'transparent') {
    return [0, 0, 0, 0];
  }

  // Handle hex colors
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    let r: number, g: number, b: number, a: number;
    if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16) / 255;
      g = parseInt(hex[1] + hex[1], 16) / 255;
      b = parseInt(hex[2] + hex[2], 16) / 255;
      a = 1.0;
    } else if (hex.length === 6) {
      r = parseInt(hex.slice(0, 2), 16) / 255;
      g = parseInt(hex.slice(2, 4), 16) / 255;
      b = parseInt(hex.slice(4, 6), 16) / 255;
      a = 1.0;
    } else if (hex.length === 8) {
      r = parseInt(hex.slice(0, 2), 16) / 255;
      g = parseInt(hex.slice(2, 4), 16) / 255;
      b = parseInt(hex.slice(4, 6), 16) / 255;
      a = parseInt(hex.slice(6, 8), 16) / 255;
    } else {
      // Invalid hex length — fall back to default
      return [...DEFAULT_GRAY] as [number, number, number, number];
    }
    // Guard against NaN from invalid hex characters (e.g., "#zzz")
    if (isNaN(r) || isNaN(g) || isNaN(b) || isNaN(a)) {
      return [...DEFAULT_GRAY] as [number, number, number, number];
    }
    return [clamp01(r), clamp01(g), clamp01(b), clamp01(a)];
  }

  // Handle rgb()/rgba() functional notation
  const rgbaMatch = color.match(
    /rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/,
  );
  if (rgbaMatch) {
    const r = clamp01(parseInt(rgbaMatch[1], 10) / 255);
    const g = clamp01(parseInt(rgbaMatch[2], 10) / 255);
    const b = clamp01(parseInt(rgbaMatch[3], 10) / 255);
    const a = rgbaMatch[4] ? clamp01(parseFloat(rgbaMatch[4])) : 1.0;
    return [r, g, b, a];
  }

  // Handle named CSS colors
  const namedHex = CSS_NAMED_COLORS[color.toLowerCase()];
  if (namedHex) {
    // Named colors are always valid 6-digit hex, so we can parse safely
    const hex = namedHex.slice(1);
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    return [r, g, b, 1.0];
  }

  // Default fallback
  return [...DEFAULT_GRAY] as [number, number, number, number];
}

// =============================================================================
// WebGL Renderer Implementation
// =============================================================================

/**
 * WebGL renderer optimized for large point datasets.
 *
 * Usage:
 * ```ts
 * const canvas = document.createElement('canvas');
 * const renderer = new WebGLRenderer(canvas);
 * if (renderer.isWebGLAvailable()) {
 *   renderer.resize(800, 600);
 *   renderer.render(symbolMarks);
 * }
 * ```
 */
export class WebGLRenderer implements Renderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private width: number = 0;
  private height: number = 0;
  private dpr: number;

  // Attribute locations
  private positionLocation: number = -1;
  private sizeLocation: number = -1;
  private colorLocation: number = -1;
  private resolutionLocation: WebGLUniformLocation | null = null;

  // Buffers
  private positionBuffer: WebGLBuffer | null = null;
  private sizeBuffer: WebGLBuffer | null = null;
  private colorBuffer: WebGLBuffer | null = null;

  // Fallback renderer uses a SEPARATE canvas to avoid the single-context-type
  // browser restriction.  The WebGL canvas keeps its 'webgl' context; the
  // fallback canvas gets a '2d' context.
  private fallbackCanvas: HTMLCanvasElement | null = null;
  private fallbackRenderer: CanvasRenderer | null = null;

  constructor(canvas: HTMLCanvasElement, options: { devicePixelRatio?: number } = {}) {
    this.canvas = canvas;
    this.dpr =
      options.devicePixelRatio ??
      (typeof window !== 'undefined' ? window.devicePixelRatio : 1) ??
      1;

    this.initWebGL();
  }

  /**
   * Initialize WebGL context and shaders.
   */
  private initWebGL(): void {
    try {
      this.gl = this.canvas.getContext('webgl', {
        alpha: true,
        antialias: true,
        premultipliedAlpha: false,
      });

      if (!this.gl) {
        console.warn('WebGL not available, will use Canvas2D fallback');
        return;
      }

      // Create shaders
      const vertexShader = this.createShader(this.gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
      const fragmentShader = this.createShader(this.gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);

      if (!vertexShader || !fragmentShader) {
        this.gl = null;
        return;
      }

      // Create program
      this.program = this.createProgram(vertexShader, fragmentShader);
      if (!this.program) {
        this.gl = null;
        return;
      }

      // Get attribute and uniform locations
      this.positionLocation = this.gl.getAttribLocation(this.program, 'a_position');
      this.sizeLocation = this.gl.getAttribLocation(this.program, 'a_size');
      this.colorLocation = this.gl.getAttribLocation(this.program, 'a_color');
      this.resolutionLocation = this.gl.getUniformLocation(this.program, 'u_resolution');

      // Create buffers
      this.positionBuffer = this.gl.createBuffer();
      this.sizeBuffer = this.gl.createBuffer();
      this.colorBuffer = this.gl.createBuffer();

      // Enable blending for transparency
      this.gl.enable(this.gl.BLEND);
      this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
    } catch (e) {
      console.warn('WebGL initialization failed:', e);
      this.gl = null;
    }
  }

  /**
   * Create a separate canvas element for the Canvas2D fallback renderer.
   *
   * A single canvas element can only have one context type (webgl OR 2d), so
   * the fallback renderer needs its own canvas.  If the primary canvas is in
   * the DOM we insert the fallback canvas as a sibling positioned on top.
   * Otherwise (e.g. in tests or offscreen usage) we just create a detached
   * canvas with matching dimensions.
   */
  private createFallbackCanvas(): HTMLCanvasElement {
    const fallback = document.createElement('canvas');

    // Match the primary canvas dimensions
    fallback.width = this.canvas.width;
    fallback.height = this.canvas.height;
    fallback.style.width = this.canvas.style.width;
    fallback.style.height = this.canvas.style.height;

    // If the primary canvas is in the DOM, overlay the fallback on top of it.
    if (this.canvas.parentElement) {
      // Ensure the parent can act as a positioning context
      const parentStyle = getComputedStyle(this.canvas.parentElement);
      if (parentStyle.position === 'static') {
        this.canvas.parentElement.style.position = 'relative';
      }

      // Position the primary canvas so the fallback can stack on top
      this.canvas.style.position = 'absolute';
      this.canvas.style.left = '0';
      this.canvas.style.top = '0';

      fallback.style.position = 'absolute';
      fallback.style.left = '0';
      fallback.style.top = '0';
      fallback.style.pointerEvents = 'none'; // Let events pass through to the primary canvas

      // Insert fallback right after the primary canvas so it renders on top
      this.canvas.parentElement.insertBefore(fallback, this.canvas.nextSibling);
    }

    return fallback;
  }

  /**
   * Create a WebGL shader.
   */
  private createShader(type: number, source: string): WebGLShader | null {
    if (!this.gl) return null;

    const shader = this.gl.createShader(type);
    if (!shader) return null;

    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);

    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      console.warn('Shader compilation error:', this.gl.getShaderInfoLog(shader));
      this.gl.deleteShader(shader);
      return null;
    }

    return shader;
  }

  /**
   * Create a WebGL program from vertex and fragment shaders.
   */
  private createProgram(
    vertexShader: WebGLShader,
    fragmentShader: WebGLShader,
  ): WebGLProgram | null {
    if (!this.gl) return null;

    const program = this.gl.createProgram();
    if (!program) return null;

    this.gl.attachShader(program, vertexShader);
    this.gl.attachShader(program, fragmentShader);
    this.gl.linkProgram(program);

    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      console.warn('Program link error:', this.gl.getProgramInfoLog(program));
      this.gl.deleteProgram(program);
      return null;
    }

    return program;
  }

  /**
   * Check if WebGL is available and initialized.
   */
  isWebGLAvailable(): boolean {
    return this.gl !== null && this.program !== null;
  }

  /**
   * Render marks. Only symbol marks with shape 'circle' are rendered with WebGL.
   * Other marks fall back to Canvas2D.
   */
  render(marks: AnyMark[]): void {
    // Separate circle symbols from other marks
    const circleSymbols: SymbolMark[] = [];
    const otherMarks: AnyMark[] = [];

    for (const mark of marks) {
      if (mark.type === 'symbol' && mark.shape === 'circle') {
        circleSymbols.push(mark);
      } else {
        otherMarks.push(mark);
      }
    }

    // Render circles with WebGL if available and there are many
    if (this.isWebGLAvailable() && circleSymbols.length > 0) {
      this.renderPoints(circleSymbols);
    }

    // Fall back to Canvas2D for other marks or if WebGL not available.
    // IMPORTANT: We must use a SEPARATE canvas for the 2D fallback because a
    // canvas element can only have one context type.  Calling getContext('2d')
    // on a canvas that already has a 'webgl' context returns null in most
    // browsers, which would silently break all non-circle mark rendering.
    if (otherMarks.length > 0 || (!this.isWebGLAvailable() && circleSymbols.length > 0)) {
      if (!this.fallbackRenderer) {
        this.fallbackCanvas = this.createFallbackCanvas();
        this.fallbackRenderer = new CanvasRenderer(this.fallbackCanvas, {
          devicePixelRatio: this.dpr,
        });
        this.fallbackRenderer.resize(this.width, this.height);
      }

      const fallbackMarks = this.isWebGLAvailable() ? otherMarks : marks;
      this.fallbackRenderer.render(fallbackMarks);
    }
  }

  /**
   * Render circle symbols using WebGL GL_POINTS.
   */
  private renderPoints(symbols: SymbolMark[]): void {
    const gl = this.gl!;
    const program = this.program!;

    // Clear with transparent background
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(program);

    // Set resolution uniform
    gl.uniform2f(this.resolutionLocation, this.width, this.height);

    // Prepare data arrays
    const positions = new Float32Array(symbols.length * 2);
    const sizes = new Float32Array(symbols.length);
    const colors = new Float32Array(symbols.length * 4);

    for (let i = 0; i < symbols.length; i++) {
      const s = symbols[i];
      positions[i * 2] = s.x;
      positions[i * 2 + 1] = s.y;

      // Convert size (area) to diameter for gl_PointSize
      sizes[i] = Math.sqrt(s.size / Math.PI) * 2 * this.dpr;

      const [r, g, b, a] = parseColor(s.style?.fill);
      const opacity = s.style?.opacity ?? 1.0;
      colors[i * 4] = r;
      colors[i * 4 + 1] = g;
      colors[i * 4 + 2] = b;
      colors[i * 4 + 3] = a * opacity;
    }

    // Upload position data
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.positionLocation);
    gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);

    // Upload size data
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sizeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, sizes, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.sizeLocation);
    gl.vertexAttribPointer(this.sizeLocation, 1, gl.FLOAT, false, 0, 0);

    // Upload color data
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.colorLocation);
    gl.vertexAttribPointer(this.colorLocation, 4, gl.FLOAT, false, 0, 0);

    // Draw points
    gl.drawArrays(gl.POINTS, 0, symbols.length);
  }

  /**
   * Clear the canvas.
   */
  clear(): void {
    if (this.gl) {
      this.gl.clearColor(0, 0, 0, 0);
      this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    }
    if (this.fallbackRenderer) {
      this.fallbackRenderer.clear();
    }
  }

  /**
   * Resize the canvas.
   */
  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;

    // Set physical size
    this.canvas.width = Math.floor(width * this.dpr);
    this.canvas.height = Math.floor(height * this.dpr);

    // Set CSS size
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;

    if (this.gl) {
      this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }

    // Keep the fallback canvas in sync
    if (this.fallbackCanvas) {
      this.fallbackCanvas.style.width = `${width}px`;
      this.fallbackCanvas.style.height = `${height}px`;
    }
    if (this.fallbackRenderer) {
      this.fallbackRenderer.resize(width, height);
    }
  }

  /**
   * Clean up WebGL resources.
   */
  destroy(): void {
    if (this.gl) {
      if (this.positionBuffer) this.gl.deleteBuffer(this.positionBuffer);
      if (this.sizeBuffer) this.gl.deleteBuffer(this.sizeBuffer);
      if (this.colorBuffer) this.gl.deleteBuffer(this.colorBuffer);
      if (this.program) this.gl.deleteProgram(this.program);
    }

    if (this.fallbackRenderer) {
      this.fallbackRenderer.destroy();
    }

    // Remove the fallback canvas from the DOM if it was inserted
    if (this.fallbackCanvas && this.fallbackCanvas.parentElement) {
      this.fallbackCanvas.parentElement.removeChild(this.fallbackCanvas);
    }
    this.fallbackCanvas = null;
    this.fallbackRenderer = null;
  }

  /**
   * Get the primary (WebGL) canvas element.
   */
  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  /**
   * Get the fallback (Canvas2D) canvas element, if one has been created.
   * Returns null if no non-circle marks have been rendered yet.
   */
  getFallbackCanvas(): HTMLCanvasElement | null {
    return this.fallbackCanvas;
  }

  /**
   * Get current logical width.
   */
  getWidth(): number {
    return this.width;
  }

  /**
   * Get current logical height.
   */
  getHeight(): number {
    return this.height;
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a WebGL renderer with Canvas2D fallback.
 */
export function createWebGLRenderer(
  canvas: HTMLCanvasElement,
  options: { devicePixelRatio?: number } = {},
): WebGLRenderer {
  return new WebGLRenderer(canvas, options);
}

/**
 * Check if the current environment supports WebGL.
 */
export function isWebGLSupported(): boolean {
  if (typeof document === 'undefined') return false;

  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl');
    return gl !== null;
  } catch (e) {
    return false;
  }
}
