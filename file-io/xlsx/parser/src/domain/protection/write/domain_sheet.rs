use crate::write::xml_writer::XmlWriter;

/// Build `<sheetProtection .../>` XML string from `domain_types::SheetProtection`.
pub fn sheet_protection_xml_from_domain(prot: &domain_types::SheetProtection) -> String {
    let mut w = XmlWriter::new();
    w.start_element("sheetProtection");

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

    w.attr("sheet", "1");

    if prot.objects {
        w.attr("objects", "1");
    }
    if prot.scenarios {
        w.attr("scenarios", "1");
    }

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn domain_sheet_protection_emits_restriction_attributes_in_order() {
        let protection = domain_types::SheetProtection::default();

        assert_eq!(
            sheet_protection_xml_from_domain(&protection),
            "<sheetProtection sheet=\"1\" formatCells=\"1\" formatColumns=\"1\" formatRows=\"1\" insertColumns=\"1\" insertRows=\"1\" insertHyperlinks=\"1\" deleteColumns=\"1\" deleteRows=\"1\" sort=\"1\" autoFilter=\"1\" pivotTables=\"1\"/>"
        );
    }

    #[test]
    fn domain_sheet_protection_password_attributes_precede_flags() {
        let mut protection = domain_types::SheetProtection::default();
        protection.password_hash = Some("ABCD".to_string());
        protection.algorithm_name = Some("SHA-512".to_string());
        protection.hash_value = Some("hash".to_string());
        protection.salt_value = Some("salt".to_string());
        protection.spin_count = Some(100000);
        protection.objects = true;
        protection.scenarios = true;
        protection.format_cells = true;
        protection.select_locked = true;

        assert_eq!(
            sheet_protection_xml_from_domain(&protection),
            "<sheetProtection password=\"ABCD\" algorithmName=\"SHA-512\" hashValue=\"hash\" saltValue=\"salt\" spinCount=\"100000\" sheet=\"1\" objects=\"1\" scenarios=\"1\" formatCells=\"0\" formatColumns=\"1\" formatRows=\"1\" insertColumns=\"1\" insertRows=\"1\" insertHyperlinks=\"1\" deleteColumns=\"1\" deleteRows=\"1\" sort=\"1\" autoFilter=\"1\" pivotTables=\"1\"/>"
        );
    }
}
