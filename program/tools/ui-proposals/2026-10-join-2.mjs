// 2026-10 データ元の結合と「マスタ」のタブ。2 回目（合格点 80 点）。
//   node program/tools/ui-variants.mjs 出力 program/tools/ui-proposals/2026-10-join-2.mjs --states master-sources,master-sources-join --from master
//   node program/tools/ui-variants.mjs 出力 program/tools/ui-proposals/2026-10-join-2.mjs --states mst-tab --from tabs-menu
// 1 回目（2026-10-join.mjs・.json）: 1 位 D 76.8・2 位 A 76.6（合格点 80 に届かず）。採点者が挙げた直す所:
//   A: 方式の札のベン図が小さい（34px）・方式ごとに何行になるかが出ない・1280 で保存が送った先・「相手 8 行・鍵の重なり 0」が弱く分かりにくい
//   D: 窓の段を順に送る手が多い・方式の段で鍵が見比べられない・欄の形と違う型・カードに外す手が見えない
//   マスタのタブは札の段で良い（C の ▾ は見ているマスタが見えない）→ どの案も札の段
// 案（持ち越し 2・新しい案 3）:
//   A2 A を直す: 方式の札を大きく（48px）し、札ごとに残る行の数・保存の段を欄の下に貼り付ける・相手の数を言葉で
//   D2 D を直す: 窓の段の札を押して飛べる（順に送らない）・方式の段の上に鍵の組の小さな表・カードの要約に「直す…」「外す」
//   G  新: A の流れで、方式は 4 枚のカード（ベン図 64px・名前・一言・残る行の数）を 1 段に。保存の段を貼り付け
//   H  新: 結合 1 件を 1 行の要約（ベン図・相手・鍵・方式・数）にし、押すとその場で開く（アコーディオン）。開いた中は G の形
//   J  新: 2 列: 左に相手・鍵・持ってくる列（欄の形）、右に方式の 4 枚を 2×2（ベン図 56px・残る行の数）。保存の段を貼り付け
const venn = (id, how, size = 40) => {
  const L = how === "left" || how === "full", R = how === "right" || how === "full";
  const h = Math.round(size * 0.6);
  return `<svg class="jv" viewBox="0 0 60 36" width="${size}" height="${h}" aria-hidden="true"><defs><clipPath id="c${id}"><circle cx="23" cy="18" r="13"/></clipPath></defs>`
    + `<circle cx="23" cy="18" r="13" fill="${L ? "#9fc2ea" : "#fff"}"/><circle cx="37" cy="18" r="13" fill="${R ? "#9fc2ea" : "#fff"}"/>`
    + `<circle cx="37" cy="18" r="13" clip-path="url(#c${id})" fill="#3f7fcf"/>`
    + `<circle cx="23" cy="18" r="13" fill="none" stroke="#2c5f99" stroke-width="1.6"/><circle cx="37" cy="18" r="13" fill="none" stroke="#b5741f" stroke-width="1.6"/></svg>`;
};
const HOWS = [["inner", "内部結合", "両方にある行だけ"], ["left", "左外部結合", "品質データの行は全部残す"], ["right", "右外部結合", "相手の行は全部残す"], ["full", "完全外部結合", "両方の行を全部残す"]];
const seg = (p) => `<div class="jn-seg" role="radiogroup" aria-label="結合の方式">${HOWS.map(([k, n, t]) =>
  `<button type="button" role="radio" aria-checked="${k === "left"}" title="${t}">${venn(p + k, k, 34)}<span>${n}</span></button>`).join("")}</div>`;
const sel = (v) => `<select class="jn-s"><option>${v}</option></select>`;
const keyRows = `<div class="jn-k"><span class="jn-side l">品質データ</span>${sel("合金")}<b class="jn-eq">＝</b><span class="jn-side r">製造条件マスタ</span>${sel("材質")}<button type="button" class="jn-x" title="この鍵を外す">×</button></div>
  <div class="jn-k"><span class="jn-side l">品質データ</span>${sel("調質")}<b class="jn-eq">＝</b><span class="jn-side r">製造条件マスタ</span>${sel("質別")}<button type="button" class="jn-x" title="この鍵を外す">×</button></div>
  <button type="button" class="jn-addk">＋ 鍵を足す</button>`;
