/**
 * Tests for CapabilityConsentDialog
 *
 */

import * as RadixTooltip from '@radix-ui/react-tooltip';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { CAPABILITY_REGISTRY } from '@mog-sdk/kernel/security';
import type {
  AppManifestWithCapabilities,
  CapabilityInfo,
  CapabilityType,
} from '@mog-sdk/contracts/capabilities';
import {
  CapabilityConsentDialog,
  RuntimeConsentDialog,
  type ConsentDialogProps,
} from '../CapabilityConsentDialog';

// =============================================================================
// Test Wrapper
// =============================================================================

/**
 * Wrapper component that provides TooltipProvider context required by Tooltip components
 */
function TestWrapper({ children }: { children: React.ReactNode }) {
  return <RadixTooltip.Provider>{children}</RadixTooltip.Provider>;
}

/**
 * Custom render function that wraps components with required providers
 */
function renderWithProviders(ui: React.ReactElement) {
  return render(<TestWrapper>{ui}</TestWrapper>);
}

// =============================================================================
// Test Fixtures
// =============================================================================

function createTestManifest(
  overrides: Partial<AppManifestWithCapabilities> = {},
): AppManifestWithCapabilities {
  return {
    id: 'test-app',
    name: 'Test App',
    version: '1.0.0',
    icon: '📱',
    description: 'A test application',
    author: 'Test Author',
    capabilities: {
      required: ['cells:read'],
    },
    ...overrides,
  };
}

function getCapabilityInfos(capabilities: CapabilityType[]): CapabilityInfo[] {
  return capabilities.map((cap) => CAPABILITY_REGISTRY[cap]);
}

// =============================================================================
// Tests
// =============================================================================

