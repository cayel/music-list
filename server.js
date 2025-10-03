// Nouveau server.js minimal sans recherche artiste+titre
const express = require('express');
// sqlite3 direct remplacé par une couche multi-driver (voir db.js)
const axios = require('axios');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const DISCOGS_API_URL = 'https://api.discogs.com';
const USER_AGENT = 'MusicListApp/1.0';
const DISCOGS_TOKEN = process.env.DISCOGS_TOKEN || null;
const DB_PATH = process.env.DB_PATH || './music_collection.db'; // conservé pour compat local
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

const dbLayer = require('./db');
let dbReady = false;
dbLayer.init().then(()=>{ dbReady = true; console.log('[DB] Initialisée driver=' + dbLayer.driver); }).catch(e => { console.error('Init DB échouée', e); process.exit(1); });

app.get('/api/status', (req, res) => {
    const db = { driver: dbLayer.driver };
    if (dbLayer.driver === 'sqlite') {
        db.location = DB_PATH;
    } else {
        try {
            const conn = process.env.PG_CONNECTION_STRING || process.env.DATABASE_URL || '';
            if (conn) {
                const url = new URL(conn.replace(/^postgres:\/\//,'postgresql://'));
                const host = url.hostname;
                const port = url.port || '5432';
                const dbname = url.pathname.replace(/^\//,'');
                db.location = `${host}:${port}/${dbname}`;
            }
        } catch { /* ignore */ }
    }
    const nodeEnv = process.env.NODE_ENV || 'development';
    const envName = process.env.ENV_NAME || nodeEnv;
    const isLocal = (nodeEnv !== 'production') || ['localhost','127.0.0.1'].includes(require('os').hostname()) || db.driver === 'sqlite';
    res.json({
        discogsToken: !!DISCOGS_TOKEN,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        db,
        port: PORT,
        env: { node: nodeEnv, name: envName, isLocal }
    });
});

function logOperation(action, entityType, entityId, infoObj) {
    let info = null;
    if (infoObj) {
        try { info = JSON.stringify(infoObj).slice(0, 5000); } catch { info = null; }
    }
    dbLayer.run('INSERT INTO operation_logs (action, entity_type, entity_id, info) VALUES (?,?,?,?)', [action, entityType || null, entityId || null, info]);
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
    dbLayer.get('SELECT id FROM albums WHERE release_id = ?', [releaseId], async (err, row) => {
            if (err) return reject(err);
            if (row) return resolve(row.id);
            try {
                const data = await fetchDiscogsRelease(releaseId);
                const mapped = mapReleaseData(data);
                dbLayer.run(`INSERT INTO albums (release_id, artist_name, album_title, release_year, genre, style, label, cover_image_url, updated_at)
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
    dbLayer.all(sql, (err, rows) => err ? res.status(500).json({ error: err.message }) : res.json(rows));
});

app.get('/api/albums/search', (req, res) => {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json([]);
    const like = `%${q.replace(/%/g, '')}%`;
    const sql = `SELECT id, release_id, artist_name, album_title, release_year, cover_image_url FROM albums WHERE artist_name LIKE ? OR album_title LIKE ? ORDER BY artist_name ASC, album_title ASC LIMIT 25`;
    dbLayer.all(sql, [like, like], (err, rows) => err ? res.status(500).json({ error: err.message }) : res.json(rows));
});

app.post('/api/albums', async (req, res) => {
    const { releaseId } = req.body || {};
    if (!releaseId) return res.status(400).json({ error: 'releaseId requis' });
    try {
        const data = await fetchDiscogsRelease(releaseId);
        const mapped = mapReleaseData(data);
    dbLayer.run(`INSERT INTO albums (release_id, artist_name, album_title, release_year, genre, style, label, cover_image_url, updated_at)
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
    dbLayer.get('SELECT COUNT(*) as cnt FROM list_items WHERE album_id = ?', [id], (cErr, row) => {
        if (cErr) return res.status(500).json({ error: cErr.message });
        if (row.cnt > 0) return res.status(409).json({ error: `Album utilisé dans ${row.cnt} liste(s)` });
    dbLayer.run('DELETE FROM albums WHERE id = ?', [id], function (dErr) {
            if (dErr) return res.status(500).json({ error: dErr.message });
            if (this.changes === 0) return res.status(404).json({ error: 'Album non trouvé' });
            logOperation('album.delete', 'album', id, null);
            res.json({ message: 'Album supprimé' });
        });
    });
});

app.patch('/api/albums/:id/refresh', (req, res) => {
    const { id } = req.params;
    dbLayer.get('SELECT * FROM albums WHERE id = ?', [id], async (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Album non trouvé' });
        try {
            const data = await fetchDiscogsRelease(row.release_id);
            const mapped = mapReleaseData(data);
            dbLayer.run(`UPDATE albums SET artist_name=?, album_title=?, release_year=?, genre=?, style=?, label=?, cover_image_url=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
                [mapped.artist_name, mapped.album_title, mapped.release_year, mapped.genre, mapped.style, mapped.label, mapped.cover_image_url, id],
                function (uErr) {
                    if (uErr) return res.status(500).json({ error: uErr.message });
                    dbLayer.get('SELECT * FROM albums WHERE id = ?', [id], (gErr, updated) => {
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
    dbLayer.all(sql, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
    dbLayer.all('SELECT list_id, tag FROM list_tags', (tErr, tagRows) => {
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
    dbLayer.run('INSERT INTO lists (name, description) VALUES (?, ?)', [name.trim(), description || null], function (err) {
        if (err) return res.status(500).json({ error: err.message });
    dbLayer.get('SELECT * FROM lists WHERE id = ?', [this.lastID], (gErr, row) => {
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
    dbLayer.run(`UPDATE lists SET ${sets.join(',')} WHERE id=?`, values, function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Liste non trouvée' });
    dbLayer.get('SELECT * FROM lists WHERE id = ?', [id], (gErr, row) => {
            if (gErr) return res.status(500).json({ error: gErr.message });
            logOperation('list.update', 'list', id, { name: name, description });
            res.json({ message: 'Liste mise à jour', list: row });
        });
    });
});

app.delete('/api/lists/:id', (req, res) => {
    const { id } = req.params;
    dbLayer.run('DELETE FROM lists WHERE id = ?', [id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Liste non trouvée' });
        logOperation('list.delete', 'list', id, null);
        res.json({ message: 'Liste supprimée' });
    });
});

app.get('/api/lists/:id', (req, res) => {
    const { id } = req.params;
    dbLayer.get('SELECT * FROM lists WHERE id=?', [id], (err, listRow) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!listRow) return res.status(404).json({ error: 'Liste non trouvée' });
        const sqlItems = `SELECT li.id as list_item_id, li.position, a.* FROM list_items li JOIN albums a ON li.album_id=a.id WHERE li.list_id=? ORDER BY li.position ASC`;
    dbLayer.all(sqlItems, [id], (iErr, items) => {
            if (iErr) return res.status(500).json({ error: iErr.message });
            dbLayer.all('SELECT tag FROM list_tags WHERE list_id=? ORDER BY tag ASC', [id], (tErr, tagsRows) => {
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
    dbLayer.get('SELECT id FROM lists WHERE id=?', [id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Liste non trouvée' });
    dbLayer.run('INSERT INTO list_tags (list_id, tag) VALUES (?, ?)', [id, tag], function (insErr) {
            if (insErr) {
                if (insErr.message.includes('UNIQUE')) return res.status(409).json({ error: 'Tag déjà présent' });
                return res.status(500).json({ error: insErr.message });
            }
            dbLayer.all('SELECT tag FROM list_tags WHERE list_id=? ORDER BY tag ASC', [id], (tErr, rows) => {
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
    dbLayer.run('DELETE FROM list_tags WHERE list_id=? AND tag=?', [id, norm], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Tag non trouvé' });
    dbLayer.all('SELECT tag FROM list_tags WHERE list_id=? ORDER BY tag ASC', [id], (tErr, rows) => {
            if (tErr) return res.status(500).json({ error: tErr.message });
            logOperation('tag.delete', 'list', id, { tag: norm });
            res.json({ message: 'Tag supprimé', tags: rows.map(r => r.tag) });
        });
    });
});

app.post('/api/lists/:id/items', async (req, res) => {
    const { id } = req.params; const { albumId, releaseId } = req.body || {};
    if (!albumId && !releaseId) return res.status(400).json({ error: 'albumId ou releaseId requis' });
    dbLayer.get('SELECT id FROM lists WHERE id=?', [id], async (lErr, listRow) => {
        if (lErr) return res.status(500).json({ error: lErr.message });
        if (!listRow) return res.status(404).json({ error: 'Liste non trouvée' });
        try {
            let finalAlbumId = albumId;
            if (!finalAlbumId && releaseId) finalAlbumId = await ensureAlbumByRelease(releaseId);
            dbLayer.get('SELECT MAX(position) as maxPos FROM list_items WHERE list_id=?', [id], (pErr, r) => {
                if (pErr) return res.status(500).json({ error: pErr.message });
                // Attention: Postgres renvoie l'alias non quoté en minuscules => maxpos
                const rawMax = r ? (r.maxPos !== undefined ? r.maxPos : r.maxpos) : null;
                const numericMax = rawMax == null ? null : Number(rawMax);
                const nextPos = Number.isFinite(numericMax) ? numericMax + 1 : 1;
                dbLayer.run('INSERT INTO list_items (list_id, album_id, position) VALUES (?, ?, ?)', [id, finalAlbumId, nextPos], function (insErr) {
                    if (insErr) {
                        if (insErr.message.includes('UNIQUE')) return res.status(409).json({ error: 'Album déjà dans la liste' });
                        return res.status(500).json({ error: insErr.message });
                    }
                    dbLayer.get('SELECT * FROM list_items WHERE id=?', [this.lastID], (gErr, liRow) => {
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
    dbLayer.all(`SELECT id FROM list_items WHERE list_id=? AND id IN (${placeholders})`, [id, ...order], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        if (rows.length !== order.length) return res.status(400).json({ error: 'Items invalides' });
        if (dbLayer.driver === 'pg') {
            // Réordonnancement atomique via CTE et unnest(array)
            // Avantages :
            // - Pas de positions temporaires hors borne (ex: +1000)
            // - Vérification finale de la contrainte UNIQUE en une fois
            const sql = `WITH np AS (
                SELECT unnest($1::int[]) AS id,
                       generate_series(1, array_length($1::int[], 1)) AS pos
            )
            UPDATE list_items li
            SET position = np.pos
            FROM np
            WHERE li.id = np.id AND li.list_id = $2`;
            dbLayer.run(sql, [order, id], (uErr) => {
                if (uErr) return res.status(500).json({ error: uErr.message });
                dbLayer.all('SELECT li.id as list_item_id, li.position, a.* FROM list_items li JOIN albums a ON li.album_id=a.id WHERE li.list_id=? ORDER BY li.position ASC', [id], (fErr, ordered) => {
                    if (fErr) return res.status(500).json({ error: fErr.message });
                    logOperation('list_item.reorder', 'list', id, { count: ordered.length });
                    res.json({ message: 'Ordre mis à jour', items: ordered });
                });
            });
        } else {
            dbLayer.run('BEGIN TRANSACTION');
            dbLayer.run('UPDATE list_items SET position=position+1000 WHERE list_id=?', [id], (bErr) => {
                if (bErr) { dbLayer.run('ROLLBACK'); return res.status(500).json({ error: bErr.message }); }
                let remaining = order.length; let failed = false;
                order.forEach((liId, idx) => {
                    dbLayer.run('UPDATE list_items SET position=? WHERE id=?', [idx + 1, liId], (uErr) => {
                        if (failed) return;
                        if (uErr) { failed = true; dbLayer.run('ROLLBACK'); return res.status(500).json({ error: uErr.message }); }
                        remaining--;
                        if (!remaining) {
                            dbLayer.run('COMMIT', (cErr) => {
                                if (cErr) { dbLayer.run('ROLLBACK'); return res.status(500).json({ error: cErr.message }); }
                                dbLayer.all('SELECT li.id as list_item_id, li.position, a.* FROM list_items li JOIN albums a ON li.album_id=a.id WHERE li.list_id=? ORDER BY li.position ASC', [id], (fErr, ordered) => {
                                    if (fErr) return res.status(500).json({ error: fErr.message });
                                    logOperation('list_item.reorder', 'list', id, { count: ordered.length });
                                    res.json({ message: 'Ordre mis à jour', items: ordered });
                                });
                            });
                        }
                    });
                });
            });
        }
    });
});

app.delete('/api/lists/:id/items/:itemId', (req, res) => {
    const { id, itemId } = req.params;
    dbLayer.run('DELETE FROM list_items WHERE id=? AND list_id=?', [itemId, id], function (err) {
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
    dbLayer.all('SELECT * FROM albums ORDER BY id ASC', (aErr, albumsRows) => {
        if (aErr) return res.status(500).json({ error: aErr.message });
        payload.albums = albumsRows;
        dbLayer.all('SELECT * FROM lists ORDER BY id ASC', (lErr, listsRows) => {
            if (lErr) return res.status(500).json({ error: lErr.message });
            payload.lists = listsRows;
            dbLayer.all('SELECT * FROM list_items ORDER BY list_id ASC, position ASC', (liErr, itemsRows) => {
                if (liErr) return res.status(500).json({ error: liErr.message });
                payload.list_items = itemsRows;
                dbLayer.all('SELECT * FROM list_tags ORDER BY list_id ASC, tag ASC', (tErr, tagRows) => {
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

// Admin health / rebuild / import
app.get('/api/admin/health', (req, res) => {
    const required = ['albums','lists','list_items','list_tags'];
    const result = { ok: true, tables: {}, counts: {}, timestamp: new Date().toISOString() };
    const listTablesSql = dbLayer.driver === 'pg'
        ? `SELECT table_name as name FROM information_schema.tables WHERE table_schema='public'`
        : "SELECT name FROM sqlite_master WHERE type='table'";
    dbLayer.all(listTablesSql, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const present = new Set(rows.map(r => r.name));
        required.forEach(t => { result.tables[t] = present.has(t); if (!present.has(t)) result.ok = false; });
        const countTasks = required.filter(t => result.tables[t]);
        let remaining = countTasks.length;
        if (!remaining) {
            required.forEach(t => result.counts[t] = 0);
            return res.json(result);
        }
        countTasks.forEach(t => {
            dbLayer.get(`SELECT COUNT(*) as c FROM ${t}`, (cErr, row) => {
                if (cErr) { result.ok = false; result.counts[t] = 0; }
                else result.counts[t] = row.c;
                remaining--;
                if (!remaining) return res.json(result);
            });
        });
    });
});

app.post('/api/admin/rebuild', (_req, res) => {
    // Schéma déjà garanti à l'init
    res.json({ message: 'Schéma vérifié/reconstruit' });
});

app.post('/api/admin/import', (req, res) => {
    const { albums: al = [], lists: ls = [], list_items: li = [], list_tags: lt = [] } = req.body || {};
    if (!Array.isArray(al) || !Array.isArray(ls) || !Array.isArray(li) || !Array.isArray(lt)) {
        return res.status(400).json({ error: 'Format JSON invalide' });
    }
    const isPg = dbLayer.driver === 'pg';
    function exec(sql, params = []) { return new Promise((resolve, reject) => dbLayer.run(sql, params, function (err) { return err ? reject(err) : resolve(this); })); }

    // Stratégie: on ne préserve pas les IDs sources (car trous possibles) => on construit un mapping.
    // Cela évite les violations FK quand l'export contenait des IDs clairsemés (ex: listes 1,2,5 => Postgres recrée 1,2,3).
    // Mapping: sourceId -> newId
    (async () => {
        if (isPg) await exec('BEGIN');
        const albumIdMap = {}; // old -> new
        const listIdMap = {}; // old -> new
        let skippedAlbumDuplicates = 0;
        try {
            // Pré-charger les albums existants par release_id (pour éviter doublons)
            const existingRelease = await new Promise((resolve, reject) => {
                dbLayer.all('SELECT id, release_id FROM albums WHERE release_id IS NOT NULL', (e, rows) => {
                    if (e) return reject(e); resolve(rows || []);
                });
            });
            const releaseToId = new Map();
            existingRelease.forEach(r => { if (r.release_id != null) releaseToId.set(r.release_id, r.id); });
            // Albums
            for (const a of al) {
                // Si release_id déjà présent dans la base cible, on remappe sans insérer
                if (a.release_id != null && releaseToId.has(a.release_id)) {
                    const existingId = releaseToId.get(a.release_id);
                    if (a.id !== undefined) albumIdMap[a.id] = existingId;
                    skippedAlbumDuplicates++;
                    continue;
                }
                try {
                    const ctx = await exec(`INSERT INTO albums (release_id, artist_name, album_title, release_year, genre, style, label, cover_image_url, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`, [a.release_id, a.artist_name, a.album_title, a.release_year, a.genre, a.style, a.label, a.cover_image_url, a.created_at || new Date().toISOString(), a.updated_at || new Date().toISOString()]);
                    const newId = ctx.lastID;
                    if (a.release_id != null) releaseToId.set(a.release_id, newId);
                    if (a.id !== undefined) albumIdMap[a.id] = newId; // ctx.lastID défini pour les deux drivers
                } catch (insErr) {
                    // En cas de race condition improbable: retenter via select unique
                    if (insErr.message && insErr.message.includes('UNIQUE')) {
                        const row = await new Promise((resolve) => dbLayer.get('SELECT id FROM albums WHERE release_id=?', [a.release_id], (_e, r) => resolve(r)));
                        if (row && a.id !== undefined) { albumIdMap[a.id] = row.id; skippedAlbumDuplicates++; continue; }
                        throw insErr;
                    }
                    throw insErr;
                }
            }
            // Listes
            for (const l of ls) {
                const ctx = await exec(`INSERT INTO lists (name, description, created_at) VALUES (?,?,?)`, [l.name, l.description, l.created_at || new Date().toISOString()]);
                if (l.id !== undefined) listIdMap[l.id] = ctx.lastID;
            }
            // Items de liste (remap list_id & album_id)
            for (const x of li) {
                const mappedListId = listIdMap.hasOwnProperty(x.list_id) ? listIdMap[x.list_id] : x.list_id;
                const mappedAlbumId = albumIdMap.hasOwnProperty(x.album_id) ? albumIdMap[x.album_id] : x.album_id;
                if (!mappedListId || !mappedAlbumId) {
                    throw new Error(`Référence introuvable pour list_item (list_id=${x.list_id}=>${mappedListId}, album_id=${x.album_id}=>${mappedAlbumId})`);
                }
                await exec(`INSERT INTO list_items (list_id, album_id, position) VALUES (?,?,?)`, [mappedListId, mappedAlbumId, x.position]);
            }
            // Tags (remap list_id)
            for (const t of lt) {
                const mappedListId = listIdMap.hasOwnProperty(t.list_id) ? listIdMap[t.list_id] : t.list_id;
                if (!mappedListId) throw new Error(`Référence introuvable pour tag (list_id=${t.list_id})`);
                await exec(`INSERT INTO list_tags (list_id, tag) VALUES (?,?)`, [mappedListId, t.tag]);
            }
            if (isPg) await exec('COMMIT');
            logOperation('admin.import', 'admin', null, { counts: { albums: al.length, lists: ls.length, list_items: li.length, list_tags: lt.length, albums_duplicates_skipped: skippedAlbumDuplicates } });
            res.json({
                message: 'Import terminé',
                counts: { albums: al.length, lists: ls.length, list_items: li.length, list_tags: lt.length, albums_duplicates_skipped: skippedAlbumDuplicates },
                remapped: { albums: Object.keys(albumIdMap).length, lists: Object.keys(listIdMap).length },
                note: skippedAlbumDuplicates ? `${skippedAlbumDuplicates} album(s) déjà présent(s) ignoré(s)` : undefined
            });
        } catch (e) {
            if (isPg) await exec('ROLLBACK');
            res.status(500).json({ error: e.message });
        }
    })();
});

app.get('/api/admin/logs', (req, res) => {
    let limit = parseInt(req.query.limit || '100', 10);
    if (isNaN(limit) || limit < 1) limit = 50;
    if (limit > 500) limit = 500;
    dbLayer.all('SELECT * FROM operation_logs ORDER BY id DESC LIMIT ?', [limit], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

process.on('SIGINT', () => { dbLayer.close(()=> { console.log('DB fermée'); process.exit(0); }); });