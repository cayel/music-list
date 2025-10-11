const axios = require('axios');

const DISCOGS_API_URL = 'https://api.discogs.com';
const USER_AGENT = 'MusicListApp/1.0';
const DISCOGS_TOKEN = process.env.DISCOGS_TOKEN || null;

function headers() {
  const h = { 'User-Agent': USER_AGENT };
  if (DISCOGS_TOKEN) h['Authorization'] = `Discogs token=${DISCOGS_TOKEN}`;
  return h;
}

async function fetchMaster(masterId) {
  const r = await axios.get(`${DISCOGS_API_URL}/masters/${masterId}`, { headers: headers() });
  return r.data;
}
async function fetchRelease(releaseId) {
  const r = await axios.get(`${DISCOGS_API_URL}/releases/${releaseId}`, { headers: headers() });
  return r.data;
}

function mapMasterData(master) {
  const artistName = (master.artists && master.artists.length) ? master.artists.map(a => a.name).join(', ') : 'Inconnu';
  const primaryArtistId = (master.artists && master.artists.length) ? master.artists[0].id : null;
  const albumTitle = master.title || 'Sans titre';
  const year = master.year || null;
  const genres = master.genres ? master.genres.join(', ') : null;
  const styles = master.styles ? master.styles.join(', ') : null;
  let cover = null;
  if (master.images && master.images.length) {
    const primary = master.images.find(i => i.type === 'primary') || master.images[0];
    cover = primary ? (primary.uri || primary.resource_url) : null;
  }
  return { artist_id: primaryArtistId, artist_name: artistName, album_title: albumTitle, release_year: year, genre: genres, style: styles, label: null, cover_image_url: cover };
}

function extractUniqueLabelsFromRelease(releaseData) {
  if (!releaseData || !Array.isArray(releaseData.labels)) return null;
  const seen = new Set();
  const out = [];
  for (const lab of releaseData.labels) {
    if (!lab || !lab.name) continue;
    const name = lab.name.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (lab.catno && lab.catno !== 'none' && lab.catno !== 'N/A') out.push(`${name} (${lab.catno})`); else out.push(name);
  }
  return out.length ? out.join(', ') : null;
}

module.exports = { fetchMaster, fetchRelease, mapMasterData, extractUniqueLabelsFromRelease };
