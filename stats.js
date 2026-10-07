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

        // рендер в существующем виде (.stat-row / .stat-name / .stat-val)
        var html = '';
        res.data.videos.forEach(function (v) {
            var name = v.name || v.id;
            var val =
                v.total + ' views' +
                ' · ' + v.today + ' today' +
                ' · ' + v.last7 + ' / 7d' +
                ' · ' + v.month + ' month';
            html +=
                '<div class="stat-row">' +
                    '<span class="stat-name">' + name + '</span>' +
                    '<span class="stat-val">' + val + '</span>' +
                '</div>';
        });

        if (res.data.daily && res.data.daily.length) {
            var total = res.data.daily.reduce(function (s, d) { return s + d.count; }, 0);
            var last = res.data.daily[res.data.daily.length - 1];
            html +=
                '<div class="stat-row">' +
                    '<span class="stat-name">LAST 30 DAYS</span>' +
                    '<span class="stat-val">' + total + ' views</span>' +
                '</div>';
        }

        statsList.innerHTML = html || '<div style="color:#888">Пока нет данных.</div>';
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
