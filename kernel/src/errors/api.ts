/**
 * API Error Factories
 *
 * Factory functions that return KernelError instances with structured codes.
 * Context objects are shaped to match MogSdkErrorDetailsMap interfaces so that
 * `toMogSdkError()` produces typed details without transformation.
 *
 */

import { KernelError } from './kernel-error';

type OperationFailedOptions = {
  readonly cause?: unknown;
};

/**
 * Create an invalid cell address error
 */
export function invalidCellAddress(row: number, col: number): KernelError {
  return new KernelError('API_INVALID_CELL_ADDRESS', `Cell address (${row}, ${col}) is invalid`, {
    path: ['row', 'col'],
    suggestion: 'Row and column must be >= 0',
    context: { paramName: 'address', expected: 'row >= 0, col >= 0', row, col },
  });
}

/**
 * Create an invalid range error
 */
export function invalidRange(
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
): KernelError {
  return new KernelError(
    'API_INVALID_RANGE',
    `Range (${startRow}, ${startCol}) to (${endRow}, ${endCol}) is invalid`,
    {
      path: ['startRow', 'startCol', 'endRow', 'endCol'],
      suggestion: 'Start must be <= end, and all values must be >= 0',
      context: {
        paramName: 'range',
        expected: 'start <= end, all >= 0',
        startRow,
        startCol,
        endRow,
        endCol,
      },
    },
  );
}

/**
 * Create a sheet not found error
 */
export function sheetNotFound(sheetId: string): KernelError {
  return new KernelError('API_SHEET_NOT_FOUND', `Sheet "${sheetId}" not found`, {
    path: ['sheetId'],
    suggestion: 'Use getSheetIds() to list available sheets',
    context: { resourceType: 'sheet', resourceId: sheetId },
  });
}

/**
 * Create an invalid sheet ID error
 */
export function invalidSheetId(sheetId: string): KernelError {
  return new KernelError('API_INVALID_SHEET_ID', `Sheet ID "${sheetId}" is invalid`, {
    path: ['sheetId'],
    suggestion: 'Sheet ID must be a non-empty string',
    context: { paramName: 'sheetId', expected: 'non-empty string', received: sheetId },
  });
}

/**
 * Create a sheet name exists error
 */
export function sheetNameExists(name: string): KernelError {
  return new KernelError('API_SHEET_NAME_EXISTS', `A sheet named "${name}" already exists`, {
    path: ['name'],
    suggestion: 'Choose a different sheet name',
    context: { resourceType: 'sheet', resourceName: name },
  });
}

/**
 * Create a formula parse error
 */
export function formulaParseError(formula: string, errorMessage: string): KernelError {
  return new KernelError('FORMULA_PARSE_ERROR', `Failed to parse formula: ${errorMessage}`, {
    path: ['formula'],
    suggestion: 'Check formula syntax. Formulas must start with "="',
    context: { formula, parseError: errorMessage },
  });
}

/**
 * Create a circular reference error
 */
export function circularReference(cellAddress: string, dependencyChain: string[]): KernelError {
  return new KernelError(
    'FORMULA_CIRCULAR_REFERENCE',
    `Circular reference detected at ${cellAddress}`,
    {
      path: ['formula'],
      suggestion: 'Remove the circular dependency from the formula',
      context: { cellAddress, dependencyChain },
    },
  );
}

/**
 * Create an unknown function error
 */
export function unknownFunction(functionName: string): KernelError {
  return new KernelError('FORMULA_UNKNOWN_FUNCTION', `Unknown function: ${functionName}`, {
    path: ['formula'],
    suggestion: 'Use getFunctionCatalog() to list available functions',
    context: { functionName },
  });
}

/**
 * Create a protected workbook error (structure operations blocked)
 */
export function protectedWorkbook(operation: string): KernelError {
  return new KernelError(
    'API_PROTECTED_WORKBOOK',
    `Cannot ${operation}: workbook structure is protected`,
    {
      path: ['workbook'],
      suggestion: 'Unprotect the workbook before modifying sheet structure',
      context: { operation },
    },
  );
}

/**
 * Create a protected range error
 */
export function protectedRange(range: string): KernelError {
  return new KernelError('API_PROTECTED_RANGE', `Cannot modify protected range: ${range}`, {
    path: ['range'],
    suggestion: 'Unprotect the range before modifying',
    context: { range },
  });
}

/**
 * Create a row out of bounds error
 */
export function rowOutOfBounds(row: number, maxRow: number): KernelError {
  return new KernelError('API_ROW_OUT_OF_BOUNDS', `Row ${row} is out of bounds (max: ${maxRow})`, {
    path: ['row'],
    suggestion: `Row must be between 0 and ${maxRow}`,
    context: { paramName: 'row', expected: `0..${maxRow}`, row, maxRow },
  });
}

