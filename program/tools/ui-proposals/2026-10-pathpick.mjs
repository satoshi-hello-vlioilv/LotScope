// 2026-10 フォルダ・ファイルの欄の補助（参照ボタンなど。7 案）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-pathpick.mjs --states master-place,master-paths [--view 1536x864]
// 利用者の要望: マスタの置き場の「置き場を変える」で、参照ボタンなどのフォルダ・ファイルの設定に対する補助が欲しい（分かりやすく使いやすく）。
// 今の画面（画像で見えたこと）:
//   ・マスタの置き場: 「置く場所（上のフォルダ）」は空の欄に例（\\サーバー\共有\検査データ）が淡く出るだけ。長い UNC・BOX のアドレスを
//     覚えて打つしかない（思い出させる）。打ち間違えると「届きません」と出るが、どこまで合っていたかは分からない
//   ・参照先: 元ファイル（.sqlite3）・更新の置き場・ブラウザ（.exe）も同じく打つだけ。合っているかは「確かめる」を押すまで分からない
//   ・作業実績のフォルダ・配布の置き場も同じ（4 か所。どれも同じ補助が要る）
// 案は「マスタの置き場」で補助を開いた形と、「参照先」の欄に補助を付けた形の 2 つで比べる。
//
// 方向（何で解くか）: A 置き場＝欄の横の「参照…」でアプリの中のフォルダを選ぶ窓（よく使う場所・中身の印つき）
// ／B 借りる＝「参照…」で Windows のフォルダ選択の窓（見慣れた形・アプリの印は出ない）
// ／C 打ちながら＝打つと、その場所の下のフォルダが候補に出る（アドレスバー式・Tab で補う）
// ／D 減らし方＝欄の下に候補の札（ほかの設定で使っている場所・これまでの置き場）。押すと入る
// ／E 見せ方＝アドレスを区切りごとの札（パンくず）にし、区切りを押すと同じ階層のフォルダから選び直せる
// 5 案は「選ぶ・打つ」の道具に寄る → 方向の違う 2 案を足す:
// F 外から持ってくる＝エクスプローラーからフォルダを落とす・アドレスを貼る（"" や file:/// を外す）＋エクスプローラーで開く
// G 流れを変える＝「場所を選ぶ」手順（① どこに置くか〈共有・BOX・この PC〉→ ② フォルダ → ③ 確かめる）

