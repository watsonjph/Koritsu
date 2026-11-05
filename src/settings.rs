use crate::i18n::{EN, JA, LANG, fill, tr};
use crate::icons::{Icon, PLUS, TRASH};
use crate::place::{self, Corner};
use crate::store::{self, Alert, Character, Lang, ProductiveScene, Settings, SkyMode, SoundProfile, Store, Theme, Token, Weather, WindowSize, parse_hex};
use crate::{GLOBAL_KEYS, HotkeysOk, autostart, commit, set_pinned, sound};
use dioxus::desktop::window;
use dioxus::prelude::*;
use std::path::PathBuf;

#[component]
pub fn SettingsTab() -> Element {
    let store = use_context::<Signal<Store>>();
    let hotkeys = use_context::<HotkeysOk>();
    let mut quote = use_signal(String::new);
    let mut exported = use_signal(|| None::<Result<PathBuf, String>>);
    // The volume while the slider is being dragged; saved once, on release.
    let mut dragging = use_signal(|| None::<u32>);
    let t = tr();
    let s = store.read().settings.clone();
    let volume = dragging().unwrap_or(s.volume);
    // Read from the OS's own login items, which is what will actually happen at login.
    let mut autostart_on = use_signal(autostart::enabled);
    let mut autostart_err = use_signal(|| None::<String>);

    // Flip a bool setting.
    let flip = move |field: fn(&mut Settings) -> &mut bool| {
        commit(store, |st| {
            let v = field(&mut st.settings);
            *v = !*v;
        });
        sound::button(&store.peek().settings, "click");
    };
    let in_app = [("Ctrl+1–5", t.key_actions[6]), ("Esc", t.key_actions[7])];
    // (label, field, colour shown, whether it's been changed from the sprite's own)
    let char_rows: Vec<(&str, CharField, String, bool)> = character_colors(t)
        .into_iter()
        .map(|(label, field, sprite)| {
            let set = field(&mut s.character.clone()).clone();
            (label, field, set.clone().unwrap_or_else(|| sprite.to_string()), set.is_some())
        })
        .collect();

    rsx! {
        div { class: "tab settings-tab",
            div { class: "group",
                ToggleRow { label: t.always_on_top, on: s.pinned, ontoggle: move |_| set_pinned(store, !s.pinned) }
                ToggleRow {
                    label: t.autostart,
                    on: autostart_on(),
                    ontoggle: move |_| {
                        let want = !autostart_on();
                        match autostart::set(want) {
                            Ok(()) => autostart_err.set(None),
                            Err(e) => autostart_err.set(Some(e.to_string())),
                        }
                        autostart_on.set(autostart::enabled());
                        sound::button(&store.peek().settings, "click");
                    },
                }
                if let Some(e) = autostart_err() {
                    div { class: "set-note error", "{e}" }
                }
            }

            div { class: "caption", "{t.sec_pomodoro}" }
            div { class: "group",
                ToggleRow { label: t.auto_work, on: s.auto_work, ontoggle: move |_| flip(|s| &mut s.auto_work) }
                ToggleRow { label: t.auto_break, on: s.auto_break, ontoggle: move |_| flip(|s| &mut s.auto_break) }
                ToggleRow { label: t.tick_work, on: s.tick_work, ontoggle: move |_| flip(|s| &mut s.tick_work) }
                ToggleRow { label: t.tick_break, on: s.tick_break, ontoggle: move |_| flip(|s| &mut s.tick_break) }
                ToggleRow { label: t.notifications, on: s.notifications, ontoggle: move |_| flip(|s| &mut s.notifications) }
            }

            div { class: "caption", "{t.sec_sound}" }
            div { class: "group",
                ToggleRow { label: t.button_sounds, on: s.sounds, ontoggle: move |_| flip(|s| &mut s.sounds) }
                div { class: "set-row",
                    span { "{t.volume}" }
                    input {
                        r#type: "range",
                        class: "slider mini",
                        style: "--c: var(--accent); --f: {f64::from(volume) / 100.0}",
                        min: "0",
                        max: "100",
                        value: "{volume}",
                        // Track the drag locally; saving (and re-rendering) on every step made the thumb fight the pointer.
                        oninput: move |e| {
                            if let Ok(v) = e.value().parse::<u32>() {
                                dragging.set(Some(v.min(100)));
                            }
                        },
                        onchange: move |_| {
                            if let Some(v) = dragging.take() {
                                commit(store, |st| st.settings.volume = v);
                            }
                            let s = &store.peek().settings;
                            sound::play_raw("productive", s.volume, s.sound_profile);
                        },
                    }
                }
                AlertRow { label: t.focus_end_sound, value: s.focus_end_sound, onpick: move |a| commit(store, |st| st.settings.focus_end_sound = a) }
                AlertRow { label: t.break_end_sound, value: s.break_end_sound, onpick: move |a| commit(store, |st| st.settings.break_end_sound = a) }
                div { class: "set-row stack",
                    span { "{t.button_sound}" }
                    div { class: "chips",
                        for profile in SoundProfile::ALL {
                            button {
                                key: "{profile.key()}",
                                class: if s.sound_profile == profile { "chip-btn on" } else { "chip-btn" },
                                onclick: move |_| {
                                    commit(store, |st| st.settings.sound_profile = profile);
                                    // Always preview, even with button sounds off: this is the picker.
                                    sound::play_raw("productive", store.peek().settings.volume, profile);
                                },
                                "{profile.name()}"
                            }
                        }
                    }
                }
            }

            div { class: "caption", "{t.sec_character}" }
            div { class: "group",
                ToggleRow { label: t.show_character, on: s.character.show, ontoggle: move |_| flip(|s| &mut s.character.show) }
                if s.character.show {
                    crate::scene::Scene {}
                    div { class: "set-row",
                        span { "{t.when_productive}" }
                        div { class: "seg small", style: "--i: {usize::from(s.character.scene == ProductiveScene::Reading)}; --n: 2",
                            span { class: "seg-pill" }
                            for (scene, name) in [(ProductiveScene::Fishing, t.fishing), (ProductiveScene::Reading, t.reading)] {
                                button {
                                    key: "{name}",
                                    class: if s.character.scene == scene { "seg-btn on" } else { "seg-btn" },
                                    onclick: move |_| commit(store, |st| st.settings.character.scene = scene),
                                    "{name}"
                                }
                            }
                        }
                    }
                    div { class: "set-row",
                        span { "{t.weather}" }
                        div { class: "seg small", style: "--i: {Weather::ALL.iter().position(|w| *w == s.character.weather).unwrap_or(0)}; --n: 4",
                            span { class: "seg-pill" }
                            for (i, weather) in Weather::ALL.into_iter().enumerate() {
                                button {
                                    key: "{weather.key()}",
                                    class: if s.character.weather == weather { "seg-btn on" } else { "seg-btn" },
                                    onclick: move |_| commit(store, |st| st.settings.character.weather = weather),
                                    "{t.weathers[i]}"
                                }
                            }
                        }
                    }
                    div { class: "set-row",
                        span { "{t.sky}" }
                        div { class: "seg small", style: "--i: {SkyMode::ALL.iter().position(|m| *m == s.character.sky).unwrap_or(0)}; --n: 4",
                            span { class: "seg-pill" }
                            for (i, mode) in SkyMode::ALL.into_iter().enumerate() {
                                button {
                                    key: "{mode.key()}",
                                    class: if s.character.sky == mode { "seg-btn on" } else { "seg-btn" },
                                    onclick: move |_| commit(store, |st| st.settings.character.sky = mode),
                                    "{t.skies[i]}"
                                }
                            }
                        }
                    }
                    for (label, field, value, custom) in char_rows {
                        ColorRow {
                            key: "{label}",
                            label,
                            value,
                            custom,
                            // `None` (the reset button) goes back to the sprite's own colour.
                            onpick: move |c: Option<String>| commit(store, |st| *field(&mut st.settings.character) = c),
                        }
                    }
                }
            }

            div { class: "caption", "{t.sec_look}" }
            div { class: "group",
                div { class: "set-row",
                    span { "{t.theme}" }
                    div { class: "swatches",
                        for theme in Theme::ALL {
                            button {
                                key: "{theme.name()}",
                                class: if s.theme == theme { "swatch-btn on" } else { "swatch-btn" },
                                style: "--accent: {s.color_for(theme, Token::Accent)}; --bg: {s.color_for(theme, Token::Bg)}",
                                title: "{theme.name()}",
                                onclick: move |_| commit(store, |st| st.settings.theme = theme),
                            }
                        }
                    }
                }
                // Edits apply to the selected theme only; each theme keeps its own tweaks.
                for token in Token::ALL {
                    ColorRow {
                        key: "{token:?}",
                        label: token_label(token),
                        value: s.color(token),
                        custom: s.is_custom(token),
                        onpick: move |c| commit(store, |st| st.settings.set_color(token, c)),
                    }
                }
                if s.custom.contains_key(&s.theme) {
                    button {
                        class: "link",
                        onclick: move |_| commit(store, |st| {
                            let theme = st.settings.theme;
                            st.settings.custom.remove(&theme);
                        }),
                        "{t.reset_theme}"
                    }
                }
                div { class: "set-row",
                    span { "{t.language}" }
                    div { class: "seg small", style: "--i: {usize::from(s.lang == Lang::Ja)}; --n: 2",
                        span { class: "seg-pill" }
                        for (lang, name) in [(Lang::En, EN.lang_name), (Lang::Ja, JA.lang_name)] {
                            button {
                                key: "{name}",
                                class: if s.lang == lang { "seg-btn on" } else { "seg-btn" },
                                onclick: move |_| {
                                    commit(store, |st| st.settings.lang = lang);
                                    *LANG.write() = lang;
                                },
                                "{name}"
                            }
                        }
                    }
                }
            }

            div { class: "caption", "{t.sec_window}" }
            div { class: "group",
                div { class: "set-row",
                    span { "{t.window_size}" }
                    div { class: "seg small", style: "--i: {WindowSize::ALL.iter().position(|w| *w == s.window_size).unwrap_or(0)}; --n: 3",
                        span { class: "seg-pill" }
                        for (i, size) in WindowSize::ALL.into_iter().enumerate() {
                            button {
                                key: "{i}",
                                class: if s.window_size == size { "seg-btn on" } else { "seg-btn" },
                                onclick: move |_| {
                                    commit(store, |st| st.settings.window_size = size);
                                    let (w, h) = size.logical();
                                    window().set_inner_size(dioxus::desktop::LogicalSize::new(w, h));
                                },
                                "{t.window_sizes[i]}"
                            }
                        }
                    }
                }
                ToggleRow { label: t.snap, on: s.snap, ontoggle: move |_| flip(|s| &mut s.snap) }
                div { class: "set-row",
                    span { "{t.move_to_corner}" }
                    div { class: "corners",
                        for c in Corner::ALL {
                            button {
                                key: "{c.arrow()}",
                                class: "corner-btn",
                                onclick: move |_| place::to_corner(&window(), c),
                                "{c.arrow()}"
                            }
                        }
                    }
                }
            }

            div { class: "caption", "{t.sec_data}" }
            div { class: "group",
                div { class: "set-row",
                    span { "{t.export_csv}" }
                    button {
                        class: "btn small",
                        onclick: move |_| {
                            sound::button(&store.peek().settings, "click");
                            exported.set(Some(store::export_csv(&store.peek()).map_err(|e| e.to_string())));
                        },
                        "CSV"
                    }
                }
                match exported() {
                    Some(Ok(path)) => rsx! {
                        div { class: "set-note",
                            span { class: "mono-path", {fill(t.exported, &[("path", &path.display().to_string())])} }
                            button {
                                class: "link",
                                onclick: move |_| {
                                    reveal(&path);
                                },
                                "{t.show_in_folder}"
                            }
                        }
                    },
                    Some(Err(e)) => rsx! { div { class: "set-note error", "{e}" } },
                    None => rsx! {},
                }
                div { class: "set-note",
                    span { class: "muted", "{t.data_file}" }
                    span { class: "mono-path", "{store::path().display()}" }
                }
            }

            div { class: "caption", "{t.sec_quotes}" }
            form {
                class: "row gap",
                onsubmit: move |e| {
                    e.prevent_default();
                    let q = quote.peek().trim().to_string();
                    if !q.is_empty() {
                        commit(store, |s| s.settings.quotes.push(q));
                        quote.set(String::new());
                    }
                },
                div { class: "input grow",
                    input { placeholder: "{t.add_quote}", value: "{quote}", oninput: move |e| quote.set(e.value()) }
                }
                button { class: "btn icon-btn", r#type: "submit", title: "{t.add_quote}", Icon { d: PLUS } }
            }
            ul { class: "list",
                for (i, q) in s.quotes.iter().cloned().enumerate() {
                    li { key: "{i}-{q}", class: "item",
                        span { class: "item-text grow", "{q}" }
                        button {
                            class: "icon-btn ghost",
                            title: "{t.delete}",
                            onclick: move |_| commit(store, |s| {
                                if i < s.settings.quotes.len() {
                                    s.settings.quotes.remove(i);
                                }
                            }),
                            Icon { d: TRASH }
                        }
                    }
                }
            }

            div { class: "caption", "{t.sec_keys}" }
            div { class: "group keys",
                for (i, (_, keys)) in GLOBAL_KEYS.iter().enumerate() {
                    div { key: "{keys}", class: "set-row",
                        span {
                            "{t.key_actions[i]}"
                            if !hotkeys.0[i] {
                                span { class: "tag wasted", " · {t.hotkey_taken}" }
                            }
                        }
                        kbd { "{keys}" }
                    }
                }
                for (keys, action) in in_app {
                    div { key: "{keys}", class: "set-row",
                        span { "{action}" }
                        kbd { "{keys}" }
                    }
                }
            }
        }
    }
}

type CharField = fn(&mut Character) -> &mut Option<String>;

/// (label, field, the sprite's own colour)
fn character_colors(t: &crate::i18n::Tr) -> [(&'static str, CharField, &'static str); 4] {
    [
        (t.hair_color, |c| &mut c.hair, store::SPRITE_HAIR),
        (t.skin, |c| &mut c.skin, store::SPRITE_SKIN),
        (t.eye_color, |c| &mut c.eyes, store::SPRITE_EYES),
        (t.outfit, |c| &mut c.outfit, store::SPRITE_OUTFIT),
    ]
}

/// Opens the system file manager at `path` (selected, where the OS supports that).
fn reveal(path: &std::path::Path) {
    use std::process::Command;
    #[cfg(windows)]
    let cmd = Command::new("explorer").arg(format!("/select,{}", path.display())).spawn();
    #[cfg(target_os = "macos")]
    let cmd = Command::new("open").arg("-R").arg(path).spawn();
    #[cfg(not(any(windows, target_os = "macos")))]
    let cmd = Command::new("xdg-open").arg(path.parent().unwrap_or(path)).spawn();
    if let Err(e) = cmd {
        eprintln!("koritsu: couldn't open the file manager: {e}");
    }
}

/// Pick a phase-end alert; choosing one plays it.
#[component]
fn AlertRow(label: &'static str, value: Alert, onpick: EventHandler<Alert>) -> Element {
    let store = use_context::<Signal<Store>>();
    rsx! {
        div { class: "set-row stack",
            span { "{label}" }
            div { class: "chips",
                for a in Alert::ALL {
                    button {
                        key: "{a.key()}",
                        class: if value == a { "chip-btn on" } else { "chip-btn" },
                        onclick: move |_| {
                            onpick.call(a);
                            sound::alert(&store.peek().settings, a);
                        },
                        "{a.name()}"
                    }
                }
            }
        }
    }
}

fn token_label(token: Token) -> &'static str {
    let t = tr();
    match token {
        Token::Accent => t.accent,
        Token::Bg => t.background,
        Token::Text => t.text_color,
        Token::Positive => t.positive_color,
        Token::Negative => t.negative_color,
        Token::Break => t.break_color,
    }
}

