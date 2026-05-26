/**
 * Lightweight XML parser for OMML.
 *
 * Since we're in a Node.js environment with no DOM, this implements
 * a simple recursive-descent XML parser sufficient for well-structured
 * OMML documents. OMML is machine-generated and well-formed, so we
 * don't need a full-spec XML parser.
 */

export interface XmlNode {
  /** Tag name (without namespace prefix for matching convenience) */
  tag: string;
  /** Full tag name including namespace prefix */
  fullTag: string;
  /** Attributes as key-value pairs */
  attrs: Record<string, string>;
  /** Child nodes (elements and text) */
  children: XmlNode[];
  /** Text content (for text nodes) */
  text?: string;
  /** Whether this is a text node */
  isText: boolean;
}

/**
 * Parse an XML string into an XmlNode tree.
 * Handles self-closing tags, attributes, namespaces, and nested elements.
 */
export function parseXml(xml: string): XmlNode {
  const trimmed = xml.trim();
  if (!trimmed) {
    return { tag: '', fullTag: '', attrs: {}, children: [], isText: true, text: '' };
  }

  const parser = new XmlParser(trimmed);
  return parser.parse();
}

/**
 * Parse an XML string that may contain multiple root-level elements.
 * Returns an array of all root-level XmlNode elements.
 */
export function parseXmlAll(xml: string): XmlNode[] {
  const trimmed = xml.trim();
  if (!trimmed) {
    return [];
  }

  const parser = new XmlParser(trimmed);
  return parser.parseAll();
}

class XmlParser {
  private pos = 0;
  private readonly input: string;

  constructor(input: string) {
    this.input = input;
  }

  parse(): XmlNode {
    this.skipWhitespace();
    // Skip XML declaration if present
    if (this.input.startsWith('<?', this.pos)) {
      const end = this.input.indexOf('?>', this.pos);
      if (end !== -1) {
        this.pos = end + 2;
        this.skipWhitespace();
      }
    }
    return this.parseElement();
  }

  parseAll(): XmlNode[] {
    this.skipWhitespace();
    // Skip XML declaration if present
    if (this.input.startsWith('<?', this.pos)) {
      const end = this.input.indexOf('?>', this.pos);
      if (end !== -1) {
        this.pos = end + 2;
        this.skipWhitespace();
      }
    }
    const nodes: XmlNode[] = [];
    while (this.pos < this.input.length) {
      this.skipWhitespace();
      if (this.pos >= this.input.length) break;
      const node = this.parseElement();
      if (node.isText && node.text === '') continue;
      nodes.push(node);
    }
    return nodes;
  }

  private parseElement(): XmlNode {
    if (this.pos >= this.input.length) {
      return { tag: '', fullTag: '', attrs: {}, children: [], isText: true, text: '' };
    }

    if (this.input[this.pos] !== '<') {
      // Text node - read until next tag
      const text = this.readUntil('<');
      return {
        tag: '#text',
        fullTag: '#text',
        attrs: {},
        children: [],
        text: decodeXmlEntities(text),
        isText: true,
      };
    }

    // Skip '<'
    this.pos++;

    // Read tag name
    const fullTag = this.readTagName();
    const tag = stripNamespace(fullTag);

    // Read attributes
    const attrs = this.readAttributes();

    // Self-closing tag?
    this.skipWhitespace();
    if (this.input[this.pos] === '/' && this.input[this.pos + 1] === '>') {
      this.pos += 2;
      return { tag, fullTag, attrs, children: [], isText: false };
    }

    // Expect '>'
    if (this.input[this.pos] === '>') {
      this.pos++;
    }

    // Read children until closing tag
    const children: XmlNode[] = [];
    while (this.pos < this.input.length) {
      this.skipWhitespace();

      if (this.pos >= this.input.length) break;

      // Check for closing tag
      if (this.input[this.pos] === '<' && this.input[this.pos + 1] === '/') {
        // Closing tag - skip it
        this.pos += 2;
        this.readUntil('>');
        this.pos++; // skip '>'
        break;
      }

      // Parse child
      const child = this.parseElement();
      if (child.isText && child.text === '') continue;
      children.push(child);
    }

    return { tag, fullTag, attrs, children, isText: false };
  }

  private readTagName(): string {
    const start = this.pos;
    while (
      this.pos < this.input.length &&
      this.input[this.pos] !== ' ' &&
      this.input[this.pos] !== '>' &&
      this.input[this.pos] !== '/' &&
      this.input[this.pos] !== '\n' &&
      this.input[this.pos] !== '\r' &&
      this.input[this.pos] !== '\t'
    ) {
      this.pos++;
    }
    return this.input.slice(start, this.pos);
  }

  private readAttributes(): Record<string, string> {
    const attrs: Record<string, string> = {};
    while (this.pos < this.input.length) {
      this.skipWhitespace();
      if (
        this.input[this.pos] === '>' ||
        this.input[this.pos] === '/' ||
        this.pos >= this.input.length
      ) {
        break;
      }

      // Read attribute name
      const nameStart = this.pos;
      while (
        this.pos < this.input.length &&
        this.input[this.pos] !== '=' &&
        this.input[this.pos] !== ' ' &&
        this.input[this.pos] !== '>' &&
        this.input[this.pos] !== '/'
      ) {
        this.pos++;
      }
      const attrFullName = this.input.slice(nameStart, this.pos);
      const attrName = stripNamespace(attrFullName);

      if (this.input[this.pos] === '=') {
        this.pos++; // skip '='
        // Read attribute value
        const quote = this.input[this.pos];
        if (quote === '"' || quote === "'") {
          this.pos++; // skip opening quote
          const valueStart = this.pos;
          while (this.pos < this.input.length && this.input[this.pos] !== quote) {
            this.pos++;
          }
          attrs[attrName] = decodeXmlEntities(this.input.slice(valueStart, this.pos));
          this.pos++; // skip closing quote
        }
      } else {
        // Boolean attribute
        attrs[attrName] = 'true';
      }
    }
    return attrs;
  }

  private readUntil(char: string): string {
    const start = this.pos;
    while (this.pos < this.input.length && this.input[this.pos] !== char) {
      this.pos++;
    }
    return this.input.slice(start, this.pos);
  }

  private skipWhitespace(): void {
    while (
      this.pos < this.input.length &&
      (this.input[this.pos] === ' ' ||
        this.input[this.pos] === '\n' ||
        this.input[this.pos] === '\r' ||
        this.input[this.pos] === '\t')
    ) {
      this.pos++;
    }
  }
}

/** Remove namespace prefix from tag/attribute name. "m:oMath" -> "oMath" */
export function stripNamespace(name: string): string {
  const colonIndex = name.indexOf(':');
  return colonIndex >= 0 ? name.slice(colonIndex + 1) : name;
}

/** Decode basic XML entities. */
function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}

/**
 * Find a direct child element by tag name (namespace-stripped).
 */
export function findChild(node: XmlNode, tag: string): XmlNode | undefined {
  return node.children.find((c) => !c.isText && c.tag === tag);
}

/**
 * Find all direct child elements by tag name (namespace-stripped).
 */
export function findChildren(node: XmlNode, tag: string): XmlNode[] {
  return node.children.filter((c) => !c.isText && c.tag === tag);
}

/**
 * Get the text content of a node (concatenating all text children).
 */
export function getTextContent(node: XmlNode): string {
  if (node.isText) return node.text || '';
  return node.children.map((c) => getTextContent(c)).join('');
}

/**
 * Get attribute value, stripping namespace from attribute name.
 */
export function getAttr(node: XmlNode, name: string): string | undefined {
  return node.attrs[name];
}
