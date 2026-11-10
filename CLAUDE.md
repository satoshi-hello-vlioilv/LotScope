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
bash program/tools/js-check.sh   # import を使う .js はモジュールとして確かめる（node --check だけでは見逃す）
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

- 上の 8 つは `bash program/tools/check-all.sh 記録のフォルダ [--verify]` で 1 回に流せる（版 3.87.0。始める前に cargo の作業フォルダの古い
  試験の実行ファイル・incremental を消し、空きが 8 GB 未満なら始めない〈空きが尽きると窓の通しの取り込みの段が落ち、コードの割れと見分けにくい〉。
  段ごとの記録と、終了コード・Ran/OK/FAILED・test result のまとめ〈summary.txt〉を残す。--verify は窓の通し〈verify.py update〉も流して作業フォルダを消す）。
  全部で 20〜30 分かかるので、背景で流すときは制限時間を 60 分にする（既定の 10 分で切られると結果が残らない）
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
- Windows の Python に付く SQLite は、URI（`file:…?mode=ro`）を既定で読まない（Linux は読む）。`tests/test_mirror_share.py` が Linux の中で
  Windows と同じ形にして結合・スケジュール・データ元の試験を流す（版 3.57.1。Linux の試験だけでは気づけず、Windows で結合が組めなかった）
- 結果は**終了コードと「Ran … / OK / FAILED」の行で**読む。出力の最後の 1 行だけ（`tail -1` など）で判断しない
  （Python の試験は最後に ResourceWarning が出ることがあり、FAILED の行が隠れる。版 3.5.0 で、これを見落として CI で初めて失敗に気づいた）。
- 失敗が残っているときは push しない。直せない理由があるときは、push せずに利用者へ伝える。

## 改良するときは、別のエージェントが現物を撮って採点し、合格点以上の案に決める

UI/UX に限らず、何かを改良するときは、必ず次の順で設計する。案を文章だけで採点しない。案を作った者が自分の案を採点しない。
利用者に選んでもらうのを待たず、この流れで自律的に 1 案に決めて作る。

1. 今の物を撮り（`ui-check.mjs`）、画像を見て、何が使いにくいか・分かりにくいかを、画像で見えたことを根拠に挙げる
   （画面に出ない改良〈速さ・作り・保存の確かさ など〉は、動かして測った数を根拠にする）
2. 改良案を**最低 5 案**出す。案の方向（何で解くか: 置き場・見せ方・減らし方・流れの変え方 など）を並べ、偏っていないかを確かめる
3. **採点に渡す前に、案を作った者が自分で画像を見て確かめる**（利用者が決めた。2026-10-17）。案ごとに `ui-variants.mjs` で撮った画像
   （1728・1536・1280）を自分で開き、案の狙いどおりに見えるか・再現の崩れ（切れ・重なり・折り返し・空白・届かない操作）が無いかを見て、
   崩れていれば案の定義を直して撮り直す。確かめたこと・直したことは採点のファイルの回の `"self_check"` に書く（無ければ `ui_score.py` が判定しない）。
   作った後（6）も、採点に渡す前に自分で前後の画像を見て確かめる
4. 採点は**別のエージェント**（Agent。案を作っていない者）に頼む。採点する者は、自分で案ごとに画面を撮り（`ui-variants.mjs`）、
   画像の現物を直接見て採点する（画面に出ない改良は、自分で動かして測る）。採点の物差しは下の加点と減点。結果は採点のファイル（JSON）に書き、
   `ui_score.py` で合計と判定を出す
5. 1 位が**合格点以上**なら、1 位に決める（同じ点なら、重い分類の点が高い方）。合格点は**案出しの回によらず一律 80 点**
   （利用者が決めた。2026-10-17。前の「1 回目 95・2 回目 90・3 回目から 80 点」は、採点のファイルに `"rule"` が無い記録だけに使う）。
   採点のファイルには `"rule": "2026-10-17"` を書く
6. 合格点に届かないときは決めない。低い項目と減点を見直し、**案出しからやり直す**（5 案以上。前の回で効いた所は持ち越してよいが、
   新しい案を 3 案以上入れる）。採点はまた別のエージェントが、撮り直した画像で付ける。3 回目でも届かなければ、いちばん高い案に決め、
   足りない点とその理由を利用者に伝える
7. 決めた案を作ったら、作る前と後を `ui-check.mjs` で撮り、別のエージェントが同じ物差しで採点する（採点のファイルの `"built"`）。
   作った後も、合格点以上か、減点が残っていないかを確かめ、届かなければ直して撮り直す。比べた画像は比較のページ（Artifact）で見せる

**画面に関係のない改良（Rust 化・作り・速さ・保存の確かさ など）は、採点を 1 回ずつにする**（利用者が決めた。2026-11-06）:
案は 5 案以上を出し、別のエージェントの採点は **1 回だけ**。合格点に届かなくても案出しをやり直さず、1 位の案に採点の指摘（割れ・落とし穴・足りない所）を
直して入れた形で作る。作った後の採点も **1 回だけ**で、見つかった割れはすべて直し、その形を突き合わせの試験（Python の答えと窓の答えを比べる評価関数）に
足して、試験が通ったら終わりにする（採点し直さない）。採点のファイルには `"rule": "2026-11-06"` を書く。画面の改良（UI/UX）は上の 1〜7 のまま（最大 3 回）

**加点**（100 点満点。4 分類・11 項目を 0〜10 で付け、重みを掛けて足す）

| 分類 | 項目（重み） |
|---|---|
| わかりやすさ（32） | 順序（8: 目と手が使う順に流れる）・チャンク（8: まとまりが一目で分かれる）・階層化（8: 最初に見る物が 1 つ・主と従の差）・視覚化（8: 数・状態を形・色・位置で見せる） |
| 使いやすさ（30） | ステップ数（10: 目的までの手が少ない）・考えさせない（10: 探させない・思い出させない・推測させない）・直感的（10: 見た目どおりに動く・慣れた型） |
| 統一感（20） | 形と色（10: 同じ物は同じ形・同じ色）・言葉と置き場（10: 同じ物は同じ言葉・同じ場所） |
| 美しさ（18） | 整列・余白・釣り合い（9）・色と文字の調子（9: 色数・強弱・読みやすさ） |

**減点**（見つけた所ごとに引く。どの画像のどこで見たかを書く）: 機能が消える・届かない −10、見切れ・はみ出し −5、重なり −5、
想定外の折り返し（1 段のはずが 2 段・ボタンの字が折れる） −3、読みにくい字（11px 未満・コントラスト 4.5 未満の本文） −3、
要らないスクロール −3、状態が見えない −3、前より手が増える −2／手、色だけで区別 −2

```sh
node program/tools/ui-check.mjs 出力フォルダ                                         # 今の画面（作った後の前後比較にも）
node program/tools/ui-variants.mjs 出力フォルダ 案の定義.mjs --states list,grouped,calc   # 案ごとの画面と、全案を並べた一覧
node program/tools/ui-variants.mjs 出力フォルダ 案の定義.mjs --view 1536x864        # フル HD・125% でも
node program/tools/ui-variants.mjs 出力フォルダ 案の定義.mjs --view 1280x720        # 表示の下限（フル HD・150%）でも
python program/tools/ui_score.py 採点.json                                            # 合計（加点−減点）・合格点の判定・次にすること
```

