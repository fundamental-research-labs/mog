use super::{VbaProject, ole::parse_ole_document, signature::detect_signature_status};
use crate::domain::vba::constants::{
    OLE_MAGIC, SECTOR_SIZE_512, XLSM_CONTENT_TYPE, vba_project_path,
};
use crate::zip::XlsxArchive;

pub fn has_vba(archive: &XlsxArchive) -> bool {
    archive.contains(vba_project_path())
}

pub fn is_macro_enabled_workbook(archive: &XlsxArchive) -> bool {
    if let Ok(content_types) = archive.read_file("[Content_Types].xml") {
        content_types
            .windows(XLSM_CONTENT_TYPE.len())
            .any(|w| w == XLSM_CONTENT_TYPE.as_bytes())
    } else {
        false
    }
}

pub fn detect_vba(archive: &XlsxArchive) -> VbaProject {
    let mut project = VbaProject::default();

    let data = match archive.read_file(vba_project_path()) {
        Ok(d) => d,
        Err(_) => return project,
    };

    project.raw_size = data.len();

    if data.len() < SECTOR_SIZE_512 || !data.starts_with(&OLE_MAGIC) {
        return project;
    }

    parse_ole_document(&data, &mut project);
    project.signature_status = detect_signature_status(&data);

    project
}
