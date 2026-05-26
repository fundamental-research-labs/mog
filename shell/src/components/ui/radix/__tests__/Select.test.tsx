/**
 * Tests for the Radix Select wrapper.
 *
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Select } from '../Select';

const OPTIONS = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
];

describe('Select (Radix wrapper)', () => {
  // Radix Select uses pointer events that jsdom does not implement.
  // Stub the prototypes so the trigger can be opened in tests.
  beforeAll(() => {
    if (!Element.prototype.hasPointerCapture) {
      Element.prototype.hasPointerCapture = () => false;
    }
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = () => undefined;
    }
    if (!Element.prototype.releasePointerCapture) {
      Element.prototype.releasePointerCapture = () => undefined;
    }
  });

  it('renders trigger as a [role="combobox"] with the selected label', () => {
    render(<Select value="center" onChange={() => {}} options={OPTIONS} />);

    const trigger = screen.getByRole('combobox');
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveTextContent('Center');
  });

  it('opens content on click and exposes [role="listbox"]', async () => {
    const user = userEvent.setup();
    render(<Select value="left" onChange={() => {}} options={OPTIONS} />);

    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveAttribute('data-state', 'closed');

    await user.click(trigger);

    expect(trigger).toHaveAttribute('data-state', 'open');
    // Radix portals the listbox to document.body
    const listbox = await screen.findByRole('listbox');
    expect(listbox).toBeInTheDocument();
  });

  it('open content opts into pointer events for shell portal hit testing', async () => {
    const user = userEvent.setup();
    render(<Select value="left" onChange={() => {}} options={OPTIONS} />);

    await user.click(screen.getByRole('combobox'));

    const listbox = await screen.findByRole('listbox');
    expect(listbox).toHaveClass('pointer-events-auto');
  });

  it('marks the selected item with data-state="checked"', async () => {
    const user = userEvent.setup();
    render(<Select value="center" onChange={() => {}} options={OPTIONS} />);

    await user.click(screen.getByRole('combobox'));
    const items = await screen.findAllByRole('option');
    const center = items.find((el) => el.textContent === 'Center')!;
    expect(center).toHaveAttribute('data-state', 'checked');
  });

  it('fires onChange with the new string value when an option is selected', async () => {
    const user = userEvent.setup();
    const handleChange = jest.fn();
    render(<Select value="left" onChange={handleChange} options={OPTIONS} />);

    await user.click(screen.getByRole('combobox'));
    const right = await screen.findByRole('option', { name: 'Right' });
    await user.click(right);

    expect(handleChange).toHaveBeenCalledWith('right');
    expect(handleChange).toHaveBeenCalledTimes(1);
  });

  it('forwards id and data-testid to the trigger', () => {
    render(
      <Select
        id="alignment"
        data-testid="alignment-select"
        value="left"
        onChange={() => {}}
        options={OPTIONS}
      />,
    );

    const trigger = screen.getByTestId('alignment-select');
    expect(trigger).toHaveAttribute('id', 'alignment');
    expect(trigger).toHaveAttribute('role', 'combobox');
  });

  it('mounts the open portal under document.body', async () => {
    const user = userEvent.setup();
    const { container } = render(<Select value="left" onChange={() => {}} options={OPTIONS} />);

    await user.click(screen.getByRole('combobox'));
    const listbox = await screen.findByRole('listbox');

    // The listbox is portaled — it lives in document.body, not under the
    // component's render root.
    expect(container.contains(listbox)).toBe(false);
    expect(document.body.contains(listbox)).toBe(true);
  });
});