- 道具は Inventor のリポジトリの同じ名前の道具を、このアプリに合わせて移した（開発用のサーバー `ui_server.py` は試験用の品質データ 1500 行で起こす。
  撮る状態は `ui-harness.mjs` の `STATES`: 品質異常・並び・まとめ・列の見出しの札（狭い列・3 段・並べ替え・計算列）・件数の行が混んだ所（3 段のまとめ＋並べ替え＋選んだ値＋色付け＋書式の名前。1 段に収まるか）・表の見せ方・並べ替え（件数の行のタブ）とプリセットの面（保存した見方）・カード・計算の検索前・作業実績・作業実績を日＋直でまとめた所と日・直を押して絞った所・集計表・グラフ（時系列・ヒストグラム・グラフの形の面・組み方の面〈すぐに見るの選び〉）・共有の書式（開いた・設備を選ぶ・当てた）・マスタの置き場の「参照…」の窓・アプリのメニュー・更新履歴・スライサー・タイムライン（発生日の期間を引いた所）・表示の設定・表示列の設定（列を選んだ所・この列の作り方を開いた所・作り方の窓で組み立てた所・式を書く所）・マスタ管理の各タブ（勤務体系・設備グループも。アプリの配布は推奨の札が付いた形と、「推奨にする」を押した直後も）・推奨アップデートの知らせ（品質異常・作業実績）・データ元（カードの並び・仕掛を直す欄）・仕掛のタブ・ダッシュボード（最初の画面。グリッドのパネル・パネルを絞る面・編集・パネルを組む所・組む所の書式・合わせた表を組む所〈表全体・まとまり〉・設備を 3 つ選んだ出し方〈重ねる・並べる〉・別のデータと合わせる〈データの札・全体の札〉・設備グループ→設備の表と小計）・ダッシュボードのスライサー（先月＋L ライン・「設備…」の面）・系列ごとの書式（設備 3 つの折れ線）・合わせた表の行を設備グループの見出しの下で引いている途中・四隅の取っ手・マスタの変換表（管理分類の判定表・セルを直す所と試す）・数字のパネルの書式（表示形式を数値・小数 1 桁・単位を本/日にした所）・保存していない変更の窓・変換表の当てる列を選ぶ面・表示列の窓の列の右クリック・ダッシュボードのパネルとすき間の右クリック・待ちの窓・計算の 3D（ロットを取り込み、汚れ位置を入れた所）・作業実績の設備が 24 台の所・一覧の列を値で絞る面（見出しの下の値で絞る段の設備の ▾）・見出しのタブの名前と並び（右クリックのメニュー）・組む所の条件（値で絞る面）・
  稼働のガント〈直近 4 日〉と ABC 分析・換算係数〈合金 × 調質〉のパネル（dash-ops）・組む所の品種の札（dash-ops-edit）・組み合わせのグラフと系列の形と目盛り（dash-combo）・ダッシュボードのセットのタブと面（dash-set・dash-set-pop。撮った後は dash-set-off が片付ける）・
  組む所の ABC の全設備のリードタイムと出す項目（dash-ops-lead）・ガントの設備を手で並べる所（dash-eorder）・積み上げ横棒（dash-hstack）・組み込みの標準を入れ替えた所と外した所の面（dash-swap-pop・dash-hide-pop。dash-swap-off が片付け、dash の状態も前の案の入れ替え・外しを戻してから始める）。ABC の段（版 3.51.0）: 線 4 本で A〜E のパネルと組む所・線 26 本で A〜AA・品種ごと・同じ線を打った知らせ（dash-ops-ranks・dash-ops-ranks-edit・dash-ops-ranks-many・dash-ops-ranks-each・dash-ops-ranks-err）。
  ダッシュボードのスライサー（版 3.52.0）: 日付の暦（10/1〜10/2 を選んで開き直した所）・「スライサー ▾」の面・パネルのスライサー（仕掛区分で保留を選んだ所）（dash-dslicer-cal・dash-dslicer-cfg・dash-dslicer-panel。dash-dslicer-off が片付ける）。
  データ元の結合とマスタのタブ（版 3.53.0）: 品質データのカードで製造条件マスタを 合金＝材質・調質＝質別 で組んだ所（master-sources-join。`joinDemo`）・
  見出しの「マスタ」のタブで製造条件マスタを開いた所（mst-tab。--from tabs-menu）。
  データ元の一覧とグループ（版 3.54.0）: データ元が多い形〈台帳 8・工程 2・マスタ 2・結合した表 1。見出しに出さない元も〉の 1 行 1 件の表（master-sources-many。`manySources`。
  master-sources-many-off が片付ける）・値で絞るの条件で「で始まらない」に「C?*」を打った所（list-wildcard。list-colfilter の続き）。試験用のマスタは製造条件マスタ（材質＋質別。A3004/H24 は無い・「a5052 」の書き方のゆれ）と設備マスタ（設備名）。
  カードの設計（版 3.55.0）: デザインを直している所で 4 つ目の項目をダブルクリックして項目の面を開いた所・カード全体の見栄え（名前と値の置き方の 8 つの見本の札）・
  組み込みの「フォーム」を当てたカード（card-edit・card-look・card-builtin。card の続き）。
  カードの分けて出す・大きな窓（版 3.56.0）: 組み込みの「タブで分ける」の 2 つ目のタブ・「畳める見出し」・「5 列」（card-tabs・card-fold・card-dense。card の続き）。
  スケジュール（版 3.57.0。ScheduleView を移した）: 設備 L-1 の予定（主の数・区分の札・完了予定と CM3 の時刻）と HOT コイル作業順（主の数・設備の札・抜き出し方・作業の流れの図・釜番の札）
  （sch・sch-hot。--from sch で撮る。作り物の CM3 は `tests/schedule_fixture.py`。仕掛の作り物に釜番の列〈設計_PIT炉番炉順〉を足してある）。
  集計の組み替え（版 3.50.0）: 札を引いている途中（worklog-pivot-dnd）・値の計算の段に ÷1000 を当てた所（worklog-pivot-calc）・重量の小数を 1 桁にした所（worklog-pivot-dec。版 3.50.1）・ウォーターフォール（dash-waterfall）。
  保存先（版 3.49.0）: 全員（共有）に「標準」★・全員の既定に「標準」と「標準ダッシュボード」を置いた ▾ の面と、同じ名前「標準」を全員の既定へ名前を付けて保存する所（dash-save-pop・dash-saveas。dash-save-off が片付ける）。
  試験用の作業実績は設備 12 台で、1 台はファイルが見つからない・1 台は更新が止まった形。ANF は焼鈍炉の形（版 3.47.0: 1 回の作業が 20〜50 時間・作業終了の時刻は年月日時分秒の列だけ・書き忘れ 2 回・いま炉の中）。作業開始（BOX実績_作業開始_日付）が同じ分割ロットを含み、作業終了（BOX実績_作業終了_日付。版 3.46.0）もある。
  勤務体系は全設備共通の交替勤務(1,2,3直) と CR2 だけの 4,5直。設備グループは「ライン別」に CR ライン（CR1・CR2 を選んだ物）と L ライン（名前が L- で始まるルール）。仕掛は 1,200 ロット〈WaveLog の仕掛と同じ列の頭・残仕掛設備ｺｰｽ は「CR1 L-1 LS3」の形・仕掛区分の列〈作り物〉〉。
  ダッシュボードの「前日」は、試験データの日に合わせて 10/2。最初の画面はダッシュボードなので、撮る頁は頁の印 `#screen=list` で一覧から始める〈ui-harness.mjs の newPage〉）
