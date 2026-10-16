// 2026-10 推奨アップデートの札と、使っている人への知らせ（版 3.35.0）。1 回目。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-recommend.mjs --states update-recommended,master-release
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-recommend.mjs --states update-recommended,master-release --view 1280x720
// 利用者の声: 配布する版に推奨アップデートの札を付けられるようにし、その版が配られたら、表示を邪魔しない程度に、使っている人へ更新を促したい。
// 今の画面（ui-harness の update-recommended: 札付きの 3.13.0 を取り込み済み）で見えたこと:
//   見出しの版の横の小さな緑の札「更新あり 3.13.0」だけ。一覧を見ている目からは遠く小さく、推奨か（なぜ更新するか）も分からない。押すと更新履歴の窓
// 作り（決まり）: 配る版の覚え（distribute.json）に recommended {note, setAt, setBy}。配布の画面の配っている版の行で付ける・外す（理由を 1 行添えられる）。
//   各 PC は、配る版に札が付いていて、まだその版でなければ知らせる。手は「更新して開き直す」（取り込み済みのとき。今の作業の覚えはそのまま）と「あとで」
// 配布の画面（どの案も同じ形）: ②の札の配る版の横に「推奨アップデート」と理由の 1 行、配っている版の行に「推奨」の札と「推奨を外す」（付けていないときは「推奨にする…」）
// 知らせの案（何で解くか）:
//   A 右下の小さな知らせ（カード。あとで＝4 時間は出さない）  B 見出しの札を強める（橙の「推奨 3.13.0 ↻」と点）だけ
//   C 一覧の上の細い帯（件数の行の上。×で閉じる）  D 見出しの札から吹き出し（最初の 1 回だけ。あとで畳むと札だけ）
//   E 左下の小さな丸い札（押すと開く）  F B と A を合わせる（札を強め、最初の 1 回だけ右下の知らせ）

const NOTE = "ほかの PC がマスタの置き場に追従しない不具合を直しました";
const css = `
.rc-card{position:fixed;right:18px;bottom:18px;z-index:60;width:360px;background:var(--surface);border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:12px;box-shadow:0 10px 30px rgba(20,40,60,.18);padding:12px 14px;font-size:13px;color:var(--ink);display:grid;gap:6px}
.rc-card b{font-size:14px}
.rc-card small{color:var(--muted);line-height:1.6}
.rc-acts{display:flex;gap:8px;justify-content:flex-end;margin-top:4px}
.rc-x{position:absolute;right:8px;top:6px;border:0;background:none;color:var(--muted);font-size:16px;cursor:pointer}
.rc-band{display:flex;align-items:center;gap:10px;margin:0 0 8px;padding:6px 12px;border-radius:8px;background:var(--amber-soft);border:1px solid #f0d29a;font-size:13px;color:var(--ink)}
.rc-band .rc-sp{flex:1}
.rc-pill{background:#f5a524!important;color:#3a2600!important;border-color:#f5a524!important;font-weight:700}
.rc-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#fff;margin-left:6px;vertical-align:middle;box-shadow:0 0 0 2px rgba(255,255,255,.35)}
.rc-tip{position:fixed;top:44px;left:180px;z-index:60;width:340px;background:var(--surface);border:1px solid var(--line);border-radius:10px;box-shadow:0 10px 30px rgba(20,40,60,.2);padding:10px 12px;font-size:13px;display:grid;gap:6px}
.rc-tip::before{content:"";position:absolute;top:-7px;left:36px;width:12px;height:12px;background:var(--surface);border-left:1px solid var(--line);border-top:1px solid var(--line);transform:rotate(45deg)}
.rc-fab{position:fixed;left:18px;bottom:18px;z-index:60;display:flex;align-items:center;gap:8px;padding:8px 14px;border-radius:999px;background:#f5a524;color:#3a2600;font-weight:700;font-size:13px;box-shadow:0 6px 18px rgba(20,40,60,.2)}
.rc-chip{display:inline-block;margin-left:6px;padding:0 8px;border-radius:999px;background:#fff1d6;color:#8a5200;font-size:12px;font-weight:700}
.rc-row-note{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
`;
const body = `<b>推奨アップデート 3.13.0</b><small>${NOTE}。開き直すと新しい版になります（表示の設定・選んだ値はそのまま）。</small>`;
const acts = '<div class="rc-acts"><button type="button" class="btn-ghost">あとで</button><button type="button" class="btn-primary">更新して開き直す</button></div>';
const card = `<div class="rc-card" role="status"><button type="button" class="rc-x" aria-label="閉じる">×</button>${body}${acts}</div>`;
const keep = (body) => ["script", `{ const run = () => { ${body} }; run(); new MutationObserver(run).observe(document.body, { childList: true, subtree: true }); }`];
const add = (html) => keep(`const open = document.querySelector("#masterOverlay:not(.hidden)"), has = document.querySelector("[data-rc]");
  if (open && has) has.remove(); else if (!open && !has) document.body.insertAdjacentHTML("beforeend", ${JSON.stringify(html.replace(/^<(\w+)/, '<$1 data-rc="1"'))});`);
