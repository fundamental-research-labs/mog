/**
 * Delimiter Layout Tests — TeXbook Rule 19
 *
 * Verifies axis-centered delimiter sizing, null delimiter space,
 * bracket width scaling, separator handling, and content positioning.
 */

import { layoutEquation } from '../../src/layout/layout-engine';
import { parseOMML } from '../../src/parser/omml-parser';

function layoutFromOMML(omml: string, fontSize: number = 12) {
  const result = parseOMML(omml);
  if (!result.ok) throw new Error(`Parse failed: ${result.error.message}`);
  const nodes = result.value[0].type === 'oMath' ? (result.value[0] as any).children : result.value;
  return layoutEquation(nodes, fontSize);
}

// Helper to build a simple delimiter OMML string
function delimOMML(opts: { begChr?: string; endChr?: string; sepChr?: string; content?: string }) {
  const begAttr = opts.begChr !== undefined ? ` m:val="${opts.begChr}"` : '';
  const endAttr = opts.endChr !== undefined ? ` m:val="${opts.endChr}"` : '';
  const sepAttr = opts.sepChr !== undefined ? ` m:val="${opts.sepChr}"` : '';
  const hasPr = opts.begChr !== undefined || opts.endChr !== undefined || opts.sepChr !== undefined;
  const content = opts.content ?? 'x';

  let pr = '';
  if (hasPr) {
    pr = '<m:dPr>';
    if (opts.begChr !== undefined) pr += `<m:begChr${begAttr}/>`;
    if (opts.endChr !== undefined) pr += `<m:endChr${endAttr}/>`;
    if (opts.sepChr !== undefined) pr += `<m:sepChr${sepAttr}/>`;
    pr += '</m:dPr>';
  }

  return `<m:oMath><m:d>${pr}<m:e><m:r><m:t>${content}</m:t></m:r></m:e></m:d></m:oMath>`;
}

// Helper for multi-element delimiters (e.g. "(a | b)")
function multiElemDelimOMML(opts: {
  begChr?: string;
  endChr?: string;
  sepChr?: string;
  elements: string[];
}) {
  const begAttr = opts.begChr !== undefined ? ` m:val="${opts.begChr}"` : '';
  const endAttr = opts.endChr !== undefined ? ` m:val="${opts.endChr}"` : '';
  const sepAttr = opts.sepChr !== undefined ? ` m:val="${opts.sepChr}"` : '';
  const hasPr = opts.begChr !== undefined || opts.endChr !== undefined || opts.sepChr !== undefined;

  let pr = '';
  if (hasPr) {
    pr = '<m:dPr>';
    if (opts.begChr !== undefined) pr += `<m:begChr${begAttr}/>`;
    if (opts.endChr !== undefined) pr += `<m:endChr${endAttr}/>`;
    if (opts.sepChr !== undefined) pr += `<m:sepChr${sepAttr}/>`;
    pr += '</m:dPr>';
  }

  const elems = opts.elements.map((e) => `<m:e><m:r><m:t>${e}</m:t></m:r></m:e>`).join('');

  return `<m:oMath><m:d>${pr}${elems}</m:d></m:oMath>`;
}

