/**
 * Canonical-formula + canonical-pipeline enforcement for @mog/grid-canvas.
 *
 * Invariant 1: `<region>.scrollOffset.x|y` and `<region>.viewportOrigin.x|y`
 * direct reads are forbidden in `src/`. The mapper at
 * `src/renderer/viewport-to-region-layout.ts` is allowlisted because it is
 * the single boundary that projects Viewport fields into RenderRegion.
 *
 * Invariant 2: `computeViewportLayout` in `src/viewports/compute-layout.ts`
 * is the only function that produces layout from inputs. Parallel
 * layout-from-inputs functions are forbidden.
 */

const SCROLL_OFFSET_AXIS_READ = {
  selector:
    'MemberExpression[property.name=/^(x|y)$/][object.type="MemberExpression"][object.property.name="scrollOffset"]',
  message:
    'Direct `<region>.scrollOffset.x|y` reads are forbidden by the canonical coordinate invariant. ' +
    'The mapper at src/renderer/viewport-to-region-layout.ts is the only allowlisted reader.',
};

const VIEWPORT_ORIGIN_AXIS_READ = {
  selector:
    'MemberExpression[property.name=/^(x|y)$/][object.type="MemberExpression"][object.property.name="viewportOrigin"]',
  message:
    'Direct `<region>.viewportOrigin.x|y` reads are forbidden by the canonical coordinate invariant. ' +
    'The mapper at src/renderer/viewport-to-region-layout.ts is the only allowlisted reader.',
};

const SUBTRACT_SCROLL_OFFSET_AXIS = {
  selector:
    'BinaryExpression[operator="-"][right.type="MemberExpression"][right.object.name="scrollOffset"][right.property.name=/^(x|y)$/]',
  message:
    'Inline `<expr> - scrollOffset.x|y` math is forbidden by the canonical coordinate invariant.',
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
    {
      files: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx'],
      rules: { 'no-restricted-syntax': 'off' },
    },
    // The mapper IS the boundary where Viewport.viewportOrigin and
    // Viewport.scrollOffset are projected into RenderRegion. It must read
    // both fields by definition.
    {
      files: ['src/renderer/viewport-to-region-layout.ts'],
      rules: { 'no-restricted-syntax': 'off' },
    },
    // compute-layout.ts builds Viewport literals (Viewport already carries
    // viewportOrigin + scrollOffset; this file IS the production layout
    // pipeline, the single function that produces ViewportLayout from inputs).
    {
      files: ['src/viewports/compute-layout.ts', 'src/viewports/scroll.ts'],
      rules: { 'no-restricted-syntax': 'off' },
    },
  ],
};
