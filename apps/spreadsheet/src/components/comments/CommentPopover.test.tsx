import { jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { Comment } from '@mog-sdk/contracts/comments';

const convertNoteToThread = jest.fn<() => Promise<void>>();
const resolveThread = jest.fn();
const close = jest.fn();

const noteComment: Comment = {
  id: 'note-1',
  cellRef: 'cell-1' as any,
  author: 'Alice',
  createdAt: 1700000000000,
  content: [{ text: 'Imported note' }],
  commentType: 'note',
};

const threadComment: Comment = {
  id: 'thread-1',
  cellRef: 'cell-1' as any,
  author: 'Alice',
  createdAt: 1700000000000,
  content: [{ text: 'Threaded comment' }],
  threadId: 'thread-1',
  resolved: false,
  commentType: 'threadedComment',
};

let popoverState: typeof basePopoverState;

const basePopoverState = {
  isVisible: true,
  mode: 'view' as const,
  target: {
    cellId: 'cell-1',
    sheetId: 'sheet-1',
    row: 0,
    col: 0,
  },
  comments: [noteComment],
  draftContent: [],
  currentAuthor: 'User',
  currentAuthorId: undefined,
  editingCommentId: null,
  deletingCommentId: null,
  close,
  save: jest.fn(),
  cancel: jest.fn(),
  addComment: jest.fn(),
  updateComment: jest.fn(),
  deleteComment: jest.fn(),
  replyToComment: jest.fn(),
  convertNoteToThread,
  resolveThread,
  startEdit: jest.fn(),
  startCompose: jest.fn(),
  requestDelete: jest.fn(),
  confirmDelete: jest.fn(),
  cancelDelete: jest.fn(),
  openForCell: jest.fn(),
};

jest.unstable_mockModule('../../hooks/comments/use-comment-popover', () => ({
  useCommentPopover: () => popoverState,
}));

jest.unstable_mockModule('../../hooks', () => ({
  useRendererActions: () => ({
    getGeometry: () => ({
      getCellPageRect: () => ({ x: 10, y: 20, width: 80, height: 20 }),
    }),
  }),
  useCoordinator: () => ({
    grid: {
      commentHover: {
        notifyPopoverMouseEnter: jest.fn(),
        notifyPopoverMouseLeave: jest.fn(),
      },
    },
  }),
}));

jest.unstable_mockModule('@mog/shell/components/ui', () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children?: React.ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  Popover: ({ open, children }: { open: boolean; children?: React.ReactNode }) =>
    open ? <div data-testid="popover">{children}</div> : null,
  PopoverAnchor: () => null,
  PopoverContent: ({ children }: { children?: React.ReactNode }) => (
    <div role="dialog">{children}</div>
  ),
}));

jest.unstable_mockModule('@mog/icons', () => ({
  AddSvg: () => <span data-testid="add-icon" />,
  CheckmarkCircleSvg: () => <span data-testid="check-icon" />,
  CloseSvg: () => <span data-testid="close-icon" />,
  DeleteSvg: () => <span data-testid="delete-icon" />,
  EditSvg: () => <span data-testid="edit-icon" />,
}));

const { CommentPopover } = await import('./CommentPopover');

describe('CommentPopover', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    convertNoteToThread.mockResolvedValue(undefined);
    popoverState = { ...basePopoverState, comments: [noteComment] };
  });

  it('does not show the thread resolve action for a note', () => {
    render(<CommentPopover />);

    expect(screen.getByText('Note')).toBeInTheDocument();
    expect(screen.queryByTitle('Resolve')).not.toBeInTheDocument();
  });

  it('shows the resolve action for a threaded comment', () => {
    popoverState = { ...basePopoverState, comments: [threadComment] };

    render(<CommentPopover />);

    expect(screen.getByText('Comment')).toBeInTheDocument();
    expect(screen.getByTitle('Resolve')).toBeInTheDocument();
  });

  it('promotes a note before replying to it', async () => {
    render(<CommentPopover />);

    fireEvent.click(screen.getByTitle('Reply'));

    await waitFor(() => {
      expect(convertNoteToThread).toHaveBeenCalledWith('note-1');
    });
    expect(resolveThread).not.toHaveBeenCalled();
  });
});
