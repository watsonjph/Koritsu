use crate::commit;
use crate::icons::{Icon, PLUS, TRASH};
use crate::store::{Store, Todo, now, today};
use chrono::NaiveTime;
use dioxus::prelude::*;

#[component]
pub fn TodoTab() -> Element {
    let store = use_context::<Signal<Store>>();
    let mut text = use_signal(String::new);
    let mut time = use_signal(String::new);
    let today = today();

    let mut add = move || {
        let t = text.peek().trim().to_string();
        if t.is_empty() {
            return;
        }
        let at = NaiveTime::parse_from_str(&time.peek(), "%H:%M").ok();
        commit(store, |s| {
            let id = s.next_id();
            let mut todo = Todo { id, text: t, date: today, time: at, done: false, notified: false };
            // A time already passed today shouldn't fire the moment it's added.
            todo.notified = todo.due().is_some_and(|d| d <= now());
            s.todos.push(todo);
        });
        text.set(String::new());
        time.set(String::new());
    };

    // Today's items plus anything left undone from earlier days.
    let mut list: Vec<Todo> = store
        .read()
        .todos
        .iter()
        .filter(|t| t.date == today || (t.date < today && !t.done))
        .cloned()
        .collect();
    list.sort_by_key(|t| (t.done, t.date, t.time.is_none(), t.time));

    rsx! {
        div { class: "tab todo-tab",
            form {
                class: "row gap",
                onsubmit: move |e| {
                    e.prevent_default();
                    add();
                },
                div { class: "input grow",
                    input {
                        placeholder: "What needs doing today?",
                        value: "{text}",
                        oninput: move |e| text.set(e.value()),
                    }
                }
                div { class: "input",
                    input { r#type: "time", value: "{time}", oninput: move |e| time.set(e.value()) }
                }
                button { class: "btn icon-btn", r#type: "submit", title: "Add", Icon { d: PLUS } }
            }
            if list.is_empty() {
                div { class: "empty", "Nothing planned. Add one thing that matters." }
            }
            ul { class: "list",
                for t in list {
                    li { key: "{t.id}", class: if t.done { "item done" } else { "item" },
                        label { class: "check",
                            input {
                                r#type: "checkbox",
                                checked: t.done,
                                onchange: move |_| commit(store, |s| {
                                    if let Some(x) = s.todos.iter_mut().find(|x| x.id == t.id) {
                                        x.done = !x.done;
                                    }
                                }),
                            }
                            span { class: "item-text", "{t.text}" }
                        }
                        if t.date < today {
                            span { class: "tag wasted", "overdue" }
                        }
                        if let Some(tm) = t.time {
                            span { class: "chip", {tm.format("%H:%M").to_string()} }
                        }
                        button {
                            class: "icon-btn ghost",
                            title: "Delete",
                            onclick: move |_| commit(store, |s| s.todos.retain(|x| x.id != t.id)),
                            Icon { d: TRASH }
                        }
                    }
                }
            }
        }
    }
}
