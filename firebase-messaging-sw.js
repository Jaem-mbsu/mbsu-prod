// ════════════════════════════════════════
//  MBSU Prod — Firebase Messaging Service Worker
//  백그라운드 FCM 푸시 수신 처리
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

// 백그라운드 메시지 수신 → 알림 표시
messaging.onBackgroundMessage(payload => {
  const { title, body, icon } = payload.notification || {};
  const notifTitle = title || 'MBSU Prod';
  const notifOptions = {
    body:    body  || '',
    icon:    icon  || './icon-192.png',
    badge:        './icon-192.png',
    tag:          payload.data?.eventId || 'mbsu-update',
    data:         payload.data || {},
    vibrate:      [200, 100, 200],
    requireInteraction: false
  };
  return self.registration.showNotification(notifTitle, notifOptions);
});

// 알림 클릭 → 앱 포커스 또는 열기
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cls => {
      if (cls.length) return cls[0].focus();
      return self.clients.openWindow('./');
    })
  );
});
