/* ============================================================
   STATS — клиент статистики просмотров.
   Заменяет CounterAPI на собственный Cloudflare Worker + D1.

   Модуль ПЕРЕХВАТЫВАЕТ существующие глобальные функции
   (updateViewCount / loadAdminStats / checkAdminPassword / toggleAdmin),
   поэтому обфусцированный блок index.html остаётся нетронутым —
   при отключении stats.js старый код продолжит работать.

   КРИТИЧЕСКИ: STATS_API_BASE задать при деплое (см. stats-worker/README.md)
   ============================================================ */

(function () {
    'use strict';

    const STATS_API_BASE = 'https://aleksey-portfolio-stats.bergarius.workers.dev';

    const SITE_ORIGIN = 'https://bergariusdesign.github.io';

    // --- утилиты ---

    async function api(path, opts = {}) {
        try {
            const res = await fetch(STATS_API_BASE + path, {
                method: opts.method || 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    ...(opts.headers || {})
                },
                credentials: 'include', // admin_session cookie
                ...(opts.body ? { body: JSON.stringify(opts.body) } : {})
            });
            return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) };
        } catch (e) {
            return { ok: false, status: 0, data: null };
        }
    }

    /* ============================================================
       ПРОСМОТРЫ — критерий: 3 сек или 25% длительности, раз на сессию
       ============================================================ */

    // видео, уже засчитанные в этой сессии страницы
    const counted = new Set();

    function countView(videoId) {
        if (!videoId || counted.has(videoId)) return;
        counted.add(videoId);
        // fire-and-forget: статистика не должна ломать UX
        api('/api/view', { method: 'POST', body: { videoId } });
    }

    // критерий просмотра: порог по длительности
    function attachViewTracking(videoEl, videoId) {
        if (!videoEl || !videoId || videoEl.dataset.aiwTracked) return;
        videoEl.dataset.aiwTracked = '1';

        let thresholdSec = 3;

        const setupThreshold = () => {
            const dur = videoEl.duration;
            if (isFinite(dur) && dur > 0 && dur > 60) {
                // длинные (> 60 сек): 25% длительности, кламп 3..30 сек
                thresholdSec = Math.min(Math.max(dur * 0.25, 3), 30);
            } else {
                // короткие: фиксированные 3 секунды
                thresholdSec = 3;
            }
        };

        const check = () => {
            if (counted.has(videoId)) return;
            if (videoEl.currentTime >= thresholdSec && !videoEl.paused) {
                countView(videoId);
            }
        };

        videoEl.addEventListener('loadedmetadata', setupThreshold, { once: true });
        videoEl.addEventListener('timeupdate', check);
        // страховка для коротких зацикленных видео без timeupdate-задержек
        videoEl.addEventListener('play', () => {
            setTimeout(check, 3200);
        });
        setupThreshold();
    }

    /* ============================================================
       ПРЯМАЯ ПРИВЯЗКА ТРЕКИНГА К РЕАЛЬНЫМ <video> (src -> videoId).

       Обфусцированный main-скрипт вызывает updateViewCount через
       замыкание (локальную функцию, шлющую в мёртвый counterapi.dev),
       поэтому перехват window.updateViewCount не срабатывал и
       POST /api/view вообще не отправлялся. Теперь трекинг вешается
       напрямую на DOM: видео с известным src получает счётчик при
       первом play. Событие play не всплывает — слушаем document
       в capture-фазе: это ловит и ДИНАМИЧЕСКИ созданные видео
       Second World (M1..M4 создаются в video-network.js при init).
       Существующая логика порога (3с / 25% с клампом 3..30с) и
       дедупликация (Set counted, раз на page session) не меняются.
       ============================================================ */

    var SRC_VIDEO_MAP = {
        'qw.mp4':        'magic',     /* главная: карточка + проект magic */
        'showreel.mp4':  'showreel',  /* главная: блок Show Reel */
        'm1.mp4':        'M1',        /* Second World */
        'm2.mp4':        'M2',
        'm3.mp4':        'M3',
        'm4.mp4':        'M4',
        'promo.mp4':     'woman',     /* исторические ID — сохранены */
        'watch.mp4':     'watch'
    };

    function videoIdOfSrc(videoEl) {
        var src = videoEl.currentSrc || '';
        if (!src) {
            var s = videoEl.querySelector('source');
            if (s) src = s.getAttribute('src') || s.src || '';
        }
        if (!src) src = videoEl.getAttribute('src') || videoEl.src || '';
        src = String(src).toLowerCase();
        var file = src.split('/').pop().split('?')[0];
        return SRC_VIDEO_MAP[file] || null;
    }

    // делегированный capture-listener: play у любого video (в т.ч.
    // динамических) -> привязать трекинг, если src известен
    document.addEventListener('play', function (e) {
        var el = e.target;
        if (!el || el.tagName !== 'VIDEO') return;
        var id = videoIdOfSrc(el);
        if (id) attachViewTracking(el, id);
    }, true);

    // страховка: видео, которые уже играют до установки listener
    // (автозапуск карточек). DOMContentLoaded отрабатывает ПОСЛЕ
    // init ai-world/video-network (их слушатель зарегистрирован
    // раньше), поэтому vn-video M1..M4 уже существуют в DOM.
    function scanExistingVideos() {
        document.querySelectorAll('video').forEach(function (el) {
            var id = videoIdOfSrc(el);
            if (id) attachViewTracking(el, id);
        });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', scanExistingVideos);
    } else {
        scanExistingVideos();
    }

    /* ============================================================
       ПЕРЕХВАТ updateViewCount — старые вызовы из обфусцированного кода
       (openProject / showreel play) перенаправляются в новую систему
       с грамотным критерием просмотра.
       ============================================================ */

    const origUpdateViewCount = window.updateViewCount;

    window.updateViewCount = function (videoId) {
        // старый код звал сразу при запуске видео; теперь ждём 3сек/25%.
        // Находим целевой video и вешаем трекинг.
        if (typeof videoId !== 'string') {
            if (origUpdateViewCount) return origUpdateViewCount.apply(this, arguments);
            return;
        }

        // 1) проектная страница: #p-video
        var pVideo = document.getElementById('p-video');
        if (pVideo && pVideo.querySelector('source')) {
            var src = (pVideo.currentSrc || pVideo.querySelector('source').src || '').toLowerCase();
            var projectsData = window.projectsData;
            // сопоставляем videoId с реальным <video> на странице
            var pd = projectsData && projectsData[videoId];
            if (pd && pd.videoSrc && src.indexOf(String(pd.videoSrc).toLowerCase()) !== -1) {
                attachViewTracking(pVideo, videoId);
                return;
            }
            // если ID совпадает с открытым проектом — трекаем
            attachViewTracking(pVideo, videoId);
            return;
        }

        // 2) шоурил на главной
        var sr = document.querySelector('.showreel-video');
        if (sr) {
            attachViewTracking(sr, videoId);
            return;
        }

        // fallback: старое поведение
        if (origUpdateViewCount) return origUpdateViewCount.apply(this, arguments);
    };

    /* ============================================================
       ПЕРЕХВАТ admin-логики: серверная авторизация + серверные статы
       ============================================================ */

    const origCheckAdminPassword = window.checkAdminPassword;
    const origToggleAdmin = window.toggleAdmin;

    // вход: пароль уходит на Worker, секрет никогда не в клиенте
    window.checkAdminPassword = async function () {
        var input = document.getElementById('admin-pass');
        var password = input ? input.value : '';
        if (!password) return;

        var loginView = document.getElementById('admin-login-view');
        var statsView = document.getElementById('admin-stats-view');
        var statsList = document.getElementById('stats-list-container');

        if (statsList) {
            statsList.innerHTML = '<div style="text-align:center; color:#666;">Проверка...</div>';
        }

        var res = await api('/api/admin/login', { method: 'POST', body: { password } });

        if (res.ok && res.data && res.data.ok) {
            if (input) input.value = '';
            if (loginView) loginView.style.display = 'none';
            if (statsView) statsView.style.display = 'block';
            window.loadAdminStats();
        } else {
            alert((res.data && res.data.error) || 'ACCESS DENIED');
            if (statsList) {
                statsList.innerHTML = '<div style="text-align: center; color: #666;">Loading data...</div>';
            }
        }
    };

    // статистика: с сервера, только авторизованной сессией
    window.loadAdminStats = async function () {
        var statsList = document.getElementById('stats-list-container');
        if (!statsList) return;

        statsList.innerHTML = '<div style="text-align:center; color:#888;">Fetching data...</div>';

        var res = await api('/api/admin/stats');

        if (res.status === 401) {
            // сессия истекла/невалидна — показать логин заново
            var loginView = document.getElementById('admin-login-view');
            var statsView = document.getElementById('admin-stats-view');
            if (loginView) loginView.style.display = 'block';
            if (statsView) statsView.style.display = 'none';
            return;
        }

        if (!res.ok || !res.data || !res.data.videos) {
            statsList.innerHTML =
                '<div style="text-align:center; color:#888;">' +
                'Не удалось загрузить статистику. Проверь деплой Worker.</div>';
            return;
        }

        /* --- ADMIN DASHBOARD UI: компактная панель статистики ---
           Названия нормализуются на frontend (D1 не меняем):
           понятные имена видео + даты в формате DD.MM.YYYY. */
        var DISPLAY_NAMES = {
            'magic':    'The Only Wall is You',
            'showreel': 'Showreel',
            'woman':    'AI Woman',
            'watch':    'Watch',
            'm1':       'M1 — Little World',
            'm2':       'M2 — Little World',
            'm3':       'M3 — Little World',
            'm4':       'M4 — Little World'
        };

        function fmtDate(iso) {
            if (!iso) return '—';
            var d = new Date(iso + (iso.length === 10 ? 'T00:00:00Z' : ''));
            if (isNaN(d.getTime())) return iso;
            var p = function (n) { return (n < 10 ? '0' : '') + n; };
            return p(d.getUTCDate()) + '.' + p(d.getUTCMonth() + 1) + '.' + d.getUTCFullYear();
        }

        function sumCard(label, value) {
            return '<div class="stats-sum-card">' +
                '<div class="stats-sum-label">' + label + '</div>' +
                '<div class="stats-sum-value">' + value + '</div>' +
            '</div>';
        }

        var videos = res.data.videos || [];
        var totalViews = 0, lastActivity = '';
        videos.forEach(function (v) { totalViews += (v.total || 0); });

        // последняя активность: максимум по lastView всех видео + daily
        (res.data.daily || []).forEach(function (d) {
            if (d.day && d.day > lastActivity) lastActivity = d.day;
        });
        videos.forEach(function (v) {
            var lv = (v.lastView || '').slice(0, 10);
            if (lv && lv > lastActivity) lastActivity = lv;
        });

        // сортировка: по количеству просмотров (DESC)
        videos.sort(function (a, b) { return (b.total || 0) - (a.total || 0); });

        var css =
            '.stats-dashboard{font-family:inherit;}' +
            '.stats-summary{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 14px;}' +
            '.stats-sum-card{flex:1 1 90px;background:rgba(0,255,255,.04);' +
                'border:1px solid rgba(0,255,255,.14);border-radius:10px;padding:10px 12px;}' +
            '.stats-sum-label{font-size:10px;letter-spacing:1.5px;color:#8a8a8a;' +
                'text-transform:uppercase;margin-bottom:3px;}' +
            '.stats-sum-value{font-size:20px;font-weight:700;color:#00e5ff;font-family:var(--font-tech, monospace);}' +
            '.stats-table{display:flex;flex-direction:column;gap:6px;}' +
            '.stats-head{display:flex;align-items:baseline;gap:12px;padding:0 4px 4px;' +
                'border-bottom:1px solid rgba(255,255,255,.08);margin-bottom:2px;}' +
            '.stats-h-title{flex:1;font-size:10px;letter-spacing:1.5px;color:#8a8a8a;text-transform:uppercase;}' +
            '.stats-h-views,.stats-h-last{font-size:10px;letter-spacing:1.5px;color:#8a8a8a;text-transform:uppercase;}' +
            '.stats-h-views{width:64px;text-align:right;}' +
            '.stats-h-last{width:92px;text-align:right;}' +
            '.stats-v-row{display:flex;align-items:center;gap:12px;padding:8px 4px;' +
                'background:rgba(255,255,255,.02);border-radius:8px;}' +
            '.stats-v-name{flex:1;font-size:13px;color:#e8e8e8;overflow:hidden;' +
                'text-overflow:ellipsis;white-space:nowrap;}' +
            '.stats-v-views{width:64px;text-align:right;font-size:18px;font-weight:700;' +
                'color:#00e5ff;font-family:var(--font-tech, monospace);}' +
            '.stats-v-last{width:92px;text-align:right;font-size:11px;color:#8a8a8a;' +
                'font-family:var(--font-tech, monospace);}' +
            '@media (max-width:600px){.stats-sum-card{flex:1 1 100%;}' +
                '.stats-v-views{width:52px;}.stats-v-last{width:80px;}}';

        var html = '<style>' + css + '</style>' +
            '<div class="stats-dashboard">' +
                '<div class="stats-summary">' +
                    sumCard('Total views', totalViews) +
                    sumCard('Videos', videos.length) +
                    sumCard('Last activity', lastActivity ? fmtDate(lastActivity) : '—') +
                '</div>' +
                '<div class="stats-table">' +
                    '<div class="stats-head">' +
                        '<span class="stats-h-title">Video</span>' +
                        '<span class="stats-h-views">Views</span>' +
                        '<span class="stats-h-last">Last view</span>' +
                    '</div>';

        if (videos.length) {
            videos.forEach(function (v) {
                html +=
                    '<div class="stats-v-row">' +
                        '<span class="stats-v-name">' +
                            (DISPLAY_NAMES[v.id] || v.name || v.id) + '</span>' +
                        '<span class="stats-v-views">' + (v.total || 0) + '</span>' +
                        '<span class="stats-v-last">' + fmtDate((v.lastView || '').slice(0, 10)) + '</span>' +
                    '</div>';
            });
        } else {
            html += '<div style="color:#888;padding:10px 4px;">Пока нет данных.</div>';
        }

        html += '</div></div>';

        statsList.innerHTML = html;
    };

    // выход: удаляем серверную сессию и закрываем модалку как раньше
    if (origToggleAdmin) {
        window.toggleAdmin = function () {
            // если открыт stats-view — считаем закрытием сессии
            var statsView = document.getElementById('admin-stats-view');
            var modal = document.getElementById('admin-modal');
            var isOpen = modal && modal.classList.contains('active');

            if (isOpen && statsView && statsView.style.display !== 'none') {
                api('/api/admin/logout', { method: 'POST' });
                // при следующем открытии снова показать логин
                statsView.style.display = 'none';
                var loginView = document.getElementById('admin-login-view');
                if (loginView) loginView.style.display = 'block';
            }
            return origToggleAdmin.apply(this, arguments);
        };
    }

    /* Экспорт для отладки (консоль браузера):
       stats.countView('magic'), stats.api('/api/health') */
    window.stats = {
        countView: countView,
        api: api,
        attachViewTracking: attachViewTracking,
        counted: counted
    };
})();
