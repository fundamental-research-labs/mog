/**
 * RadioGroup Primitive Tests
 *
 * Locks the structural invariants:
 *   - one [role="radio"] per option, with data-state ∈ {checked, unchecked}
 *   - the Indicator element mounts ONLY when data-state="checked"
 *   - the Indicator wraps an explicit child <span class="bg-ss-primary">
 *
 * Why explicit child, not `::after`: empirical workaround. Tailwind v4 in
 * this workspace does NOT compile `after:*` pseudo variants into CSS even
 * though `shell/src/styles/globals.css:16` sets the scan root to the
 * workspace root via `@import 'tailwindcss' source('../../..')`. Verified
 * via app-eval. The earlier rationale ("Tailwind only scans `apps/`") was
 * factually wrong; this one is empirical. See RadioGroup.tsx:74-89.
 *
 * If anyone refactors back to `after:*` without first fixing the
 * Tailwind/Vite toolchain issue, this test fails before the visual
 * regression reaches app-eval.
 */

import '@testing-library/jest-dom';

import { cleanup, render, screen } from '@testing-library/react';
import { useState } from 'react';

import { RadioGroup, type RadioOption } from '../radix/RadioGroup';

const OPTIONS: RadioOption[] = [
  { value: 'right', label: 'Shift cells right' },
  { value: 'down', label: 'Shift cells down' },
  { value: 'row', label: 'Entire row' },
  { value: 'column', label: 'Entire column' },
];

function Controlled({ initial = 'down' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <RadioGroup
      name="shift-direction"
      value={value}
      onChange={setValue}
      options={OPTIONS}
      aria-label="Shift options"
    />
  );
}

afterEach(cleanup);

describe('RadioGroup', () => {
  test('renders one [role=radio] per option, with data-state on each', () => {
    render(<Controlled />);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(OPTIONS.length);
    radios.forEach((r) => {
      expect(r.getAttribute('data-state')).toMatch(/^(checked|unchecked)$/);
    });
  });

  test('selected option mounts the Indicator; unchecked options do not', () => {
    render(<Controlled initial="down" />);
    const radios = screen.getAllByRole('radio');
    const checked = radios.find((r) => r.getAttribute('data-state') === 'checked');
    const unchecked = radios.filter((r) => r.getAttribute('data-state') === 'unchecked');

    expect(checked).toBeDefined();
    expect(checked!.firstElementChild).not.toBeNull();
    expect(unchecked).toHaveLength(OPTIONS.length - 1);
    unchecked.forEach((r) => {
      expect(r.firstElementChild).toBeNull();
    });
  });

  /**
   * The dot is rendered as an explicit `<span class="bg-ss-primary">`
   * inside the Indicator — NOT a Tailwind `::after` pseudo. The fill
   * colour is verified end-to-end by the app-eval scenario
   * `form-control-styling-radio-selected-state` (Playwright/Chromium);
   * here we lock the structural contract.
   */
  test('Indicator wraps an explicit <span class="bg-ss-primary"> dot', () => {
    render(<Controlled initial="down" />);
    const checked = screen
      .getAllByRole('radio')
      .find((r) => r.getAttribute('data-state') === 'checked')!;
    const indicator = checked.firstElementChild as HTMLElement;
    expect(indicator).not.toBeNull();

    const fillChild = indicator.firstElementChild as HTMLElement | null;
    expect(fillChild).not.toBeNull();
    expect(fillChild!.tagName).toBe('SPAN');
    expect(fillChild!.className).toContain('bg-ss-primary');
  });
});
