import type { FloatingObjectHandleMutationReceipt } from '../../mutation-receipt';
import type { TextBoxConfig } from '../../types';
import type { TextBoxHandle } from '../handles/textbox-handle';

export interface WorksheetTextBoxCollection {
  get(id: string): Promise<TextBoxHandle | null>;
  list(): Promise<TextBoxHandle[]>;
  add(config: TextBoxConfig): Promise<FloatingObjectHandleMutationReceipt<TextBoxHandle>>;
}
