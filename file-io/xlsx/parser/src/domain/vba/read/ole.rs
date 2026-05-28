use super::{
    VbaModule, VbaProject,
    modules::{detect_modules_from_raw, determine_module_type},
};
use crate::domain::vba::constants::{
    DIRECTORY_ENTRY_SIZE, END_OF_CHAIN, OLE_MAGIC, SECTOR_SIZE_512,
};

pub(super) fn parse_ole_document(data: &[u8], project: &mut VbaProject) {
    if data.len() < SECTOR_SIZE_512 {
        return;
    }

    let sector_shift = u16::from_le_bytes([data[30], data[31]]);
    let sector_size = 1usize << sector_shift;

    if sector_size != SECTOR_SIZE_512 && sector_size != 4096 {
        return;
    }

    let mini_sector_shift = u16::from_le_bytes([data[32], data[33]]);
    let _mini_sector_size = 1usize << mini_sector_shift;

    let first_dir_sector = u32::from_le_bytes([data[48], data[49], data[50], data[51]]) as usize;
    let num_fat_sectors = u32::from_le_bytes([data[44], data[45], data[46], data[47]]) as usize;
    let _first_mini_fat_sector =
        u32::from_le_bytes([data[60], data[61], data[62], data[63]]) as usize;

    let mut fat = Vec::new();
    for i in 0..num_fat_sectors.min(109) {
        let difat_offset = 76 + i * 4;
        let fat_sector_num = u32::from_le_bytes([
            data[difat_offset],
            data[difat_offset + 1],
            data[difat_offset + 2],
            data[difat_offset + 3],
        ]);

        if fat_sector_num == END_OF_CHAIN || fat_sector_num == 0xFFFFFFFF {
            break;
        }

        let sector_offset = SECTOR_SIZE_512 + (fat_sector_num as usize * sector_size);
        if sector_offset + sector_size <= data.len() {
            for j in (0..sector_size).step_by(4) {
                if sector_offset + j + 4 <= data.len() {
                    fat.push(u32::from_le_bytes([
                        data[sector_offset + j],
                        data[sector_offset + j + 1],
                        data[sector_offset + j + 2],
                        data[sector_offset + j + 3],
                    ]));
                }
            }
        }
    }

    let dir_offset = SECTOR_SIZE_512 + (first_dir_sector * sector_size);
    if dir_offset >= data.len() {
        return;
    }

    parse_directory_entries(data, dir_offset, sector_size, &fat, project);
}

pub(super) fn parse_directory_entries(
    data: &[u8],
    dir_offset: usize,
    sector_size: usize,
    _fat: &[u32],
    project: &mut VbaProject,
) {
    let entries_per_sector = sector_size / DIRECTORY_ENTRY_SIZE;

    for i in 0..entries_per_sector {
        let entry_offset = dir_offset + (i * DIRECTORY_ENTRY_SIZE);
        if entry_offset + DIRECTORY_ENTRY_SIZE > data.len() {
            break;
        }

        let name_len =
            u16::from_le_bytes([data[entry_offset + 64], data[entry_offset + 65]]) as usize;

        if name_len == 0 || name_len > 64 {
            continue;
        }

        let name_bytes = &data[entry_offset..entry_offset + name_len.min(64)];
        let name = decode_utf16le(name_bytes);
        let entry_type = data[entry_offset + 66];

        let _start_sector = u32::from_le_bytes([
            data[entry_offset + 116],
            data[entry_offset + 117],
            data[entry_offset + 118],
            data[entry_offset + 119],
        ]);
        let _stream_size = u32::from_le_bytes([
            data[entry_offset + 120],
            data[entry_offset + 121],
            data[entry_offset + 122],
            data[entry_offset + 123],
        ]);

        match name.as_str() {
            "PROJECT" => {
                project.name = "VBAProject".to_string();
            }
            "dir" => {}
            "VBA" => {
                if entry_type == 1 {
                    // Storage entry.
                }
            }
            _ => {
                if entry_type == 2 && !name.starts_with('_') && name != "dir" && name != "PROJECT" {
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

    if project.modules.is_empty() {
        detect_modules_from_raw(data, project);
    }
}

pub(super) fn decode_utf16le(bytes: &[u8]) -> String {
    let u16_chars: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
        .take_while(|&c| c != 0)
        .collect();

    String::from_utf16_lossy(&u16_chars)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_dir_name(entry: &mut [u8], name: &str) {
        let encoded: Vec<u8> = name
            .encode_utf16()
            .flat_map(|c| c.to_le_bytes())
            .chain([0, 0])
            .collect();
        entry[..encoded.len()].copy_from_slice(&encoded);
        let len = encoded.len() as u16;
        entry[64..66].copy_from_slice(&len.to_le_bytes());
    }

    #[test]
    fn test_decode_utf16le() {
        let data = [0x54, 0x00, 0x65, 0x00, 0x73, 0x00, 0x74, 0x00, 0x00, 0x00];
        assert_eq!(decode_utf16le(&data), "Test");
    }

    #[test]
    fn test_decode_utf16le_empty() {
        let data = [0x00, 0x00];
        assert_eq!(decode_utf16le(&data), "");
    }

    #[test]
    fn test_ole_magic_validation() {
        let mut data = vec![0u8; 512];
        data[..8].copy_from_slice(&OLE_MAGIC);
        assert!(data.starts_with(&OLE_MAGIC));

        let invalid = vec![0u8; 512];
        assert!(!invalid.starts_with(&OLE_MAGIC));
    }

    #[test]
    fn test_ole_document_too_small() {
        let small_data = vec![0u8; 100];
        let mut project = VbaProject::default();
        parse_ole_document(&small_data, &mut project);
        assert!(project.modules.is_empty());
    }

    #[test]
    fn test_ole_document_invalid_sector_size() {
        let mut data = vec![0u8; 512];
        data[..8].copy_from_slice(&OLE_MAGIC);
        data[30..32].copy_from_slice(&7u16.to_le_bytes());

        let mut project = VbaProject::default();
        parse_ole_document(&data, &mut project);
        assert!(project.modules.is_empty());
        assert!(project.name.is_empty());
    }

    #[test]
    fn test_directory_entry_stream_classification() {
        let mut data = vec![0u8; DIRECTORY_ENTRY_SIZE * 2];
        write_dir_name(&mut data[..DIRECTORY_ENTRY_SIZE], "PROJECT");
        data[66] = 2;

        let entry_start = DIRECTORY_ENTRY_SIZE;
        write_dir_name(
            &mut data[entry_start..entry_start + DIRECTORY_ENTRY_SIZE],
            "Sheet1",
        );
        data[entry_start + 66] = 2;

        let mut project = VbaProject::default();
        parse_directory_entries(&data, 0, DIRECTORY_ENTRY_SIZE * 2, &[], &mut project);

        assert_eq!(project.name, "VBAProject");
        assert_eq!(project.modules.len(), 1);
        assert_eq!(project.modules[0].name, "Sheet1");
    }
}
