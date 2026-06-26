export type FormulaAIExplainSource = 'typed' | 'active-cell';

export type FormulaAIContextCellValue = string | number | boolean | null;

export interface FormulaAIContextCell {
  readonly address: string;
  readonly value: FormulaAIContextCellValue;
}

export interface FormulaAIExplainContext {
  readonly documentId?: string;
  readonly workbookId?: string;
  readonly sheetId?: string;
  readonly sheetName?: string;
  readonly cellAddress?: string;
  readonly selectionRange?: string;
  readonly headers?: readonly string[];
  readonly nearbyCells?: readonly FormulaAIContextCell[];
}

export interface FormulaAIExplainRequest {
  readonly formula: string;
  readonly source: FormulaAIExplainSource;
  readonly context: FormulaAIExplainContext;
}

export interface FormulaAIExplainResult {
  /**
   * One plain-language sentence explaining what the formula does.
   */
  readonly explanation: string;
}

export interface FormulaAIRequestOptions {
  readonly signal?: AbortSignal;
}

export interface FormulaAIService {
  explainFormula(
    request: FormulaAIExplainRequest,
    options?: FormulaAIRequestOptions,
  ): Promise<FormulaAIExplainResult> | FormulaAIExplainResult;
}
