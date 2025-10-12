import React from 'react';
import { Box, Paper, Tabs, Tab, Stack, TextField, Button, Typography, Alert, Checkbox, FormControlLabel, Snackbar, Chip, Collapse, IconButton } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { postJson } from '../api';

interface Props { onAdded?: () => void }

const AddAlbumsPanel: React.FC<Props> = ({ onAdded }) => {
  const [tab, setTab] = React.useState(0);
  const [masterId, setMasterId] = React.useState('');
  const [artist, setArtist] = React.useState('');
  const [title, setTitle] = React.useState('');
  const [bulk, setBulk] = React.useState('');
  const [pickFirst, setPickFirst] = React.useState(false);
  const [dryRun, setDryRun] = React.useState(false);
  const [result, setResult] = React.useState<any|null>(null); // utilisé surtout pour le bulk
  const [error, setError] = React.useState<string|null>(null);
  const [loading, setLoading] = React.useState(false);
  const [successMsg, setSuccessMsg] = React.useState<string|null>(null);
  const [showDetails, setShowDetails] = React.useState(false);

  async function addByMaster() {
    if (!masterId.trim()) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const idNum = parseInt(masterId, 10);
      if (isNaN(idNum)) throw new Error('masterId invalide');
      const r = await postJson('/api/albums', { masterId: idNum });
      setSuccessMsg(`Album ajouté (ID interne ${r.albumId})`);
      setMasterId('');
      onAdded && onAdded();
    } catch(e:any){ setError(e.error || e.message); } finally { setLoading(false); }
  }
  async function addByArtistTitle() {
    if (!artist.trim() || !title.trim()) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const r = await postJson('/api/albums/by-artist-title', { artist, title, pickFirst });
      if (r.albumId) {
        setSuccessMsg(`Album ajouté (master ${r.master_id})`);
        setArtist(''); setTitle('');
        onAdded && onAdded();
      } else {
        setResult(r); // improbable mais on conserve
      }
    } catch(e:any){ setError(e.error || e.message); } finally { setLoading(false); }
  }
  async function addBulk() {
    if (!bulk.trim()) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const r = await postJson('/api/albums/bulk', { lines: bulk, pickFirst, dryRun });
      setResult(r);
      if (!dryRun && r.added && r.added.length){
        setSuccessMsg(`${r.added.length} album(s) ajouté(s), ${r.duplicates.length} doublon(s), ${r.ambiguous.length} ambigu(s), ${r.notFound.length} introuvable(s)`);
        onAdded && onAdded();
      } else if (dryRun) {
        setSuccessMsg('Simulation réalisée');
      }
    } catch(e:any){ setError(e.error || e.message); } finally { setLoading(false); }
  }

  return (
    <Paper variant="outlined" sx={{ p:2, mb:3 }}>
      <Tabs value={tab} onChange={(_,v)=> setTab(v)} sx={{ mb:2 }}>
        <Tab label="Master ID" />
        <Tab label="Artiste + Titre" />
        <Tab label="Bulk" />
      </Tabs>
      {error && <Alert severity="error" sx={{ mb:2 }}>{error}</Alert>}
      {/* Ambiguïtés (409) pour artiste+titre */}
      {error === 'Ambigu' && result?.candidates && (
        <Alert severity="warning" sx={{ mb:2 }}>
          Plusieurs masters possibles:&nbsp;
          {result.candidates.map((c:any) => <Chip key={c.id} size="small" label={`${c.id} • ${c.title}${c.year? ' ('+c.year+')':''}`} sx={{ mr:0.5, mb:0.5 }} />)}
          {!pickFirst && <Typography variant="caption" sx={{ display:'block', mt:1 }}>Activez "Prendre le 1er" pour sélectionner automatiquement le premier.</Typography>}
        </Alert>
      )}
      {tab===0 && (
        <Stack direction={{ xs:'column', sm:'row' }} spacing={2}>
          <TextField label="masterId" value={masterId} onChange={e=> setMasterId(e.target.value)} size="small" />
          <Button variant="contained" disabled={loading} onClick={addByMaster}>Ajouter</Button>
        </Stack>
      )}
      {tab===1 && (
        <Stack spacing={2}>
          <Stack direction={{ xs:'column', sm:'row' }} spacing={2}>
            <TextField label="Artiste" value={artist} onChange={e=> setArtist(e.target.value)} size="small" fullWidth />
            <TextField label="Titre" value={title} onChange={e=> setTitle(e.target.value)} size="small" fullWidth />
          </Stack>
          <FormControlLabel control={<Checkbox checked={pickFirst} onChange={e=> setPickFirst(e.target.checked)} />} label="Prendre le 1er résultat si ambigu" />
          <Button variant="contained" disabled={loading} onClick={addByArtistTitle}>Rechercher & Ajouter</Button>
        </Stack>
      )}
      {tab===2 && (
        <Stack spacing={2}>
          <TextField label="Lignes (Artiste,Titre ou Artiste - Titre)" value={bulk} onChange={e=> setBulk(e.target.value)} size="small" multiline minRows={5} />
          <Stack direction={{ xs:'column', sm:'row' }} spacing={2}>
            <FormControlLabel control={<Checkbox checked={pickFirst} onChange={e=> setPickFirst(e.target.checked)} />} label="1er si ambigu" />
            <FormControlLabel control={<Checkbox checked={dryRun} onChange={e=> setDryRun(e.target.checked)} />} label="Simulation (dry-run)" />
          </Stack>
          <Button variant="contained" disabled={loading} onClick={addBulk}>{dryRun? 'Simuler':'Importer'}</Button>
        </Stack>
      )}
      {tab===2 && result && (
        <Box sx={{ mt:2 }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb:1 }}>
            <Typography variant="subtitle2">Résumé import</Typography>
            <Chip size="small" color={result.added?.length? 'success':'default'} label={`${result.added?.length||0} ajoutés`} />
            <Chip size="small" label={`${result.duplicates?.length||0} doublons`} />
            <Chip size="small" label={`${result.ambiguous?.length||0} ambigus`} />
            <Chip size="small" label={`${result.notFound?.length||0} introuvables`} />
            <IconButton size="small" onClick={()=> setShowDetails(s => !s)}>{showDetails ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}</IconButton>
          </Stack>
          <Collapse in={showDetails} timeout="auto" unmountOnExit>
            <pre style={{ fontSize:12, maxHeight:260, overflow:'auto', background:'#111', color:'#eee', padding:8 }}>{JSON.stringify(result, null, 2)}</pre>
          </Collapse>
        </Box>
      )}
      <Snackbar open={!!successMsg} autoHideDuration={3500} onClose={()=> setSuccessMsg(null)}
        message={successMsg}
        action={
          <IconButton size="small" aria-label="close" color="inherit" onClick={()=> setSuccessMsg(null)}>
            <CloseIcon fontSize="small" />
          </IconButton>
        }
      />
    </Paper>
  );
};

export default AddAlbumsPanel;
