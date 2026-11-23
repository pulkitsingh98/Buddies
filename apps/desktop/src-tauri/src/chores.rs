//! Safe desktop chores: tidy a folder into dated category folders, with a preview first and a
//! one-click undo. Files are only ever *moved* (never deleted or overwritten), every move is
//! logged to SQLite, and only folders the user enabled are touched.

use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::settings::SettingsState;

const HISTORY_DAYS: u64 = 30;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Category {
    Images,
    Screenshots,
    Documents,
    Videos,
    Archives,
    Code,
    Other,
}

impl Category {
    pub fn folder(self) -> &'static str {
        match self {
            Category::Images => "Images",
            Category::Screenshots => "Screenshots",
            Category::Documents => "Documents",
            Category::Videos => "Videos",
            Category::Archives => "Archives",
            Category::Code => "Code",
            Category::Other => "Other",
        }
    }
}

pub fn categorize(path: &Path) -> Category {
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_lowercase();
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let is_image = matches!(
        ext.as_str(),
        "png"
            | "jpg"
            | "jpeg"
            | "gif"
            | "webp"
            | "heic"
            | "heif"
            | "bmp"
            | "tif"
            | "tiff"
            | "svg"
            | "avif"
    );
    if is_image
        && (name.starts_with("screenshot")
            || name.starts_with("screen shot")
            || name.starts_with("cleanshot")
            || name.starts_with("capture"))
    {
        return Category::Screenshots;
    }
    if is_image {
        return Category::Images;
    }
    match ext.as_str() {
        "pdf" | "doc" | "docx" | "txt" | "md" | "rtf" | "pages" | "odt" | "xls" | "xlsx"
        | "csv" | "numbers" | "ppt" | "pptx" | "key" | "odp" | "ods" | "epub" => {
            Category::Documents
        }
        "mp4" | "mov" | "avi" | "mkv" | "webm" | "m4v" | "wmv" => Category::Videos,
        "zip" | "rar" | "7z" | "tar" | "gz" | "tgz" | "bz2" | "xz" | "dmg" | "iso" | "pkg"
        | "msi" => Category::Archives,
        "js" | "ts" | "tsx" | "jsx" | "py" | "rs" | "java" | "c" | "h" | "cpp" | "cs" | "go"
        | "rb" | "php" | "html" | "css" | "json" | "yaml" | "yml" | "toml" | "sh" | "ps1"
        | "swift" | "kt" | "ipynb" | "sql" => Category::Code,
        _ => Category::Other,
    }
}

/// Why a file was left alone (`None` = it can be tidied).
pub fn skip_reason(path: &Path) -> Option<&'static str> {
    let meta = match fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(_) => return Some("unreadable"),
    };
    if meta.file_type().is_symlink() {
        return Some("shortcut");
    }
    if !meta.is_file() {
        return Some("folder");
    }
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if name.starts_with('.') || is_hidden(&meta) {
        return Some("hidden");
    }
    let lower = name.to_lowercase();
    if matches!(lower.as_str(), "desktop.ini" | "thumbs.db") {
        return Some("system file");
    }
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if matches!(
        ext.as_str(),
        "lnk" | "url" | "webloc" | "alias" | "desktop" | "inetloc"
    ) {
        return Some("shortcut");
    }
    if matches!(
        ext.as_str(),
        "crdownload" | "part" | "download" | "partial" | "tmp" | "opdownload"
    ) {
        return Some("still downloading");
    }
    if in_use(path, &meta) {
        return Some("in use");
    }
    None
}

#[cfg(windows)]
fn is_hidden(meta: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const HIDDEN: u32 = 0x2;
    const SYSTEM: u32 = 0x4;
    meta.file_attributes() & (HIDDEN | SYSTEM) != 0
}

#[cfg(not(windows))]
fn is_hidden(_meta: &fs::Metadata) -> bool {
    false
}

