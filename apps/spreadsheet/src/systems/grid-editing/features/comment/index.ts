/**
 * Comment Feature Module
 *
 * Exports for comment-related coordination functionality.
 *
 */

export {
  setupCommentSelectionCoordination,
  type CommentSelectionCoordinationDependencies,
  type CommentSelectionCoordinationResult,
} from './comment-selection-coordination';

export {
  setupCommentHoverCoordination,
  type CommentHoverCoordinationConfig,
  type CommentHoverCoordinationResult,
  type MouseMoveInfo,
} from './comment-hover-coordination';
