#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod activity;
mod autostart;
mod i18n;
mod icons;
mod place;
mod pomodoro;
mod scene;
mod settings;
mod sound;
mod stats;
mod store;
mod summary;
mod todos;
mod track;

use base64::{Engine, engine::general_purpose::STANDARD};
use dioxus::desktop::tao::event::{Event, WindowEvent};
use dioxus::desktop::trayicon::menu::{Menu, MenuItem};
use dioxus::desktop::trayicon::{Icon as TrayImage, TrayIconBuilder};
use dioxus::desktop::{Config, HotKeyState, LogicalSize, WindowBuilder, WindowCloseBehaviour, window};
use dioxus::prelude::*;
use i18n::{LANG, tr};
use icons::{Icon, MINUS, PIN, SLIDERS, X};
use pomodoro::{Phase, Pomo};
use std::cell::Cell;
use std::rc::Rc;
use std::time::Duration;
use store::{Kind, Store};

/// Wall-clock seconds, refreshed every tick; everything live reads this.
pub static NOW: GlobalSignal<i64> = Signal::global(store::now);
static SAVE_ERR: GlobalSignal<Option<String>> = Signal::global(|| None);

const CSS: &str = include_str!("../assets/main.css");
const SOUND_JS: &str = include_str!("../assets/sound.js");
const SCENE_JS: &str = include_str!("../assets/scene.js");
const SHEET_PNG: &[u8] = include_bytes!("../assets/character.png");
/// Extra animations: (name, sprite sheet, atlas). Names match `ANIM_NAMES` in scene.js.
const ANIMS: [(&str, &[u8], &str); 3] = [
    ("eating", include_bytes!("../assets/senko/eating.png"), include_str!("../assets/senko/eating.json")),
    ("to-bed", include_bytes!("../assets/senko/to-bed.png"), include_str!("../assets/senko/to-bed.json")),
    ("hopping", include_bytes!("../assets/senko/hopping.png"), include_str!("../assets/senko/hopping.json")),
];
const TRAY_SHOW: &str = "koritsu-show";
const TRAY_QUIT: &str = "koritsu-quit";

/// System-wide shortcuts: (accelerator, label). Descriptions live in `Tr::key_actions`.
pub const GLOBAL_KEYS: [(&str, &str); 6] = [
    ("ctrl+alt+P", "Ctrl+Alt+P"),
    ("ctrl+alt+W", "Ctrl+Alt+W"),
    ("ctrl+alt+B", "Ctrl+Alt+B"),
    ("ctrl+alt+S", "Ctrl+Alt+S"),
    ("ctrl+alt+F", "Ctrl+Alt+F"),
    ("ctrl+alt+K", "Ctrl+Alt+K"),
];

/// Which global shortcuts registered (another app may own one).
#[derive(Clone, Copy)]
pub struct HotkeysOk(pub [bool; 6]);

/// Mutate the store and persist it. A failed save shows a banner instead of vanishing.
pub fn commit(mut store: Signal<Store>, f: impl FnOnce(&mut Store)) {
    let mut s = store.write();
    f(&mut s);
    let err = store::save(&s).err().map(|e| format!("{} {e}", tr().save_failed));
    if *SAVE_ERR.peek() != err {
        *SAVE_ERR.write() = err;
    }
}

/// Desktop toast, if notifications are on.
pub fn notify(store: Signal<Store>, body: String) {
    if !store.peek().settings.notifications {
        return;
    }
    // Showing a toast can block for a moment on Windows; keep it off the UI thread.
    std::thread::spawn(move || {
        let mut toast = notify_rust::Notification::new();
        toast.summary("Koritsu 効率").body(&body);
        #[cfg(windows)]
        if installed() {
            // The installer's Start Menu shortcut registers this ID, so toasts show as Koritsu.
            // Without that shortcut Windows drops toasts for an unknown ID, so portable copies
            // keep the default.
            toast.app_id(APP_ID);
        }
        if let Err(e) = toast.show() {
            eprintln!("koritsu: notification failed: {e}");
        }
    });
}

/// Windows AppUserModelID; must match `AppUserModelID` in installer/koritsu.iss.
#[cfg(windows)]
const APP_ID: &str = "dev.koritsu.Koritsu";

/// Installed by the setup wizard (its uninstaller sits next to the exe), not run portably.
#[cfg(windows)]
fn installed() -> bool {
    std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.join("unins000.exe").exists())).unwrap_or(false)
}

pub fn set_pinned(store: Signal<Store>, on: bool) {
    window().set_always_on_top(on);
    commit(store, |s| s.settings.pinned = on);
}

