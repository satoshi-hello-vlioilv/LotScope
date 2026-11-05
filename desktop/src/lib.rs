//! 窓（Tauri）に依らない処理。exe（src/main.rs）と突き合わせの試験（tests/）が使う。

pub mod access;
pub mod access_write;
pub mod aggregate;
pub mod dashboard;
pub mod distribute;
pub mod formula;
pub mod home;
pub mod install;
pub mod join;
pub mod lists;
pub mod lot;
pub mod lotlist;
pub mod master_store;
pub mod mirror;
pub mod num_expr;
pub mod operation;
pub mod pivot;
pub mod presence;
pub mod pyfmt;
pub mod release;
pub mod search_index;
pub mod update;
pub mod worksum;
