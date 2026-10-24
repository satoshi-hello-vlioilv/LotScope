// 2026-10 データ元の結合（自由な鍵・方式を目で見る）と、見出しの「マスタ」のタブ。1 回目（合格点 80 点）。
//   node program/tools/ui-variants.mjs 出力 program/tools/ui-proposals/2026-10-join.mjs --states master-sources,master-sources-join --from master
//   node program/tools/ui-variants.mjs 出力 program/tools/ui-proposals/2026-10-join.mjs --states mst-tab --from tabs-menu
// 今の画面で見えたこと（ui-check の画像）:
//   ①マスタを足すたびに見出しのタブが増え、1728 でも右端の「アプリ」が切れる ②マスタの一覧に「ロット番号の列が見つかりません…検索できません」
//   と「ロット番号を押すと計算へ取り込み」が出る（マスタに関係ない） ③データ元の欄にほかの元と結ぶ手段が無く、カードにも関係が見えない
// 案の方向（何で解くか）:
//   A 置き場: 開いた欄の中の「結合」の段（相手・方式〈ベン図の 4 つの札〉・鍵の行・持ってくる列・当たった数）
//   B 見せ方: 2 つの表の箱を並べ、鍵の列どうしを線で結ぶ（ER 図）。方式は真ん中のベン図
//   C 流れ: 文で組む（「品質データの行に 製造条件マスタ の列を、合金＝材質・調質＝質別 が同じ行から持ってくる。相手の無い行は 残す」）
//   D 置き場: カードには要約だけ。「結合を組む…」で大きな窓（相手 → 鍵 → 方式 → 列の 4 段）
//   E 見せ方: 大きなベン図の 3 つの場所に数（この元だけ 161・両方 1,339・相手だけ 0）。場所を押して残す行を決める（方式の名前は後ろに）
//   F A ＋ E: 段の欄で、方式の札の代わりに数入りのベン図（押せる）を鍵の右に
// マスタのタブ（どの案も同じ。利用者の指示どおり作業実績の設備のタブと同じ形）: 見出しは「マスタ」1 つ・その下に設備のタブと同じ札で
//   製造条件マスタ・設備マスタ。マスタの一覧ではロット番号の警告と案内を出さない。C だけは札の代わりに「マスタ ▾」のメニュー（方向の偏りを見る）

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

const A = `<div class="jn sr-w pvA">${head("ほかのデータ元の列を、鍵が同じ行から持ってきます（上から順に重ねます）")}
  <div class="jn-item"><div class="jn-top">${withSel}<span class="jn-lab">方式</span>${seg("a")}<button type="button" class="jn-del" title="この結合を外す">外す</button></div>
  <div class="jn-keys"><span class="jn-lab">鍵（全部が同じ値の行を合わせる）</span>${keyRows}</div>${cols}${result}</div>
  <button type="button" class="pz-btn jn-add">＋ 結合を足す</button></div>`;

const B = `<div class="jn sr-w pvB">${head("鍵の列どうしを線で結びます。下で方式を選びます")}
  <div class="jn-er"><div class="jn-box l"><h5>品質データ<small>1,500 行</small></h5><ul><li>ロット番号</li><li>設備</li><li class="k k1">合金</li><li class="k k2">調質</li><li>重量</li><li class="more">ほか 35 列</li></ul></div>
  <div class="jn-midcol"><svg class="jn-lines" viewBox="0 0 200 208" preserveAspectRatio="none"><path d="M0 106 C100 106 100 50 200 50" stroke="#3f7fcf" stroke-width="2.5" fill="none"/><path d="M0 134 C100 134 100 78 200 78" stroke="#3f7fcf" stroke-width="2.5" fill="none"/></svg>
  <div class="jn-mid">${venn("bm", "left", 64)}<select class="jn-s"><option>左外部結合</option></select><small>品質データの行は全部残す</small></div></div>
  <div class="jn-box r"><h5>製造条件マスタ<small>8 行</small></h5><ul><li class="k k1">材質</li><li class="k k2">質別</li><li class="pick">☑ 圧延速度</li><li class="pick">☑ 焼鈍温度</li><li class="pick">☑ 板厚公差</li><li class="pick">☑ 改訂日</li></ul></div></div>
  <div class="jn-tip">左の列を押してから右の列を押すと鍵の線が引けます（線を押すと外す）。右の ☑ は持ってくる列</div>${result}
  <button type="button" class="pz-btn jn-add">＋ 結合を足す</button></div>`;

const C = `<div class="jn sr-w pvC">${head("文を読みながら空欄を選びます")}
  <p class="jn-sent">品質データの行に、${sel("製造条件マスタ")} の列 <button type="button" class="jn-chip">圧延速度 ほか 4 列 ▾</button> を、
  <span class="jn-pair">${sel("合金")} ＝ ${sel("材質")}</span> と <span class="jn-pair">${sel("調質")} ＝ ${sel("質別")}</span> <button type="button" class="jn-addk">＋</button> が同じ行から持ってくる。</p>
  <p class="jn-sent">相手の無い品質データの行は ${sel("残す")}、品質データに無い相手の行は ${sel("足さない")}。 <span class="jn-how">${venn("c", "left", 40)}左外部結合</span></p>
  ${result}<button type="button" class="pz-btn jn-add">＋ 結合を足す</button></div>`;

