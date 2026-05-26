/**
 * LaTeX Parser
 *
 * Parses LaTeX math syntax into the MathAST defined in
 * @mog-sdk/contracts/equation/omml-ast.
 *
 * Supports common LaTeX math constructs:
 * - Fractions: \frac{a}{b}
 * - Radicals: \sqrt{x}, \sqrt[n]{x}
 * - Scripts: x^{2}, x_{n}, x_{i}^{n}
 * - Matrices: \begin{pmatrix}...\end{pmatrix}
 * - Delimiters: \left(...\right)
 * - Accents: \hat{x}, \tilde{x}, etc.
 * - N-ary: \sum, \prod, \int with limits
 * - Functions: \sin, \cos, \log, \lim
 * - Greek letters, operators, spacing
 */

import type { EquationParseError } from '@mog-sdk/contracts/equation/errors';
import { createEquationParseError } from '../errors';
import type {
  AccentNode,
  BarNode,
  DelimiterNode,
  EqArrayNode,
  FractionNode,
  FunctionNode,
  LimLowNode,
  LimUppNode,
  MathNode,
  MathRun,
  MatrixNode,
  NaryNode,
  RadicalNode,
  SubscriptNode,
  SubSupNode,
  SuperscriptNode,
} from '@mog-sdk/contracts/equation/omml-ast';
import type { Result } from '@mog-sdk/contracts/equation/types';

/** Greek letter mapping: LaTeX command -> Unicode character */
const GREEK_LETTERS: Record<string, string> = {
  alpha: '\u03B1',
  beta: '\u03B2',
  gamma: '\u03B3',
  delta: '\u03B4',
  epsilon: '\u03B5',
  varepsilon: '\u03B5',
  zeta: '\u03B6',
  eta: '\u03B7',
  theta: '\u03B8',
  vartheta: '\u03D1',
  iota: '\u03B9',
  kappa: '\u03BA',
  lambda: '\u03BB',
  mu: '\u03BC',
  nu: '\u03BD',
  xi: '\u03BE',
  pi: '\u03C0',
  rho: '\u03C1',
  sigma: '\u03C3',
  varsigma: '\u03C2',
  tau: '\u03C4',
  upsilon: '\u03C5',
  phi: '\u03C6',
  varphi: '\u03D5',
  chi: '\u03C7',
  psi: '\u03C8',
  omega: '\u03C9',
  Gamma: '\u0393',
  Delta: '\u0394',
  Theta: '\u0398',
  Lambda: '\u039B',
  Xi: '\u039E',
  Pi: '\u03A0',
  Sigma: '\u03A3',
  Upsilon: '\u03A5',
  Phi: '\u03A6',
  Psi: '\u03A8',
  Omega: '\u03A9',
};

/** Operator mapping: LaTeX command -> Unicode character */
const OPERATORS: Record<string, string> = {
  times: '\u00D7',
  div: '\u00F7',
  cdot: '\u22C5',
  pm: '\u00B1',
  mp: '\u2213',
  leq: '\u2264',
  geq: '\u2265',
  neq: '\u2260',
  approx: '\u2248',
  equiv: '\u2261',
  sim: '\u223C',
  propto: '\u221D',
  infty: '\u221E',
  partial: '\u2202',
  nabla: '\u2207',
  forall: '\u2200',
  exists: '\u2203',
  nexists: '\u2204',
  in: '\u2208',
  notin: '\u2209',
  subset: '\u2282',
  supset: '\u2283',
  subseteq: '\u2286',
  supseteq: '\u2287',
  cup: '\u222A',
  cap: '\u2229',
  emptyset: '\u2205',
  land: '\u2227',
  lor: '\u2228',
  neg: '\u00AC',
  Rightarrow: '\u21D2',
  Leftarrow: '\u21D0',
  rightarrow: '\u2192',
  leftarrow: '\u2190',
  leftrightarrow: '\u2194',
  to: '\u2192',
  mapsto: '\u21A6',
  ldots: '\u2026',
  cdots: '\u22EF',
  vdots: '\u22EE',
  ddots: '\u22F1',

  // Aliases for relations
  le: '\u2264',
  ge: '\u2265',
  ne: '\u2260',

  // Additional relations
  ll: '\u226A',
  gg: '\u226B',
  prec: '\u227A',
  succ: '\u227B',
  preceq: '\u2AAF',
  succeq: '\u2AB0',
  cong: '\u2245',
  simeq: '\u2243',

  // Additional arrows
  uparrow: '\u2191',
  downarrow: '\u2193',
  updownarrow: '\u2195',
  Uparrow: '\u21D1',
  Downarrow: '\u21D3',
  Updownarrow: '\u21D5',
  hookrightarrow: '\u21AA',
  hookleftarrow: '\u21A9',

  // Additional set/logic
  setminus: '\u2216',
  therefore: '\u2234',
  because: '\u2235',
  implies: '\u21D2',
  iff: '\u21D4',

  // Dots alias
  dots: '\u2026',

  // Miscellaneous
  dagger: '\u2020',
  ddagger: '\u2021',
  star: '\u22C6',
  circ: '\u2218',
  bullet: '\u2022',
  diamond: '\u22C4',
  triangle: '\u25B3',
  triangleleft: '\u25C1',
  triangleright: '\u25B7',
  angle: '\u2220',
  perp: '\u22A5',
  parallel: '\u2225',

  // Spacing
  quad: '\u2003',
  qquad: '\u2003\u2003',
};