- 画面の部品の評価関数（node で流す。Python の試験 `tests/test_screen_parts.py` からも流れる）: `program/tools/formula-builder-check.mjs`（式ビルダー）・
  `xlsx-check.mjs`（Excel を組む部品）。本物の画面で流す評価関数: `ui-eval-formula.mjs`（この列の作り方の窓: 組み立て→式・当てる・開き直し・入力のラグ）・`ui-eval-sortview.mjs`（並べ替えの外し方・件数の行の札・保存した見方）・`ui-eval-pivot.mjs`（集計表・グラフ・右の表の合計する列・表示の状態の保存）・`ui-eval-pivot-month.mjs`（集計表の月ごと・月で区切る・月の ◀▶・数値ラベル・組み方のプリセットと標準）・`ui-eval-pivot-charts.mjs`（集計表のグラフの 14 形の数＝表の数・形の面・すぐに見るの ID ごとの選びと並び・共通デフォルト）・`ui-eval-formats.mjs`（共有の書式に条件・並べ替え・スライサーで選んだ値を入れて置き、当てる・ほかの設備へ・元に戻す）・`ui-eval-popovers.mjs`（道具の行から開く 5 つの窓が窓の幅 1728〜1100 で画面に収まり、横に送らずに読める）・`ui-eval-equiporder.mjs`（作業実績の設備のタブの並び替え: タブを引く・Ctrl＋Shift＋← →・設備を管理の ⋮⋮・表示しない設備は動かない）・`ui-eval-pathpick.mjs`（フォルダ・ファイルの欄の補助: 参照… の窓・よく使う場所の札・中身の印・置き場の切り替え・届かない所・ファイルだけを出す欄）・`ui-eval-virtual.mjs`（行を見える分＋上下 1 ページだけ描く: 隙間・順・縞・固定・拡大・畳み・カード）・`ui-eval-toolbar.mjs`（件数の行・上の段が 1 段・ボタンの字が折れない・効いている物のタブと面・拡大の面）・`ui-eval-slicer.mjs`（計算列のスライサー・開閉が画面ごと）・`ui-eval-slicer-tools.mjs`（スライサーの操作: （すべて）・1 つだけ選ぶ・0 件を隠す・カードの並べ替え・幅と高さ・字の大きさ・書式に運ぶ形）・
  `ui-eval-timeline.mjs`（タイムライン: 足し口・取っ手を引く・キー・柱・日付の欄・件数がサーバーと合う／スライサーの値の並び・手で並べる／幅 200px で字が切れない／作業実績の 0 件の日・開き直したときのまとめ方）・
  `ui-eval-excel.mjs`（Excel に出力）・`ui-eval-marks.mjs`（色付け〈条件付き書式〉と、ロット番号の横の虫眼鏡）・
  `ui-eval-profile.mjs`（表示の設定の書き出し: 名前が「アプリ名_表示の設定_日付.json」・どの画面から書き出しても同じ・中身の形）・
  `ui-eval-reopen.mjs`（開き直したとき、閉じる前の見え方に戻る: スライサー・一覧の拡大〈画面ごと〉・畳んだまとまり。窓を閉じて開く／作業場所が消えた PC）・
  `ui-eval-worklog-heal.mjs`（作業実績が「読めない」ままにならない: 一瞬見えなかったファイル・作り直した登録を、待つ・マスタ管理を閉じるだけで読む／読み込みを待っている 30 秒は「待っている」、過ぎたら「読めませんでした」）・
  `ui-eval-masterpin.mjs`（全員のマスタの置き場: 配布の画面とマスタの置き場の画面の同じ形の行・ずれた形・届かない形・この PC の置き場を配る・1280 ではみ出さない）・
  `ui-eval-recommend.mjs`（推奨アップデート: 一覧の面のいちばん上の帯・見出しの札「↻ 推奨」・あとで〈4 時間・開き直しても〉・札で戻す・更新して開き直す・出ない形・配布の画面の「推奨にする…／推奨を外す」・1280 で 1 段）・
  `ui-eval-sources.mjs`（データ元: 3 枚のカード・場所はファイル名まで・写した時刻と行の数・カードを押して直す・既定に戻す・足すとタブ・消すとタブが消える・参照先に品質データの場所が出ない・仕掛のタブ）・
  `ui-eval-dashboard.mjs`（ダッシュボード: 最初の画面・3 つの大きさでスクロールしない／パネルからはみ出さない・数字・仕掛区分の横棒・合わせた表の数がサーバーと合う・
  パネルを狭めても収まる・組む所で変えるとその場で描き直る・条件・当てる／元に戻す・見出しを掴んで動かす／重なる所へは置けない・名前を付けて保存して開き直す・消す・合わせた表を組む〈並べ替え・隠す・見せ方・条件〉・計算列をパネルに使う・組む所で開いても表の右が切れない）・
  `ui-eval-dashlink.mjs`（ダッシュボードの版 3.40.0: 設備を 3 つ選ぶと重ねる〈設備ごとの系列〉・並べる・合算・行に置く・別のデータと合わせる〈目標と実績・積み上げ・差・やめる〉・設備グループ→設備の表と小計・設備グループのマスタの設備の札〈実際に出てくる設備〉とルール・画面の印刷とハードコピー〈どの画面も窓の大きさの PNG〉。どの数もサーバーへ同じ組みを問い合わせた答えと突き合わせる）・
  `ui-eval-dashslice.mjs`（ダッシュボードの版 3.41.0: 折れ線の数値ラベルがどの系列にも付く・系列ごとの書式と見本の色・組む所の外枠が送られない・保存の往復と描き直し・合わせた表の行を引いて並べる〈ゴースト・線・上下で同じ決まり・設備グループの見出し〉・四隅の取っ手・スライサー〈数がサーバーと合う・効く／効かないパネル・月を送る・覚える・道具の行の下の帯に 1280 でも 1 段・題が切れない〉）・
  `ui-eval-dashboard-more.mjs`（ダッシュボードの改良〈版 3.39.0〉: パネルを絞る〈値・設備〉と開き直し・組む所で設備を複数選ぶ・足した 8 つの形の印・統計と累計・計算列を組む所で作る・枠と数字の形と合わせた表の見せ方・色の組と系列の色・書式〈日だけ・段の中の数・基準線・縦軸〉・設備をまとめる〈合算・このパネルのグループ・設備グループのマスタ〉。どの数もサーバーへ同じ組みを問い合わせた答えと突き合わせる）・
  `formula-parity.mjs`（計算列の式を画面〈list-formula.js〉で計算する。版 3.59.0 から答えは事例表 `tests/fixtures/formula_cases.json` に焼き付け〈作り直すのは `python program/tools/formula-cases.py`〉、Python〈`tests/test_formula_parity.py`。node があれば表が古くないかも〉と Rust〈`desktop/src/formula.rs` の `cargo test --test formula_cases`〉が node 無しで同じ表と突き合わせる）・
  `ui-eval-colsort.mjs`（版 3.42.0: 列の幅の取っ手〈左端へ動かした列・まとめて見出し行を付けた表の左端の列を引いた量どおりに狭める・拡大〉と、計算列の並べ替え〈▲▼外す・全件で式の答えの順・式を添えて Python が答える・まとめた表・仕掛〉）・
  `conv-plan-check.mjs`（変換表を一覧の列に当てる計画: 列の見つけ方・足す所・まとめて当てる・当て直し。node で流す。`tests/test_screen_parts.py` からも）・
  `ui-eval-narrow.mjs`（1728・1536・1280 の 3 つの大きさで、ボタンの字の折れ・切れ・1 段のはずの段の 2 段・3D の札の重なり・見出し帯の操作に届くか）・
  `num-format-check.mjs`（版 3.43.0。数の表示形式〈Excel の書式コード〉の答え。node で流す。`tests/test_screen_parts.py` からも）・
  `ui-eval-dashfmt.mjs`（パネルの題を変える・カラムの検索・表示形式〈数値・ユーザー定義・見本・知らせ〉・配置と字・合わせた表・保存して開き直す・1280 で切れない）・
  `ui-eval-convio.mjs`（変換表のメモが無い・条件の × が見えて外せる・書き出す→取り込む→標準にする→同梱に戻す）・
  `ui-eval-unsaved.mjs`（保存していない変更の窓: 直していなければ聞かない・マスタの各タブ・変換表の中で表を移る・保存して進む・ダッシュボードの編集・表示列の窓・終了・beforeunload）・
  `ui-eval-convedit.mjs`（版 3.44.0。変換表で値を直した直後に別の欄を押しても、判定表・マスタの面の送り位置が戻らず、押した欄に焦点が移る・比べ方を替えて描き直しても戻る・打ってすぐ「閉じる」が効く・判定表とマスタの面の下に 24px 以上の余白）・
  `ui-eval-convcols.mjs`（変換表の当てる列: データ元ごとの実際の列と値の見本・値で探す・別名を選ぶ〈有るデータの印〉・順・手で足す「!」・一覧ごとに有る方へ当たる・保存）・
  `ui-eval-colmenu.mjs`（表示列の窓: 作った列だけにごみ箱・右クリックのメニュー〈元データは消せず理由・1 つ下へ・隠す・F2・Esc・Alt+↑・複製・まとめて消す〉・Delete キー・画面に収まる）・
  `ui-eval-dashmenu.mjs`（ダッシュボードの右クリック: パネルのメニュー・パネルの画像・表の値をコピー・題・消す／元に戻す・空きが無ければ複製は押せない・パネルをコピーしてほかのダッシュボードへ貼り付け・ここにパネルを足す・Shift+F10・画面に収まる）・
  `ui-eval-colfilter.mjs`（版 3.45.0。一覧の列を値で絞る: 値と件数がサーバーと同じ・チェックで絞った件数・検索して OK・いまの選びに足す・条件と値・右クリック・並べ替え・作業実績と仕掛・計算列・画面に収まる）・
  `ui-eval-dashcalc.mjs`（数の計算と単位: ×10・÷60・読めない式の知らせ・単位を変える・出さない・自動に戻す・表の総計・保存して開き直す）・
  `ui-eval-dashwidth.mjs`（組む所の幅とカラムの欄の幅を引く・切れていたカラム名が見える・開き直し・← →・ダブルクリック・1280 で収まる）・
  `ui-eval-tabs.mjs`（見出しのタブの名前を変える・F2 と Esc・空で元の名前・引いて並べ替え・Ctrl＋Shift＋→・Alt＋数字・元に戻す・1280 で 1 段）・
  `ui-eval-ime.mjs`（版 3.46.0。絞り込み・検索の欄 16 か所で、本物の IME の道〈CDP の変換中・確定〉で日本語を打つ: 変換中に欄が作り直されない・確定した字だけが残る・確定した字で絞れる）・
  `ui-eval-dash8.mjs`（版 3.48.0。組み込みの標準を直して保存→入れ替え→戻す・外す→空の画面→戻す／積み上げ横棒の行の順と合計がサーバーと合う／ガントの日付の札と境の線が現場歴の作業日の区切り／ABC の出す項目・リードタイムの数がサーバーと合う／作業開始の列／設備を手で並べた順がガントの行と答えに効く）・
  `ui-eval-dashsave.mjs`（版 3.49.0。名前を付けて保存: 組み込みと同じ名前は組み込みの代わり・同じ置き場の同じ名前は上書き・新しい名前は 1 つ増える／先の置き場の★に負けるときの「★を外す」／面の置き場の見出し／ABC の占有時間・負荷比・換算本数の計がサーバーと合う／係数の期間〈地点 A〉の換算がサーバーと合う）・
  `ui-eval-labels.mjs`（版 3.47.0。グラフの項目の名前を、余白があるのに「…」で切らない: 12 の形 × パネルの 3 つの大きさと一覧の大きさで、切った字の全部がそこの幅に入らないこと・同じ段の字が重ならない・図からはみ出さない）・
  `pivot-dnd-check.mjs`（版 3.50.0。行・列・値の札を引いて組み替える決まり: 並べ替え・行 ⇔ 列・カラムの札から足す・満ちていれば入れ替え・総当たりで札が増減しない。node で流す。`tests/test_screen_parts.py` からも）・
  `ui-eval-pivotdnd.mjs`（札を本物のマウスで引く: 影・置ける枠・差し込む線・行 ⇔ 列・値の並べ替え・欄へ戻して外す・Alt＋矢印・Delete・合わせた表のまとまり／値の計算の段〈÷1000 の総計がサーバー÷1000・前 → 後・札・読めない式〉／小数の桁〈版 3.50.1: 1桁で表・総計・前 → 後・数値ラベルが系列ごとにその桁・自動で外れる・組む所でも計算の札は畳まず小数の札は次の行〉／⇄ 入れ替え。一覧とダッシュボード）・
  `ui-eval-abcrank.mjs`（版 3.51.0。ABC の段を A・B・C に限らない: 線 4 本で A〜E がサーバーと同じ・段の色が A → 最後へ明るく・札の字の差 4.5 以上・下の段の数の計・パレート図の線の数／品種ごとに A, B, …／前の a・b は A・B・C／組む所で線を足す・直す・外す・同じ線の知らせ・品種ごとの切り替え・組む所に収まる）・
  `ui-eval-dslicer.mjs`（版 3.52.0。ダッシュボードのスライサー: 暦が日付の札の真下・始めと終わりの日で当たる・数がサーバーの日付の範囲〈range〉の答えと同じ・札とパネルの言葉・から〜まで の欄／
  「スライサー ▾」で帯を OFF〈効かない・「スライサー OFF」・この PC だけ〉・出す物・編集中は組みに入る／パネルのスライサー〈札の件数がサーバーと同じ・押すと同じデータのほかのパネルが in の答えと同じ・自分は絞らない・札・開き直し・外す〉・
  「＋ 列の値で絞るパネルを足す…」・帯が 1 段で面が窓に収まる）・
  `ui-eval-xss.mjs`（版 3.52.1。脆弱性の確認: 表示列の設定の揃え・幅・読み替えの色に細工した字を入れて一覧と表示列の窓を開き、JS が動かない・細工した <img> が無い・
  画面の HTML に CSP〈script-src 'self' と印 nonce・object-src 'none'〉が付き、あとから入れた onerror が動かない・アプリの印つき <script> は動く。直した所の試験は `tests/test_security.py` ほか）・
  `ui-eval-join.mjs`（版 3.53.0。データ元の結合: 方式の 4 枚の残る行の数・当たった数がサーバーの「試す」の答えと同じ・方式で言葉が替わる・← →・
  名前の同じ列が無い相手は空の鍵・保存するとカードに 1 行・一覧に持ってきた列と当たった数・外すと消える・保存していない変更の窓／「マスタ」のタブ: 札の段・Alt・
  ロット番号の警告を出さない／1728・1280 ではみ出さない・保存の段が窓の下の縁に着く）・
  `ui-eval-wildcard.mjs`（版 3.54.0。絞り込みの比べ方の段・で始まらない／で終わらない・値の * ?〈読み方と並んだ値のうち当たる数・件数がサーバーと同じ・条件の字〉・値を検索の * ?・
  一覧を検索の * ? と「%」は字そのもの・1280 で OK に届く。* ? の型は Python〈lot_list.like_pattern〉と Rust〈lotlist.rs〉で同じ事例の表 `tests/fixtures/like_cases.json` を突き合わせる）・
  `ui-eval-srclist.mjs`（版 3.54.0。データ元の 1 行 1 件の表: グループの見出し・3 つの大きさで切れない・スイッチ 1 手・見出しのグループのタブの札・⠿ で並べ替え〈見出しの札も同じ順〉・
  右クリックの「グループへ移す」・Alt＋↓・グループの名前を変える・全部出す／出さない・結合した表〈元の行の数・列が増える・作る・元の下に └・消す〉・名前で探す）・
  `ui-eval-pathfit.mjs`（版 3.54.1。「参照…」の窓が欄の位置〈画面の高さの 15〜85%〉と窓の大きさ〈1728・1536×864・1536×830・1536×805・1280〉によらず頁に収まり、欄を覆わない・開いたまま後ろを送っても付いていく・開いた欄の入力欄が潰れていない）・
  `ui-eval-cardform.mjs`（版 3.55.0。カードの設計: 組み込みの標準・直す画面でも項目の位置と大きさが同じ・四隅の取っ手で 1 升・Ctrl＋Z・重なる所へは置けない・
  ダブルクリックで項目の面がカードの外に開き線で結ぶ・名前と字の大きさがその場で効く・名前と値の置き方 8 通り〈見本の札の字が切れない・名前と値の並び・項目に収まる・全部に当てる〉・
  組み合わせた項目の式の値・見栄え・名前を付けて保存〈自分だけ・★標準〉→ 開き直して当たる・消す。3 つの大きさで）・
  `ui-eval-allrows.mjs`（版 3.56.0。一覧とカードで全部の行をページで止めずに送る: 開いた直後から全部の行のぶんのスクロール・いちばん下で最後の行がサーバーと同じ・抜けが無い・
  読んでいない真ん中へ飛ぶ・並べ替え＋検索・カードの ▶ で読んでいない行・まとめた一覧・最初に出るまでの速さと長いタスク。答えは同じ問い合わせをサーバーへ 1 ページで尋ねた並び）・
  `ui-eval-cardform.mjs` には版 3.56.0 の分も（組み込みのタブ・畳める見出し・似た名前・日付・4〜6 列／タブを押す・Ctrl＋PageDown／畳んで開いて覚える／日付の順と間の日数／直すときに＋ タブ・ほかのタブへ移す）・
  `ui-eval-schedule.mjs`（版 3.57.0。スケジュールのタブ: 設備のタブ・主の数と区分の札の数がサーバーと同じ・区分の札〈点検・設備停止・仕掛に無い〉で絞った件数がサーバーと同じ・
  行の区分の色と日付の境・HOT の設備の札と釜番の札で絞る・帯の釜番の字が重ならず 8 割以上の帯に出る・上の段が 1 段ではみ出さない・見出しの「終了」が画面に収まる。3 つの大きさで）・
  `ui-eval-unify.mjs`（版 3.58.0。データ元を 1 つの仕組みに: ナビに参照先・作業実績が無い・見出しのタブは品質・実績〈データ元の名前。変える・空で戻る〉・
  接続の段〈品質の間隔が参照先の項目に入る・要約〉・実績の 5 段〈接続・設備の表・ロット番号の列・結合〉・ロット番号の列〈自動・なし・この列がサーバーの lotSet〉・
  グループを消す・そのほかの接続〈保存・既定に戻す〉・見出しのタブの権限〈✕ を保存・人の段・例外の札・出さないタブが見出しから消える〉・3 つの大きさではみ出さない。
  撮るだけの道具は `shot-unify.mjs 出力フォルダ`）・
  `ui-eval-dasheq.mjs`（版 3.69.0。組む所の「設備」に、期間・条件に作業の無い設備も含めてその元のすべての設備が並び、選べる・件数はパネルの期間・条件の数）・
  `ui-eval-dashbuild.mjs`（版 3.69.0。組んでいるパネルの見出しのボタンは「組んでいます」〈押せない〉・押しても Enter でもパネルの大きさと置き場が変わらない・閉じると「組む」に戻る）・
  `ui-eval-dashperiod.mjs`（版 3.69.0。期間の 今日を含まない n 日・直近 n か月・今年・昨年・直近 n 年: 答えの範囲が今日から別に数えた範囲と同じ・件数がサーバーと同じ・数の欄の単位と上限・
  パネルの添え書き・パネルを絞る面にも並ぶ。期間の範囲は Python と Rust を `pivot_parity`・`dash_parity` でも突き合わせる）・
  `ui-eval-dashstyle.mjs`（版 3.70.0。組む所の上のタブ〈データと数え方・デザイン・書式〉・デザインのタブ〈テーマ・見せ方・スタイル・色の組〉・テーマで 3 つが一緒に替わり食い違わない・
  スタイル 7 つがグラフに効く〈グラデーション・角丸・影・枠だけ〉・色の組 21 と自分の色〈直す・足す・外す〉・見せ方 9 つ〈夜の字のコントラスト 4.5 以上〉・当てたあとも残る。
  保存のときの確かめは `tests/test_dashboard_slice.py`）・
  `ui-eval-dashopscol.mjs`（版 3.73.0。ガント・ABC の作業開始・作業終了の列: 候補に今の列・選ぶと答えの列と棒が替わる・自動に戻す・組む所で作った計算列を選ぶ〈式が問い合わせに載る・同じ棒〉・当てて開き直す・計算列の名前を変える／消すと付いていく・一覧で設備ごとに作った同じ名前の計算列は選んだ設備〈HOT〉の式で数える。選んだ列が空・式が読めないときにほかの列へ移らないことは `ops_parity`。版 3.74.0 から: 設備を 2 つ選ぶ・すべての設備でも、設備ごとにその設備の式で数える〈パネルの calc.equips。サーバーの設備ごとの重ね方は `dash_parity`・`ops_parity`〉）・
  `ui-eval-dashscroll.mjs`（版 3.74.0。組む所で設備の並びを下へ送ってチェック・もう 1 つ・外すをしても、並びと右の欄の送り位置が戻らない・押した設備が見えている）・
  `ui-eval-waterfall.mjs`（ウォーターフォール: 棒の数・計＝サーバーの総計・前の棒の終わりから・増加と減少・足せない値は計なし・計算・はみ出さない・一覧でも）・
  `ui-eval-dashunit.mjs`（版 3.92.0。表の上位 N＋「その他（n 行）」＝総計・値ごとの単位〈重量だけに t・ロット数に t も .0 も無い〉・見出しに式を出さない・
  数字のパネルの 2 つの値〈同じ大きさ・単位と仕切りの間 8px 以上・添え書きを上〉・組む所は確定後と同じ大きさ・④ 置き方の見本・
  待っている間〈進みの線・広いパネルは見出しに秒・狭いパネルの題が切れない・道具の行の「n 枚中 k 枚 済み」・グリッドが下へずれない〉。3 つの大きさで。
  撮るだけの道具は `shot-dashunit.mjs`〈作った後は TPA_DASHUNIT_BUILT=1〉。表の形の決まりは node で流す `pivot-model-check.mjs`〈`tests/test_screen_parts.py` からも〉）。
  値の計算の式の読み方は、画面（num-format.js）とサーバー（services/num_expr.py）で同じ事例の表（`tests/fixtures/num_expr_cases.json`）を突き合わせる（`num-format-check.mjs`・`tests/test_num_expr.py`）。どれも終了コード 0 で OK