const D = `<div class="jn sr-w pvD">${head("")}<div class="jn-sum">${venn("ds", "left", 40)}<span><b>製造条件マスタ</b> を左外部結合（合金 = 材質・調質 = 質別）・4 列</span><span class="ok">1,339 / 1,500 行が当たる</span><button type="button" class="pz-btn">結合を組む…</button></div></div>`;
const Dwin = `<div class="pvD-win" role="dialog"><header><b>結合を組む — 品質データ</b><button type="button" class="pvD-x">×</button></header>
  <ol class="pvD-steps"><li class="done">1 相手</li><li class="done">2 鍵</li><li class="on">3 方式</li><li>4 列</li></ol>
  <div class="pvD-body"><p>品質データ（1,500 行）と製造条件マスタ（8 行）を 合金 = 材質・調質 = 質別 で合わせます。残す行を選んでください。</p>
  <div class="pvD-cards">${HOWS.map(([k, n, t], i) => `<button type="button" class="pvD-card${k === "left" ? " on" : ""}">${venn("dw" + k, k, 96)}<b>${n}</b><small>${t}</small><span>${[1339, 1500, 1339, 1500][i].toLocaleString()} 行</span></button>`).join("")}</div></div>
  <footer><button type="button" class="btn-ghost">‹ 戻る</button><span></span><button type="button" class="btn-primary">次へ ›</button></footer></div>`;

const bigVenn = (w) => `<svg class="jn-big" viewBox="0 0 300 170" width="${w}" height="${Math.round(w * 0.567)}" role="img" aria-label="残す行">
  <defs><clipPath id="evc"><circle cx="115" cy="85" r="78"/></clipPath></defs>
  <circle cx="115" cy="85" r="78" fill="#9fc2ea"/><circle cx="185" cy="85" r="78" fill="#fff"/><circle cx="185" cy="85" r="78" clip-path="url(#evc)" fill="#3f7fcf"/>
  <circle cx="115" cy="85" r="78" fill="none" stroke="#2c5f99" stroke-width="2"/><circle cx="185" cy="85" r="78" fill="none" stroke="#b5741f" stroke-width="2" stroke-dasharray="5 4"/>
  <text x="72" y="80" text-anchor="middle" font-size="11.5" fill="#123">この元だけ</text><text x="75" y="100" text-anchor="middle" font-size="17" font-weight="700" fill="#123">161</text>
  <text x="150" y="80" text-anchor="middle" font-size="11.5" fill="#fff">両方</text><text x="150" y="100" text-anchor="middle" font-size="17" font-weight="700" fill="#fff">1,339</text>
  <text x="228" y="80" text-anchor="middle" font-size="11.5" fill="#5a6470">相手だけ</text><text x="225" y="100" text-anchor="middle" font-size="17" font-weight="700" fill="#5a6470">0</text></svg>`;
const E = `<div class="jn sr-w pvE">${head("塗った所の行を残します。場所を押すと、残す・残さないが替わります")}
  <div class="jn-e"><div class="jn-e-v">${bigVenn(300)}<div class="jn-e-leg"><span class="l">品質データ 1,500 行</span><b>左外部結合</b><span class="r">製造条件マスタ 8 行</span></div></div>
  <div class="jn-e-r">${withSel}<div class="jn-keys"><span class="jn-lab">鍵</span>${keyRows}</div>${cols}</div></div>
  <button type="button" class="pz-btn jn-add">＋ 結合を足す</button></div>`;

const F = `<div class="jn sr-w pvF">${head("ほかのデータ元の列を、鍵が同じ行から持ってきます（上から順に重ねます）")}
  <div class="jn-item"><div class="jn-top">${withSel}<button type="button" class="jn-del" title="この結合を外す">外す</button></div>
  <div class="jn-f"><div class="jn-keys"><span class="jn-lab">鍵（全部が同じ値の行を合わせる）</span>${keyRows}${cols}</div>
  <div class="jn-f-v"><span class="jn-lab">残す行（場所を押して替える）</span>${bigVenn(240)}<div class="jn-e-leg"><span class="l">品質データ</span><b>左外部結合</b><span class="r">製造条件マスタ</span></div></div></div>
  <div class="jn-res"><b class="ok">✓ 1,339 行が当たりました</b><span class="ng">161 行は相手がありません（例: A3004 / H24）</span></div></div>
  <button type="button" class="pz-btn jn-add">＋ 結合を足す</button></div>`;

/* 閉じたカードの要約（どの案も同じ）: 品質データのカードの下の行に、ベン図と結合の 1 行 */
const SUMMARY = `<div class="jn-card sr-w">${venn("sum", "left", 30)}<span>結合 <b>製造条件マスタ</b> を左外部結合（合金 = 材質・調質 = 質別）・4 列</span><span class="ok">1,339 / 1,500 行が当たる</span></div>`;

const css = `
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
  { key: "A", name: "欄の中の結合の段（相手・方式の 4 札〈ベン図〉・鍵の行・列・数）", css, ops: [put(A), MST(false)] },
  { key: "B", name: "2 つの表の箱を並べ、鍵の列を線で結ぶ（真ん中にベン図と方式）", css, ops: [put(B), MST(false)] },
  { key: "C", name: "文で組む（空欄を選ぶ。相手の無い行を残す？で方式が決まる）・マスタは ▾ メニュー", css, ops: [put(C), MST(true)] },
  { key: "D", name: "カードは要約だけ・「結合を組む…」の大きな窓（相手→鍵→方式→列）", css, ops: [put(D, `if (document.querySelector('#masterSettings .sr-card.is-open[data-key="lot"]') && !document.querySelector(".pvD-win")) document.body.insertAdjacentHTML("beforeend", ${JSON.stringify(Dwin)});`), MST(false)] },
  { key: "E", name: "大きなベン図の場所に数（この元だけ・両方・相手だけ）。押して残す行を決める", css, ops: [put(E), MST(false)] },
  { key: "F", name: "A＋E: 段の欄で、方式の札の代わりに数入りのベン図を鍵の右に", css, ops: [put(F), MST(false)] },
];
