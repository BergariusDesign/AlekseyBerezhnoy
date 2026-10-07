-- ============================================================
-- STATS WORKER — D1 schema
-- ============================================================

-- Справочник видео (ID синхронизированы с projectsData в index.html)
CREATE TABLE IF NOT EXISTS videos (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- События просмотров: одна строка = один просмотр
CREATE TABLE IF NOT EXISTS views (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id  TEXT NOT NULL REFERENCES videos(id),
    viewed_at TEXT NOT NULL DEFAULT (datetime('now', 'utc'))
);

CREATE INDEX IF NOT EXISTS idx_views_video_id   ON views(video_id);
CREATE INDEX IF NOT EXISTS idx_views_viewed_at  ON views(viewed_at);

-- Первичное наполнение (обновляемо через INSERT OR IGNORE)
INSERT OR IGNORE INTO videos (id, name) VALUES
    ('magic',    'The Only Wall is You'),
    ('showreel', 'Commercial Motion (Mobile)'),
    ('woman',    'Commercial Motion (AI & VFX)'),
    ('watch',    'Luxury Watch'),
    ('m1',       'M1 (Little World)'),
    ('m2',       'M2 (Little World)'),
    ('m3',       'M3 (Little World)'),
    ('m4',       'M4 (Little World)');
