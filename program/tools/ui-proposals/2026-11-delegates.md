# Rust 化の段 ①: 窓が Python に任せる歩を減らす（下調べと案。2026-11-12）

版 3.103.0（23586d9）から。決まりは 2026-11-06（画面に関係のない改良。案は 5 案以上・別の係の採点は 1 回）。
採点のファイルは同じ置き場の `2026-11-delegates.json`（採点の欄は空。採点は別の係）。

## 1. 測った数

`python program/tools/delegate-count.py 作業フォルダ --json 出力.json`（19 の答えの元を流して 30 秒）。計 **507 歩**（予算 `delegates_budget.json` の total と同じ）。

形の分け方（RULES）を組み直した。前の分け方は「そのほか」は 6 歩だったが、場面の名前と本文の字を 1 本の正規表現の並びに当てていたので、
置き場の場面の GET・DELETE を「表でない本文」に、「前の版の条件」を「版が読めない」に数える取り違えがあった（表でない本文 95 のうち、
本当に表でない本文は 39）。いまは 層（場面の形か本文の形か）を先に決め、本文は Python の json.loads で読み、欄の型は同じ元の窓が答えた歩の
同じ欄の型と比べて分ける（「そのほか」0）。元ごとの数（予算）は数え方だけで決まるので変わらない。

### 層

| 層 | 歩 | 中身 |
|---|---:|---|
| 本文 | 231 | 送った本文の形（画面は送らない形が大半） |
| 置き場 | 197 | 置き場のファイル・行の形。**1 行が読めないだけで、その道の歩は本文によらず全部任される** |
| 種まき | 45 | 共有にまだ無いマスタ（Python は読むだけで最初の版を置く） |
| 道 | 15 | 道の id の字 |
| OS | 8 | フォルダの道の字（~ユーザー・file: の [ ]・NUL・読めない置き場） |
| 束 | 6 | 設定の束の場面 |
| 口 | 5 | ?engine=python（自己診断・突き合わせの口） |

### 形（上位。Python の答えの状態つき）

| 歩 | 形 | Python の答え |
|---:|---|---|
| 58 | 本文: 字・数の欄に並び・表（Python は str() で repr の字・TypeError） | 2xx 35・4xx 23 |
| 56 | 置き場の行: 項目の型が違う（並び・数・字。Python の str()・比べ方・落ち方） | 2xx 43・4xx 5・5xx 8 |
| 55 | 置き場の行: 版（rev・revision）が Python の int() で読めない | 2xx 35・4xx 20 |
| 39 | 本文: 表でない（並び・字・数・null） | 4xx 11・**5xx 28** |
| 37 | 本文: 読めない JSON・空 | 4xx 37（英語の BadRequest の字） |
| 36 | 種まき: 数える材料のマスタが共有に無い（設備グループ） | 2xx 30・4xx 6 |
| 30 | 本文: NaN・Infinity・1e400・片割れの代用字 | 2xx 9・4xx 21 |
| 29 | 置き場の字: NaN・Infinity・1e400・片割れの代用字 | 2xx 27・4xx 2 |
| 26 | 置き場の字: i64 に入らない整数・大きな id・大きな表示順 | 2xx 17・4xx 8・5xx 1 |
| 15 | 本文: 整数の -0（Python は 0、serde は -0.0） | 2xx 4・4xx 11 |
| 15 | 本文: i64 に入らない整数・1e20・19 桁以上の数の字 | 2xx 10・4xx 5 |
| 12 | 道: id の字（全角・ほかの字の数 10・百分率符号 2） | 2xx 7・4xx 5 |
| 10 | 本文: 版 base_rev・?rev= の字・型（²・小数・並び） | 2xx 9・4xx 1 |
| 10 | 置き場・配った設定: 39 桁を超える並び 4・古さが数でない 6 | 2xx 5・4xx 3・5xx 2 |
| 9 | 種まき: 読むだけで共有に最初の版を置く | 2xx 9 |
| 8 | 本文: 字の欄に小数 | 2xx 6・4xx 2 |
| 8 | 本文: 数の欄の字（全角・ASCII でない空白・制御字・4300 桁） | 2xx 2・4xx 6 |
| 8 | 置き場の字: 整数の -0 | 2xx 8 |
| 8 | OS の道 | 2xx 7・4xx 1 |
| 7 | 置き場の行: 表でない行・null の条件 | 2xx 3・**5xx 4** |
| 6 | 本文: 入れ子 128 段以上 | 2xx 4・4xx 2 |
| 6 | 置き場の字: 入れ子 128 段以上 | 2xx 6 |
| 5 | engine=python | 2xx 4・4xx 1 |
| 4 | 本文: 並び・字の欄に数・真偽 | 4xx 3・5xx 1 |
| 6 | 束（配った設定の形 4・引っ越しの印 1・種まき 1） | — |
| 3 | 道: id が i64 に入らない | 4xx 3 |
| 1 | 本文: 正規表現（Python の re） | 4xx 1 |

