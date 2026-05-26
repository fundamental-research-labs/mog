/**
 * LaTeX -> OMML Converter
 *
 * Converts a LaTeX string to OMML XML via the intermediate MathAST.
 * Pipeline: LaTeX -> MathAST (via latex-parser) -> OMML XML (via astToOmml)
 */

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
  MatrixNode,
  NaryNode,
  PhantomNode,
  PreScriptNode,
  RadicalNode,
  SubscriptNode,
  SubSupNode,
  SuperscriptNode,
} from '@mog-sdk/contracts/equation/omml-ast';
import { parseLatex } from '../parser/latex-parser';

/**
 * Convert a LaTeX string directly to OMML XML.
 * Returns the OMML XML string wrapped in <m:oMath>.
 */
export function latexToOmml(latex: string): string {
  const result = parseLatex(latex);
  if (!result.ok) {
    return `<m:oMath><m:r><m:t>${escapeXml(latex)}</m:t></m:r></m:oMath>`;
  }
  return `<m:oMath>${nodesToOmml(result.value)}</m:oMath>`;
}

/**
 * Convert a MathNode AST to OMML XML string.
 * Does NOT wrap in <m:oMath> - caller can decide wrapping.
 */
export function astToOmml(nodes: MathNode[]): string {
  return nodesToOmml(nodes);
}

function nodesToOmml(nodes: MathNode[]): string {
  return nodes.map(nodeToOmml).join('');
}

function nodeToOmml(node: MathNode): string {
  switch (node.type) {
    case 'oMath':
      return `<m:oMath>${nodesToOmml(node.children)}</m:oMath>`;
    case 'oMathPara': {
      const jc = node.justification
        ? `<m:oMathParaPr><m:jc m:val="${node.justification}"/></m:oMathParaPr>`
        : '';
      return `<m:oMathPara>${jc}${node.equations.map((eq) => `<m:oMath>${nodesToOmml(eq.children)}</m:oMath>`).join('')}</m:oMathPara>`;
    }
    case 'acc':
      return convertAccent(node);
    case 'bar':
      return convertBar(node);
    case 'box':
      return convertBox(node);
    case 'borderBox':
      return convertBorderBox(node);
    case 'd':
      return convertDelimiter(node);
    case 'eqArr':
      return convertEqArray(node);
    case 'f':
      return convertFraction(node);
    case 'func':
      return convertFunction(node);
    case 'groupChr':
      return convertGroupChar(node);
    case 'limLow':
      return convertLimLow(node);
    case 'limUpp':
      return convertLimUpp(node);
    case 'm':
      return convertMatrix(node);
    case 'nary':
      return convertNary(node);
    case 'phant':
      return convertPhantom(node);
    case 'rad':
      return convertRadical(node);
    case 'sPre':
      return convertPreScript(node);
    case 'sSub':
      return convertSubscript(node);
    case 'sSubSup':
      return convertSubSup(node);
    case 'sSup':
      return convertSuperscript(node);
    case 'r':
      return convertRun(node);
    default:
      return '';
  }
}

function convertAccent(node: AccentNode): string {
  const pr = node.chr ? `<m:accPr><m:chr m:val="${escapeXml(node.chr)}"/></m:accPr>` : '';
  return `<m:acc>${pr}<m:e>${nodesToOmml(node.e)}</m:e></m:acc>`;
}

function convertBar(node: BarNode): string {
  const pr = `<m:barPr><m:pos m:val="${node.pos}"/></m:barPr>`;
  return `<m:bar>${pr}<m:e>${nodesToOmml(node.e)}</m:e></m:bar>`;
}

function convertBox(node: BoxNode): string {
  const prParts: string[] = [];
  if (node.opEmu) prParts.push('<m:opEmu m:val="1"/>');
  if (node.noBreak) prParts.push('<m:noBreak m:val="1"/>');
  if (node.diff) prParts.push('<m:diff m:val="1"/>');
  if (node.aln) prParts.push('<m:aln m:val="1"/>');
  const pr = prParts.length > 0 ? `<m:boxPr>${prParts.join('')}</m:boxPr>` : '';
  return `<m:box>${pr}<m:e>${nodesToOmml(node.e)}</m:e></m:box>`;
}

function convertBorderBox(node: BorderBoxNode): string {
  const prParts: string[] = [];
  if (node.hideTop) prParts.push('<m:hideTop m:val="1"/>');
  if (node.hideBot) prParts.push('<m:hideBot m:val="1"/>');
  if (node.hideLeft) prParts.push('<m:hideLeft m:val="1"/>');
  if (node.hideRight) prParts.push('<m:hideRight m:val="1"/>');
  if (node.strikeH) prParts.push('<m:strikeH m:val="1"/>');
  if (node.strikeV) prParts.push('<m:strikeV m:val="1"/>');
  if (node.strikeBLTR) prParts.push('<m:strikeBLTR m:val="1"/>');
  if (node.strikeTLBR) prParts.push('<m:strikeTLBR m:val="1"/>');
  const pr = prParts.length > 0 ? `<m:borderBoxPr>${prParts.join('')}</m:borderBoxPr>` : '';
  return `<m:borderBox>${pr}<m:e>${nodesToOmml(node.e)}</m:e></m:borderBox>`;
}