export const KIT = ["script", `
(() => {
  const $ = (s) => document.querySelector(s);
  window.__pp = {
    $,
    /** 案を入れる: build() が HTML を入れる（data-px の物が消えたら入れ直す） */
    mount(key, build) { setInterval(() => { if (!document.querySelector("[data-px='" + key + "']")) try { build(); } catch (_) {} }, 150); },
    fill(sel, v) { const i = $(sel); if (i && i.value !== v) { i.value = v; } },
  };
})();`];
export const ROOT = "\\\\\\\\Nlmsrvngy03\\\\Read";
export const CSS = `
  .px-btn{height:32px;border:1px solid var(--line);border-radius:7px;background:var(--surface);font:inherit;font-size:12.5px;font-weight:700;color:var(--h-input);padding:0 12px;white-space:nowrap}
  .px-btn.on{background:var(--input-soft);border-color:var(--h-input)}
  .px-row{display:flex;gap:6px;align-items:center}
  .px-row > input{flex:1;min-width:0}
  .px-dlg{position:fixed;z-index:90;background:var(--surface);border:1px solid var(--pop-line);border-radius:12px;box-shadow:0 22px 50px var(--pop-shadow);display:grid;grid-template-rows:auto auto 1fr auto;width:760px;height:470px;overflow:hidden;font-size:13px}
  .px-dlg .px-hd{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--line)}
  .px-dlg .px-hd b{font-size:15px}.px-dlg .px-hd small{color:var(--muted)}
  .px-crumb{display:flex;align-items:center;gap:4px;padding:8px 16px;background:var(--surface-3);border-bottom:1px solid var(--line);font-family:Consolas,"BIZ UDGothic",monospace;font-size:12.5px}
  .px-crumb span{padding:2px 8px;border-radius:6px;background:var(--surface);border:1px solid var(--line)}
  .px-crumb span:last-child{border-color:var(--h-input);color:var(--h-input);font-weight:700}
  .px-crumb i{color:var(--faint);font-style:normal}
  .px-body{display:grid;grid-template-columns:220px 1fr;min-height:0}
  .px-side{border-right:1px solid var(--line);padding:10px 8px;display:flex;flex-direction:column;gap:2px;background:var(--surface-1)}
  .px-side h5{margin:8px 8px 4px;font-size:11px;color:var(--muted);letter-spacing:.06em}
  .px-side a{display:flex;flex-direction:column;padding:6px 8px;border-radius:7px;color:var(--ink);text-decoration:none;font-size:12.5px}
  .px-side a small{color:var(--muted);font-size:11px;font-family:Consolas,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .px-side a.on{background:var(--input-soft)}
  .px-list{overflow:auto;padding:6px 8px}
  .px-list div{display:grid;grid-template-columns:22px 1fr auto 120px;gap:8px;align-items:center;padding:7px 8px;border-radius:7px}
  .px-list div.on{background:var(--input-soft);outline:1px solid var(--h-input)}
  .px-list div em{font-style:normal;font-size:11px;padding:1px 8px;border-radius:999px;background:var(--ok-soft);color:var(--ok-ink);font-weight:700}
  .px-list div em.n{background:var(--surface-4);color:var(--muted)}
  .px-list div time{color:var(--muted);font-size:11.5px;font-variant-numeric:tabular-nums}
  .px-foot{display:flex;align-items:center;gap:8px;padding:10px 16px;border-top:1px solid var(--line);background:var(--surface-2)}
  .px-foot code{flex:1;min-width:0;font-size:12.5px;padding:5px 8px;border-radius:6px;background:var(--surface);border:1px solid var(--line);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .px-go{height:32px;border:0;border-radius:7px;background:var(--h-input);color:#fff;font:inherit;font-weight:700;padding:0 14px;white-space:nowrap}
  .px-win{position:fixed;z-index:90;width:720px;height:460px;background:#fff;border:1px solid #9aa4ae;box-shadow:0 18px 40px rgba(0,0,0,.28);font:12px "Segoe UI","Yu Gothic UI",sans-serif;display:grid;grid-template-rows:30px 36px 1fr 74px}
  .px-win .t{display:flex;align-items:center;padding:0 10px;background:#f3f3f3;border-bottom:1px solid #e1e1e1}
  .px-win .a{display:flex;align-items:center;gap:6px;padding:0 10px;border-bottom:1px solid #e1e1e1}
  .px-win .a span{flex:1;border:1px solid #c8c8c8;padding:3px 8px;color:#333}
  .px-win .m{display:grid;grid-template-columns:180px 1fr}
  .px-win .n{border-right:1px solid #e1e1e1;padding:8px;display:flex;flex-direction:column;gap:5px;color:#333}
  .px-win .l{padding:8px;display:flex;flex-direction:column;gap:3px}
  .px-win .l span{padding:3px 8px}.px-win .l span.on{background:#cce8ff}
  .px-win .f{display:flex;flex-direction:column;gap:8px;justify-content:center;padding:0 12px;border-top:1px solid #e1e1e1;background:#f3f3f3}
  .px-win .f div{display:flex;gap:8px;align-items:center;justify-content:flex-end}
  .px-win .f span.in{flex:1;border:1px solid #c8c8c8;background:#fff;padding:3px 8px}
  .px-win .f b{border:1px solid #0067c0;background:#0067c0;color:#fff;padding:4px 16px;font-weight:400}
  .px-win .f i{border:1px solid #c8c8c8;background:#fff;padding:4px 16px;font-style:normal}
  .px-ac{position:absolute;z-index:80;background:var(--surface);border:1px solid var(--pop-line);border-radius:9px;box-shadow:0 14px 34px var(--pop-shadow);padding:5px;display:grid;font-size:12.5px}
  .px-ac > span{display:grid;grid-template-columns:20px 1fr auto;gap:8px;align-items:center;padding:6px 10px;border-radius:6px;font-family:Consolas,"BIZ UDGothic",monospace}
  .px-ac > span.on{background:var(--input-soft)}
  .px-ac > span em{font-style:normal;font-family:var(--sans,inherit);font-size:11px;color:var(--ok-ink);background:var(--ok-soft);padding:0 7px;border-radius:999px}
  .px-ac small{padding:4px 10px 2px;color:var(--muted);border-top:1px solid var(--line);margin-top:3px}
  .px-key{font-size:10.5px;border:1px solid var(--line);border-bottom-width:2px;border-radius:4px;padding:0 4px;background:var(--surface);margin:0 1px}
  .px-chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:6px;font-size:12px}
  .px-chips > b{font-size:11.5px;color:var(--muted);margin-right:2px}
  .px-chips span{display:inline-flex;flex-direction:column;padding:4px 10px;border:1px solid var(--line);border-radius:8px;background:var(--surface);cursor:pointer;max-width:360px}
  .px-chips span code{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--h-input);font-weight:700;background:none;padding:0}
  .px-chips span small{color:var(--muted);font-size:10.5px}
  .px-bc{display:flex;align-items:center;gap:2px;flex-wrap:wrap;min-height:34px;border:1px solid var(--edit-line);background:var(--edit-field);border-radius:7px;padding:3px 6px;font-family:Consolas,"BIZ UDGothic",monospace;font-size:13px}
  .px-bc span{padding:3px 8px;border-radius:6px;display:inline-flex;align-items:center;gap:4px}
  .px-bc span::after{content:"▾";font-size:9px;color:var(--muted)}
  .px-bc span.ok{background:var(--ok-soft);color:var(--ok-ink)}
  .px-bc span.on{outline:2px solid var(--h-input);background:var(--input-soft);color:var(--h-input)}
  .px-bc i{color:var(--faint);font-style:normal}
  .px-bc .add{color:var(--muted);border:1px dashed var(--line)}
  .px-bc .add::after{content:""}
  .px-drop{margin-top:8px;border:2px dashed color-mix(in srgb,var(--h-input) 45%,var(--line));border-radius:10px;padding:14px;background:color-mix(in srgb,var(--h-input) 5%,var(--surface));display:flex;gap:12px;align-items:center;font-size:12.5px;color:var(--muted)}
  .px-drop b{color:var(--h-input);font-size:13.5px}
  .px-drop .ic{font-size:26px}
  .px-steps{display:flex;gap:6px;margin:4px 0 10px}
  .px-steps span{flex:1;padding:6px 10px;border-radius:8px;background:var(--surface-4);font-size:12px;color:var(--muted);font-weight:700}
  .px-steps span.on{background:var(--input-soft);color:var(--h-input);outline:1px solid var(--h-input)}
  .px-where{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
  .px-where div{border:1px solid var(--line);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:4px;background:var(--surface)}
  .px-where div.on{border-color:var(--h-input);box-shadow:0 0 0 2px var(--input-soft)}
  .px-where b{font-size:14px}.px-where small{color:var(--muted);font-size:11.5px}
  .px-where code{font-size:11.5px;color:var(--h-input)}
  .px-st{font-size:11.5px;font-weight:700;padding:1px 8px;border-radius:999px;background:var(--ok-soft);color:var(--ok-ink);margin-left:6px}
`;
export const go = (key, build) => ["script", `window.__pp.mount(${JSON.stringify(key)}, () => { const X = window.__pp; ${build} });`];
// マスタの置き場の「置く場所」に値を入れる（補助で選んだあとの形）
const PARENT = `X.fill("#mpParent", "${ROOT}\\\\【New】仕掛");`;
// 欄の横にボタンを置く（label の中の input を横並びの箱に包む）
export const BTN = (key, sel, text, on = false) => `const i = X.$(${JSON.stringify(sel)}); if (!i) return;
  const w = document.createElement("div"); w.className = "px-row"; w.setAttribute("data-px", ${JSON.stringify(key)}); i.before(w); w.append(i);
  w.insertAdjacentHTML("beforeend", '<button class="px-btn${on ? " on" : ""}">${text}</button>');`;
