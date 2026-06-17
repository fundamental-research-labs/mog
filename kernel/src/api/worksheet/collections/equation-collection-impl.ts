import type {
  EquationConfig,
  EquationDefaults,
  EquationHandle,
  EquationStyle,
  FloatingObjectHandleMutationReceipt,
  WorksheetEquationCollection,
} from '@mog-sdk/contracts/api';
import type { IObjectBoundsReader } from '@mog-sdk/contracts/objects/object-bounds-reader';

import { getEquationStyleDefaults } from '../../../domain/equations/equation-defaults';
import { DEFAULT_EQUATION_HEIGHT, DEFAULT_EQUATION_WIDTH } from '../operations/equation-operations';
import type { WorksheetObjectsImpl } from '../objects';
import { attachFloatingObjectHandle } from '../objects-receipts';
import { EquationHandleImpl } from '../handles/equation-handle-impl';

export class WorksheetEquationCollectionImpl implements WorksheetEquationCollection {
  constructor(
    private readonly objectsImpl: WorksheetObjectsImpl,
    private readonly boundsReader: IObjectBoundsReader | null,
  ) {}

  async get(id: string): Promise<EquationHandle | null> {
    const info = await this.objectsImpl.get(id);
    if (!info || info.type !== 'equation') return null;
    return new EquationHandleImpl(id, this.objectsImpl, this.boundsReader);
  }

  async list(): Promise<EquationHandle[]> {
    const infos = await this.objectsImpl.list();
    return infos
      .filter((info) => info.type === 'equation')
      .map((info) => new EquationHandleImpl(info.id, this.objectsImpl, this.boundsReader));
  }

  async add(config: EquationConfig): Promise<FloatingObjectHandleMutationReceipt<EquationHandle>> {
    const receipt = await this.objectsImpl.addEquation(config);
    const handle = new EquationHandleImpl(receipt.id, this.objectsImpl, this.boundsReader);
    return attachFloatingObjectHandle(receipt, handle);
  }

  async getDefaultStyle(): Promise<EquationStyle> {
    return getEquationStyleDefaults();
  }

  async getDefaults(): Promise<EquationDefaults> {
    return {
      style: await this.getDefaultStyle(),
      width: DEFAULT_EQUATION_WIDTH,
      height: DEFAULT_EQUATION_HEIGHT,
    };
  }
}
