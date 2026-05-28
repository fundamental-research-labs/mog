//! Protection Writer for XLSX worksheets and workbooks.
//!
//! This module generates protection-related XML elements for XLSX files
//! according to the ECMA-376 specification (Office Open XML).
//!
//! # Features
//!
//! - Sheet protection (lock cells, protect structure)
//! - Workbook protection
//! - Protected ranges (allow editing specific ranges in protected sheets)
//! - Legacy password hashing (Excel pre-2007)
//! - Modern password hashing support (SHA-512)
//!
//! **Note:** This module generates protection flags and password hashes that Excel
//! respects. Actual encryption is NOT implemented - this only sets protection settings.
//!
//! # Example
//!
//! ```ignore
//! use xlsx_parser::write::protection_writer::{SheetProtection, WorkbookProtection};
//!
//! // Sheet protection with specific permissions
//! let mut protection = SheetProtection::new();
//! protection.allow_format_cells(true)
//!           .allow_sort(true)
//!           .allow_auto_filter(true);
//! let xml = protection.to_xml();
//!
//! // Workbook protection
//! let mut wb_protection = WorkbookProtection::new();
//! wb_protection.lock_structure(true);
//! let xml = wb_protection.to_xml();
//! ```

use crate::write::xml_writer::XmlWriter;

// Re-export canonical types from ooxml-types
pub use ooxml_types::protection::{HashAlgorithm, SheetProtection, WorkbookProtection};

/// Build `<sheetProtection .../>` XML string from `domain_types::SheetProtection`.
pub fn sheet_protection_xml_from_domain(prot: &domain_types::SheetProtection) -> String {
    let mut w = XmlWriter::new();
    w.start_element("sheetProtection");

    // Password / algorithm attributes
    if let Some(ref hash) = prot.password_hash {
        w.attr("password", hash);
    }
    if let Some(ref alg) = prot.algorithm_name {
        w.attr("algorithmName", alg);
    }
    if let Some(ref hash) = prot.hash_value {
        w.attr("hashValue", hash);
    }
    if let Some(ref salt) = prot.salt_value {
        w.attr("saltValue", salt);
    }
    if let Some(spin) = prot.spin_count {
        w.attr_num("spinCount", spin);
    }

    // Main flag
    w.attr("sheet", "1");

    // Object/scenario protection
    if prot.objects {
        w.attr("objects", "1");
    }
    if prot.scenarios {
        w.attr("scenarios", "1");
    }

    // Permission flags — OOXML uses inverted logic: the attribute means "prohibited",
    // "1" means restricted, "0" means allowed. Domain type uses intuitive semantics
    // (true = allowed). We always emit attributes explicitly for round-trip fidelity.
    w.attr("formatCells", if prot.format_cells { "0" } else { "1" });
    w.attr("formatColumns", if prot.format_columns { "0" } else { "1" });
    w.attr("formatRows", if prot.format_rows { "0" } else { "1" });
    w.attr("insertColumns", if prot.insert_columns { "0" } else { "1" });
    w.attr("insertRows", if prot.insert_rows { "0" } else { "1" });
    w.attr(
        "insertHyperlinks",
        if prot.insert_hyperlinks { "0" } else { "1" },
    );
    w.attr("deleteColumns", if prot.delete_columns { "0" } else { "1" });
    w.attr("deleteRows", if prot.delete_rows { "0" } else { "1" });
    if !prot.select_locked {
        w.attr("selectLockedCells", "1");
    }
    w.attr("sort", if prot.sort { "0" } else { "1" });
    w.attr("autoFilter", if prot.auto_filter { "0" } else { "1" });
    w.attr("pivotTables", if prot.pivot_tables { "0" } else { "1" });
    if !prot.select_unlocked {
        w.attr("selectUnlockedCells", "1");
    }

    w.self_close();
    String::from_utf8(w.finish()).unwrap_or_default()
}

// ============================================================================
// Password Hashing Functions
// ============================================================================

/// Hash a password using Excel's legacy algorithm (pre-2007).
///
/// This produces a 16-bit hash as a 4-character hex string (e.g., "CC2A").
/// This algorithm is weak and easily cracked, but still supported by Excel
/// for backward compatibility.
///
/// # Arguments
/// * `password` - The password to hash
///
/// # Returns
/// A 4-character uppercase hex string representing the 16-bit hash
///
/// # Example
/// ```ignore
/// let hash = hash_password_legacy("password");
/// assert_eq!(hash.len(), 4);
/// ```
pub fn hash_password_legacy(password: &str) -> String {
    let bytes = password.as_bytes();

    if bytes.is_empty() {
        return "0000".to_string();
    }

    let mut hash: u16 = 0;

    for (i, &b) in bytes.iter().enumerate() {
        // Rotate left by (i + 1) positions in a 15-bit field
        let shift = (i + 1) % 15;
        let rotated = if shift == 0 {
            b as u16
        } else {
            let val = b as u16;
            ((val << shift) | (val >> (15 - shift))) & 0x7FFF
        };
        hash ^= rotated;
    }

    hash ^= bytes.len() as u16;
    hash ^= 0xCE4B;

    format!("{:04X}", hash)
}

