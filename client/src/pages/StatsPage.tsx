import React from 'react';
import { Box, Typography, Grid, Card, CardContent, CircularProgress, Stack, useTheme, Paper, Dialog, DialogTitle, DialogContent, DialogActions, Button, Chip } from '@mui/material';
import AlbumDialog from '../components/AlbumDialog';
import { useAlbums } from '../hooks/useAlbums';
import { apiFetch } from '../api';

interface ListSummary { id:number; name:string; item_count:number; tags?:string[]; }

function computeAlbumStats(albums:any[]) {
  const total = albums.length;
  const byYear = new Map<number, number>();
  const artistCounts = new Map<string, number>();
  const genreCounts = new Map<string, number>();
  for (const a of albums) {
    if (a.release_year) byYear.set(a.release_year, (byYear.get(a.release_year)||0)+1);
    const artistKey = a.artist_name || 'Inconnu';
    artistCounts.set(artistKey, (artistCounts.get(artistKey)||0)+1);
    const genres:string[] = [];
    if (a.genre) genres.push(...String(a.genre).split(',').map((s:string)=>s.trim()).filter(Boolean));
    if (a.style) genres.push(...String(a.style).split(',').map((s:string)=>s.trim()).filter(Boolean));
    genres.forEach(g => genreCounts.set(g, (genreCounts.get(g)||0)+1));
  }
  const yearDistribution = Array.from(byYear.entries()).sort((a,b)=>a[0]-b[0]);
  const topArtists = Array.from(artistCounts.entries()).sort((a,b)=>b[1]-a[1]).slice(0,12);
  const topGenres = Array.from(genreCounts.entries()).sort((a,b)=>b[1]-a[1]).slice(0,12);
  return { total, yearDistribution, topArtists, topGenres };
}

function computeListStats(lists:ListSummary[]) {
  const totalListItems = lists.reduce((acc,l)=> acc + (l.item_count||0), 0);
  const tagMap = new Map<string, number>();
  lists.forEach(l => (l.tags||[]).forEach(t => tagMap.set(t, (tagMap.get(t)||0)+1)) );
  const tagUsage = Array.from(tagMap.entries()).sort((a,b)=>b[1]-a[1]).slice(0,15);
  return { totalListItems, tagUsage };
}