### 元ごと

| 答えの元 | 計 | 本文 | 置き場 | 種まき | 道 | OS | 束 | 口 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| equipgroups | 77 | 27 | 13 | 36 | 1 |  |  |  |
| sets | 74 | 21 | 50 | 1 | 2 |  |  |  |
| conversions | 48 | 37 | 10 |  | 1 |  |  |  |
| equip_rows | 44 | 16 | 28 |  |  |  |  |  |
| formats | 44 | 17 | 24 | 1 | 2 |  |  |  |
| presets | 41 | 19 | 18 | 2 | 2 |  |  |  |
| cards | 37 | 24 | 10 | 1 | 2 |  |  |  |
| dashboards | 33 | 17 | 12 | 2 | 2 |  |  |  |
| worklog_write | 24 | 13 | 10 |  | 1 |  |  |  |
| sources_write | 17 | 16 |  |  | 1 |  |  |  |
| release_place | 15 | 6 |  |  |  | 6 |  | 3 |
| settings_write | 13 | 10 | 2 |  | 1 |  |  |  |
| shifts | 10 |  | 10 |  |  |  |  |  |
| access_write | 8 |  | 8 |  |  |  |  |  |
| ui_defaults | 6 | 4 | 2 |  |  |  |  |  |
| settings | 6 |  |  |  |  |  | 6 |  |
| place | 5 | 2 |  | 2 |  |  |  | 1 |
| fs | 5 | 2 |  |  |  | 2 |  | 1 |

## 2. なぜ窓が答えられないか（コードで確かめた所）

窓は値を serde_json の `Value` で持つ。`Value` は NaN・Infinity を持てず、整数の -0 を小数の -0.0 に、u64 を超える整数を小数に読み、
入れ子 128 段で読むのをやめ、表の鍵を字の順に並べ直す（Cargo.toml は preserve_order を入れていない）。Python の json.loads はどれも読む。
窓はこの割れを「割れうる字なら Python に任せる」で避けている。答えを分けている所は 4 つ:

1. **JSON の読み（serde と json.loads）**: `master_rows::unreadable`（master_rows.rs 207 行）・`text_split`（190 行）・`split_number`（124 行）・
   `access::Place::split_file`（access.rs 455 行）。本文・置き場のファイルに NaN・-0・大きな整数・深い入れ子があれば、その道を任せる。
2. **Python の int()**: 窓に int() の写しが 14 ある（`pyfmt::py_int`・`master_rows::py_rev`／`py_int`／`py_int_text`・`card_forms::int_of`・
   `layout_clean::py_int_of`／`int_of`・`bundle::wide_int_text`／`int_of`・`calc::py_int_value`／`py_int_exact`・`cm3::py_int_digits`・
   `worksum::py_int_of`・`pivot::py_int_or`）。読める字の範囲がそれぞれ違うので、ASCII でない字・版の読めない行は任せる
   （`card_forms::int_plain` 150 行・`master_rows::row_readable` 230 行・`access::revision_split` 557 行）。
3. **Python の str()・repr() と型の誤り**: `str()` の写しが 9 か所以上ある（`worksum::py_str` 172 行は並び・表を serde の字 `["x"]` にする。Python は `['x']`）。
   並び・表・小数の欄は `preset_rows::str_plain`（146 行）・`card_forms::scalar`（161 行）・`master_rows::value_plain`（241 行）で任せる。
   Python は名前の並びを repr の字で保存し（conversions の名前 `["名前が並び"]` → 201）、名前が数の行があると一覧が 500（`'<' not supported`）。
