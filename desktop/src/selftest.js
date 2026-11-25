/* 自己診断（環境変数 TPA_SELFTEST=結果のファイル で起動したときだけ、窓が画面に流し込む）。
   本物の WebView の中から、窓（Rust）が画面と道に正しく答えるかを確かめて /__desktop/selftest へ送る。窓は結果を書いて終わる。
   調べること: 起動が終わる・振り分け（部品・画面・API・窓のこと）・使い回しの決まり・大きな日本語の本文・日本語の問い合わせ文字・40 本同時・
   安全な文脈・保存領域・保存（ダウンロード）・窓の情報・品質異常・データ元・マスタの読み書きの道・スケジュール・LotDsp・組む所・置き場・
   作業実績・集計表・ダッシュボード・権限・画面のエラーが無い・速さ・窓が答えない道が無い。
   版 3.118.1（段 ④ の 2 つ目）: 項目はすべて窓だけの確かめ（okw）。中身（Python）とは比べない（製品の窓は中身を起こさない: python は absent）。
   値の正しさは cargo の突き合わせの試験（*_parity・焼いた表）が持ち、ここでは本物の窓の道を通した「答えの形・道どうしの数が合う・場面の決まった値・
   決めた答え」を見る。各項目の info の頭に、何と比べたかを書く（[形]・[道どうし]・[場面]・[決めた答え]）。
   名前は固定の字で、desktop/bundle/selftest_names.json の 1 か所と同じ（desktop/bundle/test_bundle.py が過不足を見る。verify.py が読む）。
   節ごとに part() で守る: 1 つの節の例外は「例外: 節の名前」の 1 項目になり、後ろの節は流れる。 */
