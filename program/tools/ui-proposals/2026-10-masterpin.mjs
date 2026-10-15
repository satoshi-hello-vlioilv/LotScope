// 2026-10 マスタの置き場を配る版で指定する（版 3.34.0）。1 回目。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-masterpin.mjs --states master-place,master-release
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-masterpin.mjs --states master-place,master-release --view 1280x720
// 利用者の声: 置き場を切り替えたら、ほかの PC が正しく追従しない（更新もうまく効かない・古いマスタの置き場を見ている）。
//   配る版のところで、マスタの置き場をしっかり指定できるようにしてほしい。
// 今の画面（撮った物 /tmp 下）で見えたこと:
//   アプリの配布: ①版を置く ②配る版を選ぶ ③各 PC がそろう の流れに、マスタの置き場がどこにも出ない（配る版と一緒に何がそろうかが分からない）
//   マスタの置き場: この PC の置き場は上の帯に出るが、全員の PC がどこを使うか（そろっているか）が分からない。変えた後にほかの PC がどうなるかも見えない
// 作り（決まっていること。案は見せ方だけを変える）: 配る版の覚え（distribute.json）に masters { dir, setAt, setBy } を書く。配る版を決めるときは
//   決めた人の PC の置き場を、マスタの置き場を変えたときは新しい置き場を書く。各 PC は取り込みのたびに受け取り、その置き場へ移る。
// 案の向き（何で解くか）:
//   A 流れの段に入れる（②の札に「マスタ」を 1 行）   B 独立の帯（新しい PC へ の帯と同じ形）   C 置き場の画面に置く（配布の画面は 1 行で案内）
//   D 両方の画面に同じ帯（言葉・色・形をそろえる）   E 流れを 4 段にする（③ マスタの置き場をそろえる）   F 「全員にそろえる物」の表（版と置き場を 2 行で）
// 試験用の画面では、この PC の置き場は手元のみ。配る版の覚えの置き場は \\nlmsrvngy03\工場内共有\検査データ\Masters（ui-harness.mjs の RELEASE）。
// 案の帯は「この PC も同じ置き場」の形で描く（ずれているときは、同じ所に橙の札と「この PC の置き場を配る」が出る。案 G で見る）

const PIN = "\\\\nlmsrvngy03\\工場内共有\\検査データ\\Masters";
const WHEN = "2026-10-15 14:30 user（PC-01）";
const css = `
.pin-band{display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center;padding:10px 14px;margin-bottom:12px;border:1px solid var(--line);border-left:4px solid var(--h-input);border-radius:10px;background:var(--surface)}
.pin-band > b{font-size:13.5px;color:var(--h-input);white-space:nowrap}
.pin-band span{font-size:13px;line-height:1.7;color:var(--ro-ink)}
.pin-band code{font-family:Consolas,"BIZ UDGothic",monospace;font-size:12.5px;background:var(--surface-4);padding:1px 5px;border-radius:4px;word-break:break-all}
.pin-band small{display:block;color:var(--muted);font-size:12px;line-height:1.6}
.pin-band.is-off{border-left-color:var(--accent);background:var(--amber-soft)}
.pin-line{display:block;margin-top:4px;font-size:12.5px;color:var(--ro-ink)}
.pin-line code{font-family:Consolas,"BIZ UDGothic",monospace;font-size:12px;background:var(--surface-4);padding:0 4px;border-radius:4px;word-break:break-all}
.pin-table{width:100%;border-collapse:collapse;margin:0 0 12px;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--surface)}
.pin-table th{font-size:12px;color:var(--muted);text-align:left;padding:6px 12px;background:var(--surface-2);border-bottom:1px solid var(--line)}
.pin-table td{font-size:13px;padding:8px 12px;border-bottom:1px solid var(--line);vertical-align:middle}
.pin-table code{font-family:Consolas,"BIZ UDGothic",monospace;font-size:12.5px;background:var(--surface-4);padding:1px 5px;border-radius:4px}
.mp-pin{margin-top:6px}
`;
const chip = (t, c) => `<span class="m-chip ${c}">${t}</span>`;
const band = (extra = "", off = false) => `<div class="pin-band${off ? " is-off" : ""}"><b>マスタの置き場</b>
  <span>配る版と一緒に、全員の PC をこの置き場にそろえます: <code>${PIN}</code> ${off ? chip("この PC は別の置き場", "c-warn") : chip("この PC も同じ", "c-on")}
  <small>${WHEN} が配りました。各 PC は起動したとき・30 分ごとに受け取り、数秒でこの置き場へ移ります。置き場を変えると、ここも新しい置き場になります。${extra}</small></span>
  <button type="button" class="pz-btn">${off ? "この PC の置き場を配る" : "置き場を変える…"}</button></div>`;
