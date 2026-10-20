// sw.js —— 离线资源缓存（FR-20、NFR-01f、API-38~API-41）
// 策略：install 预缓存关键资源 → fetch 采用 cache-first + 后台更新（FLOW-01）
//      → activate 清理旧版本缓存 → message 回报缓存版本（API-41）
// 约束：单个资源失败不阻断安装（ERR-07 降级）；非 GET / 跨源请求直接放行。

const VERSION = 'v5';
const CACHE_NAME = `stardust-${VERSION}`;
const PRECACHE = [
  './',
  './index.html',
  './styles.css',
  './src/config.js',
  './src/score.js',
  './src/levels.js',
  './src/board.js',
  './src/storage.js',
  './src/audio.js',
  './src/log.js',
  './src/ui.js',
  './src/main.js',
];

/** API-38 install：预缓存（逐条容错） */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(PRECACHE.map(async (url) => {
      try {
        await cache.add(new Request(url, { cache: 'reload' }));
      } catch (e) {
        // 单个资源失败不阻断安装（离线时仍可用已缓存部分）
      }
    }));
    await self.skipWaiting();
  })());
});

/** API-40 activate：清理非当前版本缓存 */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('stardust-') && k !== CACHE_NAME).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

/** API-39 fetch：cache-first + 后台更新 */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req, { ignoreSearch: true });
    const network = fetch(req).then((res) => {
      if (res && res.ok && res.type === 'basic') cache.put(req, res.clone()).catch(() => {});
      return res;
    }).catch(() => null);

    if (cached) return cached;                       // 命中缓存：立即返回，后台更新
    const fresh = await network;
    if (fresh) return fresh;                         // 未命中：走网络
    const fallback = await cache.match('./index.html');   // 离线且未缓存：回退首页
    if (fallback) return fallback;
    return new Response('离线资源不可用，请保持联网后重试。', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  })());
});

/** API-41 message：回报缓存版本（供设置页显示） */
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'version') {
    event.source && event.source.postMessage({ version: VERSION, cache: CACHE_NAME });
  }
});
