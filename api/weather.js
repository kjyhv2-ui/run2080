/* ===== 기상청 단기예보 공공데이터 프록시 =====
   data.go.kr에서 발급받은 서비스키(Decoding 키)는 Vercel 프로젝트 설정 > Environment
   Variables에 KMA_SERVICE_KEY로 등록해야 실제로 동작한다(값은 공공데이터포털 마이페이지에서 확인).
   동작 방식:
   - 위경도(lat, lon)를 받아 기상청 격자좌표(nx, ny)로 변환(Lambert Conformal Conic 투영)
   - 초단기실황(getUltraSrtNcst): 기온·습도·풍속·강수형태(현재 실황)
   - 초단기예보(getUltraSrtFcst): 하늘상태(SKY) — 실황 API엔 하늘상태가 없어서 보완용으로 함께 호출
   - 둘을 합쳐 기존 Open-Meteo(WMO 코드) 형식과 호환되는 간단한 JSON으로 반환
     (앱의 기존 WMO_MAP·weatherRunAdvice를 그대로 재사용하기 위함 — 일관성 유지) */
const SERVICE_KEY = process.env.KMA_SERVICE_KEY;

// 위경도 -> 기상청 격자좌표(nx, ny) : 여러 독립 출처(기상청 공식 문서 기반 커뮤니티 구현)로 교차검증한 상수
const RE = 6371.00877, GRID = 5.0, SLAT1 = 30.0, SLAT2 = 60.0, OLON = 126.0, OLAT = 38.0, XO = 43, YO = 136;
function latLonToGrid(lat, lon) {
  const DEGRAD = Math.PI / 180.0;
  const re = RE / GRID;
  const slat1 = SLAT1 * DEGRAD, slat2 = SLAT2 * DEGRAD;
  const olon = OLON * DEGRAD, olat = OLAT * DEGRAD;
  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = Math.pow(sf, sn) * Math.cos(slat1) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = re * sf / Math.pow(ro, sn);
  let ra = Math.tan(Math.PI * 0.25 + lat * DEGRAD * 0.5);
  ra = re * sf / Math.pow(ra, sn);
  let theta = lon * DEGRAD - olon;
  if (theta > Math.PI) theta -= 2.0 * Math.PI;
  if (theta < -Math.PI) theta += 2.0 * Math.PI;
  theta *= sn;
  const nx = Math.floor(ra * Math.sin(theta) + XO + 0.5);
  const ny = Math.floor(ro - ra * Math.cos(theta) + YO + 0.5);
  return { nx, ny };
}

// 발표시각 계산: 초단기실황은 매시 40분 발표(10분 후 제공), 초단기예보는 매시 30분 발표(15분 후 제공).
// 둘 다 보수적으로 "45분 이전이면 한 시간 전 정시" 규칙을 적용해 항상 이미 발표된 값만 조회한다.
function baseDateTime() {
  // KST(UTC+9) 시각을 "UTC 필드"에 담아 계산 — 서버 시간대(UTC든 KST든)와 무관하게 항상 같은 결과가 나오도록 getUTC* 계열만 사용
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  if (now.getUTCMinutes() < 45) now.setUTCHours(now.getUTCHours() - 1);
  const y = now.getUTCFullYear(), m = String(now.getUTCMonth() + 1).padStart(2, "0"), d = String(now.getUTCDate()).padStart(2, "0");
  const h = String(now.getUTCHours()).padStart(2, "0");
  return { base_date: `${y}${m}${d}`, base_time: `${h}00` };
}

function ptySkyToWmo(pty, sky) {
  // 기상청 PTY(강수형태)·SKY(하늘상태) 코드를 앱이 이미 쓰고 있는 WMO 코드로 변환(WMO_MAP·weatherRunAdvice 재사용 목적)
  if (pty === 1 || pty === 5) return 61; // 비/빗방울
  if (pty === 2 || pty === 6) return 68; // 비/눈 섞임 -> 가까운 값 없어 임의 매핑(눈비)
  if (pty === 3 || pty === 7) return 71; // 눈/눈날림
  if (pty === 4) return 80; // 소나기
  if (sky === 1) return 0; // 맑음
  if (sky === 3) return 2; // 구름많음
  if (sky === 4) return 3; // 흐림
  return 1; // 정보 없으면 대체로 맑음으로 보수적 표시
}

async function callKma(endpoint, params) {
  const url = `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/${endpoint}?` +
    new URLSearchParams({ serviceKey: SERVICE_KEY, dataType: "JSON", numOfRows: "60", pageNo: "1", ...params });
  const r = await fetch(url);
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch (e) { throw new Error("기상청 응답 파싱 실패: " + text.slice(0, 200)); }
  const header = j?.response?.header;
  if (!header || header.resultCode !== "00") throw new Error("기상청 API 오류: " + (header?.resultMsg || "알 수 없음"));
  return j.response.body.items.item;
}

module.exports = async (req, res) => {
  try {
    if (!SERVICE_KEY) throw new Error("서버에 KMA_SERVICE_KEY가 설정되지 않았습니다.");
    const lat = parseFloat(req.query.lat), lon = parseFloat(req.query.lon);
    if (!lat || !lon) throw new Error("lat, lon이 필요합니다.");
    const { nx, ny } = latLonToGrid(lat, lon);
    const { base_date, base_time } = baseDateTime();
    const common = { base_date, base_time, nx, ny };

    const [ncstItems, fcstItems] = await Promise.all([
      callKma("getUltraSrtNcst", common),
      callKma("getUltraSrtFcst", common).catch(() => []), // 하늘상태는 보완용이라 실패해도 전체를 막지 않음
    ]);

    const byCat = {}; ncstItems.forEach(it => { byCat[it.category] = it.obsrValue; });
    let sky = null;
    if (fcstItems.length) {
      const skyItem = fcstItems.find(it => it.category === "SKY");
      if (skyItem) sky = parseInt(skyItem.fcstValue);
    }
    const pty = byCat.PTY != null ? parseInt(byCat.PTY) : 0;
    const code = ptySkyToWmo(pty, sky);

    res.setHeader("Content-Type", "application/json");
    return res.status(200).json({
      temperature_2m: byCat.T1H != null ? parseFloat(byCat.T1H) : null,
      relative_humidity_2m: byCat.REH != null ? parseFloat(byCat.REH) : null,
      apparent_temperature: byCat.T1H != null ? parseFloat(byCat.T1H) : null, // 기상청 실황엔 체감온도가 없어 기온으로 대체(과대/과소 표시 방지를 위해 클라이언트에서 별도 보정 가능)
      wind_speed_10m: byCat.WSD != null ? parseFloat(byCat.WSD) * 3.6 : null, // m/s -> km/h (Open-Meteo와 단위 통일)
      weather_code: code,
      source: "kma",
    });
  } catch (e) {
    res.setHeader("Content-Type", "application/json");
    return res.status(400).json({ error: e.message });
  }
};
