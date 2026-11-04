//! Everything Koritsu persists, plus the period maths for stats.
// ponytail: whole-file JSON rewritten on every change; move to SQLite if the file passes a few MB (decades of entries).

use chrono::{Datelike, Days, Local, NaiveDate, NaiveTime, TimeZone};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::{fs, io, path::PathBuf};

#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub enum Kind {
    Productive,
    Wasted,
    /// Rest: logged automatically by finished Pomodoro breaks, or added by hand.
    Break,
}

impl Kind {
    pub const ALL: [Kind; 3] = [Kind::Productive, Kind::Wasted, Kind::Break];

    pub fn class(self) -> &'static str {
        match self {
            Kind::Productive => "productive",
            Kind::Wasted => "wasted",
            Kind::Break => "break",
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
    /// What the time went on ("Doomscrolling", "Coding"); empty if unnamed.
    #[serde(default)]
    pub activity: String,
    #[serde(default)]
    pub note: String,
}

/// The start/stop tracker. Persisted so a crash or restart keeps counting.
#[derive(Clone, PartialEq, Debug, Serialize, Deserialize)]
pub struct Running {
    pub kind: Kind,
    pub start: i64,
    #[serde(default)]
    pub activity: String,
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
    pub sound_profile: SoundProfile,
    /// Per-theme colour overrides (`#rrggbb`); anything missing follows the theme.
    pub custom: BTreeMap<Theme, BTreeMap<Token, String>>,
    /// Pre-0.3 global overrides; moved into `custom` on load.
    #[serde(skip_serializing)]
    pub positive: Option<String>,
    #[serde(skip_serializing)]
    pub negative: Option<String>,
}

/// A themeable colour.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug, Serialize, Deserialize)]
pub enum Token {
    Accent,
    Bg,
    Text,
    Positive,
    Negative,
    Break,
}

impl Token {
    pub const ALL: [Token; 6] = [Token::Accent, Token::Bg, Token::Text, Token::Positive, Token::Negative, Token::Break];

    /// The CSS variable it drives.
    pub fn var(self) -> &'static str {
        match self {
            Token::Accent => "--accent",
            Token::Bg => "--bg",
            Token::Text => "--text",
            Token::Positive => "--productive",
            Token::Negative => "--wasted",
            Token::Break => "--break",
        }
    }
}

impl Settings {
    /// The colour in effect for `token` in the current theme.
    pub fn color(&self, token: Token) -> &str {
        self.color_for(self.theme, token)
    }

    /// `theme`'s override for `token` if valid, else that theme's default.
    pub fn color_for(&self, theme: Theme, token: Token) -> &str {
        self.custom
            .get(&theme)
            .and_then(|m| m.get(&token))
            .map(String::as_str)
            // Validated because the value is pasted into inline CSS.
            .filter(|c| is_hex_color(c))
            .unwrap_or(theme.color(token))
    }

    pub fn is_custom(&self, token: Token) -> bool {
        self.custom.get(&self.theme).is_some_and(|m| m.contains_key(&token))
    }

    /// Sets (or with `None`, clears) an override for the current theme.
    pub fn set_color(&mut self, token: Token, value: Option<String>) {
        let map = self.custom.entry(self.theme).or_default();
        match value.and_then(|c| parse_hex(&c)) {
            Some(c) => map.insert(token, c),
            None => map.remove(&token),
        };
        if map.is_empty() {
            self.custom.remove(&self.theme);
        }
    }

    /// Inline CSS custom properties for every themeable colour.
    pub fn css_vars(&self) -> String {
        Token::ALL.iter().map(|t| format!("{}: {};", t.var(), self.color(*t))).collect()
    }

    fn migrate(&mut self) {
        if let Some(c) = self.positive.take() {
            self.set_color(Token::Positive, Some(c));
        }
        if let Some(c) = self.negative.take() {
            self.set_color(Token::Negative, Some(c));
        }
    }
}