- 稼働（ガント）・ABC 分析の作業の区間の評価関数（版 3.47.0）: `python program/tools/ops-bench.py [--json]`
  （本物にありそうな作業開始・作業終了の 9 つの書き方〈日時・日付だけ＋年月日時分秒の 14 桁・14 桁だけ・午前／午後・日時の数・日付＋時刻の列・焼鈍炉の 20〜60 時間・日跨ぎで作業終了の日付が作業開始の日・作業終了が空〉の設備を作り、
  ガントの棒の数・稼働の分・換算係数の元〈作業時間の分かる本数〉が正しい数と合うか、区間を出せない数と理由を答えが持つかを測る。`tests/test_operation.py` からも流れる）
- 釜番 → 日付の評価関数（版 3.51.2）: `tests/test_kama.py`（利用者の渡した kama_to_date・date_to_kama をそのまま答えの元にして、2020〜2030 年の 5 日おき × 全部の釜番で
  式 kamadate が同じ日付〈基準日にいちばん近い前月・当月・翌月〉を出すか・釜番でない値は空か・同梱の変換表「釜番日付」。画面の式とは `tests/test_formula_parity.py`）
- 入れた直後（写しの無い PC）の作業実績の評価関数: `python program/tools/worklog-first-bench.py [--equip 11] [--delay 1.5] [--spread] [--first-wait 秒]`
  （共有から写すのに時間がかかる形で、最初の画面の作業実績のパネルが答えるまで・途中の数を「写しています」と言うか・正しい数に着くまでを測る。
  版 3.92.0 からダッシュボードは最初の写しを 2 秒まで待つ〈routes/dashboard.py の DASH_FIRST_WAIT_SEC・dashboard.rs の FIRST_WAIT〉。
  --delay 4 --spread で最初の答え 12.05 → 2.02 秒・正しい数に着くのは前と同じ）
