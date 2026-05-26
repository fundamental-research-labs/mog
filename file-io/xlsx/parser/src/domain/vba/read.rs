//! VBA Project detection and metadata extraction for XLSM files.
//!
//! This module provides functionality to detect VBA macros in Excel files
//! and extract metadata about VBA projects. It parses the `vbaProject.bin`
//! file which is an OLE compound document embedded in XLSM files.
//!
//! # Security Note
//!
//! **This module does NOT execute VBA macros.** It only detects their presence
//! and extracts metadata for informational purposes. Macro execution is
//! intentionally not supported for security reasons. The parser treats all
//! VBA content as opaque binary data to be preserved or reported.
//!
//! # XLSM VBA Structure
//!
//! VBA projects in XLSM files are stored in `xl/vbaProject.bin` which is an
//! OLE (Object Linking and Embedding) compound document containing:
//!
//! - **VBA source code modules** - Standard modules, class modules, sheet modules
//! - **Project metadata** - Name, description, version info
//! - **References to external libraries** - COM libraries, ActiveX controls
//! - **Optional digital signatures** - Code signing for trusted macros
//!
//! The VBA project relationship is defined in `xl/_rels/workbook.xml.rels`:
//! ```xml
//! <Relationship Id="rId2"
//!     Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject"
//!     Target="vbaProject.bin"/>
//! ```
//!
//! # OLE Compound Document Format
//!
//! The vbaProject.bin uses the OLE Compound File Binary Format (CFB):
//! - 512-byte header with magic number and sector allocation table (SAT)
//! - Directory entries describing streams and storages
//! - VBA-specific streams: dir, PROJECT, VBA modules
//!
//! # Example Usage
//!
//! ```ignore
//! use xlsx_parser::vba::{has_vba, detect_vba, VbaProject, detect_vba_relationship};
//!
//! // Quick check for VBA presence
//! if has_vba(&archive) {
//!     let project = detect_vba(&archive);
//!     println!("VBA Project: {}", project.name);
//!     println!("Modules: {:?}", project.modules);
//!     println!("Signed: {:?}", project.signature_status);
//! }
//!
//! // Check relationship for VBA
//! if let Some(rel) = detect_vba_relationship(&archive) {
//!     println!("VBA target: {}", rel.target);
//! }
//! ```

use crate::infra::scanner::{extract_quoted_value, find_attr_simd, find_tag_simd};
use crate::zip::XlsxArchive;

// ============================================================================
// Core Data Structures
// ============================================================================

/// VBA project metadata extracted from vbaProject.bin.
///
/// Contains information about the VBA project including module names,
/// references, protection status, and digital signature information.
#[derive(Debug, Clone, Default)]
pub struct VbaProject {
    /// Name of the VBA project (typically "VBAProject")
    pub name: String,
    /// Description of the project
    pub description: String,
    /// Help context ID
    pub help_context_id: u32,
    /// VBA modules in the project
    pub modules: Vec<VbaModule>,
    /// External references (COM libraries, etc.)
    pub references: Vec<VbaReference>,
    /// Whether the project is protected/locked for viewing
    pub is_protected: bool,
    /// Digital signature status
    pub signature_status: SignatureStatus,
    /// Raw size of vbaProject.bin in bytes
    pub raw_size: usize,
    /// VBA project version (major, minor)
    pub version: (u16, u16),
    /// Code page for string encoding
    pub code_page: u16,
    /// Constants defined in the project
    pub constants: Vec<String>,
}

/// A VBA module (code unit) within a project.
///
/// Modules can be standard code modules, class modules,
/// document modules (attached to sheets/workbook), or UserForms.
#[derive(Debug, Clone, Default)]
pub struct VbaModule {
    /// Module name as it appears in the VBA editor
    pub name: String,
    /// Type of module (Standard, Class, Sheet, etc.)
    pub module_type: VbaModuleType,
    /// Stream name in the OLE document
    pub stream_name: String,
    /// Offset to module source in the dir stream
    pub text_offset: u32,
    /// Help context ID for this module
    pub help_context: u32,
    /// Whether the module is read-only
    pub is_readonly: bool,
    /// Whether the module is private
    pub is_private: bool,
}

/// Types of VBA modules in an Excel workbook.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum VbaModuleType {
    /// Standard code module (.bas) - general-purpose code
    #[default]
    Standard,
    /// Class module (.cls) - object-oriented code
    Class,
    /// ThisWorkbook module - attached to the workbook
    ThisWorkbook,
    /// Sheet module - attached to a worksheet
    Sheet,
    /// UserForm module (.frm) - visual dialog forms
    UserForm,
    /// Document module (generic) - attached to document objects
    Document,
}

/// External reference in a VBA project.
///
/// References link the VBA project to external COM libraries,
/// type libraries, or other VBA projects.
#[derive(Debug, Clone, Default)]
pub struct VbaReference {
    /// Reference name as it appears in VBA
    pub name: String,
    /// Description of the referenced library
    pub description: String,
    /// GUID of the referenced library (for registered references)
    pub guid: String,
    /// Type of reference
    pub ref_type: VbaReferenceType,
    /// Major version number
    pub major_version: u16,
    /// Minor version number
    pub minor_version: u16,
    /// Library ID (LCID)
    pub lcid: u32,
    /// Path to the library file (for project/control references)
    pub lib_path: String,
}

