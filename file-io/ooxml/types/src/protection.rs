//! Protection types (ECMA-376 CT_SheetProtection, CT_WorkbookProtection).
//!
//! Unified from xlsx-parser read (`read/protection.rs`) and write
//! (`write/protection_writer.rs`) sides.

use serde::{Deserialize, Serialize};

// ============================================================================
// Hash Algorithm Enumeration
// ============================================================================

/// Hash algorithm used for password protection (ST_CryptAlgorithmSid/ST_AlgorithmName).
///
/// Modern Excel files use SHA-based algorithms with salt and spin count.
/// Legacy files may use simple hash without algorithm specification.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, xml_derive::XmlEnum,
)]
pub enum HashAlgorithm {
    /// No algorithm specified (legacy or unprotected)
    #[default]
    #[xml("")]
    None,
    /// MD2 hash algorithm
    #[xml("MD2")]
    Md2,
    /// MD4 hash algorithm
    #[xml("MD4")]
    Md4,
    /// MD5 hash algorithm
    #[xml("MD5")]
    Md5,
    /// SHA-1 hash algorithm (160-bit)
    #[xml("SHA-1", alias = "SHA1")]
    Sha1,
    /// SHA-256 hash algorithm
    #[xml("SHA-256", alias = "SHA256")]
    Sha256,
    /// SHA-384 hash algorithm
    #[xml("SHA-384", alias = "SHA384")]
    Sha384,
    /// SHA-512 hash algorithm
    #[xml("SHA-512", alias = "SHA512")]
    Sha512,
    /// RIPEMD-128 hash algorithm
    #[xml("RIPEMD-128", alias = "RIPEMD128")]
    Ripemd128,
    /// RIPEMD-160 hash algorithm
    #[xml("RIPEMD-160", alias = "RIPEMD160")]
    Ripemd160,
    /// Whirlpool hash algorithm
    #[xml("WHIRLPOOL", alias = "Whirlpool")]
    Whirlpool,
}

// ============================================================================
// SheetProtection (CT_SheetProtection)
// ============================================================================

/// Sheet protection settings from `<sheetProtection>` element.
///
/// Controls what actions users can perform on a protected worksheet.
/// Protection is enforced by Excel when the `sheet` flag is true.
///
/// # Password Protection
/// Excel supports two password protection mechanisms:
/// 1. **Legacy**: Simple 16-bit hash stored in `password` attribute
/// 2. **Modern**: Algorithm-based hash with salt and spin count
///
/// # Protection Flags
/// Each flag controls whether a specific action is PROHIBITED when protection is enabled.
/// For example, `format_cells = true` means users CANNOT format cells.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SheetProtection {
    // -------------------------------------------------------------------------
    // Password Protection Attributes
    // -------------------------------------------------------------------------
    /// Legacy password hash (16-bit hash as hex string, e.g., "CC2A")
    pub password: Option<String>,

    /// Hash algorithm name (e.g., SHA-512)
    pub algorithm_name: HashAlgorithm,

    /// Base64-encoded hash value
    pub hash_value: Option<String>,

    /// Base64-encoded salt value
    pub salt_value: Option<String>,

    /// Number of hash iterations (spin count)
    pub spin_count: Option<u32>,

    // -------------------------------------------------------------------------
    // Main Protection Flag
    // -------------------------------------------------------------------------
    /// Enable sheet protection (must be true for other flags to take effect)
    pub sheet: bool,

    // -------------------------------------------------------------------------
    // Object Protection Flags
    // -------------------------------------------------------------------------
    /// Protect objects (shapes, charts, etc.)
    pub objects: bool,

    /// Protect scenarios (What-If analysis)
    pub scenarios: bool,

    // -------------------------------------------------------------------------
    // Formatting Protection Flags
    // -------------------------------------------------------------------------
    /// Prohibit cell formatting
    pub format_cells: bool,

    /// Prohibit column formatting (width, visibility)
    pub format_columns: bool,

    /// Prohibit row formatting (height, visibility)
    pub format_rows: bool,

    // -------------------------------------------------------------------------
    // Insert Protection Flags
    // -------------------------------------------------------------------------
    /// Prohibit inserting columns
    pub insert_columns: bool,

    /// Prohibit inserting rows
    pub insert_rows: bool,

    /// Prohibit inserting hyperlinks
    pub insert_hyperlinks: bool,

    // -------------------------------------------------------------------------
    // Delete Protection Flags
    // -------------------------------------------------------------------------
    /// Prohibit deleting columns
    pub delete_columns: bool,

    /// Prohibit deleting rows
    pub delete_rows: bool,

    // -------------------------------------------------------------------------
    // Data Operation Protection Flags
    // -------------------------------------------------------------------------
    /// Prohibit sorting
    pub sort: bool,

    /// Prohibit using AutoFilter
    pub auto_filter: bool,

    /// Prohibit pivot table operations
    pub pivot_tables: bool,

    // -------------------------------------------------------------------------
    // Selection Protection Flags
    // -------------------------------------------------------------------------
    /// Prohibit selecting locked cells
    pub select_locked_cells: bool,

    /// Prohibit selecting unlocked cells
    pub select_unlocked_cells: bool,
}

