import React from 'react';
import { Grid, Card, CardMedia, CardActionArea, CardContent, Typography, Box } from '@mui/material';

interface Album {
  id: number;
  album_title: string;
  artist_name: string;
  release_year?: number;
  cover_image_url?: string | null;
}

interface Props { albums: Album[]; onSelect?: (album: Album) => void; }

const AlbumGrid: React.FC<Props> = ({ albums, onSelect }) => {
  return (
    <Grid container spacing={2}>
      {albums.map(a => (
        <Grid key={a.id} item xs={6} sm={4} md={3} lg={2}>
            <Card variant="outlined" sx={{ height: '100%', display:'flex', flexDirection:'column' }}>
              <CardActionArea sx={{ flexGrow:1 }} onClick={()=> onSelect && onSelect(a)}>
                {a.cover_image_url ? (
                  <CardMedia component="img" image={a.cover_image_url} alt={a.album_title} sx={{ aspectRatio:'1 / 1', objectFit:'cover' }} />
                ) : (
                  <Box sx={{ aspectRatio:'1 / 1', display:'flex', alignItems:'center', justifyContent:'center', bgcolor:'action.hover', fontSize:24 }}>🎵</Box>
                )}
                <CardContent sx={{ p:1.2 }}>
                  <Typography variant="subtitle2" noWrap fontWeight={600}>{a.album_title}</Typography>
                  <Typography variant="caption" color="text.secondary" noWrap>{a.artist_name}{a.release_year?` • ${a.release_year}`:''}</Typography>
                </CardContent>
              </CardActionArea>
            </Card>
        </Grid>
      ))}
    </Grid>
  );
};
export default AlbumGrid;
