use crate::activity::{self, ASK, Ask};
use crate::i18n::{kind_label, tr};
use crate::icons::{Icon, MOON, PAUSE, PLAY, RESET, SKIP, STOP, TIMER};
use crate::pomodoro::{self, Phase, Pomo};
use crate::store::{Kind, Period, Store, fmt_clock, fmt_dur, now, today};
use crate::{NOW, commit, sound};
use dioxus::prelude::*;

/// Start tracking `kind` as `activity`, logging whatever ran before.
pub fn start(store: Signal<Store>, mut pomo: Signal<Pomo>, kind: Kind, activity: String) {
    let now = now();
    // A running focus block would count the same minutes twice.
    if pomo.peek().running() && pomo.peek().phase == Phase::Focus {
        pomo.write().pause(now);
    }
    sound::button(&store.peek().settings, kind.class());
    commit(store, |s| s.start(kind, activity, now));
}

/// Global shortcut: start `kind` with its most recent activity, or stop it if it's running.
pub fn toggle(store: Signal<Store>, pomo: Signal<Pomo>, kind: Kind) {
    if is_running(store, kind) {
        stop(store);
    } else {
        start(store, pomo, kind, activity::last(store, kind));
    }
}

fn is_running(store: Signal<Store>, kind: Kind) -> bool {
    store.peek().running.as_ref().is_some_and(|r| r.kind == kind)
}

pub fn stop(store: Signal<Store>) {
    if store.peek().running.is_none() {
        return;
    }
    sound::button(&store.peek().settings, "stop");
    commit(store, |s| s.stop(now()));
}