/// `#abc`, `abc`, `#aabbcc` or `aabbcc` → `#aabbcc`.
pub fn parse_hex(input: &str) -> Option<String> {
    let h = input.trim().trim_start_matches('#');
    let full: String = match h.len() {
        3 => h.chars().flat_map(|c| [c, c]).collect(),
        6 => h.to_string(),
        _ => return None,
    };
    let c = format!("#{}", full.to_ascii_lowercase());
    is_hex_color(&c).then_some(c)
}

pub fn is_hex_color(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s[1..].chars().all(|c| c.is_ascii_hexdigit())
}

/// Button-sound character, synthesized in `assets/sound.js`.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default, Serialize, Deserialize)]
pub enum SoundProfile {
    #[default]
    Creamy,
    Buttery,
    Thocky,
    Marble,
    Asmr,
    Crisp,
    Clacky,
    Topre,
    Pop,
}

impl SoundProfile {
    pub const ALL: [SoundProfile; 9] = [
        SoundProfile::Creamy,
        SoundProfile::Buttery,
        SoundProfile::Thocky,
        SoundProfile::Marble,
        SoundProfile::Asmr,
        SoundProfile::Crisp,
        SoundProfile::Clacky,
        SoundProfile::Topre,
        SoundProfile::Pop,
    ];

    pub fn name(self) -> &'static str {
        match self {
            SoundProfile::Creamy => "Creamy",
            SoundProfile::Buttery => "Buttery",
            SoundProfile::Thocky => "Thocky",
            SoundProfile::Marble => "Marble",
            SoundProfile::Asmr => "ASMR",
            SoundProfile::Crisp => "Crisp",
            SoundProfile::Clacky => "Clacky",
            SoundProfile::Topre => "Topre",
            SoundProfile::Pop => "Pop",
        }
    }

    /// Key in `sound.js`'s profile table.
    pub fn key(self) -> &'static str {
        match self {
            SoundProfile::Creamy => "creamy",
            SoundProfile::Buttery => "buttery",
            SoundProfile::Thocky => "thocky",
            SoundProfile::Marble => "marble",
            SoundProfile::Asmr => "asmr",
            SoundProfile::Crisp => "crisp",
            SoundProfile::Clacky => "clacky",
            SoundProfile::Topre => "topre",
            SoundProfile::Pop => "pop",
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug, Default, Serialize, Deserialize)]
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

    /// Theme defaults. Accent/bg/text from kopuz's themes; productive/wasted/break ink from
    /// each theme's own palette, every trio checked for colour-blind separation.
    pub fn color(self, token: Token) -> &'static str {
        let [accent, bg, text, positive, negative, rest] = match self {
            Theme::Copper => ["#d9842f", "#000000", "#ffffff", "#2dd4bf", "#f87171", "#a78bfa"],
            Theme::Gruvbox => ["#458588", "#282828", "#ebdbb2", "#8ec07c", "#fb4934", "#fabd2f"],
            Theme::Dracula => ["#bd93f9", "#282a36", "#f8f8f2", "#50fa7b", "#ff79c6", "#8be9fd"],
            Theme::Nord => ["#88c0d0", "#2e3440", "#d8dee9", "#88c0d0", "#bf616a", "#ebcb8b"],
            Theme::Catppuccin => ["#89b4fa", "#1e1e2e", "#cdd6f4", "#94e2d5", "#f38ba8", "#89b4fa"],
            Theme::RosePine => ["#c4a7e7", "#191724", "#e0def4", "#9ccfd8", "#eb6f92", "#f6c177"],
        };
        match token {
            Token::Accent => accent,
            Token::Bg => bg,
            Token::Text => text,
            Token::Positive => positive,
            Token::Negative => negative,
            Token::Break => rest,
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
            sound_profile: SoundProfile::Creamy,
            custom: BTreeMap::new(),
            positive: None,
            negative: None,
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
    /// Remembered activity names per kind, most recently used first. Focus uses productive's.
    pub productive_activities: Vec<String>,
    pub wasted_activities: Vec<String>,
    /// What the Pomodoro's focus blocks are logged as.
    pub focus_activity: String,
}