4. **本文の読み方が道ごとに違う（Python）**: routes の `get_json` は 50 か所で、`silent=True`（読めない本文は {}）が 25・`silent` 無し（英語の
   `400 Bad Request: The browser (or proxy) sent…`）が 24（ほかの 1 か所は答えの読み）。表でない本文は `.get` で `'list' object has no attribute 'get'`（400）か、
   `routes/common.base_rev` の `TypeError("本文の形が違います")`（**500**）。窓はこの道ごとの違いを写さず任せる（`card_forms::answer` 397〜418 行の
   `blank || !parsed.is_object() → None` など）。
5. **種まき**: 窓は変換表と設備グループには最初の版を置く（`conversions_write::seed` 538 行。3.93.0・3.94.0）が、カード・ダッシュボード・組み方・
   書式・セットの一覧（`share_absent`: card_forms 361 行・dashboards_write 185 行・pivot_presets 323 行・formats_write 249 行・dash_sets 123 行）・
   置き場の状態（`needs_seed`: master_place 813 行）・束の節（`section_broken` の seed: bundle.rs 2183 行 → 設備グループの一覧が数える材料が組めず
   lot.rs 353〜356 行で任せる）は任せる。

**前例**: LotDsp の 9 本（3.98.0）は本文を `pyjson::J`（NaN・大きな整数・送った順を持つ）で読み、1 つの `read_body`（Python `services/lotdsp_rules.read_body`・
窓 `lotdsp.rs` 264 行）で「空・null は {}／UTF-8・JSON・入れ子・表でない は 400 で断る」に決めて、任せる歩を 0 にした。

### 測って見つけた割れ（案 B の落とし穴）

`pyfmt::SPACES`（pyfmt.rs 12 行）は 0x1C〜0x1F を空白に入れている（`str.strip()` と同じ）が、Python 3.13.18 の `int('4\x1c')`・`float('4\x1c')` は
ValueError（`'\x1c'.isspace()` は True。0x85・0xA0・0x2028・0x3000・0x0B・0x0C は int() が読む）。`pynum_cases.json`（477 件）に 0x1C〜0x1F の事例が
無いので試験は通る。`pyfmt::py_int`／`py_float` は SQLite の値の読み（38 か所）に使われているので、窓の答えが Python と割れうる（`'4\x1c'` を 4 と読む）。

## 3. 案（8 案）

方向が偏らないように並べた:

| 案 | 方向 | Python の答え |
|---|---|---|
| A 本文の門を 1 つに | 断る形にそろえる（前例を全部の書く道へ） | 変える（画面が送らない形だけ） |
| B int() の部品を 1 つに | 共通の部品で Python を写す | 変えない |
| C str()・repr() を J で写す | 元ごとに直す（書く道 12 部品の値を J へ） | 変えない（誤りも写す） |
| D 欄の型の表で断る | Python の誤りを直して窓に合わせる（本文） | 変える |
| E 置き場の読めない行・ファイルを名指しで隔てる | Python の誤りを直して窓に合わせる（置き場） | 変える |
| F 種まきの係を窓へ | 係を移す | 変えない |
| G 判定を焼いた表で緩める | 事例の表で確かめて外す | 変えない |
| H 大きな整数を J::Big で持つ | 共通の値の木で Python を写す | 変えない |

### A 本文の門を 1 つに（LotDsp の read_body を全部の書く道へ・Python も同じ言葉で断る）— 減る見込み 112

- 形: 本文の表でない 39・読めない JSON・空 37・NaN・Infinity・1e400・代用字 30・入れ子 6
- 変える所: Python は `lotdsp_rules.read_body` を共通の部品へ出し、routes の `get_json` 50 か所と `common.base_rev` の本文の読みを替える
  （空・null は {}、UTF-8 でない・JSON でない・NaN／Infinity〈parse_constant で断る〉・入れ子・表でない は 400 `{"error", "kind": "body"}`）。中身を字で送る欄
  （`"body": "{…}"`）の json.loads も同じ部品。窓は `lotdsp::rules::read_body` を共通の部品へ出し、router で書く道の前に 1 回当てて、
  `master_rows::unreadable` と各部品の「表でなければ None」を外す
