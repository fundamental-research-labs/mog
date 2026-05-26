//! Conditional formatting presets — stateless, no engine instance needed.

// Re-export the types consumers need
pub use compute_core::cf::types::{CFColorScale, CFDataBar, CFIconSetName};

use compute_core::bridge_pure::CfBridge;

/// Get all built-in data bar presets.
pub fn get_data_bar_presets() -> Vec<CFDataBar> {
    CfBridge::get_data_bar_presets()
}

/// Get all built-in color scale presets.
pub fn get_color_scale_presets() -> Vec<CFColorScale> {
    CfBridge::get_color_scale_presets()
}

/// Get all built-in icon set preset names.
pub fn get_icon_set_preset_names() -> Vec<CFIconSetName> {
    CfBridge::get_icon_set_preset_names()
}
