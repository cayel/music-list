import React from 'react';
import { apiFetch, postJson, putJson, deleteReq } from '../api';
import { Box, Typography, Grid, Card, CardActionArea, CardHeader, CardContent, Button, Stack, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Chip, IconButton, Tooltip, Divider, CircularProgress } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import FilterAltIcon from '@mui/icons-material/FilterAlt';

interface SmartListSummary { id:number; name:string; description?:string|null; created_at?:string; }
interface SmartListDetails { id:number; name:string; description?:string|null; criteria:any; count:number; items:any[]; }
interface Criteria { genreIncludes?:string[]; genreExcludes?:string[]; styleIncludes?:string[]; styleExcludes?:string[]; yearMin?:number; yearMax?:number; limit?:number; }

const emptyCriteria: Criteria = { genreIncludes:[], genreExcludes:[], styleIncludes:[], styleExcludes:[], limit:200 };

const chipInputSplit = (val:string) => val.split(/[,;\n]/).map(s=>s.trim()).filter(Boolean);

const SmartListsPage: React.FC = () => {
  const [lists, setLists] = React.useState<SmartListSummary[]|null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string|null>(null);
  const [active, setActive] = React.useState<SmartListDetails|null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<SmartListSummary|null>(null);
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [criteria, setCriteria] = React.useState<Criteria>(emptyCriteria);
  const [saving, setSaving] = React.useState(false);
  const [criteriaText, setCriteriaText] = React.useState<{[k:string]:string}>({ genreIncludes:'', genreExcludes:'', styleIncludes:'', styleExcludes:'' });
  const [filter, setFilter] = React.useState('');
  const [loadingDetails, setLoadingDetails] = React.useState(false);

  const loadLists = React.useCallback(()=>{
    setLoading(true); setError(null);
    apiFetch('/api/smart-lists')
      .then(data=> { setLists(data); setLoading(false); })
      .catch(e=> { setError(e.message); setLoading(false); });
  }, []);
  React.useEffect(()=>{ loadLists(); }, [loadLists]);

  function openCreate() {
    setEditing(null); setName(''); setDescription(''); setCriteria(emptyCriteria); setCriteriaText({ genreIncludes:'', genreExcludes:'', styleIncludes:'', styleExcludes:'' }); setDialogOpen(true);
  }
  function openEdit(l:SmartListSummary) {
    setEditing(l); setName(l.name); setDescription(l.description||'');
    // Charger détails pour récupérer critères
    loadDetails(l.id, true, ()=> setDialogOpen(true));
  }
  function closeDialog() { if(!saving) setDialogOpen(false); }

  function syncCriteriaTextToState() {
    setCriteria(c => ({ ...c, genreIncludes: chipInputSplit(criteriaText.genreIncludes), genreExcludes: chipInputSplit(criteriaText.genreExcludes), styleIncludes: chipInputSplit(criteriaText.styleIncludes), styleExcludes: chipInputSplit(criteriaText.styleExcludes) }));
  }
  React.useEffect(()=> { syncCriteriaTextToState(); /* eslint-disable-next-line */ }, [criteriaText.genreIncludes, criteriaText.genreExcludes, criteriaText.styleIncludes, criteriaText.styleExcludes]);

  async function submitForm(e:React.FormEvent) {
    e.preventDefault(); if(!name.trim()) return; syncCriteriaTextToState();
    setSaving(true);
    const payload = { name: name.trim(), description: description.trim()||null, criteria };
    try {
      if (editing) {
        await putJson(`/api/smart-lists/${editing.id}`, payload);
      } else {
        await postJson('/api/smart-lists', payload);
      }
      setDialogOpen(false); loadLists();
    } catch(e:any) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function loadDetails(id:number, silent=false, after?:()=>void) {
    if(!silent) { setActive(null); setLoadingDetails(true); }
    try {
      const data = await apiFetch(`/api/smart-lists/${id}`);
      setActive(data);
      if (editing && editing.id === id) {
        // rafraîchir critères dans le form si en édition
        const c = data.criteria || {};
        setCriteria({ ...emptyCriteria, ...c });
        setCriteriaText({
          genreIncludes: (c.genreIncludes||[]).join(', '),
          genreExcludes: (c.genreExcludes||[]).join(', '),
          styleIncludes: (c.styleIncludes||[]).join(', '),
            styleExcludes: (c.styleExcludes||[]).join(', ')
        });
      }
    } catch(e:any){ setError(e.message); }
    if(!silent) setLoadingDetails(false);
    if(after) after();
  }

  async function deleteList(id:number) {
    if(!window.confirm('Supprimer la liste intelligente ?')) return;
    try {
      await deleteReq(`/api/smart-lists/${id}`);
    } catch(e:any){ alert(e.message); return; }
    if(active && active.id === id) setActive(null);
    loadLists();
  }

  function updateCriteriaField<K extends keyof Criteria>(key:K, value:Criteria[K]) { setCriteria(c => ({ ...c, [key]: value })); }

  const filtered = lists?.filter(l => !filter || l.name.toLowerCase().includes(filter.toLowerCase())) || [];

  return (
    <Box>
      <Box sx={{ display:'flex', alignItems:'center', mb:2, gap:2, flexWrap:'wrap' }}>
        <Typography variant="h5" sx={{ fontWeight:700 }}>Listes intelligentes</Typography>
        <Button startIcon={<AddIcon />} variant="contained" size="small" onClick={openCreate}>Nouvelle</Button>
        <TextField size="small" label="Filtrer" value={filter} onChange={e=>setFilter(e.target.value)} />
      </Box>
      {loading && <Box sx={{ display:'flex', justifyContent:'center', py:4 }}><CircularProgress /></Box>}
      {error && <Typography color="error" variant="body2" sx={{ mb:2 }}>{error}</Typography>}
      <Grid container spacing={2}>
        <Grid item xs={12} md={active ? 5 : 12}>
          <Grid container spacing={2}>
            {filtered.map(sl => (
              <Grid item xs={12} sm={6} md={4} key={sl.id}>
                <Card variant={active?.id === sl.id ? 'outlined' : undefined}>
                  <CardActionArea onClick={()=> loadDetails(sl.id)}>
                    <CardHeader title={sl.name} subheader={sl.description||''} titleTypographyProps={{ variant:'subtitle1', fontWeight:600 }} sx={{ pb:0 }} />
                    <CardContent sx={{ pt:1 }}>
                      <Typography variant="caption" color="text.secondary">Créée {sl.created_at ? new Date(sl.created_at).toLocaleDateString() : ''}</Typography>
                    </CardContent>
                  </CardActionArea>
                  <Box sx={{ display:'flex', justifyContent:'flex-end', p:1, pt:0, gap:1 }}>
                    <Tooltip title="Modifier"><span><IconButton size="small" onClick={()=> openEdit(sl)}><EditIcon fontSize="small" /></IconButton></span></Tooltip>
                    <Tooltip title="Supprimer"><span><IconButton size="small" color="error" onClick={()=> deleteList(sl.id)}><DeleteIcon fontSize="small" /></IconButton></span></Tooltip>
                  </Box>
                </Card>
              </Grid>
            ))}
            {!loading && !filtered.length && <Grid item xs={12}><Typography variant="body2" color="text.secondary">Aucune liste</Typography></Grid>}
          </Grid>
        </Grid>
        {active && <Grid item xs={12} md={7}>
          <Card sx={{ height:'100%', display:'flex', flexDirection:'column' }}>
            <CardHeader title={active.name} subheader={active.description} action={<Button size="small" onClick={()=> setActive(null)}>Fermer</Button>} />
            <Divider />
            <CardContent sx={{ flexGrow:1, overflowY:'auto', maxHeight:'65vh' }}>
              {loadingDetails && <Box sx={{ display:'flex', justifyContent:'center', py:4 }}><CircularProgress size={32} /></Box>}
              {!loadingDetails && <>
                <Typography variant="subtitle2" sx={{ mb:1 }}>Résultats ({active.count})</Typography>
                <Stack spacing={1}>
                  {active.items.map(it => (
                    <Box key={it.id} sx={{ display:'flex', gap:2, alignItems:'center' }}>
                      <Box sx={{ width:54, height:54, flexShrink:0, borderRadius:1, overflow:'hidden', bgcolor:'background.default', display:'flex', alignItems:'center', justifyContent:'center' }}>
                        {it.cover_image_url ? <img src={it.cover_image_url} alt={it.album_title} style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : '🎵'}
                      </Box>
                      <Box sx={{ flexGrow:1 }}>
                        <Typography variant="body2" fontWeight={500} noWrap>{it.album_title}</Typography>
                        <Typography variant="caption" color="text.secondary" noWrap>{it.artist_name} {it.release_year?`• ${it.release_year}`:''}</Typography>
                      </Box>
                    </Box>
                  ))}
                  {!active.items.length && <Typography variant="body2" color="text.secondary">Aucun album.</Typography>}
                </Stack>
              </>}
            </CardContent>
          </Card>
        </Grid>}
      </Grid>

      <Dialog open={dialogOpen} onClose={closeDialog} fullWidth maxWidth="md" component="form" onSubmit={submitForm}>
        <DialogTitle>{editing ? 'Modifier la liste intelligente' : 'Nouvelle liste intelligente'}</DialogTitle>
        <DialogContent dividers sx={{ display:'flex', flexDirection:'column', gap:2, mt:1 }}>
          <Stack direction={{ xs:'column', sm:'row' }} spacing={2}>
            <TextField label="Nom" required fullWidth value={name} onChange={e=>setName(e.target.value)} />
            <TextField label="Description" fullWidth value={description} onChange={e=>setDescription(e.target.value)} />
          </Stack>
          <Divider textAlign="left"><FilterAltIcon fontSize="small" sx={{ mr:0.5 }} /> Critères</Divider>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6} md={3}><TextField label="Genres IN" value={criteriaText.genreIncludes} onChange={e=>setCriteriaText(t=>({...t, genreIncludes:e.target.value}))} helperText="Séparés par virgule" fullWidth /></Grid>
            <Grid item xs={12} sm={6} md={3}><TextField label="Genres OUT" value={criteriaText.genreExcludes} onChange={e=>setCriteriaText(t=>({...t, genreExcludes:e.target.value}))} helperText="Exclus" fullWidth /></Grid>
            <Grid item xs={12} sm={6} md={3}><TextField label="Styles IN" value={criteriaText.styleIncludes} onChange={e=>setCriteriaText(t=>({...t, styleIncludes:e.target.value}))} helperText="" fullWidth /></Grid>
            <Grid item xs={12} sm={6} md={3}><TextField label="Styles OUT" value={criteriaText.styleExcludes} onChange={e=>setCriteriaText(t=>({...t, styleExcludes:e.target.value}))} helperText="" fullWidth /></Grid>
            <Grid item xs={6} sm={3} md={2}><TextField label="Année min" type="number" value={criteria.yearMin ?? ''} onChange={e=> updateCriteriaField('yearMin', e.target.value ? parseInt(e.target.value,10): undefined)} fullWidth /></Grid>
            <Grid item xs={6} sm={3} md={2}><TextField label="Année max" type="number" value={criteria.yearMax ?? ''} onChange={e=> updateCriteriaField('yearMax', e.target.value ? parseInt(e.target.value,10): undefined)} fullWidth /></Grid>
            <Grid item xs={6} sm={3} md={2}><TextField label="Limite" type="number" value={criteria.limit ?? ''} onChange={e=> updateCriteriaField('limit', e.target.value ? parseInt(e.target.value,10): undefined)} fullWidth /></Grid>
          </Grid>
          <Typography variant="caption" color="text.secondary">Les listes sont recalculées lors de l'ouverture du détail.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog} disabled={saving}>Annuler</Button>
          <Button type="submit" variant="contained" disabled={saving || !name.trim()}>{saving? '...' : (editing ? 'Enregistrer' : 'Créer')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default SmartListsPage;
