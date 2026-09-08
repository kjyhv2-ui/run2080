/* ===== 마라톤온라인(roadrun.co.kr) 대회 일정 프록시 =====
   문제: roadrun.co.kr은 https를 지원하지 않는다. 모바일 브라우저(Chrome)의
   "항상 보안 연결 사용" 기능이 http 링크도 자동으로 https를 먼저 시도하는데,
   이 사이트는 https 요청을 받아줄 서버가 없어 ERR_CONNECTION_REFUSED가 뜬다.
   이건 브라우저가 사용자를 지키기 위한 보안 기능이라 클라이언트 쪽에서 우회할 방법이 없다.

   해결: 이 함수(Vercel 서버)가 대신 http로 접속해서 내용을 가져온 뒤,
   우리 앱의 https 주소로 돌려준다. 서버 간 통신은 브라우저의 "항상 보안 연결" 정책과
   무관하므로 문제없이 접속된다. 브라우저는 우리 앱(https)에만 접속하면 되고,
   실제 목적지(roadrun.co.kr, http)에는 전혀 접속하지 않는다.

   원본 사이트는 EUC-KR 인코딩을 쓰므로 그대로 읽으면 한글이 깨진다(iconv-lite로 변환).
   과도한 요청을 피하기 위해 1시간 캐시를 둔다. */
const iconv = require("iconv-lite");

const UPSTREAM = "http://www.roadrun.co.kr/schedule/list.php";

module.exports = async (req, res) => {
  try {
    const r = await fetch(UPSTREAM, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Run2080-App/1.0)" },
    });
    if (!r.ok) throw new Error("upstream status " + r.status);

    const buf = Buffer.from(await r.arrayBuffer());
    let html = iconv.decode(buf, "euc-kr");

    // 원본의 스크립트·스타일시트 경로는 우리 도메인에서 의미가 없으므로 제거
    html = html.replace(/<script[\s\S]*?<\/script>/gi, "");
    html = html.replace(/<link[^>]*rel=["']stylesheet["'][^>]*>/gi, "");

    // "javascript:open_window('win','view.php?no=NNNNN', ...)" 팝업 링크를
    // 실제 URL로 바꿔 새 탭에서 열리게 함 (팝업 스크립트가 제거됐으므로 그대로 두면 동작하지 않음)
    html = html.replace(
      /href=["']javascript:open_window\('win',\s*'([^']+)'[^)]*\)["']/gi,
      (_m, path) =>
        `href="http://www.roadrun.co.kr/schedule/${path}" target="_blank" rel="noopener"`
    );

    const page = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>마라톤온라인 대회 일정</title>
<style>
  body{background:#0a0e17;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
       font-size:13px;line-height:1.6;padding:12px;margin:0}
  a{color:#38bdf8;text-decoration:none}
  a:active{opacity:.7}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  td,th{padding:7px 4px;border-bottom:1px solid #1e293b;vertical-align:top;text-align:left}
  strong{color:#fff}
  hr{border-color:#1e293b;margin:6px 0}
  select,input{background:#0d1420;color:#e2e8f0;border:1px solid #1e293b;border-radius:4px}
  .note{font-size:11px;color:#64748b;padding:8px 0;border-top:1px solid #1e293b;margin-top:10px}
</style></head><body>
${html}
<div class="note">이 화면은 roadrun.co.kr(마라톤온라인)의 대회 일정을 앱 안에서 안전하게(https) 볼 수 있도록 서버에서 대신 가져온 것입니다. 원본 사이트는 https를 지원하지 않아 직접 링크로는 열리지 않습니다.</div>
</body></html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600"); // 1시간 캐시 — 원 사이트에 매번 부담 주지 않도록
    res.status(200).send(page);
  } catch (e) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(502).send(`<!doctype html><meta charset="utf-8">
<body style="background:#0a0e17;color:#fca5a5;font-family:sans-serif;padding:20px;font-size:13px">
  대회 일정을 불러오지 못했습니다. (${(e && e.message) || "알 수 없는 오류"})<br><br>
  원본 사이트로 직접 이동: <a style="color:#38bdf8" href="http://www.roadrun.co.kr/schedule/list.php">roadrun.co.kr</a>
  <br><span style="color:#64748b;font-size:11.5px">(원본은 https를 지원하지 않아 기기 설정에 따라 안 열릴 수 있습니다)</span>
</body>`);
  }
};