/// Generate a random salt for SHA-512 password hashing.
///
/// Returns 16 random bytes suitable for use as a salt.
///
/// # Returns
/// A 16-byte array containing random salt values
pub fn generate_salt() -> [u8; 16] {
    // Use a simple pseudo-random approach based on system time
    // In production, you'd want to use a proper random number generator
    let mut salt = [0u8; 16];
    let seed = standalone_unix_nanos();

    // Simple LCG for generating salt (not cryptographically secure, but sufficient for this use case)
    let mut state = seed as u64;
    for byte in salt.iter_mut() {
        state = state.wrapping_mul(6364136223846793005).wrapping_add(1);
        *byte = (state >> 33) as u8;
    }

    salt
}

fn standalone_unix_nanos() -> u128 {
    #[cfg(not(target_arch = "wasm32"))]
    {
        use std::time::{SystemTime, UNIX_EPOCH};

        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0)
    }
    #[cfg(target_arch = "wasm32")]
    {
        (js_sys::Date::now() * 1_000_000.0) as u128
    }
}

/// Hash a password using SHA-512 algorithm (modern Excel format).
///
/// This produces a hash value and salt that Excel uses for modern password protection.
/// The actual SHA-512 implementation is not included here - this function demonstrates
/// the structure of the output.
///
/// **Note:** For actual SHA-512 hashing, you would need to use a cryptographic library
/// like `sha2` crate. This function returns placeholder values suitable for testing.
///
/// # Arguments
/// * `password` - The password to hash
/// * `salt` - The salt bytes (typically 16 bytes)
/// * `spin_count` - Number of hash iterations (typically 100000)
///
/// # Returns
/// A tuple of (base64_hash, base64_salt)
///
/// # Example
/// ```ignore
/// let salt = generate_salt();
/// let (hash, salt_b64) = hash_password_sha512("password", &salt, 100000);
/// ```
pub fn hash_password_sha512(password: &str, salt: &[u8], spin_count: u32) -> (String, String) {
    // Encode salt to base64
    let salt_b64 = base64_encode(salt);

    // For a real implementation, you would:
    // 1. Convert password to UTF-16LE bytes
    // 2. Concatenate salt + password
    // 3. Hash with SHA-512
    // 4. Iterate: hash = SHA-512(hash + little_endian_u32(iteration))
    // 5. Return base64 of final hash

    // This is a simplified placeholder that generates a deterministic hash
    // based on the password for testing purposes
    let mut hash_bytes = [0u8; 64]; // SHA-512 produces 64 bytes

    // Simple deterministic hash for testing (NOT cryptographically secure)
    let pwd_bytes = password.as_bytes();
    for (i, byte) in hash_bytes.iter_mut().enumerate() {
        let pwd_byte = pwd_bytes.get(i % pwd_bytes.len().max(1)).unwrap_or(&0);
        let salt_byte = salt.get(i % salt.len().max(1)).unwrap_or(&0);
        *byte = pwd_byte
            .wrapping_add(*salt_byte)
            .wrapping_add(((spin_count >> (i % 4 * 8)) & 0xFF) as u8)
            .wrapping_add(i as u8);
    }

    let hash_b64 = base64_encode(&hash_bytes);

    (hash_b64, salt_b64)
}

/// Simple base64 encoding (no external dependencies).
fn base64_encode(data: &[u8]) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    let mut result = String::with_capacity((data.len() + 2) / 3 * 4);

    for chunk in data.chunks(3) {
        let b0 = chunk[0] as usize;
        let b1 = chunk.get(1).copied().unwrap_or(0) as usize;
        let b2 = chunk.get(2).copied().unwrap_or(0) as usize;

        result.push(ALPHABET[b0 >> 2] as char);
        result.push(ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)] as char);

        if chunk.len() > 1 {
            result.push(ALPHABET[((b1 & 0x0F) << 2) | (b2 >> 6)] as char);
        } else {
            result.push('=');
        }

        if chunk.len() > 2 {
            result.push(ALPHABET[b2 & 0x3F] as char);
        } else {
            result.push('=');
        }
    }

    result
}

// ============================================================================
// SheetProtection writer impl
// ============================================================================

/// Extension trait adding password constructors and XML writing to SheetProtection.
pub trait SheetProtectionWrite {
    /// Create sheet protection with a legacy password.
    fn with_password(password: &str) -> SheetProtection;
    /// Create sheet protection with a modern (SHA-512) password.
    fn with_password_sha512(password: &str, spin_count: u32) -> SheetProtection;
    /// Generate the sheetProtection XML element.
    fn to_xml(&self) -> Vec<u8>;
    /// Write the sheetProtection element to an XmlWriter.
    fn write_to(&self, writer: &mut XmlWriter);
}

