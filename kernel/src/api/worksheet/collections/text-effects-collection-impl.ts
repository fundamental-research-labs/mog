import type {
  CreateTextEffectInput,
  TextEffectDefaults,
  TextEffectHandle,
  TextEffectObjectConfig,
  WorksheetTextEffectCollection,
} from '@mog-sdk/contracts/api';
import type { IObjectBoundsReader } from '@mog-sdk/contracts/objects/object-bounds-reader';

import type { WorksheetObjectsImpl } from '../objects';
import {
  createDefaultApiTextEffectConfig,
  DEFAULT_TEXT_EFFECT_HEIGHT,
  DEFAULT_TEXT_EFFECT_WIDTH,
} from '../operations/text-effects-operations';
import { TextEffectHandleImpl } from '../handles/text-effects-handle-impl';

export class WorksheetTextEffectCollectionImpl implements WorksheetTextEffectCollection {
  constructor(
    private readonly objectsImpl: WorksheetObjectsImpl,
    private readonly boundsReader: IObjectBoundsReader | null,
  ) {}

  async get(id: string): Promise<TextEffectHandle | null> {
    const info = await this.objectsImpl.get(id);
    if (!info) return null;
    if (info.type !== 'text-effects') return null;
    return new TextEffectHandleImpl(id, this.objectsImpl, this.boundsReader);
  }

  async list(): Promise<TextEffectHandle[]> {
    const infos = await this.objectsImpl.list();
    return infos
      .filter((info) => info.type === 'text-effects')
      .map((info) => new TextEffectHandleImpl(info.id, this.objectsImpl, this.boundsReader));
  }

  async add(config: CreateTextEffectInput): Promise<TextEffectHandle> {
    const id = await this.objectsImpl.addTextEffect(config);
    return new TextEffectHandleImpl(id, this.objectsImpl, this.boundsReader);
  }

  async getDefaultConfig(): Promise<TextEffectObjectConfig> {
    return createDefaultApiTextEffectConfig();
  }

  async getDefaults(): Promise<TextEffectDefaults> {
    return {
      config: await this.getDefaultConfig(),
      width: DEFAULT_TEXT_EFFECT_WIDTH,
      height: DEFAULT_TEXT_EFFECT_HEIGHT,
    };
  }
}
