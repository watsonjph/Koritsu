use crate::icons::{Icon, PENCIL, PLUS, TRASH};
use crate::store::{Entry, Kind, Period, Store, fmt_dur, local_ts, today};
use crate::{NOW, commit};
use chrono::{DateTime, Days, Local, NaiveDate, NaiveTime};
use dioxus::prelude::*;

/// The add/edit form's fields, kept as the raw strings the inputs produce.
#[derive(Clone, PartialEq)]
struct Draft {
    id: Option<u64>,
    kind: Kind,
    date: String,
    time: String,
    hours: String,
    mins: String,
    note: String,
}

impl Draft {
    fn new() -> Self {
        let now = Local::now();
        Self {
            id: None,
            kind: Kind::Wasted,
            date: now.format("%Y-%m-%d").to_string(),
            time: now.format("%H:%M").to_string(),
            hours: "1".into(),
            mins: "0".into(),
            note: String::new(),
        }
    }

    fn from(e: &Entry) -> Self {
        let start = local(e.start);
        let mins = (e.end - e.start) / 60;
        Self {
            id: Some(e.id),
            kind: e.kind,
            date: start.format("%Y-%m-%d").to_string(),
            time: start.format("%H:%M").to_string(),
            hours: (mins / 60).to_string(),
            mins: (mins % 60).to_string(),
            note: e.note.clone(),
        }
    }

    /// `(start, end)` or a message saying what's wrong.
    fn parse(&self) -> Result<(i64, i64), &'static str> {
        let date = NaiveDate::parse_from_str(&self.date, "%Y-%m-%d").map_err(|_| "Pick a date.")?;
        let time = NaiveTime::parse_from_str(&self.time, "%H:%M").map_err(|_| "Pick a start time.")?;
        let num = |s: &str| s.trim().parse::<i64>().ok().filter(|n| *n >= 0);
        let (h, m) = num(&self.hours).zip(num(&self.mins)).ok_or("Hours and minutes must be whole numbers.")?;
        let dur = h * 3600 + m * 60;
        if dur == 0 || dur > 24 * 3600 {
            return Err("Duration must be between 1 minute and 24 hours.");
        }
        let start = local_ts(date, time);
        Ok((start, start + dur))
    }
}

/// `Mon 03 Nov 14:00–15:30`
fn span_text(e: &Entry) -> String {
    format!("{}–{}", local(e.start).format("%a %d %b %H:%M"), local(e.end).format("%H:%M"))
}

fn local(ts: i64) -> DateTime<Local> {
    DateTime::from_timestamp(ts, 0).unwrap_or_default().with_timezone(&Local)
}

#[component]
pub fn StatsTab() -> Element {
    let store = use_context::<Signal<Store>>();
    let mut period = use_signal(|| Period::Week);
    let mut draft = use_signal(|| None::<Draft>);
    let mut confirm = use_signal(|| None::<u64>);
    let now = NOW();
    let today = today();
    let p = period();
    let range = p.range(today);
    let st = store.read();
    let wasted = st.total(Kind::Wasted, range, now);
    let productive = st.total(Kind::Productive, range, now);

    let nudge = match (wasted, productive) {
        (0, 0) => format!("Nothing logged {} yet.", p.this()),
        (0, _) => format!("Zero time wasted {}. Keep going.", p.this()),
        (w, pr) => format!(
            "You wasted {} {}! {}% of your tracked time was productive.",
            fmt_dur(w),
            p.this(),
            100 * pr / (w + pr)
        ),
    };

    let week: Vec<(String, i64, i64)> = (0..7)
        .rev()
        .map(|back| {
            let d = today - Days::new(back);
            let r = Period::Day.range(d);
            let letter = d.format("%a").to_string()[..1].to_string();
            (letter, st.total(Kind::Productive, r, now), st.total(Kind::Wasted, r, now))
        })
        .collect();
    // Scale against at least an hour so a 2-minute day doesn't fill the strip.
    let peak = week.iter().map(|(_, p, w)| (*p).max(*w)).max().unwrap_or(0).max(3600) as f64;

    let mut entries: Vec<Entry> = st
        .entries
        .iter()
        .filter(|e| e.end > range.0 && e.start < range.1)
        .cloned()
        .collect();
    entries.sort_by_key(|e| std::cmp::Reverse(e.start));

    rsx! {
        div { class: "tab stats-tab",
            div { class: "seg",
                for per in Period::ALL {
                    button {
                        key: "{per.label()}",
                        class: if per == p { "seg-btn on" } else { "seg-btn" },
                        onclick: move |_| period.set(per),
                        "{per.label()}"
                    }
                }
            }
            div { class: "glass-bg",
                div { class: "grid2",
                    div { class: "stat wasted",
                        div { class: "stat-num", "{fmt_dur(wasted)}" }
                        div { class: "caption", "wasted · {p.this()}" }
                    }
                    div { class: "stat productive",
                        div { class: "stat-num", "{fmt_dur(productive)}" }
                        div { class: "caption", "productive · {p.this()}" }
                    }
                }
            }
            p { class: "nudge", "{nudge}" }
            div { class: "bars",
                for (i, (letter, pr, w)) in week.into_iter().enumerate() {
                    div { key: "{i}", class: "bar-col", title: "{fmt_dur(pr)} productive · {fmt_dur(w)} wasted",
                        div { class: "bar-pair",
                            div { class: "bar productive", style: "height: {pr as f64 / peak * 100.0}%" }
                            div { class: "bar wasted", style: "height: {w as f64 / peak * 100.0}%" }
                        }
                        span { class: "caption", "{letter}" }
                    }
                }
            }
            div { class: "row between",
                span { class: "caption", "entries · {p.this()}" }
                button { class: "btn small", onclick: move |_| draft.set(Some(Draft::new())),
                    Icon { d: PLUS }
                    "Add time"
                }
            }
            if entries.is_empty() {
                div { class: "empty", "No entries {p.this()}." }
            }
            ul { class: "list",
                for e in entries {
                    li { key: "{e.id}", class: "item",
                        span { class: "dot-kind {e.kind.class()}" }
                        div { class: "grow",
                            div { class: "item-text", {span_text(&e)} }
                            if !e.note.is_empty() {
                                div { class: "muted small", "{e.note}" }
                            }
                        }
                        span { class: "chip", "{fmt_dur(e.end - e.start)}" }
                        button {
                            class: "icon-btn ghost",
                            title: "Edit",
                            onclick: {
                                let e = e.clone();
                                move |_| draft.set(Some(Draft::from(&e)))
                            },
                            Icon { d: PENCIL }
                        }
                        button {
                            class: "icon-btn ghost",
                            title: "Delete",
                            onclick: move |_| confirm.set(Some(e.id)),
                            Icon { d: TRASH }
                        }
                    }
                }
            }
            if draft().is_some() {
                EntryForm { draft }
            }
            if let Some(id) = confirm() {
                div { class: "overlay",
                    div { class: "popup",
                        h3 { "Delete this entry?" }
                        p { class: "muted", "This can't be undone." }
                        div { class: "row end gap",
                            button { class: "btn", onclick: move |_| confirm.set(None), "Cancel" }
                            button {
                                class: "btn danger",
                                onclick: move |_| {
                                    commit(store, |s| s.entries.retain(|x| x.id != id));
                                    confirm.set(None);
                                },
                                "Delete"
                            }
                        }
                    }
                }
            }
        }
    }
}

