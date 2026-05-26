/**
 * Trivial object type managers — types with no independent domain.
 *
 * Picture and TextBox have no computation engine. They're just
 * formatting + content stored in the floating object.
 */

export {
  DEFAULT_TEXTBOX_HEIGHT,
  DEFAULT_TEXTBOX_WIDTH,
  asTextBoxWithTextEffect,
  createTextBox,
  duplicateTextBox,
  getDefaultTextBoxOptions,
  isTextBox,
  type CreateTextBoxParams,
  type DuplicateTextBoxParams,
  type TextBoxDependencies,
} from './textbox-manager';

export {
  asPictureObject,
  createPicture,
  exportPictureAsFile,
  isPictureObject,
  preparePictureDuplication,
  type CreatePictureParams,
  type DuplicatePictureParams,
  type DuplicatePictureResult,
  type ExportPictureParams,
  type PictureContext,
} from './picture-manager';