/// Types of VBA references to external libraries.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum VbaReferenceType {
    /// Registered COM library (TypeLib)
    #[default]
    Registered,
    /// Project reference (another VBA project)
    Project,
    /// ActiveX control reference
    Control,
    /// Original reference (legacy format)
    Original,
}

/// Digital signature status for a VBA project.
///
/// Macro signing provides a chain of trust for VBA code.
/// Note: This parser does not validate signatures cryptographically.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SignatureStatus {
    /// No digital signature present
    #[default]
    NotSigned,
    /// Signature data found (validity not verified)
    SignaturePresent,
    /// V3 signature format detected (Office 2010+)
    V3Signature,
    /// Agile signature format detected
    AgileSignature,
    /// Unable to determine signature status
    Unknown,
}

/// Relationship entry for VBA project in workbook.xml.rels.
#[derive(Debug, Clone, Default)]
pub struct VbaRelationship {
    /// Relationship ID (e.g., "rId2")
    pub id: String,
    /// Target path (e.g., "vbaProject.bin")
    pub target: String,
    /// Relationship type URI
    pub rel_type: String,
}

/// Sheet-to-VBA code name mapping.
///
/// Links worksheet names to their VBA module code names.
#[derive(Debug, Clone, Default)]
pub struct SheetCodeName {
    /// Sheet name as displayed in Excel
    pub sheet_name: String,
    /// Code name used in VBA (e.g., "Sheet1")
    pub code_name: String,
    /// Sheet index (1-based)
    pub sheet_index: u32,
}

// ============================================================================
// OLE Compound Document Constants
// ============================================================================

/// OLE compound document magic number (first 8 bytes).
const OLE_MAGIC: [u8; 8] = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];

/// Standard sector size (512 bytes).
const SECTOR_SIZE_512: usize = 512;

/// Mini sector size (64 bytes).
#[cfg(test)]
const MINI_SECTOR_SIZE: usize = 64;

/// Directory entry size (128 bytes).
const DIRECTORY_ENTRY_SIZE: usize = 128;

/// End of chain marker in FAT.
const END_OF_CHAIN: u32 = 0xFFFFFFFE;

/// Free sector marker in FAT.
#[allow(dead_code)]
const FREE_SECTOR: u32 = 0xFFFFFFFF;

/// VBA dir stream record types.
mod dir_record {
    #![allow(dead_code)] // Spec-complete set of OLE/VBA record type constants
    pub const PROJECT_NAME: u16 = 0x0004;
    pub const PROJECT_DOCSTRING: u16 = 0x0005;
    pub const PROJECT_HELPCONTEXT: u16 = 0x0006;
    pub const PROJECT_HELPFILE: u16 = 0x0007;
    pub const PROJECT_REFERENCES: u16 = 0x000F;
    pub const PROJECT_MODULES: u16 = 0x000F;
    pub const PROJECT_COOKIE: u16 = 0x0013;
    pub const MODULE_NAME: u16 = 0x0019;
    pub const MODULE_STREAM_NAME: u16 = 0x001A;
    pub const MODULE_DOC_STRING: u16 = 0x001C;
    pub const MODULE_OFFSET: u16 = 0x0031;
    pub const MODULE_PRIVATE: u16 = 0x0028;
    pub const MODULE_READONLY: u16 = 0x0025;
    pub const MODULE_TYPE_PROCEDURAL: u16 = 0x0021;
    pub const MODULE_TYPE_DOCUMENT: u16 = 0x0022;
    pub const REFERENCE_NAME: u16 = 0x0016;
    pub const REFERENCE_REGISTERED: u16 = 0x000D;
    pub const REFERENCE_PROJECT: u16 = 0x000E;
    pub const REFERENCE_CONTROL: u16 = 0x002F;
    pub const TERMINATOR: u16 = 0x0010;
    pub const CODE_PAGE: u16 = 0x0003;
}

/// Relationship type for VBA projects.
pub const VBA_RELATIONSHIP_TYPE: &str =
    "http://schemas.microsoft.com/office/2006/relationships/vbaProject";

/// Content type for macro-enabled workbooks.
pub const XLSM_CONTENT_TYPE: &str = "application/vnd.ms-excel.sheet.macroEnabled.main+xml";

// ============================================================================
// Public API
// ============================================================================

/// Check if an XLSX archive contains VBA macros.
///
/// This is a fast check that looks for the presence of `vbaProject.bin`
/// without fully parsing the OLE document.
///
/// # Arguments
///
/// * `archive` - Reference to an XlsxArchive
///
/// # Returns
///
/// `true` if VBA macros are present, `false` otherwise.
///
/// # Example
///
/// ```ignore
/// if has_vba(&archive) {
///     println!("This file contains macros!");
/// }
/// ```
pub fn has_vba(archive: &XlsxArchive) -> bool {
    archive.contains("xl/vbaProject.bin")
}

