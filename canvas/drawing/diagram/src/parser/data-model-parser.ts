/**
 * Diagram Data Model Parser (data#.xml)
 *
 * Parses the OOXML Diagram data model XML into strongly-typed DataModel objects.
 * The data model contains:
 * - Points (dgm:pt): nodes with text, properties, and shape overrides
 * - Connections (dgm:cxn): parent-child and presentation relationships
 * - Background formatting (dgm:bg)
 * - Whole-document formatting (dgm:whole)
 *
 * Input: Pre-parsed XML object (from fast-xml-parser / WASM XML bridge format)
 * Output: DataModel interface from @mog-sdk/contracts
 *
 * @see ECMA-376 Part 1, Section 21.4.2 (Diagram Data)
 */

import type {
  ConnectionTypeValue,
  DataModel,
  DataModelConnection,
  DataModelPoint,
  DiagramBackground,
  DiagramWhole,
  ModelId,
  PointPropertySet,
  PointTypeValue,
} from '@mog-sdk/contracts/diagram';
import {
  parseEffectList,
  parseFill,
  parseLineProperties,
  parseRichText,
  parseShapeProperties,
} from './drawingml-helpers';
import type { XmlNode } from './xml-helpers';
import { attr, boolAttr, child, children, numAttr } from './xml-helpers';

// =============================================================================
// Valid Enum Values
// =============================================================================

const VALID_POINT_TYPES = new Set<string>([
  'doc',
  'node',
  'norm',
  'nonNorm',
  'asst',
  'nonAsst',
  'parTrans',
  'pres',
  'sibTrans',
]);

const VALID_CONNECTION_TYPES = new Set<string>([
  'parOf',
  'presOf',
  'presParOf',
  'unknownRelationship',
]);

// =============================================================================
// Main Parse Function
// =============================================================================

/**
 * Parse a Diagram data model from a pre-parsed XML object.
 *
 * Expects the root element to be `dgm:dataModel` or the object to contain
 * a `dgm:dataModel` key.
 *
 * @param xml - Pre-parsed XML object
 * @returns Parsed DataModel
 */
export function parseDataModel(xml: XmlNode): DataModel {
  // Navigate to the dataModel element
  const dataModel = child(xml, 'dgm:dataModel') ?? xml;

  // Parse points
  const ptLst = child(dataModel, 'dgm:ptLst');
  const points = parsePoints(ptLst);

  // Parse connections
  const cxnLst = child(dataModel, 'dgm:cxnLst');
  const connections = parseConnections(cxnLst);

  // Parse background
  const bgNode = child(dataModel, 'dgm:bg');
  const background = parseBackground(bgNode);

  // Parse whole-document formatting
  const wholeNode = child(dataModel, 'dgm:whole');
  const whole = parseWhole(wholeNode);

  return {
    points,
    connections,
    background,
    whole,
  };
}

// =============================================================================
// Point Parsing
// =============================================================================

/**
 * Parse all points from a dgm:ptLst element.
 */
function parsePoints(ptLst: XmlNode | undefined): DataModelPoint[] {
  if (!ptLst) return [];

  const points: DataModelPoint[] = [];

  for (const ptNode of children(ptLst, 'dgm:pt')) {
    const point = parsePoint(ptNode);
    if (point) {
      points.push(point);
    }
  }

  return points;
}

/**
 * Parse a single dgm:pt element into a DataModelPoint.
 */
function parsePoint(ptNode: XmlNode): DataModelPoint | null {
  const modelId = attr(ptNode, 'modelId');
  if (modelId === undefined) return null;

  // Parse type, defaulting to 'node' per OOXML spec
  const typeStr = attr(ptNode, 'type') ?? 'node';
  const type = VALID_POINT_TYPES.has(typeStr)
    ? (typeStr as PointTypeValue)
    : ('node' as PointTypeValue);

  // Parse connection ID (for transition points)
  const cxnId = attr(ptNode, 'cxnId');

  // Parse rich text (dgm:t)
  const tNode = child(ptNode, 'dgm:t');
  const text = parseRichText(tNode);

  // Parse property set (dgm:prSet)
  const prSetNode = child(ptNode, 'dgm:prSet');
  const properties = parsePropertySet(prSetNode);

  // Parse shape properties (dgm:spPr)
  const spPrNode = child(ptNode, 'dgm:spPr');
  const shapeProperties = parseShapeProperties(spPrNode);

  return {
    modelId: modelId as ModelId,
    type,
    text,
    properties,
    shapeProperties,
    cxnId: cxnId ? (cxnId as ModelId) : undefined,
  };
}

