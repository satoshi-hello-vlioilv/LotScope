# CLAUDE.md

このリポジトリで作業するときの決まり（利用者が決めたこと）。

## 返答・報告・解説は、常に日本語で書く

利用者への返答は、どんなに短くても日本語で書く。英語に戻さない。対象は次の全て:

- 返答と解説
- 途中の一言（いま何をしているか）
- 状況報告（CI の結果、PR の状態、定期確認の結果、マージ、exe の配置）
- PR の説明

## push の決まり

1. **push の前に、手元で型・構文（typecheck）・lint・test をすべて通す（green にしてから push する）。**
   CI で初めて失敗に気づく push はしない。下の「push 前の確かめ」を全部通してから push する。1 つでも落ちていれば push しない。
   文書だけの変更でも同じ。
2. **レビューの指摘は、1 件ずつ直して push しない。まとめて直し、1 回で push する。**
   届いた指摘をすべて直し、「push 前の確かめ」を通してから 1 回だけ push する。

## push 前の確かめ（CI と同じ物を手元で）

リポジトリの最上位で実行する:

```sh
# 1. 型・構文（JavaScript・Python・Rust）
find program/app/static/js program/tools desktop/src -name '*.js' -o -name '*.mjs' | xargs -n1 node --check
python -m compileall -q program
(cd desktop && cargo build --locked)
# 2. lint（Python・Rust）
ruff check program
(cd desktop && cargo fmt --check && cargo clippy --all-targets -- -D warnings)
# 3. テスト（Python・Rust）
(cd program && python -m unittest discover -s tests -t .)
python -m unittest discover -s desktop/bundle -t desktop/bundle
(cd desktop && cargo test --locked)
```

- 型検査の道具（TypeScript・mypy）は入れていないので、JavaScript・Python は構文の確かめで代えている。入れたら差し替える。Rust はコンパイラが型を確かめる。
- JavaScript の lint の設定は無い（2 は Python と Rust）。JavaScript のテスト（`npm test`）も、このリポジトリにはまだ無い。
- CI（`.github/workflows/ci.yml`）も同じ物を流す。ruff と Rust（clippy）は手元と同じ版に留めてある（ruff 0.15.20・Rust 1.97.0。
  版が上がると決まりが増え、手元で通った物が CI で落ちるため）。上げるときは手元と CI を一緒に上げる。
- `program` の中身を変えたら、版を上げて `cd program && python app_build.py --release` で `RELEASE` を書き直す（`tests/test_version.py` が止める）。
- 窓（`desktop/`。Tauri）を Linux で作るには WebKitGTK などが要る（`libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libxdo-dev libssl-dev`）。
- Windows だけのコード（`#[cfg(windows)]`）は Linux の確かめではコンパイルされない。変えたときは `rustup target add x86_64-pc-windows-msvc` のうえで
  `cargo clippy --target x86_64-pc-windows-msvc --all-targets -- -D warnings` も通す。窓全体が Linux から Windows 向けに組めないときは、その部分だけを
  `windows` クレートに頼る小さな作業用クレートへ写し、`cargo check --target x86_64-pc-windows-msvc` で型を確かめる。
- 起動・更新・配布の流れ（`desktop/src/install.rs`・`update.rs`・`distribute.rs`・`main.rs`）を変えたら、`desktop/bundle/verify.py` の通し
  （local・update・distribute）を本物の窓で確かめる（Windows は CI。手元の Linux では Windows だけの部分を差し替えて流す）。
- Windows の本物の WebView2 での自己診断は CI（`.github/workflows/desktop.yml`）が行う。手順の考え方は `program/docs/DESKTOP_MIGRATION_DESIGN.md`。
- 結果は**終了コードと「Ran … / OK / FAILED」の行で**読む。出力の最後の 1 行だけ（`tail -1` など）で判断しない
  （Python の試験は最後に ResourceWarning が出ることがあり、FAILED の行が隠れる。版 3.5.0 で、これを見落として CI で初めて失敗に気づいた）。
- 失敗が残っているときは push しない。直せない理由があるときは、push せずに利用者へ伝える。

## UI/UX を変えるときは、7 案を画像で直接比べ、2 回までの評価で自分で 1 案に決める

画面の見た目・使い方（UI/UX）を改良するときは、必ず次の順で設計する。案を文章だけで採点しない。
利用者に選んでもらうのを待たず、この流れで自律的に 1 案に決めて作る。

