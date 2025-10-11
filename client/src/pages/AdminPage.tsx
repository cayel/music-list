import React from 'react';
import { apiFetch, postJson } from '../api';
import { Box, Typography, TextField, Button, Stack, Paper, Grid, Divider, Chip, CircularProgress, Alert, IconButton, Tooltip } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import DownloadIcon from '@mui/icons-material/Download';
import UploadIcon from '@mui/icons-material/UploadFile';
import ScienceIcon from '@mui/icons-material/Science';
import CleaningServicesIcon from '@mui/icons-material/CleaningServices';
import AssignmentIcon from '@mui/icons-material/Assignment';

interface HealthResult { ok:boolean; tables:Record<string, boolean>; counts:Record<string, number>; timestamp:string; }
interface SystemResult { process:any; counts:any; db:any; recent?:any; app?:any; environment?:any; }
interface LogEntry { id:number; action:string; entity_type:string; entity_id:number|null; info:string|null; created_at:string; }

const AdminPage: React.FC = () => {
  const [adminToken, setAdminToken] = React.useState<string>(localStorage.getItem('ml-admin-token')||'');
  const [health, setHealth] = React.useState<HealthResult|null>(null);
  const [system, setSystem] = React.useState<SystemResult|null>(null);
  const [exportData, setExportData] = React.useState<any|null>(null);
  const [importFile, setImportFile] = React.useState<File|null>(null);
  const [importStatus, setImportStatus] = React.useState<string>('');
  const [logs, setLogs] = React.useState<LogEntry[]|null>(null);
  const [loading, setLoading] = React.useState<{health?:boolean; system?:boolean; export?:boolean; import?:boolean; logs?:boolean; rebuild?:boolean}>({});
  const [error, setError] = React.useState<string|null>(null);
  const [logsLimit, setLogsLimit] = React.useState(100);

  function persistToken() { localStorage.setItem('ml-admin-token', adminToken); }

  async function call(path:string, opts:RequestInit = {}) {
    setError(null);
    return apiFetch(path, opts);
  }

  async function loadHealth() { setLoading(l=>({...l,health:true})); try { setHealth(await call('/api/admin/health')); } catch(e:any){ setError(e.message);} finally { setLoading(l=>({...l,health:false})); } }
  async function loadSystem() { setLoading(l=>({...l,system:true})); try { setSystem(await call('/api/admin/system')); } catch(e:any){ setError(e.message);} finally { setLoading(l=>({...l,system:false})); } }
  async function doExport() { setLoading(l=>({...l,export:true})); try { const data = await call('/api/admin/export'); setExportData(data); } catch(e:any){ setError(e.message);} finally { setLoading(l=>({...l,export:false})); } }
  async function doRebuild() { if(!window.confirm('Vérifier/reconstruire le schéma ?')) return; setLoading(l=>({...l,rebuild:true})); try { await postJson('/api/admin/rebuild', {}); await loadHealth(); } catch(e:any){ setError(e.message);} finally { setLoading(l=>({...l,rebuild:false})); } }
  async function loadLogs(limit=logsLimit) { setLoading(l=>({...l,logs:true})); try { setLogs(await call(`/api/admin/logs?limit=${limit}`)); } catch(e:any){ setError(e.message);} finally { setLoading(l=>({...l,logs:false})); } }

  async function doImport() {
    if(!importFile) return;
    try {
      setLoading(l=>({...l,import:true})); setImportStatus('Lecture fichier...');
      const text = await importFile.text();
      let json; try { json = JSON.parse(text); } catch { throw new Error('JSON invalide'); }
      setImportStatus('Envoi...');
  const res = await postJson('/api/admin/import', json);
      setImportStatus('Terminé');
      await Promise.all([loadHealth(), loadSystem()]);
      setExportData(null); // reset
    } catch(e:any) { setImportStatus('Erreur: '+e.message); }
    finally { setLoading(l=>({...l,import:false})); }
  }

  function downloadExport() {
    if (!exportData) return;
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `export-music-list-${Date.now()}.json`; a.click(); URL.revokeObjectURL(url);
  }

  React.useEffect(()=>{ if (adminToken) persistToken(); }, [adminToken]);

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight:700, mb:2 }}>Administration</Typography>
      {error && <Alert severity="error" sx={{ mb:2 }}>{error}</Alert>}
      <Grid container spacing={2}>
        <Grid item xs={12} md={4} lg={3}>
          <Stack spacing={2}>
            <Paper variant="outlined" sx={{ p:2 }}>
              <Typography variant="subtitle2" gutterBottom>Token Admin</Typography>
              <TextField size="small" label="x-admin-token" value={adminToken} onChange={e=>setAdminToken(e.target.value)} fullWidth />
              <Typography variant="caption" color="text.secondary">Stocké localement. Laisser vide si non configuré côté serveur.</Typography>
            </Paper>
            <Paper variant="outlined" sx={{ p:2 }}>
              <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                <Typography variant="subtitle2">Santé DB</Typography>
                <IconButton size="small" onClick={loadHealth} disabled={loading.health}><RefreshIcon fontSize="small" /></IconButton>
              </Stack>
              {loading.health && <CircularProgress size={20} />}
              {health && <Stack spacing={1} sx={{ mt:1 }}>
                <Box sx={{ display:'flex', flexWrap:'wrap', gap:0.5 }}>
                  {Object.entries(health.tables).map(([tbl,ok]) => <Chip key={tbl} size="small" label={tbl} color={ok? 'success':'error'} />)}
                </Box>
                <Divider flexItem sx={{ my:1 }} />
                <Stack direction="row" spacing={1} flexWrap="wrap">
                  {Object.entries(health.counts).map(([k,v]) => <Chip key={k} size="small" label={`${k}: ${v}`} />)}
                </Stack>
                <Typography variant="caption" color="text.secondary">{new Date(health.timestamp).toLocaleString()}</Typography>
              </Stack>}
            </Paper>
            <Paper variant="outlined" sx={{ p:2 }}>
              <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                <Typography variant="subtitle2">Système</Typography>
                <IconButton size="small" onClick={loadSystem} disabled={loading.system}><RefreshIcon fontSize="small" /></IconButton>
              </Stack>
              {loading.system && <CircularProgress size={20} />}
              {system && <Stack spacing={1} sx={{ mt:1 }}>
                <Typography variant="caption">Proc: {Math.round(system.process?.memory?.heapUsed/1024/1024)}MB / Node {system.process?.node}</Typography>
                {system.app?.version && <Typography variant="caption">App v{system.app.version}{system.app.git?` (${system.app.git}${system.app.dirty?'*':''})`:''}</Typography>}
                {system.environment && <Typography variant="caption">Env: {system.environment.name}</Typography>}
                {system.db && <Typography variant="caption">DB: {system.db.driver} {system.db.sizeBytes?`(${(system.db.sizeBytes/1024/1024).toFixed(1)}MB)`:''}</Typography>}
                {system.counts && <Stack direction="row" spacing={1} flexWrap="wrap">{Object.entries(system.counts).map(([k,v])=> <Chip key={k} size="small" label={`${k}:${v}`} />)}</Stack>}
              </Stack>}
            </Paper>
            <Paper variant="outlined" sx={{ p:2 }}>
              <Typography variant="subtitle2" gutterBottom>Export</Typography>
              <Stack direction="row" spacing={1}>
                <Button size="small" variant="contained" onClick={doExport} disabled={loading.export}>Exporter</Button>
                <Tooltip title="Télécharger"><span><IconButton size="small" onClick={downloadExport} disabled={!exportData}><DownloadIcon fontSize="small" /></IconButton></span></Tooltip>
              </Stack>
              {exportData && <Typography variant="caption" sx={{ mt:1, display:'block' }}>Export prêt ({(JSON.stringify(exportData).length/1024).toFixed(1)} KB)</Typography>}
            </Paper>
            <Paper variant="outlined" sx={{ p:2 }}>
              <Typography variant="subtitle2" gutterBottom>Import</Typography>
              <Button component="label" size="small" variant="outlined" startIcon={<UploadIcon />}>Choisir JSON<input type="file" hidden accept="application/json" onChange={e=> setImportFile(e.target.files?.[0]||null)} /></Button>
              {importFile && <Typography variant="caption" sx={{ mt:1 }}>{importFile.name}</Typography>}
              <Stack direction="row" spacing={1} sx={{ mt:1 }}>
                <Button size="small" variant="contained" disabled={!importFile || loading.import} onClick={doImport}>Importer</Button>
                {loading.import && <CircularProgress size={18} />}
              </Stack>
              {importStatus && <Typography variant="caption" color={importStatus.startsWith('Erreur')?'error':'text.secondary'}>{importStatus}</Typography>}
            </Paper>
            <Paper variant="outlined" sx={{ p:2 }}>
              <Typography variant="subtitle2" gutterBottom>Maintenance</Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap">
                <Button size="small" variant="outlined" startIcon={<ScienceIcon />} onClick={loadSystem} disabled={loading.system}>Système</Button>
                <Button size="small" variant="outlined" startIcon={<CleaningServicesIcon />} onClick={doRebuild} disabled={loading.rebuild}>Rebuild</Button>
              </Stack>
            </Paper>
          </Stack>
        </Grid>
        <Grid item xs={12} md={8} lg={9}>
          <Paper variant="outlined" sx={{ p:2, mb:2 }}>
            <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
              <Typography variant="subtitle2">Logs récents</Typography>
              <Stack direction="row" spacing={1} alignItems="center">
                <TextField size="small" label="Limite" type="number" value={logsLimit} onChange={e=> setLogsLimit(parseInt(e.target.value||'100',10))} sx={{ width:100 }} />
                <Button size="small" variant="contained" onClick={()=> loadLogs(logsLimit)} disabled={loading.logs}>Charger</Button>
              </Stack>
            </Stack>
            {loading.logs && <CircularProgress size={22} sx={{ mt:2 }} />}
            {!loading.logs && logs && <Box sx={{ mt:2, maxHeight:420, overflowY:'auto', fontFamily:'monospace', fontSize:12 }}>
              {logs.map(l => (
                <Box key={l.id} sx={{ py:0.5, borderBottom:'1px solid', borderColor:'divider', display:'flex', flexWrap:'wrap', gap:1 }}>
                  <Box sx={{ flexShrink:0, width:70, color:'text.secondary' }}>{l.id}</Box>
                  <Box sx={{ flexShrink:0, width:150 }}>{l.action}</Box>
                  <Box sx={{ flexShrink:0, width:90, color:'text.secondary' }}>{l.entity_type||''}</Box>
                  <Box sx={{ flexShrink:0, width:70 }}>{l.entity_id??''}</Box>
                  <Box sx={{ flexGrow:1, minWidth:160, whiteSpace:'pre', overflow:'hidden', textOverflow:'ellipsis' }}>{l.info || ''}</Box>
                  <Box sx={{ flexShrink:0, width:160, color:'text.secondary' }}>{new Date(l.created_at).toLocaleString()}</Box>
                </Box>
              ))}
              {!logs.length && <Typography variant="caption" color="text.secondary">Aucun log.</Typography>}
            </Box>}
          </Paper>
          {exportData && <Paper variant="outlined" sx={{ p:2 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb:1 }}>
              <AssignmentIcon fontSize="small" />
              <Typography variant="subtitle2">Aperçu Export (tronc.)</Typography>
            </Stack>
            <Box component="pre" sx={{ maxHeight:260, overflow:'auto', m:0, fontSize:11 }}>{JSON.stringify(exportData, null, 2).slice(0,8000)}{JSON.stringify(exportData).length>8000?'\n…(tronqué)…':''}</Box>
          </Paper>}
        </Grid>
      </Grid>
    </Box>
  );
};

export default AdminPage;
