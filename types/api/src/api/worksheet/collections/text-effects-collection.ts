import type {
  CreateTextEffectInput,
  TextEffectDefaults,
  TextEffectObjectConfig,
} from '../../types';
import type { TextEffectHandle } from '../handles/text-effects-handle';

export type { TextEffectDefaults, TextEffectObjectConfig } from '../../types';

export interface WorksheetTextEffectCollection {
  get(id: string): Promise<TextEffectHandle | null>;
  list(): Promise<TextEffectHandle[]>;
  add(config: CreateTextEffectInput): Promise<TextEffectHandle>;
  getDefaultConfig(): Promise<TextEffectObjectConfig>;
  getDefaults(): Promise<TextEffectDefaults>;
}
