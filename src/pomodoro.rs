use crate::activity::{ASK, Ask};
use crate::i18n::{Tr, tr};
use crate::icons::{Icon, PAUSE, PLAY, RESET, SKIP};
use crate::store::{POMO_DEFAULTS, Settings, Store, fmt_clock, now};
use crate::{NOW, commit, sound};
use dioxus::prelude::*;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Phase {
    Focus,
    Short,
    Long,
}

impl Phase {
    pub fn label(self, t: &Tr) -> &'static str {
        match self {
            Phase::Focus => t.focus,
            Phase::Short => t.short_break,
            Phase::Long => t.long_break,
        }
    }
    fn class(self) -> &'static str {
        match self {
            Phase::Focus => "focus",
            Phase::Short => "short",
            Phase::Long => "long",
        }
    }
    fn secs(self, s: &Settings) -> i64 {
        60 * i64::from(match self {
            Phase::Focus => s.focus_min,
            Phase::Short => s.short_min,
            Phase::Long => s.long_min,
        })
    }
}

/// Pomodoro state. Not persisted: a restart starts a fresh cycle.
#[derive(Clone, Copy, PartialEq, Debug)]
pub struct Pomo {
    pub phase: Phase,
    /// Focus blocks completed this session.
    pub done: u32,
    /// Set while running.
    pub ends_at: Option<i64>,
    /// Seconds left while paused or not yet started.
    pub left: i64,
    /// Full length of the current phase, fixed when the phase was set up.
    pub total: i64,
}

impl Pomo {
    pub fn new(s: &Settings) -> Self {
        let total = Phase::Focus.secs(s);
        Self { phase: Phase::Focus, done: 0, ends_at: None, left: total, total }
    }

    pub fn running(&self) -> bool {
        self.ends_at.is_some()
    }

    pub fn untouched(&self) -> bool {
        !self.running() && self.left == self.total
    }

    pub fn remaining(&self, now: i64) -> i64 {
        self.ends_at.map_or(self.left, |e| (e - now).max(0))
    }

    pub fn start(&mut self, now: i64) {
        self.ends_at.get_or_insert(now + self.left);
    }

    pub fn pause(&mut self, now: i64) {
        if let Some(e) = self.ends_at.take() {
            self.left = (e - now).max(0);
        }
    }

    /// Moves to the next phase without logging anything.
    pub fn skip(&mut self, s: &Settings) {
        if self.phase == Phase::Focus {
            self.done += 1;
        }
        self.set_up_next(s);
    }

    fn set_up_next(&mut self, s: &Settings) {
        self.phase = match self.phase {
            Phase::Focus if self.done.is_multiple_of(s.rounds.max(1)) => Phase::Long,
            Phase::Focus => Phase::Short,
            _ => Phase::Focus,
        };
        self.total = self.phase.secs(s);
        self.left = self.total;
        self.ends_at = None;
    }

    /// Call every tick. When the phase has ended, returns the finished phase and,
    /// for a focus block, the `[start, end)` to log as productive.
    pub fn tick(&mut self, s: &Settings, now: i64) -> Option<(Phase, Option<(i64, i64)>)> {
        let end = self.ends_at.filter(|&e| now >= e)?;
        let finished = self.phase;
        let log = (finished == Phase::Focus).then(|| {
            self.done += 1;
            (end - self.total, end)
        });
        self.set_up_next(s);
        Some((finished, log))
    }
}

/// Starts the current phase. Starting focus stops the tracker so the same time isn't counted twice.
pub fn start(store: Signal<Store>, mut pomo: Signal<Pomo>, now: i64) {
    if pomo.peek().phase == Phase::Focus && store.peek().running.is_some() {
        commit(store, |s| s.stop(now));
    }
    pomo.write().start(now);
}

/// Start/pause, shared by the button and the global shortcut.
pub fn toggle(store: Signal<Store>, mut pomo: Signal<Pomo>) {
    let now = now();
    sound::button(&store.peek().settings, "click");
    if pomo.peek().running() {
        pomo.write().pause(now);
    } else {
        start(store, pomo, now);
    }
}

#[component]
pub fn FocusTab() -> Element {
    let store = use_context::<Signal<Store>>();
    let mut pomo = use_context::<Signal<Pomo>>();
    let mut show_settings = use_signal(|| false);
    let t = tr();
    let now = NOW();
    let p = pomo();
    let rounds = store.read().settings.rounds.max(1);
    let focus_activity = store.read().focus_activity.clone();
    let filled = if p.phase == Phase::Long { rounds } else { p.done % rounds };
    let pct = 100.0 * (1.0 - p.remaining(now) as f64 / p.total.max(1) as f64);

    rsx! {
        div { class: "tab focus-tab",
            div { class: "pomo-face {p.phase.class()}", class: if p.running() { "live" }, style: "--pct: {pct}%",
                div { class: "caption", "{p.phase.label(t)}" }
                if p.phase == Phase::Focus && !focus_activity.is_empty() {
                    div { class: "activity-now", "{focus_activity}" }
                }
                div { class: "pomo-time", "{fmt_clock(p.remaining(now))}" }
                div { class: "dots",
                    for i in 0..rounds {
                        span { class: if i < filled { "dot on" } else { "dot" } }
                    }
                }
                div { class: "pomo-bar", div { class: "pomo-fill" } }
            }
            div { class: "row center gap",
                button {
                    class: "btn icon-btn",
                    title: "{t.reset}",
                    onclick: move |_| {
                        sound::button(&store.peek().settings, "stop");
                        pomo.set(Pomo::new(&store.peek().settings));
                    },
                    Icon { d: RESET }
                }
                button {
                    class: "btn primary big",
                    onclick: move |_| {
                        // A fresh focus block asks what it's for; resuming or a break just goes.
                        let p = *pomo.peek();
                        if p.phase == Phase::Focus && p.untouched() {
                            *ASK.write() = Some(Ask::Focus);
                        } else {
                            toggle(store, pomo);
                        }
                    },
                    if p.running() {
                        Icon { d: PAUSE }
                        "{t.pause}"
                    } else {
                        Icon { d: PLAY }
                        "{t.start}"
                    }
                }
                button {
                    class: "btn icon-btn",
                    title: "{t.skip}",
                    onclick: move |_| {
                        sound::button(&store.peek().settings, "click");
                        pomo.write().skip(&store.peek().settings);
                    },
                    Icon { d: SKIP }
                }
            }
            div { class: if show_settings() { "section open" } else { "section" },
                button {
                    class: "section-head",
                    onclick: move |_| show_settings.toggle(),
                    "{t.timer}"
                    span { class: "chev", "+" }
                }
                if show_settings() {
                    TimerSettings {}
                }
            }
        }
    }
}