- 落とし穴: silent の道（25 か所）は読めない本文を {} として受けていた → 400 に替わる。画面が空の本文で送る道（/scan・/preset など）は空 → {} のまま。
  画面の本文を全部の ui-eval で通して確かめる要。-0 と大きな整数は画面から来うる（`JSON.stringify(1e20)` は 100000000000000000000）ので門で断らない（B・H）。
  代用字は LotDsp では U+FFFD に替える（`_clean`）が、書く道で替えると置く字が変わる → 書く道は断るか同じ替え方かの決めが要る。
  前の版の窓と新しい Python が混ざった PC では、窓が任せて Python が断る（答えは「断る」で同じ）
- 確かめ方: 仕様（RFC 8259 と決まり）から人が書く事例の表 `tests/fixtures/body_cases.json`（本文の字 → 断る言葉か表）を Python
  （`tests/test_body_reading.py`）と Rust（`cargo test --test body_cases`）が読む。独立の答えは app を import しない json.loads（parse_constant）の小さな道具。
  各 *_parity の 112 歩を steps へ移し、答えと「ファイルが変わらない」を突き合わせる。予算を下げる
- 手間: Python 約 80 行・Rust 約 150 行（部品は lotdsp から移す）・答えの元 15 本の場面の書き換え。1 版

### B int() の部品を 1 つに（14 の写しを 1 つへ・Python の誤りの言葉ごと）— 減る見込み 109（版の行 55 を E に回すと 54）

- 形: 置き場の行の版 55・本文の -0 15・道の id の字 10・base_rev／?rev= の字 10・数の欄の字 8・置き場の -0 8・道の id が i64 に入らない 3
- 変える所: 1 つの部品（`py_int(&str) -> Result<Int, PyErr>`。Int は i64 か桁の字。誤りは Python と同じ字: `invalid literal for int() with base 10: …`・
  `Exceeds the limit (4300 digits)…`・`int() argument must be … not 'dict'`）と値の版（真偽・小数の trunc）。14 か所をこれに替え、
  `route_of` の ASCII だけの id の確かめ・`int_plain`・`row_readable`・`revision_split` を外す。整数の -0 は読む前に 0 に読み替える（Python は int の 0。小数の -0.0 はそのまま）
- 落とし穴: 上の 0x1C〜0x1F の割れ（先に表へ足して直す）。版の読めない行は、Python が GET は 200・書くと英語の ValueError（400）を答える。
  これを写すと誤りの言葉まで写す → E と組むか決めが要る。桁の大きい版を i64 に丸めると比べ方が割れる
- 確かめ方: `pynum_cases.json` を Python 3.13 の int()・float() の全部の Unicode の空白・制御字・数字（Nd）・4300 桁の境・「_」の位置・「²」に広げて焼き直す
  （`tools/pynum-cases.py`）。Rust は `cargo test --test pynum_cases` で 1 つの部品を突き合わせ。各 *_parity の歩を steps へ
- 手間: Rust 約 250 行（部品 100・差し替え 150）・表の道具 50 行。Python は変えない。1 版

### C str()・repr() と型の誤りを pyjson::J で写す（書く道の本文を J で受ける）— 減る見込み 118

- 形: 本文の字・数の欄に並び・表 58・並び・字の欄に数・真偽 4・置き場の行の項目の型 56
- 変える所: 書く道の 12 部品（preset_rows・card_forms・pivot_presets・dash_sets・dashboards_write・formats_write・conversions_write・equipgroups_write・
  sources_write・worklog_write・master_rows〈権限・勤務体系・設備・ロール〉・settings_write）の本文を J で受け、欄の字は `J::py_str`、unhashable・
  `'<' not supported` の TypeError の字も Python と同じに作る。置き場の行の型の違い（名前が数で一覧が 500 など）も Python の落ち方まで写す
- 落とし穴: Python の誤り（repr の字で保存・一覧が 500。前の決め 2「計算・表示の誤りを直す」）まで写す。部品の型の替えが大きい。
  TypeError の言葉は Python の版で変わる（焼いた表で止める要）
