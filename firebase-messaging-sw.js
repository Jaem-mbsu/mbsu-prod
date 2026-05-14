// ════════════════════════════════════════
//  MBSU Prod — Unified Service Worker
//  PWA 캐싱 + FCM 푸시 수신
// ════════════════════════════════════════

// Firebase import — getToken() 동작에 필요
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

// messaging 인스턴스 생성 (getToken 연동용)
// onBackgroundMessage 등록 안 함 → 아래 push 이벤트에서 직접 처리
firebase.messaging();

// ── 백그라운드 푸시 수신 (raw push event) ─
// data-only 메시지이므로 Firebase SDK가 자동 표시 안 함
// 여기서 1번만 처리
self.addEventListener('push', event => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); } catch(e) { return; }

  const d = payload.data || {};
  const title   = d.title   || 'MBSU Prod';
  const body    = d.body    || '';
  const eventId = d.eventId || '';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clients => {
        const hasFocus = clients.some(c => c.visibilityState === 'visible');
        if (hasFocus) return; // 앱 열려있음 → onMessage 토스트가 처리
        return self.registration.showNotification(title, {
          body,
          icon:    './icon-192.png',
          badge:   './icon-192.png',
          tag:     eventId ? 'mbsu-' + eventId : 'mbsu-update',
          data:    d,
          vibrate: [200, 100, 200]
        });
      })
  );
});

// ── 알림 클릭 → 앱 열기 ──────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      if (clients.length) return clients[0].focus();
      return self.clients.openWindow('./');
    })
  );
});

// ── PWA 캐시 ─────────────────────────────
const CACHE = 'mbsu-v4';
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
