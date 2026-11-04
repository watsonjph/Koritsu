//! Start with Windows: a per-user `Run` registry value pointing at this exe with `--hidden`.
//! The registry is the source of truth, so the toggle always shows what Windows will do.

/// Passed by the Run entry so login starts Koritsu straight into the tray.
pub const HIDDEN_ARG: &str = "--hidden";

#[cfg(windows)]
mod imp {
    use windows::Win32::Foundation::WIN32_ERROR;
    use windows::Win32::System::Registry::{
        HKEY, HKEY_CURRENT_USER, KEY_SET_VALUE, REG_SZ, RRF_RT_REG_SZ, RegCloseKey, RegDeleteValueW, RegGetValueW, RegOpenKeyExW,
        RegSetValueExW,
    };
    use windows::core::{PCWSTR, w};

    const RUN: PCWSTR = w!(r"Software\Microsoft\Windows\CurrentVersion\Run");
    const NAME: PCWSTR = w!("Koritsu");

    pub fn enabled() -> bool {
        // SAFETY: constant, NUL-terminated wide strings; no output buffers requested.
        unsafe { RegGetValueW(HKEY_CURRENT_USER, RUN, NAME, RRF_RT_REG_SZ, None, None, None) }.is_ok()
    }

    pub fn set(on: bool) -> windows::core::Result<()> {
        let mut key = HKEY::default();
        // SAFETY: `key` is a valid out-pointer; it's closed below on every path.
        unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, RUN, None, KEY_SET_VALUE, &mut key) }.ok()?;
        let result: WIN32_ERROR = if on {
            let exe = std::env::current_exe().map_err(|e| windows::core::Error::new(windows::core::HRESULT(-1), e.to_string()))?;
            let cmd = format!("\"{}\" {}", exe.display(), super::HIDDEN_ARG);
            let bytes: Vec<u8> = cmd.encode_utf16().chain([0]).flat_map(u16::to_le_bytes).collect();
            // SAFETY: `bytes` is a NUL-terminated UTF-16 string, as REG_SZ requires.
            unsafe { RegSetValueExW(key, NAME, None, REG_SZ, Some(&bytes)) }
        } else {
            // SAFETY: deleting a value under a key we hold open.
            unsafe { RegDeleteValueW(key, NAME) }
        };
        // SAFETY: closing the key opened above.
        let _ = unsafe { RegCloseKey(key) };
        // Turning off something that's already off is fine.
        if !on && result == windows::Win32::Foundation::ERROR_FILE_NOT_FOUND {
            return Ok(());
        }
        result.ok()
    }
}

#[cfg(windows)]
pub use imp::{enabled, set};

#[cfg(not(windows))]
pub fn enabled() -> bool {
    false
}

#[cfg(not(windows))]
pub fn set(_on: bool) -> Result<(), String> {
    Err("Start with Windows is only available on Windows".into())
}
