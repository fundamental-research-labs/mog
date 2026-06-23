import { WorksheetImpl } from '../../worksheet/worksheet-impl';
import { createBridgeFixture } from './version-operation-context-helpers-bridge';
import { SHEET_ID } from './version-operation-context-helpers-constants';

export function createWorksheetFixture() {
  const bridgeFixture = createBridgeFixture();
  const worksheet = new WorksheetImpl(SHEET_ID, bridgeFixture.ctx as any, {
    name: 'Sheet1',
    index: 0,
  });
  return { ...bridgeFixture, worksheet };
}
