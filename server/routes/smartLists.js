const db = require('../db');

function buildSmartListWhere(criteria, params, driver){
  const where=[]; const likeList=(field,values,pos=true)=>{ const parts=[]; values.forEach(v=>{ parts.push(`lower(${field}) LIKE ?`); params.push(`%${v.toLowerCase()}%`); }); if(!parts.length) return; const clause='('+parts.join(' OR ')+')'; where.push(pos? clause: 'NOT '+clause); };
  if (criteria.genreIncludes?.length) likeList('genre', criteria.genreIncludes, true);
  if (criteria.genreExcludes?.length) likeList('genre', criteria.genreExcludes, false);
  if (criteria.styleIncludes?.length) likeList('style', criteria.styleIncludes, true);
  if (criteria.styleExcludes?.length) likeList('style', criteria.styleExcludes, false);
  if (Number.isInteger(criteria.yearMin)) { where.push('(release_year IS NOT NULL AND release_year >= ?)'); params.push(criteria.yearMin); }
  if (Number.isInteger(criteria.yearMax)) { where.push('(release_year IS NOT NULL AND release_year <= ?)'); params.push(criteria.yearMax); }
  return where.length? 'WHERE '+where.join(' AND '): '';
}

module.exports = (app, logOperation, driver) => {
  app.get('/api/smart-lists', (req,res)=>{
    db.all('SELECT id, name, description, created_at FROM smart_lists ORDER BY created_at DESC', (err,rows)=> err? res.status(500).json({ error:err.message }): res.json(rows||[]));
  });

  app.post('/api/smart-lists', (req,res)=>{
    const { name, description, criteria } = req.body||{};
    if (!name || typeof name !== 'string') return res.status(400).json({ error:'name requis' });
    if (!criteria || typeof criteria !== 'object') return res.status(400).json({ error:'criteria requis' });
    const allowed=['genreIncludes','genreExcludes','styleIncludes','styleExcludes','yearMin','yearMax','limit']; const sanitized={};
    for (const k of allowed) if(criteria[k]!==undefined) sanitized[k]=criteria[k];
    if (sanitized.yearMin!==undefined && !Number.isInteger(sanitized.yearMin)) delete sanitized.yearMin;
    if (sanitized.yearMax!==undefined && !Number.isInteger(sanitized.yearMax)) delete sanitized.yearMax;
    if (sanitized.limit!==undefined && !Number.isInteger(sanitized.limit)) delete sanitized.limit;
    let criteriaJson; try { criteriaJson = JSON.stringify(sanitized); } catch { return res.status(400).json({ error:'criteria JSON invalide'}); }
    db.run('INSERT INTO smart_lists (name, description, criteria_json) VALUES (?,?,?)',[name.trim(), description||null, criteriaJson], function(err){
      if (err) return res.status(500).json({ error:err.message });
      const newId = this.lastID; logOperation('smart_list.add','smart_list', newId, { name });
      db.get('SELECT id, name, description, created_at FROM smart_lists WHERE id=?',[newId], (gErr,row)=>{ if(gErr) return res.status(500).json({ error:gErr.message }); if(!row) return res.status(500).json({ error:'Créé mais introuvable' }); res.json(row); });
    });
  });

  app.get('/api/smart-lists/:id', (req,res)=>{
    const { id } = req.params;
    db.get('SELECT * FROM smart_lists WHERE id=?',[id], (err,row)=>{
      if (err) return res.status(500).json({ error:err.message }); if(!row) return res.status(404).json({ error:'Smart list non trouvée' });
      let criteria; try { criteria = JSON.parse(row.criteria_json); } catch { criteria = {}; }
      const params=[]; const where=buildSmartListWhere(criteria, params, driver);
      let limit = criteria && Number.isInteger(criteria.limit) ? criteria.limit : 500; if (limit>1000) limit=1000; if (limit<1) limit=1;
      const orderYear = driver==='pg'? 'a.release_year ASC NULLS LAST':'(CASE WHEN a.release_year IS NULL THEN 1 ELSE 0 END), a.release_year ASC';
      const sql = `SELECT a.*, (SELECT COUNT(*) FROM list_items li WHERE li.album_id=a.id) AS list_usage_count FROM albums a ${where} ORDER BY ${orderYear}, a.album_title ASC LIMIT ${limit}`;
      db.all(sql, params, (aErr, albumsRows)=> aErr? res.status(500).json({ error:aErr.message }): res.json({ id: row.id, name: row.name, description: row.description, criteria, count: albumsRows.length, items: albumsRows }));
    });
  });

  app.delete('/api/smart-lists/:id', (req,res)=>{
    const { id } = req.params;
    db.run('DELETE FROM smart_lists WHERE id=?',[id], function(err){
      if (err) return res.status(500).json({ error:err.message }); if(this.changes===0) return res.status(404).json({ error:'Smart list non trouvée' });
      logOperation('smart_list.delete','smart_list', id, null); res.json({ message:'Supprimée' });
    });
  });

  app.put('/api/smart-lists/:id', (req,res)=>{
    const { id } = req.params; const { name, description, criteria } = req.body||{};
    if (!name && !description && !criteria) return res.status(400).json({ error:'Aucun champ à mettre à jour' });
    const sets=[]; const params=[];
    if (name){ sets.push('name=?'); params.push(name.trim()); }
    if (description!==undefined){ sets.push('description=?'); params.push(description||null); }
    if (criteria){ try { const allowed=['genreIncludes','genreExcludes','styleIncludes','styleExcludes','yearMin','yearMax','limit']; const sanitized={}; for(const k of allowed) if(criteria[k]!==undefined) sanitized[k]=criteria[k]; if(sanitized.yearMin!==undefined && !Number.isInteger(sanitized.yearMin)) delete sanitized.yearMin; if(sanitized.yearMax!==undefined && !Number.isInteger(sanitized.yearMax)) delete sanitized.yearMax; if(sanitized.limit!==undefined && !Number.isInteger(sanitized.limit)) delete sanitized.limit; sets.push('criteria_json=?'); params.push(JSON.stringify(sanitized)); } catch { return res.status(400).json({ error:'criteria JSON invalide'});} }
    params.push(id);
    db.run(`UPDATE smart_lists SET ${sets.join(',')} WHERE id=?`, params, function(err){
      if (err) return res.status(500).json({ error:err.message }); if(this.changes===0) return res.status(404).json({ error:'Smart list non trouvée' });
      logOperation('smart_list.update','smart_list', id, { name, hasCriteria: !!criteria });
      db.get('SELECT id, name, description, created_at FROM smart_lists WHERE id=?',[id], (gErr,row)=> gErr? res.status(500).json({ error:gErr.message }): res.json({ message:'Mise à jour', list: row }));
    });
  });
};
