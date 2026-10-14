// 2026-10 作業実績の日・日＋直ごとの表に、作業が 0 件の日も出す（7 案）。
//   node program/tools/ui-variants.mjs 出力フォルダ program/tools/ui-proposals/2026-10-zeroday.mjs --states worklog-work [--view 1536x864]
// 利用者の要望: 件数が 0 の日は日付の行が出ない。0 件でも日付の行を出せるようにし、既定は出す。
// 今の画面（画像で見えたこと）: 9/24(木) の次が 9/22(火) で、9/23 が無い。日付を読み比べないと抜けに気づかず、
//   「作業が無かった」のか「数え漏れ」なのか分からない。日数（合計 109 日）も作業のあった日だけ。
// 案は、日＋直ごとにまとめた右の表に、抜けていた日を 0 件として入れた形で比べる。
//
// 方向（何で解くか）: A 置き場＝表の上に「☑ 0 件の日も出す」、0 件の日は淡い行（–）
// ／B 減らし方＝続いた 0 件の日は 1 行に畳む（「9/12〜9/14 作業なし 3 日」）。切り替えは表の上
// ／C 置き場を変える＝件数の行の「まとめない｜日ごと｜日＋直ごと」の横に「0 件の日」の札
// ／D 見せ方＝表の頭の「新しい順 ▼」の横に「0 件の日 出す｜隠す」の切り替え。0 件の行は 0 を淡く書く
// ／E 手がかり＝0 件の行に加え、土日の行に淡い地（曜日で 0 件の理由が分かる）。切り替えは表の下（作業開始の列の上）
// 5 案は「行を足して、切り替えをどこかに置く」に寄る → 方向の違う 2 案を足す:
// F 目立たせない＝0 件の日は行の高さを半分にして字を小さく（抜けは見えるが、表は長くならない）
// G 区切りで示す＝行は足さず、日付の間に「— 9/23 作業なし —」の細い区切り

export const KIT = ["script", `
(() => {
  const W = "日月火水木金土";
  const Z = window.__zd = {
    /** 表に、抜けている日を 0 件の行として入れる（mode: row・fold・half・gap） */
    fill(mode) {
      const tb = document.querySelector("#llWork .wk-pv tbody"); if (!tb || tb.dataset.px) return; tb.dataset.px = mode;
      const rows = [...tb.querySelectorAll("tr")], cols = rows[0] ? rows[0].children.length : 5;
      const d0 = (r) => { const b = r.querySelector("[data-wk-day]"); return b ? b.dataset.wkDay : ""; };
      const txt = (d) => { const x = new Date(d + "T00:00:00"); return (x.getMonth() + 1) + "/" + x.getDate() + "(" + W[x.getDay()] + ")"; };
      for (let i = 0; i < rows.length - 1; i++) {
        const a = d0(rows[i]), b = d0(rows[i + 1]); if (!a || !b) continue;
        const miss = []; let x = new Date(a + "T00:00:00"); x.setDate(x.getDate() - 1);
        while (x.toISOString().slice(0, 10) > b && miss.length < 40) { const k = new Date(x.getTime() - x.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); if (k <= b) break; miss.push(k); x.setDate(x.getDate() - 1); }
        if (!miss.length) continue;
        let html = "";
        if (mode === "gap") html = '<tr class="zd-gap"><td colspan="' + cols + '">— ' + (miss.length > 1 ? txt(miss[miss.length - 1]) + "〜" + txt(miss[0]) : txt(miss[0])) + " 作業なし —</td></tr>";
        else if (mode === "fold" && miss.length > 1) html = '<tr class="zd-row zd-fold"><th scope="row">' + txt(miss[miss.length - 1]) + "〜" + txt(miss[0]).replace(/^\\d+\\//, "") + '</th><td colspan="' + (cols - 1) + '">作業なし ' + miss.length + " 日</td></tr>";
        else html = miss.map((k) => { const w = new Date(k + "T00:00:00").getDay(); return '<tr class="zd-row' + (mode === "half" ? " zd-half" : "") + (w === 0 || w === 6 ? " zd-we" : "") + '"><th scope="row"><span>' + txt(k) + "</span></th>" + Array.from({ length: cols - 1 }, (_, j) => "<td>" + (mode === "zero" ? "0" : "–") + "</td>").join("") + "</tr>"; }).join("");
        rows[i].insertAdjacentHTML("afterend", html);
      }
    },
    mount(key, build) { setInterval(() => { const t = document.querySelector("#llWork .wk-pv tbody"); if (t && !t.dataset.px) try { build(); } catch (e) { console.warn(e); } }, 150); },
  };
})();`];
export const CSS = `
  .zd-row th,.zd-row td{color:#9aa6b2 !important;background:#f7f9fb !important;font-weight:400 !important}
  .zd-row th span{padding:0 8px;font-size:12.5px}
  .zd-row.zd-we th,.zd-row.zd-we td{background:#f1f3f7 !important}
  .zd-half th,.zd-half td{height:14px !important;padding-top:0 !important;padding-bottom:0 !important;font-size:10.5px !important;line-height:14px}
  .zd-half th span{font-size:10.5px}
  .zd-fold td{text-align:left !important;font-size:12px}
  .zd-gap td{padding:1px 0 !important;text-align:center;font-size:10.5px;color:#9aa6b2;background:repeating-linear-gradient(90deg,#f4f6f9 0 6px,#fff 6px 12px) !important;border:0 !important}
  .zd-tog{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--ink);margin:2px 0 6px}
  .zd-tog i{width:14px;height:14px;border-radius:3px;background:var(--h-input);position:relative;display:inline-block}
  .zd-tog i::after{content:"";position:absolute;left:4px;top:1px;width:4px;height:8px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg)}
  .zd-seg{display:inline-flex;border:1px solid var(--line);border-radius:6px;overflow:hidden;font-size:11.5px;margin-left:6px}
  .zd-seg span{padding:1px 7px;color:var(--muted)}
  .zd-seg span.on{background:var(--h-input);color:#fff;font-weight:700}
  .zd-chip{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 10px;border:1px solid var(--line);border-radius:7px;font-size:12.5px;color:var(--h-input);background:var(--surface);margin-left:6px}
  .zd-we-row th,.zd-we-row td{background:#f1f3f7}
`;
const go = (key, mode, build = "") => ["script", `window.__zd.mount(${JSON.stringify(key)}, () => { const Z = window.__zd; Z.fill(${JSON.stringify(mode)}); ${build} });`];
const TOG = (where = "#llWork .wk-table", pos = "beforebegin") => `document.querySelector("${where}").insertAdjacentHTML("${pos}", '<label class="zd-tog"><i></i>0 件の日も出す</label>');`;

