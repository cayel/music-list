import React from 'react';
import { apiFetch, postJson, putJson, deleteReq } from '../api'; // helpers centralisés
import { Box, Typography, Card, CardContent, CardHeader, Chip, Stack, IconButton, Tooltip, Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Divider, CircularProgress, RadioGroup, FormControlLabel, Radio, TableContainer, Table, TableHead, TableRow, TableCell, TableBody, Paper, MenuItem, Select, FormControl, InputLabel, Snackbar, Alert, useMediaQuery, TablePagination, Fade, Grid } from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import TagIcon from '@mui/icons-material/SellOutlined';
import FilterAltIcon from '@mui/icons-material/FilterAlt';
import CloseIcon from '@mui/icons-material/Close';

// -- Types standard lists
interface RankedListSummary { id: number; name: string; description?: string | null; created_at?: string; item_count?: number; tags?: string[]; }
interface RankedListItem { list_item_id: number; position: number; id: number; album_title: string; artist_name: string; release_year: number | null; cover_image_url?: string | null; }
interface RankedListDetails extends RankedListSummary { items: RankedListItem[]; }

// -- Types smart lists
interface SmartListSummary { id:number; name:string; description?:string|null; created_at?:string; }
interface SmartListDetails { id:number; name:string; description?:string|null; criteria:any; count:number; items:any[]; }
interface Criteria { genreIncludes?:string[]; genreExcludes?:string[]; styleIncludes?:string[]; styleExcludes?:string[]; yearMin?:number; yearMax?:number; limit?:number; }
const emptyCriteria: Criteria = { genreIncludes:[], genreExcludes:[], styleIncludes:[], styleExcludes:[], limit:200 };

type ActiveDetails = { type:'ranked'; data: RankedListDetails } | { type:'smart'; data: SmartListDetails };
type EditingEntity = { type:'ranked'; data: RankedListSummary } | { type:'smart'; data: SmartListSummary } | null;

const chipInputSplit = (val:string) => val.split(/[,;\n]/).map(s=>s.trim()).filter(Boolean);

