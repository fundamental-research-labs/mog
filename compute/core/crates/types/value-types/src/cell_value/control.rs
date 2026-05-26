//! Cell-embedded control types (checkbox, future: dropdown, radio, etc.).
//!
//! A [`CellControl`] enriches a cell with interactive UI semantics. The
//! canonical example is a checkbox: the cell stores both a boolean `checked`
//! state (reflected to formulas as `TRUE`/`FALSE`) and the `value` payload
//! written to the cell when the control is toggled.
//!
//! ## Design notes
//!
//! * **Coercion** — For formula evaluation a `Control` coerces identically to
//!   `Boolean(checked)`. This means `=A1+1` where A1 is a checked checkbox
//!   yields `2` (TRUE → 1), matching Excel's form-control behavior.
//! * **Serde** — Serializes as `{"type":"control","controlType":"checkbox","checked":true,"value":true}`.
//! * **Display** — Shows `☑ TRUE` / `☐ FALSE` for human-readable output.

use serde::{Deserialize, Serialize};

/// The kind of control embedded in a cell.
///
/// Currently only `Checkbox` is supported; the enum is `#[non_exhaustive]`
/// so future variants (toggle, radio, dropdown) can be added without a
/// breaking change.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub enum CellControlType {
    /// A checkbox control — checked/unchecked boolean toggle.
    Checkbox,
}

/// A cell-embedded interactive control.
///
/// `checked` is the user-facing toggle state (rendered as a checkbox tick).
/// `value` is the underlying boolean payload stored in the cell, which
/// formulas see via coercion. In the default checkbox case `checked == value`,
/// but the split allows future controls to decouple display from storage.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct CellControl {
    /// What kind of control this is.
    pub control_type: CellControlType,
    /// Whether the control is in its "active" state (checkbox: ticked).
    pub checked: bool,
    /// The boolean value the cell reports to formulas.
    pub value: bool,
}

impl CellControl {
    /// Create a new checkbox control with the given checked state.
    ///
    /// Both `checked` and `value` are set to the same boolean — this is the
    /// standard construction for a simple checkbox.
    #[must_use]
    #[inline]
    pub fn checkbox(checked: bool) -> Self {
        Self {
            control_type: CellControlType::Checkbox,
            checked,
            value: checked,
        }
    }
}
