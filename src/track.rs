use crate::icons::{Icon, PLAY, STOP};
use crate::pomodoro::{Phase, Pomo};
use crate::store::{Kind, Period, Store, fmt_clock, fmt_dur, today};
use crate::{NOW, commit};
use dioxus::prelude::*;

#[component]
pub fn TrackTab() -> Element {
    let store = use_context::<Signal<Store>>();
    let mut pomo = use_context::<Signal<Pomo>>();
    let mut quote = use_signal(|| crate::store::now() as usize);
    let now = NOW();
    let st = store.read();
    let running = st.running;
    let day = Period::Day.range(today());
    let wasted = st.total(Kind::Wasted, day, now);
    let productive = st.total(Kind::Productive, day, now);
    let quotes = &st.settings.quotes;
    let quote_text = (!quotes.is_empty()).then(|| quotes[quote() % quotes.len()].clone());

    let mut toggle = move |kind: Kind| {
        let now = crate::store::now();
        if store.peek().running.is_some_and(|r| r.kind == kind) {
            commit(store, |s| s.stop(now));
        } else {
            // A running focus block would count the same minutes twice.
            if pomo.peek().running() && pomo.peek().phase == Phase::Focus {
                pomo.write().pause(now);
            }
            commit(store, |s| s.start(kind, now));
        }
    };

    rsx! {
        div { class: "tab track-tab",
            div { class: "timer-face",
                match running {
                    Some(r) => rsx! {
                        div { class: "caption {r.kind.class()}", "{r.kind.label()} · running" }
                        div { class: "big-clock", "{fmt_clock(now - r.start)}" }
                    },
                    None => rsx! {
                        div { class: "caption", "idle" }
                        div { class: "big-clock dim", "00:00" }
                    },
                }
            }
            div { class: "row gap",
                for kind in [Kind::Productive, Kind::Wasted] {
                    button {
                        key: "{kind.class()}",
                        class: "track-btn {kind.class()}",
                        class: if running.is_some_and(|r| r.kind == kind) { "active" },
                        onclick: move |_| toggle(kind),
                        if running.is_some_and(|r| r.kind == kind) {
                            Icon { d: STOP }
                            "Stop"
                        } else {
                            Icon { d: PLAY }
                            "{kind.label()}"
                        }
                    }
                }
            }
            div { class: "glass-bg",
                div { class: "grid2",
                    div { class: "stat productive",
                        div { class: "stat-num", "{fmt_dur(productive)}" }
                        div { class: "caption", "productive · today" }
                    }
                    div { class: "stat wasted",
                        div { class: "stat-num", "{fmt_dur(wasted)}" }
                        div { class: "caption", "wasted · today" }
                    }
                }
            }
            if let Some(q) = quote_text {
                button {
                    class: "quote",
                    title: "Next quote",
                    onclick: move |_| quote += 1,
                    "{q}"
                }
            }
        }
    }
}
