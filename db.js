// db.js : couche d'abstraction SQLite / Postgres avec API similaire (run/get/all)
// Usage attendu par server.js : db.run(sql, params, cb), db.get(...), db.all(...), db.close(cb), db.driver

const usePg = !!(process.env.PG_CONNECTION_STRING || process.env.DATABASE_URL);
let driver = 'sqlite';
let sqliteDb = null;
let pgPool = null;

function convertPlaceholders(sql) {
    // Remplace les '?' hors chaînes par $1, $2 ... pour Postgres
    let idx = 0; let out = ''; let inS = false; let inD = false;
    for (let i = 0; i < sql.length; i++) {
        const ch = sql[i];
        if (ch === "'" && !inD) { inS = !inS; out += ch; continue; }
        if (ch === '"' && !inS) { inD = !inD; out += ch; continue; }
        if (!inS && !inD && ch === '?') { idx++; out += '$' + idx; continue; }
        out += ch;
    }
    return out;
}

async function init() {
    if (usePg) {
        driver = 'pg';
        const { Pool } = require('pg');
        const conn = process.env.PG_CONNECTION_STRING || process.env.DATABASE_URL;
        const needsSsl = /render\.com|neon\.tech|supabase\.co/i.test(conn);
        const poolConfig = { connectionString: conn };
        if (needsSsl) {
            poolConfig.ssl = { rejectUnauthorized: false }; // simplifie config SSL managée
        }
        pgPool = new Pool(poolConfig);
        // Test de connexion
        await pgPool.query('SELECT 1');
        await createSchema();
        return;
    } else {
        const sqlite3 = require('sqlite3').verbose();
        const DB_PATH = process.env.DB_PATH || './music_collection.db';
        sqliteDb = new sqlite3.Database(DB_PATH);
        sqliteDb.run('PRAGMA foreign_keys = ON');
        sqliteDb.run('PRAGMA journal_mode = WAL');
        await new Promise((resolve, reject) => sqliteDb.serialize(() => createSchema(resolve, reject)));
    }
}

function ignoreIfPg(sql) {
    return driver === 'pg' && /^\s*PRAGMA/i.test(sql);
}

function run(sql, params, cb) {
    if (typeof params === 'function') { cb = params; params = []; }
    params = params || [];
    if (driver === 'pg') {
        if (ignoreIfPg(sql)) return cb && cb(null);
        // Ajout RETURNING pour insert si pas présent (pour lastID)
        let needsReturning = /^\s*insert/i.test(sql) && !/returning\s+id/i.test(sql);
        let finalSql = sql;
        if (needsReturning) finalSql = sql.replace(/;?\s*$/, '') + ' RETURNING id';
        finalSql = convertPlaceholders(finalSql);
        pgPool.query(finalSql, params).then(result => {
            const ctx = { lastID: needsReturning && result.rows[0] ? result.rows[0].id : undefined, changes: result.rowCount };
            cb && cb.call(ctx, null);
        }).catch(err => cb && cb(err));
    } else {
        sqliteDb.run(sql, params, function(err){ cb && cb.call(this, err); });
    }
}

function get(sql, params, cb) {
    if (typeof params === 'function') { cb = params; params = []; }
    params = params || [];
    if (driver === 'pg') {
        if (ignoreIfPg(sql)) return cb && cb(null, null);
        const finalSql = convertPlaceholders(sql);
        pgPool.query(finalSql, params).then(r => cb && cb(null, r.rows[0] || null)).catch(e => cb && cb(e));
    } else {
        sqliteDb.get(sql, params, cb);
    }
}

function all(sql, params, cb) {
    if (typeof params === 'function') { cb = params; params = []; }
    params = params || [];
    if (driver === 'pg') {
        if (ignoreIfPg(sql)) return cb && cb(null, []);
        const finalSql = convertPlaceholders(sql);
        pgPool.query(finalSql, params).then(r => cb && cb(null, r.rows)).catch(e => cb && cb(e));
    } else {
        sqliteDb.all(sql, params, cb);
    }
}

function close(cb) {
    if (driver === 'pg') {
        pgPool.end().then(() => cb && cb()).catch(e => cb && cb(e));
    } else if (sqliteDb) {
        sqliteDb.close(cb);
    } else cb && cb();
}

async function createSchema(resolve, reject) {
    const stmts = [
        `CREATE TABLE IF NOT EXISTS albums (
            id SERIAL PRIMARY KEY,
            release_id INTEGER UNIQUE,
            artist_name TEXT NOT NULL,
            album_title TEXT NOT NULL,
            release_year INTEGER,
            genre TEXT,
            style TEXT,
            label TEXT,
            cover_image_url TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS lists (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS list_items (
            id SERIAL PRIMARY KEY,
            list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
            album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
            position INTEGER NOT NULL,
            UNIQUE(list_id, album_id),
            UNIQUE(list_id, position)
        )`,
        `CREATE TABLE IF NOT EXISTS list_tags (
            id SERIAL PRIMARY KEY,
            list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
            tag TEXT NOT NULL,
            UNIQUE(list_id, tag)
        )`,
        `CREATE TABLE IF NOT EXISTS operation_logs (
            id SERIAL PRIMARY KEY,
            action TEXT NOT NULL,
            entity_type TEXT,
            entity_id INTEGER,
            info TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`
    ];
    if (driver === 'pg') {
        for (const s of stmts) { await pgPool.query(s); }
    } else {
        try {
            stmts.forEach(s => sqliteDb.run(s));
        } catch (e) {
            if (reject) return reject(e);
            throw e;
        }
    }
    if (resolve) resolve();
}

module.exports = { init, run, get, all, close, get driver(){ return driver; } };