export const PATHS_BTN = (key, text) => `const cards = [...document.querySelectorAll('#masterSettings .ps-card[data-key="lot_list.source"], #masterSettings .ps-card[data-key="update.source"], #masterSettings .ps-card[data-key="lotdsp_import.direct.browser"]')];
  if (!cards.length) return; cards.forEach((c, n) => { const i = c.querySelector(".ps-input");
  i.insertAdjacentHTML("afterend", '<button class="px-btn" data-px="${key}' + (n ? n : "") + '">' + (c.dataset.key.includes("browser") ? "${text.replace("フォルダ", "ファイル")}" : c.dataset.key === "update.source" ? "${text}" : "${text.replace("フォルダ", "ファイル")}") + '</button>'); });`;
// アプリの中の窓（A）。center: 画面の中ほどに置く
export const DLG = (key, title, sub) => `const r = X.$("#mpParent").getBoundingClientRect();
  document.body.insertAdjacentHTML("beforeend", '<div class="px-dlg" data-px="${key}" style="left:' + Math.max(16, r.left) + 'px;top:' + (r.bottom + 8) + 'px">'
  + '<div class="px-hd"><b>${title}</b><small>${sub}</small></div>'
  + '<div class="px-crumb"><span>\\\\\\\\Nlmsrvngy03</span><i>›</i><span>Read</span><i>›</i><span>【New】仕掛</span></div>'
  + '<div class="px-body"><nav class="px-side"><h5>よく使う場所</h5>'
  + '<a class="on">📌 品質データの場所<small>${ROOT}\\\\【New】仕掛\\\\台帳</small></a>'
  + '<a>📌 作業実績の場所<small>${ROOT}\\\\【New】実績</small></a>'
  + '<a>☁ 配布の置き場（BOX）<small>C:\\\\boxdrive\\\\Box\\\\(D)_仕上課</small></a>'
  + '<h5>この PC</h5><a>🖥 デスクトップ<small>C:\\\\Users\\\\user\\\\Desktop</small></a><a>📄 ドキュメント<small>C:\\\\Users\\\\user\\\\Documents</small></a></nav>'
  + '<div class="px-list">'
  + '<div><span>⬑</span><span>..（Read へ戻る）</span><span></span><time></time></div>'
  + '<div class="on"><span>📁</span><span>Masters</span><em>マスタあり（17 表）</em><time>2026/10/14 08:12</time></div>'
  + '<div><span>📁</span><span>台帳</span><em class="n">.sqlite3 が 1 つ</em><time>2026/10/14 09:40</time></div>'
  + '<div><span>📁</span><span>検査データ</span><em class="n">空</em><time>2026/09/30 17:02</time></div>'
  + '<div><span>📁</span><span>旧_2025</span><span></span><time>2025/12/26 10:15</time></div></div></div>'
  + '<div class="px-foot"><code>${ROOT}\\\\【New】仕掛</code><button class="px-btn">＋ 新しいフォルダ</button><button class="px-btn">やめる</button><button class="px-go">このフォルダに置く</button></div></div>');`;

