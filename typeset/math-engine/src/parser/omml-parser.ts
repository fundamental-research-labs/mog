/**
 * OMML Parser
 *
 * Parses Office Math Markup Language (OMML) XML into the MathAST
 * defined in @mog-sdk/contracts/equation/omml-ast.
 *
 * OMML uses the 'm:' namespace and maps to ECMA-376 Part 1 shared-math.xsd.
 */

import type { EquationParseError } from '@mog-sdk/contracts/equation/errors';
import { createEquationParseError } from '../errors';
import type {
  AccentNode,
  BarNode,
  BorderBoxNode,
  BoxNode,
  DelimiterNode,
  EqArrayNode,
  FractionNode,
  FunctionNode,
  GroupCharNode,
  LimLowNode,
  LimUppNode,
  MathNode,
  MathRun,
  MathRunProperties,
  MatrixNode,
  NaryNode,
  OMath,
  PhantomNode,
  PreScriptNode,
  RadicalNode,
  SubscriptNode,
  SubSupNode,
  SuperscriptNode,
} from '@mog-sdk/contracts/equation/omml-ast';
import type { Result } from '@mog-sdk/contracts/equation/types';
import type { XmlNode } from './xml-utils';
import {
  findChild,
  findChildren,
  getAttr,
  getTextContent,
  parseXml,
  parseXmlAll,
} from './xml-utils';

const MAX_DEPTH = 50;

/**
 * Parse an OMML XML string into a MathNode array.
 *
 * Accepts either a full <m:oMath> element or a fragment with multiple
 * math elements. Returns the parsed AST nodes.
 */
export function parseOMML(omml: string): Result<MathNode[], EquationParseError> {
  if (!omml || !omml.trim()) {
    return {
      ok: false,
      error: createEquationParseError('EMPTY_INPUT', 'Empty OMML input'),
    };
  }

  try {
    const roots = parseXmlAll(omml);

    // If we got multiple root-level elements, process each one and collect results
    if (roots.length > 1) {
      const allNodes: MathNode[] = [];
      for (const root of roots) {
        const parsed = parseSingleRoot(root);
        if (parsed) allNodes.push(...parsed);
      }
      if (allNodes.length > 0) {
        return { ok: true, value: allNodes };
      }
      return {
        ok: false,
        error: createEquationParseError(
          'INVALID_STRUCTURE',
          'Unable to parse OMML: no valid math elements found in multiple roots',
        ),
      };
    }

    // Single root element (or empty)
    const root = roots.length === 1 ? roots[0] : parseXml(omml);
    return parseSingleRootResult(root);
  } catch (e) {
    return {
      ok: false,
      error: createEquationParseError(
        'INVALID_XML',
        `XML parsing failed: ${e instanceof Error ? e.message : String(e)}`,
      ),
    };
  }
}

/** Helper: parse a single root XmlNode into MathNode[], or null on failure. */
function parseSingleRoot(root: XmlNode): MathNode[] | null {
  if (root.tag === 'oMath') {
    const children = parseChildren(root, 0);
    return [{ type: 'oMath', children } as OMath];
  }
  if (root.tag === 'oMathPara') {
    const oMathNodes = findChildren(root, 'oMath');
    const equations: OMath[] = oMathNodes.map((n) => ({
      type: 'oMath' as const,
      children: parseChildren(n, 0),
    }));
    const jcNode = findChild(root, 'oMathParaPr');
    const jc = jcNode ? getAttr(findChild(jcNode, 'jc') || jcNode, 'val') : undefined;
    return [
      {
        type: 'oMathPara' as const,
        justification: (jc as 'left' | 'right' | 'center' | 'centerGroup') || undefined,
        equations,
      },
    ];
  }
  const nodes = parseChildren(root, 0);
  if (nodes.length > 0) return nodes;
  const singleNode = parseNode(root, 0);
  if (singleNode) return [singleNode];
  return null;
}

/** Helper: parse a single root XmlNode into a full Result. */
function parseSingleRootResult(root: XmlNode): Result<MathNode[], EquationParseError> {
  const result = parseSingleRoot(root);
  if (result) return { ok: true, value: result };
  return {
    ok: false,
    error: createEquationParseError(
      'INVALID_STRUCTURE',
      `Unable to parse OMML: root element is <${root.fullTag || root.tag}>`,
      root.tag,
    ),
  };
}

/**
 * Parse all child elements of an XML node into MathNode array.
 */
