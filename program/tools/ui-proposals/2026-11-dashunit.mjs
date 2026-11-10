// ダッシュボードの表の列ごとの単位・計算式の見出し・数字のパネルの置き方・待ちの知らせ（版 3.92.0。利用者の要望 2026-11-10 の 2〜5）
// 撮るのは program/tools/shot-dashunit.mjs（node shot-dashunit.mjs 出力 [1536x864] この定義 案の鍵）。at の文は状態ごとに頁の中で動く。
// 案の方向（何で解くか）:
//   A 値の計算の段に足す（置き場: 値ごとの段）           B 見本の上で直す（見せ方: 表の見出し・数字を押す）
//   C 書式のタブの値ごとの表（置き場: 書式に 1 つの表）    D 値の札の歯車（置き場: 文の札）
//   E パネル全体の切り替え（減らし方: 式はパネルで 1 つ）  F 形の見本の札で選ぶ（流れ: 選ぶだけ。数字のパネルの置き方を見本から）
// どの案も、確定後の表（ロット数に t が付かない・見出しの式を出さない）と、組む所の数字のパネルを確定後と同じ大きさで見せる所は同じ。
// 違うのは、どこで・どう決めるかと、数字のパネルの 2 つの値の並べ方・添え書きの置き場の決め方・待ちの見せ方

