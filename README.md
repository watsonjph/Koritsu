<p align="center"><img src="docs/logo.png" alt="Koritsu's fox logo" width="128"></p>

<h1 align="center">Koritsu 効率</h1>

<p align="center">A tiny always-on-top widget that counts the time you waste and the time you spend well.</p>

## Install

Works on Windows 10/11, macOS 11+ and 64-bit Linux.

### Windows

Download **[Koritsu-Setup-x64.exe](https://github.com/watsonjph/Koritsu/releases/latest/download/Koritsu-Setup-x64.exe)** and run it. If SmartScreen warns, click **More info → Run anyway**.

### macOS

Download **[Koritsu-macOS.dmg](https://github.com/watsonjph/Koritsu/releases/latest/download/Koritsu-macOS.dmg)** from [Releases](https://github.com/watsonjph/Koritsu/releases) and drag Koritsu into Applications.

### Linux

Debian / Ubuntu:

```bash
wget https://github.com/watsonjph/Koritsu/releases/latest/download/koritsu_amd64.deb
sudo apt install ./koritsu_amd64.deb
```

Fedora:

```bash
sudo dnf install https://github.com/watsonjph/Koritsu/releases/latest/download/koritsu.x86_64.rpm
```

### Build from source

Needs Rust. On Linux, install the system libraries first:

```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev libxdo-dev
```

Then:

```bash
git clone https://github.com/watsonjph/Koritsu
cd Koritsu
cargo run --release
```

## Features

- Track productive, wasted and break time, and name what you're doing
- Senko, a pixel-art companion who fishes, naps or doomscrolls along with you
- Stats for day, week, month and year
- Pomodoro timer with alerts
- Todo list with reminders
- Themes, sounds, English and 日本語
- Starts at login and hides in the tray

## Keybinds

| Keys | Action |
|---|---|
| Ctrl+Alt+P / W / B | Start productive / wasted / break |
| Ctrl+Alt+S | Stop tracking |
| Ctrl+Alt+F | Start / pause the Pomodoro |
| Ctrl+Alt+K | Show / hide Koritsu |

## License

[GPL-2.0](LICENSE)