impl Store {
    pub fn next_id(&mut self) -> u64 {
        self.next_id += 1;
        self.next_id
    }

    pub fn add_entry(&mut self, kind: Kind, start: i64, end: i64, activity: String, note: String) {
        let id = self.next_id();
        self.entries.push(Entry { id, kind, start, end, activity, note });
    }

    /// Stops the tracker, logging what it counted (zero-length runs are dropped).
    pub fn stop(&mut self, now: i64) {
        if let Some(r) = self.running.take()
            && now > r.start
        {
            self.add_entry(r.kind, r.start, now, r.activity, String::new());
        }
    }

    /// Starts tracking `kind` as `activity`, logging whatever was running before.
    pub fn start(&mut self, kind: Kind, activity: String, now: i64) {
        self.stop(now);
        self.remember(kind, &activity);
        self.running = Some(Running { kind, start: now, activity: activity.trim().to_string() });
    }

    /// Breaks have no named activities.
    pub fn activities(&self, kind: Kind) -> &[String] {
        match kind {
            Kind::Productive => &self.productive_activities,
            Kind::Wasted => &self.wasted_activities,
            Kind::Break => &[],
        }
    }

    fn activities_mut(&mut self, kind: Kind) -> Option<&mut Vec<String>> {
        match kind {
            Kind::Productive => Some(&mut self.productive_activities),
            Kind::Wasted => Some(&mut self.wasted_activities),
            Kind::Break => None,
        }
    }

    /// Moves `name` to the front of the list (adding it the first time). Case-insensitive.
    pub fn remember(&mut self, kind: Kind, name: &str) {
        let name = name.trim();
        if let Some(list) = self.activities_mut(kind).filter(|_| !name.is_empty()) {
            list.retain(|a| !a.eq_ignore_ascii_case(name));
            list.insert(0, name.to_string());
        }
    }

    pub fn forget(&mut self, kind: Kind, name: &str) {
        if let Some(list) = self.activities_mut(kind) {
            list.retain(|a| a != name);
        }
    }

