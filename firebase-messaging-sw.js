// ════════════════════════════════════════
//  MBSU Prod — Unified Service Worker
//  PWA 캐싱 + FCM 푸시 수신
// ════════════════════════════════════════

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            "AIzaSyCi6trZA-DI3z2hLvUgshTcYMaLWNxo4b4",
  authDomain:        "mbsu-prod.firebaseapp.com",
  projectId:         "mbsu-prod",
  storageBucket:     "mbsu-prod.firebasestorage.app",
  messagingSenderId: "899152711355",
  appId:             "1:899152711355:web:c94ff0b41f4b2810c1639e"
});

const messaging = firebase.messaging();

// ── 백그라운드 알림 처리 ──────────────────
// Worker가 webpush.notification으로 보내면
// Firebase SDK가 백그라운드에서 자동으로 OS 알림 1개 표시
// → onBackgroundMessage 등록 불필요 (등록하면 중복 발생)
//
// 포그라운드는 main app의 onMessage에서 토스트로 처리

// ── 알림 클릭 → 앱 열기 + 히스토리 저장 ──
self.addEventListener('notificationclick', event => {
  const notif = event.notification;
  const data = notif.data || {};
  // title/body는 notification 객체에서 가져옴 (data 필드에 없음)
  const payload = {
    title:   notif.title || data.title || 'MBSU Prod',
    body:    notif.body  || data.body  || '',
    eventId: data.eventId || '',
    type:    data.type   || ''
  };
  notif.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const target = clients.length ? clients[0] : null;
      if (target) {
        target.postMessage({ type: 'NOTIF_CLICKED', data: payload });
        return target.focus();
      }
      // 앱이 닫혀있을 때 → eventId를 URL 파라미터로 담아 열기
      const url = payload.eventId
        ? './?notif=' + encodeURIComponent(payload.eventId)
        : './';
      return self.clients.openWindow(url);
    })
  );
});

// ── PWA 캐시 ─────────────────────────────
const CACHE = 'mbsu-v4';

self.addEventListener('install', e => {
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('firestore') ||
      e.request.url.includes('googleapis') ||
      e.request.url.includes('gstatic') ||
      e.request.url.includes('firebase')) return;
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

// ── 앱→SW 예약 알림 ──────────────────────
const _timers = {};
self.addEventListener('message', e => {
  if (!e.data) return;
  if (e.data.type === 'SCHEDULE') {
    const { id, title, body, fireAt } = e.data;
    const delay = fireAt - Date.now();
    if (delay < 0) return;
    clearTimeout(_timers[id]);
    _timers[id] = setTimeout(() => {
      self.registration.showNotification(title, {
        body, icon: './icon-192.png', badge: './icon-192.png',
        tag: 'ev-' + id, vibrate: [200, 100, 200]
      });
    }, delay);
  }
  if (e.data.type === 'CANCEL') {
    clearTimeout(_timers[e.data.id]);
    delete _timers[e.data.id];
  }
});