1. 今の画面を撮り（`ui-check.mjs`）、画像を見て評価する。何が使いにくいか・分かりにくいかを、画像で見えたことを根拠に挙げる
2. 改良案をまず **5 案**出す。5 案の方向（何で解くか: 置き場・見せ方・減らし方・流れの変え方 など）を並べて、偏っていないかを確かめ、
   5 案に無い**方向の違う解き方を 2 案**足す（採点のファイルの `"added"` に書く）
3. **7 案**を案ごとに撮り（`ui-variants.mjs`）、画像を直接見比べて採点する（1 回目。7 基準。`ui_score.py`）
4. 1 位が **80 点以上**で、2 位と**僅差**（僅差の幅 11 点より近い）でなければ、1 位に決める
5. 1 位でも 80 点に届かないか、僅差なら、まだ決めない。7 案から効いているエッセンス（画像で効いて見えた部分）を抜き出し、
   組み直した**複合案を 4 案**作る（どの案の何を組んだかを `"essence"` に書く）。**1 回目の上位 3 案**と合わせた 7 案を、また画像にして
   採点し（2 回目）、1 位に決める（2 回目は僅差でも決める。同じ点なら重い基準の点が高い方）
6. 決めた案を作ったら、作る前と後を `ui-check.mjs` で撮って測り、画像と数で確かめる。比べた画像は比較のページ（Artifact）で見せる

```sh
node program/tools/ui-check.mjs 出力フォルダ                                         # 今の画面（作った後の前後比較にも）
node program/tools/ui-variants.mjs 出力フォルダ 案の定義.mjs --states list,grouped,calc   # 案ごとの画面と、全案を並べた一覧
node program/tools/ui-variants.mjs 出力フォルダ 案の定義.mjs --view 1536x864        # フル HD・125% でも
python program/tools/ui_score.py 採点.json                                            # 採点・80 点と僅差の判定・次にすること
```

- 道具は Inventor のリポジトリの同じ名前の道具を、このアプリに合わせて移した（開発用のサーバー `ui_server.py` は試験用の品質データ 1500 行で起こす。
  撮る状態は `ui-harness.mjs` の `STATES`: 異常ロット一覧・並び・まとめ・列の見出しの札（狭い列・3 段・並べ替え・計算列）・表の見せ方・カード・計算の検索前・作業実績・作業実績を日＋直でまとめた所と日・直を押して絞った所・共有の書式（開いた・設備を選ぶ・当てた）・アプリのメニュー・更新履歴・スライサー・表示の設定・表示列の設定（列を選んだ所・この列の作り方を開いた所）・マスタ管理の各タブ（勤務体系も）・待ちの窓。
  試験用の作業実績は設備 12 台で、1 台はファイルが見つからない・1 台は更新が止まった形。作業開始（BOX実績_作業開始_日付）が同じ分割ロットを含み、
  勤務体系は全設備共通の交替勤務(1,2,3直) と CR2 だけの 4,5直）
- 画面の部品の評価関数（node で流す。Python の試験 `tests/test_screen_parts.py` からも流れる）: `program/tools/formula-builder-check.mjs`（式ビルダー）・
  `xlsx-check.mjs`（Excel を組む部品）。本物の画面で流す評価関数: `ui-eval-formula.mjs`（式の欄の大きさ・式ビルダー）・`ui-eval-slicer.mjs`（計算列のスライサー）・
  `ui-eval-excel.mjs`（Excel に出力）。どれも終了コード 0 で OK
- 7 基準の 6 つ目は、このアプリでは「一覧・3D の見やすさ・操作の短さ」（Inventor では「3D の…」）。重みは同じなので、僅差の幅も同じ 11 点
- 案の定義と採点は `program/tools/ui-proposals/` に比較ごとに置く（例: `2026-10-shortcut.mjs`）
- 案は、今の画面に案の CSS と DOM の組み替えを当てて再現する（`ui-variants.mjs` の冒頭の説明）
- 全案を並べた一覧（`sheet-状態-テーマ.png`）で全体を見る。細部（隠れる・切れる・折り返す・空く）は 1 枚ずつの画像で見る
- 撮る大きさは利用者の PC（1728×1152。既定）と、フル HD・125%（1536×864）。このアプリにはダークの見た目がまだ無いので、テーマは light。
  ダークを入れたら、上位の案はダーク（`--themes light,dark`）でも見る
