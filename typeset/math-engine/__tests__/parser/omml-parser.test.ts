/**
 * OMML Parser Tests
 *
 * Tests parsing of all OMML element types into MathAST.
 */

import type { MathNode } from '@mog-sdk/contracts/equation/omml-ast';
import { parseOMML } from '../../src/parser/omml-parser';

function parseOk(omml: string): MathNode[] {
  const result = parseOMML(omml);
  if (!result.ok) {
    throw new Error(`Parse failed: ${result.error.message}`);
  }
  return result.value;
}

describe('OMML Parser', () => {
  describe('oMath root', () => {
    it('parses empty oMath', () => {
      const nodes = parseOk('<m:oMath></m:oMath>');
      expect(nodes).toHaveLength(1);
      expect(nodes[0].type).toBe('oMath');
    });

    it('parses oMath with text run', () => {
      const nodes = parseOk('<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>');
      expect(nodes).toHaveLength(1);
      expect(nodes[0].type).toBe('oMath');
      const oMath = nodes[0] as MathNode & { type: 'oMath' };
      expect(oMath.children).toHaveLength(1);
      expect(oMath.children[0].type).toBe('r');
    });
  });

  describe('fraction (m:f)', () => {
    it('parses simple fraction', () => {
      const omml =
        '<m:oMath><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:oMath>';
      const nodes = parseOk(omml);
      const oMath = nodes[0] as MathNode & { type: 'oMath' };
      const frac = oMath.children[0] as MathNode & { type: 'f' };
      expect(frac.type).toBe('f');
      expect(frac.fractionType).toBe('bar');
      expect(frac.num).toHaveLength(1);
      expect(frac.den).toHaveLength(1);
    });

    it('parses fraction with type property', () => {
      const omml =
        '<m:oMath><m:f><m:fPr><m:type m:val="lin"/></m:fPr><m:num><m:r><m:t>1</m:t></m:r></m:num><m:den><m:r><m:t>2</m:t></m:r></m:den></m:f></m:oMath>';
      const nodes = parseOk(omml);
      const oMath = nodes[0] as MathNode & { type: 'oMath' };
      const frac = oMath.children[0] as MathNode & { type: 'f' };
      expect(frac.fractionType).toBe('lin');
    });

    it('parses skewed fraction', () => {
      const omml =
        '<m:oMath><m:f><m:fPr><m:type m:val="skw"/></m:fPr><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:oMath>';
      const nodes = parseOk(omml);
      const oMath = nodes[0] as MathNode & { type: 'oMath' };
      const frac = oMath.children[0] as MathNode & { type: 'f' };
      expect(frac.fractionType).toBe('skw');
    });

    it('parses noBar fraction', () => {
      const omml =
        '<m:oMath><m:f><m:fPr><m:type m:val="noBar"/></m:fPr><m:num><m:r><m:t>n</m:t></m:r></m:num><m:den><m:r><m:t>k</m:t></m:r></m:den></m:f></m:oMath>';
      const nodes = parseOk(omml);
      const oMath = nodes[0] as MathNode & { type: 'oMath' };
      const frac = oMath.children[0] as MathNode & { type: 'f' };
      expect(frac.fractionType).toBe('noBar');
    });
  });

  describe('radical (m:rad)', () => {
    it('parses square root', () => {
      const omml =
        '<m:oMath><m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e><m:r><m:t>x</m:t></m:r></m:e></m:rad></m:oMath>';
      const nodes = parseOk(omml);
      const oMath = nodes[0] as MathNode & { type: 'oMath' };
      const rad = oMath.children[0] as MathNode & { type: 'rad' };
      expect(rad.type).toBe('rad');
      expect(rad.degHide).toBe(true);
      expect(rad.e).toHaveLength(1);
    });

    it('parses nth root', () => {
      const omml =
        '<m:oMath><m:rad><m:deg><m:r><m:t>3</m:t></m:r></m:deg><m:e><m:r><m:t>x</m:t></m:r></m:e></m:rad></m:oMath>';
      const nodes = parseOk(omml);
      const oMath = nodes[0] as MathNode & { type: 'oMath' };
      const rad = oMath.children[0] as MathNode & { type: 'rad' };
      expect(rad.deg).toHaveLength(1);
    });
  });

  describe('superscript (m:sSup)', () => {
    it('parses superscript', () => {
      const omml =
        '<m:oMath><m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath>';
      const nodes = parseOk(omml);
      const oMath = nodes[0] as MathNode & { type: 'oMath' };
      const sup = oMath.children[0] as MathNode & { type: 'sSup' };
      expect(sup.type).toBe('sSup');
      expect(sup.e).toHaveLength(1);
      expect(sup.sup).toHaveLength(1);
    });
  });

  describe('subscript (m:sSub)', () => {
    it('parses subscript', () => {
      const omml =
        '<m:oMath><m:sSub><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sub><m:r><m:t>n</m:t></m:r></m:sub></m:sSub></m:oMath>';
      const nodes = parseOk(omml);
      const oMath = nodes[0] as MathNode & { type: 'oMath' };
      const sub = oMath.children[0] as MathNode & { type: 'sSub' };
      expect(sub.type).toBe('sSub');
      expect(sub.e).toHaveLength(1);
      expect(sub.sub).toHaveLength(1);
    });
  });

  describe('sub-superscript (m:sSubSup)', () => {
    it('parses sub-superscript', () => {
      const omml =
        '<m:oMath><m:sSubSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sub><m:r><m:t>i</m:t></m:r></m:sub><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSubSup></m:oMath>';
      const nodes = parseOk(omml);
      const oMath = nodes[0] as MathNode & { type: 'oMath' };
      const ss = oMath.children[0] as MathNode & { type: 'sSubSup' };
      expect(ss.type).toBe('sSubSup');
      expect(ss.e).toHaveLength(1);
      expect(ss.sub).toHaveLength(1);
      expect(ss.sup).toHaveLength(1);
    });
  });

  describe('matrix (m:m)', () => {
    it('parses 2x2 matrix', () => {
      const omml =
        '<m:oMath><m:m><m:mr><m:e><m:r><m:t>a</m:t></m:r></m:e><m:e><m:r><m:t>b</m:t></m:r></m:e></m:mr><m:mr><m:e><m:r><m:t>c</m:t></m:r></m:e><m:e><m:r><m:t>d</m:t></m:r></m:e></m:mr></m:m></m:oMath>';
      const nodes = parseOk(omml);
      const oMath = nodes[0] as MathNode & { type: 'oMath' };
      const matrix = oMath.children[0] as MathNode & { type: 'm' };
      expect(matrix.type).toBe('m');
      expect(matrix.mr).toHaveLength(2);
    });
  });

  describe('delimiter (m:d)', () => {
    it('parses parentheses delimiter', () => {
      const omml =
        '<m:oMath><m:d><m:dPr><m:begChr m:val="("/><m:endChr m:val=")"/></m:dPr><m:e><m:r><m:t>x+1</m:t></m:r></m:e></m:d></m:oMath>';
      const nodes = parseOk(omml);
      const oMath = nodes[0] as MathNode & { type: 'oMath' };
      const delim = oMath.children[0] as MathNode & { type: 'd' };
      expect(delim.type).toBe('d');
      expect(delim.begChr).toBe('(');
      expect(delim.endChr).toBe(')');
      expect(delim.e).toHaveLength(1);
    });

    it('parses default delimiters (no dPr)', () => {
      const omml = '<m:oMath><m:d><m:e><m:r><m:t>x</m:t></m:r></m:e></m:d></m:oMath>';
      const nodes = parseOk(omml);
      const oMath = nodes[0] as MathNode & { type: 'oMath' };
      const delim = oMath.children[0] as MathNode & { type: 'd' };
      expect(delim.type).toBe('d');
    });
  });

  describe('accent (m:acc)', () => {
    it('parses accent with character', () => {
      const omml =
        '<m:oMath><m:acc><m:accPr><m:chr m:val="\u0302"/></m:accPr><m:e><m:r><m:t>x</m:t></m:r></m:e></m:acc></m:oMath>';
      const nodes = parseOk(omml);
      const oMath = nodes[0] as MathNode & { type: 'oMath' };
      const acc = oMath.children[0] as MathNode & { type: 'acc' };
      expect(acc.type).toBe('acc');
      expect(acc.chr).toBe('\u0302');
      expect(acc.e).toHaveLength(1);
    });

    it('parses accent without explicit character', () => {
      const omml = '<m:oMath><m:acc><m:e><m:r><m:t>x</m:t></m:r></m:e></m:acc></m:oMath>';
      const nodes = parseOk(omml);
      const oMath = nodes[0] as MathNode & { type: 'oMath' };
      const acc = oMath.children[0] as MathNode & { type: 'acc' };
      expect(acc.type).toBe('acc');
      expect(acc.chr).toBeUndefined();
    });
  });

  describe('function (m:func)', () => {
    it('parses function with name and argument', () => {
      const omml =
        '<m:oMath><m:func><m:fName><m:r><m:rPr><m:nor/></m:rPr><m:t>sin</m:t></m:r></m:fName><m:e><m:r><m:t>x</m:t></m:r></m:e></m:func></m:oMath>';
      const nodes = parseOk(omml);
      const oMath = nodes[0] as MathNode & { type: 'oMath' };
      const func = oMath.children[0] as MathNode & { type: 'func' };
      expect(func.type).toBe('func');
      expect(func.fName).toHaveLength(1);
      expect(func.e).toHaveLength(1);
    });
  });

  describe('n-ary (m:nary)', () => {
    it('parses summation', () => {
      const omml =
        '<m:oMath><m:nary><m:naryPr><m:chr m:val="\u2211"/><m:limLoc m:val="undOvr"/></m:naryPr><m:sub><m:r><m:t>i=1</m:t></m:r></m:sub><m:sup><m:r><m:t>n</m:t></m:r></m:sup><m:e><m:r><m:t>i</m:t></m:r></m:e></m:nary></m:oMath>';
      const nodes = parseOk(omml);
      const oMath = nodes[0] as MathNode & { type: 'oMath' };
      const nary = oMath.children[0] as MathNode & { type: 'nary' };
      expect(nary.type).toBe('nary');
      expect(nary.chr).toBe('\u2211');
      expect(nary.limLoc).toBe('undOvr');
    });

    it('parses integral', () => {
      const omml =
        '<m:oMath><m:nary><m:naryPr><m:chr m:val="\u222B"/><m:limLoc m:val="subSup"/></m:naryPr><m:sub><m:r><m:t>a</m:t></m:r></m:sub><m:sup><m:r><m:t>b</m:t></m:r></m:sup><m:e><m:r><m:t>f(x)</m:t></m:r></m:e></m:nary></m:oMath>';
      const nodes = parseOk(omml);
      const oMath = nodes[0] as MathNode & { type: 'oMath' };
      const nary = oMath.children[0] as MathNode & { type: 'nary' };
      expect(nary.chr).toBe('\u222B');
      expect(nary.limLoc).toBe('subSup');
    });
  });

  describe('bar (m:bar)', () => {
    it('parses overbar', () => {
      const omml =
        '<m:oMath><m:bar><m:barPr><m:pos m:val="top"/></m:barPr><m:e><m:r><m:t>x</m:t></m:r></m:e></m:bar></m:oMath>';
      const nodes = parseOk(omml);
      const oMath = nodes[0] as MathNode & { type: 'oMath' };
      const bar = oMath.children[0] as MathNode & { type: 'bar' };
      expect(bar.type).toBe('bar');
      expect(bar.pos).toBe('top');
    });

    it('parses underbar', () => {
      const omml =
        '<m:oMath><m:bar><m:barPr><m:pos m:val="bot"/></m:barPr><m:e><m:r><m:t>x</m:t></m:r></m:e></m:bar></m:oMath>';
      const nodes = parseOk(omml);
      const oMath = nodes[0] as MathNode & { type: 'oMath' };
      const bar = oMath.children[0] as MathNode & { type: 'bar' };
      expect(bar.pos).toBe('bot');
    });
  });

  describe('limits (m:limLow, m:limUpp)', () => {
    it('parses lower limit', () => {
      const omml =
        '<m:oMath><m:limLow><m:e><m:r><m:t>lim</m:t></m:r></m:e><m:lim><m:r><m:t>x\u21920</m:t></m:r></m:lim></m:limLow></m:oMath>';
      const nodes = parseOk(omml);
      const oMath = nodes[0] as MathNode & { type: 'oMath' };
      const lim = oMath.children[0] as MathNode & { type: 'limLow' };
      expect(lim.type).toBe('limLow');
      expect(lim.e).toHaveLength(1);
      expect(lim.lim).toHaveLength(1);
    });

    it('parses upper limit', () => {
      const omml =
        '<m:oMath><m:limUpp><m:e><m:r><m:t>x</m:t></m:r></m:e><m:lim><m:r><m:t>n</m:t></m:r></m:lim></m:limUpp></m:oMath>';
      const nodes = parseOk(omml);
      const oMath = nodes[0] as MathNode & { type: 'oMath' };
      const lim = oMath.children[0] as MathNode & { type: 'limUpp' };
      expect(lim.type).toBe('limUpp');
    });
  });

  describe('box (m:box)', () => {
    it('parses box with content', () => {
      const omml = '<m:oMath><m:box><m:e><m:r><m:t>x</m:t></m:r></m:e></m:box></m:oMath>';
      const nodes = parseOk(omml);
      const oMath = nodes[0] as MathNode & { type: 'oMath' };
      const box = oMath.children[0] as MathNode & { type: 'box' };
      expect(box.type).toBe('box');
      expect(box.e).toHaveLength(1);
    });
  });

  describe('borderBox (m:borderBox)', () => {
    it('parses borderBox', () => {
      const omml =
        '<m:oMath><m:borderBox><m:e><m:r><m:t>x</m:t></m:r></m:e></m:borderBox></m:oMath>';
      const nodes = parseOk(omml);
      const oMath = nodes[0] as MathNode & { type: 'oMath' };
      expect(oMath.children[0].type).toBe('borderBox');
    });
  });

  describe('equation array (m:eqArr)', () => {
    it('parses equation array with multiple rows', () => {
      const omml =
        '<m:oMath><m:eqArr><m:e><m:r><m:t>x=1</m:t></m:r></m:e><m:e><m:r><m:t>y=2</m:t></m:r></m:e></m:eqArr></m:oMath>';
      const nodes = parseOk(omml);
      const oMath = nodes[0] as MathNode & { type: 'oMath' };
      const eqArr = oMath.children[0] as MathNode & { type: 'eqArr' };
      expect(eqArr.type).toBe('eqArr');
      expect(eqArr.e).toHaveLength(2);
    });
  });

  describe('groupChar (m:groupChr)', () => {
    it('parses group character', () => {
      const omml =
        '<m:oMath><m:groupChr><m:groupChrPr><m:chr m:val="\u23DF"/><m:pos m:val="bot"/></m:groupChrPr><m:e><m:r><m:t>abc</m:t></m:r></m:e></m:groupChr></m:oMath>';
      const nodes = parseOk(omml);
      const oMath = nodes[0] as MathNode & { type: 'oMath' };
      const gc = oMath.children[0] as MathNode & { type: 'groupChr' };
      expect(gc.type).toBe('groupChr');
      expect(gc.chr).toBe('\u23DF');
      expect(gc.pos).toBe('bot');
    });
  });

  describe('phantom (m:phant)', () => {
    it('parses phantom', () => {
      const omml =
        '<m:oMath><m:phant><m:phantPr><m:show m:val="0"/></m:phantPr><m:e><m:r><m:t>x</m:t></m:r></m:e></m:phant></m:oMath>';
      const nodes = parseOk(omml);
      const oMath = nodes[0] as MathNode & { type: 'oMath' };
      expect(oMath.children[0].type).toBe('phant');
    });
  });

  describe('pre-script (m:sPre)', () => {
    it('parses pre-script', () => {
      const omml =
        '<m:oMath><m:sPre><m:sub><m:r><m:t>2</m:t></m:r></m:sub><m:sup><m:r><m:t>3</m:t></m:r></m:sup><m:e><m:r><m:t>He</m:t></m:r></m:e></m:sPre></m:oMath>';
      const nodes = parseOk(omml);
      const oMath = nodes[0] as MathNode & { type: 'oMath' };
      const sPre = oMath.children[0] as MathNode & { type: 'sPre' };
      expect(sPre.type).toBe('sPre');
      expect(sPre.sub).toHaveLength(1);
      expect(sPre.sup).toHaveLength(1);
      expect(sPre.e).toHaveLength(1);
    });
  });

  describe('text run (m:r)', () => {
    it('parses text with properties', () => {
      const omml =
        '<m:oMath><m:r><m:rPr><m:sty m:val="bi"/></m:rPr><m:t>Hello</m:t></m:r></m:oMath>';
      const nodes = parseOk(omml);
      const oMath = nodes[0] as MathNode & { type: 'oMath' };
      const run = oMath.children[0] as MathNode & { type: 'r' };
      expect(run.type).toBe('r');
      expect(run.text).toBe('Hello');
      expect(run.rPr?.sty).toBe('bi');
    });

    it('parses normal text property', () => {
      const omml = '<m:oMath><m:r><m:rPr><m:nor/></m:rPr><m:t>sin</m:t></m:r></m:oMath>';
      const nodes = parseOk(omml);
      const oMath = nodes[0] as MathNode & { type: 'oMath' };
      const run = oMath.children[0] as MathNode & { type: 'r' };
      expect(run.rPr?.nor).toBe(true);
    });
  });

  describe('error handling', () => {
    it('returns error for empty input', () => {
      const result = parseOMML('');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('EMPTY_INPUT');
      }
    });

    it('returns error for whitespace only', () => {
      const result = parseOMML('   ');
      expect(result.ok).toBe(false);
    });
  });

  describe('nested elements', () => {
    it('parses fraction inside radical', () => {
      const omml = `<m:oMath>
        <m:rad>
          <m:radPr><m:degHide m:val="1"/></m:radPr>
          <m:deg/>
          <m:e>
            <m:f>
              <m:num><m:r><m:t>a</m:t></m:r></m:num>
              <m:den><m:r><m:t>b</m:t></m:r></m:den>
            </m:f>
          </m:e>
        </m:rad>
      </m:oMath>`;
      const nodes = parseOk(omml);
      const oMath = nodes[0] as MathNode & { type: 'oMath' };
      const rad = oMath.children[0] as MathNode & { type: 'rad' };
      expect(rad.type).toBe('rad');
      expect(rad.e[0].type).toBe('f');
    });

    it('parses superscript inside fraction numerator', () => {
      const omml = `<m:oMath>
        <m:f>
          <m:num>
            <m:sSup>
              <m:e><m:r><m:t>x</m:t></m:r></m:e>
              <m:sup><m:r><m:t>2</m:t></m:r></m:sup>
            </m:sSup>
          </m:num>
          <m:den><m:r><m:t>y</m:t></m:r></m:den>
        </m:f>
      </m:oMath>`;
      const nodes = parseOk(omml);
      const oMath = nodes[0] as MathNode & { type: 'oMath' };
      const frac = oMath.children[0] as MathNode & { type: 'f' };
      expect(frac.num[0].type).toBe('sSup');
    });
  });
});
