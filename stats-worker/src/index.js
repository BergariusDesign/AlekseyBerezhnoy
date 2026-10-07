/* ============================================================
   STATS WORKER вЂ” Cloudflare Worker + D1
   РЎС‡С‘С‚С‡РёРє РїСЂРѕСЃРјРѕС‚СЂРѕРІ РІРёРґРµРѕ РґР»СЏ РїРѕСЂС‚С„РѕР»РёРѕ.

   API:
     POST /api/view          вЂ” Р·Р°РїРёСЃР°С‚СЊ РїСЂРѕСЃРјРѕС‚СЂ (РїСѓР±Р»РёС‡РЅС‹Р№)
     POST /api/admin/login   вЂ” РІС…РѕРґ Р°РґРјРёРЅР° (СЃРµСЃСЃРёСЏ РІ cookie)
     POST /api/admin/logout  вЂ” РІС‹С…РѕРґ
     GET  /api/admin/stats   вЂ” СЃС‚Р°С‚РёСЃС‚РёРєР° (С‚РѕР»СЊРєРѕ Р°РІС‚РѕСЂРёР·РѕРІР°РЅ)
     GET  /api/health        вЂ” РїСЂРѕРІРµСЂРєР° Р¶РёРІРѕСЃС‚Рё
   ============================================================ */

// Р Р°Р·СЂРµС€С‘РЅРЅС‹Рµ origins (СЃС‚СЂРѕРіРѕ, Р±РµР· null Рё '*'):
// 1) РїСЂРѕРґ-РґРѕРјРµРЅ РїРѕСЂС‚С„РѕР»РёРѕ; 2) localhost:8000 вЂ” РІСЂРµРјРµРЅРЅРѕ, РґР»СЏ Р»РѕРєР°Р»СЊРЅРѕР№ РѕС‚Р»Р°РґРєРё
const ALLOWED_ORIGINS = [
    'https://bergariusdesign.github.io',
    'http://localhost:8000',
    'http://localhost:8765'
];

// VIDEO_IDS СЃРёРЅС…СЂРѕРЅРёР·РёСЂРѕРІР°РЅ СЃ projectsData РІ index.html
const VIDEO_IDS = ['magic', 'showreel', 'woman', 'watch'];

// === СЃРµСЃСЃРёРё ===
// РљРѕСЂРѕС‚РєРѕР¶РёРІСѓС‰РёРµ С‚РѕРєРµРЅС‹, С…СЂР°РЅСЏС‚СЃСЏ РІ РїР°РјСЏС‚Рё Worker (РєР°Р¶РґС‹Р№ isolate).
// Р”Р»СЏ РїРѕСЂС‚С„РѕР»РёРѕ РґРѕСЃС‚Р°С‚РѕС‡РЅРѕ: РїРµСЂРµР·Р°РїСѓСЃРє isolate РїСЂРѕСЃС‚Рѕ СЂР°Р·Р»РѕРіРёРЅРёС‚ Р°РґРјРёРЅР°.
const sessions = new Map(); // token -> expiry (ms)
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 С‡Р°СЃРѕРІ

// === rate limiting (РІ РїР°РјСЏС‚Рё isolate) ===
// key -> РјР°СЃСЃРёРІ С‚Р°Р№РјСЃС‚Р°РјРїРѕРІ
const rateBuckets = new Map();
const RATE_WINDOW_MS = 1000 * 60;         // РѕРєРЅРѕ 60 СЃРµРєСѓРЅРґ
const RATE_MAX_PER_WINDOW = 10;           // РјР°РєСЃРёРјСѓРј РїСЂРѕСЃРјРѕС‚СЂРѕРІ СЃ РѕРґРЅРѕРіРѕ РєР»СЋС‡Р°
const RATE_MAX_PER_VIDEO = 3;             // Рё РјР°РєСЃРёРјСѓРј РЅР° РѕРґРЅРѕ РІРёРґРµРѕ

function json(data, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            ...extraHeaders
        }
    });
}

function corsHeaders(origin) {
    const h = {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Vary': 'Origin'
    };
    if (ALLOWED_ORIGINS.includes(origin)) {
        h['Access-Control-Allow-Origin'] = origin;
        h['Access-Control-Allow-Credentials'] = 'true';
    }
    return h;
}

/* --- session utils --- */

function newSessionToken() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function createSession() {
    const token = newSessionToken();
    sessions.set(token, Date.now() + SESSION_TTL_MS);
    // С‡РёСЃС‚РєР° РїСЂРѕСЃСЂРѕС‡РµРЅРЅС‹С…, С‡С‚РѕР±С‹ Map РЅРµ СЂРѕСЃ Р±РµСЃРєРѕРЅРµС‡РЅРѕ
    if (sessions.size > 100) {
        const now = Date.now();
        for (const [k, exp] of sessions) {
            if (exp < now) sessions.delete(k);
        }
    }
    return token;
}

