#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod icons;
mod pomodoro;
mod settings;
mod stats;
mod store;
mod todos;
mod track;

use base64::{Engine, engine::general_purpose::STANDARD};
use dioxus::desktop::trayicon::menu::{Menu, MenuItem};
use dioxus::desktop::trayicon::{Icon as TrayImage, TrayIconBuilder};
use dioxus::desktop::{Config, LogicalSize, WindowBuilder, WindowCloseBehaviour, window};
use dioxus::prelude::*;
use icons::{Icon, MINUS, PIN, SLIDERS, X};
use pomodoro::{Phase, Pomo};
use std::rc::Rc;
use std::time::Duration;
use store::{Kind, Store};

/// Wall-clock seconds, refreshed every tick; everything live reads this.
pub static NOW: GlobalSignal<i64> = Signal::global(store::now);
static SAVE_ERR: GlobalSignal<Option<String>> = Signal::global(|| None);

const CSS: &str = include_str!("../assets/main.css");
const TRAY_SHOW: &str = "koritsu-show";
const TRAY_QUIT: &str = "koritsu-quit";

/// Mutate the store and persist it. A failed save shows a banner instead of vanishing.
pub fn commit(mut store: Signal<Store>, f: impl FnOnce(&mut Store)) {
    let mut s = store.write();
    f(&mut s);
    let err = store::save(&s).err().map(|e| format!("Couldn't save your data: {e}"));
    if *SAVE_ERR.peek() != err {
        *SAVE_ERR.write() = err;
    }
}

fn notify(body: String) {
    // Showing a toast can block for a moment on Windows; keep it off the UI thread.
    std::thread::spawn(move || {
        if let Err(e) = notify_rust::Notification::new().summary("Koritsu 効率").body(&body).show() {
            eprintln!("koritsu: notification failed: {e}");
        }
    });
}

/// Copper ring with a dot, drawn in code so there's no image to decode.
fn icon_rgba(n: u32) -> Vec<u8> {
    let c = (n as f32 - 1.0) / 2.0;
    (0..n * n)
        .flat_map(|i| {
            let (x, y) = ((i % n) as f32 - c, (i / n) as f32 - c);
            let r = (x * x + y * y).sqrt() / c;
            let on = (0.62..=0.98).contains(&r) || r <= 0.28;
            if on { [217, 132, 47, 255] } else { [0, 0, 0, 0] }
        })
        .collect()
}

