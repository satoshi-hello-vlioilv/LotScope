//! 焼いたアイコンの絵（版 3.119.0。段 ⑤: 前は build.rs が組むたびに Python で描いた）が、Windows の読める .ico と 256px の PNG か。
//! .ico は大きさごとの PNG（16〜256px・32bit）を持ち、起動画面の絵（splash/icon.png）は窓の絵（icons/icon.png）と同じ 256px の PNG。

use std::path::PathBuf;

const SIZES: [u32; 8] = [16, 20, 24, 32, 40, 48, 64, 256];

fn read(rel: &str) -> Vec<u8> {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(rel);
    std::fs::read(&p).unwrap_or_else(|e| panic!("{} が読めません: {e}", p.display()))
}

/// PNG の頭と IHDR の幅・高さ・ビットの深さ・色の形（6 = RGBA）
fn png_head(b: &[u8]) -> (u32, u32, u8, u8) {
    assert!(b.starts_with(b"\x89PNG\r\n\x1a\n") && &b[12..16] == b"IHDR", "PNG の頭でない");
    let u = |i: usize| u32::from_be_bytes(b[i..i + 4].try_into().unwrap());
    (u(16), u(20), b[24], b[25])
}

#[test]
fn the_icon_holds_every_size_as_png() {
    let ico = read("icons/icon.ico");
    let u16_at = |i: usize| u16::from_le_bytes(ico[i..i + 2].try_into().unwrap());
    let u32_at = |i: usize| u32::from_le_bytes(ico[i..i + 4].try_into().unwrap());
    assert_eq!((u16_at(0), u16_at(2), u16_at(4) as usize), (0, 1, SIZES.len()), "ICO の頭（予約 0・種類 1・枚数）");
    for (i, size) in SIZES.iter().enumerate() {
        let e = 6 + 16 * i;
        let (w, h) = (if ico[e] == 0 { 256 } else { ico[e] as u32 }, if ico[e + 1] == 0 { 256 } else { ico[e + 1] as u32 });
        assert_eq!((w, h, u16_at(e + 4), u16_at(e + 6)), (*size, *size, 1, 32), "{size}px の項");
        let (n, off) = (u32_at(e + 8) as usize, u32_at(e + 12) as usize);
        assert_eq!(png_head(&ico[off..off + n]), (*size, *size, 8, 6), "{size}px の中身は RGBA の PNG");
    }
}

#[test]
fn the_window_and_splash_pictures_are_the_same_256px_png() {
    let (win, splash) = (read("icons/icon.png"), read("splash/icon.png"));
    assert_eq!(png_head(&win), (256, 256, 8, 6));
    assert_eq!(win, splash, "起動画面の絵は窓の絵と同じ");
}