function getValidSession(request) {
    const cookie = request.headers.get('Cookie') || '';
    const m = cookie.match(/(?:^|;\s*)admin_session=([a-f0-9]{64})(?:;|$)/);
    if (!m) return null;
    const token = m[1];
    const exp = sessions.get(token);
    if (!exp || exp < Date.now()) {
        sessions.delete(token);
        return null;
    }
    return token;
}

function deleteSession(request) {
    const cookie = request.headers.get('Cookie') || '';
    const m = cookie.match(/(?:^|;\s*)admin_session=([a-f0-9]{64})(?:;|$)/);
    if (m) sessions.delete(m[1]);
}

/* --- rate limiting --- */

function rateLimit(key, videoId) {
    const now = Date.now();

    // РѕР±С‰РёР№ Р±Р°РєРµС‚ РїРѕ РєР»СЋС‡Сѓ
    let bucket = rateBuckets.get(key) || [];
    bucket = bucket.filter(ts => now - ts < RATE_WINDOW_MS);
    if (bucket.length >= RATE_MAX_PER_WINDOW) return false;
    bucket.push(now);
    rateBuckets.set(key, bucket);

    // Р±Р°РєРµС‚ РїРѕ РєР»СЋС‡Сѓ+РІРёРґРµРѕ
    const vk = key + '|' + videoId;
    let vb = rateBuckets.get(vk) || [];
    vb = vb.filter(ts => now - ts < RATE_WINDOW_MS);
    if (vb.length >= RATE_MAX_PER_VIDEO) return false;
    vb.push(now);
    rateBuckets.set(vk, vb);

    // РЅРµ РґР°С‘Рј Map СЂР°СЃС‚Рё Р±РµСЃРєРѕРЅРµС‡РЅРѕ
    if (rateBuckets.size > 5000) {
        for (const [k, arr] of rateBuckets) {
            if (!arr.some(ts => now - ts < RATE_WINDOW_MS)) rateBuckets.delete(k);
        }
    }
    return true;
}

/* --- spam fingerprint: РјРёРЅРёРјР°Р»СЊРЅС‹Р№ Рё РѕР±РµР·Р»РёС‡РµРЅРЅС‹Р№ ---
   РҐРµС€РёСЂСѓРµРј (IP / 24 РґР»СЏ IPv4, /64 РґР»СЏ IPv6 + User-Agent) вЂ” С…СЂР°РЅРёС‚СЃСЏ
   РўРћР›Р¬РљРћ РІ РїР°РјСЏС‚Рё isolate РґР»СЏ rate limit, РќР• РїРёС€РµС‚СЃСЏ РІ D1. */

async function fingerprint(request) {
    const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
    const ua = request.headers.get('User-Agent') || '';
    // IPv6 РѕР±СЂРµР·Р°РµРј РґРѕ /64, IPv4 РґРѕ /24 вЂ” Р·Р°РіСЂСѓР±Р»СЏРµРј РёРґРµРЅС‚РёС„РёРєР°С†РёСЋ
    let coarse = ip;
    if (ip.includes(':')) {
        const parts = ip.split(':').slice(0, 4).join(':');
        coarse = parts;
    } else {
        const oct = ip.split('.');
        if (oct.length === 4) coarse = oct[0] + '.' + oct[1] + '.' + oct[2];
    }
    const data = new TextEncoder().encode(coarse + '|' + ua.slice(0, 120));
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest).slice(0, 16), b => b.toString(16).padStart(2, '0')).join('');
}

/* --- admin stats --- */

async function getStats(db) {
    const rows = await db.prepare(`
        SELECT
            v.id   AS video_id,
            v.name AS video_name,
            COUNT(w.id) AS total,
            SUM(CASE WHEN w.viewed_at >= date('now', 'start of day', 'utc') THEN 1 ELSE 0 END) AS today,
            SUM(CASE WHEN w.viewed_at >= date('now', '-6 days', 'start of day', 'utc') THEN 1 ELSE 0 END) AS last7,
            SUM(CASE WHEN w.viewed_at >= date('now', 'start of month', 'utc') THEN 1 ELSE 0 END) AS month,
            MAX(w.viewed_at) AS last_view
        FROM videos v
        LEFT JOIN views w ON w.video_id = v.id
        GROUP BY v.id, v.name
        ORDER BY total DESC
    `).all();

    // РґРёРЅР°РјРёРєР° РїРѕ РґРЅСЏРј: РїРѕСЃР»РµРґРЅРёРµ 30 РґРЅРµР№ СЃСѓРјРјР°СЂРЅРѕ РїРѕ РІСЃРµРј РІРёРґРµРѕ
    const daily = await db.prepare(`
        SELECT date(viewed_at) AS day, COUNT(*) AS count
        FROM views
        WHERE viewed_at >= date('now', '-29 days', 'start of day', 'utc')
        GROUP BY date(viewed_at)
        ORDER BY day
    `).all();

    return {
        videos: rows.results.map(r => ({
            id: r.video_id,
            name: r.video_name,
            total: r.total || 0,
            today: r.today || 0,
            last7: r.last7 || 0,
            month: r.month || 0,
            lastView: r.last_view || null
        })),
        daily: daily.results.map(d => ({ day: d.day, count: d.count }))
    };
}

