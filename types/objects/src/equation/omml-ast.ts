/**
 * OMML AST Types
 *
 * Abstract Syntax Tree representation of Office Math Markup Language.
 * Maps directly to ECMA-376 Part 1 shared-math.xsd elements.
 *
 * @see spec/ecma-376/part1/shared-math.xsd
 */

/**
 * All math node types
 */
export type MathNodeType =
  | 'oMath' // Root math container
  | 'oMathPara' // Math paragraph (multiple equations)
  | 'acc' // Accent
  | 'bar' // Bar (over/under)
  | 'box' // Box (invisible container)
  | 'borderBox' // Border box (visible)
  | 'd' // Delimiter (parentheses, brackets)
  | 'eqArr' // Equation array
  | 'f' // Fraction
  | 'func' // Function (sin, cos, lim)
  | 'groupChr' // Grouping character
  | 'limLow' // Lower limit
  | 'limUpp' // Upper limit
  | 'm' // Matrix
  | 'nary' // N-ary operator (sum, integral)
  | 'phant' // Phantom (invisible spacing)
  | 'rad' // Radical (root)
  | 'sPre' // Pre-scripts
  | 'sSub' // Subscript
  | 'sSubSup' // Sub-superscript
  | 'sSup' // Superscript
  | 'r'; // Run (text content)

/**
 * Base interface for all math AST nodes
 */
export interface MathNodeBase {
  type: MathNodeType;
}

// ============================================================================
// Container Nodes
// ============================================================================

/**
 * Root math container - <m:oMath>
 */
export interface OMath extends MathNodeBase {
  type: 'oMath';
  children: MathNode[];
}

/**
 * Math paragraph - <m:oMathPara>
 */
export interface OMathPara extends MathNodeBase {
  type: 'oMathPara';
  justification?: 'left' | 'right' | 'center' | 'centerGroup';
  equations: OMath[];
}

// ============================================================================
// Structure Nodes
// ============================================================================

/**
 * Accent - <m:acc>
 * Accent mark over base expression (hat, tilde, dot, etc.)
 */
export interface AccentNode extends MathNodeBase {
  type: 'acc';
  /** Accent character (defaults to combining circumflex U+0302) */
  chr?: string;
  /** Base expression */
  e: MathNode[];
}

/**
 * Bar - <m:bar>
 * Horizontal bar over or under base
 */
export interface BarNode extends MathNodeBase {
  type: 'bar';
  /** Position: 'top' (overline) or 'bot' (underline) */
  pos: 'top' | 'bot';
  /** Base expression */
  e: MathNode[];
}

/**
 * Box - <m:box>
 * Invisible container for grouping/alignment
 */
export interface BoxNode extends MathNodeBase {
  type: 'box';
  /** Operator emulator (acts as operator for spacing) */
  opEmu?: boolean;
  /** No break (keep together) */
  noBreak?: boolean;
  /** Differential (italic d for dx) */
  diff?: boolean;
  /** Alignment point */
  aln?: boolean;
  /** Content */
  e: MathNode[];
}

/**
 * BorderBox - <m:borderBox>
 * Box with visible borders
 */
export interface BorderBoxNode extends MathNodeBase {
  type: 'borderBox';
  /** Hide individual borders */
  hideTop?: boolean;
  hideBot?: boolean;
  hideLeft?: boolean;
  hideRight?: boolean;
  /** Strikethrough lines */
  strikeH?: boolean;
  strikeV?: boolean;
  strikeBLTR?: boolean;
  strikeTLBR?: boolean;
  /** Content */
  e: MathNode[];
}

/**
 * Delimiter - <m:d>
 * Parentheses, brackets, braces, etc.
 */
