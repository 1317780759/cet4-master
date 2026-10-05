/**
 * Service Worker —— 让这个站在手机上"装进桌面 + 没网也能背词"。
 *
 * ★ 缓存策略（刻意分层，不是一把梭）：
 *   - 导航请求（刷新 / 直接打开某页）→ **network-first，失败回落缓存页**。
 *     这同时修掉 GH Pages 的 SPA 硬伤：直接刷新 /learn 会 404，
 *     SW 用缓存的 index.html 兜底后由前端路由接管。
 *   - /assets/*（带内容哈希的构建产物）→ **cache-first**：文件名即版本，永不失效。
 *   - /data/*（词库分片 / 套卷）→ **stale-while-revalidate**：先给缓存（离线可背），
 *     后台刷新。词库是本站最大的资源（~2.4MB），只在用户真正用到时进缓存。
 *   - 其它 → 直连，不缓存。
 *
 * ★ 版本升级：改任何缓存策略/资源清单，必须把 CACHE_VERSION 里那个字符串 +1，
 *   旧缓存会在 activate 阶段被清掉。
 */

const CACHE_VERSION = 'cet4-v1';

const SHELL = ['./', './index.html', './manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      // 逐个加，个别失败不阻断安装（比如用户装的时候正好断网）
      await Promise.all(SHELL.map(async (url) => {
        try { await cache.add(new Request(url, { cache: 'reload' })); } catch { /* 忽略 */ }
      }));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE_VERSION).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // —— 导航：network-first，离线时回落缓存的壳页 ——
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(CACHE_VERSION);
          cache.put('./index.html', fresh.clone());
          return fresh;
        } catch {
          const cached = await caches.match('./index.html');
          return cached ?? Response.error();
        }
      })(),
    );
    return;
  }

  // —— 构建产物：文件名带哈希，cache-first ——
  if (url.pathname.includes('/assets/')) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        const fresh = await fetch(request);
        const cache = await caches.open(CACHE_VERSION);
        cache.put(request, fresh.clone());
        return fresh;
      })(),
    );
    return;
  }

  // —— 数据（词库 / 套卷）：先给缓存（离线可背），后台刷新 ——
  if (url.pathname.includes('/data/')) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        const network = fetch(request)
          .then(async (fresh) => {
            if (fresh.ok) {
              const cache = await caches.open(CACHE_VERSION);
              await cache.put(request, fresh.clone());
            }
            return fresh;
          })
          .catch(() => undefined);
        // 缓存命中就立刻返回，网络结果只用来更新缓存
        if (cached) {
          event.waitUntil(network);
          return cached;
        }
        const fresh = await network;
        return fresh ?? Response.error();
      })(),
    );
  }
});
