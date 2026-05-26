/**
 * Diagram Layout Definition Parser (layout#.xml)
 *
 * Parses OOXML Diagram layout definition XML into strongly-typed LayoutDefinition objects.
 * This is the most complex parser because layout definitions contain:
 * - Recursive layout node trees
 * - Algorithm definitions with 55 parameter types
 * - ForEach iteration loops
 * - Choose/If/Else conditional branching
 * - Constraint and rule lists
 * - Variable lists
 * - Shape definitions with adjustments
 * - PresOf mappings
 * - Sample, style, and color data
 *
 * Input: Pre-parsed XML object (from fast-xml-parser / WASM XML bridge format)
 * Output: LayoutDefinition interface from @mog-sdk/contracts
 *
 * @see ECMA-376 Part 1, Section 21.4.3 (Diagram Layout Definition)
 */

import type {
  Algorithm,
  AlgorithmTypeValue,
  Choose,
  ElseClause,
  ForEach,
  IfClause,
  LayoutCategory,
  LayoutDefinition,
  LayoutNode,
  LayoutNodeChild,
  LayoutShape,
  OoxmlConstraint,
  OoxmlRule,
  PresOf,
  ST_AnimLvlStr,
  ST_AnimOneStr,
  ST_BoolOperator,
  ST_ConstraintRelationship,
  ST_ConstraintType,
  ST_Direction,
  ST_ElementType,
  ST_FunctionArgument,
  ST_FunctionOperator,
  ST_FunctionType,
  ST_HierBranch,
  ST_ResizeHandlesStr,
  SampleData,
  VariableList,
} from '@mog-sdk/contracts/diagram';
import {
  ALL_ELEMENT_TYPES,
  ALL_FUNCTION_ARGUMENTS,
  ALL_FUNCTION_OPERATORS,
  ALL_FUNCTION_TYPES,
  VARIABLE_LIST_DEFAULTS,
} from '@mog-sdk/contracts/diagram';
import { parseDataModel } from './data-model-parser';
import { parseCatLst, validateEnum } from './drawingml-helpers';
import type { XmlNode } from './xml-helpers';
import { attr, boolAttr, child, children, iterateChildrenInOrder, numAttr } from './xml-helpers';

// =============================================================================
// Valid Algorithm Types
// =============================================================================

const VALID_ALGORITHM_TYPES = new Set<string>([
  'composite',
  'lin',
  'snake',
  'cycle',
  'hierRoot',
  'hierChild',
  'pyra',
  'conn',
  'tx',
  'sp',
]);

// =============================================================================
// Enum Validation Sets
// =============================================================================

const VALID_CONSTRAINT_TYPES = new Set<string>([
  'l',
  't',
  'r',
  'b',
  'lOff',
  'tOff',
  'rOff',
  'bOff',
  'ctrX',
  'ctrY',
  'ctrXOff',
  'ctrYOff',
  'w',
  'h',
  'wOff',
  'hOff',
  'lMarg',
  'tMarg',
  'rMarg',
  'bMarg',
  'begMarg',
  'endMarg',
  'primFontSz',
  'secFontSz',
  'sp',
  'sibSp',
  'secSibSp',
  'connDist',
  'diam',
  'stemThick',
  'begPad',
  'endPad',
  'wArH',
  'hArH',
  'bendDist',
  'pyraAcctRatio',
  'alignOff',
  'userA',
  'userB',
  'userC',
  'userD',
  'userE',
  'userF',
  'userG',
  'userH',
  'userI',
  'userJ',
  'userK',
  'userL',
  'userM',
  'userN',
  'userO',
  'userP',
  'userQ',
  'userR',
  'userS',
  'userT',
  'userU',
  'userV',
  'userW',
  'userX',
  'userY',
  'userZ',
  'none',
]);

