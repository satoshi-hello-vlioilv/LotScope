/* =========================================================================
   画面の印刷・ハードコピー（版 3.40.0。利用者の要望 2026-10）
   いま見えている画面（窓の中身）を、そのままの見た目で 1 枚の画像（PNG）にする（capture）。その画像を
     - 画像で保存（TPA.download。デスクトップ版は窓が保存し、置いた場所を右下に知らせる）
     - 画像をコピー（クリップボード。貼り付けて報告・メールに使う。できない PC では保存に替えて知らせる）
     - 印刷（画像を用紙の向きに合わせて 1 枚に収め、上に画面の名前と日時を添える。window.print の印刷の窓）
   に使う。描き方: 画面の要素を写し（入力の値・選び・チェック・送った位置も写す）、頁の CSS と一緒に SVG の foreignObject に入れ、
   canvas に描く（外の部品・通信なし。Chromium〈WebView2〉の描き方そのもの）。canvas（3D）は、その時の絵を画像にして入れる。
   キー: Ctrl+P＝印刷（ブラウザーの頁の印刷の代わり）・Ctrl+Shift+S＝画像で保存
   ========================================================================= */
(function () {
  "use strict";
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = (d = new Date()) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const when = (d = new Date()) => `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  /** いま出ている画面の名前（見出しのタブの選ばれている物） */
  const screenName = () => ((document.querySelector('.tab[aria-selected="true"], [role="tab"].on, .tab.on') || {}).textContent || "").trim().replace(/\s+/g, " ") || "画面";
  // アプリの名前は見出しの名前（brand.json から。コードにじかに書かない）
  const appName = () => ((document.querySelector(".brand h1") || {}).textContent || document.title || "app").trim().split(/\s/)[0];

  /** 頁の CSS（同じ頁の物だけ。読めない物は飛ばす） */
  function pageCss() {
    return [...document.styleSheets].map((sh) => { try { return [...sh.cssRules].map((r) => r.cssText).join("\n"); } catch (_) { return ""; } }).join("\n");
  }
  /** 写しへ、元の要素の今の様子（入力の値・選び・送った位置・canvas の絵）を移す */
  function carry(src, dst) {
    const a = [src, ...src.querySelectorAll("*")], b = [dst, ...dst.querySelectorAll("*")];
    const moves = [];
    for (let i = 0; i < a.length && i < b.length; i++) {
      const s = a[i], d = b[i];
      if (s.tagName !== d.tagName) continue;
      if (s.tagName === "INPUT") {
        if (s.type === "checkbox" || s.type === "radio") { if (s.checked) d.setAttribute("checked", ""); else d.removeAttribute("checked"); }
        else d.setAttribute("value", s.value);
      } else if (s.tagName === "TEXTAREA") d.textContent = s.value;
      else if (s.tagName === "SELECT") [...d.options].forEach((o, k) => { if (s.options[k] && s.options[k].selected) o.setAttribute("selected", ""); else o.removeAttribute("selected"); });
      else if (s.tagName === "CANVAS") {
        try { const img = document.createElement("img"); img.src = s.toDataURL("image/png"); img.width = s.clientWidth; img.height = s.clientHeight; img.setAttribute("style", getComputedStyle(s).cssText || `width:${s.clientWidth}px;height:${s.clientHeight}px`); moves.push(() => d.replaceWith(img)); } catch (_) { /* 読めない絵は空のまま */ }
      }
      // 送った位置: 中身を送った分だけずらす（写しは送れないので、子を動かして同じ所を見せる）
      if ((s.scrollTop || s.scrollLeft) && s !== document.documentElement) {
        const x = s.scrollLeft, y = s.scrollTop;
        d.style.setProperty("overflow", "hidden", "important");
        moves.push(() => [...d.children].forEach((c) => c.style.setProperty("translate", `${-x}px ${-y}px`)));
      }
    }
    moves.forEach((f) => f());
  }
  /** いまの画面 → {svg（foreignObject に写しと CSS を入れた SVG の字）, W, H} */
  function svgOf() {
    const W = document.documentElement.clientWidth, H = document.documentElement.clientHeight;
    const html = document.documentElement.cloneNode(true);
    carry(document.documentElement, html);
    html.querySelectorAll("script, #hcPrint, link[rel=stylesheet]").forEach((x) => x.remove());
    const style = document.createElement("style");
    style.textContent = pageCss() + `\nhtml,body{width:${W}px;height:${H}px;overflow:hidden !important;margin:0}`;
    html.querySelector("head").append(style);
    // XML に入れられない制御文字（区切りに使う \u001f など。画面の属性にある）は空白に替える（入っていると画像として読めない）
    const body = new XMLSerializer().serializeToString(html).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, " ");
    return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><foreignObject x="0" y="0" width="100%" height="100%">${body}</foreignObject></svg>`, W, H };
  }
  /** いまの画面 → PNG の Blob（大きさは窓の中身・表示倍率のまま） */
  async function capture() {
    const { svg, W, H } = svgOf(), r = window.devicePixelRatio || 1;
    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    await img.decode();
    const cv = document.createElement("canvas");
    cv.width = Math.round(W * r); cv.height = Math.round(H * r);
    const g = cv.getContext("2d");
    g.scale(r, r);
    g.fillStyle = getComputedStyle(document.body).backgroundColor || "#fff";
    g.fillRect(0, 0, W, H);
    g.drawImage(img, 0, 0, W, H);
    return new Promise((ok, ng) => cv.toBlob((b) => (b ? ok(b) : ng(new Error("画像にできませんでした"))), "image/png"));
  }
  const fileName = () => `${appName()}_${screenName().replace(/[\\/:*?"<>|\s]+/g, "")}_${stamp()}.png`;
  /** 短い知らせ（下の真ん中に 4 秒。読み上げにも届く） */
  function toast(t) {
    let el = document.querySelector(".hc-toast");
    if (!el) { el = document.createElement("div"); el.className = "hc-toast"; el.setAttribute("role", "status"); document.body.append(el); }
    el.textContent = t; el.hidden = false;
    clearTimeout(toast.at); toast.at = setTimeout(() => { el.hidden = true; }, 4000);
  }

  /** 画像で保存 */
  async function save() {
    try { TPA.download(await capture(), fileName()); } catch (e) { toast(`画面を画像にできませんでした（${e.message}）`); }
  }
  /** 画像をコピー（クリップボード）。できなければ保存に替える */
  async function copy() {
    let blob;
    try { blob = await capture(); } catch (e) { toast(`画面を画像にできませんでした（${e.message}）`); return; }
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      toast("画面の画像をコピーしました（Excel・メール・チャットに貼り付けられます）");
    } catch (_) {
      TPA.download(blob, fileName());
      toast("この PC ではクリップボードに入れられなかったので、画像で保存しました");
    }
  }
  /** 印刷: 画面の画像を、用紙（横）1 枚に収めて印刷の窓を出す。上に画面の名前と日時 */
  async function print() {
    let blob;
    try { blob = await capture(); } catch (e) { toast(`画面を画像にできませんでした（${e.message}）`); return; }
    const url = URL.createObjectURL(blob), box = document.createElement("div");
    box.id = "hcPrint";
    box.innerHTML = `<div class="hc-cap"><b>${TPA.esc(appName())}　${TPA.esc(screenName())}</b><span>${TPA.esc(when())} に印刷</span></div><img alt="画面の画像">`;
    const img = box.querySelector("img");
    img.src = url;
    await img.decode().catch(() => {});
    document.body.append(box);
    const done = () => { box.remove(); URL.revokeObjectURL(url); window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    window.print();
    setTimeout(() => { if (box.isConnected && !matchMedia("print").matches) done(); }, 60000);
  }

  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "p" && !e.shiftKey) { e.preventDefault(); print(); }
    else if (k === "s" && e.shiftKey) { e.preventDefault(); save(); }
  });

  window.Hardcopy = { capture, svgOf, save, copy, print, fileName };
})();
