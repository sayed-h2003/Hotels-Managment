// ⚠️ مهم: زد رقم النسخة (v5, v6, ...) في كل مرة تُعدّل فيها أي ملف على GitHub
// هذا يُجبر كل متصفح على حذف الكاش القديم وجلب نسخة جديدة تلقائياً دون أي تدخل من المستخدم
const CACHE_NAME = 'hotel-managment-v4';
const assets = [
  './',
  './index.html',
  './manifest.json'
];

self.addEventListener('install', e => {
  self.skipWaiting(); // تفعيل النسخة الجديدة فوراً دون انتظار إغلاق كل التبويبات المفتوحة
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(assets))
  );
});

self.addEventListener('activate', e => {
  // حذف كل نسخ الكاش القديمة تلقائياً فور تفعيل النسخة الجديدة - هذا هو مفتاح حل المشكلة
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // استثناء تام لطلبات تطبيق الحجوزات الفعلي (Google Apps Script) - لا يُخزَّن مطلقاً
  if (e.request.url.indexOf('script.google.com') > -1) {
    e.respondWith(fetch(e.request));
    return;
  }
  // استراتيجية "الشبكة أولاً" لملفات الغلاف نفسها: نحاول الشبكة أولاً للحصول على أحدث نسخة،
  // ولا نلجأ للكاش إلا في حال انقطاع الاتصال بالإنترنت فقط (كنسخة احتياطية للعمل دون اتصال)
  e.respondWith(
    fetch(e.request)
      .then(networkResponse => {
        var clone = networkResponse.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        return networkResponse;
      })
      .catch(() => caches.match(e.request))
  );
});

// v4 — عند الضغط على إشعار: تركيز نافذة التطبيق المفتوحة أو فتح نافذة جديدة
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if ('focus' in c) return c.focus();
      }
      return clients.openWindow('./index.html');
    })
  );
});
