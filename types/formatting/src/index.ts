/**
 * @mog/types-formatting — Cell formatting types.
 *
 * Tier 1 of the domain graph. Depends on @mog/types-core + @mog/types-culture.
 *
 * Contains (absorbed from contracts/src/):
 * - formatting/       — theme, format-registry (type-only)
 * - number-formats/   — registry (type-only), types, locale-defaults
 *                       (constants.ts + constants.gen.ts stay as shims to
 *                        @mog/types-culture)
 * - styles/           — built-in-styles (type-only)
 * - conditional-format/ — rules (pulled up from data/conditional-format.ts
 *                        to keep the CF types cohesive), presets, render-types
 *
 * NOTE: contracts/src/data/conditional-format.ts is moved here (renamed to
 * conditional-format/rules.ts) because the CF type graph was circular across
 * folders: contracts/src/conditional-format/presets imported from
 * contracts/src/data/conditional-format, while contracts/src/data/conditional-format
 * imported from contracts/src/conditional-format/render-types. Moving it here
 * keeps the whole CF API in one package and lets types-data depend cleanly on
 * types-formatting for CF types. The contracts/src/data/conditional-format.ts
 * shim re-exports from here so existing consumers (e.g. contracts/src/api/types.ts)
 * are unchanged.
 *
 * Consumers should prefer the precise subpath (e.g.
 * `@mog/types-formatting/conditional-format`) — like contracts/src/ already
 * does — because sub-barrels have some shared names.
 */

export {};
