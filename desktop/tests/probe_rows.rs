//! 版 3.114.0 の作った後の採点の再現（採点者の scratchpad/g3114/zz_probe_repro.rs）を、直した形で落ちる試験にした:
//! 止まる共有の 1 行の後ろの行も答える（places・using は wait_all でまとめて待つ）・止まる共有が上限を塞いでもローカルの「参照…」は待たされない。

use da_core::probe::Probes;
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

#[test]
fn queued_rows_behind_a_stuck_row_still_answer() {
    let p = Probes::new(16);
    let (tx, rx) = mpsc::channel::<()>();
    let rx = Arc::new(Mutex::new(rx));
    let r2 = rx.clone();
    let mut tickets = vec![p.start("reach:\\\\srv\\share\\", None, move || {
        let _ = r2.lock().unwrap().recv();
        true
    })];
    for i in 0..20 {
        tickets.push(p.start(&format!("reach:{}:\\", (b'D' + i as u8) as char), None, || true));
    }
    // 共有の行も 20 本（上限 16 を超える）
    for i in 0..20 {
        tickets.push(p.start(&format!("reach:\\\\srv{i}\\s\\"), None, || true));
    }
    let got = p.wait_all(tickets, Instant::now() + Duration::from_millis(1500));
    let none: Vec<usize> = got.iter().enumerate().filter(|(_, g)| g.is_none()).map(|(i, _)| i).collect();
    tx.send(()).unwrap();
    assert_eq!(none, vec![0], "答えの無い行は止まる 1 行だけ");
}

#[test]
fn a_full_limit_does_not_starve_a_local_ask() {
    let p = Probes::new(16);
    let (tx, rx) = mpsc::channel::<()>();
    let rx = Arc::new(Mutex::new(rx));
    for i in 0..16 {
        let r = rx.clone();
        let _ = p.start(&format!("online:\\\\srv\\s{i}\\"), None, move || {
            let _ = r.lock().unwrap().recv();
            true
        });
    }
    let t0 = Instant::now();
    let got = p.ask("browse:c:\\", None, Duration::from_millis(400), true, || true);
    for _ in 0..16 {
        tx.send(()).unwrap();
    }
    assert_eq!(got, Some(true));
    assert!(t0.elapsed() < Duration::from_millis(300));
}