    /// Seconds per activity of `kind` inside the range, largest first. Names group
    /// case-insensitively; unnamed time is `""`.
    pub fn breakdown(&self, kind: Kind, (a, b): (i64, i64), now: i64) -> Vec<(String, i64)> {
        let mut by: BTreeMap<String, (String, i64)> = BTreeMap::new();
        let live = self.running.as_ref().map(|r| (r.kind, r.start, now, r.activity.as_str()));
        let spans = self.entries.iter().map(|e| (e.kind, e.start, e.end, e.activity.as_str())).chain(live);
        for (k, s, e, name) in spans {
            let secs = overlap(s, e, a, b);
            if k == kind && secs > 0 {
                by.entry(name.to_lowercase()).or_insert_with(|| (name.to_string(), 0)).1 += secs;
            }
        }
        let mut out: Vec<(String, i64)> = by.into_values().collect();
        out.sort_by_key(|(_, s)| std::cmp::Reverse(*s));
        out
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
            .as_ref()
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

    /// A day inside the period before the one containing `today`.
    pub fn previous(self, today: NaiveDate) -> NaiveDate {
        self.bounds(today).0 - Days::new(1)
    }

    /// Days of the period that have started by `today` (the whole period if it's in the past).
    pub fn days_elapsed(self, period_day: NaiveDate, today: NaiveDate) -> i64 {
        let (first, next) = self.bounds(period_day);
        (next.min(today + Days::new(1)) - first).num_days().max(1)
    }

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
        let kind = e.kind.class();
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
        Ok(text) => serde_json::from_str::<Store>(&text)
            .map(|mut s| {
                s.settings.migrate();
                s
            })
            .unwrap_or_else(|e| {
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
        s.add_entry(Kind::Wasted, start, start + 2 * 3600, String::new(), String::new());
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
        s.start(Kind::Productive, "Coding".into(), 1000);
        assert_eq!(s.total(Kind::Productive, (0, i64::MAX), 1600), 600);
        s.start(Kind::Wasted, String::new(), 1600); // switching logs the productive run
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
        s.add_entry(Kind::Wasted, 0, 600, String::new(), "reels, \"just one\"".into());
        s.add_entry(Kind::Productive, -600, 0, String::new(), "plain".into());
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

    #[test]
    fn colors_are_per_theme_and_validated() {
        let mut s = Settings { theme: Theme::Nord, ..Settings::default() };
        assert_eq!(s.color(Token::Negative), "#bf616a");
        s.set_color(Token::Accent, Some("#ABCDEF".into()));
        s.set_color(Token::Bg, Some("red; background: url(x)".into())); // rejected
        assert_eq!(s.color(Token::Accent), "#abcdef");
        assert_eq!(s.color(Token::Bg), "#2e3440");
        s.theme = Theme::Copper; // the override belongs to Nord only
        assert_eq!(s.color(Token::Accent), "#d9842f");
        s.theme = Theme::Nord;
        s.set_color(Token::Accent, None);
        assert!(s.custom.is_empty());
    }

    #[test]
    fn legacy_global_colours_migrate() {
        let mut s: Settings = serde_json::from_str(r##"{"theme":"Dracula","positive":"#112233"}"##).unwrap();
        s.migrate();
        assert_eq!(s.color(Token::Positive), "#112233");
        assert!(s.positive.is_none());
    }

    #[test]
    fn previous_periods_and_elapsed_days() {
        let d = |y, m, day| NaiveDate::from_ymd_opt(y, m, day).unwrap();
        let today = d(2026, 11, 5); // a Thursday
        assert_eq!(Period::Day.previous(today), d(2026, 11, 4));
        assert_eq!(Period::Week.bounds(Period::Week.previous(today)).0, d(2026, 10, 26));
        assert_eq!(Period::Month.previous(d(2026, 1, 15)), d(2025, 12, 31));
        assert_eq!(Period::Week.days_elapsed(today, today), 4); // Mon–Thu
        assert_eq!(Period::Week.days_elapsed(Period::Week.previous(today), today), 7);
        assert_eq!(Period::Year.days_elapsed(d(2025, 6, 1), today), 365);
    }

    #[test]
    fn swatch_colours_follow_overrides_per_theme() {
        let mut s = Settings::default();
        s.set_color(Token::Accent, Some("#8a6be1".into()));
        assert_eq!(s.color_for(Theme::Copper, Token::Accent), "#8a6be1");
        assert_eq!(s.color_for(Theme::Nord, Token::Accent), "#88c0d0");
        let mut st = Store::default();
        st.remember(Kind::Break, "nap");
        assert!(st.activities(Kind::Break).is_empty());
    }

    #[test]
    fn parse_hex_forms() {
        assert_eq!(parse_hex("#ABC").as_deref(), Some("#aabbcc"));
        assert_eq!(parse_hex(" d9842f ").as_deref(), Some("#d9842f"));
        assert_eq!(parse_hex("#12345"), None);
        assert_eq!(parse_hex("#zzzzzz"), None);
    }

    #[test]
    fn activities_are_mru_and_broken_down() {
        let mut s = Store::default();
        s.start(Kind::Wasted, "Doomscrolling".into(), 0);
        s.start(Kind::Wasted, "YouTube".into(), 600);
        s.start(Kind::Wasted, "doomscrolling".into(), 900); // same activity, different case
        assert_eq!(s.activities(Kind::Wasted), ["doomscrolling", "YouTube"]);
        s.stop(1500);
        let b = s.breakdown(Kind::Wasted, (0, 2000), 2000);
        assert_eq!(b, [("Doomscrolling".to_string(), 1200), ("YouTube".to_string(), 300)]);
        s.forget(Kind::Wasted, "YouTube");
        assert_eq!(s.activities(Kind::Wasted).len(), 1);
    }
}
