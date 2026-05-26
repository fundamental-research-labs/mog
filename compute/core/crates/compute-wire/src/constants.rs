//! Wire format layout constants (byte sizes, strides, sentinels).

/// Current wire protocol version.
///
/// Encoded in bits 4-7 of the viewport header flags byte (offset 30).
/// Both Rust and TypeScript must agree on this value; a mismatch indicates
/// an incompatible wire format. Bump on any breaking layout change.
pub const WIRE_VERSION: u8 = 2;

/// Viewport header size in bytes.
pub const VIEWPORT_HEADER_SIZE: usize = 36;

/// Size of a single cell record in the viewport binary (bytes).
pub const CELL_STRIDE: usize = 32;

/// Size of a merge record (bytes).
pub const MERGE_STRIDE: usize = 16;

/// Size of a dimension record (row or column, bytes).
pub const DIM_STRIDE: usize = 12;

/// Sentinel value meaning "no string" in a u32 offset field.
pub const NO_STRING: u32 = 0xFFFF_FFFF;

/// Mutation header size in bytes.
pub const MUTATION_HEADER_SIZE: usize = 16;

/// Size of a single cell patch in the mutation binary (row + col + cell record).
pub const PATCH_STRIDE: usize = 40;

// -- Cell record byte offsets (within each 32-byte cell record) ----------------

/// Byte offset of the `f64` number value within a cell record.
pub const OFF_NUMBER_VALUE: usize = 0;
/// Byte offset of the `u32` display string pool offset within a cell record.
pub const OFF_DISPLAY_OFF: usize = 8;
/// Byte offset of the `u32` error string pool offset within a cell record.
pub const OFF_ERROR_OFF: usize = 12;
/// Byte offset of the `u16` flags bitfield within a cell record.
pub const OFF_FLAGS: usize = 16;
/// Byte offset of the `u16` format palette index within a cell record.
pub const OFF_FORMAT_IDX: usize = 18;
/// Byte offset of the `u16` display string length within a cell record.
pub const OFF_DISPLAY_LEN: usize = 20;
/// Byte offset of the `u16` error string length within a cell record.
pub const OFF_ERROR_LEN: usize = 22;
/// Byte offset of the `u32` packed RGBA background color override within a cell record.
pub const OFF_BG_COLOR_OVERRIDE: usize = 24;
/// Byte offset of the `u32` packed RGBA font color override within a cell record.
pub const OFF_FONT_COLOR_OVERRIDE: usize = 28;

// -- CF extras section strides ------------------------------------------------

/// Size of a data bar entry in the CF extras section (bytes).
pub const DATA_BAR_ENTRY_STRIDE: usize = 24;

/// Size of an icon entry in the CF extras section (bytes).
pub const ICON_ENTRY_STRIDE: usize = 8;

/// Size of a position entry (f64) in bytes.
pub const POSITION_ENTRY_SIZE: usize = 8;

// -- Palette binary section ---------------------------------------------------

/// Palette section header size: u16 `start_index` + u16 `format_count` + u32 `string_pool_bytes`.
pub const PALETTE_HEADER_SIZE: usize = 8;

/// Size of a string reference in the palette: u32 offset + u16 length.
pub const PALETTE_STR_REF_SIZE: usize = 6;