const strongChip = keep(`const b = document.querySelector("#verNew"); if (b && !b.classList.contains("rc-pill")) { b.classList.add("rc-pill"); b.innerHTML = "推奨 3.13.0 ↻<i class=\\"rc-dot\\"></i>"; b.title = "推奨アップデート 3.13.0（${NOTE}）。押すと更新して開き直せます"; }`);
const band = keep(`const s = document.querySelector("#lotListScreen .ll-status"); if (s && !document.querySelector(".rc-band")) s.insertAdjacentHTML("beforebegin", ${JSON.stringify(`<div class="rc-band" role="status"><b>推奨アップデート 3.13.0</b><span>${NOTE}</span><span class="rc-sp"></span><button type="button" class="btn-primary">更新して開き直す</button><button type="button" class="btn-ghost">あとで</button></div>`)});`);
// 配布の画面（どの案も同じ）
const release = keep(`const st = document.querySelectorAll("#masterSettings .dz-step")[1]; if (st && !st.querySelector(".rc-chip")) {
    const b = st.querySelector("span");
    if (b) { b.insertAdjacentHTML("beforeend", '<span class="rc-chip">推奨アップデート</span>'); b.insertAdjacentHTML("afterend", '<small class="rc-row-note" title="${NOTE}">理由: ${NOTE}</small>'); } }
  const live = document.querySelector("#masterSettings tr.is-live"); if (live && !live.querySelector(".rc-chip")) {
    live.children[1].insertAdjacentHTML("beforeend", '<span class="rc-chip">推奨</span>');
    live.lastElementChild.insertAdjacentHTML("beforeend", '<button type="button" class="pz-btn" title="各 PC への知らせを止めます（配る版はそのまま）">推奨を外す</button>'); }`);
export const PROPOSALS = [
  { key: "0", name: "今（見出しの小さな「更新あり 3.13.0」だけ）", css: "", ops: [] },
  { key: "A", name: "右下の小さな知らせ（理由・更新して開き直す・あとで）", css, ops: [release, add(card)] },
  { key: "B", name: "見出しの札を強める（橙の「推奨 3.13.0 ↻」と点）だけ", css, ops: [release, strongChip] },
  { key: "C", name: "一覧の上の細い帯（件数の行の上。理由と手）", css, ops: [release, band] },
  { key: "D", name: "見出しの札から吹き出し（最初の 1 回だけ。あとで畳むと札だけ）", css, ops: [release, strongChip,
    add(`<div class="rc-tip" role="status">${body}${acts}</div>`)] },
  { key: "E", name: "左下の小さな丸い札（押すと理由と手が開く）", css, ops: [release, add('<button type="button" class="rc-fab" title="推奨アップデート 3.13.0">↻ 推奨アップデート 3.13.0</button>')] },
  { key: "F", name: "B と A を合わせる（札を強め、最初の 1 回だけ右下の知らせ）", css, ops: [release, strongChip, add(card)] },
];
