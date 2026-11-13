/* 自己診断（環境変数 TPA_SELFTEST=結果のファイル で起動したときだけ、窓が画面に流し込む）。
   本物の WebView の中から、窓（Rust）と中身（Python）の組が正しく動くかを確かめて /__desktop/selftest へ送る。窓は結果を書いて終わる。
   調べること: 起動が終わる・振り分け（部品と画面は Rust〈画面は Python の画面と突き合わせる〉・API は Python・窓のことは Rust）・使い回しの決まり・大きな日本語の本文・
   日本語の問い合わせ文字・40 本同時・安全な文脈・保存領域・保存（ダウンロード）・窓の情報・品質異常（Rust と Python の突き合わせ）・
   画面のエラーが無い・速さ。
   版 3.111.0: 中身（Python）が起きていなければ、Python を通す項目（ok）は「中身（Python）を通す項目」の包みに数えて飛ばし、窓だけの項目（okw）を流す
   （名前の一覧は desktop/bundle/verify.py の WINDOW_ONLY）。 */
(async () => {
  const res = [];
  const t0 = performance.now();
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
  // 中身（Python）の様子（版 3.111.0）: 起こしている最中は 130 秒まで待つ（Sidecar の start_wait 120 秒より長く）。起きなければ、
  // Python を通す項目（ok）は 1 つの包み「中身を通す項目」に数えて飛ばし、窓だけの項目（okw）は流す。窓だけの項目の名前の一覧は
  // desktop/bundle/verify.py の WINDOW_ONLY が持ち、Python の無い通しで全部が通ったかを見る
  let python = "starting";
  for (const until = performance.now() + 130000; performance.now() < until;) {
    try { python = (await (await fetch("/api/health", { cache: "no-store" })).json()).python || "?"; } catch (_) { python = "?"; }
    if (python !== "starting") break;
    await sleep(250);
  }
  const pyUp = python === "ready";
  // Python を通す項目の待ちの輪（最初の版を置く途中・写しの途中を尋ね直す）は、中身が起きていなければ待たない（1 回だけ尋ねる）
  const pyWait = (ms) => (pyUp ? ms : 0);
  const skipped = [];
  const okw = (name, cond, info = "") => res.push({ name, ok: !!cond, info: String(info).slice(0, 300), window: true });
  const ok = (name, cond, info = "") => (pyUp ? res.push({ name, ok: !!cond, info: String(info).slice(0, 300) }) : skipped.push(name));
  const get = async (url, opt) => { const r = await fetch(url, opt); return { r, by: r.headers.get("X-TPA-By"), text: await r.text() }; };
  const json = (method, body) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  // 窓の情報（版 3.111.0: 中身の版は窓が読んだ program_version。Python の準備〈backend〉を待たない。中身が起きていれば backend も載る）
  const infoReady = async () => {
    let i = {};
    for (let n = 0; n < 300; n++) {
      i = await (await fetch("/__desktop/info")).json();
      if (i.program_version && (!pyUp || (i.backend && i.backend.version))) return i;
      await sleep(200);
    }
    return i;
  };
  try {
    // 1) 起動が終わる（画面の JS が設定と自分の権限を読み終えた）
    const end = performance.now() + 60000;
    const booted = () => typeof state === "object" && state.config && state.me;
    while (!booted() && performance.now() < end) await sleep(200);
    okw("起動が終わる（設定と権限を読み終える）", booted(), ((performance.now() - t0) / 1000).toFixed(1) + " 秒");
    const app = document.querySelector('meta[name="tpa-app"]');
    okw("画面の題（窓が描いた HTML・アプリの名前）", app && document.title === app.content, document.title);
    okw("画面の JS が動いている（TPA の共通部品）", typeof TPA === "object" && typeof TPA.download === "function");

    // 2) 振り分けと使い回しの決まり
    const fp = (document.querySelector('meta[name="tpa-build"]') || {}).content || "x";
    const js = await get(`/static/js/shared.js?v=${fp}`);
    okw("部品は Rust が返す（指紋付きは長く使い回す）", js.by === "shell" && js.r.ok && /immutable/.test(js.r.headers.get("Cache-Control") || ""), js.by);
    const plain = await get("/static/js/shared.js");
    okw("指紋の無い部品は毎回確かめる（no-cache）", plain.by === "shell" && plain.r.headers.get("Cache-Control") === "no-cache" && plain.text === js.text);
    const three = await get(`/static/vendor/three/three-bundle.min.js?v=${fp}`);
    okw("大きな部品（three.js）も Rust が返す", three.by === "shell" && three.r.ok && three.text.length > 100000, `${three.r.status} ${three.text.length}字`);
    // 画面は窓が描く（版 3.85.0。src/page.rs）。使い回さない（no-store）・CSP の印。Python が描いた画面（?engine=python）と、印を揃えると 1 字も違わない
    // 先に Python の画面（共有に初期設定がまだ無い PC では、Python が描くときに写しから最初の版を作る。窓はその形を Python に任せる）。
    // 版 3.86.0 から最初の画面は Python の準備を待たずに窓が描くので、その版はここで初めてできることがある
    // 新しい共有を最初に開いたときは、最初の版を置く錠がぶつかって置けない回がある（「保存中」。窓はその間 Python に任せる）ので、
    // 置かれるまで 15 秒まで尋ね直す（版 3.89.0 の CI で、起動の直後に Python が描いた。10a' と同じ）
    let pyPage = await get("/?engine=python");
    let page = await get("/");
    for (const until = Date.now() + pyWait(15000); page.by !== "shell" && Date.now() < until;) {
      await new Promise((r) => setTimeout(r, 1000));
      pyPage = await get("/?engine=python"); page = await get("/");
    }
    const csp = page.r.headers.get("Content-Security-Policy") || "";
    okw("画面は窓が描く（使い回さない・CSP の印）", page.by === "shell" && page.r.ok && page.r.headers.get("Cache-Control") === "no-store" && /'nonce-[A-Za-z0-9_-]{22}'/.test(csp), `${page.by} ${csp.slice(0, 40)}`);
    const nonceOf = (x) => ((x.r.headers.get("Content-Security-Policy") || "").match(/nonce-([A-Za-z0-9_-]+)/) || [])[1] || "@";
    const norm = (x) => x.text.split(nonceOf(x)).join("@NONCE@");
    // 起動の直後は Python がマスタの最初の版を置いている最中のことがあり、2 回の読みの間に置かれると埋め込んだマスタの revision だけが
    // 食い違う（版 3.99.0 の CI: 窓の起動が 0.2 秒で、Python の種まきと重なった）。同じ時点の形になるまで 15 秒まで読み直す（比べる中身は同じ）
    for (const until = Date.now() + pyWait(15000); page.by === "shell" && pyPage.by === "python" && norm(page) !== norm(pyPage) && Date.now() < until;) {
      await new Promise((r) => setTimeout(r, 1000));
      pyPage = await get("/?engine=python"); page = await get("/");
    }
    const at = [...norm(page)].findIndex((c, i) => c !== norm(pyPage)[i]);
    ok("窓の画面と Python の画面が同じ（印を揃えて）", pyPage.by === "python" && norm(page) === norm(pyPage), at < 0 ? pyPage.by : `${at} 字目: ${norm(page).slice(Math.max(0, at - 30), at + 40)}`);
    const escape = await get("/static/%2e%2e/templates/index.html");
    // WebView は %2e%2e を道の .. に読んで畳むので、窓の static には来ず Python の 404（中身の項目）
    ok("static の外へは出ない", escape.r.status === 404, escape.r.status);

    // 3) API
    // 版 3.88.0 から /api/build・/api/changelog は窓が答える（src/small_reads.rs）。Python を通る確かめは ?engine=python で
    const b = await get("/api/build?engine=python");
    ok("API が答える（/api/build）", b.r.ok && b.by === "python" && JSON.parse(b.text).version, b.text.slice(0, 80));
    const ch = await get("/api/changelog?engine=python");
    ok("大きな答え（更新履歴）が欠けずに届く", ch.r.ok && ch.by === "python" && JSON.parse(ch.text).entries.length > 10, ch.text.length + " 字");
    const sb = await get("/api/build"), sch = await get("/api/changelog");
    // 更新履歴の先頭が中身の版と違う版（desktop/bundle/verify.py が版の字だけを書き換えた試験の版）は、焼いた更新履歴の版も違うので
    // 窓は Python に任せる（本物の配る版は tests/test_version.py が先頭と版を揃え、--release が焼く）
    const chv = (() => { try { const j = JSON.parse(ch.text); return j.entries[0].version === j.version; } catch (_) { return true; } })();
    ok("版と更新履歴は窓が答え、Python と 1 字も違わない", sb.by === "shell" && (sch.by === "shell" || !chv) && sb.text === b.text && sch.text === ch.text,
       `${sb.by}/${sch.by}・${sch.text.length} 字 / ${ch.text.length} 字`);
    const nf = await get("/api/no-such-route");
    ok("無いところは 404", nf.r.status === 404 && nf.by === "python", nf.r.status);
    // 画面の設定の控えは窓が答える（版 3.71.0。src/presence.rs）。engine=python は Python に任せる（中身との枠の往復を確かめる）
    const bad = await get("/api/ui-state?engine=python", json("POST", { changed: "形が違う" }));
    const why = (JSON.parse(bad.text).error || "");
    ok("誤りの答え（400 と日本語の理由）", bad.r.status === 400 && /形が違います/.test(why) && bad.by === "python", why);
    const wbad = await get("/api/ui-state", json("POST", { changed: "形が違う" }));
    okw("窓が答える誤り（画面の設定の控え）", wbad.r.status === 400 && wbad.by === "shell" && /形が違います/.test(JSON.parse(wbad.text).error || ""), wbad.text.slice(0, 80));
    const hb = await get("/api/heartbeat", json("POST", { visible: true }));
    let hbj = {}; try { hbj = JSON.parse(hb.text); } catch (_) { /* 下で言う */ }
    okw("心拍は窓が答える（中身の様子を添える。版 3.111.0 から中身が止まっていても 200）",
        hb.r.ok && hb.by === "shell" && "revoked" in hbj && hbj.python && hbj.python.state === python, `${hb.r.status} ${hb.by} python=${JSON.stringify(hbj.python)}`);

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
    const paths = Array.from({ length: 40 }, (_, i) => (i % 2 ? "/api/build?engine=python" : `/static/js/shared.js?v=p${i}`));
    const all = await Promise.all(paths.map((p) => get(p)));
    ok("40 本同時でも、それぞれの答えが届く", all.every((x, i) => x.r.ok && (i % 2 ? JSON.parse(x.text).version : x.by === "shell")));

    // 7) 安全な文脈・保存領域
    okw("安全な文脈（クリップボードへ写せる）", window.isSecureContext && !!(navigator.clipboard && navigator.clipboard.writeText),
       `isSecureContext=${window.isSecureContext}`);
    localStorage.setItem("tpaSelftestV1", "1");
    okw("localStorage が使える", localStorage.getItem("tpaSelftestV1") === "1");
    localStorage.removeItem("tpaSelftestV1");
    const idb = await new Promise((done) => { const r = indexedDB.open("tpaSelftest", 1); r.onsuccess = () => { r.result.close(); done(true); }; r.onerror = () => done(false); });
    okw("IndexedDB が使える", idb);

    // 8) 保存（ダウンロード）: 画面の保存の道（TPA.download）で CSV が名前どおり・中身どおりに届く。窓は自己診断のときだけ記録する
    TPA.download(new Blob(["﻿ロット,値\r\nA,1\r\n"], { type: "text/csv;charset=utf-8" }), "自己診断_保存.csv");
    let saved = null;
    for (let i = 0; i < 100 && !saved; i++) {
      await sleep(200);
      saved = (await (await fetch("/__desktop/downloads")).json()).find((x) => x.state === "finished");
    }
    okw("保存: CSV が日本語の名前どおり・中身どおりに届く", saved && saved.success && saved.head === "efbbbfe3" && /自己診断_保存.*\.csv$/.test(saved.path || ""),
       JSON.stringify(saved));

    // 9) 窓の情報（枠の約束の版・目印・受け持ち）
    const info = await infoReady();
    const ready = info.backend || {};
    ok("窓の情報: 枠の約束の版が中身と同じ・目印・作業場所", info.protocol === 1 && ready.protocol === info.protocol && /transferpitchanalyzer/.test(info.app_id) && !!info.local_root,
       `protocol ${info.protocol}/${ready.protocol} serves=${JSON.stringify(info.serves)} root=${info.local_root}`);
    ok("窓の版と中身の版が同じ", info.shell_version === ready.version, `${info.shell_version} / ${ready.version}`);

    // 10) 品質異常（Rust が写しから引く・lot.rs）。同じ問い合わせを Python（engine=python）でも引き、答えが同じか
    const ll = await get("/api/lotlist?page=1");
    okw("一覧は Rust が答える", ll.by === "shell", `${ll.by} ${ll.r.status}`);
    const llSrc = await get("/api/lotlist/source");
    okw("データの時刻は Rust が答える（共有を見に行かない）", llSrc.by === "shell" && llSrc.r.ok, llSrc.text.slice(0, 120));
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
      // 先に Python に尋ねる（共有にまだマスタの最初の版が無い PC では、Python が読んだときに写しから作る。それまで窓は Python に任せる）。
      // 新しい共有を最初に開いたときは、最初の版を置く錠がぶつかって置けない回がある（「保存中」）ので、置かれるまで 15 秒まで尋ね直す
      let py = await get("/api/sources?engine=python"), rs = await get("/api/sources");
      for (const until = Date.now() + pyWait(15000); rs.by !== "shell" && Date.now() < until;) {
        await new Promise((r) => setTimeout(r, 1000));
        py = await get("/api/sources?engine=python"); rs = await get("/api/sources");
      }
      let same = rs.r.status === 200 && py.r.status === 200 && py.by === "python";
      try { same = same && JSON.stringify(canonS(JSON.parse(rs.text))) === JSON.stringify(canonS(JSON.parse(py.text))); } catch (_) { same = false; }
      ok("データ元の並びは窓が答え、Python と同じ答え（写しの様子・行の数を除く）", rs.by === "shell" && same,
         `窓 ${rs.r.status} ${rs.by} / Python ${py.r.status} ${py.by}・${(JSON.parse(rs.text || "{}").items || []).length} 件`);
    }

    // 10a'') 参照先の項目（版 3.89.0 から窓が答える: settings_write.rs）。読む道は Python と同じ答え（配った設定のファイルの道は
    //        Windows の字〈\〉も）。書く道は書かずに確かめる（知らない項目・合わない値は窓が Python と同じ言葉で断る）
    {
      const canonP = (v) => Array.isArray(v) ? v.map(canonP) : v && typeof v === "object"
        ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonP(v[k])])) : v;
      // 違う所の道（最初の 1 つ）。新しい PC を最初に開いたときは、Python が共有へマスタの最初の版を置く途中で版の番号が動くので、
      // 置き終わるまで 15 秒まで尋ね直す（版 3.90.0 の手元の通しで、新しい PC の場面で 1 回だけ食い違った。ほかの確かめと同じ待ち方）
      const diffAt = (a, b, at = "") => {
        if (JSON.stringify(a) === JSON.stringify(b)) return "";
        if (a && b && typeof a === "object" && typeof b === "object") {
          for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = diffAt(a[k], b[k], `${at}/${k}`); if (d) return d; }
        }
        return `${at || "/"}: 窓 ${JSON.stringify(a)?.slice(0, 60)} / Python ${JSON.stringify(b)?.slice(0, 60)}`;
      };
      let py, rs, same = false, where = "";
      for (const until = Date.now() + pyWait(15000); ;) {
        py = await get("/api/settings?engine=python"); rs = await get("/api/settings");
        same = rs.r.status === 200 && py.r.status === 200 && py.by === "python";
        try { where = diffAt(canonP(JSON.parse(rs.text)), canonP(JSON.parse(py.text))); } catch (_) { where = "読めない答え"; }
        same = same && !where;
        if ((same && rs.by === "shell") || Date.now() > until) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      ok("参照先の項目は窓が答え、Python と同じ答え", rs.by === "shell" && same, `窓 ${rs.r.status} ${rs.by} / Python ${py.r.status} ${py.by}${where ? "・" + where : ""}`);
      const put = (key, value) => get("/api/settings/" + key, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value }) });
      const unk = await put("selftest.unknown", "x"), bad = await put("lot_list.refresh_seconds", "10.5");
      const why = (x) => { try { return JSON.parse(x.text); } catch (_) { return {}; } };
      // 書けない人の PC（管理のマスタを書けない段）では、窓の門番が先に断る（403 forbidden。これも窓が受けた形）
      const denied = [unk, bad].every((x) => x.by === "shell" && x.r.status === 403 && why(x).kind === "forbidden");
      ok("参照先を書く道も窓が受ける（知らない項目・整数でない値を、Python と同じ言葉で断る。書けない人は門番が断る）", denied || (
         unk.by === "shell" && unk.r.status === 400 && why(unk).error === "知らない項目です。"
         && bad.by === "shell" && bad.r.status === 400 && why(bad).kind === "invalid" && /整数で入れてください/.test(why(bad).error || "")),
         `${unk.by} ${unk.r.status} / ${bad.by} ${bad.r.status} ${(why(bad).error || "").slice(0, 40)}`);
    }

    // 10a‴) データ元の書く道（版 3.90.0 から窓が答える: sources_write.rs）。書かずに確かめる（無いデータ元を直す・項目の無い接続の設定は、
    //       窓が Python と同じ言葉で断る。書けない人の PC では窓の門番が先に断る）
    {
      const why = (x) => { try { return JSON.parse(x.text); } catch (_) { return {}; } };
      const send = (path, method, body) => get(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const gone = await send("/api/sources/selftest-none", "PUT", { "表示名": "x" });
      const conn = await send("/api/sources/selftest-none/conn", "PUT", { field: "place", value: "x" });
      const denied = [gone, conn].every((x) => x.by === "shell" && x.r.status === 403 && why(x).kind === "forbidden");
      ok("データ元を書く道も窓が受ける（無いデータ元は Python と同じ言葉で断る。書けない人は門番が断る）", denied || (
         gone.by === "shell" && gone.r.status === 400 && /そのデータ元はありません/.test(why(gone).error || "")
         && conn.by === "shell" && conn.r.status === 404 && why(conn).kind === "unknown"),
         `${gone.by} ${gone.r.status} / ${conn.by} ${conn.r.status} ${(why(gone).error || "").slice(0, 30)}`);
    }

    // 10b) 作業実績の設備（版 3.91.0 から窓が答える: worklog_write.rs）: 答えが返る。フォルダに届かない（CI）ときも、理由つきで空の設備を返す
    //      （画面は案内を出す）。同じ問い合わせを Python でも引き、何時間前か（尋ねた時刻で変わる）を除いて同じか
    const wl = await get("/api/worklog/files");
    let wlj = {}; try { wlj = JSON.parse(wl.text); } catch (_) { /* 下で言う */ }
    ok("作業実績の設備の問い合わせが答える（届かなければ理由つき）", wl.r.ok && Array.isArray(wlj.items) && (wlj.items.length > 0 || !!wlj.error || Array.isArray(wlj.new)),
       `設備 ${(wlj.items || []).length} 台・未登録 ${(wlj.new || []).length}・${wlj.error || "フォルダに届いた"}`);
    {
      const canonW = (v) => Array.isArray(v) ? v.map(canonW) : v && typeof v === "object"
        ? Object.fromEntries(Object.keys(v).sort().filter((k) => k !== "ageHours").map((k) => [k, canonW(v[k])])) : v;
      const differ = [], by = [];
      for (const a of ["/api/worklog/files?all=1", "/api/masters/worklog"]) {
        // 新しい PC を最初に開いたときは Python が共有へマスタの最初の版を置く途中なので、15 秒まで尋ね直す（10a' と同じ）
        let rs, py, same = false;
        for (const until = Date.now() + pyWait(15000); ;) {
          py = await get(a + (a.includes("?") ? "&" : "?") + "engine=python"); rs = await get(a);
          same = rs.r.status === py.r.status && py.by === "python";
          try { same = same && JSON.stringify(canonW(JSON.parse(rs.text))) === JSON.stringify(canonW(JSON.parse(py.text))); } catch (_) { same = false; }
          if ((same && rs.by === "shell") || Date.now() > until) break;
          await new Promise((r) => setTimeout(r, 1000));
        }
        by.push(rs.by);
        if (!same) differ.push(`${a} 窓 ${rs.r.status} / Python ${py.r.status} ${py.by}`);
      }
      ok("作業実績の登録の一覧は窓が答え、Python と同じ答え（何時間前かを除く）", by.every((x) => x === "shell") && !differ.length,
         differ.join("・") || `窓 ${by.join("・")}`);
      // 書く道は書かずに確かめる（無い行を直す・消すは Python と同じ言葉で断る。書けない人の PC では窓の門番が先に断る）
      const why = (x) => { try { return JSON.parse(x.text); } catch (_) { return {}; } };
      const send = (path, method, body) => get(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const gone = await send("/api/masters/worklog/987654321", "PUT", { "設備名": "x" });
      const keys = await send("/api/masters/worklog/order", "PUT", { keys: [] });
      const denied = [gone, keys].every((x) => x.by === "shell" && x.r.status === 403 && why(x).kind === "forbidden");
      ok("作業実績の登録を書く道も窓が受ける（無い行・空の並びを Python と同じ言葉で断る。書けない人は門番が断る）", denied || (
         gone.by === "shell" && gone.r.status === 404 && why(gone).error === "id=987654321 が見つかりません。"
         && keys.by === "shell" && keys.r.status === 400 && why(keys).error === "並べるキー（keys）がありません。"),
         `${gone.by} ${gone.r.status} / ${keys.by} ${keys.r.status} ${(why(gone).error || "").slice(0, 30)}`);
    }

    // 10b') 変換表（版 3.93.0 から窓が答える: conversions_write.rs）: 一覧と書き出しは Python と同じ答え。書く道は書かずに確かめる
    //       （無い表を直す・無い表を標準に戻すは Python と同じ言葉で断る。書けない人の PC では窓の門番が先に断る）
    {
      const canonC = (v) => Array.isArray(v) ? v.map(canonC) : v && typeof v === "object"
        ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonC(v[k])])) : v;
      const differ = [], by = [];
      for (const a of ["/api/masters/conversions", "/api/masters/conversions/export?which=defaults"]) {
        // 新しい PC を最初に開いたときは共有へマスタの最初の版を置く途中なので、15 秒まで尋ね直す（10a' と同じ）
        let rs, py, same = false;
        for (const until = Date.now() + pyWait(15000); ;) {
          py = await get(a + (a.includes("?") ? "&" : "?") + "engine=python"); rs = await get(a);
          same = rs.r.status === py.r.status && py.by === "python";
          try { same = same && JSON.stringify(canonC(JSON.parse(rs.text))) === JSON.stringify(canonC(JSON.parse(py.text))); } catch (_) { same = false; }
          if ((same && rs.by === "shell") || Date.now() > until) break;
          await new Promise((r) => setTimeout(r, 1000));
        }
        by.push(rs.by);
        if (!same) differ.push(`${a} 窓 ${rs.r.status} / Python ${py.r.status} ${py.by}`);
      }
      ok("変換表の一覧と書き出しは窓が答え、Python と同じ答え", by.every((x) => x === "shell") && !differ.length,
         differ.join("・") || `窓 ${by.join("・")}`);
      const why = (x) => { try { return JSON.parse(x.text); } catch (_) { return {}; } };
      const send = (path, method, body) => get(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const gone = await send("/api/masters/conversions/987654321", "PUT", {});
      const preset = await send("/api/masters/conversions/987654321/preset", "POST", {});
      const denied = [gone, preset].every((x) => x.by === "shell" && x.r.status === 403 && why(x).kind === "forbidden");
      ok("変換表を書く道も窓が受ける（無い表を直す・標準に戻すを Python と同じ言葉で断る。書けない人は門番が断る）", denied || (
         gone.by === "shell" && gone.r.status === 404 && why(gone).error === "id=987654321 が見つかりません。"
         && preset.by === "shell" && preset.r.status === 404 && why(preset).kind === "not_found"),
         `${gone.by} ${gone.r.status} / ${preset.by} ${preset.r.status} ${(why(gone).error || "").slice(0, 30)}`);
    }

    // 10b'') 設備グループ（版 3.94.0 から窓が答える: equipgroups_write.rs）: 一覧（選べる設備の出どころと件数も）は Python と同じ答え。
    //        書く道は書かずに確かめる（無いグループを直すは Python と同じ言葉で断る。書けない人の PC では窓の門番が先に断る）。
    //        スケジュールの元（CM3 の場所と設備の列。配る設定の既定）がある PC でも、版 3.96.0 から窓がスケジュールの係（CM3 へ取りに行く）
    //        なので窓が答え、Python（受け身。窓の状態を読む）と同じ答え（版 3.94.0 は Python に任せていた）
    {
      const canonG = (v) => Array.isArray(v) ? v.map(canonG) : v && typeof v === "object"
        ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonG(v[k])])) : v;
      const a = "/api/masters/equipgroups";
      let sch = false;
      try { sch = (JSON.parse((await get("/api/dashboard/sources")).text).items || []).some((x) => x.key === "src:sch" && x.place && x.equip); } catch (_) { sch = false; }
      const want = "shell";
      let rs, py, same = false;
      for (const until = Date.now() + pyWait(15000); ;) {      // 最初の版を置く途中・データ元の最初の写しの途中は尋ね直す（10b' と同じ）
        py = await get(a + "?engine=python"); rs = await get(a);
        same = rs.r.status === py.r.status && py.by === "python";
        try { same = same && JSON.stringify(canonG(JSON.parse(rs.text))) === JSON.stringify(canonG(JSON.parse(py.text))); } catch (_) { same = false; }
        if ((same && rs.by === want) || Date.now() > until) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      ok(sch ? "設備グループの一覧は、スケジュールの元（CM3）がある PC でも窓が答え、Python と同じ答え（版 3.96.0 から窓がスケジュールの係）"
             : "設備グループの一覧は窓が答え、Python と同じ答え（選べる設備の出どころと件数も）", rs.by === want && same,
         `窓 ${rs.r.status} ${rs.by} / Python ${py.r.status} ${py.by}${sch ? "・スケジュールの元あり" : ""}`);
      const why = (x) => { try { return JSON.parse(x.text); } catch (_) { return {}; } };
      const gone = await get(a + "/987654321", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note: "x" }) });
      ok("設備グループを書く道も窓が受ける（無いグループを直すを Python と同じ言葉で断る。書けない人は門番が断る）",
         gone.by === "shell" && (gone.r.status === 403 && why(gone).kind === "forbidden"
           || gone.r.status === 404 && why(gone).error === "id=987654321 が見つかりません。"),
         `${gone.by} ${gone.r.status} ${(why(gone).error || "").slice(0, 30)}`);
    }

    // 10b''') 更新の置き場と、だれが（版 3.95.0 から窓が答える: release_place.rs。更新の係・配布の画面も同じ答えを読み、Python が居なくても
    //         更新を確かめる）。Python（engine=python）と同じ答え（権限を読めない理由の字だけは比べない）。配布の置き場を写す進み具合も窓が答える
    {
      const sortU = (v) => Array.isArray(v) ? v.map(sortU) : v && typeof v === "object"
        ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortU(v[k])])) : v;
      const canonU = (t) => { const v = JSON.parse(t); if (v && v.who && "error" in v.who) v.who.error = "<理由>"; return JSON.stringify(sortU(v)); };
      let rs, py, same = false;
      for (const until = Date.now() + pyWait(15000); ;) {      // 最初の版を置く途中は尋ね直す（10b' と同じ）
        py = await get("/api/update/settings?engine=python"); rs = await get("/api/update/settings");
        same = rs.r.status === 200 && py.r.status === 200 && py.by === "python";
        try { same = same && canonU(rs.text) === canonU(py.text); } catch (_) { same = false; }
        if ((same && rs.by === "shell") || Date.now() > until) break;
        await sleep(1000);
      }
      const pg = await get("/api/release/place/progress");
      let st = ""; try { st = JSON.parse(pg.text).state; } catch (_) { st = ""; }
      ok("更新の置き場と、だれが（版を置ける・配る版を決められる）は窓が答え、Python と同じ答え。配布の置き場を写す進み具合も窓",
         rs.by === "shell" && same && pg.by === "shell" && pg.r.status === 200 && st === "idle",
         `窓 ${rs.r.status} ${rs.by} / Python ${py.r.status} ${py.by}・進み具合 ${pg.by} ${st}${same ? "" : "・" + rs.text.slice(0, 80) + " / " + py.text.slice(0, 80)}`);
    }

    // 10b'''') スケジュール（版 3.96.0 から窓がただ 1 つの係: schedule.rs。CM3 へ取りに行く・世代を置く・状態を書く）: 設備のタブ・
    //          データ元の一覧の行の様子・最初の設備の一覧（届かない CM3 なら 502 の言葉）を窓が答え、受け身の Python（engine=python。
    //          窓の状態のファイルを読み、取りに行く要るときは窓に知らせて待つ）と同じ答え。時刻は比べない
    {
      const dropT = (v) => Array.isArray(v) ? v.map(dropT) : v && typeof v === "object"
        ? Object.fromEntries(Object.keys(v).sort().filter((k) => !["fetchedAt", "checkedAt", "copiedAt", "timing"].includes(k)).map((k) => [k, dropT(v[k])])) : v;
      const canonS = (t) => { try { return JSON.stringify(dropT(JSON.parse(t))); } catch (_) { return "?"; } };
      let first = "";
      try { first = ((JSON.parse((await get("/api/schedule")).text).equipments || [])[0] || {}).key || ""; } catch (_) { first = ""; }
      const paths = ["/api/schedule", "/api/schedule/card"].concat(first ? [`/api/src/sch?equip=${encodeURIComponent(first)}`] : []);
      const got = [];
      let allSame = true;
      for (const p of paths) {
        let rs, py, same = false, tries = 0;
        const t0 = Date.now();
        for (const until = Date.now() + pyWait(30000); ;) {
          tries += 1;
          rs = await get(p);
          py = await get(p + (p.includes("?") ? "&" : "?") + "engine=python");
          same = rs.r.status === py.r.status && py.by === "python" && canonS(rs.text) === canonS(py.text);
          if ((same && rs.by === "shell") || Date.now() > until) break;
          await sleep(1000);
        }
        allSame = allSame && same && rs.by === "shell";
        // かかった時間と尋ねた回数も残す（版 3.96.0: Windows の CI の時間切れを調べた。届かない CM3 の名前の引きは Windows で数秒かかる）
        got.push(`${p.split("?")[0]} 窓 ${rs.r.status} ${rs.by} / Python ${py.r.status} ${py.by} ${Date.now() - t0}ms×${tries}${same ? "" : "・" + rs.text.slice(0, 60) + " / " + py.text.slice(0, 60)}`);
      }
      ok("スケジュールの設備のタブ・行の様子・一覧は窓が答え、受け身の Python と同じ答え（窓がただ 1 つの係）", allSame, got.join("・"));
    }

    // 10b-L) LotDsp の 9 本（版 3.98.0 から窓がただ 1 つの係: lotdsp.rs・lotdsp_direct.rs。見えない Edge・錠・学びの覚えは窓の 1 つ）:
    //          どの形も窓が答える（?engine=python も。Python の 9 本は来たら誤りの印）。本物の WebView2 の窓で、途中経過・学びの状態・
    //          画面の表の読み方（実績の表が無い画面は窓の LookupError の字）・形の違うロット番号・調べる道具の画面（CSP の印つき）
    {
      const rows = [];
      const want = [
        ["GET", "/api/lots/fetch-lotdsp/status", null, 200, (v) => v.busy === false],
        ["GET", "/api/lots/lotdsp-api/status?engine=python", null, 200, (v) => typeof v.ready === "boolean" && Array.isArray(v.missing)],
        ["POST", "/api/lots/import-lotdsp", { html: "<table><tr><td>a</td></tr></table>", lot_no: "L1" }, 400, (v) => v.type === "LookupError"],
        ["POST", "/api/lots/import-lotdsp", { html: 5 }, 400, (v) => v.kind === "invalid"],
        ["POST", "/api/lots/fetch-lotdsp", { lot_no: "L71;50" }, 400, (v) => v.kind === "invalid"],
        ["POST", "/api/lots/fetch-lotdsp/cancel", {}, 200, (v) => v.cancelled === false],
      ];
      let allOk = true;
      for (const [m, p, body, st, check] of want) {
        const g = await get(p, m === "GET" ? undefined : { method: m, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        let v = null; try { v = JSON.parse(g.text); } catch (_) { v = null; }
        const good = g.by === "shell" && g.r.status === st && v && check(v);
        allOk = allOk && good;
        rows.push(`${m} ${p.split("?")[0]} ${g.r.status} ${g.by}${good ? "" : "・" + g.text.slice(0, 60)}`);
      }
      const page = await get("/lotdsp-link");
      const pageOk = page.by === "shell" && page.r.status === 200 && /nonce-/.test(page.r.headers.get("Content-Security-Policy") || "")
        && page.text.includes("LotDsp 項目の紐づけ");
      rows.push(`/lotdsp-link ${page.r.status} ${page.by}`);
      ok("LotDsp の 9 本は窓が答える（途中経過・学びの状態・画面の表・ロット番号の形・調べる道具の画面。Python には来ない）", allOk && pageOk, rows.join("・"));
    }

    // 10b-B) 組む所の読み 7 本（版 3.99.0 から窓が答える: builder.rs）。本物の WebView2 の窓で、窓の答え（shell）と Python の答え
    //          （engine=python）が同じか（確かめるの ms・写しの係の時刻は比べない）。品質データの無い PC（CI）でも、失敗の答えどうしを比べる
    {
      const dropB = (v) => Array.isArray(v) ? v.map(dropB) : v && typeof v === "object"
        ? Object.fromEntries(Object.keys(v).sort().filter((k) => !["mtime", "checkedAt", "copiedAt", "at", "ageHours"].includes(k)).map((k) => [k, dropB(v[k])]))
        : typeof v === "string" ? v.replace(/・\d+ ms/g, "・ms") : v;
      const canonB = (t) => { try { return JSON.stringify(dropB(JSON.parse(t))); } catch (_) { return "?"; } };
      const want = [
        ["GET", "/api/dashboard/fields?source=lot", null],
        ["GET", "/api/data/columns", null],
        ["GET", "/api/sources/lot/columns", null],
        ["POST", "/api/sources/check", { place: "", role: "品質" }],
        ["POST", "/api/sources/lot/conn/check", { field: "refresh", value: "5" }],
        ["POST", "/api/sources/join/preview", { key: "lot", joins: [] }],
      ];
      // 最初に違った所（キーの道と両方の値）。前は答えの頭 60 字を書き、300 字で切れて違いが見えなかった（版 3.101.0 の Windows の CI）
      const firstDiff = (a, b, at = "") => {
        if (JSON.stringify(a) === JSON.stringify(b)) return "";
        if (a && b && typeof a === "object" && typeof b === "object" && Array.isArray(a) === Array.isArray(b)) {
          for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])]) {
            const d = firstDiff(a[k], b[k], `${at}.${k}`);
            if (d) return d;
          }
        }
        return `${at || "."}: ${JSON.stringify(a)?.slice(0, 50)} / ${JSON.stringify(b)?.slice(0, 50)}`;
      };
      const parse = (t) => { try { return dropB(JSON.parse(t)); } catch (_) { return t.slice(0, 50); } };
      const rows = [];
      let allOk = true;
      for (const [m, p, body] of want) {
        const opt = m === "GET" ? undefined : { method: m, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
        // 列の値の見本は写しの中身から出すので、写しが入れ替わる途中（更新の通しの、版を入れ替えた直後の起動）に窓と Python が
        // 違う時点を読むことがある。同じ時点の答えになるまで 30 秒まで読み直す（スケジュール・画面の比べと同じ。コードの違いは残る）
        let rs, py, good, tries = 0;
        for (const until = Date.now() + pyWait(30000); ;) {
          tries += 1;
          rs = await get(p, opt);
          py = await get(p + (p.includes("?") ? "&" : "?") + "engine=python", opt);
          // 「試す」は答えのファイルを作るので門番を通る（Python のときから同じ決まり）。書けない人（CI の一般ユーザー）は、窓の道も
          // engine=python の道も門番（窓）が同じ言葉で断る。そのときは両方が門番の 403 で、同じ答えなら同じとみなす
          const gate = rs.r.status === 403 && py.r.status === 403 && py.by === "shell";
          good = rs.by === "shell" && (py.by === "python" || gate) && rs.r.status === py.r.status && canonB(rs.text) === canonB(py.text);
          if (good || Date.now() > until) break;
          await sleep(1000);
        }
        allOk = allOk && good;
        rows.push(`${m} ${p.split("?")[0]} 窓 ${rs.r.status} ${rs.by} / Python ${py.r.status} ${py.by}${tries > 1 ? `×${tries}` : ""}${good ? "" : "・違い " + firstDiff(parse(rs.text), parse(py.text))}`);
      }
      // 食い違った道を先に書く（記録は 300 字で切る。版 3.99.0 の CI で 6 本目の食い違いが切れて見えなかった）
      rows.sort((a, b) => b.includes("・違い ") - a.includes("・違い "));
      ok("組む所の読み 7 本は窓が答え、Python と同じ答え（札・当てる列・結合の欄の列・確かめる・試す）", allOk, rows.join("・"));
    }

    // 10b-H) 生きているか（版 3.102.0。主のセッションの決め 5）: GET /api/health は窓が答え、Python の様子を python に添える
    //          （ready・starting・stopped）。?engine=python は Python の道（Python が答えているかの印。{status: ok}）
    {
      const rs = await get("/api/health");
      const py = await get("/api/health?engine=python");
      let rv = null, pv = null;
      try { rv = JSON.parse(rs.text); pv = JSON.parse(py.text); } catch (_) { rv = rv || null; }
      const good = rs.by === "shell" && rs.r.status === 200 && rv && rv.status === "ok" && rv.by === "window"
        && ["ready", "starting", "stopped"].includes(rv.python) && py.by === "python" && py.r.status === 200 && pv && pv.status === "ok";
      ok("生きているかは窓が答え、Python の様子を添える（?engine=python は Python の印）", good,
        `${good ? "" : "食い違い・"}窓 ${rs.r.status} ${rs.by} ${rs.text.slice(0, 80)} / Python ${py.r.status} ${py.by} ${py.text.slice(0, 40)}`);
    }

    // 10b-P) 置き場と設定の 8 本（版 3.101.0 から窓が答える: master_place.rs・folder_browse.rs・builder.rs の check_entry・
    //          access_write.rs の tabs_answer）。本物の WebView2 の窓で、窓の答え（shell）と Python の答え（engine=python）が同じか
    //          （このプロセスの覚え〈last_sync・error〉と錠の残り秒は比べない）。CI は一般ユーザーで動くので、門番が断る形は両方が同じ 403 で同じ言葉なら
    //          同じとみなす（10b-B の gate と同じ）。引っ越し（move）は写す係が窓の 1 つ: engine=python は Python が 409 で断る
    {
      const dropP = (v) => Array.isArray(v) ? v.map(dropP) : v && typeof v === "object"
        ? Object.fromEntries(Object.keys(v).sort().filter((k) => !["last_sync", "error", "remaining"].includes(k)).map((k) => [k, dropP(v[k])]))
        : v;
      const canonP = (t) => { try { return JSON.stringify(dropP(JSON.parse(t))); } catch (_) { return "?"; } };
      const want = [
        ["GET", "/api/masters/status", null],
        ["GET", "/api/masters/place", null],
        ["POST", "/api/masters/place/check", { parent: "", name: "x" }],
        ["POST", "/api/fs/browse", { path: "" }],
        ["GET", "/api/fs/places", null],
        ["POST", "/api/settings/check", { key: "work_log.pattern", value: "実績_*.db" }],
        ["GET", "/api/masters/tabaccess", null],
      ];
      const rows = [];
      let allOk = true;
      for (const [m, p, body] of want) {
        const opt = m === "GET" ? undefined : { method: m, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
        let rs = await get(p, opt);
        // 共有にまだ無いマスタの最初の版を置く（種まき）のは Python の係（版 3.101.0 の主のセッションの決め）。窓は種まきの要る status・place を
        // Python に任せるので、新しい置き場の最初の 1 回は Python が答えて種をまく。まき終えた後は窓が答える
        if (rs.by === "python" && p.startsWith("/api/masters/")) rs = await get(p, opt);
        const py = await get(p + "?engine=python", opt);
        const gate = rs.r.status === 403 && py.r.status === 403;
        const good = rs.by === "shell" && (py.by === "python" || gate) && rs.r.status === py.r.status && canonP(rs.text) === canonP(py.text);
        allOk = allOk && good;
        rows.push(`${m} ${p} 窓 ${rs.r.status} ${rs.by} / Python ${py.r.status} ${py.by}${good ? "" : "・" + rs.text.slice(0, 60) + " / " + py.text.slice(0, 60)}`);
      }
      // 引っ越し: 窓は門番（一般ユーザーは 403）か確かめ（名前が空は 400）で答え、engine=python は Python が「窓の係」と 409 で断る（写さない）
      const mv = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parent: "", name: "" }) };
      const mrs = await get("/api/masters/place/move", mv);
      const mpy = await get("/api/masters/place/move?engine=python", mv);
      let mk = ""; try { mk = JSON.parse(mpy.text).kind; } catch (_) { mk = ""; }
      const moveOk = mrs.by === "shell" && [400, 403].includes(mrs.r.status) && (mpy.r.status === 409 && mk === "busy" || mpy.r.status === 403);
      allOk = allOk && moveOk;
      rows.push(`POST move 窓 ${mrs.r.status} ${mrs.by} / Python ${mpy.r.status} ${mk}${moveOk ? "" : "・" + mrs.text.slice(0, 60) + " / " + mpy.text.slice(0, 60)}`);
      // 食い違った道を先に書く（記録は 300 字で切る）
      rows.sort((a, b) => (b.includes("・{") || b.includes(" / {")) - (a.includes("・{") || a.includes(" / {")));
      ok("置き場と設定の 8 本は窓が答え、Python と同じ答え（置き場の状態・確かめる・参照…・参照先の確かめる・タブの権限。引っ越しは窓の係）", allOk, rows.join("・"));
    }

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
        for (const until = Date.now() + pyWait(60000); (copying(rs) || copying(py)) && Date.now() < until;) {
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
      // 待っているパネルの段（版 3.97.0。desktop/src/progress.rs）: 印を付けた問い合わせの段を窓が覚えて答える（済み・数えた段・前回の時間）。
      // 窓が答えない形（?engine=python）は「python」と経過だけ
      const tag = `selftest-${Date.now()}`, tp = panels[3];
      await post(`?ask=${tag}a`, tp);
      await post(`?ask=${tag}b`, tp);
      await post(`?ask=${tag}c&engine=python`, tp);
      const pg = await get(`/api/dashboard/progress?ask=${tag}a,${tag}b,${tag}c,無い印`);
      let pj = {}; try { pj = JSON.parse(pg.text).asks || {}; } catch (_) { /* 下で言う */ }
      const [pa, pb, pc] = [pj[`${tag}a`] || {}, pj[`${tag}b`] || {}, pj[`${tag}c`] || {}];
      ok("待っているパネルの段を窓が答える（済み・前回の時間・Python に任せた形は python と経過だけ）",
         pg.by === "shell" && pg.r.ok && pa.done === true && typeof pa.elapsedMs === "number" && pc.stage === "python" && !("n" in pc) && Object.keys(pj).length === 3,
         `${pg.r.status} a=${JSON.stringify(pa)} b.prevMs=${pb.prevMs} c=${pc.stage}`);
    }

    // 11) 配布の画面の係（窓）: 答えが返る・版を置けない人は理由つきで断られる（だれが置けるかは Python の権限）
    const rel = await get("/__desktop/release");
    let relj = {}; try { relj = JSON.parse(rel.text); } catch (_) { /* 下で言う */ }
    okw("配布の画面の係が答える（置き場に届くか・権限）", rel.by === "shell" && rel.r.ok && "reachable" in relj && relj.me,
       `${rel.r.status} reachable=${relj.reachable} canRelease=${(relj.me || {}).canRelease} ${relj.why || ""}`);
    // 覚えた答え（cached=1）: 上でたどった答えを、置き場をたどり直さずに返す（タブを開いたときに待たせない）
    const relT0 = performance.now(), relc = await get("/__desktop/release?cached=1"), relMs = performance.now() - relT0;
    let relcj = {}; try { relcj = JSON.parse(relc.text); } catch (_) { /* 下で言う */ }
    okw("配布の画面: 覚えた答えをすぐ返す（cached=1）", relc.r.ok && relcj.cached === true && !!relcj.me && relcj.reachable === relj.reachable,
       `${relMs.toFixed(0)}ms cached=${relcj.cached} checkedAt=${relcj.checkedAt}`);
    if (relj.me && !relj.me.canRelease) {
      const put = await get("/__desktop/release/place?name=x.zip", { method: "POST", headers: { "Content-Type": "application/zip" }, body: new Uint8Array([80, 75]) });
      okw("版を置けない人は理由つきで断られる", put.r.status === 403 && /開発者・メンテナンス者/.test(put.text), `${put.r.status} ${put.text.slice(0, 80)}`);
    }

    // 11b) 権限（版 3.65.0 から窓が決める: access.rs）: 画面が名乗った見出し X-TPA-Me は効かない。
    //     版 3.76.0 から /api/access/me は窓が自分の me で答えるので、見出しを捨ててから Python へ渡すことは、Python が答える
    //     タブの権限の GET（canEdit は me から決める）で確かめる。偽の me は書けない段（設備作業者・非表示）にする。
    //     版 3.101.0 からタブの権限の GET も窓が答えるので、engine=python で Python へ回した道で確かめる（窓は見出しを捨てて自分の me を載せる）
    {
      const am = await get("/api/access/me");
      let amj = {}; try { amj = JSON.parse(am.text); } catch (_) { /* 下で言う */ }
      // 見出しの値は Latin-1 だけ送れる（日本語は fetch が断る）ので、偽の me は \u で書く（画面の悪い字もこの形で来る）
      const fake = JSON.stringify({ login: "FAKE", pc: "FAKE", pcSource: "", key: "FAKE", rows: [], revoked: null,
        flags: { role: "設備作業者", masterEdit: "非表示", masterEditStored: "非表示", matchedId: null, hiddenTabs: [] }, caps: { role: "設備作業者" } })
        .replace(/[\u0080-\uffff]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
      const forged = await get("/api/access/me", { headers: { "X-TPA-Me": fake } });
      let fj = {}; try { fj = JSON.parse(forged.text); } catch (_) { /* 下で言う */ }
      okw("権限: 窓が決めた名乗りで答え（版 3.76.0 から窓が答える）、画面が名乗った見出しは効かない", am.r.ok && forged.r.ok && am.by === "shell" && forged.by === "shell" && !!amj.role && amj.loginId !== "FAKE" && fj.loginId === amj.loginId && fj.role === amj.role,
         `${amj.loginId}@${amj.pcName} ${amj.role}・${amj.masterEdit} / 偽の見出し → ${fj.loginId} ${fj.role}`);
      const ta = await get("/api/masters/tabaccess?engine=python"), tf = await get("/api/masters/tabaccess?engine=python", { headers: { "X-TPA-Me": fake } });
      let taj = {}, tfj = {}; try { taj = JSON.parse(ta.text); tfj = JSON.parse(tf.text); } catch (_) { /* 下で言う */ }
      ok("権限: Python が答える道でも、画面が名乗った見出しは効かない（窓が捨てて自分の me を載せる）",
         // 書けるか（can_write）は切断中なら書けない。偽の me は書けない段なので、本当の me が書けるときだけ見分けられる（見分けたかを言葉に出す）
         ta.r.ok && tf.r.ok && ta.by === "python" && tf.by === "python" && taj.canEdit === (amj.canEditAdminMaster === true && !amj.revoked)
           && tfj.canEdit === taj.canEdit,
         `${ta.by} タブの権限 canEdit ${taj.canEdit} / 偽の見出し → ${tfj.canEdit}`
           + (taj.canEdit ? "（偽の見出しが効けば false になる形で確かめた）" : "（この PC は書けないので、偽の見出しは見分けられない）"));
    }

    // 11c) 出さないタブ・権限の札・マスタ管理の入口（版 3.111.0）: 中身（Python）が止まっていても窓の名乗りで決める（前は 503 の本文を me にし、
    //      出さないタブが出た・札が空・入口が消えた）。利用状況のいま使っている印に中身の様子（起きていなければ stopped）
    {
      const me = state.me || {}, hid = me.hiddenTabs || [];
      const denied = Object.entries(FIXED_TAB_KEY).filter(([, k]) => hid.includes(k))
        .every(([screen]) => { const b = document.querySelector(`.screen-tabs [data-screen="${screen}"]`); return !b || b.hasAttribute("data-denied"); });
      const srcShown = [...document.querySelectorAll('.screen-tabs [data-screen^="src:"]')].filter((b) => hid.includes(b.dataset.screen.slice(4)));
      okw("出さないタブを出さない・権限の札とマスタ管理の入口は窓の名乗り（中身が止まっていても）",
          typeof me.role === "string" && document.querySelector("#meChip").textContent === me.role && denied && !srcShown.length
            && document.querySelector("#masterBtn").classList.contains("hidden") === !me.canOpenMaster,
          `python=${python} 区分 ${me.role} 出さない ${JSON.stringify(hid)} 札「${document.querySelector("#meChip").textContent}」 入口 ${!document.querySelector("#masterBtn").classList.contains("hidden")}`);
      let mine = null, st = 0;
      for (const until = Date.now() + 15000; Date.now() < until;) {
        const pr = await get("/api/presence");
        st = pr.r.status;
        if (!pr.r.ok) break;
        let pj = {}; try { pj = JSON.parse(pr.text); } catch (_) { /* 下で言う */ }
        mine = ((pj.fleet || {}).items || []).find((x) => x.key === pj.me) || null;
        const want = pyUp ? null : python;
        if (mine && ((mine.python && mine.python.state) || null) === want) break;
        await sleep(500);
      }
      okw("利用状況のいま使っている印に中身の様子（起きていなければ stopped・起きていれば無い）",
          st === 403 || (mine && ((mine.python && mine.python.state) || null) === (pyUp ? null : python)),
          st === 403 ? "この PC の区分は利用状況を見られない（見ない）" : `${st} ${JSON.stringify(mine && mine.python)}`);
    }

    // 12) 画面のエラーが無い（窓の外の受け口 /__desktop/update などが無くても、画面は黙って続ける）
    await sleep(500);
    const errs = window.__tpaErrors || [];
    okw("画面のエラーが無い", errs.length === 0, errs.join(" / "));

    // 13) 速さ（参考）: Python へ 30 回・Rust の部品 30 回の平均（ミリ秒）
    const avg = async (url) => { const s = performance.now(); for (let i = 0; i < 30; i++) await (await fetch(url)).arrayBuffer(); return (performance.now() - s) / 30; };
    const py = await avg("/api/build?engine=python"), sh = await avg(`/static/js/shared.js?v=${fp}`);
    ok("問い合わせの速さ（参考）", py < 300, `Python ${py.toFixed(1)}ms / Rust の部品 ${sh.toFixed(1)}ms`);
  } catch (e) {
    okw("例外", false, e && (e.stack || e.message || e));
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
    okw("更新の係が答える（取り込めない理由が無い）", update.state !== "error", `${update.state} ${update.ready || ""} ${update.problem || update.detail || ""}`);
  } catch (e) {
    okw("更新の係が答える", false, e && e.message);
  }
  // 中身を通す項目（中身が起きていないときに飛ばした物）は 1 つの包みに数える（版 3.111.0）
  if (skipped.length) res.push({ name: "中身（Python）を通す項目", ok: true, window: true, skipped: skipped.length, info: `中身が起きていない（${python}）: ${skipped.length} 項目を飛ばした`, names: skipped });
  const body = JSON.stringify({ ok: res.every((r) => r.ok), elapsed_ms: Math.round(performance.now() - t0), ua: navigator.userAgent, results: res,
    python, skipped: skipped.length,
    update, info: info && { exe: info.exe, program: info.program, installed: info.installed, version: info.program_version,
      backend_version: (info.backend || {}).version, install: info.install, local_root: info.local_root } });
  await fetch("/__desktop/selftest", { method: "POST", headers: { "Content-Type": "application/json" }, body });
})();
