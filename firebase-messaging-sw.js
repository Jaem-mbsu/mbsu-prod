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
// webpush.notification → Firebase SDK가 OS 알림 자동 1회 표시
// onBackgroundMessage → showNotification 호출 없이 IndexedDB에만 저장
// (showNotification 호출하면 중복 발생 → 절대 호출 금지)
messaging.onBackgroundMessage(payload => {
  const n = payload.notification || {};
  const d = payload.data || {};
  _saveNotifToIDB({
    title:   n.title  || d.title   || 'MBSU Prod',
    body:    n.body   || d.body    || '',
    eventId: d.eventId || '',
    time:    Date.now()
  });
  // showNotification 호출 없음 — webpush.notification이 이미 표시함
});

function _saveNotifToIDB(notif){
  const req = indexedDB.open('mbsu-notifs', 1);
  req.onupgradeneeded = e => {
    e.target.result.createObjectStore('pending', { autoIncrement: true });
  };
  req.onsuccess = e => {
    const idb = e.target.result;
    idb.transaction('pending','readwrite').objectStore('pending').add(notif);
  };
}

// 포그라운드는 main app의 onMessage에서 토스트로 처리

// ── 알림 클릭 → 앱 열기 + 히스토리 저장 ──
// Firebase SDK의 fcmOptions.link 핸들러와 충돌하지 않도록
// cloudflare-worker.js에서 fcmOptions.link 제거 필수
self.addEventListener('notificationclick', event => {
  const notif = event.notification;
  const data = notif.data || {};
  const payload = {
    title:   notif.title || data.title || 'MBSU Prod',
    body:    notif.body  || data.body  || '',
    eventId: data.eventId || '',
    type:    data.type   || ''
  };
  notif.close();

  const scope = self.registration.scope; // e.g. https://mbsu-prod.firebaseapp.com/
  const targetUrl = payload.eventId
    ? scope + '?notif=' + encodeURIComponent(payload.eventId)
    : scope;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => {
      // 이미 열려있는 앱 창 찾기
      for (const c of clients) {
        if (c.url.startsWith(scope)) {
          c.postMessage({ type: 'NOTIF_CLICKED', data: payload });
          try { await c.focus(); } catch(e) {}
          return;
        }
      }
      // 열려있는 창 없으면 새로 열기
      return self.clients.openWindow(targetUrl);
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