function parseChildren(parent: XmlNode, depth: number): MathNode[] {
  if (depth > MAX_DEPTH) return [];
  const result: MathNode[] = [];
  for (const child of parent.children) {
    if (child.isText) continue;
    const node = parseNode(child, depth + 1);
    if (node) result.push(node);
  }
  return result;
}

/**
 * Parse a single XML element into a MathNode.
 */
function parseNode(xml: XmlNode, depth: number): MathNode | null {
  if (depth > MAX_DEPTH) return null;

  switch (xml.tag) {
    case 'oMath':
      return parseOMathNode(xml, depth);
    case 'acc':
      return parseAccent(xml, depth);
    case 'bar':
      return parseBar(xml, depth);
    case 'box':
      return parseBox(xml, depth);
    case 'borderBox':
      return parseBorderBox(xml, depth);
    case 'd':
      return parseDelimiter(xml, depth);
    case 'eqArr':
      return parseEqArray(xml, depth);
    case 'f':
      return parseFraction(xml, depth);
    case 'func':
      return parseFunction(xml, depth);
    case 'groupChr':
      return parseGroupChar(xml, depth);
    case 'limLow':
      return parseLimLow(xml, depth);
    case 'limUpp':
      return parseLimUpp(xml, depth);
    case 'm':
      return parseMatrix(xml, depth);
    case 'nary':
      return parseNary(xml, depth);
    case 'phant':
      return parsePhantom(xml, depth);
    case 'rad':
      return parseRadical(xml, depth);
    case 'sPre':
      return parsePreScript(xml, depth);
    case 'sSub':
      return parseSubscript(xml, depth);
    case 'sSubSup':
      return parseSubSup(xml, depth);
    case 'sSup':
      return parseSuperscript(xml, depth);
    case 'r':
      return parseRun(xml);
    default:
      return null;
  }
}

function parseOMathNode(xml: XmlNode, depth: number): OMath {
  return {
    type: 'oMath',
    children: parseChildren(xml, depth),
  };
}

function parseAccent(xml: XmlNode, depth: number): AccentNode {
  const pr = findChild(xml, 'accPr');
  const chrNode = pr ? findChild(pr, 'chr') : undefined;
  const chr = chrNode ? getAttr(chrNode, 'val') : undefined;
  const e = findChild(xml, 'e');
  return {
    type: 'acc',
    chr,
    e: e ? parseChildren(e, depth) : [],
  };
}

function parseBar(xml: XmlNode, depth: number): BarNode {
  const pr = findChild(xml, 'barPr');
  const posNode = pr ? findChild(pr, 'pos') : undefined;
  const pos = posNode ? getAttr(posNode, 'val') : 'bot';
  const e = findChild(xml, 'e');
  return {
    type: 'bar',
    pos: (pos as 'top' | 'bot') || 'bot',
    e: e ? parseChildren(e, depth) : [],
  };
}

function parseBox(xml: XmlNode, depth: number): BoxNode {
  const pr = findChild(xml, 'boxPr');
  const e = findChild(xml, 'e');
  return {
    type: 'box',
    opEmu: parseBoolProp(pr, 'opEmu'),
    noBreak: parseBoolProp(pr, 'noBreak'),
    diff: parseBoolProp(pr, 'diff'),
    aln: parseBoolProp(pr, 'aln'),
    e: e ? parseChildren(e, depth) : [],
  };
}

function parseBorderBox(xml: XmlNode, depth: number): BorderBoxNode {
  const pr = findChild(xml, 'borderBoxPr');
  const e = findChild(xml, 'e');
  return {
    type: 'borderBox',
    hideTop: parseBoolProp(pr, 'hideTop'),
    hideBot: parseBoolProp(pr, 'hideBot'),
    hideLeft: parseBoolProp(pr, 'hideLeft'),
    hideRight: parseBoolProp(pr, 'hideRight'),
    strikeH: parseBoolProp(pr, 'strikeH'),
    strikeV: parseBoolProp(pr, 'strikeV'),
    strikeBLTR: parseBoolProp(pr, 'strikeBLTR'),
    strikeTLBR: parseBoolProp(pr, 'strikeTLBR'),
    e: e ? parseChildren(e, depth) : [],
  };
}