const cols = `<div class="jn-cols"><span class="jn-lab">持ってくる列</span>${["圧延速度", "焼鈍温度", "板厚公差", "改訂日"].map((c) => `<label class="jn-c"><input type="checkbox" checked>${c}</label>`).join("")}</div>`;
const result = `<div class="jn-res"><b class="ok">✓ 1,339 行が当たりました</b><span class="ng">161 行は相手がありません（例: A3004 / H24）</span><span>相手 8 行・鍵の重なり 0</span></div>`;
const head = (sub) => `<div class="jn-h"><b>結合</b><small>${sub}</small></div>`;
const withSel = `<label class="jn-with"><span class="jn-lab">相手</span><select class="jn-s"><option>製造条件マスタ</option></select></label>`;

const bigVenn = (w) => `<svg class="jn-big" viewBox="0 0 300 170" width="${w}" height="${Math.round(w * 0.567)}" role="img" aria-label="残す行">
  <defs><clipPath id="evc"><circle cx="115" cy="85" r="78"/></clipPath></defs>
  <circle cx="115" cy="85" r="78" fill="#9fc2ea"/><circle cx="185" cy="85" r="78" fill="#fff"/><circle cx="185" cy="85" r="78" clip-path="url(#evc)" fill="#3f7fcf"/>
  <circle cx="115" cy="85" r="78" fill="none" stroke="#2c5f99" stroke-width="2"/><circle cx="185" cy="85" r="78" fill="none" stroke="#b5741f" stroke-width="2" stroke-dasharray="5 4"/>
  <text x="72" y="80" text-anchor="middle" font-size="11.5" fill="#123">この元だけ</text><text x="75" y="100" text-anchor="middle" font-size="17" font-weight="700" fill="#123">161</text>
  <text x="150" y="80" text-anchor="middle" font-size="11.5" fill="#fff">両方</text><text x="150" y="100" text-anchor="middle" font-size="17" font-weight="700" fill="#fff">1,339</text>
  <text x="228" y="80" text-anchor="middle" font-size="11.5" fill="#5a6470">相手だけ</text><text x="225" y="100" text-anchor="middle" font-size="17" font-weight="700" fill="#5a6470">0</text></svg>`;
/* 閉じたカードの要約（どの案も同じ）: 品質データのカードの下の行に、ベン図と結合の 1 行 */
const SUMMARY = `<div class="jn-card sr-w">${venn("sum", "left", 30)}<span>結合 <b>製造条件マスタ</b> を左外部結合（合金 = 材質・調質 = 質別）・4 列</span><span class="ok">1,339 / 1,500 行が当たる</span></div>`;

const COUNTS = { inner: 1339, left: 1500, right: 1339, full: 1500 };
const keyRows2 = keyRows;
const result2 = `<div class="jn-res"><b class="ok">✓ 1,339 行が当たりました</b><span class="ng">161 行は相手がありません（例: A3004 / H24）</span><span class="mut">製造条件マスタの 8 行はどれも使われています・同じ鍵の行の重なりはありません</span></div>`;
const seg2 = (p, size = 48) => `<div class="jn-seg2" role="radiogroup" aria-label="結合の方式">${HOWS.map(([k, n, t]) =>
  `<button type="button" role="radio" aria-checked="${k === "left"}" title="${t}">${venn(p + k, k, size)}<span><b>${n}</b><small>${COUNTS[k].toLocaleString()} 行</small></span></button>`).join("")}</div>`;
const cards = (p, size, cls = "") => `<div class="jn-cards ${cls}" role="radiogroup" aria-label="結合の方式">${HOWS.map(([k, n, t]) =>
  `<button type="button" role="radio" aria-checked="${k === "left"}">${venn(p + k, k, size)}<b>${n}</b><small>${t}</small><span>${COUNTS[k].toLocaleString()} 行</span></button>`).join("")}</div>`;