/* ---------- 頁の中で動く部品（Function#toString で文にする） ---------- */
function fixTable(o) {
  const p = document.querySelector(`#dashGrid .db-p[data-id="t1"]`); if (!p) return;
  const put = () => {
    const tb = p.querySelector("table"); if (!tb || tb.dataset.mk) return;
    tb.dataset.mk = "1";
    p.querySelectorAll("tbody tr").forEach((tr) => { const td = tr.cells[tr.cells.length - 1]; td.textContent = td.textContent.replace(/\.0t$/, ""); });
    const th = p.querySelectorAll("thead th.pv-mh");
    if (th[0]) th[0].textContent = o.expr ? "重量の合計［値÷1000］" : "重量の合計（t）";
    if (th[1]) th[1].textContent = "ロット数";
  };
  put(); new MutationObserver(put).observe(p, { childList: true, subtree: true });     // 描き直しても当て直す
}
function kpiFinal(o) {
  const p = document.querySelector(`#dashGrid .db-p[data-id="k2"]`); if (!p) return;
  const meta = '<small class="mk-meta">品質・全期間</small>';
  const pair = o.pair === "side"
    ? `<div class="mk-pair"><div><small>重量の合計</small><b>4,940.7<i>t</i></b></div><div><small>ロット数</small><b>946<i>ロット</i></b></div></div>`
    : o.pair === "stack"
      ? `<div class="mk-stack"><div><small>重量の合計</small><b>4,940.7<i>t</i></b></div><div><small>ロット数</small><b>946<i>ロット</i></b></div></div>`
      : `<div class="mk-main"><b>4,940.7<i>t</i></b><span><small>ロット数</small> <b>946</b></span></div>`;
  const html = `<div class="mk-wrap mk-at-${o.meta || "bl"}">${o.meta && o.meta[0] === "t" ? meta + pair : pair + meta}</div>`;
  // 本物の数字のパネルと同じく、収まるまで字を縮める（数は 1 段・単位は数の後ろ）
  const fit = (b) => { b.querySelectorAll(".mk-pair>div,.mk-stack>div,.mk-main").forEach((box) => { const n = box.querySelector("b"); if (!n) return;
    for (let f = parseFloat(getComputedStyle(n).fontSize); f > 14 && (box.scrollWidth > box.clientWidth + 1 || b.scrollHeight > b.clientHeight + 1); f -= 2) n.style.fontSize = `${f - 2}px`; }); };
  const put = () => { const b = p.querySelector(".dp-kpi") || p.querySelector(".db-body"); if (b && !b.querySelector(".mk-wrap")) { b.innerHTML = html; fit(b); } };
  put(); new MutationObserver(put).observe(p, { childList: true, subtree: true });     // パネルを描き直しても当て直す
}
function kpiGeom(o) {
  const el = document.querySelector("#dashGrid .db-p.is-focus"); if (!el) return;
  ["position", "left", "top", "width", "height", "transform", "transformOrigin"].forEach((k) => { el.style[k] = ""; });
  document.querySelector("#dbFocusTag")?.remove();     // 版 3.92.0 の本体の札（案の札と重ねない）
  const r = el.getBoundingClientRect(), g = document.querySelector("#dashGrid").getBoundingClientRect();
  const ed = document.querySelector("#dbEditor").getBoundingClientRect(), aw = ed.left - g.left - 24, cx = g.left + aw / 2, cy = g.top + g.height / 2;
  // 確定後の大きさ（scale は 1.5 倍）。左の空きに入らなければ、同じ並びのまま縮める
  const room = Math.min((aw - 20) / r.width, (g.height - 60) / r.height), z = Math.min(o.mode === "scale" ? 1.5 : 1, room), w = r.width * z, h = r.height * z;
  const left = Math.round(cx - w / 2), top = Math.round(cy - h / 2);
  Object.assign(el.style, { position: "fixed", left: `${left}px`, top: `${top}px`, width: `${r.width}px`, height: `${r.height}px` });
  if (z !== 1) { el.style.transformOrigin = "0 0"; el.style.transform = `scale(${z})`; }
  const tag = (t, y) => document.body.insertAdjacentHTML("beforeend", `<div class="mk-tag" style="left:${left}px;top:${y}px">${t}</div>`);
  if (o.mode === "actual") tag(z < 1 ? `確定後の ${Math.round(z * 100)}%（空きに入るよう縮めた。並び・字の置き場は同じ）` : `確定後と同じ大きさ（${Math.round(r.width)}×${Math.round(r.height)}）。並び・字の置き場も同じ`, top + h + 8);
  if (o.mode === "scale") tag(`確定後の ${z.toFixed(1)} 倍に拡大（並び・字の置き場は確定後と同じ）`, top + h + 8);
  if (o.mode === "left") { tag(z < 1 ? `確定後の ${Math.round(z * 100)}%（空きに入るよう縮めた）` : `確定後と同じ大きさ（${Math.round(r.width)}×${Math.round(r.height)}）`, top + h + 8);
    document.body.insertAdjacentHTML("beforeend", `<div class="mk-mini" style="left:${left}px;top:${top - 92}px"><span>グリッドの置き場</span><i style="left:${Math.round((r.left - g.left) / g.width * 160)}px;top:${Math.round((r.top - g.top) / g.height * 60)}px;width:${Math.round(r.width / g.width * 160)}px;height:${Math.round(r.height / g.height * 60)}px"></i></div>`); }
}
function kpiControls(o) {
  const at = document.querySelector("#dbEditor .de-main") || document.querySelector("#dbEditor"); if (!at) return;
  const segs = (name, items, on) => `<span class="de-segs mk-segs" role="radiogroup" aria-label="${name}">${items.map(([k, t]) => `<label class="de-seg${k === on ? " on" : ""}"><input type="radio">${t}</label>`).join("")}</span>`;
  const grid9 = (on) => `<span class="mk-g9">${["tl", "tc", "tr", "ml", "mc", "mr", "bl", "bc", "br"].map((k) => `<i class="${k === on ? "on" : ""}" title="${k}"></i>`).join("")}</span>`;
  let h = "";
  if (o.kind === "segs") h = `<div class="mk-box"><b class="mk-cap">④ 置き方</b><div class="mk-row"><span>値が 2 つ</span>${segs("2 つの値", [["main", "主と添え"], ["side", "左右に並べる"], ["stack", "上下に並べる"]], "side")}</div><div class="mk-row"><span>添え書き（期間・元）</span>${grid9("bl")}<small>9 か所から選ぶ</small></div></div>`;
  if (o.kind === "drop") h = `<div class="mk-box"><b class="mk-cap">④ 置き方</b><div class="mk-row"><span>値が 2 つ</span><select class="mk-sel"><option>左右に並べる</option></select></div><div class="mk-row"><span>添え書き</span><select class="mk-sel"><option>下</option></select><select class="mk-sel"><option>左寄せ</option></select></div></div>`;
  if (o.kind === "thumbs") {
    const th = [["main", "主と添え", '<b>88</b><small>12</small>'], ["side", "左右に 2 つ", '<b>88</b><b>12</b>'], ["stack", "上下に 2 つ", '<b>88</b><b>12</b>'], ["tl", "添え書きを上", '<small>期間</small><b>88</b>'], ["br", "添え書きを右下", '<b>88</b><small>期間</small>'], ["row", "横 1 列", '<b>88</b><small>期間</small>']];
    h = `<div class="mk-box"><b class="mk-cap">④ 置き方<small>見本を押すと、パネルがその形に</small></b><div class="mk-thumbs">${th.map(([k, t, inner]) => `<button type="button" class="mk-th mk-th-${k}${k === "side" ? " on" : ""}"><span>${inner}</span><small>${t}</small></button>`).join("")}</div></div>`;
  }
  if (o.kind === "drag") h = `<div class="mk-box"><b class="mk-cap">④ 置き方</b><p class="mk-note">パネルの数字・添え書きを引いて置き場を決めます（上・下 × 左・中・右に吸い付きます）。値が 2 つのときは、2 つ目を数字の横か下へ引きます</p></div>`;
  at.insertAdjacentHTML("afterbegin", h);
  at.scrollTop = 0;
}
function calcBand(o) {
  const band = document.querySelector("#dbEditor .pc-band"); if (!band) return;
  band.querySelectorAll(".pc-item").forEach((it, j) => {
    const unit = j === 0 ? "t" : "";
    if (o.kind === "band") it.insertAdjacentHTML("beforeend", `<span class="mk-u"><span class="pc-l">単位</span><input class="pc-in mk-uin" value="${unit}" placeholder="なし"></span>${j === 0 ? '<label class="mk-sw"><input type="checkbox"><i></i>見出しに式</label>' : ""}`);
    if (o.kind === "chip") return;
  });
  if (o.kind === "chip") {
    const chip = document.querySelector("#dbEditor .pv-chip.v");
    if (chip) chip.insertAdjacentHTML("beforeend", '<button type="button" class="mk-gear" title="この値の見せ方">⚙</button>');
    const r = (chip || band).getBoundingClientRect();
    document.body.insertAdjacentHTML("beforeend", `<div class="mk-pop" style="left:${r.right - 40}px;top:${r.bottom + 6}px"><b>重量の合計</b><label>単位 <input value="t"></label><label class="mk-sw"><input type="checkbox"><i></i>見出しに式（値÷1000）</label><label>小数 <span class="mk-pill">1桁</span></label></div>`);
  }
}
function fmtTable() {
  const at = document.querySelector("#dbEditor .de-main") || document.querySelector("#dbEditor"); if (!at) return;
  at.insertAdjacentHTML("afterbegin", `<div class="mk-box"><b class="mk-cap">値ごとの書式<small>列ごとに単位・小数・見出しの式を決めます</small></b><table class="mk-tbl"><thead><tr><th>値</th><th>単位</th><th>小数</th><th>見出しに式</th></tr></thead><tbody>`
    + `<tr><td>重量の合計 <small>÷1000</small></td><td><input value="t"></td><td><span class="mk-pill">1桁</span></td><td><label class="mk-sw"><input type="checkbox"><i></i></label></td></tr>`
    + `<tr><td>ロット数</td><td><input value="" placeholder="なし"></td><td><span class="mk-pill">自動</span></td><td><small>式なし</small></td></tr></tbody></table></div>`);
  at.scrollTop = 0;
}
function headPop() {
  const th = document.querySelector('#dashGrid .db-p.is-focus thead th.pv-mh'); if (!th) return;
  th.classList.add("mk-hot"); const r = th.getBoundingClientRect();
  document.body.insertAdjacentHTML("beforeend", `<div class="mk-pop" style="left:${r.left}px;top:${r.bottom + 6}px"><b>重量の合計 の見せ方</b><label>単位 <input value="t"></label><label class="mk-sw"><input type="checkbox"><i></i>見出しに式（値÷1000）</label><label>小数 <span class="mk-pill">1桁</span></label><small>見出しを押すと、その列だけを直します</small></div>`);
}
function panelToggle() {
  const at = document.querySelector("#dbEditor .de-main") || document.querySelector("#dbEditor"); if (!at) return;
  at.insertAdjacentHTML("afterbegin", `<div class="mk-box"><b class="mk-cap">見出しの式</b><label class="mk-sw"><input type="checkbox"><i></i>値の計算（÷1000 など）を見出しに出す（このパネルの全部の値）</label></div>`);
  document.querySelectorAll("#dbEditor .mk-sw").forEach((x, i) => { if (i > 0) x.remove(); });
  at.scrollTop = 0;
}
function waitShow(o) {
  const ps = [...document.querySelectorAll("#dashGrid .db-p")];
  ps.forEach((p, i) => {
    const done = i === 1, sec = (1.4 + i * 0.7).toFixed(1), slow = i === 3;
    const why = slow ? "実績: 共有から写しています 3/12 設備" : "品質の写しから数えています";
    if (o.kind === "bar") { p.insertAdjacentHTML("afterbegin", `<i class="mk-bar${done ? " done" : ""}" style="--w:${done ? 100 : 30 + i * 15}%"></i>`); if (!done) p.insertAdjacentHTML("beforeend", `<p class="mk-chip">数えています <b>${sec} 秒</b><small>${why}</small></p>`); }
    if (o.kind === "steps" && !done) p.insertAdjacentHTML("beforeend", `<p class="mk-chip"><span class="mk-steps"><i class="ok">頼む</i><i class="${slow ? "now" : "ok"}">${slow ? "写す 3/12" : "写し済み"}</i><i class="${slow ? "" : "now"}">数える</i><i>描く</i></span><b>${sec} 秒</b></p>`);
    if (o.kind === "spin" && !done) p.insertAdjacentHTML("beforeend", `<p class="mk-cover"><i class="mk-ring"></i><b>${slow ? "共有から写しています" : "数えています"}</b><small>${sec} 秒</small></p>`);
  });
  const bar = document.querySelector("#dashBar");
  if (o.top && bar) bar.insertAdjacentHTML("beforeend", `<span class="mk-top"><i style="--w:25%"></i><b>4 枚中 1 枚 済み</b><small>${o.top === "list" ? "待っている: 不良ごとの重量（品質を数える 2.1 秒）・前日の実績本数（実績を共有から写す 3/12）" : "いちばん遅いのは 前日の実績本数（共有から写しています）"}</small></span>`);
}