/// Check if the archive is a macro-enabled workbook (XLSM).
///
/// Examines the content types to determine if this is an XLSM file
/// rather than a standard XLSX.
///
/// # Arguments
///
/// * `archive` - Reference to an XlsxArchive
///
/// # Returns
///
/// `true` if this is a macro-enabled workbook.
pub fn is_macro_enabled_workbook(archive: &XlsxArchive) -> bool {
    if let Ok(content_types) = archive.read_file("[Content_Types].xml") {
        // Check for macro-enabled content type
        content_types
            .windows(XLSM_CONTENT_TYPE.len())
            .any(|w| w == XLSM_CONTENT_TYPE.as_bytes())
    } else {
        false
    }
}

/// Detect VBA project relationship from workbook relationships.
///
/// Parses `xl/_rels/workbook.xml.rels` to find the VBA project relationship.
///
/// # Arguments
///
/// * `archive` - Reference to an XlsxArchive
///
/// # Returns
///
/// `Some(VbaRelationship)` if a VBA relationship exists, `None` otherwise.
pub fn detect_vba_relationship(archive: &XlsxArchive) -> Option<VbaRelationship> {
    let rels_data = archive.read_file("xl/_rels/workbook.xml.rels").ok()?;

    parse_vba_relationship(&rels_data)
}

/// Parse VBA relationship from relationship XML bytes.
fn parse_vba_relationship(xml: &[u8]) -> Option<VbaRelationship> {
    let mut pos = 0;

    while let Some(rel_pos) = find_tag_simd(xml, b"Relationship", pos) {
        // Check if this is a VBA relationship
        if let Some(type_pos) = find_attr_simd(xml, b"Type=\"", rel_pos) {
            let type_start = type_pos + 6;
            if let Some((start, end)) = extract_quoted_value(xml, type_start) {
                let rel_type = String::from_utf8_lossy(&xml[start..end]);

                if rel_type.contains("vbaProject") {
                    // Extract Id and Target
                    let mut relationship = VbaRelationship {
                        rel_type: rel_type.into_owned(),
                        ..Default::default()
                    };

                    if let Some(id_pos) = find_attr_simd(xml, b"Id=\"", rel_pos) {
                        let id_start = id_pos + 4;
                        if let Some((s, e)) = extract_quoted_value(xml, id_start) {
                            relationship.id = String::from_utf8_lossy(&xml[s..e]).into_owned();
                        }
                    }

                    if let Some(target_pos) = find_attr_simd(xml, b"Target=\"", rel_pos) {
                        let target_start = target_pos + 8;
                        if let Some((s, e)) = extract_quoted_value(xml, target_start) {
                            relationship.target = String::from_utf8_lossy(&xml[s..e]).into_owned();
                        }
                    }

                    return Some(relationship);
                }
            }
        }

        pos = rel_pos + 1;
    }

    None
}

/// Detect and extract VBA project metadata from an XLSX archive.
///
/// Parses the `vbaProject.bin` OLE compound document to extract
/// project metadata, module information, and signature status.
///
/// # Arguments
///
/// * `archive` - Reference to an XlsxArchive
///
/// # Returns
///
/// A `VbaProject` struct with extracted metadata. If no VBA is present
/// or parsing fails, returns a default empty project.
///
/// # Example
///
/// ```ignore
/// let project = detect_vba(&archive);
/// for module in &project.modules {
///     println!("{}: {:?}", module.name, module.module_type);
/// }
/// ```
pub fn detect_vba(archive: &XlsxArchive) -> VbaProject {
    let mut project = VbaProject::default();

    // Try to read vbaProject.bin
    let data = match archive.read_file("xl/vbaProject.bin") {
        Ok(d) => d,
        Err(_) => return project,
    };

    project.raw_size = data.len();

    // Verify OLE magic number
    if data.len() < SECTOR_SIZE_512 || !data.starts_with(&OLE_MAGIC) {
        return project;
    }

    // Parse OLE compound document
    parse_ole_document(&data, &mut project);

    // Check for digital signature
    project.signature_status = detect_signature_status(&data);

    project
}

/// Extract sheet code names from the workbook XML.
///
/// Parses the workbook.xml to extract the code names assigned to each sheet,
/// which are used to reference sheets in VBA code.
///
/// # Arguments
///
/// * `archive` - Reference to an XlsxArchive
///
/// # Returns
///
/// A vector of `SheetCodeName` entries mapping sheets to their VBA code names.
pub fn extract_sheet_code_names(archive: &XlsxArchive) -> Vec<SheetCodeName> {
    let mut code_names = Vec::new();

    let workbook_xml = match archive.read_file("xl/workbook.xml") {
        Ok(xml) => xml,
        Err(_) => return code_names,
    };

    parse_sheet_code_names(&workbook_xml, &mut code_names);

    code_names
}

