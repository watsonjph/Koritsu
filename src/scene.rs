//! Hosts the pixel-art canvas from `assets/scene.js` and keeps it in sync with what you're doing.

use crate::NOW;
use crate::i18n::tr;
use crate::pomodoro::{Phase, Pomo};
use crate::store::{Kind, Store};
use dioxus::prelude::*;
use std::sync::atomic::{AtomicU32, Ordering};

static NEXT_ID: AtomicU32 = AtomicU32::new(0);

/// What the character should be doing: the tracker wins, then a running Pomodoro phase.
fn mood(store: &Store, pomo: &Pomo) -> &'static str {
    match &store.running {
        Some(r) => r.kind.class(),
        None if pomo.running() => {
            if pomo.phase == Phase::Focus {
                Kind::Productive.class()
            } else {
                Kind::Break.class()
            }
        }
        None => "idle",
    }
}

/// The scene. `preview` shows that mood instead of what you're doing (the Settings preview), with
/// its own timeline, so it never disturbs the scene on Track.
#[component]
pub fn Scene(preview: ReadSignal<Option<&'static str>>) -> Element {
    let store = use_context::<Signal<Store>>();
    let pomo = use_context::<Signal<Pomo>>();
    let id = use_hook(|| format!("scene-{}", NEXT_ID.fetch_add(1, Ordering::Relaxed)));
    let shown = preview().unwrap_or_else(|| mood(&store.read(), &pomo.read()));
    let secs = store.read().settings.character.bubble_secs;
    // A tracked break that ran past its length: she realises it's time to get up.
    let over = preview().is_none() && shown == "break" && store.read().running.as_ref().is_some_and(|r| r.alerted);

    // Re-runs whenever the store, the Pomodoro or the preview mood changes.
    let canvas = id.clone();
    use_effect(move || {
        let st = store.read();
        let state = serde_json::json!({
            "mood": preview().unwrap_or_else(|| mood(&st, &pomo.read())),
            // where she idles: wherever the last thing you logged happened
            "last": st.entries.iter().max_by_key(|e| e.end).map(|e| e.kind.class()),
            "weather": st.settings.character.weather.key(),
            "sky": st.settings.character.sky.key(),
            "place": st.settings.character.productive_place.key(),
            "commute": st.settings.character.wasted_place.key(),
            // pinned on top it stays in view, so it keeps moving
            "background": st.settings.character.animate_unfocused || st.settings.pinned,
            "character": st.settings.character.to_js(),
        });
        document::eval(&format!("window.koritsuScene?.update({state}, '{canvas}')"));
    });

    rsx! {
        div { class: "scene-wrap",
            // scene.js keeps --hx / --hy on this wrapper at the top of her head
            Thought { key: "{shown}-{over}", mood: shown, over, secs }
            canvas {
                id: "{id}",
                class: "scene",
                onmounted: {
                    let id = id.clone();
                    move |_| {
                        document::eval(&format!("window.koritsuScene?.attach('{id}')"));
                    }
                },
            }
        }
    }
}

/// Her thought, in a bubble over her head: a new one every so often, each up for `secs` seconds.
/// Keyed by mood, so a change of mood starts over with a fresh thought. `over`: her break ran out.
#[component]
fn Thought(mood: &'static str, over: bool, secs: u32) -> Element {
    let start = use_hook(|| *NOW.peek());
    let t = tr();
    let list: &[&str] = match mood {
        _ if over => t.think_break_over,
        "productive" => t.think_productive,
        "wasted" => t.think_wasted,
        "break" => t.think_break,
        _ => t.think_idle,
    };
    // One thought a minute; the first a moment after the mood starts. It floats in, stays `secs`,
    // then gets one more second to float away before it's removed.
    const PERIOD: i64 = 60;
    let secs = i64::from(secs);
    let e = NOW() - start - 2;
    if secs == 0 || list.is_empty() || e < 0 || e % PERIOD > secs {
        return rsx! {};
    }
    let n = e / PERIOD;
    let leaving = e % PERIOD == secs;
    let text = list[(n as usize + start.unsigned_abs() as usize) % list.len()];
    rsx! {
        for n in [n] {
            div { key: "{n}", class: "thought {mood}", class: if leaving { "leaving" },
                if over { Alarm {} } else if mood == "break" { Sheep {} }
                span { "{text}" }
            }
        }
    }
}

/// A little sheep hopping a fence, for sleepy thoughts.
#[component]
fn Sheep() -> Element {
    rsx! {
        svg { class: "sheep", view_box: "0 0 24 12", width: "30", height: "15",
            rect { x: "11", y: "6", width: "1", height: "6", fill: "#8a6a4a" }
            rect { x: "15", y: "6", width: "1", height: "6", fill: "#8a6a4a" }
            rect { x: "10", y: "8", width: "7", height: "1", fill: "#8a6a4a" }
            g { class: "hop",
                rect { x: "2", y: "5", width: "6", height: "4", fill: "#f4f2ec" }
                rect { x: "3", y: "4", width: "4", height: "1", fill: "#f4f2ec" }
                rect { x: "7", y: "4", width: "2", height: "3", fill: "#3a3440" }
                rect { x: "3", y: "9", width: "1", height: "2", fill: "#3a3440" }
                rect { x: "6", y: "9", width: "1", height: "2", fill: "#3a3440" }
            }
        }
    }
}

/// A ringing alarm clock, for when the break is over.
#[component]
fn Alarm() -> Element {
    rsx! {
        svg { class: "alarm", view_box: "0 0 12 12", width: "16", height: "16",
            rect { x: "1", y: "1", width: "3", height: "2", fill: "#e2564a" }
            rect { x: "8", y: "1", width: "3", height: "2", fill: "#e2564a" }
            rect { x: "2", y: "3", width: "8", height: "7", fill: "#e2564a" }
            rect { x: "3", y: "4", width: "6", height: "5", fill: "#fffdf8" }
            rect { x: "5", y: "5", width: "1", height: "2", fill: "#2a2433" }
            rect { x: "5", y: "6", width: "2", height: "1", fill: "#2a2433" }
            rect { x: "2", y: "10", width: "1", height: "1", fill: "#2a2433" }
            rect { x: "9", y: "10", width: "1", height: "1", fill: "#2a2433" }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{Running, Settings};

    #[test]
    fn tracker_beats_pomodoro_for_mood() {
        let s = Settings::default();
        let mut pomo = Pomo::new(&s);
        let mut store = Store::default();
        assert_eq!(mood(&store, &pomo), "idle");
        pomo.start(0);
        assert_eq!(mood(&store, &pomo), "productive"); // focus block
        pomo.skip(&s);
        pomo.start(0);
        assert_eq!(mood(&store, &pomo), "break");
        store.running = Some(Running { kind: Kind::Wasted, start: 0, activity: String::new(), alerted: false });
        assert_eq!(mood(&store, &pomo), "wasted");
    }
}
