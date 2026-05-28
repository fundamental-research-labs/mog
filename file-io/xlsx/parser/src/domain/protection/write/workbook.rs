use crate::write::xml_writer::XmlWriter;

use super::{
    HashAlgorithm, WorkbookProtection, generate_salt, hash_password_legacy, hash_password_sha512,
};

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

        if let Some(ref password) = self.workbook_password {
            writer.attr("workbookPassword", password);
        }
        if let Some(ref character_set) = self.workbook_password_character_set {
            writer.attr("workbookPasswordCharacterSet", character_set);
        }
        if let Some(ref password) = self.revisions_password {
            writer.attr("revisionsPassword", password);
        }
        if let Some(ref character_set) = self.revisions_password_character_set {
            writer.attr("revisionsPasswordCharacterSet", character_set);
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
        if self.revisions_algorithm_name != HashAlgorithm::None {
            writer.attr(
                "revisionsAlgorithmName",
                self.revisions_algorithm_name.as_str(),
            );
        }
        if let Some(ref hash) = self.revisions_hash_value {
            writer.attr("revisionsHashValue", hash);
        }
        if let Some(ref salt) = self.revisions_salt_value {
            writer.attr("revisionsSaltValue", salt);
        }
        if let Some(spin) = self.revisions_spin_count {
            writer.attr_num("revisionsSpinCount", spin);
        }

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workbook_protection_new() {
        let protection = WorkbookProtection::new();
        assert!(!protection.lock_structure);
        assert!(!protection.lock_windows);
        assert!(!protection.lock_revision);
    }

    #[test]
    fn workbook_protection_with_password() {
        let protection = WorkbookProtection::with_password("test");
        assert_eq!(protection.workbook_password, Some("CBEB".to_string()));
    }

    #[test]
    fn workbook_protection_with_sha512() {
        let protection = WorkbookProtection::with_password_sha512("test", 100000);
        assert_eq!(protection.workbook_algorithm_name, HashAlgorithm::Sha512);
        assert!(protection.workbook_hash_value.is_some());
        assert!(protection.workbook_salt_value.is_some());
        assert_eq!(protection.workbook_spin_count, Some(100000));
    }

    #[test]
    fn workbook_protection_builder() {
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
    fn workbook_protection_is_protected() {
        let protection = WorkbookProtection::new();
        assert!(!protection.is_protected());

        let mut protection = WorkbookProtection::new();
        protection.set_lock_structure(true);
        assert!(protection.is_protected());
    }

    #[test]
    fn workbook_protection_xml_basic_exact_output() {
        let mut protection = WorkbookProtection::new();
        protection.set_lock_structure(true);

        let xml = String::from_utf8(protection.to_xml()).unwrap();

        assert_eq!(xml, "<workbookProtection lockStructure=\"1\"/>");
    }

    #[test]
    fn workbook_protection_xml_all_flags() {
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
    fn workbook_protection_xml_with_password() {
        let protection = WorkbookProtection::with_password("test");
        let xml = String::from_utf8(protection.to_xml()).unwrap();

        assert!(xml.contains("workbookPassword=\"CBEB\""));
    }

    #[test]
    fn workbook_protection_xml_with_sha512() {
        let protection = WorkbookProtection::with_password_sha512("test", 100000);
        let xml = String::from_utf8(protection.to_xml()).unwrap();

        assert!(xml.contains("workbookAlgorithmName=\"SHA-512\""));
        assert!(xml.contains("workbookHashValue=\""));
        assert!(xml.contains("workbookSaltValue=\""));
        assert!(xml.contains("workbookSpinCount=\"100000\""));
    }
}
