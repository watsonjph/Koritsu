//! Window placement: remember where it was, snap to screen edges, jump to corners.
//! All maths is on the *visible* (inner) rect in physical pixels; the outer rect on
//! Windows includes invisible resize borders, so moves are corrected by that offset.

use crate::store::Geom;
use dioxus::desktop::DesktopContext;
use dioxus::desktop::tao::dpi::{PhysicalPosition, PhysicalSize};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Corner {
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

impl Corner {
    pub const ALL: [Corner; 4] = [Corner::TopLeft, Corner::TopRight, Corner::BottomLeft, Corner::BottomRight];

    pub fn arrow(self) -> &'static str {
        match self {
            Corner::TopLeft => "↖",
            Corner::TopRight => "↗",
            Corner::BottomLeft => "↙",
            Corner::BottomRight => "↘",
        }
    }
}

/// Gap kept between a snapped window and the screen edge, in logical px.
const GAP: f64 = 10.0;
/// How close to an edge counts as "dropped on it", in logical px.
const PULL: f64 = 28.0;

/// Top-left that pulls `win` flush (minus `gap`) to any edge of `area` it is within `pull` of.
pub fn snap(win: Rect, area: Rect, gap: i32, pull: i32) -> (i32, i32) {
    let axis = |pos: i32, len: i32, start: i32, span: i32| {
        let (lo, hi) = (start + gap, start + span - gap - len);
        if (pos - lo).abs() <= pull {
            lo
        } else if (pos - hi).abs() <= pull {
            hi
        } else {
            pos
        }
    };
    (axis(win.x, win.w, area.x, area.w), axis(win.y, win.h, area.y, area.h))
}

pub fn corner(win: Rect, area: Rect, gap: i32, c: Corner) -> (i32, i32) {
    let left = area.x + gap;
    let right = area.x + area.w - gap - win.w;
    let top = area.y + gap;
    let bottom = area.y + area.h - gap - win.h;
    match c {
        Corner::TopLeft => (left, top),
        Corner::TopRight => (right, top),
        Corner::BottomLeft => (left, bottom),
        Corner::BottomRight => (right, bottom),
    }
}

fn overlaps(a: Rect, b: Rect) -> bool {
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/// Visible rect plus the (inner − outer) offset.
fn visible(w: &DesktopContext) -> Option<(Rect, (i32, i32))> {
    let inner = w.inner_position().ok()?;
    let outer = w.outer_position().ok()?;
    let size = w.inner_size();
    let rect = Rect { x: inner.x, y: inner.y, w: size.width as i32, h: size.height as i32 };
    Some((rect, (inner.x - outer.x, inner.y - outer.y)))
}

/// The monitor's usable area (minus the taskbar) under the window.
#[cfg(windows)]
fn work_area(w: &DesktopContext) -> Option<Rect> {
    use dioxus::desktop::tao::platform::windows::WindowExtWindows;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromWindow};

    let mut info = MONITORINFO { cbSize: size_of::<MONITORINFO>() as u32, ..Default::default() };
    // SAFETY: the hwnd is our live window and `info` is a correctly sized MONITORINFO.
    let ok = unsafe {
        let mon = MonitorFromWindow(HWND(w.window.hwnd() as _), MONITOR_DEFAULTTONEAREST);
        GetMonitorInfoW(mon, &mut info).as_bool()
    };
    let r = info.rcWork;
    ok.then(|| Rect { x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top })
}

#[cfg(not(windows))]
fn work_area(w: &DesktopContext) -> Option<Rect> {
    let m = w.current_monitor()?;
    let (p, s) = (m.position(), m.size());
    Some(Rect { x: p.x, y: p.y, w: s.width as i32, h: s.height as i32 })
}

fn px(w: &DesktopContext, logical: f64) -> i32 {
    (logical * w.scale_factor()).round() as i32
}

fn move_visible_to(w: &DesktopContext, (x, y): (i32, i32), offset: (i32, i32)) {
    w.set_outer_position(PhysicalPosition::new(x - offset.0, y - offset.1));
}

/// After a drag settles: pull to nearby edges. Returns true if it moved.
pub fn snap_now(w: &DesktopContext) -> bool {
    let (Some((win, off)), Some(area)) = (visible(w), work_area(w)) else { return false };
    let to = snap(win, area, px(w, GAP), px(w, PULL));
    let moved = to != (win.x, win.y);
    if moved {
        move_visible_to(w, to, off);
    }
    moved
}

pub fn to_corner(w: &DesktopContext, c: Corner) {
    if let (Some((win, off)), Some(area)) = (visible(w), work_area(w)) {
        move_visible_to(w, corner(win, area, px(w, GAP), c), off);
    }
}

pub fn geom(w: &DesktopContext) -> Option<Geom> {
    let (r, _) = visible(w)?;
    Some(Geom { x: r.x, y: r.y, w: r.w as u32, h: r.h as u32 })
}

/// Puts the window back where it was, or bottom-right on first run / if that monitor is gone.
pub fn restore(w: &DesktopContext, saved: Option<Geom>) {
    let on_screen = saved.filter(|g| {
        let r = Rect { x: g.x, y: g.y, w: g.w as i32, h: g.h as i32 };
        w.available_monitors().any(|m| {
            let (p, s) = (m.position(), m.size());
            overlaps(r, Rect { x: p.x, y: p.y, w: s.width as i32, h: s.height as i32 })
        })
    });
    match on_screen {
        Some(g) => {
            w.set_inner_size(PhysicalSize::new(g.w, g.h));
            if let Some((_, off)) = visible(w) {
                move_visible_to(w, (g.x, g.y), off);
            }
        }
        None => to_corner(w, Corner::BottomRight),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const AREA: Rect = Rect { x: 0, y: 0, w: 1920, h: 1040 };

    #[test]
    fn snaps_only_near_edges() {
        let win = |x, y| Rect { x, y, w: 360, h: 560 };
        assert_eq!(snap(win(25, 490), AREA, 10, 28), (10, 470)); // left edge; bottom edge 1040-10-560
        assert_eq!(snap(win(25, 500), AREA, 10, 28), (10, 500)); // 30px from the bottom: outside the pull
        assert_eq!(snap(win(1540, 30), AREA, 10, 28), (1550, 10)); // right + top
        assert_eq!(snap(win(700, 200), AREA, 10, 28), (700, 200)); // middle: untouched
    }

    #[test]
    fn corners_respect_gap_and_offset_monitor() {
        let win = Rect { x: 0, y: 0, w: 360, h: 560 };
        let second = Rect { x: 1920, y: 0, w: 1280, h: 984 };
        assert_eq!(corner(win, second, 10, Corner::BottomRight), (1920 + 1280 - 370, 984 - 570));
        assert_eq!(corner(win, AREA, 10, Corner::TopLeft), (10, 10));
    }
}