const VALID_CONSTRAINT_RELATIONSHIPS = new Set<string>(['self', 'ch', 'des']);
const VALID_BOOL_OPERATORS = new Set<string>(['none', 'equ', 'gte', 'lte']);
const VALID_ELEMENT_TYPES = new Set<string>(ALL_ELEMENT_TYPES);
const VALID_FUNCTION_TYPES = new Set<string>(ALL_FUNCTION_TYPES);
const VALID_FUNCTION_OPERATORS = new Set<string>(ALL_FUNCTION_OPERATORS);
const VALID_FUNCTION_ARGUMENTS = new Set<string>(ALL_FUNCTION_ARGUMENTS);
const VALID_DIRECTIONS = new Set<string>(['norm', 'rev']);
const VALID_HIER_BRANCHES = new Set<string>(['std', 'init', 'l', 'r', 'hang']);
const VALID_ANIM_ONE = new Set<string>(['none', 'one', 'branch']);
const VALID_ANIM_LVL = new Set<string>(['none', 'lvl', 'ctr']);
const VALID_RESIZE_HANDLES = new Set<string>(['exact', 'rel']);

// =============================================================================
// Main Parse Function
// =============================================================================

/**
 * Parse a Diagram layout definition from a pre-parsed XML object.
 *
 * @param xml - Pre-parsed XML object
 * @returns Parsed LayoutDefinition
 */
export function parseLayoutDefinition(xml: XmlNode): LayoutDefinition {
  // Navigate to the layoutDef element
  const layoutDef = child(xml, 'dgm:layoutDef') ?? xml;

  const uniqueId = attr(layoutDef, 'uniqueId') ?? '';

  // Parse title and description (from dgm:title and dgm:desc elements or attributes)
  const titleElem = child(layoutDef, 'dgm:title');
  const title = titleElem ? attr(titleElem, 'val') : attr(layoutDef, 'title');

  const descElem = child(layoutDef, 'dgm:desc');
  const desc = descElem ? attr(descElem, 'val') : attr(layoutDef, 'desc');

  // Parse categories
  const categories = parseCategories(child(layoutDef, 'dgm:catLst'));

  // Parse sample/style/color data
  const sampData = parseSampleData(child(layoutDef, 'dgm:sampData'));
  const styleData = parseSampleData(child(layoutDef, 'dgm:styleData'));
  const clrData = parseSampleData(child(layoutDef, 'dgm:clrData'));

  // Parse root layout node - find the first dgm:layoutNode child
  const layoutNodeElem = child(layoutDef, 'dgm:layoutNode');
  const rootLayoutNode = layoutNodeElem ? parseLayoutNode(layoutNodeElem) : createEmptyLayoutNode();

  const minVer = attr(layoutDef, 'minVer');
  const defStyle = attr(layoutDef, 'defStyle');

  return {
    uniqueId,
    title,
    desc,
    categories,
    sampData,
    styleData,
    clrData,
    rootLayoutNode,
    minVer,
    defStyle,
  };
}

// =============================================================================
// Categories Parsing
// =============================================================================

/**
 * Parse category list from dgm:catLst element.
 * Maps the shared { type, pri } format to LayoutCategory's { type, priority }.
 */
function parseCategories(catLst: XmlNode | undefined): LayoutCategory[] {
  return parseCatLst(catLst).map(({ type, pri }) => ({ type, priority: pri }));
}

// =============================================================================
// Sample Data Parsing
// =============================================================================

/**
 * Parse sample data (dgm:sampData, dgm:styleData, dgm:clrData).
 */
function parseSampleData(sampleNode: XmlNode | undefined): SampleData | undefined {
  if (!sampleNode) return undefined;

  const useDef = boolAttr(sampleNode, 'useDef');
  if (useDef) {
    return { useDefault: true };
  }

  // Check for inline data model
  const dataModelNode = child(sampleNode, 'dgm:dataModel');
  if (dataModelNode) {
    try {
      const dataModel = parseDataModel({ 'dgm:dataModel': dataModelNode });
      return { dataModel };
    } catch {
      return { useDefault: true };
    }
  }

  return { useDefault: true };
}

// =============================================================================
// Layout Node Parsing
// =============================================================================

/**
 * Parse a dgm:layoutNode element into a LayoutNode.
 */