/// The fox app icon as RGBA pixels, with its width and height.
fn icon_rgba() -> (Vec<u8>, u32, u32) {
    let img = image::load_from_memory(include_bytes!("../assets/icon.png")).expect("bundled icon is a valid PNG").to_rgba8();
    let (w, h) = img.dimensions();
    (img.into_raw(), w, h)
}

fn main() {
    // One instance only: two would overwrite each other's saves. The lock lives until exit.
    let _ = std::fs::create_dir_all(store::data_dir());
    let lock = std::fs::File::create(store::data_dir().join("koritsu.lock"));
    if lock.as_ref().is_ok_and(|f| f.try_lock().is_err()) {
        eprintln!("koritsu: already running");
        return;
    }
    // Let sounds play from hotkeys and timers, not only from clicks.
    // SAFETY: single-threaded here; nothing else reads the environment yet.
    unsafe { std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "--autoplay-policy=no-user-gesture-required") };

    let initial = store::load();
    // Launched by "Start with Windows": go straight to the tray.
    let hidden = std::env::args().any(|a| a == autostart::HIDDEN_ARG);
    let font = |b: &[u8], w: u32| {
        format!("@font-face{{font-family:'JetBrains Mono';font-weight:{w};src:url(data:font/woff2;base64,{})}}", STANDARD.encode(b))
    };
    // { name: { src: data URL, atlas: {...} } } for scene.js's extra animations
    let anims = ANIMS
        .iter()
        .map(|(name, png, atlas)| format!("\"{name}\":{{\"src\":\"data:image/png;base64,{}\",\"atlas\":{atlas}}}", STANDARD.encode(png)))
        .collect::<Vec<_>>()
        .join(",");
    let head = format!(
        "<style>{}{}{CSS}</style><script>{SOUND_JS}</script><script>window.KORITSU_SHEET=\"data:image/png;base64,{}\";window.KORITSU_ANIMS={{{anims}}};</script><script>{SCENE_JS}</script>",
        font(include_bytes!("../assets/fonts/jetbrains-mono-latin-400-normal.woff2"), 400),
        font(include_bytes!("../assets/fonts/jetbrains-mono-latin-700-normal.woff2"), 700),
        STANDARD.encode(SHEET_PNG),
    );

    let win = WindowBuilder::new()
        .with_title("Koritsu")
        .with_decorations(false)
        .with_inner_size({
            let (w, h) = initial.settings.window_size.logical();
            LogicalSize::new(w, h)
        })
        .with_resizable(false)
        .with_always_on_top(initial.settings.pinned)
        .with_visible(!hidden)
        .with_window_icon({
            let (rgba, w, h) = icon_rgba();
            dioxus::desktop::tao::window::Icon::from_rgba(rgba, w, h).ok()
        });

    let cfg = Config::new()
        .with_window(win)
        .with_menu(None)
        .with_custom_head(head)
        .with_background_color((0, 0, 0, 255))
        .with_close_behaviour(WindowCloseBehaviour::WindowHides)
        // Our tray handler toggles; Dioxus' default would show and then we'd hide it again.
        .with_tray_icon_show_window_on_click(false)
        .with_disable_context_menu(!cfg!(debug_assertions));

    dioxus::LaunchBuilder::desktop().with_cfg(cfg).with_context(initial).launch(App);
    drop(lock);
}

#[derive(Clone, Copy, PartialEq)]
enum Tab {
    Track,
    Focus,
    Todo,
    Stats,
    Settings,
}

const TABS: [Tab; 5] = [Tab::Track, Tab::Focus, Tab::Todo, Tab::Stats, Tab::Settings];