function parseDelimiter(xml: XmlNode, depth: number): DelimiterNode {
  const pr = findChild(xml, 'dPr');
  const begChrNode = pr ? findChild(pr, 'begChr') : undefined;
  const sepChrNode = pr ? findChild(pr, 'sepChr') : undefined;
  const endChrNode = pr ? findChild(pr, 'endChr') : undefined;
  const growNode = pr ? findChild(pr, 'grow') : undefined;
  const shpNode = pr ? findChild(pr, 'shp') : undefined;

  const elements = findChildren(xml, 'e');
  const e: MathNode[][] = elements.map((el) => parseChildren(el, depth));
  // If no 'e' children were found, try parsing all non-property children
  if (e.length === 0) {
    const nonPr = xml.children.filter((c) => !c.isText && c.tag !== 'dPr');
    if (nonPr.length > 0) {
      e.push(...nonPr.map((el) => parseChildren(el, depth)));
    }
  }

  return {
    type: 'd',
    begChr: begChrNode ? getAttr(begChrNode, 'val') : '(',
    sepChr: sepChrNode ? getAttr(sepChrNode, 'val') : undefined,
    endChr: endChrNode ? getAttr(endChrNode, 'val') : ')',
    grow: growNode ? getAttr(growNode, 'val') !== '0' : undefined,
    shp: shpNode ? (getAttr(shpNode, 'val') as 'centered' | 'match') : undefined,
    e,
  };
}

function parseEqArray(xml: XmlNode, depth: number): EqArrayNode {
  const pr = findChild(xml, 'eqArrPr');
  const elements = findChildren(xml, 'e');
  return {
    type: 'eqArr',
    baseJc: parseJcProp(pr, 'baseJc'),
    maxDist: parseBoolProp(pr, 'maxDist'),
    objDist: parseBoolProp(pr, 'objDist'),
    rSpRule: parseNumProp(pr, 'rSpRule') as 0 | 1 | 2 | 3 | 4 | undefined,
    rSp: parseNumProp(pr, 'rSp'),
    e: elements.map((el) => parseChildren(el, depth)),
  };
}

function parseFraction(xml: XmlNode, depth: number): FractionNode {
  const pr = findChild(xml, 'fPr');
  const typeNode = pr ? findChild(pr, 'type') : undefined;
  const fractionType = typeNode ? getAttr(typeNode, 'val') : 'bar';
  const num = findChild(xml, 'num');
  const den = findChild(xml, 'den');
  return {
    type: 'f',
    fractionType: (fractionType as 'bar' | 'skw' | 'lin' | 'noBar') || 'bar',
    num: num ? parseChildren(num, depth) : [],
    den: den ? parseChildren(den, depth) : [],
  };
}

function parseFunction(xml: XmlNode, depth: number): FunctionNode {
  const fName = findChild(xml, 'fName');
  const e = findChild(xml, 'e');
  return {
    type: 'func',
    fName: fName ? parseChildren(fName, depth) : [],
    e: e ? parseChildren(e, depth) : [],
  };
}

function parseGroupChar(xml: XmlNode, depth: number): GroupCharNode {
  const pr = findChild(xml, 'groupChrPr');
  const chrNode = pr ? findChild(pr, 'chr') : undefined;
  const posNode = pr ? findChild(pr, 'pos') : undefined;
  const vertJcNode = pr ? findChild(pr, 'vertJc') : undefined;
  const e = findChild(xml, 'e');
  return {
    type: 'groupChr',
    chr: chrNode ? getAttr(chrNode, 'val') : undefined,
    pos: posNode ? (getAttr(posNode, 'val') as 'top' | 'bot') : undefined,
    vertJc: vertJcNode ? (getAttr(vertJcNode, 'val') as 'top' | 'bot') : undefined,
    e: e ? parseChildren(e, depth) : [],
  };
}

function parseLimLow(xml: XmlNode, depth: number): LimLowNode {
  const e = findChild(xml, 'e');
  const lim = findChild(xml, 'lim');
  return {
    type: 'limLow',
    e: e ? parseChildren(e, depth) : [],
    lim: lim ? parseChildren(lim, depth) : [],
  };
}

function parseLimUpp(xml: XmlNode, depth: number): LimUppNode {
  const e = findChild(xml, 'e');
  const lim = findChild(xml, 'lim');
  return {
    type: 'limUpp',
    e: e ? parseChildren(e, depth) : [],
    lim: lim ? parseChildren(lim, depth) : [],
  };
}