function parseLayoutNode(node: XmlNode): LayoutNode {
  const name = attr(node, 'name');
  const styleLbl = attr(node, 'styleLbl');
  const moveWith = attr(node, 'moveWith');

  // Parse algorithm
  const algNode = child(node, 'dgm:alg');
  const algorithm = algNode ? parseAlgorithm(algNode) : undefined;

  // Parse shape
  const shapeNode = child(node, 'dgm:shape');
  const shape = shapeNode ? parseShape(shapeNode) : undefined;

  // Parse presOf
  // NOTE: ECMA-376 allows multiple dgm:presOf elements per layoutNode, but
  // the PresOf field on LayoutNode is currently typed as a single PresOf object.
  // We collect all presOf elements but only store the first one. If multiple
  // presOf elements are present, subsequent ones are silently dropped.
  // TODO: Change LayoutNode.presOf to PresOf[] to support multiple mappings.
  const presOfNodes = children(node, 'dgm:presOf');
  // Note: Only the first presOf is used; additional presOf elements are dropped.
  const presOf = presOfNodes.length > 0 ? parsePresOf(presOfNodes[0]) : undefined;

  // Parse constraints
  const constrLst = child(node, 'dgm:constrLst');
  const constraints = constrLst ? parseConstraintList(constrLst) : undefined;

  // Parse rules
  const ruleLst = child(node, 'dgm:ruleLst');
  const rules = ruleLst ? parseRuleList(ruleLst) : undefined;

  // Parse variable list
  const varLstNode = child(node, 'dgm:varLst');
  const varLst = varLstNode ? parseVariableList(varLstNode) : undefined;

  // Parse children (recursive layout nodes, forEach, choose)
  const childElems = parseLayoutNodeChildren(node);

  return {
    kind: 'layoutNode' as const,
    name,
    styleLbl,
    moveWith,
    algorithm,
    shape,
    presOf,
    constraints,
    rules,
    varLst,
    children: childElems,
  };
}

/**
 * Create an empty layout node (used as fallback).
 */
function createEmptyLayoutNode(): LayoutNode {
  return {
    kind: 'layoutNode' as const,
    children: [],
  };
}

// =============================================================================
// Algorithm Parsing
// =============================================================================

/**
 * Parse a dgm:alg element into an Algorithm.
 */
function parseAlgorithm(algNode: XmlNode): Algorithm {
  const typeStr = attr(algNode, 'type') ?? 'composite';
  const type = VALID_ALGORITHM_TYPES.has(typeStr)
    ? (typeStr as AlgorithmTypeValue)
    : ('composite' as AlgorithmTypeValue);

  const params: Record<string, string> = {};
  for (const paramNode of children(algNode, 'dgm:param')) {
    const paramType = attr(paramNode, 'type');
    const paramVal = attr(paramNode, 'val');
    if (paramType && paramVal !== undefined) {
      params[paramType] = paramVal;
    }
  }

  return { type, params };
}

// =============================================================================
// Shape Parsing
// =============================================================================

/**
 * Parse a dgm:shape element into a LayoutShape.
 */
function parseShape(shapeNode: XmlNode): LayoutShape {
  const result: LayoutShape = {};

  const type = attr(shapeNode, 'type');
  if (type) result.type = type;

  const rot = numAttr(shapeNode, 'rot');
  if (rot !== undefined) result.rot = rot;

  const zOrderOff = numAttr(shapeNode, 'zOrderOff');
  if (zOrderOff !== undefined) result.zOrderOff = zOrderOff;

  const hideGeom = boolAttr(shapeNode, 'hideGeom');
  if (hideGeom !== undefined) result.hideGeom = hideGeom;

  const lkTxEntry = boolAttr(shapeNode, 'lkTxEntry');
  if (lkTxEntry !== undefined) result.lkTxEntry = lkTxEntry;

  const blipPhldr = boolAttr(shapeNode, 'blipPhldr');
  if (blipPhldr !== undefined) result.blipPhldr = blipPhldr;

  // Parse adjustment values (dgm:adjLst/dgm:adj)
  const adjLst = child(shapeNode, 'dgm:adjLst');
  if (adjLst) {
    const adjs: Record<string, number> = {};
    for (const adjNode of children(adjLst, 'dgm:adj')) {
      const idx = attr(adjNode, 'idx');
      const val = numAttr(adjNode, 'val');
      if (idx !== undefined && val !== undefined) {
        adjs[idx] = val;
      }
    }
    if (Object.keys(adjs).length > 0) {
      result.adjustments = adjs;
    }
  }

  return result;
}