#[component]
fn App() -> Element {
    let store = use_context_provider(|| Signal::new(consume_context::<Store>()));
    let pomo = use_context_provider(|| Signal::new(Pomo::new(&store.peek().settings)));
    let mut tab = use_signal(|| Tab::Track);

    use_hook(|| {
        *LANG.write() = store.peek().settings.lang;
        // Runs before Dioxus first shows the window, so there's no visible jump.
        place::restore(&window(), store.peek().settings.window);
    });

    // Kept alive for the app's lifetime; dropping it removes the icon.
    let _tray = use_hook(|| {
        let t = tr();
        let menu = Menu::new();
        let _ = menu.append_items(&[
            &MenuItem::with_id(TRAY_SHOW, t.show_hide, true, None),
            &MenuItem::with_id(TRAY_QUIT, t.quit, true, None),
        ]);
        let tray = TrayIconBuilder::new()
            .with_tooltip("Koritsu 効率")
            .with_menu(Box::new(menu))
            .with_icon({
                let (rgba, w, h) = icon_rgba();
                TrayImage::from_rgba(rgba, w, h).expect("valid icon")
            })
            .build();
        if tray.is_err() {
            // No tray to come back from, so closing must really close.
            window().set_close_behavior(WindowCloseBehaviour::WindowCloses);
        }
        Rc::new(tray.ok())
    });
    dioxus::desktop::use_tray_menu_event_handler(move |e| {
        if e.id == TRAY_SHOW {
            toggle_window();
        } else if e.id == TRAY_QUIT {
            let w = window();
            w.set_close_behavior(WindowCloseBehaviour::WindowCloses);
            w.close();
        }
    });
    dioxus::desktop::use_tray_icon_event_handler(|e| {
        use dioxus::desktop::trayicon::{MouseButton, MouseButtonState, TrayIconEvent};
        if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
            toggle_window();
        }
    });

    // Global shortcuts. Hooks must run in a fixed order, so these are spelled out.
    let pressed = |state: HotKeyState| state == HotKeyState::Pressed;
    let ok = [
        dioxus::desktop::use_global_shortcut(GLOBAL_KEYS[0].0, move |s| {
            if pressed(s) {
                track::toggle(store, pomo, Kind::Productive);
            }
        }),
        dioxus::desktop::use_global_shortcut(GLOBAL_KEYS[1].0, move |s| {
            if pressed(s) {
                track::toggle(store, pomo, Kind::Wasted);
            }
        }),
        dioxus::desktop::use_global_shortcut(GLOBAL_KEYS[2].0, move |s| {
            if pressed(s) {
                track::toggle(store, pomo, Kind::Break);
            }
        }),
        dioxus::desktop::use_global_shortcut(GLOBAL_KEYS[3].0, move |s| {
            if pressed(s) {
                track::stop(store);
            }
        }),
        dioxus::desktop::use_global_shortcut(GLOBAL_KEYS[4].0, move |s| {
            if pressed(s) {
                pomodoro::toggle(store, pomo);
            }
        }),
        dioxus::desktop::use_global_shortcut(GLOBAL_KEYS[5].0, move |s| {
            if pressed(s) {
                toggle_window();
            }
        }),
    ]
    .map(|r| r.is_ok());
    use_context_provider(|| HotkeysOk(ok));

    // After a drag or resize settles: snap to edges and remember the spot.
    let moves = use_hook(|| Rc::new(Cell::new(0u64)));
    dioxus::desktop::use_wry_event_handler(move |event, _| {
        if let Event::WindowEvent { event: WindowEvent::Moved(_) | WindowEvent::Resized(_), .. } = event {
            let id = moves.get() + 1;
            moves.set(id);
            let moves = moves.clone();
            spawn(async move {
                tokio::time::sleep(Duration::from_millis(350)).await;
                if moves.get() == id {
                    settle(store);
                }
            });
        }
    });

    use_future(move || async move {
        loop {
            // Wake on the second boundary so the clock never skips a digit.
            let ms = 1000 - chrono::Local::now().timestamp_subsec_millis().min(999);
            tokio::time::sleep(Duration::from_millis(ms.into())).await;
            tick(store, pomo);
        }
    });

    let t = tr();
    let st = store.read();
    let colors = st.settings.css_vars();
    // The header, kanji and quote bar take the running kind's colour; stopping fades back.
    let mood = st.running.as_ref().map_or(String::new(), |r| format!("moody mood-{}", r.kind.class()));
    let idx = TABS.iter().position(|x| *x == tab()).unwrap_or(0);

    rsx! {
        div {
            class: "app {mood}",
            style: "{colors}",
            tabindex: "-1",
            onmounted: move |e| async move {
                let _ = e.set_focus(true).await;
            },
            onkeydown: move |e| {
                if e.key() == Key::Escape {
                    window().set_visible(false);
                } else if e.modifiers().ctrl()
                    && let Key::Character(c) = e.key()
                    && let Some(i) = c.parse::<usize>().ok().filter(|i| (1..=TABS.len()).contains(i))
                {
                    e.prevent_default();
                    tab.set(TABS[i - 1]);
                }
            },
            Titlebar {}
            nav { class: "seg tabs", style: "--i: {idx}; --n: {TABS.len()}",
                span { class: "seg-pill" }
                for (i, label) in t.tabs.iter().enumerate() {
                    button {
                        key: "{i}",
                        class: if idx == i { "seg-btn on" } else { "seg-btn" },
                        onclick: move |_| tab.set(TABS[i]),
                        "{label}"
                    }
                }
                button {
                    class: if tab() == Tab::Settings { "seg-btn on" } else { "seg-btn" },
                    title: "{t.settings}",
                    onclick: move |_| tab.set(Tab::Settings),
                    Icon { d: SLIDERS }
                }
            }
            if let Some(err) = SAVE_ERR() {
                div { class: "banner", "{err}" }
            }
            main { class: "content",
                match tab() {
                    Tab::Track => rsx! { track::TrackTab {} },
                    Tab::Focus => rsx! { pomodoro::FocusTab {} },
                    Tab::Todo => rsx! { todos::TodoTab {} },
                    Tab::Stats => rsx! { stats::StatsTab {} },
                    Tab::Settings => rsx! { settings::SettingsTab {} },
                }
            }
            activity::ActivityPrompt {}
        }
    }
}

