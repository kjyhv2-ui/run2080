/* ===== Run2080 서비스 워커 =====
   전략: 네트워크 우선(최신 버전을 항상 먼저 시도), 실패하면 캐시로 대체.
   이 앱의 실제 데이터(운동 기록 등)는 전부 localStorage/IndexedDB에 있으므로,
   여기서는 "앱 화면 자체"만 오프라인에서도 열리게 하는 최소한의 캐싱만 담당한다.
   버전을 올릴 때 CACHE_NAME의 숫자를 바꾸면 이전 캐시는 자동으로 정리된다.

   v2 변경점:
   - 우리 도메인의 정적 파일만 다룬다. /api/*(날씨·Strava·대회일정)와 외부 도메인(카카오맵 타일 등)은
     서비스 워커가 아예 손대지 않는다 → Strava 토큰이 든 URL·응답이 캐시에 저장되지 않고,
     오프라인일 때 API 호출에 index.html이 대신 돌아가 JSON 파싱이 깨지는 일도 없다.
   - 정상 응답(200)만 캐시한다 → 배포가 잠깐 깨져 404가 나도 그 404가 오프라인용 캐시를 덮어쓰지 않는다. */
const CACHE_NAME = "run2080-shell-v2";
const APP_SHELL = ["./", "./index.html", "./manifest.json"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // POST 등은 캐시 대상 아님
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 외부 도메인(지도 타일·SDK 등)은 브라우저 기본 동작에 맡김
  if (url.pathname.startsWith("/api/")) return; // 서버 함수 응답은 캐시하지 않음(토큰·실시간 데이터)
  event.respondWith(
    fetch(req)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() =>
        caches.match(req).then((cached) => {
          if (cached) return cached;
          // 페이지 이동(HTML 요청)일 때만 앱 화면으로 대체 — 이미지·JSON 요청에 HTML을 돌려주지 않음
          if (req.mode === "navigate") return caches.match("./index.html");
          return Response.error();
        })
      )
  );
});
