/**
 * Comparators
 *
 * Compare two equation ASTs for structural and semantic equality.
 */

import type { MathNode } from '@mog-sdk/contracts/equation/omml-ast';

export interface ComparisonResult {
  match: boolean;
  differences: Difference[];
}

export interface Difference {
  path: string;
  type: 'missing' | 'extra' | 'type_mismatch' | 'value_mismatch';
  expected?: string;
  actual?: string;
}

/**
 * Compare two equation ASTs for structural equivalence.
 * Reports differences in structure and content.
 */
export function compareEquations(a: MathNode[], b: MathNode[]): ComparisonResult {
  const differences: Difference[] = [];
  compareNodeArrays(a, b, '', differences);
  return {
    match: differences.length === 0,
    differences,
  };
}

function compareNodeArrays(a: MathNode[], b: MathNode[], path: string, diffs: Difference[]): void {
  const maxLen = Math.max(a.length, b.length);
  for (let i = 0; i < maxLen; i++) {
    const nodePath = `${path}[${i}]`;
    if (i >= a.length) {
      diffs.push({ path: nodePath, type: 'extra', actual: b[i].type });
      continue;
    }
    if (i >= b.length) {
      diffs.push({ path: nodePath, type: 'missing', expected: a[i].type });
      continue;
    }
    compareNodes(a[i], b[i], nodePath, diffs);
  }
}