- 画面に出ない改良（速さ）の評価関数: `python program/tools/dash-bench.py [--rows 20000] [--save 前.json] [--compare 前.json]`
  （ダッシュボードの標準の全パネルを大きな試験データで数え、冷えた時・控えから・ファイルが変わった後を、順に・一度に問い合わせて測る。--compare で前と同じ数かを突き合わせる）
- 一覧の道を Rust へ移した評価関数（版 3.60.0）: `cargo test --test lists_parity`（← `program/tests/lists_oracle.py`。表の候補・ロット番号の列・作業でまとめる・
  日時の読み方・結合の数と行と答えのファイルの名前）・`cargo test --test routes_parity`（← `program/tests/routes_oracle.py`。品質・実績・データ元の道の答えと失敗を
  Python の道と突き合わせる）。速さは `python program/tests/routes_oracle.py --bench 出力.json` → `cd desktop && cargo run --release --example routes_bench -- 出力.json`
- 集計を Rust へ移した評価関数（版 3.61.0）: 一覧の集計表の道（/pivot・カラムの札・作業日と直・空白だけの値）は上の `routes_parity`、ダッシュボードの形
  （いくつかのファイル・設備の段と絞り込み・設備のまとめ・設備グループ・期間・計算列・箱ひげ・区間・失敗・値の計算の事例）は
  `cargo test --test pivot_parity`（← `program/tests/pivot_oracle.py`。Python の `pivot.query_many` と突き合わせる）