#[component]
fn TimerSettings() -> Element {
    let store = use_context::<Signal<Store>>();
    let mut pomo = use_context::<Signal<Pomo>>();
    let s = store.read().settings.clone();
    let t = tr();

    // Apply new lengths right away unless a phase is in progress.
    let mut refresh = move || {
        if pomo.peek().untouched() {
            let s = store.peek().settings.clone();
            let mut p = pomo.write();
            p.total = p.phase.secs(&s);
            p.left = p.total;
        }
    };
    let mut set = move |field: fn(&mut Settings) -> &mut u32, v: u32| {
        commit(store, |st| *field(&mut st.settings) = v);
        refresh();
    };

    rsx! {
        div { class: "timer-settings",
            Slider { label: t.focus, color: "var(--focus)", value: s.focus_min, min: 1, max: 90, minutes: true,
                oninput: move |v| set(|s| &mut s.focus_min, v) }
            Slider { label: t.short_break, color: "var(--short)", value: s.short_min, min: 1, max: 30, minutes: true,
                oninput: move |v| set(|s| &mut s.short_min, v) }
            Slider { label: t.long_break, color: "var(--long)", value: s.long_min, min: 1, max: 60, minutes: true,
                oninput: move |v| set(|s| &mut s.long_min, v) }
            Slider { label: t.rounds, color: "var(--rounds)", value: s.rounds, min: 1, max: 12, minutes: false,
                oninput: move |v| set(|s| &mut s.rounds, v) }
            button {
                class: "link",
                onclick: move |_| {
                    commit(store, |st| {
                        let s = &mut st.settings;
                        (s.focus_min, s.short_min, s.long_min, s.rounds) = POMO_DEFAULTS;
                    });
                    refresh();
                },
                "{t.reset_defaults}"
            }
        }
    }
}

#[component]
pub fn Slider(label: &'static str, color: &'static str, value: u32, min: u32, max: u32, minutes: bool, oninput: EventHandler<u32>) -> Element {
    let pct = 100.0 * f64::from(value - min) / f64::from(max - min);
    let shown = if minutes { format!("{value}:00") } else { value.to_string() };
    rsx! {
        label { class: "slider-row",
            span { class: "slider-label", "{label}" }
            span { class: "chip", "{shown}" }
            input {
                r#type: "range",
                class: "slider",
                style: "--c: {color}; --pct: {pct}%",
                min: "{min}",
                max: "{max}",
                value: "{value}",
                oninput: move |e| {
                    if let Ok(v) = e.value().parse() {
                        oninput.call(v);
                    }
                },
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cycle_logs_focus_and_hits_long_break() {
        let s = Settings { focus_min: 25, short_min: 5, long_min: 15, rounds: 2, ..Settings::default() };
        let mut p = Pomo::new(&s);
        let mut t = 0;
        p.start(t);
        assert_eq!(p.tick(&s, t + 10), None); // not due yet

        t += 25 * 60;
        let (phase, log) = p.tick(&s, t).unwrap();
        assert_eq!((phase, log), (Phase::Focus, Some((0, 25 * 60))));
        assert_eq!(p.phase, Phase::Short);
        assert!(!p.running()); // next phase waits for Start

        p.start(t);
        t += 5 * 60;
        assert_eq!(p.tick(&s, t), Some((Phase::Short, None))); // breaks aren't logged
        assert_eq!(p.phase, Phase::Focus);

        p.start(t);
        t += 25 * 60;
        p.tick(&s, t).unwrap();
        assert_eq!(p.phase, Phase::Long); // 2nd of 2 rounds
    }

    #[test]
    fn pause_keeps_remaining_and_logged_length_excludes_pause() {
        let s = Settings::default();
        let mut p = Pomo::new(&s);
        p.start(0);
        p.pause(600);
        assert_eq!(p.remaining(5000), 25 * 60 - 600);
        p.start(5000);
        let end = 5000 + 25 * 60 - 600;
        let (_, log) = p.tick(&s, end + 3).unwrap(); // tick lands a bit late
        let (a, b) = log.unwrap();
        assert_eq!((b - a, b), (25 * 60, end));
    }
}