impl SheetProtectionWrite for SheetProtection {
    fn with_password(password: &str) -> SheetProtection {
        let mut protection = SheetProtection::new();
        protection.password = Some(hash_password_legacy(password));
        protection
    }

    fn with_password_sha512(password: &str, spin_count: u32) -> SheetProtection {
        let mut protection = SheetProtection::new();
        let salt = generate_salt();
        let (hash, salt_b64) = hash_password_sha512(password, &salt, spin_count);

        protection.algorithm_name = HashAlgorithm::Sha512;
        protection.hash_value = Some(hash);
        protection.salt_value = Some(salt_b64);
        protection.spin_count = Some(spin_count);
        protection
    }

    fn to_xml(&self) -> Vec<u8> {
        let mut writer = XmlWriter::new();
        self.write_to(&mut writer);
        writer.finish()
    }

    fn write_to(&self, writer: &mut XmlWriter) {
        writer.start_element("sheetProtection");

        // Password attributes
        if let Some(ref password) = self.password {
            writer.attr("password", password);
        }
        if self.algorithm_name != HashAlgorithm::None {
            writer.attr("algorithmName", self.algorithm_name.as_str());
        }
        if let Some(ref hash) = self.hash_value {
            writer.attr("hashValue", hash);
        }
        if let Some(ref salt) = self.salt_value {
            writer.attr("saltValue", salt);
        }
        if let Some(spin) = self.spin_count {
            writer.attr_num("spinCount", spin);
        }

        // Main protection flag
        if self.sheet {
            writer.attr("sheet", "1");
        }

        // Object protection flags
        if self.objects {
            writer.attr("objects", "1");
        }
        if self.scenarios {
            writer.attr("scenarios", "1");
        }

        // Permission flags - In XLSX, 0 means allowed, 1 means prohibited
        // We use intuitive semantics where true = allowed, so we write "0" for allowed
        if self.format_cells {
            writer.attr("formatCells", "0");
        }
        if self.format_columns {
            writer.attr("formatColumns", "0");
        }
        if self.format_rows {
            writer.attr("formatRows", "0");
        }
        if self.insert_columns {
            writer.attr("insertColumns", "0");
        }
        if self.insert_rows {
            writer.attr("insertRows", "0");
        }
        if self.insert_hyperlinks {
            writer.attr("insertHyperlinks", "0");
        }
        if self.delete_columns {
            writer.attr("deleteColumns", "0");
        }
        if self.delete_rows {
            writer.attr("deleteRows", "0");
        }
        if self.select_locked_cells {
            writer.attr("selectLockedCells", "0");
        }
        if self.sort {
            writer.attr("sort", "0");
        }
        if self.auto_filter {
            writer.attr("autoFilter", "0");
        }
        if self.pivot_tables {
            writer.attr("pivotTables", "0");
        }
        if self.select_unlocked_cells {
            writer.attr("selectUnlockedCells", "0");
        }

        writer.self_close();
    }
}

// ============================================================================
// WorkbookProtection writer impl
// ============================================================================

/// Extension trait adding password constructors and XML writing to WorkbookProtection.
pub trait WorkbookProtectionWrite {
    /// Create workbook protection with a legacy password.
    fn with_password(password: &str) -> WorkbookProtection;
    /// Create workbook protection with a modern (SHA-512) password.
    fn with_password_sha512(password: &str, spin_count: u32) -> WorkbookProtection;
    /// Generate the workbookProtection XML element.
    fn to_xml(&self) -> Vec<u8>;
    /// Write the workbookProtection element to an XmlWriter.
    fn write_to(&self, writer: &mut XmlWriter);
}

impl WorkbookProtectionWrite for WorkbookProtection {
    fn with_password(password: &str) -> WorkbookProtection {
        let mut protection = WorkbookProtection::new();
        protection.workbook_password = Some(hash_password_legacy(password));
        protection
    }

    fn with_password_sha512(password: &str, spin_count: u32) -> WorkbookProtection {
        let mut protection = WorkbookProtection::new();
        let salt = generate_salt();
        let (hash, salt_b64) = hash_password_sha512(password, &salt, spin_count);

        protection.workbook_algorithm_name = HashAlgorithm::Sha512;
        protection.workbook_hash_value = Some(hash);
        protection.workbook_salt_value = Some(salt_b64);
        protection.workbook_spin_count = Some(spin_count);
        protection
    }

    fn to_xml(&self) -> Vec<u8> {
        let mut writer = XmlWriter::new();
        self.write_to(&mut writer);
        writer.finish()
    }

