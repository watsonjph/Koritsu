//! Highlights, in the spirit of Apple Health's summary: a plain sentence about the period,
//! with a this-vs-previous comparison bar underneath.

use crate::activity;
use crate::i18n::{Tr, fill, kind_label, tr};
use crate::stats::{buckets, local};
use crate::store::{Kind, Period, Store, fmt_dur, today};
use crate::NOW;
use dioxus::prelude::*;

/// Per-day averages (plain totals for a single day) for this period and the previous one.
#[derive(Clone, Copy, PartialEq, Debug)]
pub struct Compare {
    pub now: i64,
    pub prev: i64,
}

impl Compare {
    /// Within 5% (or both under a minute) counts as "about the same".
    pub fn trend(self) -> std::cmp::Ordering {
        let diff = self.now - self.prev;
        if diff.abs() < 60 || diff.abs() * 20 <= self.prev.max(1) {
            std::cmp::Ordering::Equal
        } else {
            diff.cmp(&0)
        }
    }

    fn is_empty(self) -> bool {
        self.now == 0 && self.prev == 0
    }
}

/// Average seconds of `kind` per day, this period (days so far) vs the previous one (all its days).
pub fn compare(store: &Store, kind: Kind, p: Period, today: chrono::NaiveDate, now: i64) -> Compare {
    let prev_day = p.previous(today);
    let avg = |day| store.total(kind, p.range(day), now) / p.days_elapsed(day, today);
    Compare { now: avg(today), prev: avg(prev_day) }
}

/// Completed Pomodoro focus blocks starting inside the range.
fn focus_blocks(store: &Store, (a, b): (i64, i64)) -> i64 {
    store
        .entries
        .iter()
        .filter(|e| e.kind == Kind::Productive && e.note == "Pomodoro" && (a..b).contains(&e.start))
        .count() as i64
}

struct Card {
    kind: Kind,
    title: String,
    text: String,
    /// (label, value text, fraction of the longer bar, is current period)
    bars: Vec<(String, String, f64, bool)>,
    /// Arrow badge and whether the change is good news.
    badge: Option<(String, bool)>,
}

fn comparison_card(t: &Tr, pi: usize, kind: Kind, c: Compare) -> Card {
    let per_day = if pi == 0 { "" } else { t.per_day };
    let lead = if pi == 0 { t.hl_today } else { t.hl_avg };
    let tail = match c.trend() {
        std::cmp::Ordering::Greater => t.hl_more,
        std::cmp::Ordering::Less => t.hl_less,
        std::cmp::Ordering::Equal => t.hl_same,
    };
    let args = [("d", fmt_dur(c.now)), ("k", kind_label(kind).to_lowercase()), ("p", t.this[pi].to_string()), ("prev", t.prev_phrase[pi].to_string())];
    let args: Vec<(&str, &str)> = args.iter().map(|(k, v)| (*k, v.as_str())).collect();
    let longest = c.now.max(c.prev).max(1) as f64;
    let badge = (c.trend() != std::cmp::Ordering::Equal && c.prev > 0).then(|| {
        let pct = (c.now - c.prev) * 100 / c.prev;
        let up = pct > 0;
        // More productive or less wasted is good news; break time is neutral.
        let good = match kind {
            Kind::Productive => up,
            Kind::Wasted => !up,
            Kind::Break => true,
        };
        (format!("{} {}%", if up { "▲" } else { "▼" }, pct.abs()), good)
    });
    Card {
        kind,
        title: kind_label(kind).to_string(),
        text: format!("{} {}", fill(lead, &args), fill(tail, &args)),
        bars: vec![
            (t.period_now[pi].into(), format!("{}{per_day}", fmt_dur(c.now)), c.now as f64 / longest, true),
            (t.period_prev[pi].into(), format!("{}{per_day}", fmt_dur(c.prev)), c.prev as f64 / longest, false),
        ],
        badge,
    }
}

