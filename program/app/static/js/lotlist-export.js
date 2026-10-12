"use strict";
/* =========================================================================
   一覧（異常ロット一覧・作業実績）を Excel に出力する（道具の行の右端「Excel に出力」。置き場は 7 案＋2 回目で選んだ:
   program/tools/ui-proposals/2026-10-excel*.mjs・.json）
   - 出すのは、いまの検索・条件・スライサー・並びに当たる全件（ページに分けずに全部）。列は表示列のまま（表示名・並び・隠した列）、
     値は一覧に見えているとおり（値の整え方・読み替え・計算列の結果）。ロット番号は字のまま
   - 作業でまとめているとき（作業実績）は、各行に作業日・直・分割の数を足し、「日・直ごとのロット数」のシートも出す
   - 「出力の条件」のシートに、どの一覧を・いつ・どの絞り込みで出したかを残す（あとで見た人が同じ物を出し直せる）
   - .xlsx を組むのは xlsx-writer.js。保存はほかの書き出しと同じ TPA.download（デスクトップ版は窓が保存し、置いた場所を知らせる）
   一覧（lotlist.js）とは mount の引数だけでつながる:
     pageUrl(page, size)・count()・columns()・label(c)・text(c, row)・lotColumn()・title()・fileStem()・conditions()・work()・toast(m)
   ========================================================================= */
(function () {
  const { $ } = TPA;
  const PAGE = 5000;            // 1 回に引く行（サーバーの PAGE_SIZE_MAX）
  const MAX_ROWS = 200000;      // これを超えるときは確かめる（Excel の上限は 1,048,576 行だが、画面で組むので重い）
  let host = null, busy = false;
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = (d = new Date()) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  const when = (d = new Date()) => `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

  /** 全件を引く（ページを順に）。→ { rows, works }（works は作業でまとめているときの [鍵, 日, 直, 作業開始] の並び） */
  async function gather(total, w) {
    const rows = [], works = [];
    for (let page = 1; rows.length < total; page++) {
      w.now(`一覧を引いています… ${rows.length.toLocaleString()} / ${total.toLocaleString()} 件`);
      const r = await fetch(host.pageUrl(page, PAGE), { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "一覧を読めませんでした");
      if (!(d.rows || []).length) break;
      rows.push(...d.rows);
      if (d.work && d.work.rows) works.push(...d.work.rows);
    }
    return { rows, works };
  }
  /** 作業でまとめているとき: 日・直ごとのロット数の表（右の表と同じ数。日の並びも同じ） */
  function summarySheet(wk) {
    const P = wk.pivot();
    const head = ["日" + (wk.basisLabel ? `（${wk.basisLabel}）` : ""), ...P.cols.map((i) => wk.shiftName(i)), "計（ロット）", "行", "うち分割した作業"];
    const sum = (list, k) => list.reduce((a, b) => a + (b ? b[k] : 0), 0);
    const rows = P.days.map((d) => {
      const list = Object.values(P.by[d]);
      return [wk.dayText(d), ...P.cols.map((i) => (P.by[d][i] ? P.by[d][i].works : "")), sum(list, "works"), sum(list, "rows"), sum(list, "split")];
    });
    const all = wk.data.buckets;
    rows.push(["合計", ...P.cols.map((i) => sum(all.filter((b) => b.shift === i), "works")), wk.data.total.works, wk.data.total.rows, wk.data.total.split]);
    return { name: P.cols.length ? "日・直ごとのロット数" : "日ごとのロット数", rows: [head, ...rows] };
  }

  async function run() {
    if (busy || !host) return;
    const total = host.count();
    if (!total) { host.toast("出す行がありません（検索・条件を確かめてください）"); return; }
    if (total > MAX_ROWS && !confirm(`${total.toLocaleString()} 件あります。Excel に出すのに時間がかかります（数分）。続けますか？\n［キャンセル］して条件で絞ると早く出せます。`)) return;
    busy = true; paint();
    const w = TPA.waiting({ title: "Excel に出力しています", subject: host.title(), now: "一覧を引いています…", background: false, delay: 300,
      note: "いまの検索・条件・スライサー・並びのまま、全件を表示列の見え方で出します。" });
    try {
      const wk = host.work();
      const { rows, works } = await gather(total, w);
      w.now(`Excel を組んでいます…（${rows.length.toLocaleString()} 行）`);
      const cols = host.columns(), lot = host.lotColumn();
      const extra = wk ? [`作業日（${wk.basisLabel}）`, ...(wk.withShift ? ["直"] : []), "分割（同じ作業開始の行）"] : [];
      const head = [...extra, ...cols.map((c) => host.label(c))];
      // 分割の数: 同じ作業の鍵が続く行の数（サーバーが同じ作業を 1 か所に集めて返す）
      const runs = works.map((x, i) => { let n = 0; for (let j = i; j >= 0 && works[j][0] === x[0] && x[0]; j--) n++; for (let j = i + 1; j < works.length && works[j][0] === x[0] && x[0]; j++) n++; return Math.max(1, n); });
      const body = rows.map((r, i) => [
        ...(wk ? [wk.dayText((works[i] || [])[1] || ""), ...(wk.withShift ? [wk.shiftName((works[i] || [])[2] ?? -1)] : []), runs[i] > 1 ? runs[i] : ""] : []),
        ...cols.map((c) => (c === lot ? String(r[c] ?? "") : host.text(c, r))),
      ]);
      const sheets = [{ name: host.title(), rows: [head, ...body] }];
      if (wk) sheets.push(summarySheet(wk));
      sheets.push({ name: "出力の条件", header: false, rows: [...host.conditions(), ["出力した行", `${rows.length.toLocaleString()} 行`], ["出力した日時", when()]] });
      const bytes = await window.XlsxWriter.build(sheets);
      TPA.download(new Blob([bytes], { type: window.XlsxWriter.MIME }), `${host.fileStem()}_${stamp()}.xlsx`);
    } catch (e) {
      host.toast("Excel に出力できませんでした: " + e.message);
    } finally {
      w.done(); busy = false; paint();
    }
  }
  function paint() {
    const b = $("#llExcelBtn"); if (!b) return;
    b.disabled = busy;
    b.setAttribute("aria-busy", String(busy));
  }
  function mount(h) { host = h; $("#llExcelBtn")?.addEventListener("click", run); paint(); }
  window.LotListExport = { mount, run };
})();
