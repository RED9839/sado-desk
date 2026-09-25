/* 릴리스 한 번에 — 빌드 → 초안 만들기 → exe·blockmap 올리기 → 검사값 대조 → 공개.
 * 손으로 하다 .blockmap 을 매번 빠뜨렸다(차등 업데이트가 불가능해진다). 사람 손을 뺀다.
 *   node tools/release.js --check                 지금 낼 수 있는 상태인지만 본다
 *   node tools/release.js --notes out/notes.md    빌드부터 공개까지
 *   node tools/release.js --notes out/notes.md --no-build   이미 dist 에 있는 것으로
 * 깃허브 인증은 gh CLI 를 쓴다(gh auth token). 올린 뒤 깃허브가 알려 주는 sha256 을 우리 것과 대조한다.
 */
const fs = require("node:fs"), path = require("node:path"), { execFileSync, spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const has = (f) => process.argv.includes(f);
const sh = (cmd, args, opt = {}) => execFileSync(cmd, args, { cwd: root, encoding: "utf8", ...opt }).trim();
const die = (msg) => { console.error("✗ " + msg); process.exit(1); };

const version = arg("--version", require(path.join(root, "package.json")).version);
const tag = "v" + version;
const exe = path.join(root, "dist", `SadoDesk-Setup-${version}.exe`);
const map = exe + ".blockmap";
const sha = (f) => require("node:crypto").createHash("sha256").update(fs.readFileSync(f)).digest("hex");

// ---- 1. 낼 수 있는 상태인가 ----
function preflight() {
  const status = sh("git", ["status", "--porcelain"]);
  if (status) die("작업 트리에 커밋하지 않은 변경이 있습니다:\n" + status);
  // upstream(@{u}) 이 잡혀 있지 않은 저장소도 있다 — origin/main 과 직접 견준다
  sh("git", ["fetch", "-q", "origin", "main"]);
  const ahead = sh("git", ["rev-list", "--count", "origin/main..HEAD"]);
  if (ahead !== "0") die(`푸시하지 않은 커밋이 ${ahead}개 있습니다`);
  // 이미 공개된 릴리스면 멈춘다. 초안이면(앞선 시도가 중간에 멈춘 것) 이어서 쓴다
  const exists = spawnSync("gh", ["release", "view", tag, "--json", "isDraft"], { cwd: root, encoding: "utf8" });
  if (exists.status === 0) {
    const draft = (() => { try { return JSON.parse(exists.stdout).isDraft === true; } catch { return false; } })();
    if (!draft) die(`${tag} 릴리스가 이미 공개돼 있습니다`);
    console.log(`· ${tag} 초안이 남아 있습니다 — 이어서 씁니다`);
  }
  console.log(`· 작업 트리 깨끗 · 푸시 완료 · ${tag} 아직 없음`);
}

// ---- 2. 빌드 ----
function build() {
  console.log("· 설치판 빌드 (2~3분)");
  // 윈도우에서 .cmd 는 셸을 거쳐야 한다 — Node 20+ 는 보안상 execFile 로 직접 띄우면 EINVAL 을 낸다
  execFileSync("npm", ["run", "dist"], { cwd: root, stdio: "inherit", shell: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: "" } });
}

// ---- 3. 올리기 (exe + blockmap 둘 다 — blockmap 이 있어야 나중에 차등 업데이트를 붙일 수 있다) ----
async function upload(id, file, token) {
  const name = path.basename(file), size = fs.statSync(file).size;
  // 본문은 스트림이 아니라 버퍼로 보낸다 — 깃허브 업로드는 리디렉션을 태우는데, 스트림 본문은 다시 보낼 수 없어 거기서 끊긴다
  const r = await fetch(`https://uploads.github.com/repos/RED9839/sado-desk/releases/${id}/assets?name=${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { Authorization: `token ${token}`, "Content-Type": "application/octet-stream", "Content-Length": String(size) },
    body: fs.readFileSync(file),
  });
  if (!r.ok) die(`${name} 올리기 실패 (HTTP ${r.status}) ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  console.log(`· 올림 ${name} ${size.toLocaleString()} bytes`);
  return j;
}

(async () => {
  preflight();
  if (has("--check")) { console.log("✓ 낼 수 있는 상태입니다 (여기까지가 --check)"); return; }

  const notesFile = arg("--notes", null);
  if (!notesFile || !fs.existsSync(notesFile)) die("--notes <파일> 로 릴리스 노트를 주세요");
  if (!has("--no-build")) build();
  for (const f of [exe, map]) if (!fs.existsSync(f)) die(`없습니다: ${f}`);

  const token = sh("gh", ["auth", "token"]);
  // 초안은 아직 태그가 없어 /releases/tags/<tag> 로는 404 다 — 목록에서 tag_name 으로 찾는다.
  // 앞선 시도가 중간에 멈춰 빈 초안이 남아 있으면 그것을 쓴다(초안이 쌓이지 않게)
  const findDraft = () => sh("gh", ["api", "repos/RED9839/sado-desk/releases", "--jq", `[.[] | select(.tag_name=="${tag}")][0].id // ""`]);
  let id = findDraft();
  if (id) console.log(`· 이미 있는 초안을 씁니다 (${id})`);
  else {
    console.log(`· 초안 만들기 ${tag}`);
    sh("gh", ["release", "create", tag, "--draft", "--title", arg("--title", tag), "--notes-file", notesFile]);
    id = findDraft();
  }
  if (!id) die("초안을 찾지 못했습니다");

  const have = new Set(JSON.parse(sh("gh", ["api", `repos/RED9839/sado-desk/releases/${id}`, "--jq", "[.assets[].name]"])));
  const up = [];
  for (const f of [exe, map]) {
    if (have.has(path.basename(f))) { console.log(`· 이미 올라가 있음 ${path.basename(f)}`); up.push([f, null]); continue; }
    up.push([f, await upload(id, f, token)]);
  }

  // 깃허브가 계산한 검사값과 우리 것이 같은가 — 올리다 깨지면 앱 안 업데이트가 설치를 거부한다
  const assets = JSON.parse(sh("gh", ["api", `repos/RED9839/sado-desk/releases/${id}`, "--jq", "[.assets[] | {name, digest, size}]"]));
  for (const [f] of up) {
    const a = assets.find(x => x.name === path.basename(f)) || {};
    const mine = "sha256:" + sha(f);
    if (a.digest !== mine) die(`검사값이 다릅니다 ${path.basename(f)}\n  깃허브 ${a.digest}\n  이 PC  ${mine}`);
    console.log(`· 검사값 일치 ${path.basename(f)} ${a.digest.slice(0, 19)}…`);
  }

  sh("gh", ["release", "edit", tag, "--draft=false", "--latest"]);
  console.log(`✓ 공개했습니다 https://github.com/RED9839/sado-desk/releases/tag/${tag}`);
})();
