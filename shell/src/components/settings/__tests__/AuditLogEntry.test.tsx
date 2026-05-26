/**
 * AuditLogEntry Component Tests
 *
 * Tests for the audit log entry display component.
 */

import '@testing-library/jest-dom';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import type { CapabilityAuditEntry } from '@mog-sdk/kernel/security';

import { AuditLogEntry } from '../AuditLogEntry';

// =============================================================================
// Test Helpers
// =============================================================================

function createTestEntry(overrides: Partial<CapabilityAuditEntry> = {}): CapabilityAuditEntry {
  return {
    id: 'audit-1',
    timestamp: Date.now(),
    appId: 'test-app' as any,
    capability: 'cells:read' as any,
    eventType: 'used',
    ...overrides,
  };
}

// =============================================================================
// Setup / Teardown
// =============================================================================

afterEach(() => {
  cleanup();
});

// =============================================================================
// Rendering Tests
// =============================================================================

describe('AuditLogEntry - Rendering', () => {
  it('renders event type badge', () => {
    render(<AuditLogEntry entry={createTestEntry({ eventType: 'granted' })} />);

    expect(screen.getByText('Granted')).toBeInTheDocument();
  });

  it('renders capability name', () => {
    render(<AuditLogEntry entry={createTestEntry({ capability: 'tables:write' as any })} />);

    expect(screen.getByText('tables:write')).toBeInTheDocument();
  });

  it('renders app ID', () => {
    render(<AuditLogEntry entry={createTestEntry({ appId: 'my-app' as any })} />);

    expect(screen.getByText('my-app')).toBeInTheDocument();
  });

  it('renders timestamp', () => {
    const entry = createTestEntry({ timestamp: Date.now() });
    render(<AuditLogEntry entry={entry} />);

    // Should show "Just now" for recent timestamps
    expect(screen.getByText('Just now')).toBeInTheDocument();
  });
});

// =============================================================================
// Event Type Styling Tests
// =============================================================================

describe('AuditLogEntry - Event Type Styling', () => {
  it('renders granted events with green styling', () => {
    render(<AuditLogEntry entry={createTestEntry({ eventType: 'granted' })} />);

    const badge = screen.getByText('Granted');
    expect(badge).toHaveClass('bg-green-100');
    expect(badge).toHaveClass('text-green-700');
  });

  it('renders denied events with red styling', () => {
    render(<AuditLogEntry entry={createTestEntry({ eventType: 'denied' })} />);

    const badge = screen.getByText('Denied');
    expect(badge).toHaveClass('bg-red-100');
    expect(badge).toHaveClass('text-red-700');
  });

  it('renders revoked events with orange styling', () => {
    render(<AuditLogEntry entry={createTestEntry({ eventType: 'revoked' })} />);

    const badge = screen.getByText('Revoked');
    expect(badge).toHaveClass('bg-orange-100');
    expect(badge).toHaveClass('text-orange-700');
  });

  it('renders used events with blue styling', () => {
    render(<AuditLogEntry entry={createTestEntry({ eventType: 'used' })} />);

    const badge = screen.getByText('Used');
    expect(badge).toHaveClass('bg-blue-100');
    expect(badge).toHaveClass('text-blue-700');
  });

  it('renders expired events with gray styling', () => {
    render(<AuditLogEntry entry={createTestEntry({ eventType: 'expired' })} />);

    const badge = screen.getByText('Expired');
    expect(badge).toHaveClass('bg-gray-100');
    expect(badge).toHaveClass('text-gray-600');
  });

  it('renders auto-granted events', () => {
    render(<AuditLogEntry entry={createTestEntry({ eventType: 'auto-granted' })} />);

    expect(screen.getByText('Auto-granted')).toBeInTheDocument();
  });
});

// =============================================================================
// Expansion Tests
// =============================================================================

