// Nouveau server.js minimal sans recherche artiste+titre
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const DISCOGS_API_URL = 'https://api.discogs.com';
const USER_AGENT = 'MusicListApp/1.0';
const DISCOGS_TOKEN = process.env.DISCOGS_TOKEN || null;
const DB_PATH = process.env.DB_PATH || './music_collection.db';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || null; // Si défini, protège les endpoints /api/admin

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static('public'));

// Middleware d'authentification admin (basé sur header x-admin-token ou query ?admin_token=)
function adminAuth(req, res, next) {
    if (!ADMIN_TOKEN) return next(); // Pas d'ADMIN_TOKEN => endpoints publics (dev / self-host simple)
    const token = req.headers['x-admin-token'] || req.query.admin_token;
    if (token !== ADMIN_TOKEN) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

// Applique l'auth à tous les endpoints /api/admin/*
app.use('/api/admin', adminAuth);

if (!DISCOGS_TOKEN) {
    console.warn('[Discogs] Aucun DISCOGS_TOKEN défini. Ajoutez-le dans .env pour des limites plus larges.');
}

app.get('/api/status', (req, res) => {
    res.json({ discogsToken: !!DISCOGS_TOKEN, uptime: process.uptime(), timestamp: new Date().toISOString() });
});

const db = new sqlite3.Database(DB_PATH);
db.run('PRAGMA foreign_keys = ON');
db.run('PRAGMA journal_mode = WAL');
console.log(`[DB] SQLite initialisée sur ${DB_PATH}`);

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS albums (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        release_id INTEGER UNIQUE,
        artist_name TEXT NOT NULL,
        album_title TEXT NOT NULL,
        release_year INTEGER,
        genre TEXT,
        style TEXT,
        label TEXT,
        cover_image_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS lists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS list_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        list_id INTEGER NOT NULL,
        album_id INTEGER NOT NULL,
        position INTEGER NOT NULL,
        UNIQUE(list_id, album_id),
        UNIQUE(list_id, position),
        FOREIGN KEY(list_id) REFERENCES lists(id) ON DELETE CASCADE,
        FOREIGN KEY(album_id) REFERENCES albums(id) ON DELETE CASCADE
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS list_tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        list_id INTEGER NOT NULL,
        tag TEXT NOT NULL,
        UNIQUE(list_id, tag),
        FOREIGN KEY(list_id) REFERENCES lists(id) ON DELETE CASCADE
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS operation_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        entity_type TEXT,
        entity_id INTEGER,
        info TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

function logOperation(action, entityType, entityId, infoObj) {
    let info = null;
    if (infoObj) {
        try { info = JSON.stringify(infoObj).slice(0, 5000); } catch { info = null; }
    }
    db.run('INSERT INTO operation_logs (action, entity_type, entity_id, info) VALUES (?,?,?,?)', [action, entityType || null, entityId || null, info]);
}

function mapReleaseData(release) {
    const artistName = (release.artists && release.artists.length) ? release.artists.map(a => a.name).join(', ') : 'Inconnu';
    const albumTitle = release.title || 'Sans titre';
    const year = release.year || null;
    const genres = release.genres ? release.genres.join(', ') : null;
    const styles = release.styles ? release.styles.join(', ') : null;
    const label = (release.labels && release.labels.length) ? release.labels.map(l => l.name).join(', ') : null;
    let cover = null;
    if (release.images && release.images.length) {
        const primary = release.images.find(i => i.type === 'primary') || release.images[0];
        cover = primary ? primary.uri : null;
    }
    return { artist_name: artistName, album_title: albumTitle, release_year: year, genre: genres, style: styles, label, cover_image_url: cover };
}

async function fetchDiscogsRelease(releaseId) {
    const headers = { 'User-Agent': USER_AGENT };
    if (DISCOGS_TOKEN) headers['Authorization'] = `Discogs token=${DISCOGS_TOKEN}`;
    const r = await axios.get(`${DISCOGS_API_URL}/releases/${releaseId}`, { headers });
    return r.data;
}

function ensureAlbumByRelease(releaseId) {
    return new Promise((resolve, reject) => {
        db.get('SELECT id FROM albums WHERE release_id = ?', [releaseId], async (err, row) => {
            if (err) return reject(err);
            if (row) return resolve(row.id);
            try {
                const data = await fetchDiscogsRelease(releaseId);
                const mapped = mapReleaseData(data);
                db.run(`INSERT INTO albums (release_id, artist_name, album_title, release_year, genre, style, label, cover_image_url, updated_at)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                    [releaseId, mapped.artist_name, mapped.album_title, mapped.release_year, mapped.genre, mapped.style, mapped.label, mapped.cover_image_url],
                    function (insErr) { return insErr ? reject(insErr) : resolve(this.lastID); }
                );
            } catch (e) { reject(e); }
        });
    });
}

app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.get('/api/albums', (req, res) => {
    const sql = `SELECT a.*, (SELECT COUNT(*) FROM list_items li WHERE li.album_id = a.id) AS list_usage_count FROM albums a ORDER BY a.created_at DESC`;
    db.all(sql, (err, rows) => err ? res.status(500).json({ error: err.message }) : res.json(rows));
});

app.get('/api/albums/search', (req, res) => {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json([]);
    const like = `%${q.replace(/%/g, '')}%`;
    const sql = `SELECT id, release_id, artist_name, album_title, release_year, cover_image_url FROM albums WHERE artist_name LIKE ? OR album_title LIKE ? ORDER BY artist_name ASC, album_title ASC LIMIT 25`;
    db.all(sql, [like, like], (err, rows) => err ? res.status(500).json({ error: err.message }) : res.json(rows));
});

app.post('/api/albums', async (req, res) => {
    const { releaseId } = req.body || {};
    if (!releaseId) return res.status(400).json({ error: 'releaseId requis' });
    try {
        const data = await fetchDiscogsRelease(releaseId);
        const mapped = mapReleaseData(data);
        db.run(`INSERT INTO albums (release_id, artist_name, album_title, release_year, genre, style, label, cover_image_url, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            [releaseId, mapped.artist_name, mapped.album_title, mapped.release_year, mapped.genre, mapped.style, mapped.label, mapped.cover_image_url],
            function (errIns) {
                if (errIns) {
                    if (errIns.message.includes('UNIQUE')) return res.status(409).json({ error: 'Album déjà présent' });
                    return res.status(500).json({ error: errIns.message });
                }
                logOperation('album.add', 'album', this.lastID, { release_id: releaseId });
                res.json({ message: 'Album ajouté', albumId: this.lastID, albumData: { release_id: releaseId, ...mapped } });
            }
        );
    } catch (e) {
        if (e.response && e.response.status === 404) return res.status(404).json({ error: 'Release non trouvée' });
        res.status(500).json({ error: 'Erreur Discogs' });
    }
});

app.delete('/api/albums/:id', (req, res) => {
    const { id } = req.params;
    db.get('SELECT COUNT(*) as cnt FROM list_items WHERE album_id = ?', [id], (cErr, row) => {
        if (cErr) return res.status(500).json({ error: cErr.message });
        if (row.cnt > 0) return res.status(409).json({ error: `Album utilisé dans ${row.cnt} liste(s)` });
        db.run('DELETE FROM albums WHERE id = ?', [id], function (dErr) {
            if (dErr) return res.status(500).json({ error: dErr.message });
            if (this.changes === 0) return res.status(404).json({ error: 'Album non trouvé' });
            logOperation('album.delete', 'album', id, null);
            res.json({ message: 'Album supprimé' });
        });
    });
});

app.patch('/api/albums/:id/refresh', (req, res) => {
    const { id } = req.params;
    db.get('SELECT * FROM albums WHERE id = ?', [id], async (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Album non trouvé' });
        try {
            const data = await fetchDiscogsRelease(row.release_id);
            const mapped = mapReleaseData(data);
            db.run(`UPDATE albums SET artist_name=?, album_title=?, release_year=?, genre=?, style=?, label=?, cover_image_url=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
                [mapped.artist_name, mapped.album_title, mapped.release_year, mapped.genre, mapped.style, mapped.label, mapped.cover_image_url, id],
                function (uErr) {
                    if (uErr) return res.status(500).json({ error: uErr.message });
                    db.get('SELECT * FROM albums WHERE id = ?', [id], (gErr, updated) => {
                        if (gErr) return res.status(500).json({ error: gErr.message });
                        logOperation('album.refresh', 'album', id, { release_id: row.release_id });
                        res.json({ message: 'Album rafraîchi', album: updated });
                    });
                }
            );
        } catch (e) {
            if (e.response && e.response.status === 404) return res.status(404).json({ error: 'Release non trouvée' });
            res.status(500).json({ error: 'Erreur lors du rafraîchissement' });
        }
    });
});

// Endpoint /api/albums/refresh-all retiré (fonctionnalité considérée trop lourde / peu utilisée)

// Listes
app.get('/api/lists', (req, res) => {
    const sql = `SELECT l.*, COUNT(li.id) as item_count FROM lists l LEFT JOIN list_items li ON l.id=li.list_id GROUP BY l.id ORDER BY l.created_at DESC`;
    db.all(sql, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        db.all('SELECT list_id, tag FROM list_tags', (tErr, tagRows) => {
            if (tErr) return res.status(500).json({ error: tErr.message });
            const tagMap = {};
            tagRows.forEach(r => { (tagMap[r.list_id] = tagMap[r.list_id] || []).push(r.tag); });
            rows.forEach(r => { r.tags = tagMap[r.id] || []; });
            res.json(rows);
        });
    });
});

app.post('/api/lists', (req, res) => {
    const { name, description } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Nom requis' });
    db.run('INSERT INTO lists (name, description) VALUES (?, ?)', [name.trim(), description || null], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        db.get('SELECT * FROM lists WHERE id = ?', [this.lastID], (gErr, row) => {
            if (gErr) return res.status(500).json({ error: gErr.message });
            logOperation('list.add', 'list', row.id, null);
            res.json(row);
        });
    });
});

app.put('/api/lists/:id', (req, res) => {
    const { id } = req.params;
    let { name, description } = req.body || {};
    if (name !== undefined) {
        name = name.trim();
        if (!name) return res.status(400).json({ error: 'Nom vide' });
    }
    if (name === undefined && description === undefined) return res.status(400).json({ error: 'Rien à mettre à jour' });
    const sets = []; const values = [];
    if (name !== undefined) { sets.push('name=?'); values.push(name); }
    if (description !== undefined) { sets.push('description=?'); values.push(description); }
    values.push(id);
    db.run(`UPDATE lists SET ${sets.join(',')} WHERE id=?`, values, function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Liste non trouvée' });
        db.get('SELECT * FROM lists WHERE id = ?', [id], (gErr, row) => {
            if (gErr) return res.status(500).json({ error: gErr.message });
            logOperation('list.update', 'list', id, { name: name, description });
            res.json({ message: 'Liste mise à jour', list: row });
        });
    });
});

app.delete('/api/lists/:id', (req, res) => {
    const { id } = req.params;
    db.run('DELETE FROM lists WHERE id = ?', [id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Liste non trouvée' });
        logOperation('list.delete', 'list', id, null);
        res.json({ message: 'Liste supprimée' });
    });
});

app.get('/api/lists/:id', (req, res) => {
    const { id } = req.params;
    db.get('SELECT * FROM lists WHERE id=?', [id], (err, listRow) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!listRow) return res.status(404).json({ error: 'Liste non trouvée' });
        const sqlItems = `SELECT li.id as list_item_id, li.position, a.* FROM list_items li JOIN albums a ON li.album_id=a.id WHERE li.list_id=? ORDER BY li.position ASC`;
        db.all(sqlItems, [id], (iErr, items) => {
            if (iErr) return res.status(500).json({ error: iErr.message });
            db.all('SELECT tag FROM list_tags WHERE list_id=? ORDER BY tag ASC', [id], (tErr, tagsRows) => {
                if (tErr) return res.status(500).json({ error: tErr.message });
                res.json({ ...listRow, items, tags: tagsRows.map(r => r.tag) });
            });
        });
    });
});

app.post('/api/lists/:id/tags', (req, res) => {
    const { id } = req.params; let { tag } = req.body || {};
    tag = (tag || '').trim().toLowerCase();
    if (!tag) return res.status(400).json({ error: 'Tag requis' });
    if (tag.length > 30) return res.status(400).json({ error: 'Tag trop long' });
    db.get('SELECT id FROM lists WHERE id=?', [id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Liste non trouvée' });
        db.run('INSERT INTO list_tags (list_id, tag) VALUES (?, ?)', [id, tag], function (insErr) {
            if (insErr) {
                if (insErr.message.includes('UNIQUE')) return res.status(409).json({ error: 'Tag déjà présent' });
                return res.status(500).json({ error: insErr.message });
            }
            db.all('SELECT tag FROM list_tags WHERE list_id=? ORDER BY tag ASC', [id], (tErr, rows) => {
                if (tErr) return res.status(500).json({ error: tErr.message });
                logOperation('tag.add', 'list', id, { tag });
                res.json({ message: 'Tag ajouté', tags: rows.map(r => r.tag) });
            });
        });
    });
});

app.delete('/api/lists/:id/tags/:tag', (req, res) => {
    const { id, tag } = req.params;
    const norm = decodeURIComponent(tag).trim().toLowerCase();
    db.run('DELETE FROM list_tags WHERE list_id=? AND tag=?', [id, norm], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Tag non trouvé' });
        db.all('SELECT tag FROM list_tags WHERE list_id=? ORDER BY tag ASC', [id], (tErr, rows) => {
            if (tErr) return res.status(500).json({ error: tErr.message });
            logOperation('tag.delete', 'list', id, { tag: norm });
            res.json({ message: 'Tag supprimé', tags: rows.map(r => r.tag) });
        });
    });
});

app.post('/api/lists/:id/items', async (req, res) => {
    const { id } = req.params; const { albumId, releaseId } = req.body || {};
    if (!albumId && !releaseId) return res.status(400).json({ error: 'albumId ou releaseId requis' });
    db.get('SELECT id FROM lists WHERE id=?', [id], async (lErr, listRow) => {
        if (lErr) return res.status(500).json({ error: lErr.message });
        if (!listRow) return res.status(404).json({ error: 'Liste non trouvée' });
        try {
            let finalAlbumId = albumId;
            if (!finalAlbumId && releaseId) finalAlbumId = await ensureAlbumByRelease(releaseId);
            db.get('SELECT MAX(position) as maxPos FROM list_items WHERE list_id=?', [id], (pErr, r) => {
                if (pErr) return res.status(500).json({ error: pErr.message });
                const nextPos = (r && r.maxPos) ? r.maxPos + 1 : 1;
                db.run('INSERT INTO list_items (list_id, album_id, position) VALUES (?, ?, ?)', [id, finalAlbumId, nextPos], function (insErr) {
                    if (insErr) {
                        if (insErr.message.includes('UNIQUE')) return res.status(409).json({ error: 'Album déjà dans la liste' });
                        return res.status(500).json({ error: insErr.message });
                    }
                    db.get('SELECT * FROM list_items WHERE id=?', [this.lastID], (gErr, liRow) => {
                        if (gErr) return res.status(500).json({ error: gErr.message });
                        logOperation('list_item.add', 'list', id, { item_id: liRow.id, album_id: finalAlbumId });
                        res.json({ message: 'Ajouté', item: liRow });
                    });
                });
            });
        } catch (e) {
            if (e.response && e.response.status === 404) return res.status(404).json({ error: 'Release non trouvée' });
            res.status(500).json({ error: e.message });
        }
    });
});

app.put('/api/lists/:id/items/order', (req, res) => {
    const { id } = req.params; const { order } = req.body || {};
    if (!Array.isArray(order) || !order.length) return res.status(400).json({ error: 'order doit être un tableau non vide' });
    const placeholders = order.map(() => '?').join(',');
    db.all(`SELECT id FROM list_items WHERE list_id=? AND id IN (${placeholders})`, [id, ...order], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        if (rows.length !== order.length) return res.status(400).json({ error: 'Items invalides' });
        db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            db.run('UPDATE list_items SET position=position+1000 WHERE list_id=?', [id], (bErr) => {
                if (bErr) { db.run('ROLLBACK'); return res.status(500).json({ error: bErr.message }); }
                let remaining = order.length; let failed = false;
                order.forEach((liId, idx) => {
                    db.run('UPDATE list_items SET position=? WHERE id=?', [idx + 1, liId], (uErr) => {
                        if (failed) return;
                        if (uErr) { failed = true; db.run('ROLLBACK'); return res.status(500).json({ error: uErr.message }); }
                        remaining--;
                        if (!remaining) {
                            db.run('COMMIT', (cErr) => {
                                if (cErr) { db.run('ROLLBACK'); return res.status(500).json({ error: cErr.message }); }
                                db.all('SELECT li.id as list_item_id, li.position, a.* FROM list_items li JOIN albums a ON li.album_id=a.id WHERE li.list_id=? ORDER BY li.position ASC', [id], (fErr, ordered) => {
                                    if (fErr) return res.status(500).json({ error: fErr.message });
                                    logOperation('list_item.reorder', 'list', id, { count: ordered.length });
                                    res.json({ message: 'Ordre mis à jour', items: ordered });
                                });
                            });
                        }
                    });
                });
            });
        });
    });
});

app.delete('/api/lists/:id/items/:itemId', (req, res) => {
    const { id, itemId } = req.params;
    db.run('DELETE FROM list_items WHERE id=? AND list_id=?', [itemId, id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Item non trouvé' });
        logOperation('list_item.delete', 'list', id, { item_id: itemId });
        res.json({ message: 'Item supprimé' });
    });
});

app.listen(PORT, () => console.log(`Serveur démarré sur http://localhost:${PORT}`));

// ================== ADMIN (Export) ==================
app.get('/api/admin/export', (req, res) => {
    const payload = { exported_at: new Date().toISOString(), version: 1 };
    db.serialize(() => {
        db.all('SELECT * FROM albums ORDER BY id ASC', (aErr, albumsRows) => {
            if (aErr) return res.status(500).json({ error: aErr.message });
            payload.albums = albumsRows;
            db.all('SELECT * FROM lists ORDER BY id ASC', (lErr, listsRows) => {
                if (lErr) return res.status(500).json({ error: lErr.message });
                payload.lists = listsRows;
                db.all('SELECT * FROM list_items ORDER BY list_id ASC, position ASC', (liErr, itemsRows) => {
                    if (liErr) return res.status(500).json({ error: liErr.message });
                    payload.list_items = itemsRows;
                    db.all('SELECT * FROM list_tags ORDER BY list_id ASC, tag ASC', (tErr, tagRows) => {
                        if (tErr) return res.status(500).json({ error: tErr.message });
                        payload.list_tags = tagRows;
                        res.setHeader('Content-Type', 'application/json; charset=utf-8');
                        res.setHeader('Cache-Control', 'no-store');
                        res.json(payload);
                    });
                });
            });
        });
    });
});

// Admin health / rebuild / import
app.get('/api/admin/health', (req, res) => {
    const required = ['albums','lists','list_items','list_tags'];
    const result = { ok: true, tables: {}, counts: {}, timestamp: new Date().toISOString() };
    db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const present = new Set(rows.map(r => r.name));
        required.forEach(t => { result.tables[t] = present.has(t); if (!present.has(t)) result.ok = false; });
        // If any table missing we can return early counts 0
        const countTasks = required.filter(t => result.tables[t]);
        let remaining = countTasks.length;
        if (!remaining) {
            required.forEach(t => result.counts[t] = 0);
            return res.json(result);
        }
        countTasks.forEach(t => {
            db.get(`SELECT COUNT(*) as c FROM ${t}`, (cErr, row) => {
                if (cErr) { result.ok = false; result.counts[t] = 0; }
                else result.counts[t] = row.c;
                remaining--;
                if (!remaining) return res.json(result);
            });
        });
    });
});

app.post('/api/admin/rebuild', (req, res) => {
    // Simply ensure schema exists (CREATE TABLE IF NOT EXISTS already does this)
    try {
        db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS albums (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                release_id INTEGER UNIQUE,
                artist_name TEXT NOT NULL,
                album_title TEXT NOT NULL,
                release_year INTEGER,
                genre TEXT,
                style TEXT,
                label TEXT,
                cover_image_url TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);
            db.run(`CREATE TABLE IF NOT EXISTS lists (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);
            db.run(`CREATE TABLE IF NOT EXISTS list_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                list_id INTEGER NOT NULL,
                album_id INTEGER NOT NULL,
                position INTEGER NOT NULL,
                UNIQUE(list_id, album_id),
                UNIQUE(list_id, position),
                FOREIGN KEY(list_id) REFERENCES lists(id) ON DELETE CASCADE,
                FOREIGN KEY(album_id) REFERENCES albums(id) ON DELETE CASCADE
            )`);
            db.run(`CREATE TABLE IF NOT EXISTS list_tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                list_id INTEGER NOT NULL,
                tag TEXT NOT NULL,
                UNIQUE(list_id, tag),
                FOREIGN KEY(list_id) REFERENCES lists(id) ON DELETE CASCADE
            )`);
        });
        res.json({ message: 'Schéma vérifié/reconstruit' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/import', (req, res) => {
    const { albums: al = [], lists: ls = [], list_items: li = [], list_tags: lt = [] } = req.body || {};
    if (!Array.isArray(al) || !Array.isArray(ls) || !Array.isArray(li) || !Array.isArray(lt)) {
        return res.status(400).json({ error: 'Format JSON invalide' });
    }
    db.serialize(() => {
        db.run('PRAGMA foreign_keys = OFF');
        db.run('BEGIN TRANSACTION');
        try {
            // Insert albums
            const insAlbum = db.prepare(`INSERT OR REPLACE INTO albums (id, release_id, artist_name, album_title, release_year, genre, style, label, cover_image_url, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
            al.forEach(a => {
                insAlbum.run([a.id, a.release_id, a.artist_name, a.album_title, a.release_year, a.genre, a.style, a.label, a.cover_image_url, a.created_at || new Date().toISOString(), a.updated_at || new Date().toISOString()]);
            });
            insAlbum.finalize();
            // Insert lists
            const insList = db.prepare(`INSERT OR REPLACE INTO lists (id, name, description, created_at) VALUES (?,?,?,?)`);
            ls.forEach(l => {
                insList.run([l.id, l.name, l.description, l.created_at || new Date().toISOString()]);
            });
            insList.finalize();
            // Insert list_items
            const insItem = db.prepare(`INSERT OR REPLACE INTO list_items (id, list_id, album_id, position) VALUES (?,?,?,?)`);
            li.forEach(x => {
                insItem.run([x.id, x.list_id, x.album_id, x.position]);
            });
            insItem.finalize();
            // Insert list_tags
            const insTag = db.prepare(`INSERT OR REPLACE INTO list_tags (id, list_id, tag) VALUES (?,?,?)`);
            lt.forEach(t => {
                insTag.run([t.id, t.list_id, t.tag]);
            });
            insTag.finalize();
            db.run('COMMIT', (cErr) => {
                if (cErr) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: cErr.message });
                }
                db.run('PRAGMA foreign_keys = ON');
                logOperation('admin.import', 'admin', null, { counts: { albums: al.length, lists: ls.length, list_items: li.length, list_tags: lt.length } });
                res.json({ message: 'Import terminé', counts: { albums: al.length, lists: ls.length, list_items: li.length, list_tags: lt.length } });
            });
        } catch (e) {
            db.run('ROLLBACK');
            db.run('PRAGMA foreign_keys = ON');
            res.status(500).json({ error: e.message });
        }
    });
});

app.get('/api/admin/logs', (req, res) => {
    let limit = parseInt(req.query.limit || '100', 10);
    if (isNaN(limit) || limit < 1) limit = 50;
    if (limit > 500) limit = 500;
    db.all('SELECT * FROM operation_logs ORDER BY id DESC LIMIT ?', [limit], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

process.on('SIGINT', () => {
    db.close(() => {
        console.log('Connexion à la base de données fermée.');
        process.exit(0);
    });
});