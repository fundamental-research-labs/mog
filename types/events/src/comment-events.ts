/**
 * Comment Events
 *
 * Event types for cell comments.
 */

import type { CellId } from '@mog/types-core/cell-identity';
import type { RichText } from '@mog/types-core/rich-text';
import type { BaseEvent, StructureChangeSource } from '@mog/types-commands/event-base';
import type { Comment } from '@mog-sdk/types-document/document/comments';

export interface CommentAddedEvent extends BaseEvent {
  type: 'comment:added';
  sheetId: string;
  comment: Comment;
  source: StructureChangeSource;
}

export interface CommentUpdatedEvent extends BaseEvent {
  type: 'comment:updated';
  sheetId: string;
  comment: Comment;
  previousContent: RichText;
  source: StructureChangeSource;
}

export interface CommentDeletedEvent extends BaseEvent {
  type: 'comment:deleted';
  sheetId: string;
  commentId: string;
  cellId: CellId;
  source: StructureChangeSource;
}

export interface CommentResolvedEvent extends BaseEvent {
  type: 'comment:resolved';
  sheetId: string;
  threadId: string;
  resolved: boolean;
  source: StructureChangeSource;
}

export interface CommentsClearedEvent extends BaseEvent {
  type: 'comments:cleared';
  sheetId: string;
  source: StructureChangeSource;
}

export type CommentEvent =
  | CommentAddedEvent
  | CommentUpdatedEvent
  | CommentDeletedEvent
  | CommentResolvedEvent
  | CommentsClearedEvent;