/// Windows: a file open elsewhere can't be opened exclusively. Elsewhere: recently modified.
#[cfg(windows)]
fn in_use(path: &Path, _meta: &fs::Metadata) -> bool {
    use std::os::windows::fs::OpenOptionsExt;
    fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(path)
        .is_err()
}

#[cfg(not(windows))]
fn in_use(_path: &Path, meta: &fs::Metadata) -> bool {
    /// Files changed this recently may still be open (best effort where locks can't be checked).
    const RECENT: std::time::Duration = std::time::Duration::from_secs(30);
    meta.modified()
        .ok()
        .and_then(|m| SystemTime::now().duration_since(m).ok())
        .is_some_and(|age| age < RECENT)
}

/// `dir/name`, or `dir/name (1).ext`, `(2)`… — never an existing or already-planned path.
pub fn unique_path(dir: &Path, file_name: &str, taken: &HashSet<PathBuf>) -> PathBuf {
    let candidate = dir.join(file_name);
    if !candidate.exists() && !taken.contains(&candidate) {
        return candidate;
    }
    let p = Path::new(file_name);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or(file_name);
    let ext = p.extension().and_then(|e| e.to_str());
    for n in 1.. {
        let name = match ext {
            Some(e) => format!("{stem} ({n}).{e}"),
            None => format!("{stem} ({n})"),
        };
        let c = dir.join(name);
        if !c.exists() && !taken.contains(&c) {
            return c;
        }
    }
    unreachable!()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedMove {
    pub from: PathBuf,
    pub to: PathBuf,
    pub category: Category,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Skipped {
    pub name: String,
    pub reason: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub moves: Vec<PlannedMove>,
    pub skipped: Vec<Skipped>,
    /// The folder everything goes into, e.g. `Desktop/Tidied by Cutu/2026-11-23`.
    pub dest: PathBuf,
}

/// Works out what a tidy would do, without touching anything (the preview / dry run).
pub fn plan(dir: &Path, dest: &Path) -> std::io::Result<Plan> {
    let mut entries: Vec<PathBuf> = fs::read_dir(dir)?.flatten().map(|e| e.path()).collect();
    entries.sort();
    let mut taken = HashSet::new();
    let mut moves = Vec::new();
    let mut skipped = Vec::new();
    for from in entries {
        let name = from
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        if let Some(reason) = skip_reason(&from) {
            // Folders (including our own "Tidied by…") are simply not part of a tidy.
            if reason != "folder" {
                skipped.push(Skipped { name, reason });
            }
            continue;
        }
        let category = categorize(&from);
        let to = unique_path(&dest.join(category.folder()), &name, &taken);
        taken.insert(to.clone());
        moves.push(PlannedMove { from, to, category });
    }
    Ok(Plan {
        moves,
        skipped,
        dest: dest.to_path_buf(),
    })
}

// ---------------------------------------------------------------- move log

pub struct MoveLog(pub Mutex<Connection>);

impl MoveLog {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;
        Self::init(conn)
    }

    #[cfg(test)]
    pub fn in_memory() -> rusqlite::Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> rusqlite::Result<Self> {
        conn.execute_batch(
            "create table if not exists batches (
               id text primary key, folder text not null, dest text not null,
               at integer not null, count integer not null, undone integer not null default 0);
             create table if not exists moves (
               id integer primary key, batch_id text not null references batches(id),
               src text not null, dst text not null, at integer not null);
             create index if not exists moves_batch on moves(batch_id);",
        )?;
        let log = Self(Mutex::new(conn));
        log.purge()?;
        Ok(log)
    }

    /// Keeps 30 days of history.
    fn purge(&self) -> rusqlite::Result<()> {
        let cutoff = now_secs().saturating_sub(HISTORY_DAYS * 86_400) as i64;
        let c = self.0.lock().expect("log poisoned");
        c.execute(
            "delete from moves where batch_id in (select id from batches where at < ?1)",
            [cutoff],
        )?;
        c.execute("delete from batches where at < ?1", [cutoff])?;
        Ok(())
    }
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyReport {
    pub batch_id: String,
    pub moved: usize,
    pub failed: Vec<Skipped>,
    pub dest: PathBuf,
}

/// Performs a plan. Each move is logged as it happens, so even a partial tidy can be undone.
pub fn apply(log: &MoveLog, folder: &str, plan: &Plan) -> Result<ApplyReport, String> {
    let batch_id = format!("{}-{}", now_secs(), std::process::id());
    let at = now_secs() as i64;
    let conn = log.0.lock().expect("log poisoned");
    conn.execute(
        "insert into batches (id, folder, dest, at, count) values (?1, ?2, ?3, ?4, 0)",
        params![batch_id, folder, plan.dest.to_string_lossy(), at],
    )
    .map_err(|e| e.to_string())?;
    let mut moved = 0;
    let mut failed = Vec::new();
    for m in &plan.moves {
        let name = m
            .from
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        // Re-check right before moving: never overwrite, and skip anything that changed.
        if m.to.exists() || skip_reason(&m.from).is_some() {
            failed.push(Skipped {
                name,
                reason: "changed since preview",
            });
            continue;
        }
        if let Some(parent) = m.to.parent() {
            if let Err(e) = fs::create_dir_all(parent) {
                log::warn!("create {parent:?}: {e}");
                failed.push(Skipped {
                    name,
                    reason: "couldn't create folder",
                });
                continue;
            }
        }
        match fs::rename(&m.from, &m.to) {
            Ok(()) => {
                conn.execute(
                    "insert into moves (batch_id, src, dst, at) values (?1, ?2, ?3, ?4)",
                    params![
                        batch_id,
                        m.from.to_string_lossy(),
                        m.to.to_string_lossy(),
                        at
                    ],
                )
                .map_err(|e| e.to_string())?;
                moved += 1;
            }
            Err(e) => {
                log::warn!("move {:?}: {e}", m.from);
                failed.push(Skipped {
                    name,
                    reason: "couldn't move",
                });
            }
        }
    }
    conn.execute(
        "update batches set count = ?1 where id = ?2",
        params![moved as i64, batch_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(ApplyReport {
        batch_id,
        moved,
        failed,
        dest: plan.dest.clone(),
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoReport {
    pub restored: usize,
    /// Restored next to the original because something new now has its name.
    pub renamed: Vec<String>,
    /// No longer where the tidy put it (moved or deleted since), left alone.
    pub missing: Vec<String>,
}

/// Moves every file of the most recent (not yet undone) batch back where it came from.
pub fn undo_last(log: &MoveLog) -> Result<Option<UndoReport>, String> {
    let conn = log.0.lock().expect("log poisoned");
    let batch: Option<(String, String)> = conn
        .query_row(
            "select id, dest from batches where undone = 0 and count > 0 order by at desc, rowid desc limit 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok();
    let Some((batch_id, dest)) = batch else {
        return Ok(None);
    };
    let mut stmt = conn
        .prepare("select src, dst from moves where batch_id = ?1 order by id desc")
        .map_err(|e| e.to_string())?;
    let rows: Vec<(String, String)> = stmt
        .query_map([&batch_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|e| e.to_string())?
        .flatten()
        .collect();
    let mut report = UndoReport {
        restored: 0,
        renamed: vec![],
        missing: vec![],
    };
    let mut dirs = HashSet::new();
    for (src, dst) in rows {
        let (src, dst) = (PathBuf::from(src), PathBuf::from(dst));
        let name = src
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        if !dst.is_file() {
            report.missing.push(name);
            continue;
        }
        let parent = src.parent().unwrap_or(Path::new("."));
        let target = unique_path(parent, &name, &HashSet::new());
        if target != src {
            report.renamed.push(name);
        }
        if fs::rename(&dst, &target).is_ok() {
            report.restored += 1;
            if let Some(d) = dst.parent() {
                dirs.insert(d.to_path_buf());
            }
        }
    }
    // Tidy up the folders the tidy created, if they're now empty (never deletes files).
    let dest = PathBuf::from(dest);
    for d in &dirs {
        let _ = fs::remove_dir(d);
    }
    let _ = fs::remove_dir(&dest);
    if let Some(root) = dest.parent() {
        let _ = fs::remove_dir(root);
    }
    conn.execute("update batches set undone = 1 where id = ?1", [&batch_id])
        .map_err(|e| e.to_string())?;
    Ok(Some(report))
}

// ---------------------------------------------------------------- commands

#[derive(Clone, Copy)]
enum Folder {
    Desktop,
    Downloads,
}

fn folder(app: &AppHandle, id: &str) -> Result<(Folder, PathBuf), String> {
    let settings = app.state::<SettingsState>().get();
    let (f, enabled, path) = match id {
        "desktop" => (
            Folder::Desktop,
            settings.tidy_desktop,
            app.path().desktop_dir(),
        ),
        "downloads" => (
            Folder::Downloads,
            settings.sort_downloads,
            app.path().download_dir(),
        ),
        _ => return Err("unknown folder".into()),
    };
    if !enabled {
        return Err("This folder isn't enabled for tidying. Turn it on first.".into());
    }
    Ok((f, path.map_err(|e| e.to_string())?))
}

/// "Cutu" → "Tidied by Cutu" (file-name safe).
fn dest_dir(base: &Path, folder: Folder, pet_name: &str, date: &str) -> Result<PathBuf, String> {
    if date.len() != 10 || !date.chars().all(|c| c.is_ascii_digit() || c == '-') {
        return Err("bad date".into());
    }
    let clean: String = pet_name
        .chars()
        .filter(|c| {
            !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') && !c.is_control()
        })
        .take(30)
        .collect();
    let name = if clean.trim().is_empty() {
        "DeskPals"
    } else {
        clean.trim()
    };
    let verb = match folder {
        Folder::Desktop => "Tidied",
        Folder::Downloads => "Sorted",
    };
    Ok(base.join(format!("{verb} by {name}")).join(date))
}

fn read_error(e: std::io::Error) -> String {
    if e.kind() == std::io::ErrorKind::PermissionDenied {
        "DeskPals isn't allowed to read this folder. On a Mac: System Settings → Privacy & Security → Files and Folders → DeskPals.".into()
    } else {
        e.to_string()
    }
}

#[tauri::command]
pub fn chores_preview(
    app: AppHandle,
    folder_id: String,
    pet_name: String,
    date: String,
) -> Result<Plan, String> {
    let (f, base) = folder(&app, &folder_id)?;
    plan(&base, &dest_dir(&base, f, &pet_name, &date)?).map_err(read_error)
}

#[tauri::command]
pub fn chores_apply(
    app: AppHandle,
    log: State<'_, MoveLog>,
    folder_id: String,
    pet_name: String,
    date: String,
) -> Result<ApplyReport, String> {
    let (f, base) = folder(&app, &folder_id)?;
    let p = plan(&base, &dest_dir(&base, f, &pet_name, &date)?).map_err(read_error)?;
    apply(&log, &folder_id, &p)
}

#[tauri::command]
pub fn chores_undo_last(log: State<'_, MoveLog>) -> Result<Option<UndoReport>, String> {
    undo_last(&log)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchInfo {
    id: String,
    folder: String,
    dest: String,
    at: i64,
    count: i64,
    undone: bool,
}

#[tauri::command]
pub fn chores_history(log: State<'_, MoveLog>) -> Result<Vec<BatchInfo>, String> {
    let conn = log.0.lock().expect("log poisoned");
    let mut stmt = conn
        .prepare("select id, folder, dest, at, count, undone from batches where count > 0 order by at desc limit 20")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(BatchInfo {
                id: r.get(0)?,
                folder: r.get(1)?,
                dest: r.get(2)?,
                at: r.get(3)?,
                count: r.get(4)?,
                undone: r.get::<_, i64>(5)? != 0,
            })
        })
        .map_err(|e| e.to_string())?
        .flatten()
        .collect();
    Ok(rows)
}

fn safe_name(name: &str) -> Result<String, String> {
    let n: String = name
        .trim()
        .chars()
        .filter(|c| {
            !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') && !c.is_control()
        })
        .take(80)
        .collect();
    if n.is_empty() || n == "." || n == ".." {
        return Err("Please type a name.".into());
    }
    Ok(n)
}

/// Creates a new folder on the Desktop (never replaces an existing one).
#[tauri::command]
pub fn quick_folder(app: AppHandle, name: String) -> Result<PathBuf, String> {
    let desktop = app.path().desktop_dir().map_err(|e| e.to_string())?;
    let path = unique_path(&desktop, &safe_name(&name)?, &HashSet::new());
    fs::create_dir(&path).map_err(read_error)?;
    Ok(path)
}

/// Saves a quick note as a Markdown file on the Desktop (never overwrites).
#[tauri::command]
pub fn quick_note(app: AppHandle, title: String, body: String) -> Result<PathBuf, String> {
    let desktop = app.path().desktop_dir().map_err(|e| e.to_string())?;
    let file = format!("{}.md", safe_name(&title)?);
    let path = unique_path(&desktop, &file, &HashSet::new());
    if body.len() > 100_000 {
        return Err("That note is too long.".into());
    }
    fs::write(
        &path,
        format!("# {}\n\n{}\n", title.trim(), body.trim_end()),
    )
    .map_err(read_error)?;
    Ok(path)
}

/// Opens a folder in Finder / Explorer (only paths under Desktop or Downloads).
#[tauri::command]
pub fn reveal(app: AppHandle, path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    let allowed = [app.path().desktop_dir(), app.path().download_dir()]
        .into_iter()
        .flatten()
        .any(|base| p.starts_with(base));
    if !allowed || !p.exists() {
        return Err("Can't open that.".into());
    }
    #[cfg(target_os = "macos")]
    let cmd = "open";
    #[cfg(windows)]
    let cmd = "explorer";
    #[cfg(not(any(target_os = "macos", windows)))]
    let cmd = "xdg-open";
    std::process::Command::new(cmd)
        .arg(&p)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn touch(dir: &Path, name: &str, contents: &str) -> PathBuf {
        let p = dir.join(name);
        fs::write(&p, contents).unwrap();
        // Backdate so the "recently modified" guard doesn't skip it.
        let old = SystemTime::now() - Duration::from_secs(3600);
        fs::File::options()
            .write(true)
            .open(&p)
            .unwrap()
            .set_modified(old)
            .unwrap();
        p
    }

    #[test]
    fn categorizes_common_files() {
        assert_eq!(
            categorize(Path::new("Screenshot 2026-11-23.png")),
            Category::Screenshots
        );
        assert_eq!(categorize(Path::new("holiday.JPG")), Category::Images);
        assert_eq!(categorize(Path::new("cv.pdf")), Category::Documents);
        assert_eq!(categorize(Path::new("clip.mov")), Category::Videos);
        assert_eq!(categorize(Path::new("backup.zip")), Category::Archives);
        assert_eq!(categorize(Path::new("main.rs")), Category::Code);
        assert_eq!(categorize(Path::new("mystery")), Category::Other);
    }

    #[test]
    fn plan_skips_folders_hidden_shortcuts_partials_and_recent_files() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        touch(d, "a.png", "x");
        touch(d, ".hidden", "x");
        touch(d, "app.lnk", "x");
        touch(d, "big.zip.crdownload", "x");
        fs::create_dir(d.join("Projects")).unwrap();
        fs::write(d.join("fresh.txt"), "just saved").unwrap(); // modified now
        let p = plan(d, &d.join("Tidied by Cutu/2026-11-23")).unwrap();
        let names: Vec<_> = p
            .moves
            .iter()
            .map(|m| m.from.file_name().unwrap().to_str().unwrap())
            .collect();
        assert_eq!(names, ["a.png"]);
        let reasons: Vec<_> = p
            .skipped
            .iter()
            .map(|s| (s.name.as_str(), s.reason))
            .collect();
        assert!(reasons.contains(&(".hidden", "hidden")));
        assert!(reasons.contains(&("app.lnk", "shortcut")));
        assert!(reasons.contains(&("big.zip.crdownload", "still downloading")));
        #[cfg(not(windows))]
        assert!(reasons.contains(&("fresh.txt", "in use")));
    }

    #[test]
    fn never_overwrites_existing_or_planned_files() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        let dest = d.join("Tidied by Cutu/2026-11-23");
        fs::create_dir_all(dest.join("Documents")).unwrap();
        fs::write(dest.join("Documents/notes.txt"), "already here").unwrap();
        touch(d, "notes.txt", "new");
        let p = plan(d, &dest).unwrap();
        assert_eq!(p.moves[0].to, dest.join("Documents/notes (1).txt"));
    }

    #[test]
    fn tidy_then_undo_restores_every_file_to_its_original_path() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        let originals: Vec<(PathBuf, String)> = [
            "photo.jpg",
            "Screenshot 1.png",
            "report.pdf",
            "movie.mp4",
            "stuff.zip",
            "script.py",
            "weird.xyz",
            "noext",
        ]
        .iter()
        .enumerate()
        .map(|(i, n)| (touch(d, n, &format!("content {i}")), format!("content {i}")))
        .collect();
        fs::create_dir(d.join("Keep Me")).unwrap();
        touch(&d.join("Keep Me"), "inside.txt", "untouched");

        let log = MoveLog::in_memory().unwrap();
        let p = plan(d, &d.join("Tidied by Cutu/2026-11-23")).unwrap();
        let report = apply(&log, "desktop", &p).unwrap();
        assert_eq!(report.moved, originals.len());
        for (path, _) in &originals {
            assert!(!path.exists(), "{path:?} should have moved");
        }
        assert!(d
            .join("Tidied by Cutu/2026-11-23/Screenshots/Screenshot 1.png")
            .is_file());
        assert!(d.join("Keep Me/inside.txt").is_file());

        let undo = undo_last(&log).unwrap().unwrap();
        assert_eq!(undo.restored, originals.len());
        assert!(undo.renamed.is_empty() && undo.missing.is_empty());
        for (path, content) in &originals {
            assert_eq!(
                &fs::read_to_string(path).unwrap(),
                content,
                "{path:?} restored intact"
            );
        }
        assert!(
            !d.join("Tidied by Cutu").exists(),
            "empty tidy folders are cleaned up"
        );
        assert!(undo_last(&log).unwrap().is_none(), "nothing left to undo");
    }

    #[test]
    fn undo_never_overwrites_a_new_file_with_the_same_name() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        touch(d, "todo.txt", "old");
        let log = MoveLog::in_memory().unwrap();
        apply(&log, "desktop", &plan(d, &d.join("T/2026-11-23")).unwrap()).unwrap();
        fs::write(d.join("todo.txt"), "brand new").unwrap();
        let undo = undo_last(&log).unwrap().unwrap();
        assert_eq!(undo.renamed, ["todo.txt"]);
        assert_eq!(fs::read_to_string(d.join("todo.txt")).unwrap(), "brand new");
        assert_eq!(fs::read_to_string(d.join("todo (1).txt")).unwrap(), "old");
    }

    #[test]
    fn dest_names_are_file_name_safe() {
        let p = dest_dir(Path::new("/x"), Folder::Desktop, "Cu/tu:*", "2026-11-23").unwrap();
        assert_eq!(p, Path::new("/x/Tidied by Cutu/2026-11-23"));
        assert!(dest_dir(Path::new("/x"), Folder::Desktop, "a", "../../etc").is_err());
    }
}