/// Per ECMA-376, most protection flags default to `true` (prohibited) when
/// protection is active.  The exceptions are `sheet`, `objects`, `scenarios`,
/// `select_locked_cells`, and `select_unlocked_cells` which default to `false`.
impl Default for SheetProtection {
    fn default() -> Self {
        Self {
            password: None,
            algorithm_name: HashAlgorithm::None,
            hash_value: None,
            salt_value: None,
            spin_count: None,
            sheet: false,
            objects: false,
            scenarios: false,
            format_cells: true,
            format_columns: true,
            format_rows: true,
            insert_columns: true,
            insert_rows: true,
            insert_hyperlinks: true,
            delete_columns: true,
            delete_rows: true,
            sort: true,
            auto_filter: true,
            pivot_tables: true,
            select_locked_cells: false,
            select_unlocked_cells: false,
        }
    }
}

impl SheetProtection {
    /// Create a new sheet protection with default settings.
    ///
    /// By default, protection is enabled with all actions prohibited.
    pub fn new() -> Self {
        Self {
            sheet: true,
            objects: true,
            scenarios: true,
            format_cells: false,
            format_columns: false,
            format_rows: false,
            insert_columns: false,
            insert_rows: false,
            insert_hyperlinks: false,
            delete_columns: false,
            delete_rows: false,
            sort: false,
            auto_filter: false,
            pivot_tables: false,
            ..Default::default()
        }
    }

    /// Check if the sheet has any password protection.
    pub fn has_password(&self) -> bool {
        self.password.is_some() || self.hash_value.is_some()
    }

    /// Check if the sheet uses modern (algorithm-based) password protection.
    pub fn uses_modern_protection(&self) -> bool {
        self.algorithm_name != HashAlgorithm::None && self.hash_value.is_some()
    }

    /// Allow formatting cells when protected.
    pub fn allow_format_cells(&mut self, allow: bool) -> &mut Self {
        self.format_cells = allow;
        self
    }

    /// Allow formatting columns when protected.
    pub fn allow_format_columns(&mut self, allow: bool) -> &mut Self {
        self.format_columns = allow;
        self
    }

    /// Allow formatting rows when protected.
    pub fn allow_format_rows(&mut self, allow: bool) -> &mut Self {
        self.format_rows = allow;
        self
    }

    /// Allow inserting columns when protected.
    pub fn allow_insert_columns(&mut self, allow: bool) -> &mut Self {
        self.insert_columns = allow;
        self
    }

    /// Allow inserting rows when protected.
    pub fn allow_insert_rows(&mut self, allow: bool) -> &mut Self {
        self.insert_rows = allow;
        self
    }

    /// Allow inserting hyperlinks when protected.
    pub fn allow_insert_hyperlinks(&mut self, allow: bool) -> &mut Self {
        self.insert_hyperlinks = allow;
        self
    }

    /// Allow deleting columns when protected.
    pub fn allow_delete_columns(&mut self, allow: bool) -> &mut Self {
        self.delete_columns = allow;
        self
    }

    /// Allow deleting rows when protected.
    pub fn allow_delete_rows(&mut self, allow: bool) -> &mut Self {
        self.delete_rows = allow;
        self
    }

