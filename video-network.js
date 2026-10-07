/* ============================================================
   VIDEO NETWORK вЂ” living wires РґР»СЏ РІС‚РѕСЂРѕРіРѕ СЃРѕСЃС‚РѕСЏРЅРёСЏ РјРёСЂР°.

   4 video nodes (M1..M4), СЃРѕРµРґРёРЅС‘РЅРЅС‹Рµ С‚РѕРЅРєРёРјРё SVG-РЅРёС‚СЏРјРё.
   - desktop: hover в†’ impulse РїРѕ РїСЂРѕРІРѕРґСѓ в†’ РїР»Р°РІРЅР°СЏ Р°РєС‚РёРІР°С†РёСЏ
   - mobile: С†РµРЅС‚СЂ-viewport в†’ Р°РєС‚РёРІРЅС‹Р№ СѓР·РµР», scroll-РёРјРїСѓР»СЊСЃС‹
   - РїСѓР»СЊСЃС‹ СЌРЅРµСЂРіРёРё: РјР°Р»РµРЅСЊРєРёРµ СЃРІРµС‚СЏС‰РёРµСЃСЏ С‚РѕС‡РєРё РІРґРѕР»СЊ РїСѓС‚РµР№
   - РІСЃС‘ С‡РµСЂРµР· rAF/IntersectionObserver/ResizeObserver, РґС‘С€РµРІРѕ

   Р­РєСЃРїРѕСЂС‚: window.VideoNetwork { init, start, stop, reset }
   ============================================================ */