(async () => {
  const res = [];
  const t0 = performance.now();
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
  const okw = (name, cond, info = "") => res.push({ name, ok: !!cond, info: String(info).slice(0, 300), window: true });
  // 節の守り（版 3.118.1）: 節の中の例外は、その節の名前つきの失敗 1 つにして次の節へ進む
  const part = async (name, fn) => {
    try { await fn(); } catch (e) { okw("例外: " + name, false, `${(e && e.message) || e}・${(e && e.stack) || ""}`); }
  };
  const get = async (url, opt) => { const r = await fetch(url, opt); return { r, by: r.headers.get("X-TPA-By"), text: await r.text() }; };
  const json = (method, body) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const parse = (t) => { try { return JSON.parse(t); } catch (_) { return null; } };
  const J = (v) => encodeURIComponent(JSON.stringify(v));
  // 最初に違う所（版 3.118.1 の作った後の採点の割れ 8。比べる確かめはどれもこれ 1 つで比べ、info に違う鍵の道を出す）:
  // 2 つの値を同じ順にたどり、最初に違う鍵の道（例 "rows[3].設備"・根なら "(根)"）。同じなら ""。表の鍵の並びの順は見ない
  // firstDiff:start
  const firstDiff = (a, b, at = "") => {
    if (a === b) return "";
    const here = at || "(根)";
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b)) return here;
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (i >= a.length || i >= b.length) return `${at}[${i}]`;
        const d = firstDiff(a[i], b[i], `${at}[${i}]`);
        if (d) return d;
      }
      return "";
    }
    if (a && b && typeof a === "object" && typeof b === "object") {
      for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
        const p = at ? `${at}.${k}` : k;
        if (!(k in a) || !(k in b)) return p;
        const d = firstDiff(a[k], b[k], p);
        if (d) return d;
      }
      return "";
    }
    return here;
  };
  // firstDiff:end
  // 尋ねた時刻で変わる鍵を外した形（同じ問い合わせを 2 回引いて比べるとき）
  const dropKeys = (keys) => {
    const f = (v) => Array.isArray(v) ? v.map(f) : v && typeof v === "object"
      ? Object.fromEntries(Object.keys(v).sort().filter((k) => !keys.includes(k)).map((k) => [k, f(v[k])])) : v;
    return f;
  };
  // 窓の情報（中身の版は窓が読んだ program_version）
  const infoReady = async () => {
    let i = {};
    for (let n = 0; n < 300; n++) {
      i = await (await fetch("/__desktop/info")).json();
      if (i.program_version) return i;
      await sleep(200);
    }
    return i;
  };
  // 試験の版（desktop/bundle/verify.py が program の版の字だけを書き換えた版）は、焼いた更新履歴の版が中身の版と違うので、
  // 窓は更新履歴を答えない（503 window_unanswered。本物の配る版は tests/test_version.py が先頭と版を揃え、--release が焼く）
  let info = {}, testVersion = false, python = "?", fp = "x";
  let llj = {}, llSrc = null, llCount = 0, wlj = {}, one = null, eq = "", col = "", amj = {}, lots = null;
  const pageSize = (j) => (j && typeof j.page_size === "number" ? j.page_size : 0);
  // 集計表・パネルの答えの総計の升（行・列の段が空の升）
  const total = (v) => (((v || {}).cells || []).find((c) => !(c.r || []).length && !(c.c || []).length) || {}).v || [];

  await part("起動", async () => {
    // 1) 起動が終わる（画面の JS が設定と自分の権限を読み終えた）
    // 画面の JS（app.js）が読み込みで落ちた版（boot が無い）は、窓が確かめの上限で前の版へ戻して開き直すまで待つ（その窓の結果を書かない）
    const end = performance.now() + (typeof boot === "function" ? 60000 : 150000);
    // 権限を読めない（窓が名乗りを決められない）ときは、その形（「権限 ?」）に着けば起動が終わった（版 3.111.0）
    const booted = () => typeof state === "object" && state.config && (state.me || state.meUnknown);
    while (!booted() && performance.now() < end) await sleep(200);
    okw("起動が終わる（設定と権限を読み終える）", booted(), ((performance.now() - t0) / 1000).toFixed(1) + " 秒");
    const app = document.querySelector('meta[name="tpa-app"]');
    okw("画面の題（窓が描いた HTML・アプリの名前）", app && document.title === app.content, document.title);
    okw("画面の JS が動いている（TPA の共通部品）", typeof TPA === "object" && typeof TPA.download === "function");
    info = await infoReady();
    testVersion = !!info.shell_version && info.shell_version !== info.program_version;
    try { python = (await (await fetch("/api/health", { cache: "no-store" })).json()).python || "?"; } catch (_) { python = "?"; }
  });

  await part("振り分け", async () => {
    // 2) 振り分けと使い回しの決まり
    fp = (document.querySelector('meta[name="tpa-build"]') || {}).content || "x";
    const js = await get(`/static/js/shared.js?v=${fp}`);
    okw("部品は Rust が返す（指紋付きは長く使い回す）", js.by === "shell" && js.r.ok && /immutable/.test(js.r.headers.get("Cache-Control") || ""), js.by);
    const plain = await get("/static/js/shared.js");
    okw("指紋の無い部品は毎回確かめる（no-cache）", plain.by === "shell" && plain.r.headers.get("Cache-Control") === "no-cache" && plain.text === js.text);
    const three = await get(`/static/vendor/three/three-bundle.min.js?v=${fp}`);
    okw("大きな部品（three.js）も Rust が返す", three.by === "shell" && three.r.ok && three.text.length > 100000, `${three.r.status} ${three.text.length}字`);
    // 画面は窓が描く（版 3.85.0。src/page.rs）。使い回さない（no-store）・CSP の印
    const page = await get("/");
    const csp = page.r.headers.get("Content-Security-Policy") || "";
    okw("画面は窓が描く（使い回さない・CSP の印）", page.by === "shell" && page.r.ok && page.r.headers.get("Cache-Control") === "no-store" && /'nonce-[A-Za-z0-9_-]{22}'/.test(csp), `${page.by} ${csp.slice(0, 40)}`);
    // 画面の字の形（版 3.118.1。前は Python が描いた画面と 1 字ずつ比べた。値の正しさは cargo の page_parity・焼いた本 settings.pages）:
    // 型の字が残らない・目印と指紋と版の字が窓の答えとそろう・どの <script> も CSP の印つきか部品・部品は全部窓が返す
    const nonce = (csp.match(/nonce-([A-Za-z0-9_-]+)/) || [])[1] || "@";
    const bad = [];
    if (/\{\{|\{%/.test(page.text)) bad.push("型の字が残る");
    const meta = (n) => ((page.text.match(new RegExp(`<meta name="${n}" content="([^"]*)"`)) || [])[1]);
    if (meta("tpa-build") !== fp) bad.push(`指紋 ${meta("tpa-build")} / ${fp}`);
    if (meta("tpa-app") !== (document.querySelector('meta[name="tpa-app"]') || {}).content) bad.push("目印");
    if (!page.text.includes(`VER${info.program_version}`)) bad.push(`版の字 VER${info.program_version} が無い`);
    const tags = [...page.text.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]);
    const inline = tags.filter((a) => !/\bsrc=/.test(a));
    const wrong = inline.filter((a) => (a.match(/nonce="([^"]*)"/) || [])[1] !== nonce);
    if (!inline.length || wrong.length) bad.push(`印の無い・違う script ${wrong.length}/${inline.length}`);
    const srcs = [...page.text.matchAll(/<script src="([^"]+)"|<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1] || m[2]).filter((u) => u.startsWith("/static/"));
    const parts = await Promise.all(srcs.map((u) => get(u.replace(/&amp;/g, "&"))));
    const miss = srcs.filter((u, i) => !(parts[i].by === "shell" && parts[i].r.ok));
    if (!srcs.length || miss.length) bad.push(`部品 ${miss.length}/${srcs.length} 本が窓から来ない ${miss.slice(0, 2).join(" ")}`);
    okw("画面の字の形（版・指紋・CSP の印がそろい、部品は全部窓が返す）", page.by === "shell" && !bad.length,
        `[形・道どうし] ${bad.join("・") || `script ${tags.length}（印つき ${inline.length}）・部品 ${srcs.length} 本`}`);
    // WebView は %2e%2e を道の .. に読んで畳むので、窓の static には来ない（版 3.118.0 から窓の言葉で断る: 503 window_unanswered。
    // 畳まない WebView なら static の 404）。どちらでも型の字（templates/index.html）は返らない
    const escape = await get("/static/%2e%2e/templates/index.html");
    const ej = parse(escape.text) || {};
    okw("static の外へは出ない（畳んだ道は窓の言葉で断り、型の字を返さない）", escape.by === "shell" && !/\{\{|<html/i.test(escape.text)
        && (escape.r.status === 404 || (escape.r.status === 503 && ej.kind === "window_unanswered")), `[形] ${escape.r.status} ${escape.by} ${ej.kind || ""} ${ej.route || ""}`);
  });

  await part("API", async () => {
    // 3) API（版 3.88.0 から /api/build・/api/changelog は窓が答える: src/small_reads.rs）
    const b = await get("/api/build");
    const bj = parse(b.text) || {};
    okw("API が答える（/api/build は窓が答え、版は中身の版）", b.r.ok && b.by === "shell" && bj.version === info.program_version,
        `[道どうし] ${b.by} ${bj.version} / 窓の情報 ${info.program_version}`);
    const ch = await get("/api/changelog");
    const cj = parse(ch.text) || {};
    // 試験の版（窓と中身の版が違う）は窓が答えない形（上の説明）
    const chOk = testVersion ? ch.r.status === 503 && cj.kind === "window_unanswered" && ch.by === "shell"
      : ch.r.ok && ch.by === "shell" && Array.isArray(cj.entries) && cj.entries.length > 10 && ch.text.length > 50000
        && cj.entries.every((e) => e && typeof e.version === "string" && Array.isArray(e.notes));
    okw("大きな答え（更新履歴）が欠けずに届く", chOk, `[形] ${ch.r.status} ${ch.by} ${ch.text.length} 字・${(cj.entries || []).length} 版${testVersion ? "（試験の版: 窓は答えない）" : ""}`);
    okw("版と更新履歴は窓が答え、版の字がそろう", b.by === "shell" && bj.version === info.program_version
        && (testVersion ? cj.kind === "window_unanswered" : cj.version === info.program_version && ((cj.entries || [])[0] || {}).version === cj.version),
        `[道どうし] build ${bj.version}・更新履歴 ${cj.version || cj.kind}・先頭 ${((cj.entries || [])[0] || {}).version || ""}・窓の情報 ${info.program_version}`);
    // 道に当たらない問い合わせ（版 3.118.0 から窓の言葉で断る。404 にするかは段 ⑤ で決める）
    const nf = await get("/api/no-such-route");
    const nj = parse(nf.text) || {};
    okw("道に当たらない問い合わせは窓の言葉で断る（503・道の型）", nf.r.status === 503 && nf.by === "shell" && nj.kind === "window_unanswered"
        && nj.route === "GET /api/no-such-route" && /窓が答えられません/.test(nj.error || ""), `[形] ${nf.r.status} ${nf.by} ${nj.kind} ${nj.route}`);
    // 誤りの答え: 窓の別の道（計算）に形の違う本文
    const ce = await get("/api/calculate", json("POST", {}));
    const cej = parse(ce.text) || {};
    okw("誤りの答え（計算に形の違う本文は 400 と日本語の理由）", ce.r.status === 400 && ce.by === "shell" && cej.error === "計算するロット（lot）がありません。",
        `[決めた答え] ${ce.r.status} ${ce.by} ${cej.error}`);
    const wbad = await get("/api/ui-state", json("POST", { changed: "形が違う" }));
    okw("窓が答える誤り（画面の設定の控え）", wbad.r.status === 400 && wbad.by === "shell" && /形が違います/.test((parse(wbad.text) || {}).error || ""), wbad.text.slice(0, 80));
    // 4) 大きな日本語の本文（約 460KB）が往復する——窓の画面の設定の控えへ重ねて読み戻す
    const big = "汚れ位置・発見設備と転写".repeat(13000), key = "tpa.selftestBig";
    const put = await get("/api/ui-state", json("POST", { changed: { [key]: big } }));
    const back = parse((await get("/api/ui-state")).text) || {};
    okw("約 460KB の日本語の本文が往復する（窓の画面の設定の控え）", put.r.ok && put.by === "shell" && (back.keys || {})[key] === big,
        `[場面] ${put.r.status} ${put.by} / ${((back.keys || {})[key] || "").length} 字`);
    // 自己診断の心拍には印（X-TPA-Selftest）を付ける: 窓は入れ替えた直後の確かめ（画面の JS が起きた合図）に数えない（版 3.111.0 の作った後の採点の割れ 5）
    const hb = await get("/api/heartbeat", { ...json("POST", { visible: true }), headers: { "Content-Type": "application/json", "X-TPA-Selftest": "1" } });
    const hbj = parse(hb.text) || {};
    okw("心拍は窓が答える（中身の様子を添える。版 3.111.0 から中身が止まっていても 200）",
        hb.r.ok && hb.by === "shell" && "revoked" in hbj && hbj.python && hbj.python.state === python, `${hb.r.status} ${hb.by} python=${JSON.stringify(hbj.python)}`);
    // 書いた控えを、心拍の後にもう 1 度読む（窓が同じファイルを読み直す。前は Python が書いた控えを窓が読むかを見た）
    const again = parse((await get("/api/ui-state")).text) || {};
    const ad = firstDiff(again.keys, back.keys);
    okw("書いた控えを、心拍の後にも窓が同じファイルから読む", (again.keys || {})[key] === big && !ad,
        `[道どうし] ${((again.keys || {})[key] || "").length} 字${ad ? "・最初の違い " + ad : ""}`);
    await get("/api/ui-state", json("POST", { changed: {}, removed: [key] }));

    // 計算のタブの転写距離・ピッチ計算は窓が答える（版 3.72.0。src/calc.rs）。決めた入力に決めた答え（同梱のマスタの初期値で、
    // 版 3.118.0 の Python の道の答えを 1 度だけ控えた。値の全部は cargo の calc_parity・calc_cases が持つ）
    const calcBody = { lot: { density: 2.73, processes: [
      { no: 1, equipment: "L-1", thickness: 1.3, width: 1200, weight: 6214, unwind: "上", design_split: 1, vertical_split: 1 },
      { no: 2, equipment: "TLV", thickness: 0.505, width: 1179.8, weight: 5511.5, unwind: "上", design_split: 1, vertical_split: 1, off_front_thickness_mm: 1.37 }] },
      inputs: { found_equipment: "2:TLV", found_pitch_mm: 610, soil_a_m: 1610.7, soil_b_m: 1613.7, tolerance_percent: 2 } };
    const cw = await get("/api/calculate", json("POST", calcBody));
    const cv = parse(cw.text) || {}, o1 = (cv.origins || {})["1"] || {};
    const near = (x, y) => typeof x === "number" && Math.abs(x - y) < 1e-6;
    okw("計算は窓が答え、決めた入力に決めた答え", cw.r.ok && cw.by === "shell" && cv.actual_transfer_distance_m === 3 && cv.likely_origin_no === 1
        && near(o1.predicted_m, 10.506460998002414) && near(o1.agreement_percent, 28.553858435969904) && o1.match === false && (cv.processes || []).length === 2,
        `[決めた答え] ${cw.r.status} ${cw.by} 実 ${cv.actual_transfer_distance_m}・元 ${cv.likely_origin_no}・予測 ${o1.predicted_m}・合致 ${o1.agreement_percent}`);

    // 5) 日本語の問い合わせ文字（窓が JSON で答える）
    const q = await get("/api/lotlist?search=" + encodeURIComponent("日本語・ロット") + "&page=1");
    const qj = parse(q.text);
    okw("日本語の問い合わせ文字（窓が JSON で答える）", q.by === "shell" && q.r.ok && qj && Array.isArray(qj.columns) && typeof qj.count === "number"
        && (qj.rows || []).every((r) => JSON.stringify(r).includes("日本語・ロット")), `[形] ${q.r.status} ${q.by} ${qj ? (qj.count ?? qj.error) : q.text.slice(0, 80)}`);

    // 6) 同時の問い合わせが混ざらない（窓の道 3 種を 40 本。1 本ずつ引いた答えと同じ）
    const paths = Array.from({ length: 40 }, (_, i) => ["/api/build", `/api/lotlist?page=${i}&page_size=7`, `/static/js/shared.js?v=p${i}`][i % 3]);
    const canon = (t) => { const v = parse(t); return v ? dropKeys(["timing", "source"])(v) : t; };
    const all = await Promise.all(paths.map((p) => get(p)));
    const solo = [];
    for (const p of paths) solo.push(await get(p));
    const why = (i) => all[i].by !== "shell" ? `by ${all[i].by}` : all[i].r.status !== solo[i].r.status ? `状態 ${all[i].r.status}/${solo[i].r.status}`
      : firstDiff(canon(all[i].text), canon(solo[i].text));
    const off = paths.map((p, i) => [p, why(i)]).filter(([, w]) => w);
    okw("40 本同時でも、それぞれの答えが届く（1 本ずつ引いた答えと同じ）", !off.length, `[道どうし] 違う ${off.length}/40 ${off.slice(0, 3).map(([p, w]) => `${p}（${w}）`).join(" ")}`);
  });

  await part("保存領域", async () => {
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
  });

  await part("窓の情報", async () => {
    // 9) 窓の情報（目印・作業場所・版）。枠の約束の版（protocol）と受け持ち（serves）は段 ⑤ で消える中身の係の定数なので見ない
    okw("窓の情報: 目印・作業場所・窓と中身の版", /transferpitchanalyzer/.test(info.app_id || "") && !!info.local_root
        && /^\d+\.\d+\.\d+$/.test(info.shell_version || "") && /^\d+\.\d+\.\d+$/.test(info.program_version || ""),
        `[形] ${info.app_id} root=${info.local_root} 窓 ${info.shell_version}・中身 ${info.program_version}`);
    // 試験の版は program の版だけを書き換えた物（verify.py はこの項目を数えない: selftest_names.json の except）
    okw("窓の版と中身の版が同じ", info.shell_version === info.program_version, `[場面] ${info.shell_version} / ${info.program_version}`);
  });

  await part("品質異常", async () => {
    // 10) 品質異常（Rust が写しから引く・lot.rs）
    const ll = await get("/api/lotlist?page=1");
    llj = parse(ll.text) || {};
    // 版 3.118.1 の作った後の採点の割れ 2: 窓が受けただけ（by）でなく答えた（200）こと。503（設定を組めない・window_unanswered）は落とす
    okw("一覧は Rust が答える", ll.by === "shell" && ll.r.status === 200, `[形] ${ll.by} ${ll.r.status} ${ll.r.ok ? "" : ll.text.slice(0, 80)}`);
    llSrc = await get("/api/lotlist/source");
    okw("データの時刻は Rust が答える（共有を見に行かない）", llSrc.by === "shell" && llSrc.r.ok, llSrc.text.slice(0, 120));
    llCount = ll.r.ok ? llj.count || 0 : 0;
    if (llCount > 0) {
      const lp = async (q) => { const x = await get("/api/lotlist?" + q); return { x, j: parse(x.text) || {} }; };
      const pivotTotal = async (q) => total(parse((await get(`/api/lotlist/pivot?${q}${q ? "&" : ""}measures=${J([{ agg: "count" }, { agg: "lots" }])}`)).text));
      const [allCount, allLots] = await pivotTotal("");
      lots = allLots;
      const bad = [];
      const want = (cond, what) => { if (!cond) bad.push(what); };
      // ① 1 ページ目: 件数が集計表の総計と同じ・行の数はページの大きさまで
      const a = llj;
      want(a.count === allCount && (a.rows || []).length === Math.min(a.count, pageSize(a)) && a.page === 1 && (a.columns || []).length > 0,
           `①${a.count}/${allCount}・${(a.rows || []).length}行`);
      // ② 日本語の検索: どの行も検索の字を含む
      const s = await lp("search=" + encodeURIComponent("汚れ"));
      want(s.x.by === "shell" && s.j.count > 0 && s.j.count <= a.count && (s.j.rows || []).every((r) => JSON.stringify(r).includes("汚れ")), `②${s.j.count}`);
      // ③ ページ: 3 ページ目の 50 行（101 行目から）
      const p3 = await lp("page=3&page_size=50");
      const n3 = Math.max(0, Math.min(50, p3.j.count - 100));
      want(p3.j.page === 3 && p3.j.page_size === 50 && (p3.j.rows || []).length === n3 && (!n3 || (p3.j.range || [])[0] === 101), `③${(p3.j.rows || []).length}/${n3}`);
      // ④ 絞り込み（日付の範囲は lotlist_fixture.py の TODAY 2026-10-02 から 90 日。今日に頼らない）: 件数が同じ絞り込みの集計表と同じ・設備の頭
      const f4 = J([{ column: "発生日", op: "date_range", value: "2026-07-04..2026-10-02" }, { column: "設備", op: "starts_any", value: "L-,ＣＲ" }]);
      const r4 = await lp("filters=" + f4);
      const [c4] = await pivotTotal("filters=" + f4);
      want(r4.j.count > 0 && r4.j.count < a.count && r4.j.count === c4 && r4.j.filters_applied === 2
           && (r4.j.rows || []).every((r) => /^(L-|CR|ＣＲ)/i.test(String(r["設備"] || ""))), `④${r4.j.count}/${c4}・効いた ${r4.j.filters_applied}`);
      // ⑤ まとめ: まとめの数はロット数（集計表のロット数と同じ）・行の数以下
      const g = await lp("group=1&sorts=" + J([{ column: "重量", dir: "desc" }]));
      want(g.j.groupCount === allLots && g.j.groupCount <= g.j.count && Array.isArray(g.j.groups), `⑤まとめ ${g.j.groupCount}/ロット ${allLots}`);
      // ⑥ 0 件: 手がかり（dateHints）がある
      const z = await lp("filters=" + J([{ column: "発生日", op: "within_days", value: "0" }, { column: "設備", op: "eq", value: "無い" }]));
      want(z.j.count === 0 && (z.j.rows || []).length === 0 && (z.j.dateHints || []).length > 0, `⑥${z.j.count}・手がかり ${(z.j.dateHints || []).length}`);
      // ⑦ 計算列（版 3.59.0 から Rust も式を持つ: formula.rs）: 計算列で並べ替える。一覧の行は計算列の値を持たない（並べ替えの鍵だけ）ので、
      //    鍵 ＝ 重量 ＋ 板幅×1000 の大きい順に並んだかを、数の行の重量と板幅から確かめる（演算子を取り違えると順が崩れる）
      const calc7 = J({ formulas: { 鍵: "[重量] + [板幅] * 1000", 課: "conv('課名', [設備])" }, names: {} });
      const c = await lp("calc=" + calc7 + "&sorts=" + J([{ column: "課", dir: "asc" }, { column: "鍵", dir: "desc" }]));
      const d = await lp("calc=" + calc7 + "&sorts=" + J([{ column: "鍵", dir: "desc" }]));
      const w = (d.j.rows || []).filter((r) => typeof r["重量"] === "number" && typeof r["板幅"] === "number").map((r) => r["重量"] + r["板幅"] * 1000);
      const desc = w.every((x, i) => !i || w[i - 1] >= x - 1e-9);
      want(c.x.by === "shell" && d.x.by === "shell" && c.j.count === a.count && d.j.count === a.count && w.length > 10 && desc, `⑦順 ${desc}（数の行 ${w.length}）`);
      // ⑧ まとめた一覧の計算列: 番 ＝ ロット番号の最初の数字の並び（extract）の大きい順に、まとめが並ぶ
      const e = await lp("group=1&calc=" + J({ formulas: { 番: "extract([ロット番号], '[0-9]+')" }, names: {} }) + "&sorts=" + J([{ column: "番", dir: "desc" }]));
      const keys = (e.j.rows || []).map((r) => (String(r["ロット番号"] ?? "").match(/[0-9]+/) || [""])[0]).filter((x) => x).map(Number);
      const down = keys.every((x, i) => !i || keys[i - 1] >= x);
      want(e.x.by === "shell" && e.j.groupCount === allLots && keys.length > 10 && down && keys[0] > keys[keys.length - 1], `⑧順 ${down}（${keys.length} 行）`);
      okw("一覧: 窓の答えの形と道どうしの数が合う（8 通り・日本語の検索・絞り込み・ページ・まとめ・0 件の手がかり・計算列で並べ替え）", !bad.length,
          `[形・道どうし・場面] ${bad.length ? "違う " + bad.join(" ") : `${llCount} 行・ロット ${allLots}・④ ${r4.j.count}`}`);
      const rsSrc = parse(llSrc.text) || {};
      okw("写しは 1 つ: 一覧の元は写した台帳（写した時刻と元の時刻）", rsSrc.mirrored === true && typeof rsSrc.at === "number" && typeof rsSrc.copiedAt === "number"
          && !firstDiff((llj.source || {}).at, rsSrc.at), `[道どうし] 元の時刻 ${rsSrc.at}・一覧 ${(llj.source || {}).at}・写した ${rsSrc.copiedAt}`);
    } else {
      // 元ファイルが無い（一覧は 200 で 0 行）ときだけ比べない。一覧が答えない（503 など）ときは落とす（版 3.118.1 の作った後の採点の割れ 2: 前は
      // いつも真で、一覧の数の確かめが黙って消えた）
      okw("一覧の突き合わせ: 元ファイルが無いので比べない（CI は試験用の品質データで見る）", ll.by === "shell" && ll.r.status === 200 && llCount === 0,
          `[形] ${ll.r.status} ${ll.text.slice(0, 120)}`);
    }
  });

  await part("データ元", async () => {
    // 10a') データ元の並び（版 3.87.0 から窓が答える: sources_list.rs）。見出しのタブ（画面が答えから作った）と同じ並び
    const rs = await get("/api/sources");
    const v = parse(rs.text) || {};
    const items = v.items || [];
    const hid = (state.me || {}).hiddenTabs || [];
    const want = items.filter((d) => d.listed && String(d.api || "").startsWith("/api/src/") && !d.group && !hid.includes(d.key)).map((d) => d.screen).sort();
    const tabs = [...document.querySelectorAll('.screen-tabs [data-screen^="src:"]')].map((b) => b.dataset.screen).sort();
    okw("データ元の並びは窓が答え、見出しのタブと同じ並び", rs.by === "shell" && rs.r.status === 200 && items.length > 0 && items.every((d) => typeof d.key === "string" && typeof d.name === "string")
        && !firstDiff(want, tabs), `[形・道どうし] ${rs.r.status} ${rs.by} ${items.length} 件・タブ ${tabs.join(",")} / 答え ${want.join(",")}${firstDiff(want, tabs) ? "・最初の違い " + firstDiff(want, tabs) : ""}`);
  });

  await part("参照先", async () => {
    // 10a'') 参照先の項目（版 3.89.0 から窓が答える: settings_write.rs）: 品質の場所は一覧が使っている元と同じ。
    // マスタの置き場（版 3.118.1 の作った後の採点の割れ 1）: /api/settings に master_share.dir の項目は無い（前の版の path_settings の決め）ので、
    // 置き場の状態（/api/masters/status）・置き場の画面（/api/masters/place）・更新の置き場（/api/update/settings の masters.dir）・
    // 配った設定の置き場（place.configured。この PC の覚え〈override〉が無いとき）の 4 つが同じ置き場を言うかを見る（場面は共有を置いている）
    const rs = await get("/api/settings");
    const v = parse(rs.text) || {};
    const item = (k) => (v.items || []).find((x) => x.key === k) || {};
    const place = parse((await get("/api/masters/place")).text) || {};
    const status = parse((await get("/api/masters/status")).text) || {};
    const upd = parse((await get("/api/update/settings")).text) || {};
    const remote = (parse(llSrc ? llSrc.text : "") || {}).remote;
    // 道の字の比べ方: 区切りの「\」と「/」・末尾の区切りは同じ。Windows は大文字と小文字も同じ
    const norm = (d) => { const t = String(d ?? "").replace(/\\/g, "/").replace(/\/+$/, ""); return /^win/i.test(navigator.platform || "") ? t.toLowerCase() : t; };
    const dirs = { 状態: status.dir, 更新の置き場: (upd.masters || {}).dir, 配った設定: place.override ? place.dir : place.configured };
    const msDiff = firstDiff(Object.fromEntries(Object.entries(dirs).map(([k, d]) => [k, norm(d)])), Object.fromEntries(Object.keys(dirs).map((k) => [k, norm(place.dir)])));
    const msOk = place.mode === "shared" && typeof place.dir === "string" && place.dir !== "" && !msDiff;
    const good = rs.by === "shell" && rs.r.status === 200 && (v.items || []).length > 5 && typeof v.config_file === "string"
      && (!llCount || item("lot_list.source").effective === remote) && msOk;
    okw("参照先の項目は窓が答え、品質の場所とマスタの置き場が使っている物と同じ", good,
        `[道どうし・場面] ${rs.r.status} ${rs.by} ${(v.items || []).length} 項目・品質 ${item("lot_list.source").effective === remote}・置き場 ${place.mode} ${msOk ? "4 つ同じ" : "違う " + (msDiff || "置き場が無い")} ${place.dir}`);
    const put = (key, value) => get("/api/settings/" + key, json("PUT", { value }));
    const unk = await put("selftest.unknown", "x"), bad = await put("lot_list.refresh_seconds", "10.5");
    const why = (x) => parse(x.text) || {};
    // 書けない人の PC（管理のマスタを書けない段）では、窓の門番が先に断る（403 forbidden。これも窓が受けた形）
    const denied = [unk, bad].every((x) => x.by === "shell" && x.r.status === 403 && why(x).kind === "forbidden");
    okw("参照先を書く道も窓が受ける（知らない項目・整数でない値を窓の言葉で断る。書けない人は門番が断る）", denied || (
       unk.by === "shell" && unk.r.status === 400 && why(unk).error === "知らない項目です。"
       && bad.by === "shell" && bad.r.status === 400 && why(bad).kind === "invalid" && /整数で入れてください/.test(why(bad).error || "")),
       `[決めた答え] ${denied ? "門番 403" : "窓の言葉 400"}・${unk.by} ${unk.r.status} / ${bad.by} ${bad.r.status} ${(why(bad).error || "").slice(0, 40)}`);
  });

  await part("データ元を書く", async () => {
    // 10a‴) データ元の書く道（版 3.90.0 から窓が答える: sources_write.rs）。書かずに確かめる
    const why = (x) => parse(x.text) || {};
    const gone = await get("/api/sources/selftest-none", json("PUT", { "表示名": "x" }));
    const conn = await get("/api/sources/selftest-none/conn", json("PUT", { field: "place", value: "x" }));
    const denied = [gone, conn].every((x) => x.by === "shell" && x.r.status === 403 && why(x).kind === "forbidden");
    okw("データ元を書く道も窓が受ける（無いデータ元を窓の言葉で断る。書けない人は門番が断る）", denied || (
       gone.by === "shell" && gone.r.status === 400 && /そのデータ元はありません/.test(why(gone).error || "")
       && conn.by === "shell" && conn.r.status === 404 && why(conn).kind === "unknown"),
       `[決めた答え] ${denied ? "門番 403" : "窓の言葉 400・404"}・${gone.by} ${gone.r.status} / ${conn.by} ${conn.r.status} ${(why(gone).error || "").slice(0, 30)}`);
  });

  await part("作業実績の登録", async () => {
    // 10b) 作業実績の設備（版 3.91.0 から窓が答える: worklog_write.rs）: フォルダに届かない（CI）ときも、理由つきで空の設備を返す
    const wl = await get("/api/worklog/files");
    wlj = parse(wl.text) || {};
    // 版 3.118.1 の作った後の採点の割れ 4: 窓が答えた（by）ことも見る
    okw("作業実績の設備の問い合わせが答える（届かなければ理由つき）", wl.by === "shell" && wl.r.ok && Array.isArray(wlj.items) && (wlj.items.length > 0 || !!wlj.error || Array.isArray(wlj.new)),
       `[形] ${wl.r.status} ${wl.by} 設備 ${(wlj.items || []).length} 台・未登録 ${(wlj.new || []).length}・${wlj.error || "フォルダに届いた"}`);
    one = (wlj.items || []).find((x) => x.visible && x.state !== "missing") || null;
    eq = encodeURIComponent(one ? one.key : "無い設備");
    // 登録の一覧（マスタ）と設備の問い合わせ（フォルダ）: 同じフォルダ・同じ決まり・同じ設備
    const fa = await get("/api/worklog/files?all=1"), ma = await get("/api/masters/worklog");
    const f = parse(fa.text) || {}, m = parse(ma.text) || {};
    const side = (x) => ({ folder: x.folder, pattern: x.pattern, error: x.error || "", keys: (x.items || []).map((i) => i.key).sort() });
    const wd = firstDiff(side(f), side(m));
    okw("作業実績の登録の一覧は窓が答え、設備の問い合わせと同じフォルダ・同じ設備", fa.by === "shell" && ma.by === "shell" && fa.r.ok && ma.r.ok
        && !wd && typeof m.revision === "number",
        `[道どうし] 設備 ${(f.items || []).length}/${(m.items || []).length}・${wd ? "最初の違い " + wd : "同じフォルダ・同じ設備"}・${(m.error || "届いた").slice(0, 40)}`);
    // 書く道は書かずに確かめる（無い行を直す・空の並びは窓の言葉で断る。書けない人の PC では窓の門番が先に断る）
    const why = (x) => parse(x.text) || {};
    const gone = await get("/api/masters/worklog/987654321", json("PUT", { "設備名": "x" }));
    const order = await get("/api/masters/worklog/order", json("PUT", { keys: [] }));
    const denied = [gone, order].every((x) => x.by === "shell" && x.r.status === 403 && why(x).kind === "forbidden");
    okw("作業実績の登録を書く道も窓が受ける（無い行・空の並びを窓の言葉で断る。書けない人は門番が断る）", denied || (
       gone.by === "shell" && gone.r.status === 404 && why(gone).error === "id=987654321 が見つかりません。"
       && order.by === "shell" && order.r.status === 400 && why(order).error === "並べるキー（keys）がありません。"),
       `[決めた答え] ${denied ? "門番 403" : "窓の言葉 404・400"}・${gone.by} ${gone.r.status} / ${order.by} ${order.r.status} ${(why(gone).error || "").slice(0, 30)}`);
  });

  await part("変換表", async () => {
    // 10b') 変換表（版 3.93.0 から窓が答える: conversions_write.rs）: 一覧の標準の表は書き出し（標準）にもある
    const li = await get("/api/masters/conversions"), ex = await get("/api/masters/conversions/export?which=defaults");
    const l = parse(li.text) || {}, x = parse(ex.text) || {};
    const names = new Set((x.items || []).map((i) => i.name));
    const preset = (l.items || []).filter((i) => i.preset);
    okw("変換表の一覧と書き出しは窓が答え、標準の表の名前がそろう", li.by === "shell" && ex.by === "shell" && li.r.ok && ex.r.ok && preset.length > 0
        && preset.every((i) => names.has(i.name)) && (l.items || []).every((i) => typeof i.id === "number" && Array.isArray(i.rows)),
        `[道どうし] 一覧 ${(l.items || []).length}（標準 ${preset.length}）・書き出し ${names.size}`);
    const why = (y) => parse(y.text) || {};
    const gone = await get("/api/masters/conversions/987654321", json("PUT", {}));
    const back = await get("/api/masters/conversions/987654321/preset", json("POST", {}));
    const denied = [gone, back].every((y) => y.by === "shell" && y.r.status === 403 && why(y).kind === "forbidden");
    okw("変換表を書く道も窓が受ける（無い表を直す・標準に戻すを窓の言葉で断る。書けない人は門番が断る）", denied || (
       gone.by === "shell" && gone.r.status === 404 && why(gone).error === "id=987654321 が見つかりません。"
       && back.by === "shell" && back.r.status === 404 && why(back).kind === "not_found"),
       `[決めた答え] ${denied ? "門番 403" : "窓の言葉 404"}・${gone.by} ${gone.r.status} / ${back.by} ${back.r.status} ${(why(gone).error || "").slice(0, 30)}`);
  });

  await part("設備グループ", async () => {
    // 10b'') 設備グループ（版 3.94.0 から窓が答える: equipgroups_write.rs）: 選べる設備に品質の設備の値が全部あり、その件数は集計表の設備ごとの件数と同じ
    const a = "/api/masters/equipgroups";
    const rs = await get(a);
    const v = parse(rs.text) || {};
    const bad = [];
    if (llCount > 0) {
      const p = parse((await get(`/api/lotlist/pivot?rows=${J([{ column: "設備" }])}&measures=${J([{ agg: "count" }])}`)).text) || {};
      const labels = (p.labels || [])[0] || {};
      for (const c of (p.cells || []).filter((x) => (x.r || []).length === 1)) {
        const name = labels[c.r[0]];
        const s = (v.seen || []).find((x) => x.name === name);
        if (!(v.equipments || []).includes(name)) bad.push(`${name} が選べない`);
        else if (s && (s.from || []).includes("品質") && (s.from || []).every((x) => ["設備マスタ", "品質"].includes(x)) && s.n !== c.v[0]) bad.push(`${name} ${s.n}/${c.v[0]}`);
      }
    }
    okw("設備グループの一覧は窓が答え、選べる設備と件数が一覧の設備の値と同じ", rs.by === "shell" && rs.r.ok && Array.isArray(v.items) && Array.isArray(v.equipments) && !bad.length,
        `[道どうし] ${rs.r.status} ${rs.by} 設備 ${(v.equipments || []).length}・グループ ${(v.items || []).length}${bad.length ? "・違う " + bad.slice(0, 4).join(" ") : ""}`);
    const why = (x) => parse(x.text) || {};
    const gone = await get(a + "/987654321", json("PUT", { note: "x" }));
    okw("設備グループを書く道も窓が受ける（無いグループを直すを窓の言葉で断る。書けない人は門番が断る）",
       gone.by === "shell" && (gone.r.status === 403 && why(gone).kind === "forbidden"
         || gone.r.status === 404 && why(gone).error === "id=987654321 が見つかりません。"),
       `[決めた答え] ${gone.r.status === 403 ? "門番 403" : "窓の言葉 404"}・${gone.by} ${gone.r.status} ${(why(gone).error || "").slice(0, 30)}`);
  });

  await part("更新の置き場", async () => {
    // 10b''') 更新の置き場と、だれが（版 3.95.0 から窓が答える: release_place.rs）: 名乗りは配布の画面の係（/__desktop/release）と同じ・
    //         マスタの置き場は置き場の答えと同じ。配布の置き場を写す進み具合も窓が答える
    const rs = await get("/api/update/settings"), rel = await get("/__desktop/release?cached=1");
    const u = parse(rs.text) || {}, r = parse(rel.text) || {};
    const place = parse((await get("/api/masters/place")).text) || {};
    const who = (x) => Object.fromEntries(["canRelease", "login", "pc", "role"].map((k) => [k, (x || {})[k]]));
    const wd = firstDiff(who(u.who), who(r.me));
    const pg = await get("/api/release/place/progress");
    const st = (parse(pg.text) || {}).state || "";
    okw("更新の置き場と、だれが（版を置ける・配る版を決められる）は窓が答え、配布の画面の係と同じ名乗り。配布の置き場を写す進み具合も窓",
        rs.by === "shell" && rs.r.status === 200 && typeof u.source === "string" && !wd && (u.masters || {}).dir === place.dir
          && pg.by === "shell" && pg.r.status === 200 && st === "idle",
        `[道どうし] ${rs.r.status} ${rs.by} 名乗り ${wd ? "最初の違い " + wd : "同じ " + JSON.stringify(who(u.who))}・置き場 ${(u.masters || {}).dir === place.dir}・進み具合 ${pg.by} ${st}`);
  });

  await part("スケジュール", async () => {
    // 10b'''') スケジュール（版 3.96.0 から窓がただ 1 つの係: schedule.rs）: 設備のタブの数はデータ元の一覧の行の設備の数と同じ・
    //          最初の設備の一覧は答えか、届かない予定の元なら利用者の言葉（Python・urllib の名前が無い。言葉の種類は cm3_net_cases.json）
    const s = await get("/api/schedule"), card = await get("/api/schedule/card");
    const sv = parse(s.text) || {}, cv = parse(card.text) || {};
    const first = ((sv.equipments || [])[0] || {}).key || "";
    const rows = [`設備 ${(sv.equipments || []).length}/${cv.equipCount}`];
    let good = s.by === "shell" && card.by === "shell" && s.r.ok && card.r.ok && Array.isArray(sv.equipments) && sv.equipments.length === cv.equipCount;
    if (first) {
      const t = Date.now();
      const l = await get(`/api/src/sch?equip=${encodeURIComponent(first)}`);
      const lv = parse(l.text) || {};
      const fine = l.by === "shell" && (l.r.ok ? Array.isArray(lv.rows) : typeof lv.error === "string" && !/urllib|Traceback|Python|OSError/.test(lv.error));
      good = good && fine;
      rows.push(`一覧 ${l.r.status} ${l.by} ${Date.now() - t}ms ${l.r.ok ? (lv.rows || []).length + " 行" : (lv.error || "").slice(0, 60)}`);
    }
    okw("スケジュールの設備のタブ・行の様子・一覧は窓が答え、設備の数がそろい、届かない言葉は利用者の言葉", good, `[道どうし・形] ${rows.join("・")}`);
  });

  await part("LotDsp", async () => {
    // 10b-L) LotDsp（版 3.98.0 から窓がただ 1 つの係: lotdsp.rs・lotdsp_direct.rs。道は 9 本）のうち、書かずに確かめられる 6 本の道と調べる道具の画面:
    //          途中経過・学びの状態・画面の表の読み方（実績の表が無い画面は窓の LookupError の字）・形の違うロット番号・中止・調べる道具の画面（CSP の印つき）
    const rows = [];
    const want = [
      ["GET", "/api/lots/fetch-lotdsp/status", null, 200, (v) => v.busy === false],
      ["GET", "/api/lots/lotdsp-api/status", null, 200, (v) => typeof v.ready === "boolean" && Array.isArray(v.missing)],
      ["POST", "/api/lots/import-lotdsp", { html: "<table><tr><td>a</td></tr></table>", lot_no: "L1" }, 400, (v) => v.type === "LookupError"],
      ["POST", "/api/lots/import-lotdsp", { html: 5 }, 400, (v) => v.kind === "invalid"],
      ["POST", "/api/lots/fetch-lotdsp", { lot_no: "L71;50" }, 400, (v) => v.kind === "invalid"],
      ["POST", "/api/lots/fetch-lotdsp/cancel", {}, 200, (v) => v.cancelled === false],
    ];
    let allOk = true;
    for (const [m, p, body, st, check] of want) {
      const g = await get(p, m === "GET" ? undefined : json(m, body));
      const v = parse(g.text);
      const good = g.by === "shell" && g.r.status === st && v && check(v);
      allOk = allOk && good;
      rows.push(`${m} ${p} ${g.r.status} ${g.by}${good ? "" : "・" + g.text.slice(0, 60)}`);
    }
    const page = await get("/lotdsp-link");
    const pageOk = page.by === "shell" && page.r.status === 200 && /nonce-/.test(page.r.headers.get("Content-Security-Policy") || "")
      && page.text.includes("LotDsp 項目の紐づけ");
    rows.push(`/lotdsp-link ${page.r.status} ${page.by}`);
    okw("LotDsp の 6 本の道と調べる道具の画面は窓が答える（途中経過・学びの状態・画面の表・ロット番号の形・中止・調べる道具の画面）", allOk && pageOk, `[決めた答え] ${rows.join("・")}`);
  });

  await part("組む所", async () => {
    // 10b-B) 組む所の読み（版 3.99.0 から窓が答える: builder.rs。道は 7 本で、ここで見るのは 6 本）: 札の列は一覧の列を全部含む・当てる列の元に品質がある・列の行の数は
    //          一覧の件数と同じ・確かめるは決めた言葉で断る（空の場所・間隔 5 秒）・試すは門番を通る（書けない人は 403）
    const cols = llj.columns || [];
    const rows = [];
    const has = (list) => cols.every((c) => list.includes(c));
    const f = await get("/api/dashboard/fields?source=lot"), fv = parse(f.text) || {};
    const fOk = f.by === "shell" && (llCount ? f.r.ok && has((fv.fields || []).map((x) => x.column)) : !!fv.error || Array.isArray(fv.fields));
    rows.push(`札 ${f.r.status} ${(fv.fields || []).length}${fOk ? "" : "・違う"}`);
    const d = await get("/api/data/columns"), dv = parse(d.text) || {};
    const lotSrc = (dv.sources || []).find((x) => (x.columns || []).some((c) => c.column === "ロット番号")) || {};
    const dOk = d.by === "shell" && d.r.ok && Array.isArray(dv.sources) && (!llCount || has((lotSrc.columns || []).map((c) => c.column)));
    rows.push(`当てる列 ${d.r.status} 元 ${(dv.sources || []).length}${dOk ? "" : "・違う"}`);
    const s = await get("/api/sources/lot/columns"), sv = parse(s.text) || {};
    const sOk = s.by === "shell" && (llCount ? s.r.ok && sv.rows === llCount && has(Object.keys(sv.samples || {})) : true);
    rows.push(`結合の欄 ${s.r.status} ${sv.rows}/${llCount}${sOk ? "" : "・違う"}`);
    const ck = await get("/api/sources/check", json("POST", { place: "", role: "品質" })), ckv = parse(ck.text) || {};
    const ckOk = ck.by === "shell" && ck.r.ok && ckv.ok === false && ckv.message === "ファイルの場所を入れてください。";
    rows.push(`確かめる ${ck.r.status}${ckOk ? "" : "・" + ck.text.slice(0, 40)}`);
    const cc = await get("/api/sources/lot/conn/check", json("POST", { field: "refresh", value: "5" })), ccv = parse(cc.text) || {};
    const ccOk = cc.by === "shell" && cc.r.ok && ccv.ok === false && /10〜3600/.test(ccv.message || "");
    rows.push(`接続の確かめ ${cc.r.status}${ccOk ? "" : "・" + cc.text.slice(0, 40)}`);
    const jp = await get("/api/sources/join/preview", json("POST", { key: "lot", joins: [] })), jv = parse(jp.text) || {};
    // 「試す」は答えのファイルを作るので門番を通る（書けない人〈CI の一般ユーザー〉は 403）
    const jOk = jp.by === "shell" && ((jp.r.status === 403 && jv.kind === "forbidden") || (jp.r.ok && typeof jv === "object"));
    rows.push(`試す ${jp.r.status === 403 ? "門番 403" : jp.r.status}${jOk ? "" : "・" + jp.text.slice(0, 40)}`);
    rows.sort((x, y) => y.includes("違う") - x.includes("違う"));
    okw("組む所の読み 6 本は窓が答え、札の列と行の数が一覧と同じ（札・当てる列・結合の欄の列・確かめる・接続の確かめ・試す）", fOk && dOk && sOk && ckOk && ccOk && jOk,
        `[道どうし・決めた答え] ${rows.join("・")}`);
  });

  await part("生きているか", async () => {
    // 10b-H) 生きているか（版 3.102.0）: GET /api/health は窓が答え、中身の様子を python に添える（版 3.118.0 から absent）
    const rs = await get("/api/health");
    const rv = parse(rs.text) || {};
    okw("生きているかは窓が答える（中身は起こさない absent）", rs.by === "shell" && rs.r.status === 200 && rv.status === "ok" && rv.by === "window" && rv.python === "absent",
        `[決めた答え] ${rs.r.status} ${rs.by} ${rs.text.slice(0, 80)}`);
  });

  await part("置き場と設定", async () => {
    // 10b-P) 置き場と設定の 8 本（版 3.101.0 から窓が答える）: 置き場の状態と置き場の画面の置き場の字がそろう・届くかは真偽か確かめ中（null）・
    //          参照… は答える・参照先の確かめるは決めた形・タブの権限の表・引っ越しは窓が門番（403）か確かめ（名前が空は 400）で断る
    const rows = [];
    let allOk = true;
    const ask = async (label, m, p, body, check) => {
      const g = await get(p, m === "GET" ? undefined : json(m, body));
      const v = parse(g.text);
      const good = g.by === "shell" && !!v && check(g, v);
      allOk = allOk && good;
      // 門番の印は「門番 403」の 1 つの形（verify.py の GATE。版 3.118.1 の作った後の採点の割れ 5）
      rows.push(`${label} ${g.r.status === 403 ? "門番 403" : g.r.status}${good ? "" : "・違い " + g.text.slice(0, 50)}`);
      return v || {};
    };
    const reach = (x) => x === true || x === false || x === null;
    const st = await ask("状態", "GET", "/api/masters/status", null, (g, v) => g.r.ok && reach(v.reachable) && typeof v.dir === "string" && typeof v.masters === "object");
    const pl = await ask("置き場", "GET", "/api/masters/place", null, (g, v) => g.r.ok && reach(v.reachable) && v.dir === st.dir && Array.isArray(v.using));
    await ask("確かめる", "POST", "/api/masters/place/check", { parent: "", name: "x" }, (g, v) => (g.r.ok || g.r.status === 400 || g.r.status === 403) && (typeof v.ok === "boolean" || typeof v.error === "string"));
    // 「参照…」は参照先を変えられる人だけ（ほかは門番の 403）
    const gate = (g, v) => g.r.status === 403 && v.kind === "forbidden";
    await ask("参照…", "POST", "/api/fs/browse", { path: "" }, (g, v) => (g.r.ok && typeof v === "object") || gate(g, v));
    await ask("よく使う場所", "GET", "/api/fs/places", null, (g, v) => (g.r.ok && typeof v === "object") || gate(g, v));
    await ask("参照先の確かめる", "POST", "/api/settings/check", { key: "work_log.pattern", value: "実績_*.db" }, (g, v) => g.r.ok && typeof v === "object");
    await ask("タブの権限", "GET", "/api/masters/tabaccess", null, (g, v) => g.r.ok && Array.isArray(v.tabs) && Array.isArray(v.roles) && typeof v.canEdit === "boolean");
    const mv = await get("/api/masters/place/move", json("POST", { parent: "", name: "" }));
    const moveOk = mv.by === "shell" && [400, 403].includes(mv.r.status) && !!parse(mv.text);
    allOk = allOk && moveOk;
    rows.push(`引っ越し ${mv.r.status}${moveOk ? "" : "・違い " + mv.text.slice(0, 50)}`);
    rows.sort((x, y) => y.includes("・違い ") - x.includes("・違い "));
    okw("置き場と設定の 8 本は窓が答え、形と置き場の字がそろう（置き場の状態・確かめる・参照…・参照先の確かめる・タブの権限。引っ越しは窓の係）", allOk,
        `[形・道どうし] ${rows.join("・")}・置き場 ${pl.dir === st.dir ? "同じ" : "違う"}`);
  });

  await part("一覧のほか", async () => {
    // 10c) 作業実績・データ元の一覧（版 3.60.0 から窓が段取り・写し・結合も受け持つ: lists.rs）。答えの形（行と件数・ページ）か、
    //      失敗の形（言葉と種類）。設備・データ元が無い PC（CI）は失敗の形
    const asks = [`/api/worklog?equip=${eq}`, `/api/worklog?equip=${eq}&work=1&fill=1`, `/api/worklog?equip=${eq}&page=2&page_size=20`,
      `/api/worklog?equip=${eq}&work=1&total=` + encodeURIComponent("重量"), "/api/worklog?equip=" + encodeURIComponent("登録の無い設備"),
      "/api/src/wip?page=1", "/api/src/wip?group=1&page_size=30", "/api/src/" + encodeURIComponent("無い元")];
    const copying = (x) => x.r.status === 503 && (parse(x.text) || {}).kind === "copying";
    const differ = [];
    const shape = (x, v, a) => {
      if (x.by !== "shell" || !v) return false;
      if (!x.r.ok) return typeof v.error === "string" && typeof v.kind === "string";
      const size = Number((a.match(/page_size=(\d+)/) || [])[1] || 0);
      return Array.isArray(v.rows) && typeof v.count === "number" && (!size || v.rows.length <= size);
    };
    for (const a of asks) {
      let x = await get(a);
      // 作業実績の写し待ち（503 copying）は写し終えるまで 30 秒まで待つ（届かないデータ元の写し待ちは待たない）
      for (const until = Date.now() + (a.startsWith("/api/worklog") && one ? 30000 : 0); copying(x) && Date.now() < until;) { await sleep(500); x = await get(a); }
      const v = parse(x.text);
      if (!shape(x, v, a)) differ.push(`${a} ${x.r.status} ${x.text.slice(0, 40)}`);
      if (a.includes(encodeURIComponent("登録の無い設備")) && !(x.r.status === 404 && (v || {}).kind === "unknown")) differ.push(`登録の無い設備 ${x.r.status}`);
    }
    okw("作業実績・データ元の一覧は窓が答え、答えの形と失敗の種類（8 通り・作業でまとめる・ページ・失敗の答え）", differ.length === 0,
        `[形] ${differ.length ? differ.join(" | ") : (one ? `設備 ${one.name}` : "設備なし（失敗の形を見た）")}`);

    // 10d) 集計表・グラフ（版 3.61.0 から窓が答える: pivot.rs）: カラムの札は一覧の列を含む・総計は一覧の件数と同じ・無い列は断る
    col = ((((parse((await get("/api/lotlist/pivot?fields=1")).text) || {}).fields || []).find((x) => !x.many)) || {}).column || "";
    const pv = [["/api/lotlist/pivot?fields=1", (x, v) => x.r.ok && (llj.columns || []).every((c) => (v.fields || []).some((f) => f.column === c))],
      [`/api/lotlist/pivot?rows=${J([{ column: col }])}&measures=${J([{ agg: "count" }, { agg: "lots" }])}`, (x, v) => x.r.ok && total(v)[0] === llCount && total(v)[1] === lots],
      [`/api/lotlist/pivot?rows=${J([{ column: "無い列" }])}`, (x, v) => !x.r.ok && typeof v.error === "string"],
      [`/api/worklog/pivot?equip=${eq}&fields=1`, (x, v) => (x.r.ok ? Array.isArray(v.fields) : typeof v.error === "string")],
      [`/api/worklog/pivot?equip=${eq}&rows=${J([{ column: "@workday" }])}&cols=${J([{ column: "@shift" }])}&measures=${J([{ agg: "count" }, { agg: "lots" }])}`,
        (x, v) => (x.r.ok ? typeof total(v)[0] === "number" : typeof v.error === "string")],
      [`/api/src/wip/pivot?measures=${J([{ agg: "count" }, { agg: "lots" }])}`, (x, v) => (x.r.ok ? typeof total(v)[0] === "number" : typeof v.error === "string")]];
    const pdiff = [];
    for (const [a, check] of pv) {
      const x = await get(a), v = parse(x.text) || {};
      // 品質の元が無い PC（1b など）は、品質の集計表は失敗の形
      const lotFail = a.startsWith("/api/lotlist") && !llCount;
      if (!(x.by === "shell" && (lotFail ? !x.r.ok && typeof v.error === "string" : check(x, v)))) pdiff.push(`${a.split("?")[0]} ${x.r.status} ${x.text.slice(0, 40)}`);
    }
    okw("集計表・グラフは窓が答え、総計が一覧の件数と同じ（6 通り・カラムの札・作業日×直・失敗の答え）", pdiff.length === 0,
        `[道どうし] ${pdiff.length ? pdiff.join(" | ") : `列 ${col || "なし"}・総計 ${llCount}・ロット ${lots}`}`);

    // 10e) ダッシュボードのパネル（版 3.62.0 から窓が答える: dashboard.rs。版 3.63.0 から稼働も: operation.rs）: 数字のロット数は集計表の
    //      ロット数と同じ・設備ごとの棒の計は一覧の件数と同じ・答えられないパネルは失敗の形
    const yd = { column: "@workday", kind: "yesterday" };
    const P = (p) => ({ id: "t1", title: "", body: { rows: [], cols: [], measures: [{ agg: "lots" }] }, ...p });
    const panels = [P({ visual: "kpi", source: "lot" }), P({ visual: "bar", source: "lot", body: { rows: [{ column: col || "無い列" }], cols: [], measures: [{ agg: "count" }] } }),
      P({ visual: "kpi", source: "work", period: yd, equips: one ? [one.name] : ["無い設備"] }),
      P({ visual: "time", source: "work", period: { column: "@workday", kind: "days", n: 14 }, body: { rows: [{ column: "@workday" }], cols: [], measures: [{ agg: "lots" }] } }),
      P({ visual: "kpi", source: "src:wip" }), { id: "b1", visual: "board", groups: [] },
      P({ visual: "bar", source: "lot", link: { sides: [{ source: "lot", key: { column: "@equip" } }, { source: "work", key: { column: "@equip" } }] } }),
      P({ visual: "bar", source: "file:x" }), P({ visual: "gantt", source: "work", period: yd }),
      P({ visual: "abc", source: "work", ops: { cls: "合金", qty: "time" } }), P({ visual: "abc", source: "work", ops: { span: "lead" } })];
    const post = (q, p) => get("/api/dashboard/query" + q, json("POST", { panel: p }));
    const ddiff = [], seen = [];
    for (const p of panels) {
      const x = await post("", p), v = parse(x.text) || {};
      let good = x.by === "shell" && (x.r.ok ? typeof v === "object" : typeof v.error === "string");
      if (good && x.r.ok && p.source === "lot" && llCount && !p.link) {
        // 数字のロット数・棒の件数の総計（設備の段の総計の升か、段の升の計）
        if (p.visual === "kpi") good = total(v)[0] === lots;
        else good = total(v)[0] === llCount || (v.cells || []).filter((c) => (c.r || []).length === 1).reduce((s, c) => s + (c.v[0] || 0), 0) === llCount;
      }
      seen.push(`${p.visual}/${p.source || ""} ${x.r.status}`);
      if (!good) ddiff.push(`${p.visual}/${p.source || ""} ${x.r.status} ${x.text.slice(0, 40)}`);
    }
    okw("ダッシュボードのパネルは窓が答え、数が一覧と同じ（11 通り・数字・グラフ・合わせた表・別のデータ・稼働・ABC 分析・失敗の答え）", ddiff.length === 0,
        `[道どうし・形] ${ddiff.length ? ddiff.join(" | ") : `設備 ${one ? one.name : "なし"}・${seen.slice(0, 5).join(" ")}`}`);
    // 待っているパネルの段（版 3.97.0。desktop/src/progress.rs）: 印を付けた問い合わせの段を窓が覚えて答える（済み・前回の時間）
    const tag = `selftest-${Date.now()}`, tp = panels[3];
    await post(`?ask=${tag}a`, tp);
    await post(`?ask=${tag}b`, tp);
    const pg = await get(`/api/dashboard/progress?ask=${tag}a,${tag}b,無い印`);
    const pj = (parse(pg.text) || {}).asks || {};
    const [pa, pb] = [pj[`${tag}a`] || {}, pj[`${tag}b`] || {}];
    okw("待っているパネルの段を窓が答える（済み・前回の時間）",
       // 前回の時間（prevMs）は数えた組みだけが持つ（答えられないパネルは数えないので null）。鍵があることを見る
       pg.by === "shell" && pg.r.ok && pa.done === true && pb.done === true && typeof pa.elapsedMs === "number" && typeof pb.elapsedMs === "number"
         && "prevMs" in pb && Object.keys(pj).length === 2,
       `[形] ${pg.r.status} a=${JSON.stringify(pa).slice(0, 80)} b.prevMs=${pb.prevMs}`);
  });

  await part("配布の画面", async () => {
    // 11) 配布の画面の係（窓）: 答えが返る・版を置けない人は理由つきで断られる
    const rel = await get("/__desktop/release");
    const relj = parse(rel.text) || {};
    okw("配布の画面の係が答える（置き場に届くか・権限）", rel.by === "shell" && rel.r.ok && "reachable" in relj && relj.me,
       `${rel.r.status} reachable=${relj.reachable} canRelease=${(relj.me || {}).canRelease} ${relj.why || ""}`);
    // 覚えた答え（cached=1）: 上でたどった答えを、置き場をたどり直さずに返す（タブを開いたときに待たせない）
    const relT0 = performance.now(), relc = await get("/__desktop/release?cached=1"), relMs = performance.now() - relT0;
    const relcj = parse(relc.text) || {};
    okw("配布の画面: 覚えた答えをすぐ返す（cached=1）", relc.r.ok && relcj.cached === true && !!relcj.me && relcj.reachable === relj.reachable,
       `${relMs.toFixed(0)}ms cached=${relcj.cached} checkedAt=${relcj.checkedAt}`);
    if (relj.me && !relj.me.canRelease) {
      const put = await get("/__desktop/release/place?name=x.zip", { method: "POST", headers: { "Content-Type": "application/zip" }, body: new Uint8Array([80, 75]) });
      okw("版を置けない人は理由つきで断られる", put.r.status === 403 && /開発者・メンテナンス者/.test(put.text), `${put.r.status} ${put.text.slice(0, 80)}`);
    }
  });

  await part("権限", async () => {
    // 11b) 権限（版 3.65.0 から窓が決める: access.rs）: 画面が名乗った見出し X-TPA-Me は効かない
    const am = await get("/api/access/me");
    amj = parse(am.text) || {};
    // 見出しの値は Latin-1 だけ送れる（日本語は fetch が断る）ので、偽の me は \u で書く（画面の悪い字もこの形で来る）
    const fake = JSON.stringify({ login: "FAKE", pc: "FAKE", pcSource: "", key: "FAKE", rows: [], revoked: null,
      flags: { role: "設備作業者", masterEdit: "非表示", masterEditStored: "非表示", matchedId: null, hiddenTabs: [] }, caps: { role: "設備作業者" } })
      .replace(/[\u0080-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
    const forged = await get("/api/access/me", { headers: { "X-TPA-Me": fake } });
    const fj = parse(forged.text) || {};
    okw("権限: 窓が決めた名乗りで答え（版 3.76.0 から窓が答える）、画面が名乗った見出しは効かない", am.r.ok && forged.r.ok && am.by === "shell" && forged.by === "shell" && !!amj.role && amj.loginId !== "FAKE" && fj.loginId === amj.loginId && fj.role === amj.role,
       `${amj.loginId}@${amj.pcName} ${amj.role}・${amj.masterEdit} / 偽の見出し → ${fj.loginId} ${fj.role}`);
    // タブの権限の GET も窓が答える（版 3.101.0）: 偽の me（書けない段）を見出しに載せても、窓が決めた me で答える。前は ?engine=python で
    // Python へ回した道で見た（窓が見出しを捨てて中身へ渡す枝は、段 ⑤ まで cargo の router の試験が持つ）
    const ta = await get("/api/masters/tabaccess"), tf = await get("/api/masters/tabaccess", { headers: { "X-TPA-Me": fake } });
    const taj = parse(ta.text) || {}, tfj = parse(tf.text) || {};
    okw("権限: タブの権限の道でも、画面が名乗った見出しは効かない（窓が捨てて自分の me で答える）",
       // 書けるか（canEdit）は切断中なら書けない。偽の me は書けない段なので、本当の me が書けるときだけ見分けられる（見分けたかを言葉に出す）
       ta.r.ok && tf.r.ok && ta.by === "shell" && tf.by === "shell" && taj.canEdit === (amj.canEditAdminMaster === true && !amj.revoked)
         && !firstDiff({ canEdit: tfj.canEdit, tabs: tfj.tabs }, { canEdit: taj.canEdit, tabs: taj.tabs }),
       `[道どうし] ${ta.by} タブの権限 canEdit ${taj.canEdit} / 偽の見出し → ${tfj.canEdit}・${firstDiff({ canEdit: tfj.canEdit, tabs: tfj.tabs }, { canEdit: taj.canEdit, tabs: taj.tabs }) || "同じ"}`
         + (taj.canEdit ? "（偽の見出しが効けば false になる形で確かめた）" : "（この PC は書けないので、偽の見出しは見分けられない）"));
    // 11c) 出さないタブ・権限の札・マスタ管理の入口（版 3.111.0）: 窓の名乗りで決める
    const me = state.me || {}, hid = me.hiddenTabs || [];
    const denied = Object.entries(FIXED_TAB_KEY).filter(([, k]) => hid.includes(k))
      .every(([screen]) => { const b = document.querySelector(`.screen-tabs [data-screen="${screen}"]`); return !b || b.hasAttribute("data-denied"); });
    const srcShown = [...document.querySelectorAll('.screen-tabs [data-screen^="src:"]')].filter((b) => hid.includes(b.dataset.screen.slice(4)));
    okw("出さないタブを出さない・権限の札とマスタ管理の入口は窓の名乗り（中身が止まっていても）",
        typeof me.role === "string" && document.querySelector("#meChip").textContent === me.role && denied && !srcShown.length
          && document.querySelector("#masterBtn").classList.contains("hidden") === !me.canOpenMaster,
        `python=${python} 区分 ${me.role} 出さない ${JSON.stringify(hid)} 札「${document.querySelector("#meChip").textContent}」 入口 ${!document.querySelector("#masterBtn").classList.contains("hidden")}`);
    // 利用状況のいま使っている印: 起こさない窓（版 3.118.0）は中身の様子を書かない
    let mine = null, st = 0;
    for (const until = Date.now() + 15000; Date.now() < until;) {
      const pr = await get("/api/presence");
      st = pr.r.status;
      if (!pr.r.ok) break;
      const pj = parse(pr.text) || {};
      mine = ((pj.fleet || {}).items || []).find((x) => x.key === pj.me) || null;
      if (mine && !mine.python) break;
      await sleep(500);
    }
    okw("利用状況のいま使っている印に中身の様子（止まっていれば stopped・起きている・起こさない窓は無い）",
        st === 403 || (mine && !mine.python),
        st === 403 ? "この PC の区分は利用状況を見られない（見ない）" : `${st} ${JSON.stringify(mine && mine.python)}`);
  });

  await part("終わり", async () => {
    // 12) 画面のエラーが無い（窓の外の受け口 /__desktop/update などが無くても、画面は黙って続ける）
    await sleep(500);
    const errs = window.__tpaErrors || [];
    okw("画面のエラーが無い", errs.length === 0, errs.join(" / "));
    // 13) 速さ（参考）: 窓の道 30 回・Rust の部品 30 回の平均（ミリ秒）
    const avg = async (url) => { const s = performance.now(); for (let i = 0; i < 30; i++) await (await fetch(url)).arrayBuffer(); return (performance.now() - s) / 30; };
    const api = await avg("/api/build"), sh = await avg(`/static/js/shared.js?v=${fp}`);
    okw("問い合わせの速さ（参考）", api < 300, `[形] 窓の道 ${api.toFixed(1)}ms / Rust の部品 ${sh.toFixed(1)}ms`);
    // 14) 窓が答えない道が無い（版 3.118.1）: 画面の起動と自己診断の全部の道のあとに、窓が答えなかった形（/__desktop/info の unanswered）が
    //     自己診断がわざと叩いた形だけ（道に当たらない道・畳んだ static の外。試験の版は更新履歴も）
    const end = (await (await fetch("/__desktop/info")).json()).unanswered || {};
    const allow = ["unanswered GET /api/no-such-route", "unanswered GET /templates/index.html"].concat(testVersion ? ["unanswered GET /api/changelog"] : []);
    const extra = Object.keys(end).filter((k) => !allow.includes(k));
    okw("窓が答えない道が無い（画面の起動と自己診断の全部の道）", !extra.length && end["unanswered GET /api/no-such-route"] >= 1,
        `[形] 余分 ${extra.length ? extra.map((k) => `${k}×${end[k]}`).join("・") : "なし"}・わざと ${allow.filter((k) => k in end).map((k) => `${k.replace("unanswered ", "")}×${end[k]}`).join("・")}`);
  });

  // 更新の係（この PC のアプリで動くときだけ取り込む）。取り込み中なら落ち着くまで待ち、状態を結果に添える（verify.py が読む）
  let update = null;
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
  // 結果の形（ci.yml・desktop.yml・verify.py が読む）。python は窓の様子（版 3.118.0 から absent）・skipped は版 3.118.1 から 0（飛ばす項目は無い）
  const body = JSON.stringify({ ok: res.every((r) => r.ok), elapsed_ms: Math.round(performance.now() - t0), ua: navigator.userAgent, results: res,
    python, skipped: 0,
    update, info: info && { exe: info.exe, program: info.program, installed: info.installed, version: info.program_version,
      backend_version: (info.backend || {}).version, install: info.install, local_root: info.local_root, unanswered: info.unanswered } });
  await fetch("/__desktop/selftest", { method: "POST", headers: { "Content-Type": "application/json" }, body });
})();
