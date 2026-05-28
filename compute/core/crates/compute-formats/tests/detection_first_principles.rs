//! First-principles detection and input tests for compute-formats.
//!
//! Every expected value here is derived from the Excel specification and
//! format-code grammar, NOT from running the current implementation.
//! If the code has a bug, these tests should catch it.

mod detection_first_principles {
    mod date_time_detection;
    mod format_metadata;
    mod format_type;
    mod input_values;
}