const ListsUnifiedPage: React.FC = () => {
  // plus de tabs visuels, on affiche toutes les listes dans un tableau; filtre type facultatif
  const [typeFilter, setTypeFilter] = React.useState<'all'|'ranked'|'smart'>('all');
  const [rankedLists, setRankedLists] = React.useState<RankedListSummary[]|null>(null);
  const [smartLists, setSmartLists] = React.useState<SmartListSummary[]|null>(null);
  const [loadingRanked, setLoadingRanked] = React.useState(false);
  const [loadingSmart, setLoadingSmart] = React.useState(false);
  const [error, setError] = React.useState<string|null>(null);
  const [active, setActive] = React.useState<ActiveDetails|null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<EditingEntity>(null);
  const [newType, setNewType] = React.useState<'ranked'|'smart'>('ranked');
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [criteria, setCriteria] = React.useState<Criteria>(emptyCriteria);
  const [criteriaText, setCriteriaText] = React.useState<{[k:string]:string}>({ genreIncludes:'', genreExcludes:'', styleIncludes:'', styleExcludes:'' });
  const [saving, setSaving] = React.useState(false);
  const [filter, setFilter] = React.useState('');
  const [loadingDetails, setLoadingDetails] = React.useState(false);
  const [confirmTarget, setConfirmTarget] = React.useState<{ type:'ranked'|'smart'; id:number; name:string }|null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [studioDialog, setStudioDialog] = React.useState(false);
  const [studioArtist, setStudioArtist] = React.useState('');
  const [generatingStudio, setGeneratingStudio] = React.useState(false);
  const [snack, setSnack] = React.useState<{open:boolean; message:string; severity:'success'|'error'}>({ open:false, message:'', severity:'success' });
  const [page, setPage] = React.useState(0);
  const [rowsPerPage, setRowsPerPage] = React.useState(25);
  const [scrolled, setScrolled] = React.useState(false);

  // Loaders
  const loadRanked = React.useCallback(()=> {
    setLoadingRanked(true);
  apiFetch<RankedListSummary[]>('/api/lists').then((d)=>{ setRankedLists(d); setLoadingRanked(false); }).catch((e:Error)=> { setError(e.message); setLoadingRanked(false); });
  }, []);
  const loadSmart = React.useCallback(()=> {
    setLoadingSmart(true);
  apiFetch<SmartListSummary[]>('/api/smart-lists').then((d)=>{ setSmartLists(d); setLoadingSmart(false); }).catch((e:Error)=> { setError(e.message); setLoadingSmart(false); });
  }, []);
  React.useEffect(()=> { loadRanked(); loadSmart(); }, [loadRanked, loadSmart]);

  function openCreate() {
    setEditing(null); setNewType('ranked'); setName(''); setDescription(''); setCriteria(emptyCriteria); setCriteriaText({ genreIncludes:'', genreExcludes:'', styleIncludes:'', styleExcludes:'' }); setDialogOpen(true);
  }
  function openStudio() { setStudioArtist(''); setStudioDialog(true); }
  function openEditRanked(l:RankedListSummary) { setEditing({ type:'ranked', data:l }); setNewType('ranked'); setName(l.name); setDescription(l.description||''); setDialogOpen(true); }
  function openEditSmart(l:SmartListSummary) { setEditing({ type:'smart', data:l }); setNewType('smart'); setName(l.name); setDescription(l.description||''); // need criteria
    loadSmartDetails(l.id, true, () => setDialogOpen(true)); }
  function closeDialog() { if(!saving) setDialogOpen(false); }

  function syncCriteriaTextToState() {
    setCriteria(c => ({ ...c, genreIncludes: chipInputSplit(criteriaText.genreIncludes), genreExcludes: chipInputSplit(criteriaText.genreExcludes), styleIncludes: chipInputSplit(criteriaText.styleIncludes), styleExcludes: chipInputSplit(criteriaText.styleExcludes) }));
  }
  React.useEffect(()=> { syncCriteriaTextToState(); /* eslint-disable-next-line */ }, [criteriaText.genreIncludes, criteriaText.genreExcludes, criteriaText.styleIncludes, criteriaText.styleExcludes]);

  async function submitForm(e:React.FormEvent) {
    e.preventDefault(); if(!name.trim()) return;
    // Construire critères localement pour éviter la latence de setState asynchrone
    let finalCriteria = criteria;
    if(newType==='smart') {
      finalCriteria = {
        ...criteria,
        genreIncludes: chipInputSplit(criteriaText.genreIncludes),
        genreExcludes: chipInputSplit(criteriaText.genreExcludes),
        styleIncludes: chipInputSplit(criteriaText.styleIncludes),
        styleExcludes: chipInputSplit(criteriaText.styleExcludes)
      };
    }
    setSaving(true); setError(null);
    try {
      if (editing) {
        if (editing.type==='ranked') {
          await putJson(`/api/lists/${editing.data.id}`, { name: name.trim(), description: description.trim()||null });
        } else {
          const payload = { name: name.trim(), description: description.trim()||null, criteria: finalCriteria };
            await putJson(`/api/smart-lists/${editing.data.id}`, payload);
        }
      } else {
        if (newType==='ranked') {
          await postJson('/api/lists', { name: name.trim(), description: description.trim()||null });
        } else {
          const payload = { name: name.trim(), description: description.trim()||null, criteria: finalCriteria };
          await postJson('/api/smart-lists', payload);
        }
      }
      setDialogOpen(false); loadRanked(); loadSmart(); if(active) { // refresh details if same id
        if(active.type==='ranked') loadRankedDetails(active.data.id, true); else loadSmartDetails(active.data.id, true);
      }
    } catch(e:any) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function loadRankedDetails(id:number, silent=false) {
    if(!silent) { setLoadingDetails(true); }
  try { const data = await apiFetch(`/api/lists/${id}`); setActive({ type:'ranked', data }); } catch(e:any){ setError(e.message); }
    if(!silent) setLoadingDetails(false);
  }
  async function loadSmartDetails(id:number, silent=false, after?:()=>void) {
    if(!silent) { setLoadingDetails(true); }
  try { const data = await apiFetch(`/api/smart-lists/${id}`);
      setActive({ type:'smart', data });
      if(editing && editing.type==='smart' && editing.data.id===id) {
        const c = data.criteria || {}; setCriteria({ ...emptyCriteria, ...c }); setCriteriaText({
          genreIncludes: (c.genreIncludes||[]).join(', '),
          genreExcludes: (c.genreExcludes||[]).join(', '),
          styleIncludes: (c.styleIncludes||[]).join(', '),
          styleExcludes: (c.styleExcludes||[]).join(', ')
        });
      }
    } catch(e:any){ setError(e.message); }
    if(!silent) setLoadingDetails(false); if(after) after();
  }

  async function deleteEntity(entity: { type:'ranked'; id:number } | { type:'smart'; id:number }) {
    const endpoint = entity.type==='ranked'? `/api/lists/${entity.id}` : `/api/smart-lists/${entity.id}`;
    setDeleting(true);
    try {
  await deleteReq(endpoint);
      if(active) {
        if((active.type==='ranked' && active.data.id===entity.id) || (active.type==='smart' && active.data.id===entity.id)) setActive(null);
      }
      loadRanked(); loadSmart();
    } catch(e:any) { setError(e.message); }
    finally { setDeleting(false); setConfirmTarget(null); }
  }

  function updateCriteriaField<K extends keyof Criteria>(key:K, value:Criteria[K]) { setCriteria(c => ({ ...c, [key]: value })); }

  const rankedFiltered = rankedLists?.filter(l => !filter || l.name.toLowerCase().includes(filter.toLowerCase()) || (l.tags||[]).some(t => t.includes(filter.toLowerCase())) ) || [];
  const smartFiltered = smartLists?.filter(l => !filter || l.name.toLowerCase().includes(filter.toLowerCase())) || [];
  // Construction d'une vue unifiée pour table
  const unified = React.useMemo(() => {
    const base: { id:number; type:'ranked'|'smart'; name:string; description?:string|null; created_at?:string; count?: number | null; tags?: string[] }[] = [];
    (rankedLists||[]).forEach(l => base.push({ id:l.id, type:'ranked', name:l.name, description:l.description, created_at:l.created_at, count:l.item_count??null, tags:l.tags }));
    (smartLists||[]).forEach(l => base.push({ id:l.id, type:'smart', name:l.name, description:l.description, created_at:l.created_at, count: null }));
    return base;
  }, [rankedLists, smartLists]);
  const unifiedFiltered = unified
    .filter(r => (
      (typeFilter==='all' || r.type===typeFilter) && (
        !filter || r.name.toLowerCase().includes(filter.toLowerCase()) || (r.tags||[]).some(t => t.toLowerCase().includes(filter.toLowerCase()))
      )
    ))
    .sort((a,b)=> a.name.localeCompare(b.name, 'fr'));
  React.useEffect(()=> { // reset page si out of range
    const maxPage = Math.max(0, Math.ceil(unifiedFiltered.length / rowsPerPage) - 1);
    if(page > maxPage) setPage(0);
  }, [unifiedFiltered.length, rowsPerPage, page]);
  const paginatedRows = unifiedFiltered.slice(page*rowsPerPage, page*rowsPerPage + rowsPerPage);

  return (
    <Box>
      <Box sx={{ display:'flex', alignItems:'center', mb:1.5, gap:2, flexWrap:'wrap' }}>
        <Typography variant="h5" sx={{ fontWeight:700, mr:1 }}>Listes</Typography>
        <FormControl size="small" sx={{ minWidth:150 }}>
          <InputLabel>Type</InputLabel>
          <Select label="Type" value={typeFilter} onChange={e=> setTypeFilter(e.target.value as any)}>
            <MenuItem value="all">Tous</MenuItem>
            <MenuItem value="ranked">Classées</MenuItem>
            <MenuItem value="smart">Intelligentes</MenuItem>
          </Select>
        </FormControl>
        <TextField size="small" label="Recherche" value={filter} onChange={e=>setFilter(e.target.value)} sx={{ minWidth:260 }} />
        <Box sx={{ flexGrow:1 }} />
        <Button startIcon={<AddIcon />} variant="contained" size="small" onClick={openCreate}>Nouvelle</Button>
        <Button variant="outlined" size="small" onClick={openStudio}>Générer studio</Button>
      </Box>
      {error && <Typography color="error" variant="body2" sx={{ mb:1 }}>{error}</Typography>}
      {/* Zone principale avec panneau latéral animé */}
  <Box sx={{ position:'relative' }}>
        <Paper elevation={4} sx={{ borderRadius:3, overflow:'hidden', background: (theme)=> `linear-gradient(180deg, ${alpha(theme.palette.background.paper, 0.85)} 0%, ${theme.palette.background.paper} 120%)`, backdropFilter:'blur(4px)', display:'flex', flexDirection:'column', boxShadow:(theme)=> `0 4px 16px -4px ${alpha(theme.palette.common.black,0.3)}` }}>
          <TableContainer onScroll={e=> setScrolled((e.target as HTMLDivElement).scrollTop>4)} sx={{ maxHeight:'65vh' }}>
            <Table stickyHeader size="small" sx={{ '& tbody tr.Mui-selected': { background:(theme)=> alpha(theme.palette.primary.light,0.18) }, '& tbody tr:hover': { background:(theme)=> alpha(theme.palette.primary.light,0.08) } }}>
              <TableHead>
                <TableRow sx={{ '& th': { fontSize:12, fontWeight:700, textTransform:'uppercase', letterSpacing:'.5px', background:(theme)=> theme.palette.background.paper, borderBottom:(theme)=>`1px solid ${alpha(theme.palette.divider,0.6)}` }, boxShadow: scrolled? (theme)=>`0 2px 4px -2px ${alpha(theme.palette.common.black,0.35)}`: 'none', transition:'box-shadow .25s' }}>
                  <TableCell sx={{ width:36 }}></TableCell>
                  <TableCell>Nom</TableCell>
                  <TableCell sx={{ width:120 }}>Type</TableCell>
                  <TableCell>Description</TableCell>
                  <TableCell sx={{ width:110, textAlign:'right' }}>Albums</TableCell>
                  <TableCell sx={{ width:120 }}>Création</TableCell>
                  <TableCell sx={{ width:140 }}>Tags</TableCell>
                  <TableCell sx={{ width:110 }}></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(loadingRanked || loadingSmart) && !unified.length && <TableRow><TableCell colSpan={8} sx={{ textAlign:'center', py:6 }}><CircularProgress size={26} /></TableCell></TableRow>}
                {!loadingRanked && !loadingSmart && !unifiedFiltered.length && <TableRow><TableCell colSpan={8}><Typography variant="body2" color="text.secondary">Aucune liste</Typography></TableCell></TableRow>}
                {paginatedRows.map(row => {
                  const selected = active && active.data.id===row.id && active.type===row.type;
                  return (
                    <TableRow key={`${row.type}-${row.id}`} hover selected={!!selected} onClick={()=> row.type==='ranked'? loadRankedDetails(row.id): loadSmartDetails(row.id)} sx={{ cursor:'pointer', transition:'background-color .2s' }}>
                      <TableCell sx={{ fontSize:12, opacity:0.55, fontWeight:600 }}>{row.type==='ranked'? 'R':'S'}</TableCell>
                      <TableCell sx={{ fontWeight:600 }}>{row.name}</TableCell>
                      <TableCell><Chip size="small" label={row.type==='ranked'? 'Classée':'Smart'} color={row.type==='ranked'? 'default':'primary'} variant={row.type==='ranked'? 'outlined':'filled'} /></TableCell>
                      <TableCell sx={{ maxWidth:320 }}><Typography variant="body2" noWrap title={row.description||''}>{row.description||'—'}</Typography></TableCell>
                      <TableCell sx={{ textAlign:'right', fontVariantNumeric:'tabular-nums' }}>{row.count ?? (row.type==='smart'? '—':'')}</TableCell>
                      <TableCell>{row.created_at ? new Date(row.created_at).toLocaleDateString() : ''}</TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={0.5} sx={{ flexWrap:'wrap' }}>
                          {(row.tags||[]).slice(0,3).map(t => <Chip key={t} size="small" label={t} variant="outlined" />)}
                          {(row.tags||[]).length>3 && <Chip size="small" label={`+${(row.tags||[]).length-3}`} />}
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display:'flex', gap:0.5 }} onClick={e=> e.stopPropagation()}>
                          <Tooltip title="Modifier"><IconButton size="small" onClick={()=> row.type==='ranked'? openEditRanked(rankedLists!.find(l=>l.id===row.id)!): openEditSmart(smartLists!.find(s=>s.id===row.id)!)}><EditIcon fontSize="inherit" /></IconButton></Tooltip>
                          <Tooltip title="Supprimer"><IconButton size="small" color="error" onClick={()=> setConfirmTarget({ type:row.type, id:row.id, name:row.name })}><DeleteIcon fontSize="inherit" /></IconButton></Tooltip>
                        </Box>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePagination component="div" count={unifiedFiltered.length} page={page} onPageChange={(_,p)=> setPage(p)} rowsPerPage={rowsPerPage} onRowsPerPageChange={e=> { setRowsPerPage(parseInt(e.target.value,10)); setPage(0); }} rowsPerPageOptions={[10,25,50,100]} labelRowsPerPage="Lignes par page" sx={{ borderTop:(theme)=>`1px solid ${alpha(theme.palette.divider,0.5)}`, '.MuiTablePagination-selectLabel, .MuiTablePagination-displayedRows': { fontSize:12 } }} />
        </Paper>
        {/* Panneau de détail coulissant */}
        <DetailOverlay active={active} loadingDetails={loadingDetails} onClose={()=> setActive(null)} openEditRanked={openEditRanked} openEditSmart={openEditSmart} setConfirmTarget={setConfirmTarget} />
      </Box>

      <Dialog open={dialogOpen} onClose={closeDialog} fullWidth maxWidth={newType==='smart'? 'md':'sm'} component="form" onSubmit={submitForm}>
        <DialogTitle>{editing ? (editing.type==='ranked'? 'Modifier la liste':'Modifier la liste intelligente') : 'Nouvelle liste'}</DialogTitle>
        <DialogContent dividers sx={{ display:'flex', flexDirection:'column', gap:2, mt:1 }}>
          {error && <Alert severity="error" variant="outlined">{error}</Alert>}
          {!editing && <RadioGroup row value={newType} onChange={e=> setNewType(e.target.value as 'ranked'|'smart')}>
            <FormControlLabel value="ranked" control={<Radio />} label="Classée" />
            <FormControlLabel value="smart" control={<Radio />} label="Intelligente" />
          </RadioGroup>}
          <Stack direction={{ xs:'column', sm:'row' }} spacing={2}>
            <TextField label="Nom" required fullWidth value={name} onChange={e=>setName(e.target.value)} />
            <TextField label="Description" fullWidth value={description} onChange={e=>setDescription(e.target.value)} />
          </Stack>
          {newType==='smart' && <>
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
            <Typography variant="caption" color="text.secondary">Les listes intelligentes sont recalculées à l'ouverture.</Typography>
          </>}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog} disabled={saving}>Annuler</Button>
          <Button type="submit" variant="contained" disabled={saving || !name.trim()}>{saving? '...' : (editing ? 'Enregistrer' : 'Créer')}</Button>
        </DialogActions>
      </Dialog>
  <Dialog open={studioDialog} onClose={()=> !generatingStudio && setStudioDialog(false)} fullWidth maxWidth="xs" component="form" onSubmit={async e=> { e.preventDefault(); if(!studioArtist.trim()) return; setGeneratingStudio(true); setError(null); try { const data = await postJson('/api/lists/generate/studio', { artist: studioArtist.trim() }); setStudioDialog(false); setSnack({ open:true, message:`Liste créée: ${data.list?.name||'OK'}`, severity:'success' }); loadRanked(); } catch(e:any) { setSnack({ open:true, message:e.message, severity:'error' }); } finally { setGeneratingStudio(false); } }}>
        <DialogTitle>Génération liste albums studio</DialogTitle>
        <DialogContent dividers sx={{ display:'flex', flexDirection:'column', gap:2 }}>
          <TextField label="Artiste" autoFocus required value={studioArtist} onChange={e=> setStudioArtist(e.target.value)} helperText="Recherche locale (contient, insensible à la casse)" />
          <Typography variant="caption" color="text.secondary">Filtre heuristique: exclusion live / compilations / remix. La liste sera créée avec le tag "albums studio".</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={()=> setStudioDialog(false)} disabled={generatingStudio}>Annuler</Button>
          <Button type="submit" variant="contained" disabled={generatingStudio || !studioArtist.trim()}>{generatingStudio? 'Génération...' : 'Générer'}</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={!!confirmTarget} onClose={()=> deleting? null: setConfirmTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Confirmer la suppression</DialogTitle>
        <DialogContent>
          <Typography variant="body2">Supprimer définitivement la liste {confirmTarget?.name ? <strong>{confirmTarget.name}</strong> : ''} ({confirmTarget?.type === 'ranked' ? 'classée' : 'intelligente'}) ?</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={()=> setConfirmTarget(null)} disabled={deleting}>Annuler</Button>
            <Button color="error" variant="contained" onClick={()=> confirmTarget && deleteEntity(confirmTarget)} disabled={deleting}>{deleting? 'Suppression...' : 'Supprimer'}</Button>
        </DialogActions>
      </Dialog>
      <Snackbar open={snack.open} autoHideDuration={4000} onClose={()=> setSnack(s=>({...s, open:false}))} anchorOrigin={{ vertical:'bottom', horizontal:'right' }}>
        <Alert onClose={()=> setSnack(s=>({...s, open:false}))} severity={snack.severity} variant="filled" sx={{ boxShadow:3 }}>
          {snack.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

// --- Panneau détaillé animé ---
interface DetailPanelProps {
  active: ActiveDetails|null;
  loadingDetails: boolean;
  onClose: ()=>void;
  openEditRanked: (l:RankedListSummary)=>void;
  openEditSmart: (l:SmartListSummary)=>void;
  setConfirmTarget: React.Dispatch<React.SetStateAction<{ type:'ranked'|'smart'; id:number; name:string }|null>>;
}

const DetailOverlay: React.FC<DetailPanelProps> = ({ active, loadingDetails, onClose, openEditRanked, openEditSmart, setConfirmTarget }) => {
  const theme = useTheme();
  const isSmall = useMediaQuery(theme.breakpoints.down('md'));
  React.useEffect(()=> {
    function onKey(e:KeyboardEvent){ if(e.key==='Escape' && active) onClose(); }
    window.addEventListener('keydown', onKey); return ()=> window.removeEventListener('keydown', onKey);
  }, [active, onClose]);
  if(!active) return null;
  return (
    <>
      <Fade in timeout={200}><Box onClick={onClose} sx={{ position:'fixed', inset:0, bgcolor:'rgba(0,0,0,0.35)', backdropFilter:'blur(2px)', zIndex: theme.zIndex.drawer + 1 }} /></Fade>
      <Box aria-label="Détails liste" sx={{ position:'fixed', top:0, right:0, height:'100vh', width:{ xs:'100%', sm:520 }, zIndex:(t)=> t.zIndex.drawer + 2, display:'flex', flexDirection:'column' }}>
        <Card elevation={8} sx={{ flex:1, borderRadius:0, display:'flex', flexDirection:'column', background:(t)=> `linear-gradient(155deg, ${t.palette.background.paper} 0%, ${t.palette.background.default} 140%)` }}>
          <CardHeader title={active.data.name} subheader={active.data.description} action={<Box sx={{ display:'flex', alignItems:'center', gap:0.5 }}>
            {active.type==='ranked' && <Tooltip title="Modifier"><IconButton size="small" onClick={()=> openEditRanked(active.data as RankedListSummary)}><EditIcon fontSize="small" /></IconButton></Tooltip>}
            {active.type==='smart' && <Tooltip title="Modifier"><IconButton size="small" onClick={()=> openEditSmart(active.data as SmartListSummary)}><EditIcon fontSize="small" /></IconButton></Tooltip>}
            <Tooltip title="Supprimer"><IconButton size="small" color="error" onClick={()=> setConfirmTarget({ type:active.type, id: active.data.id, name: active.data.name })}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
            <Tooltip title="Fermer"><IconButton size="small" onClick={onClose}><CloseIcon fontSize="small" /></IconButton></Tooltip>
          </Box>} />
          <Divider />
          <CardContent sx={{ flexGrow:1, overflowY:'auto', position:'relative', px: isSmall? 2:3 }}>
            {active.type==='smart' && loadingDetails && <Box sx={{ display:'flex', justifyContent:'center', py:4 }}><CircularProgress size={32} /></Box>}
            {active.type==='ranked' && !loadingDetails && <Stack spacing={1}>
              {(active.data as RankedListDetails).items.map(item => (
                <Box key={item.list_item_id} sx={{ display:'flex', alignItems:'center', gap:2 }}>
                  <Typography variant="caption" sx={{ width:24, textAlign:'right', opacity:0.6 }}>{item.position}</Typography>
                  <Box sx={{ width:48, height:48, flexShrink:0, borderRadius:1, bgcolor:'background.default', overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center' }}>
                    {item.cover_image_url ? <img src={item.cover_image_url} alt={item.album_title} style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : <Typography variant="caption">—</Typography>}
                  </Box>
                  <Box sx={{ flexGrow:1 }}>
                    <Typography variant="body2" fontWeight={500}>{item.album_title}</Typography>
                    <Typography variant="caption" color="text.secondary">{item.artist_name} {item.release_year ? `• ${item.release_year}` : ''}</Typography>
                  </Box>
                </Box>
              ))}
              {! (active.data as RankedListDetails).items.length && <Typography variant="body2" color="text.secondary">Liste vide.</Typography>}
            </Stack>}
            {active.type==='smart' && !loadingDetails && <Stack spacing={1}>
              <Typography variant="subtitle2" sx={{ mb:1 }}>Résultats {(active.data as SmartListDetails).count ? `(${(active.data as SmartListDetails).count})` : ''}</Typography>
              {(active.data as SmartListDetails).items.map(it => (
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
              {! (active.data as SmartListDetails).items.length && <Typography variant="body2" color="text.secondary">Aucun album.</Typography>}
            </Stack>}
          </CardContent>
        </Card>
      </Box>
    </>
  );
};

export default ListsUnifiedPage;