#[component]
fn EntryForm(draft: Signal<Option<Draft>>) -> Element {
    let store = use_context::<Signal<Store>>();
    let mut error = use_signal(|| None::<&'static str>);
    let Some(d) = draft() else { return rsx! {} };
    let mut edit = move |f: fn(&mut Draft, String), v: String| {
        if let Some(d) = draft.write().as_mut() {
            f(d, v);
        }
    };

    let save = move |e: FormEvent| {
        e.prevent_default();
        let Some(d) = draft.peek().clone() else { return };
        match d.parse() {
            Err(msg) => error.set(Some(msg)),
            Ok((start, end)) => {
                commit(store, |s| match d.id {
                    Some(id) => {
                        if let Some(x) = s.entries.iter_mut().find(|x| x.id == id) {
                            (x.kind, x.start, x.end, x.note) = (d.kind, start, end, d.note.trim().into());
                        }
                    }
                    None => s.add_entry(d.kind, start, end, d.note.trim().into()),
                });
                draft.set(None);
            }
        }
    };

    rsx! {
        div { class: "overlay",
            form { class: "popup", onsubmit: save,
                h3 { if d.id.is_some() { "Edit time" } else { "Add time" } }
                div { class: "seg",
                    for kind in [Kind::Productive, Kind::Wasted] {
                        button {
                            key: "{kind.class()}",
                            r#type: "button",
                            class: if d.kind == kind { "seg-btn on {kind.class()}" } else { "seg-btn" },
                            onclick: move |_| {
                                if let Some(d) = draft.write().as_mut() {
                                    d.kind = kind;
                                }
                            },
                            "{kind.label()}"
                        }
                    }
                }
                div { class: "row gap",
                    div { class: "input grow",
                        input { r#type: "date", value: "{d.date}", oninput: move |e| edit(|d, v| d.date = v, e.value()) }
                    }
                    div { class: "input",
                        input { r#type: "time", value: "{d.time}", oninput: move |e| edit(|d, v| d.time = v, e.value()) }
                    }
                }
                div { class: "row gap",
                    div { class: "input grow",
                        input { r#type: "number", min: "0", max: "24", value: "{d.hours}", oninput: move |e| edit(|d, v| d.hours = v, e.value()) }
                        span { class: "muted", "h" }
                    }
                    div { class: "input grow",
                        input { r#type: "number", min: "0", max: "59", value: "{d.mins}", oninput: move |e| edit(|d, v| d.mins = v, e.value()) }
                        span { class: "muted", "m" }
                    }
                }
                div { class: "input",
                    input { placeholder: "Note (optional)", value: "{d.note}", oninput: move |e| edit(|d, v| d.note = v, e.value()) }
                }
                if let Some(msg) = error() {
                    p { class: "error", "{msg}" }
                }
                div { class: "row end gap",
                    button { class: "btn", r#type: "button", onclick: move |_| draft.set(None), "Cancel" }
                    button { class: "btn primary", r#type: "submit", "Save" }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn draft_validation() {
        let mut d = Draft::new();
        assert!(d.parse().is_ok());
        d.hours = "0".into();
        assert!(d.parse().is_err()); // zero length
        d.hours = "25".into();
        assert!(d.parse().is_err()); // over a day
        d.hours = "-1".into();
        assert!(d.parse().is_err());
        d.hours = "1".into();
        d.mins = "30".into();
        let (a, b) = d.parse().unwrap();
        assert_eq!(b - a, 90 * 60);
    }
}