    /// Allow selecting locked cells when protected.
    pub fn allow_select_locked(&mut self, allow: bool) -> &mut Self {
        self.select_locked_cells = allow;
        self
    }

    /// Allow sorting when protected.
    pub fn allow_sort(&mut self, allow: bool) -> &mut Self {
        self.sort = allow;
        self
    }

    /// Allow using auto filter when protected.
    pub fn allow_auto_filter(&mut self, allow: bool) -> &mut Self {
        self.auto_filter = allow;
        self
    }

    /// Allow pivot table operations when protected.
    pub fn allow_pivot_tables(&mut self, allow: bool) -> &mut Self {
        self.pivot_tables = allow;
        self
    }

    /// Allow selecting unlocked cells when protected.
    pub fn allow_select_unlocked(&mut self, allow: bool) -> &mut Self {
        self.select_unlocked_cells = allow;
        self
    }

    /// Enable or disable sheet protection.
    pub fn enable_protection(&mut self, enable: bool) -> &mut Self {
        self.sheet = enable;
        self
    }

    /// Protect objects (shapes, charts, etc.).
    pub fn protect_objects(&mut self, protect: bool) -> &mut Self {
        self.objects = protect;
        self
    }

    /// Protect scenarios (What-If analysis).
    pub fn protect_scenarios(&mut self, protect: bool) -> &mut Self {
        self.scenarios = protect;
        self
    }
}

// ============================================================================
// WorkbookProtection (CT_WorkbookProtection)
// ============================================================================

/// Workbook protection settings from `<workbookProtection>` element.
///
/// Controls workbook-level protection settings that affect the structure
/// and windows of the workbook, not individual cell content.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct WorkbookProtection {
    // -------------------------------------------------------------------------
    // Password Protection Attributes
    // -------------------------------------------------------------------------
    /// Legacy workbook password hash
    pub workbook_password: Option<String>,

    /// Legacy revision password hash (for change tracking)
    pub revisions_password: Option<String>,

    /// Character set used for legacy workbook password (rarely used).
    pub workbook_password_character_set: Option<String>,

    /// Character set used for legacy revisions password (rarely used).
    pub revisions_password_character_set: Option<String>,

    /// Hash algorithm for workbook password
    pub workbook_algorithm_name: HashAlgorithm,

    /// Base64-encoded hash value for workbook password
    pub workbook_hash_value: Option<String>,

    /// Base64-encoded salt value for workbook password
    pub workbook_salt_value: Option<String>,

    /// Spin count for workbook password
    pub workbook_spin_count: Option<u32>,

    /// Hash algorithm for revisions password
    pub revisions_algorithm_name: HashAlgorithm,

    /// Base64-encoded hash value for revisions password
    pub revisions_hash_value: Option<String>,

    /// Base64-encoded salt value for revisions password
    pub revisions_salt_value: Option<String>,

    /// Spin count for revisions password
    pub revisions_spin_count: Option<u32>,

    // -------------------------------------------------------------------------
    // Protection Flags
    // -------------------------------------------------------------------------
    /// Lock workbook structure (prevent adding/removing/renaming sheets)
    pub lock_structure: bool,

    /// Lock workbook windows (prevent resizing/moving windows)
    pub lock_windows: bool,

    /// Lock revision tracking
    pub lock_revision: bool,
}

impl WorkbookProtection {
    /// Create a new workbook protection with default settings.
    pub fn new() -> Self {
        Self::default()
    }

    /// Lock workbook structure (prevent adding/removing/renaming sheets).
    pub fn set_lock_structure(&mut self, lock: bool) -> &mut Self {
        self.lock_structure = lock;
        self
    }

    /// Lock workbook windows (prevent resizing/moving windows).
    pub fn set_lock_windows(&mut self, lock: bool) -> &mut Self {
        self.lock_windows = lock;
        self
    }

    /// Lock revision tracking.
    pub fn set_lock_revision(&mut self, lock: bool) -> &mut Self {
        self.lock_revision = lock;
        self
    }

    /// Check if any protection is enabled.
    pub fn is_protected(&self) -> bool {
        self.lock_structure || self.lock_windows || self.lock_revision
    }

    /// Check if the workbook has any password protection.
    pub fn has_password(&self) -> bool {
        self.workbook_password.is_some() || self.workbook_hash_value.is_some()
    }

