// 画面の撮影と測定（開発用。画面を直す前と後で同じ物差しで比べる。元は Inventor の同じ名前の道具）。
//
//   node program/tools/ui-check.mjs 出力フォルダ [light|dark|both] [1536x864] [--states list,dash]
//
// --states（版 3.118.3）: 撮る状態をその名前だけに（ui-harness.mjs の STATES の名前。check-all.sh の任意の段 --ui）。状態ごとに新しい頁で
// その状態から始める（walk の only と from。only だけでは選んだ状態のうち最後の物までの前の状態を全部たどる）。起動画面は撮らない。
// 前の状態の積み重ねが要る状態（まとめた後の状態など）は、その状態だけでは撮れない（STATES の並びで前から撮る形は --states を付けない）
//
// 利用者の画面と同じ大きさで、状態ごと（品質異常・並び・まとめ・表の見せ方・カード・計算の検索前・アプリのメニュー・更新履歴）に
// 撮り（状態名-テーマ.png。起動画面の進行中・失敗も）、迷いやすさに関わる量を測る（metrics.json。測る量は ui-harness.mjs の measure）。
// このアプリにはダークの見た目がまだ無いので、テーマの既定は light（入れたら both で撮る）。
// 改良案どうしを画像で比べるときは ui-variants.mjs。撮る相手（窓・Python）どうしを画素で比べるときは TPA_UI_MASK=1 で撮って ui-diff.mjs。

import fs from "node:fs";
import path from "node:path";
import { launch, measure, parseView, shot, STATES, walk, walkSplash } from "./ui-harness.mjs";

const argv = process.argv.slice(2);
const si = argv.indexOf("--states");
const ONLY = si >= 0 ? (argv.splice(si, 2)[1] || "").split(",").filter(Boolean) : null;
const OUT = path.resolve(argv[0] ?? "ui-check");
const THEMES = { light: ["light"], dark: ["dark"], both: ["light", "dark"] }[argv[1] ?? "light"];
const VIEW = parseView(argv[2]); // 省くと利用者の PC の大きさ（1728×1152）
const unknown = (ONLY || []).filter((n) => !STATES.some(([name]) => name === n));
if (ONLY && (!ONLY.length || unknown.length)) {
  console.error(`--states の名前が違います: ${unknown.join(",") || "（空）"}（ui-harness.mjs の STATES の名前）`);
  process.exit(2);
}

const app = await launch();
const report = {};
const broken = [];
try {
  fs.mkdirSync(OUT, { recursive: true });
  for (const theme of THEMES) {
    // --states なら状態ごとに新しい頁でその状態から（起動画面は撮らない）。付けなければ起動画面と、STATES を前から全部
    // --states で選んだ状態の進め方（go）が投げたら、撮っても終了コード 1（前の状態の積み重ねが要る状態を、崩れたまま撮って 0 にしない。
    // 版 3.118.3 の作った後の採点の割れ 9）
    const runs = ONLY ? ONLY.map((name) => [app.newPage, async (pg, visit) => { const f = await walk(pg, visit, [name], name); broken.push(...f.map((x) => `${x}-${theme}`)); }])
      : [[app.newSplash, walkSplash], [app.newPage, walk]];
    for (const [open, steps] of runs) {
      const page = await open(theme, VIEW);
      await steps(page, async (name, next) => {
        await shot(page, path.join(OUT, `${name}-${theme}.png`));      // TPA_UI_MASK=1 は時計の字を伏せる（ui-diff.mjs で比べるとき）
        report[`${name}-${theme}`] = await page.evaluate(measure, next);
        console.log(`${name}-${theme}`, JSON.stringify(report[`${name}-${theme}`]));
      });
      await page.context().close();
    }
  }
} finally {
  await app.close();
}
fs.writeFileSync(path.join(OUT, "metrics.json"), JSON.stringify(report, null, 1));
if (broken.length) {
  console.error(`状態に進めませんでした（その状態だけでは撮れない。前の状態の積み重ねが要る）: ${broken.join(", ")}`);
  process.exit(1);
}
