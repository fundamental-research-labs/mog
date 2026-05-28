use crate::write::xml_writer::XmlWriter;

use super::{
    HashAlgorithm, SheetProtection, generate_salt, hash_password_legacy, hash_password_sha512,
};

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

        if self.sheet {
            writer.attr("sheet", "1");
        }

        if self.objects {
            writer.attr("objects", "1");
        }
        if self.scenarios {
            writer.attr("scenarios", "1");
        }

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sheet_protection_new() {
        let protection = SheetProtection::new();
        assert!(protection.sheet);
        assert!(protection.objects);
        assert!(protection.scenarios);
        assert!(!protection.format_cells);
    }

    #[test]
    fn sheet_protection_with_password() {
        let protection = SheetProtection::with_password("test");
        assert_eq!(protection.password, Some("CBEB".to_string()));
        assert!(protection.sheet);
    }

    #[test]
    fn sheet_protection_with_sha512() {
        let protection = SheetProtection::with_password_sha512("test", 100000);
        assert_eq!(protection.algorithm_name, HashAlgorithm::Sha512);
        assert!(protection.hash_value.is_some());
        assert!(protection.salt_value.is_some());
        assert_eq!(protection.spin_count, Some(100000));
    }

    #[test]
    fn sheet_protection_builder() {
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
    fn sheet_protection_xml_basic_exact_output() {
        let protection = SheetProtection::new();
        let xml = String::from_utf8(protection.to_xml()).unwrap();

        assert_eq!(
            xml,
            "<sheetProtection sheet=\"1\" objects=\"1\" scenarios=\"1\"/>"
        );
    }

    #[test]
    fn sheet_protection_xml_with_password() {
        let protection = SheetProtection::with_password("test");
        let xml = String::from_utf8(protection.to_xml()).unwrap();

        assert!(xml.contains("password=\"CBEB\""));
    }

    #[test]
    fn sheet_protection_xml_with_sha512() {
        let protection = SheetProtection::with_password_sha512("test", 100000);
        let xml = String::from_utf8(protection.to_xml()).unwrap();

        assert!(xml.contains("algorithmName=\"SHA-512\""));
        assert!(xml.contains("hashValue=\""));
        assert!(xml.contains("saltValue=\""));
        assert!(xml.contains("spinCount=\"100000\""));
    }

    #[test]
    fn sheet_protection_xml_with_permissions() {
        let mut protection = SheetProtection::new();
        protection
            .allow_format_cells(true)
            .allow_sort(true)
            .allow_auto_filter(true);

        let xml = String::from_utf8(protection.to_xml()).unwrap();

        assert!(xml.contains("formatCells=\"0\""));
        assert!(xml.contains("sort=\"0\""));
        assert!(xml.contains("autoFilter=\"0\""));
    }

    #[test]
    fn sheet_protection_enable_disable() {
        let mut protection = SheetProtection::new();
        protection.enable_protection(false);
        assert!(!protection.sheet);

        protection.enable_protection(true);
        assert!(protection.sheet);
    }
}
