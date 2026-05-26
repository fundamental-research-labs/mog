//! Helper functions for EMU conversions.
//!
//! This module provides convenience functions for converting between
//! different measurement units and EMUs (English Metric Units).

use super::types::{EMUS_PER_CM, EMUS_PER_INCH, EMUS_PER_POINT, Emu};

/// Convert inches to EMUs
#[inline]
pub fn inches_to_emu(inches: f64) -> Emu {
    (inches * EMUS_PER_INCH as f64) as Emu
}

/// Convert centimeters to EMUs
#[inline]
pub fn cm_to_emu(cm: f64) -> Emu {
    (cm * EMUS_PER_CM as f64) as Emu
}

/// Convert pixels to EMUs at a given DPI
#[inline]
pub fn pixels_to_emu(pixels: u32, dpi: u32) -> Emu {
    ((pixels as f64 / dpi as f64) * EMUS_PER_INCH as f64) as Emu
}

/// Convert points to EMUs
#[inline]
pub fn points_to_emu(points: f64) -> Emu {
    (points * EMUS_PER_POINT as f64) as Emu
}

/// Convert EMUs to inches
#[inline]
pub fn emu_to_inches(emu: Emu) -> f64 {
    emu as f64 / EMUS_PER_INCH as f64
}

/// Convert EMUs to centimeters
#[inline]
pub fn emu_to_cm(emu: Emu) -> f64 {
    emu as f64 / EMUS_PER_CM as f64
}
