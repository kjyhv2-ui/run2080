/* ===== 오류 기록 수신 =====
   앱(index.html의 ErrorReporter)이 보낸 오류 기록을 받아 Vercel 런타임 로그에 남긴다.
   - 받는 것: 앱 버전, 오류 메시지·파일명·줄 번호·스택, 탭 번호, 브라우저 종류(개인정보처리방침 3항과 일치)
   - 저장하지 않는 것: IP 주소(로그에 기록하지 않음), 운동·위치·건강 데이터(애초에 오지 않음)
   - Vercel 무료(Hobby) 요금제는 런타임 로그 보관 기간이 짧다. 오래 보관하려면 환경변수 LOG_WEBHOOK_URL에
     웹훅 주소(디스코드·슬랙·구글 Apps Script 등)를 등록하면 같은 내용을 그곳으로도 전달한다(코드 수정 불필요). */
const MAX_BODY = 4096;
const WEBHOOK = process.env.LOG_WEBHOOK_URL;

function clip(v, n) { return String(v == null ? "" : v).slice(0, n); }

async function readBody(req) {
  if (req.body != null) return typeof req.body === "string" ? req.body : JSON.stringify(req.body);
  return await new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => { data += c; if (data.length > MAX_BODY) data = data.slice(0, MAX_BODY); });
    req.on("end", () => resolve(data));
    req.on("error", () => resolve(""));
  });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).end(); }
  try {
    const raw = (await readBody(req)).slice(0, MAX_BODY);
    let j; try { j = JSON.parse(raw); } catch (e) { return res.status(400).end(); }
    const entry = {
      at: new Date().toISOString(),
      type: clip(j.type, 20), v: clip(j.v, 20), tab: Number.isInteger(j.tab) ? j.tab : null,
      msg: clip(j.msg, 300), src: clip(j.src, 80), line: Number(j.line) || 0, col: Number(j.col) || 0,
      stack: clip(j.stack, 1200), ua: clip(j.ua, 160), standalone: !!j.standalone,
    };
    if (!entry.msg) return res.status(400).end();
    console.warn("[RUN2080 client-error]", JSON.stringify(entry));
    if (WEBHOOK) {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 3000);
      await fetch(WEBHOOK, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: ctrl.signal,
        body: JSON.stringify({ content: `[RUN2080 v${entry.v}] ${entry.type}: ${entry.msg}\n${entry.src}:${entry.line} tab=${entry.tab}\n${entry.ua}`.slice(0, 1900), entry }),
      }).catch(() => {}).finally(() => clearTimeout(t));
    }
    return res.status(204).end();
  } catch (e) {
    return res.status(500).end();
  }
};
