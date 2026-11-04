use crate::commit;
use crate::icons::{Icon, PLUS, TRASH};
use crate::store::{Store, path};
use dioxus::prelude::*;

#[component]
pub fn SettingsTab() -> Element {
    let store = use_context::<Signal<Store>>();
    let mut text = use_signal(String::new);
    let quotes = store.read().settings.quotes.clone();

    rsx! {
        div { class: "tab settings-tab",
            div { class: "caption", "quotes" }
            form {
                class: "row gap",
                onsubmit: move |e| {
                    e.prevent_default();
                    let q = text.peek().trim().to_string();
                    if !q.is_empty() {
                        commit(store, |s| s.settings.quotes.push(q));
                        text.set(String::new());
                    }
                },
                div { class: "input grow",
                    input {
                        placeholder: "Something worth remembering — Author",
                        value: "{text}",
                        oninput: move |e| text.set(e.value()),
                    }
                }
                button { class: "btn icon-btn", r#type: "submit", title: "Add quote", Icon { d: PLUS } }
            }
            ul { class: "list",
                for (i, q) in quotes.into_iter().enumerate() {
                    li { key: "{i}-{q}", class: "item",
                        span { class: "item-text grow", "{q}" }
                        button {
                            class: "icon-btn ghost",
                            title: "Delete",
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
            div { class: "caption", "data file" }
            div { class: "muted small mono-path", "{path().display()}" }
        }
    }
}
