/**
 * Unit tests for xml-helpers.ts
 *
 * Tests the low-level XML node access helpers:
 * attr, numAttr, boolAttr, child, children, textContent, iterateChildrenInOrder
 */

import type { XmlNode } from '../../src/parser/xml-helpers';
import {
  attr,
  boolAttr,
  child,
  children,
  iterateChildrenInOrder,
  numAttr,
  textContent,
} from '../../src/parser/xml-helpers';

// =============================================================================
// attr()
// =============================================================================

describe('attr', () => {
  it('should return attribute value as string', () => {
    const node: XmlNode = { '@_type': 'composite' };
    expect(attr(node, 'type')).toBe('composite');
  });

  it('should convert numeric attributes to string', () => {
    const node: XmlNode = { '@_idx': 42 };
    expect(attr(node, 'idx')).toBe('42');
  });

  it('should return undefined for missing attributes', () => {
    const node: XmlNode = { '@_type': 'foo' };
    expect(attr(node, 'missing')).toBeUndefined();
  });

  it('should return defaultValue when attribute is missing', () => {
    const node: XmlNode = {};
    expect(attr(node, 'missing', 'default')).toBe('default');
  });

  it('should return defaultValue for null node', () => {
    expect(attr(null, 'type', 'default')).toBe('default');
  });

  it('should return defaultValue for undefined node', () => {
    expect(attr(undefined, 'type', 'default')).toBe('default');
  });

  it('should return undefined for null node with no default', () => {
    expect(attr(null, 'type')).toBeUndefined();
  });

  it('should return defaultValue when attribute value is null', () => {
    const node: XmlNode = { '@_type': null };
    expect(attr(node, 'type', 'fallback')).toBe('fallback');
  });

  it('should return defaultValue when attribute value is undefined', () => {
    const node: XmlNode = { '@_type': undefined };
    expect(attr(node, 'type', 'fallback')).toBe('fallback');
  });

  it('should convert boolean attribute to string', () => {
    const node: XmlNode = { '@_hidden': true };
    expect(attr(node, 'hidden')).toBe('true');
  });
});

// =============================================================================
// numAttr()
// =============================================================================

describe('numAttr', () => {
  it('should return numeric attribute as number', () => {
    const node: XmlNode = { '@_val': 42 };
    expect(numAttr(node, 'val')).toBe(42);
  });

  it('should parse numeric string attributes', () => {
    const node: XmlNode = { '@_val': '100' };
    expect(numAttr(node, 'val')).toBe(100);
  });

  it('should handle negative numbers', () => {
    const node: XmlNode = { '@_val': '-50' };
    expect(numAttr(node, 'val')).toBe(-50);
  });

  it('should handle floating point numbers', () => {
    const node: XmlNode = { '@_val': 3.14 };
    expect(numAttr(node, 'val')).toBeCloseTo(3.14);
  });

  it('should return defaultValue for NaN strings', () => {
    const node: XmlNode = { '@_val': 'abc' };
    expect(numAttr(node, 'val', 99)).toBe(99);
  });

  it('should return undefined for missing attributes', () => {
    const node: XmlNode = {};
    expect(numAttr(node, 'val')).toBeUndefined();
  });

  it('should return defaultValue for missing attributes', () => {
    const node: XmlNode = {};
    expect(numAttr(node, 'val', 0)).toBe(0);
  });

  it('should return defaultValue for null node', () => {
    expect(numAttr(null, 'val', 0)).toBe(0);
  });

  it('should return undefined for undefined node with no default', () => {
    expect(numAttr(undefined, 'val')).toBeUndefined();
  });

  it('should return defaultValue when attribute is null', () => {
    const node: XmlNode = { '@_val': null };
    expect(numAttr(node, 'val', 5)).toBe(5);
  });

  it('should handle zero correctly', () => {
    const node: XmlNode = { '@_val': 0 };
    expect(numAttr(node, 'val')).toBe(0);
  });

  it('should handle zero string correctly', () => {
    const node: XmlNode = { '@_val': '0' };
    expect(numAttr(node, 'val')).toBe(0);
  });
});

// =============================================================================
// boolAttr()
// =============================================================================