#[component]
pub fn TrackTab() -> Element {
    let store = use_context::<Signal<Store>>();
    let mut pomo = use_context::<Signal<Pomo>>();
    let mut quote = use_signal(|| now() as usize);
    let t = tr();
    let now = NOW();
    let st = store.read();
    let running = st.running.clone();
    let day = Period::Day.range(today());
    let totals = Kind::ALL.map(|k| (k, st.total(k, day, now)));
    let quotes = &st.settings.quotes;
    let quote_text = (!quotes.is_empty()).then(|| quotes[quote() % quotes.len()].clone());
    let show_scene = st.settings.character.show;
    let rounds = st.settings.rounds.max(1);
    let active = |k: Kind| running.as_ref().is_some_and(|r| r.kind == k);

    let p = *pomo.read();
    // With nothing tracked, a running Pomodoro is what's going on (Senko's mood follows it too).
    let pomo_live = running.is_none() && p.running();
    let pomo_class = if p.phase == Phase::Focus { Kind::Productive.class() } else { Kind::Break.class() };
    let filled = if p.phase == Phase::Long { rounds } else { p.done % rounds };
    // A break with a set length counts down what's left, then up with a + once it's over.
    let run_clock = |start: i64| match st.break_left(now) {
        Some(left) if left > 0 => fmt_clock(left),
        Some(left) => format!("+{}", fmt_clock(-left)),
        None => fmt_clock(now - start),
    };
    let (status, clock) = match &running {
        Some(r) if r.activity.is_empty() => (kind_label(r.kind).to_string(), run_clock(r.start)),
        Some(r) => (format!("{} · {}", kind_label(r.kind), r.activity), run_clock(r.start)),
        None if pomo_live => (p.phase.label(t).to_string(), fmt_clock(p.remaining(now))),
        None => (t.idle.to_string(), "00:00".to_string()),
    };
    let kind_class = match &running {
        Some(r) => r.kind.class(),
        None if pomo_live => pomo_class,
        None => "idle",
    };
    let live = running.is_some() || pomo_live;
    // Productive and wasted time have named activities to switch between; breaks don't.
    let switchable = running.as_ref().map(|r| r.kind).filter(|k| *k != Kind::Break);
    let switch = move |_| {
        if let Some(kind) = switchable {
            *ASK.write() = Some(Ask::Switch(kind));
        }
    };

    rsx! {
        div { class: "tab track-tab",
            if show_scene {
                div { class: "scene-card",
                    crate::scene::Scene { preview: None }
                    // Only while something runs: what it is and for how long. Tap to switch activity.
                    if live {
                        div { class: "hud",
                            button {
                                class: "hud-pill {kind_class}",
                                class: if switchable.is_some() { "switch" },
                                title: if switchable.is_some() { t.switch_activity },
                                onclick: switch,
                                span { class: "live-dot {kind_class}" }
                                span { class: "pill-text", "{status}" }
                                span { class: "hud-clock", "{clock}" }
                            }
                        }
                    }
                }
            } else {
                div { class: "timer-face",
                    button { class: "caption {kind_class}", onclick: switch,
                        if live { span { class: "live-dot {kind_class}" } }
                        "{status}"
                    }
                    div { class: if live { "big-clock" } else { "big-clock dim" }, "{clock}" }
                }
            }

            // Tap to start, tap again to stop. Focus runs the Pomodoro.
            div { class: "track-buttons",
                for kind in Kind::ALL {
                    button {
                        key: "{kind.class()}",
                        class: "track-btn {kind.class()}",
                        class: if active(kind) { "active" },
                        onclick: move |_| {
                            if is_running(store, kind) {
                                stop(store);
                            } else if kind == Kind::Break {
                                // Breaks have no activity to ask about.
                                start(store, pomo, kind, String::new());
                            } else {
                                *ASK.write() = Some(Ask::Track(kind));
                            }
                        },
                        Icon { d: if active(kind) { STOP } else if kind == Kind::Break { MOON } else { PLAY } }
                        span { class: "btn-text", "{kind_label(kind)}" }
                    }
                }
                button {
                    key: "focus",
                    class: "track-btn {pomo_class}",
                    class: if p.running() { "active" },
                    title: "{p.phase.label(t)}",
                    onclick: move |_| pomodoro::press(store, pomo),
                    Icon { d: if p.running() { PAUSE } else { TIMER } }
                    span { class: "btn-text",
                        if p.untouched() { "{p.phase.label(t)}" } else { "{fmt_clock(p.remaining(now))}" }
                    }
                }
            }

            // Once a Pomodoro is under way: its phase, the rounds, skip and reset.
            if !p.untouched() || p.done > 0 {
                div { class: "pomo-line {pomo_class}",
                    span { "{p.phase.label(t)}" }
                    span { class: "dots",
                        for i in 0..rounds {
                            span { key: "{i}", class: if i < filled { "dot on" } else { "dot" } }
                        }
                    }
                    button {
                        class: "icon-btn ghost",
                        title: "{t.skip}",
                        onclick: move |_| {
                            sound::button(&store.peek().settings, "click");
                            pomo.write().skip(&store.peek().settings);
                        },
                        Icon { d: SKIP }
                    }
                    button {
                        class: "icon-btn ghost",
                        title: "{t.reset}",
                        onclick: move |_| {
                            sound::button(&store.peek().settings, "stop");
                            pomo.set(Pomo::new(&store.peek().settings));
                        },
                        Icon { d: RESET }
                    }
                }
            }

            // Today: the split as one thin bar, then the three totals.
            div { class: "today",
                span { class: "caption", "{t.period_now[0]}" }
                div { class: "today-bar",
                    for (kind, secs) in totals {
                        if secs > 0 {
                            span { key: "{kind.class()}", class: "{kind.class()}", style: "flex: {secs}" }
                        }
                    }
                }
                div { class: "mini-stats",
                    for (kind, secs) in totals {
                        div { key: "{kind.class()}", class: "mini {kind.class()}",
                            span { class: "mini-num", "{fmt_dur(secs)}" }
                            span { class: "caption", "{kind_label(kind)}" }
                        }
                    }
                }
            }

            // Keyed so each new quote re-mounts and fades in.
            for q in quote_text {
                button {
                    key: "{quote}",
                    class: "quote",
                    title: "{t.next_quote}",
                    onclick: move |_| quote += 1,
                    "{q}"
                }
            }
        }
    }
}