function parseMatrix(xml: XmlNode, depth: number): MatrixNode {
  const pr = findChild(xml, 'mPr');
  const rows = findChildren(xml, 'mr');
  const mr: MathNode[][][] = rows.map((row) => {
    const cells = findChildren(row, 'e');
    // Each row is an array of cells, each cell is an array of MathNodes
    return cells.map((cell) => parseChildren(cell, depth));
  });

  // Parse column properties
  const mcsNode = pr ? findChild(pr, 'mcs') : undefined;
  const mcNodes = mcsNode ? findChildren(mcsNode, 'mc') : [];
  const mcs =
    mcNodes.length > 0
      ? mcNodes.map((mc) => {
          const mcPr = findChild(mc, 'mcPr');
          const countNode = mcPr ? findChild(mcPr, 'count') : undefined;
          const mcJcNode = mcPr ? findChild(mcPr, 'mcJc') : undefined;
          return {
            count: countNode ? parseInt(getAttr(countNode, 'val') || '1', 10) : undefined,
            mcJc: mcJcNode ? (getAttr(mcJcNode, 'val') as 'left' | 'center' | 'right') : undefined,
          };
        })
      : undefined;

  return {
    type: 'm',
    baseJc: parseJcProp(pr, 'baseJc'),
    plcHide: parseBoolProp(pr, 'plcHide'),
    rSpRule: parseNumProp(pr, 'rSpRule') as 0 | 1 | 2 | 3 | 4 | undefined,
    cGpRule: parseNumProp(pr, 'cGpRule') as 0 | 1 | 2 | 3 | 4 | undefined,
    rSp: parseNumProp(pr, 'rSp'),
    cSp: parseNumProp(pr, 'cSp'),
    cGp: parseNumProp(pr, 'cGp'),
    mcs,
    mr,
  };
}

function parseNary(xml: XmlNode, depth: number): NaryNode {
  const pr = findChild(xml, 'naryPr');
  const chrNode = pr ? findChild(pr, 'chr') : undefined;
  const limLocNode = pr ? findChild(pr, 'limLoc') : undefined;
  const growNode = pr ? findChild(pr, 'grow') : undefined;
  const subHideNode = pr ? findChild(pr, 'subHide') : undefined;
  const supHideNode = pr ? findChild(pr, 'supHide') : undefined;

  const sub = findChild(xml, 'sub');
  const sup = findChild(xml, 'sup');
  const e = findChild(xml, 'e');

  return {
    type: 'nary',
    chr: chrNode ? getAttr(chrNode, 'val') : undefined,
    limLoc: limLocNode ? (getAttr(limLocNode, 'val') as 'undOvr' | 'subSup') : undefined,
    grow: growNode ? getAttr(growNode, 'val') !== '0' : undefined,
    subHide: subHideNode ? getAttr(subHideNode, 'val') === '1' : undefined,
    supHide: supHideNode ? getAttr(supHideNode, 'val') === '1' : undefined,
    sub: sub ? parseChildren(sub, depth) : [],
    sup: sup ? parseChildren(sup, depth) : [],
    e: e ? parseChildren(e, depth) : [],
  };
}

function parsePhantom(xml: XmlNode, depth: number): PhantomNode {
  const pr = findChild(xml, 'phantPr');
  const e = findChild(xml, 'e');
  return {
    type: 'phant',
    show: parseBoolProp(pr, 'show'),
    zeroWid: parseBoolProp(pr, 'zeroWid'),
    zeroAsc: parseBoolProp(pr, 'zeroAsc'),
    zeroDesc: parseBoolProp(pr, 'zeroDesc'),
    transp: parseBoolProp(pr, 'transp'),
    e: e ? parseChildren(e, depth) : [],
  };
}

function parseRadical(xml: XmlNode, depth: number): RadicalNode {
  const pr = findChild(xml, 'radPr');
  const degHideNode = pr ? findChild(pr, 'degHide') : undefined;
  const deg = findChild(xml, 'deg');
  const e = findChild(xml, 'e');
  return {
    type: 'rad',
    degHide: degHideNode ? getAttr(degHideNode, 'val') === '1' : undefined,
    deg: deg ? parseChildren(deg, depth) : [],
    e: e ? parseChildren(e, depth) : [],
  };
}

function parsePreScript(xml: XmlNode, depth: number): PreScriptNode {
  const sub = findChild(xml, 'sub');
  const sup = findChild(xml, 'sup');
  const e = findChild(xml, 'e');
  return {
    type: 'sPre',
    sub: sub ? parseChildren(sub, depth) : [],
    sup: sup ? parseChildren(sup, depth) : [],
    e: e ? parseChildren(e, depth) : [],
  };
}

