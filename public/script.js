// Configuration de l'API
const API_BASE_URL = '/api';
// Gestion optionnelle du token admin : stocké dans localStorage sous la clé 'ml-admin-token'
function getAdminHeaders(extra={}) {
    const h = { ...extra };
    const t = localStorage.getItem('ml-admin-token');
    if (t) h['x-admin-token'] = t;
    return h;
}

// Wrapper fetch pour endpoints admin avec gestion d'erreur et 401 explicite
async function adminFetch(path, options={}) {
    const finalOpts = { ...options };
    finalOpts.headers = getAdminHeaders(finalOpts.headers || {});
    let res;
    try {
        res = await fetch(`${API_BASE_URL}${path}`, finalOpts);
    } catch (e) {
        throw new Error('Réseau: ' + e.message);
    }
    if (res.status === 401) {
        throw new Error('401 Non autorisé (définissez localStorage ml-admin-token)');
    }
    let data = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) { try { data = await res.json(); } catch { /* ignore */ } }
    if (!res.ok) {
        const msg = (data && (data.error || data.message)) ? data.error || data.message : `Erreur HTTP ${res.status}`;
        throw new Error(msg);
    }
    return data;
}

// Éléments du DOM
const addAlbumForm = document.getElementById('addAlbumForm');
const releaseIdInput = document.getElementById('releaseId');
const messageDiv = document.getElementById('message');
const refreshLogsBtn = document.getElementById('refreshLogsBtn');
const logsPanel = document.getElementById('logsPanel');
const logsContainer = document.getElementById('logsContainer');
const logsLimitSelect = document.getElementById('logsLimitSelect');
const albumsContainer = document.getElementById('albumsContainer');
const emptyState = document.getElementById('emptyState');
const albumSearchInput = document.getElementById('albumSearch');
const clearAlbumSearchBtn = document.getElementById('clearAlbumSearch');
const yearFilterInput = document.getElementById('yearFilter');
const clearYearFilterBtn = document.getElementById('clearYearFilter');
const statAlbumsValue = document.getElementById('statAlbums');
const statAlbumsMeta = document.getElementById('statAlbumsMeta');
const statListsValue = document.getElementById('statLists');
const statListsMeta = document.getElementById('statListsMeta');
const statTagsValue = document.getElementById('statTags');
const statTagsMeta = document.getElementById('statTagsMeta');
const discogsStatusBadge = document.getElementById('discogsStatus');
const serverPortEl = document.getElementById('serverPort');
const serverUptimeEl = document.getElementById('serverUptime');
// Listes
let lists = [];
const listsContainer = document.getElementById('listsContainer');
const listDetails = document.getElementById('listDetails');
const createListForm = document.getElementById('createListForm');
// Admin elements
const exportJsonBtn = document.getElementById('exportJsonBtn');
const downloadJsonBtn = document.getElementById('downloadJsonBtn');
const exportResultPre = document.getElementById('exportResult');
// Admin extended
const checkDbHealthBtn = document.getElementById('checkDbHealthBtn');
const rebuildDbBtn = document.getElementById('rebuildDbBtn');
const dbHealthSummary = document.getElementById('dbHealthSummary');
const importJsonFile = document.getElementById('importJsonFile');
const importJsonTrigger = document.getElementById('importJsonTrigger');
const importStatusBox = document.getElementById('importStatus');
const statsSection = document.getElementById('statsSection');
const statsBoardsEl = document.getElementById('statsBoards');
const statsDetailsEl = document.getElementById('statsDetails');
const albumModal = document.getElementById('albumModal');
const albumModalBody = document.getElementById('albumModalBody');

// Défense: si une navigation précoce appelle les stats avant que les helpers ne soient définis plus bas
if (typeof window.computeAlbumStats !== 'function') {
    window.computeAlbumStats = function(a){ return { total:a.length, yearDistribution:[], topArtists:[], genreCounts:[] }; };
}
if (typeof window.computeListStats !== 'function') {
    window.computeListStats = function(l){ return { listSizeDetails:[], tagUsage:[], totalListItems:0, avgSize:0, largest:[] }; };
}

// État de l'application
let albums = [];
let currentAlbumFilter = '';
let yearExact = null;
let statusInfo = null;
// État : mode édition des listes (permet réordonner / supprimer)
let listEditMode = false;
let listViewMode = 'list'; // 'list' | 'mosaic'
let pendingOrder = null; // tableau d'ids list_item_id en attente de sauvegarde
let pendingOrderListId = null;

// Initialisation
document.addEventListener('DOMContentLoaded', () => {
    loadAlbums();
    addAlbumForm.addEventListener('submit', handleAddAlbum);
    if (createListForm) createListForm.addEventListener('submit', handleCreateList);
    loadLists();
    initNavigation();
    initTheme();
    if (albumSearchInput) albumSearchInput.addEventListener('input', handleAlbumFilterInput);
    if (clearAlbumSearchBtn) clearAlbumSearchBtn.addEventListener('click', resetAlbumFilter);
    if (yearFilterInput) yearFilterInput.addEventListener('input', handleYearFilterChange);
    if (clearYearFilterBtn) clearYearFilterBtn.addEventListener('click', resetYearFilter);
    if (exportJsonBtn) exportJsonBtn.addEventListener('click', handleExportJson);
    if (downloadJsonBtn) downloadJsonBtn.addEventListener('click', downloadExportedJson);
    if (checkDbHealthBtn) checkDbHealthBtn.addEventListener('click', handleDbHealthCheck);
    if (rebuildDbBtn) rebuildDbBtn.addEventListener('click', handleRebuildDb);
    if (importJsonTrigger) importJsonTrigger.addEventListener('click', () => importJsonFile && importJsonFile.click());
    if (importJsonFile) importJsonFile.addEventListener('change', handleImportJson);
        if (refreshLogsBtn) refreshLogsBtn.addEventListener('click', handleRefreshLogs);
        if (logsLimitSelect) logsLimitSelect.addEventListener('change', handleRefreshLogs);
    loadStatus();
    initAdminDebug();
});

