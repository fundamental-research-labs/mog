pub struct RegistryService {
    value: u32,
}

impl RegistryService {
    pub fn new() -> Self {
        Self { value: 0 }
    }

    pub fn value(&self) -> u32 {
        self.value
    }

    pub fn bump(&mut self, by: u32) -> u32 {
        self.value += by;
        self.value
    }
}

#[macro_export]
macro_rules! __bridge_descriptor_RegistryService_ops {
    ($gen:path) => {
        $gen! {
            bridge_version = 1;
            group = ops;
            service = RegistryService;
            key_type = str;
            key_param = "service_id";
            lifecycle create new {
                params {}
                return_type = Self;
            }
            method read value {
                params {}
                return_type = u32;
            }
            method write bump {
                params { [prim] by: u32, }
                return_type = u32;
            }
        }
    };
}

bridge_tauri::generate!(crate::__bridge_descriptor_RegistryService_ops);

#[test]
fn registry_helpers_preserve_lock_and_panic_behavior() {
    let registry = RegistryServiceRegistry::new();
    registry.insert("primary".to_string(), RegistryService { value: 1 });

    let first = registry
        .with_read("primary", |service| service.value())
        .unwrap();
    assert_eq!(first, 1);

    let bumped = registry
        .with_write("primary", |service| service.bump(2))
        .unwrap();
    assert_eq!(bumped, 3);

    let missing = registry.with_read("missing", |service| service.value());
    assert_eq!(
        missing.unwrap_err(),
        "instance not found: missing".to_string()
    );

    let panic_result = registry.with_write("primary", |service| {
        service.bump(4);
        panic!("intentional registry panic test");
    });
    assert_eq!(panic_result.unwrap_err(), "Internal panic".to_string());

    let after_panic = registry
        .with_write("primary", |service| service.bump(1))
        .unwrap();
    assert_eq!(after_panic, 8);

    let final_value = registry
        .with_read("primary", |service| service.value())
        .unwrap();
    assert_eq!(final_value, 8);
}