(function () {
    'use strict';

    const $ = (sel, root) => (root || document).querySelector(sel);
    const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

    const prefersReducedMotion = () =>
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const isMobile = () => window.matchMedia('(max-width: 768px)').matches;

    const gsapOK = () => typeof window.gsap !== 'undefined';

    /* LIFECYCLE TRACE: включить true для отладки переходов W1 <-> W2 */
    const LIFECYCLE_LOG = false;
    const logWorld = (...a) => { if (LIFECYCLE_LOG) console.log('[WORLD]', ...a); };

    /* РїР°Р»РёС‚СЂР°: С…РѕР»РѕРґРЅС‹Р№ С†РёР°РЅ РёР· СЃСѓС‰РµСЃС‚РІСѓСЋС‰РµРіРѕ СЃР°Р№С‚Р°, Р±РµР· РЅРѕРІРѕРіРѕ С†РІРµС‚Р° */
    const WIRE_COLOR = '0, 190, 230';

    /* ============================================================
       РЎРћРЎРўРћРЇРќРР• РЎР•РўР
       ============================================================ */

    const VN = {
        root: null,
        field: null,
        svg: null,
        nodes: [],          // { el, video, wirePaths, state, hoverStrength, playbackFade }
        wires: [],          // { a, b, path, len }
        running: false,
        gen: 0,             // РїРѕРєРѕР»РµРЅРёРµ Р·Р°РїСѓСЃРєР°: СѓР±РёРІР°РµС‚ С‚Р°Р№РјРµСЂРЅС‹Рµ С†РµРїРѕС‡РєРё РїСЂРѕС€Р»РѕРіРѕ С†РёРєР»Р°
        rafId: 0,
        lastFrame: 0,
        activeIdx: -1,      // mobile: РёРЅРґРµРєСЃ СѓР·Р»Р° РІ С†РµРЅС‚СЂРµ viewport
        scrollDir: 0,
        lastScroll: 0,
        driftTimelines: [], // РјРёРєСЂРѕ-РґСЂРµР№С„ СѓР·Р»РѕРІ: СѓР±РёРІР°РµС‚СЃСЏ РїСЂРё stop()
        timers: []          // РІСЃРµ setTimeout СЃРµС‚Рё: С‡РёСЃС‚СЏС‚СЃСЏ РїСЂРё stop()
    };

    /* С‚Р°Р№РјРµСЂ С‚РµРєСѓС‰РµРіРѕ РїРѕРєРѕР»РµРЅРёСЏ: Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё СѓРјРёСЂР°РµС‚ РїРѕСЃР»Рµ stop() */
    function genTimeout(fn, delay) {
        const g = VN.gen;
        const t = setTimeout(() => {
            // С‚РёРє СЃСЂР°Р±РѕС‚Р°Р», РЅРѕ РјРёСЂ СѓР¶Рµ РїРµСЂРµР·Р°РїСѓС‰РµРЅ вЂ” С†РµРїРѕС‡РєР° РјРµСЂС‚РІР°
            if (g !== VN.gen) return;
            fn();
        }, delay);
        VN.timers.push(t);
        return t;
    }

    /* ============================================================
       РџРћРЎРўР РћР•РќРР• DOM: СѓР·Р»С‹ + SVG-РѕРІРµСЂР»РµР№
       ============================================================ */

    /* ============================================================
       DESKTOP LAYOUT CONFIG (ai-world-layout.js).
       Применяет сохранённую редактором композицию поверх CSS.
       x = смещение левого края объекта от ЦЕНТРА сцены.
       Пока VN_DESKTOP_LAYOUT === null, работает CSS-композиция.
       Mobile (<=768px) не затрагивается никогда.
       ============================================================ */

    function applyDesktopLayout() {
        if (typeof VN_DESKTOP_LAYOUT === 'undefined' || !VN_DESKTOP_LAYOUT) return;

        /* Инъекция CSS-правила, а НЕ inline-стилей: lifecycle GSAP
           (revealWorld done / resetInterface) очищает inline-transform
           у .vn-cell при входе/выходе W2 — inline-повороты стирались бы,
           а CSS-правило переживает очистку и остаётся источником истины.
           Правило добавляется в <head> ПОСЛЕ ai-world.css, поэтому
           перекрывает CSS-композицию по умолчанию. Mobile-guard внутри. */

        const css = ['@media (min-width: 769px) {'];
        if (VN_DESKTOP_LAYOUT.sceneHeight) {
            css.push('.vn-scene-spin { height: ' + VN_DESKTOP_LAYOUT.sceneHeight + 'px; }');
        }
        VN.nodes.forEach(n => {
            const cfg = VN_DESKTOP_LAYOUT['M' + (n.idx + 1)];
            if (!cfg) return;
            const cls = 'vn-pos-' + (n.idx + 1);
            css.push(
                '.' + cls + ' {' +
                'left: calc(50% + ' + cfg.x + 'px);' +
                'top: ' + cfg.y + 'px;' +
                'width: ' + cfg.width + 'px;' +
                'height: ' + cfg.height + 'px;' +
                'transform: rotate(' + cfg.rotation + 'deg);' +
                'z-index: ' + cfg.zIndex + ';' +
                '}'
            );
        });
        css.push('}');

        let styleEl = document.getElementById('vn-desktop-layout-style');
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'vn-desktop-layout-style';
            document.head.appendChild(styleEl);
        }
        styleEl.textContent = css.join('\n');
    }

    function build() {
        VN.field = $('.aiw-field', VN.root);
        if (!VN.field || typeof AIW_WORKS === 'undefined') return false;

        VN.field.classList.add('vn-field');

        const frag = document.createDocumentFragment();

        /* SVG-РѕРІРµСЂР»РµР№ РґР»СЏ РїСЂРѕРІРѕРґРѕРІ: absolute РІРЅСѓС‚СЂРё field */
        VN.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        VN.svg.setAttribute('class', 'vn-svg');
        VN.svg.setAttribute('aria-hidden', 'true');

        AIW_WORKS.forEach((w, i) => {
            const cell = document.createElement('div');
            cell.className = 'vn-cell vn-fmt-' + w.format + ' vn-pos-' + (i + 1);

            const node = document.createElement('div');
            node.className = 'vn-node';
            node.dataset.vnId = w.id;
            node.dataset.vnIndex = i;
            node.setAttribute('role', 'button');
            node.setAttribute('tabindex', '0');
            node.setAttribute('aria-label', w.name);

            /* РїРѕСЃС‚РµСЂ вЂ” СЃСЂР°Р·Сѓ, РІРёРґРµРѕ вЂ” metadata-preload, РёСЃС‚РѕС‡РЅРёРє data-Р°С‚СЂРёР±СѓС‚РѕРј (lazy) */
            node.innerHTML =
                '<video class="vn-video" muted loop playsinline preload="metadata"></video>' +
                '<div class="vn-glow"></div>';

            const video = $('video', node);
            video.dataset.vnSrc = w.video;
            // preload="metadata" РіСЂСѓР·РёС‚ С‚РѕР»СЊРєРѕ РїРµСЂРІС‹Р№ РєР°РґСЂ

            VN.nodes.push({
                el: node,
                video: video,
                poster: null,   // постер убран: живое видео всегда сверху
                idx: i,
                hoverStrength: 0,      // 0..1 вЂ” РѕР±С‰РёР№ СѓСЂРѕРІРµРЅСЊ Р°РєС‚РёРІР°С†РёРё
                targetStrength: 0,
                videoReady: false
            });

            cell.appendChild(node);
            frag.appendChild(cell);
        });

        /* СЦЕНА: слой-обёртка, который поворачивает камера (JS) */
        VN.field.innerHTML = '';
        VN.scene = document.createElement('div');
        VN.scene.className = 'vn-scene-spin';
        VN.scene.appendChild(frag);
        VN.field.appendChild(VN.scene);
        VN.field.appendChild(VN.svg);
        applyDesktopLayout();

        /* РїСЂРѕРІРѕРґР°: РїРѕР»РЅС‹Р№ РіСЂР°С„ РјРµР¶РґСѓ 4 СѓР·Р»Р°РјРё, РЅРѕ РІРёР·СѓР°Р»СЊРЅРѕ вЂ”
           С‚РѕР»СЊРєРѕ "СЃРѕСЃРµРґРЅРёРµ" СЂС‘Р±СЂР° + 2 РґРёР°РіРѕРЅР°Р»Рё, С‚РѕРЅРєРѕ */
        buildWires();

        return true;
    }

    function buildWires() {
        // СЂС‘Р±СЂР° СЃРµС‚Рё: M1-M2, M2-M3, M3-M4, M4-M1 (РєРѕР»СЊС†Рѕ) + M2-M4 (РґРёР°РіРѕРЅР°Р»СЊ)
        const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [1, 3]];
        VN.wires = [];
        edges.forEach(([a, b]) => {
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('class', 'vn-wire');
            path.setAttribute('stroke', 'rgba(' + WIRE_COLOR + ', 0.22)');
            path.setAttribute('fill', 'none');
            VN.svg.appendChild(path);
            VN.wires.push({ a, b, path, pulse: null });
        });
    }

    /* ============================================================
       Р“Р•РћРњР•РўР РРЇ: РїРµСЂРµСЃС‡С‘С‚ РїСЂРѕРІРѕРґРѕРІ РїРѕ СЂРµР°Р»СЊРЅС‹Рј DOM-РєРѕРѕСЂРґРёРЅР°С‚Р°Рј
       ============================================================ */

    function updateWireGeometry() {
        if (!VN.svg || !VN.nodes.length) return;

        const fr = VN.field.getBoundingClientRect();
        VN.svg.setAttribute('width', fr.width);
        VN.svg.setAttribute('height', fr.height);
        VN.svg.setAttribute('viewBox', '0 0 ' + fr.width + ' ' + fr.height);

        VN.nodes.forEach(n => {
            const r = n.el.getBoundingClientRect();
            n.cx = r.left - fr.left + r.width / 2;
            n.cy = r.top - fr.top + r.height / 2;
        });

        VN.wires.forEach(w => {
            const A = VN.nodes[w.a];
            const B = VN.nodes[w.b];
            // РјСЏРіРєР°СЏ РєСЂРёРІР°СЏ: РєРѕРЅС‚СЂРѕР»СЊРЅР°СЏ С‚РѕС‡РєР° СЃРѕ СЃРґРІРёРіРѕРј вЂ” В«РїСЂРѕРІРёСЃС€Р°СЏВ» РЅРёС‚СЊ
            const mx = (A.cx + B.cx) / 2;
            const my = (A.cy + B.cy) / 2;
            const dx = B.cx - A.cx;
            const dy = B.cy - A.cy;
            const len = Math.hypot(dx, dy) || 1;
            // РїРµСЂРїРµРЅРґРёРєСѓР»СЏСЂРЅС‹Р№ РїСЂРѕРіРёР± вЂ” РЅРµР±РѕР»СЊС€РѕР№, Р¶РёРІРѕР№
            const sag = Math.min(len * 0.12, 40) * (w.a + w.b) % 2 === 0 ? 1 : -1;
            const qx = mx + (-dy / len) * Math.min(len * 0.1, 30) * sag;
            const qy = my + (dx / len) * Math.min(len * 0.1, 30) * sag;

            w.path.setAttribute('d',
                'M ' + A.cx + ',' + A.cy + ' Q ' + qx + ',' + qy + ' ' + B.cx + ',' + B.cy);
            w.len = len;
        });
    }

    /* ============================================================
       ENERGY PULSES: С‚РѕС‡РєР°, РґРІРёР¶СѓС‰Р°СЏСЃСЏ РІРґРѕР»СЊ РїСѓС‚Рё
       ============================================================ */

    function spawnPulse(wire, fromIdx, opts = {}) {
        if (prefersReducedMotion()) return;

        const rev = (wire.a !== fromIdx);
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('class', 'vn-pulse');
        circle.setAttribute('r', String(opts.r || 1.8));
        circle.setAttribute('fill', 'rgba(' + WIRE_COLOR + ', 0.9)');
        VN.svg.appendChild(circle);

        const dur = opts.duration || (0.9 + Math.random() * 0.8);
        const d = wire.path.getAttribute('d');
        if (!d) { circle.remove(); return; }

        const update = (progress) => {
            // С‚РѕС‡РєР° РЅР° РєРІР°РґСЂР°С‚РёС‡РЅРѕР№ РєСЂРёРІРѕР№ Р‘РµР·СЊРµ
            let p = rev ? 1 - progress : progress;
            const m = d.match(/M ([\d.-]+),([\d.-]+) Q ([\d.-]+),([\d.-]+) ([\d.-]+),([\d.-]+)/);
            if (!m) return;
            const [x0, y0, qx, qy, x1, y1] = m.slice(1).map(Number);
            const u = 1 - p;
            const x = u * u * x0 + 2 * u * p * qx + p * p * x1;
            const y = u * u * y0 + 2 * u * p * qy + p * p * y1;
            circle.setAttribute('cx', x);
            circle.setAttribute('cy', y);
        };

        if (gsapOK()) {
            gsap.to({ p: 0 }, {
                p: 1,
                duration: dur,
                ease: 'power1.inOut',
                onUpdate: function () { update(this.targets()[0].p); },
                onComplete: () => {
                    gsap.to(circle, {
                        attr: { r: 0.2 },
                        opacity: 0,
                        duration: 0.3,
                        onComplete: () => circle.remove()
                    });
                    if (opts.onArrive) opts.onArrive();
                }
            });
        } else {
            // CSS-С„РѕР»Р±СЌРє: РїСЂРѕСЃС‚Рѕ РёСЃС‡РµР·Р°СЋС‰Р°СЏ С‚РѕС‡РєР° РІ СЃРµСЂРµРґРёРЅРµ
            update(0.5);
            setTimeout(() => circle.remove(), dur * 1000);
            if (opts.onArrive) setTimeout(opts.onArrive, dur * 500);
        }
    }

    /* Р°РІС‚РѕРЅРѕРјРЅС‹Рµ РёРјРїСѓР»СЊСЃС‹: СЂРµРґРєРёРµ, СЃС‚РѕС…Р°СЃС‚РёС‡РµСЃРєРёРµ, Р±РµР· РїР°С‚С‚РµСЂРЅР° */
    function scheduleAutonomousPulse() {
        if (!VN.running || prefersReducedMotion()) return;
        const delay = 3500 + Math.random() * 6000; // 3.5вЂ“9.5СЃ
        genTimeout(() => {
            if (!VN.running) return;
            const wire = VN.wires[(Math.random() * VN.wires.length) | 0];
            const from = Math.random() > 0.5 ? wire.a : wire.b;
            spawnPulse(wire, from);
            scheduleAutonomousPulse();
        }, delay);
    }

    /* ============================================================
       Р’РР”Р•Рћ: Р»РµРЅРёРІР°СЏ РїРѕРґРіРѕС‚РѕРІРєР° Рё playback СЃ fade
       ============================================================ */

    function ensureVideoSource(node) {
        if (node.videoReady) return;
        const s = document.createElement('source');
        s.src = node.video.dataset.vnSrc;
        s.type = 'video/mp4';
        node.video.appendChild(s);
        node.video.load();
        node.videoReady = true;
    }

    function fadeInVideo(node) {
        ensureVideoSource(node);
        // РІРёРґРµРѕ РёРіСЂР°РµС‚ РІСЃРµРіРґР° (РєР°Рє .card РІ РїРµСЂРІРѕРј РјРёСЂРµ);
        // FIX: снять inline opacity="0" из stop() — иначе при повторном входе
        // inline перекроет CSS-прозрачность (--vn-a) и видео будут невидимы
        node.video.style.opacity = "";
        // hover С‚РѕР»СЊРєРѕ РїРѕРІС‹С€Р°РµС‚ РїСЂРѕР·СЂР°С‡РЅРѕСЃС‚СЊ С‡РµСЂРµР· --vn-a (CSS)
        const p = node.video.play();
        if (p && p.catch) p.catch(() => {});
    }

    /* ============================================================
       PREVIEW LOOP: инлайн-видео играют фрагмент [start..end]
       по кругу (muted, playsinline). Loop проверяется в существующем
       rAF-цикле frame() — ни setInterval, ни отдельных listeners.
       Параметры — VN_PREVIEW_CONFIG (ai-world-data.js).
       ============================================================ */

    function previewConfigOf(node) {
        if (typeof VN_PREVIEW_CONFIG === 'undefined') return null;
        return VN_PREVIEW_CONFIG['M' + (node.idx + 1)] || null;
    }

    function startPreview(node) {
        const cfg = previewConfigOf(node);
        node.previewing = true;
        node.video.muted = true;
        node.video.playsInline = true;
        node.video.volume = 0.35;   /* подготовлено; в preview видео muted */
        if (cfg && isFinite(node.video.duration) && node.video.duration > 0) {
            node.video.currentTime = cfg.start;
        }
    }

    function tickPreview(node) {
        /* вызывается из frame() только когда VN.running;
           full mode (после клика) — previewing = false, loop не мешает.
           Двойной clamp: конец фрагмента -> возврат к start; случайный
           сброс времени ниже start (браузерный loop-атрибут ставит 0) ->
           тоже возврат к start. Петля строго start..end. */
        if (!node.previewing) return;
        const cfg = previewConfigOf(node);
        if (!cfg) return;
        const t = node.video.currentTime;
        if (node.video.readyState >= 2 && (t >= cfg.end || t < cfg.start - 0.3)) {
            node.video.currentTime = cfg.start;
        }
    }

    function stopPreview(node) {
        node.previewing = false;
    }

    function fadeOutVideo(node) {
        // Р Р•Р’РР—РРЇ: РІРёРґРµРѕ РЅРµ РѕСЃС‚Р°РЅР°РІР»РёРІР°РµРј вЂ” РїРѕР»СѓРїСЂРѕР·СЂР°С‡РЅРѕСЃС‚СЊ Рё
        // РїСЂРёРіР»СѓС€РµРЅРёРµ СѓРїСЂР°РІР»СЏСЋС‚СЃСЏ CSS-РїРµСЂРµРјРµРЅРЅРѕР№ --vn-a
        // (РѕСЃС‚Р°РЅРѕРІРєР° С‚РѕР»СЊРєРѕ РїСЂРё РІС‹С…РѕРґРµ РёР· РјРёСЂР° вЂ” stop())
    }

    /* ============================================================
       РђРљРўРР’РђР¦РРЇ: hoverStrength 0..1, С„РёР·РёРєР° СЃ decay
       ============================================================ */

    function setTarget(idx, v) {
        if (VN.nodes[idx]) VN.nodes[idx].targetStrength = v;
    }

    function applyNodeState(node, dt) {
        // РёРЅРµСЂС†РёСЏ: РїСЂРёР±Р»РёР¶РµРЅРёРµ Рє С†РµР»Рё СЃРѕ СЃРєРѕСЂРѕСЃС‚СЊСЋ
        const k = node.targetStrength > node.hoverStrength ? 3.2 : 1.4; // РїРѕРґСЉС‘Рј Р±С‹СЃС‚СЂРµРµ СЃРїР°РґР°
        node.hoverStrength += (node.targetStrength - node.hoverStrength) * Math.min(1, k * dt);

        const s = node.hoverStrength;

        // РІРёР·СѓР°Р»СЊРЅРѕРµ СЃРѕСЃС‚РѕСЏРЅРёРµ С‡РµСЂРµР· CSS-РїРµСЂРµРјРµРЅРЅС‹Рµ: transition РІ CSS
        node.el.style.setProperty('--vn-a', s.toFixed(3));

        // playback: РІРєР»СЋС‡Р°РµРј РѕРґРёРЅ СЂР°Р· РїСЂРё РїРµСЂРІРѕРј РїРѕРґСЉС‘РјРµ Р°РєС‚РёРІРЅРѕСЃС‚Рё
        // (Рё РЅР° СЃС‚Р°СЂС‚Рµ РјРёСЂР°); РѕСЃС‚Р°РЅРѕРІРєР° вЂ” С‚РѕР»СЊРєРѕ stop() РїСЂРё РІС‹С…РѕРґРµ
        if (s > 0.2 && node.video.paused) fadeInVideo(node);
    }

    /* РіР»Р°РІРЅС‹Р№ rAF-С†РёРєР»: Р»С‘РіРєРёР№, С‚РѕР»СЊРєРѕ РёРЅС‚РµСЂРїРѕР»СЏС†РёСЏ Р·РЅР°С‡РµРЅРёР№ */
    function frame(now) {
        if (!VN.running) return;
        const dt = Math.min((now - (VN.lastFrame || now)) / 1000, 0.05);
        VN.lastFrame = now;

        VN.nodes.forEach(n => { applyNodeState(n, dt); tickPreview(n); });

        VN.rafId = requestAnimationFrame(frame);
    }

    /* ============================================================
       DESKTOP: hover + cursor energy
       ============================================================ */

    function bindDesktop() {
        VN.nodes.forEach((node, idx) => {
            const el = node.el;

            el.addEventListener('mouseenter', () => {
                if (isMobile()) return;
                // РёРјРїСѓР»СЊСЃ РїРѕ РІСЃРµРј РїСЂРѕРІРѕРґР°Рј СЌС‚РѕРіРѕ СѓР·Р»Р° вЂ” СЌРЅРµСЂРіРёСЏ РїСЂРёС…РѕРґРёС‚ РёР·РІРЅРµ
                VN.wires.forEach(w => {
                    if (w.a === idx || w.b === idx) {
                        spawnPulse(w, w.a === idx ? w.b : w.a, {
                            onArrive: () => setTarget(idx, 1)
                        });
                    }
                });
                setTarget(idx, 1);
                // РјРіРЅРѕРІРµРЅРЅС‹Р№ РїРµСЂРІС‹Р№ С€Р°Рі РёРЅС‚РµСЂРїРѕР»СЏС†РёРё вЂ” РЅРµ Р¶РґС‘Рј rAF
                applyNodeState(VN.nodes[idx], 0.05);
                // Рё СЃСЂР°Р·Сѓ РіРѕС‚РѕРІРёРј РІРёРґРµРѕ (source) вЂ” rAF-С„СЂРёР· РЅРµ Р±Р»РѕРєРёСЂСѓРµС‚
                ensureVideoSource(VN.nodes[idx]);
                fadeInVideo(VN.nodes[idx]);
            });

            el.addEventListener('mouseleave', () => {
                if (isMobile()) return;
                setTarget(idx, 0); // decay С‡РµСЂРµР· РёРЅРµСЂС†РёСЋ applyNodeState
                applyNodeState(VN.nodes[idx], 0.05);
            });

            el.addEventListener('focus', () => setTarget(idx, 1));
            el.addEventListener('blur', () => setTarget(idx, 0));

            /* КЛИК = полноэкранный cinematic-просмотр (AIWViewer).
               Активен только во втором мире — как раньше у shells. */
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!VN.running) return;
                if (typeof AIWViewer === 'undefined') return;
                const w = AIW_WORKS[idx];
                if (!w || !w.video) return;
                /* PREVIEW -> FULL: клик прекращает preview-loop выбранного
                   видео. Полное воспроизведение (с 0:00, звук 0.35) ведёт
                   AIWViewer; инлайн-видео замирает на паузе, loop не
                   вмешивается (previewing = false). */
                stopPreview(node);
                node.video.pause();
                AIWViewer.open({
                    id: w.id,
                    name: w.name,
                    tag: w.tag || '',
                    video: w.video
                }, el);
            });

            // РґРѕСЃС‚СѓРїРЅРѕСЃС‚СЊ: Enter Р°РєС‚РёРІРёСЂСѓРµС‚ preview
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    ensureVideoSource(node);
                    fadeInVideo(node);
                }
            });
        });

        /* ============================================================
           KAMERA-PANORAMA (CONCEPT: CANVAS). The cursor position
           softly slides the giant canvas under the viewport:
            the edge zones of the picture open only through movement.
            Wheel — the vertical ride across the canvas.
            CANVAS STABILITY: vertical movement is INSTANT (no inertia)
            and driven ONLY by the wheel — the cursor no longer floats
            the canvas up/down. Scroll feels like a static page ride.
           ============================================================ */
        /* FLOW SCROLL MIGRATION: desktop virtual camera REMOVED.
           The scene is a normal document-flow block; the wheel is the
           native scroll of #aiw-root. No --pan-x/--pan-y, no wheel
           hijacking, no scroll-driven scene translate. */
    }

    function distToSegment(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1, dy = y2 - y1;
        const l2 = dx * dx + dy * dy;
        if (!l2) return Math.hypot(px - x1, py - y1);
        let t = ((px - x1) * dx + (py - y1) * dy) / l2;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
    }

    /* ============================================================
       MOBILE: С†РµРЅС‚СЂ-viewport РґРµС‚РµРєС†РёСЏ + scroll-РёРјРїСѓР»СЊСЃС‹
       ============================================================ */

    function bindMobile() {
        // РѕРїСЂРµРґРµР»РµРЅРёРµ Р°РєС‚РёРІРЅРѕРіРѕ СѓР·Р»Р°: Р±Р»РёР¶Р°Р№С€РёР№ Рє С†РµРЅС‚СЂСѓ viewport
        const detectCenter = () => {
            if (!isMobile() || !VN.running) return;
            const mid = window.innerHeight / 2;
            let best = -1, bestDist = Infinity;

            VN.nodes.forEach((n, i) => {
                const r = n.el.getBoundingClientRect();
                const c = r.top + r.height / 2;
                const d = Math.abs(c - mid);
                if (d < bestDist) { bestDist = d; best = i; }
            });

            if (best !== VN.activeIdx) {
                const prev = VN.activeIdx;
                VN.activeIdx = best;

                // РІСЃРµ СѓР·Р»С‹: С†РµР»СЊ РїРѕ Р±Р»РёР·РѕСЃС‚Рё Рє С†РµРЅС‚СЂСѓ
                VN.nodes.forEach((n, i) => {
                    const r = n.el.getBoundingClientRect();
                    const c = r.top + r.height / 2;
                    const dist = Math.abs(c - mid);
                    // РїР»Р°РІРЅР°СЏ С€РєР°Р»Р°: С†РµРЅС‚СЂ=1, РєСЂР°Р№=0
                    setTarget(i, Math.max(0, 1 - dist / (window.innerHeight * 0.9)));
                    // РјРіРЅРѕРІРµРЅРЅС‹Р№ С€Р°Рі РёРЅС‚РµСЂРїРѕР»СЏС†РёРё вЂ” Р°РєС‚РёРІР°С†РёСЏ РЅРµ Р¶РґС‘С‚ rAF
                    applyNodeState(n, 0.05);
                });

                // scroll-РёРјРїСѓР»СЊСЃ: СЌРЅРµСЂРіРёСЏ РёРґС‘С‚ РѕС‚ РїСЂРµРґС‹РґСѓС‰РµРіРѕ Р°РєС‚РёРІРЅРѕРіРѕ Рє РЅРѕРІРѕРјСѓ
                if (prev >= 0 && best >= 0 && prev !== best) {
                    const w = VN.wires.find(w =>
                        (w.a === prev && w.b === best) || (w.a === best && w.b === prev));
                    if (w) spawnPulse(w, prev, { duration: 0.8 });
                }
            }
        };

        // СЃРєСЂРѕР»Р»: РЅР°РїСЂР°РІР»РµРЅРёРµ РґРІРёРіР°РµС‚ РёРјРїСѓР»СЊСЃС‹ РїРѕ РІРµСЂС‚РёРєР°Р»СЊРЅРѕР№ РЅРёС‚Рё.
        // Р’РђР–РќРћ: РІРѕ РІС‚РѕСЂРѕРј РјРёСЂРµ СЃРєСЂРѕР»Р»РёС‚СЃСЏ #aiw-root (overflow-y: auto),
        // Р° РЅРµ window вЂ” СЃР»СѓС€Р°РµРј РѕР±Р° РєРѕРЅС‚РµР№РЅРµСЂР°
        VN.field.addEventListener('scroll', detectCenter, { passive: true });
        window.addEventListener('scroll', detectCenter, { passive: true });
        const rootEl = VN.root;
        if (rootEl) rootEl.addEventListener('scroll', detectCenter, { passive: true });
        VN._detectCenter = detectCenter;

        /* ============================================================
           SCROLL = KAMERA (mobile): the scene travels through the world.
           Planes at different translateZ move at different speeds —
           a real parallax, no blur. The scroll progress of the world
           (0..1) shifts the scene along Y with depth-dependent scale.
           ============================================================ */
        const parallaxOnScroll = () => {
            if (!isMobile() || !VN.running || !VN.scene || prefersReducedMotion()) return;
            const root = VN.root;
            if (!root) return;
            const max = root.scrollHeight - root.clientHeight;
            if (max <= 0) return;
            const progress = Math.min(1, Math.max(0, root.scrollTop / max));
            // LAYOUT STABILITY FIX: the scene must never translate DOWN
            // from its base position. The old range (+12% .. -8% of the
            // viewport height) jumped to ~+10vh right on the FIRST swipe
            // (progress is still ~0), pushing the whole video scroll down
            // and opening a big gap between the first video and the Back
            // button. New range: 0 .. -12% — the drift feel is preserved,
            // base geometry (progress = 0 -> shift = 0) stays stable.
            const shift = -progress * 0.12 * root.clientHeight;
            VN.scene.style.transform = 'translateY(' + shift.toFixed(1) + 'px)';
        };
        VN.field.addEventListener('scroll', parallaxOnScroll, { passive: true });
        window.addEventListener('scroll', parallaxOnScroll, { passive: true });
        if (rootEl) rootEl.addEventListener('scroll', parallaxOnScroll, { passive: true });
        VN._parallaxReset = () => {
            if (VN.scene) VN.scene.style.transform = '';
        };
    }

    /* ============================================================
       BACKGROUND LIFE: РїРµСЂРёРѕРґРёС‡РµСЃРєРёРµ РєРѕСЂРѕС‚РєРёРµ playback-Р±С‘СЂСЃС‚С‹
       (РєРѕРіРґР° РЅРµС‚ hover) вЂ” В«РѕР±СЉРµРєС‚С‹ Р¶РёРІСѓС‚ СЃРІРѕРµР№ Р¶РёР·РЅСЊСЋВ»
       ============================================================ */

    function scheduleLifeBurst() {
        if (!VN.running || prefersReducedMotion() || isMobile()) return;
        const delay = 4000 + Math.random() * 5000;
        genTimeout(() => {
            if (!VN.running) return;
            // СѓР·РµР» Р±РµР· С‚РµРєСѓС‰РµР№ Р°РєС‚РёРІР°С†РёРё РїРѕР»СѓС‡Р°РµС‚ РєРѕСЂРѕС‚РєРёР№ Р±С‘СЂСЃС‚
            const idle = VN.nodes.filter(n => n.targetStrength < 0.1);
            if (idle.length) {
                const node = idle[(Math.random() * idle.length) | 0];
                setTarget(node.idx, 0.55);
                genTimeout(() => {
                    if (node.targetStrength < 0.9) setTarget(node.idx, 0); // РЅРµ РѕС‚Р±РёСЂР°РµРј hover
                }, 2600);
            }
            scheduleLifeBurst();
        }, delay);
    }

    /* ============================================================
       RESIZE / OBSERVERS
       ============================================================ */

    /* ============================================================
       РњРРљР Рћ-Р”Р Р•Р™Р¤: Р¶РёРІРѕРµ РїСЂРѕСЃС‚СЂР°РЅСЃС‚РІРѕ, РµРґРІР° Р·Р°РјРµС‚РЅРѕРµ.
       В±2вЂ“3px, В±0.1вЂ“0.2deg, scale 0.997вЂ“1.005, С„Р°Р·С‹ Сѓ РєР°Р¶РґРѕРіРѕ СѓР·Р»Р° СЃРІРѕРё.
       РўР°Р№РјР»Р°Р№РЅС‹ СЂРµРіРёСЃС‚СЂРёСЂСѓСЋС‚СЃСЏ Рё СѓР±РёРІР°СЋС‚СЃСЏ РІ stop() вЂ” РЅР°РєРѕРїР»РµРЅРёСЏ РЅРµС‚.
       ============================================================ */

    function startDrift() {
        if (!gsapOK() || prefersReducedMotion()) return;

        VN.nodes.forEach((node, i) => {
            // Р°РјРїР»РёС‚СѓРґС‹ вЂ” РІРµСЂС… РґРѕРїСѓСЃС‚РёРјРѕРіРѕ, РЅРѕ РЅРµ Р±РѕР»СЊС€Рµ
            const amp = 2 + (i % 2);                  // 2вЂ“3px
            const rot = (i % 2 ? 1 : -1) * 0.18;      // В±0.18deg
            const scl = 1 + (i % 3 === 0 ? 0.005 : 0.003);

            const tl = gsap.timeline({ repeat: -1, yoyo: true });
            tl.to(node.el, {
                y: amp,
                x: (i % 3 - 1) * amp * 0.7,
                rotation: rot,
                scale: scl,
                duration: 8 + i * 2,               // СЂР°Р·РЅС‹Рµ РїРµСЂРёРѕРґС‹ вЂ” РЅРµС‚ РїР°С‚С‚РµСЂРЅР°
                ease: 'sine.inOut'
            }, 0);
            // РІСЃС‚СЂРµС‡РЅРѕРµ РґРІРёР¶РµРЅРёРµ РІС‚РѕСЂС‹Рј С‚РІРёРЅРѕРј вЂ” РѕСЂРіР°РЅРёС‡РЅР°СЏ РїРµС‚Р»СЏ
            tl.to(node.el, {
                x: '-=' + (amp * 0.5),
                duration: 5 + i,
                ease: 'sine.inOut'
            }, 2 + i);

            VN.driftTimelines.push(tl);
        });
    }

    function bindObservers() {
        if ('ResizeObserver' in window) {
            const ro = new ResizeObserver(() => updateWireGeometry());
            ro.observe(VN.field);
            VN._ro = ro;
        } else {
            window.addEventListener('resize', updateWireGeometry, { passive: true });
        }
        window.addEventListener('orientationchange', () => {
            setTimeout(updateWireGeometry, 300);
        }, { passive: true });
        updateWireGeometry();
    }

    /* ============================================================
       РџРЈР‘Р›РР§РќР«Р™ API
       ============================================================ */

    window.VideoNetwork = {
        init(root) {
            VN.root = root || $('#aiw-root');
            if (!VN.root) return false;
            if (!build()) return false;
            bindDesktop();
            bindMobile();
            return true;
        },

        start() {
            if (!VN.nodes.length) return;
            // РЅРѕРІРѕРµ РїРѕРєРѕР»РµРЅРёРµ: СЃС‚Р°СЂС‹Рµ С‚Р°Р№РјРµСЂРЅС‹Рµ С†РµРїРѕС‡РєРё СѓРјСЂСѓС‚ РїСЂРё РїРµСЂРІРѕРј С‚РёРєРµ
            VN.gen++;
            VN.running = true;
            logWorld('W2 start | gen:', VN.gen, '| nodes:', VN.nodes.length,
                '| videos paused:', VN.nodes.map(n => n.video.paused).join(','));
            updateWireGeometry();
            VN.lastFrame = 0;
            if (!prefersReducedMotion()) VN.rafId = requestAnimationFrame(frame);
            // Р Р•Р’РР—РРЇ: РІРёРґРµРѕ РёРіСЂР°СЋС‚ РІСЃРµРіРґР° (РєР°Рє .card РїРµСЂРІРѕРіРѕ РјРёСЂР°) вЂ”
            // Р·Р°РїСѓСЃРєР°РµРј РІСЃРµ muted-loop СЃСЂР°Р·Сѓ РїРѕСЃР»Рµ reveal
            VN.nodes.forEach(n => fadeInVideo(n));
            // PREVIEW MODE: каждое видео — зацикленный фрагмент [start..end],
            // старт с cfg.start; сбрасывается кликом (viewer) и stop()
            VN.nodes.forEach(n => startPreview(n));
            if (VN._detectCenter) VN._detectCenter();
            // root-СЃРєСЂРѕР»Р» РІ РјРёСЂРµ: С†РµРЅС‚СЂ-РґРµС‚РµРєС†РёСЏ РїСЂРё РєР°Р¶РґРѕРј РєР°РґСЂРµ РЅРµ РЅСѓР¶РЅР° вЂ”
            // scroll-СЃРѕР±С‹С‚РёСЏ СѓР¶Рµ СЃР»СѓС€Р°СЋС‚СЃСЏ, РЅРѕ СЃРґРµР»Р°РµРј РєРѕРЅС‚СЂРѕР»СЊРЅС‹Р№ РІС‹Р·РѕРІ С‡СѓС‚СЊ РїРѕР·Р¶Рµ
            // (РїРѕСЃР»Рµ reveal-Р°РЅРёРјР°С†РёРё СѓР·Р»С‹ Р·Р°Р№РјСѓС‚ С„РёРЅР°Р»СЊРЅС‹Рµ РїРѕР·РёС†РёРё)
            genTimeout(() => { if (VN.running && VN._detectCenter) VN._detectCenter(); }, 1200);
        },

        stop() {
            VN.running = false;
            logWorld('W2 stop | gen:', VN.gen, '| nodes:', VN.nodes.length);
            VN.gen++;                 // СѓР±РёС‚СЊ РІСЃРµ С‚Р°Р№РјРµСЂРЅС‹Рµ С†РµРїРѕС‡РєРё СЌС‚РѕРіРѕ РїРѕРєРѕР»РµРЅРёСЏ
            cancelAnimationFrame(VN.rafId);
            // камера: обнулить поворот сцены
            if (VN.scene) {
                VN.scene.style.setProperty('--cam-x', '0');
                VN.scene.style.setProperty('--cam-y', '0');
            }
            VN.activeIdx = -1; // re-enter РїРµСЂРµСЃС‡РёС‚Р°РµС‚ С†РµРЅС‚СЂ Р·Р°РЅРѕРІРѕ
            // С‡РёСЃС‚РёРј Р·Р°СЂРµРіРёСЃС‚СЂРёСЂРѕРІР°РЅРЅС‹Рµ С‚Р°Р№РјРµСЂС‹
            VN.timers.forEach(t => clearTimeout(t));
            VN.timers.length = 0;
            // РјРёРєСЂРѕ-РґСЂРµР№С„: СѓР±РёС‚СЊ С‚Р°Р№РјР»Р°Р№РЅС‹, СЃРЅСЏС‚СЊ inline-С‚СЂР°РЅСЃС„РѕСЂРјС‹ СѓР·Р»РѕРІ
            VN.driftTimelines.forEach(tl => {
                if (gsapOK()) {
                    // timeline РЅРµ РёРјРµРµС‚ targets(); С‡РёСЃС‚РёРј С‚Р°СЂРіРµС‚С‹ РґРѕС‡РµСЂРЅРёС… С‚РІРёРЅРѕРІ
                    const targets = [];
                    (tl.getChildren ? tl.getChildren(false, true, true) : []).forEach(ch => {
                        if (ch.targets) targets.push(...ch.targets());
                    });
                    tl.kill();
                    if (targets.length) {
                        gsap.set(targets, { clearProps: 'transform' });
                    }
                }
            });
            VN.driftTimelines.length = 0;
            if (VN._parallaxReset) VN._parallaxReset();
            // РїРѕРіР°СЃРёС‚СЊ РІСЃС‘: РІРёРґРµРѕ РЅР° РїР°СѓР·Сѓ, СѓР·Р»С‹ РІ idle
            VN.nodes.forEach(n => {
                stopPreview(n);   // PREVIEW: погасить флаг — loop не вмешивается
                n.targetStrength = 0;
                n.hoverStrength = 0;
                n.el.style.setProperty('--vn-a', '0');
                clearTimeout(n._pauseT);
                n.video.pause();
                // РЕВИЗИЯ: видео НЕ прячем мгновенно — иначе они исчезают
                // отдельно от плавно гаснущих подложек при выходе.
                // Гаснут вместе с vn-cell (opacity наследуется в анимации absorbWorld).
                // постер убран — ничего восстанавливать
            });
            // РѕС‡РёСЃС‚РёС‚СЊ РёРјРїСѓР»СЊСЃС‹
            $$('.vn-pulse', VN.svg).forEach(p => p.remove());
        },

        /* РЅРµ РёСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ, РѕСЃС‚Р°РІР»РµРЅ РґР»СЏ API-СЃРѕРІРјРµСЃС‚РёРјРѕСЃС‚Рё */
        reset() {
            this.stop();
            updateWireGeometry();
        },

        /* --- debug-РіРµС‚С‚РµСЂС‹ РґР»СЏ РёРЅС‚РµРіСЂР°С†РёРѕРЅРЅРѕРіРѕ С‚РµСЃС‚Р° (read-only) --- */
        _debugDriftCount() { return VN.driftTimelines.length; },
        _debugTimersCount() { return VN.timers.length; },
        _debugRunning() { return VN.running; }
    };
})();
