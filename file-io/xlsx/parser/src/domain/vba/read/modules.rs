use super::{VbaModule, VbaModuleType, VbaProject};

pub(super) fn determine_module_type(name: &str) -> VbaModuleType {
    let lower = name.to_lowercase();

    if lower == "thisworkbook" {
        VbaModuleType::ThisWorkbook
    } else if lower.starts_with("sheet") {
        VbaModuleType::Sheet
    } else if lower.starts_with("userform") {
        VbaModuleType::UserForm
    } else if lower.starts_with("class") {
        VbaModuleType::Class
    } else {
        VbaModuleType::Standard
    }
}

pub(super) fn detect_modules_from_raw(data: &[u8], project: &mut VbaProject) {
    if contains_utf16le(data, "ThisWorkbook") {
        project.modules.push(VbaModule {
            name: "ThisWorkbook".to_string(),
            module_type: VbaModuleType::ThisWorkbook,
            stream_name: "ThisWorkbook".to_string(),
            ..Default::default()
        });
    }

    detect_module_range(data, project, "Sheet", 20, VbaModuleType::Sheet);
    detect_module_range(data, project, "Module", 20, VbaModuleType::Standard);
    detect_module_range(data, project, "Class", 20, VbaModuleType::Class);
    detect_module_range(data, project, "UserForm", 10, VbaModuleType::UserForm);

    if project.name.is_empty() && contains_utf16le(data, "VBAProject") {
        project.name = "VBAProject".to_string();
    }
}

fn detect_module_range(
    data: &[u8],
    project: &mut VbaProject,
    prefix: &str,
    max: u32,
    module_type: VbaModuleType,
) {
    for i in 1..=max {
        let module_name = format!("{}{}", prefix, i);
        if contains_utf16le(data, &module_name)
            && !project.modules.iter().any(|m| m.name == module_name)
        {
            project.modules.push(VbaModule {
                name: module_name.clone(),
                module_type,
                stream_name: module_name,
                ..Default::default()
            });
        }
    }
}