/// Parse sheet code names from workbook XML.
fn parse_sheet_code_names(xml: &[u8], code_names: &mut Vec<SheetCodeName>) {
    let mut pos = 0;
    let mut index = 0u32;

    while let Some(sheet_pos) = find_tag_simd(xml, b"sheet", pos) {
        index += 1;

        let mut sheet_code = SheetCodeName {
            sheet_index: index,
            ..Default::default()
        };

        // Extract sheet name
        if let Some(name_pos) = find_attr_simd(xml, b"name=\"", sheet_pos) {
            let name_start = name_pos + 6;
            if let Some((s, e)) = extract_quoted_value(xml, name_start) {
                sheet_code.sheet_name = String::from_utf8_lossy(&xml[s..e]).into_owned();
            }
        }

        // Extract code name (if present)
        if let Some(code_pos) = find_attr_simd(xml, b"codeName=\"", sheet_pos) {
            let code_start = code_pos + 10;
            if let Some((s, e)) = extract_quoted_value(xml, code_start) {
                sheet_code.code_name = String::from_utf8_lossy(&xml[s..e]).into_owned();
            }
        } else {
            // Default code name is Sheet{N}
            sheet_code.code_name = format!("Sheet{}", index);
        }

        code_names.push(sheet_code);
        pos = sheet_pos + 1;
    }
}

// ============================================================================
// OLE Compound Document Parsing
// ============================================================================

/// Parse OLE compound document structure.
fn parse_ole_document(data: &[u8], project: &mut VbaProject) {
    if data.len() < SECTOR_SIZE_512 {
        return;
    }

    // Parse OLE header
    let sector_shift = u16::from_le_bytes([data[30], data[31]]);
    let sector_size = 1usize << sector_shift;

    // Validate sector size
    if sector_size != SECTOR_SIZE_512 && sector_size != 4096 {
        return;
    }

    let mini_sector_shift = u16::from_le_bytes([data[32], data[33]]);
    let _mini_sector_size = 1usize << mini_sector_shift;

    // First directory sector
    let first_dir_sector = u32::from_le_bytes([data[48], data[49], data[50], data[51]]) as usize;

    // Number of FAT sectors
    let num_fat_sectors = u32::from_le_bytes([data[44], data[45], data[46], data[47]]) as usize;

    // First mini FAT sector
    let _first_mini_fat_sector =
        u32::from_le_bytes([data[60], data[61], data[62], data[63]]) as usize;

    // Build FAT from header DIFAT entries (first 109 sectors)
    let mut fat = Vec::new();
    for i in 0..num_fat_sectors.min(109) {
        let fat_sector_num = u32::from_le_bytes([
            data[76 + i * 4],
            data[77 + i * 4],
            data[78 + i * 4],
            data[79 + i * 4],
        ]);

        if fat_sector_num == END_OF_CHAIN || fat_sector_num == 0xFFFFFFFF {
            break;
        }

        // Read FAT sector
        let sector_offset = SECTOR_SIZE_512 + (fat_sector_num as usize * sector_size);
        if sector_offset + sector_size <= data.len() {
            for j in (0..sector_size).step_by(4) {
                if sector_offset + j + 4 <= data.len() {
                    let entry = u32::from_le_bytes([
                        data[sector_offset + j],
                        data[sector_offset + j + 1],
                        data[sector_offset + j + 2],
                        data[sector_offset + j + 3],
                    ]);
                    fat.push(entry);
                }
            }
        }
    }

    // Parse directory entries
    let dir_offset = SECTOR_SIZE_512 + (first_dir_sector * sector_size);
    if dir_offset >= data.len() {
        return;
    }

    parse_directory_entries(data, dir_offset, sector_size, &fat, project);
}

/// Parse directory entries from OLE compound document.
fn parse_directory_entries(
    data: &[u8],
    dir_offset: usize,
    sector_size: usize,
    _fat: &[u32],
    project: &mut VbaProject,
) {
    // Read directory entries from the directory sector
    let entries_per_sector = sector_size / DIRECTORY_ENTRY_SIZE;

    for i in 0..entries_per_sector {
        let entry_offset = dir_offset + (i * DIRECTORY_ENTRY_SIZE);
        if entry_offset + DIRECTORY_ENTRY_SIZE > data.len() {
            break;
        }

        // Read directory entry name (UTF-16LE, up to 64 bytes)
        let name_len =
            u16::from_le_bytes([data[entry_offset + 64], data[entry_offset + 65]]) as usize;

        if name_len == 0 || name_len > 64 {
            continue;
        }

        // Decode UTF-16LE name
        let name_bytes = &data[entry_offset..entry_offset + name_len.min(64)];
        let name = decode_utf16le(name_bytes);

        // Entry type: 1 = storage, 2 = stream, 5 = root
        let entry_type = data[entry_offset + 66];

        // Stream start sector
        let _start_sector = u32::from_le_bytes([
            data[entry_offset + 116],
            data[entry_offset + 117],
            data[entry_offset + 118],
            data[entry_offset + 119],
        ]);

        // Stream size
        let _stream_size = u32::from_le_bytes([
            data[entry_offset + 120],
            data[entry_offset + 121],
            data[entry_offset + 122],
            data[entry_offset + 123],
        ]);

        // Process based on entry name
        match name.as_str() {
            "PROJECT" => {
                // PROJECT stream contains project metadata
                project.name = "VBAProject".to_string();
            }
            "dir" => {
                // dir stream contains module information
                // Would need to decompress and parse
            }
            "VBA" => {
                // VBA storage - contains module streams
                if entry_type == 1 {
                    // Storage entry
                }
            }
            _ => {
                // Check if this is a module stream
                if entry_type == 2 && !name.starts_with('_') && name != "dir" && name != "PROJECT" {
                    // This might be a module
                    let module_type = determine_module_type(&name);
                    project.modules.push(VbaModule {
                        name: name.clone(),
                        module_type,
                        stream_name: name,
                        ..Default::default()
                    });
                }
            }
        }
    }

    // Also detect modules from raw data patterns if none found
    if project.modules.is_empty() {
        detect_modules_from_raw(data, project);
    }
}

