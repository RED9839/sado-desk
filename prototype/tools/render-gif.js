// Spine(.skel + .atlas + png) → GIF. Electron 숨김 창에서 renderer/gif.html 로 프레임을 뽑고 ffmpeg(palettegen)로 GIF 인코딩.
// 사용: electron tools/render-gif.js -- <skel> <atlas> <out.gif> [--anim Idle_1] [--skin NAME] [--fps 24] [--size 512] [--list] [--all-anims]
//   --list       애니/스킨 목록만 출력
//   --all-anims  모든 애니를 각각 <out 디렉터리>/<anim>.gif 로
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

const args = process.argv.slice(process.argv.indexOf("--") + 1);
const pos = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && ["--anim", "--skin", "--fps", "--size", "--ffmpeg"].includes(args[i - 1])));
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const [skel, atlas, out] = pos;
const FFMPEG = opt("--ffmpeg", process.env.FFMPEG || "C:/Users/User/AppData/Roaming/Python/Python314/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe");

function encodeGif(frames, fps, outFile) {
  const tmp = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "gif-"));
  frames.forEach((f, i) => fs.writeFileSync(path.join(tmp, `f${String(i).padStart(4, "0")}.png`), Buffer.from(f.split(",")[1], "base64")));
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  // 투명 GIF: palettegen에서 투명색 예약, paletteuse에서 알파 임계값
  execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-framerate", String(fps), "-i", path.join(tmp, "f%04d.png"),
    "-vf", "split[a][b];[a]palettegen=reserve_transparent=1:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:alpha_threshold=128",
    "-loop", "0", outFile]);
  fs.rmSync(tmp, { recursive: true, force: true });
  return fs.statSync(outFile).size;
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 600, height: 600, webPreferences: { preload: path.join(__dirname, "..", "preload.js"), contextIsolation: true, sandbox: false, offscreen: false } });
  win.webContents.on("console-message", (ev) => console.log("[gif]", ev.message));
  await win.loadFile(path.join(__dirname, "..", "renderer", "gif.html"));
  const fps = +opt("--fps", 24), size = +opt("--size", 512);
  const base = { skelPath: path.resolve(skel), atlasPath: path.resolve(atlas), skin: opt("--skin", null), fps, size, fixedBounds: args.includes("--fixed") };
  const first = await win.webContents.executeJavaScript(`window.renderFrames(${JSON.stringify({ ...base, anim: opt("--anim", "Idle_1") })})`);
  if (args.includes("--list")) {
    console.log("skins:", first.skins.join(", "));
    console.log("animations:", first.animations.map(a => `${a.name}(${a.duration}s)`).join(", "));
    app.quit(); return;
  }
  const targets = args.includes("--all-anims") ? first.animations.map(a => a.name) : [first.anim];
  for (const anim of targets) {
    const r = anim === first.anim ? first : await win.webContents.executeJavaScript(`window.renderFrames(${JSON.stringify({ ...base, anim })})`);
    const outFile = args.includes("--all-anims") ? path.join(out, `${anim}.gif`) : out;
    const bytes = encodeGif(r.frames, fps, outFile);
    console.log(`GIF ${outFile} anim=${r.anim} frames=${r.frames.length} ${r.duration.toFixed(2)}s bounds=${r.bounds.w}x${r.bounds.h} pma=${r.pma} ${(bytes / 1024).toFixed(0)}KB`);
  }
  app.quit();
}).catch(e => { console.error("ERR", e); app.exit(1); });