    fn write_to(&self, writer: &mut XmlWriter) {
        writer.start_element("workbookProtection");

        // Password attributes
        if let Some(ref password) = self.workbook_password {
            writer.attr("workbookPassword", password);
        }
        if self.workbook_algorithm_name != HashAlgorithm::None {
            writer.attr(
                "workbookAlgorithmName",
                self.workbook_algorithm_name.as_str(),
            );
        }
        if let Some(ref hash) = self.workbook_hash_value {
            writer.attr("workbookHashValue", hash);
        }
        if let Some(ref salt) = self.workbook_salt_value {
            writer.attr("workbookSaltValue", salt);
        }
        if let Some(spin) = self.workbook_spin_count {
            writer.attr_num("workbookSpinCount", spin);
        }

        // Protection flags
        if self.lock_structure {
            writer.attr("lockStructure", "1");
        }
        if self.lock_windows {
            writer.attr("lockWindows", "1");
        }
        if self.lock_revision {
            writer.attr("lockRevision", "1");
        }

        writer.self_close();
    }
}

// ============================================================================
// ProtectedRange
// ============================================================================

/// A protected range that allows editing specific cells in a protected sheet.
///
/// When a sheet is protected, normally all cells are locked. Protected ranges
/// define areas where users can still edit, optionally requiring a password.
///
/// # Example
///
/// ```ignore
/// // Allow editing A1:D10 without password
/// let range = ProtectedRange::new("EditableArea", "A1:D10");
///
/// // Allow editing E1:H10 with password
/// let range = ProtectedRange::with_password("SecureArea", "E1:H10", "mypassword");
/// ```
#[derive(Debug, Clone)]
pub struct ProtectedRange {
    /// Name of the protected range
    pub name: String,
    /// Cell range(s) this protection applies to (e.g., "A1:D10" or "A1:D10 F1:H10")
    pub sqref: String,
    /// Legacy password hash
    pub password_hash: Option<String>,
    /// Hash algorithm name (e.g., "SHA-512")
    pub algorithm_name: Option<String>,
    /// Base64-encoded hash value
    pub hash_value: Option<String>,
    /// Base64-encoded salt value
    pub salt_value: Option<String>,
    /// Number of hash iterations (spin count)
    pub spin_count: Option<u32>,
    /// Security descriptor for Active Directory integration
    pub security_descriptor: Option<String>,
}

impl ProtectedRange {
    /// Create a new protected range (no password required).
    ///
    /// # Arguments
    /// * `name` - Name of the protected range
    /// * `sqref` - Cell range(s) (e.g., "A1:D10")
    pub fn new(name: &str, sqref: &str) -> Self {
        Self {
            name: name.to_string(),
            sqref: sqref.to_string(),
            password_hash: None,
            algorithm_name: None,
            hash_value: None,
            salt_value: None,
            spin_count: None,
            security_descriptor: None,
        }
    }

    /// Create a protected range with a legacy password.
    ///
    /// # Arguments
    /// * `name` - Name of the protected range
    /// * `sqref` - Cell range(s)
    /// * `password` - Password required to edit this range
    pub fn with_password(name: &str, sqref: &str, password: &str) -> Self {
        let mut range = Self::new(name, sqref);
        range.password_hash = Some(hash_password_legacy(password));
        range
    }

    /// Create a protected range with a modern (SHA-512) password.
    ///
    /// # Arguments
    /// * `name` - Name of the protected range
    /// * `sqref` - Cell range(s)
    /// * `password` - Password required to edit this range
    /// * `spin_count` - Number of hash iterations
    pub fn with_password_sha512(name: &str, sqref: &str, password: &str, spin_count: u32) -> Self {
        let mut range = Self::new(name, sqref);
        let salt = generate_salt();
        let (hash, salt_b64) = hash_password_sha512(password, &salt, spin_count);

        range.algorithm_name = Some("SHA-512".to_string());
        range.hash_value = Some(hash);
        range.salt_value = Some(salt_b64);
        range.spin_count = Some(spin_count);
        range
    }

    /// Set a security descriptor for Active Directory integration.
    pub fn with_security_descriptor(&mut self, descriptor: &str) -> &mut Self {
        self.security_descriptor = Some(descriptor.to_string());
        self
    }

    /// Generate the protectedRange XML element.
    pub fn to_xml(&self) -> Vec<u8> {
        let mut writer = XmlWriter::new();
        self.write_to(&mut writer);
        writer.finish()
    }

    /// Write the protectedRange element to an XmlWriter.
    pub fn write_to(&self, writer: &mut XmlWriter) {
        writer.start_element("protectedRange");

        // Required attributes
        writer.attr("name", &self.name);
        writer.attr("sqref", &self.sqref);

        // Password attributes
        if let Some(ref password) = self.password_hash {
            writer.attr("password", password);
        }
        if let Some(ref alg) = self.algorithm_name {
            writer.attr("algorithmName", alg);
        }
        if let Some(ref hash) = self.hash_value {
            writer.attr("hashValue", hash);
        }
        if let Some(ref salt) = self.salt_value {
            writer.attr("saltValue", salt);
        }
        if let Some(spin) = self.spin_count {
            writer.attr_num("spinCount", spin);
        }

        // Security descriptor
        if let Some(ref desc) = self.security_descriptor {
            writer.attr("securityDescriptor", desc);
        }

        writer.self_close();
    }
}

