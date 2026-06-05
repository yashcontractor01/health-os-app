/* Cache the app shell so it opens instantly and works offline.
   Never caches cross-origin API calls (Claude/Gemini/GitHub). */
const CACHE='healthos-v1';
const ASSETS=['./','./index.html','./app.js','./manifest.webmanifest','./icon.svg'];
self.addEventListener('install',e=>{ e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener('activate',e=>{ e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x))))); self.clients.claim(); });
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET') return;
  if(new URL(e.request.url).origin!==location.origin) return; // let API calls hit the network
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));
});