// 案は 2 つの画面（マスタの置き場・アプリの配布）のどちらにも当たるので、差し込む先が無い画面では何もしない。
// 画面は読み終えてから描き直す（中身を入れ替える）ので、描き直すたびに差し込み直す（印 data-pin で 2 度は入れない）
const keep = (body) => ["script", `{ const run = () => { ${body} }; run();
  new MutationObserver(run).observe(document.querySelector("#masterSettings") || document.body, { childList: true, subtree: true }); }`];
const before = (sel, html) => keep(`const el = document.querySelector(${JSON.stringify(sel)});
  if (el && !(el.previousElementSibling && el.previousElementSibling.dataset.pin)) el.insertAdjacentHTML("beforebegin", ${JSON.stringify(html.replace(/^<(\w+)/, '<$1 data-pin="1"'))});`);
const placeBand = (off = false) => before("#masterSettings .mp-sec", `<div class="pin-band mp-pin${off ? " is-off" : ""}"><b>全員の PC</b>
  <span>配る版で全員にそろえている置き場: <code>${PIN}</code> ${off ? chip("この PC と違う", "c-warn") : chip("この PC も同じ", "c-on")}
  <small>${WHEN} が配りました。下で置き場を変えると、配る版の覚えも新しい置き場に書き換え、全員の PC が数秒〜30 分で移ります。</small></span>
  <button type="button" class="pz-btn">アプリの配布で見る</button></div>`);

export const PROPOSALS = [
  { key: "0", name: "今（マスタの置き場は配布の画面に出ない）", css: "", ops: [] },
  { key: "A", name: "流れの段に入れる: ②配る版の札に「マスタ ＼\\…\\Masters ✓」を 1 行足す",
    css, ops: [keep(`const s = document.querySelectorAll("#masterSettings .dz-step")[1]; if (s && !s.querySelector(".pin-line")) s.insertAdjacentHTML("beforeend",
      '<span class="pin-line">マスタ <code>${PIN.replace(/\\/g, "\\\\")}</code> <span class="m-chip c-on">この PC も同じ</span></span>');`)] },
  { key: "B", name: "独立の帯: 流れの下（新しい PC へ の上）に「マスタの置き場」の帯（新しい PC へ と同じ形・青い縁）",
    css, ops: [before("#masterSettings .dz-new", band())] },
  { key: "C", name: "置き場の画面に置く: マスタの置き場の画面の上に「全員の PC」の帯。配布の画面は流れの下に 1 行の案内だけ",
    css, ops: [before("#masterSettings .dz-new", `<p class="dz-where">マスタの置き場（配る版と一緒に全員へ）: <code>${PIN}</code> ${chip("この PC も同じ", "c-on")} <button type="button" class="pz-btn">マスタの置き場で見る</button></p>`),
      placeBand()] },
  { key: "D", name: "両方に同じ帯: 配布の画面（B と同じ帯）と、マスタの置き場の画面（上の帯の下）に、同じ言葉・色・形の帯",
    css, ops: [before("#masterSettings .dz-new", band()), placeBand()] },
  { key: "E", name: "流れを 4 段に: ①版を置く ②配る版を選ぶ ③マスタの置き場 ④各 PC がそろう",
    css: css + ".dz-flow{grid-template-columns:1fr 22px 1fr 22px 1fr 22px 1.2fr}",
    ops: [keep(`const st = document.querySelectorAll("#masterSettings .dz-step"); const a = st[1] && st[1].nextElementSibling;
      if (a && st.length === 3) a.insertAdjacentHTML("afterend", '<li class="dz-step is-set"><b>③ マスタの置き場</b><span><code style="font-size:12px">${PIN.replace(/\\/g, "\\\\")}</code></span><small>配る版と一緒に全員へ <span class="m-chip c-on">この PC も同じ</span></small></li><li class="dz-arrow" aria-hidden="true"></li>');
      const last = document.querySelectorAll("#masterSettings .dz-step")[3]; if (last && last.querySelector("b").textContent !== "④ 各 PC がそろう") last.querySelector("b").textContent = "④ 各 PC がそろう";`)] },
  { key: "F", name: "「全員にそろえる物」の表: 流れの下に、配る版とマスタの置き場を 2 行で（それぞれの状態と操作）",
    css, ops: [before("#masterSettings .dz-new", `<table class="pin-table"><thead><tr><th>全員にそろえる物</th><th>いまの値</th><th>この PC</th><th></th></tr></thead><tbody>
      <tr><td><b>配る版</b></td><td>3.12.0</td><td>${chip("開き直すと 3.12.0", "c-warn")}</td><td>一覧の「この版を配る」</td></tr>
      <tr><td><b>マスタの置き場</b></td><td><code>${PIN}</code></td><td>${chip("同じ", "c-on")}</td><td><button type="button" class="pz-btn">置き場を変える…</button></td></tr></tbody></table>`)] },
  { key: "G", name: "D のずれた形（この PC が配る版の置き場と違う: 橙の帯・「この PC の置き場を配る」）",
    css, ops: [before("#masterSettings .dz-new", band("", true)), placeBand(true)] },
];
