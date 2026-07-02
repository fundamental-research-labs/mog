import { jest } from '@jest/globals';
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

type Status = 'fresh' | 'stale' | 'unchecked';

function makeRecord(text: string, status: Status): any {
  return {
    schemaVersion: 1,
    id: 'ann-1',
    anchorId: 'cell-1',
    text,
    status,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  };
}

const mockDiagGet = jest.fn<(...args: any[]) => Promise<any>>();
const mockSet = jest.fn<(...args: any[]) => Promise<any>>();
const mockRemove = jest.fn<(...args: any[]) => Promise<any>>();
const mockAcceptStale = jest.fn<(...args: any[]) => Promise<any>>();

const mockWorksheet = {
  annotations: {
    cells: {
      diagnostics: { get: mockDiagGet },
      set: mockSet,
      remove: mockRemove,
      acceptStale: mockAcceptStale,
    },
  },
};
const mockWorkbook = {
  getSheetById: jest.fn(() => mockWorksheet),
  on: jest.fn(() => jest.fn()),
};
let mockReadOnly = false;

jest.unstable_mockModule('../../../internal-api', () => ({
  useWorkbook: () => mockWorkbook,
  useActiveSheetId: () => 'sheet-1',
  useActiveCell: () => ({ row: 2, col: 3 }),
  useReadOnly: () => mockReadOnly,
}));

const { AnnotationBar } = await import('../AnnotationBar');

beforeEach(() => {
  jest.clearAllMocks();
  mockReadOnly = false;
  mockDiagGet.mockResolvedValue(null);
});

describe('AnnotationBar', () => {
  it('renders nothing when the active cell has no annotation', async () => {
    mockDiagGet.mockResolvedValue(null);
    const { container } = render(<AnnotationBar />);
    await waitFor(() => expect(mockDiagGet).toHaveBeenCalled());
    expect(screen.queryByTestId('annotation-bar')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('shows just glyph + text with no action buttons when the annotation is fresh', async () => {
    mockDiagGet.mockResolvedValue(makeRecord('Total 2026 revenue', 'fresh'));
    render(<AnnotationBar />);
    expect(await screen.findByTestId('annotation-bar')).toBeInTheDocument();
    expect(screen.getByTestId('annotation-bar-text')).toHaveTextContent('Total 2026 revenue');
    expect(screen.getByTestId('annotation-bar-glyph')).toBeInTheDocument();
    // Fresh needs no attention: no ✕/✓ edit signs while idle.
    expect(screen.queryByTestId('annotation-bar-confirm')).not.toBeInTheDocument();
    expect(screen.queryByTestId('annotation-bar-cancel')).not.toBeInTheDocument();
  });

  it('re-baselines a stale note via acceptStale when confirmed unchanged', async () => {
    mockDiagGet.mockResolvedValue(makeRecord('Total 2026 revenue', 'stale'));
    mockAcceptStale.mockResolvedValue(makeRecord('Total 2026 revenue', 'fresh'));
    render(<AnnotationBar />);

    // No dedicated re-baseline button exists — resolving is folded into confirm.
    await userEvent.click(await screen.findByTestId('annotation-bar-glyph'));
    // Confirm without changing the text → acceptStale (mark up to date), not set.
    await userEvent.click(await screen.findByTestId('annotation-bar-confirm'));
    expect(mockAcceptStale).toHaveBeenCalledWith(2, 3);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('shows ✕ / ✓ edit signs while editing and confirms via ✓', async () => {
    mockDiagGet.mockResolvedValue(makeRecord('old note', 'fresh'));
    mockSet.mockResolvedValue(makeRecord('new note', 'fresh'));
    render(<AnnotationBar />);

    await userEvent.click(await screen.findByTestId('annotation-bar-text'));
    const input = await screen.findByTestId('annotation-bar-input');
    expect(screen.getByTestId('annotation-bar-cancel')).toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, 'new note');
    await userEvent.click(screen.getByTestId('annotation-bar-confirm'));

    expect(mockSet).toHaveBeenCalledWith(2, 3, 'new note');
  });

  it('starts editing when the glyph is clicked', async () => {
    mockDiagGet.mockResolvedValue(makeRecord('note', 'fresh'));
    render(<AnnotationBar />);

    await userEvent.click(await screen.findByTestId('annotation-bar-glyph'));
    expect(await screen.findByTestId('annotation-bar-input')).toBeInTheDocument();
  });

  it('commits an inline edit on Enter', async () => {
    mockDiagGet.mockResolvedValue(makeRecord('old note', 'fresh'));
    mockSet.mockResolvedValue(makeRecord('new note', 'fresh'));
    render(<AnnotationBar />);

    await userEvent.click(await screen.findByTestId('annotation-bar-text'));
    const input = await screen.findByTestId('annotation-bar-input');
    await userEvent.clear(input);
    await userEvent.type(input, 'new note{Enter}');

    expect(mockSet).toHaveBeenCalledWith(2, 3, 'new note');
  });

  it('cancels an edit via ✕ without saving', async () => {
    mockDiagGet.mockResolvedValue(makeRecord('keep me', 'fresh'));
    render(<AnnotationBar />);

    await userEvent.click(await screen.findByTestId('annotation-bar-text'));
    const input = await screen.findByTestId('annotation-bar-input');
    await userEvent.clear(input);
    await userEvent.type(input, 'discarded');
    await userEvent.click(screen.getByTestId('annotation-bar-cancel'));

    expect(mockSet).not.toHaveBeenCalled();
    expect(screen.queryByTestId('annotation-bar-input')).not.toBeInTheDocument();
    expect(screen.getByTestId('annotation-bar-text')).toHaveTextContent('keep me');
  });

  it('removes the annotation when an inline edit is cleared to empty', async () => {
    mockDiagGet.mockResolvedValue(makeRecord('to be deleted', 'fresh'));
    mockRemove.mockResolvedValue(undefined);
    render(<AnnotationBar />);

    await userEvent.click(await screen.findByTestId('annotation-bar-text'));
    const input = await screen.findByTestId('annotation-bar-input');
    await userEvent.clear(input);
    await userEvent.type(input, '{Enter}');

    expect(mockRemove).toHaveBeenCalledWith(2, 3);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('hides all editing affordances in read-only mode', async () => {
    mockReadOnly = true;
    mockDiagGet.mockResolvedValue(makeRecord('read only note', 'stale'));
    render(<AnnotationBar />);

    const text = await screen.findByTestId('annotation-bar-text');
    await userEvent.click(text);
    expect(screen.queryByTestId('annotation-bar-input')).not.toBeInTheDocument();
    // No confirm affordance either, even though the record is stale.
    expect(screen.queryByTestId('annotation-bar-confirm')).not.toBeInTheDocument();
  });
});
