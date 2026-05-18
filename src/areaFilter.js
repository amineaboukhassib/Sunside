// ============================================================
// areaFilter.js — Area · Sort · Near Me · Sunny filter
// ============================================================

export const AREAS = [
  { id: 'all',         label: 'All Areas',   emoji: '🗺️' },
  { id: 'Cihangir',    label: 'Cihangir',    emoji: '☕' },
  { id: 'Beyoglu',     label: 'Beyoğlu',     emoji: '🎭' },
  { id: 'Galata',      label: 'Galata',      emoji: '🗼' },
  { id: 'Karakoy',     label: 'Karaköy',     emoji: '⚓' },
  { id: 'Nisantasi',   label: 'Nişantaşı',   emoji: '🛍️' },
  { id: 'Besiktas',    label: 'Beşiktaş',    emoji: '⚽' },
  { id: 'Bebek',       label: 'Bebek',       emoji: '🌊' },
  { id: 'Arnavutkoy',  label: 'Arnavutköy',  emoji: '🏡' },
  { id: 'Sultanahmet', label: 'Sultanahmet', emoji: '🕌' },
  { id: 'Balat',       label: 'Balat',       emoji: '🎨' },
  { id: 'Eminonu',     label: 'Eminönü',     emoji: '⛵' },
  { id: 'Ortakoy',     label: 'Ortaköy',     emoji: '🌉' },
  { id: 'Istanbul',    label: 'Other',       emoji: '📍' },
];

// ── State ────────────────────────────────────────────────────
let activeArea      = 'all';
let activeSunnyOnly = false;
let activeSort      = 'all';   // 'all' | 'sun' | 'nearest'
let activeRadius    = null;    // null | 500 | 1000 | 2000
let userLat         = null;
let userLng         = null;
let onFilterChange  = null;
let allCafesRef     = null;

// ── Haversine (local copy, avoids import cycle) ───────────────
function distMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Public: set user location from main.js ────────────────────
export function setUserLocation(lat, lng) {
  userLat = lat;
  userLng = lng;
  // Enable the "Nearest" sort button now that we have a position
  document.querySelector('[data-sort="nearest"]')?.removeAttribute('disabled');
  // Re-trigger filter with fresh distances
  if (onFilterChange && allCafesRef) {
    onFilterChange(filterCafes(allCafesRef), activeArea, activeSunnyOnly);
  }
}

// ── Core filter + sort ────────────────────────────────────────
export function filterCafes(allCafes, area = activeArea, sunnyOnly = activeSunnyOnly) {
  // Attach distanceMeters to every cafe
  if (userLat !== null) {
    allCafes.forEach(c => {
      const lat = c.location?.latitude;
      const lng = c.location?.longitude;
      if (lat && lng) c.distanceMeters = distMeters(userLat, userLng, lat, lng);
    });
  }

  let result = allCafes;

  if (area !== 'all') {
    result = result.filter(c => c.area === area);
  }
  if (sunnyOnly) {
    result = result.filter(c => (c.sunScore ?? 0) > 50);
  }
  if (activeRadius !== null && userLat !== null) {
    result = result.filter(c => (c.distanceMeters ?? Infinity) <= activeRadius);
  }

  // Sort
  if (activeSort !== 'all') {
    result = [...result].sort((a, b) => {
      if (activeSort === 'nearest' && userLat !== null) {
        return (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity);
      }
      // Sun score desc; zeros sink to bottom
      const sa = a.sunScore ?? 0, sb = b.sunScore ?? 0;
      if (sa === 0 && sb > 0) return 1;
      if (sb === 0 && sa > 0) return -1;
      return sb - sa;
    });
  }

  return result;
}

export function getCafeCounts(allCafes) {
  const counts = { all: allCafes.length };
  AREAS.forEach(a => {
    if (a.id !== 'all') counts[a.id] = allCafes.filter(c => c.area === a.id).length;
  });
  return counts;
}

export function getSunnyCounts(allCafes) {
  const sunny = allCafes.filter(c => (c.sunScore ?? 0) > 50);
  const counts = { all: sunny.length };
  AREAS.forEach(a => {
    if (a.id !== 'all') counts[a.id] = sunny.filter(c => c.area === a.id).length;
  });
  return counts;
}

