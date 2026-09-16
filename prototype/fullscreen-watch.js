/* 앞에 있는 창이 모니터를 통째로 덮고 있는지 본다 — 전체화면 게임·영상 위에서는 사도를 숨기려고.
 * Electron 에는 "지금 앞에 있는 창"을 알아내는 API 가 없다. 네이티브 모듈을 들이지 않으려고 PowerShell 하나를
 * 상주시켜 1초마다 앞 창의 사각형·프로세스·클래스를 한 줄로 받는다. C# 컴파일이 처음 한 번 1~2초 걸리고
 * 그 뒤로는 10MB 안팎에 CPU 는 거의 쓰지 않는다. PowerShell 이 없거나 실패하면 이 기능만 조용히 꺼진다. */
const { spawn } = require("node:child_process");

// __PARENT__ 는 띄울 때 우리 pid 로 바꿔 넣는다. 앱이 강제 종료되어 stop() 이 못 돌아도 감시가 혼자 남지 않게
const PS = String.raw`
$ErrorActionPreference = "SilentlyContinue"
$parent = __PARENT__
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public class FG {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@
$sb = New-Object System.Text.StringBuilder 128
$last = ""
$tick = 0
while ($true) {
  $tick++
  if ($tick % 5 -eq 0) { if (-not (Get-Process -Id $parent -ErrorAction SilentlyContinue)) { exit } }
  $h = [FG]::GetForegroundWindow()
  $r = New-Object FG+RECT
  [void][FG]::GetWindowRect($h, [ref]$r)
  [void]$sb.Clear(); [void][FG]::GetClassName($h, $sb, 128)
  $p = [uint32]0; [void][FG]::GetWindowThreadProcessId($h, [ref]$p)
  $z = 0; if ([FG]::IsZoomed($h)) { $z = 1 }
  $line = "$($r.L),$($r.T),$($r.R),$($r.B),$p,$z,$($sb.ToString())"
  if ($line -ne $last) { $last = $line; [Console]::Out.WriteLine($line); [Console]::Out.Flush() }
  Start-Sleep -Milliseconds 1000
}
`;

// 바탕화면·작업표시줄·시작 메뉴는 앞에 있어도 "전체화면"이 아니다
const DESKTOP_CLASSES = new Set(["Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "Windows.UI.Core.CoreWindow", "XamlExplorerHostIslandWindow"]);

/** @param {{ screen: Electron.Screen, ownPid: number, onChange: (fullscreen: boolean, info: object) => void, log?: Function }} o */
function createFullscreenWatcher({ screen, ownPid, onChange, log = () => {} }) {
  let proc = null, state = false, stopped = false, restarts = 0;

  function judge(line) {
    const [L, T, R, B, pid, zoomed, cls] = line.split(",");
    // 최대화 창은 전체화면이 아니다. 작업표시줄을 자동 숨김으로 둔 PC 에서는 최대화 창도 모니터를
    // 다 덮으므로 사각형만 보면 오탐이 난다
    if (zoomed === "1") return false;
    const rect = { x: +L, y: +T, width: +R - +L, height: +B - +T };
    if (!Number.isFinite(rect.width) || rect.width <= 0 || rect.height <= 0) return false;
    if (+pid === ownPid) return false;                       // 우리 창(마스코트 창은 모니터 합집합 크기라 늘 걸린다)
    if (DESKTOP_CLASSES.has((cls || "").trim())) return false;
    // GetWindowRect 는 물리 픽셀, Electron 의 bounds 는 DIP 다. 배율 150% 화면이면 어긋나므로 바꿔서 본다
    let dip = rect; try { dip = screen.screenToDipRect(null, rect); } catch {}
    for (const d of screen.getAllDisplays()) {
      const b = d.bounds;
      // 모니터를 통째로 덮으면 전체화면. 최대화 창은 작업표시줄 자리가 남아 여기 안 걸린다. 1~2px 오차는 봐준다
      if (dip.x <= b.x + 2 && dip.y <= b.y + 2 && dip.x + dip.width >= b.x + b.width - 2 && dip.y + dip.height >= b.y + b.height - 2) return { display: d.id, pid: +pid, cls };
    }
    return false;
  }

  function start() {
    if (stopped) return;
    try {
      proc = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", PS.replace("__PARENT__", String(ownPid))],
        // 작업 폴더를 앱 폴더에 두면 이 프로세스가 살아 있는 동안 설치 폴더가 잠긴다 — 앱을 끄고 곧바로
        // 새 판을 설치하면 구판 제거 단계가 폴더를 못 지워 설치기가 멈춘다. 임시 폴더에서 돌린다
        { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], cwd: require("node:os").tmpdir() });
    } catch (e) { log("fullscreen watch spawn fail", e.message); return; }
    let buf = "";
    proc.stdout.on("data", (d) => {
      buf += d.toString("utf8"); let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue;
        restarts = 0; // 한 줄이라도 받았으면 살아 있는 것 — 며칠 쓰다 누적 세 번에 포기하지 않게
        const fs = judge(line); const now = !!fs;
        if (now !== state) { state = now; onChange(now, fs || {}); }
      }
    });
    proc.stderr.on("data", (d) => { const t = d.toString("utf8").trim(); if (t) log("fullscreen watch:", t.slice(0, 200)); });
    proc.on("exit", (code) => {
      proc = null;
      if (state) { state = false; onChange(false, {}); } // 숨긴 채로 감시가 죽으면 사도가 영영 안 보인다. 죽는 순간 되돌린다
      if (stopped) return;
      // 죽으면 다시 띄운다. 계속 죽으면 포기한다 — 이 기능 없이도 앱은 멀쩡해야 한다
      if (++restarts <= 3) setTimeout(start, 3000 * restarts); else log("fullscreen watch gave up, exit", code);
    });
  }
  function stop() { stopped = true; if (proc) { try { proc.kill(); } catch {} proc = null; } if (state) { state = false; onChange(false, {}); } }
  return { start, stop, get fullscreen() { return state; } };
}
module.exports = { createFullscreenWatcher };
