//! Click-through except on the pet.
//!
//! Each pet page reports a coarse occupancy grid of its window (which cells contain opaque
//! sprite pixels or UI such as a speech bubble). A low-frequency background thread checks the
//! global cursor against those grids and toggles `set_ignore_cursor_events` only on change,
//! so clicks on empty space fall through to the apps underneath.

use std::{collections::HashMap, sync::Mutex, time::Duration};

use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

use crate::pet_windows::LABEL_PREFIX;

#[derive(Debug, Clone, PartialEq)]
pub struct HitMask {
    pub cols: u32,
    pub rows: u32,
    /// Row-major bitset, LSB first.
    pub bits: Vec<u8>,
}

impl HitMask {
    /// Is the point (relative to the window's top-left, in the same units as `size`) on the pet?
    pub fn hit(&self, x: f64, y: f64, w: f64, h: f64) -> bool {
        if w <= 0.0 || h <= 0.0 || x < 0.0 || y < 0.0 || x >= w || y >= h {
            return false;
        }
        let col = ((x / w) * self.cols as f64) as u32;
        let row = ((y / h) * self.rows as f64) as u32;
        let i = (row.min(self.rows - 1) * self.cols + col.min(self.cols - 1)) as usize;
        self.bits
            .get(i / 8)
            .is_some_and(|b| b & (1 << (i % 8)) != 0)
    }
}

#[derive(Default)]
pub struct HitMasks {
    masks: Mutex<HashMap<String, HitMask>>,
    /// Last value passed to `set_ignore_cursor_events`, per window.
    ignoring: Mutex<HashMap<String, bool>>,
}

#[tauri::command]
pub fn set_hit_mask(
    window: WebviewWindow,
    state: tauri::State<'_, HitMasks>,
    cols: u32,
    rows: u32,
    bits: Vec<u8>,
) -> Result<(), String> {
    if cols == 0
        || rows == 0
        || cols * rows > 64 * 64
        || bits.len() < (cols * rows).div_ceil(8) as usize
    {
        return Err("bad mask dimensions".into());
    }
    state
        .masks
        .lock()
        .expect("masks poisoned")
        .insert(window.label().to_string(), HitMask { cols, rows, bits });
    Ok(())
}

fn inside(
    cursor: PhysicalPosition<f64>,
    pos: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    margin: f64,
) -> bool {
    cursor.x >= pos.x as f64 - margin
        && cursor.y >= pos.y as f64 - margin
        && cursor.x < (pos.x as f64 + size.width as f64 + margin)
        && cursor.y < (pos.y as f64 + size.height as f64 + margin)
}

pub fn start(app: AppHandle) {
    std::thread::Builder::new()
        .name("hit-test".into())
        .spawn(move || loop {
            let near = tick(&app);
            // Poll quickly only while the cursor is near a pet.
            std::thread::sleep(Duration::from_millis(if near { 50 } else { 250 }));
        })
        .expect("spawn hit-test thread");
}

/// Returns true if the cursor is near any pet window.
fn tick(app: &AppHandle) -> bool {
    let Ok(cursor) = app.cursor_position() else {
        return false;
    };
    let state = app.state::<HitMasks>();
    let masks = state.masks.lock().expect("masks poisoned").clone();
    let mut ignoring = state.ignoring.lock().expect("ignoring poisoned");
    ignoring.retain(|label, _| app.get_webview_window(label).is_some());

    let mut near = false;
    for (label, win) in app.webview_windows() {
        if !label.starts_with(LABEL_PREFIX) {
            continue;
        }
        let (Ok(pos), Ok(size)) = (win.outer_position(), win.inner_size()) else {
            continue;
        };
        near |= inside(cursor, pos, size, 120.0);
        let on_pet = masks.get(&label).is_some_and(|m| {
            m.hit(
                cursor.x - pos.x as f64,
                cursor.y - pos.y as f64,
                size.width as f64,
                size.height as f64,
            )
        });
        let want_ignore = !on_pet;
        if ignoring.get(&label) != Some(&want_ignore)
            && win.set_ignore_cursor_events(want_ignore).is_ok()
        {
            ignoring.insert(label, want_ignore);
        }
    }
    near
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mask_with(cols: u32, rows: u32, on: &[(u32, u32)]) -> HitMask {
        let mut bits = vec![0u8; (cols * rows).div_ceil(8) as usize];
        for (c, r) in on {
            let i = (r * cols + c) as usize;
            bits[i / 8] |= 1 << (i % 8);
        }
        HitMask { cols, rows, bits }
    }

    #[test]
    fn maps_points_to_cells() {
        let m = mask_with(4, 4, &[(1, 2)]);
        // window 400×400 → each cell is 100px
        assert!(m.hit(150.0, 250.0, 400.0, 400.0));
        assert!(!m.hit(50.0, 250.0, 400.0, 400.0));
        assert!(!m.hit(150.0, 350.0, 400.0, 400.0));
    }

    #[test]
    fn outside_window_never_hits() {
        let m = mask_with(2, 2, &[(0, 0), (1, 0), (0, 1), (1, 1)]);
        assert!(!m.hit(-1.0, 10.0, 100.0, 100.0));
        assert!(!m.hit(10.0, 100.0, 100.0, 100.0));
        assert!(m.hit(99.9, 99.9, 100.0, 100.0));
    }
}
