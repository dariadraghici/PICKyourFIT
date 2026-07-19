(function (global) {
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const WEEKDAY_SHORT = ['Mo','Tu','We','Th','Fr','Sa','Su'];

  let styleInjected = false;
  function injectStyle() {
    if (styleInjected) 
      return;
    styleInjected = true;
    const style = document.createElement('style');
    style.textContent = `
      .pyfdp-overlay{ position:fixed; inset:0; z-index:80; background:rgba(28,26,23,0.55);
        display:flex; align-items:center; justify-content:center; padding:20px; }
      .pyfdp-box{ width:100%; max-width:330px; background:var(--linen-card, #FAF7EF);
        border:1px solid var(--line, #D9D0BD); border-radius:16px; overflow:hidden;
        box-shadow:0 30px 60px rgba(20,15,10,0.35); font-family:'Inter',sans-serif; }
      .pyfdp-head{ display:flex; align-items:center; justify-content:space-between;
        padding:16px 18px; background:var(--side-bg, rgba(42,34,27,0.9)); color:#fff; }
      .pyfdp-head .pyfdp-title{ font-family:'Fraunces',serif; font-size:15px; font-weight:600; }
      .pyfdp-head button{ background:none; border:none; color:#fff; opacity:0.75; cursor:pointer; padding:4px; }
      .pyfdp-head button:hover{ opacity:1; }
      .pyfdp-nav{ display:flex; align-items:center; justify-content:space-between; padding:14px 18px 4px; }
      .pyfdp-nav .pyfdp-month{ font-weight:600; font-size:14px; color:var(--ink,#22222b); }
      .pyfdp-nav button{ width:28px; height:28px; border-radius:8px; border:1px solid var(--line,#D9D0BD);
        background:transparent; color:var(--ink,#22222b); cursor:pointer; display:flex; align-items:center; justify-content:center; }
      .pyfdp-nav button:hover{ background:rgba(0,0,0,0.05); }
      .pyfdp-weekdays{ display:grid; grid-template-columns:repeat(7,1fr); padding:8px 14px 0; }
      .pyfdp-weekdays span{ text-align:center; font-size:10.5px; font-weight:600; letter-spacing:0.04em;
        text-transform:uppercase; color:var(--ink-soft,#6B6258); padding:4px 0; }
      .pyfdp-grid{ display:grid; grid-template-columns:repeat(7,1fr); gap:2px; padding:2px 14px 18px; }
      .pyfdp-day{ aspect-ratio:1; border:none; background:transparent; border-radius:50%;
        font-size:12.5px; color:var(--ink,#22222b); cursor:pointer; display:flex; align-items:center; justify-content:center; }
      .pyfdp-day:hover:not(:disabled){ background:rgba(0,0,0,0.06); }
      .pyfdp-day.pyfdp-out{ color:var(--ink-soft,#6B6258); opacity:0.35; }
      .pyfdp-day.pyfdp-today{ box-shadow: inset 0 0 0 1.5px var(--thread,#B5442F); font-weight:600; }
      .pyfdp-day.pyfdp-selected{ background:var(--thread,#B5442F); color:#fff; font-weight:600; }
      .pyfdp-day:disabled{ opacity:0.25; cursor:default; }
    `;
    document.head.appendChild(style);
  }

  function toDateStr(d) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function open({ minDate, initialDate, onSelect } = {}) {
    injectStyle();
    const min = minDate ? new Date(minDate + 'T00:00:00') : new Date(new Date().toDateString());
    let cursor = initialDate ? new Date(initialDate + 'T00:00:00') : new Date(min);
    let selected = initialDate || toDateStr(min);

    const overlay = document.createElement('div');
    overlay.className = 'pyfdp-overlay';
    overlay.innerHTML = `
      <div class="pyfdp-box">
        <div class="pyfdp-head">
          <span class="pyfdp-title">Pick a day</span>
          <button type="button" class="pyfdp-close" aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="pyfdp-nav">
          <button type="button" class="pyfdp-prev" aria-label="Previous month">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <span class="pyfdp-month"></span>
          <button type="button" class="pyfdp-next" aria-label="Next month">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M9 5l7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
        <div class="pyfdp-weekdays">${WEEKDAY_SHORT.map((w) => `<span>${w}</span>`).join('')}</div>
        <div class="pyfdp-grid"></div>
      </div>
    `;
    document.body.appendChild(overlay);

    const monthLabel = overlay.querySelector('.pyfdp-month');
    const grid = overlay.querySelector('.pyfdp-grid');

    function render() {
      const year = cursor.getFullYear(), monthIndex = cursor.getMonth();
      monthLabel.textContent = `${MONTH_NAMES[monthIndex]} ${year}`;
      grid.innerHTML = '';
      const firstOfMonth = new Date(year, monthIndex, 1);
      const firstWeekday = (firstOfMonth.getDay() + 6) % 7;
      const startDate = new Date(year, monthIndex, 1 - firstWeekday);
      for (let i = 0; i < 42; i++) {
        const d = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + i);
        const dStr = toDateStr(d);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pyfdp-day';
        btn.textContent = d.getDate();
        if (d.getMonth() !== monthIndex) btn.classList.add('pyfdp-out');
        if (dStr === toDateStr(new Date())) btn.classList.add('pyfdp-today');
        if (dStr === selected) btn.classList.add('pyfdp-selected');
        if (d < min) btn.disabled = true;
        btn.onclick = () => {
          selected = dStr;
          close();
          if (onSelect) onSelect(dStr);
        };
        grid.appendChild(btn);
      }
    }

    function close() { overlay.remove(); }

    overlay.querySelector('.pyfdp-close').onclick = close;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('.pyfdp-prev').onclick = () => { cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1); render(); };
    overlay.querySelector('.pyfdp-next').onclick = () => { cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1); render(); };

    render();
  }

  global.PYFDatePicker = { open };
})(window);
