const CACHE_NAME = 'hotel-managment-v2';
const assets = [
  './',
  './index.html',
  './manifest.json'
];

self.addEventListener('install', e => {
  self.skipWaiting(); // تفعيل النسخة الجديدة من الـ Service Worker فوراً دون انتظار إغلاق كل التبويبات
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(assets))
  );
});

self.addEventListener('activate', e => {
  // حذف نسخ الكاش القديمة تلقائياً عند تحديث الإصدار (يمنع تراكم كاش قديم لا داعي له)
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // لا نتدخل إطلاقاً في طلبات Google Apps Script (iframe المحتوى الفعلي) - فقط الغلاف المحلي يُخزَّن
  if (e.request.url.indexOf('script.google.com') > -1) return;
  e.respondWith(
    caches.match(e.request).then(response => response || fetch(e.request))
  );
});
