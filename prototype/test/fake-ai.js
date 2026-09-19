// 가짜 OpenAI 호환 서버 — --aifail-test 가 실패 상황을 순서대로 겪게 한다 (flow.js 가 띄운다)
//   1번째 요청: 스트림을 두 조각 보내고 소켓을 끊음 · 2번째: 429 한도 초과 · 3번째: 401 잘못된 키 · 그 뒤: 정상 답
const http = require("http"); const port = +(process.argv[2] || 18081); let n = 0;
http.createServer((req, res) => {
  let body = ""; req.on("data", d => body += d); req.on("end", () => {
    n++;
    if (n === 1) { res.writeHead(200, { "content-type": "text/event-stream" }); res.write('data: {"choices":[{"delta":{"content":"안녕, 교주"}}]}\n\n'); setTimeout(() => { res.write('data: {"choices":[{"delta":{"content":"님. 오늘은"}}]}\n\n'); setTimeout(() => res.socket.destroy(), 150); }, 150); return; }
    if (n === 2) { res.writeHead(429, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { message: "Rate limit reached for model", code: "rate_limit_exceeded" } })); return; }
    if (n === 3) { res.writeHead(401, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { message: "Invalid API Key", code: "invalid_api_key" } })); return; }
    res.writeHead(200, { "content-type": "text/event-stream" }); res.write('data: {"choices":[{"delta":{"content":"이번엔 잘 왔다비. [감정:행복]"}}]}\n\n'); res.write("data: [DONE]\n\n"); res.end();
  });
}).listen(port, "127.0.0.1", () => console.log("FAKEAI on", port));
