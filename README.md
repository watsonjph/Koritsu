<p align="center"><img src="docs/logo.png" alt="Koritsu's fox logo" width="128"></p>

<h1 align="center">Koritsu 効率</h1>

<p align="center">A tiny always-on-top widget that counts the time you waste and the time you spend well.</p>

## Supported systems

| OS | Versions | Download |
|---|---|---|
| Windows | 10 and 11, x64 | `Koritsu-Setup-<version>.exe` |
| macOS | 11 Big Sur or later, Apple Silicon and Intel | `Koritsu-<version>-macOS-universal.dmg` |
| Linux | x86_64 with glibc 2.35+ (Ubuntu 22.04+, Debian 12+, Fedora 36+) | `.deb`, `.rpm` or `.tar.gz` |

All downloads are on the [Releases](https://github.com/watsonjph/Koritsu/releases) page. Your data stays on your computer, in Koritsu's folder in your user profile, and is kept if you uninstall.

## Install

### Windows

1. Download and run **`Koritsu-Setup-<version>.exe`**. It installs just for you, with no admin prompt.
2. Optionally tick **Start Koritsu when you log in**.
3. Koritsu is now in the Start Menu and in **Settings → Apps** (where you can also uninstall it).

The installer isn't code-signed, so SmartScreen may say "unknown publisher": click **More info → Run anyway**. Koritsu needs the Microsoft WebView2 runtime, which is built into Windows 11 and up-to-date Windows 10.

### macOS

1. Open **`Koritsu-<version>-macOS-universal.dmg`** and drag **Koritsu** into **Applications**.
2. The app isn't notarized by Apple, so the first time, **right-click Koritsu → Open → Open**. If macOS says it's damaged or won't open, run this once in Terminal, then open it normally:

   ```bash
   xattr -dr com.apple.quarantine /Applications/Koritsu.app
   ```

3. Koritsu lives in the menu bar when hidden. Global shortcuts may ask for **Accessibility** access in System Settings → Privacy & Security.

### Linux

**Debian / Ubuntu**

```bash
sudo apt install ./koritsu_<version>-1_amd64.deb
```

**Fedora**

```bash
sudo dnf install ./koritsu-<version>-1.x86_64.rpm
```

**Any distribution** (`.tar.gz`): install WebKitGTK 4.1, GTK 3, libayatana-appindicator and libxdo from your package manager, then:

```bash
tar -xzf koritsu-<version>-linux-x86_64.tar.gz
cd koritsu-<version>-linux-x86_64
install -Dm755 koritsu ~/.local/bin/koritsu
install -Dm644 koritsu.desktop ~/.local/share/applications/koritsu.desktop
install -Dm644 koritsu.png ~/.local/share/icons/hicolor/256x256/apps/koritsu.png
```

Notes for Linux:

- The tray icon needs AppIndicator support (on GNOME, the *AppIndicator and KStatusNotifierItem Support* extension).
- Global shortcuts work on X11. Wayland doesn't let apps register them, so use the buttons there.

### Start at login

Turn on **Settings → Start at Login** on any OS. It adds a login item the way each system expects: the `Run` registry key on Windows, a LaunchAgent on macOS, and an XDG autostart entry on Linux. Koritsu then starts hidden in the tray or menu bar.

## Features

- **Track** productive, wasted and break time with one click, and name what you're doing.
- **Companion**: Senko eats, strolls and hops on the dock while you're idle, fishes or reads while you work, doomscrolls in bed while you don't, and curls up for a nap on breaks. The pixel-art lake and bedroom follow your clock (or a fixed time of day), with rain.
- **Stats** for day, week, month and year: a timeline, a breakdown by activity, and highlights that compare with the previous period.
- **Pomodoro** with adjustable lengths and rounds, auto-start, tick sounds and end-of-phase alerts.
- **Todo list** with timed reminders.
- **Make it yours**: themes with a custom accent that the whole palette follows, character colours, switch sounds, window size, English and 日本語.
- **Stays out of the way**: frameless, pin on top, snaps to screen corners, hides to the tray, exports to CSV.

## Keybinds

| Keys | Action |
|---|---|
| Ctrl+Alt+P / W / B | Start productive / wasted / break (works anywhere) |
| Ctrl+Alt+S | Stop tracking |
| Ctrl+Alt+F | Start / pause the Pomodoro |
| Ctrl+Alt+K | Show / hide Koritsu |
| Ctrl+1–5 | Switch tab |
| Esc | Close a dialog, or hide to the tray |

## Build from source

Needs a recent stable Rust toolchain. On Linux, first install the development packages:

```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev libxdo-dev
```

Then:

```bash
cargo run --release
```

```bash
cargo test
```

Installers for all three systems are built by GitHub Actions (`.github/workflows/release.yml`) when a version tag is pushed, and attached to a draft release. To build the Windows installer locally, install [Inno Setup 6](https://jrsoftware.org/isinfo.php), run `cargo build --release`, then:

```bash
ISCC installer/koritsu.iss
```

## License

[GPL-2.0](LICENSE)