describe('AuditLogEntry - Expansion', () => {
  it('does not show details when not expanded', () => {
    render(
      <AuditLogEntry
        entry={createTestEntry({
          operation: 'getValue',
          resourceType: 'cell',
          resourceId: 'A1',
        })}
        expanded={false}
      />,
    );

    expect(screen.queryByText('Operation:')).not.toBeInTheDocument();
    expect(screen.queryByText('Resource:')).not.toBeInTheDocument();
  });

  it('shows operation when expanded', () => {
    render(<AuditLogEntry entry={createTestEntry({ operation: 'getValue' })} expanded={true} />);

    expect(screen.getByText('Operation:')).toBeInTheDocument();
    expect(screen.getByText('getValue')).toBeInTheDocument();
  });

  it('shows resource when expanded', () => {
    render(
      <AuditLogEntry
        entry={createTestEntry({
          resourceType: 'table',
          resourceId: 'contacts',
        })}
        expanded={true}
      />,
    );

    expect(screen.getByText('Resource:')).toBeInTheDocument();
    expect(screen.getByText('table:contacts')).toBeInTheDocument();
  });

  it('shows metadata when expanded', () => {
    render(
      <AuditLogEntry
        entry={createTestEntry({
          metadata: { reason: 'user-request' },
        })}
        expanded={true}
      />,
    );

    expect(screen.getByText('Details:')).toBeInTheDocument();
  });

  it('does not show details section for entries without details', () => {
    render(<AuditLogEntry entry={createTestEntry()} expanded={true} />);

    expect(screen.queryByText('Operation:')).not.toBeInTheDocument();
    expect(screen.queryByText('Resource:')).not.toBeInTheDocument();
    expect(screen.queryByText('Details:')).not.toBeInTheDocument();
  });
});

// =============================================================================
// Click Handling Tests
// =============================================================================

describe('AuditLogEntry - Click Handling', () => {
  it('calls onClick when clicked', () => {
    const handleClick = jest.fn();

    render(<AuditLogEntry entry={createTestEntry()} onClick={handleClick} />);

    fireEvent.click(screen.getByRole('button'));

    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('does not have button role when no onClick', () => {
    render(<AuditLogEntry entry={createTestEntry()} />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('calls onClick on Enter key', () => {
    const handleClick = jest.fn();

    render(<AuditLogEntry entry={createTestEntry()} onClick={handleClick} />);

    const element = screen.getByRole('button');
    fireEvent.keyDown(element, { key: 'Enter' });

    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('has correct cursor style when clickable', () => {
    const handleClick = jest.fn();

    render(<AuditLogEntry entry={createTestEntry()} onClick={handleClick} />);

    const element = screen.getByRole('button');
    expect(element).toHaveClass('cursor-pointer');
  });
});

// =============================================================================
// Timestamp Formatting Tests
// =============================================================================

describe('AuditLogEntry - Timestamp Formatting', () => {
  it('shows "Just now" for very recent entries', () => {
    render(<AuditLogEntry entry={createTestEntry({ timestamp: Date.now() })} />);

    expect(screen.getByText('Just now')).toBeInTheDocument();
  });

  it('shows minutes ago for entries less than 1 hour old', () => {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    render(<AuditLogEntry entry={createTestEntry({ timestamp: fiveMinutesAgo })} />);

    expect(screen.getByText('5m ago')).toBeInTheDocument();
  });

  it('shows hours ago for entries less than 24 hours old', () => {
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    render(<AuditLogEntry entry={createTestEntry({ timestamp: twoHoursAgo })} />);

    expect(screen.getByText('2h ago')).toBeInTheDocument();
  });

  it('shows full timestamp in title attribute', () => {
    const timestamp = Date.now();
    render(<AuditLogEntry entry={createTestEntry({ timestamp })} />);

    const timestampElement = screen.getByText('Just now');
    expect(timestampElement).toHaveAttribute('title');
    expect(timestampElement.title).toContain('2026'); // Current year in test
  });
});
