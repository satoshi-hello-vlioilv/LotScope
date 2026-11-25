//! アプリの名前（`program/app/brand.json` の1か所の定義を、作るときに取り込む）。
//!
//! 名前（`name`・`subtitle`・`exe`）は窓の題名・起動画面・記録に使う。`app_id`・`data_dir` は変えない目印
//! （Tauri の identifier・この PC の作業場所のフォルダ名）。名前のじか書きの禁止・作る道具との突き合わせは program/tests/test_brand_names.py も見る。

use serde::Deserialize;
use std::sync::OnceLock;

const SOURCE: &str = include_str!("../../program/app/brand.json");

#[derive(Debug, Deserialize)]
pub struct Brand {
    pub name: String,
    pub subtitle: String,
    pub exe: String,
    pub app_id: String,
    pub data_dir: String,
    /// 名前の歴史: 前のアプリ名（その名前のショートカットを、いまの名前で作り直す）
    #[serde(default)]
    pub legacy_names: Vec<String>,
    /// 名前の歴史: 前の作業場所のフォルダ名（起動のはじめに中身を新しい場所へ移す・home.rs）
    #[serde(default)]
    pub legacy_data_dir: Vec<String>,
}

pub fn brand() -> &'static Brand {
    static B: OnceLock<Brand> = OnceLock::new();
    B.get_or_init(|| serde_json::from_str(SOURCE).expect("program/app/brand.json が読めません"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agrees_with_the_build_tools() {
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let b = brand();
        assert_eq!(conf["identifier"], b.app_id.as_str(), "Tauri の identifier は変えない目印（WebView の保存先が変わらない）");
        assert_eq!(conf["productName"], b.name.as_str());
        assert_eq!(format!("{}.exe", conf["mainBinaryName"].as_str().unwrap()), b.exe, "exe の名前");
        assert!(!b.data_dir.is_empty() && !b.subtitle.is_empty());
        assert!(!b.legacy_names.contains(&b.name) && !b.legacy_data_dir.contains(&b.data_dir), "名前の歴史に、いまの名前は入れない");
        // 版 3.119.0 の作った後の直し 2（前の Python の試験 test_brand の守りを移した）: desktop/Cargo.toml の [[bin]] name は exe の頭と同じ
        // （前の版の窓は入れ替えた後 brand.json の exe の名前で開き直すので、食い違うと開き直せない）
        let cargo = include_str!("../Cargo.toml");
        let bins: Vec<&str> = cargo
            .split("[[bin]]")
            .skip(1)
            .filter_map(|blk| {
                blk.lines()
                    .find_map(|l| l.trim().strip_prefix("name")?.trim().strip_prefix('=')?.trim().strip_prefix('"')?.strip_suffix('"'))
            })
            .collect();
        assert_eq!(bins, [b.exe.trim_end_matches(".exe")], "desktop/Cargo.toml の [[bin]] name は brand.json の exe と同じ");
    }

    #[test]
    fn fixed_ids_never_change() {
        let b = brand();
        // app_id を変えると、WebView の保存先・更新の置き場での見分けが切れる
        assert_eq!(b.app_id, "local.transferpitchanalyzer.desktop");
        // 作業場所は名前を変えてよいが、前の名前を legacy_data_dir に残す。はじめの名前 TransferPitchAnalyzer までたどれれば、
        // 各 PC の設定・記録・入れたアプリ・取り込んだ版を引き継げる
        assert!(
            b.data_dir == "TransferPitchAnalyzer" || b.legacy_data_dir.iter().any(|d| d == "TransferPitchAnalyzer"),
            "{:?}",
            b.legacy_data_dir
        );
    }
}