describe('Delimiter Layout — TeXbook Rule 19', () => {
  // --- 1. Delimiter height matches content height ---

  it('produces non-zero dimensions for a simple delimiter', () => {
    const layout = layoutFromOMML(delimOMML({ begChr: '(', endChr: ')' }));
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
    expect(layout.baseline).toBeGreaterThan(0);
  });

  it('delimiter height is at least the content height', () => {
    const bare = layoutFromOMML('<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>');
    const delimited = layoutFromOMML(delimOMML({ begChr: '(', endChr: ')' }));
    // The delimiter box height must be >= the raw content height
    expect(delimited.height).toBeGreaterThanOrEqual(bare.height);
  });

  it('delimiter is wider than bare content (accounts for brackets)', () => {
    const bare = layoutFromOMML('<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>');
    const delimited = layoutFromOMML(delimOMML({ begChr: '(', endChr: ')' }));
    expect(delimited.width).toBeGreaterThan(bare.width);
  });

  it('taller content produces taller delimiters', () => {
    // A fraction is taller than a single character
    const smallOMML =
      '<m:oMath><m:d><m:dPr><m:begChr m:val="("/><m:endChr m:val=")"/></m:dPr>' +
      '<m:e><m:r><m:t>x</m:t></m:r></m:e></m:d></m:oMath>';
    const tallOMML =
      '<m:oMath><m:d><m:dPr><m:begChr m:val="("/><m:endChr m:val=")"/></m:dPr>' +
      '<m:e><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:e></m:d></m:oMath>';

    const small = layoutFromOMML(smallOMML);
    const tall = layoutFromOMML(tallOMML);
    expect(tall.height).toBeGreaterThan(small.height);
  });

  // --- 2. Bracket width scales with content height ---

  it('bracket width scales with delimiter height', () => {
    // Compare bracket contribution for small vs. tall content
    const smallDelim = layoutFromOMML(delimOMML({ begChr: '(', endChr: ')' }));
    const smallBare = layoutFromOMML('<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>');

    const tallOMML =
      '<m:oMath><m:d><m:dPr><m:begChr m:val="("/><m:endChr m:val=")"/></m:dPr>' +
      '<m:e><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:e></m:d></m:oMath>';
    const tallDelim = layoutFromOMML(tallOMML);
    const tallBare = layoutFromOMML(
      '<m:oMath><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:oMath>',
    );

    // Bracket overhead = delimited width - content width
    const smallBrackets = smallDelim.width - smallBare.width;
    const tallBrackets = tallDelim.width - tallBare.width;

    // Taller content should produce wider brackets (or at least equal due to minimum)
    expect(tallBrackets).toBeGreaterThanOrEqual(smallBrackets);
  });

  it('bracket width has a minimum of fontSize * 0.3', () => {
    const fontSize = 12;
    const layout = layoutFromOMML(delimOMML({ begChr: '(', endChr: ')' }), fontSize);
    const bare = layoutFromOMML('<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>', fontSize);

    // Width overhead includes two brackets + two paddings
    // Each bracket >= fontSize * 0.3 = 3.6
    const overhead = layout.width - bare.width;
    const minBracketWidth = fontSize * 0.3;
    // overhead includes 2 brackets + 2 paddings (each padding is delimiterPadding=2)
    // So overhead >= 2 * minBracketWidth + 2 * 2
    expect(overhead).toBeGreaterThanOrEqual(2 * minBracketWidth);
  });

  // --- 3. Empty delimiter chars use nullDelimiterSpace ---

  it('empty begChr uses nullDelimiterSpace width', () => {
    // With begChr set to empty string (null delimiter)
    const nullBeg = layoutFromOMML(delimOMML({ begChr: '', endChr: ')' }));
    const normalBeg = layoutFromOMML(delimOMML({ begChr: '(', endChr: ')' }));

    // The null-delimiter version should be narrower because nullDelimiterSpace < bracketWidth
    // nullDelimiterSpace = 0.12 * fontSize = 1.44 at fontSize 12
    // bracketWidth >= 0.3 * fontSize = 3.6 at fontSize 12
    expect(nullBeg.width).toBeLessThan(normalBeg.width);
  });

  it('empty endChr uses nullDelimiterSpace width', () => {
    const nullEnd = layoutFromOMML(delimOMML({ begChr: '(', endChr: '' }));
    const normalEnd = layoutFromOMML(delimOMML({ begChr: '(', endChr: ')' }));

    expect(nullEnd.width).toBeLessThan(normalEnd.width);
  });

  it('both empty delimiters still have non-zero width (nullDelimiterSpace)', () => {
    const layout = layoutFromOMML(delimOMML({ begChr: '', endChr: '' }));
    const bare = layoutFromOMML('<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>');

    // Even with both null delimiters, total width should exceed bare content
    // by 2 * nullDelimiterSpace = 2 * 0.12 * 12 = 2.88
    expect(layout.width).toBeGreaterThan(bare.width);
  });

  it('nullDelimiterSpace scales with fontSize', () => {
    const small = layoutFromOMML(delimOMML({ begChr: '', endChr: '' }), 10);
    const large = layoutFromOMML(delimOMML({ begChr: '', endChr: '' }), 20);
    const smallBare = layoutFromOMML('<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>', 10);
    const largeBare = layoutFromOMML('<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>', 20);

    const smallOverhead = small.width - smallBare.width;
    const largeOverhead = large.width - largeBare.width;

    // Larger fontSize should yield proportionally larger null delimiter space
    expect(largeOverhead).toBeGreaterThan(smallOverhead);
  });

  // --- 4. Separator width is proportional to fontSize ---

  it('separator adds width between elements', () => {
    const noSep = layoutFromOMML(
      multiElemDelimOMML({ begChr: '(', endChr: ')', sepChr: '', elements: ['a', 'b'] }),
    );
    const withSep = layoutFromOMML(
      multiElemDelimOMML({ begChr: '(', endChr: ')', sepChr: '|', elements: ['a', 'b'] }),
    );

    expect(withSep.width).toBeGreaterThan(noSep.width);
  });

  it('separator width scales with fontSize', () => {
    const small = layoutFromOMML(
      multiElemDelimOMML({ begChr: '(', endChr: ')', sepChr: '|', elements: ['a', 'b'] }),
      10,
    );
    const large = layoutFromOMML(
      multiElemDelimOMML({ begChr: '(', endChr: ')', sepChr: '|', elements: ['a', 'b'] }),
      20,
    );

    // Width should scale roughly with fontSize (not exactly, due to glyph metrics)
    expect(large.width).toBeGreaterThan(small.width);
    // Ratio should be approximately 2x (fontSize ratio)
    const ratio = large.width / small.width;
    expect(ratio).toBeGreaterThan(1.5);
    expect(ratio).toBeLessThan(2.5);
  });

  // --- 5. Content is centered between delimiters ---

  it('content children are offset past the beginning delimiter', () => {
    const layout = layoutFromOMML(delimOMML({ begChr: '(', endChr: ')' }));

    // layoutEquation wraps the delimiter box in arrangeHorizontally, so
    // layout.children[0] is the delimiter box itself. The content children
    // are nested inside it with x offsets past the opening bracket.
    const delimBox = layout.children[0];
    expect(delimBox.children.length).toBeGreaterThan(0);
    for (const child of delimBox.children) {
      expect(child.x).toBeGreaterThan(0);
    }
  });

  it('content starts at the same x position regardless of content width', () => {
    const narrow = layoutFromOMML(delimOMML({ begChr: '(', endChr: ')', content: 'x' }));
    const wide = layoutFromOMML(delimOMML({ begChr: '(', endChr: ')', content: 'abcde' }));

    // The delimiter box is the first child of the root layout
    const narrowDelim = narrow.children[0];
    const wideDelim = wide.children[0];

    if (narrowDelim.children.length > 0 && wideDelim.children.length > 0) {
      // For same-height content, bracket width is the same, so content starts at same x
      const narrowFirstX = narrowDelim.children[0].x;
      const wideFirstX = wideDelim.children[0].x;
      expect(narrowFirstX).toBeGreaterThan(0);
      expect(wideFirstX).toBeGreaterThan(0);
      // Both should be at the same offset since content height (and thus bracket width) is equal
      expect(narrowFirstX).toBeCloseTo(wideFirstX, 2);
    }
  });

  it('multi-element content groups are positioned sequentially', () => {
    const layout = layoutFromOMML(
      multiElemDelimOMML({ begChr: '(', endChr: ')', sepChr: '|', elements: ['a', 'b', 'c'] }),
    );

    // The delimiter box is the first child of the root layout
    const delimBox = layout.children[0];
    // Should have children from 3 content groups
    expect(delimBox.children.length).toBeGreaterThan(0);
    // Children should be ordered left-to-right
    for (let i = 1; i < delimBox.children.length; i++) {
      expect(delimBox.children[i].x).toBeGreaterThanOrEqual(delimBox.children[i - 1].x);
    }
  });

  // --- Additional: axis-centering and shortfall ---

  it('delimiter height never shrinks below content height', () => {
    // Even with delimiterShortfall, delimiters should not be shorter than content
    const layouts = [
      layoutFromOMML(delimOMML({ begChr: '(', endChr: ')', content: 'x' })),
      layoutFromOMML(delimOMML({ begChr: '[', endChr: ']', content: 'xyz' })),
      layoutFromOMML(delimOMML({ begChr: '{', endChr: '}', content: 'a' })),
    ];

    const bare = layoutFromOMML('<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>');

    for (const layout of layouts) {
      expect(layout.height).toBeGreaterThanOrEqual(bare.height);
    }
  });

  it('default delimiters (no dPr) produce valid layout', () => {
    // When no dPr is specified, parser uses defaults
    const layout = layoutFromOMML(
      '<m:oMath><m:d><m:e><m:r><m:t>x</m:t></m:r></m:e></m:d></m:oMath>',
    );
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
    expect(layout.baseline).toBeGreaterThan(0);
  });

  it('snapshot: delimiter layout with parentheses', () => {
    const layout = layoutFromOMML(delimOMML({ begChr: '(', endChr: ')' }));
    expect({
      width: Math.round(layout.width * 100) / 100,
      height: Math.round(layout.height * 100) / 100,
      baseline: Math.round(layout.baseline * 100) / 100,
      childCount: layout.children.length,
    }).toMatchSnapshot();
  });

  it('snapshot: delimiter layout with null delimiters', () => {
    const layout = layoutFromOMML(delimOMML({ begChr: '', endChr: '' }));
    expect({
      width: Math.round(layout.width * 100) / 100,
      height: Math.round(layout.height * 100) / 100,
      baseline: Math.round(layout.baseline * 100) / 100,
      childCount: layout.children.length,
    }).toMatchSnapshot();
  });
});
