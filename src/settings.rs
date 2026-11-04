use crate::i18n::{EN, JA, LANG, fill, tr};
use crate::icons::{Icon, PLUS, TRASH};
use crate::place::{self, Corner};
use crate::store::{self, Lang, Settings, SoundProfile, Store, Theme, Token, parse_hex};
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
    let t = tr();
    let s = store.read().settings.clone();
    // Read from the registry, which is what Windows will actually do at login.
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
    let in_app = [("Ctrl+1–5", t.key_actions[5]), ("Esc", t.key_actions[6])];

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
                label { class: "set-row",
                    span { "{t.volume}" }
                    input {
                        r#type: "range",
                        class: "slider mini",
                        style: "--c: var(--accent); --pct: {s.volume}%",
                        min: "0",
                        max: "100",
                        value: "{s.volume}",
                        oninput: move |e| {
                            if let Ok(v) = e.value().parse::<u32>() {
                                commit(store, |st| st.settings.volume = v.min(100));
                            }
                        },
                        // Preview on release, not on every step of the drag.
                        onchange: move |_| {
                            let s = &store.peek().settings;
                            sound::play_raw("productive", s.volume, s.sound_profile);
                        },
                    }
                }
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

            div { class: "caption", "{t.sec_look}" }
            div { class: "group",
                div { class: "set-row",
                    span { "{t.theme}" }
                    div { class: "swatches",
                        for theme in Theme::ALL {
                            button {
                                key: "{theme.name()}",
                                class: if s.theme == theme { "swatch-btn on" } else { "swatch-btn" },
                                style: "--accent: {theme.color(Token::Accent)}; --bg: {theme.color(Token::Bg)}",
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
                        value: s.color(token).to_string(),
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
                                    let _ = std::process::Command::new("explorer").arg(format!("/select,{}", path.display())).spawn();
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

fn token_label(token: Token) -> &'static str {
    let t = tr();
    match token {
        Token::Accent => t.accent,
        Token::Bg => t.background,
        Token::Text => t.text_color,
        Token::Positive => t.positive_color,
        Token::Negative => t.negative_color,
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
