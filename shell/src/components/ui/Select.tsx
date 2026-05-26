/**
 * Select primitive
 *
 * Re-exports the Radix-based Select wrapper from `./radix/Select`.
 *
 * The previous implementation was a styled native `<select>` whose
 * OS-controlled popup couldn't be reached by DOM queries (no open-state
 * verification, no hover token, no portaled listbox). The Radix
 * wrapper exposes a `[role="combobox"]` trigger and a portaled
 * `[role="listbox"]` panel — same as the other 9 sibling primitives in
 * `radix/`.
 *
 */

export { Select, type SelectProps, type SelectOption } from './radix/Select';
