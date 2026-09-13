/* ===== Run2080 서비스 워커 =====
   전략: 네트워크 우선(최신 버전을 항상 먼저 시도), 실패하면 캐시로 대체.
   이 앱의 실제 데이터(운동 기록 등)는 전부 localStorage/IndexedDB에 있으므로,
   여기서는 "앱 화면 자체"만 오프라인에서도 열리게 하는 최소한의 캐싱만 담당한다.
   버전을 올릴 때 CACHE_NAME의 숫자를 바꾸면 이전 캐시는 자동으로 정리된다. */
const CACHE_NAME = "run2080-shell-v1";
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
  if (event.request.method !== "GET") return; // POST 등은 캐시 대상 아님
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => cached || caches.match("./index.html"))
      )
  );
});
