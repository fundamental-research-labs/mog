/**
 * Rich Text Selection Manager
 *
 * Rich Text Editing
 * Character Selection Within Cell
 *
 * Provides bidirectional mapping between DOM Selection and character offsets.
 * This is essential for tracking text selection in contentEditable rich text cells.
 *
 * Key responsibilities:
 * - Convert DOM Selection (node + offset) to character offsets
 * - Set DOM Selection from character offsets (for restoring cursor position)
 * - Handle edge cases: empty segments, cursor at boundaries, multi-segment selection
 *
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Character offset range in plain text.
 * Start is always <= end regardless of selection direction.
 */
export interface CharacterOffsets {
  /** Start offset (inclusive) */
  start: number;
  /** End offset (exclusive) */
  end: number;
}

/**
 * Position within a text node, used internally for DOM navigation.
 */
interface TextNodePosition {
  /** The text node */
  node: Text;
  /** Offset within the text node */
  offset: number;
}

// =============================================================================
// RichTextSelectionManager
// =============================================================================

/**
 * Manages mapping between DOM Selection and character offsets in rich text.
 *
 * The contentEditable div contains span elements for each RichTextSegment.
 * Each span contains a text node. This class walks the DOM tree to:
 * 1. Count text length to find character position from DOM node/offset
 * 2. Find the correct text node from character offset
 *
 * @example
 * ```typescript
 * const manager = new RichTextSelectionManager();
 *
 * // Get character offsets from current selection
 * const offsets = manager.getCharacterOffsets(contentEditableDiv);
 * console.log(offsets); // { start: 0, end: 5 }
 *
 * // Set selection from character offsets
 * manager.setCharacterOffsets(contentEditableDiv, 2, 7);
 * ```
 */
export class RichTextSelectionManager {
  /**
   * Convert DOM Selection to character offsets.
   * Walks segment spans to find character position.
   *
   * @param contentEditableDiv - The contentEditable div containing rich text spans
   * @returns Character offsets in plain text
   */
  getCharacterOffsets(contentEditableDiv: HTMLDivElement): CharacterOffsets {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return { start: 0, end: 0 };
    }

    // Check if selection is within our contentEditable
    if (!contentEditableDiv.contains(selection.anchorNode)) {
      return { start: 0, end: 0 };
    }

    const range = selection.getRangeAt(0);

    const start = this.nodeOffsetToCharOffset(
      contentEditableDiv,
      range.startContainer,
      range.startOffset,
    );

    const end = this.nodeOffsetToCharOffset(
      contentEditableDiv,
      range.endContainer,
      range.endOffset,
    );

