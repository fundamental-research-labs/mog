import { shouldDeferKeyboardCaptureToTarget } from '../coordinator-keyboard-targets';

describe('coordinator keyboard target filtering', () => {
  it('defers document-level capture for marked chrome controls', () => {
    const wrapper = document.createElement('div');
    const input = document.createElement('input');
    input.setAttribute('data-keyboard-capture', 'defer');
    wrapper.append(input);

    expect(shouldDeferKeyboardCaptureToTarget(input)).toBe(true);
    expect(shouldDeferKeyboardCaptureToTarget(wrapper)).toBe(false);
  });

  it('defers events from descendants of marked controls', () => {
    const button = document.createElement('button');
    button.setAttribute('data-keyboard-capture', 'defer');
    const label = document.createElement('span');
    button.append(label);

    expect(shouldDeferKeyboardCaptureToTarget(label)).toBe(true);
  });
});
