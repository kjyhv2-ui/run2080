// api/weather.js
// Run2080 - 기상청 단기예보 API 프록시 (Vercel Serverless Function)
//
// [사전 준비]
// 1. Vercel 프로젝트 > Settings > Environment Variables 에서
//    이름: KMA_SERVICE_KEY
//    값:  공공데이터포털에서 발급받은 "일반 인증키(Decoding)"
//    를 등록하세요. (채팅이나 코드에 직접 붙여넣지 마세요)
//
// 2. 활용신청 상세 페이지에 나오는 "요청주소(End Point)"를 확인해서
//    아래 VILAGE_ENDPOINT / NCST_ENDPOINT 값이 실제와 다르면 맞게 바꿔주세요.
//    (기관 정책에 따라 주소가 VilageFcstInfoService 또는
//     VilageFcstInfoService_2.0 등으로 표기될 수 있습니다)

const VILAGE_ENDPOINT = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst';
const NCST_ENDPOINT = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst';

// ---- 위경도 → 기상청 격자좌표(nx, ny) 변환 (기상청 공식 변환식) ----
const RE = 6371.00877, GRID = 5.0;
const SLAT1 = 30.0, SLAT2 = 60.0, OLON = 126.0, OLAT = 38.0, XO = 43, YO = 136;

function toGrid(lat, lon) {
  const DEGRAD = Math.PI / 180.0;
  const re = RE / GRID;
  const slat1 = SLAT1 * DEGRAD, slat2 = SLAT2 * DEGRAD;
  const olon = OLON * DEGRAD, olat = OLAT * DEGRAD;

  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = (re * sf) / Math.pow(ro, sn);

  const ra0 = Math.tan(Math.PI * 0.25 + lat * DEGRAD * 0.5);
  const ra = (re * sf) / Math.pow(ra0, sn);
  let theta = lon * DEGRAD - olon;
  if (theta > Math.PI) theta -= 2.0 * Math.PI;
  if (theta < -Math.PI) theta += 2.0 * Math.PI;
  theta *= sn;

  const nx = Math.floor(ra * Math.sin(theta) + XO + 0.5);
  const ny = Math.floor(ro - ra * Math.cos(theta) + YO + 0.5);
  return { nx, ny };
}

// ---- 최근 발표시각 계산 ----
function kstNow() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

function latestVilageBaseTime() {
  const times = [2, 5, 8, 11, 14, 17, 20, 23];
  const kst = kstNow();
  const h = kst.getUTCHours();
  const m = kst.getUTCMinutes();
  const usable = times.filter(t => t < h || (t === h && m >= 10)); // 발표 후 10분 반영 버퍼
  let d = new Date(kst);
  let baseHour;
  if (usable.length === 0) {
    d.setUTCDate(d.getUTCDate() - 1);
    baseHour = 23;
  } else {
    baseHour = usable[usable.length - 1];
  }
  return {
    base_date: `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`,
    base_time: `${String(baseHour).padStart(2, '0')}00`,
  };
}

function latestNcstBaseTime() {
  const kst = kstNow();
  let h = kst.getUTCHours();
  let d = new Date(kst);
  if (kst.getUTCMinutes() < 40) { // 매시 40분경 반영
    h -= 1;
    if (h < 0) { h = 23; d.setUTCDate(d.getUTCDate() - 1); }
  }
  return {
    base_date: `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`,
    base_time: `${String(h).padStart(2, '0')}00`,
  };
}

export default async function handler(req, res) {
  const { lat, lon, type = 'vilage' } = req.query;

  if (!lat || !lon) {
    return res.status(400).json({ error: 'lat, lon 쿼리 파라미터가 필요합니다.' });
  }

  const serviceKey = process.env.KMA_SERVICE_KEY;
  if (!serviceKey) {
    return res.status(500).json({ error: '서버에 KMA_SERVICE_KEY 환경변수가 설정되어 있지 않습니다.' });
  }

  const { nx, ny } = toGrid(parseFloat(lat), parseFloat(lon));
  const isNcst = type === 'ncst';
  const endpoint = isNcst ? NCST_ENDPOINT : VILAGE_ENDPOINT;
  const timeParams = isNcst ? latestNcstBaseTime() : latestVilageBaseTime();

  const url = new URL(endpoint);
  url.searchParams.set('serviceKey', serviceKey);
  url.searchParams.set('dataType', 'JSON');
  url.searchParams.set('numOfRows', '1000');
  url.searchParams.set('pageNo', '1');
  url.searchParams.set('nx', nx);
  url.searchParams.set('ny', ny);
  Object.entries(timeParams).forEach(([k, v]) => url.searchParams.set(k, v));

  try {
    const r = await fetch(url.toString());
    const raw = await r.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      // 기상청 API가 인증 오류 등을 XML로 내려주는 경우 대비
      return res.status(502).json({ error: '기상청 응답을 파싱할 수 없습니다.', raw });
    }

    const header = data?.response?.header;
    if (header && header.resultCode !== '00') {
      return res.status(502).json({ error: `기상청 API 오류: ${header.resultMsg}`, code: header.resultCode });
    }

    const items = data?.response?.body?.items?.item || [];
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=300');
    return res.status(200).json({ nx, ny, baseDate: timeParams.base_date, baseTime: timeParams.base_time, items });
  } catch (e) {
    return res.status(502).json({ error: '기상청 API 호출 실패', detail: String(e) });
  }
}
