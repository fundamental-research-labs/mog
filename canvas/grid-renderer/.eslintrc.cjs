/**
 * Canonical-formula enforcement for @mog/grid-renderer.
 *
 * Invariant 1: every doc⇄canvas coordinate transform MUST go through
 *   docToCanvas / canvasToDoc / docToCanvasXY / canvasToDocXY in
 *   canvas-engine/core/coordinate-space.ts. Helpers in shared/cell-bounds.ts
 *   compose those four — they never re-implement the formula. Renderer-layer
 *   files NEVER read `region.scrollOffset.x|y` or `region.viewportOrigin.x|y`
 *   directly, and they NEVER write inline `(docY − scrollOffset.y)` math.
 *
 * The two rules below close that invariant in this package. The allowlist
 * below is explicit and named — every file authorized to reach inside the
 * formula is enumerated.
 *
 * If you find yourself wanting to add a file to the allowlist, ask: does
 * this file *implement* the formula, or does it *consume* it? Consumers
 * compose the helpers in @mog/grid-renderer/shared/cell-bounds. Only the
 * helpers themselves (and the canvas-engine canonical functions) are
 * authorized to reach inside.
 */

const SCROLL_OFFSET_AXIS_READ = {
  selector:
    'MemberExpression[property.name=/^(x|y)$/][object.type="MemberExpression"][object.property.name="scrollOffset"]',
  message:
    'Direct `<region>.scrollOffset.x|y` reads are forbidden by the canonical coordinate invariant. ' +
    'Use docToCanvasXY / docToRegionXY / cellRectInRegion / snapDoc{X|Y}ToPixelGrid ' +
    'from @mog/grid-renderer/shared/cell-bounds (which compose docToCanvas).',
};

const VIEWPORT_ORIGIN_AXIS_READ = {
  selector:
    'MemberExpression[property.name=/^(x|y)$/][object.type="MemberExpression"][object.property.name="viewportOrigin"]',
  message:
    'Direct `<region>.viewportOrigin.x|y` reads are forbidden by the canonical coordinate invariant. ' +
    'The canonical helpers in @mog/canvas-engine and @mog/grid-renderer fold ' +
    'viewportOrigin into the formula; consumers must never read it inline.',
};

// Catches the indirect helper-signature variant: `getRowTop(row) - scrollOffset.y`.
// scrollOffset here is a local parameter (not `region.scrollOffset`), but the
// pattern `<expr> - scrollOffset.<x|y>` is the same architectural fault.
const SUBTRACT_SCROLL_OFFSET_AXIS = {
  selector:
    'BinaryExpression[operator="-"][right.type="MemberExpression"][right.object.name="scrollOffset"][right.property.name=/^(x|y)$/]',
  message:
    'Inline `<expr> - scrollOffset.x|y` math is forbidden by the canonical coordinate invariant. ' +
    'Helpers must compose docToCanvas/docToCanvasXY rather than re-implement the formula. ' +
    'Convert your helper signature to take `region: RenderRegion` and call ' +
    'docToRegionXY / cellRectInRegion / snapDoc{X|Y}ToPixelGrid.',
};

module.exports = {
  root: false,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  rules: {
    'no-restricted-syntax': [
      'error',
      SCROLL_OFFSET_AXIS_READ,
      VIEWPORT_ORIGIN_AXIS_READ,
      SUBTRACT_SCROLL_OFFSET_AXIS,
    ],
  },
  overrides: [
    // Tests are allowlisted: fixtures legitimately construct RenderRegion
    // literals and assert against their fields.
    {
      files: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx'],
      rules: { 'no-restricted-syntax': 'off' },
    },
    // The two sanctioned sites where renderer-side code is allowed to
    // read region.scrollOffset and region.viewportOrigin: the shared
    // helper module that *implements* the composition, and the canvas-
    // engine canonical functions (lifted into this package via project
    // references — but the source lives in canvas/engine/, governed by
    // its own header comment, not by this lint config).
    {
      files: ['src/shared/cell-bounds.ts'],
      rules: { 'no-restricted-syntax': 'off' },
    },
    // viewports/scroll.ts implements the scroll-behavior state machine
    // (e.g., the `linked` behavior reads a peer Viewport's scrollOffset
    // to follow its scroll on a given axis). This is scroll propagation,
    // not coordinate transformation — the canonical formula doesn't apply
    // because there's no doc⇄canvas conversion happening.
    {
      files: ['src/viewports/scroll.ts'],
      rules: { 'no-restricted-syntax': 'off' },
    },
    // viewports/hit-testing.ts: the canonical canvasToCell entry point
    // works on Viewport (not RenderRegion). It already routes through
    // canvasToDocXY / docToCanvasXY. The remaining bounds
    // checks against Viewport bounds are not coordinate transforms.
    // (No carve-out needed if it stays clean — verify and remove.)
  ],
};
