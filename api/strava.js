/* ===== Strava OAuth 2.0 프록시 =====
   Client Secret은 브라우저(클라이언트 JS)에 절대 노출하면 안 되므로, 이 서버 함수가
   대신 Strava와 통신한다. Vercel 프로젝트 설정 > Environment Variables에
   STRAVA_CLIENT_SECRET을 등록해야 실제로 동작한다(값은 strava.com/settings/api에서 확인).
   동작 방식:
   - action=exchange : 인증 코드(code)를 access_token으로 교환(최초 연결 시 1회)
   - action=refresh   : 만료된 access_token을 refresh_token으로 갱신
   - action=activities: 최근 활동 목록을 가져옴(내부적으로 Bearer 토큰 사용) */
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;

module.exports = async (req, res) => {
  const { action } = req.query;
  try {
    if (!CLIENT_SECRET) throw new Error("서버에 STRAVA_CLIENT_SECRET이 설정되지 않았습니다.");

    if (action === "exchange" || action === "refresh") {
      const { client_id } = req.query;
      if (!client_id) throw new Error("client_id가 없습니다.");
      const body =
        action === "exchange"
          ? { client_id, client_secret: CLIENT_SECRET, code: req.query.code, grant_type: "authorization_code" }
          : { client_id, client_secret: CLIENT_SECRET, refresh_token: req.query.refresh_token, grant_type: "refresh_token" };
      const r = await fetch("https://www.strava.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      res.setHeader("Content-Type", "application/json");
      return res.status(r.ok ? 200 : 400).send(JSON.stringify(data));
    }

    if (action === "activities") {
      const { access_token } = req.query;
      if (!access_token) throw new Error("access_token이 없습니다.");
      const r = await fetch("https://www.strava.com/api/v3/athlete/activities?per_page=30", {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      const data = await r.json();
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "private, max-age=60"); // 짧게만 캐시(활동은 자주 갱신될 수 있음)
      return res.status(r.ok ? 200 : 400).send(JSON.stringify(data));
    }

    res.status(400).json({ error: "알 수 없는 action입니다." });
  } catch (e) {
    res.status(500).json({ error: (e && e.message) || "서버 오류" });
  }
};