/** N-ary operator mapping */
const NARY_OPERATORS: Record<string, string> = {
  sum: '\u2211',
  prod: '\u220F',
  coprod: '\u2210',
  int: '\u222B',
  iint: '\u222C',
  iiint: '\u222D',
  oint: '\u222E',
  bigcup: '\u22C3',
  bigcap: '\u22C2',
  bigoplus: '\u2A01',
  bigotimes: '\u2A02',
  bigvee: '\u22C1',
  bigwedge: '\u22C0',
};

/** Accent mapping: LaTeX command -> Unicode combining character */
const ACCENTS: Record<string, string> = {
  hat: '\u0302',
  tilde: '\u0303',
  bar: '\u0304',
  overline: '\u0304',
  vec: '\u20D7',
  dot: '\u0307',
  ddot: '\u0308',
  acute: '\u0301',
  grave: '\u0300',
  breve: '\u0306',
  check: '\u030C',
};

/** Standard function names */
const FUNCTIONS = new Set([
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
  'min',
  'max',
  'sup',
  'inf',
  'det',
  'dim',
  'ker',
  'arg',
  'deg',
  'gcd',
  'hom',
  'mod',
]);

/** Matrix environment -> delimiter characters */
const MATRIX_DELIMITERS: Record<string, { beg: string; end: string }> = {
  pmatrix: { beg: '(', end: ')' },
  bmatrix: { beg: '[', end: ']' },
  Bmatrix: { beg: '{', end: '}' },
  vmatrix: { beg: '|', end: '|' },
  Vmatrix: { beg: '\u2016', end: '\u2016' },
  matrix: { beg: '', end: '' },
};

/**
 * Parse a LaTeX math string into a MathNode array.
 */
export function parseLatex(latex: string): Result<MathNode[], EquationParseError> {
  if (!latex || !latex.trim()) {
    return {
      ok: false,
      error: createEquationParseError('EMPTY_INPUT', 'Empty LaTeX input'),
    };
  }

  try {
    const parser = new LatexParser(latex.trim());
    const nodes = parser.parseAll();
    return { ok: true, value: nodes };
  } catch (e) {
    return {
      ok: false,
      error: createEquationParseError(
        'SYNTAX_ERROR',
        `LaTeX parsing failed: ${e instanceof Error ? e.message : String(e)}`,
      ),
    };
  }
}

const MAX_LATEX_DEPTH = 100;

class LatexParser {
  private pos = 0;
  private depth = 0;
  private readonly input: string;

  constructor(input: string) {
    this.input = input;
  }

  private checkDepth(): void {
    if (this.depth > MAX_LATEX_DEPTH) {
      throw new Error(
        `Maximum nesting depth (${MAX_LATEX_DEPTH}) exceeded. Input may contain excessively nested structures.`,
      );
    }
  }

