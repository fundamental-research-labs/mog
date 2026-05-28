//! VBA project metadata types.

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vba_project_default() {
        let project = VbaProject::default();
        assert!(project.name.is_empty());
        assert!(project.modules.is_empty());
        assert!(project.references.is_empty());
        assert!(!project.is_protected);
        assert_eq!(project.signature_status, SignatureStatus::NotSigned);
        assert_eq!(project.raw_size, 0);
        assert_eq!(project.version, (0, 0));
        assert_eq!(project.code_page, 0);
    }

    #[test]
    fn test_vba_module_type_default() {
        let module = VbaModule::default();
        assert_eq!(module.module_type, VbaModuleType::Standard);
    }

    #[test]
    fn test_vba_reference_type_default() {
        let reference = VbaReference::default();
        assert_eq!(reference.ref_type, VbaReferenceType::Registered);
    }

    #[test]
    fn test_signature_status_default() {
        let project = VbaProject::default();
        assert_eq!(project.signature_status, SignatureStatus::NotSigned);
    }

    #[test]
    fn test_vba_relationship_default() {
        let rel = VbaRelationship::default();
        assert!(rel.id.is_empty());
        assert!(rel.target.is_empty());
        assert!(rel.rel_type.is_empty());
    }

    #[test]
    fn test_sheet_code_name_default() {
        let code_name = SheetCodeName::default();
        assert!(code_name.sheet_name.is_empty());
        assert!(code_name.code_name.is_empty());
        assert_eq!(code_name.sheet_index, 0);
    }

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
        assert!(reference.guid.starts_with('{'));
    }

    #[test]
    fn test_vba_project_clone() {
        let mut project = VbaProject {
            name: "Test".to_string(),
            ..Default::default()
        };
        project.modules.push(VbaModule {
            name: "Module1".to_string(),
            ..Default::default()
        });

        let cloned = project.clone();
        assert_eq!(cloned.name, project.name);
        assert_eq!(cloned.modules.len(), project.modules.len());
    }
}
