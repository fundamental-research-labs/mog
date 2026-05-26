/**
 * XML Parsing Helpers
 *
 * Utility functions for working with pre-parsed XML objects in the
 * fast-xml-parser / WASM XML bridge format:
 * - Attributes have `@_` prefix (e.g., `@_type`, `@_modelId`)
 * - Text content is in `#text` key
 * - Numeric strings may be parsed to numbers
 * - Single child elements may be objects or arrays
 *
 * These helpers provide consistent, null-safe access to parsed XML data.
 */

// =============================================================================
// Type for parsed XML nodes
// =============================================================================

/**
 * A parsed XML node (object representation from fast-xml-parser).
 * This is the format produced by the WASM XML bridge used in the project.
 */

export type XmlNode = Record<string, any>;

// =============================================================================
// Attribute Access
// =============================================================================

/**
 * Get a string attribute value from a parsed XML node.
 *
 * @param node - The parsed XML node
 * @param name - Attribute name (without @_ prefix)
 * @param defaultValue - Default if attribute is missing
 * @returns The attribute value as string, or the default
 */
export function attr(
  node: XmlNode | undefined | null,
  name: string,
  defaultValue?: string,
): string | undefined {
  if (!node) return defaultValue;
  const val = node[`@_${name}`];
  if (val === undefined || val === null) return defaultValue;
  return String(val);
}

/**
 * Get a numeric attribute value from a parsed XML node.
 *
 * @param node - The parsed XML node
 * @param name - Attribute name (without @_ prefix)
 * @param defaultValue - Default if attribute is missing or not a number
 * @returns The attribute value as number, or the default
 */
export function numAttr(
  node: XmlNode | undefined | null,
  name: string,
  defaultValue?: number,
): number | undefined {
  if (!node) return defaultValue;
  const val = node[`@_${name}`];
  if (val === undefined || val === null) return defaultValue;
  const num = typeof val === 'number' ? val : Number(val);
  return isNaN(num) ? defaultValue : num;
}

/**
 * Get a boolean attribute value from a parsed XML node.
 * Handles OOXML boolean conventions: "1"/"0", "true"/"false", true/false.
 *
 * @param node - The parsed XML node
 * @param name - Attribute name (without @_ prefix)
 * @param defaultValue - Default if attribute is missing
 * @returns Boolean value
 */
export function boolAttr(
  node: XmlNode | undefined | null,
  name: string,
  defaultValue?: boolean,
): boolean | undefined {
  if (!node) return defaultValue;
  const val = node[`@_${name}`];
  if (val === undefined || val === null) return defaultValue;
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val !== 0;
  if (typeof val === 'string') {
    return val === '1' || val.toLowerCase() === 'true';
  }
  return defaultValue;
}

// =============================================================================
// Child Element Access
// =============================================================================

/**
 * Get a child element from a parsed XML node.
 * Handles namespace prefixes by looking for exact match first,
 * then tries common OOXML prefixes.
 *
 * @param node - The parsed XML node
 * @param name - Element name (may include namespace prefix, e.g., "dgm:pt")
 * @returns The child element or undefined
 */
export function child(node: XmlNode | undefined | null, name: string): XmlNode | undefined {
  if (!node) return undefined;
  const val = node[name];
  if (val === undefined || val === null) return undefined;
  // If it's an array, return the first element
  if (Array.isArray(val)) return val[0];
  return val;
}

/**
 * Get all children matching a given element name.
 * Always returns an array (empty if not found).
 * Handles single element vs array normalization.
 *
 * @param node - The parsed XML node
 * @param name - Element name (may include namespace prefix)
 * @returns Array of child elements
 */
export function children(node: XmlNode | undefined | null, name: string): XmlNode[] {
  if (!node) return [];
  const val = node[name];
  if (val === undefined || val === null) return [];
  if (Array.isArray(val)) return val;
  return [val];
}

/**
 * Get text content from a parsed XML node.
 *
 * @param node - The parsed XML node
 * @returns Text content string, or undefined
 */
export function textContent(node: XmlNode | undefined | null): string | undefined {
  if (!node) return undefined;
  const text = node['#text'];
  if (text === undefined || text === null) return undefined;
  return String(text);
}

// =============================================================================
// Document-Order Iteration
// =============================================================================

/**
 * Handler map for processing child elements in document order.
 * Each key is an element name (e.g., "dgm:layoutNode") and each value
 * is a callback that receives a single child element node.
 */
export type ElementHandlers = Record<string, (childNode: XmlNode) => void>;

/**
 * Iterate child elements of an XML node in document order, dispatching
 * to the appropriate handler based on element name.
 *
 * JavaScript objects preserve string key insertion order (ES2015+), and
 * fast-xml-parser inserts keys in document order, so iterating Object.keys()
 * gives us the correct sequence. For each matching key, if the value is an
 * array (multiple siblings of the same type), each item is dispatched in order.
 *
 * Keys starting with `@_` (attributes) and `#text` (text content) are skipped.
 *
 * @param node - The parent XML node
 * @param handlers - Map of element names to handler callbacks
 */
export function iterateChildrenInOrder(
  node: XmlNode | undefined | null,
  handlers: ElementHandlers,
): void {
  if (!node) return;

  for (const key of Object.keys(node)) {
    // Skip attributes and text content
    if (key.startsWith('@_') || key === '#text') continue;

    const handler = handlers[key];
    if (!handler) continue;

    const val = node[key];
    if (val === undefined || val === null) continue;

    if (Array.isArray(val)) {
      for (const item of val) {
        handler(item);
      }
    } else {
      handler(val);
    }
  }
}