/* ---------- 2 回目（2026-11-10。1 回目は 63.8 点〈F〉で届かず。採点の指摘: 待ちの札が中身に重なる・字が小さい・見本の札の名前が折れる・
   ④ 置き方が ①〜③ より先・2 つの値の単位が仕切りに付く・表の単位が見出しとセルの 2 か所）---------- */
function fixTable2(o) {
  const p = document.querySelector(`#dashGrid .db-p[data-id="t1"]`); if (!p) return;
  const put = () => {
    const tb = p.querySelector("table"); if (!tb || tb.dataset.mk) return;
    tb.dataset.mk = "1";
    p.querySelectorAll("tbody tr").forEach((tr) => { const a = tr.cells[tr.cells.length - 2], b = tr.cells[tr.cells.length - 1];
      b.textContent = b.textContent.replace(/\.0t$/, "");
      if (o.unit === "head") a.textContent = a.textContent.replace(/t$/, ""); });
    const th = p.querySelectorAll("thead th.pv-mh");
    if (th[0]) th[0].textContent = o.unit === "head" ? "重量の合計（t）" : "重量の合計";
    if (th[1]) th[1].textContent = "ロット数";
  };
  put(); new MutationObserver(put).observe(p, { childList: true, subtree: true });
}
function kpiControls2(o) {
  const main = document.querySelector("#dbEditor .de-main"); if (!main) return;
  const panes = main.querySelector('[data-pane="data"]') || main;
  const thumbs = [["main", "主と添え", '<b>88</b><small>12</small>'], ["side", "左右に 2 つ", '<b>88</b><b>12</b>'], ["stack", "上下に 2 つ", '<b>88</b><b>12</b>'],
    ["tl", "期間を上", '<small>期間</small><b>88</b>'], ["bl", "期間を下", '<b>88</b><small>期間</small>'], ["row", "横 1 列", '<b>88</b><small>期間</small>']];
  const segs = (items, on) => `<span class="de-segs mk-segs">${items.map(([k, t]) => `<label class="de-seg${k === on ? " on" : ""}"><input type="radio">${t}</label>`).join("")}</span>`;
  const g9 = (on) => `<span class="mk-g9t">${[["tl", "上左"], ["tc", "上中"], ["tr", "上右"], ["bl", "下左"], ["bc", "下中"], ["br", "下右"]].map(([k, t]) => `<i class="${k === on ? "on" : ""}">${t}</i>`).join("")}</span>`;
  let h = "";
  if (o.kind === "thumbs") h = `<div class="de-step"><i>4</i>置き方<small>数字のパネルの値と期間の置き場（見本を押すとパネルがその形に）</small></div><div class="mk-box2"><div class="mk-thumbs2">${thumbs.map(([k, t, inner]) => `<button type="button" class="mk-th mk-th-${k}${k === o.on ? " on" : ""}"><span>${inner}</span><small>${t}</small></button>`).join("")}</div></div>`;
  if (o.kind === "grid") h = `<div class="de-step"><i>4</i>置き方<small>数字のパネルの値と期間の置き場</small></div><div class="mk-box2"><div class="mk-row"><span>値が 2 つ</span>${segs([["main", "主と添え"], ["side", "左右に並べる"], ["stack", "上下に並べる"]], "side")}</div><div class="mk-row"><span>期間・元</span>${g9("bl")}</div></div>`;
  panes.insertAdjacentHTML("beforeend", h);
  const last = panes.lastElementChild; if (last) main.scrollTop = Math.max(0, last.offsetTop - 220);
}
function kpiFloatBar() {
  const el = document.querySelector("#dashGrid .db-p.is-focus"); if (!el) return;
  const r = el.getBoundingClientRect();
  document.body.insertAdjacentHTML("beforeend", `<div class="mk-fbar" style="left:${r.left}px;top:${r.top - 46}px"><span>値</span><label class="de-seg">主と添え</label><label class="de-seg on">左右</label><label class="de-seg">上下</label><i></i><span>期間</span><label class="de-seg">上</label><label class="de-seg on">下</label><i></i><label class="de-seg on">左</label><label class="de-seg">右</label></div>`);
}
function calcTable() {
  const band = document.querySelector("#dbEditor .pc-band"); if (!band) return;
  band.innerHTML = `<b class="pc-cap">値の書式</b><table class="mk-ctbl"><thead><tr><th>値</th><th>計算</th><th>小数</th><th>単位</th><th>見出しに式</th></tr></thead><tbody>`
    + `<tr><td>重量の合計</td><td><input class="pc-in" value="÷1000"><small class="mk-sm">計 4,940.7</small></td><td><span class="mk-pill">1桁</span></td><td><input class="pc-in mk-uin" value="t"></td><td><label class="mk-sw"><input type="checkbox"><i></i></label></td></tr>`
    + `<tr><td>ロット数</td><td><input class="pc-in" placeholder="例: ÷1000"></td><td><span class="mk-pill mk-pill2">自動</span></td><td><input class="pc-in mk-uin" placeholder="なし"></td><td><small class="mk-sm">式なし</small></td></tr></tbody></table>`
    + `<div class="mk-ctfoot"><label class="mk-sw"><input type="checkbox"><i></i>すべての見出しに式を出す</label><small class="mk-sm">単位は数の後ろに付きます（列ごと）</small></div>`;
}
function waitShow2(o) {
  const ps = [...document.querySelectorAll("#dashGrid .db-p")];
  ps.forEach((p) => { p.style.transform = ""; p.style.position = ""; p.style.left = ""; p.style.top = ""; p.style.width = ""; p.style.height = ""; });
  ps.forEach((p, i) => {
    const done = i === 1, sec = (1.4 + i * 0.7).toFixed(1), slow = i === 3;
    const why = slow ? "実績を共有から写しています 3/12 設備" : "品質の写しから数えています";
    if (o.bar) p.insertAdjacentHTML("afterbegin", `<i class="mk-bar${done ? " done" : ""}" style="--w:${done ? 100 : 30 + i * 15}%"></i>`);
    if (done || !o.head) return;
    const html = o.head === "text" ? `<span class="mk-hw" title="${why}">${slow ? "写しています 3/12" : "数えています"} <b>${sec} 秒</b></span>`
      : `<span class="mk-hw mk-hsteps" title="${why}"><i class="ok">頼む</i><i class="${slow ? "now" : "ok"}">${slow ? "写す 3/12" : "写し済"}</i><i class="${slow ? "" : "now"}">数える</i><b>${sec} 秒</b></span>`;
    // 見出しの回る印の横に（パネルを描き直しても当て直す）
    const put = () => { if (p.querySelector(".mk-hw")) return; const at = p.querySelector(".db-spin"); if (at) at.insertAdjacentHTML("afterend", html); };
    put(); new MutationObserver(put).observe(p, { childList: true, subtree: true });
  });
  const bar = document.querySelector("#dashBar");
  if (o.top && bar) bar.insertAdjacentHTML("afterend", `<div class="mk-tline"><i style="--w:25%"></i><b>4 枚中 1 枚 済み</b><span>${o.top === "list" ? "待っている: 不良ごとの重量（数える 1.4 秒）・重量の合計（数える 2.8 秒）・前日の実績本数（実績を共有から写す 3/12・3.5 秒）" : "いちばん遅いのは 前日の実績本数（実績を共有から写しています 3/12）"}</span></div>`);
}
const CSS2 = `
.mk-box2{margin:0 0 14px;padding:10px 12px;border:1px solid #e3d3ae;background:#fffaf0;border-radius:8px}
.mk-thumbs2{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.mk-thumbs2 .mk-th>small{font-size:12px;white-space:nowrap}.mk-thumbs2 .mk-th span{height:40px}
.mk-g9t{display:inline-grid;grid-template-columns:repeat(3,auto);gap:4px}.mk-g9t i{font-style:normal;font-size:12px;padding:2px 8px;border:1px solid #9aa8b6;border-radius:4px;color:#3b4652}.mk-g9t i.on{background:#3f6591;border-color:#3f6591;color:#fff}
.mk-fbar{position:fixed;z-index:70;display:flex;align-items:center;gap:4px;background:#fff;border:1px solid #c9d4de;border-radius:8px;box-shadow:0 4px 14px rgba(20,30,40,.14);padding:5px 8px;font-size:13px;color:#3b4652}.mk-fbar>i{width:1px;height:18px;background:#d9e1e8;margin:0 4px}.mk-fbar .de-seg{font-size:13px;padding:2px 8px}
.mk-ctbl{width:100%;border-collapse:collapse;font-size:13px;margin-top:4px}.mk-ctbl th{text-align:left;color:#5d6b78;font-weight:600;padding:3px 4px;border-bottom:1px solid #e3d3ae;font-size:12px}.mk-ctbl td{padding:5px 4px;border-bottom:1px solid #f0e6cf;vertical-align:middle}
.mk-ctbl .pc-in{width:88px}.mk-ctbl .mk-uin{width:56px!important}.mk-sm{font-size:12px;color:#5d6b78;margin-left:6px}.mk-pill2{background:#e3e9ee;color:#3b4652}
.mk-ctfoot{display:flex;align-items:center;gap:12px;margin-top:6px}
.mk-pair>div:first-child{padding-right:16px}.mk-pair i{margin-left:6px}
.mk-hw{display:inline-flex;align-items:center;gap:6px;margin-left:6px;font-size:12px;color:#3b4652;white-space:nowrap}.mk-hw b{font-variant-numeric:tabular-nums}
.mk-hsteps i{font-style:normal;padding:1px 6px;border-radius:9px;background:#eef2f5;color:#5d6b78;font-size:12px}.mk-hsteps i.ok{background:#e1efe9;color:#24614f}.mk-hsteps i.now{background:#3f6591;color:#fff}
.mk-tline{display:flex;align-items:center;gap:10px;margin:2px 16px 4px;font-size:12px;color:#3b4652}.mk-tline i{width:140px;height:6px;background:#e3e9ee;border-radius:3px;position:relative;overflow:hidden}.mk-tline i::after{content:"";position:absolute;inset:0;width:var(--w);background:#3f6591}.mk-tline span{color:#3b4652;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
`;

