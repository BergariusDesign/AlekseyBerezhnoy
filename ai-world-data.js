/* ============================================================
   AI WORLD — данные узлов Video Network.
   M1..M4 — реальные видео второго состояния мира.
   format: 'landscape' | 'portrait' — определяет композицию.
   poster — обложка на время до активации (lazy).
   ============================================================ */

const AIW_WORKS = [
    {
        id: 'm1',
        name: 'Signal I',
        video: 'M1.mp4',
        format: 'landscape',
        poster: 'images/preview.jpg'
    },
    {
        id: 'm2',
        name: 'Signal II',
        video: 'M2.mp4',
        format: 'portrait',
        poster: 'images/woman1.jpg'
    },
    {
        id: 'm3',
        name: 'Signal III',
        video: 'M3.mp4',
        format: 'landscape',
        poster: 'images/Watch1.png'
    },
    {
        id: 'm4',
        name: 'Signal IV',
        video: 'M4.mp4',
        format: 'landscape',
        poster: 'images/miro.png'
    }
];

/* ============================================================
   SECOND WORLD — PREVIEW FRAGMENTS (seconds).
   Инлайн-видео M1..M4 играют только этот фрагмент по кругу
   (беззвучный preview). Клик открывает полное воспроизведение
   с 0:00 со звуком 0.35 (AIWViewer).
   Timestamps задаёт владелец проекта — менять только здесь.
   ============================================================ */

const VN_PREVIEW_CONFIG = {
    M1: { start: 78, end: 114 },   /* 1:15 */
    M2: { start: 29, end: 56 },   /* 0:27 */
    M3: { start: 7,  end: 38 },   /* 0:07 */
    M4: { start: 65, end: 73 }    /* 1:05 */
};