fn toggle_window() {
    let w = window();
    if w.is_visible() && !w.is_minimized() {
        w.set_visible(false);
    } else {
        w.set_visible(true);
        w.set_minimized(false);
        w.set_focus();
    }
}

fn settle(store: Signal<Store>) {
    let w = window();
    if !w.is_visible() || w.is_minimized() {
        return;
    }
    // Each move fires another settle, which saves the final spot.
    if place::keep_on_screen(&w) || (store.peek().settings.snap && place::snap_now(&w)) {
        return;
    }
    let g = place::geom(&w);
    if g.is_some() && g != store.peek().settings.window {
        commit(store, |s| s.settings.window = g);
    }
}

/// Runs once a second: live clock, Pomodoro ticks and phase ends, todo reminders.
fn tick(store: Signal<Store>, mut pomo: Signal<Pomo>) {
    let now = store::now();
    *NOW.write() = now;
    let s = store.peek().settings.clone();

    let p = *pomo.peek();
    if p.running() {
        let ticking = if p.phase == Phase::Focus { s.tick_work } else { s.tick_break };
        if ticking && p.remaining(now) > 0 {
            sound::play_raw("tick", s.volume, s.sound_profile);
        }
    }

    if p.ends_at.is_some_and(|e| now >= e) {
        let finished = pomo.write().tick(&s, now);
        if let Some((phase, (a, b))) = finished {
            // Focus blocks count as productive; breaks are logged as break time.
            commit(store, |st| {
                if phase == Phase::Focus {
                    st.add_entry(Kind::Productive, a, b, st.focus_activity.clone(), "Pomodoro".into());
                } else {
                    st.add_entry(Kind::Break, a, b, String::new(), "Pomodoro".into());
                }
            });
            sound::alert(&s, if phase == Phase::Focus { s.focus_end_sound } else { s.break_end_sound });
            let t = tr();
            notify(store, if phase == Phase::Focus { t.focus_done } else { t.break_done }.into());
            let auto = if pomo.peek().phase == Phase::Focus { s.auto_work } else { s.auto_break };
            if auto {
                pomodoro::start(store, pomo, now);
            }
        }
    }

    let due = |t: &store::Todo| !t.done && !t.notified && t.due().is_some_and(|d| d <= now);
    if store.peek().todos.iter().any(due) {
        let mut texts = Vec::new();
        commit(store, |st| {
            for t in st.todos.iter_mut().filter(|t| due(t)) {
                t.notified = true;
                texts.push(t.text.clone());
            }
        });
        for text in texts {
            sound::button(&s, "chime");
            notify(store, text);
        }
    }
}

#[component]
fn Titlebar() -> Element {
    let store = use_context::<Signal<Store>>();
    let pinned = store.read().settings.pinned;
    let mood = store.read().running.as_ref().map_or("idle", |r| r.kind.class());
    let t = tr();
    rsx! {
        div { class: "titlebar",
            div { class: "drag", onmousedown: move |_| window().drag(),
                // Re-keyed on every mood change so the shine sweep replays; the colour itself
                // is inherited from `.app` and transitions smoothly.
                for m in [mood] {
                    span { key: "{m}", class: "logo",
                        span { class: "brand", "Koritsu" }
                        span { class: "kanji", "効率" }
                    }
                }
            }
            button {
                class: if pinned { "tb-btn on" } else { "tb-btn" },
                title: "{t.keep_on_top}",
                onclick: move |_| set_pinned(store, !pinned),
                Icon { d: PIN }
            }
            button { class: "tb-btn", title: "{t.minimize}", onclick: move |_| window().set_minimized(true), Icon { d: MINUS } }
            button { class: "tb-btn close", title: "{t.hide_to_tray}", onclick: move |_| window().set_visible(false), Icon { d: X } }
        }
    }
}