export const PROPOSALS = [
  { key: "A", name: "置き場: 欄の横の「参照…」→ アプリの中のフォルダを選ぶ窓（よく使う場所・中身の印・新しいフォルダ）", css: CSS,
    ops: [KIT, go("Ab", BTN("Ab", "#mpParent", "📁 参照…", true)), go("Ad", DLG("Ad", "置く場所を選ぶ", "マスタのフォルダを置く、上のフォルダを選びます")),
      go("Ap", PATHS_BTN("Ap", "📁 フォルダを選ぶ…"))] },
  { key: "B", name: "借りる: 「参照…」→ Windows のフォルダ選択の窓（見慣れた形）", css: CSS,
    ops: [KIT, go("Bb", BTN("Bb", "#mpParent", "参照…", true)),
      go("Bd", `const r = X.$("#mpParent").getBoundingClientRect();
        document.body.insertAdjacentHTML("beforeend", '<div class="px-win" data-px="Bd" style="left:' + (r.left + 60) + 'px;top:' + (r.bottom + 10) + 'px">'
        + '<div class="t">フォルダーの選択</div><div class="a">← → ↑ <span>ネットワーク › Nlmsrvngy03 › Read › 【New】仕掛</span></div>'
        + '<div class="m"><div class="n">★ クイック アクセス<br>☁ Box<br>🖥 PC<br>🌐 ネットワーク</div>'
        + '<div class="l"><span>📁 Masters</span><span class="on">📁 台帳</span><span>📁 検査データ</span><span>📁 旧_2025</span></div></div>'
        + '<div class="f"><div><span>フォルダー:</span><span class="in">【New】仕掛</span></div><div><b>フォルダーの選択</b><i>キャンセル</i></div></div></div>');`),
      go("Bp", PATHS_BTN("Bp", "参照…"))] },
  { key: "C", name: "打ちながら: 打つとその場所の下のフォルダが候補に出る（Tab・↓ で補う・届く所に ✓）", css: CSS,
    ops: [KIT, go("Cv", `X.fill("#mpParent", "${ROOT}\\\\【New】"); const i = X.$("#mpParent"); const r = i.getBoundingClientRect(); const box = i.closest(".mp-form") || document.body;
        document.body.insertAdjacentHTML("beforeend", '<div class="px-ac" data-px="Cv" style="position:fixed;left:' + r.left + 'px;top:' + (r.bottom + 4) + 'px;width:' + r.width + 'px">'
        + '<span class="on">📁<b>${ROOT}\\\\【New】仕掛</b><em>届く・マスタあり</em></span><span>📁<b>${ROOT}\\\\【New】実績</b><em>届く</em></span><span>📁<b>${ROOT}\\\\【New】台帳</b><em>届く</em></span>'
        + '<small><span class="px-key">↓</span> で選ぶ・<span class="px-key">Tab</span> で補う・<span class="px-key">Enter</span> で決める</small></div>');`),
      go("Cp", `const c = X.$('#masterSettings .ps-card[data-key="lot_list.source"] .ps-input'); if (!c) return; const r = c.getBoundingClientRect();
        document.body.insertAdjacentHTML("beforeend", '<div class="px-ac" data-px="Cp" style="position:fixed;left:' + r.left + 'px;top:' + (r.bottom + 4) + 'px;width:' + (r.width * .7) + 'px">'
        + '<span class="on">📄<b>台帳\\\\SIKADEF.sqlite3</b><em>品質データ</em></span><span>📁<b>台帳\\\\旧</b><em>届く</em></span><small><span class="px-key">Tab</span> で補う</small></div>');`)] },
  { key: "D", name: "減らし方: 欄の下に候補の札（ほかの設定で使っている場所・これまでの置き場）。押すと入る", css: CSS,
    ops: [KIT, go("Dc", `const g = X.$(".mp-form .dz-pl-grid"); if (!g) return;
        g.insertAdjacentHTML("afterend", '<div class="px-chips" data-px="Dc"><b>候補</b>'
        + '<span><code>${ROOT}\\\\【New】仕掛</code><small>品質データと同じ場所</small></span>'
        + '<span><code>${ROOT}\\\\【New】実績</code><small>作業実績のフォルダ</small></span>'
        + '<span><code>C:\\\\boxdrive\\\\Box\\\\(D)_仕上課\\\\90_アプリ開発</code><small>配布の置き場の上</small></span></div>');`),
      go("Dp", `const c = X.$('#masterSettings .ps-card[data-key="update.source"] .ps-row'); if (!c) return;
        c.insertAdjacentHTML("afterend", '<div class="px-chips" data-px="Dp"><b>候補</b><span><code>C:\\\\boxdrive\\\\Box\\\\(D)_仕上課\\\\90_アプリ開発\\\\90_Releases</code><small>BOX で見つかった版の置き場</small></span><span><code>%USERPROFILE%\\\\Box\\\\90_Releases</code><small>人ごとの BOX</small></span></div>');`)] },
  { key: "E", name: "見せ方: アドレスを区切りの札（パンくず）に。区切りを押すと同じ階層から選び直す・届く所は緑", css: CSS,
    ops: [KIT, go("Ev", `const i = X.$("#mpParent"); if (!i) return; i.style.display = "none";
        i.insertAdjacentHTML("afterend", '<div class="px-bc" data-px="Ev"><span class="ok">\\\\\\\\Nlmsrvngy03</span><i>\\\\</i><span class="ok">Read</span><i>\\\\</i><span class="on">【New】仕掛</span><i>\\\\</i><span class="add">＋ 下のフォルダ</span></div>');
        const r = X.$(".px-bc span.on").getBoundingClientRect();
        document.body.insertAdjacentHTML("beforeend", '<div class="px-ac" data-px="Ev2" style="position:fixed;left:' + r.left + 'px;top:' + (r.bottom + 6) + 'px;width:300px">'
        + '<span class="on">📁<b>【New】仕掛</b><em>マスタあり</em></span><span>📁<b>【New】実績</b><em>届く</em></span><span>📁<b>【New】台帳</b><em>届く</em></span><span>📁<b>共通</b><em>届く</em></span></div>');`),
      go("Ep", `const c = X.$('#masterSettings .ps-card[data-key="lot_list.source"] .ps-input'); if (!c) return; c.style.display = "none";
        c.insertAdjacentHTML("afterend", '<div class="px-bc" data-px="Ep" style="flex:1"><span class="ok">\\\\\\\\Nlmsrvngy03</span><i>\\\\</i><span class="ok">Read</span><i>\\\\</i><span class="ok">【New】仕掛</span><i>\\\\</i><span class="ok">台帳</span><i>\\\\</i><span class="ok">SIKADEF.sqlite3</span></div>');`)] },
  { key: "F", name: "外から持ってくる: エクスプローラーからフォルダを落とす・アドレスを貼る（\"\" や file:/// を外す）＋エクスプローラーで開く", css: CSS,
    ops: [KIT, go("Fd", `const g = X.$(".mp-form .dz-pl-grid"); if (!g) return;
        g.insertAdjacentHTML("afterend", '<div class="px-drop" data-px="Fd"><span class="ic">📂</span><div><b>エクスプローラーからフォルダをここへ落とす</b><br>またはアドレスを貼る（エクスプローラーのアドレス欄で Ctrl＋C。前後の "" や file:/// は外します）</div><button class="px-btn" style="margin-left:auto">エクスプローラーで開く</button></div>');`),
      go("Fp", `const cards = [...document.querySelectorAll('#masterSettings .ps-card[data-key="lot_list.source"], #masterSettings .ps-card[data-key="update.source"]')]; if (!cards.length) return;
        cards.forEach((c, n) => c.querySelector(".ps-row").insertAdjacentHTML("afterend", '<div class="px-drop" style="padding:8px 12px" data-px="Fp' + (n || "") + '"><span>📂</span><div><b>ここへ' + (n ? "フォルダ" : "ファイル") + 'を落とす</b>・アドレスを貼る</div><button class="px-btn" style="margin-left:auto">エクスプローラーで開く</button></div>'));`)] },
  { key: "G", name: "流れを変える: 「場所を選ぶ」手順（① どこに置くか → ② フォルダ → ③ 確かめる）", css: CSS,
    ops: [KIT, go("Gw", `const g = X.$(".mp-form .dz-pl-grid"); if (!g) return; g.style.display = "none";
        g.insertAdjacentHTML("beforebegin", '<div data-px="Gw"><div class="px-steps"><span class="on">① どこに置くか</span><span>② フォルダを選ぶ</span><span>③ 確かめて変える</span></div>'
        + '<div class="px-where"><div class="on"><b>🌐 共有フォルダ <span class="px-st">おすすめ</span></b><small>全員の PC から届く所。社内の共有サーバー</small><code>${ROOT}</code></div>'
        + '<div><b>☁ BOX</b><small>BOX Drive で同期している所。人ごとに見え方が違うことがある</small><code>C:\\\\boxdrive\\\\Box</code></div>'
        + '<div><b>🖥 この PC だけ</b><small>ほかの PC と共有しない（試すとき）</small><code>アプリの data</code></div></div></div>');`),
      go("Gp", PATHS_BTN("Gp", "場所を選ぶ…"))] },
];
