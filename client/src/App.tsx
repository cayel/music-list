import React from 'react';
import { Box, Container, CircularProgress, Typography, GlobalStyles } from '@mui/material';
import { Routes, Route, Navigate } from 'react-router-dom';
import AlbumGrid from './components/AlbumGrid';
import AddAlbumsPanel from './components/AddAlbumsPanel';
import { apiFetch, patchJson } from './api';
import Layout from './components/Layout';
import AlbumDialog from './components/AlbumDialog';
import ListsPage from './pages/ListsPage';
import StatsPage from './pages/StatsPage';
import AdminPage from './pages/AdminPage';

interface AppProps { onToggleTheme: () => void; mode: 'light' | 'dark'; }

const App: React.FC<AppProps> = ({ onToggleTheme, mode }) => {
  const [albums, setAlbums] = React.useState<any[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<any | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);

  React.useEffect(() => {
    setLoading(true);
    apiFetch('/api/albums')
      .then(data => { setAlbums(data); setLoading(false); })
      .catch(e => { setError(e.message || String(e)); setLoading(false); });
  }, []);

  async function refreshAlbum(id: number) {
    try {
      setRefreshing(true);
      const target = albums?.find(a => a.id === id);
      const body = (target && !target.master_id) ? { rederiveMaster: true } : undefined;
      const data = await patchJson(`/api/albums/${id}/refresh`, body);
      setAlbums(albs => albs ? albs.map(a => a.id === id ? data.album : a) : albs);
      setSelected(data.album);
    } catch(e:any) {
      console.error(e);
      setError(e.message);
    } finally { setRefreshing(false); }
  }

  return (
    <Layout mode={mode} onToggleTheme={onToggleTheme}>
      <GlobalStyles styles={{ '@keyframes spin': { from:{ transform:'rotate(0deg)' }, to:{ transform:'rotate(360deg)' } }} } />
      <Container sx={{ py:4, flexGrow:1 }}>
        <Routes>
          <Route path="/" element={<Navigate to="/albums" replace />} />
          <Route path="/albums" element={<>
            <AddAlbumsPanel onAdded={() => {
              setLoading(true);
              apiFetch('/api/albums')
                .then(data => { setAlbums(data); setLoading(false); })
                .catch(e => { setError(e.message || String(e)); setLoading(false); });
            }} />
            {loading && <Box sx={{ display:'flex', justifyContent:'center', mt:2 }}><CircularProgress size={28} /></Box>}
            {error && <Typography color="error" variant="body2">{error}</Typography>}
            {albums && <AlbumGrid albums={albums} onSelect={setSelected} />}
          </>} />
          <Route path="/lists" element={<ListsPage />} />
          <Route path="/smart-lists" element={<Navigate to="/lists" replace />} />
            <Route path="/stats" element={<StatsPage />} />
            <Route path="/admin" element={<AdminPage />} />
        </Routes>
      </Container>
      <AlbumDialog open={!!selected} album={selected} onClose={()=> setSelected(null)} onRefresh={refreshAlbum} refreshing={refreshing} />
    </Layout>
  );
};

export default App;
