/**
 * Regression: document-level keyup capture must call `preventDefault`
 * (and `stopPropagation`) when the keyboard coordinator signals
 * `handled = true` on Alt-up.
 *
 * Without this, Windows browsers complete the Win32 menu-mnemonic
 * handler on bare-Alt release and yank focus to the title-bar menu —
 * even though the coordinator has already entered `'keyTipMode'`.
 * The next chord key (e.g. `H` after a clean Alt tap) then routes to
 * the browser chrome instead of the matcher and the KeyTip overlay
 * never surfaces.
 *
 * macOS has no equivalent default, so the bug is invisible on
 * developer machines and CI; the unit test below locks in the
 * contract independent of platform.
 */

import { jest } from '@jest/globals';

import { createKeyUpCapture } from '../coordinator-keyup-capture';

describe('createKeyUpCapture (Windows Alt-menu suppression contract)', () => {
  it('calls preventDefault and stopPropagation when the coordinator returns handled=true', () => {
    const handleKeyUp = jest.fn<(e: KeyboardEvent) => boolean>().mockReturnValue(true);
    const onKeyUp = createKeyUpCapture(handleKeyUp);

    const event = new KeyboardEvent('keyup', { key: 'Alt', code: 'AltLeft', cancelable: true });
    const stopSpy = jest.spyOn(event, 'stopPropagation');

    onKeyUp(event);

    expect(handleKeyUp).toHaveBeenCalledWith(event);
    expect(event.defaultPrevented).toBe(true);
    expect(stopSpy).toHaveBeenCalled();
  });

  it('does not call preventDefault when the coordinator returns handled=false', () => {
    const handleKeyUp = jest.fn<(e: KeyboardEvent) => boolean>().mockReturnValue(false);
    const onKeyUp = createKeyUpCapture(handleKeyUp);

    const event = new KeyboardEvent('keyup', { key: 'a', code: 'KeyA', cancelable: true });
    const stopSpy = jest.spyOn(event, 'stopPropagation');

    onKeyUp(event);

    expect(handleKeyUp).toHaveBeenCalledWith(event);
    expect(event.defaultPrevented).toBe(false);
    expect(stopSpy).not.toHaveBeenCalled();
  });
});
