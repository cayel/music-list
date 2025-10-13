// Copie intégrale de l'ancien server.js (chemins ajustés)
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');
const swaggerUi = require('swagger-ui-express');
require('dotenv').config();

const app = express();
const BASE_PORT = parseInt(process.env.PORT || '3000', 10) || 3000;
let runtimePort = BASE_PORT;
const DISCOGS_API_URL = 'https://api.discogs.com';
const USER_AGENT = 'MusicListApp/1.0';
const DISCOGS_TOKEN = process.env.DISCOGS_TOKEN || null;
const DB_PATH = process.env.DB_PATH || './music_collection.db';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || null;

const FRONT_ORIGIN = process.env.FRONT_ORIGIN || '*';
app.use(cors({ origin: FRONT_ORIGIN === '*' ? true : FRONT_ORIGIN, credentials:false }));
app.use(express.json({ limit: '5mb' }));

app.get('/', (req,res)=> res.status(200).json({ service:'music-list-api', status:'ok', version: require('../package.json').version }));

// Chargement OpenAPI (Swagger)
let openapiDoc = null;
try {
    const openapiPath = path.join(__dirname, 'openapi.yaml');
    if (fs.existsSync(openapiPath)) {
        const raw = fs.readFileSync(openapiPath, 'utf8');
        openapiDoc = yaml.load(raw);
        const port = process.env.PORT || 3000;
        if (openapiDoc && openapiDoc.servers && openapiDoc.servers.length) {
            openapiDoc.servers[0].url = `http://localhost:${port}`;
        } else if (openapiDoc) {
            openapiDoc.servers = [{ url: `http://localhost:${port}` }];
        }
        app.get('/api/openapi.json', (req, res) => res.json(openapiDoc));
        app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapiDoc));
        console.log('Swagger UI disponible sur /api/docs');
    } else {
        console.warn('openapi.yaml introuvable, Swagger désactivé');
    }
} catch (e) {
    console.error('Erreur chargement openapi.yaml', e);
}

function adminAuth(req, res, next) {
    if (!ADMIN_TOKEN) return next();
    const token = req.headers['x-admin-token'] || req.query.admin_token;
    if (token !== ADMIN_TOKEN) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}
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
    let version = null; let git = null;
    try { version = require('../package.json').version || null; } catch { /* ignore */ }
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