const withSel2 = `<label class="jn-with"><span class="jn-lab">相手</span><select class="jn-s"><option>製造条件マスタ</option></select></label>`;
const delBtn = '<button type="button" class="jn-del" title="この結合を外す">外す</button>';

const A2 = `<div class="jn sr-w pvA2">${head("ほかのデータ元の列を、鍵が同じ行から持ってきます")}
  <div class="jn-item"><div class="jn-top">${withSel2}${delBtn}</div>
  <div><span class="jn-lab">方式（残す行）</span>${seg2("a2")}</div>
  <div class="jn-keys"><span class="jn-lab">鍵（全部が同じ値の行を合わせる）</span>${keyRows2}</div>${cols}${result2}</div>
  <button type="button" class="pz-btn jn-add">＋ 結合を足す（この答えに、さらに重ねる）</button></div>`;

const D2 = `<div class="jn sr-w pvD">${head("")}<div class="jn-sum">${venn("ds2", "left", 40)}<span><b>製造条件マスタ</b> を左外部結合（合金 = 材質・調質 = 質別）・4 列</span><span class="ok">1,339 / 1,500 行が当たる</span><button type="button" class="pz-btn">直す…</button><button type="button" class="jn-del">外す</button></div>
  <button type="button" class="pz-btn jn-add">＋ 結合を足す</button></div>`;
const D2win = `<div class="pvD-win" role="dialog"><header><b>結合を組む — 品質データ</b><button type="button" class="pvD-x">×</button></header>
  <div class="pvD-steps2" role="tablist"><button class="done">1 相手 <small>製造条件マスタ</small></button><button class="done">2 鍵 <small>2 つ</small></button><button class="on" aria-selected="true">3 方式 <small>左外部結合</small></button><button>4 列 <small>4 列</small></button></div>
  <div class="pvD-body"><table class="pvD-keys"><tr><th class="l">品質データ</th><th></th><th class="r">製造条件マスタ</th></tr><tr><td>合金</td><td>＝</td><td>材質</td></tr><tr><td>調質</td><td>＝</td><td>質別</td></tr></table>
  <div class="pvD-cards">${HOWS.map(([k, n, t]) => `<button type="button" class="pvD-card${k === "left" ? " on" : ""}">${venn("dw2" + k, k, 96)}<b>${n}</b><small>${t}</small><span>${COUNTS[k].toLocaleString()} 行</span></button>`).join("")}</div></div>
  <footer><button type="button" class="btn-ghost">閉じる</button><span></span><button type="button" class="btn-primary">これで決める</button></footer></div>`;

const G = `<div class="jn sr-w pvG">${head("ほかのデータ元の列を、鍵が同じ行から持ってきます")}
  <div class="jn-item"><div class="jn-top">${withSel2}${delBtn}</div>
  <div class="jn-keys"><span class="jn-lab">鍵（全部が同じ値の行を合わせる）</span>${keyRows2}</div>
  <div><span class="jn-lab">方式（どの行を残すか）</span>${cards("g", 64)}</div>${cols}${result2}</div>
  <button type="button" class="pz-btn jn-add">＋ 結合を足す（この答えに、さらに重ねる）</button></div>`;

const H = `<div class="jn sr-w pvH">${head("1 件ずつ押すと開きます")}
  <div class="jn-acc"><button type="button" class="jn-acc-h" aria-expanded="true"><span class="tw">▼</span>${venn("h0", "left", 36)}<b>製造条件マスタ</b><span>合金 = 材質・調質 = 質別</span><span class="how">左外部結合</span><span class="ok">1,339 / 1,500 行</span></button>
  <div class="jn-acc-b">${withSel2}<div class="jn-keys"><span class="jn-lab">鍵</span>${keyRows2}</div><div><span class="jn-lab">方式</span>${cards("h", 56)}</div>${cols}${result2}<div>${delBtn}</div></div></div>
  <div class="jn-acc"><button type="button" class="jn-acc-h" aria-expanded="false"><span class="tw">▶</span>${venn("h1", "left", 36)}<b>設備マスタ</b><span>設備 = 設備名</span><span class="how">左外部結合</span><span class="ok">1,500 / 1,500 行</span></button></div>
  <button type="button" class="pz-btn jn-add">＋ 結合を足す</button></div>`;

