//! Everything Koritsu persists, plus the period maths for stats.
// ponytail: whole-file JSON rewritten on every change; move to SQLite if the file passes a few MB (decades of entries).

use chrono::{Datelike, Days, Local, NaiveDate, NaiveTime, TimeZone};
use serde::{Deserialize, Serialize};
use std::{fs, io, path::PathBuf};

#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub enum Kind {
    Productive,
    Wasted,
}

impl Kind {
    pub fn class(self) -> &'static str {
        match self {
            Kind::Productive => "productive",
            Kind::Wasted => "wasted",
        }
    }
}

/// A finished block of time, in unix seconds.
#[derive(Clone, PartialEq, Debug, Serialize, Deserialize)]
pub struct Entry {
    pub id: u64,
    pub kind: Kind,
    pub start: i64,
    pub end: i64,
    #[serde(default)]
    pub note: String,
}

/// The start/stop tracker. Persisted so a crash or restart keeps counting.
#[derive(Clone, Copy, PartialEq, Debug, Serialize, Deserialize)]
pub struct Running {
    pub kind: Kind,
    pub start: i64,
}

#[derive(Clone, PartialEq, Debug, Serialize, Deserialize)]
pub struct Todo {
    pub id: u64,
    pub text: String,
    pub date: NaiveDate,
    pub time: Option<NaiveTime>,
    pub done: bool,
    pub notified: bool,
}

impl Todo {
    pub fn due(&self) -> Option<i64> {
        self.time.map(|t| local_ts(self.date, t))
    }
}

#[derive(Clone, PartialEq, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub focus_min: u32,
    pub short_min: u32,
    pub long_min: u32,
    pub rounds: u32,
    pub pinned: bool,
    pub quotes: Vec<String>,
    pub auto_work: bool,
    pub auto_break: bool,
    pub tick_work: bool,
    pub tick_break: bool,
    pub notifications: bool,
    pub sounds: bool,
    /// 0–100.
    pub volume: u32,
    pub snap: bool,
    pub theme: Theme,
    pub lang: Lang,
    /// Last window position and inner size, in physical pixels.
    pub window: Option<Geom>,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default, Serialize, Deserialize)]
pub enum Theme {
    #[default]
    Copper,
    Gruvbox,
    Dracula,
    Nord,
    Catppuccin,
    RosePine,
}

impl Theme {
    pub const ALL: [Theme; 6] = [Theme::Copper, Theme::Gruvbox, Theme::Dracula, Theme::Nord, Theme::Catppuccin, Theme::RosePine];

    pub fn name(self) -> &'static str {
        match self {
            Theme::Copper => "Copper",
            Theme::Gruvbox => "Gruvbox",
            Theme::Dracula => "Dracula",
            Theme::Nord => "Nord",
            Theme::Catppuccin => "Catppuccin",
            Theme::RosePine => "Rosé Pine",
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default, Serialize, Deserialize)]
pub enum Lang {
    #[default]
    En,
    Ja,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub struct Geom {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

pub const POMO_DEFAULTS: (u32, u32, u32, u32) = (25, 5, 15, 4);

impl Default for Settings {
    fn default() -> Self {
        let (focus_min, short_min, long_min, rounds) = POMO_DEFAULTS;
        Self {
            focus_min,
            short_min,
            long_min,
            rounds,
            pinned: false,
            quotes: [
                "It is not that we have a short time to live, but that we waste a lot of it. — Seneca",
                "While we are postponing, life speeds by. — Seneca",
                "You could leave life right now. Let that determine what you do and say and think. — Marcus Aurelius",
                "Waste no more time arguing what a good man should be. Be one. — Marcus Aurelius",
                "Lost time is never found again. — Benjamin Franklin",
            ]
            .map(String::from)
            .to_vec(),
            auto_work: false,
            auto_break: false,
            tick_work: false,
            tick_break: false,
            notifications: true,
            sounds: true,
            volume: 60,
            snap: true,
            theme: Theme::Copper,
            lang: Lang::En,
            window: None,
        }
    }
}

#[derive(Clone, PartialEq, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Store {
    pub entries: Vec<Entry>,
    pub running: Option<Running>,
    pub todos: Vec<Todo>,
    pub settings: Settings,
    pub next_id: u64,
}

impl Store {
    pub fn next_id(&mut self) -> u64 {
        self.next_id += 1;
        self.next_id
    }

    pub fn add_entry(&mut self, kind: Kind, start: i64, end: i64, note: String) {
        let id = self.next_id();
        self.entries.push(Entry { id, kind, start, end, note });
    }

    /// Stops the tracker, logging what it counted (zero-length runs are dropped).
    pub fn stop(&mut self, now: i64) {
        if let Some(r) = self.running.take()
            && now > r.start
        {
            self.add_entry(r.kind, r.start, now, String::new());
        }
    }