/// Determine VBA module type from name.
fn determine_module_type(name: &str) -> VbaModuleType {
    let lower = name.to_lowercase();

    if lower == "thisworkbook" {
        VbaModuleType::ThisWorkbook
    } else if lower.starts_with("sheet") {
        VbaModuleType::Sheet
    } else if lower.starts_with("userform") {
        VbaModuleType::UserForm
    } else if lower.starts_with("class") {
        VbaModuleType::Class
    } else if lower.starts_with("module") {
        VbaModuleType::Standard
    } else {
        VbaModuleType::Standard
    }
}

/// Decode UTF-16LE bytes to String.
fn decode_utf16le(bytes: &[u8]) -> String {
    let u16_chars: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
        .take_while(|&c| c != 0)
        .collect();

    String::from_utf16_lossy(&u16_chars)
}

/// Detect VBA modules from raw binary data patterns.
///
/// This is a heuristic approach that looks for module name patterns
/// in the raw OLE data without full stream parsing.
fn detect_modules_from_raw(data: &[u8], project: &mut VbaProject) {
    // Look for "ThisWorkbook" pattern (UTF-16LE)
    if contains_utf16le(data, "ThisWorkbook") {
        project.modules.push(VbaModule {
            name: "ThisWorkbook".to_string(),
            module_type: VbaModuleType::ThisWorkbook,
            stream_name: "ThisWorkbook".to_string(),
            ..Default::default()
        });
    }

    // Look for "Sheet" patterns (up to Sheet20)
    for i in 1..=20 {
        let sheet_name = format!("Sheet{}", i);
        if contains_utf16le(data, &sheet_name) {
            // Avoid duplicates
            if !project.modules.iter().any(|m| m.name == sheet_name) {
                project.modules.push(VbaModule {
                    name: sheet_name.clone(),
                    module_type: VbaModuleType::Sheet,
                    stream_name: sheet_name,
                    ..Default::default()
                });
            }
        }
    }

    // Look for "Module" patterns (standard modules)
    for i in 1..=20 {
        let module_name = format!("Module{}", i);
        if contains_utf16le(data, &module_name) {
            if !project.modules.iter().any(|m| m.name == module_name) {
                project.modules.push(VbaModule {
                    name: module_name.clone(),
                    module_type: VbaModuleType::Standard,
                    stream_name: module_name,
                    ..Default::default()
                });
            }
        }
    }

    // Look for "Class" patterns
    for i in 1..=20 {
        let class_name = format!("Class{}", i);
        if contains_utf16le(data, &class_name) {
            if !project.modules.iter().any(|m| m.name == class_name) {
                project.modules.push(VbaModule {
                    name: class_name.clone(),
                    module_type: VbaModuleType::Class,
                    stream_name: class_name,
                    ..Default::default()
                });
            }
        }
    }

    // Look for "UserForm" patterns
    for i in 1..=10 {
        let form_name = format!("UserForm{}", i);
        if contains_utf16le(data, &form_name) {
            if !project.modules.iter().any(|m| m.name == form_name) {
                project.modules.push(VbaModule {
                    name: form_name.clone(),
                    module_type: VbaModuleType::UserForm,
                    stream_name: form_name,
                    ..Default::default()
                });
            }
        }
    }

    // Try to extract project name
    if project.name.is_empty() {
        if contains_utf16le(data, "VBAProject") {
            project.name = "VBAProject".to_string();
        }
    }
}

/// Check if data contains a UTF-16LE encoded string.
fn contains_utf16le(data: &[u8], needle: &str) -> bool {
    let utf16: Vec<u8> = needle
        .encode_utf16()
        .flat_map(|c| c.to_le_bytes())
        .collect();

    data.windows(utf16.len()).any(|w| w == utf16.as_slice())
}

/// Detect digital signature status from raw OLE data.
fn detect_signature_status(data: &[u8]) -> SignatureStatus {
    // Check for various signature stream patterns

    // V3 signature (Office 2010+)
    if contains_utf16le(data, "_VBA_PROJECT_CUR") && contains_utf16le(data, "VBASigDataV3") {
        return SignatureStatus::V3Signature;
    }

    // Agile signature
    if contains_utf16le(data, "VBASigDataAgile") {
        return SignatureStatus::AgileSignature;
    }

    // Standard signature
    if contains_utf16le(data, "VBASigData") || contains_utf16le(data, "_VBA_PROJECT_CUR") {
        return SignatureStatus::SignaturePresent;
    }

    SignatureStatus::NotSigned
}

