#!/usr/bin/env bash
# push 前の確かめ一式（CLAUDE.md の「push 前の確かめ」と同じ物）を 1 つずつ流し、段ごとの記録と最後のまとめを出す。
#
#   bash program/tools/check-all.sh [記録のフォルダ] [--verify] [--keep-free GB]
#
# - 始める前に cargo の作業フォルダの古い物（2 時間より前の試験の実行ファイル・incremental・examples）を消し、空きを確かめる。
#   空きが --keep-free（既定 8 GB）より少なければ、確かめを始めずに止める（窓の通しは版を何度も写すので、空きが尽きると
#   取り込みの段が「No space left on device」で落ち、コードの割れと見分けにくい）。
# - 段ごとの記録は 記録のフォルダ/NN-名前.log。結果は終了コードと「Ran … / OK / FAILED」「test result」の行で読む（最後の 1 行で読まない）。
# - 段 ci-shape（版 3.116.0）は、焼いた本の試験を CI に似せた形（root でない利用者・Python 無し・名前を引けない）で流す。
# - --verify は窓の通し（desktop/bundle/verify.py の update と local〈Python の無い PC。版 3.111.0〉。起動・更新・配布の流れを変えたとき）も流し、終わったら作業フォルダを消す。
# - どれか 1 つでも落ちれば終了コード 1（push しない）。
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT=""
VERIFY=0
KEEP=8
while [ $# -gt 0 ]; do
  case "$1" in
    --verify) VERIFY=1 ;;
    --keep-free) KEEP="$2"; shift ;;
    *) OUT="$1" ;;
  esac
  shift
done
OUT="${OUT:-${TMPDIR:-/tmp}/check-all}"
mkdir -p "$OUT"
rm -f "$OUT"/*.log "$OUT/summary.txt"
cd "$ROOT" || exit 2

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

# 2) 型・構文
step js-check bash program/tools/js-check.sh
step compileall python -m compileall -q program
step cargo-build bash -c "cd desktop && cargo build --locked"
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
step cargo-test bash -c "cd desktop && cargo test --locked --no-fail-fast"
# 4a) Linux の上の Windows の形（版 3.117.3。TPA_BAKE_OS=nt）: 札が table の本（books.json の windows）を、Windows の CI と同じ読み方
#     （nt の表・札・Windows で作れない物の数え方）で表だけの形で流す。Windows の CI の 1 回目で初めて落ちる形（作れない物の数え違いなど）を先に見つける。
#     答えは Linux の窓の答えなので、道の区切り・OS の誤りの字のような Windows の答えそのものはここでは守れない（それは Windows の CI）
step nt-shape python program/tools/bless.py --no-python --all --windows table --as-windows --skip-test route_reach
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

if [ $FAIL -eq 0 ]; then
  echo "すべて通りました${NOTE:+。ただし $NOTE}" | tee -a "$OUT/summary.txt"
else
  echo "落ちた段があります（push しない）。記録: $OUT" | tee -a "$OUT/summary.txt"
fi
exit $FAIL
