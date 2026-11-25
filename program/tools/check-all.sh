#!/usr/bin/env bash
# push 前の確かめ一式（CLAUDE.md の「push 前の確かめ」と同じ物）を 1 つずつ流し、段ごとの記録と最後のまとめを出す。
#
#   bash program/tools/check-all.sh [記録のフォルダ] [--verify] [--ui] [--ui-only] [--keep-free GB]
#
# - 始める前に cargo の作業フォルダの古い物（2 時間より前の試験の実行ファイル・incremental・examples）を消し、空きを確かめる。
#   空きが --keep-free（既定 8 GB）より少なければ、確かめを始めずに止める（窓の通しは版を何度も写すので、空きが尽きると
#   取り込みの段が「No space left on device」で落ち、コードの割れと見分けにくい）。
# - 段ごとの記録は 記録のフォルダ/NN-名前.log。結果は終了コードと「Ran … / OK / FAILED」「test result」の行で読む（最後の 1 行で読まない）。
# - 段 ci-shape（版 3.116.0）は、焼いた本の試験を CI に似せた形（root でない利用者・Python 無し・名前を引けない）で流す。
# - --verify は窓の通し（desktop/bundle/verify.py の update と local〈Python の無い PC。版 3.111.0〉。起動・更新・配布の流れを変えたとき）も流し、終わったら作業フォルダを消す。
# - --ui（版 3.118.3。任意の段）は撮る・採点する道具を窓の開発用サーバー（examples/ui_serve）を相手に流す: ui_serve を組み
#   （cargo test は test = true の example を組んでも、そのままの examples/ui_serve を作らない。始めに examples も消す）、
#   ui-check の list・dash（--states）・ui-eval-xss・ui-eval-narrow・ui-eval-dashwait。段の計の秒をまとめに出す（上限の目安 15 分）。
#   --ui-only はほかの段を流さず --ui の段だけ（道具を直したとき。--verify とは一緒に付けられない）。
# - どれか 1 つでも落ちれば終了コード 1（push しない）。
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT=""
VERIFY=0
UI=0
ONLY_UI=0
KEEP=8
while [ $# -gt 0 ]; do
  case "$1" in
    --verify) VERIFY=1 ;;
    --ui) UI=1 ;;
    --ui-only) UI=1; ONLY_UI=1 ;;
    --keep-free) KEEP="$2"; shift ;;
    *) OUT="$1" ;;
  esac
  shift
done
OUT="${OUT:-${TMPDIR:-/tmp}/check-all}"
# --ui-only はほかの段を流さないので、--verify と一緒には付けない（黙って窓の通しを飛ばさない。版 3.118.3 の作った後の採点の割れ 10）
if [ $ONLY_UI -eq 1 ] && [ $VERIFY -eq 1 ]; then
  echo "--ui-only と --verify は一緒に付けられません（--ui-only は ui の段だけ流します）。全部の段と ui の段なら --verify --ui を付けてください。" >&2
  exit 2
