use crate::i18n::tr;
use crate::icons::{Icon, PLUS, TRASH};
use crate::store::{Store, Todo, now, today};
use crate::{commit, sound};
use chrono::NaiveTime;
use dioxus::prelude::*;

#[component]
pub fn TodoTab() -> Element {
    let store = use_context::<Signal<Store>>();
    let mut text = use_signal(String::new);
    let mut time = use_signal(String::new);
    let t = tr();
    let today = today();

    let mut add = move || {
        let task = text.peek().trim().to_string();
        if task.is_empty() {
            return;
        }
        let at = NaiveTime::parse_from_str(&time.peek(), "%H:%M").ok();
        sound::button(&store.peek().settings, "click");
        commit(store, |s| {
            let id = s.next_id();
            let mut todo = Todo { id, text: task, date: today, time: at, done: false, notified: false };
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
            // Task text gets the full width; time and Add sit underneath so neither squeezes the other.
            form {
                class: "composer",
                onsubmit: move |e| {
                    e.prevent_default();
                    add();
                },
                div { class: "input",
                    input {
                        placeholder: "{t.add_task}",
                        value: "{text}",
                        oninput: move |e| text.set(e.value()),
                    }
                }
                div { class: "row gap",
                    div { class: "input time-input",
                        input { r#type: "time", value: "{time}", oninput: move |e| time.set(e.value()) }
                    }
                    button { class: "btn primary grow", r#type: "submit", disabled: text().trim().is_empty(),
                        Icon { d: PLUS }
                        "{t.add}"
                    }
                }
            }
            if list.is_empty() {
                div { class: "empty", "{t.no_tasks}" }
            }
            ul { class: "list",
                for todo in list {
                    li { key: "{todo.id}", class: if todo.done { "item done" } else { "item" },
                        label { class: "check",
                            input {
                                r#type: "checkbox",
                                checked: todo.done,
                                onchange: move |_| {
                                    sound::button(&store.peek().settings, "click");
                                    commit(store, |s| {
                                        if let Some(x) = s.todos.iter_mut().find(|x| x.id == todo.id) {
                                            x.done = !x.done;
                                        }
                                    });
                                },
                            }
                            span { class: "item-text", "{todo.text}" }
                        }
                        if todo.date < today {
                            span { class: "tag wasted", "{t.overdue}" }
                        }
                        if let Some(tm) = todo.time {
                            span { class: "chip", {tm.format("%H:%M").to_string()} }
                        }
                        button {
                            class: "icon-btn ghost",
                            title: "{t.delete}",
                            onclick: move |_| commit(store, |s| s.todos.retain(|x| x.id != todo.id)),
                            Icon { d: TRASH }
                        }
                    }
                }
            }
        }
    }
}
