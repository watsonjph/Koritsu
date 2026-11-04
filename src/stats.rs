use crate::activity;
use crate::i18n::{Tr, fill, kind_label, tr};
use crate::icons::{Icon, PENCIL, PLUS, TRASH};
use crate::store::{Entry, Kind, Period, Store, fmt_dur, local_ts, today};
use crate::{NOW, commit};
use chrono::{DateTime, Datelike, Days, Local, NaiveDate, NaiveTime};
use dioxus::prelude::*;

/// The add/edit form's fields, kept as the raw strings the inputs produce.
#[derive(Clone, PartialEq)]
struct Draft {
    id: Option<u64>,
    kind: Kind,
    activity: String,
    date: String,
    time: String,
    hours: String,
    mins: String,
    note: String,
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum DraftErr {
    Date,
    Time,
    Numbers,
    Duration,
}

impl DraftErr {
    fn text(self, t: &Tr) -> &'static str {
        match self {
            DraftErr::Date => t.err_date,
            DraftErr::Time => t.err_time,
            DraftErr::Numbers => t.err_numbers,
            DraftErr::Duration => t.err_duration,
        }
    }
}

impl Draft {
    fn new() -> Self {
        let now = Local::now();
        Self {
            id: None,
            kind: Kind::Wasted,
            activity: String::new(),
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
            activity: e.activity.clone(),
            date: start.format("%Y-%m-%d").to_string(),
            time: start.format("%H:%M").to_string(),
            hours: (mins / 60).to_string(),
            mins: (mins % 60).to_string(),
            note: e.note.clone(),
        }
    }

    fn parse(&self) -> Result<(i64, i64), DraftErr> {
        let date = NaiveDate::parse_from_str(&self.date, "%Y-%m-%d").map_err(|_| DraftErr::Date)?;
        let time = NaiveTime::parse_from_str(&self.time, "%H:%M").map_err(|_| DraftErr::Time)?;
        let num = |s: &str| s.trim().parse::<i64>().ok().filter(|n| *n >= 0);
        let (h, m) = num(&self.hours).zip(num(&self.mins)).ok_or(DraftErr::Numbers)?;
        let dur = h * 3600 + m * 60;
        if dur == 0 || dur > 24 * 3600 {
            return Err(DraftErr::Duration);
        }
        let start = local_ts(date, time);
        Ok((start, start + dur))
    }
}

pub(crate) fn local(ts: i64) -> DateTime<Local> {
    DateTime::from_timestamp(ts, 0).unwrap_or_default().with_timezone(&Local)
}

/// One chart column: axis label (may be empty), tooltip name, `[start, end)`.
pub(crate) struct Bucket {
    pub label: String,
    pub name: String,
    pub range: (i64, i64),
}

/// Hours of the day, days of the week/month, or months of the year.
pub(crate) fn buckets(p: Period, today: NaiveDate, t: &Tr) -> Vec<Bucket> {
    let midnight = |d: NaiveDate| local_ts(d, NaiveTime::MIN);
    let (first, next) = p.bounds(today);
    match p {
        Period::Day => (0..24)
            .map(|h| {
                let end = if h == 23 { midnight(next) } else { local_ts(first, NaiveTime::from_hms_opt(h + 1, 0, 0).expect("hour")) };
                Bucket {
                    label: if h % 6 == 0 { h.to_string() } else { String::new() },
                    name: format!("{h:02}:00"),
                    range: (local_ts(first, NaiveTime::from_hms_opt(h, 0, 0).expect("hour")), end),
                }
            })
            .collect(),
        Period::Week | Period::Month => first
            .iter_days()
            .take_while(|d| *d < next)
            .map(|d| Bucket {
                label: if p == Period::Week {
                    t.weekdays[d.weekday().num_days_from_monday() as usize].to_string()
                } else if d.day() == 1 || d.day() % 5 == 0 {
                    d.day().to_string()
                } else {
                    String::new()
                },
                name: d.format("%Y-%m-%d").to_string(),
                range: (midnight(d), midnight(d + Days::new(1))),
            })
            .collect(),
        Period::Year => (1..=12)
            .map(|m| {
                let d = NaiveDate::from_ymd_opt(first.year(), m, 1).expect("month");
                Bucket {
                    label: t.months[m as usize - 1].to_string(),
                    name: d.format("%Y-%m").to_string(),
                    range: (midnight(d), Period::Month.range(d).1),
                }
            })
            .collect(),
    }
}