export const PROPOSALS = [
  { key: "A", name: "置き場: 表の上に「☑ 0 件の日も出す」・0 件の日は淡い行（–）", css: CSS, ops: [KIT, go("A", "row", TOG())] },
  { key: "B", name: "減らし方: 続いた 0 件の日は 1 行に畳む（作業なし N 日）・切り替えは表の上", css: CSS, ops: [KIT, go("B", "fold", TOG())] },
  { key: "C", name: "置き場を変える: 件数の行のまとめ方の横に「0 件の日」の札", css: CSS,
    ops: [KIT, go("C", "row", `const s = document.querySelector("#llWorkSwitch .wk-seg"); if (s && !document.querySelector(".zd-chip")) s.insertAdjacentHTML("afterend", '<span class="zd-chip"><i class="zd-tog" style="margin:0"><i></i></i>0 件の日</span>');`)] },
  { key: "D", name: "見せ方: 表の頭の「新しい順 ▼」の横に「0 件の日 出す｜隠す」・0 を淡く書く", css: CSS,
    ops: [KIT, go("D", "zero", `document.querySelector("#llWork .wk-order").insertAdjacentHTML("beforebegin", '<span class="zd-seg" title="0 件の日"><span>0 件の日</span><span class="on">出す</span><span>隠す</span></span>');`)] },
  { key: "E", name: "手がかり: 0 件の行＋土日の行に淡い地・切り替えは表の下（作業開始の列の上）", css: CSS,
    ops: [KIT, go("E", "row", `${TOG("#llWork .wk-table", "afterend")} document.querySelectorAll("#llWork tbody tr:not(.zd-row)").forEach((r) => { const b = r.querySelector("[data-wk-day]"); if (b && /\\((土|日)\\)/.test(b.textContent)) r.classList.add("zd-we-row"); });`)] },
  { key: "F", name: "目立たせない: 0 件の日は行の高さを半分・字を小さく", css: CSS, ops: [KIT, go("F", "half", TOG())] },
  { key: "G", name: "区切りで示す: 行を足さず、日付の間に「— 9/23 作業なし —」の細い区切り", css: CSS, ops: [KIT, go("G", "gap", TOG())] },
];
