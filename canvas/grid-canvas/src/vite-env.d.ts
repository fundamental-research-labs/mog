/// <reference types="vite/client" />

/**
 * Vite-specific type declarations for canvas-renderer.
 *
 * This file provides TypeScript support for Vite's special import suffixes.
 */

/**
 * CSS imports with ?inline suffix return the CSS content as a string.
 * This is used to bundle KaTeX CSS locally instead of loading from CDN.
 *
 * @see https://vitejs.dev/guide/features.html#disabling-css-injection-into-the-page
 */
declare module '*.css?inline' {
  const css: string;
  export default css;
}

declare module 'katex/dist/katex.min.css?inline' {
  const css: string;
  export default css;
}
