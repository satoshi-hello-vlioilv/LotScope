/* 自己診断（環境変数 TPA_SELFTEST=結果のファイル で起動したときだけ、窓が画面に流し込む）。
   本物の WebView の中から、窓（Rust）と中身（Python）の組が正しく動くかを確かめて /__desktop/selftest へ送る。窓は結果を書いて終わる。
   調べること: 起動が終わる・振り分け（部品と画面は Rust〈画面は Python の画面と突き合わせる〉・API は Python・窓のことは Rust）・使い回しの決まり・大きな日本語の本文・
   日本語の問い合わせ文字・40 本同時・安全な文脈・保存領域・保存（ダウンロード）・窓の情報・品質異常（Rust と Python の突き合わせ）・
   画面のエラーが無い・速さ。 */
(async () => {
  const res = [];
  const ok = (name, cond, info = "") => res.push({ name, ok: !!cond, info: String(info).slice(0, 300) });
  const t0 = performance.now();
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
  const get = async (url, opt) => { const r = await fetch(url, opt); return { r, by: r.headers.get("X-TPA-By"), text: await r.text() }; };
  const json = (method, body) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  // 窓の情報（版 3.86.0: 画面は中身の準備を待たずに開くので、中身の版〈backend〉は準備ができてから載る。60 秒まで待つ）
  const infoReady = async () => {
    let i = {};
    for (let n = 0; n < 300; n++) {
      i = await (await fetch("/__desktop/info")).json();
      if (i.backend && i.backend.version) return i;
      await sleep(200);
    }
    return i;
  };
  try {
    // 1) 起動が終わる（画面の JS が設定と自分の権限を読み終えた）
    const end = performance.now() + 60000;
    const booted = () => typeof state === "object" && state.config && state.me;
    while (!booted() && performance.now() < end) await sleep(200);
    ok("起動が終わる（設定と権限を読み終える）", booted(), ((performance.now() - t0) / 1000).toFixed(1) + " 秒");
    const app = document.querySelector('meta[name="tpa-app"]');
    ok("画面の題（窓が描いた HTML・アプリの名前）", app && document.title === app.content, document.title);
    ok("画面の JS が動いている（TPA の共通部品）", typeof TPA === "object" && typeof TPA.download === "function");

    // 2) 振り分けと使い回しの決まり
    const fp = (document.querySelector('meta[name="tpa-build"]') || {}).content || "x";
    const js = await get(`/static/js/shared.js?v=${fp}`);
    ok("部品は Rust が返す（指紋付きは長く使い回す）", js.by === "shell" && js.r.ok && /immutable/.test(js.r.headers.get("Cache-Control") || ""), js.by);
    const plain = await get("/static/js/shared.js");
    ok("指紋の無い部品は毎回確かめる（no-cache）", plain.by === "shell" && plain.r.headers.get("Cache-Control") === "no-cache" && plain.text === js.text);
    const three = await get(`/static/vendor/three/three-bundle.min.js?v=${fp}`);
    ok("大きな部品（three.js）も Rust が返す", three.by === "shell" && three.r.ok && three.text.length > 100000, `${three.r.status} ${three.text.length}字`);
    // 画面は窓が描く（版 3.85.0。src/page.rs）。使い回さない（no-store）・CSP の印。Python が描いた画面（?engine=python）と、印を揃えると 1 字も違わない
    // 先に Python の画面（共有に初期設定がまだ無い PC では、Python が描くときに写しから最初の版を作る。窓はその形を Python に任せる）。
    // 版 3.86.0 から最初の画面は Python の準備を待たずに窓が描くので、その版はここで初めてできることがある
    const pyPage = await get("/?engine=python");
    const page = await get("/");
    const csp = page.r.headers.get("Content-Security-Policy") || "";
    ok("画面は窓が描く（使い回さない・CSP の印）", page.by === "shell" && page.r.ok && page.r.headers.get("Cache-Control") === "no-store" && /'nonce-[A-Za-z0-9_-]{22}'/.test(csp), `${page.by} ${csp.slice(0, 40)}`);
    const nonceOf = (x) => ((x.r.headers.get("Content-Security-Policy") || "").match(/nonce-([A-Za-z0-9_-]+)/) || [])[1] || "@";
    const norm = (x) => x.text.split(nonceOf(x)).join("@NONCE@");
    const at = [...norm(page)].findIndex((c, i) => c !== norm(pyPage)[i]);
    ok("窓の画面と Python の画面が同じ（印を揃えて）", pyPage.by === "python" && norm(page) === norm(pyPage), at < 0 ? pyPage.by : `${at} 字目: ${norm(page).slice(Math.max(0, at - 30), at + 40)}`);
    const escape = await get("/static/%2e%2e/templates/index.html");
    ok("static の外へは出ない", escape.r.status === 404, escape.r.status);

    // 3) API
    const b = await get("/api/build");
    ok("API が答える（/api/build）", b.r.ok && b.by === "python" && JSON.parse(b.text).version, b.text.slice(0, 80));
    const ch = await get("/api/changelog");
    ok("大きな答え（更新履歴）が欠けずに届く", ch.r.ok && JSON.parse(ch.text).entries.length > 10, ch.text.length + " 字");
    const nf = await get("/api/no-such-route");
    ok("無いところは 404", nf.r.status === 404 && nf.by === "python", nf.r.status);
    // 画面の設定の控えは窓が答える（版 3.71.0。src/presence.rs）。engine=python は Python に任せる（中身との枠の往復を確かめる）
    const bad = await get("/api/ui-state?engine=python", json("POST", { changed: "形が違う" }));
    const why = (JSON.parse(bad.text).error || "");
    ok("誤りの答え（400 と日本語の理由）", bad.r.status === 400 && /形が違います/.test(why) && bad.by === "python", why);
    const wbad = await get("/api/ui-state", json("POST", { changed: "形が違う" }));
    ok("窓が答える誤り（画面の設定の控え）", wbad.r.status === 400 && wbad.by === "shell" && /形が違います/.test(JSON.parse(wbad.text).error || ""), wbad.text.slice(0, 80));
    const hb = await get("/api/heartbeat", json("POST", { visible: true }));
    ok("心拍は窓が答える（中身が生きていれば 200）", hb.r.ok && hb.by === "shell" && "revoked" in JSON.parse(hb.text), `${hb.r.status} ${hb.by}`);

    // 4) 大きな日本語の本文（約 460KB）が往復する——画面の設定の控えへ重ねて読み戻し、消す
    const big = "汚れ位置・発見設備と転写".repeat(13000), key = "tpa.selftestBig";
    const put = await get("/api/ui-state?engine=python", json("POST", { changed: { [key]: big } }));
    const back = JSON.parse((await get("/api/ui-state?engine=python")).text);
    ok("約 460KB の日本語の本文が往復する", put.r.ok && put.by === "python" && (back.keys || {})[key] === big, `${put.r.status} / ${((back.keys || {})[key] || "").length}`);
    const wback = JSON.parse((await get("/api/ui-state")).text);
    ok("Python が書いた控えを窓が読む（同じファイル）", (wback.keys || {})[key] === big, ((wback.keys || {})[key] || "").length);
    await get("/api/ui-state", json("POST", { changed: {}, removed: [key] }));

    // 計算のタブの転写距離・ピッチ計算は窓が答える（版 3.72.0。src/calc.rs）。engine=python の Python の答えと同じ
    const calcBody = { lot: { density: 2.73, processes: [
      { no: 1, equipment: "L-1", thickness: 1.3, width: 1200, weight: 6214, unwind: "上", design_split: 1, vertical_split: 1 },
      { no: 2, equipment: "TLV", thickness: 0.505, width: 1179.8, weight: 5511.5, unwind: "上", design_split: 1, vertical_split: 1, off_front_thickness_mm: 1.37 }] },
      inputs: { found_equipment: "2:TLV", found_pitch_mm: 610, soil_a_m: 1610.7, soil_b_m: 1613.7, tolerance_percent: 2 } };
    const cw = await get("/api/calculate", json("POST", calcBody));
    const cp = await get("/api/calculate?engine=python", json("POST", calcBody));
    ok("計算は窓が答え、Python と同じ答え", cw.r.ok && cw.by === "shell" && cp.by === "python" && JSON.stringify(JSON.parse(cw.text)) === JSON.stringify(JSON.parse(cp.text)),
       `${cw.r.status} ${cw.by} / ${cp.r.status} ${cp.by} ${cw.text.length}字`);

    // 5) 日本語の問い合わせ文字（Python のアプリが JSON で答える。元ファイルが無い PC では理由つきの誤り）
    const q = await get("/api/lotlist?search=" + encodeURIComponent("日本語・ロット") + "&page=1&engine=python");
    let qj = null; try { qj = JSON.parse(q.text); } catch (_) { /* 下で失敗にする */ }
    ok("日本語の問い合わせ文字（Python が JSON で答える）", q.by === "python" && qj && (q.r.ok || qj.error), `${q.r.status} ${q.text.slice(0, 80)}`);

    // 6) 同時の問い合わせが混ざらない
    const paths = Array.from({ length: 40 }, (_, i) => (i % 2 ? "/api/build" : `/static/js/shared.js?v=p${i}`));
    const all = await Promise.all(paths.map((p) => get(p)));
    ok("40 本同時でも、それぞれの答えが届く", all.every((x, i) => x.r.ok && (i % 2 ? JSON.parse(x.text).version : x.by === "shell")));

    // 7) 安全な文脈・保存領域
    ok("安全な文脈（クリップボードへ写せる）", window.isSecureContext && !!(navigator.clipboard && navigator.clipboard.writeText),
       `isSecureContext=${window.isSecureContext}`);
    localStorage.setItem("tpaSelftestV1", "1");
    ok("localStorage が使える", localStorage.getItem("tpaSelftestV1") === "1");
    localStorage.removeItem("tpaSelftestV1");
    const idb = await new Promise((done) => { const r = indexedDB.open("tpaSelftest", 1); r.onsuccess = () => { r.result.close(); done(true); }; r.onerror = () => done(false); });
    ok("IndexedDB が使える", idb);

    // 8) 保存（ダウンロード）: 画面の保存の道（TPA.download）で CSV が名前どおり・中身どおりに届く。窓は自己診断のときだけ記録する
    TPA.download(new Blob(["﻿ロット,値\r\nA,1\r\n"], { type: "text/csv;charset=utf-8" }), "自己診断_保存.csv");
    let saved = null;
    for (let i = 0; i < 100 && !saved; i++) {
      await sleep(200);
      saved = (await (await fetch("/__desktop/downloads")).json()).find((x) => x.state === "finished");
    }
    ok("保存: CSV が日本語の名前どおり・中身どおりに届く", saved && saved.success && saved.head === "efbbbfe3" && /自己診断_保存.*\.csv$/.test(saved.path || ""),
       JSON.stringify(saved));

    // 9) 窓の情報（枠の約束の版・目印・受け持ち）
    const info = await infoReady();
    const ready = info.backend || {};
    ok("窓の情報: 枠の約束の版が中身と同じ・目印・作業場所", info.protocol === 1 && ready.protocol === info.protocol && /transferpitchanalyzer/.test(info.app_id) && !!info.local_root,
       `protocol ${info.protocol}/${ready.protocol} serves=${JSON.stringify(info.serves)} root=${info.local_root}`);
    ok("窓の版と中身の版が同じ", info.shell_version === ready.version, `${info.shell_version} / ${ready.version}`);

    // 10) 品質異常（Rust が写しから引く・lot.rs）。同じ問い合わせを Python（engine=python）でも引き、答えが同じか
    const ll = await get("/api/lotlist?page=1");
    ok("一覧は Rust が答える", ll.by === "shell", `${ll.by} ${ll.r.status}`);
    const llSrc = await get("/api/lotlist/source");
    ok("データの時刻は Rust が答える（共有を見に行かない）", llSrc.by === "shell" && llSrc.r.ok, llSrc.text.slice(0, 120));
    let llCount = 0; try { llCount = JSON.parse(ll.text).count || 0; } catch (_) { /* 下で言う */ }
    if (llCount > 0) {
      const canon = (v) => Array.isArray(v) ? v.map(canon) : v && typeof v === "object"
        ? Object.fromEntries(Object.keys(v).sort().filter((k) => k !== "timing" && k !== "source").map((k) => [k, canon(v[k])])) : v;
      const enc = (v) => encodeURIComponent(typeof v === "string" ? v : JSON.stringify(v));
      const qs = ["page=1", "search=" + enc("汚れ"), "page=3&page_size=50",
        "filters=" + enc([{ column: "発生日", op: "within_days", value: "90" }, { column: "設備", op: "starts_any", value: "L-,ＣＲ" }]),
        "group=1&sorts=" + enc([{ column: "重量", dir: "desc" }]),
        "filters=" + enc([{ column: "発生日", op: "within_days", value: "0" }, { column: "設備", op: "eq", value: "無い" }]),
        // 計算列で並べ替える（版 3.59.0 から Rust も式を持つ: formula.rs。変換表は Python の設定の答えから）
        "calc=" + enc({ formulas: { 倍: "[重量] * 2 + 1", 課: "conv('課名', [設備])" }, names: {} }) + "&sorts=" + enc([{ column: "課", dir: "asc" }, { column: "倍", dir: "desc" }]),
        "group=1&calc=" + enc({ formulas: { 番: "extract([ロット番号], '[0-9]+')" }, names: {} }) + "&sorts=" + enc([{ column: "番", dir: "desc" }])];
      const differ = [], speed = { rust: 0, python: 0 };
      for (const q of qs) {
        let s = performance.now(); const rs = await get("/api/lotlist?" + q); speed.rust += performance.now() - s;
        if (q.includes("calc=") && rs.by !== "shell") differ.push("計算列を Rust が答えない: " + q);
        s = performance.now(); const py = await get("/api/lotlist?" + q + "&engine=python"); speed.python += performance.now() - s;
        if (py.by !== "python" || JSON.stringify(canon(JSON.parse(rs.text))) !== JSON.stringify(canon(JSON.parse(py.text)))) differ.push(q);
      }
      ok(`一覧: Rust と Python の答えが同じ（${qs.length} 通り・日本語の検索・絞り込み・ページ・まとめ・0 件の手がかり・計算列で並べ替え）`, differ.length === 0,
         differ.length ? differ.join(" | ") : `${llCount} 行・Rust ${speed.rust.toFixed(0)}ms / Python ${speed.python.toFixed(0)}ms`);
      const pySrc = JSON.parse((await get("/api/lotlist/source?engine=python")).text), rsSrc = JSON.parse(llSrc.text);
      ok("写しは 1 つ: Python も Rust が写した写しを読む（同じ台帳・同じ元の時刻）", rsSrc.mirrored && pySrc.mirrored && pySrc.at === rsSrc.at,
         `Rust ${rsSrc.at} / Python ${pySrc.at}`);
    } else {
      ok("一覧の突き合わせ: 元ファイルが無いので比べない（CI は試験用の品質データで比べる）", true, ll.text.slice(0, 120));
    }

    // 10a') データ元の並び（版 3.87.0 から窓が答える: sources_list.rs）。同じ問い合わせを Python でも引き、写しの様子・行の数
    //       （尋ねた時刻と、そのプロセスが開いた元で変わる）を除いて同じか
    {
      const canonS = (v) => Array.isArray(v) ? v.map(canonS) : v && typeof v === "object"
        ? Object.fromEntries(Object.keys(v).sort().filter((k) => !["mirror", "rows"].includes(k)).map((k) => [k, canonS(v[k])])) : v;
      const rs = await get("/api/sources"), py = await get("/api/sources?engine=python");
      let same = rs.r.status === 200 && py.r.status === 200 && py.by === "python";
      try { same = same && JSON.stringify(canonS(JSON.parse(rs.text))) === JSON.stringify(canonS(JSON.parse(py.text))); } catch (_) { same = false; }
      ok("データ元の並びは窓が答え、Python と同じ答え（写しの様子・行の数を除く）", rs.by === "shell" && same,
         `窓 ${rs.r.status} ${rs.by} / Python ${py.r.status} ${py.by}・${(JSON.parse(rs.text || "{}").items || []).length} 件`);
    }

    // 10b) 作業実績の設備（Python）: 答えが返る。フォルダに届かない（CI）ときも、理由つきで空の設備を返す（画面は案内を出す）
    const wl = await get("/api/worklog/files");
    let wlj = {}; try { wlj = JSON.parse(wl.text); } catch (_) { /* 下で言う */ }
    ok("作業実績の設備の問い合わせが答える（届かなければ理由つき）", wl.r.ok && Array.isArray(wlj.items) && (wlj.items.length > 0 || !!wlj.error || Array.isArray(wlj.new)),
       `設備 ${(wlj.items || []).length} 台・未登録 ${(wlj.new || []).length}・${wlj.error || "フォルダに届いた"}`);

    // 10c) 作業実績・データ元の一覧（版 3.60.0 から窓が段取り・写し・結合も受け持つ: lists.rs）。同じ問い合わせを Python でも引き、
    //      状態と答え（いつのデータか・かかった時間を除く）が同じか。設備・データ元が無い PC（CI）でも、失敗の答えどうしを比べる
    {
      const canon2 = (v) => Array.isArray(v) ? v.map(canon2) : v && typeof v === "object"
        ? Object.fromEntries(Object.keys(v).sort().filter((k) => !["timing", "source", "ms"].includes(k)).map((k) => [k, canon2(v[k])])) : v;
      const one = (wlj.items || []).find((x) => x.visible && x.state !== "missing");
      const eq = encodeURIComponent(one ? one.key : "無い設備");
      const asks = [`/api/worklog?equip=${eq}`, `/api/worklog?equip=${eq}&work=1&fill=1`, `/api/worklog?equip=${eq}&page=2&page_size=20`,
        `/api/worklog?equip=${eq}&work=1&total=` + encodeURIComponent("重量"), "/api/worklog?equip=" + encodeURIComponent("登録の無い設備"),
        "/api/src/wip?page=1", "/api/src/wip?group=1&page_size=30", "/api/src/" + encodeURIComponent("無い元")];
      const differ = [], by = [];
      // 写し待ち（503 copying）の答えは写しの進み具合（source）が尋ねた時刻で変わる。版 3.86.0 から画面は中身の準備を待たずに開くので、
      // 写し終えるまで（60 秒まで）待ってから比べる
      const copying = (x) => { try { return x.r.status === 503 && JSON.parse(x.text).kind === "copying"; } catch (_) { return false; } };
      for (const a of asks) {
        const pyAsk = a + (a.includes("?") ? "&" : "?") + "engine=python";
        let rs = await get(a), py = await get(pyAsk);
        for (const until = Date.now() + 60000; (copying(rs) || copying(py)) && Date.now() < until;) {
          await new Promise((r) => setTimeout(r, 500));
          rs = await get(a); py = await get(pyAsk);
        }
        by.push(rs.by);
        let same = rs.r.status === py.r.status && py.by === "python";
        try { same = same && JSON.stringify(canon2(JSON.parse(rs.text))) === JSON.stringify(canon2(JSON.parse(py.text))); } catch (_) { same = false; }
        if (!same) differ.push(`${a} ${rs.r.status}/${py.r.status}`);
      }
      ok(`作業実績・データ元の一覧は窓が答え、Python と同じ答え（${asks.length} 通り・作業でまとめる・ページ・失敗の答え）`,
         by.every((b) => b === "shell") && differ.length === 0, differ.length ? differ.join(" | ") : (one ? `設備 ${one.name}` : "設備なし（失敗の答えを比べた）"));

      // 10d) 集計表・グラフ（版 3.61.0 から窓が答える: pivot.rs）。列はカラムの札の答えから選ぶ（どの PC のデータでも比べられる）
      const J = (v) => encodeURIComponent(JSON.stringify(v));
      let col = "";
      try { col = ((JSON.parse((await get("/api/lotlist/pivot?fields=1")).text).fields || []).find((f) => !f.many) || {}).column || ""; } catch (_) { /* 列なし */ }
      const pv = ["/api/lotlist/pivot?fields=1", `/api/lotlist/pivot?rows=${J([{ column: col }])}&measures=${J([{ agg: "count" }, { agg: "lots" }])}`,
        `/api/lotlist/pivot?rows=${J([{ column: "無い列" }])}`, `/api/worklog/pivot?equip=${eq}&fields=1`,
        `/api/worklog/pivot?equip=${eq}&rows=${J([{ column: "@workday" }])}&cols=${J([{ column: "@shift" }])}&measures=${J([{ agg: "count" }, { agg: "lots" }])}`,
        `/api/src/wip/pivot?measures=${J([{ agg: "count" }, { agg: "lots" }])}`];
      const pdiff = [], pby = [];
      for (const a of pv) {
        const rs = await get(a), py = await get(a + "&engine=python");
        pby.push(rs.by);
        let same = rs.r.status === py.r.status && py.by === "python";
        try { same = same && JSON.stringify(canon2(JSON.parse(rs.text))) === JSON.stringify(canon2(JSON.parse(py.text))); } catch (_) { same = false; }
        if (!same) pdiff.push(`${a} ${rs.r.status}/${py.r.status}`);
      }
      ok(`集計表・グラフは窓が答え、Python と同じ答え（${pv.length} 通り・カラムの札・作業日×直・失敗の答え）`,
         pby.every((b) => b === "shell") && pdiff.length === 0, pdiff.length ? pdiff.join(" | ") : `列 ${col || "なし"}`);

      // 10e) ダッシュボードのパネル（版 3.62.0 から窓が答える: dashboard.rs）。いま（now）・写しの様子（mirrors）は問い合わせの時刻で変わるので比べない。
      //      版 3.63.0 から稼働（ガント・ABC 分析）も窓が答える（operation.rs）
      const canon3 = (v) => Array.isArray(v) ? v.map(canon3) : v && typeof v === "object"
        ? Object.fromEntries(Object.keys(v).sort().filter((k) => !["timing", "source", "ms", "now", "mirrors"].includes(k)).map((k) => [k, canon3(v[k])])) : v;
      const yd = { column: "@workday", kind: "yesterday" };
      const P = (p) => ({ id: "t1", title: "", body: { rows: [], cols: [], measures: [{ agg: "lots" }] }, ...p });
      const panels = [P({ visual: "kpi", source: "lot" }), P({ visual: "bar", source: "lot", body: { rows: [{ column: col || "無い列" }], cols: [], measures: [{ agg: "count" }] } }),
        P({ visual: "kpi", source: "work", period: yd, equips: one ? [one.name] : ["無い設備"] }),
        P({ visual: "time", source: "work", period: { column: "@workday", kind: "days", n: 14 }, body: { rows: [{ column: "@workday" }], cols: [], measures: [{ agg: "lots" }] } }),
        P({ visual: "kpi", source: "src:wip" }), { id: "b1", visual: "board", groups: [] },
        P({ visual: "bar", source: "lot", link: { sides: [{ source: "lot", key: { column: "@equip" } }, { source: "work", key: { column: "@equip" } }] } }),
        P({ visual: "bar", source: "file:x" }), P({ visual: "gantt", source: "work", period: yd }),
        P({ visual: "abc", source: "work", ops: { cls: "合金", qty: "time" } }), P({ visual: "abc", source: "work", ops: { span: "lead" } })];
      const ddiff = [], dby = [];
      const post = (q, p) => get("/api/dashboard/query" + q, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ panel: p }) });
      for (const p of panels) {
        const rs = await post("", p), py = await post("?engine=python", p);
        dby.push(rs.by);
        let same = rs.r.status === py.r.status && py.by === "python";
        try { same = same && JSON.stringify(canon3(JSON.parse(rs.text))) === JSON.stringify(canon3(JSON.parse(py.text))); } catch (_) { same = false; }
        if (!same) ddiff.push(`${p.visual}/${p.source || ""} ${rs.r.status}/${py.r.status}`);
      }
      ok(`ダッシュボードのパネルは窓が答え、Python と同じ答え（${panels.length} 通り・数字・グラフ・合わせた表・別のデータ・稼働・ABC 分析・失敗の答え）`,
         dby.every((b) => b === "shell") && ddiff.length === 0, ddiff.length ? ddiff.join(" | ") : `設備 ${one ? one.name : "なし"}`);
    }

    // 11) 配布の画面の係（窓）: 答えが返る・版を置けない人は理由つきで断られる（だれが置けるかは Python の権限）
    const rel = await get("/__desktop/release");
    let relj = {}; try { relj = JSON.parse(rel.text); } catch (_) { /* 下で言う */ }
    ok("配布の画面の係が答える（置き場に届くか・権限）", rel.by === "shell" && rel.r.ok && "reachable" in relj && relj.me,
       `${rel.r.status} reachable=${relj.reachable} canRelease=${(relj.me || {}).canRelease} ${relj.why || ""}`);
    // 覚えた答え（cached=1）: 上でたどった答えを、置き場をたどり直さずに返す（タブを開いたときに待たせない）
    const relT0 = performance.now(), relc = await get("/__desktop/release?cached=1"), relMs = performance.now() - relT0;
    let relcj = {}; try { relcj = JSON.parse(relc.text); } catch (_) { /* 下で言う */ }
    ok("配布の画面: 覚えた答えをすぐ返す（cached=1）", relc.r.ok && relcj.cached === true && !!relcj.me && relcj.reachable === relj.reachable,
       `${relMs.toFixed(0)}ms cached=${relcj.cached} checkedAt=${relcj.checkedAt}`);
    if (relj.me && !relj.me.canRelease) {
      const put = await get("/__desktop/release/place?name=x.zip", { method: "POST", headers: { "Content-Type": "application/zip" }, body: new Uint8Array([80, 75]) });
      ok("版を置けない人は理由つきで断られる", put.r.status === 403 && /開発者・メンテナンス者/.test(put.text), `${put.r.status} ${put.text.slice(0, 80)}`);
    }

    // 11b) 権限（版 3.65.0 から窓が決める: access.rs）: 画面が名乗った見出し X-TPA-Me は効かない。
    //     版 3.76.0 から /api/access/me は窓が自分の me で答えるので、見出しを捨ててから Python へ渡すことは、Python が答える
    //     タブの権限の GET（canEdit は me から決める）で確かめる。偽の me は書けない段（設備作業者・非表示）にする
    {
      const am = await get("/api/access/me");
      let amj = {}; try { amj = JSON.parse(am.text); } catch (_) { /* 下で言う */ }
      // 見出しの値は Latin-1 だけ送れる（日本語は fetch が断る）ので、偽の me は \u で書く（画面の悪い字もこの形で来る）
      const fake = JSON.stringify({ login: "FAKE", pc: "FAKE", pcSource: "", key: "FAKE", rows: [], revoked: null,
        flags: { role: "設備作業者", masterEdit: "非表示", masterEditStored: "非表示", matchedId: null, hiddenTabs: [] }, caps: { role: "設備作業者" } })
        .replace(/[\u0080-\uffff]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
      const forged = await get("/api/access/me", { headers: { "X-TPA-Me": fake } });
      let fj = {}; try { fj = JSON.parse(forged.text); } catch (_) { /* 下で言う */ }
      ok("権限: 窓が決めた名乗りで答え（版 3.76.0 から窓が答える）、画面が名乗った見出しは効かない", am.r.ok && forged.r.ok && am.by === "shell" && forged.by === "shell" && !!amj.role && amj.loginId !== "FAKE" && fj.loginId === amj.loginId && fj.role === amj.role,
         `${amj.loginId}@${amj.pcName} ${amj.role}・${amj.masterEdit} / 偽の見出し → ${fj.loginId} ${fj.role}`);
      const ta = await get("/api/masters/tabaccess"), tf = await get("/api/masters/tabaccess", { headers: { "X-TPA-Me": fake } });
      let taj = {}, tfj = {}; try { taj = JSON.parse(ta.text); tfj = JSON.parse(tf.text); } catch (_) { /* 下で言う */ }
      ok("権限: Python が答える道でも、画面が名乗った見出しは効かない（窓が捨てて自分の me を載せる）",
         // 書けるか（can_write）は切断中なら書けない。偽の me は書けない段なので、本当の me が書けるときだけ見分けられる（見分けたかを言葉に出す）
         ta.r.ok && tf.r.ok && ta.by === "python" && tf.by === "python" && taj.canEdit === (amj.canEditAdminMaster === true && !amj.revoked)
           && tfj.canEdit === taj.canEdit,
         `${ta.by} タブの権限 canEdit ${taj.canEdit} / 偽の見出し → ${tfj.canEdit}`
           + (taj.canEdit ? "（偽の見出しが効けば false になる形で確かめた）" : "（この PC は書けないので、偽の見出しは見分けられない）"));
    }

    // 12) 画面のエラーが無い（窓の外の受け口 /__desktop/update などが無くても、画面は黙って続ける）
    await sleep(500);
    const errs = window.__tpaErrors || [];
    ok("画面のエラーが無い", errs.length === 0, errs.join(" / "));

    // 13) 速さ（参考）: Python へ 30 回・Rust の部品 30 回の平均（ミリ秒）
    const avg = async (url) => { const s = performance.now(); for (let i = 0; i < 30; i++) await (await fetch(url)).arrayBuffer(); return (performance.now() - s) / 30; };
    const py = await avg("/api/build"), sh = await avg(`/static/js/shared.js?v=${fp}`);
    ok("問い合わせの速さ（参考）", py < 300, `Python ${py.toFixed(1)}ms / Rust の部品 ${sh.toFixed(1)}ms`);
  } catch (e) {
    ok("例外", false, e && (e.stack || e.message || e));
  }
  // 更新の係（この PC のアプリで動くときだけ取り込む）。取り込み中なら落ち着くまで待ち、状態を結果に添える（verify.py が読む）
  let update = null, info = null;
  try {
    const end = performance.now() + 60000;
    for (;;) {
      update = await (await fetch("/__desktop/update", { cache: "no-store" })).json();
      if (!["idle", "checking", "staging"].includes(update.state) || performance.now() > end) break;
      await sleep(500);
    }
    info = await infoReady();
    info.install = await (await fetch("/__desktop/install")).json();
    ok("更新の係が答える（取り込めない理由が無い）", update.state !== "error", `${update.state} ${update.ready || ""} ${update.problem || update.detail || ""}`);
  } catch (e) {
    ok("更新の係が答える", false, e && e.message);
  }
  const body = JSON.stringify({ ok: res.every((r) => r.ok), elapsed_ms: Math.round(performance.now() - t0), ua: navigator.userAgent, results: res,
    update, info: info && { exe: info.exe, program: info.program, installed: info.installed, version: (info.backend || {}).version,
      install: info.install, local_root: info.local_root } });
  await fetch("/__desktop/selftest", { method: "POST", headers: { "Content-Type": "application/json" }, body });
})();