- 確かめ方: 事例の表 `pyrepr_cases.json`（Python 3.13 の str()・repr() を入れ子・鍵の順・小数・大きな整数・引用符と逃がしの値で焼く）を窓が読む。各 *_parity の歩を steps へ
- 手間: Rust 1,200〜1,800 行・2〜3 版

### D 欄の型の表で断る（Python が repr の字で置いていた形を、Python も窓も 400 で断る）— 減る見込み 62

- 形: 本文の字・数の欄に並び・表 58・並び・字の欄に数・真偽 4（小数・数は今どおり str() で答える＝G）
- 変える所: 道 → 欄 → 型（字・数・真偽・字の並び・表・任意）の表を `tests/fixtures/body_spec.json` に置き、Python（clean_row 群の str(v) の前）と窓が同じ表を読む。
  違えば 400 `{"error": "「名前」は字で送ってください。", "kind": "body"}`
- 落とし穴: 表を書き間違えると画面の正しい本文を断る（ui-eval の全部で画面の本文を通す要）。断るのは並び・表だけに絞る（数・真偽を字の欄に送る画面があるかを確かめていない）。
  Python の答えが 2xx（保存）から 400 に替わる 35 歩は、前の版で保存された repr の字の行が残る（読むときは E）
- 確かめ方: body_spec.json と事例の表 `body_cases.json`（欄の型 × 値 → 断る言葉）を Python と Rust が読む。独立の答えは表から作る小さな確かめ（app を import しない）。
  *_parity の歩を「窓も Python も断り、ファイルが変わらない」歩へ
- 手間: Python 約 150 行＋表・Rust 約 200 行。1 版

### E 置き場の読めない行・ファイルを名指しで隔てる（3.102.0 の badRows の続き）— 減る見込み 159

- 形: 置き場の行の項目の型 56・版 55・置き場の字の NaN 29・表でない行・null 7・入れ子 6・配った設定の古さが数でない 6
- 変える所: Python の MasterRepository の読みで、版が int() で読めない・名前が字でない・中身が読めない（NaN・入れ子・表でない）行は飛ばして
  badRows（{行, 理由}）に数え、書くときはその行を名指しで断る（503 master_unreadable）。ファイルの字に NaN・Infinity（JSON でない）・入れ子 128 段以上があれば
  ファイルを理由つきで「読めない」。一覧の並べ替えは名前を字で比べる。窓は `Place`・`Store` の読みで同じ決まり（`split_file` を理由つきの読めないに替える）
- 落とし穴: Python の答えが替わる（今は 200 で全部の行を出す → 飛ばした行は出ない）。画面で行が消えて見えるので帯で知らせる（帯は画面の改良の決まりで別に）。
  -0 と大きな整数は正しい JSON なので読む（B・H）。ファイルの NaN がどこから来たかは分からない（今の Python は NaN を送ると "nan" の字で置く）→ 消さない・書き換えない
- 確かめ方: `tests/test_broken_masters.py` に版・型・NaN の行を足す（独立の答えは app を使わない json.loads と行ごとの確かめ）。`bundle_cases.json` に行の形を足す。
  *_parity の置き場の場面を steps へ
- 手間: Python 約 200 行・Rust 約 250 行。1〜2 版

### F 種まきの係を窓へ（読む道でも Store::pull が最初の版を置く）— 減る見込み 46

- 形: 数える材料のマスタが共有に無い 36・読むだけで最初の版 9・束の種まき 1
- 変える所: `share_absent`・`needs_seed` で任せていた所（上の 2 の 5）を `Store::pull`（無ければ錠を取って seed: master_store.rs 922〜970 行）に替える。
  束の節の seed は窓が置いてから組み直す
- 落とし穴: 窓と古い Python（版の混ざった PC）・窓 2 つが同時に置く競い合い（seed は錠の中で共有のファイルの有無を見直すので 1 回だけのはず。place_parity で見る）。
  読む道が共有に書く（錠を待つ）。共有に書けない PC では置けず写しで答える（今の Python と同じかを確かめる）
