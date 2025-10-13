const db = require('../db');

module.exports = (app, logOperation) => {
  app.post('/api/lists/generate/studio', async (req,res)=>{
    const { artist } = req.body||{}; const artistName=(artist||'').trim(); if(!artistName) return res.status(400).json({ error:'artist requis' });
    try {
      const like = `%${artistName.toLowerCase().replace(/%/g,'')}%`;
      const sql = `SELECT * FROM albums WHERE lower(artist_name) LIKE ?`;
      const rows = await new Promise((resolve,reject)=> db.all(sql,[like], (err,r)=> err? reject(err): resolve(r||[])));
      if(!rows.length) return res.status(404).json({ error:'Aucun album local pour cet artiste' });
      function isExcluded(title){
        if(!title) return false;
        const lc=title.toLowerCase();
        const normalized = lc.replace(/[^a-z0-9]+/g,' ').trim();
        if(!normalized) return false;
        const tokens = normalized.split(/\s+/);
        const tokenSet = new Set(tokens);
        // Phrases multi-mots
        const phraseList = ['best of','dj mix'];
        if (phraseList.some(p => normalized.includes(p))) return true;
        // Tokens simples
        const simple = ['live','remix','remastered','reissue','compilation','greatest','mix','single','ep','promo','anthology','collection'];
        if (simple.some(t => tokenSet.has(t))) return true;
        return false;
      }
      const filtered = rows.filter(r=> !isExcluded(r.album_title||''));
      if(!filtered.length) return res.status(404).json({ error:'Albums trouvés mais aucun ne passe le filtre studio' });
      filtered.sort((a,b)=>{ if(a.release_year && b.release_year && a.release_year!==b.release_year) return a.release_year-b.release_year; if(a.release_year && !b.release_year) return -1; if(!a.release_year && b.release_year) return 1; return (a.album_title||'').localeCompare(b.album_title||'','fr'); });
      const listName=`Album Studio ${artistName}`; const listDescription=`Discographie ${artistName} - Albums Studio`;
      const listId = await new Promise((resolve,reject)=> db.run('INSERT INTO lists (name, description) VALUES (?,?)',[listName, listDescription], function(err){ return err? reject(err): resolve(this.lastID); }));
      logOperation('list.add','list', listId, { generated:'studio.local', artist: artistName });
      await new Promise(r=> db.run('INSERT INTO list_tags (list_id, tag) VALUES (?,?)',[listId,'albums studio'], ()=> r()));
      const itemInsert='INSERT INTO list_items (list_id, album_id, position) VALUES (?,?,?)';
      for(let i=0;i<filtered.length;i++){
        const a=filtered[i]; await new Promise((resolve,reject)=> db.run(itemInsert,[listId,a.id,i+1], function(err){ return err? reject(err): resolve(); }));
        logOperation('list_item.add','list', listId, { album_id:a.id, position:i+1, generate:'studio.local' });
      }
      logOperation('list.generate.studio','list', listId, { artist: artistName, added: filtered.length, source:'local' });
      db.all('SELECT li.id as list_item_id, li.position, a.* FROM list_items li JOIN albums a ON li.album_id=a.id WHERE li.list_id=? ORDER BY li.position ASC',[listId], (liErr,items)=>{
        if (liErr) return res.status(500).json({ error:liErr.message });
        res.json({ message:'Liste studio générée (local)', list:{ id:listId, name:listName, description:listDescription, tags:['albums studio'], item_count: items.length }, items, meta:{ artist: artistName, added: items.length, source:'local' } });
      });
    } catch(e){ res.status(500).json({ error:e.message||'Erreur génération locale' }); }
  });
};
