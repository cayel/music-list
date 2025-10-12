import React from 'react';
import { TextField, InputAdornment, IconButton, Box, Tooltip, CircularProgress, Fade } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';

interface Props {
  onResults: (albums: any[]) => void;
  onReset?: (full?: boolean) => void;
  initial?: string;
}

const AlbumSearchBar: React.FC<Props> = ({ onResults, onReset, initial }) => {
  const [q, setQ] = React.useState(initial || '');
  const [timer, setTimer] = React.useState<number | null>(null);
  const [loading, setLoading] = React.useState(false);
  const controllerRef = React.useRef<AbortController | null>(null);
  const API_BASE = (import.meta as any).env?.VITE_API_BASE || '';

  React.useEffect(() => {
    if (!q) {
      onReset && onReset(true);
      return;
    }
    if (q.length < 2 && !/^\d{4}$/.test(q)) return; // ne cherche pas encore (sauf année exacte)
    if (timer) window.clearTimeout(timer);
    const t = window.setTimeout(() => {
      if (controllerRef.current) controllerRef.current.abort();
      const ac = new AbortController();
      controllerRef.current = ac;
      setLoading(true);
      fetch(`${API_BASE}/api/albums/search?q=${encodeURIComponent(q)}`, { signal: ac.signal })
        .then(r => r.ok ? r.json(): r.json().then(e=> Promise.reject(e)))
        .then(data => { onResults(data); setLoading(false); })
        .catch(err => { if (err.name !== 'AbortError') console.warn('search error', err); setLoading(false); });
    }, 400);
    setTimer(t);
    // cleanup
    return () => { if (t) window.clearTimeout(t); };
  }, [q]);

  function clear(){ setQ(''); onReset && onReset(true); }

  return (
    <Box sx={{ mb:2, position:'relative' }}>
      <TextField
        fullWidth
        size="small"
        label="Recherche (artiste, titre ou année)"
        value={q}
        onChange={e=> setQ(e.target.value)}
        InputProps={{
          startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>,
          endAdornment: q && <InputAdornment position="end">
            <Tooltip title="Effacer"><IconButton size="small" onClick={clear}><ClearIcon fontSize="small" /></IconButton></Tooltip>
          </InputAdornment>
        }}
        helperText={q && q.length < 2 && !/^\d{4}$/.test(q) ? 'Tape encore… (2 caractères mini ou 4 chiffres pour année)' : ' '}
      />
      <Fade in={loading} unmountOnExit>
        <Box sx={{ position:'absolute', top:8, right:8 }}><CircularProgress size={16} /></Box>
      </Fade>
    </Box>
  );
};

export default AlbumSearchBar;