/**
 * MathAST -> LaTeX Converter
 *
 * Converts the MathAST (from OMML parsing) to a LaTeX string.
 * Preserves as much semantic information as possible.
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

/** Unicode -> LaTeX mapping for operators and symbols */
const UNICODE_TO_LATEX: Record<string, string> = {
  '\u00D7': '\\times',
  '\u00F7': '\\div',
  '\u22C5': '\\cdot',
  '\u00B1': '\\pm',
  '\u2213': '\\mp',
  '\u2264': '\\leq',
  '\u2265': '\\geq',
  '\u2260': '\\neq',
  '\u2248': '\\approx',
  '\u2261': '\\equiv',
  '\u223C': '\\sim',
  '\u221D': '\\propto',
  '\u221E': '\\infty',
  '\u2202': '\\partial',
  '\u2207': '\\nabla',
  '\u2200': '\\forall',
  '\u2203': '\\exists',
  '\u2204': '\\nexists',
  '\u2208': '\\in',
  '\u2209': '\\notin',
  '\u2282': '\\subset',
  '\u2283': '\\supset',
  '\u2286': '\\subseteq',
  '\u2287': '\\supseteq',
  '\u222A': '\\cup',
  '\u2229': '\\cap',
  '\u2205': '\\emptyset',
  '\u2227': '\\land',
  '\u2228': '\\lor',
  '\u00AC': '\\neg',
  '\u21D2': '\\Rightarrow',
  '\u21D0': '\\Leftarrow',
  '\u2192': '\\rightarrow',
  '\u2190': '\\leftarrow',
  '\u2194': '\\leftrightarrow',
  '\u21A6': '\\mapsto',
  '\u2026': '\\ldots',
  '\u22EF': '\\cdots',
  '\u22EE': '\\vdots',
  '\u22F1': '\\ddots',
  // Greek letters
  '\u03B1': '\\alpha',
  '\u03B2': '\\beta',
  '\u03B3': '\\gamma',
  '\u03B4': '\\delta',
  '\u03B5': '\\epsilon',
  '\u03B6': '\\zeta',
  '\u03B7': '\\eta',
  '\u03B8': '\\theta',
  '\u03D1': '\\vartheta',
  '\u03B9': '\\iota',
  '\u03BA': '\\kappa',
  '\u03BB': '\\lambda',
  '\u03BC': '\\mu',
  '\u03BD': '\\nu',
  '\u03BE': '\\xi',
  '\u03C0': '\\pi',
  '\u03C1': '\\rho',
  '\u03C3': '\\sigma',
  '\u03C2': '\\varsigma',
  '\u03C4': '\\tau',
  '\u03C5': '\\upsilon',
  '\u03C6': '\\phi',
  '\u03D5': '\\varphi',
  '\u03C7': '\\chi',
  '\u03C8': '\\psi',
  '\u03C9': '\\omega',
  '\u0393': '\\Gamma',
  '\u0394': '\\Delta',
  '\u0398': '\\Theta',
  '\u039B': '\\Lambda',
  '\u039E': '\\Xi',
  '\u03A0': '\\Pi',
  '\u03A3': '\\Sigma',
  '\u03A5': '\\Upsilon',
  '\u03A6': '\\Phi',
  '\u03A8': '\\Psi',
  '\u03A9': '\\Omega',
};

/** N-ary operator Unicode -> LaTeX mapping */
const NARY_TO_LATEX: Record<string, string> = {
  '\u2211': '\\sum',
  '\u220F': '\\prod',
  '\u2210': '\\coprod',
  '\u222B': '\\int',
  '\u222C': '\\iint',
  '\u222D': '\\iiint',
  '\u222E': '\\oint',
  '\u22C3': '\\bigcup',
  '\u22C2': '\\bigcap',
  '\u2A01': '\\bigoplus',
  '\u2A02': '\\bigotimes',
  '\u22C1': '\\bigvee',
  '\u22C0': '\\bigwedge',
};

/** Accent Unicode -> LaTeX command mapping */
const ACCENT_TO_LATEX: Record<string, string> = {
  '\u0302': '\\hat',
  '\u0303': '\\tilde',
  '\u0304': '\\bar',
  '\u20D7': '\\vec',
  '\u0307': '\\dot',
  '\u0308': '\\ddot',
  '\u0301': '\\acute',
  '\u0300': '\\grave',
  '\u0306': '\\breve',
  '\u030C': '\\check',
};

/**
 * Convert a MathNode (or array) to a LaTeX string.
 */
export function astToLatex(node: MathNode | MathNode[]): string {
  if (Array.isArray(node)) {
    return nodesToLatex(node);
  }
  return nodeToLatex(node);
}