/// Colour picker plus a hex field, and a way back to the theme's own colour. `None` = theme default.
#[component]
fn ColorRow(label: &'static str, value: String, custom: bool, onpick: EventHandler<Option<String>>) -> Element {
    let t = tr();
    // What's typed, kept until it parses; follows the picker otherwise.
    let mut typed = use_signal(|| None::<String>);
    let shown = typed().unwrap_or_else(|| value.clone());
    let bad = typed().is_some_and(|v| parse_hex(&v).is_none());
    rsx! {
        div { class: "set-row",
            span { class: "grow", "{label}" }
            if custom {
                button { class: "link", title: "{t.theme_default}", onclick: move |_| {
                    typed.set(None);
                    onpick.call(None);
                }, "↺" }
            }
            div { class: if bad { "input hex bad" } else { "input hex" },
                input {
                    value: "{shown}",
                    maxlength: "7",
                    spellcheck: "false",
                    oninput: move |e| {
                        let v = e.value();
                        if let Some(c) = parse_hex(&v) {
                            onpick.call(Some(c));
                        }
                        typed.set(Some(v));
                    },
                    onblur: move |_| typed.set(None),
                }
            }
            input {
                r#type: "color",
                class: "color-pick",
                value: "{value}",
                oninput: move |e| {
                    typed.set(None);
                    onpick.call(Some(e.value()));
                },
            }
        }
    }
}

/// A settings row with a round on/off indicator, like the reference mock.
#[component]
fn ToggleRow(label: &'static str, on: bool, ontoggle: EventHandler<()>) -> Element {
    rsx! {
        button {
            class: "set-row toggle",
            role: "switch",
            aria_checked: "{on}",
            onclick: move |_| ontoggle.call(()),
            span { "{label}" }
            span { class: if on { "knob on" } else { "knob" } }
        }
    }
}