    /// Starts tracking `kind`, logging whatever was running before.
    pub fn start(&mut self, kind: Kind, now: i64) {
        self.stop(now);
        self.running = Some(Running { kind, start: now });
    }

    /// Seconds of `kind` inside `[a, b)`, including the live tracker.
    pub fn total(&self, kind: Kind, (a, b): (i64, i64), now: i64) -> i64 {
        let logged: i64 = self
            .entries
            .iter()
            .filter(|e| e.kind == kind)
            .map(|e| overlap(e.start, e.end, a, b))
            .sum();
        let live = self
            .running
            .filter(|r| r.kind == kind)
            .map_or(0, |r| overlap(r.start, now, a, b));
        logged + live
    }
}

/// Length of `[s, e) ∩ [a, b)`. Splits entries across midnight/week edges for free.
pub fn overlap(s: i64, e: i64, a: i64, b: i64) -> i64 {
    (e.min(b) - s.max(a)).max(0)
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Period {
    Day,
    Week,
    Month,
    Year,
}

impl Period {
    pub const ALL: [Period; 4] = [Period::Day, Period::Week, Period::Month, Period::Year];

    /// `[first day, first day of the next period)`; weeks start Monday.
    pub fn bounds(self, today: NaiveDate) -> (NaiveDate, NaiveDate) {
        let ymd = |y, m| NaiveDate::from_ymd_opt(y, m, 1).expect("valid date");
        match self {
            Period::Day => (today, today + Days::new(1)),
            Period::Week => {
                let mon = today - Days::new(today.weekday().num_days_from_monday().into());
                (mon, mon + Days::new(7))
            }
            Period::Month => {
                let next = if today.month() == 12 {
                    ymd(today.year() + 1, 1)
                } else {
                    ymd(today.year(), today.month() + 1)
                };
                (ymd(today.year(), today.month()), next)
            }
            Period::Year => (ymd(today.year(), 1), ymd(today.year() + 1, 1)),
        }
    }

    /// Unix-second range of the period containing `today`, in local time.
    pub fn range(self, today: NaiveDate) -> (i64, i64) {
        let (a, b) = self.bounds(today);
        (local_ts(a, NaiveTime::MIN), local_ts(b, NaiveTime::MIN))
    }
}

/// Local wall-clock time to unix seconds. `earliest()` picks a side of a DST gap instead of panicking.
pub fn local_ts(date: NaiveDate, time: NaiveTime) -> i64 {
    let naive = date.and_time(time);
    Local
        .from_local_datetime(&naive)
        .earliest()
        .map_or_else(|| naive.and_utc().timestamp(), |t| t.timestamp())
}

pub fn now() -> i64 {
    Local::now().timestamp()
}

pub fn today() -> NaiveDate {
    Local::now().date_naive()
}

/// `12h 40m`, `45m`, `0m`.
pub fn fmt_dur(secs: i64) -> String {
    let m = secs.max(0) / 60;
    match (m / 60, m % 60) {
        (0, m) => format!("{m}m"),
        (h, m) => format!("{h}h {m}m"),
    }
}

/// `1:02:03` or `02:03`.
pub fn fmt_clock(secs: i64) -> String {
    let s = secs.max(0);
    let (h, m, s) = (s / 3600, s / 60 % 60, s % 60);
    if h > 0 { format!("{h}:{m:02}:{s:02}") } else { format!("{m:02}:{s:02}") }
}

/// Entries as CSV (local times), oldest first.
pub fn to_csv(entries: &[Entry]) -> String {
    fn field(s: &str) -> String {
        if s.contains([',', '"', '\n', '\r']) { format!("\"{}\"", s.replace('"', "\"\"")) } else { s.to_string() }
    }
    let local = |ts: i64| {
        chrono::DateTime::from_timestamp(ts, 0)
            .unwrap_or_default()
            .with_timezone(&Local)
            .format("%Y-%m-%d %H:%M:%S")
            .to_string()
    };
    let mut rows: Vec<&Entry> = entries.iter().collect();
    rows.sort_by_key(|e| e.start);
    let mut out = String::from("kind,start,end,minutes,note\n");
    for e in rows {
        let kind = match e.kind {
            Kind::Productive => "productive",
            Kind::Wasted => "wasted",
        };
        out += &format!("{kind},{},{},{},{}\n", local(e.start), local(e.end), (e.end - e.start) / 60, field(&e.note));
    }
    out
}

/// Writes the CSV to Downloads (or the data dir) and returns its path.
pub fn export_csv(store: &Store) -> io::Result<PathBuf> {
    let dir = directories::UserDirs::new()
        .and_then(|u| u.download_dir().map(PathBuf::from))
        .unwrap_or_else(data_dir);
    let p = dir.join(format!("koritsu-{}.csv", Local::now().format("%Y-%m-%d-%H%M")));
    fs::write(&p, to_csv(&store.entries))?;
    Ok(p)
}

pub fn data_dir() -> PathBuf {
    directories::ProjectDirs::from("dev", "koritsu", "Koritsu")
        .map_or_else(|| PathBuf::from("."), |d| d.data_dir().to_path_buf())
}

pub fn path() -> PathBuf {
    data_dir().join("koritsu.json")
}

/// Missing file → fresh store. Unreadable file → moved aside (never overwritten) and a fresh store.
pub fn load() -> Store {
    let p = path();
    match fs::read_to_string(&p) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_else(|e| {
            let aside = p.with_file_name(format!("koritsu.corrupt-{}.json", now()));
            eprintln!("koritsu: {} is unreadable ({e}); moved to {}", p.display(), aside.display());
            let _ = fs::rename(&p, aside);
            Store::default()
        }),
        Err(_) => Store::default(),
    }
}

/// Write to a temp file then rename over the real one, so a crash mid-write can't truncate it.
pub fn save(store: &Store) -> io::Result<()> {
    let p = path();
    fs::create_dir_all(data_dir())?;
    let tmp = p.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(store)?)?;
    fs::rename(tmp, p)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    #[test]
    fn overlap_clips_to_range() {
        assert_eq!(overlap(0, 100, 50, 200), 50); // starts before range
        assert_eq!(overlap(150, 300, 50, 200), 50); // ends after range
        assert_eq!(overlap(0, 10, 50, 200), 0); // disjoint
        assert_eq!(overlap(60, 70, 50, 200), 10); // inside
    }

