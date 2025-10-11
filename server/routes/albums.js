const { fetchMaster, fetchRelease, mapMasterData, extractUniqueLabelsFromRelease } = require('../lib/discogs');
const db = require('../db');

function ensureAlbumByMaster(masterId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT id FROM albums WHERE master_id = ?', [masterId], async (err, row) => {
      if (err) return reject(err);
      if (row) return resolve(row.id);
      try {
        const data = await fetchMaster(masterId);
        const mapped = mapMasterData(data);
        if (data.main_release) {
          try {
            const rel = await fetchRelease(data.main_release);
            const lbl = extractUniqueLabelsFromRelease(rel);
            if (lbl) mapped.label = lbl;
          } catch {}
        }
        db.run(`INSERT INTO albums (master_id, artist_id, artist_name, album_title, release_year, genre, style, label, cover_image_url, updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
          [masterId, mapped.artist_id, mapped.artist_name, mapped.album_title, mapped.release_year, mapped.genre, mapped.style, mapped.label, mapped.cover_image_url],
          function(insErr){ return insErr? reject(insErr): resolve(this.lastID); });
      } catch(e){ reject(e); }
    });
  });
}

module.exports = (app, logOperation) => {
  app.get('/api/albums', (req,res)=>{
    const sql = `SELECT a.*, (SELECT COUNT(*) FROM list_items li WHERE li.album_id = a.id) AS list_usage_count FROM albums a ORDER BY a.created_at DESC`;
    db.all(sql, (err, rows)=> err? res.status(500).json({ error: err.message }): res.json(rows));
  });

  app.get('/api/albums/search', (req,res)=>{
    const q = (req.query.q||'').trim();
    if (q.length < 2) return res.json([]);
    const like = `%${q.replace(/%/g,'')}%`;
    const sql = `SELECT id, release_id, artist_name, album_title, release_year, cover_image_url FROM albums WHERE artist_name LIKE ? OR album_title LIKE ? ORDER BY artist_name ASC, album_title ASC LIMIT 25`;
    db.all(sql,[like, like], (err, rows)=> err? res.status(500).json({ error: err.message }): res.json(rows));
  });

  app.post('/api/albums', async (req,res)=>{
    const { masterId } = req.body||{};
    if (!masterId) return res.status(400).json({ error:'masterId requis' });
    try {
      const data = await fetchMaster(masterId);
      const mapped = mapMasterData(data);
      if (data.main_release) {
        try { const rel = await fetchRelease(data.main_release); const lbl = extractUniqueLabelsFromRelease(rel); if (lbl) mapped.label = lbl; } catch {}
      }
      db.run(`INSERT INTO albums (master_id, artist_id, artist_name, album_title, release_year, genre, style, label, cover_image_url, updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
        [masterId, mapped.artist_id, mapped.artist_name, mapped.album_title, mapped.release_year, mapped.genre, mapped.style, mapped.label, mapped.cover_image_url],
        function(errIns){
          if (errIns) { if (errIns.message.includes('UNIQUE')) return res.status(409).json({ error:'Album déjà présent' }); return res.status(500).json({ error: errIns.message }); }
          logOperation('album.add','album', this.lastID, { master_id: masterId, artist_id: mapped.artist_id });
          res.json({ message:'Album ajouté', albumId: this.lastID, albumData:{ master_id: masterId, artist_id: mapped.artist_id, ...mapped }});
        });
    } catch(e) { if (e.response && e.response.status===404) return res.status(404).json({ error:'Master non trouvé' }); res.status(500).json({ error:'Erreur Discogs' }); }
  });

  app.delete('/api/albums/:id', (req,res)=>{
    const { id } = req.params;
    db.get('SELECT COUNT(*) as cnt FROM list_items WHERE album_id=?',[id], (cErr,row)=>{
      if (cErr) return res.status(500).json({ error:cErr.message });
      if (row.cnt>0) return res.status(409).json({ error:`Album utilisé dans ${row.cnt} liste(s)` });
      db.run('DELETE FROM albums WHERE id=?',[id], function(dErr){
        if (dErr) return res.status(500).json({ error:dErr.message });
        if (this.changes===0) return res.status(404).json({ error:'Album non trouvé' });
        logOperation('album.delete','album', id, null);
        res.json({ message:'Album supprimé' });
      });
    });
  });

  app.patch('/api/albums/:id/refresh', (req,res)=>{
    const { id } = req.params;
    db.get('SELECT * FROM albums WHERE id=?',[id], async (err,row)=>{
      if (err) return res.status(500).json({ error:err.message });
      if (!row) return res.status(404).json({ error:'Album non trouvé' });
      if (!row.master_id) return res.status(400).json({ error:'master_id absent' });
      try {
        const data = await fetchMaster(row.master_id);
        const mapped = mapMasterData(data);
        if (data.main_release) { try { const rel = await fetchRelease(data.main_release); const lbl = extractUniqueLabelsFromRelease(rel); if (lbl) mapped.label = lbl; } catch {} }
        db.run(`UPDATE albums SET artist_id=?, artist_name=?, album_title=?, release_year=?, genre=?, style=?, label=?, cover_image_url=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
          [mapped.artist_id, mapped.artist_name, mapped.album_title, mapped.release_year, mapped.genre, mapped.style, mapped.label, mapped.cover_image_url, id],
          function(uErr){ if (uErr) return res.status(500).json({ error:uErr.message });
            db.get('SELECT * FROM albums WHERE id=?',[id], (gErr,updated)=>{
              if (gErr) return res.status(500).json({ error:gErr.message });
              logOperation('album.refresh','album', id, { master_id: row.master_id });
              res.json({ message:'Album rafraîchi', album: updated });
            });
          });
      } catch(e){ if (e.response && e.response.status===404) return res.status(404).json({ error:'Release non trouvée' }); res.status(500).json({ error:'Erreur lors du rafraîchissement' }); }
    });
  });

  return { ensureAlbumByMaster };
};
