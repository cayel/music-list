// Nouveau server.js minimal sans recherche artiste+titre
const express = require('express');
// sqlite3 direct remplacé par une couche multi-driver (voir db.js)
const axios = require('axios');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
// Port de base demandé ; runtimePort reflétera le port effectif après tentative (fallback si occupé)
const BASE_PORT = parseInt(process.env.PORT || '3000', 10) || 3000;
let runtimePort = BASE_PORT;
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
    // Version app (package.json) + court hash Git si disponible
    let version = null; let git = null;
    try { version = require('./package.json').version || null; } catch { /* ignore */ }
    try {
        const cp = require('child_process');
        git = cp.execSync('git rev-parse --short HEAD',{stdio:['ignore','pipe','ignore']}).toString().trim();
    } catch { /* ignore */ }
    res.json({
        discogsToken: !!DISCOGS_TOKEN,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        db,
        port: runtimePort,
        env: { node: nodeEnv, name: envName, isLocal },
        version: { app: version, git }
    });
});

function logOperation(action, entityType, entityId, infoObj) {
    let info = null;
    if (infoObj) {
        try { info = JSON.stringify(infoObj).slice(0, 5000); } catch { info = null; }
    }
    dbLayer.run('INSERT INTO operation_logs (action, entity_type, entity_id, info) VALUES (?,?,?,?)', [action, entityType || null, entityId || null, info]);
}

function mapMasterData(master) {
    const artistName = (master.artists && master.artists.length) ? master.artists.map(a => a.name).join(', ') : 'Inconnu';
    const primaryArtistId = (master.artists && master.artists.length) ? master.artists[0].id : null;
    const albumTitle = master.title || 'Sans titre';
    const year = master.year || null;
    const genres = master.genres ? master.genres.join(', ') : null;
    const styles = master.styles ? master.styles.join(', ') : null;
    let cover = null;
    if (master.images && master.images.length) {
        const primary = master.images.find(i => i.type === 'primary') || master.images[0];
        cover = primary ? (primary.uri || primary.resource_url) : null;
    }
    return { artist_id: primaryArtistId, artist_name: artistName, album_title: albumTitle, release_year: year, genre: genres, style: styles, label: null, cover_image_url: cover };
}

async function fetchDiscogsMaster(masterId) {
    const headers = { 'User-Agent': USER_AGENT };
    if (DISCOGS_TOKEN) headers['Authorization'] = `Discogs token=${DISCOGS_TOKEN}`;
    const r = await axios.get(`${DISCOGS_API_URL}/masters/${masterId}`, { headers });
    return r.data;
}

async function fetchDiscogsRelease(releaseId) {
    const headers = { 'User-Agent': USER_AGENT };
    if (DISCOGS_TOKEN) headers['Authorization'] = `Discogs token=${DISCOGS_TOKEN}`;
    const r = await axios.get(`${DISCOGS_API_URL}/releases/${releaseId}`, { headers });
    return r.data;
}

function extractUniqueLabelsFromRelease(releaseData) {
    if (!releaseData || !Array.isArray(releaseData.labels)) return null;
    const seen = new Set();
    const out = [];
    for (const lab of releaseData.labels) {
        if (!lab || !lab.name) continue;
        const name = lab.name.trim();
        if (!name) continue;
        const key = name.toLowerCase();
        if (seen.has(key)) continue; // évite doublons de même nom
        seen.add(key);
        // Inclure catno si distinct et pertinent
        if (lab.catno && lab.catno !== 'none' && lab.catno !== 'N/A') {
            out.push(`${name} (${lab.catno})`);
        } else {
            out.push(name);
        }
    }
    return out.length ? out.join(', ') : null;
}

