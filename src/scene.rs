//! Hosts the pixel-art canvas from `assets/scene.js` and keeps it in sync with what you're doing.

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

#[component]
pub fn Scene() -> Element {
    let store = use_context::<Signal<Store>>();
    let pomo = use_context::<Signal<Pomo>>();
    let id = use_hook(|| format!("scene-{}", NEXT_ID.fetch_add(1, Ordering::Relaxed)));

    // Re-runs whenever the store or the Pomodoro changes.
    use_effect(move || {
        let st = store.read();
        let state = serde_json::json!({
            "mood": mood(&st, &pomo.read()),
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
        document::eval(&format!("window.koritsuScene?.update({state})"));
    });

    rsx! {
        div { class: "scene-wrap",
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
        store.running = Some(Running { kind: Kind::Wasted, start: 0, activity: String::new() });
        assert_eq!(mood(&store, &pomo), "wasted");
    }
}
