use crate::i18n::tr;
use crate::icons::{Icon, PLAY, STOP};
use crate::pomodoro::{Phase, Pomo};
use crate::store::{Kind, Period, Store, fmt_clock, fmt_dur, now, today};
use crate::{NOW, commit, sound};
use dioxus::prelude::*;

/// Start `kind`, or stop it if it's already running. Shared by the buttons and global shortcuts.
pub fn toggle(store: Signal<Store>, mut pomo: Signal<Pomo>, kind: Kind) {
    if store.peek().running.is_some_and(|r| r.kind == kind) {
        return stop(store);
    }
    let now = now();
    // A running focus block would count the same minutes twice.
    if pomo.peek().running() && pomo.peek().phase == Phase::Focus {
        pomo.write().pause(now);
    }
    sound::button(&store.peek().settings, kind.class());
    commit(store, |s| s.start(kind, now));
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
    let running = st.running;
    let day = Period::Day.range(today());
    let wasted = st.total(Kind::Wasted, day, now);
    let productive = st.total(Kind::Productive, day, now);
    let quotes = &st.settings.quotes;
    let quote_text = (!quotes.is_empty()).then(|| quotes[quote() % quotes.len()].clone());
    let label = |k: Kind| if k == Kind::Productive { t.productive } else { t.wasted };

    rsx! {
        div { class: "tab track-tab",
            div { class: "timer-face",
                match running {
                    Some(r) => rsx! {
                        div { class: "caption {r.kind.class()}", span { class: "live-dot {r.kind.class()}" } "{label(r.kind)} · {t.running}" }
                        div { class: "big-clock", "{fmt_clock(now - r.start)}" }
                    },
                    None => rsx! {
                        div { class: "caption", "{t.idle}" }
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
                        onclick: move |_| toggle(store, pomo, kind),
                        if running.is_some_and(|r| r.kind == kind) {
                            Icon { d: STOP }
                            "{t.stop}"
                        } else {
                            Icon { d: PLAY }
                            "{label(kind)}"
                        }
                    }
                }
            }
            div { class: "glass-bg",
                div { class: "grid2",
                    div { class: "stat productive",
                        div { class: "stat-num", "{fmt_dur(productive)}" }
                        div { class: "caption", "{t.productive} · {t.this[0]}" }
                    }
                    div { class: "stat wasted",
                        div { class: "stat-num", "{fmt_dur(wasted)}" }
                        div { class: "caption", "{t.wasted} · {t.this[0]}" }
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