// =============================================================================
// PresOf Parsing
// =============================================================================

/**
 * Parse a dgm:presOf element into a PresOf.
 */
function parsePresOf(presOfNode: XmlNode): PresOf {
  const result: PresOf = {};

  const axis = attr(presOfNode, 'axis');
  if (axis) result.axis = axis;

  const ptType = attr(presOfNode, 'ptType');
  if (ptType) result.ptType = ptType;

  const cnt = numAttr(presOfNode, 'cnt');
  if (cnt !== undefined) result.cnt = cnt;

  const st = numAttr(presOfNode, 'st');
  if (st !== undefined) result.st = st;

  const step = numAttr(presOfNode, 'step');
  if (step !== undefined) result.step = step;

  const hideLastTrans = boolAttr(presOfNode, 'hideLastTrans');
  if (hideLastTrans !== undefined) result.hideLastTrans = hideLastTrans;

  return result;
}

// =============================================================================
// Constraint List Parsing
// =============================================================================

/**
 * Parse constraint list from dgm:constrLst element.
 */
function parseConstraintList(constrLst: XmlNode): OoxmlConstraint[] {
  const constraints: OoxmlConstraint[] = [];

  for (const constrNode of children(constrLst, 'dgm:constr')) {
    constraints.push(parseConstraint(constrNode));
  }

  return constraints;
}

/**
 * Parse a single dgm:constr element.
 */
function parseConstraint(constrNode: XmlNode): OoxmlConstraint {
  return {
    type: validateEnum(
      attr(constrNode, 'type') ?? 'none',
      VALID_CONSTRAINT_TYPES,
      'none' as ST_ConstraintType,
    ),
    for: validateEnum(
      attr(constrNode, 'for') ?? 'self',
      VALID_CONSTRAINT_RELATIONSHIPS,
      'self' as ST_ConstraintRelationship,
    ),
    forName: attr(constrNode, 'forName') ?? '',
    refType: validateEnum(
      attr(constrNode, 'refType') ?? 'none',
      VALID_CONSTRAINT_TYPES,
      'none' as ST_ConstraintType,
    ),
    refFor: validateEnum(
      attr(constrNode, 'refFor') ?? 'self',
      VALID_CONSTRAINT_RELATIONSHIPS,
      'self' as ST_ConstraintRelationship,
    ),
    refForName: attr(constrNode, 'refForName') ?? '',
    op: validateEnum(
      attr(constrNode, 'op') ?? 'equ',
      VALID_BOOL_OPERATORS,
      'equ' as ST_BoolOperator,
    ),
    val: numAttr(constrNode, 'val') ?? 0,
    fact: numAttr(constrNode, 'fact') ?? 1,
    ptType: validateEnum(
      attr(constrNode, 'ptType') ?? 'all',
      VALID_ELEMENT_TYPES,
      'all' as ST_ElementType,
    ),
    refPtType: validateEnum(
      attr(constrNode, 'refPtType') ?? 'all',
      VALID_ELEMENT_TYPES,
      'all' as ST_ElementType,
    ),
  };
}

// =============================================================================
// Rule List Parsing
// =============================================================================

/**
 * Parse rule list from dgm:ruleLst element.
 */
function parseRuleList(ruleLst: XmlNode): OoxmlRule[] {
  const rules: OoxmlRule[] = [];

  for (const ruleNode of children(ruleLst, 'dgm:rule')) {
    rules.push(parseRule(ruleNode));
  }

  return rules;
}

/**
 * Parse a single dgm:rule element.
 */