// ── Init ──────────────────────────────────────────────────────
export function initAreaFilter(allCafes, callback) {
  allCafesRef    = allCafes;
  onFilterChange = callback;
  injectStyles();

  const container = document.createElement('div');
  container.id = 'area-filter';
  container.innerHTML = buildHTML(allCafes);

  (document.querySelector('.map-overlay') || document.querySelector('#app') || document.body)
    .appendChild(container);

  attachEvents(allCafes);
  onFilterChange(filterCafes(allCafes), activeArea, activeSunnyOnly);
}

// ── HTML ──────────────────────────────────────────────────────
function buildHTML(allCafes) {
  const counts      = getCafeCounts(allCafes);
  const sunnyCounts = getSunnyCounts(allCafes);

  const pills = AREAS
    .filter(a => a.id === 'all' || counts[a.id] > 0)
    .map(a => {
      const count  = counts[a.id]      || 0;
      const sunny  = sunnyCounts[a.id] || 0;
      return `
        <button class="area-pill ${a.id === activeArea ? 'active' : ''}"
                data-area="${a.id}"
                title="${count} cafes, ${sunny} sunny now">
          <span class="pill-emoji">${a.emoji}</span>
          <span class="pill-label">${a.label}</span>
          <span class="pill-count">${count}</span>
          ${sunny > 0 ? `<span class="pill-sunny">☀️ ${sunny}</span>` : ''}
        </button>`;
    }).join('');

  return `
    <div class="filter-bar">
      <div class="filter-pills" id="filter-pills">${pills}</div>
      <div class="filter-controls">
        <button class="sort-btn ${activeSort === 'all' ? 'active' : ''}" data-sort="all">All</button>
        <button class="sort-btn ${activeSort === 'sun' ? 'active' : ''}" data-sort="sun">☀️ Sunniest</button>
        <button class="sort-btn ${activeSort === 'nearest' ? 'active' : ''}" data-sort="nearest" ${userLat === null ? 'disabled' : ''}>📍 Nearest</button>
        <span class="filter-divider">|</span>
        <button class="radius-btn ${activeRadius === 500  ? 'active' : ''}" data-radius="500">500m</button>
        <button class="radius-btn ${activeRadius === 1000 ? 'active' : ''}" data-radius="1000">1km</button>
        <button class="radius-btn ${activeRadius === 2000 ? 'active' : ''}" data-radius="2000">2km</button>
        <span class="filter-divider">|</span>
        <button class="sunny-toggle ${activeSunnyOnly ? 'active' : ''}" id="sunny-toggle">☀️ Sunny only</button>
      </div>
    </div>`;
}

