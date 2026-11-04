//! "What are you doing?" — asked when starting productive, wasted or a focus block.
//! Past answers are remembered per kind (most recent first) so the usual one is a single click.

use crate::i18n::tr;
use crate::icons::{Icon, PLAY, X};
use crate::pomodoro::{self, Pomo};
use crate::stats::Overlay;
use crate::store::{Kind, Store};
use crate::{commit, track};
use dioxus::prelude::*;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Ask {
    Track(Kind),
    Focus,
}

impl Ask {
    /// Focus blocks are productive time, so they share productive's list.
    fn kind(self) -> Kind {
        match self {
            Ask::Track(k) => k,
            Ask::Focus => Kind::Productive,
        }
    }
}

pub static ASK: GlobalSignal<Option<Ask>> = Signal::global(|| None);

fn begin(store: Signal<Store>, pomo: Signal<Pomo>, ask: Ask, name: String) {
    *ASK.write() = None;
    match ask {
        Ask::Track(kind) => track::start(store, pomo, kind, name),
        Ask::Focus => {
            commit(store, |s| {
                s.remember(Kind::Productive, &name);
                s.focus_activity = name.trim().to_string();
            });
            pomodoro::toggle(store, pomo);
        }
    }
}

#[component]
pub fn ActivityPrompt() -> Element {
    let store = use_context::<Signal<Store>>();
    let pomo = use_context::<Signal<Pomo>>();
    let mut text = use_signal(String::new);
    let Some(ask) = ASK() else { return rsx! {} };
    let t = tr();
    let kind = ask.kind();
    let known = store.read().activities(kind).to_vec();
    let title = match ask {
        Ask::Track(Kind::Productive) => t.ask_productive,
        Ask::Track(Kind::Wasted) => t.ask_wasted,
        Ask::Focus => t.ask_focus,
    };
    let mut close = move || {
        text.set(String::new());
        *ASK.write() = None;
    };

    rsx! {
        // The text field takes focus instead of the backdrop, so typing a new name is immediate.
        Overlay { onclose: move |_| close(), focus_self: false,
            form {
                class: "popup ask {kind.class()}",
                onsubmit: move |e| {
                    e.prevent_default();
                    let name = text.peek().trim().to_string();
                    text.set(String::new());
                    begin(store, pomo, ask, name);
                },
                h3 { "{title}" }
                if !known.is_empty() {
                    div { class: "chips",
                        for name in known {
                            span { key: "{name}", class: "activity-chip",
                                button {
                                    r#type: "button",
                                    class: "chip-main",
                                    onclick: {
                                        let name = name.clone();
                                        move |_| begin(store, pomo, ask, name.clone())
                                    },
                                    "{name}"
                                }
                                button {
                                    r#type: "button",
                                    class: "chip-x",
                                    title: "{t.forget}",
                                    onclick: move |_| commit(store, |s| s.forget(kind, &name)),
                                    Icon { d: X }
                                }
                            }
                        }
                    }
                }
                div { class: "row gap",
                    div { class: "input grow",
                        input {
                            placeholder: "{t.new_activity}",
                            value: "{text}",
                            oninput: move |e| text.set(e.value()),
                            onmounted: move |e| async move {
                                let _ = e.set_focus(true).await;
                            },
                        }
                    }
                    button { class: "btn primary", r#type: "submit",
                        Icon { d: PLAY }
                        "{t.start}"
                    }
                }
                p { class: "muted small", "{t.ask_hint}" }
            }
        }
    }
}

/// Starting from a global shortcut skips the question and reuses the most recent activity.
pub fn last(store: Signal<Store>, kind: Kind) -> String {
    store.peek().activities(kind).first().cloned().unwrap_or_default()
}

/// Shown as the activity's label; unnamed time gets a placeholder.
pub fn label(name: &str) -> &str {
    if name.is_empty() { tr().unnamed } else { name }
}
