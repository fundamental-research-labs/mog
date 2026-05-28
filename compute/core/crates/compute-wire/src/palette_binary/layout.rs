//! Wire-layout constants for palette binary records.

// ---------------------------------------------------------------------------
// Presence-mask bit constants (29 fields, bits 0-28)
// ---------------------------------------------------------------------------

/// Bit for `font_family`: `Option<String>`.
pub(crate) const BIT_FONT_FAMILY: u32 = 1 << 0;
/// Bit for `font_size`: `Option<FontSize>`.
pub(crate) const BIT_FONT_SIZE: u32 = 1 << 1;
/// Bit for `font_color`: `Option<String>`.
pub(crate) const BIT_FONT_COLOR: u32 = 1 << 2;
/// Bit for `bold`: `Option<bool>`.
pub(crate) const BIT_BOLD: u32 = 1 << 3;
/// Bit for `italic`: `Option<bool>`.
pub(crate) const BIT_ITALIC: u32 = 1 << 4;
/// Bit for `underline_type`: `Option<String>`.
pub(crate) const BIT_UNDERLINE_TYPE: u32 = 1 << 5;
/// Bit for `strikethrough`: `Option<bool>`.
pub(crate) const BIT_STRIKETHROUGH: u32 = 1 << 6;
/// Bit for `superscript`: `Option<bool>`.
pub(crate) const BIT_SUPERSCRIPT: u32 = 1 << 7;
/// Bit for `subscript`: `Option<bool>`.
pub(crate) const BIT_SUBSCRIPT: u32 = 1 << 8;
/// Bit for `font_outline`: `Option<bool>`.
pub(crate) const BIT_FONT_OUTLINE: u32 = 1 << 9;
/// Bit for `font_shadow`: `Option<bool>`.
pub(crate) const BIT_FONT_SHADOW: u32 = 1 << 10;
/// Bit for `font_theme`: `Option<String>`.
pub(crate) const BIT_FONT_THEME: u32 = 1 << 11;
/// Bit for `font_charset`: `Option<u32>`.
pub(crate) const BIT_FONT_CHARSET: u32 = 1 << 12;
/// Bit for `font_family_type`: `Option<u32>`.
pub(crate) const BIT_FONT_FAMILY_TYPE: u32 = 1 << 13;
/// Bit for `horizontal_align`: `Option<String>`.
pub(crate) const BIT_HORIZONTAL_ALIGN: u32 = 1 << 14;
/// Bit for `vertical_align`: `Option<String>`.
pub(crate) const BIT_VERTICAL_ALIGN: u32 = 1 << 15;
/// Bit for `wrap_text`: `Option<bool>`.
pub(crate) const BIT_WRAP_TEXT: u32 = 1 << 16;
/// Bit for `indent`: `Option<u32>`.
pub(crate) const BIT_INDENT: u32 = 1 << 17;
/// Bit for `text_rotation`: `Option<i32>`.
pub(crate) const BIT_TEXT_ROTATION: u32 = 1 << 18;
/// Bit for `shrink_to_fit`: `Option<bool>`.
pub(crate) const BIT_SHRINK_TO_FIT: u32 = 1 << 19;
/// Bit for `reading_order`: `Option<String>`.
pub(crate) const BIT_READING_ORDER: u32 = 1 << 20;
/// Bit for `number_format`: `Option<String>`.
pub(crate) const BIT_NUMBER_FORMAT: u32 = 1 << 21;
/// Bit for `background_color`: `Option<String>`.
pub(crate) const BIT_BACKGROUND_COLOR: u32 = 1 << 22;
/// Bit for `pattern_type`: `Option<String>`.
pub(crate) const BIT_PATTERN_TYPE: u32 = 1 << 23;
/// Bit for `pattern_foreground_color`: `Option<String>`.
pub(crate) const BIT_PATTERN_FG_COLOR: u32 = 1 << 24;
/// Bit for `gradient_fill`: `Option<GradientFillFormat>`.
pub(crate) const BIT_GRADIENT_FILL: u32 = 1 << 25;
/// Bit for `borders`: `Option<CellBorders>`.
pub(crate) const BIT_BORDERS: u32 = 1 << 26;
/// Bit for `locked`: `Option<bool>`.
pub(crate) const BIT_LOCKED: u32 = 1 << 27;
/// Bit for `hidden`: `Option<bool>`.
pub(crate) const BIT_HIDDEN: u32 = 1 << 28;

/// Palette header size: `u16` `start_index` + `u16` `format_count` + `u32` `string_pool_bytes`.
pub(super) const PALETTE_HEADER_SIZE: usize = 8;

// Gradient nested presence bits.
pub(super) const GRADIENT_HAS_DEGREE: u8 = 1 << 0;
pub(super) const GRADIENT_HAS_CENTER: u8 = 1 << 1;

// Border nested presence bits.
pub(super) const BORDER_HAS_TOP: u16 = 1 << 0;
pub(super) const BORDER_HAS_RIGHT: u16 = 1 << 1;
pub(super) const BORDER_HAS_BOTTOM: u16 = 1 << 2;
pub(super) const BORDER_HAS_LEFT: u16 = 1 << 3;
pub(super) const BORDER_HAS_DIAGONAL: u16 = 1 << 4;
pub(super) const BORDER_HAS_DIAGONAL_UP: u16 = 1 << 5;
pub(super) const BORDER_HAS_DIAGONAL_DOWN: u16 = 1 << 6;
pub(super) const BORDER_HAS_VERTICAL: u16 = 1 << 7;
pub(super) const BORDER_HAS_HORIZONTAL: u16 = 1 << 8;
pub(super) const BORDER_HAS_OUTLINE: u16 = 1 << 9;

// Border-side nested presence bits.
pub(super) const BORDER_SIDE_HAS_STYLE: u8 = 1 << 0;
pub(super) const BORDER_SIDE_HAS_COLOR: u8 = 1 << 1;
