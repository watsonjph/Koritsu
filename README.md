# Koritsu
効率 Stop wasting time! 

A tiny always-on-top widget (Rust + Dioxus) that counts the time you waste and the time you spend well, with a Pomodoro and a today list.

## Run

```bash
cargo run --release
```

Data lives in `%APPDATA%\koritsu\Koritsu\data\koritsu.json`; the path is also shown in the app's settings tab.

## Test

```bash
cargo test
```

## Keybinds

| Keys | Action |
|---|---|
| Ctrl+Alt+P / W | Start productive / wasted (works anywhere) |
| Ctrl+Alt+S | Stop tracking |
| Ctrl+Alt+F | Start / pause the Pomodoro |
| Ctrl+Alt+K | Show / hide Koritsu |
| Ctrl+1–5 | Switch tab |
| Esc | Close dialog, or hide to tray |