- ダッシュボードのパネルを Rust へ移した評価関数（版 3.62.0。1 段目）: `cargo test --test dash_parity`
  （← `program/tests/dashboard_oracle.py`。POST /api/dashboard/query を、数字・グラフ・合わせた表・別のデータを合わせる・設備の分け方〈重ねる・並べる・合算〉・
  設備のまとめ・設備グループの段と見出し・手で並べた順・期間・計算列・箱ひげ・読めない設備・確かめの失敗で Python の道と突き合わせる）。
  速さは `python program/tests/dashboard_oracle.py --bench 出力.json` → `cd desktop && cargo run --release --example dash_bench -- 出力.json`
- 稼働（ガント）・ABC 分析を Rust へ移した評価関数（版 3.63.0。ダッシュボードの 2 段目。スケジュールだけが Python のまま）: `cargo test --test ops_parity`
  （← `program/tests/ops_oracle.py`。`tools/ops-bench.py` の 9 つの書き方の設備に、区間を出せない理由のすべて・分割ロット・棒の上限を超える設備・
  作業開始／作業終了の列が無い設備・読めない設備・品種と量の列・勤務体系の違う設備を足し、ガントと ABC〈品種・量・線・品種ごと・リードタイム・基準の期間・
  計算列・条件〉の答えと失敗、勤務体系が無い段を Python の道と突き合わせる。速さは上の dash_bench に入っている）
- 権限の判定と書き込みの門番を Rust へ移した評価関数（版 3.65.0。順 5 の 1 段目 a）: `cargo test --test access_parity`
  （← `program/tests/access_oracle.py`。行の当たり方・区分と段・タブの決まりと例外・切断の指示・置き場〈共有・壊れた共有と写し・写しだけ・手元だけ・BOM・
  読めない写し〉の 41 の組 × 25 の道で、me と門番の答えを Python の道と突き合わせる。切断の指示の読み方〈時刻の書き方・BOM・NaN・冷却の境・鍵の形〉の
  69 組は `access_oracle.py --revocations`。百分率符号で書いた道も門番を抜けないことは router.rs の試験）。Python 側は `tests/test_access.py` の ShellMe（窓が載せた me を使う・
  見出しが無い／壊れていれば Python が決めて門番も見る）。版 3.65.1 から一覧・ダッシュボードの出さないタブと勤務体系を直せるかも窓の me から（`lists_take_hidden_tabs_from_the_shell_me`・本物の道を通す `lot::tests::the_real_paths_use_the_shell_me_for_tabs_and_shifts`）
- マスタの書く係を Rust へ写した評価関数（版 3.67.0。順 5 の 2 段目 a）: `cargo test --test masters_parity`（← `program/tests/masters_oracle.py`。25 の場面で
  Python の MasterStore と答え・断る言葉・できたファイルを突き合わせる・同じ PC で Python〈係 py〉と窓〈係 rs〉が同時に書いても保存が消えない・
  値を変えずに書けない数と版の端は断る・2 つの置き場の Store と panic で錠の置き場が混ざらない・SHARED_ALWAYS が Python と同じ）
- 権限のマスタを書く道を窓へ移した評価関数（版 3.68.0。順 5 の 2 段目 b）: `cargo test --test access_write_parity`（← `program/tests/access_write_oracle.py`。
  8 場面・58 歩で POST／PUT／DELETE /api/masters/access と PUT /api/masters/tabaccess の答え・断る言葉・できたファイルを Python の道と突き合わせる）・
  `lot::tests::the_window_writes_access_masters`（本物の道・門番・書いたら権限の覚えを捨てる・Python に任せる形）
- 使用の履歴・心拍・画面の設定の控えを窓へ移した評価関数（版 3.71.0。順 5 の 3 段目 a）: `cargo test --test presence_parity`（← `program/tests/presence_oracle.py`。
  9 場面・100 歩を超える心拍と道で、1 歩ごとに時計を差し替えて答えとできたファイル〈中身・字下げ・改行〉を Python の道と突き合わせる）・
  `lot::tests::the_window_answers_the_heartbeat_and_presence`（止まった中身で 503・裏の糸が書く・使い終わり・Python に任せる形）・
  `tests/test_access.py` の `test_heartbeat_does_not_write_when_the_window_serves_presence`（窓が名乗ると Python の心拍は書かない）
- 転写距離・ピッチ計算を窓へ移した評価関数（版 3.72.0。順 6 の 1 段目）: `cargo test --test calc_parity`（← `program/tests/calc_oracle.py`。3 場面 × 約 240 の本文で、
  窓が答えた物は状態・本文〈0 と 0.0 も〉が Python の道と同じ・答えなかった物は Python に任せてよい形。小数のオフの厚さの乱数で 2 乗の pow の違いも見る）・
  `lot::tests::the_window_answers_the_calculation`
