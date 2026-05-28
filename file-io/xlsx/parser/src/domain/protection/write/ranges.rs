use crate::write::xml_writer::XmlWriter;

use super::{generate_salt, hash_password_legacy, hash_password_sha512};

/// A protected range that allows editing specific cells in a protected sheet.
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
    pub fn with_password(name: &str, sqref: &str, password: &str) -> Self {
        let mut range = Self::new(name, sqref);
        range.password_hash = Some(hash_password_legacy(password));
        range
    }

    /// Create a protected range with a modern (SHA-512) password.
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

        writer.attr("name", &self.name);
        writer.attr("sqref", &self.sqref);

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

        if let Some(ref desc) = self.security_descriptor {
            writer.attr("securityDescriptor", desc);
        }

        writer.self_close();
    }
}

/// Collection of protected ranges for a worksheet.
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
    pub fn add_unprotected(&mut self, name: &str, sqref: &str) -> &mut Self {
        self.ranges.push(ProtectedRange::new(name, sqref));
        self
    }

    /// Add a password-protected range.
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
    pub fn to_xml(&self) -> Vec<u8> {
        let mut writer = XmlWriter::new();
        self.write_to(&mut writer);
        writer.finish()
    }

    /// Write the protectedRanges element to an XmlWriter.
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protected_range_new() {
        let range = ProtectedRange::new("TestRange", "A1:D10");
        assert_eq!(range.name, "TestRange");
        assert_eq!(range.sqref, "A1:D10");
        assert!(range.password_hash.is_none());
    }

    #[test]
    fn protected_range_with_password() {
        let range = ProtectedRange::with_password("SecureRange", "E1:H10", "password");
        assert_eq!(range.name, "SecureRange");
        assert_eq!(range.sqref, "E1:H10");
        assert_eq!(range.password_hash, Some("83AF".to_string()));
    }

    #[test]
    fn protected_range_with_sha512() {
        let range =
            ProtectedRange::with_password_sha512("SecureRange", "E1:H10", "password", 100000);
        assert_eq!(range.algorithm_name, Some("SHA-512".to_string()));
        assert!(range.hash_value.is_some());
        assert!(range.salt_value.is_some());
        assert_eq!(range.spin_count, Some(100000));
    }

    #[test]
    fn protected_range_with_security_descriptor() {
        let mut range = ProtectedRange::new("ADRange", "A1:B5");
        range.with_security_descriptor("O:WDG:WDD:(A;;CC;;;S-1-5-21-xxx)");
        assert!(range.security_descriptor.is_some());
    }

    #[test]
    fn protected_range_xml_basic_exact_output() {
        let range = ProtectedRange::new("EditableArea", "A1:D10");
        let xml = String::from_utf8(range.to_xml()).unwrap();

        assert_eq!(
            xml,
            "<protectedRange name=\"EditableArea\" sqref=\"A1:D10\"/>"
        );
    }

    #[test]
    fn protected_range_xml_with_password() {
        let range = ProtectedRange::with_password("SecureArea", "E1:H10", "pass");
        let xml = String::from_utf8(range.to_xml()).unwrap();

        assert_eq!(
            xml,
            "<protectedRange name=\"SecureArea\" sqref=\"E1:H10\" password=\"CB83\"/>"
        );
    }

    #[test]
    fn protected_range_xml_with_sha512() {
        let range = ProtectedRange::with_password_sha512("SecureArea", "E1:H10", "pass", 100000);
        let xml = String::from_utf8(range.to_xml()).unwrap();

        assert!(xml.contains("algorithmName=\"SHA-512\""));
        assert!(xml.contains("hashValue=\""));
        assert!(xml.contains("saltValue=\""));
        assert!(xml.contains("spinCount=\"100000\""));
    }

    #[test]
    fn xml_escaping() {
        let range = ProtectedRange::new("Test & <Range>", "A1:B2");
        let xml = String::from_utf8(range.to_xml()).unwrap();

        assert!(xml.contains("name=\"Test &amp; &lt;Range&gt;\""));
    }

    #[test]
    fn protected_ranges_new() {
        let ranges = ProtectedRanges::new();
        assert!(ranges.is_empty());
        assert_eq!(ranges.len(), 0);
    }

    #[test]
    fn protected_ranges_add() {
        let mut ranges = ProtectedRanges::new();
        ranges.add(ProtectedRange::new("Range1", "A1:B10"));
        ranges.add(ProtectedRange::new("Range2", "C1:D10"));

        assert!(!ranges.is_empty());
        assert_eq!(ranges.len(), 2);
    }

    #[test]
    fn protected_ranges_add_unprotected() {
        let mut ranges = ProtectedRanges::new();
        ranges.add_unprotected("EditableArea", "A1:D10");

        assert_eq!(ranges.len(), 1);
        assert!(ranges.ranges()[0].password_hash.is_none());
    }

    #[test]
    fn protected_ranges_add_with_password() {
        let mut ranges = ProtectedRanges::new();
        ranges.add_with_password("SecureArea", "E1:H10", "password");

        assert_eq!(ranges.len(), 1);
        assert!(ranges.ranges()[0].password_hash.is_some());
    }

    #[test]
    fn protected_ranges_empty_xml() {
        let ranges = ProtectedRanges::new();
        let xml = ranges.to_xml();
        assert!(xml.is_empty());
    }

    #[test]
    fn protected_ranges_xml_preserves_order() {
        let mut ranges = ProtectedRanges::new();
        ranges
            .add_unprotected("EditableArea", "A1:D10")
            .add_with_password("SecureArea", "E1:H10", "pass");

        let xml = String::from_utf8(ranges.to_xml()).unwrap();

        assert_eq!(
            xml,
            "<protectedRanges><protectedRange name=\"EditableArea\" sqref=\"A1:D10\"/><protectedRange name=\"SecureArea\" sqref=\"E1:H10\" password=\"CB83\"/></protectedRanges>"
        );
    }
}