describe('boolAttr', () => {
  it('should return true for boolean true', () => {
    const node: XmlNode = { '@_flag': true };
    expect(boolAttr(node, 'flag')).toBe(true);
  });

  it('should return false for boolean false', () => {
    const node: XmlNode = { '@_flag': false };
    expect(boolAttr(node, 'flag')).toBe(false);
  });

  it('should return true for string "1"', () => {
    const node: XmlNode = { '@_flag': '1' };
    expect(boolAttr(node, 'flag')).toBe(true);
  });

  it('should return false for string "0"', () => {
    const node: XmlNode = { '@_flag': '0' };
    expect(boolAttr(node, 'flag')).toBe(false);
  });

  it('should return true for string "true"', () => {
    const node: XmlNode = { '@_flag': 'true' };
    expect(boolAttr(node, 'flag')).toBe(true);
  });

  it('should return true for string "True" (case-insensitive)', () => {
    const node: XmlNode = { '@_flag': 'True' };
    expect(boolAttr(node, 'flag')).toBe(true);
  });

  it('should return false for string "false"', () => {
    const node: XmlNode = { '@_flag': 'false' };
    expect(boolAttr(node, 'flag')).toBe(false);
  });

  it('should return true for numeric 1', () => {
    const node: XmlNode = { '@_flag': 1 };
    expect(boolAttr(node, 'flag')).toBe(true);
  });

  it('should return false for numeric 0', () => {
    const node: XmlNode = { '@_flag': 0 };
    expect(boolAttr(node, 'flag')).toBe(false);
  });

  it('should return undefined for missing attributes', () => {
    const node: XmlNode = {};
    expect(boolAttr(node, 'flag')).toBeUndefined();
  });

  it('should return defaultValue for missing attributes', () => {
    const node: XmlNode = {};
    expect(boolAttr(node, 'flag', true)).toBe(true);
  });

  it('should return defaultValue for null node', () => {
    expect(boolAttr(null, 'flag', false)).toBe(false);
  });

  it('should return undefined for null node with no default', () => {
    expect(boolAttr(null, 'flag')).toBeUndefined();
  });

  it('should return defaultValue when attribute is null', () => {
    const node: XmlNode = { '@_flag': null };
    expect(boolAttr(node, 'flag', true)).toBe(true);
  });
});

// =============================================================================
// child()
// =============================================================================

describe('child', () => {
  it('should return a child object', () => {
    const childNode: XmlNode = { '@_val': 'test' };
    const node: XmlNode = { 'a:child': childNode };
    expect(child(node, 'a:child')).toBe(childNode);
  });

  it('should return first element when child is an array', () => {
    const first: XmlNode = { '@_val': 'first' };
    const second: XmlNode = { '@_val': 'second' };
    const node: XmlNode = { 'a:items': [first, second] };
    expect(child(node, 'a:items')).toBe(first);
  });

  it('should return undefined for missing children', () => {
    const node: XmlNode = {};
    expect(child(node, 'a:missing')).toBeUndefined();
  });

  it('should return undefined for null value', () => {
    const node: XmlNode = { 'a:child': null };
    expect(child(node, 'a:child')).toBeUndefined();
  });

  it('should return undefined for null node', () => {
    expect(child(null, 'a:child')).toBeUndefined();
  });

  it('should return undefined for undefined node', () => {
    expect(child(undefined, 'a:child')).toBeUndefined();
  });
});

// =============================================================================
// children()
// =============================================================================

describe('children', () => {
  it('should return an array for array values', () => {
    const items = [{ '@_val': 'a' }, { '@_val': 'b' }];
    const node: XmlNode = { 'a:items': items };
    expect(children(node, 'a:items')).toBe(items);
  });

  it('should wrap single object in array', () => {
    const singleChild: XmlNode = { '@_val': 'single' };
    const node: XmlNode = { 'a:item': singleChild };
    const result = children(node, 'a:item');
    expect(result).toEqual([singleChild]);
    expect(result).toHaveLength(1);
  });

  it('should return empty array for missing children', () => {
    const node: XmlNode = {};
    expect(children(node, 'a:missing')).toEqual([]);
  });

  it('should return empty array for null value', () => {
    const node: XmlNode = { 'a:items': null };
    expect(children(node, 'a:items')).toEqual([]);
  });

  it('should return empty array for null node', () => {
    expect(children(null, 'a:items')).toEqual([]);
  });

  it('should return empty array for undefined node', () => {
    expect(children(undefined, 'a:items')).toEqual([]);
  });
});

