/**
 * @mog/types-objects — Canvas objects: floating objects, drawing,
 * ink, text-effects, diagram, equation.
 *
 * Tier 1 of the domain graph. Depends on @mog/types-core and @mog/types-viewport.
 *
 * Contains (absorbed from contracts/src/):
 * - objects/   — canvas-object, drawing-object, floating-object-types,
 *                floating-objects, object-bounds-reader, object-mutator
 * - drawing/   — three-d (Scene3D, Shape3D)
 * - ink/       — types (DrawingObject as it pertains to ink), spatial-index
 * - text-effects/   — types, effects, presets, bridge
 * - diagram/  — types, layouts, styles, ooxml-{algorithm,data-model,drawing,engine,layout,style}-types
 * - equation/  — types, omml-ast, templates, errors
 *
 * NOTE: The plan said deps should be types-core + types-formatting, but no
 * file in these folders imports from types-formatting. types-viewport IS
 * needed (objects/drawing-object.ts -> @mog/types-viewport/geometry).
 *
 * Consumers should prefer the precise subpath — sub-barrels have pre-existing
 * name overlaps between folders (e.g. ShapeType in objects vs diagram).
 */

export {};