function parseRule(ruleNode: XmlNode): OoxmlRule {
  const maxVal = numAttr(ruleNode, 'max');
  return {
    type: validateEnum(
      attr(ruleNode, 'type') ?? 'none',
      VALID_CONSTRAINT_TYPES,
      'none' as ST_ConstraintType,
    ),
    for: validateEnum(
      attr(ruleNode, 'for') ?? 'self',
      VALID_CONSTRAINT_RELATIONSHIPS,
      'self' as ST_ConstraintRelationship,
    ),
    forName: attr(ruleNode, 'forName') ?? '',
    refType: validateEnum(
      attr(ruleNode, 'refType') ?? 'none',
      VALID_CONSTRAINT_TYPES,
      'none' as ST_ConstraintType,
    ),
    refFor: validateEnum(
      attr(ruleNode, 'refFor') ?? 'self',
      VALID_CONSTRAINT_RELATIONSHIPS,
      'self' as ST_ConstraintRelationship,
    ),
    refForName: attr(ruleNode, 'refForName') ?? '',
    op: validateEnum(attr(ruleNode, 'op') ?? 'equ', VALID_BOOL_OPERATORS, 'equ' as ST_BoolOperator),
    ptType: validateEnum(
      attr(ruleNode, 'ptType') ?? 'all',
      VALID_ELEMENT_TYPES,
      'all' as ST_ElementType,
    ),
    val: numAttr(ruleNode, 'val') ?? 0,
    fact: numAttr(ruleNode, 'fact') ?? 1,
    max: maxVal !== undefined ? maxVal : Number.MAX_SAFE_INTEGER,
  };
}

// =============================================================================
// Variable List Parsing
// =============================================================================

/**
 * Parse variable list from dgm:varLst element.
 */
function parseVariableList(varLstNode: XmlNode): VariableList {
  const defaults = VARIABLE_LIST_DEFAULTS;

  // Each variable is a child element like <dgm:orgChart val="1"/>
  const orgChartNode = child(varLstNode, 'dgm:orgChart');
  const orgChart = orgChartNode
    ? (boolAttr(orgChartNode, 'val') ?? defaults.orgChart)
    : defaults.orgChart;

  const chMaxNode = child(varLstNode, 'dgm:chMax');
  const chMax = chMaxNode ? (numAttr(chMaxNode, 'val') ?? defaults.chMax) : defaults.chMax;

  const chPrefNode = child(varLstNode, 'dgm:chPref');
  const chPref = chPrefNode ? (numAttr(chPrefNode, 'val') ?? defaults.chPref) : defaults.chPref;

  const bulEnabledNode = child(varLstNode, 'dgm:bulletEnabled');
  const bulletEnabled = bulEnabledNode
    ? (boolAttr(bulEnabledNode, 'val') ?? defaults.bulletEnabled)
    : defaults.bulletEnabled;

  const dirNode = child(varLstNode, 'dgm:dir');
  const dir = dirNode
    ? validateEnum(attr(dirNode, 'val'), VALID_DIRECTIONS, defaults.dir as ST_Direction)
    : defaults.dir;

  const hierBranchNode = child(varLstNode, 'dgm:hierBranch');
  const hierBranch = hierBranchNode
    ? validateEnum(
        attr(hierBranchNode, 'val'),
        VALID_HIER_BRANCHES,
        defaults.hierBranch as ST_HierBranch,
      )
    : defaults.hierBranch;

  const animOneNode = child(varLstNode, 'dgm:animOne');
  const animOne = animOneNode
    ? validateEnum(attr(animOneNode, 'val'), VALID_ANIM_ONE, defaults.animOne as ST_AnimOneStr)
    : defaults.animOne;

  const animLvlNode = child(varLstNode, 'dgm:animLvl');
  const animLvl = animLvlNode
    ? validateEnum(attr(animLvlNode, 'val'), VALID_ANIM_LVL, defaults.animLvl as ST_AnimLvlStr)
    : defaults.animLvl;

  const resizeHandlesNode = child(varLstNode, 'dgm:resizeHandles');
  const resizeHandles = resizeHandlesNode
    ? validateEnum(
        attr(resizeHandlesNode, 'val'),
        VALID_RESIZE_HANDLES,
        defaults.resizeHandles as ST_ResizeHandlesStr,
      )
    : defaults.resizeHandles;

  return {
    orgChart,
    chMax,
    chPref,
    bulletEnabled,
    dir,
    hierBranch,
    animOne,
    animLvl,
    resizeHandles,
  };
}

// =============================================================================
// Layout Node Children Parsing (Recursive)
// =============================================================================

