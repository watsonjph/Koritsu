//! Start at login, the way each OS expects:
//! - Windows: a per-user `Run` registry value.
//! - macOS: a LaunchAgent plist in `~/Library/LaunchAgents`.
//! - Linux: an XDG autostart entry in `~/.config/autostart`.
//!
//! Each points at this executable with `--hidden`, and what's on disk is the source of truth,
//! so the toggle always shows what the OS will actually do.

/// Passed by the login entry so Koritsu starts straight into the tray.
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

    pub fn set(on: bool) -> Result<(), String> {
        let mut key = HKEY::default();
        // SAFETY: `key` is a valid out-pointer; it's closed below on every path.
        unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, RUN, None, KEY_SET_VALUE, &mut key) }.ok().map_err(|e| e.to_string())?;
        let result: WIN32_ERROR = if on {
            let exe = std::env::current_exe().map_err(|e| e.to_string())?;
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
        result.ok().map_err(|e| e.to_string())
    }
}

/// macOS and Linux: a small file describes the login item.
#[cfg(not(windows))]
mod imp {
    use std::path::PathBuf;

    #[cfg(target_os = "macos")]
    fn entry_path() -> Option<PathBuf> {
        let home = directories::BaseDirs::new()?.home_dir().to_path_buf();
        Some(home.join("Library/LaunchAgents/dev.koritsu.Koritsu.plist"))
    }

    #[cfg(not(target_os = "macos"))]
    fn entry_path() -> Option<PathBuf> {
        Some(directories::BaseDirs::new()?.config_dir().join("autostart/koritsu.desktop"))
    }

    /// The program to launch at login. An AppImage runs from a temporary mount, so use the
    /// AppImage file itself, which it names in `$APPIMAGE`.
    fn program() -> Result<PathBuf, String> {
        if let Some(app_image) = std::env::var_os("APPIMAGE") {
            return Ok(PathBuf::from(app_image));
        }
        std::env::current_exe().map_err(|e| e.to_string())
    }

    pub fn enabled() -> bool {
        entry_path().is_some_and(|p| p.exists())
    }

    pub fn set(on: bool) -> Result<(), String> {
        let path = entry_path().ok_or("couldn't find your home folder")?;
        if !on {
            return match std::fs::remove_file(&path) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
                _ => Ok(()),
            };
        }
        let exe = program()?;
        #[cfg(target_os = "macos")]
        let contents = super::launch_agent(&exe.to_string_lossy());
        #[cfg(not(target_os = "macos"))]
        let contents = super::desktop_entry(&exe.to_string_lossy());
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        std::fs::write(&path, contents).map_err(|e| e.to_string())
    }
}

pub use imp::{enabled, set};

/// A macOS LaunchAgent that opens Koritsu (hidden) when you log in.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn launch_agent(exe: &str) -> String {
    let xml = exe.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>dev.koritsu.Koritsu</string>
  <key>ProgramArguments</key>
  <array>
    <string>{xml}</string>
    <string>{HIDDEN_ARG}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
"#
    )
}

/// An XDG autostart entry that opens Koritsu (hidden) when you log in.
#[cfg_attr(any(windows, target_os = "macos"), allow(dead_code))]
fn desktop_entry(exe: &str) -> String {
    // Exec quoting per the Desktop Entry spec: wrap in quotes, escape " ` $ and \.
    let quoted: String = exe.chars().flat_map(|c| if matches!(c, '"' | '`' | '$' | '\\') { vec!['\\', c] } else { vec![c] }).collect();
    format!(
        "[Desktop Entry]\nType=Application\nName=Koritsu\nComment=Time tracker, Pomodoro and todos\nExec=\"{quoted}\" {HIDDEN_ARG}\nIcon=koritsu\nTerminal=false\nX-GNOME-Autostart-enabled=true\n"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launch_agent_escapes_the_path() {
        let plist = launch_agent("/Applications/R&D <x>/Koritsu.app/Contents/MacOS/koritsu");
        assert!(plist.contains("<string>/Applications/R&amp;D &lt;x&gt;/Koritsu.app/Contents/MacOS/koritsu</string>"));
        assert!(plist.contains("<string>--hidden</string>"));
        assert!(plist.contains("<key>RunAtLoad</key>\n  <true/>"));
    }

    #[test]
    fn desktop_entry_quotes_exec() {
        let entry = desktop_entry("/home/a b/$apps/koritsu");
        assert!(entry.contains("Exec=\"/home/a b/\\$apps/koritsu\" --hidden\n"));
        assert!(entry.starts_with("[Desktop Entry]\nType=Application\n"));
    }
}
