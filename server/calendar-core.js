/* ---------- Pick Your Fit — shared calendar logic ---------- */
(function (global) {
  const CALENDAR_KEY = 'pyf_outfit_calendar';
  const FAVORITES_KEY = 'pyf_outfit_favorites';

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

  function readStore(key) {
    try { return JSON.parse(localStorage.getItem(key)) || []; } catch (e) { return []; }
  }
  function writeStore(key, arr) { localStorage.setItem(key, JSON.stringify(arr)); }

  function getCalendarEntries() { return readStore(CALENDAR_KEY); }
  function getFavorites() { return readStore(FAVORITES_KEY); }

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

  function entryKey(e) { return (e.date || '') + '|' + (e.savedAt || '') + '|' + (e.signature || ''); }

  function deleteCalendarEntry(entry) {
    const arr = getCalendarEntries().filter((e) => entryKey(e) !== entryKey(entry));
    writeStore(CALENDAR_KEY, arr);
    return arr;
  }

  function moveCalendarEntryToFavorites(entry) {
    const favs = getFavorites();
    if (!favs.some((f) => f.signature === entry.signature)) {
      favs.push({ signature: entry.signature, type: entry.type, items: entry.items, savedAt: new Date().toISOString() });
      writeStore(FAVORITES_KEY, favs);
    }
    return deleteCalendarEntry(entry);
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

  global.PYFCal = {
    CALENDAR_KEY, FAVORITES_KEY, MONTH_NAMES, WEEKDAY_SHORT,
    getCalendarEntries, getFavorites,
    toDateStr, todayStr, buildDateMap, entryKey,
    deleteCalendarEntry, moveCalendarEntryToFavorites,
    renderOutfitComposite, monthMatrix,
  };
})(window);