// ── Events ────────────────────────────────────────────────────
function attachEvents(allCafes) {
  const root = document.getElementById('area-filter');

  // Area pills
  document.getElementById('filter-pills').addEventListener('click', e => {
    const pill = e.target.closest('.area-pill');
    if (!pill) return;
    activeArea = pill.dataset.area;
    document.querySelectorAll('.area-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    onFilterChange(filterCafes(allCafes), activeArea, activeSunnyOnly);
  });

  // Sort buttons
  root.addEventListener('click', e => {
    const sortBtn = e.target.closest('.sort-btn');
    if (sortBtn && !sortBtn.disabled) {
      activeSort = sortBtn.dataset.sort;
      root.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
      sortBtn.classList.add('active');
      onFilterChange(filterCafes(allCafes), activeArea, activeSunnyOnly);
    }

    // Radius buttons (toggle off if already active)
    const radiusBtn = e.target.closest('.radius-btn');
    if (radiusBtn) {
      const r = Number(radiusBtn.dataset.radius);
      activeRadius = activeRadius === r ? null : r;
      root.querySelectorAll('.radius-btn').forEach(b => b.classList.remove('active'));
      if (activeRadius !== null) radiusBtn.classList.add('active');
      // Auto-switch to nearest sort when radius is set
      if (activeRadius !== null && userLat !== null) {
        activeSort = 'nearest';
        root.querySelectorAll('.sort-btn').forEach(b =>
          b.classList.toggle('active', b.dataset.sort === 'nearest'));
      }
      onFilterChange(filterCafes(allCafes), activeArea, activeSunnyOnly);
    }
  });

  // Sunny only toggle
  document.getElementById('sunny-toggle').addEventListener('click', () => {
    activeSunnyOnly = !activeSunnyOnly;
    document.getElementById('sunny-toggle').classList.toggle('active', activeSunnyOnly);
    onFilterChange(filterCafes(allCafes), activeArea, activeSunnyOnly);
  });
}

// ── Refresh sunny badges (called from applySunScores) ─────────
export function refreshFilterCounts(allCafes) {
  const sunnyCounts = getSunnyCounts(allCafes);
  const counts      = getCafeCounts(allCafes);

  AREAS.forEach(area => {
    const pill = document.querySelector(`.area-pill[data-area="${area.id}"]`);
    if (!pill) return;
    const sunnyCount = sunnyCounts[area.id] || 0;
    pill.title = `${counts[area.id] || 0} cafes, ${sunnyCount} sunny now`;
    let badge = pill.querySelector('.pill-sunny');
    if (sunnyCount > 0) {
      if (!badge) { badge = document.createElement('span'); badge.className = 'pill-sunny'; pill.appendChild(badge); }
      badge.textContent = `☀️ ${sunnyCount}`;
    } else if (badge) badge.remove();
  });

  if (activeSunnyOnly && onFilterChange && allCafesRef) {
    onFilterChange(filterCafes(allCafesRef), activeArea, activeSunnyOnly);
  }
}

// ── Styles ────────────────────────────────────────────────────
function injectStyles() {
  if (document.getElementById('area-filter-styles')) return;
  const style = document.createElement('style');
  style.id = 'area-filter-styles';
  style.textContent = `
    #area-filter {
      position: absolute;
      bottom: 32px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 100;
      width: min(92vw, 720px);
    }
    .filter-bar { display: flex; flex-direction: column; gap: 8px; align-items: center; }

    /* Area pills row */
    .filter-pills {
      display: flex; gap: 8px; overflow-x: auto; padding: 4px 2px;
      scrollbar-width: none; width: 100%;
    }
    .filter-pills::-webkit-scrollbar { display: none; }

    .area-pill {
      display: flex; align-items: center; gap: 5px;
      padding: 7px 12px; border-radius: 999px;
      border: 1px solid rgba(255,255,255,0.15);
      background: rgba(20,18,14,0.85); backdrop-filter: blur(12px);
      color: rgba(255,255,255,0.7); font-size: 12px; font-weight: 500;
      white-space: nowrap; cursor: pointer; transition: all 0.18s ease; flex-shrink: 0;
    }
    .area-pill:hover { border-color: rgba(251,191,36,0.5); color:#fff; transform:translateY(-1px); }
    .area-pill.active { background:rgba(251,191,36,0.2); border-color:#FBBF24; color:#FBBF24; font-weight:600; }
    .pill-emoji { font-size: 13px; }
    .pill-count { background:rgba(255,255,255,0.1); border-radius:999px; padding:1px 6px; font-size:10px; color:rgba(255,255,255,0.5); }
    .area-pill.active .pill-count { background:rgba(251,191,36,0.2); color:#FBBF24; }
    .pill-sunny { font-size:10px; background:rgba(251,191,36,0.15); color:#FBBF24; border-radius:999px; padding:1px 6px; }

    /* Controls row */
    .filter-controls {
      display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: center;
    }
    .sort-btn, .radius-btn, .sunny-toggle {
      padding: 6px 13px; border-radius: 999px;
      border: 1px solid rgba(255,255,255,0.15);
      background: rgba(20,18,14,0.85); backdrop-filter: blur(12px);
      color: rgba(255,255,255,0.7); font-size: 12px; font-weight: 500;
      cursor: pointer; transition: all 0.18s ease; white-space: nowrap;
    }
    .sort-btn:disabled { opacity: 0.38; cursor: not-allowed; }
    .sort-btn:not(:disabled):hover,
    .radius-btn:hover,
    .sunny-toggle:hover { border-color:rgba(251,191,36,0.5); color:#fff; }
    .sort-btn.active, .radius-btn.active, .sunny-toggle.active {
      background:rgba(251,191,36,0.2); border-color:#FBBF24; color:#FBBF24; font-weight:600;
    }
    .filter-divider { color: rgba(255,255,255,0.2); font-size: 14px; user-select: none; }

    @media (max-width: 600px) {
      #area-filter { bottom: 16px; width: 96vw; }
      .area-pill, .sort-btn, .radius-btn, .sunny-toggle { padding: 5px 10px; font-size: 11px; }
    }
  `;
  document.head.appendChild(style);
}
