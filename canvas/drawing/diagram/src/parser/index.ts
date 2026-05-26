/**
 * Diagram OOXML Parsers
 *
 * Barrel export for all 5 Diagram XML part parsers.
 * Each parser converts pre-parsed XML objects (fast-xml-parser format)
 * into strongly-typed TypeScript objects from @mog-sdk/contracts.
 *
 * Usage:
 * ```typescript
 * import { parseDataModel, parseLayoutDefinition, parseColorsDef, parseStyleDef, parseDiagramDrawing } from './parser';
 *
 * const dataModel = parseDataModel(parsedDataXml);
 * const layoutDef = parseLayoutDefinition(parsedLayoutXml);
 * const colorsDef = parseColorsDef(parsedColorsXml);
 * const styleDef = parseStyleDef(parsedStyleXml);
 * const drawing = parseDiagramDrawing(parsedDrawingXml);
 * ```
 */

export { parseColorsDef } from './colors-def-parser';
export { parseDataModel } from './data-model-parser';
export { parseDiagramDrawing } from './drawing-parser';
export { parseLayoutDefinition } from './layout-def-parser';
export { parseStyleDef } from './style-def-parser';

// Re-export helper types and functions that consumers might need
export { parseCatLst, parseStyleColorTransforms, validateEnum } from './drawingml-helpers';
export { attr, boolAttr, child, children, numAttr, textContent } from './xml-helpers';
export type { XmlNode } from './xml-helpers';