const J = `<div class="jn sr-w pvJ">${head("ほかのデータ元の列を、鍵が同じ行から持ってきます")}
  <div class="jn-item"><div class="jn-j"><div class="jn-j-l"><div class="jn-top">${withSel2}${delBtn}</div>
  <div class="jn-keys"><span class="jn-lab">鍵（全部が同じ値の行を合わせる）</span>${keyRows2}</div>${cols}</div>
  <div class="jn-j-r"><span class="jn-lab">方式（どの行を残すか）</span>${cards("j", 52, "g2")}</div></div>${result2}</div>
  <button type="button" class="pz-btn jn-add">＋ 結合を足す（この答えに、さらに重ねる）</button></div>`;

const css = `
.sr-card.is-open .sr-acts{position:sticky;bottom:-1px;z-index:3;background:#fff;padding:8px 0 6px;border-top:1px solid var(--line);margin-top:2px}
.jn-res .mut{color:#4c5864}
.jn-seg2{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin-top:4px}
.jn-seg2 button{display:flex;align-items:center;gap:8px;padding:6px 10px;border:1px solid var(--line);border-radius:8px;background:#fff;text-align:left;cursor:pointer}
.jn-seg2 button span{display:flex;flex-direction:column;font-size:13px}.jn-seg2 small{color:#4c5864;font-size:12px}
.jn-seg2 button[aria-checked=true]{border:2px solid #3f7fcf;background:#f2f7fd;padding:5px 9px}
.jn-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:4px}
.jn-cards.g2{grid-template-columns:repeat(2,minmax(0,1fr))}
.jn-cards button{display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 6px;border:1px solid var(--line);border-radius:10px;background:#fff;cursor:pointer}
.jn-cards button b{font-size:13.5px}.jn-cards button small{font-size:12px;color:#4c5864}.jn-cards button span{font-size:13px;font-weight:700}
.jn-cards button[aria-checked=true]{border:2px solid #3f7fcf;background:#f2f7fd;padding:7px 5px}
.pvD .jn-sum .jn-del{margin-left:0}.pvD .jn-sum .pz-btn{margin-left:auto}
.pvD-steps2{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:12px 18px;border-bottom:1px solid var(--line)}
.pvD-steps2 button{display:flex;flex-direction:column;align-items:center;padding:6px;border:1px solid var(--line);border-radius:8px;background:#fff;font-size:13px;font-weight:700;color:#1f4f86}
.pvD-steps2 button small{font-weight:400;color:#4c5864}.pvD-steps2 button.on{border:2px solid #3f7fcf;background:#f2f7fd}
.pvD-keys{border-collapse:collapse;margin:0 0 12px;font-size:13px}.pvD-keys th,.pvD-keys td{padding:3px 10px;border-bottom:1px solid #e3e9ef}.pvD-keys th.l{color:#1f4f86}.pvD-keys th.r{color:#7a4a0c}
.jn-acc{border:1px solid #d7e1ec;border-radius:8px;background:#fff}
.jn-acc-h{display:flex;align-items:center;gap:10px;width:100%;padding:8px 12px;border:0;background:none;font-size:13.5px;text-align:left;cursor:pointer}
.jn-acc-h .tw{color:#4c5864;font-size:11px;width:12px}.jn-acc-h .how{color:#1f4f86;font-weight:700}.jn-acc-h .ok{margin-left:auto;color:#1d6b33}
.jn-acc-b{display:flex;flex-direction:column;gap:10px;padding:4px 12px 12px;border-top:1px solid #e3e9ef}
.jn-j{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:16px;align-items:start}.jn-j-l{display:flex;flex-direction:column;gap:10px}

.jn{grid-column:1 / -1;border:1px solid var(--line);border-radius:10px;padding:12px 14px;background:#f7fafd;display:flex;flex-direction:column;gap:10px}
.jn-h{display:flex;align-items:baseline;gap:10px}.jn-h b{font-size:15px}.jn-h small{color:var(--muted);font-size:12.5px}
.jn-item{border:1px solid #d7e1ec;background:#fff;border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;gap:10px}
.jn-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.jn-lab{font-size:12.5px;color:var(--muted);font-weight:600}
.jn-with{display:flex;align-items:center;gap:8px}.jn-s{height:30px;padding:0 8px;border:1px solid var(--line);border-radius:6px;background:#fff;font-size:13.5px;min-width:110px}
.jn-seg{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden}.jn-seg button{display:flex;align-items:center;gap:4px;padding:3px 10px 3px 6px;border:0;border-right:1px solid var(--line);background:#fff;font-size:12.5px;color:var(--ink);cursor:pointer}
.jn-seg button:last-child{border-right:0}.jn-seg button[aria-checked=true]{background:#e4effb;box-shadow:inset 0 -3px 0 #3f7fcf;font-weight:700}
.jn-del{margin-left:auto;height:28px;padding:0 10px;border:1px solid var(--line);border-radius:6px;background:#fff;color:#a33;font-size:12.5px}
.jn-keys{display:flex;flex-direction:column;gap:6px}.jn-k{display:grid;grid-template-columns:auto 150px 24px auto 150px 28px;align-items:center;gap:6px;justify-content:start}
.jn-side{font-size:12px;padding:2px 7px;border-radius:10px;white-space:nowrap}.jn-side.l{background:#e4effb;color:#1f4f86}.jn-side.r{background:#fbefdc;color:#7a4a0c}
.jn-eq{text-align:center;color:#3f7fcf}.jn-x{width:26px;height:26px;border:1px solid var(--line);border-radius:6px;background:#fff;color:var(--muted)}
.jn-addk,.jn-add{align-self:flex-start;height:28px;padding:0 10px;font-size:12.5px;border:1px dashed #9db3cc;border-radius:6px;background:#fff;color:#1f4f86}
.jn-cols{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px}.jn-c{display:inline-flex;align-items:center;gap:4px;font-size:13px;padding:2px 8px;border:1px solid #e6d3b5;border-radius:12px;background:#fffaf2}
.jn-res{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:13px;padding:6px 10px;border-radius:6px;background:#f1f6ec}.jn-res .ok{color:#1d6b33}.jn-res .ng{color:#8a4b00}.jn-res span{color:var(--muted)}.jn-res .ng{color:#8a4b00}
.jn-card{grid-column:2 / -1;display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink)}.jn-card .ok{color:#1d6b33;font-size:12.5px}
.pvB .jn-er{display:grid;grid-template-columns:220px 1fr 220px;align-items:start;gap:0}.pvB .jn-midcol{position:relative;height:208px}
.pvB .jn-box{border:1px solid var(--line);border-radius:8px;background:#fff;overflow:hidden}.pvB .jn-box h5{margin:0;padding:6px 10px;font-size:13.5px;display:flex;justify-content:space-between}
.pvB .jn-box.l h5{background:#e4effb;color:#1f4f86}.pvB .jn-box.r h5{background:#fbefdc;color:#7a4a0c}.pvB .jn-box small{font-weight:400;color:var(--muted)}
.pvB .jn-box h5{height:32px;box-sizing:border-box;align-items:center}.pvB .jn-box ul{list-style:none;margin:0;padding:4px 0}.pvB .jn-box li{padding:3px 10px;font-size:13px;height:28px;box-sizing:border-box}
.pvB .jn-box li.k{background:#dbe9f8;font-weight:700;color:#1f4f86}.pvB .jn-box li.more{color:var(--muted)}.pvB .jn-lines{position:absolute;inset:0;width:100%;height:208px}
.pvB .jn-mid{position:absolute;left:50%;bottom:0;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:4px;background:#f7fafd;padding:4px 8px;border-radius:8px}.pvB .jn-mid small{font-size:12px;color:var(--muted);text-align:center}
.pvB .jn-tip{font-size:12.5px;color:var(--muted)}
.pvC .jn-sent{margin:0;line-height:2.3;font-size:14px}.pvC .jn-pair{background:#eef4fb;border-radius:6px;padding:3px 4px}.pvC .jn-chip{height:28px;border:1px solid #e6d3b5;background:#fffaf2;border-radius:14px;padding:0 10px;font-size:13px}
.pvC .jn-how{display:inline-flex;align-items:center;gap:4px;font-size:12.5px;color:var(--muted);vertical-align:middle}.pvC .jn-s{min-width:80px}
.pvD .jn-sum{display:flex;align-items:center;gap:10px;font-size:13.5px}.pvD .jn-sum .ok{color:#1d6b33;font-size:12.5px}.pvD .jn-sum .pz-btn{margin-left:auto}
.pvD-win{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:860px;background:#fff;border-radius:12px;box-shadow:0 20px 60px rgba(10,30,50,.35);z-index:9999;display:flex;flex-direction:column}
.pvD-win header{display:flex;justify-content:space-between;align-items:center;padding:12px 18px;background:#123c5a;color:#fff;border-radius:12px 12px 0 0}.pvD-x{background:none;border:0;color:#fff;font-size:18px}
.pvD-steps{display:flex;gap:0;margin:0;padding:12px 18px;list-style:none;border-bottom:1px solid var(--line)}.pvD-steps li{flex:1;text-align:center;padding:6px;font-size:13px;color:var(--muted);border-bottom:3px solid #e1e7ee}
.pvD-steps li.done{color:#1d6b33;border-color:#8cc59a}.pvD-steps li.on{color:#1f4f86;font-weight:700;border-color:#3f7fcf}
.pvD-body{padding:14px 18px}.pvD-body p{margin:0 0 12px;font-size:13.5px}.pvD-cards{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.pvD-card{display:flex;flex-direction:column;align-items:center;gap:4px;padding:12px 6px;border:1px solid var(--line);border-radius:10px;background:#fff}.pvD-card.on{border:2px solid #3f7fcf;background:#f2f7fd}
.pvD-card small{font-size:12px;color:var(--muted)}.pvD-card span{font-size:13px;font-weight:700}
.pvD-win footer{display:flex;gap:8px;padding:12px 18px;border-top:1px solid var(--line)}.pvD-win footer span{flex:1}
.pvE .jn-e{display:grid;grid-template-columns:320px 1fr;gap:16px;align-items:start}.pvE .jn-e-r{display:flex;flex-direction:column;gap:10px}
.jn-e-leg{display:flex;justify-content:space-between;font-size:12.5px;margin-top:2px}.jn-e-leg .l{color:#1f4f86}.jn-e-leg .r{color:#7a4a0c}.jn-e-leg b{color:#1f4f86}
.pvF .jn-f{display:grid;grid-template-columns:1fr 260px;gap:16px;align-items:start}.pvF .jn-f-v{display:flex;flex-direction:column;gap:4px}
.sr-form .jn label.jn-with,.sr-form .jn label.jn-c{flex-direction:row;align-items:center}
.sr-form .jn label.jn-with{gap:8px}.sr-form .jn label.jn-c{gap:4px;font-size:13px}
.pvM-hide{display:none!important}
.pvM-mnu{position:absolute;z-index:999;background:#fff;border:1px solid var(--line);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.18);padding:4px;display:flex;flex-direction:column;min-width:200px}
.pvM-mnu button{text-align:left;padding:8px 12px;border:0;background:#fff;font-size:14px;border-radius:6px}.pvM-mnu button.on{background:#e4effb;font-weight:700}
`;