  parseAll(): MathNode[] {
    const nodes: MathNode[] = [];
    while (this.pos < this.input.length) {
      try {
        const node = this.parseExpression();
        if (node) {
          nodes.push(...(Array.isArray(node) ? node : [node]));
        }
      } catch {
        // If a single expression fails, skip the character and continue
        if (this.pos < this.input.length) {
          nodes.push(makeTextRun(this.input[this.pos]));
          this.pos++;
        }
      }
    }
    return nodes;
  }

  private parseExpression(): MathNode | MathNode[] | null {
    this.skipSpaces();
    if (this.pos >= this.input.length) return null;

    const ch = this.input[this.pos];

    if (ch === '\\') {
      return this.parseCommand();
    }
    if (ch === '{') {
      return this.parseGroup();
    }
    if (ch === '^') {
      // Standalone superscript (no base) - shouldn't happen at top level
      // but handle gracefully
      return this.parseScript(makeTextRun(''));
    }
    if (ch === '_') {
      return this.parseScript(makeTextRun(''));
    }
    if (ch === '&' || ch === '}') {
      // Matrix cell separator or end of group - caller handles
      return null;
    }

    // Regular character
    this.pos++;
    const textNode = makeTextRun(ch);

    // Check for scripts after character
    if (
      this.pos < this.input.length &&
      (this.input[this.pos] === '^' || this.input[this.pos] === '_')
    ) {
      return this.parseScript(textNode);
    }

    return textNode;
  }

  private parseCommand(): MathNode | MathNode[] | null {
    this.pos++; // skip '\'

    if (this.pos >= this.input.length) return makeTextRun('\\');

    const ch = this.input[this.pos];

    // Special single-character commands
    if (ch === ' ' || ch === ',' || ch === ';' || ch === '!' || ch === ':') {
      this.pos++;
      // Spacing commands - emit as text with appropriate space
      // \! is negative thin space in TeX; approximated as hair space since negative spacing
      // would require a dedicated spacing node type
      return makeTextRun(
        ch === ','
          ? '\u2009'
          : ch === ';'
            ? '\u2005'
            : ch === '!'
              ? '\u200A'
              : ch === ':'
                ? '\u2005'
                : ' ',
      );
    }
    if (ch === '\\') {
      this.pos++;
      return makeTextRun('\n'); // Line break in matrices
    }
    if (ch === '{' || ch === '}' || ch === '&' || ch === '%' || ch === '#' || ch === '_') {
      this.pos++;
      return makeTextRun(ch);
    }

    // Read command name
    const name = this.readCommandName();
    if (!name) return makeTextRun('\\');

    // Handle different commands
    if (name === 'frac' || name === 'dfrac' || name === 'tfrac' || name === 'cfrac') {
      return this.parseFraction(name);
    }
    if (name === 'binom' || name === 'dbinom' || name === 'tbinom') {
      return this.parseBinom();
    }
    if (name === 'sqrt') {
      return this.parseRadical();
    }
    if (name === 'left') {
      return this.parseDelimiter();
    }
    if (name === 'begin') {
      return this.parseEnvironment();
    }
    if (name === 'overline') {
      return this.parseOverUnder('top');
    }
    if (name === 'underline') {
      return this.parseOverUnder('bot');
    }
    if (name in ACCENTS) {
      return this.parseAccent(name);
    }
    if (name in NARY_OPERATORS) {
      return this.parseNary(name);
    }
    if (FUNCTIONS.has(name)) {
      return this.parseFunctionCommand(name);
    }
    if (name in GREEK_LETTERS) {
      const textNode = makeTextRun(GREEK_LETTERS[name]);
      // Check for scripts
      this.skipSpaces();
      if (
        this.pos < this.input.length &&
        (this.input[this.pos] === '^' || this.input[this.pos] === '_')
      ) {
        return this.parseScript(textNode);
      }
      return textNode;
    }
    if (name in OPERATORS) {
      return makeTextRun(OPERATORS[name]);
    }
    if (name === 'text' || name === 'mathrm' || name === 'textrm') {
      return this.parseTextCommand();
    }
    if (name === 'mathbf' || name === 'bf' || name === 'textbf') {
      return this.parseBoldCommand();
    }
    if (name === 'mathit' || name === 'it') {
      return this.parseItalicCommand();
    }
    if (name === 'overset' || name === 'stackrel') {
      return this.parseOverset();
    }
    if (name === 'underset') {
      return this.parseUnderset();
    }
    if (
      name === 'displaystyle' ||
      name === 'textstyle' ||
      name === 'scriptstyle' ||
      name === 'scriptscriptstyle'
    ) {
      // Style commands affect rendering context but don't change AST structure.
      // Continue parsing the rest of the current scope.
      return this.parseExpression();
    }
    if (name === 'color' || name === 'textcolor') {
      return this.parseColorCommand();
    }
    if (name === 'colorbox') {
      return this.parseColorCommand();
    }
    if (name === 'xrightarrow' || name === 'xleftarrow') {
      return this.parseExtensibleArrow(name);
    }
    if (name === 'operatorname') {
      return this.parseOperatorName();
    }

    // Unknown command - emit as text
    return makeTextRun(name);
  }