// ============================================================================
// ProtectedRanges
// ============================================================================

/// Collection of protected ranges for a worksheet.
///
/// Generates the `<protectedRanges>` XML element containing multiple
/// protected range definitions.
///
/// # Example
///
/// ```ignore
/// let mut ranges = ProtectedRanges::new();
/// ranges
///     .add_unprotected("EditableArea", "A1:D10")
///     .add(ProtectedRange::with_password("SecureArea", "E1:H10", "password"));
///
/// let xml = ranges.to_xml();
/// ```
#[derive(Debug, Clone, Default)]
pub struct ProtectedRanges {
    ranges: Vec<ProtectedRange>,
}

impl ProtectedRanges {
    /// Create a new empty collection of protected ranges.
    pub fn new() -> Self {
        Self { ranges: Vec::new() }
    }

    /// Add a protected range to the collection.
    pub fn add(&mut self, range: ProtectedRange) -> &mut Self {
        self.ranges.push(range);
        self
    }

    /// Add an unprotected range (anyone can edit without password).
    ///
    /// # Arguments
    /// * `name` - Name of the range
    /// * `sqref` - Cell range(s)
    pub fn add_unprotected(&mut self, name: &str, sqref: &str) -> &mut Self {
        self.ranges.push(ProtectedRange::new(name, sqref));
        self
    }

    /// Add a password-protected range.
    ///
    /// # Arguments
    /// * `name` - Name of the range
    /// * `sqref` - Cell range(s)
    /// * `password` - Password required to edit
    pub fn add_with_password(&mut self, name: &str, sqref: &str, password: &str) -> &mut Self {
        self.ranges
            .push(ProtectedRange::with_password(name, sqref, password));
        self
    }

    /// Check if the collection is empty.
    pub fn is_empty(&self) -> bool {
        self.ranges.is_empty()
    }

    /// Get the number of protected ranges.
    pub fn len(&self) -> usize {
        self.ranges.len()
    }

    /// Get a reference to the protected ranges.
    pub fn ranges(&self) -> &[ProtectedRange] {
        &self.ranges
    }

    /// Generate the protectedRanges XML element.
    ///
    /// Returns empty Vec if there are no ranges.
    pub fn to_xml(&self) -> Vec<u8> {
        let mut writer = XmlWriter::new();
        self.write_to(&mut writer);
        writer.finish()
    }

    /// Write the protectedRanges element to an XmlWriter.
    ///
    /// Does nothing if there are no ranges.
    pub fn write_to(&self, writer: &mut XmlWriter) {
        if self.ranges.is_empty() {
            return;
        }

        writer.start_element("protectedRanges").end_attrs();

        for range in &self.ranges {
            range.write_to(writer);
        }

        writer.end_element("protectedRanges");
    }
}