function initTheme() {
    const btn = document.getElementById('themeToggle');
    if (!btn) return;
    const stored = localStorage.getItem('ml-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    let theme = stored || (prefersDark ? 'dark' : 'light');
    applyTheme(theme);
    btn.addEventListener('click', () => {
        theme = theme === 'light' ? 'dark' : 'light';
        localStorage.setItem('ml-theme', theme);
        applyTheme(theme);
    });
}

async function handleRefreshLogs() {
    if (!logsPanel || !logsContainer) return;
    logsPanel.style.display='block';
    logsContainer.innerHTML = '<div class="log-entry">Chargement...</div>';
    const limit = logsLimitSelect ? parseInt(logsLimitSelect.value, 10) : 100;
    try {
        const rows = await adminFetch(`/admin/logs?limit=${limit}`);
        if (!Array.isArray(rows) || !rows.length) {
            logsContainer.innerHTML = '<div class="log-entry">Aucune entrée.</div>';
            return;
        }
        logsContainer.innerHTML = rows.map(r => formatLogEntry(r)).join('');
    } catch (e) {
        logsContainer.innerHTML = '<div class="log-entry">Erreur: ' + escapeHtml(e.message) + '</div>';
    }
}

function formatLogEntry(row) {
    const date = row.created_at || '';
    let infoPretty = '';
    if (row.info) {
        try { infoPretty = JSON.stringify(JSON.parse(row.info), null, 2); } catch { infoPretty = row.info; }
    }
    const action = row.action || '';
    let category = 'other';
    if (action.startsWith('album.')) category = 'album';
    else if (action.startsWith('list_item.')) category = 'list-item';
    else if (action.startsWith('list.')) category = 'list';
    else if (action.startsWith('tag.')) category = 'tag';
    else if (action.startsWith('admin.')) category = 'admin';
    return `
        <div class="log-entry log-cat-${category}">
            <div class="log-meta">
                <span class="log-action">${escapeHtml(action)}</span>
                ${row.entity_type ? `<span>${escapeHtml(row.entity_type)}</span>` : ''}
                ${row.entity_id ? `<span>#${escapeHtml(String(row.entity_id))}</span>` : ''}
                <span>${escapeHtml(date)}</span>
            </div>
            ${infoPretty ? `<pre class="log-info">${escapeHtml(infoPretty)}</pre>` : ''}
        </div>
    `;
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const btn = document.getElementById('themeToggle');
    if (btn) btn.textContent = theme === 'light' ? '🌙' : '☀️';
}

function initNavigation() {
    const navLinks = document.querySelectorAll('.nav-link');
    const albumsSection = document.getElementById('albumsSection');
    const listsSection = document.getElementById('listsSection');
    const adminSection = document.getElementById('adminSection');
    const statsSectionEl = document.getElementById('statsSection');
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            const target = link.getAttribute('data-section');
            if (target === 'albums') {
                albumsSection.style.display = '';
                listsSection.style.display = 'none';
                if (adminSection) adminSection.style.display='none';
                if (statsSectionEl) statsSectionEl.style.display='none';
            } else {
                if (target === 'lists') {
                    albumsSection.style.display = 'none';
                    listsSection.style.display = '';
                    if (adminSection) adminSection.style.display='none';
                    if (statsSectionEl) statsSectionEl.style.display='none';
                } else if (target === 'admin') {
                    albumsSection.style.display = 'none';
                    listsSection.style.display = 'none';
                    if (adminSection) adminSection.style.display='';
                    if (statsSectionEl) statsSectionEl.style.display='none';
                } else if (target === 'stats') {
                    albumsSection.style.display = 'none';
                    listsSection.style.display = 'none';
                    if (adminSection) adminSection.style.display='none';
                    if (statsSectionEl) { statsSectionEl.style.display=''; renderStatsPage(); }
                }
            }
        });
    });
    // Forcer l'état initial
    if (adminSection) adminSection.style.display='none';
    if (statsSectionEl) statsSectionEl.style.display='none';
}

// Chargement des albums depuis l'API
async function loadAlbums() {
    try {
        showLoading();
        const response = await fetch(`${API_BASE_URL}/albums`);
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const json = await response.json();
        const schemaErr = validateAlbumsSchema(json);
        if (schemaErr) {
          console.error('[SchemaAlbums] ' + schemaErr, json);
          showMessage('Schéma inattendu: ' + schemaErr, 'error');
          return;
        }
        albums = json;
        console.debug('[Albums] loaded', albums.length);
        renderAlbums();
        updateStats();
        const activeNav = document.querySelector('.nav-link.active');
        if (activeNav && activeNav.getAttribute('data-section') === 'stats') {
          renderStatsPage();
        }
    } catch (error) {
        console.error('Erreur chargement albums:', error);
        showMessage('Erreur chargement albums: ' + (error.message || error), 'error');
    }
}

// Ajout d'un nouvel album
async function handleAddAlbum(event) {
    event.preventDefault();
    
    const releaseId = releaseIdInput.value.trim();
    
    if (!releaseId) {
        showMessage('Veuillez entrer un numéro de release', 'error');
        return;
    }
    
    const submitButton = addAlbumForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = 'Ajout...';
    try {
        const response = await fetch(`${API_BASE_URL}/albums`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ releaseId: parseInt(releaseId, 10) }),
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Erreur lors de l\'ajout de l\'album');
        }
        showMessage('Album ajouté avec succès !', 'success');
        releaseIdInput.value = '';
        loadAlbums();
    } catch (error) {
        console.error('Erreur:', error);
        showMessage(error.message, 'error');
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = 'Ajouter l\'Album';
    }
}

// Suppression d'un album
async function deleteAlbum(albumId) {
    if (!confirm('Êtes-vous sûr de vouloir supprimer cet album de votre collection ?')) {
        return;
    }
    try {
        const response = await fetch(`${API_BASE_URL}/albums/${albumId}`, { method: 'DELETE' });
        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Erreur lors de la suppression');
        }
        showMessage('Album supprimé avec succès', 'success');
        loadAlbums();
    } catch (error) {
        console.error('Erreur:', error);
        showMessage(error.message, 'error');
    }
}

// Indicateur de chargement pour la grille d'albums
function showLoading() {
    if (albumsContainer) {
        albumsContainer.style.display='block';
        albumsContainer.innerHTML = '<div class="loading">Chargement des albums…</div>';
    }
    if (emptyState) emptyState.style.display='none';
}

// Affichage des albums
function renderAlbums() {
  const normalizedFilter = currentAlbumFilter.trim();
  const dataset = normalizedFilter ? albums.filter(a => {
    const haystack = `${a.artist_name} ${a.album_title} ${a.label || ''}`.toLowerCase();
    return haystack.includes(normalizedFilter);
  }) : albums;
  const filteredByYear = dataset.filter(a => !yearExact || (a.release_year && a.release_year === yearExact));
  if (filteredByYear.length === 0) {
    albumsContainer.style.display='none'; emptyState.style.display='block';
    emptyState.innerHTML = normalizedFilter ? '<p>Aucun album ne correspond à votre filtre.</p>' : (albums.length === 0 ? '<p>Votre collection est vide.</p>' : '<p>Aucun album pour cette année.</p>');
    return;
  }
  albumsContainer.style.display='grid'; emptyState.style.display='none';
  albumsContainer.innerHTML = filteredByYear.map(a => createAlbumCard(a)).join('');
  albumsContainer.querySelectorAll('.delete-btn').forEach(btn => btn.addEventListener('click', e => { const id = e.currentTarget.getAttribute('data-album-id'); deleteAlbum(id); e.stopPropagation(); }));
  albumsContainer.querySelectorAll('.refresh-btn').forEach(btn => btn.addEventListener('click', e => { const id = e.currentTarget.getAttribute('data-album-id'); refreshAlbum(id); e.stopPropagation(); }));
  albumsContainer.querySelectorAll('.album-tile').forEach(tile => {
    tile.addEventListener('click', e => {
      if (e.target.closest('.tile-actions')) return; // ignore action clicks
      const id = parseInt(tile.getAttribute('data-album-id'),10);
      const album = albums.find(a => a.id === id);
      if (album) openAlbumModal(album);
    });
  });
}

function handleYearFilterChange() {
    const raw = yearFilterInput && yearFilterInput.value ? parseInt(yearFilterInput.value, 10) : null;
    yearExact = Number.isInteger(raw) ? raw : null;
    renderAlbums();
}

function resetYearFilter() {
    yearExact = null;
    if (yearFilterInput) yearFilterInput.value = '';
    renderAlbums();
}

// ================= ADMIN DEBUG TOKEN =================
function initAdminDebug() {
    const input = document.getElementById('adminTokenInput');
    const saveBtn = document.getElementById('saveAdminTokenBtn');
    const clearBtn = document.getElementById('clearAdminTokenBtn');
    const testBtn = document.getElementById('testAdminExportBtn');
    const status = document.getElementById('adminDebugStatus');
    if (!input || !saveBtn || !clearBtn || !testBtn) return; // section absente
    // Prefill
    const current = localStorage.getItem('ml-admin-token') || '';
    if (current) input.value = current;
    function setStatus(msg, type='info') {
        if (!status) return; status.textContent = msg; status.className='admin-debug-status '+type;
    }
    saveBtn.addEventListener('click', () => {
        const v = input.value.trim();
        if (!v) { setStatus('Token vide', 'error'); return; }
        localStorage.setItem('ml-admin-token', v);
        setStatus('Token enregistré en localStorage', 'ok');
    });
    clearBtn.addEventListener('click', () => {
        localStorage.removeItem('ml-admin-token');
        setStatus('Token supprimé', 'ok');
    });
    testBtn.addEventListener('click', async () => {
        setStatus('Test export…');
        try {
            const data = await adminFetch('/admin/export');
            setStatus('OK export reçu (' + (data.albums ? data.albums.length : 0) + ' albums)', 'ok');
        } catch (e) {
            setStatus('Échec: ' + e.message, 'error');
        }
    });
}

// Si l'utilisateur ne voit pas l'onglet Administration, ajout d'un bouton discret dans la barre d'outils albums

// ================= ADMIN EXPORT =================
let lastExportPayload = null;
async function handleExportJson() {
    if (!exportResultPre) return;
    exportResultPre.style.display='block';
    exportResultPre.textContent = 'Export en cours...';
    downloadJsonBtn && (downloadJsonBtn.style.display='none');
    try {
        lastExportPayload = await adminFetch(`/admin/export`);
        const pretty = JSON.stringify(lastExportPayload, null, 2);
        exportResultPre.textContent = pretty;
        if (downloadJsonBtn) downloadJsonBtn.style.display='';
    } catch (e) {
        exportResultPre.textContent = 'Erreur: ' + e.message;
    }
}

// ================= ADMIN HEALTH / REBUILD / IMPORT =================
async function handleDbHealthCheck() {
    if (!dbHealthSummary) return;
    dbHealthSummary.style.display='block';
    dbHealthSummary.textContent='Vérification en cours...';
    rebuildDbBtn && (rebuildDbBtn.style.display='none');
    importJsonTrigger && (importJsonTrigger.parentElement.style.display='none');
    try {
    const data = await adminFetch(`/admin/health`);
        const missing = Object.entries(data.tables).filter(([k,v]) => !v).map(([k])=>k);
        const counts = data.counts || {};
        const lines = [];
        lines.push(`Tables présentes: ${Object.keys(data.tables).filter(t=>data.tables[t]).length}/${Object.keys(data.tables).length}`);
        Object.keys(counts).forEach(t => lines.push(`${t}: ${counts[t]} enregistrements`));
        if (missing.length) {
            lines.push('Tables manquantes: ' + missing.join(', '));
            dbHealthSummary.className='db-health error';
            rebuildDbBtn && (rebuildDbBtn.style.display='');
        } else {
            dbHealthSummary.className='db-health ' + (data.ok ? 'ok' : 'error');
            // Si schéma ok mais vide -> proposer import
            const total = Object.values(counts).reduce((a,b)=>a+b,0);
            if (total === 0) {
                importJsonTrigger && (importJsonTrigger.parentElement.style.display='');
            } else {
                importJsonTrigger && (importJsonTrigger.parentElement.style.display='');
            }
        }
        dbHealthSummary.innerHTML = lines.map(l=>escapeHtml(l)).join('<br>');
    } catch (e) {
        dbHealthSummary.className='db-health error';
        dbHealthSummary.textContent='Erreur: ' + e.message;
    }
}

async function handleRebuildDb() {
    if (!confirm('Recréer le schéma si nécessaire ?')) return;
    rebuildDbBtn.disabled = true; const original = rebuildDbBtn.textContent; rebuildDbBtn.textContent='...';
    try {
    const data = await adminFetch(`/admin/rebuild`, { method:'POST' });
        showMessage(data.message || 'Schéma OK', 'success');
        handleDbHealthCheck();
    } catch (e) {
        showMessage('Erreur: ' + e.message, 'error');
    } finally { rebuildDbBtn.disabled=false; rebuildDbBtn.textContent=original; }
}

async function handleImportJson(evt) {
    const file = evt.target.files && evt.target.files[0];
    if (!file) return;
    if (!importStatusBox) return;
    importStatusBox.style.display='block';
    importStatusBox.textContent='Lecture fichier...';
    importStatusBox.className='import-status';
    try {
        const text = await file.text();
        let json;
        try { json = JSON.parse(text); } catch { throw new Error('JSON invalide'); }
        importStatusBox.textContent='Envoi vers le serveur...';
    const data = await adminFetch(`/admin/import`, { method:'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(json) });
        importStatusBox.className='import-status success';
        importStatusBox.textContent=`Import terminé: ${data.counts.albums} albums, ${data.counts.lists} listes.`;
        loadAlbums();
        loadLists();
        updateStats();
    } catch (e) {
        importStatusBox.className='import-status error';
        importStatusBox.textContent='Erreur: ' + e.message;
    } finally {
        evt.target.value='';
    }
}

function downloadExportedJson() {
    if (!lastExportPayload) return;
    const blob = new Blob([JSON.stringify(lastExportPayload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[:]/g,'-');
    a.href = url;
    a.download = `musiclist-export-${ts}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

// Création d'une carte d'album
function createAlbumCard(album) { // modified to add data-album-id
    if (!album) return '';
    if (!('album_title' in album) || !('artist_name' in album)) {
        console.warn('[AlbumCard] Champs manquants dans album', album);
    }
    const safeTitle = escapeHtml(album.album_title || '(Titre inconnu)');
    const safeArtist = escapeHtml(album.artist_name || '(Artiste inconnu)');
    const year = album && album.release_year ? album.release_year : 'Année inconnue';
    const genre = album.genre || ''; const style = album.style || ''; const label = album.label || ''; const country = album.country || '';
    const usedCount = album.list_usage_count || 0; const cannotDelete = usedCount > 0;
    const deleteTitle = cannotDelete ? `Album utilisé dans ${usedCount} liste(s)` : 'Supprimer cet album';
    const coverImage = album.cover_image_url ? `<img src="${album.cover_image_url}" alt="Pochette de ${safeTitle}" class="album-cover">` : `<div class="album-cover cover-placeholder" role="img">🎵</div>`;
    const tileLabel = `${album.artist_name} – ${album.album_title}${year && year !== 'Année inconnue' ? ` (${year})` : ''}`;
    return `
      <article class="album-tile ${cannotDelete ? 'in-use' : ''}" data-album-id="${album.id}" aria-label="${escapeHtml(tileLabel)}">
        <div class="tile-actions">
          <button class="refresh-btn" data-album-id="${album.id}" title="Rafraîchir depuis Discogs">⟳</button>
          <button class="delete-btn" data-album-id="${album.id}" title="${escapeHtml(deleteTitle)}" ${cannotDelete ? 'disabled' : ''}>×</button>
        </div>
        ${coverImage}
        <div class="tile-overlay tile-overlay--minimal">
          <div class="tile-info">
            <p class="tile-artist">${safeArtist}</p>
            <h3 class="tile-title">${safeTitle}</h3>
          </div>
        </div>
      </article>`;
}

// Ouvrir le modal d'album
function openAlbumModal(album) {
  if (!albumModal || !albumModalBody) return;
  albumModalBody.innerHTML = buildAlbumModalContent(album);
  albumModal.setAttribute('aria-hidden','false');
  albumModal.style.display='block';
  // close bindings
  albumModal.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', closeAlbumModal));
  document.addEventListener('keydown', escModalHandler, { once:true });
}

function closeAlbumModal() {
  if (!albumModal) return; albumModal.setAttribute('aria-hidden','true'); albumModal.style.display='none'; albumModalBody.innerHTML='';
}

function escModalHandler(e){ if (e.key === 'Escape') closeAlbumModal(); }

function buildAlbumModalContent(a) {
  const safeTitle = escapeHtml(a.album_title); const safeArtist = escapeHtml(a.artist_name);
  const cover = a.cover_image_url ? `<img src="${a.cover_image_url}" alt="Pochette ${safeTitle}">` : `<div class="cover-placeholder" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:4rem;">🎵</div>`;
  const discogsLink = a.release_id ? `https://www.discogs.com/release/${a.release_id}` : null;
  const metaEntries = [
    ['Année', a.release_year || '—'],
    ['Label', a.label || '—'],
    ['Pays', a.country || '—'],
    ['Genre', a.genre || '—'],
    ['Style', a.style || '—'],
    ['Release ID', a.release_id ? '#' + a.release_id : '—']
  ];
  const metaHtml = metaEntries.map(([k,v]) => `<li><span class="label">${escapeHtml(k)}</span><span>${escapeHtml(String(v))}</span></li>`).join('');
  // Tracklist si info disponible dans album.extra_json (si le backend l'a stockée un jour)
  let tracklistHtml = '';
  if (a.tracklist && Array.isArray(a.tracklist) && a.tracklist.length) {
    tracklistHtml = `<div class="album-tracklist"><h4>Pistes</h4><ul>${a.tracklist.map(t=>`<li>${escapeHtml(t.title || t)}</li>`).join('')}</ul></div>`;
  }
  return `
    <div class="album-modal-cover">${cover}</div>
    <div class="album-modal-info">
      <div class="album-modal-header">
        <div class="artist">${safeArtist}</div>
        <h3>${safeTitle}</h3>
      </div>
      <ul class="album-meta-list">${metaHtml}</ul>
      <div class="album-modal-actions">
        ${discogsLink ? `<a href="${discogsLink}" target="_blank" rel="noopener">Voir sur Discogs ↗</a>` : ''}
      </div>
      ${tracklistHtml}
    </div>`;
}

// ====================== LISTES ======================
function updateStats() {
    if (statAlbumsValue) {
        statAlbumsValue.textContent = albums.length;
        statAlbumsMeta.textContent = albums.length ? `${albums[0].artist_name} – ${albums[0].album_title}` : 'Ajoutez votre premier album.';
    }
    if (statListsValue) {
        statListsValue.textContent = lists.length;
        statListsMeta.textContent = lists.length ? `${lists[0].name} contient ${lists[0].item_count} album(s).` : 'Créez une liste personnalisée.';
    }
    if (statTagsValue) {
        const tagSet = new Set();
        lists.forEach(l => (l.tags||[]).forEach(t => tagSet.add(t)));
        const totalTagLinks = lists.reduce((acc,l)=>acc + ((l.tags||[]).length),0);
        statTagsValue.textContent = tagSet.size;
        statTagsMeta.textContent = tagSet.size ? `${totalTagLinks} utilisation(s) de tag au total.` : 'Ajoutez des tags pour mieux filtrer.';
    }
}
async function loadLists() {
    try {
        const res = await fetch(`${API_BASE_URL}/lists`);
        if (!res.ok) throw new Error('Erreur chargement listes');
        lists = await res.json();
        console.debug('[Lists] loaded', lists.length);
        renderLists();
        updateStats();
        const activeNav = document.querySelector('.nav-link.active');
        if (activeNav && activeNav.getAttribute('data-section') === 'stats') {
          renderStatsPage();
        }
    } catch (e) {
        console.error(e);
    }
}

function renderLists() {
    if (!listsContainer) return;
    listsContainer.innerHTML = lists.map(l => {
        const tags = Array.isArray(l.tags) ? l.tags : [];
        const tagBadges = tags.length > 0
            ? `<div class="badge-tags">${tags.slice(0, 4).map(t => `<span class="badge-tag" title="Tag: ${escapeHtml(t)}">${escapeHtml(t)}</span>`).join('')}${tags.length > 4 ? `<span class="badge-tag more" title="+${tags.length - 4} autre(s)">+${tags.length - 4}</span>` : ''}</div>`
            : '';
        return `
            <div class="list-badge" data-list-id="${l.id}">
                <div class="lb-title">${escapeHtml(l.name)}</div>
                <div class="lb-meta"><small>${l.item_count} item(s)</small></div>
                ${tagBadges}
            </div>`;
    }).join('');
    listsContainer.querySelectorAll('.list-badge').forEach(div => {
        div.addEventListener('click', () => {
            const id = div.getAttribute('data-list-id');
            loadListDetails(id);
        });
    });
}

async function handleCreateList(e) {
    e.preventDefault();
    const name = document.getElementById('listName').value.trim();
    const description = document.getElementById('listDescription').value.trim();
    if (!name) return;
    try {
        const res = await fetch(`${API_BASE_URL}/lists`, {
            method: 'POST',
            headers: { 'Content-Type':'application/json' },
            body: JSON.stringify({ name, description })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erreur création liste');
        showMessage('Liste créée', 'success');
        document.getElementById('listName').value='';
        document.getElementById('listDescription').value='';
        loadLists();
        updateStats();
    } catch (e) { showMessage(e.message, 'error'); }
}

async function loadListDetails(id) {
    try {
        const res = await fetch(`${API_BASE_URL}/lists/${id}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erreur chargement liste');
        renderListDetails(data);
    } catch (e) { showMessage(e.message, 'error'); }
}

function renderListDetails(list) {
    if (!listDetails) return;
    listDetails.style.display = 'block';
    const tagChips = (list.tags || []).map(t => `<span class="tag-chip" data-tag="${escapeHtml(t)}">${escapeHtml(t)}${listEditMode ? '<button type="button" class="tag-remove" aria-label="Retirer">×</button>' : ''}</span>`).join('');
    const addTagForm = listEditMode ? `
        <form class="add-tag-form" data-list-id="${list.id}">
            <input type="text" class="tag-input" placeholder="Nouveau tag" maxlength="30" />
            <button type="submit" class="tag-add-btn" disabled>Ajouter</button>
        </form>` : '';
    const editableName = listEditMode ? `<input type="text" class="list-name-input" value="${escapeHtml(list.name)}" />` : `<span class="list-name-static">${escapeHtml(list.name)}</span>`;
    const editableDesc = listEditMode ? `<textarea class="list-desc-input" rows="2" placeholder="Description...">${escapeHtml(list.description || '')}</textarea>` : `<span class="list-desc-static">${escapeHtml(list.description || '')}</span>`;
    listDetails.innerHTML = `
        <div class="list-header-block">
            <h3 class="list-title">${editableName}</h3>
            <div class="list-desc">${editableDesc}</div>
            ${listEditMode ? '<button type="button" class="save-meta-btn" disabled>💾 Sauver les infos</button>' : ''}
            <div class="tags-section">
                <div class="tags-label">Tags :</div>
                <div class="tags-chips">${tagChips || (!listEditMode ? '<span class="tag-empty">Aucun tag</span>' : '')}</div>
                ${addTagForm}
            </div>
        </div>
        <div class="list-toolbar">
            <button type="button" class="toggle-edit-btn ${listEditMode ? 'active' : ''}" aria-pressed="${listEditMode}" title="Activer / désactiver le mode édition">
                ${listEditMode ? '✔ Terminer l\'édition' : '✏️ Mode édition'}
            </button>
            <div class="view-toggle" role="group" aria-label="Mode d'affichage">
                <button type="button" class="view-btn ${listViewMode==='list' ? 'active':''}" data-view="list" title="Vue liste">📄</button>
                <button type="button" class="view-btn ${listViewMode==='mosaic' ? 'active':''}" data-view="mosaic" title="Vue mosaïque">🧩</button>
            </div>
            <button type="button" class="save-order-btn" ${listEditMode && listViewMode==='list' ? '' : 'style="display:none;"'} disabled title="Enregistrer le nouvel ordre">💾 Enregistrer l'ordre</button>
            ${listEditMode ? `<button type="button" class="delete-list-btn" title="Supprimer la liste">🗑 Supprimer</button>` : ''}
        </div>
        <form class="add-to-list-form" data-list-id="${list.id}">
            <div class="field-group">
                <label>Recherche locale</label>
                <input type="text" placeholder="Artiste ou Album" class="album-search-input" autocomplete="off">
                <div class="autocomplete-panel" style="display:none;"></div>
                <input type="hidden" class="album-add-input">
            </div>
            <div class="field-group">
                <label>Release ID Discogs</label>
                <input type="number" placeholder="Release ID Discogs" class="release-add-input">
            </div>
            <div class="field-group submit-group">
                <button type="submit">Ajouter à la liste</button>
            </div>
        </form>
        ${listViewMode === 'list' ? `
            <div class="list-items" data-edit="${listEditMode ? '1':'0'}">
                ${list.items.map(it => `
                    <div class="list-item-row" data-li-id="${it.list_item_id}" ${listEditMode ? 'draggable="true"' : ''}>
                        <div class="drag-handle" title="${listEditMode ? 'Glisser pour réordonner' : 'Activer le mode édition pour réordonner'}">⋮⋮</div>
                        <div class="pos">${it.position}</div>
                        <div class="info">${escapeHtml(it.artist_name)} – <strong>${escapeHtml(it.album_title)}</strong> <span class="year-tag">${it.release_year || ''}</span></div>
                        ${listEditMode ? `<button class=\"remove-list-item\" data-li-id=\"${it.list_item_id}\" title=\"Retirer\">×</button>` : ''}
                    </div>
                `).join('')}
            </div>` : `
            <div class="mosaic-grid">
                ${list.items.map(it => {
                    const cover = it.cover_image_url ? `<img src="${it.cover_image_url}" alt="Pochette ${escapeHtml(it.album_title)}" class="mosaic-cover" loading="lazy">` : `<div class=\"mosaic-cover placeholder\">🎵</div>`;
                    return `<div class="mosaic-card" data-li-id="${it.list_item_id}">
                        ${cover}
                        <div class="mosaic-meta">
                            <div class="mosaic-title" title="${escapeHtml(it.album_title)}">${escapeHtml(it.album_title)}</div>
                            <div class="mosaic-artist">${escapeHtml(it.artist_name)}</div>
                            <div class="mosaic-year">${it.release_year || ''}</div>
                        </div>
                        ${listEditMode ? `<button class=\"remove-list-item mosaic-remove\" data-li-id=\"${it.list_item_id}\" title=\"Retirer\">×</button>` : ''}
                    </div>`;
                }).join('')}
            </div>`}
    `;
    // Bind add form
    const addForm = listDetails.querySelector('.add-to-list-form');
    addForm.addEventListener('submit', handleAddItemToList);
    initAlbumAutocomplete(addForm);
    // Bind remove buttons (seulement en mode édition)
    if (listEditMode) {
        listDetails.querySelectorAll('.remove-list-item').forEach(btn => {
            btn.addEventListener('click', () => {
                const liId = btn.getAttribute('data-li-id');
                removeListItem(list.id, liId);
            });
        });
    }

    // Gestion sauvegarde nom / description
    if (listEditMode) {
        const nameInput = listDetails.querySelector('.list-name-input');
        const descInput = listDetails.querySelector('.list-desc-input');
        const metaBtn = listDetails.querySelector('.save-meta-btn');
        const tagForm = listDetails.querySelector('.add-tag-form');
        const tagInput = tagForm ? tagForm.querySelector('.tag-input') : null;
        const tagAddBtn = tagForm ? tagForm.querySelector('.tag-add-btn') : null;

        if (tagForm && tagInput && tagAddBtn) {
            tagInput.addEventListener('input', () => {
                tagAddBtn.disabled = tagInput.value.trim().length === 0;
            });
            tagForm.addEventListener('submit', async (event) => {
                event.preventDefault();
                const newTag = tagInput.value.trim();
                if (!newTag) return;
                tagAddBtn.disabled = true;
                try {
                    const res = await fetch(`${API_BASE_URL}/lists/${list.id}/tags`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ tag: newTag })
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || 'Erreur ajout tag');
                    list.tags = data.tags;
                    updateStats();
                    renderListDetails(list);
                } catch (error) {
                    showMessage(error.message, 'error');
                    tagAddBtn.disabled = false;
                }
            });
        }

        listDetails.querySelectorAll('.tag-remove').forEach(btn => {
            btn.addEventListener('click', async () => {
                const tag = btn.getAttribute('data-tag');
                if (!tag) return;
                btn.disabled = true;
                try {
                    const res = await fetch(`${API_BASE_URL}/lists/${list.id}/tags/${encodeURIComponent(tag)}`, { method: 'DELETE' });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || 'Erreur suppression tag');
                    list.tags = data.tags;
                    updateStats();
                    renderListDetails(list);
                } catch (error) {
                    showMessage(error.message, 'error');
                    btn.disabled = false;
                }
            });
        });

        const markDirty = () => {
            if (!metaBtn) return;
            const nameVal = nameInput ? nameInput.value.trim() : list.name;
            const descVal = descInput ? descInput.value.trim() : '';
            const unchanged = nameVal === list.name && descVal === (list.description || '');
            metaBtn.disabled = unchanged;
            metaBtn.classList.toggle('dirty', !unchanged);
        };

        if (nameInput) nameInput.addEventListener('input', markDirty);
        if (descInput) descInput.addEventListener('input', markDirty);

        if (metaBtn && nameInput && descInput) {
            metaBtn.addEventListener('click', async () => {
                const newName = nameInput.value.trim();
                const newDesc = descInput.value.trim();
                if (!newName) { showMessage('Le nom ne peut pas être vide', 'error'); return; }
                metaBtn.disabled = true;
                metaBtn.classList.remove('dirty');
                metaBtn.classList.add('loading');
                const originalText = metaBtn.textContent;
                metaBtn.textContent = 'Sauvegarde...';
                try {
                    const res = await fetch(`${API_BASE_URL}/lists/${list.id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: newName, description: newDesc || null })
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || 'Erreur mise à jour liste');
                    showMessage('Liste mise à jour', 'success');
                    list.name = data.list.name;
                    list.description = data.list.description;
                    updateStats();
                    renderListDetails(list);
                    loadLists();
                } catch (error) {
                    showMessage(error.message, 'error');
                    metaBtn.disabled = false;
                    metaBtn.textContent = originalText;
                    metaBtn.classList.remove('loading');
                }
            });
        }
    }
    // Bouton toggle mode édition
    const toggleBtn = listDetails.querySelector('.toggle-edit-btn');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            if (reorderInFlight) return; // éviter conflit
            listEditMode = !listEditMode;
            // Réinitialiser état d'ordre en attente si on quitte le mode
            if (!listEditMode) {
                pendingOrder = null;
                pendingOrderListId = null;
            }
            // Re-rendu sans refetch des données (on réutilise l'objet list actuel)
            renderListDetails(list);
        });
    }

    // Toggle view mode
    listDetails.querySelectorAll('.view-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const view = btn.getAttribute('data-view');
            if (view === listViewMode) return;
            listViewMode = view;
            // Si passage en mosaïque, désactiver mode édition
            if (listViewMode === 'mosaic' && listEditMode) {
                listEditMode = false;
            }
            renderListDetails(list);
        });
    });

    // Activer le drag & drop seulement si mode édition
    if (listEditMode && listViewMode === 'list') {
        enableListReordering(list.id);
    }

    // Gestion bouton sauvegarde
    const saveBtn = listDetails.querySelector('.save-order-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            if (!pendingOrder || pendingOrderListId !== list.id) return;
            saveBtn.disabled = true;
            saveBtn.textContent = 'Enregistrement...';
            try {
                await sendNewOrder(list.id, pendingOrder);
                pendingOrder = null;
                pendingOrderListId = null;
            } catch (e) {
                // message déjà géré dans sendNewOrder si erreur
            } finally {
                saveBtn.textContent = '💾 Enregistrer l\'ordre';
                saveBtn.disabled = true;
            }
        });
    }

    // Suppression liste
    if (listEditMode) {
        const delBtn = listDetails.querySelector('.delete-list-btn');
        if (delBtn) {
            delBtn.addEventListener('click', async () => {
                if (!confirm('Supprimer définitivement cette liste ?')) return;
                delBtn.disabled = true;
                delBtn.textContent = 'Suppression...';
                try {
                    const res = await fetch(`${API_BASE_URL}/lists/${list.id}`, { method: 'DELETE' });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || 'Erreur suppression liste');
                    showMessage('Liste supprimée', 'success');
                    listDetails.style.display='none';
                    loadLists();
                } catch (e) {
                    showMessage(e.message, 'error');
                    delBtn.disabled = false;
                    delBtn.textContent = '🗑 Supprimer';
                }
            });
        }
    }
}

