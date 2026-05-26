import '@testing-library/jest-dom';

import { render, screen } from '@testing-library/react';

import { PortalContainerProvider } from '../PortalContainerContext';

describe('PortalContainerProvider', () => {
  it('keeps the full-screen portal host pointer-transparent', () => {
    render(
      <PortalContainerProvider>
        <div>App content</div>
      </PortalContainerProvider>,
    );

    expect(screen.getByText('App content')).toBeInTheDocument();
    expect(document.querySelector('[data-mog-engine=""]')).toHaveStyle({
      pointerEvents: 'none',
    });
  });
});
