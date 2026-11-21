const base=new URL('./',self.location.href);
const prefix='yulan:'+base.pathname+':';
const cacheName=prefix+'7';
const urls=['./','index.html','style.css','app.js','wechat.js','read-excel-file.min.js','yulan-180.png','yulan-192.png','yulan-512.png','manifest.webmanifest'].map(p=>new URL(p,base).href);
self.addEventListener('install',event=>event.waitUntil(caches.open(cacheName).then(cache=>cache.addAll(urls))));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const n of await caches.keys())if(n.startsWith(prefix)&&n!==cacheName)await caches.delete(n);await self.clients.claim()})()));
self.addEventListener('fetch',event=>{const url=event.request.url;if(event.request.method==='GET'&&urls.includes(url))event.respondWith(caches.open(cacheName).then(async cache=>await cache.match(url)||fetch(event.request)))});



