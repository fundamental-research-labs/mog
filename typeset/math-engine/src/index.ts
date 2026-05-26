/**
 * @mog/math-engine
 *
 * Standalone math typesetting engine for OMML (Office Math Markup Language).
 * Parses OMML XML into MathAST, converts between OMML and LaTeX,
 * lays out equations for rendering, and provides diagnostic tools.
 *
 * Dependencies: @mog-sdk/contracts (types only)
 */

// Parser
export { parseLatex } from './parser/latex-parser';
export { parseOMML } from './parser/omml-parser';

// Converters
export { latexToOmml } from './converter/latex-to-omml';
export { astToLatex } from './converter/omml-to-latex';

// Layout
export {
  configForStyle,
  fontSizeForStyle,
  fracDenominatorStyle,
  fracNumeratorStyle,
  layoutEquation,
  subStyle,
  supStyle,
} from './layout/layout-engine';
export type { LayoutBox, LayoutConfig } from './layout/layout-engine';

// Layout types
export { DefaultMetricsProvider, getDefaultFontParams } from './layout/default-metrics';
export type {
  FontMetricsProvider,
  FontParameters,
  GlyphMetrics,
  GlyphStyle,
  MathStyle,
} from './layout/types';

// Templates
export {
  createBinomialTheorem,
  createEulersIdentity,
  createMatrixMultiplication,
  createProductNotation,
  createPythagoreanTheorem,
  createQuadraticFormula,
  createStandardDerivative,
  createStandardIntegral,
  createSummationNotation,
} from './templates/template-library';

// Render
export { layoutToRenderPlan } from './render/render-plan';
export type { RenderInstruction } from './render/render-plan';

// Equation error factory
export { createEquationParseError } from './errors';

// Equation gallery templates (Excel-style)
export {
  ALL_EQUATION_TEMPLATES,
  FRACTION_TEMPLATES,
  INTEGRAL_TEMPLATES,
  LARGE_OPERATOR_TEMPLATES,
  MATRIX_TEMPLATES,
  RADICAL_TEMPLATES,
  SCRIPT_TEMPLATES,
  getTemplatesByCategory,
} from './templates/equation-templates';

// Diagnostics
export { compareEquations } from './diagnostics/comparators';
export { roundTripCheck } from './diagnostics/round-trip';
export { validateAST, validateOMML } from './diagnostics/validators';

// AST type guards
export {
  isDelimiter,
  isFraction,
  isMathRun,
  isMatrix,
  isNary,
  isOMath,
  isRadical,
} from './ast/omml-type-guards';

// Re-export AST types from contracts for convenience
export type {
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
  MathNodeType,
  MathRun,
  MathRunProperties,
  MatrixNode,
  NaryNode,
  OMath,
  OMathPara,
  PhantomNode,
  PreScriptNode,
  RadicalNode,
  SubSupNode,
  SubscriptNode,
  SuperscriptNode,
} from '@mog-sdk/contracts/equation/omml-ast';
