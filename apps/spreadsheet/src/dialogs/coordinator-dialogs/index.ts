/**
 * Coordinator Dialog Containers
 *
 * Container components that wire dialogs to XState coordinator state machines.
 * These containers must be rendered inside SpreadsheetCoordinatorProvider
 * to access clipboard, editor, and selection state machines.
 *
 * Wrapper components (e.g., PasteSpecialDialogContainerWrapper) conditionally
 * mount the container only when the dialog is open, improving performance.
 *
 */

export { ExtensionHostContainer } from './ExtensionHostContainer';
export { FunctionArgumentsDialogContainer } from './FunctionArgumentsDialogContainer';
export { InsertFunctionDialogContainer } from './InsertFunctionDialogContainer';
export {
  PasteSpecialDialogContainer,
  PasteSpecialDialogContainerWrapper,
} from './PasteSpecialDialogContainer';
export {
  RemoveDuplicatesDialogContainer,
  RemoveDuplicatesDialogContainerWrapper,
} from './RemoveDuplicatesDialogContainer';
export { SubtotalDialogContainer, SubtotalDialogContainerWrapper } from './SubtotalDialogContainer';
export {
  TextToColumnsDialogContainer,
  TextToColumnsDialogContainerWrapper,
} from './TextToColumnsDialogContainer';