function compareNodes(a: MathNode, b: MathNode, path: string, diffs: Difference[]): void {
  if (a.type !== b.type) {
    diffs.push({
      path,
      type: 'type_mismatch',
      expected: a.type,
      actual: b.type,
    });
    return;
  }

  switch (a.type) {
    case 'r': {
      const br = b as typeof a;
      if (a.text !== br.text) {
        diffs.push({
          path: `${path}/text`,
          type: 'value_mismatch',
          expected: a.text,
          actual: br.text,
        });
      }
      // Compare rPr (run properties) styling fields
      const aRPr = a.rPr;
      const bRPr = br.rPr;
      if (aRPr?.nor !== bRPr?.nor) {
        diffs.push({
          path: `${path}/rPr/nor`,
          type: 'value_mismatch',
          expected: String(aRPr?.nor),
          actual: String(bRPr?.nor),
        });
      }
      if (aRPr?.sty !== bRPr?.sty) {
        diffs.push({
          path: `${path}/rPr/sty`,
          type: 'value_mismatch',
          expected: aRPr?.sty,
          actual: bRPr?.sty,
        });
      }
      if (aRPr?.brk?.alnAt !== bRPr?.brk?.alnAt) {
        diffs.push({
          path: `${path}/rPr/brk`,
          type: 'value_mismatch',
          expected: JSON.stringify(aRPr?.brk),
          actual: JSON.stringify(bRPr?.brk),
        });
      }
      if (aRPr?.aln !== bRPr?.aln) {
        diffs.push({
          path: `${path}/rPr/aln`,
          type: 'value_mismatch',
          expected: String(aRPr?.aln),
          actual: String(bRPr?.aln),
        });
      }
      break;
    }
    case 'f': {
      const bf = b as typeof a;
      if (a.fractionType !== bf.fractionType) {
        diffs.push({
          path: `${path}/fractionType`,
          type: 'value_mismatch',
          expected: a.fractionType,
          actual: bf.fractionType,
        });
      }
      compareNodeArrays(a.num, bf.num, `${path}/num`, diffs);
      compareNodeArrays(a.den, bf.den, `${path}/den`, diffs);
      break;
    }
    case 'rad': {
      const br = b as typeof a;
      compareNodeArrays(a.e, br.e, `${path}/e`, diffs);
      compareNodeArrays(a.deg, br.deg, `${path}/deg`, diffs);
      break;
    }
    case 'sSup': {
      const bs = b as typeof a;
      compareNodeArrays(a.e, bs.e, `${path}/e`, diffs);
      compareNodeArrays(a.sup, bs.sup, `${path}/sup`, diffs);
      break;
    }
    case 'sSub': {
      const bs = b as typeof a;
      compareNodeArrays(a.e, bs.e, `${path}/e`, diffs);
      compareNodeArrays(a.sub, bs.sub, `${path}/sub`, diffs);
      break;
    }
    case 'sSubSup': {
      const bs = b as typeof a;
      compareNodeArrays(a.e, bs.e, `${path}/e`, diffs);
      compareNodeArrays(a.sub, bs.sub, `${path}/sub`, diffs);
      compareNodeArrays(a.sup, bs.sup, `${path}/sup`, diffs);
      break;
    }
    case 'nary': {
      const bn = b as typeof a;
      if (a.chr !== bn.chr) {
        diffs.push({
          path: `${path}/chr`,
          type: 'value_mismatch',
          expected: a.chr,
          actual: bn.chr,
        });
      }
      compareNodeArrays(a.sub, bn.sub, `${path}/sub`, diffs);
      compareNodeArrays(a.sup, bn.sup, `${path}/sup`, diffs);
      compareNodeArrays(a.e, bn.e, `${path}/e`, diffs);
      break;
    }
    case 'm': {
      const bm = b as typeof a;
      const maxRows = Math.max(a.mr.length, bm.mr.length);
      for (let r = 0; r < maxRows; r++) {
        if (r >= a.mr.length) {
          diffs.push({ path: `${path}/mr[${r}]`, type: 'extra' });
        } else if (r >= bm.mr.length) {
          diffs.push({ path: `${path}/mr[${r}]`, type: 'missing' });
        } else {
          const maxCells = Math.max(a.mr[r].length, bm.mr[r].length);
          for (let c = 0; c < maxCells; c++) {
            if (c >= a.mr[r].length) {
              diffs.push({ path: `${path}/mr[${r}][${c}]`, type: 'extra' });
            } else if (c >= bm.mr[r].length) {
              diffs.push({ path: `${path}/mr[${r}][${c}]`, type: 'missing' });
            } else {
              compareNodeArrays(a.mr[r][c], bm.mr[r][c], `${path}/mr[${r}][${c}]`, diffs);
            }
          }
        }
      }
      break;
    }
    case 'd': {
      const bd = b as typeof a;
      if (a.begChr !== bd.begChr) {
        diffs.push({
          path: `${path}/begChr`,
          type: 'value_mismatch',
          expected: a.begChr,
          actual: bd.begChr,
        });
      }
      if (a.endChr !== bd.endChr) {
        diffs.push({
          path: `${path}/endChr`,
          type: 'value_mismatch',
          expected: a.endChr,
          actual: bd.endChr,
        });
      }
      const maxE = Math.max(a.e.length, bd.e.length);
      for (let i = 0; i < maxE; i++) {
        if (i >= a.e.length) {
          diffs.push({ path: `${path}/e[${i}]`, type: 'extra' });
        } else if (i >= bd.e.length) {
          diffs.push({ path: `${path}/e[${i}]`, type: 'missing' });
        } else {
          compareNodeArrays(a.e[i], bd.e[i], `${path}/e[${i}]`, diffs);
        }
      }
      break;
    }
    case 'acc': {
      const ba = b as typeof a;
      if (a.chr !== ba.chr) {
        diffs.push({
          path: `${path}/chr`,
          type: 'value_mismatch',
          expected: a.chr,
          actual: ba.chr,
        });
      }
      compareNodeArrays(a.e, ba.e, `${path}/e`, diffs);
      break;
    }
    case 'bar': {
      const bb = b as typeof a;
      if (a.pos !== bb.pos) {
        diffs.push({
          path: `${path}/pos`,
          type: 'value_mismatch',
          expected: a.pos,
          actual: bb.pos,
        });
      }
      compareNodeArrays(a.e, bb.e, `${path}/e`, diffs);
      break;
    }
    case 'func': {
      const bf = b as typeof a;
      compareNodeArrays(a.fName, bf.fName, `${path}/fName`, diffs);
      compareNodeArrays(a.e, bf.e, `${path}/e`, diffs);
      break;
    }
    case 'limLow':
    case 'limUpp': {
      const bl = b as typeof a;
      compareNodeArrays(a.e, bl.e, `${path}/e`, diffs);
      compareNodeArrays(a.lim, bl.lim, `${path}/lim`, diffs);
      break;
    }
    case 'oMath': {
      const bo = b as typeof a;
      compareNodeArrays(a.children, bo.children, `${path}/children`, diffs);
      break;
    }
    case 'groupChr': {
      const bg = b as typeof a;
      if (a.chr !== bg.chr) {
        diffs.push({
          path: `${path}/chr`,
          type: 'value_mismatch',
          expected: a.chr,
          actual: bg.chr,
        });
      }
      if (a.pos !== bg.pos) {
        diffs.push({
          path: `${path}/pos`,
          type: 'value_mismatch',
          expected: a.pos,
          actual: bg.pos,
        });
      }
      if (a.vertJc !== bg.vertJc) {
        diffs.push({
          path: `${path}/vertJc`,
          type: 'value_mismatch',
          expected: a.vertJc,
          actual: bg.vertJc,
        });
      }
      compareNodeArrays(a.e, bg.e, `${path}/e`, diffs);
      break;
    }
    case 'box': {
      const bb = b as typeof a;
      if (a.opEmu !== bb.opEmu) {
        diffs.push({
          path: `${path}/opEmu`,
          type: 'value_mismatch',
          expected: String(a.opEmu),
          actual: String(bb.opEmu),
        });
      }
      if (a.noBreak !== bb.noBreak) {
        diffs.push({
          path: `${path}/noBreak`,
          type: 'value_mismatch',
          expected: String(a.noBreak),
          actual: String(bb.noBreak),
        });
      }
      if (a.diff !== bb.diff) {
        diffs.push({
          path: `${path}/diff`,
          type: 'value_mismatch',
          expected: String(a.diff),
          actual: String(bb.diff),
        });
      }
      if (a.aln !== bb.aln) {
        diffs.push({
          path: `${path}/aln`,
          type: 'value_mismatch',
          expected: String(a.aln),
          actual: String(bb.aln),
        });
      }
      compareNodeArrays(a.e, bb.e, `${path}/e`, diffs);
      break;
    }
    case 'borderBox': {
      const bbox = b as typeof a;
      if (a.hideTop !== bbox.hideTop) {
        diffs.push({
          path: `${path}/hideTop`,
          type: 'value_mismatch',
          expected: String(a.hideTop),
          actual: String(bbox.hideTop),
        });
      }
      if (a.hideBot !== bbox.hideBot) {
        diffs.push({
          path: `${path}/hideBot`,
          type: 'value_mismatch',
          expected: String(a.hideBot),
          actual: String(bbox.hideBot),
        });
      }
      if (a.hideLeft !== bbox.hideLeft) {
        diffs.push({
          path: `${path}/hideLeft`,
          type: 'value_mismatch',
          expected: String(a.hideLeft),
          actual: String(bbox.hideLeft),
        });
      }
      if (a.hideRight !== bbox.hideRight) {
        diffs.push({
          path: `${path}/hideRight`,
          type: 'value_mismatch',
          expected: String(a.hideRight),
          actual: String(bbox.hideRight),
        });
      }
      if (a.strikeH !== bbox.strikeH) {
        diffs.push({
          path: `${path}/strikeH`,
          type: 'value_mismatch',
          expected: String(a.strikeH),
          actual: String(bbox.strikeH),
        });
      }
      if (a.strikeV !== bbox.strikeV) {
        diffs.push({
          path: `${path}/strikeV`,
          type: 'value_mismatch',
          expected: String(a.strikeV),
          actual: String(bbox.strikeV),
        });
      }
      if (a.strikeBLTR !== bbox.strikeBLTR) {
        diffs.push({
          path: `${path}/strikeBLTR`,
          type: 'value_mismatch',
          expected: String(a.strikeBLTR),
          actual: String(bbox.strikeBLTR),
        });
      }
      if (a.strikeTLBR !== bbox.strikeTLBR) {
        diffs.push({
          path: `${path}/strikeTLBR`,
          type: 'value_mismatch',
          expected: String(a.strikeTLBR),
          actual: String(bbox.strikeTLBR),
        });
      }
      compareNodeArrays(a.e, bbox.e, `${path}/e`, diffs);
      break;
    }
    case 'phant': {
      const bp = b as typeof a;
      if (a.show !== bp.show) {
        diffs.push({
          path: `${path}/show`,
          type: 'value_mismatch',
          expected: String(a.show),
          actual: String(bp.show),
        });
      }
      if (a.zeroWid !== bp.zeroWid) {
        diffs.push({
          path: `${path}/zeroWid`,
          type: 'value_mismatch',
          expected: String(a.zeroWid),
          actual: String(bp.zeroWid),
        });
      }
      if (a.zeroAsc !== bp.zeroAsc) {
        diffs.push({
          path: `${path}/zeroAsc`,
          type: 'value_mismatch',
          expected: String(a.zeroAsc),
          actual: String(bp.zeroAsc),
        });
      }
      if (a.zeroDesc !== bp.zeroDesc) {
        diffs.push({
          path: `${path}/zeroDesc`,
          type: 'value_mismatch',
          expected: String(a.zeroDesc),
          actual: String(bp.zeroDesc),
        });
      }
      if (a.transp !== bp.transp) {
        diffs.push({
          path: `${path}/transp`,
          type: 'value_mismatch',
          expected: String(a.transp),
          actual: String(bp.transp),
        });
      }
      compareNodeArrays(a.e, bp.e, `${path}/e`, diffs);
      break;
    }
    case 'eqArr': {
      const beq = b as typeof a;
      const maxE = Math.max(a.e.length, beq.e.length);
      for (let i = 0; i < maxE; i++) {
        if (i >= a.e.length) diffs.push({ path: `${path}/e[${i}]`, type: 'extra' });
        else if (i >= beq.e.length) diffs.push({ path: `${path}/e[${i}]`, type: 'missing' });
        else compareNodeArrays(a.e[i], beq.e[i], `${path}/e[${i}]`, diffs);
      }
      break;
    }
    case 'sPre': {
      const bp = b as typeof a;
      compareNodeArrays(a.sub, bp.sub, `${path}/sub`, diffs);
      compareNodeArrays(a.sup, bp.sup, `${path}/sup`, diffs);
      compareNodeArrays(a.e, bp.e, `${path}/e`, diffs);
      break;
    }
    case 'oMathPara': {
      const bop = b as typeof a;
      const maxEq = Math.max(a.equations.length, bop.equations.length);
      for (let i = 0; i < maxEq; i++) {
        if (i >= a.equations.length) diffs.push({ path: `${path}/eq[${i}]`, type: 'extra' });
        else if (i >= bop.equations.length)
          diffs.push({ path: `${path}/eq[${i}]`, type: 'missing' });
        else
          compareNodeArrays(
            a.equations[i].children,
            bop.equations[i].children,
            `${path}/eq[${i}]`,
            diffs,
          );
      }
      break;
    }
  }
}