  private parseFraction(_name: string): FractionNode {
    const num = this.parseRequiredGroup();
    const den = this.parseRequiredGroup();
    // The display/text distinction (dfrac/tfrac vs frac) is intentionally
    // not preserved in the AST -- OMML uses a single 'bar' fraction type
    // for all stacked fractions regardless of display style.
    return {
      type: 'f',
      fractionType: 'bar',
      num,
      den,
    };
  }

  private parseRadical(): RadicalNode {
    this.skipSpaces();
    let deg: MathNode[] = [];
    let degHide = true;

    // Optional degree: \sqrt[n]{x}
    if (this.pos < this.input.length && this.input[this.pos] === '[') {
      this.pos++; // skip '['
      deg = this.parseUntil(']');
      degHide = false;
    }

    const e = this.parseRequiredGroup();
    return {
      type: 'rad',
      degHide: degHide || undefined,
      deg,
      e,
    };
  }

  private parseDelimiter(): DelimiterNode {
    this.skipSpaces();
    const begChr = this.readDelimiterChar();

    // Parse content until \right
    const content: MathNode[] = [];
    while (this.pos < this.input.length) {
      this.skipSpaces();
      if (this.input[this.pos] === '\\') {
        const savedPos = this.pos;
        this.pos++;
        const cmd = this.readCommandName();
        if (cmd === 'right') {
          break;
        }
        // Not \right, back up and parse normally
        this.pos = savedPos;
      }
      const node = this.parseExpression();
      if (node) {
        if (Array.isArray(node)) content.push(...node);
        else content.push(node);
      } else {
        break;
      }
    }

    this.skipSpaces();
    const endChr = this.readDelimiterChar();

    return {
      type: 'd',
      begChr: begChr || '(',
      endChr: endChr || ')',
      e: [content],
    };
  }

  private readDelimiterChar(): string {
    this.skipSpaces();
    if (this.pos >= this.input.length) return '';

    const ch = this.input[this.pos];
    if (ch === '.' || ch === '(' || ch === ')' || ch === '[' || ch === ']' || ch === '|') {
      this.pos++;
      return ch === '.' ? '' : ch;
    }
    if (ch === '\\') {
      this.pos++;
      const cmd = this.readCommandName();
      if (cmd === 'lbrace' || cmd === '{') return '{';
      if (cmd === 'rbrace' || cmd === '}') return '}';
      if (cmd === 'langle') return '\u27E8';
      if (cmd === 'rangle') return '\u27E9';
      if (cmd === '|' || cmd === 'Vert') return '\u2016';
      if (cmd === 'lfloor') return '\u230A';
      if (cmd === 'rfloor') return '\u230B';
      if (cmd === 'lceil') return '\u2308';
      if (cmd === 'rceil') return '\u2309';
      return cmd;
    }
    if (ch === '{') {
      this.pos++;
      return '{';
    }
    if (ch === '}') {
      this.pos++;
      return '}';
    }
    this.pos++;
    return ch;
  }

  private parseEnvironment(): MathNode | MathNode[] | null {
    const envName = this.parseRequiredBraceContent();
    this.depth++;
    this.checkDepth();

    try {
      if (envName in MATRIX_DELIMITERS) {
        return this.parseMatrixEnvironment(envName);
      }
      if (envName === 'cases') {
        return this.parseCasesEnvironment();
      }
      if (envName === 'aligned') {
        return this.parseAlignedEnvironment();
      }

      // Unknown environment - try to skip it
      this.skipUntilEndEnv(envName);
      return null;
    } finally {
      this.depth--;
    }
  }