function nodesToLatex(nodes: MathNode[]): string {
  return nodes.map(nodeToLatex).join('');
}

function nodeToLatex(node: MathNode): string {
  switch (node.type) {
    case 'oMath':
      return nodesToLatex(node.children);
    case 'oMathPara':
      return node.equations.map((eq) => nodesToLatex(eq.children)).join(' \\\\ ');
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
  const chr = node.chr || '\u0302';
  const cmd = ACCENT_TO_LATEX[chr] || '\\hat';
  const base = nodesToLatex(node.e);
  return `${cmd}{${base}}`;
}

function convertBar(node: BarNode): string {
  const base = nodesToLatex(node.e);
  if (node.pos === 'top') {
    return `\\overline{${base}}`;
  }
  return `\\underline{${base}}`;
}

function convertBox(node: BoxNode): string {
  return nodesToLatex(node.e);
}

function convertBorderBox(node: BorderBoxNode): string {
  const base = nodesToLatex(node.e);
  return `\\boxed{${base}}`;
}

function convertDelimiter(node: DelimiterNode): string {
  const begChr = node.begChr ?? '(';
  const endChr = node.endChr ?? ')';
  const content = node.e.map(nodesToLatex).join(node.sepChr || '|');

  const leftCmd = delimToLatex(begChr, 'left');
  const rightCmd = delimToLatex(endChr, 'right');

  return `\\left${leftCmd}${content}\\right${rightCmd}`;
}

function delimToLatex(ch: string, _side: 'left' | 'right'): string {
  if (!ch) return '.';
  if (ch === '(' || ch === ')' || ch === '[' || ch === ']' || ch === '|') return ch;
  if (ch === '{') return '\\{';
  if (ch === '}') return '\\}';
  if (ch === '\u27E8') return '\\langle';
  if (ch === '\u27E9') return '\\rangle';
  if (ch === '\u2016') return '\\|';
  if (ch === '\u230A') return '\\lfloor';
  if (ch === '\u230B') return '\\rfloor';
  if (ch === '\u2308') return '\\lceil';
  if (ch === '\u2309') return '\\rceil';
  return ch;
}

function convertEqArray(node: EqArrayNode): string {
  const rows = node.e.map(nodesToLatex).join(' \\\\ ');
  return `\\begin{aligned}${rows}\\end{aligned}`;
}

function convertFraction(node: FractionNode): string {
  const num = nodesToLatex(node.num);
  const den = nodesToLatex(node.den);

  if (node.fractionType === 'lin') {
    return `${wrapIfComplex(num)}/${wrapIfComplex(den)}`;
  }
  if (node.fractionType === 'skw') {
    return `{}^{${num}}/_{${den}}`;
  }
  if (node.fractionType === 'noBar') {
    return `\\binom{${num}}{${den}}`;
  }
  return `\\frac{${num}}{${den}}`;
}

function wrapIfComplex(latex: string): string {
  if (latex.length <= 1) return latex;
  return `{${latex}}`;
}

/** Known LaTeX function names -- allocated once at module level */
const KNOWN_FUNCTIONS = new Set([
  'sin',
  'cos',
  'tan',
  'sec',
  'csc',
  'cot',
  'arcsin',
  'arccos',
  'arctan',
  'sinh',
  'cosh',
  'tanh',
  'log',
  'ln',
  'exp',
  'lim',
  'liminf',
  'limsup',
  'det',
  'dim',
  'ker',
  'arg',
  'deg',
  'gcd',
  'hom',
  'mod',
  'min',
  'max',
  'sup',
  'inf',
]);

function convertFunction(node: FunctionNode): string {
  const name = nodesToLatex(node.fName);
  const arg = nodesToLatex(node.e);
  // If name is a known function, use backslash
  if (KNOWN_FUNCTIONS.has(name)) {
    // Known LaTeX operators use a space separator, not braces: \sin x, not \sin{x}
    // For multi-token arguments, wrap in parentheses for clarity
    if (!arg) return `\\${name}`;
    const needsParens =
      arg.length > 1 && !arg.startsWith('\\left') && !arg.startsWith('{') && !arg.startsWith('\\');
    return needsParens ? `\\${name}\\left(${arg}\\right)` : `\\${name} ${arg}`;
  }
  return arg ? `\\operatorname{${name}} ${arg}` : `\\operatorname{${name}}`;
}

function convertGroupChar(node: GroupCharNode): string {
  const base = nodesToLatex(node.e);
  const chr = node.chr || '\u23DF'; // underbrace by default
  if (chr === '\u23DE' || node.pos === 'top') {
    return `\\overbrace{${base}}`;
  }
  return `\\underbrace{${base}}`;
}

function convertLimLow(node: LimLowNode): string {
  const base = nodesToLatex(node.e);
  const lim = nodesToLatex(node.lim);
  return `${base}_{${lim}}`;
}

function convertLimUpp(node: LimUppNode): string {
  const base = nodesToLatex(node.e);
  const lim = nodesToLatex(node.lim);
  return `${base}^{${lim}}`;
}

function convertMatrix(node: MatrixNode): string {
  const rows = node.mr
    .map((row) => {
      // Each row is MathNode[][] - an array of cells, each cell is MathNode[]
      return row.map((cell) => nodesToLatex(cell)).join(' & ');
    })
    .join(' \\\\ ');
  return `\\begin{matrix}${rows}\\end{matrix}`;
}

function convertNary(node: NaryNode): string {
  const chr = node.chr || '\u2211'; // default to sum
  const cmd = NARY_TO_LATEX[chr] || '\\sum';
  const sub = nodesToLatex(node.sub);
  const sup = nodesToLatex(node.sup);
  const body = nodesToLatex(node.e);

  let result = cmd;
  if (sub && !node.subHide) {
    result += `_{${sub}}`;
  }
  if (sup && !node.supHide) {
    result += `^{${sup}}`;
  }
  if (body) {
    result += ` ${body}`;
  }
  return result;
}

function convertPhantom(node: PhantomNode): string {
  const content = nodesToLatex(node.e);
  if (node.show === false) {
    return `\\phantom{${content}}`;
  }
  return content;
}

function convertRadical(node: RadicalNode): string {
  const base = nodesToLatex(node.e);
  if (node.degHide || node.deg.length === 0) {
    return `\\sqrt{${base}}`;
  }
  const deg = nodesToLatex(node.deg);
  return `\\sqrt[${deg}]{${base}}`;
}

function convertPreScript(node: PreScriptNode): string {
  const base = nodesToLatex(node.e);
  const sub = nodesToLatex(node.sub);
  const sup = nodesToLatex(node.sup);
  return `{}_{${sub}}^{${sup}}${base}`;
}

function convertSubscript(node: SubscriptNode): string {
  const base = nodesToLatex(node.e);
  const sub = nodesToLatex(node.sub);
  if (base.length > 1 && !base.startsWith('\\')) {
    return `{${base}}_{${sub}}`;
  }
  return `${base}_{${sub}}`;
}

function convertSubSup(node: SubSupNode): string {
  const base = nodesToLatex(node.e);
  const sub = nodesToLatex(node.sub);
  const sup = nodesToLatex(node.sup);
  if (base.length > 1 && !base.startsWith('\\')) {
    return `{${base}}_{${sub}}^{${sup}}`;
  }
  return `${base}_{${sub}}^{${sup}}`;
}

function convertSuperscript(node: SuperscriptNode): string {
  const base = nodesToLatex(node.e);
  const sup = nodesToLatex(node.sup);
  if (base.length > 1 && !base.startsWith('\\')) {
    return `{${base}}^{${sup}}`;
  }
  return `${base}^{${sup}}`;
}

function convertRun(node: MathRun): string {
  let text = node.text;

  // Convert Unicode characters to LaTeX commands
  const chars = Array.from(text);
  const mapped = chars.map((ch) => {
    if (UNICODE_TO_LATEX[ch]) return UNICODE_TO_LATEX[ch];
    return ch;
  });
  const converted = mapped
    .map((token, i) => {
      // If this token is a LaTeX command and the next token starts with a letter,
      // append a space to prevent LaTeX from merging the command with the following text.
      if (/^\\[a-zA-Z]+$/.test(token) && i + 1 < mapped.length && /^[a-zA-Z]/.test(mapped[i + 1])) {
        return token + ' ';
      }
      return token;
    })
    .join('');

  text = converted;

  // Handle bold/italic styling
  // Check nor (normal text) first: if nor is true, use text-mode commands
  // to avoid invalid nesting like \text{\mathbf{x}}
  if (node.rPr) {
    if (node.rPr.nor) {
      if (node.rPr.sty === 'bi') {
        text = `\\textbf{\\textit{${text}}}`;
      } else if (node.rPr.sty === 'b') {
        text = `\\textbf{${text}}`;
      } else if (node.rPr.sty === 'i') {
        text = `\\textit{${text}}`;
      } else {
        text = `\\text{${text}}`;
      }
    } else {
      if (node.rPr.sty === 'b') {
        text = `\\mathbf{${text}}`;
      } else if (node.rPr.sty === 'bi') {
        text = `\\boldsymbol{${text}}`;
      }
    }
  }

  return text;
}
