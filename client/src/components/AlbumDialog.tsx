import React from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, Box, Stack, Chip, IconButton, Tooltip } from '@mui/material';
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

interface Props { open: boolean; album: Album | null; onClose: () => void; onRefresh?: (id: number)=>Promise<void>; refreshing?: boolean; }

const splitValues = (v?: string | null) => v ? v.split(/\s*,\s*/).filter(Boolean) : [];

const AlbumDialog: React.FC<Props> = ({ open, album, onClose, onRefresh, refreshing }) => {
  if (!album) return null;
  const genres = splitValues(album.genre);
  const styles = splitValues(album.style);

  async function handleRefresh() {
    if (onRefresh && album) await onRefresh(album.id);
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
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fermer</Button>
      </DialogActions>
    </Dialog>
  );
};
export default AlbumDialog;
