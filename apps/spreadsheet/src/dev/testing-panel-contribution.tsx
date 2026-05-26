import type React from 'react';

import { registerSpreadsheetPanelContribution } from '../chrome/layers/panel-contributions';
import { TestPanel } from '../components/testing/TestPanel';
import { useUIStore } from '../infra/context';

function SpreadsheetTestingPanelContribution(): React.JSX.Element | null {
  const showTestPanel = useUIStore((state) => state.showTestPanel);
  const hideTestPanel = useUIStore((state) => state.hideTestPanelAction);

  if (!showTestPanel) return null;

  return <TestPanel position="bottom-right" onClose={hideTestPanel} />;
}

export function registerSpreadsheetTestingPanel(): () => void {
  return registerSpreadsheetPanelContribution({
    id: 'dev.testing',
    order: -100,
    Component: SpreadsheetTestingPanelContribution,
  });
}
