import type { FloatingObjectHandleMutationReceipt } from '../../mutation-receipt';
import type { PictureConfig } from '../../types';
import type { PictureHandle } from '../handles/picture-handle';

export interface WorksheetPictureCollection {
  get(id: string): Promise<PictureHandle | null>;
  list(): Promise<PictureHandle[]>;
  add(config: PictureConfig): Promise<FloatingObjectHandleMutationReceipt<PictureHandle>>;
}