- 数の読み方と勤務体系の道を窓へ移した評価関数（版 3.75.0。7 段目の手本）: `cargo test --test pynum_cases`（← `tests/fixtures/pynum_cases.json`。Python 3.13 の int()・float()・\d・shifts.hm が読む字〈68 系統の数字・全角・下線・nan・inf・1e400・「²」・時刻〉を窓の pyfmt・worksum::hm と突き合わせる。表を作り直すのは `python program/tools/pynum-cases.py`、古い表は `tests/test_pynum_cases.py` が止める）・`cargo test --test shifts_parity`（← `program/tests/shifts_oracle.py`。5 場面・49 歩で GET／POST／PUT／DELETE /api/masters/shifts の答え・断る言葉・できたファイルを Python の道と突き合わせる。書く型は窓の `master_rows.rs`〈Python の SPECS・_create／_update／_delete と同じ 1 つの型。権限の組もここ〉）
- 権限の読む 2 本を窓へ移した評価関数（版 3.76.0）: `cargo test --test access_parity`（← `program/tests/access_oracle.py` の reads。GET /api/access/me・/api/masters/access の窓の答えを、41 の組で Python が自分で決めた me の答えと突き合わせる）・`lot::tests::the_window_writes_access_masters`（main.rs が渡す Lot::access_read: 版が分からない・中身が答えないときは Python・書いた後の読み直し）
- 設備・ロールのマスタを窓へ移した評価関数（版 3.77.0）: `cargo test --test equip_rows_parity`（← `program/tests/equip_rows_oracle.py`。10 場面・74 歩の答えとファイル、Python に任せる 40 歩〈本文と置き場の行〉）・`cargo test --test jsonnum_cases`（← `tests/fixtures/jsonnum_cases.json`。書く道の本文の数の字〈整数の -0・i64 に入らない整数〉を窓が Python と同じに読むか任せるか。表を作り直すのは `python program/tools/jsonnum-cases.py`、古い表は `tests/test_jsonnum_cases.py`）・`tests/test_body_reading.py`（書く道の本文と版は Content-Type によらず読む・表でない本文では書かない・必須の null）・`lot::tests::the_window_writes_equipment_and_rolls`
- 表示の初期設定を窓へ移した評価関数（版 3.78.0）: `cargo test --test ui_defaults_parity`（← `program/tests/ui_defaults_oracle.py`。8 場面・35 歩の答えとファイル〈開発者でない・切断中・表でない本文・2 MB の境・手元だけ・写しから・同じ名前の行・保存中の錠〉、Python に任せる 6 歩）・`tests/test_body_reading.py` の UiDefaults（表でない本文で消さない・切断中は置けない）・`lot::tests::the_window_answers_ui_defaults`
- ダッシュボードのセットと保存の行の部品を窓へ移した評価関数（版 3.79.0）: `cargo test --test sets_parity`（← `program/tests/sets_oracle.py`。27 場面・97 歩の答えとファイル〈範囲 3 つ × 書ける／書けない・切断中・★標準の付け替え・同じ組の名前・版・手元だけ・写しから・保存中の錠〉、Python に任せる 74 歩〈本文の小数・並び・表の項目・NaN の中身・入れ子 128 段以上・置き場のファイルの生の NaN・-0・大きな整数・対の無い代用字・読めない版の番号・写しだけの最初の読み・置き場の行の形・ASCII でない id〉）・`lot::tests::the_window_answers_dashboard_sets`・`cargo test --test name_key_cases`（← `program/tests/name_key_oracle.py`。名前の比べ方〈NFKC・大文字。窓は `access::py_key` の 1 か所〉が全部の字と並びの例で Python 3.13 と同じ答えか・Python でまだ割り当てのない字の表〈そのまま残す字〉が過不足なく合うか。表を焼き直すのは `python program/tools/key-split-table.py > desktop/src/key_split_table.rs`）。部品は `desktop/src/preset_rows.rs`（組み方・カード・ダッシュボードも同じ行の形）
- 小数の書き方・共有の書式・カードの設計を窓へ移した評価関数（版 3.80.0）: `cargo test --test pyfloat_cases`（← `tests/fixtures/pyfloat_cases.json`。Python 3.13 の float の repr と json.dumps の 5,754 の数〈丁度まん中の値は偶数へ〉。表を作り直すのは `python program/tools/pyfloat-cases.py`、古い表は `tests/test_pyfloat_cases.py`）・`cargo test --test formats_parity`（← `program/tests/formats_oracle.py`。16 場面・72 歩の答えとファイル〈中身の字は送った順の json.dumps。窓は `desktop/src/jsontree.rs` の木で読み書きする〉、Python に任せる 44 歩）・`cargo test --test cards_parity`（← `program/tests/cards_oracle.py`。12 場面・103 歩〈方眼の数の int()〈先頭の 0 の長い字も〉・タブごとの重なり・日付のまとまり・64KB・範囲と★〉、Python に任せる 37 歩〈全角の数の字・並びの項目など〉）・`lot::tests::the_window_answers_formats_and_card_forms`
- 組み方のプリセットとダッシュボードの中身の確かめを窓へ移した評価関数（版 3.81.0）: `cargo test --test presets_parity`（← `program/tests/presets_oracle.py`。17 場面の答えとファイル〈組み方の中身・すぐに見るの並び・★標準・組み込みの組み方〉、Python に任せる歩〈ASCII でない id・長い chartAt の字・並びの項目など〉。組み込みの組み方は Python から焼いた `desktop/src/pivot_builtins.json`〈焼くのは `python program/tools/pivot-builtins.py`、古い表は `tests/test_pivot_builtins.py`〉）・`cargo test --test layout_cases`（← `tests/fixtures/layout_cases.json`。ダッシュボードの clean_layout・clean_hide_body・condition_of の 88 件〈送った順の色・系列・id の付け直し・数の字・Python が落ちる形は任せる〉。焼くのは `python program/tools/layout-cases.py`、古い表は `tests/test_layout_cases.py`）
- ダッシュボードの 5 本の道を窓へ移した評価関数（版 3.82.0）: `cargo test --test dashboards_parity`（← `program/tests/dashboards_oracle.py`。22 場面・114 歩の答えとファイル〈書く人と範囲・★標準・組み込みと同じ名前の入れ替え〈確かめを 2〜3 回通す〉・組み込みを外す／戻す・前の版の条件のマスタ・切断中・手元だけ・写しから・錠〉、Python に任せる歩〈Python が落ちる置き場・まだ無いファイルの最初の読み・読めない本文〉。組み込みは Python から焼いた `desktop/src/dash_builtins.json`〈焼くのは `python program/tools/dash-builtins.py`、古い表は `tests/test_dash_builtins.py`〉）
- 問い合わせと保存のパネルの確かめを 1 つにした評価関数（版 3.83.0）: `cargo test --test dash_parity`（← `program/tests/dashboard_oracle.py`。本文は送った字〈raw〉のまま送り、送った順に効く計算列の式の上限も突き合わせる）・`layout_cases`・`dashboards_parity`。確かめは `desktop/src/layout_clean.rs` の clean_panel の 1 か所（dashboard.rs は呼ぶだけ）
- 設定の束を窓が組む評価関数（版 3.84.0）: `cargo test --test bundle_parity`（← `program/tests/settings_oracle.py`。場面ごとのフォルダから窓〈`desktop/src/bundle.rs`〉が組んだ束を Python の GET /api/lotlist/settings と 1 字ずつ突き合わせる〈conversions.rev は除く〉・Python に任せる形・引っ越しの印をたどる係は窓）・`tests/test_shell_follows.py`・`tests/test_bundle_tables.py`（焼いた決まりの表 `desktop/src/bundle_tables.json` が古くないか。焼くのは `python program/tools/bundle-tables.py`）
- 画面と最初の画面の読む道を窓が答える評価関数（版 3.85.0）: `cargo test --test page_parity`（← `program/tests/settings_oracle.py` の reads。束の場面と同じフォルダで、Python が居ない形の窓の答え〈GET / の画面の字と見出し〈印は @NONCE@〉・/api/config・/api/dashboard/sources・/api/dashboard/equip-tree・版 3.87.0 から /api/sources〈写しの様子の時刻は比べない。窓は `desktop/src/sources_list.rs`〉〉を Python の答えと突き合わせる。Python が落ちる形・窓が同じに読めない形は Python に任せる。焼いた決まりは `bundle_tables.json`〈期間・巻出しの既定・LotDsp の学び・指紋の拡張子〉）
- 参照先の項目を窓が読み書きする評価関数（版 3.89.0）: `cargo test --test settings_write_parity`（← `program/tests/settings_write_oracle.py`。10 場面で PUT /api/settings/<key> の答え・断る言葉・できたファイルを Python の道と突き合わせる〈値の読み方・行の版・空で消す・同じ項目の最初の行・本文の形・門番〉、Python に任せる歩〈ブラウザの欄・表でない本文・並びの値・NaN・数字でない版・百分率符号〉）・GET /api/settings は上の `page_parity`（`settings_oracle.py` の reads）・`lot::tests::the_window_answers_path_settings`
- データ元の書く道を窓が答える評価関数（版 3.90.0）: `cargo test --test sources_write_parity`（← `program/tests/sources_write_oracle.py`。7 場面〈足す・直す・その場で変える・消す・並べ替え・グループ・接続の設定・門番・手元だけ・錠〉で本物の窓の道〈Lot〉の答え・断る言葉・できたファイルを Python の道と突き合わせる。足す元のキーは同じ並びに差し替える。Python に任せる歩〈並びの値・表でない本文・NaN・keys が表・cols が数・百分率符号〉）
- 作業実績の登録を窓が答える評価関数（版 3.91.0）: `cargo test --test worklog_write_parity`（← `program/tests/worklog_write_oracle.py`。15 場面〈見る・探し直す・並べ替え・直す・結び直す・消す・フォルダに届かない・決まりの誤り・同じファイル名の行・39 桁を超える並び・配った設定の古さが数でない・門番・手元だけ・写しから・錠・登録が無い〉で本物の窓の道〈Lot〉の答え・断る言葉・できたファイルを Python の道と突き合わせる。実績のフォルダは共にし、更新時刻は os.utime・古さの時刻と足すキーは差し替え、ファイルID は same_fid でそろえる。ファイルID の比べ方の事例の表は `tests/fixtures/fid_cases.json`〈Python と窓が同じ表を読む〉。Python に任せる歩〈空・読めない・表でない本文・並びの値・NaN・大きな id・「²」の版〉）
- 変換表を窓が答える評価関数（版 3.93.0）: `cargo test --test conversions_write_parity`（← `program/tests/conversions_oracle.py`。43 場面〈一覧・書き出し 2 種・足す〈名前の重なり・入力 0 と 9 個・判定の行の上限・比べ方の各種・範囲の端の字・出す値の式〉・直す〈来た物だけ・版の食い違い〉・標準に戻す〈プリセットにある／無い／行が無い・取り込んだ標準〉・消す・取り込む〈足す・置き換え・ファイルの中の同じ名前・形の誤り・asDefault の真偽の字・同じ名前の行の後ろ勝ち〉・標準を決める・門番・手元だけ・写しから・錠・取り込みの 2 回目だけ錠・共有にまだ無い〈道ごとに置かれるファイル〉・本文の形〉で本物の窓の道〈Lot〉の答え・断る言葉・できたファイルを Python の道と突き合わせる。Python に任せる歩〈空・読めない本文・道の外で落ちる本文・並びや表の値・unhashable・2^63 以上の数・正規表現の読めない式・入れ子の深い式〈not の重ね〉・窓が同じに読めない置き場の行〉）・`lot::tests::the_window_answers_conversions`
- 設備グループを窓が答える評価関数（版 3.94.0）: `cargo test --test equipgroups_write_parity`（← `program/tests/equipgroups_oracle.py`。41 場面〈一覧・足す〈名前の重なり〈normalize_part〉・まとめ方の既定・設備の字と並び・ルールの切り方・表示順の字〉・直す〈来た物だけ・設備／ルール／除く設備の一部だけ〈版 3.94.0 で Python の部分 PUT の不具合を直した形〉・版の食い違い・まとめ方が空の行〉・消す・門番・手元だけ・写しから・錠・まだ空・共有にまだ無い〈道ごとに置かれるファイル〉・数える材料〈作業実績・設備マスタ・データ元〉が共有に無い〈窓は任せ、置かない〉・スケジュールの元がある〈CM3 に届く／届かない。一覧は任せ、断る歩は窓が答える〉・本文の形〉で本物の窓の道〈Lot〉の答え〈選べる設備の出どころと件数〈データ元の設備の列をダッシュボードの数え方で〉も〉・断る言葉・できたファイルを Python の道と突き合わせる。Python に任せる歩〈空・読めない本文・道の外で落ちる本文・並びや表の値・unhashable・正規表現のルール〈置き場の行も〉・i64 を超える表示順・窓が同じに読めない置き場の行〉）・`lot::tests::the_window_answers_equipment_groups`。選べる設備は `dashboard::equipment_seen` の 1 か所（設備の木も）
- 更新と配布の流れを窓が答える評価関数（版 3.95.0）: `cargo test --test release_parity`（← `program/tests/release_place_oracle.py`。配布の置き場の 3 本〈POST /api/release/place/check・move・GET progress〉を 6 場面〈確かめる〈名前・上のフォルダ・同じ所と中〈resolve＋normcase。記号リンク・..〉・既にある・空でない・写す量・本文の字と copy の読み方〉・写す〈裏の糸・進み具合・写した後は既に置き場・忙しい〉・門番〈版を置けない・参照先を書けない・切断〉・権限を読めない・2 つの PC が同じ置き場を写す・読めないファイル〈Linux〉〉で、答え・断る言葉・写し終えた後の進み具合・終わった後のフォルダの中身〈更新時刻・権限も〉を Python の道と突き合わせる。Python に任せる歩〈?engine=python・並びや表の値・NaN・表でない本文・Path.exists が落ちる形・NUL の道〉。作った後の採点の割れ〈根の上のフォルダ・一時フォルダを作れない・名前付きパイプ・名乗り 4 人〉も場面に。`joined_paths_match_python` は Path(上)/名前 の字〈POSIX と Windows の決まり〉と OSError の str の事例の表）・GET /api/update/settings は上の `page_parity`・`lot::tests::the_window_answers_update_and_release_place`。写す係は窓の 1 つ（SERVES の release。Python は move で写さない: `tests/test_release_place.py`）
- 検索の索引とカラムの札を覚える評価関数（版 3.66.0）: `cargo test --test search_index`（語ごとに索引と今の形〈全列に CStr LIKE〉で当たる行を突き合わせる・
  * ? とつなぎの字・ビュー・WITHOUT ROWID は今の形・書き換えた後に作り直す〈時刻を戻した書き換えも〉・壊れた索引は作り直す・1 つの接続で 2 つの表・札は覚える／書き換えで数え直す／計算列は覚えない）