export interface DelimiterNode extends MathNodeBase {
  type: 'd';
  /** Beginning character (default '(') */
  begChr?: string;
  /** Separator character (default '|') */
  sepChr?: string;
  /** Ending character (default ')') */
  endChr?: string;
  /** Grow with content */
  grow?: boolean;
  /** Shape: 'centered' or 'match' */
  shp?: 'centered' | 'match';
  /** Content elements (separated by sepChr) */
  e: MathNode[][];
}

/**
 * Equation Array - <m:eqArr>
 * Vertically aligned equations
 */
export interface EqArrayNode extends MathNodeBase {
  type: 'eqArr';
  /** Base justification */
  baseJc?: 'top' | 'center' | 'bottom';
  /** Maximum distribution */
  maxDist?: boolean;
  /** Object distribution */
  objDist?: boolean;
  /** Row spacing rule */
  rSpRule?: 0 | 1 | 2 | 3 | 4;
  /** Row spacing value */
  rSp?: number;
  /** Array rows */
  e: MathNode[][];
}

/**
 * Fraction - <m:f>
 * Numerator over denominator
 *
 * IMPORTANT: Uses `fractionType` field (NOT `type_`)
 * Maps to OMML <m:fPr><m:type m:val="..."/></m:fPr>
 */
export interface FractionNode extends MathNodeBase {
  type: 'f';
  /** Fraction type: bar (stacked), skw (skewed), lin (linear), noBar (no bar) */
  fractionType: 'bar' | 'skw' | 'lin' | 'noBar';
  /** Numerator */
  num: MathNode[];
  /** Denominator */
  den: MathNode[];
}

/**
 * Function - <m:func>
 * Named function like sin, cos, lim
 */
export interface FunctionNode extends MathNodeBase {
  type: 'func';
  /** Function name */
  fName: MathNode[];
  /** Argument */
  e: MathNode[];
}

/**
 * Group Character - <m:groupChr>
 * Grouping symbol (underbrace, overbrace)
 */
export interface GroupCharNode extends MathNodeBase {
  type: 'groupChr';
  /** Character (default is underbrace) */
  chr?: string;
  /** Position: 'top' or 'bot' */
  pos?: 'top' | 'bot';
  /** Vertical justification */
  vertJc?: 'top' | 'bot';
  /** Content */
  e: MathNode[];
}

/**
 * Lower Limit - <m:limLow>
 * Base with limit below
 */
export interface LimLowNode extends MathNodeBase {
  type: 'limLow';
  /** Base expression */
  e: MathNode[];
  /** Limit expression */
  lim: MathNode[];
}

/**
 * Upper Limit - <m:limUpp>
 * Base with limit above
 */
export interface LimUppNode extends MathNodeBase {
  type: 'limUpp';
  /** Base expression */
  e: MathNode[];
  /** Limit expression */
  lim: MathNode[];
}

/**
 * Matrix - <m:m>
 * Mathematical matrix
 */
export interface MatrixNode extends MathNodeBase {
  type: 'm';
  /** Base justification */
  baseJc?: 'top' | 'center' | 'bottom';
  /** Hide placeholder */
  plcHide?: boolean;
  /** Row spacing rule */
  rSpRule?: 0 | 1 | 2 | 3 | 4;
  /** Column gap rule */
  cGpRule?: 0 | 1 | 2 | 3 | 4;
  /** Row spacing */
  rSp?: number;
  /** Column spacing */
  cSp?: number;
  /** Column gap */
  cGp?: number;
  /** Column properties */
  mcs?: Array<{ count?: number; mcJc?: 'left' | 'center' | 'right' }>;
  /** Matrix rows - each row is an array of cells, each cell is an array of nodes */
  mr: MathNode[][][];
}

/**
 * N-ary Operator - <m:nary>
 * Summation, integral, product, etc.
 */