fi
mkdir -p "$OUT"
rm -f "$OUT"/*.log "$OUT/summary.txt"
cd "$ROOT" || exit 2
# CARGO_TARGET_DIR が相対の道なら、最上位を基準の絶対の道にして渡す（cargo は desktop/ を基準に、片付けと道具〈ui-harness.mjs〉は最上位を基準に
# 読むので、相対のままだと別の所を見る。版 3.118.3 の作った後の採点の割れ 10）
if [ -n "${CARGO_TARGET_DIR:-}" ]; then
  case "$CARGO_TARGET_DIR" in
    /*) ;;
    *) CARGO_TARGET_DIR="$ROOT/$CARGO_TARGET_DIR" ;;
  esac
  export CARGO_TARGET_DIR
fi

free_gb() { df -Pk "$ROOT" | awk 'NR==2 {print int($4 / 1024 / 1024)}'; }

# 1) 古い作り物を片付ける（今の試験の実行ファイルは cargo が作り直す。rlib などの依存は消さない＝作り直しは軽い）
# cargo の作業フォルダを替えている（CARGO_TARGET_DIR。worktree で主の作業フォルダを共にする）ときは、そこを片付ける（版 3.116.0。前は
# worktree の中の無いフォルダを見て、何も片付けなかった）
T="${CARGO_TARGET_DIR:-$ROOT/desktop/target}/debug"
if [ -d "$T" ]; then
  find "$T/deps" -maxdepth 1 -type f -perm -u+x ! -name "*.*" -mmin +120 -delete 2>/dev/null
  rm -rf "$T/incremental" "$T/examples"
fi
echo "空き: $(free_gb) GB（必要 ${KEEP} GB）" | tee "$OUT/summary.txt"
if [ "$(free_gb)" -lt "$KEEP" ]; then
  echo "空きが足りないので確かめを始めません。desktop/target を消す（cargo clean）か、作業フォルダを片付けてください。" | tee -a "$OUT/summary.txt"
  exit 2
fi

N=0
FAIL=0
NOTE=""
LAST_RC=0
step() {
  N=$((N + 1))
  local name="$1"; shift
  local log
  log="$OUT/$(printf '%02d' "$N")-$name.log"
  local t0=$SECONDS
  "$@" >"$log" 2>&1
  local rc=$?
  # 試験の数と失敗の行（Python の Ran/OK/FAILED・cargo の test result）。最後の 1 行だけで読まない
  local ran fails
  ran=$(grep -E "^Ran [0-9]+ tests" "$log" | tr '\n' ' ')
  fails=$(grep -E "^FAILED|test result: FAILED|^error(\[|:)" "$log" | head -3 | tr '\n' ' ')
  LAST_RC=$rc
  # ci-shape の終了コード 3 は「1 つの形も流せなかった」（root でない PC）。落ちた段にはしないが、まとめに出す（下の NOTE）
  if [ "$name" = ci-shape ] && [ $rc -eq 3 ]; then
    NOTE="ci-shape は流せませんでした（root でない PC。CI に似せた形の確かめはしていません）"
  elif [ $rc -ne 0 ]; then
    FAIL=1
  fi
  printf '%-14s 終了コード %-3s %4ss %s %s\n' "$name" "$rc" "$((SECONDS - t0))" "$ran" "$fails" | tee -a "$OUT/summary.txt"
}

if [ $ONLY_UI -eq 0 ]; then
# 2) 型・構文
step js-check bash program/tools/js-check.sh
step compileall python -m compileall -q program
step cargo-build bash -c "cd desktop && cargo build --locked"
# 窓に遅くする口（desktop/src/slow.rs。feature testing の下だけ）が入っていない: exe の中に口の印の字が無い・組んだ記録の features に testing が無い
# （版 3.118.3 の作った後の採点の割れ 2。配る release の exe は Windows の CI〈desktop.yml の windows-exe〉が同じ道具で見る）
step no-slow-hook bash -c "(cd desktop && cargo build --locked --bin LotScope --message-format=json > \"$OUT/cargo-build.json\") && python program/tools/slow-hook-check.py --exe \"$T/LotScope\" --build-json \"$OUT/cargo-build.json\""
# 3) lint
# ruff は手元と CI で同じ版（CLAUDE.md: 0.15.20）。PATH に別の版があっても、決めた版を先に使う
RUFF="${RUFF:-$(for r in /usr/local/bin/ruff "$(command -v ruff)"; do [ -x "$r" ] && "$r" --version | grep -q "0.15.20" && echo "$r" && break; done)}"
RUFF="${RUFF:-ruff}"
echo "ruff: $RUFF（$($RUFF --version 2>/dev/null)）" | tee -a "$OUT/summary.txt"
step ruff "$RUFF" check program
step fmt-clippy bash -c "cd desktop && cargo fmt --check && cargo clippy --all-targets -- -D warnings"
# 4) 試験
step py-tests bash -c "cd program && python -m unittest discover -s tests -t ."
step bundle-tests python -m unittest discover -s desktop/bundle -t desktop/bundle
# --no-fail-fast: 落ちた本で止めず、全部の本を流す（CI と同じ。落ちた本があれば終了コードは 0 でない）
# 表だけの形（TPA_NO_PYTHON=1。CLAUDE.md の「push 前の確かめ」の命令そのまま。版 3.119.0〈段 ⑤〉で Python と比べる形は答え合わせ役と一緒に消した）
step cargo-test bash -c "cd desktop && TPA_NO_PYTHON=1 cargo test --locked --no-fail-fast"
# 4a) Linux の上の Windows の形（版 3.117.3。TPA_BAKE_OS=nt）: 札が table の本（books.json の windows）を、Windows の CI と同じ読み方
#     （nt の表・札・Windows で作れない物の数え方）で表だけの形で流す。Windows の CI の 1 回目で初めて落ちる形（作れない物の数え違いなど）を先に見つける。
#     答えは Linux の窓の答えなので、道の区切り・OS の誤りの字のような Windows の答えそのものはここでは守れない（それは Windows の CI）
#     焼く係そのものの試験（bake_selftest）も Windows の形で流す（版 3.117.3 の 1 回目の Windows の CI で、焼く決めを見る 4 本が落ちた形）
step nt-shape bash -c "(cd desktop && TPA_BAKE_OS=nt cargo test --locked --test bake_selftest) && python program/tools/bless.py --no-python --all --windows table --as-windows --skip-test route_reach"
# 4b) CI に似せた形（版 3.116.0。root でない利用者・別の TMPDIR・SQLite の版が違う Python・リポジトリが家の下・時差・Python 無し・
#     名前を引けない）で、焼いた本の試験を全部流す（program/tools/ci-shape.py。手元と CI の違いで初めて CI で落ちる形を先に見つける）
step ci-shape python program/tools/ci-shape.py "$OUT/ci-shape"
# 5) 窓の通し（起動・更新・配布の流れを変えたとき）
if [ $VERIFY -eq 1 ]; then
  # 窓の通しは版を何度も写して 7〜10 GB 使う。cargo の試験が済んだので、試験の実行ファイルと incremental を消して空きを作る
  # （版 3.116.0。前は手で消していた。窓の通しが使う exe〈debug/LotScope〉は deps の外なので残る）
  if [ -d "$T" ]; then
    find "$T/deps" -maxdepth 1 -type f -perm -u+x ! -name "*.*" -delete 2>/dev/null
    rm -rf "$T/incremental"
  fi
  echo "空き（窓の通しの前）: $(free_gb) GB" | tee -a "$OUT/summary.txt"
  if [ "$(free_gb)" -lt "$KEEP" ]; then
    echo "空きが足りないので窓の通しを始めません（必要 ${KEEP} GB）。" | tee -a "$OUT/summary.txt"
    FAIL=1
    VERIFY=0
  fi
fi
if [ $VERIFY -eq 1 ]; then
  W="$OUT/verify-work"
  rm -rf "$W"
  # cargo の作業フォルダを替えている（CARGO_TARGET_DIR。worktree で主の作業フォルダを共にする）ときは、そこに組んだ exe（版 3.98.0）
  EXE="${CARGO_TARGET_DIR:-desktop/target}/debug/LotScope"
  if command -v xvfb-run >/dev/null 2>&1 && [ "$(uname)" != "MINGW64_NT" ]; then
    step verify xvfb-run -a python desktop/bundle/verify.py update --exe "$EXE" --work "$W"
    # Python の無い PC（版 3.111.0。作業場所の窓だけ・窓だけの自己診断の項目）
    step verify-local xvfb-run -a python desktop/bundle/verify.py local --exe "$EXE" --work "$W-local"
    rm -rf "$W-local"
  else
    step verify python desktop/bundle/verify.py update --exe "$EXE" --work "$W"
  fi
  grep -E "^FAIL|^  \[" "$OUT"/*-verify*.log | head -10 | tee -a "$OUT/summary.txt"
  rm -rf "$W"
fi
fi  # ONLY_UI
# 6) 撮る・採点する道具を窓の開発用サーバーで（--ui。版 3.118.3）
if [ $UI -eq 1 ]; then
  UIO="$OUT/ui"
  rm -rf "$UIO"
  mkdir -p "$UIO"
  U0=$SECONDS
  # ui_serve は自分で組む（first_fixes 1）。道具は ui-harness.mjs の UI_EXE（CARGO_TARGET_DIR か desktop/target の debug/examples/ui_serve）を使う
  step ui-build bash -c "cd desktop && cargo build --locked --example ui_serve && cd .. && python program/tools/slow-hook-check.py --exe \"$T/examples/ui_serve\" --expect-mark"
  if [ $LAST_RC -ne 0 ]; then
    echo "ui の段: 窓の開発用サーバー（examples/ui_serve）を組めないので、道具を流しません" | tee -a "$OUT/summary.txt"
  elif ! command -v node >/dev/null 2>&1; then
    echo "ui の段: node がありません" | tee -a "$OUT/summary.txt"
    FAIL=1
  else
    step ui-check env TPA_UI_SERVER=window node program/tools/ui-check.mjs "$UIO/check" light 1728x1152 --states list,dash
    step ui-xss env TPA_UI_SERVER=window node program/tools/ui-eval-xss.mjs
    step ui-narrow env TPA_UI_SERVER=window node program/tools/ui-eval-narrow.mjs
    step ui-dashwait env TPA_UI_SERVER=window node program/tools/ui-eval-dashwait.mjs
    grep -hE "^NG" "$OUT"/*-ui-*.log | head -5 | tee -a "$OUT/summary.txt"
  fi
  echo "ui の段の計: $((SECONDS - U0)) 秒（目安 900 秒）" | tee -a "$OUT/summary.txt"
fi

if [ $FAIL -eq 0 ]; then
  echo "すべて通りました${NOTE:+。ただし $NOTE}" | tee -a "$OUT/summary.txt"
else
  echo "落ちた段があります（push しない）。記録: $OUT" | tee -a "$OUT/summary.txt"
fi
exit $FAIL
