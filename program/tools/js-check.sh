#!/usr/bin/env bash
# JavaScript の構文の確かめ（CLAUDE.md の「push 前の確かめ」と CI が同じ物を流す）。
#   bash program/tools/js-check.sh
# 拡張子が .js でも import / export を使うファイル（explain3d.js など ES モジュール）は、モジュールとして確かめる。
# node --check はそのままだと .js を古い形のスクリプトとして読み、モジュールの中の書き方の誤りを見逃して終了コード 0 を返す
# （版 3.32.0 で、explain3d.js の壊れた凡例を通してしまったのを見つけた）。
set -u
bad=0
while IFS= read -r f; do
  if [[ "$f" == *.js ]] && grep -qE '^(import|export) ' "$f"; then
    node --input-type=module --check < "$f" || { echo "構文の誤り: $f"; bad=1; }
  else
    node --check "$f" || { echo "構文の誤り: $f"; bad=1; }
  fi
done < <(find program/app/static/js program/tools desktop/src -name '*.js' -o -name '*.mjs')
exit $bad
