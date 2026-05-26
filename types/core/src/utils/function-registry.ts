/**
 * Function Registry -- Lightweight metadata registry for Excel functions.
 *
 * Types remain here in contracts.
 *
 * Migrated from @mog/calculator.
 */

// =============================================================================
// Types (stay in contracts)
// =============================================================================

export type FunctionArgumentType =
  | 'number'
  | 'text'
  | 'logical'
  | 'reference'
  | 'array'
  | 'any'
  | 'date';

export interface FunctionArgument {
  name: string;
  description: string;
  type: FunctionArgumentType;
  optional: boolean;
  repeating?: boolean;
}

export interface FunctionMetadata {
  name: string;
  category: FunctionCategory;
  description: string;
  minArgs?: number;
  maxArgs?: number;
  isVolatile?: boolean;
  arguments?: FunctionArgument[];
}

export enum FunctionCategory {
  MATH = 'Math',
  STATISTICAL = 'Statistical',
  TEXT = 'Text',
  LOGICAL = 'Logical',
  DATE_TIME = 'Date & Time',
  LOOKUP = 'Lookup & Reference',
  FINANCIAL = 'Financial',
  INFORMATION = 'Information',
  DATABASE = 'Database',
  ENGINEERING = 'Engineering',
  WEB = 'Web',
  TESTING = 'Testing',
}