  private parseMatrixEnvironment(envName: string): MathNode | MathNode[] {
    const rows: MathNode[][][] = [];
    let currentRow: MathNode[][] = [];
    let currentCell: MathNode[] = [];

    while (this.pos < this.input.length) {
      this.skipSpaces();

      // Check for \end{envName}
      if (this.input[this.pos] === '\\') {
        const savedPos = this.pos;
        this.pos++;
        const cmd = this.readCommandName();

        if (cmd === 'end') {
          this.parseRequiredBraceContent(); // consume {envName}
          break;
        }
        if (cmd === '\\' || cmd === '') {
          // Row separator - push current cell and row.
          currentRow.push(currentCell);
          rows.push(currentRow);
          currentRow = [];
          currentCell = [];
          continue;
        }

        // Not \end or \\, go back and parse normally
        this.pos = savedPos;
      }

      // Check for & (column separator)
      if (this.input[this.pos] === '&') {
        this.pos++;
        currentRow.push(currentCell);
        currentCell = [];
        continue;
      }

      const node = this.parseExpression();
      if (node) {
        if (Array.isArray(node)) currentCell.push(...node);
        else currentCell.push(node);
      } else {
        // Could be end of input or unrecognized char
        if (this.pos < this.input.length && this.input[this.pos] !== '\\') {
          this.pos++;
        } else {
          break;
        }
      }
    }

    // Push last cell and row
    if (currentCell.length > 0) {
      currentRow.push(currentCell);
    }
    if (currentRow.length > 0) {
      rows.push(currentRow);
    }

    const matrixNode: MatrixNode = {
      type: 'm',
      mr: rows,
    };

    const delims = MATRIX_DELIMITERS[envName];
    if (delims && (delims.beg || delims.end)) {
      const delimNode: DelimiterNode = {
        type: 'd',
        begChr: delims.beg || undefined,
        endChr: delims.end || undefined,
        e: [[matrixNode]],
      };
      return delimNode;
    }

    return matrixNode;
  }

  private parseCasesEnvironment(): DelimiterNode {
    // Cases is like a matrix with { delimiter
    const rows: MathNode[][] = [];
    let currentRow: MathNode[] = [];
    let currentCell: MathNode[] = [];

    while (this.pos < this.input.length) {
      this.skipSpaces();

      if (this.input[this.pos] === '\\') {
        const savedPos = this.pos;
        this.pos++;
        const cmd = this.readCommandName();

        if (cmd === 'end') {
          this.parseRequiredBraceContent();
          break;
        }
        if (cmd === '\\' || cmd === '') {
          currentRow.push(...currentCell);
          rows.push(currentRow);
          currentRow = [];
          currentCell = [];
          continue;
        }

        this.pos = savedPos;
      }

      if (this.input[this.pos] === '&') {
        this.pos++;
        currentRow.push(...currentCell);
        currentCell = [];
        continue;
      }

      const node = this.parseExpression();
      if (node) {
        if (Array.isArray(node)) currentCell.push(...node);
        else currentCell.push(node);
      } else {
        if (this.pos < this.input.length) this.pos++;
        else break;
      }
    }

    if (currentCell.length > 0) currentRow.push(...currentCell);
    if (currentRow.length > 0) rows.push(currentRow);

    return {
      type: 'd',
      begChr: '{',
      endChr: '',
      e: rows.length > 0 ? rows.map((r) => r) : [[]],
    };
  }

