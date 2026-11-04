use crate::i18n::{Tr, fill, tr};
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

fn local(ts: i64) -> DateTime<Local> {
    DateTime::from_timestamp(ts, 0).unwrap_or_default().with_timezone(&Local)
}

/// One chart column: axis label (may be empty), tooltip name, `[start, end)`.
struct Bucket {
    label: String,
    name: String,
    range: (i64, i64),
}

/// Hours of the day, days of the week/month, or months of the year.
fn buckets(p: Period, today: NaiveDate, t: &Tr) -> Vec<Bucket> {
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

    let nudge = match (wasted, productive) {
        (0, 0) => fill(t.nudge_none, &[("p", this)]),
        (0, _) => fill(t.nudge_clean, &[("p", this)]),
        (w, pr) => fill(t.nudge, &[("d", &fmt_dur(w)), ("p", this), ("n", &(100 * pr / (w + pr)).to_string())]),
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
            div { class: "glass-bg",
                div { class: "grid2",
                    div { class: "stat wasted",
                        div { class: "stat-num", "{fmt_dur(wasted)}" }
                        div { class: "caption", "{t.wasted}" }
                        div { class: "caption faint", "{this}" }
                    }
                    div { class: "stat productive",
                        div { class: "stat-num", "{fmt_dur(productive)}" }
                        div { class: "caption", "{t.productive}" }
                        div { class: "caption faint", "{this}" }
                    }
                }
            }
            p { class: "nudge", "{nudge}" }
            Chart { period: p }
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
                                {format!("{}–{}", local(e.start).format(t.entry_fmt), local(e.end).format("%H:%M"))}
                            }
                            if !e.note.is_empty() {
                                div { class: "muted small", "{e.note}" }
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
    let cols: Vec<(Bucket, i64, i64)> = buckets(period, today(), t)
        .into_iter()
        .map(|b| {
            let p = st.total(Kind::Productive, b.range, now);
            let w = st.total(Kind::Wasted, b.range, now);
            (b, p, w)
        })
        .collect();
    // Scale against at least an hour so a 2-minute bucket doesn't fill the chart.
    let peak = cols.iter().map(|(_, p, w)| (*p).max(*w)).max().unwrap_or(0).max(3600) as f64;
    let h = |v: i64| v as f64 / peak * 100.0;

    rsx! {
        div { class: "chart",
            div { class: "legend",
                span { span { class: "swatch productive" } "▲ {t.productive}" }
                span { span { class: "swatch wasted" } "▼ {t.wasted}" }
            }
            div { class: "plot",
                for (i, (b, p, w)) in cols.into_iter().enumerate() {
                    div {
                        key: "{period:?}-{i}",
                        class: if (b.range.0..b.range.1).contains(&now) { "col now" } else { "col" },
                        title: "{b.name}\n▲ {fmt_dur(p)}\n▼ {fmt_dur(w)}",
                        div { class: "half up", div { class: "bar productive", style: "height: {h(p)}%" } }
                        div { class: "half down", div { class: "bar wasted", style: "height: {h(w)}%" } }
                        span { class: "tick", "{b.label}" }
                    }
                }
            }
        }
    }
}

/// Dimmed backdrop that closes on Escape or a click outside the dialog.
#[component]
pub fn Overlay(onclose: EventHandler<()>, children: Element) -> Element {
    rsx! {
        div {
            class: "overlay",
            tabindex: "-1",
            onmounted: move |e| async move {
                let _ = e.set_focus(true).await;
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
    let ki = usize::from(d.kind == Kind::Wasted);

    rsx! {
        Overlay { onclose: move |_| draft.set(None),
            form { class: "popup", onsubmit: save,
                h3 { if d.id.is_some() { "{t.edit_time}" } else { "{t.add_time}" } }
                div { class: "seg", style: "--i: {ki}; --n: 2",
                    span { class: "seg-pill {d.kind.class()}" }
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
                            if kind == Kind::Productive { "{t.productive}" } else { "{t.wasted}" }
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
