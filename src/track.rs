use crate::activity::{self, ASK, Ask};
use crate::i18n::{kind_label, tr};
use crate::icons::{Icon, MOON, PLAY, STOP};
use crate::pomodoro::{Phase, Pomo};
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
    let pomo = use_context::<Signal<Pomo>>();
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
    let active = |k: Kind| running.as_ref().is_some_and(|r| r.kind == k);
    let (status, clock) = match &running {
        Some(r) if r.activity.is_empty() => (kind_label(r.kind).to_string(), fmt_clock(now - r.start)),
        Some(r) => (format!("{} · {}", kind_label(r.kind), r.activity), fmt_clock(now - r.start)),
        None => (t.idle.to_string(), "00:00".to_string()),
    };
    let kind_class = running.as_ref().map_or("idle", |r| r.kind.class());
    // Productive and wasted time have named activities to switch between; breaks don't.
    let switchable = running.as_ref().map(|r| r.kind).filter(|k| *k != Kind::Break);

    rsx! {
        div { class: "tab track-tab",
            // With the character shown, the timer sits on the scene like a game HUD.
            if show_scene {
                div { class: "scene-card",
                    crate::scene::Scene {}
                    div { class: "hud",
                        // While tracking, the label switches activity without stopping.
                        if let Some(kind) = switchable {
                            button {
                                class: "hud-pill switch {kind_class}",
                                title: "{t.switch_activity}",
                                onclick: move |_| *ASK.write() = Some(Ask::Switch(kind)),
                                span { class: "live-dot {kind_class}" }
                                span { class: "pill-text", "{status}" }
                                span { class: "switch-icon", "⇄" }
                            }
                        } else {
                            span { class: "hud-pill {kind_class}",
                                if running.is_some() { span { class: "live-dot {kind_class}" } }
                                "{status}"
                            }
                        }
                        span { class: "hud-pill hud-clock", "{clock}" }
                    }
                }
            } else {
                div { class: "timer-face",
                    div { class: "caption {kind_class}",
                        if running.is_some() { span { class: "live-dot {kind_class}" } }
                        "{status}"
                        if let Some(kind) = switchable {
                            button {
                                class: "switch-btn",
                                title: "{t.switch_activity}",
                                onclick: move |_| *ASK.write() = Some(Ask::Switch(kind)),
                                "⇄"
                            }
                        }
                    }
                    div { class: if running.is_some() { "big-clock" } else { "big-clock dim" }, "{clock}" }
                }
            }
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
                        if active(kind) {
                            Icon { d: STOP }
                            "{t.stop}"
                        } else {
                            Icon { d: if kind == Kind::Break { MOON } else { PLAY } }
                            "{kind_label(kind)}"
                        }
                    }
                }
            }
            div { class: "today",
                span { class: "caption", "{t.period_now[0]}" }
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
