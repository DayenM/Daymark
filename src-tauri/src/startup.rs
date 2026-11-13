use std::path::Path;

const RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const VALUE_NAME: &str = "Daymark";

#[cfg(windows)]
pub fn reconcile(enabled: bool) -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Ok(());
    }
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};

    let (run_key, _) = RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(RUN_KEY)
        .map_err(|error| error.to_string())?;
    if enabled {
        let executable = std::env::current_exe().map_err(|error| error.to_string())?;
        let expected = startup_command(&executable);
        let current: Option<String> = run_key.get_value(VALUE_NAME).ok();
        if current.as_deref() != Some(expected.as_str()) {
            run_key
                .set_value(VALUE_NAME, &expected)
                .map_err(|error| error.to_string())?;
        }
    } else if let Err(error) = run_key.delete_value(VALUE_NAME) {
        if error.kind() != std::io::ErrorKind::NotFound {
            return Err(error.to_string());
        }
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn reconcile(_enabled: bool) -> Result<(), String> {
    Ok(())
}

pub fn set_enabled(enabled: bool) -> Result<(), String> {
    reconcile(enabled)
}

fn startup_command(executable: &Path) -> String {
    format!("\"{}\" --startup", executable.display())
}

#[cfg(test)]
mod tests {
    #[test]
    fn debug_build_does_not_modify_os_startup() {
        if cfg!(debug_assertions) {
            assert!(super::reconcile(true).is_ok());
            assert!(super::reconcile(false).is_ok());
        }
    }
}
