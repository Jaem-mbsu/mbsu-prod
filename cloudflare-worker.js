// ════════════════════════════════════════
//  MBSU Prod — Cloudflare Worker
//  FCM 푸시 알림 서버 (완전 무료)
// ════════════════════════════════════════
// 환경변수 (Cloudflare Worker 설정에서 추가):
//   FIREBASE_SA  : Firebase 서비스 계정 JSON 전체 내용
//   PROJECT_ID   : mbsu-prod

export default {
  async fetch(request, env) {
    // ── 진단 엔드포인트 (GET /?debug) ──────
    if (request.method === 'GET') {
      return handleDebug(env);
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }
    try {
      const { title, body, type, eventId, targetToken } = await request.json();

      // 환경변수 확인
      if (!env.FIREBASE_SA) throw new Error('FIREBASE_SA not set');
      if (!env.PROJECT_ID) throw new Error('PROJECT_ID not set');

      // 1. 서비스 계정으로 액세스 토큰 발급
      const accessToken = await getAccessToken(env.FIREBASE_SA);

      // 2. 토큰 목록 (targetToken 지정 시 그것만, 없으면 Firestore 전체)
      const tokens = targetToken ? [targetToken] : await getFCMTokens(env.PROJECT_ID, accessToken);
      if (!tokens.length) return jsonResponse({ ok: true, sent: 0 });

      // 3. FCM 푸시 병렬 발송 (순차→병렬로 변경해 응답 시간 단축)
      const results = await Promise.all(
        tokens.map(token => sendFCM(accessToken, env.PROJECT_ID, token, title, body, type, eventId))
      );
      const sent = results.filter(r => r.ok).length;
      const dead = results
        .map((r, i) => r.dead ? tokens[i] : null)
        .filter(Boolean);

      // 4. 만료된 토큰 삭제 (백그라운드)
      if (dead.length) {
        Promise.all(dead.map(t => deleteToken(env.PROJECT_ID, t, accessToken).catch(() => {})));
      }

      return jsonResponse({ ok: true, sent });
    } catch (e) {
      console.error('Worker error:', e.message, e.stack);
      return jsonResponse({ ok: false, error: e.message }, 500);
    }
  }
};

// ── 진단 핸들러 ──────────────────────────
async function handleDebug(env) {
  const info = { project_id: env.PROJECT_ID || 'NOT SET' };
  try {
    if (!env.FIREBASE_SA) { info.sa = 'NOT SET'; }
    else {
      let sa;
      try {
        sa = JSON.parse(env.FIREBASE_SA);
        info.sa_type          = sa.type;
        info.sa_project_id    = sa.project_id;
        info.sa_client_email  = sa.client_email;
        info.sa_token_uri     = sa.token_uri;
        info.sa_pk_start      = sa.private_key?.slice(0, 60);
        info.sa_pk_len        = sa.private_key?.length;
      } catch(e) { info.sa = 'JSON parse error: ' + e.message; sa = null; }

      if (sa) {
        try {
          const key = await importPEM(sa.private_key);
          info.key_import = 'OK';
          const testSig = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, key, new TextEncoder().encode('test'));
          info.sign = 'OK, bytes=' + testSig.byteLength;

          // JWT 생성
          const TOKEN_URL = 'https://oauth2.googleapis.com/token';
          const now = Math.floor(Date.now() / 1000);
          const hdr = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
          const pld = b64u(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/datastore', aud: TOKEN_URL, iat: now, exp: now + 3600 }));
          const unsigned = `${hdr}.${pld}`;
          const sig = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, key, new TextEncoder().encode(unsigned));
          const jwt = `${unsigned}.${b64uBuf(sig)}`;
          info.jwt_len = jwt.length;

          // Google 토큰 요청
          const bodyStr = 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + jwt;
          const res = await fetch(TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': String(bodyStr.length) },
            body: bodyStr
          });
          const text = await res.text();
          info.oauth_status = res.status;
          info.oauth_body   = text.slice(0, 500);
          // 성공 시 토큰 앞 20자만
          try { const d = JSON.parse(text); if(d.access_token) info.token_preview = d.access_token.slice(0,20)+'...'; } catch(_){}
        } catch(e) { info.crypto_error = e.message; }
      }
    }
  } catch(e) { info.error = e.message; }
  return new Response(JSON.stringify(info, null, 2), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}

// ── 서비스 계정 → OAuth2 액세스 토큰 ─────
async function getAccessToken(saJson) {
  const sa = JSON.parse(saJson);
  // sa.token_uri 가 구식 엔드포인트(accounts.google.com)일 경우 JWT bearer 미지원
  // → 반드시 oauth2.googleapis.com 을 직접 지정
  const TOKEN_URL = 'https://oauth2.googleapis.com/token';
  const now = Math.floor(Date.now() / 1000);
  const header  = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64u(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/datastore',
    aud: TOKEN_URL,
    iat: now, exp: now + 3600
  }));
  const unsigned = `${header}.${payload}`;
  const key = await importPEM(sa.private_key);
  const sig = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, key,
    new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${b64uBuf(sig)}`;

  const bodyStr = 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + jwt;
  console.log('[Auth] email:', sa.client_email, 'sa.token_uri:', sa.token_uri);

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: bodyStr
  });
  const text = await res.text();
  console.log('[Auth] status:', res.status, 'body:', text.slice(0, 300));
  let data;
  try { data = JSON.parse(text); } catch(e) { throw new Error('Auth parse error: ' + text.slice(0,100)); }
  if (data.error) throw new Error('Auth error: ' + data.error + ' / ' + (data.error_description||''));
  return data.access_token;
}

// ── Firestore에서 토큰 목록 읽기 ─────────
async function getFCMTokens(projectId, token) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/fcm_tokens?pageSize=300`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return [];
  const data = await res.json();
  if (!data.documents) return [];
  return data.documents.map(d => d.name.split('/').pop()).filter(Boolean);
}

// ── FCM v1 API 푸시 발송 ─────────────────
async function sendFCM(token, projectId, fcmToken, title, body, type, eventId) {
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: fcmToken,
          // webpush.notification만 사용 — 브라우저가 백그라운드에서 자동 1번 표시
          // notification 필드(최상위) 없음 → onBackgroundMessage 호출 안 됨 → 중복 방지
          data: { type: type || '', eventId: eventId || '' },
          webpush: {
            notification: {
              title: title || 'MBSU Prod',
              body:  body  || '',
              icon:  'https://mbsu-prod.firebaseapp.com/icon-192.png',
              badge: 'https://mbsu-prod.firebaseapp.com/icon-192.png',
              tag:   eventId ? 'mbsu-' + eventId : 'mbsu-update'
            }
            // fcmOptions.link 제거 → SW의 notificationclick 핸들러가 직접 앱 열기 처리
          }
        }
      })
    }
  );
  if (res.status === 200) return { ok: true };
  const err = await res.json();
  const code = err?.error?.details?.[0]?.errorCode;
  if (code === 'UNREGISTERED' || code === 'INVALID_ARGUMENT') return { ok: false, dead: true };
  return { ok: false };
}

// ── 만료 토큰 삭제 ───────────────────────
async function deleteToken(projectId, fcmToken, token) {
  await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/fcm_tokens/${encodeURIComponent(fcmToken)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
  );
}

// ── Helpers ──────────────────────────────
function b64u(str) {
  return btoa(str).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}
function b64uBuf(buf) {
  const bytes = new Uint8Array(buf);
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}
async function importPEM(pem) {
  const b64 = pem.replace(/-----[^-]+-----/g,'').replace(/\s/g,'');
  const der = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}
