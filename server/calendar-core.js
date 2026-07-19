/* ---------- Pick Your Fit — shared calendar logic ----------
   Calendar entries and favorites are stored server-side in Firestore
   (see calendarRoutes.js / favoritesRoutes.js). This module keeps a local
   in-memory cache so pages can keep reading getCalendarEntries()/getFavorites()
   synchronously after calling PYFCal.init() once — only the mutating calls
   (scheduleOutfit, toggleFavorite, deleteCalendarEntry,
   moveCalendarEntryToFavorites) are async and need `await`. */
(function (global) {
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const WEEKDAY_SHORT = ['Mo','Tu','We','Th','Fr','Sa','Su'];

  const POS_A = {
    head:      { top: '0%',  left: '50%', width: '16%', height: '8%'  },
    jacket:    { top: '9%',  left: '21%', width: '42%', height: '27%' },
    upperBody: { top: '9%',  left: '50%', width: '40%', height: '27%' },
    purse:     { top: '13%', left: '79%', width: '24%', height: '16%' },
    lowerBody: { top: '33%', left: '50%', width: '48%', height: '33%' },
    sockBig:   { top: '58%', left: '50%', width: '36%', height: '22%' },
    sockSmall: { top: '78%', left: '23%', width: '24%', height: '10%' },
    shoes:     { top: '75%', left: '50%', width: '24%', height: '14%' },
  };
  const POS_B = {
    head:      { top: '0%',  left: '50%', width: '16%', height: '8%'  },
    jacket:    { top: '9%',  left: '21%', width: '44%', height: '27%' },
    body:      { top: '11%', left: '50%', width: '60%', height: '64%' },
    purse:     { top: '13%', left: '79%', width: '24%', height: '16%' },
    sockBig:   { top: '68%', left: '50%', width: '36%', height: '20%' },
    sockSmall: { top: '84%', left: '23%', width: '24%', height: '10%' },
    shoes:     { top: '82%', left: '50%', width: '24%', height: '14%' },
  };

  // ---------- API helpers ----------
  function authHeaders(extra) {
    const idToken = localStorage.getItem('pyf_idToken');
    return Object.assign(
      { 'Content-Type': 'application/json' },
      idToken ? { Authorization: 'Bearer ' + idToken } : {},
      extra || {}
    );
  }

  async function apiRequest(path, options) {
    const res = await fetch('/api' + path, Object.assign({}, options, { headers: authHeaders((options && options.headers) || {}) }));
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || 'Request failed');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // ---------- Local cache (populated by init(), kept in sync by mutations) ----------
  let calendarCache = [];
  let favoritesCache = [];
  let initialized = false;

  async function init() {
    const [calRes, favRes] = await Promise.all([
      apiRequest('/calendar', { method: 'GET' }),
      apiRequest('/favorites', { method: 'GET' }),
    ]);
    calendarCache = (calRes && calRes.entries) || [];
    favoritesCache = (favRes && favRes.favorites) || [];
    initialized = true;
    return { calendar: calendarCache, favorites: favoritesCache };
  }

  function getCalendarEntries() { return calendarCache; }
  function getFavorites() { return favoritesCache; }

  // local (not UTC) YYYY-MM-DD, so it lines up with real-world "today"
  function toDateStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  function todayStr() { return toDateStr(new Date()); }

  function buildDateMap(entries) {
    const map = {};
    entries.forEach((e) => {
      if (!e.date) return;
      if (!map[e.date]) map[e.date] = [];
      map[e.date].push(e);
    });
    return map;
  }

  // Kept for backward compatibility with any code that still needs a
  // composite key; prefer entry.id (Firestore doc id) wherever possible.
  function entryKey(e) { return e.id || ((e.date || '') + '|' + (e.savedAt || '') + '|' + (e.signature || '')); }

  function outfitSignature(outfit) {
    return outfit.type + ':' + Object.values(outfit.items).filter((i) => i).map((i) => i.id).sort().join(',');
  }

  function isFavorited(signature) {
    return favoritesCache.some((f) => f.signature === signature);
  }

  // Schedules an outfit on dateStr. Checks the local cache first (fast,
  // avoids an obviously-duplicate request) and the server also rejects
  // duplicates (409) as the source of truth in case of a stale cache.
  async function scheduleOutfit(outfit, dateStr) {
    const alreadyThere = calendarCache.some((e) => e.date === dateStr && e.signature === outfit.signature);
    if (alreadyThere) {
      const err = new Error('DUPLICATE');
      err.duplicate = true;
      throw err;
    }
    try {
      const created = await apiRequest('/calendar', {
        method: 'POST',
        body: JSON.stringify({
          signature: outfit.signature,
          type: outfit.type,
          items: outfit.items,
          isTights: !!outfit.isTights,
          date: dateStr,
        }),
      });
      calendarCache.push(created);
      return created;
    } catch (err) {
      if (err.status === 409) {
        err.duplicate = true;
      }
      throw err;
    }
  }

  // Adds/removes the outfit from favorites (toggle), mirroring the old
  // localStorage behaviour. Returns true if now favorited, false if removed.
  async function toggleFavorite(outfit) {
    const existing = favoritesCache.find((f) => f.signature === outfit.signature);
    if (existing) {
      await apiRequest('/favorites/' + existing.id, { method: 'DELETE' });
      favoritesCache = favoritesCache.filter((f) => f.id !== existing.id);
      return false;
    }
    const created = await apiRequest('/favorites', {
      method: 'POST',
      body: JSON.stringify({ signature: outfit.signature, type: outfit.type, items: outfit.items }),
    });
    favoritesCache = favoritesCache.filter((f) => f.signature !== created.signature);
    favoritesCache.push(created);
    return true;
  }

  async function deleteCalendarEntry(entry) {
    await apiRequest('/calendar/' + entry.id, { method: 'DELETE' });
    calendarCache = calendarCache.filter((e) => e.id !== entry.id);
    return calendarCache;
  }

  async function moveCalendarEntryToFavorites(entry) {
    const result = await apiRequest('/calendar/' + entry.id + '/favorite', { method: 'POST' });
    calendarCache = calendarCache.filter((e) => e.id !== entry.id);
    favoritesCache = favoritesCache.filter((f) => f.id !== result.favorite.id);
    favoritesCache.push(result.favorite);
    return calendarCache;
  }

  // Builds a div containing the layered outfit images (no card, no background).
  function renderOutfitComposite(entry, className) {
    const frame = document.createElement('div');
    frame.className = className || 'pyf-outfit-composite';
    const POS = entry.type === 'A' ? POS_A : POS_B;
    const items = entry.items || {};

    function place(item, pos, z) {
      if (!item || !pos) return;
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.src = item.imageUrl;
      img.alt = item.category || '';
      img.style.position = 'absolute';
      img.style.top = pos.top;
      img.style.left = pos.left;
      img.style.width = pos.width;
      img.style.height = pos.height;
      img.style.objectFit = 'contain';
      img.style.transform = 'translateX(-50%)';
      img.style.zIndex = z;
      img.style.filter = 'drop-shadow(0 3px 6px rgba(34,34,43,0.16))';
      frame.appendChild(img);
    }

    place(items.jacket, POS.jacket, 1);
    if (entry.type === 'A') {
      place(items.upperBody, POS.upperBody, 2);
      place(items.lowerBody, POS.lowerBody, 2);
    } else {
      place(items.body, POS.body, 2);
    }
    place(items.purse, POS.purse, 3);
    if (items.sock) {
      const pos = entry.isTights || items.sock.category === 'Tights' ? POS.sockBig : POS.sockSmall;
      place(items.sock, pos, 1);
    }
    place(items.shoes, POS.shoes, 1);
    place(items.head, POS.head, 4);

    return frame;
  }

  // 42-cell (6x7) matrix for a given month, Monday-first.
  function monthMatrix(year, monthIndex) {
    const firstOfMonth = new Date(year, monthIndex, 1);
    const firstWeekday = (firstOfMonth.getDay() + 6) % 7; // 0 = Monday
    const startDate = new Date(year, monthIndex, 1 - firstWeekday);
    const cells = [];
    const today = todayStr();
    for (let i = 0; i < 42; i++) {
      const d = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + i);
      const dateStr = toDateStr(d);
      cells.push({
        date: d,
        dateStr,
        dayNum: d.getDate(),
        inMonth: d.getMonth() === monthIndex,
        isToday: dateStr === today,
      });
    }
    return cells;
  }

  // For 403s (unverified-account limits) the server message is the useful
  // part ("max 2 favorites until you verify..."); for everything else fall
  // back to a generic message so we don't leak raw error internals.
  function friendlyError(err, fallback) {
    if (err && err.status === 403 && err.data && err.data.error) return err.data.error;
    return fallback;
  }

  global.PYFCal = {
    MONTH_NAMES, WEEKDAY_SHORT,
    init, isInitialized: () => initialized,
    getCalendarEntries, getFavorites,
    toDateStr, todayStr, buildDateMap, entryKey, outfitSignature, isFavorited,
    scheduleOutfit, toggleFavorite, deleteCalendarEntry, moveCalendarEntryToFavorites,
    renderOutfitComposite, monthMatrix, friendlyError,
  };
})(window);