// =============================================================================
// textContent()
// =============================================================================

describe('textContent', () => {
  it('should return text content', () => {
    const node: XmlNode = { '#text': 'Hello World' };
    expect(textContent(node)).toBe('Hello World');
  });

  it('should convert numeric text content to string', () => {
    const node: XmlNode = { '#text': 42 };
    expect(textContent(node)).toBe('42');
  });

  it('should return undefined for missing text content', () => {
    const node: XmlNode = {};
    expect(textContent(node)).toBeUndefined();
  });

  it('should return undefined for null text content', () => {
    const node: XmlNode = { '#text': null };
    expect(textContent(node)).toBeUndefined();
  });

  it('should return undefined for null node', () => {
    expect(textContent(null)).toBeUndefined();
  });

  it('should return undefined for undefined node', () => {
    expect(textContent(undefined)).toBeUndefined();
  });

  it('should handle boolean text content', () => {
    const node: XmlNode = { '#text': true };
    expect(textContent(node)).toBe('true');
  });
});

// =============================================================================
// iterateChildrenInOrder()
// =============================================================================

describe('iterateChildrenInOrder', () => {
  it('should iterate children in document order', () => {
    const order: string[] = [];
    const node: XmlNode = {
      '@_id': '1', // attribute - should be skipped
      'a:first': { '@_val': 'first' },
      'a:second': { '@_val': 'second' },
      'a:third': { '@_val': 'third' },
    };

    iterateChildrenInOrder(node, {
      'a:first': () => order.push('first'),
      'a:second': () => order.push('second'),
      'a:third': () => order.push('third'),
    });

    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('should handle array children (multiple siblings)', () => {
    const items: string[] = [];
    const node: XmlNode = {
      'a:item': [{ '@_val': 'a' }, { '@_val': 'b' }, { '@_val': 'c' }],
    };

    iterateChildrenInOrder(node, {
      'a:item': (child) => items.push(attr(child, 'val')!),
    });

    expect(items).toEqual(['a', 'b', 'c']);
  });

  it('should skip attributes (keys starting with @_)', () => {
    const visited: string[] = [];
    const node: XmlNode = {
      '@_attr': 'should-skip',
      'a:child': { '@_val': 'found' },
    };

    iterateChildrenInOrder(node, {
      '@_attr': () => visited.push('attr'),
      'a:child': () => visited.push('child'),
    });

    // Only 'child' should be visited; '@_attr' never matches because the
    // iteration skips keys starting with '@_'
    expect(visited).toEqual(['child']);
  });

  it('should skip #text key', () => {
    const visited: string[] = [];
    const node: XmlNode = {
      '#text': 'text content',
      'a:child': { '@_val': 'found' },
    };

    iterateChildrenInOrder(node, {
      '#text': () => visited.push('text'),
      'a:child': () => visited.push('child'),
    });

    expect(visited).toEqual(['child']);
  });

  it('should skip unhandled element names', () => {
    const visited: string[] = [];
    const node: XmlNode = {
      'a:handled': { '@_val': 'yes' },
      'a:unhandled': { '@_val': 'no' },
    };

    iterateChildrenInOrder(node, {
      'a:handled': () => visited.push('handled'),
    });

    expect(visited).toEqual(['handled']);
  });

  it('should handle null node gracefully', () => {
    // Should not throw
    iterateChildrenInOrder(null, {
      'a:child': () => {
        throw new Error('Should not be called');
      },
    });
  });

  it('should handle undefined node gracefully', () => {
    iterateChildrenInOrder(undefined, {
      'a:child': () => {
        throw new Error('Should not be called');
      },
    });
  });

  it('should skip null/undefined values', () => {
    const visited: string[] = [];
    const node: XmlNode = {
      'a:present': { '@_val': 'here' },
      'a:nullChild': null,
      'a:undefChild': undefined,
    };

    iterateChildrenInOrder(node, {
      'a:present': () => visited.push('present'),
      'a:nullChild': () => visited.push('null'),
      'a:undefChild': () => visited.push('undef'),
    });

    expect(visited).toEqual(['present']);
  });
});