// ================== REORDER LIST (DRAG & DROP) ==================
function enableListReordering(listId) {
    const container = listDetails.querySelector('.list-items');
    if (!container) return;

    let dragSrcEl = null;
    let dragOverEl = null;
    let reorderTimer = null;

    const rows = Array.from(container.querySelectorAll('.list-item-row'));
    rows.forEach(row => {
        row.addEventListener('dragstart', (e) => {
            dragSrcEl = row;
            row.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            try { e.dataTransfer.setData('text/plain', row.dataset.liId); } catch(_){}
        });
        row.addEventListener('dragend', () => {
            row.classList.remove('dragging');
            container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        });
        row.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (row === dragSrcEl) return;
            dragOverEl = row;
            container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
            row.classList.add('drag-over');
        });
        row.addEventListener('dragleave', () => {
            row.classList.remove('drag-over');
        });
        row.addEventListener('drop', (e) => {
            e.preventDefault();
            if (!dragSrcEl || dragSrcEl === row) return;
            row.classList.remove('drag-over');
            // Calcul insertion : avant ou après selon position verticale
            const bounding = row.getBoundingClientRect();
            const offset = e.clientY - bounding.top;
            const insertBefore = offset < bounding.height / 2;
            if (insertBefore) {
                container.insertBefore(dragSrcEl, row);
            } else {
                container.insertBefore(dragSrcEl, row.nextSibling);
            }
            updatePositionsLocal(listId, container);
        });
    });
}
function updatePositionsLocal(listId, container) {
    const rows = Array.from(container.querySelectorAll('.list-item-row'));
    rows.forEach((row, idx) => {
        const posEl = row.querySelector('.pos');
        if (posEl) posEl.textContent = idx + 1;
    });
    pendingOrder = rows.map(r => r.dataset.liId);
    pendingOrderListId = listId;
    // Activer bouton save
    const btn = listDetails.querySelector('.save-order-btn');
    if (btn) {
        btn.disabled = false;
        btn.classList.add('dirty');
    }
}