interface InteractiveBarsProps { data:[string,number][]; label?:string; maxBars?:number; onSelect:(name:string)=>void; emptyLabel?:string; }
const InteractiveBars: React.FC<InteractiveBarsProps> = ({ data, label, maxBars=12, onSelect, emptyLabel='Aucune donnée.' }) => {
  const top = data.slice(0,maxBars);
  const max = top.length ? Math.max(...top.map(d=>d[1])) : 0;
  return (
    <Box>
      {label && <Typography variant="subtitle2" sx={{ mb:1 }}>{label}</Typography>}
      <Stack spacing={0.7}>
        {top.map(([name,val]) => {
          const pct = max ? (val/max)*100 : 0;
          return (
            <Box key={name} sx={{ display:'flex', alignItems:'center', gap:1, cursor:'pointer' }} onClick={()=> onSelect(name)}>
              <Box sx={{ flexGrow:1, position:'relative', height:18, bgcolor:'action.hover', borderRadius:1, overflow:'hidden' }}>
                <Box sx={{ position:'absolute', inset:0, width:`${pct}%`, bgcolor:'primary.main', opacity:0.85 }} />
                <Box sx={{ position:'absolute', left:8, top:0, bottom:0, display:'flex', alignItems:'center', fontSize:12, color:'primary.contrastText', textShadow:'0 1px 2px rgba(0,0,0,0.4)', maxWidth:'75%', overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis' }}>{name}</Box>
              </Box>
              <Typography variant="caption" sx={{ width:26, textAlign:'right' }}>{val}</Typography>
            </Box>
          );
        })}
        {!top.length && <Typography variant="caption" color="text.secondary">{emptyLabel}</Typography>}
      </Stack>
    </Box>
  );
};

const YearMiniBars: React.FC<{ data:[number,number][], onSelect:(year:number)=>void }> = ({ data, onSelect }) => {
  const last = data.slice(-24);
  const max = last.length ? Math.max(...last.map(d=>d[1])) : 0;
  return (
    <Stack direction="row" alignItems="flex-end" spacing={0.5} sx={{ minHeight:80 }}>
      {last.map(([y,c]) => {
        const h = max ? (c/max) * 72 : 0;
        return <Box key={y} onClick={()=> onSelect(y)} sx={{ width:12, borderRadius:0.5, bgcolor:'primary.main', height:h || 2, cursor:'pointer', transition:'all .2s', '&:hover':{ bgcolor:'primary.dark', boxShadow:1 } }} title={`${y}: ${c}`} />;
      })}
    </Stack>
  );
};

const StatsPage: React.FC = () => {
  const { albums, loading: albumsLoading, error: albumsError } = useAlbums();
  const [lists, setLists] = React.useState<ListSummary[]|null>(null);
  const [listsLoading, setListsLoading] = React.useState(false);
  const [listsError, setListsError] = React.useState<string|null>(null);

  React.useEffect(()=>{
    setListsLoading(true);
    apiFetch('/api/lists')
      .then(data=> { setLists(data); setListsLoading(false); })
      .catch(e=> { setListsError(e.message); setListsLoading(false); });
  }, []);

  const albumStats = React.useMemo(()=> albums ? computeAlbumStats(albums) : null, [albums]);
  const listStats = React.useMemo(()=> lists ? computeListStats(lists) : null, [lists]);

  const loading = albumsLoading || listsLoading;
  const hasError = albumsError || listsError;

  // Interactivité
  const [yearDialog, setYearDialog] = React.useState<{year:number, items:any[]}|null>(null);
  const [genreDialog, setGenreDialog] = React.useState<{genre:string, items:any[]}|null>(null);
  const [artistDialog, setArtistDialog] = React.useState<{artist:string, items:any[]}|null>(null);
  const [selectedAlbum, setSelectedAlbum] = React.useState<any|null>(null);

  function openYear(year:number) {
    if (!albums) return;
    const items = albums.filter(a => a.release_year === year).slice(0,200);
    setYearDialog({ year, items });
  }
  function openGenre(name:string) {
    if (!albums) return;
    const norm = name.toLowerCase();
    const items = albums.filter(a => {
      const g = ((a.genre||'') + ' ' + (a.style||''));
      return g.toLowerCase().split(/[,/]/).map(s=>s.trim()).includes(norm);
    }).slice(0,120);
    setGenreDialog({ genre:name, items });
  }
  function openArtist(name:string) {
    if (!albums) return;
    const items = albums.filter(a => a.artist_name === name).slice(0,120);
    setArtistDialog({ artist:name, items });
  }
  const coverBox = (a:any) => (
    <Box key={a.id} onClick={()=> setSelectedAlbum(a)} sx={{ position:'relative', cursor:'pointer', borderRadius:1, overflow:'hidden', aspectRatio:'1 / 1', bgcolor:'action.hover', '&:hover':{ outline:'2px solid var(--mui-palette-primary-main, #1976d2)' }, display:'flex', alignItems:'center', justifyContent:'center' }} title={`${a.artist_name} – ${a.album_title}`}>
      {a.cover_image_url ? <img src={a.cover_image_url} alt={a.album_title} style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : <Typography variant="h6">🎵</Typography>}
    </Box>
  );

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight:700, mb:2 }}>Statistiques</Typography>
      {loading && <Box sx={{ display:'flex', justifyContent:'center', py:4 }}><CircularProgress /></Box>}
      {hasError && <Typography color="error" variant="body2" sx={{ mb:2 }}>{albumsError || listsError}</Typography>}
      {albumStats && listStats && (
        <Grid container spacing={2}>
          <Grid item xs={12} md={5} lg={4}>
            <Stack spacing={2}>
              <Paper variant="outlined" sx={{ p:2 }}>
                <Typography variant="subtitle2" sx={{ mb:1 }}>Synthèse</Typography>
                <Grid container spacing={1}>
                  <Grid item xs={6}><Card variant="outlined" sx={{ p:1.5 }}><Typography variant="caption" color="text.secondary">Albums</Typography><Typography fontWeight={600}>{albumStats.total}</Typography></Card></Grid>
                  <Grid item xs={6}><Card variant="outlined" sx={{ p:1.5 }}><Typography variant="caption" color="text.secondary">Artistes</Typography><Typography fontWeight={600}>{new Set(albums!.map(a=>a.artist_name)).size}</Typography></Card></Grid>
                  <Grid item xs={6}><Card variant="outlined" sx={{ p:1.5 }}><Typography variant="caption" color="text.secondary">Années</Typography><Typography fontWeight={600}>{new Set(albums!.filter(a=>a.release_year).map(a=>a.release_year)).size}</Typography></Card></Grid>
                  <Grid item xs={6}><Card variant="outlined" sx={{ p:1.5 }}><Typography variant="caption" color="text.secondary">Listes</Typography><Typography fontWeight={600}>{lists!.length}</Typography></Card></Grid>
                  <Grid item xs={6}><Card variant="outlined" sx={{ p:1.5 }}><Typography variant="caption" color="text.secondary">Entrées listes</Typography><Typography fontWeight={600}>{listStats.totalListItems}</Typography></Card></Grid>
                  <Grid item xs={6}><Card variant="outlined" sx={{ p:1.5 }}><Typography variant="caption" color="text.secondary">Tags</Typography><Typography fontWeight={600}>{listStats.tagUsage.length}</Typography></Card></Grid>
                </Grid>
              </Paper>
              <Paper variant="outlined" sx={{ p:2 }}>
                <Typography variant="subtitle2" sx={{ mb:1 }}>Distribution années (24 dernières)</Typography>
                <YearMiniBars data={albumStats.yearDistribution} onSelect={openYear} />
              </Paper>
            </Stack>
          </Grid>
          <Grid item xs={12} md={7} lg={8}>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <Paper variant="outlined" sx={{ p:2, height:'100%' }}>
                  <InteractiveBars data={albumStats.topGenres} label="Genres / Styles (Top 12)" onSelect={openGenre} />
                </Paper>
              </Grid>
              <Grid item xs={12} md={6}>
                <Paper variant="outlined" sx={{ p:2, height:'100%' }}>
                  <InteractiveBars data={albumStats.topArtists} label="Artistes (Top 12)" onSelect={openArtist} />
                </Paper>
              </Grid>
              <Grid item xs={12}>
                <Paper variant="outlined" sx={{ p:2 }}>
                  <Typography variant="subtitle2" sx={{ mb:1 }}>Tags (Top 15)</Typography>
                  {listStats.tagUsage.length ? <Stack spacing={1}>
                    {listStats.tagUsage.map(([t,c]) => (
                      <Box key={t} sx={{ display:'flex', alignItems:'center', gap:1 }}>
                        <Box sx={{ width:120, fontSize:12, color:'text.secondary', textAlign:'right', pr:1 }}>{t}</Box>
                        <Box sx={{ flexGrow:1, position:'relative', height:6, bgcolor:'action.hover', borderRadius:3 }}>
                          <Box sx={{ position:'absolute', left:0, top:0, bottom:0, width:`${(c / listStats.tagUsage[0][1])*100}%`, bgcolor:'primary.main', borderRadius:3 }} />
                        </Box>
                        <Typography variant="caption" sx={{ width:24, textAlign:'right' }}>{c}</Typography>
                      </Box>
                    ))}
                  </Stack> : <Typography variant="caption" color="text.secondary">Aucun tag.</Typography>}
                </Paper>
              </Grid>
            </Grid>
          </Grid>
        </Grid>
      )}
      {/* Dialog Année */}
      <Dialog open={!!yearDialog} onClose={()=> setYearDialog(null)} maxWidth="md" fullWidth>
        <DialogTitle>Année {yearDialog?.year} {yearDialog && albums && <Typography component="span" variant="caption" sx={{ ml:1 }}>({yearDialog.items.length} / {albums.filter(a=>a.release_year===yearDialog.year).length})</Typography>}</DialogTitle>
        <DialogContent dividers>
          <Grid container spacing={1.2}>
            {yearDialog?.items.map(a => <Grid key={a.id} item xs={3} sm={2} md={2} lg={1.5 as any}>{coverBox(a)}</Grid>)}
            {!yearDialog?.items.length && <Typography variant="body2" color="text.secondary">Aucun album.</Typography>}
          </Grid>
          {yearDialog && albums && albums.filter(a=>a.release_year===yearDialog.year).length>yearDialog.items.length && <Typography variant="caption" color="text.secondary" sx={{ mt:1, display:'block' }}>Limité à {yearDialog.items.length} albums (max 200).</Typography>}
        </DialogContent>
        <DialogActions><Button onClick={()=> setYearDialog(null)}>Fermer</Button></DialogActions>
      </Dialog>
      {/* Dialog Genre */}
      <Dialog open={!!genreDialog} onClose={()=> setGenreDialog(null)} maxWidth="md" fullWidth>
        <DialogTitle>Genre / Style {genreDialog?.genre} {genreDialog && <Typography component="span" variant="caption" sx={{ ml:1 }}>({genreDialog.items.length})</Typography>}</DialogTitle>
        <DialogContent dividers>
          <Grid container spacing={1.2}>
            {genreDialog?.items.map(a => <Grid key={a.id} item xs={3} sm={2} md={2} lg={1.5 as any}>{coverBox(a)}</Grid>)}
            {!genreDialog?.items.length && <Typography variant="body2" color="text.secondary">Aucun album.</Typography>}
          </Grid>
          {genreDialog && genreDialog.items.length>=120 && <Typography variant="caption" color="text.secondary" sx={{ mt:1, display:'block' }}>Limité à 120 albums.</Typography>}
        </DialogContent>
        <DialogActions><Button onClick={()=> setGenreDialog(null)}>Fermer</Button></DialogActions>
      </Dialog>
      {/* Dialog Artiste */}
      <Dialog open={!!artistDialog} onClose={()=> setArtistDialog(null)} maxWidth="md" fullWidth>
        <DialogTitle>Artiste {artistDialog?.artist} {artistDialog && <Typography component="span" variant="caption" sx={{ ml:1 }}>({artistDialog.items.length})</Typography>}</DialogTitle>
        <DialogContent dividers>
          <Grid container spacing={1.2}>
            {artistDialog?.items.map(a => <Grid key={a.id} item xs={3} sm={2} md={2} lg={1.5 as any}>{coverBox(a)}</Grid>)}
            {!artistDialog?.items.length && <Typography variant="body2" color="text.secondary">Aucun album.</Typography>}
          </Grid>
          {artistDialog && artistDialog.items.length>=120 && <Typography variant="caption" color="text.secondary" sx={{ mt:1, display:'block' }}>Limité à 120 albums.</Typography>}
        </DialogContent>
        <DialogActions><Button onClick={()=> setArtistDialog(null)}>Fermer</Button></DialogActions>
      </Dialog>
      <AlbumDialog open={!!selectedAlbum} album={selectedAlbum} onClose={()=> setSelectedAlbum(null)} />
    </Box>
  );
};

export default StatsPage;