/**
 * Create a column out of bounds error
 */
export function columnOutOfBounds(col: number, maxCol: number): KernelError {
  return new KernelError(
    'API_COLUMN_OUT_OF_BOUNDS',
    `Column ${col} is out of bounds (max: ${maxCol})`,
    {
      path: ['col'],
      suggestion: `Column must be between 0 and ${maxCol}`,
      context: { paramName: 'col', expected: `0..${maxCol}`, col, maxCol },
    },
  );
}

/**
 * Create a generic operation failed error
 */
export function operationFailed(
  operation: string,
  reason: string,
  options?: OperationFailedOptions,
): KernelError {
  return new KernelError('OPERATION_FAILED', `Operation "${operation}" failed: ${reason}`, {
    context: { operation, reason },
    ...(options && 'cause' in options ? { cause: options.cause } : {}),
  });
}

/**
 * Create a not implemented error
 */
export function notImplemented(feature: string): KernelError {
  return new KernelError('NOT_IMPLEMENTED', `Feature not yet implemented: ${feature}`, {
    context: { feature },
  });
}

/**
 * Create a chart not found error
 */
export function chartNotFound(chartId: string): KernelError {
  return new KernelError('OBJ_CHART_NOT_FOUND', `Chart "${chartId}" not found`, {
    path: ['chartId'],
    suggestion:
      'Use ws.charts.list() to list available charts, or api.describe("ws.charts") for chart API discovery',
    context: { resourceType: 'chart', resourceId: chartId },
  });
}

/**
 * Create an invalid chart config error
 */
export function invalidChartConfig(reason: string): KernelError {
  return new KernelError('OBJ_CHART_INVALID_CONFIG', `Invalid chart configuration: ${reason}`, {
    path: ['config'],
    suggestion: 'Check chart type, dataRange, and position are valid',
    context: { reason },
  });
}

/**
 * Create a shape not found error
 */
export function shapeNotFound(shapeId: string): KernelError {
  return new KernelError('OBJ_SHAPE_NOT_FOUND', `Shape "${shapeId}" not found`, {
    path: ['shapeId'],
    suggestion: 'Use getShapes() to list available shapes',
    context: { resourceType: 'shape', resourceId: shapeId },
  });
}

/**
 * Create an equation not found error
 */
export function equationNotFound(equationId: string): KernelError {
  return new KernelError('OBJ_EQUATION_NOT_FOUND', `Equation "${equationId}" not found`, {
    path: ['equationId'],
    suggestion: 'Verify the equation ID is correct',
    context: { resourceType: 'equation', resourceId: equationId },
  });
}

/**
 * Create a floating object not found error
 */
export function objectNotFound(objectId: string): KernelError {
  return new KernelError('OBJ_NOT_FOUND', `Floating object "${objectId}" not found`, {
    path: ['objectId'],
    suggestion: 'Use listFloatingObjects() to list available objects',
    context: { resourceType: 'floatingObject', resourceId: objectId },
  });
}

/**
 * Create a TextEffect not found error
 */
export function textEffectNotFound(textEffectId: string): KernelError {
  return new KernelError('OBJ_TEXT_EFFECT_NOT_FOUND', `TextEffect "${textEffectId}" not found`, {
    path: ['textEffectId'],
    suggestion: 'Verify the TextEffect ID is correct',
    context: { resourceType: 'text-effects', resourceId: textEffectId },
  });
}

/**
 * Create a Diagram not found error
 */
export function diagramNotFound(diagramId: string): KernelError {
  return new KernelError('OBJ_DIAGRAM_NOT_FOUND', `Diagram "${diagramId}" not found`, {
    path: ['diagramId'],
    suggestion: 'Use getDiagram() to verify the Diagram ID',
    context: { resourceType: 'diagram', resourceId: diagramId },
  });
}

/**
 * Create a drawing not found error
 */
export function drawingNotFound(drawingId: string): KernelError {
  return new KernelError('OBJ_DRAWING_NOT_FOUND', `Drawing "${drawingId}" not found`, {
    path: ['drawingId'],
    suggestion: 'Verify the drawing ID is correct',
    context: { resourceType: 'drawing', resourceId: drawingId },
  });
}

/**
 * Create an invalid shape config error
 */
export function invalidShapeConfig(reason: string): KernelError {
  return new KernelError('OBJ_SHAPE_INVALID_CONFIG', `Invalid shape configuration: ${reason}`, {
    path: ['config'],
    suggestion: 'Check shape type and position are valid',
    context: { reason },
  });
}
