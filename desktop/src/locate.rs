//! 置き場所を探す: アプリの中身（program フォルダ）・この PC の作業場所。
//! 作業場所の決まりは前の版の Python（版 3.119.0 で消した program/app_env.py の local_root）と同じ（前の版の PC と記録・写し・設定を共にする）。

use crate::brand::brand;
use std::env;
use std::path::{Path, PathBuf};

/// program フォルダを渡す引数（`--program <フォルダ>`）。
pub const PROGRAM_ARG: &str = "--program";
/// 最後に使った program フォルダの控え（`local_root()/desktop/program.txt`）。
const REMEMBERED: &str = "program.txt";

/// program フォルダ（中身がある所: da_core::update::is_dist。版 3.118.0 から sidecar.py か app の版と名乗り）。答えはここの1箇所。
/// 探す順: 引数 `--program` → 環境変数 TPA_PROGRAM_DIR（開発・試験）→ この exe の置き場所から上へたどって
/// 中身がある所（da_core::update::is_dist。配る形は exe と program が並ぶ・作る途中は3つ上）→ 最後に使った場所の控え。
pub fn program_dir() -> Result<PathBuf, String> {
    let given = arg_value(PROGRAM_ARG).or_else(|| env::var_os("TPA_PROGRAM_DIR").map(PathBuf::from));
    let found = match given {
        Some(p) if da_core::update::is_dist(&p) => p,
        Some(p) => return Err(format!("指定された program フォルダに中身（app\\version.py・brand.json）がありません: {}", p.display())),
        None => {
            let exe = env::current_exe().map_err(|e| e.to_string())?;
            match find_program_from(&exe).or_else(remembered) {
                Some(p) => p,
                None => {
                    return Err(format!(
                        "アプリの中身（program フォルダ）が見つかりません。配られた ZIP を展開したフォルダの {} から開いてください（exe と program フォルダが並んでいる形）。\n探し始めた場所: {}",
                        brand().exe,
                        exe.parent().unwrap_or(&exe).display()
                    ))
                }
            }
        }
    };
    remember(&found);
    Ok(found)
}

/// 引数 `name <値>` の値（`--name=値` も受ける）。
fn arg_value(name: &str) -> Option<PathBuf> {
    let args: Vec<String> = env::args().collect();
    let eq = format!("{name}=");
    args.iter()
        .enumerate()
        .find_map(|(i, a)| if a == name { args.get(i + 1).map(PathBuf::from) } else { a.strip_prefix(&eq).map(PathBuf::from) })
}

fn remembered() -> Option<PathBuf> {
    let text = std::fs::read_to_string(local_root().join("desktop").join(REMEMBERED)).ok()?;
    let p = PathBuf::from(text.trim());
    da_core::update::is_dist(&p).then_some(p)
}

/// program フォルダを控える（同じなら書かない）。
pub fn remember(p: &Path) {
    let dir = local_root().join("desktop");
    let file = dir.join(REMEMBERED);
    let text = p.display().to_string();
    if std::fs::read_to_string(&file).ok().as_deref() != Some(text.as_str()) {
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::write(file, text);
    }
}

pub fn find_program_from(start: &Path) -> Option<PathBuf> {
    start.ancestors().skip(1).take(6).map(|d| d.join("program")).find(|p| da_core::update::is_dist(p))
}

/// この PC の作業場所（`app_env.local_root` と同じ決まり: TRANSFER_LOCAL_ROOT → (LOCALAPPDATA → TEMP → ホーム)\<data_dir>。
/// 前の名前の場所（legacy_data_dir）から移し終えるまでは前の場所: da_core::home::choose）。
pub fn local_root() -> PathBuf {
    local_root_from(|k| env::var_os(k).filter(|v| !v.is_empty()), home())
}

fn local_root_from(var: impl Fn(&str) -> Option<std::ffi::OsString>, home: PathBuf) -> PathBuf {
    if let Some(p) = var("TRANSFER_LOCAL_ROOT") {
        return PathBuf::from(p);
    }
    let (new, legacy) = roots_from(&var, home);
    da_core::home::choose(&new, &legacy)
}

/// 作業場所の候補（いまの名前の場所, 前の名前の場所）。TRANSFER_LOCAL_ROOT を指定したとき（試験・開発）は None（移さない）。
pub fn home_roots() -> Option<(PathBuf, Vec<PathBuf>)> {
    let var = |k: &str| env::var_os(k).filter(|v| !v.is_empty());
    if var("TRANSFER_LOCAL_ROOT").is_some() {
        return None;
    }
    Some(roots_from(&var, home()))
}

fn roots_from(var: &impl Fn(&str) -> Option<std::ffi::OsString>, home: PathBuf) -> (PathBuf, Vec<PathBuf>) {
    let base = var("LOCALAPPDATA").or_else(|| var("TEMP")).map(PathBuf::from).unwrap_or(home);
    let b = brand();
    (base.join(&b.data_dir), b.legacy_data_dir.iter().map(|d| base.join(d)).collect())
}

/// Python の `Path.home()` と同じ（Windows は USERPROFILE、ほかは HOME）。
fn home() -> PathBuf {
    let key = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    env::var_os(key).map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;

    #[test]
    fn finds_program_next_to_the_exe_or_above() {
        let tmp = env::temp_dir().join(format!("da-locate-{}", std::process::id()));
        let prog = tmp.join("program");
        std::fs::create_dir_all(&prog).unwrap();
        std::fs::write(prog.join("sidecar.py"), "").unwrap();
        let deep = tmp.join("desktop").join("target").join("release");
        std::fs::create_dir_all(&deep).unwrap();
        assert_eq!(find_program_from(&tmp.join("App.exe")), Some(prog.clone()), "exe と program が並ぶ（配る形）");
        assert_eq!(find_program_from(&deep.join("App.exe")), Some(prog.clone()), "作る途中（3つ上）");
        assert_eq!(find_program_from(&env::temp_dir().join("nowhere").join("x.exe")), None);
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn local_root_follows_app_env() {
        let home = PathBuf::from("/home/u");
        let vars = |pairs: &'static [(&'static str, &'static str)]| {
            move |k: &str| pairs.iter().find(|(n, _)| *n == k).map(|(_, v)| OsString::from(v))
        };
        let d = &brand().data_dir;
        assert_eq!(
            local_root_from(vars(&[("TRANSFER_LOCAL_ROOT", "/x"), ("LOCALAPPDATA", "/l")]), home.clone()),
            PathBuf::from("/x"),
            "指定が先"
        );
        assert_eq!(local_root_from(vars(&[("LOCALAPPDATA", "/l"), ("TEMP", "/t")]), home.clone()), PathBuf::from("/l").join(d));
        assert_eq!(local_root_from(vars(&[("TEMP", "/t")]), home.clone()), PathBuf::from("/t").join(d), "LOCALAPPDATA が無ければ TEMP");
        assert_eq!(local_root_from(vars(&[]), home.clone()), home.join(d), "どちらも無ければホーム");
    }
}