// =============================================================================
// Property Set Parsing
// =============================================================================

/**
 * Parse a dgm:prSet element into a PointPropertySet.
 */
function parsePropertySet(prSetNode: XmlNode | undefined): PointPropertySet | undefined {
  if (!prSetNode) return undefined;

  const result: PointPropertySet = {};

  // Boolean properties
  const phldr = boolAttr(prSetNode, 'phldr');
  if (phldr !== undefined) result.phldr = phldr;

  const custT = boolAttr(prSetNode, 'custT');
  if (custT !== undefined) result.custT = custT;

  const custFlipVert = boolAttr(prSetNode, 'custFlipVert');
  if (custFlipVert !== undefined) result.custFlipVert = custFlipVert;

  const custFlipHor = boolAttr(prSetNode, 'custFlipHor');
  if (custFlipHor !== undefined) result.custFlipHor = custFlipHor;

  const coherent3DOff = boolAttr(prSetNode, 'coherent3DOff');
  if (coherent3DOff !== undefined) result.coherent3DOff = coherent3DOff;

  // String properties
  const phldrT = attr(prSetNode, 'phldrT');
  if (phldrT !== undefined) result.phldrT = phldrT;

  const presName = attr(prSetNode, 'presName');
  if (presName !== undefined) result.presName = presName;

  const presStyleLbl = attr(prSetNode, 'presStyleLbl');
  if (presStyleLbl !== undefined) result.presStyleLbl = presStyleLbl;

  const loTypeId = attr(prSetNode, 'loTypeId');
  if (loTypeId !== undefined) result.loTypeId = loTypeId;

  const loCatId = attr(prSetNode, 'loCatId');
  if (loCatId !== undefined) result.loCatId = loCatId;

  const qsTypeId = attr(prSetNode, 'qsTypeId');
  if (qsTypeId !== undefined) result.qsTypeId = qsTypeId;

  const qsCatId = attr(prSetNode, 'qsCatId');
  if (qsCatId !== undefined) result.qsCatId = qsCatId;

  const csTypeId = attr(prSetNode, 'csTypeId');
  if (csTypeId !== undefined) result.csTypeId = csTypeId;

  const csCatId = attr(prSetNode, 'csCatId');
  if (csCatId !== undefined) result.csCatId = csCatId;

  // ModelId property
  const presAssocID = attr(prSetNode, 'presAssocID');
  if (presAssocID !== undefined) result.presAssocID = presAssocID as ModelId;

  // Numeric properties
  const custAng = numAttr(prSetNode, 'custAng');
  if (custAng !== undefined) result.custAng = custAng;

  const custSzX = numAttr(prSetNode, 'custSzX');
  if (custSzX !== undefined) result.custSzX = custSzX;

  const custSzY = numAttr(prSetNode, 'custSzY');
  if (custSzY !== undefined) result.custSzY = custSzY;

  const custRadScaleRad = numAttr(prSetNode, 'custRadScaleRad');
  if (custRadScaleRad !== undefined) result.custRadScaleRad = custRadScaleRad;

  const custRadScaleInc = numAttr(prSetNode, 'custRadScaleInc');
  if (custRadScaleInc !== undefined) result.custRadScaleInc = custRadScaleInc;

  const custLinFactX = numAttr(prSetNode, 'custLinFactX');
  if (custLinFactX !== undefined) result.custLinFactX = custLinFactX;

  const custLinFactY = numAttr(prSetNode, 'custLinFactY');
  if (custLinFactY !== undefined) result.custLinFactY = custLinFactY;

  const custLinFactNeighborX = numAttr(prSetNode, 'custLinFactNeighborX');
  if (custLinFactNeighborX !== undefined) result.custLinFactNeighborX = custLinFactNeighborX;

  const custLinFactNeighborY = numAttr(prSetNode, 'custLinFactNeighborY');
  if (custLinFactNeighborY !== undefined) result.custLinFactNeighborY = custLinFactNeighborY;

  const custScaleX = numAttr(prSetNode, 'custScaleX');
  if (custScaleX !== undefined) result.custScaleX = custScaleX;

  const custScaleY = numAttr(prSetNode, 'custScaleY');
  if (custScaleY !== undefined) result.custScaleY = custScaleY;

  const presStyleIdx = numAttr(prSetNode, 'presStyleIdx');
  if (presStyleIdx !== undefined) result.presStyleIdx = presStyleIdx;

  const presStyleCnt = numAttr(prSetNode, 'presStyleCnt');
  if (presStyleCnt !== undefined) result.presStyleCnt = presStyleCnt;

  return Object.keys(result).length > 0 ? result : undefined;
}

