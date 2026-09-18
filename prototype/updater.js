/* 업데이트 확인 — 깃허브 최신 릴리스 태그가 이 버전보다 높으면 알림(클릭 → 릴리스 페이지). 같은 버전은 한 번만 알린다.
 * main.js 에서 떼어 낸 것. 트레이 갱신은 ctx.refreshTray 로.
 *   const UP = require("./updater.js")(ctx); → { checkUpdate, get info(), newerThan, semver }
 */
const { app, shell } = require("electron");
const argHas = (f) => process.argv.includes(f);

module.exports = function createUpdater(ctx) {
  const UPDATE_REPO = "RED9839/sado-desk";
  let updateInfo = null, updateNotified = "";
  const semver = (v) => String(v || "").replace(/^v/, "").split(".").map(n => parseInt(n, 10) || 0);
  const newerThan = (a, b) => { const x = semver(a), y = semver(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
  async function checkUpdate() {
    try {
      const r = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, { headers: { "User-Agent": `sado-desk/${app.getVersion()}`, Accept: "application/vnd.github+json" } });
      if (!r.ok) { console.log("update check", r.status); return; }
      const j = await r.json(); const tag = j.tag_name || "";
      if (!newerThan(tag, app.getVersion())) { updateInfo = null; return; }
      updateInfo = { tag, url: j.html_url || `https://github.com/${UPDATE_REPO}/releases/latest`, asset: (j.assets || []).find(a => /\.exe$/i.test(a.name))?.browser_download_url };
      ctx.refreshTray();
      if (updateNotified === tag) return; updateNotified = tag;
      const { Notification } = require("electron");
      if (Notification.isSupported()) { const n = new Notification({ title: `사도 데스크 ${tag} 업데이트가 나왔어요`, body: `지금 ${app.getVersion()} → ${tag.replace(/^v/, "")}. 클릭하면 다운로드 페이지가 열려요. (트레이 메뉴에서도 받을 수 있어요)`, silent: true }); n.on("click", () => shell.openExternal(updateInfo.url)); n.show(); }
      console.log(`update: ${app.getVersion()} → ${tag}`);
    } catch (e) { console.log("update check 실패", e.message); }
  }
  if (argHas("--update-test")) setTimeout(async () => { await checkUpdate(); console.log("UPDATETEST", app.getVersion(), JSON.stringify(updateInfo), "newer(v9.9.9,cur)=", newerThan("v9.9.9", app.getVersion()), "newer(v0.1.0,cur)=", newerThan("v0.1.0", app.getVersion())); app.quit(); }, 2000);
  return { checkUpdate, get info() { return updateInfo; }, newerThan, semver };
};
