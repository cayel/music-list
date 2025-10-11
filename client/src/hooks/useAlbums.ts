import React from 'react';
import { apiFetch } from '../api';

export interface Album { id:number; album_title:string; artist_name:string; release_year?:number|null; genre?:string|null; style?:string|null; cover_image_url?:string|null; label?:string|null; }

export function useAlbums() {
  const [albums, setAlbums] = React.useState<Album[]|null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string|null>(null);

  React.useEffect(()=>{
    setLoading(true);
    apiFetch('/api/albums')
      .then(data=> { setAlbums(data); setLoading(false); })
      .catch(e=> { setError(e.message); setLoading(false); });
  }, []);

  return { albums, loading, error, setAlbums };
}