/* ---------- 3 回目（2026-11-10。2 回目は 77.6 点〈F2〉で届かず。採点の指摘: 狭いパネルで待ちの字が題を切る・待つ間だけ 1 段増えて
   パネルが下へずれる・左右に並べた値の単位が仕切りに付く。持ち込むとよい所: 待っているパネルの名前を道具の行に・すべての見出しに式の切り替え・
   単位を見出しに置く形）---------- */
function kpiStack3() {
  const p = document.querySelector(`#dashGrid .db-p[data-id="k2"]`); if (!p) return;
  const html = `<div class="mk-wrap mk-at-bl"><div class="mk-s3"><small>重量の合計</small><b>4,940.7</b><i>t</i><small>ロット数</small><b>946</b><i>ロット</i></div><small class="mk-meta">品質・全期間</small></div>`;
  const fit = (b) => { const g = b.querySelector(".mk-s3"); if (!g) return; const ns = [...g.querySelectorAll("b")];
    for (let f = parseFloat(getComputedStyle(ns[0]).fontSize); f > 14 && (g.scrollWidth > g.clientWidth + 1 || b.scrollHeight > b.clientHeight + 1); f -= 2) ns.forEach((n) => { n.style.fontSize = `${f - 2}px`; }); };
  const put = () => { const b = p.querySelector(".dp-kpi") || p.querySelector(".db-body"); if (b && !b.querySelector(".mk-wrap")) { b.innerHTML = html; fit(b); } };
  put(); new MutationObserver(put).observe(p, { childList: true, subtree: true });
}
function calcBand3(o) {
  const band = document.querySelector("#dbEditor .pc-band"); if (!band) return;
  const seg = (items, on) => `<span class="de-segs mk-segs3">${items.map(([k, t]) => `<label class="de-seg${k === on ? " on" : ""}"><input type="radio">${t}</label>`).join("")}</span>`;
  band.querySelectorAll(".pc-item").forEach((it, j) => {
    const unit = j === 0 ? "t" : "";
    let h = `<span class="mk-u"><span class="pc-l">単位</span><input class="pc-in mk-uin" value="${unit}" placeholder="なし"></span>`;
    if (j === 0) h += o.seg ? `<span class="mk-u"><span class="pc-l">見出し</span>${seg([["on", "式を出す"], ["off", "出さない"]], "off")}</span>` : '<label class="mk-sw"><input type="checkbox"><i></i>見出しに式</label>';
    it.insertAdjacentHTML("beforeend", h);
  });
  let foot = "";
  if (o.place) foot += `<span class="mk-u"><span class="pc-l">単位の置き場</span>${seg([["cell", "数の後ろ"], ["head", "見出しに（t）"]], "head")}</span>`;
  if (o.all) foot += '<label class="mk-sw"><input type="checkbox"><i></i>すべての値で見出しに式を出す</label>';
  if (foot) band.insertAdjacentHTML("beforeend", `<div class="mk-bfoot">${foot}</div>`);
}
function waitShow3(o) {
  const ps = [...document.querySelectorAll("#dashGrid .db-p")];
  const info = ps.map((p, i) => ({ p, done: i === 1, sec: (1.4 + i * 0.7).toFixed(1), slow: i === 3, name: (p.querySelector("h3") || {}).textContent || "" }));
  info.forEach(({ p, done, sec, slow }, i) => {
    const why = slow ? "実績を共有から写しています 3/12 設備" : "品質の写しから数えています";
    if (o.bar) p.insertAdjacentHTML("afterbegin", `<i class="mk-bar${done ? " done" : ""}" style="--w:${done ? 100 : 30 + i * 15}%"></i>`);
    if (done) return;
    const put = () => {
      // 狭いパネル（460px 未満）は見出しに秒を出さない（題を先に。秒と理由は添え書きの段に）
      const narrow = p.clientWidth < 460;
      if (o.head && !narrow && !p.querySelector(".mk-hs")) { const at = p.querySelector(".db-spin"); if (at) at.insertAdjacentHTML("afterend", `<b class="mk-hs" title="${why}">${sec} 秒</b>`); }
      // 添え書きの段を出していない低いパネル（添え書きを数の横に出す形）は、その添え書きの後ろに足す（段を増やさない）
      const sub0 = p.querySelector(".db-psub"), sub = sub0 && sub0.hidden ? p.querySelector(".dp-kmeta") || sub0 : sub0;
      if (o.sub && sub && !p.querySelector(".mk-sw3")) {
        const t = (o.sub === "prev" ? `前回 14:02 の数・${slow ? "実績を写しています 3/12" : "数え直しています"}` : slow ? "実績を共有から写しています 3/12" : "数えています") + (narrow && o.head ? ` ${sec} 秒` : "");
        sub.insertAdjacentHTML("beforeend", `<span class="mk-sw3"><i></i>${t}</span>`);
      }
      if (o.dim) { const b = p.querySelector(".db-pb"); if (b) b.style.opacity = ".5"; }
    };
    put(); new MutationObserver(put).observe(p, { childList: true, subtree: true });
  });
  const bar = document.querySelector("#dashBar"); if (!bar || !o.top) return;
  const wait = info.filter((x) => !x.done), sp = bar.querySelector(".db-sp");
  const why = (x) => (x.slow ? "実績を共有から写す 3/12" : `数える ${x.sec} 秒`);
  let h = "";
  if (o.top === "inline") h = `<span class="mk-inl"><i class="mk-pg" style="--w:25%"></i><b>4 枚中 1 枚 済み</b><span>いちばん遅いのは ${wait[wait.length - 1].name}（${why(wait[wait.length - 1])}）</span></span>`;
  if (o.top === "inline-list") h = `<span class="mk-inl"><i class="mk-pg" style="--w:25%"></i><b>4 枚中 1 枚 済み</b><span>待っている: ${wait.slice(-2).reverse().map((x) => `${x.name}（${why(x)}）`).join("・")}${wait.length > 2 ? `・ほか ${wait.length - 2} 枚` : ""}</span></span>`;
  if (o.top === "sum") h = `<span class="mk-inl"><b>${wait.length} 枚を待っています</b><span>いちばん遅いのは ${wait[wait.length - 1].name}（${why(wait[wait.length - 1])}）</span></span>`;
  if (o.top === "chip") h = `<span class="mk-inl"><button type="button" class="mk-wchip"><i class="mk-ring2"></i>待っている ${wait.length} 枚 ▾</button></span>`;
  if (sp) sp.insertAdjacentHTML("beforebegin", h);
  if (o.top === "chip") {
    const c = bar.querySelector(".mk-wchip").getBoundingClientRect();
    document.body.insertAdjacentHTML("beforeend", `<div class="mk-pop mk-wpop" style="left:${c.left}px;top:${c.bottom + 6}px"><b>数を待っているパネル</b>${wait.map((x) => `<div class="mk-wl"><span>${x.name}</span><small>${x.slow ? "実績を共有から写しています 3/12" : "品質の写しから数えています"}</small><b>${x.sec} 秒</b></div>`).join("")}<small>済み: ${info.filter((x) => x.done).map((x) => x.name).join("・")}</small></div>`);
  }
}
const CSS3 = `
.mk-pair>div:first-child{padding-right:22px}.mk-pair>div+div{padding-left:18px}.mk-pair i{margin-left:8px}
.mk-s3{display:grid;grid-template-columns:auto auto auto;justify-content:start;align-items:baseline;column-gap:10px;row-gap:2px}
.mk-s3 small{font-size:12px;color:#5d6b78}.mk-s3 b{font-size:40px;font-weight:800;color:#1c2733;text-align:right;line-height:1.05;white-space:nowrap;font-variant-numeric:tabular-nums}.mk-s3 i{font-style:normal;font-size:15px;color:#5d6b78}
.mk-hs{font-size:12px;font-weight:600;color:#3b4652;margin:0 4px;white-space:nowrap;font-variant-numeric:tabular-nums}
.mk-sw3{display:inline-flex;align-items:center;gap:5px;margin-left:8px;color:#3f6591}.mk-sw3 i{width:6px;height:6px;border-radius:50%;background:#3f6591}
.mk-inl{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:8px;margin-left:14px;font-size:12px;color:#3b4652;overflow:hidden}.mk-inl>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#3b4652}.mk-inl>b{white-space:nowrap}
.mk-inl+.db-sp{flex:0 0 8px}
.mk-pg{flex:0 0 110px;height:6px;background:#e3e9ee;border-radius:3px;position:relative;overflow:hidden}.mk-pg::after{content:"";position:absolute;inset:0;width:var(--w);background:#3f6591}
.mk-wchip{display:inline-flex;align-items:center;gap:6px;border:1px solid #c9d4de;background:#fff;border-radius:16px;padding:3px 12px;font:inherit;font-size:13px;color:#24384d}
.mk-ring2{width:12px;height:12px;border:2px solid #c9d4de;border-top-color:#3f6591;border-radius:50%}
.mk-wpop{min-width:360px}.mk-wl{display:grid;grid-template-columns:1fr auto;column-gap:10px}.mk-wl span{font-weight:600}.mk-wl small{grid-column:1}.mk-wl b{grid-row:1/3;grid-column:2;align-self:center;font-variant-numeric:tabular-nums}
.mk-bfoot{grid-column:1 / -1;display:flex;flex-wrap:wrap;align-items:center;gap:14px;margin-top:6px;padding-top:6px;border-top:1px dashed #e3d3ae}
.mk-segs3 .de-seg{font-size:12px;padding:1px 8px}
`;
const fn = (f, a) => `(${f})(${JSON.stringify(a || {})})`;