- 確かめ方: place_parity の種まきの競い合いに窓と窓・窓と Python を足す。equipgroups_write_parity の「共有に X が無い」6 場面・各一覧の「写しだけで最初に読む」を steps へ。
  できたファイル（版 1・updated_by）を突き合わせ
- 手間: Rust 約 150 行・試験の場面の書き換え。1 版

### G 既にある部品で同じ字が出せるのに任せている形を、焼いた表で確かめて外す — 減る見込み 12

- 形: 本文の字の欄に小数 8（`pyfmt::float_repr` と `pyfloat_cases.json` 5,754 件が既にある。Cargo.toml 32 行で float_roundtrip）・u64 に入る大きな整数 4
  （12345678901234567890 ×3・9223372036854775808。serde は u64 で正確に持つが `worksum::py_str` は as_i64 だけを見て小数の字にする）
- 変える所: `preset_rows::str_plain`・`formats_write::str_plain`・`master_rows::value_plain` を「有限の小数・u64 の整数は答える」に、`py_str` は as_u64 も見る
- 落とし穴: -0.0 の小数（Python の str は '-0.0'）・1e16 以上の小数の字。名前の比べ方（normalize_part）が小数の字でも同じか
- 確かめ方: `pyfloat_cases.json` に欄の値としての str() の事例（1.5・0.1・1059438285926254.2・-0.0・1e16・u64 の境）を足す。*_parity の 12 歩を steps へ
- 手間: Rust 約 40 行（ほかの案の版に入る大きさ）

### H 大きな整数を Python と同じに持つ（置き場も本文も J::Big）— 減る見込み 41

- 形: 置き場の字の i64 に入らない整数・大きな id・大きな表示順 26・本文の i64 に入らない整数（u64 の 4 を除く）11・39 桁を超える並び 4
- 変える所: Store の行・本文の数を J で持つ（または読む前に大きな整数だけを印の字にして serde で持ち、書くときに戻す）。表示順・id・版の比べ方は桁で比べる
- 落とし穴: 画面から来うる（表示順に 1e20 → Python は int で持って共有に桁のまま書く → 窓は小数に丸める）。next_id（max+1）が桁で同じか。
  serde の arbitrary_precision は tauri を含む crate 全体の Number を替えるので使わない（jsontree.rs の冒頭と同じ理由）
- 確かめ方: `jsonnum_cases.json`（既にある本文の数の字の表）を置き場のファイルと表示順・id の計算に広げる。*_parity の歩を steps へ
- 手間: Rust 400〜600 行・1〜2 版

## 4. 組み合わせた見込み（形は重ならないように数えた。B と E は版の行 55 が重なる）

| 組み | 減る | 残る |
|---|---:|---:|
| A＋F＋G（Python の答えを直さない物は F・G） | 170 | 337 |
| A＋B＋F＋G | 279 | 228 |
| A＋B＋D＋E＋F＋G | 445 | 62 |
| A＋B＋D＋E＋F＋G＋H | 486 | 21 |

残る 21 は OS の道 8・engine=python 5・束 5（配った設定の形 4・引っ越しの印 1）・道の百分率符号 2・正規表現 1（段 ④ までに別に決める）。

## 5. 決めが要ること（利用者・主のセッション）

1. 画面が送らない本文の形（表でない・NaN・入れ子・字の欄の並び）で、Python の答え（英語の例外・500・repr の字の保存）を「理由を添えて断る」に替えてよいか（A・D）
2. 置き場の読めない行を、Python も飛ばして知らせる形に替えてよいか（E。今は 200 で全部の行を出す・名前が数なら 500）
3. 本文の片割れの代用字を断るか U+FFFD に替えるか（A。LotDsp は替える）
4. 種まきを窓も行う（F。3.101.0 の「⑤ まで Python のまま」の決めは、変換表・設備グループで既に一部替わっている）

## 6. 分からないこと

- 現場でどの形が何回起きているか（`logs/delegations.json` は 3.102.0 から数え始めた。数えるのは道の型で、本文の形は分けていない）
- 画面が字の欄に数・真偽を送る所があるか（D で断る範囲を決める前に、画面の本文を ui-eval の全部で集める要）
- Windows でだけ任せる形（ドライブだけの上のフォルダなど）の数（Linux で数えた。予算の envExtra は 1）
