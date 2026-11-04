use crate::store::Settings;

/// Plays a synthesized sound from `assets/sound.js`, ignoring the button-sounds toggle.
pub fn play_raw(name: &str, volume: u32) {
    let vol = f64::from(volume.min(100)) / 100.0;
    dioxus::document::eval(&format!("window.koritsu?.play('{name}', {vol})"));
}

/// Button feedback ("thock"), if button sounds are on.
pub fn button(s: &Settings, name: &str) {
    if s.sounds {
        play_raw(name, s.volume);
    }
}