const CSS = `
.mk-wrap{display:flex;flex-direction:column;justify-content:center;height:100%;padding:4px 6px;gap:6px}
.mk-wrap.mk-at-tr .mk-meta,.mk-wrap.mk-at-br .mk-meta{align-self:flex-end}
.mk-meta{color:#5d6b78;font-size:12px}
.mk-main b{font-size:64px;font-weight:800;color:#1c2733;line-height:1}.mk-main i{font-style:normal;font-size:22px;color:#5d6b78;margin-left:4px}
.mk-main span{display:block;margin-top:6px;font-size:13px;color:#3b4652}
.mk-pair{display:grid;grid-template-columns:1fr 1fr;gap:0}.mk-pair>div{padding:0 10px}.mk-pair>div+div{border-left:1px solid #d9e1e8}
.mk-pair b,.mk-stack b,.mk-main>b{white-space:nowrap;display:block}.mk-pair>div,.mk-stack>div{min-width:0;overflow:hidden}
.mk-pair small,.mk-stack small{display:block;font-size:12px;color:#5d6b78}.mk-pair b{font-size:46px;font-weight:800;color:#1c2733;line-height:1.05}
.mk-pair i,.mk-stack i{font-style:normal;font-size:16px;color:#5d6b78;margin-left:3px}
.mk-stack>div{display:flex;align-items:baseline;gap:10px}.mk-stack b{font-size:34px;font-weight:800;color:#1c2733}
.mk-ghost{position:fixed;border:2px dashed #b5822a;border-radius:10px;z-index:40;pointer-events:none}.mk-ghost span{position:absolute;left:8px;top:-22px;background:#fff8ea;color:#7a5612;font-size:12px;padding:1px 6px;border-radius:4px}
.mk-mini{position:fixed;z-index:60;width:160px;height:60px;border:1px solid #9aa8b6;background:#f3f6f9;border-radius:4px}.mk-mini span{position:absolute;left:0;top:-18px;font-size:11px;color:#5d6b78;white-space:nowrap}.mk-mini i{position:absolute;background:#b5822a;border-radius:2px}
.mk-tag{position:fixed;z-index:60;background:#fff8ea;color:#7a5612;border:1px solid #e8cf98;font-size:12px;padding:2px 8px;border-radius:4px}
.mk-box{margin:0 0 12px;padding:10px 12px;border:1px solid #e3d3ae;background:#fffaf0;border-radius:8px}
.mk-cap{display:block;font-size:14px;margin-bottom:6px}.mk-cap small{font-weight:400;color:#5d6b78;margin-left:8px;font-size:12px}
.mk-row{display:flex;align-items:center;gap:10px;margin:6px 0;font-size:13px}.mk-row>span:first-child{min-width:150px;color:#3b4652}
.mk-g9{display:inline-grid;grid-template-columns:repeat(3,18px);gap:3px}.mk-g9 i{width:18px;height:12px;border:1px solid #9aa8b6;border-radius:2px}.mk-g9 i.on{background:#3f6591;border-color:#3f6591}
.mk-sel{font:inherit;font-size:13px;padding:3px 6px}
.mk-thumbs{display:grid;grid-template-columns:repeat(6,1fr);gap:6px}
.mk-th{border:1px solid #c9d4de;background:#fff;border-radius:6px;padding:4px;display:flex;flex-direction:column;align-items:center;gap:3px;font:inherit}
.mk-th.on{border-color:#3f6591;box-shadow:0 0 0 2px #c9dbef}.mk-th span{width:100%;height:36px;background:#f3f6f9;border-radius:3px;display:flex;align-items:center;justify-content:center;gap:4px}
.mk-th span b{font-size:15px}.mk-th span small{font-size:9px;color:#5d6b78}.mk-th>small{font-size:11px;color:#3b4652}
.mk-th-stack span,.mk-th-tl span{flex-direction:column;gap:0}.mk-th-br span{align-items:flex-end}
.mk-note{font-size:13px;color:#3b4652;margin:0}
.mk-u{display:inline-flex;align-items:center;gap:4px;margin-left:8px}.mk-uin{width:64px!important}
.mk-sw{display:inline-flex;align-items:center;gap:6px;font-size:13px;margin-left:8px;cursor:pointer}.mk-sw input{display:none}.mk-sw i{width:28px;height:16px;border-radius:8px;background:#b7c2cc;position:relative}.mk-sw i::after{content:"";position:absolute;left:2px;top:2px;width:12px;height:12px;border-radius:50%;background:#fff}
.mk-pop{position:fixed;z-index:80;background:#fff;border:1px solid #c9d4de;border-radius:8px;box-shadow:0 8px 24px rgba(20,30,40,.18);padding:10px 12px;display:flex;flex-direction:column;gap:8px;font-size:13px;min-width:240px}
.mk-pop input{width:70px;font:inherit;padding:2px 6px}.mk-pop small{color:#5d6b78}
.mk-pill{display:inline-block;background:#3f4b57;color:#fff;border-radius:4px;padding:0 8px;font-size:12px}
.mk-tbl{width:100%;border-collapse:collapse;font-size:13px}.mk-tbl th{text-align:left;color:#5d6b78;font-weight:600;border-bottom:1px solid #e3d3ae;padding:4px}.mk-tbl td{padding:5px 4px;border-bottom:1px solid #f0e6cf}.mk-tbl input{width:70px;font:inherit;padding:2px 6px}
.mk-gear{margin-left:4px;border:0;background:#fff3;color:#fff;border-radius:50%;width:20px;height:20px;font-size:12px;line-height:20px;padding:0;outline:2px solid #fff}
.mk-hot{outline:2px solid #b5822a;outline-offset:-2px}
.mk-bar{position:absolute;left:0;top:0;height:3px;width:var(--w);background:#3f6591;border-radius:3px 0 0 0;z-index:3}.mk-bar.done{background:#2f7d78}
.db-p{position:relative}
.mk-chip{white-space:nowrap;max-width:calc(100% - 20px);overflow:hidden;position:absolute;right:10px;bottom:8px;z-index:4;margin:0;padding:4px 10px;background:#fff;border:1px solid #c9d4de;border-radius:6px;box-shadow:0 2px 6px rgba(20,30,40,.08);font-size:12px;color:#3b4652;display:flex;align-items:center;gap:8px}
.mk-chip small{color:#5d6b78}.mk-chip b{font-variant-numeric:tabular-nums}
.mk-chip .mk-steps i{font-style:normal;padding:1px 7px;border-radius:9px;background:#eef2f5;color:#7a8794;margin-right:3px}.mk-chip .mk-steps i.ok{background:#e1efe9;color:#24614f}.mk-chip .mk-steps i.now{background:#3f6591;color:#fff}
.mk-cover{position:absolute;inset:34px 0 0;z-index:4;margin:0;background:rgba(255,255,255,.82);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;font-size:13px;color:#3b4652}.mk-cover small{color:#5d6b78}
.mk-wait{margin:10px 0 0;font-size:13px;color:#3b4652}.mk-wait small{display:block;color:#5d6b78;font-size:12px;margin-top:2px}.mk-wait b{font-variant-numeric:tabular-nums}
.mk-c{display:flex;flex-direction:column;align-items:center;justify-content:center;height:60%}
.mk-ring{width:26px;height:26px;border:3px solid #c9d4de;border-top-color:#3f6591;border-radius:50%;margin-bottom:6px}
.mk-steps{display:flex;gap:4px;list-style:none;padding:0;margin:10px 0 0;font-size:12px}.mk-steps li{padding:2px 8px;border-radius:10px;background:#eef2f5;color:#7a8794}.mk-steps li.ok{background:#e1efe9;color:#24614f}.mk-steps li.now{background:#3f6591;color:#fff}
.mk-top{display:inline-flex;align-items:center;gap:8px;margin-left:12px;font-size:12px;color:#3b4652}.mk-top i{width:120px;height:6px;background:#e3e9ee;border-radius:3px;position:relative;overflow:hidden}.mk-top i::after{content:"";position:absolute;inset:0;width:var(--w);background:#3f6591}.mk-top small{color:#5d6b78;max-width:520px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
`;