const keep = (body) => ["script", `{ const run = () => { ${body} }; run(); new MutationObserver(run).observe(document.body, { childList: true, subtree: true }); }`];
/** 開いた品質データの欄に案を差し込む（保存・閉じるの段の前）と、閉じた品質データのカードに要約 */
const put = (html, extra = "") => keep(`
  const open = document.querySelector('#masterSettings .sr-card.is-open[data-key="lot"] .sr-form');
  if (open && !open.querySelector(".jn")) open.querySelector(".sr-acts").insertAdjacentHTML("beforebegin", ${JSON.stringify(html)});
  const shut = document.querySelector('#masterSettings .sr-card[data-key="lot"]:not(.is-open)');
  if (shut && !shut.querySelector(".jn-card")) shut.insertAdjacentHTML("beforeend", ${JSON.stringify(SUMMARY)});
  ${extra}`);
/** マスタのタブ: 見出しのマスタごとのタブを隠し、「マスタ」1 つに。一覧の上に設備のタブと同じ札。ロット番号の警告・案内を出さない */
const keepTick = (body) => ["script", `{ const run = () => { ${body} }; run(); new MutationObserver(run).observe(document.body, { childList: true, subtree: true }); setInterval(run, 250); }`];
const MST = (menu) => keepTick(`
  const nav = document.querySelector(".screen-tabs"); if (!nav || !window.LotList) return;
  nav.querySelectorAll('[data-screen^="src:m"]').forEach((b) => b.classList.add("pvM-hide"));
  const onMst = !document.querySelector("#lotListScreen.hidden") && String(window.LotList.source() || "").startsWith("src:m");
  const w = nav.querySelector('[data-screen="src:wip"]'); if (!w) return;
  let t = nav.querySelector(".pvM-tab");
  if (!t) { t = w.cloneNode(true); t.removeAttribute("id"); t.removeAttribute("data-screen"); t.classList.add("pvM-tab");
    t.querySelector(".tab-name").textContent = ${menu ? '"マスタ ▾"' : '"マスタ"'}; }
  if (t.previousElementSibling !== w) w.after(t);
  const want = onMst ? "true" : "false";
  if (t.getAttribute("aria-selected") !== want) t.setAttribute("aria-selected", want);
  if (onMst && w.getAttribute("aria-selected") !== "false") w.setAttribute("aria-selected", "false");
  const bar = document.querySelector("#llEquipBar");
  if (onMst && ${!menu} && bar && bar.hidden) bar.hidden = false;
  if (onMst && ${!menu} && bar && !bar.querySelector(".pvM-c")) { bar.hidden = false;
    bar.innerHTML = '<span class="eq-lab">マスタ</span><div class="eq-chips pvM-c" role="tablist"><button type="button" role="tab" class="eq-chip" aria-selected="true">製造条件マスタ</button><button type="button" role="tab" class="eq-chip" aria-selected="false">設備マスタ</button></div><button type="button" class="eq-manage">データ元を管理…</button>'; }
  if (onMst && ${menu} && !document.querySelector(".pvM-mnu")) { const r = t.getBoundingClientRect();
    document.body.insertAdjacentHTML("beforeend", '<div class="pvM-mnu" style="left:' + r.left + 'px;top:' + (r.bottom + 2) + 'px"><button class="on">製造条件マスタ</button><button>設備マスタ</button></div>'); }
  if (onMst) { const h = document.querySelector(".ll-lothint"); if (h && !h.classList.contains("pvM-hide")) h.classList.add("pvM-hide");
    const n = document.querySelector("#llNote"); if (n && /ロット番号の列が見つかりません/.test(n.textContent) && !n.classList.contains("pvM-hide")) n.classList.add("pvM-hide"); }`);

export const PROPOSALS = [
  { key: "A2", name: "A を直す: 方式の札を大きく（48px）＋札ごとの行数・保存の段を下に貼り付け・相手の数を言葉で", css, ops: [put(A2), MST(false)] },
  { key: "D2", name: "D を直す: 段の札を押して飛べる・方式の段に鍵の表・カードに「直す…」「外す」", css,
    ops: [put(D2, `if (document.querySelector('#masterSettings .sr-card.is-open[data-key="lot"]') && !document.querySelector(".pvD-win")) document.body.insertAdjacentHTML("beforeend", ${JSON.stringify(D2win)});`), MST(false)] },
  { key: "G", name: "新: A の流れ（相手→鍵→方式→列→数）で、方式は 4 枚のカード（ベン図・一言・残る行の数）を 1 段に", css, ops: [put(G), MST(false)] },
  { key: "H", name: "新: 結合 1 件を 1 行の要約にし、押すとその場で開く（アコーディオン。中は G の形）", css, ops: [put(H), MST(false)] },
  { key: "J", name: "新: 2 列: 左に相手・鍵・列、右に方式の 4 枚を 2×2（残る行の数つき）", css, ops: [put(J), MST(false)] },
];