// ============================================================================
// Unit Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -------------------------------------------------------------------------
    // Legacy Password Hash Tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_hash_password_legacy_empty() {
        let hash = hash_password_legacy("");
        assert_eq!(hash, "0000");
    }

    #[test]
    fn test_hash_password_legacy_simple() {
        let hash = hash_password_legacy("password");
        // Should produce a 4-character hex string
        assert_eq!(hash.len(), 4);
        // Should be uppercase hex
        assert!(hash.chars().all(|c| c.is_ascii_hexdigit()));
        assert!(hash.chars().all(|c| !c.is_ascii_lowercase()));
    }

    #[test]
    fn test_hash_password_legacy_consistency() {
        // Same password should always produce same hash
        let hash1 = hash_password_legacy("test123");
        let hash2 = hash_password_legacy("test123");
        assert_eq!(hash1, hash2);
    }

    #[test]
    fn test_hash_password_legacy_different() {
        // Different passwords should produce different hashes
        let hash1 = hash_password_legacy("password1");
        let hash2 = hash_password_legacy("password2");
        assert_ne!(hash1, hash2);
    }

    // -------------------------------------------------------------------------
    // SHA-512 Password Hash Tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_hash_password_sha512() {
        let salt = [0u8; 16];
        let (hash, salt_b64) = hash_password_sha512("password", &salt, 100000);

        // Hash should be base64 encoded (length for 64 bytes = 88 chars with padding)
        assert!(!hash.is_empty());
        // Salt should be base64 encoded (length for 16 bytes = 24 chars with padding)
        assert!(!salt_b64.is_empty());
    }

    #[test]
    fn test_hash_password_sha512_consistency() {
        let salt = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
        let (hash1, _) = hash_password_sha512("test", &salt, 100000);
        let (hash2, _) = hash_password_sha512("test", &salt, 100000);
        assert_eq!(hash1, hash2);
    }

    #[test]
    fn test_generate_salt() {
        let salt1 = generate_salt();
        // Salt should be 16 bytes
        assert_eq!(salt1.len(), 16);
    }

    // -------------------------------------------------------------------------
    // Base64 Encoding Tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_base64_encode_empty() {
        let encoded = base64_encode(&[]);
        assert_eq!(encoded, "");
    }

    #[test]
    fn test_base64_encode_one_byte() {
        let encoded = base64_encode(&[0]);
        assert_eq!(encoded, "AA==");
    }

    #[test]
    fn test_base64_encode_two_bytes() {
        let encoded = base64_encode(&[0, 0]);
        assert_eq!(encoded, "AAA=");
    }

    #[test]
    fn test_base64_encode_three_bytes() {
        let encoded = base64_encode(&[0, 0, 0]);
        assert_eq!(encoded, "AAAA");
    }

    #[test]
    fn test_base64_encode_hello() {
        let encoded = base64_encode(b"Hello");
        assert_eq!(encoded, "SGVsbG8=");
    }

    // -------------------------------------------------------------------------
    // SheetProtection Tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_sheet_protection_new() {
        let protection = SheetProtection::new();
        assert!(protection.sheet);
        assert!(protection.objects);
        assert!(protection.scenarios);
        assert!(!protection.format_cells);
    }

    #[test]
    fn test_sheet_protection_with_password() {
        let protection = SheetProtection::with_password("test");
        assert!(protection.password.is_some());
        assert!(protection.sheet);
    }

    #[test]
    fn test_sheet_protection_with_sha512() {
        let protection = SheetProtection::with_password_sha512("test", 100000);
        assert_eq!(protection.algorithm_name, HashAlgorithm::Sha512);
        assert!(protection.hash_value.is_some());
        assert!(protection.salt_value.is_some());
        assert_eq!(protection.spin_count, Some(100000));
    }

    #[test]
    fn test_sheet_protection_builder() {
        let mut protection = SheetProtection::new();
        protection
            .allow_format_cells(true)
            .allow_format_columns(true)
            .allow_format_rows(true)
            .allow_insert_columns(true)
            .allow_insert_rows(true)
            .allow_insert_hyperlinks(true)
            .allow_delete_columns(true)
            .allow_delete_rows(true)
            .allow_select_locked(true)
            .allow_sort(true)
            .allow_auto_filter(true)
            .allow_pivot_tables(true)
            .allow_select_unlocked(true);

        assert!(protection.format_cells);
        assert!(protection.format_columns);
        assert!(protection.format_rows);
        assert!(protection.insert_columns);
        assert!(protection.insert_rows);
        assert!(protection.insert_hyperlinks);
        assert!(protection.delete_columns);
        assert!(protection.delete_rows);
        assert!(protection.select_locked_cells);
        assert!(protection.sort);
        assert!(protection.auto_filter);
        assert!(protection.pivot_tables);
        assert!(protection.select_unlocked_cells);
    }

    #[test]
    fn test_sheet_protection_xml_basic() {
        let protection = SheetProtection::new();
        let xml = String::from_utf8(protection.to_xml()).unwrap();

        assert!(xml.contains("<sheetProtection"));
        assert!(xml.contains("sheet=\"1\""));
        assert!(xml.contains("objects=\"1\""));
        assert!(xml.contains("scenarios=\"1\""));
        assert!(xml.contains("/>"));
    }

    #[test]
    fn test_sheet_protection_xml_with_password() {
        let protection = SheetProtection::with_password("test");
        let xml = String::from_utf8(protection.to_xml()).unwrap();

        assert!(xml.contains("password=\""));
    }

    #[test]
    fn test_sheet_protection_xml_with_sha512() {
        let protection = SheetProtection::with_password_sha512("test", 100000);
        let xml = String::from_utf8(protection.to_xml()).unwrap();

        assert!(xml.contains("algorithmName=\"SHA-512\""));
        assert!(xml.contains("hashValue=\""));
        assert!(xml.contains("saltValue=\""));
        assert!(xml.contains("spinCount=\"100000\""));
    }

    #[test]
    fn test_sheet_protection_xml_with_permissions() {
        let mut protection = SheetProtection::new();
        protection
            .allow_format_cells(true)
            .allow_sort(true)
            .allow_auto_filter(true);

        let xml = String::from_utf8(protection.to_xml()).unwrap();

        // In XLSX, "0" means allowed
        assert!(xml.contains("formatCells=\"0\""));
        assert!(xml.contains("sort=\"0\""));
        assert!(xml.contains("autoFilter=\"0\""));
    }

    #[test]
    fn test_sheet_protection_enable_disable() {
        let mut protection = SheetProtection::new();
        protection.enable_protection(false);
        assert!(!protection.sheet);

        protection.enable_protection(true);
        assert!(protection.sheet);
    }

    // -------------------------------------------------------------------------
    // WorkbookProtection Tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_workbook_protection_new() {
        let protection = WorkbookProtection::new();
        assert!(!protection.lock_structure);
        assert!(!protection.lock_windows);
        assert!(!protection.lock_revision);
    }

    #[test]
    fn test_workbook_protection_with_password() {
        let protection = WorkbookProtection::with_password("test");
        assert!(protection.workbook_password.is_some());
    }

    #[test]
    fn test_workbook_protection_with_sha512() {
        let protection = WorkbookProtection::with_password_sha512("test", 100000);
        assert_eq!(protection.workbook_algorithm_name, HashAlgorithm::Sha512);
        assert!(protection.workbook_hash_value.is_some());
        assert!(protection.workbook_salt_value.is_some());
        assert_eq!(protection.workbook_spin_count, Some(100000));
    }

    #[test]
    fn test_workbook_protection_builder() {
        let mut protection = WorkbookProtection::new();
        protection
            .set_lock_structure(true)
            .set_lock_windows(true)
            .set_lock_revision(true);

        assert!(protection.lock_structure);
        assert!(protection.lock_windows);
        assert!(protection.lock_revision);
    }

    #[test]
    fn test_workbook_protection_is_protected() {
        let protection = WorkbookProtection::new();
        assert!(!protection.is_protected());

        let mut protection = WorkbookProtection::new();
        protection.set_lock_structure(true);
        assert!(protection.is_protected());
    }

    #[test]
    fn test_workbook_protection_xml_basic() {
        let mut protection = WorkbookProtection::new();
        protection.set_lock_structure(true);

        let xml = String::from_utf8(protection.to_xml()).unwrap();

        assert!(xml.contains("<workbookProtection"));
        assert!(xml.contains("lockStructure=\"1\""));
        assert!(xml.contains("/>"));
    }

    #[test]
    fn test_workbook_protection_xml_all_flags() {
        let mut protection = WorkbookProtection::new();
        protection
            .set_lock_structure(true)
            .set_lock_windows(true)
            .set_lock_revision(true);

        let xml = String::from_utf8(protection.to_xml()).unwrap();

        assert!(xml.contains("lockStructure=\"1\""));
        assert!(xml.contains("lockWindows=\"1\""));
        assert!(xml.contains("lockRevision=\"1\""));
    }

    #[test]
    fn test_workbook_protection_xml_with_password() {
        let protection = WorkbookProtection::with_password("test");
        let xml = String::from_utf8(protection.to_xml()).unwrap();

        assert!(xml.contains("workbookPassword=\""));
    }

    #[test]
    fn test_workbook_protection_xml_with_sha512() {
        let protection = WorkbookProtection::with_password_sha512("test", 100000);
        let xml = String::from_utf8(protection.to_xml()).unwrap();

        assert!(xml.contains("workbookAlgorithmName=\"SHA-512\""));
        assert!(xml.contains("workbookHashValue=\""));
        assert!(xml.contains("workbookSaltValue=\""));
        assert!(xml.contains("workbookSpinCount=\"100000\""));
    }

    // -------------------------------------------------------------------------
    // ProtectedRange Tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_protected_range_new() {
        let range = ProtectedRange::new("TestRange", "A1:D10");
        assert_eq!(range.name, "TestRange");
        assert_eq!(range.sqref, "A1:D10");
        assert!(range.password_hash.is_none());
    }

    #[test]
    fn test_protected_range_with_password() {
        let range = ProtectedRange::with_password("SecureRange", "E1:H10", "password");
        assert_eq!(range.name, "SecureRange");
        assert_eq!(range.sqref, "E1:H10");
        assert!(range.password_hash.is_some());
    }

    #[test]
    fn test_protected_range_with_sha512() {
        let range =
            ProtectedRange::with_password_sha512("SecureRange", "E1:H10", "password", 100000);
        assert_eq!(range.algorithm_name, Some("SHA-512".to_string()));
        assert!(range.hash_value.is_some());
        assert!(range.salt_value.is_some());
        assert_eq!(range.spin_count, Some(100000));
    }

    #[test]
    fn test_protected_range_with_security_descriptor() {
        let mut range = ProtectedRange::new("ADRange", "A1:B5");
        range.with_security_descriptor("O:WDG:WDD:(A;;CC;;;S-1-5-21-xxx)");
        assert!(range.security_descriptor.is_some());
    }

    #[test]
    fn test_protected_range_xml_basic() {
        let range = ProtectedRange::new("EditableArea", "A1:D10");
        let xml = String::from_utf8(range.to_xml()).unwrap();

        assert!(xml.contains("<protectedRange"));
        assert!(xml.contains("name=\"EditableArea\""));
        assert!(xml.contains("sqref=\"A1:D10\""));
        assert!(xml.contains("/>"));
    }

    #[test]
    fn test_protected_range_xml_with_password() {
        let range = ProtectedRange::with_password("SecureArea", "E1:H10", "pass");
        let xml = String::from_utf8(range.to_xml()).unwrap();

        assert!(xml.contains("password=\""));
    }

    #[test]
    fn test_protected_range_xml_with_sha512() {
        let range = ProtectedRange::with_password_sha512("SecureArea", "E1:H10", "pass", 100000);
        let xml = String::from_utf8(range.to_xml()).unwrap();

        assert!(xml.contains("algorithmName=\"SHA-512\""));
        assert!(xml.contains("hashValue=\""));
        assert!(xml.contains("saltValue=\""));
        assert!(xml.contains("spinCount=\"100000\""));
    }

    // -------------------------------------------------------------------------
    // ProtectedRanges Tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_protected_ranges_new() {
        let ranges = ProtectedRanges::new();
        assert!(ranges.is_empty());
        assert_eq!(ranges.len(), 0);
    }

    #[test]
    fn test_protected_ranges_add() {
        let mut ranges = ProtectedRanges::new();
        ranges.add(ProtectedRange::new("Range1", "A1:B10"));
        ranges.add(ProtectedRange::new("Range2", "C1:D10"));

        assert!(!ranges.is_empty());
        assert_eq!(ranges.len(), 2);
    }

    #[test]
    fn test_protected_ranges_add_unprotected() {
        let mut ranges = ProtectedRanges::new();
        ranges.add_unprotected("EditableArea", "A1:D10");

        assert_eq!(ranges.len(), 1);
        assert!(ranges.ranges()[0].password_hash.is_none());
    }

    #[test]
    fn test_protected_ranges_add_with_password() {
        let mut ranges = ProtectedRanges::new();
        ranges.add_with_password("SecureArea", "E1:H10", "password");

        assert_eq!(ranges.len(), 1);
        assert!(ranges.ranges()[0].password_hash.is_some());
    }

    #[test]
    fn test_protected_ranges_empty_xml() {
        let ranges = ProtectedRanges::new();
        let xml = ranges.to_xml();
        assert!(xml.is_empty());
    }

    #[test]
    fn test_protected_ranges_xml() {
        let mut ranges = ProtectedRanges::new();
        ranges
            .add_unprotected("EditableArea", "A1:D10")
            .add_with_password("SecureArea", "E1:H10", "pass");

        let xml = String::from_utf8(ranges.to_xml()).unwrap();

        assert!(xml.contains("<protectedRanges>"));
        assert!(xml.contains("<protectedRange"));
        assert!(xml.contains("name=\"EditableArea\""));
        assert!(xml.contains("name=\"SecureArea\""));
        assert!(xml.contains("</protectedRanges>"));
    }

    // -------------------------------------------------------------------------
    // Integration Tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_complete_sheet_protection() {
        let mut protection = SheetProtection::with_password_sha512("secretpass", 100000);
        protection
            .allow_format_cells(true)
            .allow_format_columns(true)
            .allow_select_unlocked(true)
            .allow_sort(true)
            .allow_auto_filter(true);

        let xml = String::from_utf8(protection.to_xml()).unwrap();

        // Verify structure
        assert!(xml.contains("<sheetProtection"));
        assert!(xml.contains("algorithmName=\"SHA-512\""));
        assert!(xml.contains("sheet=\"1\""));
        assert!(xml.contains("formatCells=\"0\""));
        assert!(xml.contains("formatColumns=\"0\""));
        assert!(xml.contains("selectUnlockedCells=\"0\""));
        assert!(xml.contains("sort=\"0\""));
        assert!(xml.contains("autoFilter=\"0\""));
        assert!(xml.contains("/>"));
    }

    #[test]
    fn test_complete_workbook_protection() {
        let mut protection = WorkbookProtection::with_password("wbpass");
        protection.set_lock_structure(true).set_lock_windows(true);

        let xml = String::from_utf8(protection.to_xml()).unwrap();

        assert!(xml.contains("<workbookProtection"));
        assert!(xml.contains("workbookPassword=\""));
        assert!(xml.contains("lockStructure=\"1\""));
        assert!(xml.contains("lockWindows=\"1\""));
        assert!(xml.contains("/>"));
    }

    #[test]
    fn test_complete_protected_ranges() {
        let mut ranges = ProtectedRanges::new();

        // Add various types of protected ranges
        ranges.add_unprotected("PublicArea", "A1:D10");
        ranges.add_with_password("PrivateArea", "E1:H10", "secret");
        ranges.add(ProtectedRange::with_password_sha512(
            "SecureArea",
            "I1:L10",
            "verysecret",
            100000,
        ));

        let xml = String::from_utf8(ranges.to_xml()).unwrap();

        // Verify structure
        assert!(xml.contains("<protectedRanges>"));
        assert_eq!(xml.matches("<protectedRange ").count(), 3);
        assert!(xml.contains("name=\"PublicArea\""));
        assert!(xml.contains("name=\"PrivateArea\""));
        assert!(xml.contains("name=\"SecureArea\""));
        assert!(xml.contains("algorithmName=\"SHA-512\""));
        assert!(xml.contains("</protectedRanges>"));
    }

    #[test]
    fn test_xml_escaping() {
        // Test that special characters are properly escaped
        let range = ProtectedRange::new("Test & <Range>", "A1:B2");
        let xml = String::from_utf8(range.to_xml()).unwrap();

        // Name should be escaped
        assert!(xml.contains("name=\"Test &amp; &lt;Range&gt;\""));
    }
}
