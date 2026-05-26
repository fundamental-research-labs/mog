import type { EquationConfig, EquationDefaults, EquationStyle } from '../../types';
import type { EquationHandle } from '../handles/equation-handle';

export type { EquationDefaults, EquationStyle } from '../../types';

export interface WorksheetEquationCollection {
  get(id: string): Promise<EquationHandle | null>;
  list(): Promise<EquationHandle[]>;
  add(config: EquationConfig): Promise<EquationHandle>;
  getDefaultStyle(): Promise<EquationStyle>;
  getDefaults(): Promise<EquationDefaults>;
}