let reorderInFlight = false;
async function sendNewOrder(listId, order) {
    if (reorderInFlight) return; // simple lock pour éviter rafales
    reorderInFlight = true;
    try {
        const res = await fetch(`${API_BASE_URL}/lists/${listId}/items/order`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erreur réordonnancement');
        showMessage('Ordre mis à jour', 'success');
        // Recharger pour récupérer cohérence serveur (positions recalculées si besoin)
        loadListDetails(listId);
        loadLists();
    } catch (e) {
        showMessage(e.message, 'error');
    } finally {
        reorderInFlight = false;
    }
}

async function handleAddItemToList(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const listId = form.getAttribute('data-list-id');
    const releaseInput = form.querySelector('.release-add-input');
    const albumInput = form.querySelector('.album-add-input');
    const releaseVal = releaseInput.value.trim();
    const albumVal = albumInput.value.trim();
    if (!releaseVal && !albumVal) { showMessage('Fournir release ou album id', 'error'); return; }
    try {
        const payload = releaseVal ? { releaseId: parseInt(releaseVal,10) } : { albumId: parseInt(albumVal,10) };
        const res = await fetch(`${API_BASE_URL}/lists/${listId}/items`, {
            method: 'POST',
            headers: { 'Content-Type':'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erreur ajout item');
        showMessage('Album ajouté à la liste', 'success');
        releaseInput.value=''; albumInput.value='';
        loadListDetails(listId);
        loadLists();
    } catch (e) { showMessage(e.message, 'error'); }
}

async function removeListItem(listId, listItemId) {
    if (!listEditMode) { showMessage('Activez le mode édition pour supprimer un élément.', 'error'); return; }
    if (!confirm('Retirer cet album de la liste ?')) return;
    try {
        const res = await fetch(`${API_BASE_URL}/lists/${listId}/items/${listItemId}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erreur suppression');
        showMessage('Retiré de la liste', 'success');
        loadListDetails(listId);
        loadLists();
    } catch (e) { showMessage(e.message, 'error'); }
}

// ================== AUTOCOMPLETE ALBUM LOCAL ==================
function initAlbumAutocomplete(formEl) {
    const searchInput = formEl.querySelector('.album-search-input');
    const hiddenAlbumId = formEl.querySelector('.album-add-input');
    const panel = formEl.querySelector('.autocomplete-panel');
    if (!searchInput || !panel) return;

    let debounceTimer = null;
    let currentResults = [];

    searchInput.addEventListener('input', () => {
        hiddenAlbumId.value = '';
        const q = searchInput.value.trim();
        if (debounceTimer) clearTimeout(debounceTimer);
        if (q.length < 2) { panel.style.display='none'; panel.innerHTML=''; return; }
        debounceTimer = setTimeout(() => fetchAlbumSuggestions(q, panel, searchInput, hiddenAlbumId), 250);
    });

    searchInput.addEventListener('blur', () => {
        setTimeout(() => { panel.style.display='none'; }, 200);
    });
}

async function fetchAlbumSuggestions(q, panel, inputEl, hiddenAlbumId) {
    try {
        const res = await fetch(`${API_BASE_URL}/albums/search?q=${encodeURIComponent(q)}`);
        if (!res.ok) throw new Error('Erreur recherche');
        const data = await res.json();
        if (!Array.isArray(data) || data.length === 0) {
            panel.innerHTML = '<div class="ac-empty">Aucun résultat</div>';
            panel.style.display = 'block';
            return;
        }
        panel.innerHTML = data.map(a => `
            <div class="ac-item" data-album-id="${a.id}">
                <div class="ac-line-main">${escapeHtml(a.artist_name)} – <strong>${escapeHtml(a.album_title)}</strong></div>
                <div class="ac-line-meta">${a.release_year || ''} ${a.release_id ? '(Release ' + a.release_id + ')' : ''}</div>
            </div>
        `).join('');
        panel.style.display = 'block';
        panel.querySelectorAll('.ac-item').forEach(item => {
            item.addEventListener('mousedown', () => {
                const albumId = item.getAttribute('data-album-id');
                hiddenAlbumId.value = albumId;
                inputEl.value = item.querySelector('.ac-line-main').innerText;
                panel.style.display='none';
            });
        });
    } catch (e) {
        panel.innerHTML = '<div class="ac-error">Erreur</div>';
        panel.style.display='block';
    }
}

// Affichage des messages
function showMessage(text, type) {
    messageDiv.textContent = text;
    messageDiv.className = `message ${type}`;
    messageDiv.style.display = 'block';
    
    // Masquer le message après 5 secondes
    setTimeout(() => {
        messageDiv.style.display = 'none';
    }, 5000);
}

// Échappement HTML pour prévenir les attaques XSS
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ================== STATS HELPERS (restored) ==================
function computeAlbumStats(albumsArr) {
    const total = albumsArr.length;
    const byYear = new Map();
    const artistCounts = new Map();
    const genreCounts = new Map();
    for (const a of albumsArr) {
        if (a.release_year) byYear.set(a.release_year, (byYear.get(a.release_year)||0)+1);
        const artistKey = a.artist_name || 'Inconnu';
        artistCounts.set(artistKey, (artistCounts.get(artistKey)||0)+1);
        const genres = [];
        if (a.genre) genres.push(...String(a.genre).split(',').map(s=>s.trim()).filter(Boolean));
        if (a.style) genres.push(...String(a.style).split(',').map(s=>s.trim()).filter(Boolean));
        genres.forEach(g => genreCounts.set(g, (genreCounts.get(g)||0)+1));
    }
    const yearDistribution = Array.from(byYear.entries()).sort((a,b)=>a[0]-b[0]);
    const topArtists = Array.from(artistCounts.entries()).sort((a,b)=>b[1]-a[1]).slice(0,25);
    const topGenres = Array.from(genreCounts.entries()).sort((a,b)=>b[1]-a[1]).slice(0,50);
    return { total, yearDistribution, topArtists, genreCounts: topGenres };
}

function computeListStats(listsArr, albumsArr) {
    const listSizeDetails = listsArr.map(l => ({ id: l.id, name: l.name, size: l.item_count }));
    const tagUsageMap = new Map();
    listsArr.forEach(l => (l.tags||[]).forEach(t => tagUsageMap.set(t, (tagUsageMap.get(t)||0)+1)));
    const tagUsage = Array.from(tagUsageMap.entries()).sort((a,b)=>b[1]-a[1]);
    const totalListItems = listSizeDetails.reduce((a,b)=>a + (b.size||0), 0);
    const avgSize = listSizeDetails.length ? (totalListItems / listSizeDetails.length) : 0;
    const largest = listSizeDetails.slice().sort((a,b)=>b.size - a.size).slice(0,1);
    return { listSizeDetails, tagUsage, totalListItems, avgSize, largest };
}

// ===== Rendering helpers (recréés si perdus) =====
function buildStatCards(albumStats, listStats) {
    const distinctArtists = new Set(albums.map(a=>a.artist_name)).size;
    const distinctYears = new Set(albums.filter(a=>a.release_year).map(a=>a.release_year)).size;
    return `
        <div class="stats-card">
            <h3>Albums</h3><div class="stat-value">${albumStats.total}</div><div class="stat-sub">Total albums</div>
        </div>
        <div class="stats-card">
            <h3>Artistes</h3><div class="stat-value">${distinctArtists}</div><div class="stat-sub">Artistes uniques</div>
        </div>
        <div class="stats-card">
            <h3>Années</h3><div class="stat-value">${distinctYears}</div><div class="stat-sub">Années distinctes</div>
        </div>
        <div class="stats-card">
            <h3>Listes</h3><div class="stat-value">${lists.length}</div><div class="stat-sub">Listes actives</div>
        </div>
        <div class="stats-card">
            <h3>Entrées listes</h3><div class="stat-value">${listStats.totalListItems}</div><div class="stat-sub">Albums dans listes</div>
        </div>
        <div class="stats-card">
            <h3>Tags</h3><div class="stat-value">${listStats.tagUsage.length}</div><div class="stat-sub">Tags différents</div>
        </div>`;
}

function buildYearDistributionSection(yearDist) {
    if (!yearDist.length) return '';
    const max = Math.max(...yearDist.map(r=>r[1]));
    const bars = yearDist.slice(-16);
    return `
        <div class="stats-details-section">
            <h4>Distribution par année (dern. 16)</h4>
            <div class="mini-bar">${bars.map(([y,c])=>`<span title="${y}: ${c}" data-v="${(c/max).toFixed(3)}"></span>`).join('')}</div>
            <div class="stats-table-wrapper"><table class="stats-table"><thead><tr><th>Année</th><th>Albums</th></tr></thead><tbody>
            ${yearDist.map(([y,c])=>`<tr><td>${y}</td><td>${c}</td></tr>`).join('')}
            </tbody></table></div>
        </div>`;
}

function buildTopArtistsSection(top) {
    if (!top.length) return '';
    return `<div class="stats-details-section"><h4>Top Artistes</h4><div class="stats-table-wrapper"><table class="stats-table"><thead><tr><th>Artiste</th><th>Albums</th></tr></thead><tbody>${top.map(([a,c])=>`<tr><td>${escapeHtml(a)}</td><td>${c}</td></tr>`).join('')}</tbody></table></div></div>`;
}

function buildGenreSection(genreCounts) {
    if (!genreCounts.length) return '';
    return `<div class="stats-details-section"><h4>Genres / Styles</h4><div class="stats-table-wrapper"><table class="stats-table"><thead><tr><th>Genre / Style</th><th>Occur.</th></tr></thead><tbody>${genreCounts.map(([g,c])=>`<tr><td>${escapeHtml(g)}</td><td>${c}</td></tr>`).join('')}</tbody></table></div></div>`;
}

function buildListSizeSection(listSizeDetails) {
    if (!listSizeDetails.length) return '';
    const sorted = listSizeDetails.slice().sort((a,b)=>b.size - a.size);
    return `<div class="stats-details-section"><h4>Taille des listes</h4><div class="stats-table-wrapper"><table class="stats-table"><thead><tr><th>Liste</th><th>Taille</th></tr></thead><tbody>${sorted.map(l=>`<tr><td>${escapeHtml(l.name)}</td><td>${l.size}</td></tr>`).join('')}</tbody></table></div></div>`;
}

function buildTagUsageSection(tagUsage) {
    if (!tagUsage.length) return '';
    return `<div class="stats-details-section"><h4>Utilisation des tags</h4><div class="stats-table-wrapper"><table class="stats-table"><thead><tr><th>Tag</th><th>Listes</th></tr></thead><tbody>${tagUsage.map(([t,c])=>`<tr><td>${escapeHtml(t)}</td><td>${c}</td></tr>`).join('')}</tbody></table></div></div>`;
}

function renderStatsPage() {
  console.debug('[Stats] render charts only', { albums: albums.length, lists: lists.length });
  const albumStats = computeAlbumStats(albums);
  drawYearChart(albumStats.yearDistribution);
  drawGenreChart(albumStats.genreCounts);
}

function drawYearChart(yearDist) {
  const canvas = document.getElementById('yearChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0,0,w,h);
    if (!yearDist || !yearDist.length) {
        ctx.font='14px system-ui';
        ctx.fillStyle=getComputedStyle(document.documentElement).getPropertyValue('--text-dim')||'#666';
        ctx.textAlign='center';
        ctx.textBaseline='middle';
        ctx.fillText('Aucune donnée année', w/2, h/2);
        return;
    }
    const padding = { l: 40, r: 10, t: 10, b: 28 };
  const last = yearDist.slice(-24); // up to last 24 years
  const max = Math.max(...last.map(r=>r[1]));
    if (!max) {
        ctx.font='14px system-ui';
        ctx.fillStyle=getComputedStyle(document.documentElement).getPropertyValue('--text-dim')||'#666';
        ctx.textAlign='center';
        ctx.textBaseline='middle';
        ctx.fillText('Données années vides', w/2, h/2);
        return;
    }
  const barGap = 4;
  const plotW = w - padding.l - padding.r;
  const plotH = h - padding.t - padding.b;
  const barW = Math.max(6, Math.floor((plotW - barGap*(last.length-1))/last.length));
  ctx.font = '11px system-ui';
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-dim') || '#666';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(max), padding.l - 4, padding.t + 4);
  ctx.textAlign = 'center';
  last.forEach((entry, i) => {
    const [year, count] = entry;
    const x = padding.l + i * (barW + barGap);
    const barH = max ? (count / max) * plotH : 0;
    const y = padding.t + (plotH - barH);
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#3b82f6';
    const accentFade = getComputedStyle(document.documentElement).getPropertyValue('--accent-fade').trim() || '#9ab';
    const grd = ctx.createLinearGradient(0, y, 0, y + barH);
    grd.addColorStop(0, accent);
    grd.addColorStop(1, accentFade);
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, barW, barH, 3) : ctx.rect(x,y,barW,barH); ctx.fill();
    // Outline to increase contrast
    ctx.strokeStyle = accent;
    ctx.lineWidth = 0.5;
    ctx.stroke();
    if (last.length <= 16 || i % 2 === 0) {
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-dim') || '#555';
      ctx.save();
      ctx.translate(x + barW/2, h - padding.b + 10);
      ctx.rotate(-Math.PI/4);
      ctx.fillText(String(year), 0,0);
      ctx.restore();
    }
  });
  // Axis line
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--border') || '#ccc';
  ctx.beginPath(); ctx.moveTo(padding.l, h - padding.b); ctx.lineTo(w - padding.r, h - padding.b); ctx.stroke();
}

function drawGenreChart(genreCounts) {
  const canvas = document.getElementById('genreChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0,0,w,h);
    if (!genreCounts || !genreCounts.length) {
        ctx.font='14px system-ui';
        ctx.fillStyle=getComputedStyle(document.documentElement).getPropertyValue('--text-dim')||'#666';
        ctx.textAlign='center';
        ctx.textBaseline='middle';
        ctx.fillText('Aucune donnée genre/style', w/2, h/2);
        return;
    }
    const top = genreCounts.slice(0,12);
    const max = Math.max(...top.map(r=>r[1]));
    if (!max) {
        ctx.font='14px system-ui';
        ctx.fillStyle=getComputedStyle(document.documentElement).getPropertyValue('--text-dim')||'#666';
        ctx.textAlign='center';
        ctx.textBaseline='middle';
        ctx.fillText('Données genres vides', w/2, h/2);
        return;
    }
  const padding = { l: 140, r: 10, t: 10, b: 10 };
  const rowH = (h - padding.t - padding.b) / top.length;
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#3b82f6';
  const accentFade = getComputedStyle(document.documentElement).getPropertyValue('--accent-fade').trim() || '#9ab';
  ctx.font = '11px system-ui';
  ctx.textBaseline = 'middle';
  top.forEach((entry,i) => {
    const [name,val] = entry;
    const yMid = padding.t + i * rowH + rowH/2;
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text') || '#222';
    ctx.textAlign = 'right';
    ctx.fillText(name, padding.l - 8, yMid);
    const barMaxW = w - padding.l - padding.r - 40;
    const bw = max ? (val/max)*barMaxW : 0;
    const x = padding.l;
    const y = yMid - (rowH*0.45)/2;
    const barH = rowH*0.45;
    const grd = ctx.createLinearGradient(x, y, x + bw, y);
    grd.addColorStop(0, accent);
    grd.addColorStop(1, accentFade);
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, bw, barH, 4) : ctx.rect(x,y,bw,barH); ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 0.5;
    ctx.stroke();
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-dim') || '#555';
    ctx.textAlign = 'left';
    ctx.fillText(String(val), x + bw + 6, yMid);
  });
}
function validateAlbumsSchema(arr) {
  if (!Array.isArray(arr)) return 'La réponse albums n\'est pas un tableau';
  for (let i=0;i<Math.min(arr.length,5);i++) {
    const a = arr[i];
    if (typeof a !== 'object') return 'Entrée non objet index ' + i;
    if (!('id' in a)) return 'Champ id manquant index ' + i;
    if (!('album_title' in a)) return 'Champ album_title manquant index ' + i;
    if (!('artist_name' in a)) return 'Champ artist_name manquant index ' + i;
  }
  return null;
}