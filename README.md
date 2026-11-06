<p align="center"><img src="docs/logo.png" alt="Koritsu's fox logo" width="128"></p>

<h1 align="center">Koritsu 効率</h1>

<p align="center">A tiny always-on-top widget that counts the time you waste and the time you spend well.</p>

<p align="center"><img src="docs/senko.gif" alt="Senko fishing, studying in Akihabara and by a river, waiting for a train and counting sheep, with thought bubbles" width="640"></p>

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

- Track productive, wasted and break time, name what you're doing, and switch without stopping
- Set a break length and get a nudge when it's up
- Senko, a pixel-art companion who lives it with you:
  - productive, she travels: fishing at a lake, then studying in the countryside, by a river, under Mt Fuji, on a Tokyo street and in Akihabara, a new place every 10 minutes
  - wasting time, she commutes: waiting on the platform, riding the train, on her phone
  - on a break, she naps, and an alarm wakes her when your break is up; idle, she wanders through every scene
  - thought bubbles that cheer you on, or call you out
  - day and night, rain and snow
- A Pomodoro right in the Track page
- Stats for day, week, month and year, and a log of every entry
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
| Ctrl+1–5 | Switch page (in the app) |

## License

[GPL-2.0](LICENSE)
