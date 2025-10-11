const db = require('../db');

module.exports = (app, logOperation, helpers) => {
  app.get('/api/lists', (req,res)=>{
    const sql = `SELECT l.*, COUNT(li.id) as item_count FROM lists l LEFT JOIN list_items li ON l.id=li.list_id GROUP BY l.id ORDER BY l.created_at DESC`;
    db.all(sql, (err, rows)=>{
      if (err) return res.status(500).json({ error: err.message });
      db.all('SELECT list_id, tag FROM list_tags', (tErr, tagRows)=>{
        if (tErr) return res.status(500).json({ error:tErr.message });
        const tagMap={}; tagRows.forEach(r=>{ (tagMap[r.list_id]=tagMap[r.list_id]||[]).push(r.tag); });
        rows.forEach(r=> r.tags = tagMap[r.id]||[]);
        res.json(rows);
      });
    });
  });

  app.post('/api/lists', (req,res)=>{
    const { name, description } = req.body||{};
    if(!name) return res.status(400).json({ error:'Nom requis' });
    db.run('INSERT INTO lists (name, description) VALUES (?,?)',[name.trim(), description||null], function(err){
      if (err) return res.status(500).json({ error:err.message });
      db.get('SELECT * FROM lists WHERE id=?',[this.lastID], (gErr,row)=>{
        if (gErr) return res.status(500).json({ error:gErr.message });
        logOperation('list.add','list', row.id, null);
        res.json(row);
      });
    });
  });

  app.put('/api/lists/:id', (req,res)=>{
    const { id } = req.params; let { name, description } = req.body||{};
    if (name!==undefined) { name = name.trim(); if(!name) return res.status(400).json({ error:'Nom vide'}); }
    if (name===undefined && description===undefined) return res.status(400).json({ error:'Rien à mettre à jour' });
    const sets=[]; const vals=[];
    if (name!==undefined){ sets.push('name=?'); vals.push(name); }
    if (description!==undefined){ sets.push('description=?'); vals.push(description); }
    vals.push(id);
    db.run(`UPDATE lists SET ${sets.join(',')} WHERE id=?`, vals, function(err){
      if (err) return res.status(500).json({ error:err.message });
      if (this.changes===0) return res.status(404).json({ error:'Liste non trouvée' });
      db.get('SELECT * FROM lists WHERE id=?',[id], (gErr,row)=>{
        if (gErr) return res.status(500).json({ error:gErr.message });
        logOperation('list.update','list', id, { name, description });
        res.json({ message:'Liste mise à jour', list: row });
      });
    });
  });

  app.delete('/api/lists/:id', (req,res)=>{
    const { id } = req.params;
    db.run('DELETE FROM lists WHERE id=?',[id], function(err){
      if (err) return res.status(500).json({ error:err.message });
      if (this.changes===0) return res.status(404).json({ error:'Liste non trouvée' });
      logOperation('list.delete','list', id, null);
      res.json({ message:'Liste supprimée' });
    });
  });

  app.get('/api/lists/:id', (req,res)=>{
    const { id } = req.params;
    db.get('SELECT * FROM lists WHERE id=?',[id], (err,listRow)=>{
      if (err) return res.status(500).json({ error:err.message });
      if (!listRow) return res.status(404).json({ error:'Liste non trouvée' });
      const sqlItems = `SELECT li.id as list_item_id, li.position, a.* FROM list_items li JOIN albums a ON li.album_id=a.id WHERE li.list_id=? ORDER BY li.position ASC`;
      db.all(sqlItems,[id], (iErr,items)=>{
        if (iErr) return res.status(500).json({ error:iErr.message });
        db.all('SELECT tag FROM list_tags WHERE list_id=? ORDER BY tag ASC',[id], (tErr,trows)=>{
          if (tErr) return res.status(500).json({ error:tErr.message });
          res.json({ ...listRow, items, tags: trows.map(r=>r.tag) });
        });
      });
    });
  });

  app.post('/api/lists/:id/tags', (req,res)=>{
    const { id } = req.params; let { tag } = req.body||{};
    tag = (tag||'').trim().toLowerCase(); if (!tag) return res.status(400).json({ error:'Tag requis' }); if (tag.length>30) return res.status(400).json({ error:'Tag trop long' });
    db.get('SELECT id FROM lists WHERE id=?',[id], (err,row)=>{
      if (err) return res.status(500).json({ error:err.message }); if(!row) return res.status(404).json({ error:'Liste non trouvée' });
      db.run('INSERT INTO list_tags (list_id, tag) VALUES (?,?)',[id, tag], function(insErr){
        if (insErr){ if (insErr.message.includes('UNIQUE')) return res.status(409).json({ error:'Tag déjà présent' }); return res.status(500).json({ error:insErr.message }); }
        db.all('SELECT tag FROM list_tags WHERE list_id=? ORDER BY tag ASC',[id], (tErr,rows)=>{
          if (tErr) return res.status(500).json({ error:tErr.message });
          logOperation('tag.add','list', id, { tag });
          res.json({ message:'Tag ajouté', tags: rows.map(r=>r.tag) });
        });
      });
    });
  });

  app.delete('/api/lists/:id/tags/:tag', (req,res)=>{
    const { id, tag } = req.params; const norm = decodeURIComponent(tag).trim().toLowerCase();
    db.run('DELETE FROM list_tags WHERE list_id=? AND tag=?',[id,norm], function(err){
      if (err) return res.status(500).json({ error:err.message });
      if (this.changes===0) return res.status(404).json({ error:'Tag non trouvé' });
      db.all('SELECT tag FROM list_tags WHERE list_id=? ORDER BY tag ASC',[id], (tErr,rows)=>{
        if (tErr) return res.status(500).json({ error:tErr.message });
        logOperation('tag.delete','list', id, { tag:norm });
        res.json({ message:'Tag supprimé', tags: rows.map(r=>r.tag) });
      });
    });
  });

  app.post('/api/lists/:id/items', async (req,res)=>{
    const { id } = req.params; const { albumId, masterId } = req.body||{};
    if (!albumId && !masterId) return res.status(400).json({ error:'albumId ou masterId requis' });
    db.get('SELECT id FROM lists WHERE id=?',[id], async (lErr,listRow)=>{
      if (lErr) return res.status(500).json({ error:lErr.message }); if (!listRow) return res.status(404).json({ error:'Liste non trouvée' });
      try {
        let finalAlbumId = albumId; if(!finalAlbumId && masterId) finalAlbumId = await helpers.ensureAlbumByMaster(masterId);
        db.get('SELECT id FROM list_items WHERE list_id=? AND album_id=?',[id, finalAlbumId], (dupErr,existing)=>{
          if (dupErr) return res.status(500).json({ error:dupErr.message }); if (existing) return res.status(409).json({ error:'Album déjà dans la liste' });
          const insertSql = `INSERT INTO list_items (list_id, album_id, position) SELECT ?, ?, COALESCE(MAX(position),0)+1 FROM list_items WHERE list_id=?`;
          db.run(insertSql,[id, finalAlbumId, id], function(insErr){
            if (insErr){ if (/UNIQUE|duplicate key value/i.test(insErr.message)) return res.status(409).json({ error:'Album déjà dans la liste' }); return res.status(500).json({ error:insErr.message }); }
            db.get('SELECT * FROM list_items WHERE id=?',[this.lastID], (gErr,liRow)=>{
              if (gErr) return res.status(500).json({ error:gErr.message });
              logOperation('list_item.add','list', id, { item_id: liRow.id, album_id: finalAlbumId });
              res.json({ message:'Ajouté', item: liRow });
            });
          });
        });
      } catch(e){ if (e.response && e.response.status===404) return res.status(404).json({ error:'Master non trouvé' }); res.status(500).json({ error:e.message }); }
    });
  });

  app.put('/api/lists/:id/items/order', (req,res)=>{
    const { id } = req.params; const { order } = req.body||{};
    if (!Array.isArray(order)||!order.length) return res.status(400).json({ error:'order doit être un tableau non vide' });
    const normalized = order.map(o=>Number(o)); const seen=new Set(); const dedupOrder=[];
    for (const oid of normalized){ if(!Number.isFinite(oid)) return res.status(400).json({ error:`ID invalide: ${oid}`}); if(!seen.has(oid)){ seen.add(oid); dedupOrder.push(oid);} }
    const hadDuplicates = dedupOrder.length !== normalized.length;
    db.all('SELECT id FROM list_items WHERE list_id=? ORDER BY position ASC',[id], (err, allRows)=>{
      if (err) return res.status(500).json({ error:err.message }); if(!allRows.length) return res.status(404).json({ error:'Liste vide ou non trouvée' });
      const allIds = allRows.map(r=>r.id); const allSet=new Set(allIds);
      for (const oid of dedupOrder) if(!allSet.has(oid)) return res.status(400).json({ error:`Item ${oid} invalide pour cette liste`});
      const providedSet=new Set(dedupOrder); const tail= allIds.filter(x=>!providedSet.has(x)); const fullOrder=[...dedupOrder, ...tail]; const isPartial = fullOrder.length!==allIds.length;
      if (db.driver==='pg') {
        const sql = `WITH np AS ( SELECT unnest($1::int[]) AS id, generate_series(1, array_length($1::int[],1)) AS pos ) UPDATE list_items li SET position = np.pos FROM np WHERE li.id=np.id AND li.list_id=$2`;
        db.run(sql,[fullOrder, id], (uErr)=>{
          if (uErr) return res.status(500).json({ error:uErr.message });
          db.all('SELECT li.id as list_item_id, li.position, a.* FROM list_items li JOIN albums a ON li.album_id=a.id WHERE li.list_id=? ORDER BY li.position ASC',[id], (fErr,ordered)=>{
            if (fErr) return res.status(500).json({ error:fErr.message });
            logOperation('list_item.reorder','list', id, { count: ordered.length, partial: isPartial, dedup: hadDuplicates });
            res.json({ message:'Ordre mis à jour', items: ordered, partial: isPartial, dedup: hadDuplicates });
          });
        });
      } else {
        db.run('BEGIN TRANSACTION');
        let failed=false; let remainingNeg=fullOrder.length; let remainingPos=fullOrder.length;
        fullOrder.forEach((liId,idx)=>{
          db.run('UPDATE list_items SET position=? WHERE id=? AND list_id=?',[ -(idx+1), liId, id], (negErr)=>{
            if (failed) return; if (negErr){ failed=true; db.run('ROLLBACK'); return res.status(500).json({ error:negErr.message }); }
            remainingNeg--; if (remainingNeg===0){
              fullOrder.forEach((liId2, idx2)=>{
                db.run('UPDATE list_items SET position=? WHERE id=? AND list_id=?',[ idx2+1, liId2, id], (posErr)=>{
                  if (failed) return; if (posErr){ failed=true; db.run('ROLLBACK'); return res.status(500).json({ error:posErr.message }); }
                  remainingPos--; if (remainingPos===0){
                    db.run('COMMIT', (cErr)=>{
                      if (cErr){ db.run('ROLLBACK'); return res.status(500).json({ error:cErr.message }); }
                      db.all('SELECT li.id as list_item_id, li.position, a.* FROM list_items li JOIN albums a ON li.album_id=a.id WHERE li.list_id=? ORDER BY li.position ASC',[id], (fErr,ordered)=>{
                        if (fErr) return res.status(500).json({ error:fErr.message });
                        logOperation('list_item.reorder','list', id, { count: ordered.length, partial: isPartial, dedup: hadDuplicates });
                        res.json({ message:'Ordre mis à jour', items: ordered, partial: isPartial, dedup: hadDuplicates });
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

  app.delete('/api/lists/:id/items/:itemId', (req,res)=>{
    const { id, itemId } = req.params;
    db.run('DELETE FROM list_items WHERE id=? AND list_id=?',[itemId, id], function(err){
      if (err) return res.status(500).json({ error:err.message });
      if (this.changes===0) return res.status(404).json({ error:'Item non trouvé' });
      logOperation('list_item.delete','list', id, { item_id: itemId });
      res.json({ message:'Item supprimé' });
    });
  });
};
