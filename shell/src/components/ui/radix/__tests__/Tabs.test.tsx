import '@testing-library/jest-dom';

import { useState } from 'react';

import { act, render, screen } from '@testing-library/react';

import { TabPanel, Tabs } from '../Tabs';

function ControlledTabsHarness() {
  const [activeTab, setActiveTab] = useState('page');

  return (
    <Tabs
      tabs={[
        { id: 'page', label: 'Page' },
        { id: 'margins', label: 'Margins' },
      ]}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      ariaLabel="Page setup"
    >
      <TabPanel tabId="page">Page panel</TabPanel>
      <TabPanel tabId="margins">Margins panel</TabPanel>
    </Tabs>
  );
}

describe('Tabs (Radix wrapper)', () => {
  it('activates a tab from a native HTMLElement.click() event', () => {
    render(<ControlledTabsHarness />);

    const marginsTab = screen.getByRole('tab', { name: 'Margins' });
    expect(marginsTab).toHaveAttribute('data-state', 'inactive');

    act(() => {
      marginsTab.click();
    });

    expect(marginsTab).toHaveAttribute('data-state', 'active');
    expect(screen.getByText('Margins panel')).toBeInTheDocument();
  });
});