#[component]
pub fn Highlights(period: Period) -> Element {
    let store = use_context::<Signal<Store>>();
    let t = tr();
    let now = NOW();
    let today = today();
    let st = store.read();
    let pi = Period::ALL.iter().position(|x| *x == period).unwrap_or(0);
    let range = period.range(today);
    let mut cards = Vec::new();

    for kind in Kind::ALL {
        let c = compare(&st, kind, period, today, now);
        if !c.is_empty() {
            cards.push(comparison_card(t, pi, kind, c));
        }
    }

    // Biggest time sink, if it has a name.
    let wasted = st.breakdown(Kind::Wasted, range, now);
    let wasted_total: i64 = wasted.iter().map(|(_, s)| s).sum();
    if let Some((name, secs)) = wasted.first().filter(|(n, _)| !n.is_empty()) {
        let share = *secs as f64 / wasted_total.max(1) as f64;
        let n = ((share * 100.0).round() as i64).to_string();
        cards.push(Card {
            kind: Kind::Wasted,
            title: t.by_activity.to_string(),
            text: fill(t.hl_top, &[("a", name), ("n", &n), ("p", t.this[pi])]),
            bars: vec![(activity::label(name).to_string(), fmt_dur(*secs), share, true)],
            badge: None,
        });
    }

    // Best hour / day / month for productive time.
    let best = buckets(period, today, t)
        .into_iter()
        .map(|b| (st.total(Kind::Productive, b.range, now), b))
        .filter(|(secs, _)| *secs > 0)
        .max_by_key(|(secs, _)| *secs);
    if let Some((secs, b)) = best {
        let start = local(b.range.0);
        let (template, when) = match period {
            Period::Day => (t.hl_best_hour, start.format("%H:00").to_string()),
            Period::Year => (t.hl_best_month, start.format(t.month_fmt).to_string()),
            _ => (t.hl_best_day, start.format(t.day_fmt).to_string()),
        };
        cards.push(Card {
            kind: Kind::Productive,
            title: t.productive.to_string(),
            text: fill(template, &[("when", &when), ("d", &fmt_dur(secs)), ("p", t.this[pi])]),
            bars: Vec::new(),
            badge: None,
        });
    }

    let blocks = (focus_blocks(&st, range), focus_blocks(&st, period.range(period.previous(today))));
    if blocks != (0, 0) {
        let longest = blocks.0.max(blocks.1).max(1) as f64;
        cards.push(Card {
            kind: Kind::Productive,
            title: t.focus.to_string(),
            text: fill(t.hl_focus, &[("n", &blocks.0.to_string()), ("p", t.this[pi])]),
            bars: vec![
                (t.period_now[pi].into(), blocks.0.to_string(), blocks.0 as f64 / longest, true),
                (t.period_prev[pi].into(), blocks.1.to_string(), blocks.1 as f64 / longest, false),
            ],
            badge: None,
        });
    }

    rsx! {
        div { class: "highlights",
            span { class: "caption", "{t.highlights}" }
            if cards.is_empty() {
                div { class: "empty", "{t.no_highlights}" }
            }
            for (i, card) in cards.into_iter().enumerate() {
                div { key: "{period:?}-{i}", class: "hl-card {card.kind.class()}", style: "animation-delay: {i * 40}ms",
                    div { class: "hl-head",
                        span { class: "dot-kind {card.kind.class()}" }
                        span { class: "hl-title", "{card.title}" }
                        if let Some((badge, good)) = card.badge {
                            span { class: if good { "hl-badge good" } else { "hl-badge bad" }, "{badge}" }
                        }
                    }
                    p { class: "hl-text", "{card.text}" }
                    for (label, value, frac, current) in card.bars {
                        div { key: "{label}", class: if current { "hl-bar now" } else { "hl-bar" },
                            div { class: "hl-bar-top",
                                span { "{label}" }
                                span { class: "hl-value", "{value}" }
                            }
                            div { class: "hl-track",
                                span { class: "hl-fill", style: "width: {frac * 100.0}%" }
                            }
                        }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::local_ts;
    use chrono::{NaiveDate, NaiveTime};
    use std::cmp::Ordering;

    #[test]
    fn compare_uses_elapsed_days_this_period() {
        let today = NaiveDate::from_ymd_opt(2026, 11, 5).unwrap(); // Thursday: 4 days in
        let at = |d: u32, h: u32| local_ts(NaiveDate::from_ymd_opt(2026, 11, d).unwrap(), NaiveTime::from_hms_opt(h, 0, 0).unwrap());
        let last_week = |d: u32, h: u32| local_ts(NaiveDate::from_ymd_opt(2026, 10, d).unwrap(), NaiveTime::from_hms_opt(h, 0, 0).unwrap());
        let mut s = Store::default();
        s.add_entry(Kind::Productive, at(2, 9), at(2, 17), String::new(), String::new()); // 8h this week
        s.add_entry(Kind::Productive, last_week(27, 9), last_week(27, 16), String::new(), String::new()); // 7h last week
        let c = compare(&s, Kind::Productive, Period::Week, today, at(5, 12));
        assert_eq!(c, Compare { now: 8 * 3600 / 4, prev: 3600 });
        assert_eq!(c.trend(), Ordering::Greater);
    }

    #[test]
    fn trend_ignores_tiny_changes() {
        assert_eq!(Compare { now: 3600, prev: 3500 }.trend(), Ordering::Equal); // < 5%
        assert_eq!(Compare { now: 30, prev: 0 }.trend(), Ordering::Equal); // under a minute
        assert_eq!(Compare { now: 1800, prev: 3600 }.trend(), Ordering::Less);
    }
}