  private parseAlignedEnvironment(): EqArrayNode {
    // Parse \begin{aligned}...\end{aligned} into an eqArr node.
    // Rows are separated by \\ and cells within rows by &.
    // Each row becomes one entry in eqArr.e, with cell content concatenated.
    const rows: MathNode[][] = [];
    let currentRow: MathNode[] = [];
    let currentCell: MathNode[] = [];

    while (this.pos < this.input.length) {
      this.skipSpaces();

      if (this.input[this.pos] === '\\') {
        const savedPos = this.pos;
        this.pos++;
        const cmd = this.readCommandName();

        if (cmd === 'end') {
          this.parseRequiredBraceContent();
          break;
        }
        if (cmd === '\\' || cmd === '') {
          currentRow.push(...currentCell);
          rows.push(currentRow);
          currentRow = [];
          currentCell = [];
          continue;
        }

        this.pos = savedPos;
      }

      if (this.input[this.pos] === '&') {
        this.pos++;
        currentRow.push(...currentCell);
        currentCell = [];
        continue;
      }

      const node = this.parseExpression();
      if (node) {
        if (Array.isArray(node)) currentCell.push(...node);
        else currentCell.push(node);
      } else {
        if (this.pos < this.input.length) this.pos++;
        else break;
      }
    }

    if (currentCell.length > 0) currentRow.push(...currentCell);
    if (currentRow.length > 0) rows.push(currentRow);

    return {
      type: 'eqArr',
      e: rows.length > 0 ? rows : [[]],
    };
  }

  private parseOverUnder(pos: 'top' | 'bot'): BarNode {
    const e = this.parseRequiredGroup();
    return { type: 'bar', pos, e };
  }

  private parseAccent(name: string): AccentNode {
    const e = this.parseRequiredGroup();
    return {
      type: 'acc',
      chr: ACCENTS[name],
      e,
    };
  }