pub(super) fn contains_utf16le(data: &[u8], needle: &str) -> bool {
    let utf16: Vec<u8> = needle
        .encode_utf16()
        .flat_map(|c| c.to_le_bytes())
        .collect();

    data.windows(utf16.len()).any(|w| w == utf16.as_slice())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utf16le(value: &str) -> Vec<u8> {
        value.encode_utf16().flat_map(|c| c.to_le_bytes()).collect()
    }

    #[test]
    fn test_contains_utf16le_basic() {
        let data = [0x54, 0x00, 0x65, 0x00, 0x73, 0x00, 0x74, 0x00];
        assert!(contains_utf16le(&data, "Test"));
        assert!(!contains_utf16le(&data, "Other"));
    }

    #[test]
    fn test_contains_utf16le_module_names() {
        let sheet1 = utf16le("Sheet1");
        assert!(contains_utf16le(&sheet1, "Sheet1"));
        assert!(!contains_utf16le(&sheet1, "Sheet2"));
    }

    #[test]
    fn test_contains_utf16le_embedded() {
        let mut data = vec![0u8; 100];
        let module1 = utf16le("Module1");
        data[50..50 + module1.len()].copy_from_slice(&module1);
        assert!(contains_utf16le(&data, "Module1"));
    }

    #[test]
    fn test_contains_utf16le_empty_data() {
        let data: [u8; 0] = [];
        assert!(!contains_utf16le(&data, "Test"));
    }

    #[test]
    fn test_determine_module_type() {
        assert_eq!(
            determine_module_type("ThisWorkbook"),
            VbaModuleType::ThisWorkbook
        );
        assert_eq!(determine_module_type("Sheet1"), VbaModuleType::Sheet);
        assert_eq!(determine_module_type("Sheet10"), VbaModuleType::Sheet);
        assert_eq!(determine_module_type("UserForm1"), VbaModuleType::UserForm);
        assert_eq!(determine_module_type("Class1"), VbaModuleType::Class);
        assert_eq!(determine_module_type("Module1"), VbaModuleType::Standard);
        assert_eq!(
            determine_module_type("CustomModule"),
            VbaModuleType::Standard
        );
    }

    #[test]
    fn test_determine_module_type_case_insensitive() {
        assert_eq!(
            determine_module_type("THISWORKBOOK"),
            VbaModuleType::ThisWorkbook
        );
        assert_eq!(determine_module_type("SHEET1"), VbaModuleType::Sheet);
    }

    #[test]
    fn test_detect_modules_from_raw_thisworkbook() {
        let mut data = vec![0u8; 500];
        let this_workbook = utf16le("ThisWorkbook");
        data[100..100 + this_workbook.len()].copy_from_slice(&this_workbook);

        let mut project = VbaProject::default();
        detect_modules_from_raw(&data, &mut project);

        assert_eq!(project.modules.len(), 1);
        assert_eq!(project.modules[0].name, "ThisWorkbook");
        assert_eq!(project.modules[0].module_type, VbaModuleType::ThisWorkbook);
    }

    #[test]
    fn test_detect_modules_from_raw_multiple() {
        let mut data = vec![0u8; 1000];

        let this_workbook = utf16le("ThisWorkbook");
        data[100..100 + this_workbook.len()].copy_from_slice(&this_workbook);
        let sheet1 = utf16le("Sheet1");
        data[300..300 + sheet1.len()].copy_from_slice(&sheet1);
        let module1 = utf16le("Module1");
        data[500..500 + module1.len()].copy_from_slice(&module1);
        let vba_project = utf16le("VBAProject");
        data[700..700 + vba_project.len()].copy_from_slice(&vba_project);

        let mut project = VbaProject::default();
        detect_modules_from_raw(&data, &mut project);

        assert_eq!(project.modules.len(), 3);
        assert_eq!(project.name, "VBAProject");

        let types: Vec<VbaModuleType> = project.modules.iter().map(|m| m.module_type).collect();
        assert!(types.contains(&VbaModuleType::ThisWorkbook));
        assert!(types.contains(&VbaModuleType::Sheet));
        assert!(types.contains(&VbaModuleType::Standard));
    }

    #[test]
    fn test_detect_modules_no_duplicates() {
        let mut data = vec![0u8; 500];
        let sheet1 = utf16le("Sheet1");
        data[100..100 + sheet1.len()].copy_from_slice(&sheet1);
        data[200..200 + sheet1.len()].copy_from_slice(&sheet1);

        let mut project = VbaProject::default();
        detect_modules_from_raw(&data, &mut project);

        let sheet1_count = project
            .modules
            .iter()
            .filter(|m| m.name == "Sheet1")
            .count();
        assert_eq!(sheet1_count, 1);
    }

    #[test]
    fn test_detect_modules_from_raw_boundaries() {
        let mut data = vec![0u8; 1000];
        let names = ["Sheet20", "Module20", "Class20", "UserForm10"];
        let mut offset = 100;
        for name in names {
            let encoded = utf16le(name);
            data[offset..offset + encoded.len()].copy_from_slice(&encoded);
            offset += 100;
        }

        let mut project = VbaProject::default();
        detect_modules_from_raw(&data, &mut project);

        assert!(project.modules.iter().any(|m| m.name == "Sheet20"));
        assert!(project.modules.iter().any(|m| m.name == "Module20"));
        assert!(project.modules.iter().any(|m| m.name == "Class20"));
        assert!(project.modules.iter().any(|m| m.name == "UserForm10"));
    }

    #[test]
    fn test_detect_modules_from_raw_out_of_range() {
        let mut data = vec![0u8; 300];
        let sheet21 = utf16le("Sheet21");
        data[100..100 + sheet21.len()].copy_from_slice(&sheet21);
        let userform11 = utf16le("UserForm11");
        data[200..200 + userform11.len()].copy_from_slice(&userform11);

        let mut project = VbaProject::default();
        detect_modules_from_raw(&data, &mut project);

        assert!(!project.modules.iter().any(|m| m.name == "Sheet21"));
        assert!(!project.modules.iter().any(|m| m.name == "UserForm11"));
    }
}