export interface NaryNode extends MathNodeBase {
  type: 'nary';
  /** Operator character (sum, integral, product, etc.) */
  chr?: string;
  /** Limit location: 'undOvr' (above/below) or 'subSup' (sub/superscript) */
  limLoc?: 'undOvr' | 'subSup';
  /** Grow with content */
  grow?: boolean;
  /** Hide subscript */
  subHide?: boolean;
  /** Hide superscript */
  supHide?: boolean;
  /** Subscript (lower limit) */
  sub: MathNode[];
  /** Superscript (upper limit) */
  sup: MathNode[];
  /** Content (integrand, summand) */
  e: MathNode[];
}

/**
 * Phantom - <m:phant>
 * Invisible element for spacing
 */
export interface PhantomNode extends MathNodeBase {
  type: 'phant';
  /** Show content (false = invisible) */
  show?: boolean;
  /** Zero width */
  zeroWid?: boolean;
  /** Zero ascent */
  zeroAsc?: boolean;
  /** Zero descent */
  zeroDesc?: boolean;
  /** Transparent (show but don't contribute to size) */
  transp?: boolean;
  /** Content */
  e: MathNode[];
}

/**
 * Radical - <m:rad>
 * Square root or n-th root
 */
export interface RadicalNode extends MathNodeBase {
  type: 'rad';
  /** Hide degree (for square root) */
  degHide?: boolean;
  /** Degree (n in n-th root) */
  deg: MathNode[];
  /** Radicand (content under root) */
  e: MathNode[];
}

/**
 * Pre-scripts - <m:sPre>
 * Subscript and superscript before base
 */
export interface PreScriptNode extends MathNodeBase {
  type: 'sPre';
  /** Subscript */
  sub: MathNode[];
  /** Superscript */
  sup: MathNode[];
  /** Base */
  e: MathNode[];
}

/**
 * Subscript - <m:sSub>
 */
export interface SubscriptNode extends MathNodeBase {
  type: 'sSub';
  /** Base */
  e: MathNode[];
  /** Subscript */
  sub: MathNode[];
}

/**
 * Sub-Superscript - <m:sSubSup>
 */
export interface SubSupNode extends MathNodeBase {
  type: 'sSubSup';
  /** Align scripts */
  alnScr?: boolean;
  /** Base */
  e: MathNode[];
  /** Subscript */
  sub: MathNode[];
  /** Superscript */
  sup: MathNode[];
}

/**
 * Superscript - <m:sSup>
 */
export interface SuperscriptNode extends MathNodeBase {
  type: 'sSup';
  /** Base */
  e: MathNode[];
  /** Superscript */
  sup: MathNode[];
}

// ============================================================================
// Text Nodes
// ============================================================================

/**
 * Text Run - <m:r>
 * Actual text/symbol content
 */
export interface MathRun extends MathNodeBase {
  type: 'r';
  /** Text content */
  text: string;
  /** Run properties */
  rPr?: MathRunProperties;
}

/**
 * Math run properties
 */
export interface MathRunProperties {
  /** Literal (don't apply math styling) */
  lit?: boolean;
  /** Normal text (not math) */
  nor?: boolean;
  /** Script style */
  scr?: 'roman' | 'script' | 'fraktur' | 'double-struck' | 'sans-serif' | 'monospace';
  /** Style (plain, bold, italic, bold-italic) */
  sty?: 'p' | 'b' | 'i' | 'bi';
  /** Manual break */
  brk?: { alnAt?: number };
  /** Alignment point */
  aln?: boolean;
}

// ============================================================================
// Union Type
// ============================================================================

/**
 * Any math AST node
 */
export type MathNode =
  | OMath
  | OMathPara
  | AccentNode
  | BarNode
  | BoxNode
  | BorderBoxNode
  | DelimiterNode
  | EqArrayNode
  | FractionNode
  | FunctionNode
  | GroupCharNode
  | LimLowNode
  | LimUppNode
  | MatrixNode
  | NaryNode
  | PhantomNode
  | RadicalNode
  | PreScriptNode
  | SubscriptNode
  | SubSupNode
  | SuperscriptNode
  | MathRun;

// ============================================================================
// Type Guards
// ============================================================================
