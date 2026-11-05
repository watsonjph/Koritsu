//! Stroke icons as SVG path data (24×24 grid), in place of an icon font.
use dioxus::prelude::*;

pub const PLAY: &str = "M7 4v16l13-8z";
pub const PAUSE: &str = "M7 4h3v16H7zM14 4h3v16h-3z";
pub const STOP: &str = "M6 6h12v12H6z";
pub const MOON: &str = "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z";
/// A stopwatch: the Pomodoro.
pub const TIMER: &str = "M12 9v4l2.5 2M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM10 2h4";
pub const X: &str = "M6 6l12 12M18 6L6 18";
pub const MINUS: &str = "M5 12h14";
pub const PLUS: &str = "M12 5v14M5 12h14";
pub const PIN: &str = "M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z";
pub const TRASH: &str = "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6";
pub const PENCIL: &str = "M17 3l4 4L7 21H3v-4z";
pub const SKIP: &str = "M5 4l10 8-10 8zM19 5v14";
pub const RESET: &str = "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5";

#[component]
pub fn Icon(d: &'static str) -> Element {
    rsx! {
        svg { class: "ico", view_box: "0 0 24 24", path { d } }
    }
}