function ensureAlbumByMaster(masterId) {
    return new Promise((resolve, reject) => {
        dbLayer.get('SELECT id FROM albums WHERE master_id = ?', [masterId], async (err, row) => {
            if (err) return reject(err);
            if (row) return resolve(row.id);
            try {
                const data = await fetchDiscogsMaster(masterId);
                const mapped = mapMasterData(data);
                // Récupération label depuis la main_release si disponible
                if (data.main_release) {
                    try {
                        const rel = await fetchDiscogsRelease(data.main_release);
                        const lbl = extractUniqueLabelsFromRelease(rel);
                        if (lbl) mapped.label = lbl;
                    } catch (e) { /* ignore label fetch error */ }
                }
                dbLayer.run(`INSERT INTO albums (master_id, artist_id, artist_name, album_title, release_year, genre, style, label, cover_image_url, updated_at)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                    [masterId, mapped.artist_id, mapped.artist_name, mapped.album_title, mapped.release_year, mapped.genre, mapped.style, mapped.label, mapped.cover_image_url],
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

// ============= SMART LISTS =============
// Modèle de critère (JSON stocké dans criteria_json) :
// {
//   "artistIncludes": ["Miles Davis"],      // OU liste vide
//   "artistExcludes": ["Live"],            // optionnel
//   "yearMin": 1960,                        // optionnel
//   "yearMax": 1970,                        // optionnel
//   "genreIncludes": ["Jazz"],
//   "genreExcludes": ["Electronic"],
//   "styleIncludes": ["Hard Bop"],
//   "styleExcludes": ["Compilation"],
//   "limit": 200                            // borne résultat (défaut 500 hard)
// }

function buildSmartListWhere(criteria, params) {
    const where = [];
    const pushLikeList = (field, values, positive=true) => {
        const parts = [];
        values.forEach(v => {
            const term = `%${v.toLowerCase()}%`;
            parts.push(`lower(${field}) LIKE ?`);
            params.push(term);
        });
        if (!parts.length) return;
        const clause = '(' + parts.join(' OR ') + ')';
        where.push(positive ? clause : 'NOT ' + clause);
    };
    // Artistes et titres retirés des critères (simplification demandée)
    if (criteria.genreIncludes?.length) pushLikeList('genre', criteria.genreIncludes, true);
    if (criteria.genreExcludes?.length) pushLikeList('genre', criteria.genreExcludes, false);
    if (criteria.styleIncludes?.length) pushLikeList('style', criteria.styleIncludes, true);
    if (criteria.styleExcludes?.length) pushLikeList('style', criteria.styleExcludes, false);
    if (Number.isInteger(criteria.yearMin)) { where.push('(release_year IS NOT NULL AND release_year >= ?)'); params.push(criteria.yearMin); }
    if (Number.isInteger(criteria.yearMax)) { where.push('(release_year IS NOT NULL AND release_year <= ?)'); params.push(criteria.yearMax); }
    return where.length ? 'WHERE ' + where.join(' AND ') : '';
}

app.get('/api/smart-lists', (req,res) => {
    dbLayer.all('SELECT id, name, description, created_at FROM smart_lists ORDER BY created_at DESC', (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});

app.post('/api/smart-lists', (req,res) => {
    const { name, description, criteria } = req.body || {};
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name requis' });
    if (!criteria || typeof criteria !== 'object') return res.status(400).json({ error: 'criteria requis (objet)' });
    // Filtrer uniquement les clés autorisées (sécurité / stabilité)
    const allowed = ['genreIncludes','genreExcludes','styleIncludes','styleExcludes','yearMin','yearMax','limit'];
    const sanitized = {};
    for (const k of allowed) if (criteria[k] !== undefined) sanitized[k] = criteria[k];
    // Normalisation années
    if (sanitized.yearMin !== undefined && !Number.isInteger(sanitized.yearMin)) delete sanitized.yearMin;
    if (sanitized.yearMax !== undefined && !Number.isInteger(sanitized.yearMax)) delete sanitized.yearMax;
    if (sanitized.limit !== undefined && !Number.isInteger(sanitized.limit)) delete sanitized.limit;
    let criteriaJson;
    try { criteriaJson = JSON.stringify(sanitized); } catch { return res.status(400).json({ error: 'criteria JSON invalide' }); }
    dbLayer.run('INSERT INTO smart_lists (name, description, criteria_json) VALUES (?,?,?)', [name.trim(), description || null, criteriaJson], function(err){
        if (err) return res.status(500).json({ error: err.message });
        const newId = this.lastID; // SQLite & pg returning handled in db layer
        logOperation('smart_list.add','smart_list', newId, { name });
        dbLayer.get('SELECT id, name, description, created_at FROM smart_lists WHERE id=?',[newId], (gErr,row)=>{
            if (gErr) return res.status(500).json({ error: gErr.message });
            if (!row) return res.status(500).json({ error: 'Créé mais introuvable' });
            res.json(row);
        });
    });
});

app.get('/api/smart-lists/:id', (req,res) => {
    const { id } = req.params;
    dbLayer.get('SELECT * FROM smart_lists WHERE id=?',[id], (err,row)=>{
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Smart list non trouvée' });
        let criteria; try { criteria = JSON.parse(row.criteria_json); } catch { criteria = {}; }
        const params = [];
        const where = buildSmartListWhere(criteria, params);
        let limit = criteria && Number.isInteger(criteria.limit) ? criteria.limit : 500;
        if (limit > 1000) limit = 1000; if (limit < 1) limit = 1;
        // SQLite ne supporte pas "NULLS LAST" : on ajuste dynamiquement.
        const orderReleaseYear = dbLayer.driver === 'pg' ? 'a.release_year ASC NULLS LAST' : '(CASE WHEN a.release_year IS NULL THEN 1 ELSE 0 END), a.release_year ASC';
        const sql = `SELECT a.*, (SELECT COUNT(*) FROM list_items li WHERE li.album_id=a.id) AS list_usage_count FROM albums a ${where} ORDER BY ${orderReleaseYear}, a.album_title ASC LIMIT ${limit}`;
        dbLayer.all(sql, params, (aErr, albumsRows) => {
            if (aErr) return res.status(500).json({ error: aErr.message });
            res.json({ id: row.id, name: row.name, description: row.description, criteria, count: albumsRows.length, items: albumsRows });
        });
    });
});

app.delete('/api/smart-lists/:id', (req,res) => {
    const { id } = req.params;
    dbLayer.run('DELETE FROM smart_lists WHERE id=?',[id], function(err){
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Smart list non trouvée' });
        logOperation('smart_list.delete','smart_list', id, null);
        res.json({ message: 'Supprimée' });
    });
});

app.put('/api/smart-lists/:id', (req,res) => {
    const { id } = req.params;
    const { name, description, criteria } = req.body || {};
    if (!name && !description && !criteria) return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
    const sets = []; const params = [];
    if (name) { sets.push('name=?'); params.push(name.trim()); }
    if (description !== undefined) { sets.push('description=?'); params.push(description || null); }
    if (criteria) {
        try {
            const allowed = ['genreIncludes','genreExcludes','styleIncludes','styleExcludes','yearMin','yearMax','limit'];
            const sanitized = {};
            for (const k of allowed) if (criteria[k] !== undefined) sanitized[k] = criteria[k];
            if (sanitized.yearMin !== undefined && !Number.isInteger(sanitized.yearMin)) delete sanitized.yearMin;
            if (sanitized.yearMax !== undefined && !Number.isInteger(sanitized.yearMax)) delete sanitized.yearMax;
            if (sanitized.limit !== undefined && !Number.isInteger(sanitized.limit)) delete sanitized.limit;
            sets.push('criteria_json=?'); params.push(JSON.stringify(sanitized));
        }
        catch { return res.status(400).json({ error: 'criteria JSON invalide' }); }
    }
    params.push(id);
    dbLayer.run(`UPDATE smart_lists SET ${sets.join(',')} WHERE id=?`, params, function(err){
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Smart list non trouvée' });
        logOperation('smart_list.update','smart_list', id, { name, hasCriteria: !!criteria });
        dbLayer.get('SELECT id, name, description, created_at FROM smart_lists WHERE id=?',[id], (gErr,row)=>{
            if (gErr) return res.status(500).json({ error: gErr.message });
            res.json({ message: 'Mise à jour', list: row });
        });
    });
});

app.get('/api/albums/search', (req, res) => {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json([]);
    const like = `%${q.replace(/%/g, '')}%`;
    const sql = `SELECT id, release_id, artist_name, album_title, release_year, cover_image_url FROM albums WHERE artist_name LIKE ? OR album_title LIKE ? ORDER BY artist_name ASC, album_title ASC LIMIT 25`;
    dbLayer.all(sql, [like, like], (err, rows) => err ? res.status(500).json({ error: err.message }) : res.json(rows));
});


app.post('/api/albums', async (req, res) => {
    const { masterId } = req.body || {};
    if (!masterId) return res.status(400).json({ error: 'masterId requis' });
    try {
        const data = await fetchDiscogsMaster(masterId);
        const mapped = mapMasterData(data);
        if (data.main_release) {
            try {
                const rel = await fetchDiscogsRelease(data.main_release);
                const lbl = extractUniqueLabelsFromRelease(rel);
                if (lbl) mapped.label = lbl;
            } catch { /* ignore */ }
        }
        dbLayer.run(`INSERT INTO albums (master_id, artist_id, artist_name, album_title, release_year, genre, style, label, cover_image_url, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            [masterId, mapped.artist_id, mapped.artist_name, mapped.album_title, mapped.release_year, mapped.genre, mapped.style, mapped.label, mapped.cover_image_url],
            function (errIns) {
                if (errIns) {
                    if (errIns.message.includes('UNIQUE')) return res.status(409).json({ error: 'Album déjà présent' });
                    return res.status(500).json({ error: errIns.message });
                }
                logOperation('album.add', 'album', this.lastID, { master_id: masterId, artist_id: mapped.artist_id });
                res.json({ message: 'Album ajouté', albumId: this.lastID, albumData: { master_id: masterId, artist_id: mapped.artist_id, ...mapped } });
            }
        );
    } catch (e) {
        if (e.response && e.response.status === 404) return res.status(404).json({ error: 'Master non trouvé' });
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
            if (!row.master_id) return res.status(400).json({ error: 'master_id absent pour cet album' });
            const data = await fetchDiscogsMaster(row.master_id);
            const mapped = mapMasterData(data);
            if (data.main_release) {
                try {
                    const rel = await fetchDiscogsRelease(data.main_release);
                    const lbl = extractUniqueLabelsFromRelease(rel);
                    if (lbl) mapped.label = lbl;
                } catch { /* ignore */ }
            }
            dbLayer.run(`UPDATE albums SET artist_id=?, artist_name=?, album_title=?, release_year=?, genre=?, style=?, label=?, cover_image_url=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
                [mapped.artist_id, mapped.artist_name, mapped.album_title, mapped.release_year, mapped.genre, mapped.style, mapped.label, mapped.cover_image_url, id],
                function (uErr) {
                    if (uErr) return res.status(500).json({ error: uErr.message });
                    dbLayer.get('SELECT * FROM albums WHERE id = ?', [id], (gErr, updated) => {
                        if (gErr) return res.status(500).json({ error: gErr.message });
                        logOperation('album.refresh', 'album', id, { master_id: row.master_id });
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
    const { id } = req.params; const { albumId, masterId } = req.body || {};
    if (!albumId && !masterId) return res.status(400).json({ error: 'albumId ou masterId requis' });
    dbLayer.get('SELECT id FROM lists WHERE id=?', [id], async (lErr, listRow) => {
        if (lErr) return res.status(500).json({ error: lErr.message });
        if (!listRow) return res.status(404).json({ error: 'Liste non trouvée' });
        try {
            let finalAlbumId = albumId;
            if (!finalAlbumId && masterId) finalAlbumId = await ensureAlbumByMaster(masterId);
            // Pré‑vérification (évite retour 500 Postgres 'duplicate key value')
            dbLayer.get('SELECT id FROM list_items WHERE list_id=? AND album_id=?', [id, finalAlbumId], (dupErr, existing) => {
                if (dupErr) return res.status(500).json({ error: dupErr.message });
                if (existing) return res.status(409).json({ error: 'Album déjà dans la liste' });
                // Insertion atomique du prochain rang pour éviter les races (UNIQUE list_id, position)
                const insertSql = `INSERT INTO list_items (list_id, album_id, position)
                                   SELECT ?, ?, COALESCE(MAX(position),0)+1 FROM list_items WHERE list_id=?`;
                dbLayer.run(insertSql, [id, finalAlbumId, id], function (insErr) {
                    if (insErr) {
                        if (/UNIQUE|duplicate key value/i.test(insErr.message)) return res.status(409).json({ error: 'Album déjà dans la liste' });
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
            if (e.response && e.response.status === 404) return res.status(404).json({ error: 'Master non trouvé' });
            res.status(500).json({ error: e.message });
        }
    });
});

app.put('/api/lists/:id/items/order', (req, res) => {
    const { id } = req.params; const { order } = req.body || {};
    if (!Array.isArray(order) || !order.length) return res.status(400).json({ error: 'order doit être un tableau non vide' });
    // Normalisation & déduplication (si le front envoie par erreur un ID deux fois, on garde la 1ère occurrence)
    const normalized = order.map(o => Number(o));
    const seenIds = new Set();
    const dedupOrder = [];
    for (const oid of normalized) {
        if (!Number.isFinite(oid)) return res.status(400).json({ error: `ID invalide: ${oid}` });
        if (!seenIds.has(oid)) { seenIds.add(oid); dedupOrder.push(oid); }
    }
    const hadDuplicates = dedupOrder.length !== normalized.length;
    // Nouvelle logique: on récupère tous les items de la liste pour détecter si l'ordre fourni est partiel.
    dbLayer.all('SELECT id FROM list_items WHERE list_id=? ORDER BY position ASC', [id], (err, allRows) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!allRows.length) return res.status(404).json({ error: 'Liste vide ou non trouvée' });
        const allIds = allRows.map(r => r.id);
        const allSet = new Set(allIds);
        // Validation que chaque id fourni appartient bien à la liste
        for (const oid of dedupOrder) { if (!allSet.has(oid)) return res.status(400).json({ error: `Item ${oid} invalide pour cette liste` }); }
        const providedSet = new Set(dedupOrder);
        const tail = allIds.filter(x => !providedSet.has(x));
        const fullOrder = [...dedupOrder, ...tail]; // Items déplacés en tête dans l'ordre donné, puis le reste dans l'ordre existant
        const isPartial = fullOrder.length !== allIds.length; // vrai si on n'a pas fourni tous les items
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
            dbLayer.run(sql, [fullOrder, id], (uErr) => {
                if (uErr) return res.status(500).json({ error: uErr.message });
                dbLayer.all('SELECT li.id as list_item_id, li.position, a.* FROM list_items li JOIN albums a ON li.album_id=a.id WHERE li.list_id=? ORDER BY li.position ASC', [id], (fErr, ordered) => {
                    if (fErr) return res.status(500).json({ error: fErr.message });
                    logOperation('list_item.reorder', 'list', id, { count: ordered.length, partial: isPartial, dedup: hadDuplicates });
                    res.json({ message: 'Ordre mis à jour', items: ordered, partial: isPartial, dedup: hadDuplicates });
                });
            });
        } else {
            // Nouvelle stratégie SQLite : deux passes avec positions négatives (évite toute collision UNIQUE même sur permutations simples)
            // 1) Assigner des positions négatives uniques (-1, -2, ...) à l'ordre cible
            // 2) Réassigner en positif (1..n)
            dbLayer.run('BEGIN TRANSACTION');
            let failed = false; let remainingNeg = fullOrder.length; let remainingPos = fullOrder.length;
            fullOrder.forEach((liId, idx) => {
                // Phase négative
                dbLayer.run('UPDATE list_items SET position=? WHERE id=? AND list_id=?', [-(idx + 1), liId, id], (negErr) => {
                    if (failed) return;
                    if (negErr) { failed = true; dbLayer.run('ROLLBACK'); return res.status(500).json({ error: negErr.message }); }
                    remainingNeg--;
                    if (remainingNeg === 0) {
                        // Phase positive
                        fullOrder.forEach((liId2, idx2) => {
                            dbLayer.run('UPDATE list_items SET position=? WHERE id=? AND list_id=?', [idx2 + 1, liId2, id], (posErr) => {
                                if (failed) return;
                                if (posErr) { failed = true; dbLayer.run('ROLLBACK'); return res.status(500).json({ error: posErr.message }); }
                                remainingPos--;
                                if (remainingPos === 0) {
                                    dbLayer.run('COMMIT', (cErr) => {
                                        if (cErr) { dbLayer.run('ROLLBACK'); return res.status(500).json({ error: cErr.message }); }
                                        dbLayer.all('SELECT li.id as list_item_id, li.position, a.* FROM list_items li JOIN albums a ON li.album_id=a.id WHERE li.list_id=? ORDER BY li.position ASC', [id], (fErr, ordered) => {
                                            if (fErr) return res.status(500).json({ error: fErr.message });
                                            logOperation('list_item.reorder', 'list', id, { count: ordered.length, partial: isPartial, dedup: hadDuplicates });
                                            res.json({ message: 'Ordre mis à jour', items: ordered, partial: isPartial, dedup: hadDuplicates });
                                        });
                                    });
                                }
                            });
                        });
                    }
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

// ================== GENERATION LISTE ALBUMS STUDIO ==================
// Heuristique : recherche Discogs database search (type=release, format=album) triée par année ascendante.
// Filtre des formats/ titres indiquant compilations, live, remix, best of, singles.
// Création d'une liste nommée "Album Studio <Artiste>" avec description standard et tag "albums studio".
app.post('/api/lists/generate/studio', async (req, res) => {
    const { artist } = req.body || {};
    const artistName = (artist || '').trim();
    if (!artistName) return res.status(400).json({ error: 'artist requis' });
    try {
        // Récupération des albums locaux correspondant (recherche insensible à la casse, substring)
        const like = `%${artistName.toLowerCase().replace(/%/g,'')}%`;
        const sql = `SELECT * FROM albums WHERE lower(artist_name) LIKE ?`;
        const rows = await new Promise((resolve, reject) => {
            dbLayer.all(sql, [like], (err, r) => err ? reject(err) : resolve(r || []));
        });
        if (!rows.length) return res.status(404).json({ error: 'Aucun album local pour cet artiste' });
        // Filtrage heuristique pour exclure compilations / live / remix
        const denyTitle = /(live|remix|remastered|reissue|compilation|best\s*of|greatest|mix|dj\s*mix|single|ep|promo|anthology|collection)/i;
        const filtered = rows.filter(r => !denyTitle.test(r.album_title || ''));
        if (!filtered.length) return res.status(404).json({ error: 'Albums trouvés mais aucun ne passe le filtre studio' });
        // Tri: année croissante (nulls à la fin), puis titre
        filtered.sort((a,b)=>{
            if (a.release_year && b.release_year && a.release_year !== b.release_year) return a.release_year - b.release_year;
            if (a.release_year && !b.release_year) return -1;
            if (!a.release_year && b.release_year) return 1;
            return (a.album_title||'').localeCompare(b.album_title||'', 'fr');
        });
        const listName = `Album Studio ${artistName}`;
        const listDescription = `Discographie ${artistName} - Albums Studio`;
        const listId = await new Promise((resolve, reject) => {
            dbLayer.run('INSERT INTO lists (name, description) VALUES (?,?)', [listName, listDescription], function (err) { if (err) return reject(err); resolve(this.lastID); });
        });
        logOperation('list.add', 'list', listId, { generated: 'studio.local', artist: artistName });
        await new Promise(resolve => dbLayer.run('INSERT INTO list_tags (list_id, tag) VALUES (?,?)', [listId, 'albums studio'], () => resolve()));
        // Insérer items
        const itemInsert = `INSERT INTO list_items (list_id, album_id, position) VALUES (?,?,?)`;
        for (let i=0;i<filtered.length;i++) {
            const a = filtered[i];
            await new Promise((resolve, reject) => {
                dbLayer.run(itemInsert, [listId, a.id, i+1], function (err) { return err ? reject(err) : resolve(); });
            });
            logOperation('list_item.add', 'list', listId, { album_id: a.id, position: i+1, generate: 'studio.local' });
        }
        logOperation('list.generate.studio', 'list', listId, { artist: artistName, added: filtered.length, source: 'local' });
        dbLayer.all('SELECT li.id as list_item_id, li.position, a.* FROM list_items li JOIN albums a ON li.album_id=a.id WHERE li.list_id=? ORDER BY li.position ASC', [listId], (liErr, items) => {
            if (liErr) return res.status(500).json({ error: liErr.message });
            res.json({
                message: 'Liste studio générée (local)',
                list: { id: listId, name: listName, description: listDescription, tags: ['albums studio'], item_count: items.length },
                items,
                meta: { artist: artistName, added: items.length, source: 'local' }
            });
        });
    } catch (e) {
        res.status(500).json({ error: e.message || 'Erreur génération locale' });
    }
});

// Démarrage avec fallback automatique si le port est déjà utilisé (jusqu'à +10 ports)
function startServer(port, remainingFallbacks) {
    const server = app.listen(port, () => {
        runtimePort = port;
        console.log(`Serveur démarré sur http://localhost:${port}`);
    });
    server.on('error', (err) => {
        if (err && err.code === 'EADDRINUSE') {
            if (remainingFallbacks > 0) {
                const nextPort = port + 1;
                console.warn(`[Server] Port ${port} occupé, tentative sur ${nextPort}… (${remainingFallbacks} fallback restant)`);
                startServer(nextPort, remainingFallbacks - 1);
            } else {
                console.error('[Server] Ports consécutifs indisponibles, arrêt. Dernière erreur:', err.message);
                process.exit(1);
            }
        } else {
            console.error('[Server] Erreur au démarrage:', err);
            process.exit(1);
        }
    });
}

startServer(BASE_PORT, 10);

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

// Système / métriques avancées
app.get('/api/admin/system', async (req, res) => {
    const isPg = dbLayer.driver === 'pg';
    const result = { timestamp: new Date().toISOString() };
    // Process / Node
    const mem = process.memoryUsage();
    result.process = {
        uptime: process.uptime(),
        memory: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal },
        node: process.version
    };
    // App version / git
    try { result.app = { version: require('./package.json').version }; } catch { result.app = {}; }
    try {
        const cp = require('child_process');
        result.app.git = cp.execSync('git rev-parse --short HEAD', { stdio:['ignore','pipe','ignore'] }).toString().trim();
        // dirty flag
        try { cp.execSync('git diff --quiet'); } catch { result.app.dirty = true; }
    } catch { /* ignore */ }
    // Environnement
    const nodeEnv = process.env.NODE_ENV || 'development';
    const envName = process.env.ENV_NAME || nodeEnv;
    result.environment = { node: nodeEnv, name: envName };

    // DB counts
    const counts = { albums:0, lists:0, list_items:0, list_tags:0, logs:0 };
    const countNames = Object.keys(counts);
    await Promise.all(countNames.map(c => new Promise(resolve => {
        dbLayer.get(`SELECT COUNT(*) as c FROM ${c === 'logs' ? 'operation_logs' : c}`, (e,row)=>{ counts[c]= e?0: row.c; resolve(); });
    })));
    result.counts = counts;

    // DB size & table sizes
    result.db = { driver: dbLayer.driver };
    if (isPg) {
        try {
            const sizes = {};
            // total DB size
            await new Promise(resolve => dbLayer.get('SELECT pg_database_size(current_database()) as s', (e,row)=>{ if(!e&&row) result.db.sizeBytes=row.s; resolve(); }));
            const rels = ['albums','lists','list_items','list_tags','operation_logs'];
            await Promise.all(rels.map(tbl => new Promise(resolve => {
                dbLayer.get(`SELECT pg_total_relation_size(?) as sz`, [tbl], (e,row)=>{ if(!e&&row) sizes[tbl]=row.sz; resolve(); });
            })));
            result.db.tables = sizes;
        } catch (e) { result.db.error = e.message; }
    } else {
        // SQLite : taille fichier + estimation pages
        const fs = require('fs'); const path = require('path');
        const dbPath = process.env.DB_PATH || './music_collection.db';
        try { const st = fs.statSync(dbPath); result.db.file = path.resolve(dbPath); result.db.sizeBytes = st.size; } catch { /* ignore */ }
        // Page size / count
        await new Promise(resolve => dbLayer.get('PRAGMA page_size', (e,row)=>{ if(!e&&row) result.db.page_size=row.page_size; resolve(); }));
        await new Promise(resolve => dbLayer.get('PRAGMA page_count', (e,row)=>{ if(!e&&row) result.db.page_count=row.page_count; resolve(); }));
        if (result.db.page_size && result.db.page_count && !result.db.sizeBytes) {
            result.db.sizeBytes = result.db.page_size * result.db.page_count;
        }
    }

    // Logs récents (24h)
    await new Promise(resolve => dbLayer.get(`SELECT COUNT(*) as c FROM operation_logs WHERE created_at >= datetime('now','-1 day')`, (e,row)=>{ result.recent = { logs24h: e?0: row.c }; resolve(); }));
    res.json(result);
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