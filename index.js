// ════════════════════════════════════════
//  MBSU Prod — Cloud Functions
//  Firestore events 변경 시 → FCM 전체 발송
// ════════════════════════════════════════
const functions  = require('firebase-functions');
const admin      = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

// ── 공통: 모든 FCM 토큰에 푸시 발송 ────────
async function sendPushToAll(title, body, data = {}) {
  const snap = await db.collection('fcm_tokens').get();
  if (snap.empty) return;

  const tokens = snap.docs.map(d => d.id).filter(Boolean);
  if (!tokens.length) return;

  // FCM v1 멀티캐스트 (100개씩 청크)
  const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
  const chunks = chunk(tokens, 100);

  const msg = {
    notification: { title, body },
    data,
    webpush: {
      notification: {
        title,
        body,
        icon: 'https://mbsu-prod.github.io/mbsu-prod/icon-192.png',
        badge: 'https://mbsu-prod.github.io/mbsu-prod/icon-192.png',
        vibrate: [200, 100, 200]
      },
      fcmOptions: { link: 'https://mbsu-prod.github.io/mbsu-prod/' }
    }
  };

  const results = await Promise.allSettled(
    chunks.map(batch =>
      admin.messaging().sendEachForMulticast({ tokens: batch, ...msg })
        .then(res => {
          // 실패한(만료된) 토큰 삭제
          res.responses.forEach((r, i) => {
            if (!r.success) {
              const code = r.error?.code;
              if (code === 'messaging/invalid-registration-token' ||
                  code === 'messaging/registration-token-not-registered') {
                db.collection('fcm_tokens').doc(batch[i]).delete().catch(() => {});
              }
            }
          });
        })
    )
  );
  console.log('[FCM] 발송 완료', tokens.length, '명');
}

// ── events 문서 생성 ─────────────────────
exports.onEventCreate = functions
  .region('asia-northeast3')
  .firestore.document('events/{docId}')
  .onCreate(async (snap) => {
    const ev = snap.data();
    const name = ev.name || '새 일정';
    const date = ev.date ? ` (${ev.date})` : '';
    const who  = Array.isArray(ev.person) ? ev.person.join(', ') : (ev.person || '');
    await sendPushToAll(
      '📅 새 일정 추가됨',
      `${name}${date}${who ? ' · ' + who : ''}`,
      { type: 'event_create', eventId: snap.id }
    );
  });

// ── events 문서 수정 ─────────────────────
exports.onEventUpdate = functions
  .region('asia-northeast3')
  .firestore.document('events/{docId}')
  .onUpdate(async (change) => {
    const ev = change.after.data();
    const name = ev.name || '일정';
    const date = ev.date ? ` (${ev.date})` : '';
    const who  = Array.isArray(ev.person) ? ev.person.join(', ') : (ev.person || '');
    await sendPushToAll(
      '✏️ 일정 수정됨',
      `${name}${date}${who ? ' · ' + who : ''}`,
      { type: 'event_update', eventId: change.after.id }
    );
  });

// ── events 문서 삭제 ─────────────────────
exports.onEventDelete = functions
  .region('asia-northeast3')
  .firestore.document('events/{docId}')
  .onDelete(async (snap) => {
    const ev = snap.data();
    const name = ev.name || '일정';
    await sendPushToAll(
      '🗑 일정 삭제됨',
      name,
      { type: 'event_delete', eventId: snap.id }
    );
  });