// Recherche master Discogs par artiste + titre
async function searchDiscogsMasterByArtistTitle(artist, title) {
    const headers = { 'User-Agent': USER_AGENT };
    if (DISCOGS_TOKEN) headers['Authorization'] = `Discogs token=${DISCOGS_TOKEN}`;
    const params = new URLSearchParams();
    if (artist) params.set('artist', artist);
    if (title) params.set('release_title', title);
    params.set('type', 'master');
    params.set('per_page', '5');
    const url = `https://api.discogs.com/database/search?${params.toString()}`;
    const r = await axios.get(url, { headers });
    const results = (r.data?.results || []).filter(x => x.type === 'master');
    const norm = s => (s || '').toString().trim().toLowerCase();
    const exact = results.filter(x => norm(x.title).includes(norm(title)) && (!artist || norm(x.artist) === norm(artist)));
    return { results, exact };
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
        if (seen.has(key)) continue;
        seen.add(key);
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

app.get('/', (_, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

app.get('/api/albums', (req, res) => {
    const sql = `SELECT a.*, (SELECT COUNT(*) FROM list_items li WHERE li.album_id = a.id) AS list_usage_count FROM albums a ORDER BY a.created_at DESC`;
    dbLayer.all(sql, (err, rows) => err ? res.status(500).json({ error: err.message }) : res.json(rows));
});

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
    if (criteria.genreIncludes?.length) pushLikeList('genre', criteria.genreIncludes, true);
    if (criteria.genreExcludes?.length) pushLikeList('genre', criteria.genreExcludes, false);
    if (criteria.styleIncludes?.length) pushLikeList('style', criteria.styleIncludes, true);
    if (criteria.styleExcludes?.length) pushLikeList('style', criteria.styleExcludes, false);
    if (Number.isInteger(criteria.yearMin)) { where.push('(release_year IS NOT NULL AND release_year >= ?)'); params.push(criteria.yearMin); }
    if (Number.isInteger(criteria.yearMax)) { where.push('(release_year IS NOT NULL AND release_year <= ?)'); params.push(criteria.yearMax); }
    return where.length ? 'WHERE ' + where.join(' AND ') : '';
}

// ---- ADMIN ROUTES (déplacées hors de buildSmartListWhere) ----
function pGet(sql, params=[]) { return new Promise((resolve, reject)=> dbLayer.get(sql, params, (e,row)=> e?reject(e):resolve(row))); }
function pAll(sql, params=[]) { return new Promise((resolve, reject)=> dbLayer.all(sql, params, (e,rows)=> e?reject(e):resolve(rows||[]))); }
function pRun(sql, params=[]) { return new Promise((resolve, reject)=> dbLayer.run(sql, params, function(e){ return e?reject(e):resolve(this); })); }
const ADMIN_TABLES = ['albums','lists','list_items','list_tags','smart_lists','operation_logs'];
async function detectTables() { const presence={}, counts={}; for (const t of ADMIN_TABLES){ try{ const r=await pGet(`SELECT COUNT(*) as c FROM ${t}`); presence[t]=true; counts[t]=r? r.c:0; } catch { presence[t]=false; counts[t]=0; } } return { presence, counts }; }
app.get('/api/admin/health', async (req,res)=>{ try{ const {presence,counts}=await detectTables(); const ok=ADMIN_TABLES.every(t=>presence[t]); res.json({ ok, tables:presence, counts, timestamp:new Date().toISOString() }); } catch(e){ res.status(500).json({ error:e.message }); } });
app.get('/api/admin/system', async (req,res)=>{ try{ const {presence,counts}=await detectTables(); let version=null,git=null,sizeBytes=null; try{ version=require('../package.json').version; }catch{} try{ const cp=require('child_process'); git=cp.execSync('git rev-parse --short HEAD',{stdio:['ignore','pipe','ignore']}).toString().trim(); }catch{} if (dbLayer.driver==='sqlite'){ try{ const st=fs.statSync(DB_PATH); sizeBytes=st.size; }catch{} } res.json({ process:{ pid:process.pid, memory:process.memoryUsage(), uptime:process.uptime(), node:process.version }, environment:{ node:process.env.NODE_ENV||'development', name:process.env.ENV_NAME||process.env.NODE_ENV||'dev' }, app:{ version, git }, db:{ driver:dbLayer.driver, sizeBytes }, tables:presence, counts }); } catch(e){ res.status(500).json({ error:e.message }); } });
app.get('/api/admin/logs', async (req,res)=>{ try{ let limit=parseInt(req.query.limit||'100',10); if(!Number.isFinite(limit)||limit<1) limit=100; if(limit>500) limit=500; const rows=await pAll('SELECT * FROM operation_logs ORDER BY id DESC LIMIT ?', [limit]); res.json(rows); } catch(e){ res.status(500).json({ error:e.message }); } });
app.get('/api/admin/export', async (req,res)=>{ try{ const payload={}; for (const t of ADMIN_TABLES){ payload[t]=await pAll(`SELECT * FROM ${t}`); } logOperation('admin.export','admin', null, { rows:ADMIN_TABLES.reduce((a,t)=>(a[t]=payload[t].length,a),{}) }); res.json(payload); } catch(e){ res.status(500).json({ error:e.message }); } });
app.post('/api/admin/import', async (req,res)=>{ const data=req.body||{}; const albumMap=new Map(); const listMap=new Map(); const driver=dbLayer.driver; async function begin(){ if(driver==='pg') await pRun('BEGIN'); else await pRun('BEGIN TRANSACTION'); } async function commit(){ if(driver==='pg') await pRun('COMMIT'); else await pRun('COMMIT'); } async function rollback(){ try{ if(driver==='pg') await pRun('ROLLBACK'); else await pRun('ROLLBACK'); }catch{} } try{ await begin(); if(Array.isArray(data.albums)){ for(const a of data.albums){ if(!a) continue; let existing=null; if(a.master_id) existing=await pGet('SELECT id FROM albums WHERE master_id=?',[a.master_id]).catch(()=>null); if(!existing && a.release_id) existing=await pGet('SELECT id FROM albums WHERE release_id=?',[a.release_id]).catch(()=>null); if(existing && existing.id){ albumMap.set(a.id, existing.id); continue;} const cols=['master_id','release_id','artist_id','artist_name','album_title','release_year','genre','style','label','cover_image_url']; const vals=cols.map(c=> a[c]??null); const placeholders=cols.map(()=>'?').join(','); const ins=await pRun(`INSERT INTO albums (${cols.join(',')}, updated_at) VALUES (${placeholders}, CURRENT_TIMESTAMP)`, vals); albumMap.set(a.id, ins.lastID||ins.insertId); } } if(Array.isArray(data.lists)){ for(const l of data.lists){ if(!l) continue; const ins=await pRun('INSERT INTO lists (name, description, created_at) VALUES (?,?, COALESCE(?, CURRENT_TIMESTAMP))',[l.name||'Sans nom', l.description||null, l.created_at||null]); listMap.set(l.id, ins.lastID||ins.insertId); } } if(Array.isArray(data.smart_lists)){ for(const s of data.smart_lists){ if(!s) continue; try{ await pRun('INSERT INTO smart_lists (name, description, criteria_json, created_at) VALUES (?,?,?, COALESCE(?, CURRENT_TIMESTAMP))',[s.name||'Sans nom', s.description||null, s.criteria_json||s.criteriaJson||'{}', s.created_at||null]); }catch{} } } if(Array.isArray(data.list_items)){ for(const li of data.list_items){ const newList=listMap.get(li.list_id); const newAlbum=albumMap.get(li.album_id); if(!newList||!newAlbum) continue; try{ await pRun('INSERT INTO list_items (list_id, album_id, position) VALUES (?,?,?)',[newList, newAlbum, li.position||1]); }catch{} } } if(Array.isArray(data.list_tags)){ for(const lt of data.list_tags){ const newList=listMap.get(lt.list_id); if(!newList) continue; try{ await pRun('INSERT INTO list_tags (list_id, tag) VALUES (?,?)',[newList, lt.tag]); }catch{} } } await commit(); logOperation('admin.import','admin', null, { albums:albumMap.size, lists:listMap.size }); res.json({ message:'Import terminé', imported:{ albums:albumMap.size, lists:listMap.size } }); } catch(e){ await rollback(); res.status(500).json({ error:e.message }); } });
app.post('/api/admin/rebuild', async (req,res)=>{ try{ await dbLayer.init(); const {presence,counts}=await detectTables(); logOperation('admin.rebuild','admin', null, { tables:presence }); res.json({ message:'Rebuild effectué', tables:presence, counts }); } catch(e){ res.status(500).json({ error:e.message }); } });
// ---- FIN ADMIN ROUTES ----

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
    const allowed = ['genreIncludes','genreExcludes','styleIncludes','styleExcludes','yearMin','yearMax','limit'];
    const sanitized = {};
    for (const k of allowed) if (criteria[k] !== undefined) sanitized[k] = criteria[k];
    if (sanitized.yearMin !== undefined && !Number.isInteger(sanitized.yearMin)) delete sanitized.yearMin;
    if (sanitized.yearMax !== undefined && !Number.isInteger(sanitized.yearMax)) delete sanitized.yearMax;
    if (sanitized.limit !== undefined && !Number.isInteger(sanitized.limit)) delete sanitized.limit;
    let criteriaJson;
    try { criteriaJson = JSON.stringify(sanitized); } catch { return res.status(400).json({ error: 'criteria JSON invalide' }); }
    dbLayer.run('INSERT INTO smart_lists (name, description, criteria_json) VALUES (?,?,?)', [name.trim(), description || null, criteriaJson], function(err){
        if (err) return res.status(500).json({ error: err.message });
        const newId = this.lastID;
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
    const params = [like, like];
    let sql = `SELECT id, master_id, release_id, artist_name, album_title, release_year, cover_image_url FROM albums WHERE (artist_name LIKE ? OR album_title LIKE ?`;
    if (/^\d{4}$/.test(q)) { // année exacte
        sql += ' OR release_year = ?';
        params.push(parseInt(q,10));
    }
    sql += ') ORDER BY artist_name ASC, album_title ASC LIMIT 50';
    dbLayer.all(sql, params, (err, rows) => err ? res.status(500).json({ error: err.message }) : res.json(rows));
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

// Ajout via artiste + titre
app.post('/api/albums/by-artist-title', async (req, res) => {
    const { artist, title, pickFirst } = req.body || {};
    if (!artist || !title) return res.status(400).json({ error: 'artist et title requis' });
    try {
        const { results, exact } = await searchDiscogsMasterByArtistTitle(artist, title);
        const candidates = exact.length ? exact : results;
        if (!candidates.length) return res.status(404).json({ error: 'Aucun master trouvé' });
        let chosen = null;
        if (candidates.length === 1) chosen = candidates[0];
        else if (pickFirst) chosen = candidates[0];
        else return res.status(409).json({ error: 'Ambigu', candidates: candidates.slice(0,5).map(c => ({ id: c.id, title: c.title, year: c.year })) });
        try {
            const albumId = await ensureAlbumByMaster(chosen.id);
            logOperation('album.add', 'album', albumId, { via: 'artistTitle', master_id: chosen.id });
            return res.json({ message: 'Album ajouté', albumId, master_id: chosen.id, via: 'artistTitle' });
        } catch (e) {
            if (e.message && /UNIQUE/i.test(e.message)) return res.status(409).json({ error: 'Album déjà présent' });
            throw e;
        }
    } catch (e) {
        console.error('Erreur ajout via artiste+titre', e.message);
        res.status(500).json({ error: 'Erreur Discogs recherche' });
    }
});

// Ajout en masse multi-lignes
app.post('/api/albums/bulk', async (req, res) => {
    const { lines, dryRun, pickFirst } = req.body || {};
    if (typeof lines !== 'string' || !lines.trim()) return res.status(400).json({ error: 'lines (string) requis' });
    const rawLines = lines.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const out = { total: rawLines.length, processed: 0, added: [], duplicates: [], ambiguous: [], notFound: [], errors: [] };
    for (const line of rawLines) {
        if (out.processed >= 200) { out.errors.push({ line, error: 'Limite 200 atteinte' }); continue; }
        out.processed++;
        let artist = null, title = null;
        if (line.includes(',')) [artist, title] = line.split(',');
        else if (line.includes(' - ')) [artist, title] = line.split(' - ');
        if (!artist || !title) { out.errors.push({ line, error: 'Format invalide' }); continue; }
        artist = artist.trim(); title = title.trim();
        try {
            const { results, exact } = await searchDiscogsMasterByArtistTitle(artist, title);
            const candidates = exact.length ? exact : results;
            if (!candidates.length) { out.notFound.push({ line, artist, title }); continue; }
            let chosen = null;
            if (candidates.length === 1) chosen = candidates[0];
            else if (pickFirst) chosen = candidates[0];
            else { out.ambiguous.push({ line, artist, title, candidates: candidates.slice(0,5).map(c => ({ id: c.id, title: c.title, year: c.year })) }); continue; }
            if (dryRun) { out.added.push({ line, master_id: chosen.id, dryRun: true }); continue; }
            const existing = await new Promise(resolve => dbLayer.get('SELECT id FROM albums WHERE master_id=?', [chosen.id], (err, row) => resolve(row && row.id)));
            if (existing) { out.duplicates.push({ line, master_id: chosen.id, album_id: existing }); continue; }
            const albumId = await ensureAlbumByMaster(chosen.id);
            out.added.push({ line, master_id: chosen.id, album_id: albumId });
        } catch (e) {
            out.errors.push({ line, error: e.message || 'Erreur inconnue' });
        }
    }
    logOperation('album.bulk', 'album', null, { added: out.added.length, duplicates: out.duplicates.length, ambiguous: out.ambiguous.length, notFound: out.notFound.length });
    res.json(out);
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
    const { rederiveMaster } = req.body || {};
    dbLayer.get('SELECT * FROM albums WHERE id = ?', [id], async (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Album non trouvé' });
        try {
            let masterId = row.master_id;
            let masterChanged = false;
            // Si master_id manquant ou rederiveMaster demandé, tenter de le récupérer
            if (!masterId || rederiveMaster) {
                let candidate = null;
                // 1. Si release_id présent, on tente depuis la release
                if (row.release_id) {
                    try {
                        const rel = await fetchDiscogsRelease(row.release_id);
                        if (rel && rel.master_id) candidate = rel.master_id;
                    } catch {/* ignore */}
                }
                // 2. Recherche par artiste + titre si toujours rien
                if (!candidate && row.artist_name && row.album_title) {
                    try {
                        const { results, exact } = await searchDiscogsMasterByArtistTitle(row.artist_name, row.album_title);
                        const pick = (exact && exact.length) ? exact[0] : (results && results.length ? results[0] : null);
                        if (pick) candidate = pick.id;
                    } catch {/* ignore */}
                }
                if (candidate && candidate !== masterId) {
                    masterId = candidate;
                    masterChanged = true;
                }
                if (!masterId) return res.status(400).json({ error: 'Impossible de déterminer master_id' });
            }
            // Récupération données master
            const data = await fetchDiscogsMaster(masterId);
            const mapped = mapMasterData(data);
            if (data.main_release) {
                try {
                    const rel = await fetchDiscogsRelease(data.main_release);
                    const lbl = extractUniqueLabelsFromRelease(rel);
                    if (lbl) mapped.label = lbl;
                    // Mise à jour cover si (a) pas de cover master ou (b) image différente disponible côté release
                    if (rel && Array.isArray(rel.images) && rel.images.length) {
                        const primaryRel = rel.images.find(i=> i.type === 'primary') || rel.images[0];
                        const relCover = primaryRel ? (primaryRel.uri || primaryRel.resource_url) : null;
                        if (relCover && relCover !== mapped.cover_image_url) {
                            mapped.cover_image_url = relCover;
                        }
                    }
                } catch { /* ignore */ }
            }
            const updateSql = `UPDATE albums SET master_id=?, artist_id=?, artist_name=?, album_title=?, release_year=?, genre=?, style=?, label=?, cover_image_url=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`;
            dbLayer.run(updateSql,
                [masterId, mapped.artist_id, mapped.artist_name, mapped.album_title, mapped.release_year, mapped.genre, mapped.style, mapped.label, mapped.cover_image_url, id],
                function (uErr) {
                    if (uErr) return res.status(500).json({ error: uErr.message });
                    dbLayer.get('SELECT * FROM albums WHERE id = ?', [id], (gErr, updated) => {
                        if (gErr) return res.status(500).json({ error: gErr.message });
                        logOperation('album.refresh', 'album', id, { prev_master: row.master_id, new_master: masterId, changed: masterChanged });
                        res.json({ message: 'Album rafraîchi', album: updated, master_id_changed: masterChanged });
                    });
                }
            );
        } catch (e) {
            if (e.response && e.response.status === 404) return res.status(404).json({ error: 'Master non trouvé' });
            res.status(500).json({ error: 'Erreur lors du rafraîchissement' });
        }
    });
});

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
            dbLayer.get('SELECT id FROM list_items WHERE list_id=? AND album_id=?', [id, finalAlbumId], (dupErr, existing) => {
                if (dupErr) return res.status(500).json({ error: dupErr.message });
                if (existing) return res.status(409).json({ error: 'Album déjà dans la liste' });
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
    const normalized = order.map(o => Number(o));
    const seenIds = new Set();
    const dedupOrder = [];
    for (const oid of normalized) {
        if (!Number.isFinite(oid)) return res.status(400).json({ error: `ID invalide: ${oid}` });
        if (!seenIds.has(oid)) { seenIds.add(oid); dedupOrder.push(oid); }
    }
    const hadDuplicates = dedupOrder.length !== normalized.length;
    dbLayer.all('SELECT id FROM list_items WHERE list_id=? ORDER BY position ASC', [id], (err, allRows) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!allRows.length) return res.status(404).json({ error: 'Liste vide ou non trouvée' });
        const allIds = allRows.map(r => r.id);
        const allSet = new Set(allIds);
        for (const oid of dedupOrder) { if (!allSet.has(oid)) return res.status(400).json({ error: `Item ${oid} invalide pour cette liste` }); }
        const providedSet = new Set(dedupOrder);
        const tail = allIds.filter(x => !providedSet.has(x));
        const fullOrder = [...dedupOrder, ...tail];
        const isPartial = fullOrder.length !== allIds.length;
        if (dbLayer.driver === 'pg') {
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
            dbLayer.run('BEGIN TRANSACTION');
            let failed = false; let remainingNeg = fullOrder.length; let remainingPos = fullOrder.length;
            fullOrder.forEach((liId, idx) => {
                dbLayer.run('UPDATE list_items SET position=? WHERE id=? AND list_id=?', [-(idx + 1), liId, id], (negErr) => {
                    if (failed) return;
                    if (negErr) { failed = true; dbLayer.run('ROLLBACK'); return res.status(500).json({ error: negErr.message }); }
                    remainingNeg--;
                    if (remainingNeg === 0) {
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

app.post('/api/lists/generate/studio', async (req, res) => {
    const { artist } = req.body || {};
    const artistName = (artist || '').trim();
    if (!artistName) return res.status(400).json({ error: 'artist requis' });
    try {
        const like = `%${artistName.toLowerCase().replace(/%/g,'')}%`;
        const sql = `SELECT * FROM albums WHERE lower(artist_name) LIKE ?`;
        const rows = await new Promise((resolve, reject) => {
            dbLayer.all(sql, [like], (err, r) => err ? reject(err) : resolve(r || []));
        });
        if (!rows.length) return res.status(404).json({ error: 'Aucun album local pour cet artiste' });
        function isExcludedStudioTitle(title){
            if(!title) return false;
            const lc=title.toLowerCase();
            const normalized = lc.replace(/[^a-z0-9]+/g,' ').trim();
            if(!normalized) return false;
            const tokens = normalized.split(/\s+/);
            const tokenSet = new Set(tokens);
            const phrases = ['best of','dj mix'];
            if (phrases.some(p => normalized.includes(p))) return true;
            const singles = ['live','remix','remastered','reissue','compilation','greatest','mix','single','ep','promo','anthology','collection'];
            if (singles.some(t => tokenSet.has(t))) return true;
            return false;
        }
        const filtered = rows.filter(r => !isExcludedStudioTitle(r.album_title || ''));
        if (!filtered.length) return res.status(404).json({ error: 'Albums trouvés mais aucun ne passe le filtre studio' });
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

module.exports = { app };