function parseSubscript(xml: XmlNode, depth: number): SubscriptNode {
  const e = findChild(xml, 'e');
  const sub = findChild(xml, 'sub');
  return {
    type: 'sSub',
    e: e ? parseChildren(e, depth) : [],
    sub: sub ? parseChildren(sub, depth) : [],
  };
}

function parseSubSup(xml: XmlNode, depth: number): SubSupNode {
  const pr = findChild(xml, 'sSubSupPr');
  const alnScrNode = pr ? findChild(pr, 'alnScr') : undefined;
  const e = findChild(xml, 'e');
  const sub = findChild(xml, 'sub');
  const sup = findChild(xml, 'sup');
  return {
    type: 'sSubSup',
    alnScr: alnScrNode ? getAttr(alnScrNode, 'val') === '1' : undefined,
    e: e ? parseChildren(e, depth) : [],
    sub: sub ? parseChildren(sub, depth) : [],
    sup: sup ? parseChildren(sup, depth) : [],
  };
}

function parseSuperscript(xml: XmlNode, depth: number): SuperscriptNode {
  const e = findChild(xml, 'e');
  const sup = findChild(xml, 'sup');
  return {
    type: 'sSup',
    e: e ? parseChildren(e, depth) : [],
    sup: sup ? parseChildren(sup, depth) : [],
  };
}

function parseRun(xml: XmlNode): MathRun {
  const rPr = findChild(xml, 'rPr');
  const text = getRunText(xml);
  return {
    type: 'r',
    text,
    rPr: rPr ? parseRunProperties(rPr) : undefined,
  };
}

function getRunText(xml: XmlNode): string {
  // Text is in <m:t> children
  const tNodes = findChildren(xml, 't');
  if (tNodes.length > 0) {
    return tNodes.map((t) => getTextContent(t)).join('');
  }
  // Fallback: direct text content
  return getTextContent(xml);
}

function parseRunProperties(pr: XmlNode): MathRunProperties {
  const litNode = findChild(pr, 'lit');
  const norNode = findChild(pr, 'nor');
  const scrNode = findChild(pr, 'scr');
  const styNode = findChild(pr, 'sty');
  const brkNode = findChild(pr, 'brk');
  const alnNode = findChild(pr, 'aln');

  const result: MathRunProperties = {};
  if (litNode) result.lit = getAttr(litNode, 'val') !== '0';
  if (norNode) result.nor = getAttr(norNode, 'val') !== '0';
  if (scrNode) {
    const val = getAttr(scrNode, 'val');
    if (val) result.scr = val as MathRunProperties['scr'];
  }
  if (styNode) {
    const val = getAttr(styNode, 'val');
    if (val) result.sty = val as MathRunProperties['sty'];
  }
  if (brkNode) {
    const alnAt = getAttr(brkNode, 'alnAt');
    result.brk = { alnAt: alnAt ? parseInt(alnAt, 10) : undefined };
  }
  if (alnNode) result.aln = true;

  return result;
}

// ── Helper functions ──────────────────────────────────────────────────────────

function parseBoolProp(prNode: XmlNode | undefined, propName: string): boolean | undefined {
  if (!prNode) return undefined;
  const node = findChild(prNode, propName);
  if (!node) return undefined;
  const val = getAttr(node, 'val');
  // Per OMML spec, presence of the element (with any value including empty string
  // or no value attribute) defaults to true
  if (val === undefined || val === '') return true;
  return val === '1' || val === 'true' || val === 'on';
}

function parseNumProp(prNode: XmlNode | undefined, propName: string): number | undefined {
  if (!prNode) return undefined;
  const node = findChild(prNode, propName);
  if (!node) return undefined;
  const val = getAttr(node, 'val');
  if (val === undefined) return undefined;
  const num = parseInt(val, 10);
  return isNaN(num) ? undefined : num;
}

function parseJcProp(
  prNode: XmlNode | undefined,
  propName: string,
): 'top' | 'center' | 'bottom' | undefined {
  if (!prNode) return undefined;
  const node = findChild(prNode, propName);
  if (!node) return undefined;
  const val = getAttr(node, 'val');
  if (val === 'top' || val === 'center' || val === 'bottom') return val;
  return undefined;
}