export const PROPOSALS = [
  { key: "now", name: "今", css: "", at: {} },
  { key: "A", name: "A 値の計算の段に単位と式の切り替え・9 か所の置き場・パネルの細い進み",
    css: CSS, at: { table: fn(fixTable, { expr: false }) + ";" + fn(kpiFinal, { pair: "side", meta: "bl" }), kpiEdit: fn(kpiGeom, { mode: "actual" }) + ";" + fn(kpiFinal, { pair: "side", meta: "bl" }) + ";" + fn(kpiControls, { kind: "segs" }),
      tableEdit: fn(kpiGeom, { mode: "actual" }) + ";" + fn(fixTable, { expr: false }) + ";" + fn(calcBand, { kind: "band" }), wait: fn(waitShow, { kind: "bar", top: "count" }) } },
  { key: "B", name: "B 見本の上で直す（見出し・数字を押す／引く）・1.5 倍の見本・道具の行の進み",
    css: CSS, at: { table: fn(fixTable, { expr: false }) + ";" + fn(kpiFinal, { pair: "side", meta: "tr" }), kpiEdit: fn(kpiGeom, { mode: "scale" }) + ";" + fn(kpiFinal, { pair: "side", meta: "tr" }) + ";" + fn(kpiControls, { kind: "drag" }),
      tableEdit: fn(kpiGeom, { mode: "scale" }) + ";" + fn(fixTable, { expr: false }) + ";" + fn(headPop), wait: fn(waitShow, { kind: "spin", top: "slow" }) } },
  { key: "C", name: "C 書式のタブに値ごとの表・選ぶ箱の置き方・実寸を左に置いて置き場を点線で・段の札",
    css: CSS, at: { table: fn(fixTable, { expr: false }) + ";" + fn(kpiFinal, { pair: "side", meta: "bl" }), kpiEdit: fn(kpiGeom, { mode: "left" }) + ";" + fn(kpiFinal, { pair: "side", meta: "bl" }) + ";" + fn(kpiControls, { kind: "drop" }),
      tableEdit: fn(kpiGeom, { mode: "left" }) + ";" + fn(fixTable, { expr: false }) + ";" + fn(fmtTable), wait: fn(waitShow, { kind: "steps", top: "" }) } },
  { key: "D", name: "D 値の札の歯車で単位と式・見本の札で置き方・実寸・待っているパネルの名前の並び",
    css: CSS, at: { table: fn(fixTable, { expr: false }) + ";" + fn(kpiFinal, { pair: "stack", meta: "tl" }), kpiEdit: fn(kpiGeom, { mode: "actual" }) + ";" + fn(kpiFinal, { pair: "stack", meta: "tl" }) + ";" + fn(kpiControls, { kind: "thumbs" }),
      tableEdit: fn(kpiGeom, { mode: "actual" }) + ";" + fn(fixTable, { expr: false }) + ";" + fn(calcBand, { kind: "chip" }), wait: fn(waitShow, { kind: "bar", top: "list" }) } },
  { key: "E", name: "E 見出しの式はパネルで 1 つの切り替え・単位は値の段・主と添えのまま・丸い待ち",
    css: CSS, at: { table: fn(fixTable, { expr: false }) + ";" + fn(kpiFinal, { pair: "main", meta: "bl" }), kpiEdit: fn(kpiGeom, { mode: "actual" }) + ";" + fn(kpiFinal, { pair: "main", meta: "bl" }) + ";" + fn(kpiControls, { kind: "drop" }),
      tableEdit: fn(kpiGeom, { mode: "actual" }) + ";" + fn(fixTable, { expr: false }) + ";" + fn(calcBand, { kind: "band" }) + ";" + fn(panelToggle), wait: fn(waitShow, { kind: "spin", top: "" }) } },
  { key: "F", name: "F 値の計算の段に単位と式＋見本の札で置き方（2 つ並べる・添え書き）・実寸・パネルの進み＋道具の行の数",
    css: CSS, at: { table: fn(fixTable, { expr: false }) + ";" + fn(kpiFinal, { pair: "side", meta: "br" }), kpiEdit: fn(kpiGeom, { mode: "actual" }) + ";" + fn(kpiFinal, { pair: "side", meta: "br" }) + ";" + fn(kpiControls, { kind: "thumbs" }),
      tableEdit: fn(kpiGeom, { mode: "actual" }) + ";" + fn(fixTable, { expr: false }) + ";" + fn(calcBand, { kind: "band" }), wait: fn(waitShow, { kind: "bar", top: "slow" }) } },
  // ---- 2 回目（1 回目の F・A の効いた所を持ち越し・採点の指摘を直した F2・H と、新しい G・I・J）
  { key: "F2", name: "F2 値の計算の段に単位と式（セルに単位）・③ の下に見本の札 6 つ・見出しの横に待ちの字＋道具の行の下に進み",
    css: CSS + CSS2, at: { table: fn(fixTable2, { unit: "cell" }) + ";" + fn(kpiFinal, { pair: "side", meta: "bl" }), kpiEdit: fn(kpiGeom, { mode: "actual" }) + ";" + fn(kpiFinal, { pair: "side", meta: "bl" }) + ";" + fn(kpiControls2, { kind: "thumbs", on: "side" }),
      tableEdit: fn(kpiGeom, { mode: "actual" }) + ";" + fn(fixTable2, { unit: "cell" }) + ";" + fn(calcBand, { kind: "band" }), wait: fn(waitShow2, { bar: true, head: "text", top: "slow" }) } },
  { key: "G", name: "G 値の書式の表（計算・小数・単位・見出しに式を 1 行に。まとめて切り替え）・見本の札・見出しの横に段の札",
    css: CSS + CSS2, at: { table: fn(fixTable2, { unit: "cell" }) + ";" + fn(kpiFinal, { pair: "side", meta: "bl" }), kpiEdit: fn(kpiGeom, { mode: "actual" }) + ";" + fn(kpiFinal, { pair: "side", meta: "bl" }) + ";" + fn(kpiControls2, { kind: "thumbs", on: "side" }),
      tableEdit: fn(kpiGeom, { mode: "actual" }) + ";" + fn(fixTable2, { unit: "cell" }) + ";" + fn(calcTable), wait: fn(waitShow2, { bar: true, head: "steps", top: "" }) } },
  { key: "H", name: "H 値の計算の段（見出しに単位）・字の付いた 6 か所の升と 2 つの並べ方・道具の行の下に待っているパネルの並び",
    css: CSS + CSS2, at: { table: fn(fixTable2, { unit: "head" }) + ";" + fn(kpiFinal, { pair: "side", meta: "bl" }), kpiEdit: fn(kpiGeom, { mode: "actual" }) + ";" + fn(kpiFinal, { pair: "side", meta: "bl" }) + ";" + fn(kpiControls2, { kind: "grid" }),
      tableEdit: fn(kpiGeom, { mode: "actual" }) + ";" + fn(fixTable2, { unit: "head" }) + ";" + fn(calcBand, { kind: "band" }), wait: fn(waitShow2, { bar: true, head: "text", top: "list" }) } },
  { key: "I", name: "I 値の書式の表・見本のパネルの上に置き方の小さな道具の行（値・期間）・見出しの横に待ちの字",
    css: CSS + CSS2, at: { table: fn(fixTable2, { unit: "cell" }) + ";" + fn(kpiFinal, { pair: "side", meta: "bl" }), kpiEdit: fn(kpiGeom, { mode: "actual" }) + ";" + fn(kpiFinal, { pair: "side", meta: "bl" }) + ";" + fn(kpiFloatBar),
      tableEdit: fn(kpiGeom, { mode: "actual" }) + ";" + fn(fixTable2, { unit: "cell" }) + ";" + fn(calcTable), wait: fn(waitShow2, { bar: false, head: "text", top: "slow" }) } },
  { key: "J", name: "J 値の計算の段（セルに単位）・見本の札・待ちは道具の行の下の 1 行だけ（パネルは細い進みの線）",
    css: CSS + CSS2, at: { table: fn(fixTable2, { unit: "cell" }) + ";" + fn(kpiFinal, { pair: "stack", meta: "tl" }), kpiEdit: fn(kpiGeom, { mode: "actual" }) + ";" + fn(kpiFinal, { pair: "stack", meta: "tl" }) + ";" + fn(kpiControls2, { kind: "thumbs", on: "stack" }),
      tableEdit: fn(kpiGeom, { mode: "actual" }) + ";" + fn(fixTable2, { unit: "cell" }) + ";" + fn(calcBand, { kind: "band" }), wait: fn(waitShow2, { bar: true, head: "", top: "list" }) } },
// ---- 3 回目（F2 を直した F3 と、新しい K・L・M・N）
  { key: "F3", name: "F3 F2 を直した形（待ちは題の横に秒だけ・理由は添え書きの段・道具の行の空きに進み・すべての見出しに式・単位と仕切りの間を空ける）",
    css: CSS + CSS2 + CSS3, at: { table: fn(fixTable2, { unit: "cell" }) + ";" + fn(kpiFinal, { pair: "side", meta: "bl" }), kpiEdit: fn(kpiGeom, { mode: "actual" }) + ";" + fn(kpiFinal, { pair: "side", meta: "bl" }) + ";" + fn(kpiControls2, { kind: "thumbs", on: "side" }),
      tableEdit: fn(kpiGeom, { mode: "actual" }) + ";" + fn(fixTable2, { unit: "cell" }) + ";" + fn(calcBand3, { all: true }), wait: fn(waitShow3, { bar: true, head: true, sub: true, top: "inline" }) } },
  { key: "K", name: "K 単位の置き場を選べる（数の後ろ／見出しに）・待っているパネルの名前を道具の行の空きに並べる",
    css: CSS + CSS2 + CSS3, at: { table: fn(fixTable2, { unit: "head" }) + ";" + fn(kpiFinal, { pair: "side", meta: "bl" }), kpiEdit: fn(kpiGeom, { mode: "actual" }) + ";" + fn(kpiFinal, { pair: "side", meta: "bl" }) + ";" + fn(kpiControls2, { kind: "thumbs", on: "side" }),
      tableEdit: fn(kpiGeom, { mode: "actual" }) + ";" + fn(fixTable2, { unit: "head" }) + ";" + fn(calcBand3, { all: true, place: true }), wait: fn(waitShow3, { bar: true, head: true, sub: true, top: "inline-list" }) } },
  { key: "L", name: "L 上下に並べた 2 つの値を同じ大きさで右に揃える・待つ間は前回の数を薄く残し添え書きの段に「数え直しています」",
    css: CSS + CSS2 + CSS3, at: { table: fn(fixTable2, { unit: "cell" }) + ";" + fn(kpiStack3), kpiEdit: fn(kpiGeom, { mode: "actual" }) + ";" + fn(kpiStack3) + ";" + fn(kpiControls2, { kind: "thumbs", on: "stack" }),
      tableEdit: fn(kpiGeom, { mode: "actual" }) + ";" + fn(fixTable2, { unit: "cell" }) + ";" + fn(calcBand3, { all: true }), wait: fn(waitShow3, { bar: false, head: true, sub: "prev", dim: true, top: "inline" }) } },
  { key: "M", name: "M 見出しの式は「式を出す／出さない」の 2 択・道具の行の「待っている n 枚 ▾」から待っているパネルと理由の一覧",
    css: CSS + CSS2 + CSS3, at: { table: fn(fixTable2, { unit: "cell" }) + ";" + fn(kpiFinal, { pair: "side", meta: "bl" }), kpiEdit: fn(kpiGeom, { mode: "actual" }) + ";" + fn(kpiFinal, { pair: "side", meta: "bl" }) + ";" + fn(kpiControls2, { kind: "thumbs", on: "side" }),
      tableEdit: fn(kpiGeom, { mode: "actual" }) + ";" + fn(fixTable2, { unit: "cell" }) + ";" + fn(calcBand3, { seg: true }), wait: fn(waitShow3, { bar: true, head: true, top: "chip" }) } },
  { key: "N", name: "N 単位は見出しに（t）・見出しの式は 2 択＋すべて・待ちはパネルの添え書きの段だけ（道具の行は待っている枚数と遅いパネル）",
    css: CSS + CSS2 + CSS3, at: { table: fn(fixTable2, { unit: "head" }) + ";" + fn(kpiFinal, { pair: "side", meta: "bl" }), kpiEdit: fn(kpiGeom, { mode: "actual" }) + ";" + fn(kpiFinal, { pair: "side", meta: "bl" }) + ";" + fn(kpiControls2, { kind: "thumbs", on: "side" }),
      tableEdit: fn(kpiGeom, { mode: "actual" }) + ";" + fn(fixTable2, { unit: "head" }) + ";" + fn(calcBand3, { seg: true, all: true }), wait: fn(waitShow3, { bar: false, head: false, sub: true, top: "sum" }) } },
];