  private parseNary(name: string): NaryNode {
    const chr = NARY_OPERATORS[name];
    this.skipSpaces();

    let sub: MathNode[] = [];
    let sup: MathNode[] = [];

    // Parse optional limits
    if (this.pos < this.input.length && this.input[this.pos] === '_') {
      this.pos++;
      sub = this.parseRequiredGroup();
    }
    this.skipSpaces();
    if (this.pos < this.input.length && this.input[this.pos] === '^') {
      this.pos++;
      sup = this.parseRequiredGroup();
    }
    // Also handle ^..._ order
    this.skipSpaces();
    if (sub.length === 0 && this.pos < this.input.length && this.input[this.pos] === '_') {
      this.pos++;
      sub = this.parseRequiredGroup();
    }

    // Parse remaining expressions in the current scope as the body.
    // Stop at group close '}', column separator '&', or row separator '\\'.
    const e: MathNode[] = [];
    this.skipSpaces();
    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];
      if (ch === '}' || ch === '&') break;
      // Check for \\ (row separator) or \end/\right (environment/delimiter end)
      if (ch === '\\' && this.pos + 1 < this.input.length) {
        const next = this.input[this.pos + 1];
        if (next === '\\') break; // row separator
        // Peek for \end or \right
        const savedPos = this.pos;
        this.pos++;
        const cmd = this.readCommandName();
        this.pos = savedPos; // restore
        if (cmd === 'end' || cmd === 'right') break;
      }
      const body = this.parseExpression();
      if (body) {
        if (Array.isArray(body)) e.push(...body);
        else e.push(body);
      } else {
        break;
      }
    }

    return {
      type: 'nary',
      chr,
      limLoc:
        name === 'int' || name === 'iint' || name === 'iiint' || name === 'oint'
          ? 'subSup'
          : 'undOvr',
      sub,
      sup,
      e,
    };
  }

  private parseFunctionCommand(name: string): MathNode | MathNode[] {
    // For \lim, check for _{...} (lower limit)
    this.skipSpaces();
    if (name === 'lim' && this.pos < this.input.length && this.input[this.pos] === '_') {
      this.pos++;
      const lim = this.parseRequiredGroup();
      const funcNameRun: MathRun = { type: 'r', text: name, rPr: { nor: true } };
      const result: LimLowNode = {
        type: 'limLow',
        e: [funcNameRun],
        lim,
      };
      return result;
    }

    const funcNameRun: MathRun = { type: 'r', text: name, rPr: { nor: true } };

    // Check for scripts after function name
    if (
      this.pos < this.input.length &&
      (this.input[this.pos] === '^' || this.input[this.pos] === '_')
    ) {
      return this.parseScript(funcNameRun);
    }

    // Parse argument if next char is { or a simple char follows
    this.skipSpaces();
    const funcNode: FunctionNode = {
      type: 'func',
      fName: [funcNameRun],
      e: [],
    };

    // Try to parse one argument
    if (this.pos < this.input.length) {
      if (this.input[this.pos] === '{') {
        funcNode.e = this.parseRequiredGroup();
      } else if (
        this.input[this.pos] !== '\\' &&
        this.input[this.pos] !== '}' &&
        this.input[this.pos] !== '^' &&
        this.input[this.pos] !== '_'
      ) {
        const arg = this.parseExpression();
        if (arg) {
          if (Array.isArray(arg)) funcNode.e = arg;
          else funcNode.e = [arg];
        }
      }
    }

    return funcNode;
  }

  private parseTextCommand(): MathRun {
    const text = this.parseRequiredBraceContent();
    return { type: 'r', text, rPr: { nor: true } };
  }

  private parseBoldCommand(): MathRun {
    const content = this.parseRequiredBraceContent();
    return { type: 'r', text: content, rPr: { sty: 'b' } };
  }

  private parseItalicCommand(): MathRun {
    const content = this.parseRequiredBraceContent();
    return { type: 'r', text: content, rPr: { sty: 'i' } };
  }

  private parseBinom(): DelimiterNode {
    const num = this.parseRequiredGroup();
    const den = this.parseRequiredGroup();
    const fracNode: FractionNode = {
      type: 'f',
      fractionType: 'noBar',
      num,
      den,
    };
    return {
      type: 'd',
      begChr: '(',
      endChr: ')',
      e: [[fracNode]],
    };
  }

  private parseOverset(): LimUppNode {
    const lim = this.parseRequiredGroup(); // annotation (top)
    const e = this.parseRequiredGroup(); // base
    return {
      type: 'limUpp',
      e,
      lim,
    };
  }

  private parseUnderset(): LimLowNode {
    const lim = this.parseRequiredGroup(); // annotation (bottom)
    const e = this.parseRequiredGroup(); // base
    return {
      type: 'limLow',
      e,
      lim,
    };
  }

  private parseColorCommand(): MathNode | MathNode[] | null {
    // Parse the color name (required brace content), then content group.
    // We ignore the color and just return the content nodes.
    this.parseRequiredBraceContent(); // consume {color}
    return this.parseRequiredGroup();
  }

  private parseExtensibleArrow(name: string): MathNode {
    this.skipSpaces();

    let below: MathNode[] = [];
    let above: MathNode[] = [];

    // Optional [below] content
    if (this.pos < this.input.length && this.input[this.pos] === '[') {
      this.pos++; // skip '['
      below = this.parseUntil(']');
    }

    // Required {above} content
    above = this.parseRequiredGroup();

    const arrowChar = name === 'xrightarrow' ? '\u2192' : '\u2190';
    const arrowRun = makeTextRun(arrowChar);

    if (below.length > 0 && above.length > 0) {
      // Both above and below: use LimLow wrapping a LimUpp
      const upper: LimUppNode = {
        type: 'limUpp',
        e: [arrowRun],
        lim: above,
      };
      return {
        type: 'limLow',
        e: [upper],
        lim: below,
      } as LimLowNode;
    }
    if (below.length > 0) {
      return {
        type: 'limLow',
        e: [arrowRun],
        lim: below,
      } as LimLowNode;
    }
    // Only above (or empty)
    return {
      type: 'limUpp',
      e: [arrowRun],
      lim: above,
    } as LimUppNode;
  }

  private parseOperatorName(): MathNode | MathNode[] {
    const name = this.parseRequiredBraceContent();
    const funcNameRun: MathRun = { type: 'r', text: name, rPr: { nor: true } };

    // Check for scripts after operator name
    this.skipSpaces();
    if (
      this.pos < this.input.length &&
      (this.input[this.pos] === '^' || this.input[this.pos] === '_')
    ) {
      return this.parseScript(funcNameRun);
    }

    // Parse argument if next char is {
    this.skipSpaces();
    const funcNode: FunctionNode = {
      type: 'func',
      fName: [funcNameRun],
      e: [],
    };

    if (this.pos < this.input.length && this.input[this.pos] === '{') {
      funcNode.e = this.parseRequiredGroup();
    }

    return funcNode;
  }

  private parseScript(base: MathNode): MathNode {
    this.skipSpaces();
    if (this.pos >= this.input.length) return base;

    let sub: MathNode[] | undefined;
    let sup: MathNode[] | undefined;

    const ch = this.input[this.pos];
    if (ch === '_') {
      this.pos++;
      sub = this.parseRequiredGroup();
      this.skipSpaces();
      if (this.pos < this.input.length && this.input[this.pos] === '^') {
        this.pos++;
        sup = this.parseRequiredGroup();
      }
    } else if (ch === '^') {
      this.pos++;
      sup = this.parseRequiredGroup();
      this.skipSpaces();
      if (this.pos < this.input.length && this.input[this.pos] === '_') {
        this.pos++;
        sub = this.parseRequiredGroup();
      }
    } else {
      return base;
    }

    if (sub && sup) {
      return {
        type: 'sSubSup',
        e: [base],
        sub,
        sup,
      } as SubSupNode;
    }
    if (sub) {
      return {
        type: 'sSub',
        e: [base],
        sub,
      } as SubscriptNode;
    }
    if (sup) {
      return {
        type: 'sSup',
        e: [base],
        sup,
      } as SuperscriptNode;
    }

    return base;
  }

  private parseGroup(): MathNode[] {
    if (this.input[this.pos] !== '{') return [];
    this.pos++; // skip '{'
    this.depth++;
    this.checkDepth();

    const nodes: MathNode[] = [];
    while (this.pos < this.input.length && this.input[this.pos] !== '}') {
      const node = this.parseExpression();
      if (node) {
        if (Array.isArray(node)) nodes.push(...node);
        else nodes.push(node);
      } else {
        break;
      }
    }

    if (this.pos < this.input.length && this.input[this.pos] === '}') {
      this.pos++; // skip '}'
    }
    this.depth--;

    // NOTE: Do NOT check for scripts here. Script detection is handled by
    // parseExpression() after it encounters a group as a standalone expression.
    // If we checked here, it would steal scripts from the calling context
    // (e.g., parseScript calling parseRequiredGroup for subscript {i} would
    // see ^{n} and consume it, preventing the sub+super combination).

    return nodes;
  }

  private parseRequiredGroup(): MathNode[] {
    this.skipSpaces();
    if (this.pos >= this.input.length) return [];

    if (this.input[this.pos] === '{') {
      return this.parseGroup();
    }

    // Single token
    if (this.input[this.pos] === '\\') {
      const node = this.parseCommand();
      if (node) {
        return Array.isArray(node) ? node : [node];
      }
      return [];
    }

    // Single character
    const ch = this.input[this.pos];
    this.pos++;
    return [makeTextRun(ch)];
  }

  private parseRequiredBraceContent(): string {
    this.skipSpaces();
    if (this.pos >= this.input.length || this.input[this.pos] !== '{') return '';
    this.pos++; // skip '{'
    let depth = 1;
    const start = this.pos;
    while (this.pos < this.input.length && depth > 0) {
      if (this.input[this.pos] === '{') depth++;
      else if (this.input[this.pos] === '}') depth--;
      if (depth > 0) this.pos++;
    }
    const content = this.input.slice(start, this.pos);
    if (this.pos < this.input.length) this.pos++; // skip closing '}'
    return content;
  }

  private parseUntil(endChar: string): MathNode[] {
    const nodes: MathNode[] = [];
    while (this.pos < this.input.length && this.input[this.pos] !== endChar) {
      const node = this.parseExpression();
      if (node) {
        if (Array.isArray(node)) nodes.push(...node);
        else nodes.push(node);
      } else {
        break;
      }
    }
    if (this.pos < this.input.length && this.input[this.pos] === endChar) {
      this.pos++;
    }
    return nodes;
  }

  private skipUntilEndEnv(envName: string): void {
    const endTag = `\\end{${envName}}`;
    const idx = this.input.indexOf(endTag, this.pos);
    if (idx >= 0) {
      this.pos = idx + endTag.length;
    } else {
      this.pos = this.input.length;
    }
  }

  private readCommandName(): string {
    const start = this.pos;
    // Command names are sequences of letters
    while (this.pos < this.input.length && /[a-zA-Z]/.test(this.input[this.pos])) {
      this.pos++;
    }
    return this.input.slice(start, this.pos);
  }

  private skipSpaces(): void {
    while (this.pos < this.input.length && this.input[this.pos] === ' ') {
      this.pos++;
    }
  }
}

function makeTextRun(text: string): MathRun {
  return { type: 'r', text };
}