describe('CapabilityConsentDialog', () => {
  const defaultProps: ConsentDialogProps = {
    open: true,
    onClose: jest.fn(),
    appManifest: createTestManifest(),
    requiredCapabilities: getCapabilityInfos(['cells:read']),
    optionalCapabilities: [],
    onAllow: jest.fn(),
    onDeny: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('rendering', () => {
    it('should render app name and icon', () => {
      renderWithProviders(<CapabilityConsentDialog {...defaultProps} />);

      expect(screen.getByText('Test App')).toBeInTheDocument();
      expect(screen.getByText('📱')).toBeInTheDocument();
    });

    it('should render required capabilities section', () => {
      renderWithProviders(<CapabilityConsentDialog {...defaultProps} />);

      expect(screen.getByText('Required permissions')).toBeInTheDocument();
      expect(screen.getByText('Read Cells')).toBeInTheDocument();
    });

    it('should render optional capabilities when provided', () => {
      const props: ConsentDialogProps = {
        ...defaultProps,
        optionalCapabilities: [
          {
            info: CAPABILITY_REGISTRY['filesystem:write'],
            capability: 'filesystem:write',
            reason: 'To save exports',
          },
        ],
      };

      renderWithProviders(<CapabilityConsentDialog {...props} />);

      expect(screen.getByText('Optional permissions')).toBeInTheDocument();
      expect(screen.getByText('Write Files')).toBeInTheDocument();
      expect(screen.getByText(/To save exports/i)).toBeInTheDocument();
    });

    it('should render warning banner for sensitive capabilities', () => {
      const props: ConsentDialogProps = {
        ...defaultProps,
        requiredCapabilities: getCapabilityInfos(['credentials:use']),
      };

      renderWithProviders(<CapabilityConsentDialog {...props} />);

      expect(screen.getByText('Sensitive permissions requested')).toBeInTheDocument();
    });

    it('should render app description when provided', () => {
      renderWithProviders(<CapabilityConsentDialog {...defaultProps} />);

      expect(screen.getByText(/A test application/)).toBeInTheDocument();
    });

    it('should render "Remember my choice" checkbox', () => {
      renderWithProviders(<CapabilityConsentDialog {...defaultProps} />);

      expect(screen.getByText('Remember my choice')).toBeInTheDocument();
    });
  });

  describe('interactions', () => {
    it('should call onAllow with required capabilities when Allow is clicked', async () => {
      const onAllow = jest.fn();
      const props: ConsentDialogProps = {
        ...defaultProps,
        onAllow,
      };

      renderWithProviders(<CapabilityConsentDialog {...props} />);

      const allowButton = screen.getByRole('button', { name: /Allow/i });
      await userEvent.click(allowButton);

      expect(onAllow).toHaveBeenCalledWith(expect.arrayContaining(['cells:read']));
    });

    it('should call onDeny when Deny is clicked', async () => {
      const onDeny = jest.fn();
      const props: ConsentDialogProps = {
        ...defaultProps,
        onDeny,
      };

      renderWithProviders(<CapabilityConsentDialog {...props} />);

      const denyButton = screen.getByRole('button', { name: /Deny/i });
      await userEvent.click(denyButton);

      expect(onDeny).toHaveBeenCalled();
    });

    it('should call onClose when dialog is closed', async () => {
      const onClose = jest.fn();
      const props: ConsentDialogProps = {
        ...defaultProps,
        onClose,
      };

      renderWithProviders(<CapabilityConsentDialog {...props} />);

      // Click the close button (X)
      const closeButton = screen.getByRole('button', { name: /Close/i });
      await userEvent.click(closeButton);

      expect(onClose).toHaveBeenCalled();
    });

    it('should include selected optional capabilities in onAllow', async () => {
      const onAllow = jest.fn();
      const props: ConsentDialogProps = {
        ...defaultProps,
        optionalCapabilities: [
          {
            info: CAPABILITY_REGISTRY['filesystem:write'],
            capability: 'filesystem:write',
            reason: 'To save exports',
          },
        ],
        onAllow,
      };

      renderWithProviders(<CapabilityConsentDialog {...props} />);

      // Optional capabilities are selected by default
      const allowButton = screen.getByRole('button', { name: /Allow/i });
      await userEvent.click(allowButton);

      expect(onAllow).toHaveBeenCalledWith(
        expect.arrayContaining(['cells:read', 'filesystem:write']),
      );
    });

    it('should exclude deselected optional capabilities from onAllow', async () => {
      const onAllow = jest.fn();
      const props: ConsentDialogProps = {
        ...defaultProps,
        optionalCapabilities: [
          {
            info: CAPABILITY_REGISTRY['filesystem:write'],
            capability: 'filesystem:write',
            reason: 'To save exports',
          },
        ],
        onAllow,
      };

      renderWithProviders(<CapabilityConsentDialog {...props} />);

      // Find and click the optional capability checkbox to deselect it
      const checkboxes = screen.getAllByRole('checkbox');
      // The first checkbox is "Remember my choice", the second is the optional capability
      await userEvent.click(checkboxes[0]);

      const allowButton = screen.getByRole('button', { name: /Allow/i });
      await userEvent.click(allowButton);

      // Should only include required capabilities
      const calledWith = onAllow.mock.calls[0][0];
      expect(calledWith).toContain('cells:read');
      expect(calledWith).not.toContain('filesystem:write');
    });
  });

  describe('button styling', () => {
    it('should show danger variant for Allow when sensitive', () => {
      const props: ConsentDialogProps = {
        ...defaultProps,
        requiredCapabilities: getCapabilityInfos(['credentials:use']),
      };

      renderWithProviders(<CapabilityConsentDialog {...props} />);

      // The button text changes to "Allow Anyway" for sensitive permissions
      expect(screen.getByRole('button', { name: /Allow Anyway/i })).toBeInTheDocument();
    });
  });
});

describe('RuntimeConsentDialog', () => {
  const defaultProps = {
    open: true,
    onClose: jest.fn(),
    appName: 'Test App',
    appIcon: '📱',
    capability: 'filesystem:write' as CapabilityType,
    reason: 'To save the exported file',
    onAllow: jest.fn(),
    onDeny: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render app name', () => {
    renderWithProviders(<RuntimeConsentDialog {...defaultProps} />);

    expect(screen.getByText('Test App')).toBeInTheDocument();
  });

  it('should render capability info', () => {
    renderWithProviders(<RuntimeConsentDialog {...defaultProps} />);

    expect(screen.getByText('Write Files')).toBeInTheDocument();
  });

  it('should render reason', () => {
    renderWithProviders(<RuntimeConsentDialog {...defaultProps} />);

    expect(screen.getByText(/To save the exported file/)).toBeInTheDocument();
  });

  it('should call onAllow when Allow is clicked', async () => {
    const onAllow = jest.fn();
    renderWithProviders(<RuntimeConsentDialog {...defaultProps} onAllow={onAllow} />);

    const allowButton = screen.getByRole('button', { name: /Allow/i });
    await userEvent.click(allowButton);

    expect(onAllow).toHaveBeenCalled();
  });

  it('should call onDeny when Deny is clicked', async () => {
    const onDeny = jest.fn();
    renderWithProviders(<RuntimeConsentDialog {...defaultProps} onDeny={onDeny} />);

    const denyButton = screen.getByRole('button', { name: /Deny/i });
    await userEvent.click(denyButton);

    expect(onDeny).toHaveBeenCalled();
  });

  it('should show warning for sensitive capabilities', () => {
    renderWithProviders(<RuntimeConsentDialog {...defaultProps} capability="credentials:use" />);

    expect(screen.getByText('Sensitive permission')).toBeInTheDocument();
  });
});