fn main() {
    // One instance only: two would overwrite each other's saves. The lock lives until exit.
    let _ = std::fs::create_dir_all(store::data_dir());
    let lock = std::fs::File::create(store::data_dir().join("koritsu.lock"));
    if lock.as_ref().is_ok_and(|f| f.try_lock().is_err()) {
        eprintln!("koritsu: already running");
        return;
    }

    let initial = store::load();
    let font = |b: &[u8], w: u32| {
        format!("@font-face{{font-family:'JetBrains Mono';font-weight:{w};src:url(data:font/woff2;base64,{})}}", STANDARD.encode(b))
    };
    let head = format!(
        "<style>{}{}{CSS}</style>",
        font(include_bytes!("../assets/fonts/jetbrains-mono-latin-400-normal.woff2"), 400),
        font(include_bytes!("../assets/fonts/jetbrains-mono-latin-700-normal.woff2"), 700),
    );

    let win = WindowBuilder::new()
        .with_title("Koritsu")
        .with_decorations(false)
        .with_inner_size(LogicalSize::new(360.0, 560.0))
        .with_min_inner_size(LogicalSize::new(320.0, 480.0))
        .with_always_on_top(initial.settings.pinned)
        .with_window_icon(dioxus::desktop::tao::window::Icon::from_rgba(icon_rgba(64), 64, 64).ok());

    let cfg = Config::new()
        .with_window(win)
        .with_menu(None)
        .with_custom_head(head)
        .with_background_color((0, 0, 0, 255))
        .with_close_behaviour(WindowCloseBehaviour::WindowHides);

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

#[component]
fn App() -> Element {
    let store = use_context_provider(|| Signal::new(consume_context::<Store>()));
    let pomo = use_context_provider(|| Signal::new(Pomo::new(&store.peek().settings)));
    let mut tab = use_signal(|| Tab::Track);

    // Kept alive for the app's lifetime; dropping it removes the icon.
    let _tray = use_hook(|| {
        let menu = Menu::new();
        let _ = menu.append_items(&[
            &MenuItem::with_id(TRAY_SHOW, "Show / Hide", true, None),
            &MenuItem::with_id(TRAY_QUIT, "Quit Koritsu", true, None),
        ]);
        let tray = TrayIconBuilder::new()
            .with_tooltip("Koritsu 効率")
            .with_menu(Box::new(menu))
            .with_icon(TrayImage::from_rgba(icon_rgba(32), 32, 32).expect("valid icon"))
            .build();
        if tray.is_err() {
            // No tray to come back from, so closing must really close.
            window().set_close_behavior(WindowCloseBehaviour::WindowCloses);
        }
        Rc::new(tray.ok())
    });
    dioxus::desktop::use_tray_menu_event_handler(move |e| {
        let w = window();
        if e.id == TRAY_SHOW {
            toggle_window();
        } else if e.id == TRAY_QUIT {
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

    use_future(move || async move {
        loop {
            // Wake on the second boundary so the clock never skips a digit.
            let ms = 1000 - chrono::Local::now().timestamp_subsec_millis().min(999);
            tokio::time::sleep(Duration::from_millis(ms.into())).await;
            tick(store, pomo);
        }
    });

    let tabs = [(Tab::Track, "Track"), (Tab::Focus, "Focus"), (Tab::Todo, "Todo"), (Tab::Stats, "Stats")];

    rsx! {
        div { class: "app",
            Titlebar {}
            nav { class: "seg tabs",
                for (t, label) in tabs {
                    button {
                        key: "{label}",
                        class: if tab() == t { "seg-btn on" } else { "seg-btn" },
                        onclick: move |_| tab.set(t),
                        "{label}"
                    }
                }
                button {
                    class: if tab() == Tab::Settings { "seg-btn icon on" } else { "seg-btn icon" },
                    title: "Settings",
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
        }
    }
}

fn toggle_window() {
    let w = window();
    if w.is_visible() {
        w.set_visible(false);
    } else {
        w.set_visible(true);
        w.set_minimized(false);
        w.set_focus();
    }
}

/// Runs once a second: live clock, Pomodoro phase ends, todo reminders.
fn tick(store: Signal<Store>, mut pomo: Signal<Pomo>) {
    let now = store::now();
    *NOW.write() = now;

    if pomo.peek().ends_at.is_some_and(|e| now >= e) {
        let settings = store.peek().settings.clone();
        let finished = pomo.write().tick(&settings, now);
        if let Some((phase, log)) = finished {
            if let Some((a, b)) = log {
                commit(store, |s| s.add_entry(Kind::Productive, a, b, "Pomodoro".into()));
            }
            notify(match phase {
                Phase::Focus => "Focus block done. Take a break.".into(),
                _ => "Break's over. Back to focus.".into(),
            });
        }
    }

    let due = |t: &store::Todo| !t.done && !t.notified && t.due().is_some_and(|d| d <= now);
    if store.peek().todos.iter().any(due) {
        commit(store, |s| {
            for t in s.todos.iter_mut().filter(|t| due(t)) {
                t.notified = true;
                notify(t.text.clone());
            }
        });
    }
}

#[component]
fn Titlebar() -> Element {
    let store = use_context::<Signal<Store>>();
    let pinned = store.read().settings.pinned;
    rsx! {
        div { class: "titlebar",
            div { class: "drag", onmousedown: move |_| window().drag(),
                span { class: "brand", "Koritsu" }
                span { class: "kanji", "効率" }
            }
            button {
                class: if pinned { "tb-btn on" } else { "tb-btn" },
                title: "Keep on top",
                onclick: move |_| {
                    window().set_always_on_top(!pinned);
                    commit(store, |s| s.settings.pinned = !pinned);
                },
                Icon { d: PIN }
            }
            button { class: "tb-btn", title: "Minimize", onclick: move |_| window().set_minimized(true), Icon { d: MINUS } }
            button { class: "tb-btn close", title: "Hide to tray", onclick: move |_| window().set_visible(false), Icon { d: X } }
        }
    }
}
