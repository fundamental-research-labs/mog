//! Roundtrip validation tests for connectors and group shapes.
//!
//! Each test follows the pattern:
//! 1. Build a write-side props struct (e.g. `ConnectorProps`, `GroupShapeProps`)
//! 2. Serialize to XML via `DrawingWriter`
//! 3. Re-parse the XML via `parse_drawing` (read-side)
//! 4. Convert back via conversion functions (read -> write)
//! 5. Assert that all supported properties survive the trip
//!
//! Known limitations documented inline:
//! - The writer assigns its own `id` to `cNvPr`, so the numeric ID will differ.

mod common;
mod connectors;
mod groups;