/**
 * Parse all children of a layout node / forEach / if / else.
 * Children can be dgm:layoutNode, dgm:forEach, or dgm:choose.
 *
 * IMPORTANT: Children are iterated in document order by walking the object
 * keys, which JavaScript preserves in insertion order (ES2015+). This ensures
 * that interleaved layoutNode, forEach, and choose elements maintain their
 * original XML sequence.
 */
function parseLayoutNodeChildren(parentNode: XmlNode): LayoutNodeChild[] {
  const result: LayoutNodeChild[] = [];

  iterateChildrenInOrder(parentNode, {
    'dgm:layoutNode': (node) => {
      result.push(parseLayoutNode(node) as LayoutNodeChild);
    },
    'dgm:forEach': (node) => {
      result.push(parseForEach(node));
    },
    'dgm:choose': (node) => {
      result.push(parseChoose(node));
    },
  });

  return result;
}

// =============================================================================
// ForEach Parsing
// =============================================================================

/**
 * Parse a dgm:forEach element.
 */
function parseForEach(forEachNode: XmlNode): ForEach {
  const name = attr(forEachNode, 'name') ?? '';
  const ref = attr(forEachNode, 'ref') ?? '';
  const axis = attr(forEachNode, 'axis') ?? 'ch';
  const ptType = attr(forEachNode, 'ptType') ?? 'all';
  const cnt = numAttr(forEachNode, 'cnt') ?? 0;
  const st = numAttr(forEachNode, 'st') ?? 1;
  const step = numAttr(forEachNode, 'step') ?? 1;
  const hideLastTrans = boolAttr(forEachNode, 'hideLastTrans') ?? true;

  const childElements = parseLayoutNodeChildren(forEachNode);

  return {
    kind: 'forEach' as const,
    name,
    ref,
    axis,
    ptType,
    cnt,
    st,
    step,
    hideLastTrans,
    children: childElements,
  };
}

// =============================================================================
// Choose / If / Else Parsing
// =============================================================================

/**
 * Parse a dgm:choose element.
 */
function parseChoose(chooseNode: XmlNode): Choose {
  const name = attr(chooseNode, 'name') ?? '';

  // Parse if clauses
  const ifClauses: IfClause[] = [];
  for (const ifNode of children(chooseNode, 'dgm:if')) {
    ifClauses.push(parseIfClause(ifNode));
  }

  // Parse else clause
  const elseNode = child(chooseNode, 'dgm:else');
  const elseClauses = elseNode ? parseElseClause(elseNode) : null;

  return {
    kind: 'choose' as const,
    name,
    ifClauses,
    elseClauses,
  };
}

/**
 * Parse a dgm:if element.
 */
function parseIfClause(ifNode: XmlNode): IfClause {
  const name = attr(ifNode, 'name') ?? '';
  const func = validateEnum(
    attr(ifNode, 'func') ?? 'cnt',
    VALID_FUNCTION_TYPES,
    'cnt' as ST_FunctionType,
  );
  const arg = validateEnum(
    attr(ifNode, 'arg') ?? 'none',
    VALID_FUNCTION_ARGUMENTS,
    'none' as ST_FunctionArgument,
  );
  const op = validateEnum(
    attr(ifNode, 'op') ?? 'equ',
    VALID_FUNCTION_OPERATORS,
    'equ' as ST_FunctionOperator,
  );
  const val = attr(ifNode, 'val') ?? '0';
  const axis = attr(ifNode, 'axis') ?? 'none';
  const ptType = attr(ifNode, 'ptType') ?? 'all';
  const cnt = numAttr(ifNode, 'cnt') ?? 0;
  const st = numAttr(ifNode, 'st') ?? 1;
  const step = numAttr(ifNode, 'step') ?? 1;
  const hideLastTrans = boolAttr(ifNode, 'hideLastTrans') ?? true;

  const childElements = parseLayoutNodeChildren(ifNode);

  return {
    name,
    func,
    arg,
    op,
    val,
    axis,
    ptType,
    cnt,
    st,
    step,
    hideLastTrans,
    children: childElements,
  };
}

/**
 * Parse a dgm:else element.
 */
function parseElseClause(elseNode: XmlNode): ElseClause {
  const name = attr(elseNode, 'name') ?? '';
  const childElements = parseLayoutNodeChildren(elseNode);

  return {
    name,
    children: childElements,
  };
}
