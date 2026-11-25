//! 作る前の準備: Tauri の準備へ渡す。
//! アイコンの絵は焼いた物を追跡ファイルとして置く（版 3.119.0。段 ⑤: 前は組むたびに Python で 前の版の app_icon を流して描いた）:
//! desktop/icons/icon.ico・icon.png（exe と窓の絵）と desktop/splash/icon.png（起動画面。256px）。確かめは tests/icon_files.rs。

fn main() {
    // exe が名乗る「作ったコミット」。CI が渡す（desktop.yml の TPA_BUILD_COMMIT）。手元で作った exe は空
    println!("cargo:rerun-if-env-changed=TPA_BUILD_COMMIT");
    println!("cargo:rustc-env=TPA_BUILD_COMMIT={}", std::env::var("TPA_BUILD_COMMIT").unwrap_or_default());
    println!("cargo:rerun-if-changed=../program/app/brand.json");
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/icon.png");
    tauri_build::build()
}
