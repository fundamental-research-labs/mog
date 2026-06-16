import type {
  Comment,
  CommentMutationTarget,
  OperationEffect,
  SheetId,
} from '@mog-sdk/contracts/api';
import { toA1 } from '@mog/spreadsheet-utils/a1';

export function fallbackComment(input: {
  id: string;
  row: number;
  col: number;
  text: string;
  author: string;
  commentType: Comment['commentType'];
  parentId?: string | null;
  threadId?: string | null;
}): Comment {
  return {
    id: input.id,
    cellRef: `${input.row}:${input.col}`,
    author: input.author,
    content: input.text,
    runs: [],
    threadId: input.threadId ?? null,
    parentId: input.parentId ?? null,
    createdAt: null,
    modifiedAt: null,
    commentType: input.commentType,
  };
}

export function targetFromPosition(
  sheetId: SheetId,
  row: number,
  col: number,
): CommentMutationTarget {
  const address = toA1(row, col);
  return { sheetId, address, range: address, row, col };
}

export function worksheetTarget(sheetId: SheetId): CommentMutationTarget {
  return { sheetId };
}

export function targetFromCellRef(sheetId: SheetId, cellRef: string): CommentMutationTarget {
  const match = /^(\d+):(\d+)$/.exec(cellRef);
  if (!match) {
    return { sheetId, cellRef };
  }
  return targetFromPosition(sheetId, Number(match[1]), Number(match[2]));
}

function targetRange(target: CommentMutationTarget | undefined): string | undefined {
  return target?.range ?? target?.address;
}

function commentObjectDetails(comment: Comment, details?: Record<string, unknown>) {
  return {
    objectType: 'comment',
    commentType: comment.commentType,
    threadId: comment.threadId,
    parentId: comment.parentId,
    ...details,
  };
}

export function commentObjectEffect(
  type: 'createdObject' | 'updatedObject' | 'removedObject',
  sheetId: SheetId,
  comment: Comment,
  details?: Record<string, unknown>,
): OperationEffect {
  return {
    type,
    sheetId,
    objectId: comment.id,
    details: commentObjectDetails(comment, details),
  };
}

export function changedRangeEffect(
  sheetId: SheetId,
  target: CommentMutationTarget | undefined,
  count = 1,
): OperationEffect {
  const range = targetRange(target);
  return {
    type: 'changedRange',
    sheetId,
    ...(range ? { range } : {}),
    count,
  };
}

export function worksheetUnchangedEffect(
  sheetId: SheetId,
  target?: CommentMutationTarget,
): OperationEffect {
  const range = targetRange(target);
  return {
    type: 'worksheetUnchanged',
    sheetId,
    ...(range ? { range } : {}),
  };
}

export function removedCommentEffects(
  sheetId: SheetId,
  target: CommentMutationTarget | undefined,
  removedCount: number,
): OperationEffect[] {
  if (removedCount === 0) {
    return [worksheetUnchangedEffect(sheetId, target)];
  }
  return [
    {
      type: 'removedObject',
      sheetId,
      count: removedCount,
      details: { objectType: 'comment' },
    },
    changedRangeEffect(sheetId, target, removedCount),
  ];
}