- Python を Rust へ移す順の評価関数（版 3.58.1）: `python program/tools/rust-port-bench.py [--calibrate 20000] [--json 出力.json] [--static-only]`
  （部品ごとの行・試験・依存の段・要る crate の棚卸しと、全部の道の速さを SQLite の中・JSON・Python の手に分けて測る。--calibrate は既に Rust にある一覧で
  見積もりを Rust の実際の時間〈`cargo build --release --example lotbench`〉と突き合わせる。表と順は `program/docs/RUST_PORT_PLAN.md`）
- 採点のファイルの形は `ui_score.py` の冒頭。案ごとに「画像で見えたこと」（`"seen"`）と、だれが撮って採点したか（`"evaluator"`）を必ず書く。
  2026-10 までのファイルは旧い決まり（7 基準・80 点・7 案）の記録で、判定はしない
- 案の定義と採点は `program/tools/ui-proposals/` に比較ごとに置く（例: `2026-10-shortcut.mjs`）
- 案は、今の画面に案の CSS と DOM の組み替えを当てて再現する（`ui-variants.mjs` の冒頭の説明）
- 全案を並べた一覧（`sheet-状態-テーマ.png`）で全体を見る。細部（隠れる・切れる・折り返す・空く）は 1 枚ずつの画像で見る
- 撮る大きさは利用者の PC（1728×1152。既定）と、フル HD・125%（1536×864）と、表示の下限のフル HD・150%（1280×720）。
  下限では、見切れ・はみ出し・重なり・1 段のはずの段の折り返しが無いことを確かめる（`ui-eval-narrow.mjs`）。このアプリにはダークの見た目がまだ無いので、テーマは light。
  ダークを入れたら、上位の案はダーク（`--themes light,dark`）でも見る