// =============================================================================
// Connection Parsing
// =============================================================================

/**
 * Parse all connections from a dgm:cxnLst element.
 */
function parseConnections(cxnLst: XmlNode | undefined): DataModelConnection[] {
  if (!cxnLst) return [];

  const connections: DataModelConnection[] = [];

  for (const cxnNode of children(cxnLst, 'dgm:cxn')) {
    const connection = parseConnection(cxnNode);
    if (connection) {
      connections.push(connection);
    }
  }

  return connections;
}

/**
 * Parse a single dgm:cxn element into a DataModelConnection.
 */
function parseConnection(cxnNode: XmlNode): DataModelConnection | null {
  const modelId = attr(cxnNode, 'modelId');
  const srcId = attr(cxnNode, 'srcId');
  const destId = attr(cxnNode, 'destId');

  if (modelId === undefined || srcId === undefined || destId === undefined) {
    return null;
  }

  const typeStr = attr(cxnNode, 'type') ?? 'parOf';
  const type = VALID_CONNECTION_TYPES.has(typeStr)
    ? (typeStr as ConnectionTypeValue)
    : ('unknownRelationship' as ConnectionTypeValue);

  const srcOrd = numAttr(cxnNode, 'srcOrd') ?? 0;
  const destOrd = numAttr(cxnNode, 'destOrd') ?? 0;
  const parTransId = attr(cxnNode, 'parTransId');
  const sibTransId = attr(cxnNode, 'sibTransId');
  const presId = attr(cxnNode, 'presId');

  return {
    modelId: modelId as ModelId,
    type,
    srcId: srcId as ModelId,
    destId: destId as ModelId,
    srcOrd,
    destOrd,
    parTransId: parTransId ? (parTransId as ModelId) : undefined,
    sibTransId: sibTransId ? (sibTransId as ModelId) : undefined,
    presId,
  };
}

// =============================================================================
// Background & Whole Parsing
// =============================================================================

/**
 * Parse dgm:bg (diagram background) element.
 */
function parseBackground(bgNode: XmlNode | undefined): DiagramBackground | undefined {
  if (!bgNode) return undefined;

  const fill = parseFill(bgNode);
  const effectLst = child(bgNode, 'a:effectLst');
  const effectList = parseEffectList(effectLst);

  if (!fill && !effectList) return undefined;

  return { fill, effectList };
}

/**
 * Parse dgm:whole (whole-document formatting) element.
 */
function parseWhole(wholeNode: XmlNode | undefined): DiagramWhole | undefined {
  if (!wholeNode) return undefined;

  const lnNode = child(wholeNode, 'a:ln');
  const line = parseLineProperties(lnNode);

  const effectLst = child(wholeNode, 'a:effectLst');
  const effectList = parseEffectList(effectLst);

  if (!line && !effectList) return undefined;

  return { line, effectList };
}