function convertDelimiter(node: DelimiterNode): string {
  const prParts: string[] = [];
  if (node.begChr !== undefined) prParts.push(`<m:begChr m:val="${escapeXml(node.begChr)}"/>`);
  if (node.sepChr !== undefined) prParts.push(`<m:sepChr m:val="${escapeXml(node.sepChr)}"/>`);
  if (node.endChr !== undefined) prParts.push(`<m:endChr m:val="${escapeXml(node.endChr)}"/>`);
  if (node.grow !== undefined) prParts.push(`<m:grow m:val="${node.grow ? '1' : '0'}"/>`);
  if (node.shp) prParts.push(`<m:shp m:val="${node.shp}"/>`);
  const pr = prParts.length > 0 ? `<m:dPr>${prParts.join('')}</m:dPr>` : '';
  const elements = node.e.map((el) => `<m:e>${nodesToOmml(el)}</m:e>`).join('');
  return `<m:d>${pr}${elements}</m:d>`;
}

function convertEqArray(node: EqArrayNode): string {
  const prParts: string[] = [];
  if (node.baseJc) prParts.push(`<m:baseJc m:val="${node.baseJc}"/>`);
  if (node.maxDist) prParts.push('<m:maxDist m:val="1"/>');
  if (node.objDist) prParts.push('<m:objDist m:val="1"/>');
  if (node.rSpRule !== undefined) prParts.push(`<m:rSpRule m:val="${node.rSpRule}"/>`);
  if (node.rSp !== undefined) prParts.push(`<m:rSp m:val="${node.rSp}"/>`);
  const pr = prParts.length > 0 ? `<m:eqArrPr>${prParts.join('')}</m:eqArrPr>` : '';
  const rows = node.e.map((row) => `<m:e>${nodesToOmml(row)}</m:e>`).join('');
  return `<m:eqArr>${pr}${rows}</m:eqArr>`;
}

function convertFraction(node: FractionNode): string {
  const pr =
    node.fractionType !== 'bar' ? `<m:fPr><m:type m:val="${node.fractionType}"/></m:fPr>` : '';
  return `<m:f>${pr}<m:num>${nodesToOmml(node.num)}</m:num><m:den>${nodesToOmml(node.den)}</m:den></m:f>`;
}

function convertFunction(node: FunctionNode): string {
  return `<m:func><m:fName>${nodesToOmml(node.fName)}</m:fName><m:e>${nodesToOmml(node.e)}</m:e></m:func>`;
}

function convertGroupChar(node: GroupCharNode): string {
  const prParts: string[] = [];
  if (node.chr) prParts.push(`<m:chr m:val="${escapeXml(node.chr)}"/>`);
  if (node.pos) prParts.push(`<m:pos m:val="${node.pos}"/>`);
  if (node.vertJc) prParts.push(`<m:vertJc m:val="${node.vertJc}"/>`);
  const pr = prParts.length > 0 ? `<m:groupChrPr>${prParts.join('')}</m:groupChrPr>` : '';
  return `<m:groupChr>${pr}<m:e>${nodesToOmml(node.e)}</m:e></m:groupChr>`;
}

function convertLimLow(node: LimLowNode): string {
  return `<m:limLow><m:e>${nodesToOmml(node.e)}</m:e><m:lim>${nodesToOmml(node.lim)}</m:lim></m:limLow>`;
}

function convertLimUpp(node: LimUppNode): string {
  return `<m:limUpp><m:e>${nodesToOmml(node.e)}</m:e><m:lim>${nodesToOmml(node.lim)}</m:lim></m:limUpp>`;
}

function convertMatrix(node: MatrixNode): string {
  const prParts: string[] = [];
  if (node.baseJc) prParts.push(`<m:baseJc m:val="${node.baseJc}"/>`);
  if (node.plcHide) prParts.push('<m:plcHide m:val="1"/>');
  if (node.mcs && node.mcs.length > 0) {
    const mcsContent = node.mcs
      .map((mc) => {
        const mcPrParts: string[] = [];
        if (mc.count !== undefined) mcPrParts.push(`<m:count m:val="${mc.count}"/>`);
        if (mc.mcJc) mcPrParts.push(`<m:mcJc m:val="${mc.mcJc}"/>`);
        return `<m:mc><m:mcPr>${mcPrParts.join('')}</m:mcPr></m:mc>`;
      })
      .join('');
    prParts.push(`<m:mcs>${mcsContent}</m:mcs>`);
  }
  const pr = prParts.length > 0 ? `<m:mPr>${prParts.join('')}</m:mPr>` : '';

  const rows = node.mr
    .map((row) => {
      // Each row is an array of cells, each cell is a MathNode[]
      const cells = row.map((cell) => `<m:e>${nodesToOmml(cell)}</m:e>`).join('');
      return `<m:mr>${cells}</m:mr>`;
    })
    .join('');

  return `<m:m>${pr}${rows}</m:m>`;
}