    // Ensure start <= end (selection direction doesn't matter for our purposes)
    return {
      start: Math.min(start, end),
      end: Math.max(start, end),
    };
  }

  /**
   * Set DOM Selection from character offsets.
   * Creates Range at correct position in segment spans.
   *
   * @param contentEditableDiv - The contentEditable div containing rich text spans
   * @param start - Start character offset
   * @param end - End character offset
   */
  setCharacterOffsets(contentEditableDiv: HTMLDivElement, start: number, end: number): void {
    const range = this.createRangeFromOffsets(contentEditableDiv, start, end);
    if (!range) return;

    const selection = window.getSelection();
    if (!selection) return;

    selection.removeAllRanges();
    selection.addRange(range);
  }

  /**
   * Place cursor at specific character offset (collapsed selection).
   *
   * @param contentEditableDiv - The contentEditable div containing rich text spans
   * @param offset - Character offset for cursor position
   */
  setCursorPosition(contentEditableDiv: HTMLDivElement, offset: number): void {
    this.setCharacterOffsets(contentEditableDiv, offset, offset);
  }

  /**
   * Get the total text length in the contentEditable div.
   *
   * @param contentEditableDiv - The contentEditable div containing rich text spans
   * @returns Total character count
   */
  getTextLength(contentEditableDiv: HTMLDivElement): number {
    return contentEditableDiv.textContent?.length ?? 0;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Walk DOM tree to find character offset from node/offset pair.
   * Counts text length in each segment span.
   *
   * @param root - The contentEditable div (root element)
   * @param node - The DOM node where selection is
   * @param offset - The offset within the node
   * @returns Character offset in plain text
   */
  private nodeOffsetToCharOffset(root: HTMLDivElement, node: Node, offset: number): number {
    // Handle case where selection is directly on the root
    if (node === root) {
      // offset is the child index
      return this.getTextLengthUpToChildIndex(root, offset);
    }

    // Walk through all text nodes in order
    const textNodes = this.getTextNodesInOrder(root);
    let charOffset = 0;

    for (const textNode of textNodes) {
      if (node === textNode) {
        // Found the target text node
        return charOffset + Math.min(offset, textNode.textContent?.length ?? 0);
      }

      if (node.nodeType === Node.ELEMENT_NODE && node.contains(textNode)) {
        // Selection is on an element that contains text nodes
        // The offset is the child index within this element
        if (node === textNode.parentNode) {
          // Find which child text nodes come before offset
          const children = Array.from(node.childNodes);
          let localOffset = 0;
          for (let i = 0; i < offset && i < children.length; i++) {
            localOffset += children[i].textContent?.length ?? 0;
          }
          // Count text before this node plus local offset
          const nodeBefore = this.getTextLengthBeforeNode(root, node);
          return nodeBefore + localOffset;
        }
      }

      charOffset += textNode.textContent?.length ?? 0;
    }

    // Node not found - return total length (cursor at end)
    return this.getTextLength(root);
  }

  /**
   * Create DOM Range from character offsets.
   * Finds correct text node and offset within segments.
   *
   * @param root - The contentEditable div (root element)
   * @param start - Start character offset
   * @param end - End character offset
   * @returns Range object or null if cannot create
   */
  private createRangeFromOffsets(root: HTMLDivElement, start: number, end: number): Range | null {
    const startPos = this.charOffsetToNodePosition(root, start);
    const endPos = this.charOffsetToNodePosition(root, end);

    if (!startPos || !endPos) {
      // Fallback: try to place cursor at end if no text nodes
      const range = document.createRange();
      try {
        range.selectNodeContents(root);
        range.collapse(false); // Collapse to end
        return range;
      } catch {
        return null;
      }
    }

    const range = document.createRange();
    try {
      range.setStart(startPos.node, startPos.offset);
      range.setEnd(endPos.node, endPos.offset);
      return range;
    } catch {
      // Invalid range (e.g., offset out of bounds)
      return null;
    }
  }

  /**
   * Convert character offset to text node position.
   *
   * @param root - The contentEditable div (root element)
   * @param charOffset - Character offset in plain text
   * @returns Text node and offset within it, or null if not found
   */
  private charOffsetToNodePosition(
    root: HTMLDivElement,
    charOffset: number,
  ): TextNodePosition | null {
    const textNodes = this.getTextNodesInOrder(root);

    if (textNodes.length === 0) {
      return null;
    }

    let currentOffset = 0;

    for (const textNode of textNodes) {
      const textLength = textNode.textContent?.length ?? 0;

      if (charOffset <= currentOffset + textLength) {
        // Found the text node
        return {
          node: textNode,
          offset: charOffset - currentOffset,
        };
      }

      currentOffset += textLength;
    }

    // Offset is beyond end - return end of last text node
    const lastNode = textNodes[textNodes.length - 1];
    return {
      node: lastNode,
      offset: lastNode.textContent?.length ?? 0,
    };
  }

  /**
   * Get all text nodes within an element in document order.
   *
   * @param root - Root element to search within
   * @returns Array of text nodes in order
   */
  private getTextNodesInOrder(root: HTMLDivElement): Text[] {
    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);

    let node = walker.nextNode();
    while (node) {
      textNodes.push(node as Text);
      node = walker.nextNode();
    }

    return textNodes;
  }

  /**
   * Get total text length up to a child index within a container.
   *
   * @param container - Parent container
   * @param childIndex - Index of child to stop at
   * @returns Character count
   */
  private getTextLengthUpToChildIndex(container: Node, childIndex: number): number {
    const children = container.childNodes;
    let length = 0;

    for (let i = 0; i < childIndex && i < children.length; i++) {
      length += children[i].textContent?.length ?? 0;
    }

    return length;
  }

  /**
   * Get total text length before a given node in the tree.
   *
   * @param root - Root element
   * @param targetNode - Node to measure up to
   * @returns Character count before the node
   */
  private getTextLengthBeforeNode(root: HTMLDivElement, targetNode: Node): number {
    const textNodes = this.getTextNodesInOrder(root);
    let length = 0;

    for (const textNode of textNodes) {
      // Check if this text node comes before the target
      if (targetNode.compareDocumentPosition(textNode) & Node.DOCUMENT_POSITION_PRECEDING) {
        length += textNode.textContent?.length ?? 0;
      } else if (targetNode === textNode || targetNode.contains(textNode)) {
        break;
      }
    }

    return length;
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

/**
 * Shared selection manager instance.
 * Since this class is stateless, a single instance can be reused.
 */
export const richTextSelectionManager = new RichTextSelectionManager();