// ============================================================================
// Utility Functions
// ============================================================================

/// Get the standard VBA project path in XLSX archives.
#[inline]
pub fn vba_project_path() -> &'static str {
    "xl/vbaProject.bin"
}

/// Get the workbook relationships path.
#[inline]
pub fn workbook_rels_path() -> &'static str {
    "xl/_rels/workbook.xml.rels"
}

/// Check if a file extension indicates a macro-enabled format.
pub fn is_macro_extension(extension: &str) -> bool {
    let lower = extension.to_lowercase();
    matches!(lower.as_str(), "xlsm" | "xltm" | "xlam" | "xlsb")
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -------------------------------------------------------------------------
    // OLE Magic and Constants Tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_ole_magic() {
        assert_eq!(OLE_MAGIC.len(), 8);
        assert_eq!(OLE_MAGIC[0], 0xD0);
        assert_eq!(OLE_MAGIC[7], 0xE1);
    }

    #[test]
    fn test_sector_constants() {
        assert_eq!(SECTOR_SIZE_512, 512);
        assert_eq!(MINI_SECTOR_SIZE, 64);
        assert_eq!(DIRECTORY_ENTRY_SIZE, 128);
        assert_eq!(END_OF_CHAIN, 0xFFFFFFFE);
    }

    // -------------------------------------------------------------------------
    // UTF-16LE Encoding Tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_contains_utf16le_basic() {
        // "Test" in UTF-16LE: T=0x54, e=0x65, s=0x73, t=0x74
        let data = [0x54, 0x00, 0x65, 0x00, 0x73, 0x00, 0x74, 0x00];
        assert!(contains_utf16le(&data, "Test"));
        assert!(!contains_utf16le(&data, "Other"));
    }

    #[test]
    fn test_contains_utf16le_module_names() {
        // "Sheet1" in UTF-16LE
        let sheet1: Vec<u8> = "Sheet1"
            .encode_utf16()
            .flat_map(|c| c.to_le_bytes())
            .collect();
        assert!(contains_utf16le(&sheet1, "Sheet1"));
        assert!(!contains_utf16le(&sheet1, "Sheet2"));
    }

    #[test]
    fn test_contains_utf16le_embedded() {
        // Embed "Module1" in larger data
        let mut data = vec![0u8; 100];
        let module1: Vec<u8> = "Module1"
            .encode_utf16()
            .flat_map(|c| c.to_le_bytes())
            .collect();
        data[50..50 + module1.len()].copy_from_slice(&module1);

        assert!(contains_utf16le(&data, "Module1"));
    }

    #[test]
    fn test_decode_utf16le() {
        // "Test" with null terminator
        let data = [0x54, 0x00, 0x65, 0x00, 0x73, 0x00, 0x74, 0x00, 0x00, 0x00];
        assert_eq!(decode_utf16le(&data), "Test");
    }

    #[test]
    fn test_decode_utf16le_empty() {
        let data = [0x00, 0x00];
        assert_eq!(decode_utf16le(&data), "");
    }

    // -------------------------------------------------------------------------
    // VBA Module Type Tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_vba_module_type_default() {
        let module = VbaModule::default();
        assert_eq!(module.module_type, VbaModuleType::Standard);
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

    // -------------------------------------------------------------------------
    // Signature Status Tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_signature_status_default() {
        let project = VbaProject::default();
        assert_eq!(project.signature_status, SignatureStatus::NotSigned);
    }

    #[test]
    fn test_detect_signature_status_not_signed() {
        let data = vec![0u8; 1000];
        assert_eq!(detect_signature_status(&data), SignatureStatus::NotSigned);
    }

    #[test]
    fn test_detect_signature_status_v3() {
        let mut data = vec![0u8; 1000];

        // Insert "_VBA_PROJECT_CUR" in UTF-16LE
        let vba_cur: Vec<u8> = "_VBA_PROJECT_CUR"
            .encode_utf16()
            .flat_map(|c| c.to_le_bytes())
            .collect();
        data[100..100 + vba_cur.len()].copy_from_slice(&vba_cur);

        // Insert "VBASigDataV3" in UTF-16LE
        let sig_v3: Vec<u8> = "VBASigDataV3"
            .encode_utf16()
            .flat_map(|c| c.to_le_bytes())
            .collect();
        data[300..300 + sig_v3.len()].copy_from_slice(&sig_v3);

        assert_eq!(detect_signature_status(&data), SignatureStatus::V3Signature);
    }

    #[test]
    fn test_detect_signature_status_agile() {
        let mut data = vec![0u8; 500];

        let sig_agile: Vec<u8> = "VBASigDataAgile"
            .encode_utf16()
            .flat_map(|c| c.to_le_bytes())
            .collect();
        data[100..100 + sig_agile.len()].copy_from_slice(&sig_agile);

        assert_eq!(
            detect_signature_status(&data),
            SignatureStatus::AgileSignature
        );
    }

    // -------------------------------------------------------------------------
    // VbaProject Default Tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_vba_project_default() {
        let project = VbaProject::default();
        assert!(project.name.is_empty());
        assert!(project.modules.is_empty());
        assert!(project.references.is_empty());
        assert!(!project.is_protected);
        assert_eq!(project.raw_size, 0);
        assert_eq!(project.version, (0, 0));
        assert_eq!(project.code_page, 0);
    }

    #[test]
    fn test_vba_reference_type_default() {
        let reference = VbaReference::default();
        assert_eq!(reference.ref_type, VbaReferenceType::Registered);
    }

    // -------------------------------------------------------------------------
    // VbaRelationship Tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_vba_relationship_default() {
        let rel = VbaRelationship::default();
        assert!(rel.id.is_empty());
        assert!(rel.target.is_empty());
        assert!(rel.rel_type.is_empty());
    }

    #[test]
    fn test_parse_vba_relationship() {
        let xml = br#"<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/>
</Relationships>"#;

        let rel = parse_vba_relationship(xml);
        assert!(rel.is_some());

        let rel = rel.unwrap();
        assert_eq!(rel.id, "rId2");
        assert_eq!(rel.target, "vbaProject.bin");
        assert!(rel.rel_type.contains("vbaProject"));
    }

    #[test]
    fn test_parse_vba_relationship_not_found() {
        let xml = br#"<?xml version="1.0"?>
<Relationships>
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>"#;

        let rel = parse_vba_relationship(xml);
        assert!(rel.is_none());
    }

    // -------------------------------------------------------------------------
    // SheetCodeName Tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_sheet_code_name_default() {
        let code_name = SheetCodeName::default();
        assert!(code_name.sheet_name.is_empty());
        assert!(code_name.code_name.is_empty());
        assert_eq!(code_name.sheet_index, 0);
    }

    #[test]
    fn test_parse_sheet_code_names() {
        let xml = br#"<?xml version="1.0"?>
<workbook>
  <sheets>
    <sheet name="Sales Data" sheetId="1" codeName="Sheet1"/>
    <sheet name="Summary" sheetId="2" codeName="SummarySheet"/>
    <sheet name="Raw" sheetId="3"/>
  </sheets>
</workbook>"#;

        let mut code_names = Vec::new();
        parse_sheet_code_names(xml, &mut code_names);

        assert_eq!(code_names.len(), 3);

        assert_eq!(code_names[0].sheet_name, "Sales Data");
        assert_eq!(code_names[0].code_name, "Sheet1");
        assert_eq!(code_names[0].sheet_index, 1);

        assert_eq!(code_names[1].sheet_name, "Summary");
        assert_eq!(code_names[1].code_name, "SummarySheet");

        // Third sheet has no codeName, should default to Sheet3
        assert_eq!(code_names[2].sheet_name, "Raw");
        assert_eq!(code_names[2].code_name, "Sheet3");
    }

    // -------------------------------------------------------------------------
    // Utility Function Tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_vba_project_path() {
        assert_eq!(vba_project_path(), "xl/vbaProject.bin");
    }

    #[test]
    fn test_workbook_rels_path() {
        assert_eq!(workbook_rels_path(), "xl/_rels/workbook.xml.rels");
    }

    #[test]
    fn test_is_macro_extension() {
        assert!(is_macro_extension("xlsm"));
        assert!(is_macro_extension("XLSM"));
        assert!(is_macro_extension("xltm"));
        assert!(is_macro_extension("xlam"));
        assert!(is_macro_extension("xlsb"));

        assert!(!is_macro_extension("xlsx"));
        assert!(!is_macro_extension("xls"));
        assert!(!is_macro_extension("csv"));
    }

    // -------------------------------------------------------------------------
    // Module Detection Tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_detect_modules_from_raw_thisworkbook() {
        let mut data = vec![0u8; 500];
        let this_workbook: Vec<u8> = "ThisWorkbook"
            .encode_utf16()
            .flat_map(|c| c.to_le_bytes())
            .collect();
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

        // Add ThisWorkbook
        let this_workbook: Vec<u8> = "ThisWorkbook"
            .encode_utf16()
            .flat_map(|c| c.to_le_bytes())
            .collect();
        data[100..100 + this_workbook.len()].copy_from_slice(&this_workbook);

        // Add Sheet1
        let sheet1: Vec<u8> = "Sheet1"
            .encode_utf16()
            .flat_map(|c| c.to_le_bytes())
            .collect();
        data[300..300 + sheet1.len()].copy_from_slice(&sheet1);

        // Add Module1
        let module1: Vec<u8> = "Module1"
            .encode_utf16()
            .flat_map(|c| c.to_le_bytes())
            .collect();
        data[500..500 + module1.len()].copy_from_slice(&module1);

        // Add VBAProject name
        let vba_project: Vec<u8> = "VBAProject"
            .encode_utf16()
            .flat_map(|c| c.to_le_bytes())
            .collect();
        data[700..700 + vba_project.len()].copy_from_slice(&vba_project);

        let mut project = VbaProject::default();
        detect_modules_from_raw(&data, &mut project);

        assert_eq!(project.modules.len(), 3);
        assert_eq!(project.name, "VBAProject");

        // Check module types
        let types: Vec<VbaModuleType> = project.modules.iter().map(|m| m.module_type).collect();
        assert!(types.contains(&VbaModuleType::ThisWorkbook));
        assert!(types.contains(&VbaModuleType::Sheet));
        assert!(types.contains(&VbaModuleType::Standard));
    }

    #[test]
    fn test_detect_modules_no_duplicates() {
        let mut data = vec![0u8; 500];

        // Add Sheet1 twice in different locations
        let sheet1: Vec<u8> = "Sheet1"
            .encode_utf16()
            .flat_map(|c| c.to_le_bytes())
            .collect();
        data[100..100 + sheet1.len()].copy_from_slice(&sheet1);
        data[200..200 + sheet1.len()].copy_from_slice(&sheet1);

        let mut project = VbaProject::default();
        detect_modules_from_raw(&data, &mut project);

        // Should only have one Sheet1 module
        let sheet1_count = project
            .modules
            .iter()
            .filter(|m| m.name == "Sheet1")
            .count();
        assert_eq!(sheet1_count, 1);
    }

    // -------------------------------------------------------------------------
    // OLE Header Parsing Tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_ole_magic_validation() {
        // Valid OLE header start
        let mut data = vec![0u8; 512];
        data[..8].copy_from_slice(&OLE_MAGIC);
        assert!(data.starts_with(&OLE_MAGIC));

        // Invalid header
        let invalid = vec![0u8; 512];
        assert!(!invalid.starts_with(&OLE_MAGIC));
    }

    #[test]
    fn test_ole_document_too_small() {
        let small_data = vec![0u8; 100];
        let mut project = VbaProject::default();
        parse_ole_document(&small_data, &mut project);

        // Should not crash, just return empty project
        assert!(project.modules.is_empty());
    }

    // -------------------------------------------------------------------------
    // Relationship Type Constants Tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_vba_relationship_type_constant() {
        assert_eq!(
            VBA_RELATIONSHIP_TYPE,
            "http://schemas.microsoft.com/office/2006/relationships/vbaProject"
        );
    }

    #[test]
    fn test_xlsm_content_type_constant() {
        assert_eq!(
            XLSM_CONTENT_TYPE,
            "application/vnd.ms-excel.sheet.macroEnabled.main+xml"
        );
    }

    // -------------------------------------------------------------------------
    // VbaModule Field Tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_vba_module_fields() {
        let module = VbaModule {
            name: "TestModule".to_string(),
            module_type: VbaModuleType::Class,
            stream_name: "TestModule".to_string(),
            text_offset: 1024,
            help_context: 42,
            is_readonly: true,
            is_private: false,
        };

        assert_eq!(module.name, "TestModule");
        assert_eq!(module.module_type, VbaModuleType::Class);
        assert_eq!(module.text_offset, 1024);
        assert_eq!(module.help_context, 42);
        assert!(module.is_readonly);
        assert!(!module.is_private);
    }

    // -------------------------------------------------------------------------
    // VbaReference Field Tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_vba_reference_fields() {
        let reference = VbaReference {
            name: "VBA".to_string(),
            description: "Visual Basic For Applications".to_string(),
            guid: "{000204EF-0000-0000-C000-000000000046}".to_string(),
            ref_type: VbaReferenceType::Registered,
            major_version: 4,
            minor_version: 2,
            lcid: 0,
            lib_path: String::new(),
        };

        assert_eq!(reference.name, "VBA");
        assert_eq!(reference.major_version, 4);
        assert_eq!(reference.minor_version, 2);
        assert!(reference.guid.starts_with("{"));
    }

    // -------------------------------------------------------------------------
    // Dir Record Constants Tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_dir_record_constants() {
        assert_eq!(dir_record::PROJECT_NAME, 0x0004);
        assert_eq!(dir_record::MODULE_NAME, 0x0019);
        assert_eq!(dir_record::TERMINATOR, 0x0010);
        assert_eq!(dir_record::CODE_PAGE, 0x0003);
    }

    // -------------------------------------------------------------------------
    // VbaProject Clone Tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_vba_project_clone() {
        let mut project = VbaProject::default();
        project.name = "Test".to_string();
        project.modules.push(VbaModule {
            name: "Module1".to_string(),
            ..Default::default()
        });

        let cloned = project.clone();
        assert_eq!(cloned.name, project.name);
        assert_eq!(cloned.modules.len(), project.modules.len());
    }

    // -------------------------------------------------------------------------
    // Edge Case Tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_empty_xml_relationship() {
        let xml = b"";
        let rel = parse_vba_relationship(xml);
        assert!(rel.is_none());
    }

    #[test]
    fn test_malformed_xml_relationship() {
        let xml = b"<not valid xml";
        let rel = parse_vba_relationship(xml);
        assert!(rel.is_none());
    }

    #[test]
    fn test_sheet_code_names_empty_xml() {
        let xml = b"";
        let mut code_names = Vec::new();
        parse_sheet_code_names(xml, &mut code_names);
        assert!(code_names.is_empty());
    }

    #[test]
    fn test_contains_utf16le_empty() {
        let data: [u8; 0] = [];
        assert!(!contains_utf16le(&data, "Test"));
    }

    #[test]
    fn test_is_macro_extension_empty() {
        assert!(!is_macro_extension(""));
    }
}