/* --- СЂРѕСѓС‚РёРЅРі --- */

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;
        const origin = request.headers.get('Origin') || '';
        const cors = corsHeaders(origin);

        // OPTIONS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: cors });
        }

        try {
            // ---- health ----
            if (path === '/api/health') {
                return json({ ok: true, time: new Date().toISOString() }, 200, cors);
            }

            // ---- POST /api/view ----
            if (path === '/api/view' && request.method === 'POST') {
                if (origin && origin !== undefined && origin !== '' && !ALLOWED_ORIGINS.includes(origin)) {
                    return json({ error: 'Origin not allowed' }, 403, cors);
                }

                let body;
                try {
                    body = await request.json();
                } catch {
                    return json({ error: 'Invalid JSON' }, 400, cors);
                }

                const videoId = String(body.videoId || '').toLowerCase();
                if (!VIDEO_IDS.includes(videoId)) {
                    return json({ error: 'Unknown videoId' }, 400, cors);
                }

                // rate limit
                const fp = await fingerprint(request);
                if (!rateLimit(fp, videoId)) {
                    return json({ ok: true, limited: true }, 200, cors);
                }

                await env.DB.prepare(
                    'INSERT INTO views (video_id) VALUES (?)'
                ).bind(videoId).run();

                return json({ ok: true }, 200, cors);
            }

            // ---- POST /api/admin/login ----
            if (path === '/api/admin/login' && request.method === 'POST') {
                // admin API вЂ” С‚РѕР»СЊРєРѕ СЃ РЅР°С€РµРіРѕ origin
                if (origin !== undefined && origin !== '' && !ALLOWED_ORIGINS.includes(origin)) {
                    return json({ error: 'Origin not allowed' }, 403, cors);
                }

                let body;
                try {
                    body = await request.json();
                } catch {
                    return json({ error: 'Invalid JSON' }, 400, cors);
                }

                const password = String(body.password || '');
                // СЃСЂР°РІРЅРµРЅРёРµ РЅР° СЃРµСЂРІРµСЂРµ; secret РЅРµРґРѕСЃС‚СѓРїРµРЅ РєР»РёРµРЅС‚Сѓ
                if (!env.ADMIN_PASSWORD || password !== env.ADMIN_PASSWORD) {
                    // Р·Р°РґРµСЂР¶РєР° РїСЂРѕС‚РёРІ Р±СЂСѓС‚С„РѕСЂСЃР°
                    await new Promise(r => setTimeout(r, 500));
                    return json({ error: 'ACCESS DENIED' }, 401, cors);
                }

                const token = createSession();
                const cookie =
                    'admin_session=' + token +
                    '; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=' +
                    (SESSION_TTL_MS / 1000);

                return json({ ok: true }, 200, {
                    ...cors,
                    'Set-Cookie': cookie
                });
            }

            // ---- POST /api/admin/logout ----
            if (path === '/api/admin/logout' && request.method === 'POST') {
                if (origin !== undefined && origin !== '' && !ALLOWED_ORIGINS.includes(origin)) {
                    return json({ error: 'Origin not allowed' }, 403, cors);
                }
                deleteSession(request);
                const cookie =
                    'admin_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0';
                return json({ ok: true }, 200, {
                    ...cors,
                    'Set-Cookie': cookie
                });
            }

            // ---- GET /api/admin/stats ----
            if (path === '/api/admin/stats' && request.method === 'GET') {
                if (origin && origin !== undefined && origin !== '' && !ALLOWED_ORIGINS.includes(origin)) {
                    return json({ error: 'Origin not allowed' }, 403, cors);
                }

                if (!getValidSession(request)) {
                    return json({ error: 'Unauthorized' }, 401, cors);
                }

                const stats = await getStats(env.DB);
                return json(stats, 200, cors);
            }

            return json({ error: 'Not found' }, 404, cors);

        } catch (err) {
            return json({ error: 'Internal error' }, 500, cors);
        }
    }
};