function convertNary(node: NaryNode): string {
  const prParts: string[] = [];
  if (node.chr) prParts.push(`<m:chr m:val="${escapeXml(node.chr)}"/>`);
  if (node.limLoc) prParts.push(`<m:limLoc m:val="${node.limLoc}"/>`);
  if (node.grow !== undefined) prParts.push(`<m:grow m:val="${node.grow ? '1' : '0'}"/>`);
  if (node.subHide) prParts.push('<m:subHide m:val="1"/>');
  if (node.supHide) prParts.push('<m:supHide m:val="1"/>');
  const pr = prParts.length > 0 ? `<m:naryPr>${prParts.join('')}</m:naryPr>` : '';

  return `<m:nary>${pr}<m:sub>${nodesToOmml(node.sub)}</m:sub><m:sup>${nodesToOmml(node.sup)}</m:sup><m:e>${nodesToOmml(node.e)}</m:e></m:nary>`;
}

function convertPhantom(node: PhantomNode): string {
  const prParts: string[] = [];
  if (node.show !== undefined) prParts.push(`<m:show m:val="${node.show ? '1' : '0'}"/>`);
  if (node.zeroWid) prParts.push('<m:zeroWid m:val="1"/>');
  if (node.zeroAsc) prParts.push('<m:zeroAsc m:val="1"/>');
  if (node.zeroDesc) prParts.push('<m:zeroDesc m:val="1"/>');
  if (node.transp) prParts.push('<m:transp m:val="1"/>');
  const pr = prParts.length > 0 ? `<m:phantPr>${prParts.join('')}</m:phantPr>` : '';
  return `<m:phant>${pr}<m:e>${nodesToOmml(node.e)}</m:e></m:phant>`;
}

function convertRadical(node: RadicalNode): string {
  const prParts: string[] = [];
  if (node.degHide) prParts.push('<m:degHide m:val="1"/>');
  const pr = prParts.length > 0 ? `<m:radPr>${prParts.join('')}</m:radPr>` : '';
  return `<m:rad>${pr}<m:deg>${nodesToOmml(node.deg)}</m:deg><m:e>${nodesToOmml(node.e)}</m:e></m:rad>`;
}

function convertPreScript(node: PreScriptNode): string {
  return `<m:sPre><m:sub>${nodesToOmml(node.sub)}</m:sub><m:sup>${nodesToOmml(node.sup)}</m:sup><m:e>${nodesToOmml(node.e)}</m:e></m:sPre>`;
}

function convertSubscript(node: SubscriptNode): string {
  return `<m:sSub><m:e>${nodesToOmml(node.e)}</m:e><m:sub>${nodesToOmml(node.sub)}</m:sub></m:sSub>`;
}

function convertSubSup(node: SubSupNode): string {
  const pr = node.alnScr ? '<m:sSubSupPr><m:alnScr m:val="1"/></m:sSubSupPr>' : '';
  return `<m:sSubSup>${pr}<m:e>${nodesToOmml(node.e)}</m:e><m:sub>${nodesToOmml(node.sub)}</m:sub><m:sup>${nodesToOmml(node.sup)}</m:sup></m:sSubSup>`;
}

function convertSuperscript(node: SuperscriptNode): string {
  return `<m:sSup><m:e>${nodesToOmml(node.e)}</m:e><m:sup>${nodesToOmml(node.sup)}</m:sup></m:sSup>`;
}

function convertRun(node: MathRun): string {
  let rPr = '';
  if (node.rPr) {
    const parts: string[] = [];
    if (node.rPr.lit) parts.push('<m:lit/>');
    if (node.rPr.nor) parts.push('<m:nor/>');
    if (node.rPr.scr) parts.push(`<m:scr m:val="${node.rPr.scr}"/>`);
    if (node.rPr.sty) parts.push(`<m:sty m:val="${node.rPr.sty}"/>`);
    if (node.rPr.brk) {
      const alnAt = node.rPr.brk.alnAt !== undefined ? ` m:alnAt="${node.rPr.brk.alnAt}"` : '';
      parts.push(`<m:brk${alnAt}/>`);
    }
    if (node.rPr.aln) parts.push('<m:aln/>');
    if (parts.length > 0) {
      rPr = `<m:rPr>${parts.join('')}</m:rPr>`;
    }
  }
  return `<m:r>${rPr}<m:t>${escapeXml(node.text)}</m:t></m:r>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
