import React from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, Box, Stack, Chip, IconButton, Tooltip, Link } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import RefreshIcon from '@mui/icons-material/Refresh';

interface Album {
  id: number;
  album_title: string;
  artist_name: string;
  release_year?: number | null;
  genre?: string | null;
  style?: string | null;
  label?: string | null;
  cover_image_url?: string | null;
  list_usage_count?: number;
  master_id?: number | null;
}

interface Props { open: boolean; album: Album | null; onClose: () => void; onRefresh?: (id: number)=>Promise<void>; onDelete?: (id:number)=>Promise<void>; refreshing?: boolean; }

const splitValues = (v?: string | null) => v ? v.split(/\s*,\s*/).filter(Boolean) : [];

const AlbumDialog: React.FC<Props> = ({ open, album, onClose, onRefresh, onDelete, refreshing }) => {
  if (!album) return null;
  const genres = splitValues(album.genre);
  const styles = splitValues(album.style);
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);

  async function handleRefresh() {
    if (onRefresh && album) await onRefresh(album.id);
  }

  async function handleDelete() {
    if (!onDelete || !album) return;
    if (!confirmingDelete) { setConfirmingDelete(true); return; }
    await onDelete(album.id);
    setConfirmingDelete(false);
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pr:6 }}>{album.album_title}
        {onRefresh && <Tooltip title="Rafraîchir depuis Discogs"><span><IconButton size="small" onClick={handleRefresh} disabled={!!refreshing} sx={{ position:'absolute', right:8, top:8, animation: refreshing ? 'spin 1s linear infinite' : 'none' }}><RefreshIcon fontSize="small" /></IconButton></span></Tooltip>}
      </DialogTitle>
      <DialogContent dividers>
        <Stack direction={{ xs:'column', sm:'row' }} spacing={2}>
          <Box sx={{ width:180, flexShrink:0, alignSelf:'flex-start', borderRadius:1, overflow:'hidden', bgcolor:'background.paper', boxShadow:1 }}>
            {album.cover_image_url ? <img src={album.cover_image_url} alt={album.album_title} style={{ width:'100%', display:'block' }} /> : <Box sx={{ p:4, textAlign:'center' }}>🎵</Box>}
          </Box>
          <Stack spacing={1} sx={{ flexGrow:1 }}>
            <Typography variant="subtitle1" fontWeight={600}>{album.artist_name}</Typography>
            <Typography variant="body2" color="text.secondary">{album.release_year || 'Année inconnue'} {album.label ? `• ${album.label}`: ''}</Typography>
            {!!genres.length && <Box>
              <Typography variant="caption" sx={{ display:'block', mb:0.5 }}>Genres</Typography>
              <Stack direction="row" spacing={0.5} flexWrap="wrap">
                {genres.map(g => <Chip size="small" key={g} label={g} />)}
              </Stack>
            </Box>}
            {!!styles.length && <Box>
              <Typography variant="caption" sx={{ display:'block', mb:0.5 }}>Styles</Typography>
              <Stack direction="row" spacing={0.5} flexWrap="wrap">
                {styles.map(s => <Chip size="small" key={s} label={s} variant="outlined" />)}
              </Stack>
            </Box>}
            {typeof album.list_usage_count === 'number' && <Typography variant="caption" color="text.secondary">Présent dans {album.list_usage_count} liste(s)</Typography>}
            {album.master_id && (
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mt:0.5 }}>
                <Typography variant="caption" color="text.secondary">Master ID:&nbsp;<strong>{album.master_id}</strong></Typography>
                <Tooltip title="Copier l'ID">
                  <IconButton size="small" onClick={()=> navigator.clipboard.writeText(String(album.master_id))}>
                    <ContentCopyIcon fontSize="inherit" />
                  </IconButton>
                </Tooltip>
                <Link href={`https://www.discogs.com/master/${album.master_id}`} target="_blank" rel="noopener noreferrer" underline="hover" variant="caption">Discogs ↗</Link>
              </Stack>
            )}
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        {onDelete && (
          <Button color={confirmingDelete? 'error':'inherit'} onClick={handleDelete} disabled={refreshing}
            variant={confirmingDelete? 'contained':'text'}>
            {confirmingDelete? 'Confirmer suppression':'Supprimer'}
          </Button>
        )}
        <Button onClick={onClose}>Fermer</Button>
      </DialogActions>
    </Dialog>
  );
};
export default AlbumDialog;