    #[test]
    fn entry_across_midnight_splits_between_days() {
        let mut s = Store::default();
        let start = local_ts(d(2026, 11, 1), NaiveTime::from_hms_opt(23, 0, 0).unwrap());
        s.add_entry(Kind::Wasted, start, start + 2 * 3600, String::new());
        let now = start + 10 * 3600;
        assert_eq!(s.total(Kind::Wasted, Period::Day.range(d(2026, 11, 1)), now), 3600);
        assert_eq!(s.total(Kind::Wasted, Period::Day.range(d(2026, 11, 2)), now), 3600);
        assert_eq!(s.total(Kind::Productive, Period::Day.range(d(2026, 11, 2)), now), 0);
        // Sun 1 Nov → Mon 2 Nov crosses a week edge too.
        assert_eq!(s.total(Kind::Wasted, Period::Week.range(d(2026, 11, 2)), now), 3600);
    }

    #[test]
    fn running_tracker_counts_live_and_stop_logs_it() {
        let mut s = Store::default();
        s.start(Kind::Productive, 1000);
        assert_eq!(s.total(Kind::Productive, (0, i64::MAX), 1600), 600);
        s.start(Kind::Wasted, 1600); // switching logs the productive run
        assert_eq!(s.entries.len(), 1);
        s.stop(1600); // zero-length run is dropped
        assert_eq!(s.entries.len(), 1);
        assert!(s.running.is_none());
    }

    #[test]
    fn period_bounds() {
        let sun = d(2026, 11, 8);
        assert_eq!(Period::Week.bounds(sun), (d(2026, 11, 2), d(2026, 11, 9)));
        assert_eq!(Period::Week.bounds(d(2026, 11, 9)).0, d(2026, 11, 9));
        assert_eq!(Period::Month.bounds(d(2026, 12, 31)), (d(2026, 12, 1), d(2027, 1, 1)));
        assert_eq!(Period::Year.bounds(sun), (d(2026, 1, 1), d(2027, 1, 1)));
        assert_eq!(Period::Day.bounds(sun), (sun, d(2026, 11, 9)));
    }

    #[test]
    fn formatting() {
        assert_eq!(fmt_dur(12 * 3600 + 40 * 60 + 59), "12h 40m");
        assert_eq!(fmt_dur(45 * 60), "45m");
        assert_eq!(fmt_dur(0), "0m");
        assert_eq!(fmt_clock(3723), "1:02:03");
        assert_eq!(fmt_clock(65), "01:05");
    }

    #[test]
    fn csv_quotes_awkward_notes() {
        let mut s = Store::default();
        s.add_entry(Kind::Wasted, 0, 600, "reels, \"just one\"".into());
        s.add_entry(Kind::Productive, -600, 0, "plain".into());
        let csv = to_csv(&s.entries);
        let lines: Vec<&str> = csv.lines().collect();
        assert_eq!(lines[0], "kind,start,end,minutes,note");
        assert!(lines[1].starts_with("productive,") && lines[1].ends_with(",10,plain"));
        assert!(lines[2].ends_with(",10,\"reels, \"\"just one\"\"\""));
    }

    #[test]
    fn old_files_missing_fields_still_load() {
        let s: Store = serde_json::from_str(r#"{"entries":[]}"#).unwrap();
        assert_eq!(s.settings.rounds, 4);
    }
}
