<p align="center"><img src="docs/logo.png" alt="Koritsu's fox logo" width="128"></p>

<h1 align="center">Koritsu 効率</h1>

<p align="center">A tiny always-on-top widget that counts the time you waste and the time you spend well.</p>

## Download

Get **`Koritsu-Setup-….exe`** from [Releases](https://github.com/watsonjph/Koritsu/releases) and run it.

- Installs just for you (no admin prompt) and adds Koritsu to the Start Menu and **Apps & features**.
- Tick **Start Koritsu when Windows starts** during setup, or turn it on later in Settings.
- Needs the Microsoft WebView2 runtime (built into Windows 11 and up-to-date Windows 10).
- The installer isn't code-signed, so SmartScreen may say "unknown publisher": click **More info → Run anyway**.
- Uninstalling keeps your data (`%APPDATA%\koritsu`).

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

Needs a recent stable Rust toolchain.

```bash
cargo run --release
```

```bash
cargo test
```

To build the installer, install [Inno Setup 6](https://jrsoftware.org/isinfo.php), build the release exe, then compile `installer/koritsu.iss`; it writes `dist/Koritsu-Setup-<version>.exe`.

```bash
ISCC installer/koritsu.iss
```

## License

[GPL-2.0](LICENSE)
