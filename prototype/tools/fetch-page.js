// SPA 페이지를 Electron(Chromium)으로 렌더링해서 본문 텍스트/HTML을 파일로 저장 (나무위키 등 대조용)
// 사용: electron tools/fetch-page.js -- <url> <out.txt> [selector] [waitMs]
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const args = process.argv.slice(process.argv.indexOf("--") + 1); // electron이 URL 인자를 앱 경로로 오해하므로 "--" 뒤에 넘긴다
const [url, out, selector = "body", waitMs = "6000"] = args;
process.on("uncaughtException", (e) => { console.error("ERR", e); app.exit(2); });
process.on("unhandledRejection", (e) => { console.error("REJ", e); app.exit(3); });
console.log("fetch", url);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1400, height: 2000, webPreferences: { sandbox: true } });
  win.webContents.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36");
  win.webContents.on("did-fail-load", (_e, code, desc) => console.error("FAIL", code, desc));
  try { await win.loadURL(url); } catch (e) { console.error("loadURL", e.message); }
  const deadline = Date.now() + +waitMs;
  let text = "";
  while (Date.now() < deadline) {
    text = await win.webContents.executeJavaScript(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? el.innerText : ""; })()`);
    if (text.length > 2000) break;
    await new Promise(r => setTimeout(r, 500));
  }
  const html = await win.webContents.executeJavaScript(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? el.innerHTML : ""; })()`);
  fs.writeFileSync(out, text); fs.writeFileSync(out.replace(/\.txt$/, "") + ".html", html);
  console.log("saved", out, "chars", text.length, "title", await win.webContents.executeJavaScript("document.title"));
  app.quit();
});