#[component]
pub fn StatsTab() -> Element {
    let store = use_context::<Signal<Store>>();
    let mut period = use_signal(|| Period::Week);
    let mut draft = use_signal(|| None::<Draft>);
    let mut confirm = use_signal(|| None::<u64>);
    let t = tr();
    let now = NOW();
    let today = today();
    let p = period();
    let pi = Period::ALL.iter().position(|x| *x == p).unwrap_or(0);
    let this = t.this[pi];
    let range = p.range(today);
    let st = store.read();
    let wasted = st.total(Kind::Wasted, range, now);
    let productive = st.total(Kind::Productive, range, now);
    let rest = st.total(Kind::Break, range, now);

    let nudge = match (wasted, productive) {
        (0, 0) => fill(t.nudge_none, &[("p", this)]),
        (0, _) => fill(t.nudge_clean, &[("p", this)]),
        (w, pr) => fill(t.nudge, &[("d", &fmt_dur(w)), ("p", this), ("n", &(100 * pr / (w + pr)).to_string())]),
    };
    let wasted_by = st.breakdown(Kind::Wasted, range, now);
    let productive_by = st.breakdown(Kind::Productive, range, now);
    // Name the biggest time sink, if it has a name.
    let nudge = match wasted_by.first() {
        Some((name, secs)) if !name.is_empty() => format!("{nudge} {}", fill(t.nudge_top, &[("a", name), ("d", &fmt_dur(*secs))])),
        _ => nudge,
    };

    let mut entries: Vec<Entry> = st
        .entries
        .iter()
        .filter(|e| e.end > range.0 && e.start < range.1)
        .cloned()
        .collect();
    entries.sort_by_key(|e| std::cmp::Reverse(e.start));

    rsx! {
        div { class: "tab stats-tab",
            div { class: "seg", style: "--i: {pi}; --n: 4",
                span { class: "seg-pill" }
                for (i, per) in Period::ALL.into_iter().enumerate() {
                    button {
                        key: "{i}",
                        class: if per == p { "seg-btn on" } else { "seg-btn" },
                        onclick: move |_| period.set(per),
                        "{t.periods[i]}"
                    }
                }
            }
            div { class: "mini-stats",
                div { class: "mini wasted",
                    span { class: "mini-num", "{fmt_dur(wasted)}" }
                    span { class: "caption", "{t.wasted} · {this}" }
                }
                div { class: "mini productive",
                    span { class: "mini-num", "{fmt_dur(productive)}" }
                    span { class: "caption", "{t.productive} · {this}" }
                }
                if rest > 0 {
                    div { class: "mini break",
                        span { class: "mini-num", "{fmt_dur(rest)}" }
                        span { class: "caption", "{t.break_time} · {this}" }
                    }
                }
            }
            p { class: "nudge", "{nudge}" }
            crate::summary::Highlights { period: p }
            Chart { period: p }
            if !(wasted_by.is_empty() && productive_by.is_empty()) {
                div { class: "breakdown",
                    span { class: "caption", "{t.by_activity}" }
                    Breakdown { kind: Kind::Wasted, rows: wasted_by, total: wasted }
                    Breakdown { kind: Kind::Productive, rows: productive_by, total: productive }
                }
            }
            div { class: "row between",
                span { class: "caption", "{t.entries} · {this}" }
                button { class: "btn small", onclick: move |_| draft.set(Some(Draft::new())),
                    Icon { d: PLUS }
                    "{t.add_time}"
                }
            }
            if entries.is_empty() {
                div { class: "empty", {fill(t.no_entries, &[("p", this)])} }
            }
            ul { class: "list",
                for e in entries {
                    li { key: "{e.id}", class: "item",
                        span { class: "dot-kind {e.kind.class()}" }
                        div { class: "grow",
                            div { class: "item-text",
                                if e.kind == Kind::Break && e.activity.is_empty() { "{t.break_time}" } else { "{activity::label(&e.activity)}" }
                            }
                            div { class: "muted small",
                                {format!("{}–{}", local(e.start).format(t.entry_fmt), local(e.end).format("%H:%M"))}
                                if !e.note.is_empty() { " · {e.note}" }
                            }
                        }
                        span { class: "chip", "{fmt_dur(e.end - e.start)}" }
                        button {
                            class: "icon-btn ghost",
                            title: "{t.edit}",
                            onclick: {
                                let e = e.clone();
                                move |_| draft.set(Some(Draft::from(&e)))
                            },
                            Icon { d: PENCIL }
                        }
                        button {
                            class: "icon-btn ghost",
                            title: "{t.delete}",
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
                Overlay { onclose: move |_| confirm.set(None),
                    div { class: "popup",
                        h3 { "{t.delete_q}" }
                        p { class: "muted", "{t.cant_undo}" }
                        div { class: "row end gap",
                            button { class: "btn", onclick: move |_| confirm.set(None), "{t.cancel}" }
                            button {
                                class: "btn danger",
                                onclick: move |_| {
                                    commit(store, |s| s.entries.retain(|x| x.id != id));
                                    confirm.set(None);
                                },
                                "{t.delete}"
                            }
                        }
                    }
                }
            }
        }
    }
}

/// Diverging bars: productive grows up from the baseline, wasted grows down,
/// so the two never rely on colour alone.
#[component]
fn Chart(period: Period) -> Element {
    let store = use_context::<Signal<Store>>();
    let t = tr();
    let now = NOW();
    let st = store.read();
    // Tooltip line: total plus the top two activities, e.g. "▲ 2h 0m · Coding 1h 30m, Reading 30m".
    let line = |kind: Kind, range| {
        let rows = st.breakdown(kind, range, now);
        let total: i64 = rows.iter().map(|(_, s)| s).sum();
        let top: Vec<String> = rows.iter().take(2).map(|(n, s)| format!("{} {}", activity::label(n), fmt_dur(*s))).collect();
        let arrow = match kind {
            Kind::Productive => "▲",
            Kind::Wasted => "▼",
            Kind::Break => "☕",
        };
        let text = if top.is_empty() { format!("{arrow} 0m") } else { format!("{arrow} {} · {}", fmt_dur(total), top.join(", ")) };
        (total, text)
    };
    let cols: Vec<(Bucket, i64, i64, i64, String)> = buckets(period, today(), t)
        .into_iter()
        .map(|b| {
            let (p, pt) = line(Kind::Productive, b.range);
            let (w, wt) = line(Kind::Wasted, b.range);
            let r = st.total(Kind::Break, b.range, now);
            let rt = if r > 0 { format!("\n☕ {}", fmt_dur(r)) } else { String::new() };
            let tip = format!("{}\n{pt}\n{wt}{rt}", b.name);
            (b, p, w, r, tip)
        })
        .collect();
    // Scale against at least an hour so a 2-minute bucket doesn't fill the chart.
    let peak = cols.iter().map(|(_, p, w, r, _)| (p + r).max(*w)).max().unwrap_or(0).max(3600) as f64;
    let h = |v: i64| v as f64 / peak * 100.0;

    rsx! {
        div { class: "chart",
            div { class: "legend",
                span { span { class: "swatch productive" } "▲ {t.productive}" }
                span { span { class: "swatch wasted" } "▼ {t.wasted}" }
                span { span { class: "swatch break" } "☕ {t.break_time}" }
            }
            div { class: "plot",
                for (i, (b, p, w, r, tip)) in cols.into_iter().enumerate() {
                    div {
                        key: "{period:?}-{i}",
                        class: if (b.range.0..b.range.1).contains(&now) { "col now" } else { "col" },
                        title: "{tip}",
                        div { class: "half up",
                            div { class: "bar-stack",
                                if r > 0 { div { class: "bar break", style: "height: {h(r)}%" } }
                                div { class: "bar productive", style: "height: {h(p)}%" }
                            }
                        }
                        div { class: "half down", div { class: "bar wasted", style: "height: {h(w)}%" } }
                        span { class: "tick", "{b.label}" }
                    }
                }
            }
        }
    }
}

/// One kind's time split by activity, as proportional bars.
#[component]
fn Breakdown(kind: Kind, rows: Vec<(String, i64)>, total: i64) -> Element {
    rsx! {
        ul { class: "list",
            for (name, secs) in rows {
                li { key: "{name}", class: "share-row",
                    span { class: "dot-kind {kind.class()}" }
                    span { class: "share-name", "{activity::label(&name)}" }
                    span { class: "share-bar", span { class: "share-fill {kind.class()}", style: "width: {secs as f64 / total.max(1) as f64 * 100.0}%" } }
                    span { class: "chip", "{fmt_dur(secs)}" }
                }
            }
        }
    }
}

/// Dimmed backdrop that closes on Escape or a click outside the dialog.
#[component]
pub fn Overlay(onclose: EventHandler<()>, children: Element, #[props(default = true)] focus_self: bool) -> Element {
    rsx! {
        div {
            class: "overlay",
            tabindex: "-1",
            onmounted: move |e| async move {
                if focus_self {
                    let _ = e.set_focus(true).await;
                }
            },
            onkeydown: move |e| {
                if e.key() == Key::Escape {
                    e.stop_propagation();
                    onclose.call(());
                }
            },
            onclick: move |_| onclose.call(()),
            div { onclick: |e| e.stop_propagation(), {children} }
        }
    }
}

#[component]
fn EntryForm(draft: Signal<Option<Draft>>) -> Element {
    let store = use_context::<Signal<Store>>();
    let mut error = use_signal(|| None::<DraftErr>);
    let t = tr();
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
            Err(err) => error.set(Some(err)),
            Ok((start, end)) => {
                let activity = d.activity.trim().to_string();
                commit(store, |s| {
                    s.remember(d.kind, &activity);
                    match d.id {
                        Some(id) => {
                            if let Some(x) = s.entries.iter_mut().find(|x| x.id == id) {
                                (x.kind, x.start, x.end, x.activity, x.note) = (d.kind, start, end, activity, d.note.trim().into());
                            }
                        }
                        None => s.add_entry(d.kind, start, end, activity, d.note.trim().into()),
                    }
                });
                draft.set(None);
            }
        }
    };
    let ki = Kind::ALL.iter().position(|k| *k == d.kind).unwrap_or(0);
    let suggestions = store.read().activities(d.kind).to_vec();

    rsx! {
        Overlay { onclose: move |_| draft.set(None),
            form { class: "popup", onsubmit: save,
                h3 { if d.id.is_some() { "{t.edit_time}" } else { "{t.add_time}" } }
                div { class: "seg", style: "--i: {ki}; --n: 3",
                    span { class: "seg-pill {d.kind.class()}" }
                    for kind in Kind::ALL {
                        button {
                            key: "{kind.class()}",
                            r#type: "button",
                            class: if d.kind == kind { "seg-btn on {kind.class()}" } else { "seg-btn" },
                            onclick: move |_| {
                                if let Some(d) = draft.write().as_mut() {
                                    d.kind = kind;
                                }
                            },
                            "{kind_label(kind)}"
                        }
                    }
                }
                div { class: if d.kind == Kind::Break { "input hidden" } else { "input" },
                    input {
                        placeholder: "{t.activity}",
                        list: "activity-suggestions",
                        value: "{d.activity}",
                        oninput: move |e| edit(|d, v| d.activity = v, e.value()),
                    }
                    datalist { id: "activity-suggestions",
                        for a in suggestions {
                            option { key: "{a}", value: "{a}" }
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
                    input { placeholder: "{t.note}", value: "{d.note}", oninput: move |e| edit(|d, v| d.note = v, e.value()) }
                }
                if let Some(err) = error() {
                    p { class: "error", "{err.text(t)}" }
                }
                div { class: "row end gap",
                    button { class: "btn", r#type: "button", onclick: move |_| draft.set(None), "{t.cancel}" }
                    button { class: "btn primary", r#type: "submit", "{t.save}" }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::i18n::EN;

    #[test]
    fn draft_validation() {
        let mut d = Draft::new();
        assert!(d.parse().is_ok());
        d.hours = "0".into();
        assert_eq!(d.parse(), Err(DraftErr::Duration)); // zero length
        d.hours = "25".into();
        assert_eq!(d.parse(), Err(DraftErr::Duration)); // over a day
        d.hours = "-1".into();
        assert_eq!(d.parse(), Err(DraftErr::Numbers));
        d.hours = "1".into();
        d.mins = "30".into();
        let (a, b) = d.parse().unwrap();
        assert_eq!(b - a, 90 * 60);
    }

    #[test]
    fn buckets_tile_the_period() {
        let d = |y, m, day| NaiveDate::from_ymd_opt(y, m, day).unwrap();
        for (p, day, n) in [
            (Period::Day, d(2026, 11, 5), 24),
            (Period::Week, d(2026, 11, 5), 7),
            (Period::Month, d(2027, 2, 10), 28),
            (Period::Month, d(2026, 12, 31), 31),
            (Period::Year, d(2026, 11, 5), 12),
        ] {
            let b = buckets(p, day, &EN);
            assert_eq!(b.len(), n, "{p:?}");
            // Contiguous and exactly covering the period.
            assert_eq!(b[0].range.0, p.range(day).0);
            assert_eq!(b[n - 1].range.1, p.range(day).1);
            assert!(b.windows(2).all(|w| w[0].range.1 == w[1].range.0));
        }
        assert_eq!(buckets(Period::Week, d(2026, 11, 5), &EN)[0].label, "M");
    }
}
