// ════════════════════════════════════════
//  MBSU Prod — Unified Service Worker
//  PWA 캐싱 + FCM 백그라운드 푸시 수신
//  (firebase-messaging-sw.js 이름 유지 필수)
// ════════════════════════════════════════

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// ── Firebase 초기화 ───────────────────────
firebase.initializeApp({
  apiKey:            "AIzaSyCi6trZA-DI3z2hLvUgshTcYMaLWNxo4b4",
  authDomain:        "mbsu-prod.firebaseapp.com",
  projectId:         "mbsu-prod",
  storageBucket:     "mbsu-prod.firebasestorage.app",
  messagingSenderId: "899152711355",
  appId:             "1:899152711355:web:c94ff0b41f4b2810c1639e"
});

const messaging = firebase.messaging();

// ── 백그라운드 알림 ────────────────────────
// webpush.notification 필드를 사용하므로
// 브라우저가 자동으로 1번만 표시 → onBackgroundMessage 불필요
// (등록하면 중복 발생하므로 제거)

// ── PWA 캐시 ─────────────────────────────
// ※ push 이벤트 리스너 없음 — Firebase SDK(onBackgroundMessage)가 처리
const CACHE = 'mbsu-v3';
const SHELL = ['./', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
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
  // Firebase / external APIs: 네트워크만 사용
  if (e.request.url.includes('firestore') ||
      e.request.url.includes('googleapis') ||
      e.request.url.includes('gstatic') ||
      e.request.url.includes('firebase')) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// ── 알림 클릭 → 앱 포커스 또는 열기 ─────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cls => {
      if (cls.length) return cls[0].focus();
      return self.clients.openWindow('./');
    })
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