    /// Check if revisions are password protected.
    pub fn has_revisions_password(&self) -> bool {
        self.revisions_password.is_some() || self.revisions_hash_value.is_some()
    }
}

// ============================================================================
// ProtectedRange (CT_ProtectedRange)
// ============================================================================

/// A protected cell range within a worksheet (ECMA-376 §18.3.1.65 CT_ProtectedRange).
///
/// Defines a named range of cells that can have independent protection settings,
/// including optional password protection and Windows security descriptors for
/// user-level access control.
///
/// # Password Protection
/// Like sheet protection, protected ranges support two mechanisms:
/// 1. **Legacy**: Simple 16-bit hash stored in `password` attribute
/// 2. **Modern**: Algorithm-based hash with salt and spin count
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProtectedRange {
    /// The cell ranges this protection applies to (e.g., "A1:B10 C3:D5")
    pub sqref: String,

    /// Name of the protected range
    pub name: String,

    /// Windows security descriptors (for user-level permissions).
    /// Per ECMA-376, this element can appear 0..unbounded times.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub security_descriptor: Vec<String>,

    /// Legacy password hash (16-bit hash as hex string)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,

    /// Hash algorithm name (e.g., SHA-512)
    pub algorithm_name: HashAlgorithm,

    /// Base64-encoded hash value
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hash_value: Option<String>,

    /// Base64-encoded salt value
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub salt_value: Option<String>,

    /// Number of hash iterations (spin count)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spin_count: Option<u32>,
}

impl Default for ProtectedRange {
    fn default() -> Self {
        Self {
            sqref: String::new(),
            name: String::new(),
            security_descriptor: Vec::new(),
            password: None,
            algorithm_name: HashAlgorithm::None,
            hash_value: None,
            salt_value: None,
            spin_count: None,
        }
    }
}

impl ProtectedRange {
    /// Create a new protected range with the given name and cell reference.
    pub fn new(name: impl Into<String>, sqref: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            sqref: sqref.into(),
            ..Default::default()
        }
    }

    /// Check if the protected range has any password protection.
    pub fn has_password(&self) -> bool {
        self.password.is_some() || self.hash_value.is_some()
    }

    /// Check if the protected range uses modern (algorithm-based) password protection.
    pub fn uses_modern_protection(&self) -> bool {
        self.algorithm_name != HashAlgorithm::None && self.hash_value.is_some()
    }

    /// Add a security descriptor for user-level permissions.
    pub fn add_security_descriptor(&mut self, descriptor: impl Into<String>) -> &mut Self {
        self.security_descriptor.push(descriptor.into());
        self
    }

    /// Set the security descriptor for user-level permissions (replaces all existing).
    pub fn set_security_descriptor(&mut self, descriptor: impl Into<String>) -> &mut Self {
        self.security_descriptor = vec![descriptor.into()];
        self
    }

    /// Set the cell ranges this protection applies to.
    pub fn set_sqref(&mut self, sqref: impl Into<String>) -> &mut Self {
        self.sqref = sqref.into();
        self
    }

    /// Set the name of the protected range.
    pub fn set_name(&mut self, name: impl Into<String>) -> &mut Self {
        self.name = name.into();
        self
    }
}

// ============================================================================
// ProtectedRanges (CT_ProtectedRanges)
// ============================================================================

/// Collection of protected ranges within a worksheet (ECMA-376 §18.3.1.66 CT_ProtectedRanges).
///
/// Contains one or more `ProtectedRange` elements that define independently
/// protected cell ranges on a worksheet.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct ProtectedRanges {
    /// The list of protected ranges (1 or more required by the spec)
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub protected_range: Vec<ProtectedRange>,
}

impl ProtectedRanges {
    /// Create a new empty collection of protected ranges.
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a protected range to the collection.
    pub fn add_range(&mut self, range: ProtectedRange) -> &mut Self {
        self.protected_range.push(range);
        self
    }

    /// Check if the collection is empty.
    pub fn is_empty(&self) -> bool {
        self.protected_range.is_empty()
    }

    /// Return the number of protected ranges.
    pub fn len(&self) -> usize {
        self.protected_range.len()
    }
}
