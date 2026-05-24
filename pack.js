// pack.js — Pack tab logic, extracted from index.html in v9.13.
//
// Loaded with a plain <script src="./pack.js"></script> AFTER the main
// inline script, so all globals defined there (groundApi, esc,
// escapeHtml, showToast, switchTab, PDFLib + JsBarcode lazy loaders,
// pdfjsLib, XLSX) are already in scope.
//
// Kept at global scope on purpose so the inline onclick handlers
// scattered through the Pack tab HTML continue to resolve without
// window.* shims. ES module migration deferred — see TODO.md.

// ────────────────────────────────────────────────────────────
// PACK TAB — cabinet/freight daily packing queue (PackingQueue Phase 2)
// Pulls today's TODO from the PackingQueue Murphy Ops tab via
// listPackingQueue, renders 10–12 cards, supports server-side claim.
// ────────────────────────────────────────────────────────────

const PACK_QUEUE_CACHE_KEY = 'mbd_pack_queue_cache_v1';
const PACK_DEVICE_ID_KEY = 'mbd_pack_device_id';

function getPackDeviceId_() {
  let id = localStorage.getItem(PACK_DEVICE_ID_KEY);
  if (!id) {
    id = 'ipad-' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem(PACK_DEVICE_ID_KEY, id);
  }
  return id;
}

let _packQueueCache = [];
let _packDetailOrderNumber = null;

// v10.153 persona #12 Shane — end-of-shift reminder for packers with
// orphaned claims. Polled every 60s; only fires once per device per
// day. If you have any in_progress/checking claim AND it's past the
// configured time AND the reminder hasn't shown today → big banner
// at top of Pack tab with Ready-for-Check / Release / Snooze actions.
const EOS_REMINDER_KEY_ENABLED  = 'mbd_eos_reminder_enabled';
const EOS_REMINDER_KEY_TIME     = 'mbd_eos_reminder_time';      // HH:MM
const EOS_REMINDER_KEY_LASTDATE = 'mbd_eos_reminder_lastdate';  // YYYY-MM-DD
const EOS_REMINDER_KEY_SNOOZE   = 'mbd_eos_reminder_snooze_until'; // epoch ms

function eosReminderEnabled_() {
  const v = localStorage.getItem(EOS_REMINDER_KEY_ENABLED);
  return v === null ? true : v === 'true';
}
function eosReminderTime_() {
  return localStorage.getItem(EOS_REMINDER_KEY_TIME) || '17:00';
}
function eosTodayIso_() {
  const d = new Date();
  const pad = n => n < 10 ? '0' + n : '' + n;
  return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate());
}

function checkPackEosReminder_() {
  if (!eosReminderEnabled_()) return;
  // Only fire if Pack tab is the active panel — banner injects there.
  const packPanel = document.getElementById('packQueueList');
  if (!packPanel || packPanel.offsetParent === null) return;
  // Snooze check.
  const snoozeUntil = Number(localStorage.getItem(EOS_REMINDER_KEY_SNOOZE) || 0);
  if (snoozeUntil && Date.now() < snoozeUntil) return;
  // Already shown today.
  if (localStorage.getItem(EOS_REMINDER_KEY_LASTDATE) === eosTodayIso_()) return;
  // Time check.
  const now = new Date();
  const cfg = eosReminderTime_();
  const [hh, mm] = cfg.split(':').map(Number);
  if (isNaN(hh) || isNaN(mm)) return;
  if (now.getHours() < hh || (now.getHours() === hh && now.getMinutes() < mm)) return;
  // Any active claims on this device?
  const myDevice = getPackDeviceId_();
  const myClaims = (_packQueueCache || []).filter(r => {
    if (r.status === 'in_progress' && r.started_by === myDevice) return true;
    if (r.status === 'checking' && r.checker_started_by === myDevice) return true;
    return false;
  });
  if (!myClaims.length) {
    // Mark as shown so silent-no-claim doesn't re-check 1000x; still
    // counts as "today's reminder fired" since the goal is met.
    localStorage.setItem(EOS_REMINDER_KEY_LASTDATE, eosTodayIso_());
    return;
  }
  showPackEosBanner_(myClaims);
  localStorage.setItem(EOS_REMINDER_KEY_LASTDATE, eosTodayIso_());
}

function showPackEosBanner_(myClaims) {
  let bar = document.getElementById('packEosReminderBanner');
  if (bar) bar.remove();
  bar = document.createElement('div');
  bar.id = 'packEosReminderBanner';
  bar.style.cssText = 'position:sticky;top:0;z-index:50;background:linear-gradient(135deg,#FFC107 0%,#FF9800 100%);color:#3d2400;border:2px solid #B26500;border-radius:12px;padding:16px 18px;margin-bottom:12px;box-shadow:0 4px 12px rgba(0,0,0,.25);font-family:-apple-system,Helvetica,Arial,sans-serif';
  // v10.204 Shane persona: make each #order in the EOS banner a tap
  // target that jumps straight to its detail view. Was: comma-separated
  // plain text that gave Shane the order # but no way to act on it
  // without scrolling the Pack list. Was usability hostile during the
  // exact moment (end of shift) when speed matters.
  // v10.219 Jonah pain #4: add a "↻ release" pill next to each
  // tap-to-jump button. Was: only path to release a claim required
  // opening detail → marking ready-for-check (heavyweight if he just
  // wants to free it for tomorrow without finishing). Now: one tap
  // confirms + calls releasePackJob endpoint + redraws.
  const list = myClaims.map(c => {
    const onum = esc(c.order_number);
    return '<span style="display:inline-flex !important;align-items:center !important;gap:3px !important;margin:2px 6px 2px 0 !important">'
      + '<button onclick="openPackDetail(\'' + onum + '\');dismissPackEosReminder_()" '
      + 'style="background:rgba(255,255,255,.55) !important;color:#3d2400 !important;'
      + '-webkit-text-fill-color:#3d2400 !important;border:1.5px solid rgba(0,0,0,.30) !important;'
      + 'border-radius:6px 0 0 6px !important;border-right-width:0 !important;padding:3px 9px !important;font-size:13px !important;'
      + 'font-weight:900 !important;cursor:pointer !important;font-family:inherit !important;'
      + 'display:inline-flex !important;align-items:center !important;gap:5px !important">'
      + '<span>#' + onum + '</span>'
      + '<span style="font-size:10px;font-weight:700;opacity:.75;text-transform:uppercase;letter-spacing:.5px">' + esc(c.status) + '</span>'
      + '</button>'
      + '<button onclick="eosReleaseClaim_(\'' + onum + '\')" title="Release this claim — frees the order for tomorrow"'
      + ' style="background:rgba(139,0,0,.85) !important;color:#fff !important;'
      + '-webkit-text-fill-color:#fff !important;border:1.5px solid #5c0000 !important;'
      + 'border-radius:0 6px 6px 0 !important;padding:3px 9px !important;font-size:11px !important;'
      + 'font-weight:900 !important;cursor:pointer !important;font-family:inherit !important;'
      + 'display:inline-flex !important;align-items:center !important;gap:3px !important">↻ release</button>'
      + '</span>';
  }).join('');
  bar.innerHTML =
    '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">'
    + '<div style="font-size:32px">🌙</div>'
    + '<div style="flex:1;min-width:200px">'
    +   '<div style="font-family:\'Barlow Condensed\',Arial,sans-serif;font-size:20px;font-weight:900;letter-spacing:1px;text-transform:uppercase">End of Shift Check-in</div>'
    +   '<div style="font-size:13px;margin-top:4px;font-weight:600">You still have <strong>' + myClaims.length + ' active claim' + (myClaims.length === 1 ? '' : 's') + '</strong>:</div>'
    +   '<div style="margin-top:6px;line-height:1.9">' + list + '</div>'
    +   '<div style="font-size:12px;margin-top:6px;opacity:.85">If you\'re done, mark them Ready-for-Check or release the claim so they\'re free for tomorrow.</div>'
    + '</div>'
    + '<div style="display:flex;gap:8px;flex-wrap:wrap">'
    +   '<button onclick="snoozePackEosReminder_(15)" style="background:rgba(255,255,255,.4);color:#3d2400;border:1.5px solid rgba(0,0,0,.25);border-radius:8px;padding:8px 14px;font-size:13px;font-weight:800;cursor:pointer">Snooze 15m</button>'
    +   '<button onclick="dismissPackEosReminder_()" style="background:#3d2400;color:#FFC107;border:none;border-radius:8px;padding:8px 14px;font-size:13px;font-weight:800;cursor:pointer">Got it</button>'
    + '</div>'
    + '</div>';
  const queueList = document.getElementById('packQueueList');
  if (queueList && queueList.parentNode) queueList.parentNode.insertBefore(bar, queueList);
  // Haptic + sound (if FB engine exists)
  try {
    if (typeof FB !== 'undefined') {
      if (FB.vibrate) FB.vibrate([200, 100, 200]);
      if (FB.beep) FB.beep(523, 0.18, 'sine'); // C5
    }
  } catch(e) {}
}

function snoozePackEosReminder_(minutes) {
  localStorage.setItem(EOS_REMINDER_KEY_SNOOZE, String(Date.now() + minutes * 60_000));
  // Clear lastdate so it can re-fire after snooze expires.
  localStorage.removeItem(EOS_REMINDER_KEY_LASTDATE);
  dismissPackEosReminder_();
  if (typeof showToast === 'function') showToast('Reminder snoozed ' + minutes + ' min');
}

// v10.219 — release a claim straight from the EOS banner. One confirm
// then calls releasePackJob (existing endpoint, PackingQueue.js:494).
// On success: refreshes the local pack queue cache so the banner
// rebuilds with the remaining claims. If that was the last claim,
// the banner auto-dismisses.
async function eosReleaseClaim_(orderNumber) {
  if (!orderNumber) return;
  if (!confirm('Release claim on #' + orderNumber + '?\n\nThis returns the order to "pending" so anyone can pick it up tomorrow. Scan progress is preserved (next packer can resume).')) return;
  try {
    const res = await groundApi('releasePackJob', {
      orderNumber: orderNumber,
      deviceId: getPackDeviceId_(),
    });
    if (!res || !res.ok) {
      if (typeof showToast === 'function') showToast('⚠ Release failed: ' + ((res && res.error) || 'unknown'));
      return;
    }
    if (typeof showToast === 'function') showToast('↻ Released #' + orderNumber);
    // Refresh queue + rebuild banner with the remaining claims.
    if (typeof refreshPackQueue === 'function') {
      await refreshPackQueue();
      const myDevice = getPackDeviceId_();
      const remaining = (_packQueueCache || []).filter(r => {
        if (r.status === 'in_progress' && r.started_by === myDevice) return true;
        if (r.status === 'checking' && r.checker_started_by === myDevice) return true;
        return false;
      });
      if (remaining.length) showPackEosBanner_(remaining);
      else dismissPackEosReminder_();
    } else {
      dismissPackEosReminder_();
    }
  } catch (e) {
    if (typeof showToast === 'function') showToast('⚠ Release error: ' + (e.message || String(e)));
  }
}

function dismissPackEosReminder_() {
  const bar = document.getElementById('packEosReminderBanner');
  if (bar) bar.remove();
}

// Poll once a minute. setInterval armed at module load so the check
// runs even between Pack-tab paint cycles.
if (typeof window !== 'undefined' && !window._packEosInterval) {
  window._packEosInterval = setInterval(checkPackEosReminder_, 60_000);
  // Also fire once at 5s after load so silent days are marked early.
  setTimeout(checkPackEosReminder_, 5000);
}

function renderPackTab() {
  document.getElementById('packQueueDetail').style.display = 'none';
  document.getElementById('packQueueList').style.display = '';
  // Paint cached rows immediately for instant feel, then refresh.
  try {
    const cached = JSON.parse(localStorage.getItem(PACK_QUEUE_CACHE_KEY) || '[]');
    if (Array.isArray(cached) && cached.length) {
      _packQueueCache = cached;
      paintPackQueue_(cached, true);
    }
  } catch(e) {}
  refreshPackQueue();
  // v10.153: run an EOS check on every tab open in case it's already
  // past 5pm when the packer switches to Pack.
  setTimeout(checkPackEosReminder_, 1500);
}

async function refreshPackQueue() {
  const statusEl = document.getElementById('packQueueStatus');
  statusEl.textContent = 'Loading…';
  // v10.162 — global loader on first paint only (no flicker when
  // refreshing already-cached data). showGlobalLoader is defined in
  // index.html's inline scope.
  const loader = (typeof showGlobalLoader === 'function' && !_packQueueCache.length)
    ? showGlobalLoader('Loading pack queue…') : null;
  // v9.99: parallel Day Plan paint into the Pack tab strip.
  paintDayPlanInto_('packDayPlan');
  // Only show the big loading card if we don't have a cached list to
  // show — otherwise the cache paints first and the user sees the
  // small "Loading…" status as a quiet refresh indicator, which is
  // fine when content is already on screen.
  if (!_packQueueCache.length) {
    const list = document.getElementById('packQueueList');
    if (list) list.innerHTML = '<div style="padding:48px 24px;text-align:center;background:rgba(66,165,245,.06);border:1.5px dashed rgba(66,165,245,.35);border-radius:12px;color:#42a5f5;font-size:18px;font-weight:800;letter-spacing:.5px"><div style="font-size:36px;margin-bottom:12px;animation:mbdSpin 1s linear infinite;display:inline-block">⟳</div><div>Loading pack queue…</div></div>';
  }
  try {
    // Two-pass: in-flight orders capped at 12 (Jonah's daily TODO size),
    // packed orders unlimited so the manager can ship any of them.
    const [inflight, packed] = await Promise.all([
      groundApi('listPackingQueue', {
        status: ['pending','in_progress','ready_for_check','checking'],
        limit: 12,
      }),
      groundApi('listPackingQueue', { status: ['packed'] }),
    ]);
    if (!inflight || !inflight.ok) {
      if (loader) loader.stop();
      _packStatusError_(statusEl, (inflight && inflight.error) || 'unknown');
      return;
    }
    const inflightRows = inflight.rows || [];
    const packedRows = (packed && packed.ok && packed.rows) ? packed.rows : [];
    _packQueueCache = inflightRows.concat(packedRows);
    localStorage.setItem(PACK_QUEUE_CACHE_KEY, JSON.stringify(_packQueueCache));
    paintPackQueue_(_packQueueCache, false);
    const ipPart = inflightRows.length + ' to pack';
    const pkPart = packedRows.length ? (', ' + packedRows.length + ' awaiting ship') : '';
    statusEl.textContent = ipPart + pkPart;
    if (loader) loader.stop();
  } catch (err) {
    if (loader) loader.stop();
    _packStatusError_(statusEl, err.message);
  }
}

// v10.157 R3 — render an error status with an inline Retry button.
// iPad Pack queue load fails most often due to intermittent Apps Script
// wake-up timeouts; surfacing Retry inline saves the operator a trip
// to the toolbar.
function _packStatusError_(statusEl, message) {
  if (!statusEl) return;
  statusEl.innerHTML = '<span style="color:#ff5252">Error: ' + esc(String(message || '')) + '</span>'
    + ' <button onclick="refreshPackQueue()" style="margin-left:8px;padding:3px 10px;background:var(--green-bright);color:#000;border:none;border-radius:6px;font-size:11px;font-weight:800;cursor:pointer">↻ Retry</button>';
}

function paintPackQueue_(rows, fromCache) {
  const list = document.getElementById('packQueueList');
  list.innerHTML = '';
  // v10.160 Sable S3 — stale-data dimming. When painting from cache
  // (the existing fromCache path), apply mild opacity to signal the
  // data is being refreshed. Cleared on the fresh-fetch paint. Pairs
  // with the existing "(cached — refreshing…)" tag at the bottom.
  list.style.opacity = fromCache ? '0.78' : '';
  list.style.transition = 'opacity 200ms ease-out';
  // v10.152 Seth's manager-mode ship-date filter chips: only render
  // chips + apply filter when in bulk/manager mode. Outside bulk mode
  // the list stays unfiltered (Jonah needs the full picture).
  if (_packManagerMode) {
    list.appendChild(renderPackShipDateFilterChips_(rows));
  }
  if (!rows.length) {
    list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-dim);background:rgba(255,255,255,.03);border:1px dashed rgba(255,255,255,.15);border-radius:10px">Today\'s pack list is empty.<br><span style="font-size:12px">Tap <strong>+ Add to List</strong> above to load today\'s orders by ship date.</span></div>';
    return;
  }
  // v9.80 same day-bucket pattern as Pre-Pack — anchors the active
  // list by ship date so cross-day Pack lists don't read as a blob.
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today.getTime() + 86400000);
  const weekOut = new Date(today.getTime() + 7 * 86400000);
  const bucketOf = (iso) => {
    if (!iso) return 'No Date';
    const d = new Date(String(iso).slice(0, 10) + 'T00:00:00');
    if (d < today) return 'Past';
    if (d < tomorrow) return 'Today';
    if (d < new Date(today.getTime() + 2 * 86400000)) return 'Tomorrow';
    if (d < weekOut) return 'This Week';
    return 'Later';
  };
  const BUCKET_ORDER = ['Past', 'Today', 'Tomorrow', 'This Week', 'Later', 'No Date'];
  const BUCKET_ACCENT = { Past: '#ff5252', Today: '#00e676', Tomorrow: '#FFB300', 'This Week': '#42a5f5', Later: '#9e9e9e', 'No Date': '#666' };
  const grouped = { Past: [], Today: [], Tomorrow: [], 'This Week': [], Later: [], 'No Date': [] };
  // v10.152: apply ship-date filter when bulk mode active.
  const filteredRows = (_packManagerMode && _packShipDateFilter !== 'all')
    ? rows.filter(r => matchPackShipDateFilter_(r.ship_date, bucketOf))
    : rows;
  if (_packManagerMode && _packShipDateFilter !== 'all' && !filteredRows.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:20px;text-align:center;color:var(--text-dim);background:rgba(255,165,0,.06);border:1px dashed rgba(255,165,0,.30);border-radius:10px;margin-top:6px';
    empty.innerHTML = 'No orders match the <strong>' + esc(packShipDateFilterLabel_(_packShipDateFilter)) + '</strong> filter.<br><span style="font-size:12px">Tap <strong>Any date</strong> above to see everything.</span>';
    list.appendChild(empty);
    return;
  }
  filteredRows.forEach(r => grouped[bucketOf(r.ship_date)].push(r));
  // _filteredRows fully shadow `rows` from this point on; outer code
  // reads `filteredRows` not `rows` so the buckets reflect the filter.
  BUCKET_ORDER.forEach(bucket => {
    if (!grouped[bucket].length) return;
    const accent = BUCKET_ACCENT[bucket];
    const hdr = document.createElement('div');
    // v9.84: position:sticky so the bucket header floats while
    // its cards scroll. background must be opaque enough to mask
    // cards passing behind.
    hdr.style.cssText = 'position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:10px;margin:14px 0 6px;padding:8px 10px 8px 4px;background:var(--bg);border-bottom:1px solid ' + accent + '40;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)';
    hdr.innerHTML =
      '<span style="font-family:\'Barlow Condensed\',Arial,sans-serif;font-size:13px;font-weight:900;color:' + accent + ';letter-spacing:1.5px;text-transform:uppercase">' + bucket + '</span>'
      + '<span style="font-size:11px;color:var(--text-dim);font-weight:700">' + grouped[bucket].length + ' order' + (grouped[bucket].length === 1 ? '' : 's') + '</span>';
    list.appendChild(hdr);
    grouped[bucket].forEach(r => list.appendChild(renderPackCard_(r)));
  });
  if (fromCache) {
    const tag = document.createElement('div');
    tag.style.cssText = 'font-size:10px;color:var(--text-dim);text-align:center;margin-top:6px;opacity:.6';
    tag.textContent = '(cached — refreshing…)';
    list.appendChild(tag);
  }
}

function renderPackCard_(r) {
  const card = document.createElement('div');
  const status = String(r.status || 'pending');
  const meta = PACK_STATUS_META[status] || PACK_STATUS_META.pending;
  const myDevice = getPackDeviceId_();
  const packerMine = (status === 'in_progress') && r.started_by === myDevice;
  const checkerMine = (status === 'checking') && r.checker_started_by === myDevice;
  const someoneActive = (status === 'in_progress') || (status === 'checking');
  const accent = (status === 'packed') ? '#00e676'
               : (status === 'ready_for_check') ? '#42a5f5'
               : (status === 'checking') ? '#ab47bc'
               : (status === 'in_progress') ? (packerMine ? '#00e676' : '#ff9800')
               : null;
  const bg = accent ? accent + '1a' : 'rgba(255,255,255,.04)';
  const border = accent ? accent + '72' : 'rgba(255,255,255,.12)';
  // v10.199 — full-card tap target (was: only ship-date + task-line
  // divs clickable, gaps + meta pill swallowed taps). Inner onclicks
  // dropped to avoid double-fire; checkbox label + Mark-Shipped
  // button stopPropagation as before.
  card.style.cssText = 'background:'+bg+';border:1px solid '+border+';border-radius:12px;padding:18px 18px;display:flex;align-items:center;gap:16px;transition:transform .1s ease;cursor:pointer';
  card.onclick = () => openPackDetail(r.order_number);

  const shipDate = r.ship_date || '—';
  const taskLine = r.task_line || (r.order_number + ' (no task line)');
  const skuCount = packCountSkus_(r.sku_lines_json);
  const inStock = /INSTOCK/i.test(r.sku_lines_json || '');
  const hwReady = !!r.hardware_packed_at;
  const hwChip = hwReady
    ? '<span style="color:#00e676;font-weight:700" title="HW box prepped by '+esc(String(r.hardware_packed_by||''))+'">· 🔧 HW READY</span>'
    : '<span style="color:#ff9800;font-weight:700" title="Hardware pre-pack pending — see Pre-Pack tab">· 🔧 HW PENDING</span>';

  // Status chip line text. Roo: truncate long device ids so they
  // don't blow out the chip width on phones (16-char cap).
  const truncName = (s) => { const v = String(s || ''); return v.length > 16 ? v.slice(0, 16) + '…' : v; };
  let stateLine = '';
  if (status === 'in_progress') stateLine = packerMine ? 'YOU\'RE PACKING' : 'PACKING — ' + truncName(r.started_by || 'other');
  else if (status === 'ready_for_check') stateLine = 'READY FOR CHECKER';
  else if (status === 'checking') stateLine = checkerMine ? 'YOU\'RE CHECKING' : 'CHECKING — ' + truncName(r.checker_started_by || 'other');
  else if (status === 'packed') stateLine = 'PACKED — AWAITING SHIP';

  const isSelected = _packBulkSelection.has(String(r.order_number));
  const checkboxHtml = _packManagerMode
    ? '<label style="flex:0 0 28px;display:flex;align-items:center;justify-content:center;cursor:pointer" onclick="event.stopPropagation()"><input type="checkbox" '
        + (isSelected ? 'checked ' : '')
        + 'onchange="togglePackBulkSelect(\''+esc(r.order_number)+'\', this.checked)" '
        + 'style="width:22px;height:22px;cursor:pointer;accent-color:#ff9800"></label>'
    : '';

  card.innerHTML = `
    ${checkboxHtml}
    <div style="flex:0 0 96px;text-align:center;border-right:1px solid rgba(255,255,255,.10);padding-right:16px">
      <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;color:var(--text-dim);text-transform:uppercase">Ship</div>
      <div style="font-family:'JetBrains Mono',monospace;font-size:26px;font-weight:900;color:var(--green-bright);margin-top:4px;line-height:1.05">${esc(shipDate.slice(5))}</div>
      <div style="font-size:12px;color:var(--text-dim);margin-top:3px">${esc(shipDate.slice(0,4))}</div>
    </div>
    <div style="flex:1;min-width:0">
      <div style="font-family:'Barlow Condensed',Arial,sans-serif;font-size:24px;font-weight:900;color:var(--text);text-transform:uppercase;line-height:1.2;word-break:break-word">${esc(taskLine)}</div>
      <div style="font-size:14px;color:var(--text);opacity:.85;margin-top:8px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;line-height:1.4">
        ${r.customer_name ? '<span>'+esc(r.customer_name)+'</span>' : ''}
        ${skuCount ? '<span style="color:var(--text-dim)">· '+skuCount+' SKU'+(skuCount===1?'':'s')+'</span>' : ''}
        ${inStock ? '<span style="color:#00e676;font-weight:700">· IN STOCK</span>' : ''}
        ${hwChip}
        ${r.instructions_printed_at ? '<span style="color:#42a5f5;font-weight:700" title="Printed '+esc(r.instructions_printed_at)+'">· 🖨 Printed</span>' : ''}
        <span style="margin-left:auto;padding:3px 10px;font-size:12px;font-weight:900;letter-spacing:1.2px;background:${meta.bg};color:${meta.color};border:1px solid ${meta.color}55;border-radius:999px">${meta.label}</span>
        ${stateLine ? '<span style="flex-basis:100%;color:'+(accent||'var(--text-dim)')+';font-weight:700;margin-top:4px;font-size:13px;letter-spacing:1px">'+esc(stateLine)+'</span>' : ''}
      </div>
    </div>
    ${status === 'packed'
      ? '<button onclick="event.stopPropagation();confirmMarkPackJobShipped(\''+esc(r.order_number)+'\')" class="amp-btn go" style="padding:10px 16px;font-size:13px;font-weight:900;white-space:nowrap">📦 Mark Shipped</button>'
      : '<div style="color:var(--text-dim);font-size:20px;cursor:pointer" onclick="openPackDetail(\''+esc(r.order_number)+'\')">›</div>'
    }
  `;
  return card;
}

function packCountSkus_(jsonStr) {
  try {
    const arr = JSON.parse(jsonStr || '[]');
    return Array.isArray(arr) ? arr.length : 0;
  } catch(e) { return 0; }
}

// Status meta used by openPackDetail to pick badge color + intent.
const PACK_STATUS_META = {
  pending:          { label: 'PENDING',          color: '#9aa0a6', bg: 'rgba(154,160,166,.10)' },
  in_progress:      { label: 'PACKING',          color: '#ff9800', bg: 'rgba(255,152,0,.10)' },
  ready_for_check:  { label: 'READY FOR CHECK',  color: '#42a5f5', bg: 'rgba(66,165,245,.10)' },
  checking:         { label: 'CHECKING',         color: '#ab47bc', bg: 'rgba(171,71,188,.10)' },
  packed:           { label: 'PACKED',           color: '#00e676', bg: 'rgba(0,230,118,.10)' },
};

function openPackDetail(orderNumber) {
  const row = _packQueueCache.find(r => String(r.order_number) === String(orderNumber));
  if (!row) {
    showToast('Order not in current queue — refresh');
    return;
  }
  _packDetailOrderNumber = orderNumber;
  document.getElementById('packQueueList').style.display = 'none';
  const detail = document.getElementById('packQueueDetail');
  detail.style.display = '';

  const myDevice = getPackDeviceId_();
  const status = String(row.status || 'pending');
  const meta = PACK_STATUS_META[status] || PACK_STATUS_META.pending;

  // Phase selection: the SKU list + scan input read/write the checker
  // column when the order is past ready_for_check. Otherwise packer column.
  const phase = (status === 'checking' || status === 'ready_for_check' || status === 'packed') ? 'checker' : 'packer';
  _packActivePhase = phase;
  const scannedColumnJson = (phase === 'checker') ? row.checker_scanned_json : row.scanned_json;

  const packerMine = (status === 'in_progress') && row.started_by === myDevice;
  const checkerMine = (status === 'checking') && row.checker_started_by === myDevice;

  const photoCount = (() => {
    try { const a = JSON.parse(row.photo_urls_json || '[]'); return Array.isArray(a) ? a.length : 0; }
    catch(e) { return 0; }
  })();

  // ── action-row HTML driven by status ──────────────────────────────
  let actionRowHtml = '';
  if (status === 'pending') {
    actionRowHtml = '<button onclick="claimPackOrder(\''+esc(row.order_number)+'\')" class="amp-btn go" style="padding:14px 22px;font-size:15px;font-weight:900">▶ Start Packing</button>';
  } else if (status === 'in_progress') {
    if (packerMine) {
      actionRowHtml =
        '<button onclick="releasePackOrder(\''+esc(row.order_number)+'\')" class="amp-btn" style="padding:14px 22px;font-size:14px">↩ Release Claim</button>'
        + '<button onclick="confirmReadyForCheck(\''+esc(row.order_number)+'\')" class="amp-btn go" style="padding:14px 22px;font-size:15px;font-weight:900;margin-left:auto">✓ Ready for Checker →</button>';
    } else {
      actionRowHtml = '<div style="padding:12px 18px;background:rgba(255,165,0,.10);border:1px solid rgba(255,165,0,.45);border-radius:10px;font-size:13px;color:var(--text)">Packing in progress by '+esc(row.started_by||'another device')+'</div>';
    }
  } else if (status === 'ready_for_check') {
    actionRowHtml =
      '<div style="padding:12px 18px;background:rgba(66,165,245,.10);border:1px solid rgba(66,165,245,.45);border-radius:10px;font-size:13px;color:var(--text);flex:1">Packer finished — checker, please verify frame boxes and hardware-box contents before sealing.</div>'
      + '<button onclick="claimPackCheck(\''+esc(row.order_number)+'\')" class="amp-btn go" style="padding:14px 22px;font-size:15px;font-weight:900;margin-left:auto">▶ Start Checking</button>';
  } else if (status === 'checking') {
    if (checkerMine) {
      actionRowHtml =
        '<button onclick="releasePackCheck(\''+esc(row.order_number)+'\')" class="amp-btn" style="padding:14px 22px;font-size:14px">↩ Release Check</button>'
        + '<button onclick="confirmMarkPackJobComplete(\''+esc(row.order_number)+'\')" class="amp-btn go" style="padding:14px 22px;font-size:15px;font-weight:900;margin-left:auto">✓ Confirm Packed & Email Seth</button>';
    } else {
      actionRowHtml = '<div style="padding:12px 18px;background:rgba(171,71,188,.10);border:1px solid rgba(171,71,188,.45);border-radius:10px;font-size:13px;color:var(--text)">Checking in progress by '+esc(row.checker_started_by||'another device')+'</div>';
    }
  }

  // ── SKU list card: read-write for the active phase's claimer, read-only otherwise.
  const canScan = (phase === 'packer' && packerMine) || (phase === 'checker' && checkerMine);
  const phaseLabel = phase === 'checker' ? 'CHECKER SCAN' : 'PACKER SCAN';
  const phaseHelp = phase === 'checker'
    ? 'Independent verification — scan everything the packer scanned, plus open the hardware box and verify its contents before sealing.'
    : 'Scan each SKU as you stage it on the pallet. When complete, tap Ready for Checker.';
  const phaseAccent = phase === 'checker' ? 'rgba(171,71,188,.45)' : 'rgba(0,230,118,.35)';

  detail.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">
      <button onclick="closePackDetail()" class="amp-btn" style="padding:8px 14px;font-size:13px">← Back</button>
      <div style="flex:1;font-family:'Barlow Condensed',Arial,sans-serif;font-size:22px;font-weight:900;color:var(--text);text-transform:uppercase;letter-spacing:1px">Order ${esc(row.order_number)}</div>
      <span style="padding:6px 14px;font-size:11px;font-weight:900;letter-spacing:1.5px;background:${meta.bg};color:${meta.color};border:1px solid ${meta.color}55;border-radius:999px">${meta.label}</span>
    </div>

    <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:16px;margin-bottom:14px">
      <div style="font-family:'Barlow Condensed',Arial,sans-serif;font-size:18px;font-weight:900;color:var(--text);text-transform:uppercase;line-height:1.2;margin-bottom:8px">${esc(row.task_line || '')}</div>
      <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:13px">
        <div style="color:var(--text-dim)">Ship date</div><div style="color:var(--text);font-weight:600">${esc(row.ship_date || '—')}</div>
        <div style="color:var(--text-dim)">Customer</div><div style="color:var(--text)">${esc(row.customer_name || '—')}</div>
        <div style="color:var(--text-dim)">Address</div><div style="color:var(--text)">${esc(row.customer_address || '—')}</div>
        <div style="color:var(--text-dim)">Phone</div><div style="color:var(--text)">${esc(row.customer_phone || '—')}</div>
        <div style="color:var(--text-dim)">Order details</div><div style="color:var(--text)">${esc(row.order_details || '—')}</div>
        <div style="color:var(--text-dim)">Instructions</div><div style="color:${row.instructions_printed_at?'#42a5f5':'var(--text-dim)'};font-weight:${row.instructions_printed_at?'700':'400'}">${row.instructions_printed_at ? '🖨 Printed ' + esc(row.instructions_printed_at) : 'Not yet printed'}</div>
      </div>
    </div>

    <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:16px;margin-bottom:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:10px">
        <div style="font-family:'Barlow Condensed',Arial,sans-serif;font-size:14px;font-weight:900;color:${phase==='checker'?'#ab47bc':'#00e676'};text-transform:uppercase;letter-spacing:1.5px">${phaseLabel} <span id="packSkuProgress" style="color:var(--text-dim);font-size:12px;letter-spacing:0;margin-left:6px;font-weight:700"></span></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${(phase !== 'checker' && row.pick_list_pdf_url) ? '<button onclick="loadPackPdfFromUrl(\''+esc(row.pick_list_pdf_url)+'\')" class="amp-btn" style="padding:8px 12px;font-size:12px">📥 Re-parse from Drive PDF</button>' : ''}
          ${phase !== 'checker' ? '<label for="packPdfFile" class="amp-btn" style="cursor:pointer;padding:8px 12px;font-size:12px;margin:0">📂 Upload PDF/CSV</label><input type="file" id="packPdfFile" accept="application/pdf,.pdf,.xlsx,.xls,.csv" style="display:none" onchange="onPackPdfFileSelected(event)">' : ''}
          ${canScan ? '<button onclick="resetActivePackScansForOrder(\''+esc(row.order_number)+'\')" class="amp-btn" style="padding:8px 12px;font-size:12px">↺ Reset Scans</button>' : ''}
        </div>
      </div>
      <div style="font-size:11px;color:var(--text-dim);margin-bottom:10px;line-height:1.4">${phaseHelp}</div>
      <div style="display:flex;gap:8px;margin-bottom:10px">
        <input type="text" id="packScanInput" placeholder="Scan or type a SKU…" autocomplete="off" autocorrect="off" spellcheck="false"
          style="flex:1;padding:11px 13px;font-size:15px;font-family:'JetBrains Mono',monospace;letter-spacing:1px;background:#000;color:${phase==='checker'?'#ce93d8':'var(--green-bright)'};border:2px solid ${phaseAccent};border-radius:8px;outline:none;text-shadow:0 0 8px ${phaseAccent}">
        <button onclick="handlePackScanSubmit()" class="amp-btn go" style="padding:11px 16px;font-size:13px">Scan</button>
      </div>
      <div id="packLoadStatus" style="font-size:11px;color:var(--text-dim);min-height:14px;margin-bottom:8px"></div>
      <div id="packSkuList"></div>
    </div>

    <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px">
      ${row.pick_list_pdf_url ? '<a href="'+esc(row.pick_list_pdf_url)+'" target="_blank" rel="noopener" class="amp-btn" style="text-decoration:none;padding:12px 18px;font-size:14px">📄 Open Pick List PDF</a>' : ''}
      ${row.pick_list_pdf_url ? '<button onclick="printOneInstruction(\''+esc(row.order_number)+'\')" class="amp-btn" style="padding:12px 18px;font-size:14px">🖨 Print Instructions</button>' : ''}
      <button onclick="promptForInstructionsUrl_(\''+esc(row.order_number)+'\')" class="amp-btn" style="padding:12px 18px;font-size:14px" title="${row.instructions_pdf_url ? 'Instructions link is set — tap to view/replace' : 'No instructions link found — paste it; it will be remembered'}">${row.instructions_pdf_url ? '🔗 Instructions Link ✓' : '✏️ Set Instructions Link'}</button>
      ${row.shopify_admin_url ? '<a href="'+esc(row.shopify_admin_url)+'" target="_blank" rel="noopener" class="amp-btn" style="text-decoration:none;padding:12px 18px;font-size:14px">🛒 Shopify Order</a>' : ''}
    </div>

    <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:16px;margin-bottom:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;gap:10px;flex-wrap:wrap">
        <div style="font-family:'Barlow Condensed',Arial,sans-serif;font-size:16px;font-weight:900;color:var(--text);text-transform:uppercase;letter-spacing:1px">Shipment Photos <span id="packPhotoCount" style="color:var(--text-dim);font-size:13px;letter-spacing:0;margin-left:6px">(${photoCount})</span></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <label for="packPhotoCamera" class="amp-btn" style="cursor:pointer;padding:10px 16px;font-size:13px;margin:0">📷 Take Photo</label>
          <input type="file" id="packPhotoCamera" accept="image/*" capture="environment" style="display:none" onchange="onPackPhotoSelected(event, '${esc(row.order_number)}')">
          <label for="packPhotoLibrary" class="amp-btn" style="cursor:pointer;padding:10px 16px;font-size:13px;margin:0">🖼 From Library</label>
          <input type="file" id="packPhotoLibrary" accept="image/*" multiple style="display:none" onchange="onPackPhotoSelected(event, '${esc(row.order_number)}')">
        </div>
      </div>
      <div id="packPhotoGallery" style="display:flex;flex-wrap:wrap;gap:8px">${renderPackPhotoGallery_(row.photo_urls_json)}</div>
      <div id="packPhotoStatus" style="font-size:11px;color:var(--text-dim);margin-top:8px;min-height:14px"></div>
    </div>

    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">
      ${actionRowHtml}
    </div>
  `;

  // Seed scan state from the active phase's column.
  delete _packScanState[row.order_number];
  getPackScanState_(row.order_number, row.sku_lines_json, scannedColumnJson);
  renderPackSkuList_(row.order_number);

  // Auto-parse the pick list PDF the first time an order is opened, so
  // the packer doesn't have to manually tap "Re-parse from Drive PDF"
  // to get the accurate breakdown. Email-parsed SKUs are summaries
  // ("Here are the SKUs"); the PDF has the physical pack breakdown the
  // packer actually needs to scan. Skipped if:
  //   • the row has already been PDF-parsed (sku_source === 'pdf')
  //   • there's no Drive URL to parse from
  //   • the order is past the packer phase (don't churn the list once
  //     a checker is involved)
  const skuSource = String(row.sku_source || '').trim();
  const hasExistingScans = (() => {
    try {
      const a = JSON.parse(row.scanned_json || '[]');
      return Array.isArray(a) && a.some(s => Number(s.scanned) > 0);
    } catch(e) { return false; }
  })();
  if (skuSource !== 'pdf' && skuSource !== 'sheet' && row.pick_list_pdf_url && phase === 'packer' && !hasExistingScans) {
    const statusEl = document.getElementById('packLoadStatus');
    if (statusEl) statusEl.textContent = 'Auto-loading pick list PDF…';
    // Fire and forget — loadPackPdfFromUrl updates the UI as it goes.
    loadPackPdfFromUrl(row.pick_list_pdf_url);
  }
}

function renderPackPhotoGallery_(jsonStr) {
  let arr = [];
  try { arr = JSON.parse(jsonStr || '[]'); if (!Array.isArray(arr)) arr = []; } catch(e) {}
  if (!arr.length) return '<div style="color:var(--text-dim);font-size:12px;font-style:italic">No photos yet — take a few of the boxed shipment before marking packed.</div>';
  return arr.map((p, idx) =>
    '<a href="'+esc(p.url)+'" target="_blank" rel="noopener" style="display:block;width:80px;height:80px;background:#000 url(\'https://drive.google.com/thumbnail?id='+esc((p.url.match(/\/d\/([^/]+)\//)||[])[1]||'')+'&sz=w160\') center/cover no-repeat;border:1px solid rgba(255,255,255,.15);border-radius:8px;position:relative" title="'+esc(p.name||'photo '+(idx+1))+'"><span style="position:absolute;bottom:2px;right:4px;background:rgba(0,0,0,.7);color:#fff;font-size:9px;padding:1px 4px;border-radius:3px">'+(idx+1)+'</span></a>'
  ).join('');
}

async function onPackPhotoSelected(event, orderNumber) {
  const files = Array.from(event.target.files || []);
  event.target.value = ''; // reset so the same file can be picked again later
  if (!files.length) return;
  const statusEl = document.getElementById('packPhotoStatus');
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    statusEl.textContent = 'Uploading ' + (i+1) + '/' + files.length + ' (' + f.name + ')…';
    try {
      const dataUrl = await compressImageToJpeg_(f, 1920, 0.85);
      const base64 = dataUrl.split(',')[1];
      const res = await groundApi('addPackPhoto', {
        orderNumber: orderNumber,
        base64Data: base64,
        filename: orderNumber + '-' + Date.now() + '-' + (i+1) + '.jpg',
        mimeType: 'image/jpeg',
        deviceId: getPackDeviceId_(),
      });
      if (!res || !res.ok) {
        statusEl.textContent = 'Upload failed: ' + ((res && res.error) || 'unknown');
        return;
      }
      // Patch the in-memory cache row + repaint the gallery
      const row = _packQueueCache.find(r => String(r.order_number) === String(orderNumber));
      if (row) {
        let arr = []; try { arr = JSON.parse(row.photo_urls_json || '[]'); if (!Array.isArray(arr)) arr = []; } catch(e) {}
        arr.push({ url: res.url, name: f.name, addedAt: new Date().toISOString() });
        row.photo_urls_json = JSON.stringify(arr);
        document.getElementById('packPhotoGallery').innerHTML = renderPackPhotoGallery_(row.photo_urls_json);
        document.getElementById('packPhotoCount').textContent = '(' + arr.length + ')';
      }
    } catch (err) {
      statusEl.textContent = 'Upload error: ' + err.message;
      return;
    }
  }
  statusEl.textContent = files.length + ' photo' + (files.length===1?'':'s') + ' uploaded';
}

function compressImageToJpeg_(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('FileReader failed'));
    reader.onload = e => {
      const img = new Image();
      img.onerror = () => reject(new Error('Image decode failed'));
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) {
          const scale = maxDim / Math.max(w, h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(cv.toDataURL('image/jpeg', quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

if (typeof pdfjsLib !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
}

// ────────────────────────────────────────────────────────────
// PACK PDF PARSER + SCAN-TO-VERIFY (DIAG-V75-PACK-PDF)
//
// Hybrid per Phase 3 plan:
//   • Client-side PDF/CSV/manual parse ported from
//     murphybeddepot/fulfillment/index.html (parsePDFText / parsePDFBuffer
//     / extractDriveFileId / loadFromLink). QTY column governs item
//     count (regex /^(\d+)\s+(.+)$/) per the fulfillment app's contract.
//   • Scan-to-verify state lives in JS only this slice (per-order map
//     keyed by normalized SKU). The PackingQueue sheet's sku_lines_json
//     is unchanged unless the packer explicitly re-parses; no scan-
//     progress endpoint exists yet — proposed `recordPackScan` in the
//     deploy summary so multi-device sync + inside-item resolution
//     can move server-side in the next slice.
//   • Drive-link load uses the same CORS proxy fallback chain from the
//     fulfillment app since GitHub Pages can't fetch drive.google.com
//     directly.
// ────────────────────────────────────────────────────────────

const PACK_PDF_CORS_PROXIES = [
  function(u){ return 'https://corsproxy.io/?' + encodeURIComponent(u); },
  function(u){ return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u); },
  function(u){ return 'https://cors-anywhere.herokuapp.com/' + u; },
];
const PACK_SIZE_PREFIXES = new Set(['DOUBLE','SINGLE','QUEEN','KING','TWIN','FULL','NOTE','QTY','DESCRIPTION','MBD']);

// Per-order scan state. Map<orderNumber, { skus: [{sku, qty, name, scanned}, ...] }>
const _packScanState = {};

// Per-order request queue so rapid scans / ± taps don't race. Each scan
// or stepper tap chains onto the prior in-flight request via .then(), so
// the optimistic-then-server-replace cycle never overlaps for the same
// order. Without this, response A could overwrite optimistic state from
// scan B before B's own response lands, flickering rows checked→unchecked
// →checked.
const _packScanQueue = {};

// 'packer' or 'checker' — controls which endpoint scan + ± calls hit, and
// which scanned-state column the iPad reads on detail open. Set by
// openPackDetail based on the row's status + whose device id is on the
// row's claim fields.
let _packActivePhase = 'packer';

// Manager bulk-mode state — when enabled, cards show a checkbox and a
// sticky toolbar at the top of the list lets the manager mark multiple
// orders packed/shipped in one PIN-gated batch.
let _packManagerMode = false;
const _packBulkSelection = new Set();

// v10.152 persona #13 Seth — ship-date filter chips that appear in
// manager bulk mode so he can isolate today / overdue / this-week
// before marking. Persisted to localStorage so re-entering bulk mode
// remembers the last filter. Values: all | overdue | today | tomorrow
// | this_week.
const PACK_SHIPDATE_FILTER_KEY = 'mbd_pack_ship_date_filter';
let _packShipDateFilter = (function() {
  try { return localStorage.getItem(PACK_SHIPDATE_FILTER_KEY) || 'all'; }
  catch(e) { return 'all'; }
})();

const PACK_SHIPDATE_FILTERS = [
  { value: 'all',       label: 'Any date',  emoji: '◯',   color: '#9aa0a6' },
  { value: 'overdue',   label: 'Overdue',   emoji: '⚠️', color: '#ff5252' },
  { value: 'today',     label: 'Today',     emoji: '📅', color: '#00e676' },
  { value: 'tomorrow',  label: 'Tomorrow',  emoji: '➡️', color: '#FFB300' },
  { value: 'this_week', label: 'This week', emoji: '📆', color: '#42a5f5' },
];

function packShipDateFilterLabel_(value) {
  const f = PACK_SHIPDATE_FILTERS.find(x => x.value === value);
  return f ? f.label : value;
}

function matchPackShipDateFilter_(iso, bucketOf) {
  const b = bucketOf(iso);
  if (_packShipDateFilter === 'overdue')   return b === 'Past';
  if (_packShipDateFilter === 'today')     return b === 'Today';
  if (_packShipDateFilter === 'tomorrow')  return b === 'Tomorrow';
  if (_packShipDateFilter === 'this_week') return b === 'Today' || b === 'Tomorrow' || b === 'This Week';
  return true;
}

function renderPackShipDateFilterChips_(rows) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:10px;padding:10px 12px;background:rgba(255,165,0,.06);border:1px solid rgba(255,165,0,.25);border-radius:10px;flex-wrap:wrap';
  const label = document.createElement('div');
  label.style.cssText = 'font-family:\'Barlow Condensed\',Arial,sans-serif;font-size:12px;font-weight:900;color:#ff9800;letter-spacing:1.5px;text-transform:uppercase;margin-right:4px';
  label.textContent = 'Ship date';
  wrap.appendChild(label);
  // Pre-count rows per filter so Seth sees how many he'd be selecting.
  const today = new Date(); today.setHours(0,0,0,0);
  const tomorrow = new Date(today.getTime() + 86400000);
  const weekOut = new Date(today.getTime() + 7 * 86400000);
  const bucketOf = (iso) => {
    if (!iso) return 'No Date';
    const d = new Date(String(iso).slice(0, 10) + 'T00:00:00');
    if (d < today) return 'Past';
    if (d < tomorrow) return 'Today';
    if (d < new Date(today.getTime() + 2 * 86400000)) return 'Tomorrow';
    if (d < weekOut) return 'This Week';
    return 'Later';
  };
  const counts = { all: rows.length, overdue: 0, today: 0, tomorrow: 0, this_week: 0 };
  rows.forEach(r => {
    const b = bucketOf(r.ship_date);
    if (b === 'Past') counts.overdue++;
    if (b === 'Today') { counts.today++; counts.this_week++; }
    else if (b === 'Tomorrow') { counts.tomorrow++; counts.this_week++; }
    else if (b === 'This Week') counts.this_week++;
  });
  PACK_SHIPDATE_FILTERS.forEach(f => {
    const active = _packShipDateFilter === f.value;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.onclick = () => setPackShipDateFilter_(f.value);
    const bg = active ? f.color + '33' : 'rgba(255,255,255,.04)';
    const border = active ? f.color : 'rgba(255,255,255,.18)';
    const color = active ? f.color : 'var(--text)';
    chip.style.cssText = 'padding:6px 11px;font-size:12px;font-weight:'+(active?'900':'700')+';background:'+bg+';color:'+color+';border:1.5px solid '+border+';border-radius:999px;cursor:pointer;letter-spacing:.3px';
    chip.innerHTML = f.emoji + ' ' + esc(f.label)
      + '<span style="margin-left:6px;font-size:11px;opacity:.75;font-weight:700">' + counts[f.value] + '</span>';
    wrap.appendChild(chip);
  });
  return wrap;
}

function setPackShipDateFilter_(value) {
  _packShipDateFilter = value;
  try { localStorage.setItem(PACK_SHIPDATE_FILTER_KEY, value); } catch(e) {}
  paintPackQueue_(_packQueueCache, false);
}
function packEnqueue_(orderNumber, task) {
  const prev = _packScanQueue[orderNumber] || Promise.resolve();
  const next = prev.then(task).catch(err => { console.warn('pack queue task failed:', err); });
  _packScanQueue[orderNumber] = next;
  return next;
}

function getPackScanState_(orderNumber, sourceSkusJson, sourceScannedJson) {
  if (!_packScanState[orderNumber]) {
    let arr = [];
    try { arr = JSON.parse(sourceSkusJson || '[]'); if (!Array.isArray(arr)) arr = []; } catch(e) {}
    let scannedBySku = {};
    try {
      const scArr = JSON.parse(sourceScannedJson || '[]');
      if (Array.isArray(scArr)) scArr.forEach(s => { scannedBySku[String(s.sku || '').trim()] = Number(s.scanned) || 0; });
    } catch(e) {}
    _packScanState[orderNumber] = {
      skus: arr.map(s => {
        const sku = String(s.sku || '').trim();
        return {
          sku: sku,
          qty: Number(s.qty) || 0,
          name: String(s.name || s.sku || '').trim(),
          scanned: scannedBySku[sku] || 0,
        };
      }),
    };
  }
  return _packScanState[orderNumber];
}

function setPackScanState_(orderNumber, skuArr) {
  _packScanState[orderNumber] = {
    skus: skuArr.map(s => ({
      sku: String(s.sku || '').trim(),
      qty: Number(s.qty) || 0,
      name: String(s.name || s.sku || '').trim(),
      scanned: Number(s.scanned) || 0,
    })),
  };
}

function packNorm_(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function renderPackSkuList_(orderNumber) {
  const list = document.getElementById('packSkuList');
  const prog = document.getElementById('packSkuProgress');
  if (!list) return;
  const state = _packScanState[orderNumber];
  if (!state || !state.skus.length) {
    list.innerHTML = '<div style="color:var(--text-dim);font-size:13px;font-style:italic">No SKUs loaded — upload a pick list PDF/CSV or re-parse from the email.</div>';
    if (prog) prog.textContent = '';
    return;
  }
  const done = state.skus.filter(s => s.scanned >= s.qty).length;
  if (prog) prog.textContent = '(' + done + '/' + state.skus.length + ' complete)';
  list.innerHTML = state.skus.map((s, idx) => {
    const isDone = s.scanned >= s.qty;
    const isOver = s.scanned > s.qty;
    const bg = isDone ? 'rgba(0,230,118,.10)' : isOver ? 'rgba(255,82,82,.10)' : 'rgba(255,255,255,.02)';
    const border = isDone ? 'rgba(0,230,118,.45)' : isOver ? 'rgba(255,82,82,.45)' : 'rgba(255,255,255,.08)';
    const checkColor = isDone ? '#00e676' : isOver ? '#ff5252' : 'var(--text-dim)';
    const checkChar = isDone ? '✓' : isOver ? '!' : '○';
    return '<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;margin-bottom:6px;background:'+bg+';border:1px solid '+border+';border-radius:8px">'
      + '<div style="font-size:18px;font-weight:900;color:'+checkColor+';width:22px;text-align:center">'+checkChar+'</div>'
      + '<div style="flex:1;min-width:0">'
      +   '<div style="font-family:\'JetBrains Mono\',monospace;font-size:13px;color:var(--text);word-break:break-all">'+esc(s.sku)+'</div>'
      +   (s.name && s.name !== s.sku ? '<div style="font-size:11px;color:var(--text-dim);margin-top:2px">'+esc(s.name)+'</div>' : '')
      + '</div>'
      + '<div style="display:flex;align-items:center;gap:4px;flex-shrink:0">'
      +   '<button onclick="bumpPackSku(\''+esc(orderNumber)+'\',' + idx + ',-1)" class="amp-btn" style="padding:4px 9px;font-size:14px;min-width:32px">−</button>'
      +   '<div style="font-family:\'JetBrains Mono\',monospace;font-size:16px;font-weight:900;color:'+(isOver?'#ff5252':isDone?'#00e676':'var(--text)')+';min-width:48px;text-align:center">'+s.scanned+'/'+s.qty+'</div>'
      +   '<button onclick="bumpPackSku(\''+esc(orderNumber)+'\',' + idx + ',1)" class="amp-btn go" style="padding:4px 9px;font-size:14px;min-width:32px">+</button>'
      + '</div>'
      + '</div>';
  }).join('');
}

function bumpPackSku(orderNumber, idx, delta) {
  const state = _packScanState[orderNumber];
  if (!state || !state.skus[idx]) return;
  const s = state.skus[idx];
  const prev = s.scanned;
  // Optimistic local update so the tap feels instant.
  s.scanned = Math.max(0, s.scanned + delta);
  renderPackSkuList_(orderNumber);

  const bumpAction = _packActivePhase === 'checker' ? 'recordPackCheckScan' : 'recordPackScan';
  packEnqueue_(orderNumber, async () => {
    try {
      const res = await groundApi(bumpAction, {
        orderNumber: orderNumber,
        scannedSku: s.sku,
        manualAdjustment: true,
        delta: delta,
        deviceId: getPackDeviceId_(),
      });
      if (!res || !res.ok) {
        if (_packScanState[orderNumber] && _packScanState[orderNumber].skus[idx]) {
          _packScanState[orderNumber].skus[idx].scanned = prev;
          if (_packDetailOrderNumber === orderNumber) renderPackSkuList_(orderNumber);
        }
        showToast('Adjustment failed: ' + ((res && res.error) || 'unknown'));
        return;
      }
      const cached = _packQueueCache.find(r => String(r.order_number) === String(orderNumber));
      if (cached) {
        if (_packActivePhase === 'checker') cached.checker_scanned_json = res.scanned_json;
        else cached.scanned_json = res.scanned_json;
      }
      // Authoritative apply for manual ± because the user's explicit intent
      // is the new count (not max-merge — a − tap should be able to
      // decrement past optimistic increments from concurrent scans).
      let serverByScannedSku = {};
      try {
        const arr = JSON.parse(res.scanned_json || '[]');
        if (Array.isArray(arr)) arr.forEach(x => { serverByScannedSku[String(x.sku || '').trim()] = Number(x.scanned) || 0; });
      } catch(e) {}
      const localState = _packScanState[orderNumber];
      if (localState) {
        localState.skus.forEach(x => {
          if (x.sku === s.sku) x.scanned = serverByScannedSku[x.sku] || 0;
          else x.scanned = Math.max(x.scanned, serverByScannedSku[x.sku] || 0);
        });
      }
      if (_packDetailOrderNumber === orderNumber) renderPackSkuList_(orderNumber);
    } catch (err) {
      if (_packScanState[orderNumber] && _packScanState[orderNumber].skus[idx]) {
        _packScanState[orderNumber].skus[idx].scanned = prev;
        if (_packDetailOrderNumber === orderNumber) renderPackSkuList_(orderNumber);
      }
      showToast('Adjustment error: ' + err.message);
    }
  });
}

function handlePackScanSubmit() {
  const input = document.getElementById('packScanInput');
  if (!input) return;
  const code = input.value.trim();
  input.value = '';
  if (!code) return;
  processPackScan_(code);
  input.focus();
}

function processPackScan_(code) {
  if (!_packDetailOrderNumber) return;
  const orderNumber = _packDetailOrderNumber;
  const state = _packScanState[orderNumber];
  if (!state || !state.skus.length) {
    showToast('No SKU list loaded — upload a pick list first');
    return;
  }

  // Optimistic local match is applied immediately so the UI feels
  // instant; the actual server roundtrip is queued so it can't race
  // with a follow-up scan's server roundtrip.
  const codeNorm = packNorm_(code);
  let optimisticIdx = state.skus.findIndex(s => packNorm_(s.sku) === codeNorm);
  if (optimisticIdx < 0) {
    optimisticIdx = state.skus.findIndex(s => packNorm_(s.sku).startsWith(codeNorm) && codeNorm.length >= 4);
  }
  if (optimisticIdx >= 0) {
    const s = state.skus[optimisticIdx];
    s.scanned = Math.min(s.qty + 5, s.scanned + 1);
    renderPackSkuList_(orderNumber);
  }

  const scanAction = _packActivePhase === 'checker' ? 'recordPackCheckScan' : 'recordPackScan';
  packEnqueue_(orderNumber, async () => {
    try {
      const res = await groundApi(scanAction, {
        orderNumber: orderNumber,
        scannedSku: code,
        deviceId: getPackDeviceId_(),
      });
      if (!res || !res.ok) {
        if (optimisticIdx >= 0 && _packScanState[orderNumber]) {
          _packScanState[orderNumber].skus[optimisticIdx].scanned =
            Math.max(0, _packScanState[orderNumber].skus[optimisticIdx].scanned - 1);
          if (_packDetailOrderNumber === orderNumber) renderPackSkuList_(orderNumber);
        }
        showToast(((res && res.error) || 'Scan rejected'));
        return;
      }
      // Merge: keep counts at max(local, server) so an earlier server
      // response from a stale scan can't overwrite a later optimistic
      // increment. Once the whole queue drains, the two converge.
      const cached = _packQueueCache.find(r => String(r.order_number) === String(orderNumber));
      if (cached) {
        if (_packActivePhase === 'checker') cached.checker_scanned_json = res.scanned_json;
        else cached.scanned_json = res.scanned_json;
      }
      let serverByScannedSku = {};
      try {
        const arr = JSON.parse(res.scanned_json || '[]');
        if (Array.isArray(arr)) arr.forEach(s => { serverByScannedSku[String(s.sku || '').trim()] = Number(s.scanned) || 0; });
      } catch(e) {}
      const localState = _packScanState[orderNumber];
      if (localState) {
        localState.skus.forEach(s => {
          const serverCount = serverByScannedSku[s.sku] || 0;
          s.scanned = Math.max(s.scanned, serverCount);
        });
      }
      if (_packDetailOrderNumber === orderNumber) renderPackSkuList_(orderNumber);
      if (navigator.vibrate) navigator.vibrate(res.scanned >= res.qty ? [60, 30, 60] : 40);
      if (res.kind === 'box_alias' || res.kind === 'parent_alias') {
        showToast('✓ ' + res.sku + ' via alias "' + res.scanned_alias + '" — ' + res.scanned + '/' + res.qty);
      } else if (res.scanned >= res.qty) {
        showToast('✓ ' + res.sku + ' complete (' + res.scanned + '/' + res.qty + ')');
      }
    } catch (err) {
      if (optimisticIdx >= 0 && _packScanState[orderNumber]) {
        _packScanState[orderNumber].skus[optimisticIdx].scanned =
          Math.max(0, _packScanState[orderNumber].skus[optimisticIdx].scanned - 1);
        if (_packDetailOrderNumber === orderNumber) renderPackSkuList_(orderNumber);
      }
      showToast('Scan error: ' + err.message);
    }
  });
}

// Phase-aware reset: hits whichever scan column is active.
async function resetActivePackScansForOrder(orderNumber) {
  const action = _packActivePhase === 'checker' ? 'resetPackCheckScans' : 'resetPackScans';
  return resetPackScansViaAction_(orderNumber, action);
}

async function resetPackScansViaAction_(orderNumber, action) {
  if (!confirm('Reset scans for order ' + orderNumber + '? (Photos, claim, and the other phase\'s scans are preserved.)')) return;
  try {
    const res = await groundApi(action, { orderNumber: orderNumber, deviceId: getPackDeviceId_() });
    if (!res || !res.ok) {
      showToast('Reset failed: ' + ((res && res.error) || 'unknown'));
      return;
    }
    const cached = _packQueueCache.find(r => String(r.order_number) === String(orderNumber));
    if (cached) {
      if (_packActivePhase === 'checker') cached.checker_scanned_json = '';
      else cached.scanned_json = '';
    }
    delete _packScanState[orderNumber];
    if (cached) {
      const seedJson = (_packActivePhase === 'checker') ? cached.checker_scanned_json : cached.scanned_json;
      getPackScanState_(orderNumber, cached.sku_lines_json, seedJson);
    }
    renderPackSkuList_(orderNumber);
    showToast('Scans reset');
  } catch (err) {
    showToast('Reset error: ' + err.message);
  }
}

async function confirmReadyForCheck(orderNumber) {
  const state = _packScanState[orderNumber];
  let unscanned = 0;
  if (state) state.skus.forEach(s => { if (s.scanned < s.qty) unscanned += (s.qty - s.scanned); });
  const warn = unscanned > 0 ? '\n\nWARNING: ' + unscanned + ' SKU unit' + (unscanned===1?'':'s') + ' still unscanned. Tap Cancel and finish scanning, or push through if it\'s OK.' : '';
  if (!confirm('Hand off order ' + orderNumber + ' to the checker?' + warn)) return;
  try {
    const res = await groundApi('markPackJobReadyForCheck', { orderNumber: orderNumber, deviceId: getPackDeviceId_() });
    if (!res || !res.ok) {
      let msg = (res && res.error) || 'unknown';
      if (res && res.pending && res.pending.length) {
        msg += '\nUnscanned: ' + res.pending.map(p => p.sku + ' (' + p.scanned + '/' + p.qty + ')').join(', ');
      }
      showToast('Ready-for-check failed: ' + msg);
      return;
    }
    showToast('Handed off to checker ✓');
    closePackDetail();
    await refreshPackQueue();
  } catch (err) {
    showToast('Ready-for-check error: ' + err.message);
  }
}

async function claimPackCheck(orderNumber) {
  try {
    const res = await groundApi('claimPackCheckJob', {
      orderNumber: orderNumber,
      deviceId: getPackDeviceId_(),
      checkerName: localStorage.getItem('mbd_ground_packer') || '',
    });
    if (!res || !res.ok) {
      showToast('Could not start check: ' + ((res && res.error) || 'unknown'));
      return;
    }
    showToast('Checking order ' + orderNumber);
    await refreshPackQueue();
    openPackDetail(orderNumber);
  } catch (err) {
    showToast('Check claim error: ' + err.message);
  }
}

async function releasePackCheck(orderNumber) {
  if (!confirm('Release the check on order ' + orderNumber + '? Status goes back to "ready for check" so another checker can pick it up.')) return;
  try {
    const res = await groundApi('releasePackCheckJob', { orderNumber: orderNumber, deviceId: getPackDeviceId_() });
    if (!res || !res.ok) {
      showToast('Release failed: ' + ((res && res.error) || 'unknown'));
      return;
    }
    showToast('Released — order ' + orderNumber + ' is back to "ready for check"');
    if (typeof closePackDetail === 'function') closePackDetail();
    await refreshPackQueue();
  } catch (err) {
    showToast('Release error: ' + err.message);
  }
}

// In-memory cache of the manager PIN — saved after one successful
// manager action, expires 10 min later. Avoids re-typing the PIN for
// every batch the same manager runs in one session. Not persisted to
// localStorage (would defeat the security premise).
let _packManagerPin = null;
let _packManagerPinExpiresAt = 0;

function getCachedManagerPin_() {
  if (_packManagerPin && Date.now() < _packManagerPinExpiresAt) return _packManagerPin;
  return null;
}

function cacheManagerPin_(pin) {
  _packManagerPin = pin;
  _packManagerPinExpiresAt = Date.now() + 10 * 60 * 1000;
}

function clearManagerPin_() {
  _packManagerPin = null;
  _packManagerPinExpiresAt = 0;
}

function promptManagerPin_(reason) {
  const cached = getCachedManagerPin_();
  if (cached) return cached;
  const pin = prompt('Manager PIN' + (reason ? ' (' + reason + ')' : '') + ':');
  if (pin == null) return null;
  const trimmed = pin.trim();
  if (!trimmed) return null;
  cacheManagerPin_(trimmed);
  return trimmed;
}

function showPackBanner_(text, color) {
  const banner = document.getElementById('packActionBanner');
  if (!banner) return;
  banner.style.cssText = 'display:block;background:'+color+'1a;border:1px solid '+color+'72;border-radius:10px;padding:14px 16px;margin-bottom:10px;color:'+color+';font-family:\'Barlow Condensed\',Arial,sans-serif;font-size:18px;font-weight:900;letter-spacing:1px;text-transform:uppercase';
  banner.textContent = text;
  clearTimeout(showPackBanner_._t);
  showPackBanner_._t = setTimeout(() => { banner.style.display = 'none'; }, 6000);
}

// pdf-lib lazy loader — only fetched when "Print All" is tapped so
// the ~300KB doesn't load on every page open.
async function loadPdfLib_() {
  if (window.PDFLib) return window.PDFLib;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('pdf-lib failed to load — check your network'));
    document.head.appendChild(s);
  });
  if (!window.PDFLib) throw new Error('pdf-lib loaded but not on window');
  return window.PDFLib;
}

// JsBarcode lazy loader — Code 128 barcode generation for the stamped
// cover page. Renders to a canvas, which we then snapshot as a PNG and
// embed in the cover via pdf-lib.
async function loadJsBarcode_() {
  if (window.JsBarcode) return window.JsBarcode;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('JsBarcode failed to load'));
    document.head.appendChild(s);
  });
  if (!window.JsBarcode) throw new Error('JsBarcode loaded but not on window');
  return window.JsBarcode;
}

// Generate a Code 128 barcode of the order number as a PNG data URL.
function makeOrderBarcodePng_(orderNumber) {
  const canvas = document.createElement('canvas');
  JsBarcode(canvas, String(orderNumber), {
    format: 'CODE128',
    width: 3,
    height: 80,
    displayValue: true,
    fontSize: 22,
    margin: 10,
    background: '#ffffff',
    lineColor: '#000000',
  });
  return canvas.toDataURL('image/png');
}

// Build a one-page cover PDF (as Uint8Array) with order # huge at the
// top, customer abbrev + state, ship date, customer name + address,
// and a Code 128 barcode at the bottom. Prepends to the instructions
// PDF before sending to PrintNode. Page is Letter (612×792 pt).
async function buildPackCoverPagePdf_(row) {
  const PDFLib = await loadPdfLib_();
  await loadJsBarcode_();
  const cover = await PDFLib.PDFDocument.create();
  const page = cover.addPage([612, 792]);
  const bold = await cover.embedFont(PDFLib.StandardFonts.HelveticaBold);
  const reg = await cover.embedFont(PDFLib.StandardFonts.Helvetica);
  const black = PDFLib.rgb(0, 0, 0);
  const dim = PDFLib.rgb(0.35, 0.35, 0.35);

  // Huge order number, centered horizontally near the top.
  const orderText = '#' + String(row.order_number || '?');
  const orderSize = 140;
  const orderWidth = bold.widthOfTextAtSize(orderText, orderSize);
  page.drawText(orderText, {
    x: (612 - orderWidth) / 2,
    y: 600,
    size: orderSize,
    font: bold,
    color: black,
  });

  // Second line: the task line (e.g. "31875 OSB (D123 QLHW81) -BKS MN CC")
  // gives us customer abbrev, lot, SKU, state, carrier at a glance.
  const taskLine = String(row.task_line || '').trim();
  if (taskLine) {
    const taskSize = 28;
    const taskWidth = bold.widthOfTextAtSize(taskLine, taskSize);
    page.drawText(taskLine, {
      x: Math.max(40, (612 - taskWidth) / 2),
      y: 540,
      size: Math.min(taskSize, (612 - 80) * taskSize / Math.max(taskWidth, taskSize)),
      font: bold,
      color: black,
      maxWidth: 612 - 80,
    });
  }

  // Ship date — third line.
  if (row.ship_date) {
    const sd = 'SHIP: ' + row.ship_date;
    const sdSize = 22;
    const sdWidth = bold.widthOfTextAtSize(sd, sdSize);
    page.drawText(sd, {
      x: (612 - sdWidth) / 2,
      y: 490,
      size: sdSize,
      font: bold,
      color: black,
    });
  }

  // Customer name + address as a small block in the middle.
  const cust = String(row.customer_name || '').trim();
  const addr = String(row.customer_address || '').trim();
  let y = 410;
  if (cust) {
    page.drawText(cust, { x: 40, y: y, size: 16, font: reg, color: black, maxWidth: 532 });
    y -= 22;
  }
  if (addr) {
    // Wrap manually at ~70 chars.
    const lines = [];
    let buf = '';
    addr.split(/\s+/).forEach(w => {
      if ((buf + ' ' + w).trim().length > 70) { if (buf) lines.push(buf); buf = w; }
      else buf = (buf ? buf + ' ' : '') + w;
    });
    if (buf) lines.push(buf);
    lines.forEach(l => {
      page.drawText(l, { x: 40, y: y, size: 14, font: reg, color: dim });
      y -= 18;
    });
  }
  if (row.customer_phone) {
    page.drawText(String(row.customer_phone), { x: 40, y: y, size: 14, font: reg, color: dim });
    y -= 18;
  }

  // Barcode at the bottom — scannable by the iPad's keyboard-wedge scanner.
  try {
    const barcodeDataUrl = makeOrderBarcodePng_(row.order_number);
    const pngBytes = await fetch(barcodeDataUrl).then(r => r.arrayBuffer());
    const png = await cover.embedPng(pngBytes);
    const targetWidth = 400;
    const scale = targetWidth / png.width;
    const targetHeight = png.height * scale;
    page.drawImage(png, {
      x: (612 - targetWidth) / 2,
      y: 80,
      width: targetWidth,
      height: targetHeight,
    });
  } catch (err) {
    console.warn('barcode embed failed:', err);
    // Fallback: draw the order number plain
    page.drawText('Order ' + String(row.order_number), {
      x: 40, y: 100, size: 18, font: bold, color: black,
    });
  }

  // Footer with timestamp + a packer note
  const ts = new Date().toLocaleString();
  page.drawText('Printed ' + ts, { x: 40, y: 40, size: 9, font: reg, color: dim });
  page.drawText('Scan barcode at packing station to open order', { x: 320, y: 40, size: 9, font: reg, color: dim });

  return await cover.save();
}

// Take instructions PDF bytes, prepend the generated cover + a blank
// page (so duplex printing lands the instructions' original first page
// on the front of sheet 2, not the back of the cover sheet), return
// the combined bytes.
async function prependCoverToPdf_(coverBytes, instructionsBytes) {
  const PDFLib = await loadPdfLib_();
  const out = await PDFLib.PDFDocument.create();
  const cover = await PDFLib.PDFDocument.load(coverBytes);
  const instructions = await PDFLib.PDFDocument.load(instructionsBytes, { ignoreEncryption: true });
  const coverPages = await out.copyPages(cover, cover.getPageIndices());
  coverPages.forEach(p => out.addPage(p));
  // Blank duplex spacer. Sized to match the cover so the printer
  // doesn't reflow / scale anything. Letter (612×792 pt).
  out.addPage([612, 792]);
  const instructionPages = await out.copyPages(instructions, instructions.getPageIndices());
  instructionPages.forEach(p => out.addPage(p));
  return await out.save();
}

// Base64-encode a Uint8Array — avoiding String.fromCharCode.apply spread
// blow-up on large arrays.
function uint8ToBase64_(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

// Stamp + print one order's instructions. Fetches the instructions PDF
// (via existing orchestrator passthrough), generates the cover, prepends,
// sends base64 to printRawPackPdf. Returns the server's response object.
async function stampAndPrintPackInstructions_(row) {
  const url = row.instructions_pdf_url || row.pick_list_pdf_url;
  if (!url) throw new Error('no PDF URL for ' + row.order_number);
  const instructionsBytes = await packFetchPdfBytes_(url);
  const coverBytes = await buildPackCoverPagePdf_(row);
  const combined = await prependCoverToPdf_(coverBytes, instructionsBytes);
  const base64 = uint8ToBase64_(combined);
  return await groundApi('printRawPackPdf', {
    orderNumber: row.order_number,
    base64: base64,
    jobTitle: 'MBD Pack ' + row.order_number,
  });
}

// Fetch a Drive PDF via the orchestrator (passes auth so PII-restricted
// PDFs work) and return raw bytes as Uint8Array.
async function packFetchPdfBytes_(driveUrl) {
  const res = await groundApi('fetchPackPickListPdf', { driveUrl: driveUrl });
  if (!res || !res.ok || !res.base64) {
    throw new Error((res && res.error) || 'orchestrator returned no bytes for ' + driveUrl);
  }
  const raw = atob(res.base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

// Open a Drive PDF in a new tab for AirPrint. Fetches via orchestrator
// (since the PDF carries customer PII and isn't publicly shared), wraps
// as a Blob URL, opens. Safari → Share sheet → Print → AirPrint Brother.
async function airPrintDrivePdf_(driveUrl, suggestedFilename) {
  const bytes = await packFetchPdfBytes_(driveUrl);
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if (!w) {
    // Popup blocked — surface a tappable link.
    showToast('Allow popups, then tap Print again');
  }
  // Don't revoke immediately — Safari may still be loading. Revoke after a
  // minute; if the user prints faster than that, the blob will be cached.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// Ensure a row has its instructions_pdf_url populated. If it's missing,
// fetch the pick-list PDF via the orchestrator, parse it with PDF.js,
// extract the first drive.google.com hyperlink (the INST-* link), and
// persist via setPackInstructionsUrl. Idempotent — early-exits if the
// URL is already there. Returns the URL or empty string on failure.
async function ensurePackInstructionsUrl_(orderNumber) {
  const row = _packQueueCache.find(r => String(r.order_number) === String(orderNumber));
  if (!row) return '';
  if (row.instructions_pdf_url) return row.instructions_pdf_url;
  if (!row.pick_list_pdf_url) return '';

  const parsed = await (async () => {
    try {
      const res = await groundApi('fetchPackPickListPdf', { driveUrl: row.pick_list_pdf_url });
      if (!res || !res.ok || !res.base64) throw new Error((res && res.error) || 'orchestrator fetch failed');
      const raw = atob(res.base64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      return await packParsePdfBuffer_(bytes.buffer);
    } catch (err) {
      console.warn('ensurePackInstructionsUrl_(' + orderNumber + ') parse failed:', err.message);
      return null;
    }
  })();

  if (!parsed || !parsed.instructionsPdfUrl) return '';

  try {
    const res = await groundApi('setPackInstructionsUrl', {
      orderNumber: orderNumber,
      url: parsed.instructionsPdfUrl,
    });
    if (res && res.ok) {
      row.instructions_pdf_url = parsed.instructionsPdfUrl;
      return parsed.instructionsPdfUrl;
    }
  } catch (e) { /* swallow */ }
  return '';
}

// v10.92 (task #63, Zac): when the instructions link can't be
// auto-extracted from the pick-list PDF, the packer was stuck —
// nothing prompted for it and every print re-attempted the failing
// parse. Now they can paste it once; it persists via the existing
// setPackInstructionsUrl endpoint (no server change) so it's never
// asked again. Returns the saved URL or ''.
async function promptForInstructionsUrl_(orderNumber) {
  const row = _packQueueCache.find(r => String(r.order_number) === String(orderNumber));
  if (!row) { showToast('Order not in current list — refresh'); return ''; }
  const existing = row.instructions_pdf_url || '';
  const entered = window.prompt(
    'Instructions link for order ' + orderNumber + '\n\n'
    + 'Paste the build/assembly instructions URL (Drive or PDF link).\n'
    + 'It will be remembered for this order — you won\'t be asked again.',
    existing);
  if (entered === null) return existing; // cancelled
  const url = String(entered).trim();
  if (url && url === existing) return existing; // unchanged
  if (url && !/^https?:\/\//i.test(url)) {
    showToast('That doesn\'t look like a URL (needs http/https) — not saved');
    return existing;
  }
  if (!url) { showToast('No URL entered — nothing changed'); return existing; }
  try {
    showPackBanner_('Saving instructions link for ' + orderNumber + '…', '#42a5f5');
    const res = await groundApi('setPackInstructionsUrl', { orderNumber: orderNumber, url: url });
    if (res && res.ok) {
      row.instructions_pdf_url = url;
      try { paintPackQueue_(_packQueueCache, false); } catch (e) {}
      if (typeof openPackDetail === 'function' && _packDetailOrderNumber === orderNumber) {
        try { openPackDetail(orderNumber); } catch (e) {}
      }
      showPackBanner_('✓ Instructions link saved & remembered for ' + orderNumber, '#00e676');
      return url;
    }
    showToast('Save failed: ' + ((res && res.error) || 'unknown'));
  } catch (e) {
    showToast('Save error: ' + e.message);
  }
  return existing;
}

async function printOneInstruction(orderNumber) {
  const row = _packQueueCache.find(r => String(r.order_number) === String(orderNumber));
  if (!row) { showToast('Order not in current list — refresh'); return; }
  if (!row.pick_list_pdf_url) { showToast('No PDF URL on this order'); return; }
  if (!confirm('Print stamped instructions packet for ' + orderNumber + ' to the Brother?\n\n(Cover page with order # + barcode is added on top.)')) return;

  // If instructions URL hasn't been extracted yet, extract it now so we
  // don't print the pick list by mistake.
  if (!row.instructions_pdf_url) {
    showPackBanner_('Extracting instructions URL from ' + orderNumber + '…', '#42a5f5');
    await ensurePackInstructionsUrl_(orderNumber);
    // v10.92: auto-extract failed → don't silently print the pick
    // list as if it were instructions. Ask the packer to paste the
    // link once; promptForInstructionsUrl_ persists it so this never
    // recurs. Cancel = keep the old pick-list fallback behavior.
    if (!row.instructions_pdf_url) {
      const supplied = await promptForInstructionsUrl_(orderNumber);
      if (!supplied) {
        showPackBanner_('No instructions link — printing the pick list as a fallback', '#ff9800');
      }
    }
  }

  showPackBanner_('Stamping cover + sending ' + orderNumber + ' to Brother…', '#42a5f5');
  try {
    const res = await stampAndPrintPackInstructions_(row);
    if (res && res.ok) {
      // Reflect printed status locally so the badge appears immediately.
      row.instructions_printed_at = new Date().toISOString();
      paintPackQueue_(_packQueueCache, false);
      showPackBanner_('Sent ' + orderNumber + ' → Brother 🖨 (job ' + res.job_id + ')', '#00e676');
      return;
    }
    const why = (res && res.error) || 'unknown';
    showPackBanner_('PrintNode failed (' + why + ') — opening for AirPrint', '#ff9800');
    const url = row.instructions_pdf_url || row.pick_list_pdf_url;
    await airPrintDrivePdf_(url, orderNumber + '-instructions.pdf');
  } catch (err) {
    showPackBanner_('Print error: ' + err.message + ' — try AirPrint', '#ff5252');
    const url = row.instructions_pdf_url || row.pick_list_pdf_url;
    try { await airPrintDrivePdf_(url, orderNumber + '-instructions.pdf'); } catch(e) {}
  }
}

async function printTodaysInstructions() {
  const inflight = _packQueueCache.filter(r => {
    const s = String(r.status || '');
    return s === 'pending' || s === 'in_progress' || s === 'ready_for_check' || s === 'checking';
  });
  if (inflight.length === 0) {
    showToast('No orders on today\'s list to print');
    return;
  }
  if (!confirm('Print instructions for ' + inflight.length + ' order' + (inflight.length === 1 ? '' : 's') + ' to the Brother?')) return;

  // Pre-fetch: any order missing instructions_pdf_url gets its pick-list
  // PDF parsed inline so the server has the right URL to print. Without
  // this, the server falls back to printing the pick list itself — which
  // is what was happening in v90.
  const needsExtraction = inflight.filter(r => !r.instructions_pdf_url && r.pick_list_pdf_url);
  if (needsExtraction.length) {
    showPackBanner_('Extracting instructions from ' + needsExtraction.length + ' pick list' + (needsExtraction.length === 1 ? '' : 's') + '…', '#42a5f5');
    // Run with a small concurrency window so we don't fire 12 simultaneous
    // Drive fetches at the orchestrator.
    const CONCURRENCY = 3;
    let i = 0, extracted = 0, noLink = 0;
    while (i < needsExtraction.length) {
      const batch = needsExtraction.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map(r => ensurePackInstructionsUrl_(r.order_number)));
      results.forEach(u => { if (u) extracted++; else noLink++; });
      i += CONCURRENCY;
      showPackBanner_('Extracted ' + extracted + '/' + needsExtraction.length + '…', '#42a5f5');
    }
    if (noLink) {
      console.warn(noLink + ' orders had no instructions link inside their pick lists — those will print the pick list as fallback');
    }
  }

  // Stamp + submit each order sequentially. Each order = one PrintNode
  // job = one stapled packet at the Brother. Sequential (not concurrent)
  // because we want the printer's spool to receive them in ship_date
  // order so packets stack in the right order at the printer.
  showPackBanner_('Stamping covers + printing ' + inflight.length + ' packets…', '#42a5f5');
  const sorted = inflight.slice().sort((a, b) => String(a.ship_date || '').localeCompare(String(b.ship_date || '')));
  let ok = 0, failed = [];
  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i];
    showPackBanner_('Stamping ' + (i + 1) + '/' + sorted.length + ' (' + row.order_number + ')…', '#42a5f5');
    try {
      const res = await stampAndPrintPackInstructions_(row);
      if (res && res.ok) {
        row.instructions_printed_at = new Date().toISOString();
        ok++;
      } else {
        failed.push(row.order_number + ': ' + ((res && res.error) || 'unknown'));
      }
    } catch (err) {
      failed.push(row.order_number + ': ' + err.message);
    }
  }
  paintPackQueue_(_packQueueCache, false); // refresh badges

  if (failed.length === 0) {
    showPackBanner_(ok + ' packet' + (ok === 1 ? '' : 's') + ' sent to Brother 🖨', '#00e676');
  } else if (ok > 0) {
    showPackBanner_(ok + ' sent · ' + failed.length + ' failed — see alert', '#ff9800');
    alert('Print Today\'s Instructions:\n' + ok + ' sent, ' + failed.length + ' failed.\n\n' + failed.join('\n'));
  } else {
    showPackBanner_('All ' + failed.length + ' prints failed — falling back to AirPrint merge', '#ff9800');
    await printTodaysInstructionsAirPrintFallback_(inflight);
  }
}

async function printTodaysInstructionsAirPrintFallback_(inflight) {
  const withInstructions = inflight.filter(r => r.instructions_pdf_url);
  const fallbackPick = inflight.filter(r => !r.instructions_pdf_url && r.pick_list_pdf_url);
  if (!withInstructions.length && !fallbackPick.length) {
    showPackBanner_('No PDFs available to print', '#ff5252');
    return;
  }
  const total = withInstructions.length + fallbackPick.length;
  showPackBanner_('Merging ' + total + ' PDFs for AirPrint…', '#42a5f5');
  try {
    const PDFLib = await loadPdfLib_();
    const merged = await PDFLib.PDFDocument.create();
    const all = withInstructions.concat(fallbackPick);
    let done = 0, failed = [];
    for (const r of all) {
      const url = r.instructions_pdf_url || r.pick_list_pdf_url;
      try {
        const bytes = await packFetchPdfBytes_(url);
        const src = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
        const pages = await merged.copyPages(src, src.getPageIndices());
        pages.forEach(p => merged.addPage(p));
        done++;
      } catch (err) {
        failed.push(r.order_number + ': ' + err.message);
      }
    }
    if (!done) {
      showPackBanner_('AirPrint merge failed — see alert', '#ff5252');
      alert('Could not merge any PDFs:\n\n' + failed.join('\n'));
      return;
    }
    const mergedBytes = await merged.save();
    const blob = new Blob([mergedBytes], { type: 'application/pdf' });
    const blobUrl = URL.createObjectURL(blob);
    const w = window.open(blobUrl, '_blank');
    if (!w) { showPackBanner_('Allow popups, then retry', '#ff9800'); return; }
    setTimeout(() => URL.revokeObjectURL(blobUrl), 5 * 60 * 1000);
    showPackBanner_(done + ' merged · Share → Print → AirPrint', '#00e676');
  } catch (err) {
    showPackBanner_('AirPrint fallback error: ' + err.message, '#ff5252');
  }
}

async function bulkRemoveFromList() {
  if (!_packBulkSelection.size) {
    showToast('Select at least one order first');
    return;
  }
  const orderNumbers = Array.from(_packBulkSelection);
  if (!confirm('Remove ' + orderNumbers.length + ' order' + (orderNumbers.length === 1 ? '' : 's') + ' from today\'s list?\n\n(Status unchanged — they can be re-added with + Add Order #.)')) return;
  const pin = promptManagerPin_('remove ' + orderNumbers.length + ' from list');
  if (!pin) return;
  try {
    const res = await groundApi('removeFromTodaysPackList', {
      orderNumbers: orderNumbers,
      manager_pin: pin,
    });
    if (!res || !res.ok) {
      if (res && /pin/i.test(res.error || '')) clearManagerPin_();
      showToast(((res && res.error) || 'Remove failed'));
      return;
    }
    _packBulkSelection.clear();
    await refreshPackQueue();
    showPackBanner_(res.removed + ' order' + (res.removed === 1 ? '' : 's') + ' removed from list 🗑', '#42a5f5');
  } catch (err) {
    showToast('Remove error: ' + err.message);
  }
}

async function resetTodaysPackList() {
  const inflight = _packQueueCache.filter(r => {
    const s = String(r.status || '');
    return s === 'pending' || s === 'in_progress' || s === 'ready_for_check' || s === 'checking';
  }).length;
  if (inflight === 0) {
    showToast('List is already empty');
    return;
  }
  if (!confirm('Reset the entire pack list?\n\nAll ' + inflight + ' in-flight order' + (inflight === 1 ? '' : 's') + ' will be removed from the list. Status is unchanged — they can be re-added.\n\nPacked orders awaiting ship are NOT affected.')) return;
  const pin = promptManagerPin_('reset entire list');
  if (!pin) return;
  try {
    const res = await groundApi('clearTodaysPackList', { manager_pin: pin });
    if (!res || !res.ok) {
      if (res && /pin/i.test(res.error || '')) clearManagerPin_();
      showToast(((res && res.error) || 'Reset failed'));
      return;
    }
    _packBulkSelection.clear();
    await refreshPackQueue();
    showPackBanner_('List reset — ' + res.cleared + ' order' + (res.cleared === 1 ? '' : 's') + ' cleared ↺', '#42a5f5');
  } catch (err) {
    showToast('Reset error: ' + err.message);
  }
}

async function addOrderByNumberPrompt() {
  const input = prompt('Order number to add to today\'s list?\n\n(If the order isn\'t in PackingQueue yet, the orchestrator will look it up in the MBD:FL SHIPMENTS calendar and bootstrap a row.)');
  if (input == null) return;
  const orderNumber = String(input).trim().replace(/^#/, '');
  if (!orderNumber || !/^\d+$/.test(orderNumber)) { showToast('Enter a numeric order number'); return; }
  const pin = promptManagerPin_('add order ' + orderNumber);
  if (!pin) return;
  showPackBanner_('Adding order ' + orderNumber + '…', '#42a5f5');
  try {
    const res = await groundApi('addOrderByNumber', { orderNumber: orderNumber, manager_pin: pin });
    if (!res || !res.ok) {
      if (res && /pin/i.test(res.error || '')) clearManagerPin_();
      showPackBanner_((res && res.error) || 'Add failed', '#ff5252');
      return;
    }
    await refreshPackQueue();
    if (res.source === 'existing_row') {
      showPackBanner_('Order ' + orderNumber + ' added to list ✓', '#00e676');
    } else if (res.source === 'calendar') {
      const note = res.pickListUrl
        ? 'Bootstrapped from calendar. Open it to auto-parse the pick list and pull SKUs.'
        : 'Bootstrapped from calendar but no pick-list URL found in the event. You may need to upload the PDF manually.';
      showPackBanner_('Order ' + orderNumber + ' added (from calendar) — ' + note, '#00e676');
    } else {
      showPackBanner_('Order ' + orderNumber + ' added', '#00e676');
    }
  } catch (err) {
    showPackBanner_('Add error: ' + err.message, '#ff5252');
  }
}

async function batchAddOrdersPrompt() {
  const input = prompt('Paste order numbers to add to today\'s list.\n\nSeparate with commas, spaces, or new lines.\n\n(Rows not yet in PackingQueue will be bootstrapped from the MBD:FL SHIPMENTS calendar. One PIN entry covers the whole batch.)');
  if (input == null) return;
  const orderNumbers = String(input)
    .split(/[\s,;]+/)
    .map(s => s.trim().replace(/^#/, ''))
    .filter(s => s.length && /^\d+$/.test(s));
  if (!orderNumbers.length) { showToast('No numeric order numbers found'); return; }
  // De-dupe while preserving order.
  const seen = new Set();
  const deduped = orderNumbers.filter(n => { if (seen.has(n)) return false; seen.add(n); return true; });
  if (!confirm('Add ' + deduped.length + ' order' + (deduped.length === 1 ? '' : 's') + ' to today\'s list?\n\n' + deduped.join(', '))) return;
  const pin = promptManagerPin_('batch add ' + deduped.length + ' orders');
  if (!pin) return;
  showPackBanner_('Adding ' + deduped.length + ' order' + (deduped.length === 1 ? '' : 's') + '…', '#42a5f5');
  try {
    const res = await groundApi('addOrdersByNumber', { orderNumbers: deduped, manager_pin: pin });
    if (!res || !res.ok) {
      if (res && /pin/i.test(res.error || '')) clearManagerPin_();
      showPackBanner_((res && res.error) || 'Batch add failed', '#ff5252');
      return;
    }
    await refreshPackQueue();
    if (res.failed === 0) {
      showPackBanner_('+ ' + res.added + ' added to list ✓', '#00e676');
    } else {
      const fails = (res.results || []).filter(r => !r.ok).map(r => r.orderNumber + ' (' + r.error + ')').join('; ');
      showPackBanner_(res.added + ' added · ' + res.failed + ' failed: ' + fails, '#ff9800');
    }
  } catch (err) {
    showPackBanner_('Batch add error: ' + err.message, '#ff5252');
  }
}

async function addToTodaysListPrompt() {
  const inflightNow = _packQueueCache.filter(r => {
    const s = String(r.status || '');
    return s === 'pending' || s === 'in_progress' || s === 'ready_for_check' || s === 'checking';
  }).length;
  const suggested = Math.max(1, 12 - inflightNow);
  const input = prompt('How many orders to add to today\'s list?', String(suggested));
  if (input == null) return;
  const count = parseInt(input, 10);
  if (!count || count < 1) { showToast('Enter a positive number'); return; }

  const pin = promptManagerPin_('add to list');
  if (!pin) return;

  try {
    const res = await groundApi('addToTodaysPackList', { count: count, manager_pin: pin });
    if (!res || !res.ok) {
      if (res && /pin/i.test(res.error || '')) clearManagerPin_();
      showToast((res && res.error) || 'Add failed');
      return;
    }
    showPackBanner_('+ ' + res.added + ' added · ' + res.totalActive + ' on today\'s list', '#42a5f5');
    await refreshPackQueue();
  } catch (err) {
    showToast('Add error: ' + err.message);
  }
}

function togglePackManagerMode() {
  _packManagerMode = !_packManagerMode;
  _packBulkSelection.clear();
  const btn = document.getElementById('packManagerModeBtn');
  const bar = document.getElementById('packBulkBar');
  if (btn) btn.classList.toggle('go', _packManagerMode);
  if (bar) bar.style.display = _packManagerMode ? 'flex' : 'none';
  updatePackBulkBar_();
  paintPackQueue_(_packQueueCache, false);
}

function togglePackBulkSelect(orderNumber, checked) {
  if (checked) _packBulkSelection.add(String(orderNumber));
  else _packBulkSelection.delete(String(orderNumber));
  updatePackBulkBar_();
}

function updatePackBulkBar_() {
  const countEl = document.getElementById('packBulkCount');
  if (countEl) {
    const n = _packBulkSelection.size;
    countEl.textContent = n + ' selected';
  }
}

async function bulkPackAction(target) {
  if (!_packBulkSelection.size) {
    showToast('Select at least one order first');
    return;
  }
  const orderNumbers = Array.from(_packBulkSelection);
  const targetLabel = target === 'packed' ? 'Mark Packed' : 'Mark Shipped';
  const pin = promptManagerPin_(targetLabel + ' ' + orderNumbers.length
    + ' order' + (orderNumbers.length === 1 ? '' : 's'));
  if (!pin) return;

  const action = target === 'packed' ? 'markPackJobComplete' : 'markPackJobShipped';
  let ok = 0, failed = [];
  let pinInvalid = false;
  for (const orderNumber of orderNumbers) {
    try {
      const res = await groundApi(action, {
        orderNumber: orderNumber,
        manager_pin: pin,
        deviceId: getPackDeviceId_(),
        packerName: localStorage.getItem('mbd_ground_packer') || '',
      });
      if (res && res.ok) ok++;
      else {
        if (res && /pin/i.test(res.error || '')) pinInvalid = true;
        failed.push(orderNumber + ': ' + ((res && res.error) || 'unknown'));
      }
    } catch (err) {
      failed.push(orderNumber + ': ' + err.message);
    }
  }
  if (pinInvalid) clearManagerPin_();
  _packBulkSelection.clear();
  await refreshPackQueue();

  // Highly visible feedback so the manager can see the result without
  // staring at the toast — banner persists for 6 seconds.
  if (ok > 0 && failed.length === 0) {
    const verb = target === 'packed' ? '✓ packed' : '📦 shipped';
    showPackBanner_(ok + ' order' + (ok === 1 ? '' : 's') + ' ' + verb, '#00e676');
  } else if (ok > 0 && failed.length > 0) {
    showPackBanner_(ok + ' ok · ' + failed.length + ' failed — see alert', '#ff9800');
    alert('Bulk ' + targetLabel + ':\n' + ok + ' succeeded, ' + failed.length + ' failed.\n\n' + failed.join('\n'));
  } else {
    showPackBanner_('Bulk ' + targetLabel + ' failed', '#ff5252');
    alert('Bulk ' + targetLabel + ' failed:\n\n' + failed.join('\n'));
  }
}

async function confirmMarkPackJobShipped(orderNumber) {
  const pin = promptManagerPin_('mark ' + orderNumber + ' shipped');
  if (!pin) return;
  try {
    const res = await groundApi('markPackJobShipped', { orderNumber: orderNumber, manager_pin: pin });
    if (!res || !res.ok) {
      if (res && /pin/i.test(res.error || '')) clearManagerPin_();
      showToast(((res && res.error) || 'Mark shipped failed'));
      return;
    }
    showPackBanner_('Order ' + orderNumber + ' shipped 📦', '#00e676');
    await refreshPackQueue();
  } catch (err) {
    showToast('Mark shipped error: ' + err.message);
  }
}

async function resetPackScansForOrder(orderNumber) {
  if (!confirm('Reset all scan counts for order ' + orderNumber + '? (Photos and claim are preserved.)')) return;
  try {
    const res = await groundApi('resetPackScans', {
      orderNumber: orderNumber,
      deviceId: getPackDeviceId_(),
    });
    if (!res || !res.ok) {
      showToast('Reset failed: ' + ((res && res.error) || 'unknown'));
      return;
    }
    const cached = _packQueueCache.find(r => String(r.order_number) === String(orderNumber));
    if (cached) cached.scanned_json = '';
    delete _packScanState[orderNumber];
    if (cached) getPackScanState_(cached.order_number, cached.sku_lines_json, '');
    renderPackSkuList_(orderNumber);
    showToast('Scans reset');
  } catch (err) {
    showToast('Reset error: ' + err.message);
  }
}

// Wire Enter-key in the scan input (cordless barcode scanners terminate with \n).
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const ae = document.activeElement;
  if (!ae || ae.id !== 'packScanInput') return;
  e.preventDefault();
  handlePackScanSubmit();
});

// ── PDF / CSV parse (ported from fulfillment/index.html with the QTY-
//    column-governs rule kept intact) ─────────────────────────────

function packExtractDriveFileId_(raw) {
  let url = String(raw || '').trim();
  if (url.includes('google.com/url')) {
    const m = url.match(/[?&]q=([^&]+)/);
    if (m) url = decodeURIComponent(m[1]);
  }
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]{20,})/,
    /[?&]id=([a-zA-Z0-9_-]{20,})/,
    /\/d\/([a-zA-Z0-9_-]{20,})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

function packParsePdfText_(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let orderNum = null, shipDate = null, shipFrom = null, color = null;

  for (const line of lines) {
    let m;
    if ((m = line.match(/ORDER INFO:\s*(\d+)/i))) orderNum = m[1];
    if ((m = line.match(/SHIP-FROM:\s*(\S+)/i))) shipFrom = m[1];
    if ((m = line.match(/COLOR:\s*(.+)/i))) color = m[1].trim();
    if (/^\d{2}\/\d{2}\/\d{2}$/.test(line)) shipDate = line;
  }

  const items = [];
  let inItems = false;
  let pending = null;

  for (const line of lines) {
    if (/QTY\s+DESCRIPTION/i.test(line)) { inItems = true; continue; }
    if (/Packed By:/i.test(line) || /^__Palletized/i.test(line)) break;
    if (!inItems) continue;

    // QTY column governs: leading digits = quantity, rest = description.
    // "LB-4 HINGE PACK" with leading "1 LB-4 ..." means qty=1, not 4.
    const itemMatch = line.match(/^(\d+)\s+(.+)$/);
    if (itemMatch) {
      if (pending) items.push(pending);
      const qty = parseInt(itemMatch[1], 10);
      const desc = itemMatch[2].trim();
      const { sku, name } = packExtractSku_(desc);
      pending = { qty: qty, sku: sku, name: desc, scanned: 0 };
    } else if (pending) {
      pending.name += ' ' + line;
      const partMatch = line.match(/(\d{3}\.\d{2}\.\d{3})/);
      if (partMatch && pending.sku === pending.name.split(' ')[0]) {
        pending.sku = partMatch[1];
      }
    }
  }
  if (pending) items.push(pending);

  return { orderNum, shipDate, shipFrom, color, items };
}

function packExtractSku_(desc) {
  const tokens = desc.split(/\s+/);
  let i = 0;
  while (i < tokens.length && PACK_SIZE_PREFIXES.has(tokens[i].toUpperCase())) i++;
  if (i >= tokens.length) return { sku: tokens[0] || desc, name: desc };
  let sku = tokens[i].replace(/[,;]$/, '');
  let name = desc.replace(/^\S+\s*[-–]\s*/, '').trim() || desc;
  const partNum = desc.match(/^(?:[A-Z\s]+\s)?(\d{3}\.\d{2}\.\d{3})\s*[-–]?\s*(.*)/);
  if (partNum) { sku = partNum[1]; name = partNum[2] || partNum[1]; }
  return { sku: sku, name: name };
}

async function packParsePdfBuffer_(arrayBuffer) {
  if (typeof pdfjsLib === 'undefined') throw new Error('PDF.js failed to load — check your network');
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  // Collect all text items + URL annotations across all pages. The
  // instructions PDF link is buried as an annotation behind a SKU like
  // "INST-QL8F-V2" — pdfjs surfaces it via page.getAnnotations().
  let items = [];
  let urlAnnotations = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    content.items.forEach(it => {
      items.push({ text: String(it.str || ''), x: it.transform[4], y: it.transform[5] });
    });
    try {
      const anns = await page.getAnnotations();
      anns.forEach(a => {
        if (!a || a.subtype !== 'Link') return;
        // pdfjs exposes external link URLs under several fields depending
        // on how the PDF encoded the link. Check all of them.
        const url = a.url || a.unsafeUrl || (typeof a.dest === 'string' ? a.dest : '') || '';
        if (url) urlAnnotations.push({ url: url, raw: a });
      });
    } catch(e) { /* annotations optional */ }
  }

  // The pick-list table has an MBD NOTE column (right-most) full of
  // human notes like "8 hinge!" that look like qty+desc to a line-based
  // parser and corrupt rows downstream. Detect that column's left edge
  // from the header text and filter every item at or to the right of
  // it before line reconstruction. Header text in real PDFs splits as
  // separate "MBD" and "NOTE" items — match either.
  const mbdLeftX =
    ((items.find(it => /^MBD\s*NOTE$/i.test(it.text.trim())) || {}).x) ||
    ((items.find(it => /^MBD$/i.test(it.text.trim())) || {}).x) ||
    ((items.find(it => /^NOTE$/i.test(it.text.trim())) || {}).x) ||
    null;
  if (mbdLeftX != null) {
    items = items.filter(it => it.x < mbdLeftX - 5);
  }

  // Cluster items into rows by y-coordinate with a small tolerance.
  // PDF.js can hand back items on the same visible row with sub-pixel
  // y-offsets (one cell at y=410.2, another at y=409.8) — Math.round
  // bucketing splits those into phantom rows and the existing line-based
  // parser then misreads them. Tolerance of ~3pt collapses real rows
  // while still separating distinct table rows (~14pt apart in practice).
  items.sort((a, b) => b.y - a.y);
  const rows = [];
  const Y_TOL = 3;
  for (const it of items) {
    const lastRow = rows[rows.length - 1];
    if (lastRow && Math.abs(lastRow[0].y - it.y) <= Y_TOL) {
      lastRow.push(it);
    } else {
      rows.push([it]);
    }
  }

  const lines = rows.map(row =>
    row.sort((a, b) => a.x - b.x).map(it => it.text).join(' ').replace(/\s+/g, ' ').trim()
  );
  const parsed = packParsePdfText_(lines.join('\n'));

  // Pick the first Drive (or Docs) URL as the instructions link. The
  // pick-list PDFs embed exactly one INST-* hyperlink per order; if there
  // are multiple, the first one wins. Match drive.google.com OR
  // docs.google.com OR a bare file id pattern — some PDFs encode just
  // the file id as the destination instead of a full URL.
  const driveAnn = urlAnnotations.find(a => /drive\.google\.com|docs\.google\.com|drive\.usercontent\.google\.com/i.test(a.url));
  let instructionsPdfUrl = driveAnn ? driveAnn.url : '';
  if (!instructionsPdfUrl && urlAnnotations.length) {
    // If we found URLs but none Google-shaped, take the first http(s)
    // URL — better to print something than nothing.
    const httpAnn = urlAnnotations.find(a => /^https?:\/\//i.test(a.url));
    if (httpAnn) instructionsPdfUrl = httpAnn.url;
  }
  parsed.instructionsPdfUrl = instructionsPdfUrl;
  parsed._debugAnnotations = urlAnnotations.map(a => a.url); // exposed for debugPackPdfAnnotations
  return parsed;
}

// Editor-runnable debug helper: parse one order's pick-list PDF and
// log every annotation URL we find, so we can see what's actually in
// there when the instructions extraction fails. Invoke from the iPad
// console: `await debugPackPdfAnnotations('31851')`.
async function debugPackPdfAnnotations(orderNumber) {
  const row = _packQueueCache.find(r => String(r.order_number) === String(orderNumber));
  if (!row) { console.log('Order not in cache — open it first or refresh the queue'); return; }
  if (!row.pick_list_pdf_url) { console.log('Order has no pick_list_pdf_url'); return; }
  console.log('=== debugPackPdfAnnotations ' + orderNumber + ' ===');
  console.log('  pick_list_pdf_url:', row.pick_list_pdf_url);
  try {
    const res = await groundApi('fetchPackPickListPdf', { driveUrl: row.pick_list_pdf_url });
    if (!res || !res.ok || !res.base64) { console.log('  fetch failed:', res); return; }
    const raw = atob(res.base64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const parsed = await packParsePdfBuffer_(bytes.buffer);
    console.log('  annotation URLs found (' + (parsed._debugAnnotations || []).length + '):');
    (parsed._debugAnnotations || []).forEach((u, i) => console.log('    [' + i + '] ' + u));
    console.log('  picked instructionsPdfUrl:', parsed.instructionsPdfUrl || '(none)');
    console.log('  SKU lines parsed:');
    parsed.items.forEach(it => console.log('    ' + it.qty + ' x ' + it.sku + (it.name && it.name !== it.sku ? ' — ' + it.name : '')));
  } catch (err) {
    console.log('  ERROR:', err.message);
  }
}

async function loadPackPdfFromUrl(url) {
  const statusEl = document.getElementById('packLoadStatus');
  const fileId = packExtractDriveFileId_(url);
  if (!fileId) {
    if (statusEl) statusEl.textContent = 'Not a Drive URL — can\'t extract a file ID.';
    return;
  }
  if (statusEl) statusEl.textContent = 'Fetching PDF via orchestrator…';

  // Primary: route through the orchestrator. Pick-list PDFs carry
  // customer PII so they're never publicly shared — the iPad can't
  // reach them anonymously, but the orchestrator has the script
  // owner's Drive auth.
  let buf = null, lastErr = '';
  try {
    const res = await groundApi('fetchPackPickListPdf', { fileId: fileId });
    if (res && res.ok && res.base64) {
      const raw = atob(res.base64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const header = bytes.slice(0, 4);
      const isPDF = header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46;
      if (!isPDF) throw new Error('Orchestrator returned non-PDF bytes');
      buf = bytes.buffer;
    } else if (res && res.error) {
      lastErr = 'orchestrator: ' + res.error;
    } else {
      lastErr = 'orchestrator returned no data';
    }
  } catch (e) {
    lastErr = 'orchestrator: ' + e.message;
  }

  // Fallback: CORS proxy chain for genuinely public Drive links
  // (e.g., a manually pasted URL where the file is shared with
  // anyone-with-link). Skipped when the primary path succeeded.
  if (!buf) {
    const driveUrl = 'https://drive.google.com/uc?export=download&id=' + fileId + '&confirm=t';
    for (const makeProxy of PACK_PDF_CORS_PROXIES) {
      try {
        const resp = await fetch(makeProxy(driveUrl));
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const bytes = await resp.arrayBuffer();
        const header = new Uint8Array(bytes, 0, 4);
        const isPDF = header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46;
        if (!isPDF) throw new Error('Response is not a PDF');
        buf = bytes;
        break;
      } catch (e) {
        lastErr = 'proxy: ' + e.message;
      }
    }
  }

  if (!buf) {
    if (statusEl) statusEl.textContent = 'PDF fetch failed (' + lastErr + '). Try Upload PDF/CSV.';
    return;
  }
  try {
    const parsed = await packParsePdfBuffer_(buf);
    applyPackParsedToActiveOrder_(parsed, 'drive');
  } catch (e) {
    if (statusEl) statusEl.textContent = 'Parse failed: ' + e.message;
  }
}

async function onPackPdfFileSelected(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = '';
  if (!file) return;
  const statusEl = document.getElementById('packLoadStatus');
  if (statusEl) statusEl.textContent = 'Parsing ' + file.name + '…';

  try {
    const buf = await file.arrayBuffer();
    const nameLow = file.name.toLowerCase();
    if (nameLow.endsWith('.pdf')) {
      const parsed = await packParsePdfBuffer_(buf);
      applyPackParsedToActiveOrder_(parsed, 'upload-pdf');
    } else if (nameLow.endsWith('.xlsx') || nameLow.endsWith('.xls') || nameLow.endsWith('.csv')) {
      const items = packParseSpreadsheet_(buf);
      if (!items.length) throw new Error('No items found — expected columns including SKU and QTY');
      applyPackParsedToActiveOrder_({ orderNum: null, items: items }, 'upload-sheet');
    } else {
      throw new Error('Unsupported file type — use PDF, XLSX, or CSV');
    }
  } catch (e) {
    if (statusEl) statusEl.textContent = 'Parse failed: ' + e.message;
  }
}

function packParseSpreadsheet_(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const out = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (rows.length < 2) continue;
    const hdr = rows[0].map(c => String(c).toLowerCase());
    const sc = hdr.findIndex(h => h.includes('sku') || h.includes('item'));
    const nc = hdr.findIndex(h => h.includes('name') || h.includes('product') || h.includes('title') || h.includes('description'));
    const qc = hdr.findIndex(h => h.includes('qty') || h.includes('quantity'));
    if (sc < 0 || qc < 0) continue;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const sku = String(r[sc]).trim();
      const qty = parseInt(r[qc], 10) || 0;
      if (!sku || !qty) continue;
      const name = nc >= 0 ? String(r[nc]).trim() : sku;
      out.push({ sku: sku, qty: qty, name: name, scanned: 0 });
    }
  }
  return out;
}

async function applyPackParsedToActiveOrder_(parsed, source) {
  const statusEl = document.getElementById('packLoadStatus');
  if (!_packDetailOrderNumber) {
    if (statusEl) statusEl.textContent = 'No order selected.';
    return;
  }
  if (parsed.orderNum && String(parsed.orderNum) !== String(_packDetailOrderNumber)) {
    if (!confirm('Parsed order # is ' + parsed.orderNum + ' but the open order is ' + _packDetailOrderNumber + '. Replace SKU list anyway?')) {
      if (statusEl) statusEl.textContent = 'Parse discarded — order mismatch.';
      return;
    }
  }
  if (!parsed.items || !parsed.items.length) {
    if (statusEl) statusEl.textContent = 'Parsed 0 line items — check the file format.';
    return;
  }

  // Optimistic local render so the packer sees the new list immediately,
  // then persist server-side so scan resolution lines up.
  setPackScanState_(_packDetailOrderNumber, parsed.items);
  renderPackSkuList_(_packDetailOrderNumber);
  if (statusEl) statusEl.textContent = 'Loaded ' + parsed.items.length + ' line items from ' + source + ' — saving to sheet…';

  try {
    const skuLines = parsed.items.map(it => ({ sku: it.sku, qty: it.qty, name: it.name || '' }));
    const res = await groundApi('updatePackJobSkus', {
      orderNumber: _packDetailOrderNumber,
      skuLines: skuLines,
      source: source,
      instructionsPdfUrl: parsed.instructionsPdfUrl || '',
    });
    if (!res || !res.ok) {
      if (statusEl) statusEl.textContent = 'Loaded locally but server save failed: ' + ((res && res.error) || 'unknown')
        + ' — scans may be rejected until you retry the re-parse.';
      return;
    }
    // Sync cache so subsequent scans / re-opens use the new canonical list.
    const cached = _packQueueCache.find(r => String(r.order_number) === String(_packDetailOrderNumber));
    if (cached) {
      cached.sku_lines_json = res.sku_lines_json;
      cached.scanned_json = ''; // server cleared on update
      if (res.instructions_pdf_url) cached.instructions_pdf_url = res.instructions_pdf_url;
    }
    // Refresh scan state from the now-canonical list so the rendered counts
    // reflect what the server has.
    delete _packScanState[_packDetailOrderNumber];
    if (cached) getPackScanState_(cached.order_number, cached.sku_lines_json, '');
    renderPackSkuList_(_packDetailOrderNumber);
    if (statusEl) statusEl.textContent = 'Loaded ' + parsed.items.length + ' line items from ' + source + ' — saved to sheet (scans reset)';
  } catch (err) {
    if (statusEl) statusEl.textContent = 'Loaded locally but server save errored: ' + err.message;
  }
}

async function confirmMarkPackJobComplete(orderNumber) {
  const row = _packQueueCache.find(r => String(r.order_number) === String(orderNumber));
  let photoCount = 0;
  try { const a = JSON.parse((row && row.photo_urls_json) || '[]'); photoCount = Array.isArray(a) ? a.length : 0; } catch(e) {}
  const warn = photoCount === 0 ? '\n\nWARNING: No shipment photos attached.' : '\n\n' + photoCount + ' photo' + (photoCount===1?'':'s') + ' attached.';
  if (!confirm('Mark order ' + orderNumber + ' as completely packed?' + warn)) return;
  try {
    const res = await groundApi('markPackJobComplete', {
      orderNumber: orderNumber,
      deviceId: getPackDeviceId_(),
      packerName: localStorage.getItem('mbd_ground_packer') || '',
    });
    if (!res || !res.ok) {
      showToast('Mark packed failed: ' + ((res && res.error) || 'unknown'));
      return;
    }
    showToast('Order ' + orderNumber + ' marked packed ✓');
    closePackDetail();
    await refreshPackQueue();
  } catch (err) {
    showToast('Mark packed error: ' + err.message);
  }
}

function closePackDetail() {
  _packDetailOrderNumber = null;
  document.getElementById('packQueueDetail').style.display = 'none';
  document.getElementById('packQueueList').style.display = '';
}

async function claimPackOrder(orderNumber) {
  try {
    const data = await groundApi('claimPackJob', {
      orderNumber: orderNumber,
      deviceId: getPackDeviceId_(),
      packerName: localStorage.getItem('mbd_ground_packer') || '',
    });
    if (!data || !data.ok) {
      showToast('Could not claim: ' + ((data && data.error) || 'unknown'));
      return;
    }
    showToast('Claimed order ' + orderNumber);
    await refreshPackQueue();
    openPackDetail(orderNumber);
  } catch (err) {
    showToast('Claim error: ' + err.message);
  }
}

async function releasePackOrder(orderNumber) {
  try {
    const data = await groundApi('releasePackJob', {
      orderNumber: orderNumber,
      deviceId: getPackDeviceId_(),
    });
    if (!data || !data.ok) {
      showToast('Could not release: ' + ((data && data.error) || 'unknown'));
      return;
    }
    showToast('Released order ' + orderNumber);
    await refreshPackQueue();
    openPackDetail(orderNumber);
  } catch (err) {
    showToast('Release error: ' + err.message);
  }
}

// ──────────────────────────────────────────────────────────────────────
// PRE-PACK TAB — hardware-box prep, day before cabinet pack
// ──────────────────────────────────────────────────────────────────────

let _prePackQueueCache = [];
let _prePackDetailOrderNumber = null;
let _prePackHorizon = 'all';
const PRE_PACK_QUEUE_CACHE_KEY = 'mbd_pre_pack_queue_cache_v1';

function renderPrePackTab() {
  document.getElementById('prePackQueueDetail').style.display = 'none';
  document.getElementById('prePackQueueList').style.display = '';
  try {
    const cached = JSON.parse(localStorage.getItem(PRE_PACK_QUEUE_CACHE_KEY) || '[]');
    if (Array.isArray(cached) && cached.length) {
      _prePackQueueCache = cached;
      paintPrePackQueue_(cached, true);
    }
  } catch(e) {}
  refreshPrePackQueue();
}

function setPrePackHorizon(h) {
  _prePackHorizon = h;
  ['all', 'today', 'tomorrow', 'beyond'].forEach(k => {
    const btn = document.getElementById('prePackHorizon' + k.charAt(0).toUpperCase() + k.slice(1));
    if (btn) btn.classList.toggle('go', k === h);
  });
  // Clear immediately so the old horizon's results don't masquerade
  // as the new horizon's during the API round-trip.
  _prePackQueueCache = [];
  refreshPrePackQueue();
}

function renderPrePackLoadingState_(message) {
  const list = document.getElementById('prePackQueueList');
  if (!list) return;
  list.innerHTML = '<div style="padding:48px 24px;text-align:center;background:rgba(66,165,245,.06);border:1.5px dashed rgba(66,165,245,.35);border-radius:12px;color:#42a5f5;font-size:18px;font-weight:800;letter-spacing:.5px"><div style="font-size:36px;margin-bottom:12px;animation:mbdSpin 1s linear infinite;display:inline-block">⟳</div><div>' + (message || 'Loading…') + '</div></div>';
}

async function refreshPrePackQueue() {
  const statusEl = document.getElementById('prePackQueueStatus');
  statusEl.textContent = 'Loading…';
  renderPrePackLoadingState_('Loading ' + _prePackHorizon + ' queue…');
  // v9.99: paint Day Plan strip in parallel (fire-and-forget — server
  // cache means it's usually a no-op after the first tab visit).
  paintDayPlanInto_('prePackDayPlan');
  try {
    const res = await groundApi('listHardwarePackQueue', { horizon: _prePackHorizon });
    if (!res || !res.ok) {
      statusEl.textContent = 'Error: ' + ((res && res.error) || 'unknown');
      return;
    }
    _prePackQueueCache = res.rows || [];
    localStorage.setItem(PRE_PACK_QUEUE_CACHE_KEY, JSON.stringify(_prePackQueueCache));
    paintPrePackQueue_(_prePackQueueCache, false);
    const pending = _prePackQueueCache.filter(r => !r.hardware_packed_at).length;
    const done = _prePackQueueCache.filter(r => r.hardware_packed_at).length;
    // v10.205 Zoe/Evan persona — surface past-due pending count in the
    // status line. Past bucket is rendered first in the list (red
    // accent) but if Zoe glances at the status bar without scrolling
    // she has no signal that something's overdue. Computing client-side
    // (same logic as the bucket sort) avoids a server round-trip.
    const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);
    const pastDue = _prePackQueueCache.filter(r => {
      if (r.hardware_packed_at) return false;
      const iso = String(r.ship_date || '').slice(0, 10);
      if (!iso) return false;
      const d = new Date(iso + 'T00:00:00');
      return d < todayMidnight;
    }).length;
    statusEl.textContent = pending + ' to pre-pack'
      + (pastDue ? (' · 🔥 ' + pastDue + ' past due') : '')
      + (done ? (' · ' + done + ' done in last 48h') : '')
      + ' · today=' + res.today + ' · tomorrow=' + res.tomorrow;
    // Make past-due chip eye-catching in red on the status element so
    // it doesn't blend in with the rest of the line. textContent
    // doesn't carry inline color; switch to innerHTML when past>0.
    if (pastDue) {
      statusEl.innerHTML = pending + ' to pre-pack'
        + ' · <span style="color:#ff5252;font-weight:900">🔥 ' + pastDue + ' past due</span>'
        + (done ? (' · ' + done + ' done in last 48h') : '')
        + ' · today=' + res.today + ' · tomorrow=' + res.tomorrow;
    }
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message;
  }
}

function paintPrePackQueue_(rows, fromCache) {
  const list = document.getElementById('prePackQueueList');
  list.innerHTML = '';
  // v10.160 Sable S3 — same dimming pattern as paintPackQueue_.
  list.style.opacity = fromCache ? '0.78' : '';
  list.style.transition = 'opacity 200ms ease-out';
  if (!rows.length) {
    list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-dim);background:rgba(255,255,255,.03);border:1px dashed rgba(255,255,255,.15);border-radius:10px">No hardware to pre-pack in this horizon.<br><span style="font-size:12px">Switch to <strong>All</strong> or <strong>Tomorrow</strong> to see upcoming jobs.</span></div>';
    return;
  }
  // v9.80 Sable+Tav: group by ship-date bucket (Today / Tomorrow /
  // This Week / Later) so Zoe can anchor scanning by day, not just
  // scroll a flat list. Bucket headers use the same vocabulary as
  // the Tracking view.
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today.getTime() + 86400000);
  const weekOut = new Date(today.getTime() + 7 * 86400000);
  const bucketOf = (iso) => {
    if (!iso) return 'No Date';
    const d = new Date(String(iso).slice(0, 10) + 'T00:00:00');
    if (d < today) return 'Past';
    if (d < tomorrow) return 'Today';
    if (d < new Date(today.getTime() + 2 * 86400000)) return 'Tomorrow';
    if (d < weekOut) return 'This Week';
    return 'Later';
  };
  const BUCKET_ORDER = ['Past', 'Today', 'Tomorrow', 'This Week', 'Later', 'No Date'];
  const BUCKET_ACCENT = { Past: '#ff5252', Today: '#00e676', Tomorrow: '#FFB300', 'This Week': '#42a5f5', Later: '#9e9e9e', 'No Date': '#666' };
  const grouped = { Past: [], Today: [], Tomorrow: [], 'This Week': [], Later: [], 'No Date': [] };
  rows.forEach(r => grouped[bucketOf(r.ship_date)].push(r));

  BUCKET_ORDER.forEach(bucket => {
    if (!grouped[bucket].length) return;
    const hdr = document.createElement('div');
    const accent = BUCKET_ACCENT[bucket];
    hdr.style.cssText = 'position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:10px;margin:14px 0 6px;padding:8px 10px 8px 4px;background:var(--bg);border-bottom:1px solid ' + accent + '40;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)';
    hdr.innerHTML =
      '<span style="font-family:\'Barlow Condensed\',Arial,sans-serif;font-size:13px;font-weight:900;color:' + accent + ';letter-spacing:1.5px;text-transform:uppercase">' + bucket + '</span>'
      + '<span style="font-size:11px;color:var(--text-dim);font-weight:700">' + grouped[bucket].length + ' order' + (grouped[bucket].length === 1 ? '' : 's') + '</span>';
    list.appendChild(hdr);
    grouped[bucket].forEach(r => list.appendChild(renderPrePackCard_(r)));
  });

  if (fromCache) {
    const tag = document.createElement('div');
    tag.style.cssText = 'font-size:10px;color:var(--text-dim);text-align:center;margin-top:6px;opacity:.6';
    tag.textContent = '(cached — refreshing…)';
    list.appendChild(tag);
  }
}

function renderPrePackCard_(r) {
  const card = document.createElement('div');
  const hwReady = !!r.hardware_packed_at;
  const hwLines = Array.isArray(r.hardware_sku_lines) ? r.hardware_sku_lines : [];
  const accent = hwReady ? '#00e676' : '#ff9800';
  const bg = accent + '1a';
  const border = accent + '72';
  card.style.cssText = 'background:'+bg+';border:1px solid '+border+';border-radius:12px;padding:18px 18px;display:flex;align-items:center;gap:16px;transition:transform .1s ease;cursor:pointer';
  card.onclick = () => openPrePackDetail(r.order_number);

  const shipDate = r.ship_date || '—';
  const taskLine = r.task_line || (r.order_number + ' (no task line)');
  const hwSkuCount = hwLines.length;
  const hwTotalQty = hwLines.reduce((sum, l) => sum + (Number(l.qty) || 0), 0);

  let scannedTotal = 0;
  try {
    const arr = JSON.parse(r.hardware_scanned_json || '[]');
    if (Array.isArray(arr)) {
      const wantedSkus = new Set(hwLines.map(l => String(l.sku || '').trim()));
      arr.forEach(s => { if (wantedSkus.has(String(s.sku || '').trim())) scannedTotal += Number(s.scanned) || 0; });
    }
  } catch(e) {}

  const stateLabel = hwReady
    ? ('✓ HW READY · ' + esc(String(r.hardware_packed_by || '').slice(0, 14)))
    : (scannedTotal > 0 ? 'IN PROGRESS · ' + scannedTotal + '/' + hwTotalQty : 'PENDING');

  // v9.80 Sable: thin progress bar under the state chip — at-a-glance
  // "how close to done" without parsing 3/14 each card.
  const progressPct = (!hwReady && hwTotalQty > 0)
    ? Math.min(100, Math.round((scannedTotal / hwTotalQty) * 100))
    : (hwReady ? 100 : 0);
  const progressBar = (scannedTotal > 0 || hwReady)
    ? '<div style="margin-top:6px;height:3px;background:rgba(255,255,255,.06);border-radius:2px;overflow:hidden"><div style="height:100%;width:' + progressPct + '%;background:' + accent + ';transition:width .25s ease"></div></div>'
    : '';

  card.innerHTML = `
    <div style="flex:0 0 96px;text-align:center;border-right:1px solid rgba(255,255,255,.10);padding-right:16px">
      <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;color:var(--text-dim);text-transform:uppercase">Ship</div>
      <div style="font-family:'JetBrains Mono',monospace;font-size:26px;font-weight:900;color:var(--green-bright);margin-top:4px;line-height:1.05">${esc(shipDate.slice(5))}</div>
      <div style="font-size:12px;color:var(--text-dim);margin-top:3px">${esc(shipDate.slice(0,4))}</div>
    </div>
    <div style="flex:1;min-width:0">
      <div style="font-family:'Barlow Condensed',Arial,sans-serif;font-size:24px;font-weight:900;color:var(--text);text-transform:uppercase;line-height:1.2;word-break:break-word">${esc(taskLine)}</div>
      <div style="font-size:14px;color:var(--text);opacity:.85;margin-top:8px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;line-height:1.4">
        ${r.customer_name ? '<span>'+esc(r.customer_name)+'</span>' : ''}
        <span style="color:var(--text-dim)">· ${hwSkuCount} HW SKU${hwSkuCount===1?'':'s'} · ${hwTotalQty} pc${hwTotalQty===1?'':'s'}</span>
        <span style="margin-left:auto;padding:3px 10px;font-size:12px;font-weight:900;letter-spacing:1.2px;background:${accent}22;color:${accent};border:1px solid ${accent}55;border-radius:999px">${stateLabel}</span>
      </div>
      ${progressBar}
    </div>
    <div style="color:var(--text-dim);font-size:20px">›</div>
  `;
  return card;
}

function openPrePackDetail(orderNumber) {
  const row = _prePackQueueCache.find(r => String(r.order_number) === String(orderNumber));
  if (!row) { showToast('Order not in current queue — refresh'); return; }
  _prePackDetailOrderNumber = orderNumber;
  document.getElementById('prePackQueueList').style.display = 'none';
  const detail = document.getElementById('prePackQueueDetail');
  detail.style.display = '';
  paintPrePackDetail_(row);
  // Email-derived sku_lines_json typically only has top-level SKUs
  // (the cabinet, mattress, backs). HW pack SKUs (450.81.*, INST-*,
  // MAGNETS-*, etc.) only appear inside the pick-list PDF. If after
  // server-side filtering this order has zero HW lines AND we have a
  // pick-list PDF URL, fetch + parse it client-side and persist the
  // detailed line list back to PackingQueue so Pack and Pre-Pack
  // both see the full breakdown.
  autoLoadPrePackPdfIfThin_(row);
}

async function autoLoadPrePackPdfIfThin_(row) {
  if (!row) return;
  const hwLines = Array.isArray(row.hardware_sku_lines) ? row.hardware_sku_lines : [];
  if (hwLines.length > 0) return;
  const pdfUrl = String(row.pick_list_pdf_url || '').trim();
  if (!pdfUrl) {
    showPrePackBanner_('No HW SKUs on this order and no pick-list PDF URL — manual entry needed', '#ff9800');
    return;
  }
  showPrePackBanner_('No HW SKUs found in email body — fetching pick-list PDF…', '#42a5f5');
  try {
    const fileId = packExtractDriveFileId_(pdfUrl);
    if (!fileId) {
      showPrePackBanner_('Pick-list URL isn\'t a Drive file — manual entry needed', '#ff9800');
      return;
    }
    const fetchRes = await groundApi('fetchPackPickListPdf', { fileId: fileId });
    if (!fetchRes || !fetchRes.ok || !fetchRes.base64) {
      showPrePackBanner_('PDF fetch failed: ' + ((fetchRes && fetchRes.error) || 'unknown'), '#ff5252');
      return;
    }
    const raw = atob(fetchRes.base64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const parsed = await packParsePdfBuffer_(bytes.buffer);
    if (!parsed || !parsed.items || !parsed.items.length) {
      showPrePackBanner_('PDF parsed but no line items found — manual entry needed', '#ff9800');
      return;
    }
    showPrePackBanner_('Parsed ' + parsed.items.length + ' line items, saving…', '#42a5f5');
    const skuLines = parsed.items.map(it => ({ sku: it.sku, qty: it.qty, name: it.name || '' }));
    const updateRes = await groundApi('updatePackJobSkus', {
      orderNumber: row.order_number,
      skuLines: skuLines,
      source: 'prepack-auto-pdf',
      instructionsPdfUrl: parsed.instructionsPdfUrl || '',
    });
    if (!updateRes || !updateRes.ok) {
      showPrePackBanner_('Parsed OK but server save failed: ' + ((updateRes && updateRes.error) || 'unknown'), '#ff5252');
      return;
    }
    // Re-fetch the queue so we get the freshly-filtered hardware_sku_lines.
    const fresh = await groundApi('listHardwarePackQueue', { horizon: _prePackHorizon });
    if (fresh && fresh.ok && Array.isArray(fresh.rows)) {
      _prePackQueueCache = fresh.rows;
      const updatedRow = _prePackQueueCache.find(r => String(r.order_number) === String(row.order_number));
      if (updatedRow && _prePackDetailOrderNumber === String(row.order_number)) {
        paintPrePackDetail_(updatedRow);
      }
    }
    const newHwCount = (fresh && fresh.rows || []).find(r => String(r.order_number) === String(row.order_number));
    const hwCount = newHwCount && Array.isArray(newHwCount.hardware_sku_lines) ? newHwCount.hardware_sku_lines.length : 0;
    showPrePackBanner_('✓ Loaded ' + parsed.items.length + ' lines · ' + hwCount + ' classified as HW', '#00e676');
  } catch (err) {
    showPrePackBanner_('Auto-load error: ' + err.message, '#ff5252');
  }
}

// v10.255 + v10.256 — Häfele part-number lead-with helpers for pre-pack rows.
// Picker can't ID an item from "overlay" alone — the Häfele# is what's
// printed on the bag (e.g. 329.17.552).
//
// v10.256 (Zac 2026-05-24 13:19 EDT) — server now supplies `l.hafele_part`
// via HardwareHafeleMap tab + inline HAFELE_SKU_MAP + embedded regex,
// so we prefer that when present. Client-side regex stays as a fallback
// for orders that pre-date the enrichment.
const _HAFELE_PART_RE_ = /([0-9]{3}\.[0-9]{2}\.[0-9]{3})/;
function _prePackDisplayTitle_(sku, name, serverHafele) {
  const sv = String(serverHafele || '').trim();
  if (sv) return sv;
  const both = String(sku || '') + ' ' + String(name || '');
  const m = both.match(_HAFELE_PART_RE_);
  return m ? m[1] : (String(sku || '').trim() || String(name || '').trim());
}
function _prePackDisplaySubtitle_(sku, name, lead) {
  const strip = (s) => String(s || '').replace(/\s*[(\[]?[0-9]{3}\.[0-9]{2}\.[0-9]{3}[)\]]?\s*/g, ' ').replace(/\s+/g, ' ').trim();
  if (lead && _HAFELE_PART_RE_.test(lead)) {
    const skuClean = strip(sku);
    const nameClean = strip(name);
    if (skuClean && nameClean && skuClean.toUpperCase() !== nameClean.toUpperCase()) return skuClean + ' · ' + nameClean;
    return skuClean || nameClean;
  }
  return String(name || '').trim();
}

function paintPrePackDetail_(row) {
  const detail = document.getElementById('prePackQueueDetail');
  const hwLines = Array.isArray(row.hardware_sku_lines) ? row.hardware_sku_lines : [];
  const scannedBySku = {};
  try {
    const arr = JSON.parse(row.hardware_scanned_json || '[]');
    if (Array.isArray(arr)) arr.forEach(s => { scannedBySku[String(s.sku || '').trim()] = Number(s.scanned) || 0; });
  } catch(e) {}

  const hwReady = !!row.hardware_packed_at;
  const allScanned = hwLines.length > 0 && hwLines.every(l => (scannedBySku[String(l.sku).trim()] || 0) >= (Number(l.qty) || 0));

  const skuRowsHtml = hwLines.map((l, idx) => {
    const sku = String(l.sku || '').trim();
    const qty = Number(l.qty) || 0;
    const scanned = scannedBySku[sku] || 0;
    const done = scanned >= qty;
    const accent = done ? '#00e676' : '#ff9800';
    // v10.255 — lead with Häfele part # (NNN.NN.NNN) when present in either sku or name.
    // v10.256 — server-supplied `l.hafele_part` wins when set (tab + inline map lookup);
    // client regex stays as fallback. Picker can't ID an item from "overlay" alone (Zac
    // 09:32 EDT bug report); the Häfele# is what's printed on the bag.
    const lead = _prePackDisplayTitle_(sku, l.name, l.hafele_part);
    const sub = _prePackDisplaySubtitle_(sku, l.name, lead);
    return `<div style="display:flex;align-items:center;gap:12px;padding:14px;background:${accent}14;border:1.5px solid ${accent}55;border-radius:10px">
      <div style="flex:0 0 70px;text-align:center;cursor:pointer;padding:4px;border-radius:8px;background:rgba(255,255,255,.04)" onclick="promptPrePackCount('${esc(row.order_number)}','${esc(sku)}',${scanned},${qty})" title="Tap to set the count directly (e.g. 40 screws)">
        <div style="font-family:'JetBrains Mono',monospace;font-size:22px;font-weight:900;color:${accent}">${scanned}/${qty}</div>
        <div style="font-size:9px;color:var(--text-dim);letter-spacing:1px;margin-top:2px">${done?'DONE':'TAP TO SET'}</div>
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:900;color:var(--text);letter-spacing:.5px">${esc(lead)}</div>
        ${sub ? '<div style="font-size:12px;color:var(--text-dim);margin-top:2px">'+esc(sub)+'</div>' : ''}
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
        ${done ? '' : '<button onclick="bumpPrePackSku(\''+esc(row.order_number)+'\',\''+esc(sku)+'\','+(qty-scanned)+')" class="amp-btn" style="padding:6px 10px;font-size:13px;min-width:0;flex:0 0 auto;background:#00e676;color:#000" title="Mark this SKU fully scanned">✓</button>'}
      </div>
    </div>`;
  }).join('');

  const markReadyDisabled = hwReady || !allScanned;
  const markReadyLabel = hwReady ? '✓ HW READY' : (allScanned ? '✓ MARK HW READY + PRINT LABEL' : 'Scan all SKUs to enable');
  const markReadyColor = hwReady ? '#00e676' : (allScanned ? '#00e676' : '#9aa0a6');

  detail.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
      <button onclick="closePrePackDetail()" class="amp-btn" style="font-size:13px;padding:8px 14px">‹ Back</button>
      <div style="flex:1">
        <div style="font-family:'Barlow Condensed',Arial,sans-serif;font-size:24px;font-weight:900;color:var(--text);text-transform:uppercase;line-height:1.1">${esc(row.task_line || row.order_number)}</div>
        <div style="font-size:13px;color:var(--text-dim);margin-top:4px">${esc(row.customer_name || '')} · Ship ${esc(row.ship_date || '—')}</div>
      </div>
    </div>
    ${hwReady ? '<div style="padding:12px 14px;background:rgba(0,230,118,.10);border:1px solid rgba(0,230,118,.45);border-radius:10px;margin-bottom:14px;font-size:14px;color:#00e676;font-weight:700">✓ HW box already prepped by '+esc(String(row.hardware_packed_by || ''))+' at '+esc(String(row.hardware_packed_at || '').slice(0,16))+'</div>' : ''}
    <div style="margin-bottom:14px">
      <input type="search" id="prePackScanInput" placeholder="Scan or type HW SKU…" autocomplete="off" autocorrect="off" spellcheck="false" onkeydown="handlePrePackScanKey(event)" style="width:100%;padding:14px 16px;font-size:18px;font-family:'JetBrains Mono',monospace;background:#000;color:var(--green-bright);border:2px solid var(--border);border-radius:10px;outline:none">
    </div>
    <div id="prePackSkuList" style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px">${skuRowsHtml || '<div style="padding:20px;text-align:center;color:var(--text-dim)">No HW SKUs detected on this order. (If you expect HW, check the SKU list against the rulebook classifier.)</div>'}</div>
    ${hwReady ? '' : '<button onclick="confirmMarkAllHardwareScanned(\''+esc(row.order_number)+'\')" class="amp-btn" style="width:100%;padding:14px;font-size:14px;font-weight:900;background:linear-gradient(135deg,#FFB300,#FF9100);color:#1a1a1a;border:1.5px solid #FFB300;letter-spacing:.5px;margin-bottom:10px">👤 MARK ALL PACKED (MANAGER)</button>'}
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button onclick="confirmMarkHardwareReady('${esc(row.order_number)}')" ${markReadyDisabled?'disabled':''} class="amp-btn ${allScanned&&!hwReady?'go':''}" style="flex:1;min-width:200px;padding:14px;font-size:15px;font-weight:900;background:${markReadyColor};color:#000;opacity:${markReadyDisabled?'.55':'1'}">${markReadyLabel}</button>
      ${hwReady ? '<button onclick="printPrePackLabel(\''+esc(row.order_number)+'\')" class="amp-btn" style="padding:14px;font-size:14px">🖨 Reprint Label</button>' : ''}
      <button onclick="confirmResetHardwareScans('${esc(row.order_number)}')" class="amp-btn" style="padding:14px;font-size:14px">↺ Reset Scans</button>
    </div>
    ${row.pick_list_pdf_url ? '<a href="'+esc(row.pick_list_pdf_url)+'" target="_blank" rel="noopener" class="amp-btn" style="display:block;text-align:center;text-decoration:none;margin-top:10px;padding:12px;font-size:13px" title="Open the full pick list to cross-reference hardware">📄 Open Full Pick List PDF</a>' : ''}
  `;
  setTimeout(() => {
    const inp = document.getElementById('prePackScanInput');
    if (inp) inp.focus();
  }, 100);
}

function closePrePackDetail() {
  _prePackDetailOrderNumber = null;
  document.getElementById('prePackQueueDetail').style.display = 'none';
  document.getElementById('prePackQueueList').style.display = '';
  refreshPrePackQueue();
}

function handlePrePackScanKey(event) {
  if (event.key === 'Enter') {
    event.preventDefault();
    const inp = document.getElementById('prePackScanInput');
    const code = String(inp.value || '').trim();
    if (!code) return;
    inp.value = '';
    processPrePackScan_(code);
  }
}

async function processPrePackScan_(code) {
  const orderNumber = _prePackDetailOrderNumber;
  if (!orderNumber) return;
  try {
    const res = await groundApi('recordHardwarePackScan', {
      orderNumber: orderNumber,
      scannedSku: code,
      deviceId: getPackDeviceId_(),
    });
    if (!res || !res.ok) {
      const msg = (res && res.error) || 'Scan failed';
      // v10.114: mirror Ground's scan-reject pattern — haptic +
      // sound on top of the red banner so a busy packer never
      // mistakes a silent banner for a successful scan.
      try { if (typeof FB !== 'undefined' && FB.error) FB.error(); } catch (e) {}
      showPrePackBanner_(msg, '#ff5252');
      return;
    }
    // Refresh row + repaint.
    const fresh = await groundApi('listHardwarePackQueue', { horizon: _prePackHorizon });
    if (fresh && fresh.ok && Array.isArray(fresh.rows)) {
      _prePackQueueCache = fresh.rows;
      const row = _prePackQueueCache.find(r => String(r.order_number) === String(orderNumber));
      if (row) paintPrePackDetail_(row);
    }
    showPrePackBanner_('✓ ' + res.sku + ' · ' + res.scanned + '/' + res.qty, '#00e676');
  } catch (err) {
    try { if (typeof FB !== 'undefined' && FB.error) FB.error(); } catch (e) {}
    showPrePackBanner_('Scan error: ' + err.message, '#ff5252');
  }
}

// Tap-to-set count flow: opens a numeric keypad modal defaulted to qty
// so a packer with a fistful of N pieces can confirm with one tap (or
// override to a different count if they're short). Solves the
// "40 screws shouldn't require 40 scans" problem.
function promptPrePackCount(orderNumber, sku, currentScanned, qty) {
  const skuLabel = esc(sku);
  const target = Number(qty) || 0;
  // Start with the target as the default — most common case is "I got
  // all of them, just confirm." User can backspace to override.
  let entry = String(target);

  // Remove any prior open keypad
  const prior = document.getElementById('prePackKeypadOverlay');
  if (prior) prior.remove();

  const ov = document.createElement('div');
  ov.id = 'prePackKeypadOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:9999;display:flex;align-items:center;justify-content:center;padding:18px';
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };

  const panel = document.createElement('div');
  panel.style.cssText = 'background:#1a1a1a;color:#fff;border:1.5px solid rgba(255,255,255,.15);border-radius:14px;padding:18px 16px 14px;max-width:420px;width:100%;box-shadow:0 8px 40px rgba(0,0,0,.5);font-family:Helvetica,Arial,sans-serif';
  ov.appendChild(panel);

  function paint() {
    const n = parseInt(entry, 10);
    const safeN = Number.isFinite(n) ? n : 0;
    const diff = safeN - currentScanned;
    const diffLabel = diff === 0 ? '(no change)'
      : (diff > 0 ? '+' + diff + ' from current' : diff + ' from current');
    panel.innerHTML =
        '<div style="font-family:\'Barlow Condensed\',Arial,sans-serif;font-size:22px;font-weight:900;color:#FFD27A;letter-spacing:.5px;text-transform:uppercase;line-height:1.1;margin-bottom:4px">' + skuLabel + '</div>'
      + '<div style="font-size:12px;color:#9AAAC0;margin-bottom:14px">Current ' + currentScanned + ' · Target ' + target + ' · ' + diffLabel + '</div>'
      + '<div style="background:#000;color:var(--green-bright,#00E676);font-family:\'JetBrains Mono\',monospace;font-size:64px;font-weight:900;text-align:center;padding:14px;border:2px solid rgba(0,230,118,.3);border-radius:10px;margin-bottom:14px;letter-spacing:6px;text-shadow:0 0 18px rgba(0,230,118,.5)">'
        + (entry || '0')
      + '</div>'
      + '<div id="ppKpGrid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px">'
      + ['7','8','9','4','5','6','1','2','3'].map(d => keyBtn(d, d)).join('')
      + keyBtn('⌫', '__back__', '#3a2a1a;color:#FFD27A')
      + keyBtn('0', '0')
      + keyBtn('Clr', '__clear__', '#3a1a1a;color:#ff9090')
      + '</div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap">'
      +   '<button id="ppKpAll" style="flex:1;min-width:90px;padding:14px;background:linear-gradient(180deg,#FFB300,#FF9100);color:#000;border:none;border-radius:10px;font-size:15px;font-weight:900;letter-spacing:.5px;cursor:pointer">ALL · ' + target + '</button>'
      +   '<button id="ppKpCancel" style="flex:1;min-width:90px;padding:14px;background:#2a2a2a;color:#aaa;border:1px solid #444;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer">Cancel</button>'
      +   '<button id="ppKpSave" style="flex:1.4;min-width:120px;padding:14px;background:linear-gradient(180deg,#00C853,#1A5C1A);color:#fff;border:1.5px solid #00E676;border-radius:10px;font-size:16px;font-weight:900;cursor:pointer;letter-spacing:.5px">✓ Save</button>'
      + '</div>';

    document.getElementById('ppKpAll').onclick = () => { entry = String(target); paint(); };
    document.getElementById('ppKpCancel').onclick = () => ov.remove();
    document.getElementById('ppKpSave').onclick = async () => {
      const finalN = parseInt(entry || '0', 10);
      if (!Number.isFinite(finalN) || finalN < 0) { showToast('Enter a non-negative number'); return; }
      ov.remove();
      const delta = finalN - currentScanned;
      if (delta !== 0) await bumpPrePackSku(orderNumber, sku, delta);
    };
    panel.querySelectorAll('button[data-kp]').forEach(b => {
      b.onclick = () => {
        const v = b.getAttribute('data-kp');
        if (v === '__back__') { entry = entry.slice(0, -1); }
        else if (v === '__clear__') { entry = ''; }
        else {
          if (entry === '0') entry = v;
          else if (entry.length < 6) entry += v;
        }
        paint();
      };
    });
  }

  function keyBtn(label, val, extraStyle) {
    const base = 'padding:18px 0;background:#262626;color:#fff;border:1px solid #3a3a3a;border-radius:10px;font-family:\'JetBrains Mono\',monospace;font-size:24px;font-weight:900;cursor:pointer;letter-spacing:.5px';
    return '<button data-kp="' + val + '" style="' + base + (extraStyle ? ';background:' + extraStyle : '') + '">' + label + '</button>';
  }

  document.body.appendChild(ov);
  paint();
}

async function bumpPrePackSku(orderNumber, sku, delta) {
  try {
    const res = await groundApi('recordHardwarePackScan', {
      orderNumber: orderNumber,
      scannedSku: sku,
      manualAdjustment: true,
      delta: delta,
      deviceId: getPackDeviceId_(),
    });
    if (!res || !res.ok) {
      showPrePackBanner_((res && res.error) || 'Bump failed', '#ff5252');
      return;
    }
    const fresh = await groundApi('listHardwarePackQueue', { horizon: _prePackHorizon });
    if (fresh && fresh.ok && Array.isArray(fresh.rows)) {
      _prePackQueueCache = fresh.rows;
      const row = _prePackQueueCache.find(r => String(r.order_number) === String(orderNumber));
      if (row) paintPrePackDetail_(row);
    }
  } catch (err) {
    showPrePackBanner_('Bump error: ' + err.message, '#ff5252');
  }
}

async function confirmMarkHardwareReady(orderNumber) {
  if (!confirm('Mark hardware box ready for order ' + orderNumber + '?\n\nA customer-facing "OPEN ME FIRST" label will be opened for printing.')) return;
  try {
    const res = await groundApi('markHardwarePackReady', {
      orderNumber: orderNumber,
      packedBy: getPackDeviceId_(),
    });
    if (!res || !res.ok) {
      showPrePackBanner_((res && res.error) || 'Mark failed', '#ff5252');
      return;
    }
    showPrePackBanner_('✓ HW ready for ' + orderNumber, '#00e676');
    // Await the label print and only auto-close on success. If the
    // OPEN-ME-FIRST label fails (no printer / PrintNode / network),
    // keep the detail OPEN so Zoe sees the failure + the 🖨 Reprint
    // button — otherwise the view collapsed in 800ms and she'd walk
    // away with an unlabeled hardware box (silent failure).
    const printed = await printPrePackLabel(orderNumber);
    await refreshPrePackQueue();
    if (printed) {
      setTimeout(() => closePrePackDetail(), 1000);
    } else {
      showPrePackBanner_('⚠ HW marked ready, but the label did NOT print — tap 🖨 Reprint Label', '#ff5252');
    }
  } catch (err) {
    showPrePackBanner_('Mark error: ' + err.message, '#ff5252');
  }
}

// Manager-gated bulk-mark: sets scanned = qty for every HW SKU on
// the order in one call. Lets a manager fast-forward an order that
// was packed visually without scan-to-verify (catch-up, override,
// etc.). After this, Mark HW Ready will unlock and the label can
// print normally.
async function confirmMarkAllHardwareScanned(orderNumber) {
  if (!confirm('Mark ALL HW SKUs on order ' + orderNumber + ' as fully packed?\n\nBypasses scan-to-verify. Requires manager PIN.')) return;
  const pin = promptManagerPin_('mark all HW packed on ' + orderNumber);
  if (!pin) return;
  try {
    const res = await groundApi('markAllHardwareScanned', {
      orderNumber: orderNumber,
      manager_pin: pin,
    });
    if (!res || !res.ok) {
      if (res && /pin/i.test(res.error || '')) clearManagerPin_();
      showPrePackBanner_((res && res.error) || 'Mark-all failed', '#ff5252');
      return;
    }
    showPrePackBanner_('✓ Marked ' + res.marked + ' HW SKU' + (res.marked === 1 ? '' : 's') + ' (' + res.totalQty + ' total pcs) as packed', '#00e676');
    const fresh = await groundApi('listHardwarePackQueue', { horizon: _prePackHorizon });
    if (fresh && fresh.ok && Array.isArray(fresh.rows)) {
      _prePackQueueCache = fresh.rows;
      const row = _prePackQueueCache.find(r => String(r.order_number) === String(orderNumber));
      if (row) paintPrePackDetail_(row);
    }
  } catch (err) {
    showPrePackBanner_('Mark-all error: ' + err.message, '#ff5252');
  }
}

async function confirmResetHardwareScans(orderNumber) {
  if (!confirm('Reset all hardware scans for order ' + orderNumber + '?')) return;
  try {
    const res = await groundApi('resetHardwarePackScans', { orderNumber: orderNumber });
    if (!res || !res.ok) {
      showPrePackBanner_((res && res.error) || 'Reset failed', '#ff5252');
      return;
    }
    showPrePackBanner_('↺ HW scans cleared', '#42a5f5');
    const fresh = await groundApi('listHardwarePackQueue', { horizon: _prePackHorizon });
    if (fresh && fresh.ok && Array.isArray(fresh.rows)) {
      _prePackQueueCache = fresh.rows;
      const row = _prePackQueueCache.find(r => String(r.order_number) === String(orderNumber));
      if (row) paintPrePackDetail_(row);
    }
  } catch (err) {
    showPrePackBanner_('Reset error: ' + err.message, '#ff5252');
  }
}

function showPrePackBanner_(text, color) {
  const el = document.getElementById('prePackActionBanner');
  if (!el) return;
  el.style.cssText = 'display:block;padding:10px 14px;background:'+color+'1a;border:1px solid '+color+'72;border-radius:10px;color:'+color+';font-weight:700;margin-bottom:10px;font-size:13px';
  el.textContent = text;
  clearTimeout(showPrePackBanner_._t);
  showPrePackBanner_._t = setTimeout(() => { el.style.display = 'none'; }, 4000);
}

/**
 * Customer-facing HW box label. Opens a new window with a single-page
 * 8.5x11 (or 4x6) label saying "OPEN ME FIRST" + order info, and
 * auto-triggers window.print(). The pre-packer slaps it on the box.
 *
 * For now: prints whatever the iPad's default print target is (usually
 * an AirPrint-discovered office printer). v2 will route via PrintNode
 * so it's truly auto with no print sheet.
 */
// Bulk-print pick-list instructions for everything currently in the
// Pre-Pack view (whichever horizon is selected). Skips rows where
// hardware_packed_at is already set so we don't re-print yesterday's
// work. Mirrors the Pack-tab printTodaysInstructions pattern but uses
// _prePackQueueCache as the source so it respects horizon selection.
async function printPrePackInstructions() {
  const todo = (_prePackQueueCache || []).filter(r => !r.hardware_packed_at);
  if (!todo.length) {
    showToast('Nothing to print in this horizon (or everything is already HW-ready)');
    return;
  }
  if (!confirm('Print pick-list instructions for ' + todo.length + ' order' + (todo.length === 1 ? '' : 's') + ' to the Brother?')) return;

  const needsExtraction = todo.filter(r => !r.instructions_pdf_url && r.pick_list_pdf_url);
  if (needsExtraction.length && typeof ensurePackInstructionsUrl_ === 'function') {
    showPrePackBanner_('Extracting instructions from ' + needsExtraction.length + ' pick list' + (needsExtraction.length === 1 ? '' : 's') + '…', '#42a5f5');
    const CONCURRENCY = 3;
    let i = 0;
    while (i < needsExtraction.length) {
      const batch = needsExtraction.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(r => ensurePackInstructionsUrl_(r.order_number)));
      i += CONCURRENCY;
    }
  }

  const sorted = todo.slice().sort((a, b) => String(a.ship_date || '').localeCompare(String(b.ship_date || '')));
  showPrePackBanner_('Stamping + printing ' + sorted.length + ' packets…', '#42a5f5');
  let ok = 0, failed = [];
  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i];
    showPrePackBanner_('Printing ' + (i + 1) + '/' + sorted.length + ' (' + row.order_number + ')…', '#42a5f5');
    try {
      const res = (typeof stampAndPrintPackInstructions_ === 'function')
        ? await stampAndPrintPackInstructions_(row)
        : await groundApi('printPackInstructions', { orderNumber: row.order_number });
      if (res && res.ok) ok++;
      else failed.push(row.order_number + ': ' + ((res && res.error) || 'unknown'));
    } catch (err) {
      failed.push(row.order_number + ': ' + err.message);
    }
  }

  if (failed.length === 0) {
    showPrePackBanner_('✓ ' + ok + ' packet' + (ok === 1 ? '' : 's') + ' sent to Brother', '#00e676');
  } else {
    showPrePackBanner_(ok + ' sent · ' + failed.length + ' failed: ' + failed.join('; '), '#ff9800');
  }
}

// HW box label is now generated server-side as a B&W PDF and sent
// straight to the default PrintNode printer — no Safari new-tab,
// no print dialog, no color. The label says "OPEN ME FIRST" and
// gets slapped on the outside of the HW carton.
async function printPrePackLabel(orderNumber) {
  showPrePackBanner_('Printing HW box label for ' + orderNumber + '…', '#42a5f5');
  try {
    const res = await groundApi('printHwBoxLabel', { orderNumber: orderNumber });
    if (!res || !res.ok) {
      showPrePackBanner_('Label print failed: ' + ((res && res.error) || 'unknown'), '#ff5252');
      return false;
    }
    showPrePackBanner_('✓ Label sent to printer #' + res.printer_id + ' (job ' + res.job_id + ')', '#00e676');
    return true;
  } catch (err) {
    showPrePackBanner_('Label print error: ' + err.message, '#ff5252');
    return false;
  }
}


// ──────────────────────────────────────────────────────────────────────
// SCHEDULE TAB — shipping schedule, replaces MBD:FL SHIPMENTS GCal
// Phase 1: read-only, mobile-first scrollable date-grouped list.
// Today card auto-scrolls into view; past days dim; future days
// in regular accent. Carrier color comes from the rulebook carriers
// tab — to add a new carrier, just add a row in the sheet.
// ──────────────────────────────────────────────────────────────────────

let _scheduleCache = null;
let _scheduleShowWeekends = false;
let _scheduleWeekOffset = 0;
const SCHEDULE_CACHE_KEY = 'mbd_schedule_cache_v1';
const SCHEDULE_DESKTOP_BREAKPOINT_PX = 820;

// The stalled / awaiting / to-book panels are reachable from the
// Cabinets attention strip without ever opening the Schedule tab,
// so _scheduleCache can be null there (Zac: "5 stalled → schedule
// not loaded"). Resolve it from memory → localStorage → a live
// fetch so those panels work from anywhere.
async function _ensureScheduleCache_() {
  if (_scheduleCache && _scheduleCache.days) return _scheduleCache;
  try {
    const c = JSON.parse(localStorage.getItem(SCHEDULE_CACHE_KEY) || 'null');
    if (c && c.days) { _scheduleCache = c; return c; }
  } catch (e) {}
  try {
    const res = await groundApi('listScheduleByDateRange', {});
    if (res && res.ok && res.days) {
      _scheduleCache = res;
      try { localStorage.setItem(SCHEDULE_CACHE_KEY, JSON.stringify(res)); } catch (e) {}
      return res;
    }
  } catch (e) {}
  return null;
}

// v10.16 pass 8: "changed since you last looked" delta. Schedule is a
// monitoring surface checked many times a day with no client auto-
// refresh — every render is an intentional open or post-write. We
// snapshot each order's actionable state and flag NEW / UPD on the
// next intentional render so Kim/Seth don't have to re-scan the whole
// horizon to find what moved. Pure client-side, persisted across app
// reloads via localStorage; zero server/JS2 involvement.
const SCHEDULE_SEEN_KEY = 'mbd_sched_seen';
let _schedulePrevSnap = null;

function _scheduleSnap_(payload) {
  const m = {};
  (payload && payload.days || []).forEach(d => (d.orders || []).forEach(o => {
    const on = String(o.order_number || '');
    if (!on) return;
    // Cabinet: track the three bits that matter for action. Ground/
    // mattress have no booked/ready/stall semantics — presence only,
    // so they can flag NEW but never a spurious UPD.
    m[on] = o.source === 'cabinet'
      ? 'b' + (o.booked_at ? 1 : 0) + 'r' + (o.customer_ready ? 1 : 0) + 's' + (o.stalled ? 1 : 0)
      : '-';
  }));
  return m;
}

function _scheduleStampChanges_(payload) {
  const prev = _schedulePrevSnap;
  const hasPrev = prev && Object.keys(prev).length > 0;
  const cur = _scheduleSnap_(payload);
  (payload && payload.days || []).forEach(d => (d.orders || []).forEach(o => {
    const on = String(o.order_number || '');
    if (!hasPrev || !on) { o._chg = ''; return; }
    if (!(on in prev)) o._chg = 'new';
    else if (prev[on] !== '-' && prev[on] !== cur[on]) o._chg = 'upd';
    else o._chg = '';
  }));
}

function renderScheduleTab() {
  try {
    _schedulePrevSnap = JSON.parse(localStorage.getItem(SCHEDULE_SEEN_KEY) || 'null');
  } catch(e) { _schedulePrevSnap = null; }
  try {
    const cached = JSON.parse(localStorage.getItem(SCHEDULE_CACHE_KEY) || 'null');
    if (cached && cached.days) {
      _scheduleCache = cached;
      paintSchedule_(cached);
    }
  } catch(e) {}
  refreshScheduleTab();
}

async function refreshScheduleTab() {
  const statusEl = document.getElementById('scheduleStatus');
  const listEl = document.getElementById('scheduleDayList');
  if (statusEl) statusEl.textContent = 'Loading schedule…';
  const hasCached = _scheduleCache && _scheduleCache.days && _scheduleCache.days.length;
  if (listEl && !hasCached) {
    listEl.innerHTML = '<div style="padding:48px 24px;text-align:center;background:rgba(66,165,245,.06);border:1.5px dashed rgba(66,165,245,.35);border-radius:12px;color:#42a5f5;font-size:18px;font-weight:800;letter-spacing:.5px"><div style="font-size:36px;margin-bottom:12px;animation:mbdSpin 1s linear infinite;display:inline-block">⟳</div><div>Loading schedule…</div></div>';
  }
  try {
    const res = await groundApi('listScheduleByDateRange', {});
    if (!res || !res.ok) {
      if (statusEl) statusEl.textContent = 'Error: ' + ((res && res.error) || 'unknown');
      return;
    }
    _scheduleCache = res;
    try { localStorage.setItem(SCHEDULE_CACHE_KEY, JSON.stringify(res)); } catch(e) {}
    // Diff vs the last-seen snapshot, stamp _chg on each order, then
    // advance the baseline. Done AFTER the cache persist so the
    // stored copy stays free of transient _chg flags.
    _scheduleStampChanges_(res);
    try {
      const snap = _scheduleSnap_(res);
      _schedulePrevSnap = snap;
      localStorage.setItem(SCHEDULE_SEEN_KEY, JSON.stringify(snap));
    } catch(e) {}
    // v9.68 — surface cross-tab attention counts (stalled,
    // awaiting customer) so Cabinets tab can render them without
    // re-fetching. Updated every Schedule refresh.
    try {
      let awaitingCount = 0;
      (res.days || []).forEach(d => {
        (d.orders || []).forEach(o => {
          if (o.source !== 'cabinet') return;
          if (o.customer_ready) return;
          const status = String(o.status || '').toLowerCase();
          if (status !== '' && status !== 'pending') return;
          if (!o.ship_date) return;
          const ship = new Date(o.ship_date + 'T00:00:00');
          const now = new Date(); now.setHours(0, 0, 0, 0);
          const diff = (ship - now) / (1000 * 60 * 60 * 24);
          if (diff >= -1 && diff <= 14) awaitingCount++;
        });
      });
      localStorage.setItem('mbd_attention_v1', JSON.stringify({
        stalled: res.stalled_total || 0,
        awaiting: awaitingCount,
        holds: res.holds_total || 0,
        at: Date.now(),
      }));
    } catch(e) {}
    paintSchedule_(res);
    paintScheduleDayPlan_();
    if (typeof renderCabinetAttentionStrip_ === 'function') renderCabinetAttentionStrip_();
    // v10.175 Phase 0c — fetch the ShipConf status map in parallel.
    // 5min TTL cache + fire-and-forget; on completion repaint so chips
    // appear. Non-blocking so schedule paints immediately.
    refreshShipConfStatusMap_().then(() => {
      if (_scheduleCache) paintSchedule_(_scheduleCache);
    });
    const totalOrders = (res.days || []).reduce((s, d) => s + d.total, 0);
    if (statusEl) statusEl.textContent = totalOrders + ' order' + (totalOrders === 1 ? '' : 's') + ' across ' + (res.days || []).length + ' day' + ((res.days || []).length === 1 ? '' : 's') + ' · today=' + res.today;
  } catch (err) {
    // v10.166 R3-style — inline Retry on Schedule load failure (Zac
    // 2026-05-21 09:59 bug report: schedule failing on phone, no way
    // to retry without finding the refresh button).
    if (statusEl) {
      statusEl.innerHTML = '<span style="color:#ff5252">Error: ' + esc(String(err && err.message || err)) + '</span>'
        + ' <button onclick="refreshScheduleTab()" style="margin-left:8px;padding:5px 12px;background:#003087;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:800;cursor:pointer">↻ Retry</button>';
    }
    if (listEl && !hasCached) {
      listEl.innerHTML = '<div style="padding:32px 18px;text-align:center;background:rgba(255,82,82,.08);border:1.5px dashed rgba(255,82,82,.35);border-radius:12px;color:#ff5252;font-size:14px">'
        + '<div style="font-size:28px;margin-bottom:10px">⚠</div>'
        + '<div style="font-weight:800;margin-bottom:6px">Schedule load failed</div>'
        + '<div style="font-size:12px;color:var(--text-dim);margin-bottom:14px">' + esc(String(err && err.message || err)) + '</div>'
        + '<button onclick="refreshScheduleTab()" style="padding:10px 20px;background:#003087;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:800;cursor:pointer">↻ Try again</button>'
        + '</div>';
    }
  }
}

// v10.10 pass 2: view-mode filter. Turns the read-everything board
// into each role's work queue. Sticky in localStorage so a device
// stays in the mode its user works in (Kim → needs_booking).
let _scheduleViewMode = 'all';
try { _scheduleViewMode = localStorage.getItem('mbd_sched_view') || 'all'; } catch(e) {}
// v10.220 Seth pain #2 — stalled sub-filter. When view-mode='stalled',
// a second chip row appears letting Seth narrow to a single stall
// reason. Persists across reload.
let _scheduleStallReasonFilter = 'all';
try { _scheduleStallReasonFilter = localStorage.getItem('mbd_sched_stall_reason') || 'all'; } catch(e) {}
function setScheduleStallReasonFilter(r) {
  _scheduleStallReasonFilter = String(r || 'all');
  try { localStorage.setItem('mbd_sched_stall_reason', _scheduleStallReasonFilter); } catch(e) {}
  if (_scheduleCache) paintSchedule_(_scheduleCache);
}

const SCHEDULE_VIEW_MODES = [
  { key: 'all',              label: 'All',              color: '#9AAAC0' },
  { key: 'needs_booking',    label: 'Needs Booking',    color: '#FFB300' },
  { key: 'awaiting_customer',label: 'Awaiting Customer', color: '#3DBEFF' },
  { key: 'stalled',          label: 'Stalled',          color: '#FF5252' },
  // v10.171 — ShipConf Inbox view (Phase 0a). Filters to cabinet
  // orders in the outreach window where ShipConf hasn't been sent.
  // Data joined client-side from the new listShipConfInbox endpoint.
  // v10.180 — color brightened from #9C27B0 (dark purple, fails contrast
  // on black bg per Zac 16:24 EDT) to #CE93D8 (Material Light Purple).
  { key: 'shipconf_inbox',   label: '📧 Ship Conf',     color: '#CE93D8' },
];

// v10.171 — ShipConf Inbox state. _shipConfInboxMap is order_number →
// inbox row, populated by refreshShipConfInbox_() on view-mode switch.
let _shipConfInboxMap = null;
let _shipConfInboxStats = null;

// v10.175 Phase 0c — ShipConf status chip on EVERY cabinet card.
// _shipConfStatusMap is order_number → { status: 'sent'|'skipped',
// sent_at?, skipped_reason? } from the ShippingConfirmation log.
// 'queued' and 'past_due' are computed locally from arrival_date
// (no log row + in outreach window = queued; no log row + arrival
// in past = past_due). Refreshed on schedule load with 5min cache.
let _shipConfStatusMap = null;
let _shipConfStatusFetchedAt = 0;
const SHIPCONF_STATUS_TTL_MS = 5 * 60 * 1000;
const SHIPCONF_OUTREACH_BIZ_DAYS = 14;

// v10.180 — heuristic for "is this cabinet order in the ShipConf
// inbox" that works regardless of view mode. Two paths:
//  - In shipconf_inbox view, _shipConfInboxMap is server-loaded →
//    trust it (authoritative).
//  - In any other view, _shipConfStatusMap is loaded (from v10.175
//    refreshShipConfStatusMap_ on schedule load). Compute: cabinet,
//    not yet sent, not yet skipped, arrival within outreach window
//    (≤20 cal days ahead, includes past-due).
// Used both by filter (mode match) and by chip-count rendering.
function _scheduleOrderInShipConfInbox_(o) {
  if (!o || o.source !== 'cabinet') return false;
  const orderNum = String(o.order_number || '');
  if (!orderNum) return false;
  if (_shipConfInboxMap) {
    return !!_shipConfInboxMap[orderNum];
  }
  const logRow = _shipConfStatusMap && _shipConfStatusMap[orderNum];
  if (logRow && (logRow.status === 'sent' || logRow.status === 'skipped')) return false;
  const arrival = String(o.ship_date || '');
  if (!arrival) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const ship = new Date(arrival + 'T00:00:00');
  const diffDays = (ship - today) / 86400000;
  return diffDays <= 20; // includes past-due (negative diff)
}

function _scheduleOrderMatchesMode_(o, mode) {
  if (mode === 'all') return true;
  if (mode === 'stalled') {
    if (!o.stalled) return false;
    // v10.220 Seth pain #2: optional secondary filter by single
    // stall reason. 'all' = any reason; otherwise stall_reasons
    // must include the picked code.
    if (_scheduleStallReasonFilter && _scheduleStallReasonFilter !== 'all') {
      const reasons = Array.isArray(o.stall_reasons) ? o.stall_reasons : [];
      if (!reasons.includes(_scheduleStallReasonFilter)) return false;
    }
    return true;
  }
  if (mode === 'needs_booking') {
    // Calendar/JS2-sourced rows are committed-schedule visibility,
    // not Bedrock freight-booking actionable — exclude so Kim's
    // "to book" worklist/chip isn't flooded by the calendar feed.
    if (o.cal_sourced || o.js2_sourced) return false;
    return o.source === 'cabinet' && !o.booked_at;
  }
  if (mode === 'awaiting_customer') {
    if (o.source !== 'cabinet' || o.customer_ready) return false;
    const st = String(o.status || '').toLowerCase();
    if (st !== '' && st !== 'pending') return false;
    if (!o.ship_date) return false;
    const ship = new Date(o.ship_date + 'T00:00:00');
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const diff = (ship - now) / 86400000;
    return diff >= -1 && diff <= 14;
  }
  if (mode === 'shipconf_inbox') {
    // Match if this order_number is in the inbox map (server-side
    // computed in listShipConfInbox).
    if (o.source !== 'cabinet') return false;
    if (!_shipConfInboxMap) return false;
    return !!_shipConfInboxMap[String(o.order_number || '')];
  }
  return true;
}

// v10.171 — fetch the ShipConf inbox set from server. Called when
// view-mode flips to 'shipconf_inbox'. Cached as long as the user
// stays in that view; cleared on view-mode change.
async function refreshShipConfInbox_() {
  try {
    const res = await groundApi('listShipConfInbox', {});
    if (!res || !res.ok) {
      _shipConfInboxMap = {};
      _shipConfInboxStats = { total: 0, queued: 0, sent_today: 0, skipped: 0, past_due: 0 };
      return;
    }
    const map = {};
    (res.inbox || []).forEach(item => { map[String(item.order_number || '')] = item; });
    _shipConfInboxMap = map;
    _shipConfInboxStats = res.stats || null;
  } catch (e) {
    console.warn('shipConfInbox fetch failed:', e.message);
    _shipConfInboxMap = {};
    _shipConfInboxStats = null;
  }
}

// v10.175 Phase 0c — fetch the ShipConf status map (sent/skipped facts
// only). Lightweight server endpoint; 5min TTL cache. Force=true skips
// cache check (used after a Send/Skip action so the chip flips
// immediately).
async function refreshShipConfStatusMap_(force) {
  const now = Date.now();
  if (!force && _shipConfStatusMap
      && (now - _shipConfStatusFetchedAt) < SHIPCONF_STATUS_TTL_MS) {
    return _shipConfStatusMap;
  }
  try {
    const res = await groundApi('getShipConfStatusMap', {});
    if (res && res.ok && res.statusMap) {
      _shipConfStatusMap = res.statusMap;
      _shipConfStatusFetchedAt = now;
    } else {
      _shipConfStatusMap = _shipConfStatusMap || {};
    }
  } catch (e) {
    console.warn('shipConfStatusMap fetch failed:', e.message);
    _shipConfStatusMap = _shipConfStatusMap || {};
  }
  return _shipConfStatusMap;
}

// Returns one of: 'sent' | 'skipped' | 'past_due' | 'queued' | null.
// Null = no chip rendered (non-cabinet or arrival > outreach window).
function _shipConfStatusForOrder_(o) {
  if (!o || o.source !== 'cabinet') return null;
  const orderNum = String(o.order_number || '');
  if (!orderNum) return null;
  // Definitive facts from the log (server-side).
  const logRow = _shipConfStatusMap && _shipConfStatusMap[orderNum];
  if (logRow && logRow.status === 'sent') return 'sent';
  if (logRow && logRow.status === 'skipped') return 'skipped';
  // Compute queued/past_due from arrival date — only meaningful if we
  // have an arrival date to begin with. No chip if arrival unknown.
  const arrival = String(o.ship_date || '');
  if (!arrival) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const ship = new Date(arrival + 'T00:00:00');
  const diffDays = (ship - today) / 86400000;
  // Arrival already happened, no log row → overdue ShipConf.
  if (diffDays < 0) return 'past_due';
  // Arrival in the outreach window (next ~14 biz days ≈ 20 cal days
  // accounting for weekends) → queued chip; further out = no chip
  // so chips don't blanket every distant cabinet.
  if (diffDays <= 20) return 'queued';
  return null;
}

function _shipConfStatusChipHtml_(status) {
  if (!status) return '';
  let bg, color, glyph, title;
  if (status === 'sent') {
    bg = 'rgba(0,200,83,.18)'; color = '#00e676';
    glyph = '🟢'; title = 'Shipping confirmation sent';
  } else if (status === 'skipped') {
    bg = 'rgba(120,120,120,.18)'; color = '#9e9e9e';
    glyph = '🚫'; title = 'Shipping confirmation skipped';
  } else if (status === 'past_due') {
    bg = 'rgba(255,82,82,.18)'; color = '#ff5252';
    glyph = '🔴'; title = 'Shipping confirmation past due — arrival has passed without outreach';
  } else if (status === 'queued') {
    bg = 'rgba(255,179,0,.18)'; color = '#FFB300';
    glyph = '🟡'; title = 'Shipping confirmation queued — in outreach window';
  } else return '';
  return ' <span style="font-size:9px;font-weight:900;letter-spacing:.5px;background:' + bg + ';color:' + color + ';border:1px solid ' + color + '55;padding:0 5px;border-radius:3px;vertical-align:middle" title="' + title + '">' + glyph + ' SC</span>';
}

function setScheduleViewMode(mode) {
  _scheduleViewMode = mode;
  try { localStorage.setItem('mbd_sched_view', mode); } catch(e) {}
  // v10.171 — when switching INTO ShipConf inbox view, fetch the
  // inbox set first then repaint. Clear on switch OUT so a stale map
  // doesn't accidentally filter another view.
  if (mode === 'shipconf_inbox') {
    // v10.180 — show explicit loading state during the fetch (5-15s
    // for listShipConfInbox since it calls listScheduleByDateRange
    // internally). Without this, the empty-state message renders
    // and looks like "nothing in inbox" → confusing per Zac 16:24 EDT.
    const listEl = document.getElementById('scheduleDayList');
    if (listEl) {
      listEl.innerHTML = '<div style="padding:48px 24px;text-align:center;background:rgba(206,147,216,.10);border:1.5px dashed rgba(206,147,216,.45);border-radius:12px;color:#CE93D8;font-size:18px;font-weight:800;letter-spacing:.5px"><div style="font-size:36px;margin-bottom:12px;animation:mbdSpin 1s linear infinite;display:inline-block">⟳</div><div>Loading Ship Conf inbox…</div><div style="font-size:11px;color:var(--text-dim);margin-top:8px;font-weight:600;letter-spacing:.5px">Fetching cabinet orders awaiting customer outreach</div></div>';
    }
    refreshShipConfInbox_().then(() => {
      if (_scheduleCache) paintSchedule_(_scheduleCache);
    });
  } else {
    _shipConfInboxMap = null;
    _shipConfInboxStats = null;
    if (_scheduleCache) paintSchedule_(_scheduleCache);
  }
}

// v10.12 pass 4: ephemeral order-find (NOT persisted — a stale filter
// on next load would hide orders confusingly). Survives the 60s
// auto-refresh because the box is render-once; resets on page reload.
let _scheduleFindQuery = '';

function _scheduleOrderMatchesFind_(o) {
  if (!_scheduleFindQuery) return true;
  const q = _scheduleFindQuery.toLowerCase();
  return String(o.order_number || '').toLowerCase().indexOf(q) !== -1
      || String(o.customer_name || '').toLowerCase().indexOf(q) !== -1;
}

// Apply the active view-mode filter + find query to a payload,
// returning a shallow-cloned payload with filtered days (empty days
// dropped). Both compose: find narrows within the active view mode.
function _applyScheduleViewFilter_(payload) {
  if (_scheduleViewMode === 'all' && !_scheduleFindQuery) return payload;
  const days = (payload.days || []).map(d => {
    const orders = (d.orders || []).filter(o => _scheduleOrderMatchesMode_(o, _scheduleViewMode) && _scheduleOrderMatchesFind_(o));
    if (!orders.length) return null;
    const fd = Object.assign({}, d, { orders: orders, total: orders.length });
    fd.freight_count = orders.filter(o => o.source === 'cabinet').length;
    fd.ground_count = orders.filter(o => o.source === 'ground').length;
    fd.mattress_count = orders.filter(o => o.source === 'mattress').length;
    fd.counts = {};
    orders.forEach(o => { const k = o.carrier_key || 'unassigned'; fd.counts[k] = (fd.counts[k] || 0) + 1; });
    return fd;
  }).filter(Boolean);
  return Object.assign({}, payload, { days: days });
}

function _renderScheduleFilterBar_(payload) {
  const bar = document.getElementById('scheduleFilterBar');
  if (!bar) return;
  // Per-mode counts so each pill shows how many it'd surface.
  // v10.180: shipconf_inbox count was missing → rendered "undefined"
  // on the chip. Computed client-side from _shipConfStatusMap +
  // arrival window (same heuristic as Phase 0c chip's queued/past_due
  // detection) so the count works regardless of view mode.
  const counts = { all: 0, needs_booking: 0, awaiting_customer: 0, stalled: 0, shipconf_inbox: 0 };
  (payload.days || []).forEach(d => (d.orders || []).forEach(o => {
    counts.all++;
    if (_scheduleOrderMatchesMode_(o, 'needs_booking')) counts.needs_booking++;
    if (_scheduleOrderMatchesMode_(o, 'awaiting_customer')) counts.awaiting_customer++;
    if (_scheduleOrderMatchesMode_(o, 'stalled')) counts.stalled++;
    if (_scheduleOrderInShipConfInbox_(o)) counts.shipconf_inbox++;
  }));
  // v10.183 Phase 0d — when server _shipConfInboxMap is loaded, it
  // includes BOTH PackingQueue cabinets AND ARCH-upcoming cabinets
  // (the latter have no backing Schedule row, so the iteration above
  // misses them). Use the map size as authoritative count.
  if (_shipConfInboxMap) {
    counts.shipconf_inbox = Object.keys(_shipConfInboxMap).length;
  }
  bar.innerHTML = SCHEDULE_VIEW_MODES.map(m => {
    const active = m.key === _scheduleViewMode;
    const n = counts[m.key];
    return '<button onclick="setScheduleViewMode(\'' + m.key + '\')" style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:999px;font-size:12px;font-weight:800;letter-spacing:.5px;cursor:pointer;text-transform:uppercase;border:1px solid ' + m.color + (active ? ';background:' + m.color + ';color:#0a0a0a' : '88;background:transparent;color:' + m.color) + '">'
      + esc(m.label)
      + '<span style="font-size:10px;font-weight:900;opacity:.85;background:rgba(0,0,0,' + (active ? '.18' : '0') + ');padding:0 5px;border-radius:999px">' + n + '</span>'
      + '</button>';
  }).join('');

  // v10.220 Seth pain #2 — when stalled mode is active, append a
  // second chip row showing per-reason filter. Counts computed over
  // payload's stalled orders only.
  if (_scheduleViewMode === 'stalled') {
    const reasonCounts = { all: 0, past_ship_date: 0, needs_booking: 0, awaiting_customer_confirm: 0, missing_instructions: 0 };
    (payload.days || []).forEach(d => (d.orders || []).forEach(o => {
      if (!o.stalled) return;
      reasonCounts.all++;
      (o.stall_reasons || []).forEach(r => { if (reasonCounts[r] != null) reasonCounts[r]++; });
    }));
    const REASONS = [
      { key: 'all',                        label: 'Any',             color: '#FF5252' },
      { key: 'past_ship_date',             label: 'Past Due',        color: '#ff5252' },
      { key: 'needs_booking',              label: 'Needs Booking',   color: '#FFB300' },
      { key: 'awaiting_customer_confirm',  label: 'Needs Customer',  color: '#42a5f5' },
      { key: 'missing_instructions',       label: 'No Instructions', color: '#ab47bc' },
    ];
    const subBar = REASONS.map(r => {
      const active = r.key === (_scheduleStallReasonFilter || 'all');
      const n = reasonCounts[r.key] || 0;
      // Hide chips with 0 count (except 'all' which always shows)
      if (n === 0 && r.key !== 'all') return '';
      return '<button onclick="setScheduleStallReasonFilter(\'' + r.key + '\')" style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:800;letter-spacing:.4px;cursor:pointer;text-transform:uppercase;border:1px solid ' + r.color + (active ? ';background:' + r.color + ';color:#0a0a0a' : '88;background:transparent;color:' + r.color) + '">'
        + esc(r.label)
        + '<span style="font-size:10px;font-weight:900;opacity:.85;background:rgba(0,0,0,' + (active ? '.18' : '0') + ');padding:0 4px;border-radius:999px">' + n + '</span>'
        + '</button>';
    }).join(' ');
    bar.innerHTML += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;padding:6px 10px;background:rgba(255,82,82,.06);border:1px dashed rgba(255,82,82,.4);border-radius:8px;width:100%"><span style="font-size:10px;color:#FF5252;font-weight:900;letter-spacing:1px;align-self:center;margin-right:4px">REASON →</span>' + subBar + '</div>';
  }
}

// Render-once so typing never loses focus on the 60s auto-refresh
// or a view-mode tap. Only the count span + Clear visibility mutate
// after first render; the <input> node itself is never replaced.
function _renderScheduleFindBox_() {
  const box = document.getElementById('scheduleFindBox');
  if (!box) return;
  if (box.querySelector('#scheduleFindInput')) { _updateScheduleFindCount_(); return; }
  box.innerHTML = '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">'
    + '<input id="scheduleFindInput" type="search" inputmode="search" autocomplete="off" placeholder="Find order # or customer…" oninput="setScheduleFindQuery(this.value)" style="flex:1;min-width:160px;max-width:340px;padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.25);color:var(--text);font-size:14px">'
    + '<span id="scheduleFindCount" style="font-size:11px;color:var(--text-dim);font-weight:700;letter-spacing:.5px"></span>'
    + '<button id="scheduleFindClear" onclick="var i=document.getElementById(\'scheduleFindInput\');if(i)i.value=\'\';setScheduleFindQuery(\'\');" style="display:none;padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.18);background:transparent;color:var(--text-dim);font-size:12px;cursor:pointer">Clear</button>'
    + '</div>';
  _updateScheduleFindCount_();
}

function _updateScheduleFindCount_() {
  const el = document.getElementById('scheduleFindCount');
  if (!el) return;
  if (!_scheduleFindQuery) { el.textContent = ''; return; }
  let n = 0;
  const c = _scheduleCache;
  if (c && c.days) c.days.forEach(d => (d.orders || []).forEach(o => {
    if (_scheduleOrderMatchesMode_(o, _scheduleViewMode) && _scheduleOrderMatchesFind_(o)) n++;
  }));
  el.textContent = n === 0 ? 'no matches' : (n === 1 ? '1 match' : n + ' matches');
}

function setScheduleFindQuery(v) {
  _scheduleFindQuery = String(v || '').trim();
  const clr = document.getElementById('scheduleFindClear');
  if (clr) clr.style.display = _scheduleFindQuery ? '' : 'none';
  if (_scheduleCache) paintSchedule_(_scheduleCache);
}

function paintSchedule_(payloadRaw) {
  const legendEl = document.getElementById('scheduleLegend');
  const listEl = document.getElementById('scheduleDayList');
  if (!legendEl || !listEl) return;
  // Filter bar reflects the FULL payload's counts; the grid/list
  // below render the FILTERED payload.
  _renderScheduleFilterBar_(payloadRaw);
  _renderScheduleFindBox_();

  // v10.183 Phase 0d — in Ship Conf inbox view, ARCH-upcoming items
  // don't have backing Schedule rows (they come from
  // listUpcomingCabinets, not from PackingQueue). Render entirely
  // from _shipConfInboxMap with two visual sections per Zac
  // Q1 = C (sectioned) + B (colored left border).
  if (_scheduleViewMode === 'shipconf_inbox' && _shipConfInboxMap) {
    paintShipConfInboxSectioned_(legendEl, listEl);
    return;
  }

  const payload = _applyScheduleViewFilter_(payloadRaw);

  // ── Legend (shared) ──
  const carriers = payload.carriers || [];
  const carriersUsed = {};
  (payload.days || []).forEach(d => {
    Object.keys(d.counts || {}).forEach(k => { carriersUsed[k] = (carriersUsed[k] || 0) + d.counts[k]; });
  });
  // v9.54: stalled summary chip leads the legend if there are any.
  // Tap → opens a panel listing the stalled orders + their reasons.
  let stalledChip = '';
  if (payload.stalled_total && payload.stalled_total > 0) {
    stalledChip = '<button onclick="openStalledList()" style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;background:linear-gradient(135deg,#FF5252,#B71C1C);color:#fff;border:1px solid #ff5252;border-radius:999px;font-size:11px;font-weight:900;letter-spacing:.5px;cursor:pointer;margin-right:6px">⚠ ' + payload.stalled_total + ' STALLED</button>';
  }
  // v9.58: awaiting-customer chip — Ken's at-a-glance count of
  // orders he still needs to confirm. Counted client-side from the
  // existing payload (any cabinet order with !customer_ready and
  // status=pending and ship within ~14 days).
  // v10.18 pass 10 (correctness): count from the FULL cache via the
  // shared predicate so this chip agrees with the filter-bar pill
  // and openAwaitingCustomerList. It previously recomputed over the
  // FILTERED payload, so the count wrongly shrank whenever a view
  // filter was active — chip said 2, tapping it showed 7. Now
  // matches the stalled chip (server total carried through
  // unfiltered) and the pass-9 "to book" chip.
  let awaitingChip = '';
  let awaitingCount = 0;
  ((_scheduleCache && _scheduleCache.days) || []).forEach(d => (d.orders || []).forEach(o => {
    if (_scheduleOrderMatchesMode_(o, 'awaiting_customer')) awaitingCount++;
  }));
  if (awaitingCount > 0) {
    awaitingChip = '<button onclick="openAwaitingCustomerList()" style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;background:linear-gradient(135deg,#3DBEFF,#005577);color:#fff;border:1px solid #3DBEFF;border-radius:999px;font-size:11px;font-weight:900;letter-spacing:.5px;cursor:pointer;margin-right:6px">🔔 ' + awaitingCount + ' AWAITING CUSTOMER</button>';
  }
  // v10.17 pass 9: Kim's "to book" chip. Counted from the FULL cache
  // (not the filtered payload) so it always shows the true total and
  // matches openNeedsBookingList's contents regardless of active view.
  // v10.200 — also breakdown per-carrier and surface as a tooltip on
  // the chip so Kim can see "4 FedEx Freight · 2 ABF · 1 unassigned"
  // without first switching to needs_booking view-mode.
  let bookChip = '';
  let bookCount = 0;
  const bookByCarrier = {};
  ((_scheduleCache && _scheduleCache.days) || []).forEach(d => (d.orders || []).forEach(o => {
    if (_scheduleOrderMatchesMode_(o, 'needs_booking')) {
      bookCount++;
      const ck = o.carrier_display || o.carrier_key || 'unassigned';
      bookByCarrier[ck] = (bookByCarrier[ck] || 0) + 1;
    }
  }));
  if (bookCount > 0) {
    const breakdown = Object.entries(bookByCarrier)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => n + ' ' + k)
      .join(' · ');
    const titleAttr = 'By carrier: ' + breakdown;
    bookChip = '<button onclick="openNeedsBookingList()" title="' + esc(titleAttr) + '" style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;background:linear-gradient(135deg,#FFB300,#995c00);color:#1a1a1a;border:1px solid #FFB300;border-radius:999px;font-size:11px;font-weight:900;letter-spacing:.5px;cursor:pointer;margin-right:6px">📋 ' + bookCount + ' TO BOOK</button>';
  }
  const adminBtns = '<button onclick="openCarrierEditor()" title="Edit carriers + colors" style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;background:rgba(255,255,255,.04);border:1px dashed rgba(255,255,255,.3);border-radius:999px;font-size:11px;font-weight:800;color:var(--text-dim);letter-spacing:.5px;cursor:pointer">✎ Carriers</button>'
    + '<button onclick="openFreightDefaultsEditor()" title="Edit freight weights/dims/links by SKU" style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;margin-left:6px;background:rgba(255,255,255,.04);border:1px dashed rgba(255,255,255,.3);border-radius:999px;font-size:11px;font-weight:800;color:var(--text-dim);letter-spacing:.5px;cursor:pointer">✎ Freight</button>';
  legendEl.innerHTML = stalledChip + awaitingChip + bookChip + carriers
    .filter(c => carriersUsed[c.carrier_key])
    .map(c => '<span style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;background:rgba(255,255,255,.05);border:1px solid ' + c.color + '55;border-radius:999px;font-size:11px;font-weight:700;color:' + c.color + ';letter-spacing:.5px"><span style="width:9px;height:9px;background:' + c.color + ';border-radius:50%;box-shadow:0 0 6px ' + c.color + '88"></span>' + esc(c.display_name) + ' · ' + carriersUsed[c.carrier_key] + '</span>').join('') + adminBtns;

  if (!payload.days || !payload.days.length) {
    const modeLabel = (SCHEDULE_VIEW_MODES.find(m => m.key === _scheduleViewMode) || {}).label || '';
    const msg = _scheduleViewMode === 'all'
      ? 'No orders scheduled in this window.'
      : '✓ Nothing in <strong>' + esc(modeLabel) + '</strong> right now.<br><span style="font-size:12px">Tap <strong>All</strong> above to see the full schedule.</span>';
    listEl.innerHTML = '<div style="padding:24px;text-align:center;color:' + (_scheduleViewMode === 'all' ? 'var(--text-dim)' : '#0a8a3f') + ';background:rgba(255,255,255,.03);border:1px dashed rgba(255,255,255,.15);border-radius:10px">' + msg + '</div>';
    return;
  }

  // Branch on viewport width — desktop gets a calendar grid, mobile
  // gets the scrollable list. The breakpoint covers iPad portrait
  // (~768px is too tight for a 5-column grid) and goes desktop at
  // typical laptop widths.
  const isDesktop = window.innerWidth >= SCHEDULE_DESKTOP_BREAKPOINT_PX;
  if (isDesktop) {
    paintScheduleDesktopGrid_(payload, listEl);
  } else {
    paintScheduleMobileList_(payload, listEl);
  }
}

// v10.183 Phase 0d — sectioned inbox render. Items in _shipConfInboxMap
// come from two server sources (per ShippingConfirmation.js):
//   - source='arrived_packqueue' — cabinet has arrived, in PackingQueue
//   - source='upcoming_arch'     — ARCH-confirmed delivery date, not yet arrived
// Per Zac Q1=C+B: render two sections with colored left borders.
function paintShipConfInboxSectioned_(legendEl, listEl) {
  // Lightweight legend: just the stalled/awaiting/book chips, no carriers
  // here (inbox view has its own context). Repaint via the standard helper
  // by passing empty days so other chips compute correctly.
  // (legend already painted via _renderScheduleFilterBar_; no changes here)

  const items = Object.values(_shipConfInboxMap || {});
  if (!items.length) {
    listEl.innerHTML = '<div style="padding:32px 24px;text-align:center;color:#0a8a3f;background:rgba(255,255,255,.03);border:1px dashed rgba(255,255,255,.15);border-radius:10px">✓ Nothing in <strong>📧 Ship Conf</strong> right now.<br><span style="font-size:12px">Tap <strong>All</strong> above to see the full schedule.</span></div>';
    return;
  }

  const arrived = items.filter(i => i.source === 'arrived_packqueue' || !i.source).sort(_inboxItemSort_);
  const upcoming = items.filter(i => i.source === 'upcoming_arch').sort(_inboxItemSort_);

  // v10.201 Ken persona — stats banner. _shipConfInboxStats has been
  // populated since v10.171 but never surfaced in the UI. Ken sends
  // ShipConf emails all day; a "X sent today · Y queued · Z past due"
  // header gives him daily progress at a glance without doing math.
  const stats = _shipConfInboxStats || { sent_today: 0, queued: 0, past_due: 0, skipped: 0 };
  const sentToday = Number(stats.sent_today || 0);
  const pastDue = items.filter(i => {
    const arrival = String(i.arrival_date || '');
    if (!arrival) return false;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const ship = new Date(arrival + 'T00:00:00');
    return (ship - today) / 86400000 < 0;
  }).length;
  const queued = items.length;
  const sections = [];
  sections.push('<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 12px;margin-bottom:14px;background:rgba(206,147,216,.08);border:1px solid rgba(206,147,216,.35);border-radius:8px;font-size:12px;color:var(--text)">'
    + '<span style="font-weight:900;letter-spacing:1px;text-transform:uppercase;color:#CE93D8">📊 Ship Conf today</span>'
    + '<span style="background:rgba(0,200,83,.20);color:#00e676;border:1px solid #00e67655;padding:2px 8px;border-radius:999px;font-weight:800">🟢 ' + sentToday + ' sent</span>'
    + '<span style="background:rgba(255,179,0,.20);color:#FFB300;border:1px solid #FFB30055;padding:2px 8px;border-radius:999px;font-weight:800">🟡 ' + queued + ' queued</span>'
    + (pastDue ? '<span style="background:rgba(255,82,82,.20);color:#ff5252;border:1px solid #ff525255;padding:2px 8px;border-radius:999px;font-weight:800">🔴 ' + pastDue + ' past due</span>' : '')
    + (stats.skipped ? '<span style="background:rgba(120,120,120,.18);color:#aaa;border:1px solid #88888855;padding:2px 8px;border-radius:999px;font-weight:800">🚫 ' + Number(stats.skipped) + ' skipped</span>' : '')
    + '</div>');
  if (upcoming.length) {
    sections.push('<div style="margin-bottom:14px"><div style="font-size:12px;color:#42a5f5;font-weight:900;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px;padding-left:4px;display:flex;align-items:center;gap:8px"><span>📅 Arriving Soon (ARCH-confirmed)</span><span style="background:rgba(66,165,245,.18);border:1px solid #42a5f588;color:#42a5f5;font-size:10px;padding:1px 7px;border-radius:999px">' + upcoming.length + '</span></div>' + upcoming.map(_renderShipConfInboxCard_).join('') + '</div>');
  }
  if (arrived.length) {
    sections.push('<div><div style="font-size:12px;color:#CE93D8;font-weight:900;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px;padding-left:4px;display:flex;align-items:center;gap:8px"><span>📦 In Pack Queue (arrived)</span><span style="background:rgba(206,147,216,.18);border:1px solid #CE93D888;color:#CE93D8;font-size:10px;padding:1px 7px;border-radius:999px">' + arrived.length + '</span></div>' + arrived.map(_renderShipConfInboxCard_).join('') + '</div>');
  }

  // v10.227 Ken pain #6 — "Recent skipped" expander. Surfaces the
  // last 15 orders skipped (status='skipped' in _shipConfStatusMap)
  // with their reason inline. Was: invisible in the inbox view (only
  // viewable by querying the shadow log directly). Now Ken can see
  // why each was skipped + spot patterns.
  if (_shipConfStatusMap) {
    const skippedEntries = Object.keys(_shipConfStatusMap)
      .filter(k => _shipConfStatusMap[k] && _shipConfStatusMap[k].status === 'skipped')
      .map(k => Object.assign({ order_number: k }, _shipConfStatusMap[k]))
      .sort((a, b) => String(b.skipped_at || '').localeCompare(String(a.skipped_at || '')))
      .slice(0, 15);
    if (skippedEntries.length) {
      const rows = skippedEntries.map(s => {
        const reason = s.skipped_reason || '(no reason)';
        const when = String(s.skipped_at || '').slice(0, 16).replace('T', ' ');
        return '<div onclick="jumpToLookup_(\'' + esc(s.order_number) + '\')" style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:rgba(120,120,120,.10);border-left:3px solid #aaa;border-radius:4px;margin-bottom:4px;cursor:pointer;font-size:12px;color:var(--text)" title="Tap for full order detail">'
          + '<span style="font-family:\'JetBrains Mono\',monospace;font-weight:900;color:#fff;background:rgba(0,0,0,.30);padding:1px 7px;border-radius:3px">#' + esc(s.order_number) + '</span>'
          + '<span style="flex:1;color:var(--text-dim);min-width:0">' + esc(reason) + '</span>'
          + '<span style="font-size:10px;color:var(--text-dim);font-family:monospace;flex-shrink:0">' + esc(when) + '</span>'
          + '</div>';
      }).join('');
      sections.push('<details style="margin-top:14px"><summary style="background:rgba(120,120,120,.08);color:#aaa;padding:8px 12px;font-family:\'Barlow Condensed\',Arial,sans-serif;font-size:12px;font-weight:900;letter-spacing:1.5px;text-transform:uppercase;cursor:pointer;border:1px solid rgba(120,120,120,.30);border-radius:8px;list-style:none;display:flex;align-items:center;justify-content:space-between;gap:8px"><span>🚫 Recent skipped (' + skippedEntries.length + ')</span><span style="font-size:10px;opacity:.7">▾</span></summary><div style="padding:8px 0 0">' + rows + '</div></details>');
    }
  }

  listEl.innerHTML = sections.join('');
}

function _inboxItemSort_(a, b) {
  const aDate = String(a.auto_offered_date || a.arrival_date || '9999');
  const bDate = String(b.auto_offered_date || b.arrival_date || '9999');
  return aDate.localeCompare(bDate);
}

// Renders a single inbox card. ARCH-upcoming gets a blue left border;
// arrived gets purple. Send button on ARCH-upcoming is visible-but-
// disabled with a tooltip (per Phase 0d Pass 1: customer email lookup
// from Shopify is Phase 0e, not in this MVP). Per Zac Q2=yes for the
// long-term intent — the visual scaffolding is here.
function _renderShipConfInboxCard_(item) {
  const isUpcoming = item.source === 'upcoming_arch';
  const borderColor = isUpcoming ? '#42a5f5' : '#CE93D8';
  const bg = isUpcoming ? 'rgba(66,165,245,.10)' : 'rgba(206,147,216,.10)';
  const orderNum = esc(String(item.order_number || ''));
  const arrivalLabel = isUpcoming ? 'Arriving Week of' : 'Arrived';
  const arrivalDate = item.arrival_date ? esc(String(item.arrival_date)) : '—';
  const customerName = item.customer_name ? esc(item.customer_name) : (isUpcoming ? '<span style="color:var(--text-dim);font-style:italic">(name pending — Shopify lookup)</span>' : '—');
  const autoDate = item.auto_offered_date || '—';
  const tplKey = item.template_key || 'cc_default';

  // Send button — disabled on ARCH-upcoming because no customer_email yet.
  const hasEmail = !!item.customer_email;
  const sendBtn = hasEmail
    ? '<button onclick="event.stopPropagation();openShipConfPreviewModal(\'' + orderNum + '\')" style="margin-left:auto;padding:7px 14px;background:linear-gradient(135deg,#CE93D8,#9C27B0);color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:900;cursor:pointer;letter-spacing:.5px;text-transform:uppercase;box-shadow:0 2px 6px rgba(0,0,0,.35);text-shadow:0 1px 2px rgba(0,0,0,.4)">📧 Preview &amp; Send</button>'
    : '<button disabled title="Customer email lookup not wired yet (Phase 0e — Shopify Admin API). Tap once order arrives in PackingQueue." style="margin-left:auto;padding:7px 14px;background:rgba(255,255,255,.08);color:var(--text-dim);border:1px dashed rgba(255,255,255,.20);border-radius:6px;font-size:11px;font-weight:800;cursor:not-allowed;letter-spacing:.5px;text-transform:uppercase">📧 Send (email pending)</button>';

  const skipBtn = '<button onclick="event.stopPropagation();openShipConfSkipModal(\'' + orderNum + '\')" style="padding:7px 14px;background:rgba(255,255,255,.14);color:#fff;border:1px solid rgba(255,255,255,.40);border-radius:6px;font-size:11px;font-weight:800;cursor:pointer;letter-spacing:.5px">⊘ Skip</button>';

  const rowTap = ' onclick="jumpToLookup_(\'' + orderNum + '\')" title="Tap for full order detail"';

  return '<div' + rowTap + ' style="background:' + bg + ';border-left:4px solid ' + borderColor + ';border-radius:6px;margin-bottom:6px;padding:10px 12px;cursor:pointer;color:var(--text)">'
    + '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:13px">'
    +   '<span style="font-family:\'JetBrains Mono\',monospace;font-weight:900;color:#fff;background:rgba(0,0,0,.30);padding:2px 8px;border-radius:4px">#' + orderNum + '</span>'
    +   '<span style="flex:1;min-width:0;color:var(--text)">' + customerName + '</span>'
    + '</div>'
    + '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;font-size:12px;margin-top:8px;color:var(--text)">'
    +   '<span style="color:var(--text-dim);font-weight:700">' + arrivalLabel + ':</span><strong style="color:#fff;font-family:\'JetBrains Mono\',monospace;background:rgba(0,0,0,.30);padding:1px 6px;border-radius:3px">' + arrivalDate + '</strong>'
    +   '<span style="color:var(--text-dim);font-weight:700">· Auto Date:</span><strong title="' + esc(item.auto_offered_date_explain || '') + '" style="color:#fff;font-family:\'JetBrains Mono\',monospace;background:rgba(0,0,0,.30);padding:1px 6px;border-radius:3px">' + esc(autoDate) + '</strong>'
    +   '<span style="color:var(--text-dim);font-weight:700">· Template:</span><code style="font-family:\'JetBrains Mono\',monospace;color:#fff;background:rgba(0,0,0,.30);padding:1px 6px;border-radius:3px">' + esc(tplKey) + '</code>'
    + '</div>'
    + '<div style="display:flex;gap:8px;margin-top:10px;align-items:center" onclick="event.stopPropagation()">'
    +   sendBtn
    +   skipBtn
    + '</div>'
    + '</div>';
}

// Booker roster — Kim does most freight booking (VA), Seth oversees.
// Kim first because she's the default-most-common assignee.
const SCHEDULE_BOOKER_ROSTER = ['Kim', 'Seth'];

function _scheduleBookerChip_(o, compact) {
  // Only freight (cabinet) orders get a booker chip — ground auto-ships,
  // mattress dropship has its own MFRM workflow.
  if (o.source !== 'cabinet') return '';
  const booker = String(o.booker || '').trim();
  const booked = !!o.booked_at;
  // No amp-btn class on these tiny chips — its ::before/::after
  // brass-rivet circles crowd/muddy text at chip size (Zac flagged
  // 2026-05-17). Fully inline-styled; class only added the rivets.
  const pad = compact ? '1px 6px' : '2px 8px';
  const fs = compact ? '9px' : '10px';
  if (booked) {
    return '<button onclick="event.stopPropagation();openScheduleBookerModal(\''+esc(o.order_number)+'\',\''+esc(booker)+'\',true)" style="background:rgba(0,230,118,.18);color:#00e676;border:1px solid #00e676;padding:' + pad + ';font-size:' + fs + ';font-weight:900;letter-spacing:.5px;text-transform:uppercase;border-radius:999px;cursor:pointer;white-space:nowrap;min-width:0;flex:0 0 auto" title="Booked. Tap to view/edit.">✓ ' + esc(booker || 'booked') + '</button>';
  }
  if (booker) {
    return '<button onclick="event.stopPropagation();openScheduleBookerModal(\''+esc(o.order_number)+'\',\''+esc(booker)+'\',false)" style="background:rgba(255,179,0,.18);color:#FFB300;border:1px solid #FFB300;padding:' + pad + ';font-size:' + fs + ';font-weight:900;letter-spacing:.5px;text-transform:uppercase;border-radius:999px;cursor:pointer;white-space:nowrap;min-width:0;flex:0 0 auto" title="Assigned. Tap to reassign or mark booked.">👤 ' + esc(booker) + '</button>';
  }
  // Gate the "+ ASSIGN" prompt on customer-ready, but only for
  // pending orders shipping within 14 days. Older / further-out
  // rows default to allowing booking so we don't regress Kim's
  // workflow on orders that pre-date the customer_ready column.
  // Status is the backstop: if the order is already in pack flow,
  // customer-readiness is implicitly resolved.
  const shipIso = String(o.ship_date || '');
  const status = String(o.status || '').toLowerCase();
  const pending = status === '' || status === 'pending';
  let imminent = false;
  if (shipIso) {
    const ship = new Date(shipIso + 'T00:00:00');
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const diffDays = (ship - now) / (1000 * 60 * 60 * 24);
    imminent = diffDays <= 14;
  }
  if (!o.customer_ready && pending && imminent) {
    return '<button onclick="event.stopPropagation();openCustomerReadyModal(\''+esc(o.order_number)+'\',false,\'\',\'\')" style="background:transparent;color:#9AAAC0;border:1px dashed rgba(154,170,192,.4);padding:' + pad + ';font-size:' + fs + ';font-weight:900;letter-spacing:.5px;text-transform:uppercase;border-radius:999px;cursor:pointer;white-space:nowrap;min-width:0;flex:0 0 auto" title="Customer not yet confirmed. Tap to mark ready.">⏳ WAIT</button>';
  }
  return '<button onclick="event.stopPropagation();openScheduleBookerModal(\''+esc(o.order_number)+'\',\'\',false)" style="background:transparent;color:var(--text-dim);border:1px dashed rgba(255,255,255,.25);padding:' + pad + ';font-size:' + fs + ';font-weight:900;letter-spacing:.5px;text-transform:uppercase;border-radius:999px;cursor:pointer;white-space:nowrap;min-width:0;flex:0 0 auto" title="Tap to assign a booker">+ ASSIGN</button>';
}

const SCHEDULE_STALL_LABELS = {
  past_ship_date: 'PAST',
  needs_booking: 'BOOK',
  awaiting_customer_confirm: 'CUST?',
  missing_instructions: 'NO PDF',
};
// v10.15 pass 7: readable labels for roomy (mobile/list) rows — the
// 4-char codes above only fit the dense desktop grid columns. Touch
// users never see the hover `title`, so the reason must be on-chip.
const SCHEDULE_STALL_LABELS_FULL = {
  past_ship_date: 'PAST DUE',
  needs_booking: 'NEEDS BOOKING',
  awaiting_customer_confirm: 'NEEDS CUSTOMER',
  missing_instructions: 'NO INSTRUCTIONS',
};
const SCHEDULE_STALL_DESCRIPTIONS = {
  past_ship_date: 'Past ship date and not packed yet',
  needs_booking: 'Ready to ship but no freight booking',
  awaiting_customer_confirm: 'Within 7 days, customer not yet confirmed',
  missing_instructions: 'No instructions PDF parsed yet',
};

function _scheduleStallChip_(o, compact) {
  if (!o.stalled || !o.stall_reasons || !o.stall_reasons.length) return '';
  const pad = compact ? '1px 5px' : '2px 7px';
  const fs = compact ? '9px' : '10px';
  // Compact desktop grid keeps the terse code to fit columns; roomy
  // list/mobile rows show the readable phrase so touch users (no
  // hover tooltip) get the actual reason without tapping.
  const map = compact ? SCHEDULE_STALL_LABELS : SCHEDULE_STALL_LABELS_FULL;
  const label = map[o.stall_reasons[0]] || 'STALLED';
  const title = o.stall_reasons.map(r => SCHEDULE_STALL_DESCRIPTIONS[r] || r).join(' · ');
  // Tappable → stalled triage panel (was an inert span; the header's
  // ⚠ STALLED chip already opens this — match that). stopPropagation
  // so it doesn't also fire the row→Lookup tap from pass 3.
  return '<button onclick="event.stopPropagation();openStalledList()" title="' + esc(title) + '" style="background:rgba(255,82,82,.2);color:#ff5252;border:1px solid #ff5252;padding:' + pad + ';font-size:' + fs + ';font-weight:900;letter-spacing:.5px;text-transform:uppercase;border-radius:999px;white-space:nowrap;cursor:pointer;flex:0 0 auto">⚠ ' + esc(label) + (o.stall_reasons.length > 1 ? ' +' + (o.stall_reasons.length - 1) : '') + '</button>';
}

// v10.88 (Zac): the Customer-Ready notes field can carry a structured
// "[HOLD:YYYY-MM-DD]" token meaning "customer confirmed BUT asked us
// to hold the order until this date" — distinct from a plain confirm
// that means ship-ASAP. Token is authored client-side in the
// Customer-Ready modal and round-trips through the existing notes
// string (no server/JS2 schema change — Offered-Date/Hold history
// proper is still JS2 col G/V territory, deferred to the spine).
var _CUST_HOLD_RE_ = /\[HOLD:(\d{4})-(\d{2})-(\d{2})\]/;
function _parseCustReadyHold_(notes) {
  const m = _CUST_HOLD_RE_.exec(String(notes || ''));
  return m ? { iso: m[1] + '-' + m[2] + '-' + m[3], y: +m[1], mo: +m[2], d: +m[3] } : null;
}
function _stripHoldToken_(notes) {
  return String(notes || '').replace(_CUST_HOLD_RE_, '').replace(/\s{2,}/g, ' ').trim();
}
function _fmtHoldDate_(h) {
  if (!h) return '';
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return MON[(h.mo - 1) % 12] + ' ' + h.d;
}

function _scheduleCustomerReadyChip_(o, compact) {
  if (o.source !== 'cabinet') return '';
  const ready = !!o.customer_ready;
  const by = String(o.customer_ready_by || '').trim();
  const notes = String(o.customer_ready_notes || '').trim();
  const pad = compact ? '1px 6px' : '2px 8px';
  const fs = compact ? '9px' : '10px';
  const onclick = 'event.stopPropagation();openCustomerReadyModal(\''+esc(o.order_number)+'\',' + (ready ? 'true' : 'false') + ',\''+esc(by)+'\',\''+esc(notes)+'\')';
  if (ready) {
    const hold = _parseCustReadyHold_(notes);
    if (hold) {
      const clean = _stripHoldToken_(notes);
      const tip = 'Customer confirmed' + (by ? ' by ' + esc(by) : '')
        + ' — HOLD until ' + esc(hold.iso) + (clean ? ' · ' + esc(clean) : '') + '. Tap to edit.';
      return '<button onclick="' + onclick + '" style="background:rgba(255,179,0,.18);color:#FFB300;border:1px solid #FFB300;padding:' + pad + ';font-size:' + fs + ';font-weight:900;letter-spacing:.5px;text-transform:uppercase;border-radius:999px;cursor:pointer;white-space:nowrap;min-width:0;flex:0 0 auto" title="' + tip + '">⏸ HOLD → ' + esc(_fmtHoldDate_(hold)) + '</button>';
    }
    return '<button onclick="' + onclick + '" style="background:rgba(0,180,255,.15);color:#3DBEFF;border:1px solid #3DBEFF;padding:' + pad + ';font-size:' + fs + ';font-weight:900;letter-spacing:.5px;text-transform:uppercase;border-radius:999px;cursor:pointer;white-space:nowrap;min-width:0;flex:0 0 auto" title="Customer confirmed ready' + (by ? ' by ' + esc(by) : '') + '. Tap to edit.">✓ CUST</button>';
  }
  return ''; // unconfirmed → the booker chip already shows "⏳ WAIT" which itself opens this modal
}

// v10.14 pass 6: intra-day actionability rank. Within a day, float
// the rows that need a human now to the top; sink the done ones.
//   0 stalled (needs triage)  1 bookable now (customer-ready, unbooked)
//   2 awaiting customer (can't book yet)  3 booked (done)
// Applied only to the freight group; ground auto-ships and keeps its
// own grouping. Array.sort is stable in modern Safari/Chrome so
// same-rank orders keep the server's order.
function _scheduleActionRank_(o) {
  if (o.stalled) return 0;
  if (!o.booked_at && o.customer_ready) return 1;
  if (!o.booked_at) return 2;
  return 3;
}
function _scheduleSortFreight_(arr) {
  return arr.slice().sort((a, b) => _scheduleActionRank_(a) - _scheduleActionRank_(b));
}

// Shared: format a single order row inside a day cell.
function _scheduleRenderOrderRow_(o, opts) {
  opts = opts || {};
  // v10.9 Sable: estimated-vs-confirmed must be unmistakable. A
  // computed ground date (order_date + 2 biz days heuristic) is a
  // GUESS — amber "EST" pill. A real offered date (pick-list ship
  // date, MF delivery date) or a booked freight order is locked —
  // green "✓" so Kim/Ken can triage at a glance.
  const computed = o.ship_date_computed
    ? ' <span style="font-size:8px;font-weight:900;letter-spacing:.5px;background:rgba(255,179,0,.22);color:#FFB300;border:1px solid rgba(255,179,0,.55);padding:0 4px;border-radius:3px;vertical-align:middle">EST</span>'
    : (o.booked_at
        ? ' <span style="font-size:8px;font-weight:900;letter-spacing:.5px;background:rgba(0,200,83,.20);color:#00e676;border:1px solid rgba(0,230,118,.5);padding:0 4px;border-radius:3px;vertical-align:middle" title="Freight booked — date locked">✓</span>'
        : '');
  const priority = o.has_priority_tag ? ' <span style="font-size:9px;color:#ff5252;letter-spacing:1px;font-weight:900">⚡PRI</span>' : '';
  // v10.20: source pill — distinguishes the schedule date's origin
  // so it's never confused with freight-booked (✓) or ground
  // heuristic (EST).
  //  • cal_sourced  → on the operational calendar; show the H/P/L
  //    fulfillment-progress tri-state (H=picklist+instructions sent
  //    to warehouse, P=packed, L=labels sent) — the actual status
  //    the warehouse tracks, not just "confirmed".
  //  • js2_sourced  → legacy JS2 path, dormant now but kept for the
  //    future "Offered" lifecycle layer (green CONFIRMED / amber
  //    PLANNED by tier).
  const _hpl = (lab, on) => '<span style="font-weight:900;color:' + (on ? '#00e676' : '#5a6472') + '">' + lab + '</span>';
  const js2Pill = o.cal_sourced
    ? ' <span style="font-size:8px;font-weight:900;letter-spacing:1px;background:rgba(0,200,83,.12);border:1px solid rgba(0,230,118,.45);padding:0 5px;border-radius:3px;vertical-align:middle" title="On the operational calendar' + (o.cal_name ? ' (' + esc(o.cal_name) + ')' : '') + '. Fulfillment: H=pick list+instructions sent · P=packed · L=labels sent.' + (o.cal_label ? ' — ' + esc(o.cal_label) : '') + '">✓ ' + _hpl('H', o.cal_h) + ' ' + _hpl('P', o.cal_p) + ' ' + _hpl('L', o.cal_l) + '</span>'
    : (o.js2_sourced
        ? (o.js2_tier === 'locked'
            ? ' <span style="font-size:8px;font-weight:900;letter-spacing:.5px;background:rgba(0,200,83,.20);color:#00e676;border:1px solid rgba(0,230,118,.5);padding:0 4px;border-radius:3px;vertical-align:middle" title="JS2 ' + esc(o.js2_status || '') + ' — offered date confirmed">JS2 ✓ CONFIRMED</span>'
            : ' <span style="font-size:8px;font-weight:900;letter-spacing:.5px;background:rgba(255,179,0,.22);color:#FFB300;border:1px solid rgba(255,179,0,.55);padding:0 4px;border-radius:3px;vertical-align:middle" title="JS2 ' + esc(o.js2_status || '') + ' — planned, date may still move">JS2 ~ PLANNED</span>')
        : '');
  // v10.22 enrich: a calendar-confirmed order reads "CONFIRMED"
  // even if its underlying PackingQueue status is still pending —
  // display-only (doesn't touch o.status, so filters/sort/stall
  // logic are unaffected).
  const statusText = o.cal_sourced ? 'CONFIRMED' : String(o.status || '');
  // v10.24: calendar alert (e.g. "ND WG PAY" = customer upgraded
  // to White Glove but the WG invoice is unpaid — a ship blocker).
  const alertPill = o.cal_alert
    ? ' <span style="font-size:8px;font-weight:900;letter-spacing:.5px;background:#B71C1C;color:#fff;border:1px solid #ff5252;padding:0 4px;border-radius:3px;vertical-align:middle" title="' + esc(o.cal_alert) + '">⚠ WG UNPAID</span>'
    : '';
  // v10.16 pass 8: delta pill — NEW (appeared since last look) /
  // UPD (booked/customer-ready/stalled state moved). Cleared once
  // this render becomes the new baseline, so it self-extinguishes.
  const chgPill = o._chg === 'new'
    ? '<span style="font-size:8px;font-weight:900;letter-spacing:.5px;background:#00e676;color:#0a0a0a;padding:0 4px;border-radius:3px;margin-right:4px;vertical-align:middle" title="New since you last viewed">NEW</span>'
    : (o._chg === 'upd'
        ? '<span style="font-size:8px;font-weight:900;letter-spacing:.5px;background:#3DBEFF;color:#0a0a0a;padding:0 4px;border-radius:3px;margin-right:4px;vertical-align:middle" title="Booking / customer-ready / stall state changed since you last viewed">UPD</span>'
        : '');
  const bookerChip = _scheduleBookerChip_(o, !!opts.compact);
  const custChip = _scheduleCustomerReadyChip_(o, !!opts.compact);
  const stallChip = _scheduleStallChip_(o, !!opts.compact);
  // v10.175 Phase 0c — ShipConf chip on EVERY cabinet card (regardless
  // of view mode). 🟢 Sent / 🚫 Skipped / 🔴 Past due / 🟡 Queued / no
  // chip when arrival > outreach window or order not cabinet.
  const shipConfChip = _shipConfStatusChipHtml_(_shipConfStatusForOrder_(o));
  // v10.11 pass 3: row tap → Lookup for this order (full address,
  // items, phone, activity timeline). Chips all stopPropagation so
  // they keep their own actions. Mirrors the Tracking v9.93 pattern.
  const rowTap = ' onclick="jumpToLookup_(\'' + esc(o.order_number) + '\')" title="Tap for full order detail"';
  // v10.173 ShipConf Inbox Phase 0b — when filtering to the inbox view,
  // append a purple actions footer with Preview/Send + Skip per row.
  // Other view modes render unchanged.
  let shipConfFooter = '';
  if (_scheduleViewMode === 'shipconf_inbox' && o.source === 'cabinet'
      && _shipConfInboxMap && _shipConfInboxMap[String(o.order_number)]) {
    const item = _shipConfInboxMap[String(o.order_number)];
    const autoDate = item.auto_offered_date || '—';
    const tplKey = item.template_key || 'cc_default';
    // v10.176 — contrast pass: Zac flagged the original 10%-purple-on-
    // dark-card as unreadable. Bump background opacity, brighten label
    // text to var(--text), promote inline values to bright lavender,
    // and add top border accent so the footer reads as its own block.
    shipConfFooter = '<div style="background:rgba(186,104,200,.22);border-left:3px solid #CE93D8;border-top:1px solid rgba(206,147,216,.40);padding:8px 12px;margin-top:-4px;margin-bottom:6px;border-radius:0 0 6px 6px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;font-size:12px;color:var(--text)">'
      +   '<span style="color:#E1BEE7;font-weight:700">Auto Date: <strong style="color:#fff;font-family:\'JetBrains Mono\',monospace;background:rgba(0,0,0,.30);padding:1px 6px;border-radius:3px">' + esc(autoDate) + '</strong></span>'
      +   '<span style="color:#E1BEE7;font-weight:700">· Template: <code style="font-family:\'JetBrains Mono\',monospace;color:#fff;background:rgba(0,0,0,.30);padding:1px 6px;border-radius:3px">' + esc(tplKey) + '</code></span>'
      +   '<button onclick="event.stopPropagation();openShipConfPreviewModal(\'' + esc(o.order_number) + '\')" style="margin-left:auto;padding:7px 14px;background:linear-gradient(135deg,#CE93D8,#9C27B0);color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:900;cursor:pointer;letter-spacing:.5px;text-transform:uppercase;box-shadow:0 2px 6px rgba(0,0,0,.35);text-shadow:0 1px 2px rgba(0,0,0,.4)">📧 Preview &amp; Send</button>'
      +   '<button onclick="event.stopPropagation();openShipConfSkipModal(\'' + esc(o.order_number) + '\')" style="padding:7px 14px;background:rgba(255,255,255,.14);color:#fff;border:1px solid rgba(255,255,255,.40);border-radius:6px;font-size:11px;font-weight:800;cursor:pointer;letter-spacing:.5px">⊘ Skip</button>'
      + '</div>';
  }
  if (opts.compact) {
    // Desktop grid cell — compact two-line layout to fit a column
    return '<div' + rowTap + ' style="padding:6px 8px;background:rgba(0,0,0,.18);border-left:3px solid ' + o.carrier_color + ';border-radius:5px;margin-bottom:4px;font-size:11px;line-height:1.3;cursor:pointer">'
      + '<div style="display:flex;justify-content:space-between;gap:6px;align-items:baseline">'
      +   '<span style="font-family:\'JetBrains Mono\',monospace;font-weight:900;color:var(--text)">' + chgPill + '#' + esc(o.order_number) + '</span>'
      +   '<span style="font-size:9px;color:' + o.carrier_color + ';font-weight:800;letter-spacing:.5px;white-space:nowrap">' + esc(o.carrier_display) + computed + priority + js2Pill + alertPill + shipConfChip + '</span>'
      + '</div>'
      + '<div style="color:var(--text-dim);font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(o.customer_name || '—') + '</div>'
      + '<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:2px">'
      +   (statusText ? '<span style="font-size:9px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px">' + esc(statusText.slice(0,14)) + '</span>' : '<span></span>')
      +   '<div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end">' + stallChip + custChip + bookerChip + '</div>'
      + '</div>'
      + '</div>'
      + shipConfFooter;
  }
  // Mobile / list layout — single-line row
  return '<div' + rowTap + ' style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:rgba(0,0,0,.18);border-left:3px solid ' + o.carrier_color + ';border-radius:6px;font-size:13px;flex-wrap:wrap;cursor:pointer">'
    + '<div style="font-family:\'JetBrains Mono\',monospace;font-weight:900;color:var(--text);min-width:62px">' + chgPill + '#' + esc(o.order_number) + '</div>'
    + '<div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text)">' + esc(o.customer_name || '—') + '</div>'
    + '<div style="font-size:11px;color:' + o.carrier_color + ';font-weight:800;letter-spacing:.5px;white-space:nowrap">' + esc(o.carrier_display) + computed + priority + js2Pill + alertPill + shipConfChip + '</div>'
    + '<div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;white-space:nowrap;min-width:50px;text-align:right">' + esc(statusText.slice(0,12)) + '</div>'
    + stallChip
    + custChip
    + bookerChip
    + '</div>'
    + shipConfFooter;
}

// v10.173 ShipConf Inbox Phase 0b — Preview & Send modal.
// Fetches the rendered template via previewShipConfTemplate, lets
// operator review subject + body + recipient, then sends via the
// shadow path (or sendShipConfReal when SHIPCONF_LIVE Script Property
// is true). Honors the v10.157 R3 retry pattern + showGlobalLoader.
async function openShipConfPreviewModal(orderNumber) {
  const item = _shipConfInboxMap && _shipConfInboxMap[String(orderNumber)];
  if (!item) {
    showToast('Order not in inbox — refresh + try again');
    return;
  }
  // Remove any prior overlay first.
  const prior = document.getElementById('shipConfPreviewOverlay');
  if (prior) prior.remove();

  const ov = document.createElement('div');
  ov.id = 'shipConfPreviewOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:10010;display:flex;align-items:center;justify-content:center;padding:14px;overflow-y:auto';
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });

  const panel = document.createElement('div');
  panel.className = 'keep-dark-text';
  panel.style.cssText = 'background:#fff;border-radius:14px;padding:18px 20px;max-width:720px;width:100%;max-height:92vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,.4);display:flex;flex-direction:column;gap:12px;box-sizing:border-box';
  panel.addEventListener('click', e => e.stopPropagation());
  panel.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px">'
    + '<div style="font-family:\'Barlow Condensed\',Arial,sans-serif;font-size:22px;font-weight:900;color:#1a1a1a;text-transform:uppercase;letter-spacing:.5px">📧 Preview & Send</div>'
    + '<button onclick="document.getElementById(\'shipConfPreviewOverlay\').remove()" style="background:none;border:none;font-size:22px;color:#666;cursor:pointer">✕</button>'
    + '</div>'
    + '<div style="background:#F5F7FA;border:1px solid #ddd;border-radius:8px;padding:10px 12px;font-size:13px;color:#333">'
    +   '<div><strong>Order:</strong> #' + esc(orderNumber) + ' · ' + esc(item.customer_name || '—') + '</div>'
    +   '<div><strong>Arrival:</strong> ' + esc(item.arrival_date || '—') + ' · <strong>Auto Date:</strong> <span title="' + esc(item.auto_offered_date_explain || '') + '">' + esc(item.auto_offered_date || '—') + '</span> · <strong>Template:</strong> <code>' + esc(item.template_key) + '</code></div>'
    + '</div>'
    // v10.180 — explicit white-bg/dark-text on the To: input so
    // the dark theme's default input chrome doesn't bleed through
    // and render invisible (Zac 16:24 EDT screenshot).
    + '<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#1a1a1a"><span style="font-weight:700;min-width:60px">To:</span>'
    +   '<input type="email" id="shipConfRecipient" value="' + esc(item.customer_email || '') + '" style="flex:1;padding:8px 10px;font-size:13px;border:1.5px solid #ccc;border-radius:6px;background:#fff;color:#1a1a1a"></label>'
    // v10.180 — preview body wrapped in an iframe (sandboxed) so
    // the rendered email HTML uses its OWN clean stylesheet — none
    // of the parent dark-theme overrides or keep-dark-text rewrites
    // leak in to invert colors. iframe srcdoc'd from rendered HTML
    // after the fetch completes.
    + '<iframe id="shipConfPreviewBody" sandbox="allow-same-origin" style="width:100%;background:#fff;border:1px solid #e0e0e0;border-radius:8px;min-height:280px;max-height:380px;font-size:13px" srcdoc="<div style=&quot;font-family:Helvetica,Arial,sans-serif;color:#555;padding:14px&quot;>Loading preview&hellip;</div>"></iframe>'
    + '<div id="shipConfSendStatus" style="font-size:12px;color:#666;min-height:14px"></div>'
    + '<div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">'
    +   '<button onclick="document.getElementById(\'shipConfPreviewOverlay\').remove()" style="padding:11px 16px;background:#f5f5f5;color:#444;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer">Cancel</button>'
    +   '<button id="shipConfSendBtn" onclick="_shipConfSendClick_(\'' + esc(orderNumber) + '\')" style="padding:11px 18px;background:linear-gradient(135deg,#9C27B0,#7B1FA2);color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:900;cursor:pointer;letter-spacing:.5px;text-transform:uppercase">📧 Send</button>'
    + '</div>';
  ov.appendChild(panel);
  document.body.appendChild(ov);

  // Fetch the rendered template body.
  try {
    const res = await groundApi('previewShipConfTemplate', {
      template_key: item.template_key,
      sample_overrides: {
        customer_name: item.customer_name || '',
        order_number: orderNumber,
        arrival_date: item.arrival_date || '',
        offered_date: item.auto_offered_date || '',
        carrier: item.carrier_display || '',
      },
    });
    const body = document.getElementById('shipConfPreviewBody');
    if (res && res.ok) {
      // v10.180 — write into iframe srcdoc so the email body renders
      // with its own clean stylesheet (no dark-theme overrides).
      const docHtml = '<html><head><style>'
        + 'body{font-family:Helvetica,Arial,sans-serif;color:#1a1a1a;background:#fff;margin:0;padding:14px;font-size:13px;line-height:1.5}'
        + '.subj{font-weight:700;color:#1a1a1a;margin-bottom:8px;font-size:14px}'
        + 'hr{border:0;border-top:1px solid #e0e0e0;margin:8px 0}'
        + 'a{color:#003087}'
        + '</style></head><body>'
        + '<div class="subj">Subject: ' + esc(res.rendered_subject || '') + '</div>'
        + '<hr>'
        + (res.rendered_body_html || '<em>(empty body)</em>')
        + '</body></html>';
      body.setAttribute('srcdoc', docHtml);
    } else {
      body.setAttribute('srcdoc', '<div style="color:#c33;padding:14px;font-family:Helvetica,Arial,sans-serif">Preview failed: ' + esc(res && res.error || 'unknown') + '</div>');
    }
  } catch (err) {
    const body = document.getElementById('shipConfPreviewBody');
    if (body) body.setAttribute('srcdoc', '<div style="color:#c33;padding:14px;font-family:Helvetica,Arial,sans-serif">Preview error: ' + esc(err.message) + '</div>');
  }
}

async function _shipConfSendClick_(orderNumber) {
  const item = _shipConfInboxMap && _shipConfInboxMap[String(orderNumber)];
  if (!item) { showToast('Order not in inbox'); return; }
  const recipient = (document.getElementById('shipConfRecipient') || {}).value || '';
  const statusEl = document.getElementById('shipConfSendStatus');
  const sendBtn = document.getElementById('shipConfSendBtn');
  if (sendBtn) sendBtn.disabled = true;
  if (statusEl) statusEl.textContent = 'Sending…';
  const loader = (typeof showGlobalLoader === 'function') ? showGlobalLoader('📧 Sending Ship Conf…') : null;
  try {
    const res = await groundApi('sendShipConfReal', {
      order_number: orderNumber,
      template_key: item.template_key,
      recipient: recipient,
      customer_name: item.customer_name || '',
      arrival_date: item.arrival_date || '',
      auto_offered_date: item.auto_offered_date || '',
      operator: (function(){ try { return localStorage.getItem('mbd_ground_packer') || ''; } catch(e) { return ''; } })(),
    });
    if (loader) loader.stop();
    if (res && res.ok) {
      const isLive = res.sent === true;
      showToast(isLive ? '✓ Sent to ' + recipient : '✓ Shadow-logged (SHIPCONF_LIVE=false, no real send)');
      document.getElementById('shipConfPreviewOverlay').remove();
      // Refresh inbox so this card drops out + status-map so 🟢 Sent
      // chip appears on the card on every other view too (Phase 0c).
      if (typeof refreshShipConfInbox_ === 'function') {
        refreshShipConfInbox_().then(() => { if (_scheduleCache) paintSchedule_(_scheduleCache); });
      }
      if (typeof refreshShipConfStatusMap_ === 'function') {
        refreshShipConfStatusMap_(true).then(() => { if (_scheduleCache) paintSchedule_(_scheduleCache); });
      }
    } else {
      if (statusEl) statusEl.textContent = '⚠ ' + ((res && res.error) || 'unknown');
      if (sendBtn) sendBtn.disabled = false;
    }
  } catch (err) {
    if (loader) loader.stop();
    if (statusEl) statusEl.textContent = '⚠ ' + err.message;
    if (sendBtn) sendBtn.disabled = false;
  }
}

// v10.173 ShipConf Inbox Phase 0b — Skip modal.
function openShipConfSkipModal(orderNumber) {
  const item = _shipConfInboxMap && _shipConfInboxMap[String(orderNumber)];
  if (!item) { showToast('Order not in inbox'); return; }
  const prior = document.getElementById('shipConfSkipOverlay');
  if (prior) prior.remove();

  const ov = document.createElement('div');
  ov.id = 'shipConfSkipOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:10010;display:flex;align-items:center;justify-content:center;padding:14px';
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });

  const panel = document.createElement('div');
  panel.className = 'keep-dark-text';
  panel.style.cssText = 'background:#fff;border-radius:14px;padding:18px 20px;max-width:460px;width:100%;box-shadow:0 8px 40px rgba(0,0,0,.4);display:flex;flex-direction:column;gap:12px';
  panel.addEventListener('click', e => e.stopPropagation());

  const reasons = [
    { key: 'no_email', label: 'Customer has no email on file' },
    { key: 'contacted_directly', label: 'Already contacted directly (phone, etc)' },
    { key: 'order_cancelled', label: 'Order cancelled — escalate' },
    { key: 'other', label: 'Other (free-text)' },
  ];
  panel.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center"><div style="font-family:\'Barlow Condensed\',Arial,sans-serif;font-size:20px;font-weight:900;color:#1a1a1a;text-transform:uppercase;letter-spacing:.5px">⊘ Skip Ship Conf</div><button onclick="document.getElementById(\'shipConfSkipOverlay\').remove()" style="background:none;border:none;font-size:22px;color:#666;cursor:pointer">✕</button></div>'
    + '<div style="font-size:12px;color:#666">Order #' + esc(orderNumber) + ' · ' + esc(item.customer_name || '') + '. Marks this order as "no Ship Conf needed" — drops from the inbox.</div>'
    + '<div style="display:flex;flex-direction:column;gap:8px">'
    +   reasons.map(r => '<label style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:#fafafa;border:1.5px solid #e0e0e0;border-radius:8px;cursor:pointer"><input type="radio" name="shipConfSkipReason" value="' + r.key + '"' + (r.key === 'other' ? '' : ' checked') + ' style="width:18px;height:18px;cursor:pointer;accent-color:#9C27B0"><span style="font-size:13px;color:#1a1a1a">' + esc(r.label) + '</span></label>').join('')
    + '</div>'
    + '<textarea id="shipConfSkipNote" placeholder="Optional note (required for &quot;Other&quot;)…" style="padding:8px 10px;font-size:12px;border:1.5px solid #ccc;border-radius:6px;min-height:50px;resize:vertical;font-family:inherit"></textarea>'
    + '<div style="display:flex;gap:8px;justify-content:flex-end">'
    +   '<button onclick="document.getElementById(\'shipConfSkipOverlay\').remove()" style="padding:11px 16px;background:#f5f5f5;color:#444;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer">Cancel</button>'
    +   '<button onclick="_shipConfSkipConfirm_(\'' + esc(orderNumber) + '\')" style="padding:11px 18px;background:#666;color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:900;cursor:pointer;letter-spacing:.5px;text-transform:uppercase">⊘ Skip</button>'
    + '</div>';
  ov.appendChild(panel);
  document.body.appendChild(ov);
}

async function _shipConfSkipConfirm_(orderNumber) {
  const reasonInput = document.querySelector('input[name="shipConfSkipReason"]:checked');
  const reason = reasonInput ? reasonInput.value : 'other';
  const note = (document.getElementById('shipConfSkipNote') || {}).value || '';
  if (reason === 'other' && !note.trim()) { showToast('Note required for "Other" reason'); return; }
  const loader = (typeof showGlobalLoader === 'function') ? showGlobalLoader('Marking skipped…') : null;
  try {
    const res = await groundApi('markShipConfSkipped', {
      order_number: orderNumber,
      reason: reason,
      note: note,
      operator: (function(){ try { return localStorage.getItem('mbd_ground_packer') || ''; } catch(e) { return ''; } })(),
    });
    if (loader) loader.stop();
    if (res && res.ok) {
      showToast('✓ Skipped — ' + reason);
      const ov = document.getElementById('shipConfSkipOverlay');
      if (ov) ov.remove();
      // Refresh inbox + status-map (Phase 0c chip flips to 🚫 Skipped
      // on every Schedule card immediately, regardless of view mode).
      if (typeof refreshShipConfInbox_ === 'function') {
        refreshShipConfInbox_().then(() => { if (_scheduleCache) paintSchedule_(_scheduleCache); });
      }
      if (typeof refreshShipConfStatusMap_ === 'function') {
        refreshShipConfStatusMap_(true).then(() => { if (_scheduleCache) paintSchedule_(_scheduleCache); });
      }
    } else {
      showToast('⚠ Skip failed: ' + ((res && res.error) || 'unknown'));
    }
  } catch (err) {
    if (loader) loader.stop();
    showToast('⚠ Skip error: ' + err.message);
  }
}

// Stalled-only filter panel — taps the red "N STALLED" chip in the
// header. Lists every stalled order grouped by reason so Seth can
// triage in one sweep.
// v10.243 — stalled popup gets sub-filter chips matching the Schedule
// view-mode chips (Zac 14:02 EDT "stalled popup should have filter too").
// Keeps a module-level filter state so re-opening the popup remembers
// the user's last selection within the session.
let _stalledPopupFilter = 'all';

function setStalledPopupFilter(key) {
  _stalledPopupFilter = key || 'all';
  // Re-render the popup body without recreating the whole overlay so
  // the user's scroll position survives chip taps.
  const body = document.getElementById('stalledPopupBody');
  if (body && body.dataset.allStalledJson) {
    _renderStalledPopupBody_(JSON.parse(body.dataset.allStalledJson));
  }
}

function _renderStalledPopupBody_(stalled) {
  const body = document.getElementById('stalledPopupBody');
  if (!body) return;
  const filter = _stalledPopupFilter || 'all';
  const matching = filter === 'all'
    ? stalled
    : stalled.filter(o => (o.stall_reasons || []).indexOf(filter) !== -1);
  // Group by primary reason for triage clarity.
  const byReason = {};
  matching.forEach(o => {
    const r = (o.stall_reasons || ['other'])[0];
    if (!byReason[r]) byReason[r] = [];
    byReason[r].push(o);
  });
  if (!matching.length) {
    body.innerHTML = '<div style="padding:24px;text-align:center;color:#9AAAC0;font-size:13px;background:rgba(255,255,255,.03);border:1px dashed rgba(255,255,255,.15);border-radius:10px">No stalled orders match the <strong>' + esc(filter) + '</strong> filter. Try another chip above.</div>';
    return;
  }
  body.innerHTML = Object.keys(byReason).map(r => {
    const label = SCHEDULE_STALL_DESCRIPTIONS[r] || r;
    return '<div style="margin-bottom:14px"><div style="font-family:\'Barlow Condensed\',Arial,sans-serif;font-size:12px;font-weight:900;color:#ff5252;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">⚠ ' + esc(label) + ' (' + byReason[r].length + ')</div>'
      + byReason[r].map(o => '<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:rgba(255,82,82,.06);border-left:3px solid #ff5252;border-radius:6px;font-size:13px;color:#fff;margin-bottom:4px">'
          + '<span style="font-family:\'JetBrains Mono\',monospace;font-weight:900;min-width:60px">#' + esc(o.order_number) + '</span>'
          + '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(o.customer_name || '—') + '</span>'
          + '<span style="font-size:10px;color:#9AAAC0">' + esc(o.ship_date) + '</span>'
          + '<span style="font-size:9px;color:' + (o.carrier_color || '#888') + ';font-weight:800;letter-spacing:.5px">' + esc(o.carrier_display) + '</span>'
        + '</div>').join('')
      + '</div>';
  }).join('');
}

async function openStalledList() {
  const cache = await _ensureScheduleCache_();
  if (!cache || !cache.days) { showToast('Schedule data unavailable — check connection'); return; }
  const stalled = [];
  cache.days.forEach(d => {
    (d.orders || []).forEach(o => { if (o.stalled) stalled.push(o); });
  });
  if (!stalled.length) { showToast('No stalled orders'); return; }

  // v10.243 — per-reason counts for the filter-chip bar in the header.
  // Each order can have multiple stall reasons; chips show how many
  // orders match each reason (not summed — same as the inline view).
  const reasonCounts = { all: stalled.length, past_ship_date: 0, needs_booking: 0, awaiting_customer_confirm: 0, missing_instructions: 0 };
  stalled.forEach(o => {
    (o.stall_reasons || []).forEach(r => { if (reasonCounts[r] != null) reasonCounts[r]++; });
  });
  const REASONS = [
    { key: 'all',                        label: 'Any',             color: '#FF5252' },
    { key: 'past_ship_date',             label: 'Past Due',        color: '#ff5252' },
    { key: 'needs_booking',              label: 'Needs Booking',   color: '#FFB300' },
    { key: 'awaiting_customer_confirm',  label: 'Needs Customer',  color: '#42a5f5' },
    { key: 'missing_instructions',       label: 'No Instructions', color: '#ab47bc' },
  ];
  const chipBar = REASONS.map(r => {
    const active = r.key === (_stalledPopupFilter || 'all');
    const n = reasonCounts[r.key] || 0;
    if (n === 0 && r.key !== 'all') return '';
    return '<button onclick="setStalledPopupFilter(\'' + r.key + '\')" style="display:inline-flex;align-items:center;gap:5px;padding:5px 11px;border-radius:999px;font-size:11px;font-weight:800;letter-spacing:.4px;cursor:pointer;text-transform:uppercase;border:1px solid ' + r.color + (active ? ';background:' + r.color + ';color:#0a0a0a' : '88;background:transparent;color:' + r.color) + '">'
      + esc(r.label)
      + '<span style="font-size:10px;font-weight:900;opacity:.85;background:rgba(0,0,0,' + (active ? '.18' : '0') + ');padding:0 5px;border-radius:999px">' + n + '</span>'
      + '</button>';
  }).join(' ');

  const ov = document.createElement('div');
  ov.id = 'stalledListOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:10000;display:flex;align-items:flex-end;justify-content:center';
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };

  ov.innerHTML =
    '<div onclick="event.stopPropagation()" style="background:#1a1a1a;color:#fff;width:100%;max-width:680px;max-height:85vh;border-radius:14px 14px 0 0;padding:18px 18px 24px;overflow-y:auto;box-shadow:0 -4px 24px rgba(0,0,0,.6);border-top:2px solid #ff5252">'
    + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px"><div style="font-family:\'Barlow Condensed\',Arial,sans-serif;font-size:24px;font-weight:900;letter-spacing:.5px;text-transform:uppercase">⚠ ' + stalled.length + ' Stalled</div><button onclick="document.getElementById(\'stalledListOverlay\').remove()" style="background:none;border:none;color:#999;font-size:24px;cursor:pointer;padding:0 4px">✕</button></div>'
    + '<div style="font-size:12px;color:#9AAAC0;margin-bottom:10px">Orders flagged for pipeline review — past ship date, missing booking, missing PDF, or waiting on customer confirmation.</div>'
    // v10.243: filter chips
    + '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;padding:6px 10px;background:rgba(255,82,82,.06);border:1px dashed rgba(255,82,82,.4);border-radius:8px"><span style="font-size:10px;color:#FF5252;font-weight:900;letter-spacing:1px;align-self:center;margin-right:4px">FILTER →</span>' + chipBar + '</div>'
    + '<div id="stalledPopupBody"></div>'
    + '<button onclick="document.getElementById(\'stalledListOverlay\').remove()" style="width:100%;margin-top:8px;padding:12px;background:#2a2a2a;color:#aaa;border:1px solid #444;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer">Close</button>'
    + '</div>';
  document.body.appendChild(ov);
  // Stash the full stalled list on the body element so chip taps can
  // re-render without re-fetching the schedule cache.
  const body = document.getElementById('stalledPopupBody');
  if (body) body.dataset.allStalledJson = JSON.stringify(stalled);
  _renderStalledPopupBody_(stalled);
}

// v10.17 pass 9: Kim's flat "to book" worklist. The calendar shows
// WHEN; Kim's actual job is WHAT to book now, and she books by
// carrier in one portal session — so group by carrier, sort each
// group by ship date (most urgent first). Mirrors openStalledList /
// openAwaitingCustomerList (the Seth / Ken panels); this is the
// missing third. Tapping a row jumps straight to the booker modal.
async function openNeedsBookingList() {
  const cache = await _ensureScheduleCache_();
  if (!cache || !cache.days) { showToast('Schedule data unavailable — check connection'); return; }
  const need = [];
  cache.days.forEach(d => (d.orders || []).forEach(o => {
    if (_scheduleOrderMatchesMode_(o, 'needs_booking')) need.push(o);
  }));
  if (!need.length) { showToast('Nothing to book — all freight is booked'); return; }

  const byCarrier = {};
  need.forEach(o => {
    const c = o.carrier_display || 'TBD';
    if (!byCarrier[c]) byCarrier[c] = [];
    byCarrier[c].push(o);
  });
  // Carrier groups alphabetical; within a carrier, soonest ship first.
  const carrierNames = Object.keys(byCarrier).sort();
  carrierNames.forEach(c => byCarrier[c].sort((a, b) => String(a.ship_date).localeCompare(String(b.ship_date))));

  const ov = document.createElement('div');
  ov.id = 'needsBookingOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:10000;display:flex;align-items:flex-end;justify-content:center';
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  const body = carrierNames.map(c => {
    const color = (byCarrier[c][0] && byCarrier[c][0].carrier_color) || '#FFB300';
    return '<div style="margin-bottom:14px"><div style="font-family:\'Barlow Condensed\',Arial,sans-serif;font-size:13px;font-weight:900;color:' + color + ';text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">' + esc(c) + ' (' + byCarrier[c].length + ')</div>'
      + byCarrier[c].map(o => {
          const cust = o.customer_ready ? '' : '<span style="font-size:9px;font-weight:900;color:#3DBEFF;letter-spacing:.5px;margin-left:6px" title="Customer not yet confirmed">CUST?</span>';
          const stall = o.stalled ? '<span style="font-size:9px;font-weight:900;color:#ff5252;letter-spacing:.5px;margin-left:6px">⚠</span>' : '';
          const tap = "document.getElementById('needsBookingOverlay').remove();openScheduleBookerModal('" + esc(o.order_number) + "','" + esc(o.booker || '') + "',false)";
          return '<div onclick="' + tap + '" style="display:flex;align-items:center;gap:10px;padding:9px 10px;background:rgba(255,179,0,.07);border-left:3px solid ' + color + ';border-radius:6px;font-size:13px;color:#fff;margin-bottom:4px;cursor:pointer" title="Tap to assign / mark booked">'
            + '<span style="font-family:\'JetBrains Mono\',monospace;font-weight:900;min-width:60px">#' + esc(o.order_number) + '</span>'
            + '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(o.customer_name || '—') + cust + stall + '</span>'
            + '<span style="font-size:10px;color:#9AAAC0;white-space:nowrap">' + esc(o.ship_date) + '</span>'
            + (o.booker ? '<span style="font-size:9px;color:#FFB300;font-weight:800;letter-spacing:.5px;white-space:nowrap" title="Assigned booker">👤 ' + esc(o.booker) + '</span>' : '')
          + '</div>';
        }).join('')
      + '</div>';
  }).join('');

  ov.innerHTML =
    '<div onclick="event.stopPropagation()" style="background:#1a1a1a;color:#fff;width:100%;max-width:680px;max-height:85vh;border-radius:14px 14px 0 0;padding:18px 18px 24px;overflow-y:auto;box-shadow:0 -4px 24px rgba(0,0,0,.6);border-top:2px solid #FFB300">'
    + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px"><div style="font-family:\'Barlow Condensed\',Arial,sans-serif;font-size:24px;font-weight:900;letter-spacing:.5px;text-transform:uppercase">📋 ' + need.length + ' To Book</div><button onclick="document.getElementById(\'needsBookingOverlay\').remove()" style="background:none;border:none;color:#999;font-size:24px;cursor:pointer;padding:0 4px">✕</button></div>'
    + '<div style="font-size:12px;color:#9AAAC0;margin-bottom:14px">Freight not yet booked, grouped by carrier so you can book a whole portal session at once. Soonest ship date first. <span style="color:#3DBEFF">CUST?</span> = customer not yet confirmed.</div>'
    + body
    + '<button onclick="document.getElementById(\'needsBookingOverlay\').remove()" style="width:100%;margin-top:8px;padding:12px;background:#2a2a2a;color:#aaa;border:1px solid #444;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer">Close</button>'
    + '</div>';
  document.body.appendChild(ov);
}

// ── "How Bedrock Works" — in-app architecture/orientation page ─
// Plain-language for the team (Seth/Norm/Kim/Jonah/CS), not eng.
// How an order flows today + the spine we're building + live
// pillar status. Pure additive; reads nothing, breaks nothing.
function openHowItWorks() {
  const prior = document.getElementById('howItWorksOverlay');
  if (prior) prior.remove();
  const ov = document.createElement('div');
  ov.id = 'howItWorksOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:10000;display:flex;align-items:flex-end;justify-content:center;overscroll-behavior:contain';
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  const H = (t) => '<div style="font-family:\'Barlow Condensed\',Arial,sans-serif;font-size:18px;font-weight:900;color:#fff;text-transform:uppercase;letter-spacing:.5px;margin:18px 0 8px">' + t + '</div>';
  const P = (t) => '<div style="font-size:13px;line-height:1.55;color:#C7D2E0;margin-bottom:8px">' + t + '</div>';
  const step = (n, t, d) => '<div style="display:flex;gap:10px;margin-bottom:8px"><div style="flex:0 0 22px;height:22px;border-radius:50%;background:rgba(66,165,245,.18);color:#5BB3FF;font-weight:900;font-size:12px;display:flex;align-items:center;justify-content:center">' + n + '</div><div style="flex:1;font-size:13px;line-height:1.5;color:#C7D2E0"><b style="color:#fff">' + t + '</b> — ' + d + '</div></div>';
  const pill = (state, label, detail) => {
    const c = state === 'live' ? ['#00C853', 'rgba(0,200,83,.14)', 'LIVE'] : state === 'safe' ? ['#42a5f5', 'rgba(66,165,245,.14)', 'SHIPPED'] : ['#FFB300', 'rgba(255,179,0,.14)', 'GATED'];
    return '<div style="display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.07)">'
      + '<span style="flex:0 0 64px;text-align:center;font-size:10px;font-weight:900;letter-spacing:.5px;color:' + c[0] + ';background:' + c[1] + ';border:1px solid ' + c[0] + '55;border-radius:999px;padding:3px 0">' + c[2] + '</span>'
      + '<div style="flex:1;font-size:12.5px;line-height:1.5;color:#C7D2E0"><b style="color:#fff">' + label + '</b> — ' + detail + '</div></div>';
  };
  ov.innerHTML = '<div onclick="event.stopPropagation()" style="background:#14181F;color:#fff;width:100%;max-width:760px;max-height:90vh;border-radius:16px 16px 0 0;padding:20px 20px 28px;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;box-shadow:0 -4px 24px rgba(0,0,0,.6);border-top:2px solid #2a3340">'
    + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">'
    +   '<div style="font-family:\'Barlow Condensed\',Arial,sans-serif;font-size:26px;font-weight:900;letter-spacing:.5px;text-transform:uppercase">How Bedrock Works</div>'
    +   '<button onclick="document.getElementById(\'howItWorksOverlay\').remove()" style="background:none;border:none;color:#9AAAC0;font-size:26px;cursor:pointer;padding:4px 8px;min-height:40px">✕</button>'
    + '</div>'
    + '<div style="font-size:12px;color:#7E8CA0;margin-bottom:6px">Plain-language map of how an order moves through Bedrock today + what each surface does. Updated through v10.231 (2026-05-23).</div>'

    + H('An order today, start → ship')
    + step(1, 'Schedule', 'Upcoming freight/cabinet shipments by day; a carrier on the calendar means it\'s booked. Kim works the to-book list (📋 N TO BOOK chip shows per-carrier breakdown on hover), taps an order to open a FedEx Freight quote and book in two clicks. Stalled view has sub-filter chips (Past Due / Needs Booking / Needs Customer / No Instructions). 14-day lookback keeps past-due cabinets visible.')
    + step(2, 'Cabinets / Ground', 'Cabinet shipments arrive as PICK LIST emails (parsed into Cabinets receive list); ground orders import from ShipStation. Cabinets search surfaces ARCH-announced future cabinets ("📅 Arriving Week of MMM D") before the truck lands. Damaged cabinets hide from pulls automatically.')
    + step(3, 'Pre-Pack', 'Zoe builds the hardware box the day before, scan-verified with haptic/audio feedback. 4×6 OPEN-ME-FIRST label auto-prints. Pre-Pack status line surfaces 🔥 past-due count.')
    + step(4, 'Pack', 'Packer scans every item; a second checker re-scans (catches mistakes before they ship). Photos + freight booking. EOS banner has tap-to-jump + release-claim buttons for end-of-shift cleanup. Card body is full-area-tappable for mobile.')
    + step(5, 'Ship', 'Label is bought, ShipStation + Shopify told, customer gets tracking. View cost in ShipStation V2 Shipments tab (V1\'s Rate column is blank for Bedrock by design).')
    + step(6, 'Lookup / Tracking / Remakes / Damage', 'CS answers "where\'s my order" (phone fields auto-tel, address fields auto-Map), files a 🚨 customer-damage report with photo uploads + carrier-claim tracking, sends replacement parts.')

    + H('Ops surfaces (More menu ⋯)')
    + pill('live', '📦 Tracking', 'Recent shipments across all sources for CS escalations.')
    + pill('live', '🔧 Remakes', 'Structured replacement-part log + 🚨 Report Customer Damage flow with photo uploads + carrier-claim tracking. Auto-sort by age (stuck first). Carrier-claims roll-up banner at top (Jessica\'s CS-VP view).')
    + pill('live', '🔨 Damage Log', 'Open damage records w/ due-date filter chips (Overdue / 7 days / 30 days / No date) — Seth\'s "due this week" view.')
    + pill('live', '📝 Email Templates', 'WYSIWYG editor (Quill). Mail-merge variables as tap-to-insert chips. Live preview with sample data substituted. Auto-Slack diff to #claude_bedrock on every save.')
    + pill('live', '🚦 Holds', 'Orders blocked from packing — Beacon / manual / cabinet. NEW: 🗑 Delete (PIN) permanently clears stale holds.')
    + pill('live', '🏭 Manufacturing', 'NEW Phase 0: cabinet jobs through the 5-stage CNC pipeline (CNC → Denester → 6-Drill → Edgebander → Stacker). Intake form + sign-off pills (Designer + Ops-PIN) + stage advance. Status boards Phase 4+.')
    + pill('live', '🧬 Pick-List BOM', 'NEW 3-mode panel from PickList migration: BOM Expand (bundle SKU → flat elements), Variant Resolve (Shopify variant SKU → walks variant map + recursive BOM → flat element list), Admin (4 ingest buttons to re-sync from Kristine\'s sheet).')
    + pill('live', '📑 Purchase Orders', 'NEW Odoo-style PO emailer: reorder needs grouped by vendor (sorted by qty desc), drill into vendor → editable qty rows → preview composed PO body → send via Gmail or mailto.')
    + pill('live', '✅ Customer Ready', 'NEW shadow-log inspector. Reads CustomerReady tab + shows composed body preview on tap. CUSTREADY_LIVE flag gates real sends (currently off).')

    + H('Stock tab')
    + P('Element-level inventory + locations. Cloud-synced via StockSync.js (v10.213) — local-first, syncs to PickListBundleBOM after every save (10s debounce). 🔍 SKU / 📍 Location toggle at top (per-device persisted). Locations section has dropdown for aisle/bay (266 standard bins + HDWR zone + custom). Per-row tap → batch-count modal pinned to location (scan + qty + status). Per-item card: tap a location row to re-count or edit qty/status/move. Print Location Labels modal w/ "+ bay" inline-add per aisle.')

    + H('FedEx Freight quote → book (live)')
    + P('From any cabinet/freight order, tap "📦 Get FedEx Quote" → review rates across both MBD accounts → pick service → Book. Two-click confirm; pickup is a separate opt-in. BOL (×4) + landscape order-# label sheet (×2) auto-print via PrintNode.')

    + H('What\'s pending design + build')
    + pill('safe', '📋 Shipping Confirmation Phase 1+', 'Shadow infrastructure live (Phases 0a-0d). Phase 1 (real customer sends) waits on Zac flipping SHIPCONF_LIVE Script Property.')
    + pill('safe', '✅ Customer Ready Phase 2+', 'Phase 1 scaffold + inspector live. Phase 2 (auto-trigger + GmailApp send + pick-list PDF + Calendar event) waits on ShipConf-live + customer-response webhook.')
    + pill('safe', '🧬 PickList Phase 4-5', 'Phases 0-3 done (BOM / Variant Map / Per-warehouse inventory / Purchase Orders). Phase 4 (Shopify-webhook-driven order commitment + Ground bridge) and Phase 5 (multi-warehouse routing) pending.')
    + pill('safe', '🏭 Manufacturing Phase 1+', 'Phase 0 intake live. Phase 1 (Shopify diff for the auto-check sign-off) + Phase 4 (status boards for warehouse/office TVs) pending.')
    + pill('gated', '💸 Multi-carrier parcel quote', 'UPS + FedEx + USPS rate compare. Needs carrier-API credentials + Zac at the keyboard (real money).')
    + pill('gated', '🔒 Hardware QR scan-to-verify', 'HW box QR scanned during pack. Risky to ship unattended because it modifies the production HW box label format.')
    + pill('gated', '☁ GAS Phase 1 — Cloudflare Workers', 'Move off Apps Script as primary backend. Zac queued for a separate focused session.')

    + '<div style="margin-top:16px;font-size:11px;color:#5E6A7E;line-height:1.5">Bedrock builds additively and reversibly — nothing risky happens without explicit sign-off. Design docs live in <code style="color:#8FA3BD">docs/VISION.md</code> · <code style="color:#8FA3BD">docs/SHIPPING_CONFIRMATION.md</code> · <code style="color:#8FA3BD">docs/CUSTOMER_READY.md</code> · <code style="color:#8FA3BD">docs/EMAIL_TEMPLATES_EDITOR.md</code>.</div>'
    + '<button onclick="document.getElementById(\'howItWorksOverlay\').remove()" style="width:100%;margin-top:18px;padding:14px;background:#1f2630;color:#C7D2E0;border:none;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer">Close</button>'
    + '</div>';
  document.body.appendChild(ov);
}

// ── Carrier editor ───────────────────────────────────────────
// Edit carrier display name + color + active. Persists to the
// Rulebook 'carriers' tab via the manager-PIN-gated saveCarriers
// endpoint; the Schedule reads colors from there.
let _carrierEditorRows = [];

function _hexForPicker_(c) {
  c = String(c || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(c) ? c : '#666666';
}

async function openCarrierEditor() {
  const prior = document.getElementById('carrierEditorOverlay');
  if (prior) prior.remove();
  const ov = document.createElement('div');
  ov.id = 'carrierEditorOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:10000;display:flex;align-items:flex-end;justify-content:center';
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  ov.innerHTML = '<div onclick="event.stopPropagation()" style="background:#1a1a1a;color:#fff;width:100%;max-width:680px;max-height:88vh;border-radius:14px 14px 0 0;padding:18px 18px 24px;overflow-y:auto;box-shadow:0 -4px 24px rgba(0,0,0,.6);border-top:2px solid #888"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px"><div style="font-family:\'Barlow Condensed\',Arial,sans-serif;font-size:24px;font-weight:900;letter-spacing:.5px;text-transform:uppercase">Carriers</div><button onclick="document.getElementById(\'carrierEditorOverlay\').remove()" style="background:none;border:none;color:#999;font-size:24px;cursor:pointer;padding:0 4px">✕</button></div><div id="carrierEditorBody" style="font-size:13px;color:#9AAAC0;padding:24px;text-align:center">Loading…</div></div>';
  document.body.appendChild(ov);
  try {
    const res = await groundApi('listCarriers', {});
    if (!res || !res.ok) { const b = document.getElementById('carrierEditorBody'); if (b) b.textContent = 'Error: ' + ((res && res.error) || 'unknown'); return; }
    _carrierEditorRows = res.carriers || [];
    _renderCarrierEditor_();
  } catch (e) {
    const b = document.getElementById('carrierEditorBody'); if (b) b.textContent = 'Error: ' + e.message;
  }
}

function _renderCarrierEditor_() {
  const b = document.getElementById('carrierEditorBody');
  if (!b) return;
  const rowsHtml = _carrierEditorRows.map((c, i) =>
    '<div style="display:flex;align-items:center;gap:8px;padding:7px 4px;border-bottom:1px solid rgba(255,255,255,.07)">'
    + '<input type="color" id="ced_color_' + i + '" value="' + _hexForPicker_(c.color) + '" style="width:34px;height:30px;padding:0;border:1px solid #444;border-radius:6px;background:transparent;cursor:pointer">'
    + '<input type="text" id="ced_name_' + i + '" value="' + esc(String(c.display_name || '')) + '" style="flex:1;min-width:0;padding:7px 9px;border-radius:7px;border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.25);color:#fff;font-size:13px">'
    + '<span style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#667;min-width:92px;text-align:right" title="carrier_key (not editable)">' + esc(String(c.carrier_key || '')) + '</span>'
    + '<label style="display:inline-flex;align-items:center;gap:4px;font-size:10px;color:#9AAAC0;text-transform:uppercase;letter-spacing:.5px;cursor:pointer"><input type="checkbox" id="ced_active_' + i + '" ' + (c.active !== false ? 'checked' : '') + ' style="width:15px;height:15px;accent-color:#00e676">On</label>'
    + '</div>'
  ).join('');
  b.style.cssText = '';
  b.innerHTML =
    '<div style="font-size:12px;color:#9AAAC0;margin-bottom:10px">Edit name + color, toggle active. Colors drive the Schedule legend, row borders & labels. Saving requires the manager PIN.</div>'
    + rowsHtml
    + '<div style="margin-top:14px;padding-top:12px;border-top:1px dashed rgba(255,255,255,.18)"><div style="font-size:11px;font-weight:900;color:#9AAAC0;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Add carrier</div>'
    + '<div style="display:flex;align-items:center;gap:8px">'
    + '<input type="color" id="ced_add_color" value="#666666" style="width:34px;height:30px;padding:0;border:1px solid #444;border-radius:6px;background:transparent;cursor:pointer">'
    + '<input type="text" id="ced_add_name" placeholder="Display name (e.g. Old Dominion)" style="flex:1;min-width:0;padding:7px 9px;border-radius:7px;border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.25);color:#fff;font-size:13px">'
    + '<input type="text" id="ced_add_key" placeholder="key e.g. old_dominion" style="width:160px;padding:7px 9px;border-radius:7px;border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.25);color:#fff;font-size:12px;font-family:\'JetBrains Mono\',monospace">'
    + '</div></div>'
    + '<button onclick="saveCarrierEdits_()" style="width:100%;margin-top:16px;padding:13px;background:linear-gradient(135deg,#00C853,#1A5C1A);color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:900;letter-spacing:.5px;cursor:pointer">Save (Manager PIN)</button>';
}

async function saveCarrierEdits_() {
  const pin = promptManagerPin_('save carriers');
  if (!pin) return;
  const val = (id) => { const el = document.getElementById(id); return el ? el.value : null; };
  const edits = _carrierEditorRows.map((c, i) => ({
    carrier_key: c.carrier_key,
    display_name: val('ced_name_' + i),
    color: val('ced_color_' + i),
    active: !!(document.getElementById('ced_active_' + i) || {}).checked,
  }));
  const adds = [];
  const ak = val('ced_add_key'), an = val('ced_add_name'), ac = val('ced_add_color');
  if (ak && an) adds.push({ carrier_key: ak, display_name: an, color: ac });
  try {
    const res = await groundApi('saveCarriers', { manager_pin: pin, edits: edits, adds: adds });
    if (!res || !res.ok) { showToast('Save failed: ' + ((res && res.error) || 'unknown')); return; }
    showToast('✓ Carriers saved' + (res.touched ? ' (' + res.touched.length + ')' : ''));
    const ov = document.getElementById('carrierEditorOverlay'); if (ov) ov.remove();
    if (typeof refreshScheduleTab === 'function') refreshScheduleTab();
  } catch (e) { showToast('Save error: ' + e.message); }
}

// ── Freight-defaults editor (P1.4) ───────────────────────────
// Search a SKU → edit weight/dims/parts/class/links → save
// (manager-PIN). Writes to Supabase freight_defaults. Dataset is
// ~749+ rows so it's search-driven, never list-all.
let _freightEditorRows = [];

function openFreightDefaultsEditor() {
  const prior = document.getElementById('freightDefEditorOverlay');
  if (prior) prior.remove();
  const ov = document.createElement('div');
  ov.id = 'freightDefEditorOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:10000;display:flex;align-items:flex-end;justify-content:center;overscroll-behavior:contain';
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  ov.innerHTML = '<div onclick="event.stopPropagation()" style="background:#1a1a1a;color:#fff;width:100%;max-width:760px;max-height:88vh;border-radius:14px 14px 0 0;padding:18px 18px 24px;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;box-shadow:0 -4px 24px rgba(0,0,0,.6);border-top:2px solid #888">'
    + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px"><div style="font-family:\'Barlow Condensed\',Arial,sans-serif;font-size:24px;font-weight:900;letter-spacing:.5px;text-transform:uppercase">Freight Defaults</div><button onclick="document.getElementById(\'freightDefEditorOverlay\').remove()" style="background:none;border:none;color:#999;font-size:24px;cursor:pointer;padding:0 4px">✕</button></div>'
    + '<div style="font-size:12px;color:#9AAAC0;margin-bottom:10px">Search a SKU (≥2 chars), edit weight / dims / parts / class / links, Save (manager PIN). Writes to the Bedrock store (Supabase) — overrides the sheet.</div>'
    + '<div style="display:flex;gap:8px;margin-bottom:12px"><input type="text" id="fde_q" placeholder="SKU search (e.g. QBOAZ)" oninput="_fdeSearchDebounced_()" style="flex:1;padding:9px 11px;border-radius:8px;border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.25);color:#fff;font-size:14px"></div>'
    + '<div id="fde_results" style="font-size:13px;color:#9AAAC0">Type a SKU to search…</div>'
    + '</div>';
  document.body.appendChild(ov);
  setTimeout(() => { const i = document.getElementById('fde_q'); if (i) i.focus(); }, 80);
}

let _fdeTimer = null;
function _fdeSearchDebounced_() {
  clearTimeout(_fdeTimer);
  _fdeTimer = setTimeout(_fdeSearch_, 320);
}

// "Add «query» as a new SKU" — server saveFreightDefault is an
// upsert keyed on sku, so creating is just a blank editable row.
// Lets the manager capture an unmapped SKU on the spot (the
// "ask + remember unmapped SKUs" need) without waiting on a
// migration/suggester.
function _fdeAddNew_() {
  const q = ((document.getElementById('fde_q') || {}).value || '').trim().toUpperCase();
  if (q.length < 2) { showToast('Type the full SKU first (≥2 chars)'); return; }
  if (_freightEditorRows.some(r => String(r.sku).toUpperCase() === q)) { showToast('Already listed — edit it below'); return; }
  _freightEditorRows.unshift({ sku: q, weightLbs: '', heightIn: '', lengthIn: '', widthIn: '', parts: '', freightClass: '', fileLink: '', pdfUrl: '', source: 'new' });
  _fdeRender_('manual-add');
}

function _fdeAddBtn_() {
  return '<button onclick="_fdeAddNew_()" style="padding:6px 12px;border-radius:7px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.06);color:#cfe;font-size:12px;font-weight:800;cursor:pointer">➕ Add this SKU as new</button>';
}

function _fdeRender_(source) {
  const b2 = document.getElementById('fde_results');
  if (!b2) return;
  if (!_freightEditorRows.length) {
    b2.innerHTML = '<div style="padding:14px;color:#888">No SKUs match. ' + _fdeAddBtn_() + '</div>';
    return;
  }
  const num = (v) => (v == null ? '' : v);
  const capped = _freightEditorRows.length >= 200;
  b2.innerHTML = (capped ? '<div style="background:#3a2a00;border:1px solid #E8A33D;color:#FFD27A;font-size:11px;padding:6px 9px;border-radius:6px;margin-bottom:6px">⚠ Showing the first 200 matches (max). Some variants may be hidden — type more of the SKU (e.g. add the size/color or <b>V2</b>) to narrow it.</div>' : '')
    + '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px"><div style="font-size:11px;color:#667">' + _freightEditorRows.length + ' row' + (_freightEditorRows.length === 1 ? '' : 's') + (capped ? '+' : '') + ' · source: ' + esc(source || '?') + '</div>' + _fdeAddBtn_() + '</div>'
    + '<div style="background:rgba(80,120,255,.10);border:1px solid rgba(120,150,255,.35);border-radius:8px;padding:8px 10px;margin-bottom:10px">'
    +   '<div style="font-size:10px;color:#9DB4FF;font-weight:800;letter-spacing:.5px;text-transform:uppercase;margin-bottom:6px">Bulk-apply to all ' + _freightEditorRows.length + ' shown <span style="color:#667;font-weight:400;text-transform:none">— height left per-row; blank = don\'t change</span></div>'
    +   '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">'
    +     '<label style="font-size:10px;color:#9AAAC0">L <input type="number" id="fde_bulk_L" placeholder="91" style="width:60px;padding:5px 6px;border-radius:6px;border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.25);color:#fff;font-size:12px"></label>'
    +     '<label style="font-size:10px;color:#9AAAC0">W <input type="number" id="fde_bulk_W" placeholder="35" style="width:60px;padding:5px 6px;border-radius:6px;border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.25);color:#fff;font-size:12px"></label>'
    +     '<label style="font-size:10px;color:#9AAAC0">Class <input type="text" id="fde_bulk_C" placeholder="auto" style="width:54px;padding:5px 6px;border-radius:6px;border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.25);color:#fff;font-size:12px"></label>'
    +     '<button onclick="_fdeBulkApply_()" style="padding:6px 12px;border-radius:7px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.06);color:#cfe;font-size:12px;font-weight:800;cursor:pointer">Apply to all ' + _freightEditorRows.length + '</button>'
    +     '<button onclick="_fdeBulkSave_()" style="padding:6px 12px;border-radius:7px;border:none;background:linear-gradient(135deg,#2962FF,#0D2B8C);color:#fff;font-size:12px;font-weight:900;cursor:pointer">💾 Save all ' + _freightEditorRows.length + ' (PIN)</button>'
    +   '</div>'
    + '</div>'
    + _freightEditorRows.map((r, i) =>
      '<div style="border-bottom:1px solid rgba(255,255,255,.07);padding:8px 4px">'
      + '<div style="font-family:\'JetBrains Mono\',monospace;font-weight:900;font-size:12px;color:' + (r.source === 'new' ? '#7CFFB2' : '#fff') + ';margin-bottom:5px">' + esc(String(r.sku)) + (r.source === 'new' ? '  · NEW' : '') + '</div>'
      + '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">'
      + ['weightLbs:Wt(lb)', 'heightIn:H', 'lengthIn:L', 'widthIn:W', 'parts:#Parts'].map(p => { const [k, lab] = p.split(':'); return '<label style="font-size:10px;color:#9AAAC0">' + lab + ' <input type="number" id="fde_' + k + '_' + i + '" value="' + num(r[k]) + '" style="width:64px;padding:5px 6px;border-radius:6px;border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.25);color:#fff;font-size:12px"></label>'; }).join('')
      + '<label style="font-size:10px;color:#9AAAC0">Class <input type="text" id="fde_freightClass_' + i + '" value="' + esc(num(r.freightClass)) + '" placeholder="auto" style="width:54px;padding:5px 6px;border-radius:6px;border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.25);color:#fff;font-size:12px"></label>'
      + '<button onclick="_fdeSave_(' + i + ')" style="padding:6px 12px;border-radius:7px;border:none;background:linear-gradient(135deg,#00C853,#1A5C1A);color:#fff;font-size:12px;font-weight:900;cursor:pointer">Save</button>'
      + '</div></div>'
    ).join('');
}

let _fdeSearchToken = 0;
async function _fdeSearch_() {
  const q = (document.getElementById('fde_q') || {}).value || '';
  const box = document.getElementById('fde_results');
  if (!box) return;
  if (q.trim().length < 2) { box.textContent = 'Type ≥2 chars of a SKU…'; return; }
  const myToken = ++_fdeSearchToken;
  box.innerHTML = '<div style="padding:10px;color:#9AAAC0">Searching… &nbsp; ' + _fdeAddBtn_() + '</div>';
  const watchdog = setTimeout(() => {
    if (myToken !== _fdeSearchToken) return;
    const b = document.getElementById('fde_results');
    if (b) b.innerHTML = '<div style="padding:12px;color:#E8A33D">Search timed out (server slow). <button onclick="_fdeSearch_()" style="padding:5px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.06);color:#fff;font-size:12px;cursor:pointer">Retry</button> &nbsp; ' + _fdeAddBtn_() + '</div>';
  }, 9000);
  try {
    const res = await groundApi('listFreightDefaults', { q: q, limit: 200 });
    clearTimeout(watchdog);
    if (myToken !== _fdeSearchToken) return; // a newer keystroke superseded this
    if (!res || !res.ok) { const be = document.getElementById('fde_results'); if (be) be.innerHTML = '<div style="padding:12px;color:#E8657A">Error: ' + esc((res && res.error) || 'unknown') + ' &nbsp; ' + _fdeAddBtn_() + '</div>'; return; }
    _freightEditorRows = res.rows || [];
    _fdeRender_(res.source);
  } catch (e) {
    clearTimeout(watchdog);
    if (myToken !== _fdeSearchToken) return;
    const b3 = document.getElementById('fde_results'); if (b3) b3.innerHTML = '<div style="padding:12px;color:#E8657A">Error: ' + esc(e.message) + ' &nbsp; ' + _fdeAddBtn_() + '</div>';
  }
}

async function _fdeSave_(i) {
  const r = _freightEditorRows[i];
  if (!r) return;
  const pin = promptManagerPin_('save freight default');
  if (!pin) return;
  const v = (k) => { const el = document.getElementById('fde_' + k + '_' + i); return el ? el.value : ''; };
  try {
    const res = await groundApi('saveFreightDefault', {
      manager_pin: pin, sku: r.sku,
      weightLbs: v('weightLbs'), heightIn: v('heightIn'), lengthIn: v('lengthIn'),
      widthIn: v('widthIn'), parts: v('parts'), freightClass: v('freightClass'),
      fileLink: r.fileLink || '', pdfUrl: r.pdfUrl || '',
    });
    if (!res || !res.ok) { showToast('Save failed: ' + ((res && res.error) || 'unknown')); return; }
    showToast('✓ Saved ' + r.sku);
    if (r.source === 'new') { r.source = 'manual'; _fdeRender_('manual-add'); }
  } catch (e) { showToast('Save error: ' + e.message); }
}

// Harvest the current per-row input values into _freightEditorRows
// so individual tweaks + bulk-applied values both persist on save.
function _fdeHarvestRows_() {
  _freightEditorRows.forEach((r, i) => {
    ['weightLbs', 'heightIn', 'lengthIn', 'widthIn', 'parts', 'freightClass'].forEach(k => {
      const el = document.getElementById('fde_' + k + '_' + i);
      if (el) r[k] = el.value === '' ? '' : el.value;
    });
  });
}

// Bulk-apply L / W / Class to every shown row (Zac: "edit all at
// once … all that contain pbcab to 91×35, height variable"). Blank
// bulk field = leave that dimension alone. Height never touched.
function _fdeBulkApply_() {
  _fdeHarvestRows_(); // keep any manual per-row edits already typed
  const L = (document.getElementById('fde_bulk_L') || {}).value;
  const W = (document.getElementById('fde_bulk_W') || {}).value;
  const C = (document.getElementById('fde_bulk_C') || {}).value;
  if ((L == null || L === '') && (W == null || W === '') && (C == null || C === '')) {
    showToast('Enter L, W, or Class to bulk-apply'); return;
  }
  _freightEditorRows.forEach(r => {
    if (L !== '' && L != null) r.lengthIn = L;
    if (W !== '' && W != null) r.widthIn = W;
    if (C !== '' && C != null) r.freightClass = C;
  });
  _fdeRender_('bulk-applied (unsaved)');
  showToast('Applied to ' + _freightEditorRows.length + ' rows — review, then 💾 Save all');
}

// One PIN, one round trip: upsert every shown row's current values.
async function _fdeBulkSave_() {
  _fdeHarvestRows_();
  const n = _freightEditorRows.length;
  if (!n) return;
  if (!confirm('Save all ' + n + ' shown SKUs to the freight store? This overwrites their weight/dims/class with what\'s shown.')) return;
  const pin = promptManagerPin_('bulk-save ' + n + ' freight defaults');
  if (!pin) return;
  showToast('Saving ' + n + ' rows…');
  try {
    const res = await groundApi('saveFreightDefaultsBulk', {
      manager_pin: pin,
      rows: _freightEditorRows.map(r => ({
        sku: r.sku, weightLbs: r.weightLbs, heightIn: r.heightIn,
        lengthIn: r.lengthIn, widthIn: r.widthIn, parts: r.parts,
        freightClass: r.freightClass, fileLink: r.fileLink || '', pdfUrl: r.pdfUrl || '',
      })),
    });
    if (!res) { showToast('Bulk save: no response'); return; }
    if (res.error && res.upserted == null) { showToast('Bulk save failed: ' + res.error); return; }
    _freightEditorRows.forEach(r => { if (r.source === 'new') r.source = 'manual'; });
    _fdeRender_('saved');
    showToast('✓ Saved ' + (res.upserted || 0) + '/' + n + (res.failed ? ' · ' + res.failed + ' failed' : ''));
  } catch (e) { showToast('Bulk save error: ' + e.message); }
}

// Booker assignment modal — tap a chip to open. Kim/Seth/Clear + a
// Mark Booked form (shown when a booker is already assigned) to
// capture the carrier confirmation # and optional freight label URL.
function openScheduleBookerModal(orderNumber, currentBooker, alreadyBooked) {
  const prior = document.getElementById('scheduleBookerOverlay');
  if (prior) prior.remove();
  const ov = document.createElement('div');
  ov.id = 'scheduleBookerOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:9999;display:flex;align-items:center;justify-content:center;padding:18px;overflow-y:auto';
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };

  const panel = document.createElement('div');
  panel.style.cssText = 'background:#1a1a1a;color:#fff;border:1.5px solid rgba(255,255,255,.15);border-radius:14px;padding:20px 18px 16px;max-width:440px;width:100%;box-shadow:0 8px 40px rgba(0,0,0,.5);font-family:Helvetica,Arial,sans-serif';

  const bookedForm = currentBooker && !alreadyBooked
    ? '<div style="margin-top:14px;padding-top:14px;border-top:1px solid rgba(255,255,255,.10)">'
      + '<div style="font-family:\'Barlow Condensed\',Arial,sans-serif;font-size:14px;font-weight:900;color:#00e676;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px">Mark Booked</div>'
      + '<input type="text" id="schedBookingRef" placeholder="Confirmation # from carrier" autocomplete="off" autocorrect="off" spellcheck="false" style="width:100%;padding:12px;font-size:14px;font-family:\'JetBrains Mono\',monospace;background:#000;color:var(--green-bright,#00e676);border:1.5px solid rgba(0,230,118,.35);border-radius:8px;outline:none;margin-bottom:8px;letter-spacing:1px">'
      + '<input type="file" id="schedFreightFile" accept="application/pdf,image/*" style="display:none" onchange="schedFreightFilePicked_(event)">'
      + '<button type="button" id="schedFreightFileBtn" onclick="document.getElementById(\'schedFreightFile\').click()" style="width:100%;padding:12px;background:rgba(255,179,0,.10);color:#FFB300;border:1.5px dashed rgba(255,179,0,.5);border-radius:8px;font-size:13px;font-weight:800;cursor:pointer;margin-bottom:8px">📎 Upload Freight Label (PDF)</button>'
      + '<div id="schedFreightFileStatus" style="font-size:11px;color:#9AAAC0;margin-bottom:8px;min-height:14px"></div>'
      + '<input type="text" id="schedFreightLabel" placeholder="…or paste a Drive URL instead" autocomplete="off" autocorrect="off" spellcheck="false" style="width:100%;padding:10px;font-size:12px;font-family:\'JetBrains Mono\',monospace;background:#000;color:#9AAAC0;border:1px solid rgba(255,255,255,.15);border-radius:8px;outline:none;margin-bottom:8px">'
      + '<label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#9AAAC0;margin-bottom:10px;cursor:pointer"><input type="checkbox" id="schedAutoPrint" checked style="width:16px;height:16px;cursor:pointer"> Auto-print label on save</label>'
      + '<button onclick="scheduleMarkBooked(\''+esc(orderNumber)+'\',\''+esc(currentBooker)+'\')" style="width:100%;padding:14px;background:linear-gradient(180deg,#00C853,#1A5C1A);color:#fff;border:1.5px solid #00E676;border-radius:10px;font-size:15px;font-weight:900;cursor:pointer;letter-spacing:.5px;text-transform:uppercase">✓ Save Booking</button>'
      + '</div>'
    : (alreadyBooked
        ? '<div style="margin-top:14px;padding:10px 12px;background:rgba(0,230,118,.10);border:1px solid rgba(0,230,118,.45);border-radius:10px;font-size:12px;color:#00e676;font-weight:700;text-align:center">✓ Already booked — tap a name to change booker, or Clear to unassign.<br><br><button onclick="scheduleReprintFreightLabel(\''+esc(orderNumber)+'\')" style="margin-top:8px;padding:10px 18px;background:rgba(255,179,0,.18);color:#FFB300;border:1px solid #FFB300;border-radius:8px;font-size:12px;font-weight:800;cursor:pointer">🖨 Reprint Freight Label</button></div>'
        : '');

  panel.innerHTML =
      '<div style="font-family:\'Barlow Condensed\',Arial,sans-serif;font-size:22px;font-weight:900;color:var(--text);letter-spacing:.5px;text-transform:uppercase;line-height:1.1;margin-bottom:6px">Booker · Order #' + esc(orderNumber) + '</div>'
    + '<div style="font-size:12px;color:#9AAAC0;margin-bottom:14px">' + (currentBooker ? 'Currently assigned: <strong style="color:#FFB300">' + esc(currentBooker) + '</strong>' + (alreadyBooked ? ' · <span style="color:#00e676">✓ booked</span>' : '') : 'Unassigned. Tap a name to claim.') + '</div>'
    + '<button onclick="document.getElementById(\'scheduleBookerOverlay\').remove();openFedexFreightModal(\''+esc(orderNumber)+'\')" style="width:100%;padding:13px;background:linear-gradient(180deg,#4D148C,#2D0A52);color:#fff;border:1.5px solid #7C3AED;border-radius:10px;font-size:14px;font-weight:900;letter-spacing:.5px;text-transform:uppercase;cursor:pointer;margin-bottom:14px">📦 Get FedEx Freight Quote → Book</button>'
    + '<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px">'
    +   SCHEDULE_BOOKER_ROSTER.map(name => {
          const active = name === currentBooker;
          return '<button onclick="scheduleAssignBooker(\''+esc(orderNumber)+'\',\''+esc(name)+'\')" class="amp-btn ' + (active ? 'go' : '') + '" style="padding:14px;font-size:16px;font-weight:900;letter-spacing:.5px;text-transform:uppercase;background:' + (active ? 'linear-gradient(135deg,#FFB300,#FF9100)' : 'rgba(255,255,255,.06)') + ';color:' + (active ? '#1a1a1a' : 'var(--text)') + ';border:1px solid ' + (active ? '#FFB300' : 'rgba(255,255,255,.20)') + ';border-radius:10px;cursor:pointer">' + (active ? '✓ ' : '') + '👤 ' + esc(name) + '</button>';
        }).join('')
    + '</div>'
    + '<div style="display:flex;gap:8px">'
    +   (currentBooker ? '<button onclick="scheduleAssignBooker(\''+esc(orderNumber)+'\',\'\')" style="flex:1;padding:12px;background:rgba(255,82,82,.12);color:#ff5252;border:1px solid rgba(255,82,82,.4);border-radius:10px;font-size:13px;font-weight:800;cursor:pointer">Clear</button>' : '')
    +   '<button onclick="document.getElementById(\'scheduleBookerOverlay\').remove()" style="flex:1;padding:12px;background:#2a2a2a;color:#aaa;border:1px solid #444;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer">Cancel</button>'
    + '</div>'
    + bookedForm;
  ov.appendChild(panel);
  document.body.appendChild(ov);
  // Focus the booking-ref input if the form is shown
  setTimeout(() => {
    const inp = document.getElementById('schedBookingRef');
    if (inp) inp.focus();
  }, 80);
}

// ── FedEx Freight quote→book modal (Zac 2026-05-18, v10.98) ──────
// Manual two-click: Get Quote → review net + itemized discounts →
// Book (deliberate second action + confirm). NO manager PIN (Zac's
// call). Pickup is a separate explicit opt-in, never auto. Entry
// from the Schedule booker modal and Lookup freight hits.
let _fxState = { orderNumber: '', quotes: [], dest: null, ctx: null, selected: '' };
// Shared modal input style. box-sizing:border-box is the actual fix
// for "fields off the side of the screen" — without it the 9px
// padding was added ON TOP of the flex width and overflowed the
// modal on a phone. Always appended with a flex/width rule + ';'.
const _FXIN = 'box-sizing:border-box;padding:9px;font-size:13px;background:#000;color:#fff;border:1px solid rgba(255,255,255,.2);border-radius:7px;';

function openFedexFreightModal(orderNumber) {
  const prior = document.getElementById('fedexFreightOverlay');
  if (prior) prior.remove();
  _fxState = { orderNumber: String(orderNumber), quotes: [], dest: null, ctx: null, selected: '' };
  const ov = document.createElement('div');
  ov.id = 'fedexFreightOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:10002;display:flex;align-items:flex-start;justify-content:center;padding:14px;overflow-y:auto';
  // Backdrop-dismiss ONLY when the press both starts AND ends on the
  // backdrop itself. Fixes the rage bug: selecting text in an input
  // and dragging past the box edge used to fire click on the overlay
  // and nuke the whole modal mid-edit.
  let _fxDownOnOv = false;
  ov.addEventListener('pointerdown', (e) => { _fxDownOnOv = (e.target === ov); });
  ov.addEventListener('click', (e) => { if (e.target === ov && _fxDownOnOv) ov.remove(); _fxDownOnOv = false; });
  const panel = document.createElement('div');
  panel.id = 'fxPanel';
  panel.style.cssText = 'background:#1a1a1a;color:#fff;border:1.5px solid rgba(255,255,255,.15);border-radius:14px;padding:18px;max-width:520px;width:100%;box-shadow:0 8px 40px rgba(0,0,0,.55);font-family:Helvetica,Arial,sans-serif;margin:8px 0';
  panel.innerHTML = '<div style="font-family:\'Barlow Condensed\',Arial,sans-serif;font-size:22px;font-weight:900;letter-spacing:.5px;text-transform:uppercase">📦 FedEx Freight · #' + esc(orderNumber) + '</div>'
    + '<div id="fxBody" style="margin-top:10px"><div style="padding:30px;text-align:center;color:#42a5f5">Loading order…</div></div>'
    + '<button onclick="document.getElementById(\'fedexFreightOverlay\').remove()" style="width:100%;margin-top:12px;padding:11px;background:#2a2a2a;color:#aaa;border:1px solid #444;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer">Close</button>';
  ov.appendChild(panel);
  document.body.appendChild(ov);
  _fxLoadContext_();
}

async function _fxLoadContext_() {
  const b = document.getElementById('fxBody');
  if (!b) return;
  try {
    // First call with no destination → server returns parsed addr +
    // items + a quote attempt. We show the addr editable first.
    const res = await groundApi('fedexQuoteOrder', { orderNumber: _fxState.orderNumber });
    if (res && res.context) { _fxState.ctx = res.context; }
    if (!res || (!res.ok && !res.context)) {
      b.innerHTML = '<div style="padding:16px;background:rgba(255,82,82,.1);border:1px solid #ff5252;border-radius:8px;color:#ff8a8a;font-size:13px">' + esc((res && res.error) || 'Could not load order') + '</div>';
      return;
    }
    const ctx = res.context || {};
    // v10.110: installer order → destination is the FedEx TERMINAL,
    // not the (garbled) customer address. Prefill from the
    // remembered terminal if we have one; else leave blank for the
    // booker to enter (first-time-learn).
    let d;
    if (ctx.installer_code && ctx.remembered_terminal) {
      d = ctx.remembered_terminal;
      _fxState.terminalOneOff = false;
    } else if (ctx.installer_code) {
      d = { street: '', city: '', state: '', zip: '' };
    } else {
      d = (res.destination_used) || (ctx.parsed_destination) || {};
    }
    _fxState.dest = { street: d.street || '', city: d.city || '', state: d.state || '', zip: d.zip || '' };
    if (res.ok && Array.isArray(res.quotes)) { _fxState.quotes = res.quotes; }
    _fxRender_();
  } catch (e) {
    b.innerHTML = '<div style="padding:16px;color:#ff8a8a;font-size:13px">Error: ' + esc(e.message) + '</div>';
  }
}

function _fxMoney_(n, cur) {
  if (n == null || isNaN(n)) return '—';
  return (cur && cur !== 'USD' ? cur + ' ' : '$') + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function _fxRender_() {
  const b = document.getElementById('fxBody');
  if (!b) return;
  const ctx = _fxState.ctx || {};
  // effective installer code: auto-detected (PackingQueue/Shopify)
  // OR the booker's manual fallback entry. v10.111.
  const instCode = ctx.installer_code || _fxState.manualInstaller || '';
  const d = _fxState.dest || {};
  let html = ''
    + '<div style="font-size:12px;color:#9AAAC0;margin-bottom:4px">' + esc(ctx.customer_name || '') + (ctx.item_count ? ' · ' + ctx.item_count + ' line(s)' : '') + '</div>'
    + '<div style="font-size:11px;color:#6b7685;margin-bottom:' + ((ctx.hardware_inside && ctx.hardware_inside.length) ? '4' : '10') + 'px;word-break:break-word">Items: '
      + ((ctx.items || []).length
          ? (ctx.items || []).map(it => esc(it.sku) + '×' + (it.pieces || 1)
              + ' <span onclick="_fxToggleHardware_(\'' + esc(String(it.sku).replace(/'/g, "\\'")) + '\',\'add\')" title="Mark as hardware packed inside (manager PIN) — excludes from freight" style="color:#7C3AED;-webkit-text-fill-color:#7C3AED;cursor:pointer;font-weight:800">🔩</span>').join(' · ')
          : '<span style="color:#ff8a8a">no SKU lines on this order</span>')
      + '</div>'
    + ((ctx.hardware_inside && ctx.hardware_inside.length)
        ? '<div style="font-size:11px;color:#7C9CBF;margin-bottom:10px;word-break:break-word">🔩 Packed inside (no freight charge): '
          + ctx.hardware_inside.map(s => esc(s)
              + ' <span onclick="_fxToggleHardware_(\'' + esc(String(s).replace(/'/g, "\\'")) + '\',\'remove\')" title="Not hardware — include in freight (manager PIN)" style="color:#FFB300;-webkit-text-fill-color:#FFB300;cursor:pointer;font-weight:800">↩</span>').join(' · ')
          + '</div>'
        : '')
    + (instCode
        ? '<div style="background:rgba(124,58,237,.14);border:1px solid #7C3AED;border-radius:8px;padding:9px 11px;margin-bottom:8px;font-size:12px;color:#C4B5FD;-webkit-text-fill-color:#C4B5FD">'
          + '<div style="font-weight:900;font-size:13px;color:#E8EDF4;-webkit-text-fill-color:#E8EDF4">🏢 Installer order — ' + esc(instCode) + (ctx.installer_code ? '' : ' <span style="font-size:10px;color:#9AAAC0">(manual)</span>') + '</div>'
          + (ctx.remembered_terminal
              ? 'Ships to the <b>remembered FedEx terminal</b> below. Confirm it, or edit for a <b>one-off</b> (this order only — won’t change the saved default). '
                + '<button onclick="_fxSaveInstallerTerminal_()" style="margin-top:6px;display:inline-block;padding:6px 10px;background:rgba(124,58,237,.25);color:#fff;-webkit-text-fill-color:#fff;border:1px solid #A78BFA;border-radius:6px;font-size:11px;font-weight:800;cursor:pointer">💾 Save as new default (manager)</button>'
              : '<b>First time for this installer.</b> Enter the FedEx terminal address below — it’ll be remembered for next time.')
          + '</div>'
        : '<div style="margin-bottom:8px"><input id="fxManualInst" placeholder="Installer order? enter code (e.g. CesarSOCAL) — optional" value="' + esc(_fxState.manualInstaller || '') + '" onchange="_fxSetManualInstaller_(this.value)" style="' + _FXIN + 'width:100%;border-style:dashed;border-color:#7C3AED"></div>')
    + '<div style="font-size:10px;font-weight:900;color:#9AAAC0;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">' + (instCode ? 'FedEx terminal address (recipient)' : 'Destination (parsed — confirm/fix before quoting)') + '</div>'
    + '<input id="fxStreet" placeholder="Street" value="' + esc(d.street || '') + '" style="' + _FXIN + 'width:100%;margin-bottom:6px">'
    + '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">'
    +   '<input id="fxCity" placeholder="City" value="' + esc(d.city || '') + '" style="' + _FXIN + 'flex:1 1 130px;min-width:0">'
    +   '<input id="fxState_" placeholder="ST" maxlength="2" value="' + esc(d.state || '') + '" style="' + _FXIN + 'flex:0 1 52px;min-width:0;text-transform:uppercase">'
    +   '<input id="fxZip" placeholder="ZIP" value="' + esc(d.zip || '') + '" style="' + _FXIN + 'flex:0 1 80px;min-width:0">'
    + '</div>'
    + '<div style="font-size:10px;font-weight:900;color:#9AAAC0;text-transform:uppercase;letter-spacing:1px;margin:4px 0">Accessorials (apply to all quotes)</div>'
    + '<div style="display:flex;flex-wrap:wrap;gap:6px 14px;margin-bottom:10px">'
    +   [['LIFTGATE_DELIVERY','Liftgate'],['LIMITED_ACCESS_DELIVERY','Residential / limited-access'],['CALL_BEFORE_DELIVERY','Call before delivery']]
          .map(a => '<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#E8EDF4;cursor:pointer"><input type="checkbox" class="fxAcc" value="' + a[0] + '"' + (((_fxState.accessorials||[]).indexOf(a[0])>=0)?' checked':'') + ' style="width:15px;height:15px"> ' + a[1] + '</label>').join('')
    + '</div>'
    + '<button onclick="_fxGetQuote_()" id="fxQuoteBtn" style="width:100%;box-sizing:border-box;padding:13px;background:linear-gradient(180deg,#1A5BE0,#003087);color:#fff;border:1.5px solid #3B82F6;border-radius:9px;font-size:15px;font-weight:900;letter-spacing:.5px;text-transform:uppercase;cursor:pointer">↻ Get FedEx Quote</button>'
    + '<details id="fxManualWrap"' + (_fxState.needsDims ? ' open' : '') + ' style="margin-top:10px">'
    +   '<summary style="cursor:pointer;font-size:12px;color:#FFB300;font-weight:800">'
    +     (_fxState.needsDims ? '⚠ SKUs not in freight table — enter the shipment manually' : '＋ Manual shipment (if SKUs aren’t in the freight table)')
    +   '</summary>'
    +   '<div style="padding:10px 0 2px">'
    +     (_fxState.needsDims ? '<div style="font-size:11px;color:#FFB300;margin-bottom:6px">Unmapped: ' + esc((_fxState.needsDims || []).join(', ')) + '. Enter total pallet weight + dims to rate the whole shipment.</div>' : '')
    +     '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px">'
    +       '<input id="fxMWt" type="number" inputmode="decimal" placeholder="Total wt (lb)" value="' + esc((_fxState.manual && _fxState.manual.weightLbs) || '') + '" style="' + _FXIN + 'flex:1 1 130px;min-width:0">'
    +       '<input id="fxMHU" type="number" inputmode="numeric" placeholder="# pallets" value="' + esc((_fxState.manual && _fxState.manual.handlingUnits) || '1') + '" style="' + _FXIN + 'flex:0 1 90px;min-width:0">'
    +     '</div>'
    +     '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px">'
    +       '<input id="fxML" type="number" inputmode="decimal" placeholder="L in" value="' + esc((_fxState.manual && _fxState.manual.lengthIn) || '') + '" style="' + _FXIN + 'flex:1 1 60px;min-width:0">'
    +       '<input id="fxMW" type="number" inputmode="decimal" placeholder="W in" value="' + esc((_fxState.manual && _fxState.manual.widthIn) || '') + '" style="' + _FXIN + 'flex:1 1 60px;min-width:0">'
    +       '<input id="fxMH" type="number" inputmode="decimal" placeholder="H in" value="' + esc((_fxState.manual && _fxState.manual.heightIn) || '') + '" style="' + _FXIN + 'flex:1 1 60px;min-width:0">'
    +       '<input id="fxMC" type="text" placeholder="class (auto)" value="' + esc((_fxState.manual && _fxState.manual.freightClass) || '') + '" style="' + _FXIN + 'flex:1 1 90px;min-width:0">'
    +     '</div>'
    +     '<div style="font-size:10px;color:#6b7685">Leave class blank → computed from density (weight ÷ ft³). Dims default to a 48×40×48 pallet if blank.</div>'
    +   '</div>'
    + '</details>';

  if (_fxState.quotes && _fxState.quotes.length) {
    html += '<div style="margin-top:14px;font-size:10px;font-weight:900;color:#9AAAC0;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Quotes — tap a price to select, ▾ for breakdown</div>';
    // v10.108 (Zac): condensed FedEx-style view — group by tier,
    // tier name+desc on the left, service rows w/ price + a ▾ that
    // expands the discount/surcharge breakdown. Identical rows
    // across accounts are collapsed (they're the same negotiated
    // price right now — flagged separately); if accounts ever
    // differ the rows split with an account label.
    const TIER_META = {
      '':                    { name: 'Commercial',          desc: 'Terminal / commercial dock — no Freight Direct' },
      BASIC:                 { name: 'Basic',               desc: 'Front door, back door, or garage — no signature' },
      BASIC_BY_APPOINTMENT:  { name: 'Basic by Appointment', desc: 'Front/back door or garage — scheduled, signature' },
      STANDARD:              { name: 'Standard',            desc: 'To the first ground-level room' },
      PREMIUM:               { name: 'Premium',             desc: 'Room of choice + packaging removal by request' },
    };
    const ORDER = ['', 'BASIC', 'BASIC_BY_APPOINTMENT', 'STANDARD', 'PREMIUM'];
    // group + de-dupe identical-across-account
    const groups = {};
    (_fxState.quotes || []).forEach((q, i) => {
      const tk = q.freightDirectTier || '';
      (groups[tk] = groups[tk] || []);
      const dupe = groups[tk].find(e => e.q.serviceType === q.serviceType && e.q.totalNet === q.totalNet);
      if (dupe) { dupe.accounts = (dupe.accounts || [dupe.q.accountLabel]).concat(q.accountLabel || q.account); }
      else groups[tk].push({ q, i, accounts: [q.accountLabel || q.account] });
    });
    const tierKeys = Object.keys(groups).sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
    html += tierKeys.map(tk => {
      const meta = TIER_META[tk] || { name: _fxTierLabel_(tk), desc: '' };
      const rows2 = groups[tk].map(({ q, i, accounts }) => {
        const bd = q.breakdown || {};
        const L = [];
        if (bd.grossFreight != null) L.push(['List/base', _fxMoney_(bd.grossFreight, q.currency), '#9AAAC0']);
        if (bd.totalDiscount) L.push(['Discount', '−' + _fxMoney_(bd.totalDiscount, q.currency), '#00e676']);
        if (bd.netFreight != null) L.push(['Net freight', _fxMoney_(bd.netFreight, q.currency), '#cfd8e3']);
        if (bd.totalSurcharge) L.push(['Surcharges/fuel', '+' + _fxMoney_(bd.totalSurcharge, q.currency), '#FFB300']);
        const sel = _fxState.selectedIdx === i;
        const acctNote = (accounts && accounts.filter(Boolean).length > 1) ? ' · both accts' : (accounts && accounts[0] ? ' · ' + esc(accounts[0]) : '');
        return '<details style="border-top:1px dashed rgba(255,255,255,.10)"><summary style="list-style:none;cursor:pointer;display:flex;align-items:center;gap:10px;padding:9px 0">'
          + '<div onclick="event.preventDefault();_fxSelect_(' + i + ')" style="flex:1;min-width:0">'
          +   '<div style="font-size:13px;font-weight:800;color:' + (sel ? '#00e676' : '#E8EDF4') + ';-webkit-text-fill-color:' + (sel ? '#00e676' : '#E8EDF4') + '">' + (sel ? '✓ ' : '') + esc(q.serviceName || q.serviceType.replace(/_/g, ' ')) + '</div>'
          +   '<div style="font-size:10px;color:#9AAAC0;-webkit-text-fill-color:#9AAAC0">' + esc(q.transitDays || '') + acctNote + '</div>'
          + '</div>'
          + '<span onclick="event.preventDefault();_fxSelect_(' + i + ')" style="flex:0 0 auto;background:' + (sel ? '#00C853' : '#FF6B00') + ';color:#fff;-webkit-text-fill-color:#fff;border-radius:7px;padding:8px 12px;font-size:14px;font-weight:900;font-family:\'Barlow Condensed\',Arial,sans-serif;letter-spacing:.5px">' + _fxMoney_(q.totalNet, q.currency) + '</span>'
          + '<span style="flex:0 0 auto;color:#9AAAC0;font-size:14px;padding-left:2px">▾</span>'
          + '</summary>'
          + '<div style="font-size:10px;font-family:\'JetBrains Mono\',monospace;line-height:1.7;padding:2px 4px 10px">'
          +   L.map(l => '<div style="display:flex;justify-content:space-between;color:' + l[2] + '"><span>' + l[0] + '</span><span>' + l[1] + '</span></div>').join('')
          +   (q.rateType ? '<div style="color:#00e676;margin-top:3px">' + esc(q.rateType) + ' negotiated rate</div>' : '')
          + '</div></details>';
      }).join('');
      return '<div style="margin-bottom:10px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.10);border-radius:10px;padding:10px 12px">'
        + '<div style="font-size:15px;font-weight:900;color:#E8EDF4">' + esc(meta.name) + '</div>'
        + (meta.desc ? '<div style="font-size:11px;color:#9AAAC0;margin-bottom:2px">' + esc(meta.desc) + '</div>' : '')
        + rows2
        + '</div>';
    }).join('');

    if (_fxState.selectedIdx != null && _fxState.quotes[_fxState.selectedIdx]) {
      const _sq = _fxState.quotes[_fxState.selectedIdx];
      html += '<button onclick="_fxBook_()" id="fxBookBtn" style="width:100%;margin-top:4px;padding:15px;background:linear-gradient(180deg,#00C853,#1A5C1A);color:#fff;border:1.5px solid #00E676;border-radius:10px;font-size:16px;font-weight:900;letter-spacing:1px;text-transform:uppercase;cursor:pointer;box-shadow:0 0 20px rgba(0,230,118,.35)">📦 Book ' + esc((_sq.serviceName || _sq.serviceType).replace(/_/g, ' ')) + ' · ' + esc(_fxTierLabel_(_sq.freightDirectTier)) + '</button>'
        + '<div style="font-size:11px;color:#9AAAC0;text-align:center;margin-top:6px">A confirm step follows — booking only happens after you confirm.</div>'
        + '<details style="margin-top:12px"><summary style="cursor:pointer;font-size:12px;color:#FFB300;font-weight:800">＋ Also schedule a FedEx pickup (optional)</summary>'
        +   '<div style="padding:10px 0 2px">'
        +   '<div style="font-size:11px;color:#9AAAC0;margin-bottom:6px">Only if you want FedEx to come get it. An uncancelled pickup with nothing to ship can incur a charge — leave this closed if unsure.</div>'
        +   '<div style="display:flex;gap:6px;margin-bottom:8px">'
        +     '<input id="fxPuDate" type="date" style="flex:1;padding:9px;font-size:13px;background:#000;color:#fff;border:1px solid rgba(255,255,255,.2);border-radius:7px">'
        +     '<input id="fxPuClose" type="time" value="17:00" style="flex:0 0 110px;padding:9px;font-size:13px;background:#000;color:#fff;border:1px solid rgba(255,255,255,.2);border-radius:7px">'
        +   '</div>'
        +   '<button onclick="_fxPickup_()" style="width:100%;padding:12px;background:rgba(255,179,0,.14);color:#FFB300;border:1.5px solid #FFB300;border-radius:9px;font-size:13px;font-weight:900;cursor:pointer">Schedule Pickup (separate confirm)</button>'
        +   '</div></details>';
    }
  }
  html += '<div id="fxResult" style="margin-top:12px"></div>';
  b.innerHTML = html;
}

function _fxReadDest_() {
  const g = id => (document.getElementById(id) || {}).value || '';
  return { street: g('fxStreet').trim(), city: g('fxCity').trim(), state: g('fxState_').trim().toUpperCase(), zip: g('fxZip').trim() };
}

function _fxReadManual_() {
  const g = id => String((document.getElementById(id) || {}).value || '').trim();
  const wt = Number(g('fxMWt')) || 0;
  if (wt <= 0) return null;
  return {
    weightLbs: wt,
    handlingUnits: Number(g('fxMHU')) || 1,
    lengthIn: Number(g('fxML')) || 0,
    widthIn: Number(g('fxMW')) || 0,
    heightIn: Number(g('fxMH')) || 0,
    freightClass: g('fxMC'),
  };
}

function _fxReadAccessorials_() {
  return Array.prototype.slice.call(document.querySelectorAll('.fxAcc'))
    .filter(c => c.checked).map(c => c.value);
}

// Manual installer fallback (auto-detect found nothing). Setting a
// code flips the modal into installer mode (terminal learn/confirm).
function _fxSetManualInstaller_(v) {
  _fxState.manualInstaller = String(v || '').trim().replace(/\s+/g, '');
  _fxRender_();
}
function _fxInstallerCode_() {
  return (_fxState.ctx && _fxState.ctx.installer_code) || _fxState.manualInstaller || '';
}

// v10.112 (#69): booker marks a SKU hardware-packed-inside (exclude
// from freight) or un-marks it (include) — manager-PIN persisted to
// the shared FEDEX_HARDWARE_SKUS list. Re-loads the quote so the
// reclassification takes effect immediately.
async function _fxToggleHardware_(sku, action) {
  if (!sku) return;
  const verb = action === 'remove' ? 'include in freight (not hardware)' : 'mark as hardware packed inside (exclude from freight)';
  const pin = window.prompt('Manager PIN to ' + verb + ' for SKU "' + sku + '".\n\n(Persists for ALL future freight quotes.)');
  if (pin == null) return;
  try {
    const res = await groundApi('setHardwareSku', { sku: sku, op: action, manager_pin: String(pin).trim() });
    if (!res || !res.ok) { showToast(res && /PIN/i.test(res.error || '') ? '✗ ' + res.error : ('Failed: ' + ((res && res.error) || 'unknown'))); return; }
    showToast('✓ ' + sku + (action === 'remove' ? ' → freight' : ' → hardware (packed inside)'));
    _fxState.quotes = []; _fxState.selectedIdx = null;
    _fxLoadContext_();   // re-resolve items + re-quote with new classification
  } catch (e) { showToast('Error: ' + e.message); }
}

// v10.110: change the SAVED default terminal for this installer
// (manager-PIN gated — remembered one already exists). One-off
// edits don't call this; they just leave the dest fields changed
// for this quote/book only.
async function _fxSaveInstallerTerminal_() {
  const code = _fxInstallerCode_();
  if (!code) return;
  const t = _fxReadDest_();
  if (!t.street || !t.city || !t.state || !t.zip) { showToast('Fill street, city, state, ZIP first'); return; }
  const pin = window.prompt('Manager PIN to CHANGE the saved FedEx terminal for ' + code + '.\n\n(One-off shipments don\'t need this — just edit the address and Get Quote; the saved default only changes here.)');
  if (pin == null) return;
  try {
    const res = await groundApi('setInstallerTerminal', {
      code: code,
      terminal: { name: 'FedEx Terminal', street: t.street, city: t.city, state: t.state, zip: t.zip },
      manager_pin: String(pin).trim(),
    });
    if (!res || !res.ok) { showToast(res && /PIN/i.test(res.error || '') ? '✗ ' + res.error : ('Save failed: ' + ((res && res.error) || 'unknown'))); return; }
    _fxState.ctx.remembered_terminal = res.terminal;
    _fxState.terminalOneOff = false;
    showToast('✓ Saved default terminal for ' + code);
    _fxRender_();
  } catch (e) { showToast('Save error: ' + e.message); }
}

async function _fxGetQuote_() {
  const btn = document.getElementById('fxQuoteBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Rating…'; }
  _fxState.accessorials = _fxReadAccessorials_();
  _fxState.dest = _fxReadDest_();
  _fxState.manual = _fxReadManual_();
  if (!_fxState.dest.zip) { showToast('ZIP required to rate'); if (btn) { btn.disabled = false; btn.textContent = '↻ Get FedEx Quote'; } return; }
  // v10.110: first-time installer → persist the entered terminal as
  // the remembered default (no PIN; learn-on-first-use). Best-effort
  // — never block the quote on a save hiccup.
  const _ic = _fxInstallerCode_();
  if (_ic && _fxState.ctx && !_fxState.ctx.remembered_terminal
      && _fxState.dest.street && _fxState.dest.city && _fxState.dest.state) {
    try {
      const sv = await groundApi('setInstallerTerminal', {
        code: _ic, terminal: Object.assign({ name: 'FedEx Terminal' }, _fxState.dest),
      });
      if (sv && sv.ok) { _fxState.ctx.remembered_terminal = sv.terminal; showToast('✓ Terminal saved for ' + _ic); }
    } catch (e) { /* swallow — still quote */ }
  }
  try {
    const payload = { orderNumber: _fxState.orderNumber, destination: _fxState.dest };
    if (_fxState.manual) payload.manualShipment = _fxState.manual;
    if (_fxState.accessorials && _fxState.accessorials.length) payload.accessorials = _fxState.accessorials;
    const res = await groundApi('fedexQuoteOrder', payload);
    if (!res || !res.ok) {
      if (res && res.needs_dims && res.needs_dims.length) _fxState.needsDims = res.needs_dims;
      const why = (res && (res.error || (res.needs_dims && ('Unmapped SKUs: ' + res.needs_dims.join(', '))))) || 'rate failed';
      _fxState.quotes = [];
      _fxRender_();
      const rr = document.getElementById('fxResult');
      if (rr) rr.innerHTML = '<div style="padding:12px;background:rgba(255,82,82,.1);border:1px solid #ff5252;border-radius:8px;color:#ff8a8a;font-size:12px">' + esc(why) + (res && res.needs_dims ? '<br><br>Open “Manual shipment” above and enter total weight + dims, then Get Quote again.' : '') + '</div>';
      if (btn) { btn.disabled = false; btn.textContent = '↻ Get FedEx Quote'; }
      return;
    }
    _fxState.needsDims = null;
    _fxState.quotes = res.quotes || [];
    if (res.context) _fxState.ctx = res.context;
    _fxState.selectedIdx = null;
    if (res.virtualized) showToast('FedEx sandbox (virtualized) response');
    _fxRender_();
  } catch (e) {
    showToast('Quote error: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = '↻ Get FedEx Quote'; }
  }
}

// v10.106: selection is now by quote INDEX — multiple quotes share
// a serviceType (Economy) across Freight Direct tiers, so a string
// key is ambiguous. _fxSel_() = the chosen quote object.
function _fxSelect_(idx) { _fxState.selectedIdx = Number(idx); _fxRender_(); }
function _fxSel_() {
  return (_fxState.selectedIdx != null) ? (_fxState.quotes || [])[_fxState.selectedIdx] : null;
}
function _fxTierLabel_(t) {
  return ({ BASIC_BY_APPOINTMENT: 'Freight Direct · By Appt', PREMIUM: 'Freight Direct · Premium (white glove)', BASIC: 'Freight Direct · Basic', STANDARD: 'Freight Direct · Standard' })[t] || (t || 'Commercial');
}

async function _fxRetryPrintBol_(ev) {
  if (ev && ev.preventDefault) ev.preventDefault();
  const r = _fxState.lastBookResult || {};
  if (!r.bolLabelBase64) { showToast('No BOL to reprint — re-book or print manually'); return; }
  try {
    const res = await groundApi('printFedexBol', {
      base64: r.bolLabelBase64,
      copies: 4,
      orderNumber: _fxState.orderNumber,
      pro: r.proNumber || r.masterTrackingNumber || '',
    });
    if (res && res.ok) showToast('🖨 BOL re-queued × ' + (res.copies || 4));
    else showToast('Re-print failed: ' + ((res && res.error) || 'unknown'));
  } catch (e) { showToast('Re-print error: ' + e.message); }
}

async function _fxBook_() {
  const q = _fxSel_();
  if (!q) { showToast('Pick a service first'); return; }
  const ok = confirm('Book FedEx Freight for order ' + _fxState.orderNumber + '?\n\n'
    + (q.serviceName || q.serviceType) + ' · ' + _fxTierLabel_(q.freightDirectTier) + '\n'
    + 'Account: ' + (q.accountLabel || q.account || '?') + '\n'
    + _fxMoney_(q.totalNet, q.currency) + '\n'
    + 'To: ' + _fxState.dest.city + ', ' + _fxState.dest.state + ' ' + _fxState.dest.zip + '\n\n'
    + 'This creates a REAL FedEx Freight shipment + BOL on the production account. You only pay when it actually ships (cancellable). Proceed?');
  if (!ok) return;
  const btn = document.getElementById('fxBookBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Booking…'; }
  try {
    const bookPayload = {
      orderNumber: _fxState.orderNumber,
      serviceType: q.serviceType,
      freightDirectTier: q.freightDirectTier || '',
      account: q.account || '',
      accessorials: _fxState.accessorials || [],
      destination: _fxState.dest,
      confirm: 'BOOK-CONFIRMED',
    };
    if (_fxState.manual) bookPayload.manualShipment = _fxState.manual;
    const res = await groundApi('fedexBookOrder', bookPayload);
    const rr = document.getElementById('fxResult');
    if (!res || !res.ok) {
      if (rr) rr.innerHTML = '<div style="padding:12px;background:rgba(255,82,82,.1);border:1px solid #ff5252;border-radius:8px;color:#ff8a8a;font-size:12px">Book failed: ' + esc((res && res.error) || 'unknown') + '</div>';
      if (btn) { btn.disabled = false; btn.textContent = '📦 Book selected service'; }
      return;
    }
    if (res.simulated) {
      if (rr) rr.innerHTML = '<div style="padding:12px;background:rgba(255,179,0,.12);border:1px solid #FFB300;border-radius:8px;color:#FFB300;font-size:12px;font-weight:700">SIMULATED (' + esc(res.why || '') + ') — not a real booking. FedEx live switch is off.</div>';
      return;
    }
    showPackBanner_('✓ FedEx Freight booked for ' + _fxState.orderNumber, '#00e676');
    const pro = res.proNumber || res.masterTrackingNumber || '';
    const pb = res.print_bol || {};
    const pol = res.print_order_label || {};
    const pbLine = pb.ok
      ? '🖨 BOL queued to default printer × ' + (pb.copies || 4)
      : '⚠ BOL print failed: ' + esc(pb.error || 'unknown') + (res.bolLabelBase64 ? ' — <a href="#" onclick="_fxRetryPrintBol_(event)" style="color:#FFB300;text-decoration:underline">Retry</a>' : '');
    const polLine = pol.ok
      ? '🖨 Order# labels queued (2 landscape pages)'
      : '⚠ Order# label print failed: ' + esc(pol.error || 'unknown');
    if (rr) rr.innerHTML = '<div style="padding:12px;background:rgba(0,230,118,.1);border:1px solid #00e676;border-radius:8px;color:#00e676;font-size:12px;font-weight:800">✓ Booked' + (pro ? ' · PRO ' + esc(pro) : '') + '<br>' + pbLine + '<br>' + polLine + '</div>';
    // v10.120: server-side PDF + PrintNode handles the order# label now;
    // no client popup-print needed.
    _fxState.lastBookResult = res;
  } catch (e) {
    showToast('Book error: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = '📦 Book ' + _fxState.selected.replace(/_/g, ' '); }
  }
}

async function _fxPickup_() {
  const date = (document.getElementById('fxPuDate') || {}).value || '';
  const close = (document.getElementById('fxPuClose') || {}).value || '17:00';
  if (!date) { showToast('Pick a ready date'); return; }
  if (!confirm('Schedule a FedEx pickup on ' + date + ' (close ' + close + ')?\n\nSeparate from the booking. An uncancelled pickup can incur a charge.')) return;
  try {
    const _pq = _fxSel_() || {};
    const puPayload = {
      orderNumber: _fxState.orderNumber,
      readyDate: date,
      closeTime: close.length === 5 ? close + ':00' : close,
      serviceType: _pq.serviceType || '',
      freightDirectTier: _pq.freightDirectTier || '',
      confirm: 'PICKUP-CONFIRMED',
    };
    if (_fxState.manual) puPayload.manualShipment = _fxState.manual;
    const res = await groundApi('fedexPickupOrder', puPayload);
    const rr = document.getElementById('fxResult');
    if (!res || !res.ok) { if (rr) rr.innerHTML = '<div style="padding:10px;color:#ff8a8a;font-size:12px">Pickup failed: ' + esc((res && res.error) || 'unknown') + '</div>'; return; }
    if (res.simulated) { if (rr) rr.innerHTML = '<div style="padding:10px;color:#FFB300;font-size:12px;font-weight:700">Pickup SIMULATED (' + esc(res.why || '') + ')</div>'; return; }
    showPackBanner_('✓ FedEx pickup scheduled', '#00e676');
    if (rr) rr.innerHTML = '<div style="padding:10px;color:#00e676;font-size:12px;font-weight:800">✓ Pickup scheduled.</div>';
  } catch (e) { showToast('Pickup error: ' + e.message); }
}

async function scheduleAssignBooker(orderNumber, booker) {
  const ov = document.getElementById('scheduleBookerOverlay');
  if (ov) ov.remove();
  try {
    const res = await groundApi('setPackJobBooker', { orderNumber: orderNumber, booker: booker });
    if (!res || !res.ok) {
      showToast('Booker update failed: ' + ((res && res.error) || 'unknown'));
      return;
    }
    showToast(booker ? '✓ ' + booker + ' on #' + orderNumber : 'Cleared booker on #' + orderNumber);
    refreshScheduleTab();
  } catch (err) {
    showToast('Booker update error: ' + err.message);
  }
}

// Pending file capture for the freight-label upload — set by the
// file picker, consumed (and cleared) by scheduleMarkBooked.
let _schedPendingFreightFile = null;

function schedFreightFilePicked_(e) {
  const f = e.target && e.target.files && e.target.files[0];
  const statusEl = document.getElementById('schedFreightFileStatus');
  const btnEl = document.getElementById('schedFreightFileBtn');
  if (!f) { _schedPendingFreightFile = null; return; }
  const sizeKb = Math.round(f.size / 1024);
  if (sizeKb > 8000) { // 8MB cap — Apps Script doPost body is bounded
    if (statusEl) { statusEl.textContent = '⚠ File too large (' + sizeKb + ' KB) — Drive-upload via web app caps at ~8 MB. Try compressing.'; statusEl.style.color = '#ff5252'; }
    _schedPendingFreightFile = null;
    return;
  }
  _schedPendingFreightFile = f;
  if (statusEl) { statusEl.textContent = '📎 ' + f.name + ' (' + sizeKb + ' KB) — ready to upload on save'; statusEl.style.color = '#00e676'; }
  if (btnEl) btnEl.textContent = '✓ ' + f.name + ' — tap to change';
}

async function _readFileAsBase64_(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('file read failed'));
    reader.readAsDataURL(file);
  });
}

async function scheduleMarkBooked(orderNumber, booker) {
  const refEl = document.getElementById('schedBookingRef');
  const lblEl = document.getElementById('schedFreightLabel');
  const autoEl = document.getElementById('schedAutoPrint');
  const bookingRef = refEl ? String(refEl.value || '').trim() : '';
  const labelUrl = lblEl ? String(lblEl.value || '').trim() : '';
  const autoPrint = autoEl ? !!autoEl.checked : true;
  if (!bookingRef) {
    showToast('Enter a confirmation # before saving');
    if (refEl) refEl.focus();
    return;
  }

  const payload = {
    orderNumber: orderNumber,
    booking_ref: bookingRef,
    booker: booker,
    auto_print: autoPrint,
  };

  if (_schedPendingFreightFile) {
    try {
      const statusEl = document.getElementById('schedFreightFileStatus');
      if (statusEl) { statusEl.textContent = 'Reading file…'; statusEl.style.color = '#9AAAC0'; }
      payload.freight_label_base64 = await _readFileAsBase64_(_schedPendingFreightFile);
      payload.freight_label_filename = _schedPendingFreightFile.name;
      payload.freight_label_mime_type = _schedPendingFreightFile.type || 'application/pdf';
    } catch (err) {
      showToast('File read error: ' + err.message);
      return;
    }
  } else if (labelUrl) {
    payload.freight_label_url = labelUrl;
  }

  try {
    let res = await groundApi('markPackJobBooked', payload);
    if (res && res.already_booked) {
      const ok = confirm('⚠ Order ' + orderNumber + ' is already booked:\n  ref ' +
        (res.existing_booking_ref || '?') + (res.existing_booker ? ' · by ' + res.existing_booker : '') +
        '\n\nReplace it with ref ' + bookingRef + '?');
      if (!ok) { showToast('Kept existing booking ' + (res.existing_booking_ref || '')); return; }
      payload.force = true;
      res = await groundApi('markPackJobBooked', payload);
    }
    if (!res || !res.ok) {
      showToast('Save failed: ' + ((res && res.error) || 'unknown'));
      return;
    }
    const ov = document.getElementById('scheduleBookerOverlay');
    if (ov) ov.remove();
    _schedPendingFreightFile = null;
    let msg = '✓ #' + orderNumber + ' booked · ref ' + bookingRef;
    if (res.print && res.print.ok) msg += ' · 🖨 sent to printer';
    else if (res.print && !res.print.ok) msg += ' · ⚠ print failed (' + (res.print.error || '?') + ')';
    showToast(msg);
    refreshScheduleTab();
  } catch (err) {
    showToast('Save error: ' + err.message);
  }
}

// Customer-ready modal — Ken's primary surface. He sees the
// schedule, taps "⏳ WAIT" on an order, sets it to "✓ CUST" with
// optional notes ("customer confirmed via email 5/14, OK to ship
// any day next week").
function _custReadyDefaultName_() {
  try { return localStorage.getItem('mbd_ground_packer') || ''; } catch(e) { return ''; }
}

function openCustomerReadyModal(orderNumber, currentReady, currentBy, currentNotes) {
  const prior = document.getElementById('customerReadyOverlay');
  if (prior) prior.remove();
  // Pull any structured [HOLD:date] token out so the date shows in
  // its own picker and the notes box stays clean prose; re-encoded
  // on save in setCustomerReady_.
  const _hold = _parseCustReadyHold_(currentNotes);
  const _cleanNotes = _stripHoldToken_(currentNotes);
  const ov = document.createElement('div');
  ov.id = 'customerReadyOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:10000;display:flex;align-items:center;justify-content:center;padding:18px;overflow-y:auto';
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  const panel = document.createElement('div');
  panel.style.cssText = 'background:#1a1a1a;color:#fff;border:1.5px solid rgba(255,255,255,.15);border-radius:14px;padding:20px 18px 16px;max-width:440px;width:100%;box-shadow:0 8px 40px rgba(0,0,0,.5);font-family:Helvetica,Arial,sans-serif';
  panel.innerHTML =
      '<div style="font-family:\'Barlow Condensed\',Arial,sans-serif;font-size:22px;font-weight:900;color:var(--text);letter-spacing:.5px;text-transform:uppercase;line-height:1.1;margin-bottom:6px">Customer Ready · #' + esc(orderNumber) + '</div>'
    + '<div style="font-size:12px;color:#9AAAC0;margin-bottom:14px">' + (currentReady ? 'Currently <strong style="color:#3DBEFF">confirmed' + (currentBy ? ' by ' + esc(currentBy) : '') + '</strong>' : 'Not yet confirmed. Set when customer has been reached and is ready to receive the shipment.') + '</div>'
    + '<div style="font-size:11px;color:#9AAAC0;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Confirmed by</div>'
    + '<input type="text" id="custReadyBy" placeholder="Your name (e.g. Ken)" autocomplete="off" value="' + esc(currentBy || _custReadyDefaultName_()) + '" style="width:100%;padding:10px;font-size:14px;background:#000;color:var(--text);border:1px solid rgba(255,255,255,.20);border-radius:8px;outline:none;margin-bottom:10px">'
    + '<div style="font-size:11px;color:#9AAAC0;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Notes (optional)</div>'
    + '<textarea id="custReadyNotes" rows="3" placeholder="e.g. customer confirmed 5/14 — OK any day next week" style="width:100%;padding:10px;font-size:13px;background:#000;color:var(--text);border:1px solid rgba(255,255,255,.20);border-radius:8px;outline:none;margin-bottom:14px;resize:vertical;font-family:inherit">' + esc(_cleanNotes || '') + '</textarea>'
    + '<div style="font-size:11px;color:#9AAAC0;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Hold until <span style="text-transform:none;letter-spacing:0">(optional — customer asked to delay to this date)</span></div>'
    + '<div style="display:flex;gap:8px;align-items:center;margin-bottom:14px">'
    +   '<input type="date" id="custReadyHold" value="' + esc(_hold ? _hold.iso : '') + '" style="flex:1;padding:10px;font-size:14px;background:#000;color:var(--text);border:1px solid rgba(255,255,255,.20);border-radius:8px;outline:none;font-family:inherit">'
    +   '<button type="button" onclick="var e=document.getElementById(\'custReadyHold\');if(e)e.value=\'\'" style="padding:10px 12px;background:#2a2a2a;color:#aaa;border:1px solid #444;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap">Clear</button>'
    + '</div>'
    + '<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:10px">'
    +   '<button onclick="setCustomerReady_(\''+esc(orderNumber)+'\',true)" style="padding:14px;background:linear-gradient(180deg,#0099CC,#005577);color:#fff;border:1.5px solid #3DBEFF;border-radius:10px;font-size:15px;font-weight:900;cursor:pointer;letter-spacing:.5px;text-transform:uppercase">✓ Customer Ready</button>'
    +   (currentReady ? '<button onclick="setCustomerReady_(\''+esc(orderNumber)+'\',false)" style="padding:12px;background:rgba(255,82,82,.12);color:#ff5252;border:1px solid rgba(255,82,82,.4);border-radius:10px;font-size:13px;font-weight:800;cursor:pointer">Mark Not Ready</button>' : '')
    + '</div>'
    + '<button onclick="document.getElementById(\'customerReadyOverlay\').remove()" style="width:100%;padding:10px;background:#2a2a2a;color:#aaa;border:1px solid #444;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer">Cancel</button>';
  ov.appendChild(panel);
  document.body.appendChild(ov);
  setTimeout(() => {
    const inp = document.getElementById('custReadyBy');
    if (inp && !inp.value) inp.focus();
    else { const n = document.getElementById('custReadyNotes'); if (n) n.focus(); }
  }, 80);
}

async function setCustomerReady_(orderNumber, ready) {
  const byEl = document.getElementById('custReadyBy');
  const notesEl = document.getElementById('custReadyNotes');
  const by = byEl ? String(byEl.value || '').trim() : '';
  // Re-encode the structured hold token: strip any stray one the
  // user may have typed, then prepend the date picker's value so the
  // notes string stays the single round-tripped source of truth.
  const holdEl = document.getElementById('custReadyHold');
  const holdIso = holdEl && /^\d{4}-\d{2}-\d{2}$/.test(String(holdEl.value || '')) ? holdEl.value : '';
  const cleanNotes = _stripHoldToken_(notesEl ? String(notesEl.value || '') : '');
  const notes = (holdIso ? '[HOLD:' + holdIso + '] ' : '') + cleanNotes;
  if (ready && !by) {
    showToast('Enter your name before marking ready');
    if (byEl) byEl.focus();
    return;
  }
  try {
    const res = await groundApi('setCustomerReady', {
      orderNumber: orderNumber,
      ready: ready,
      by: by,
      notes: notes,
    });
    if (!res || !res.ok) {
      showToast('Save failed: ' + ((res && res.error) || 'unknown'));
      return;
    }
    const ov = document.getElementById('customerReadyOverlay');
    if (ov) ov.remove();
    showToast(ready ? '✓ #' + orderNumber + ' marked ready by ' + by : '#' + orderNumber + ' marked not ready');
    refreshScheduleTab();
  } catch (err) {
    showToast('Save error: ' + err.message);
  }
}

async function scheduleReprintFreightLabel(orderNumber) {
  try {
    const res = await groundApi('reprintFreightLabel', { orderNumber: orderNumber });
    if (!res || !res.ok) {
      showToast('Reprint failed: ' + ((res && res.error) || 'unknown'));
      return;
    }
    showToast('🖨 Freight label re-queued for #' + orderNumber);
  } catch (err) {
    showToast('Reprint error: ' + err.message);
  }
}

// v10.4: export the currently-loaded schedule as a CSV download.
// Pure client-side from _scheduleCache — no server call, no risk.
// Kim books freight and sometimes wants the week in a spreadsheet.
function exportScheduleCsv_() {
  const cache = _scheduleCache;
  if (!cache || !cache.days || !cache.days.length) {
    showToast('No schedule loaded — tap Refresh first');
    return;
  }
  const rows = [['Ship Date', 'Source', 'Order #', 'Customer', 'State', 'Carrier', 'Status', 'Booker', 'Booking Ref', 'Customer Ready', 'Stalled Reasons']];
  cache.days.forEach(d => {
    (d.orders || []).forEach(o => {
      rows.push([
        o.ship_date || '',
        o.source || '',
        o.order_number || '',
        o.customer_name || '',
        o.state || '',
        o.carrier_display || o.carrier_key || '',
        o.status || '',
        o.booker || '',
        o.booking_ref || '',
        o.customer_ready ? 'YES' : '',
        (o.stall_reasons || []).join('; '),
      ]);
    });
  });
  const csv = rows.map(r => r.map(cell => {
    const s = String(cell == null ? '' : cell);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n');
  const today = (cache.today || new Date().toISOString().slice(0, 10));
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'bedrock-schedule-' + today + '.csv';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
  showToast('✓ Exported ' + (rows.length - 1) + ' orders to CSV');
}

function _scheduleDayName_(iso) {
  const d = new Date(iso + 'T12:00:00');
  return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
}

// ── Holds — orders blocked from packing ──────────────────
// CS-facing view of every order currently held: Beacon-Hold V1
// orders (fraud / shipping-rules flag), OrderPack pack_status=Hold
// rows (manual-hide via the ⋯ button or breakdown-time auto-hold),
// PackingQueue cabinet-side holds. Jessica uses this to chase down
// what needs attention so held orders aren't invisible.
async function openHoldsPanel(opts) {
  opts = opts || {};
  const kindFilter = String(opts.kind || 'all');
  const prior = document.getElementById('holdsOverlay');
  if (prior) prior.remove();

  const ov = document.createElement('div');
  ov.id = 'holdsOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:flex-end;justify-content:center';
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  ov.innerHTML =
    '<div onclick="event.stopPropagation()" style="background:#fff;width:100%;max-width:720px;max-height:92vh;border-radius:18px 18px 0 0;padding:18px 20px 28px;overflow-y:auto;box-shadow:0 -4px 24px rgba(0,0,0,.3)">'
    + '<div style="width:40px;height:4px;background:#ccc;border-radius:999px;margin:0 auto 14px"></div>'
    + '<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:6px">'
    +   '<div style="font-family:\'Barlow Condensed\',Arial,sans-serif;font-size:24px;font-weight:900;color:#1a1a1a;text-transform:uppercase;letter-spacing:.5px">🚦 Holds</div>'
    +   '<button onclick="document.getElementById(\'holdsOverlay\').remove()" style="background:none;border:none;font-size:24px;color:#999;cursor:pointer;padding:0 4px">✕</button>'
    + '</div>'
    + '<div style="font-size:12px;color:#666;line-height:1.4;margin-bottom:12px">Orders blocked from the active pack queues. Beacon = fraud / shipping-rules flag. Manual = hidden via ⋯ button. Cabinet = freight pack hold.</div>'
    + '<div id="holdsFilters" style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap">'
    + ['all', 'beacon_hold', 'orderpack_hold', 'packingqueue_hold'].map(k =>
        '<button onclick="openHoldsPanel({kind:\'' + k + '\'})" style="flex:1;min-width:60px;padding:7px 4px;background:' + (k === kindFilter ? '#003087' : '#f5f5f5') + ';color:' + (k === kindFilter ? '#fff' : '#444') + ';border:none;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;text-transform:uppercase;letter-spacing:.5px">' + (k === 'all' ? 'All' : k === 'beacon_hold' ? 'Beacon' : k === 'orderpack_hold' ? 'Ground' : 'Cabinet') + '</button>').join('')
    + '</div>'
    + '<div id="holdsBody" style="min-height:60px">Loading…</div>'
    + '</div>';
  document.body.appendChild(ov);

  let res;
  try { res = await groundApi('listHolds', {}); }
  catch (err) {
    document.getElementById('holdsBody').innerHTML = '<div style="color:#c33;font-weight:700;padding:14px">Error: ' + esc(err.message) + '</div>';
    return;
  }
  if (!res || !res.ok) {
    document.getElementById('holdsBody').innerHTML = '<div style="color:#c33;font-weight:700;padding:14px">Error: ' + esc((res && res.error) || 'unknown') + '</div>';
    return;
  }
  const rows = (res.holds || []).filter(r => kindFilter === 'all' || r.kind === kindFilter);
  if (!rows.length) {
    document.getElementById('holdsBody').innerHTML = '<div style="padding:24px;text-align:center;color:#0a8a3f;background:rgba(0,200,83,.06);border:1px dashed rgba(0,200,83,.40);border-radius:10px;font-size:13px;font-weight:700">✓ No orders on hold in this view.</div>';
    return;
  }

  const KIND_COLORS = { beacon_hold: '#9C27B0', orderpack_hold: '#FF6B00', packingqueue_hold: '#FFB300' };
  const KIND_LABELS = { beacon_hold: 'BEACON', orderpack_hold: 'GROUND', packingqueue_hold: 'CABINET' };
  document.getElementById('holdsBody').innerHTML = rows.map(h => {
    const color = KIND_COLORS[h.kind] || '#666';
    const dateStr = String(h.held_at || h.order_date || h.ship_date || '').slice(0, 10);
    const itemsList = (h.items || []).map(i => esc(i.qty + '× ' + i.sku)).join(', ');
    const total = h.order_total ? '<span style="color:#1A5C1A;font-weight:700">$' + Number(h.order_total).toLocaleString() + '</span>' : '';
    // Resume action — only for orderpack_hold (calls resumeOrderFromHold).
    // Beacon-held orders need clearing in ShipStation first (Bedrock can't
    // override Beacon directly). PackingQueue cabinet holds — manager
    // would use the existing cabinet flow.
    const resumeBtn = (h.kind === 'orderpack_hold' && h.order_id)
      ? '<button onclick="resumeHoldFromPanel_(\'' + esc(h.order_id) + '\',\'' + esc(h.order_number) + '\')" style="padding:10px 16px;background:rgba(0,200,83,.12);color:#1A5C1A;border:1px solid #00C853;border-radius:6px;font-size:13px;font-weight:800;cursor:pointer;margin-top:8px;min-height:40px;display:inline-flex;align-items:center;justify-content:center;margin-right:6px">↩ Resume to queue</button>'
      : (h.kind === 'beacon_hold'
          ? '<div style="font-size:10px;color:#9C27B0;margin-top:6px;font-weight:700">↪ Clear in ShipStation (Beacon)</div>'
          : '');
    // v10.223 — permanent-delete button (manager-PIN gated). Per Zac:
    // stale ShipStation holds had no way to be cleared from Bedrock.
    const deleteBtn = '<button onclick="deleteHoldFromPanel_(\'' + esc(h.order_id || '') + '\',\'' + esc(h.order_number) + '\',\'' + esc(h.kind || '') + '\')" style="padding:10px 14px;background:rgba(139,0,0,.10);color:#8B0000;border:1px solid #8B0000;border-radius:6px;font-size:12px;font-weight:800;cursor:pointer;margin-top:8px;min-height:40px;display:inline-flex;align-items:center;justify-content:center" title="Permanently remove this hold row from the underlying tab (manager PIN required)">🗑 Delete (PIN)</button>';
    return '<div style="padding:12px;background:#fafafa;border-left:3px solid ' + color + ';border-radius:8px;margin-bottom:8px;font-size:13px">'
      + '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;flex-wrap:wrap;gap:6px">'
      +   '<div><span style="font-family:\'JetBrains Mono\',monospace;font-weight:900;color:#1a1a1a">#' + esc(h.order_number) + '</span> ' + total + '</div>'
      +   '<span style="font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:1px;color:' + color + '">' + KIND_LABELS[h.kind] + '</span>'
      + '</div>'
      + '<div style="font-weight:700;color:#1a1a1a">' + esc(h.customer_name || '—') + (h.state ? ' · ' + esc(h.state) : '') + '</div>'
      + (h.customer_email ? '<div style="font-size:12px;color:#666">' + esc(h.customer_email) + '</div>' : '')
      + (itemsList ? '<div style="font-size:12px;color:#666;margin-top:4px">' + itemsList + '</div>' : '')
      + '<div style="font-size:11px;color:#888;font-style:italic;margin-top:6px">' + esc(h.hold_reason || '(no reason)') + '</div>'
      + (dateStr ? '<div style="font-size:10px;color:#aaa;margin-top:3px;font-family:monospace">' + dateStr + '</div>' : '')
      + '<div style="display:flex;gap:6px;flex-wrap:wrap">' + resumeBtn + deleteBtn + '</div>'
      + '</div>';
  }).join('');
}

async function resumeHoldFromPanel_(orderId, orderNumber) {
  if (!confirm('Resume #' + orderNumber + ' to the Ground queue?')) return;
  try {
    const res = await groundApi('resumeOrderFromHold', { orderId: Number(orderId) });
    if (!res || !res.ok) { showToast('Resume failed: ' + ((res && res.error) || 'unknown')); return; }
    showToast('✓ #' + orderNumber + ' resumed');
    openHoldsPanel();
  } catch (err) {
    showToast('Resume error: ' + err.message);
  }
}

// v10.223 — permanent-delete a hold record. Per Zac 2026-05-22 20:00
// EDT: "you have the old orders that got stuck from ShipStation in
// 'holds' as though they're anything legitimate, with no way to
// permanently delete/clear them". Manager-PIN gated so a stray tap
// doesn't lose data.
async function deleteHoldFromPanel_(orderId, orderNumber, holdKind) {
  if (!confirm('Permanently DELETE the hold record for #' + orderNumber + '?\n\nThis removes the row from the underlying tab. The order itself in ShipStation/PackingQueue is NOT touched. Use this when a hold is stale + you want it out of the list.')) return;
  const pin = prompt('Manager PIN (delete is irreversible):');
  if (!pin) return;
  try {
    const res = await groundApi('deleteHold', {
      orderId: Number(orderId) || 0,
      orderNumber: String(orderNumber),
      holdKind: String(holdKind || ''),
      managerPin: pin,
    });
    if (!res || !res.ok) { showToast('Delete failed: ' + ((res && res.error) || 'unknown')); return; }
    showToast('🗑 #' + orderNumber + ' removed from holds');
    openHoldsPanel();
  } catch (err) {
    showToast('Delete error: ' + err.message);
  }
}

// ══════════════════════════════════════════════════════════════════
// v10.223 — Manufacturing panel (Phase 0 UI on top of v10.222 server)
// ══════════════════════════════════════════════════════════════════

const MFG_STATUS_META = {
  awaiting_designer: { label: 'Awaiting Designer', color: '#FFB300', bg: 'rgba(255,179,0,.12)' },
  awaiting_ops:      { label: 'Awaiting Ops',      color: '#FF6B00', bg: 'rgba(255,107,0,.12)' },
  ready_for_cnc:     { label: 'Ready for CNC',     color: '#003087', bg: 'rgba(0,48,135,.12)' },
  in_progress:       { label: 'In Progress',       color: '#42a5f5', bg: 'rgba(66,165,245,.12)' },
  done:              { label: 'Done',              color: '#00C853', bg: 'rgba(0,200,83,.10)' },
};
const MFG_STAGES = [
  { key: 'queued',     label: 'Queued',     color: '#888' },
  { key: 'cnc',        label: 'CNC',        color: '#1A4FB0' },
  { key: 'denester',   label: 'Denester',   color: '#9C27B0' },
  { key: 'drill_6',    label: '6-Drill',    color: '#FF6B00' },
  { key: 'edgebander', label: 'Edgebander', color: '#FFB300' },
  { key: 'stacker',    label: 'Stacker',    color: '#42a5f5' },
  { key: 'done',       label: 'Done',       color: '#00C853' },
];

async function openManufacturingPanel(opts) {
  opts = opts || {};
  const statusFilter = String(opts.status || '');
  const prior = document.getElementById('mfgOverlay');
  if (prior) prior.remove();

  const ov = document.createElement('div');
  ov.id = 'mfgOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9999;display:flex;align-items:flex-end;justify-content:center';
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  ov.innerHTML =
    '<div onclick="event.stopPropagation()" class="keep-dark-text" style="background:#fff !important;color:#1a1a1a !important;-webkit-text-fill-color:#1a1a1a !important;width:100%;max-width:780px;max-height:94vh;border-radius:18px 18px 0 0;padding:18px 20px 28px;overflow-y:auto;box-shadow:0 -4px 24px rgba(0,0,0,.35);box-sizing:border-box">'
    + '<div style="width:40px;height:4px;background:#ccc;border-radius:999px;margin:0 auto 14px"></div>'
    + '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:10px">'
    +   '<div style="font-family:\'Barlow Condensed\',Arial,sans-serif !important;font-size:24px !important;font-weight:900 !important;color:#1a1a1a !important;-webkit-text-fill-color:#1a1a1a !important;text-transform:uppercase;letter-spacing:.5px">🏭 Manufacturing</div>'
    +   '<button onclick="document.getElementById(\'mfgOverlay\').remove()" style="background:none;border:none;font-size:24px;color:#666 !important;-webkit-text-fill-color:#666 !important;cursor:pointer;padding:0 4px">✕</button>'
    + '</div>'
    + '<div style="font-size:12px;color:#666 !important;-webkit-text-fill-color:#666 !important;line-height:1.5;margin-bottom:12px">Cabinet jobs through the 5-stage pipeline (CNC → Denester → 6-Drill → Edgebander → Stacker). Phase 0: ingest + sign-off + stage advance. Phase 1+ adds Shopify diff + status boards.</div>'
    + '<div style="display:flex;gap:8px;margin-bottom:12px">'
    +   '<button onclick="_openMfgIngestForm_()" style="flex:2;padding:13px;background:linear-gradient(135deg,#1A4FB0,#003087) !important;color:#fff !important;-webkit-text-fill-color:#fff !important;border:none;border-radius:10px;font-size:14px;font-weight:900;cursor:pointer;letter-spacing:.5px;text-transform:uppercase">+ New Job</button>'
    // v10.249 Phase 1 client UI — open the SkuGcodeMap authoring panel.
    +   '<button onclick="openSkuGcodeMapPanel()" style="flex:1;padding:13px;background:transparent !important;color:#1A4FB0 !important;-webkit-text-fill-color:#1A4FB0 !important;border:1.5px solid #1A4FB0 !important;border-radius:10px;font-size:13px;font-weight:900;cursor:pointer;letter-spacing:.4px;text-transform:uppercase">🧬 gcode Map</button>'
    + '</div>'
    + '<div id="mfgStatusFilters" style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap">'
    +   ['', 'awaiting_designer', 'awaiting_ops', 'ready_for_cnc', 'in_progress', 'done'].map(s => {
          const active = s === statusFilter;
          const lbl = s === '' ? 'All' : (MFG_STATUS_META[s] && MFG_STATUS_META[s].label) || s;
          return '<button onclick="openManufacturingPanel({status:\'' + s + '\'})" style="flex:1;min-width:80px;padding:7px 4px;background:' + (active ? '#003087' : '#f5f5f5') + ' !important;color:' + (active ? '#fff' : '#444') + ' !important;-webkit-text-fill-color:' + (active ? '#fff' : '#444') + ' !important;border:none;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;text-transform:uppercase;letter-spacing:.5px">' + esc(lbl) + '</button>';
        }).join('')
    + '</div>'
    + '<div id="mfgListBody" style="min-height:60px;color:#666 !important;-webkit-text-fill-color:#666 !important">Loading…</div>'
    + '</div>';
  document.body.appendChild(ov);

  let res;
  try { res = await groundApi('manufacturingListJobs', statusFilter ? { status: statusFilter } : {}); }
  catch (err) {
    document.getElementById('mfgListBody').innerHTML = '<div style="color:#c33 !important;-webkit-text-fill-color:#c33 !important;padding:14px">Error: ' + esc(err.message) + '</div>';
    return;
  }
  if (!res || !res.ok) {
    document.getElementById('mfgListBody').innerHTML = '<div style="color:#c33 !important;-webkit-text-fill-color:#c33 !important;padding:14px">Error: ' + esc((res && res.error) || 'unknown') + '</div>';
    return;
  }
  const jobs = res.jobs || [];
  if (!jobs.length) {
    document.getElementById('mfgListBody').innerHTML = '<div style="padding:24px;text-align:center;color:#0a8a3f !important;-webkit-text-fill-color:#0a8a3f !important;background:rgba(0,200,83,.06);border:1px dashed rgba(0,200,83,.40);border-radius:10px;font-size:13px;font-weight:700">No jobs in this view. Tap "+ New Job" to ingest one.</div>';
    return;
  }
  document.getElementById('mfgListBody').innerHTML = jobs.map(j => {
    const meta = MFG_STATUS_META[j.status] || MFG_STATUS_META.awaiting_designer;
    const designerSigned = !!j.designer_signed_at;
    const opsSigned = !!j.ops_signed_at;
    const stageMeta = MFG_STAGES.find(s => s.key === j.stage) || MFG_STAGES[0];
    const ingestedDate = String(j.ingested_at || '').slice(0, 16).replace('T', ' ');
    return '<div style="padding:12px;background:' + meta.bg + ' !important;border-left:3px solid ' + meta.color + ' !important;border-radius:8px;margin-bottom:8px;font-size:13px;color:#1a1a1a !important;-webkit-text-fill-color:#1a1a1a !important">'
      + '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;flex-wrap:wrap;gap:6px">'
      +   '<div><span style="font-family:\'JetBrains Mono\',monospace;font-weight:900">#' + esc(j.order_number) + '</span> <span style="color:#666 !important;-webkit-text-fill-color:#666 !important">' + esc(j.customer_name || '') + '</span></div>'
      +   '<span style="font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:1px;color:' + meta.color + ' !important;-webkit-text-fill-color:' + meta.color + ' !important">' + meta.label + '</span>'
      + '</div>'
      + (j.mozaik_source_url ? '<div style="font-size:11px;margin-top:4px"><a href="' + esc(j.mozaik_source_url) + '" target="_blank" style="color:#1A4FB0 !important;-webkit-text-fill-color:#1A4FB0 !important">📁 Mozaik file ↗</a></div>' : '')
      + '<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">'
      +   '<span style="padding:2px 8px;border-radius:999px;font-size:10px;font-weight:800;background:' + (designerSigned ? '#1A5C1A' : '#ccc') + ' !important;color:#fff !important;-webkit-text-fill-color:#fff !important">' + (designerSigned ? '✓' : '○') + ' Designer</span>'
      +   '<span style="padding:2px 8px;border-radius:999px;font-size:10px;font-weight:800;background:' + (opsSigned ? '#1A5C1A' : '#ccc') + ' !important;color:#fff !important;-webkit-text-fill-color:#fff !important">' + (opsSigned ? '✓' : '○') + ' Ops</span>'
      +   '<span style="padding:2px 8px;border-radius:999px;font-size:10px;font-weight:800;background:' + stageMeta.color + ' !important;color:#fff !important;-webkit-text-fill-color:#fff !important">Stage: ' + esc(stageMeta.label) + '</span>'
      + '</div>'
      + '<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">'
      +   (!designerSigned ? '<button onclick="_mfgSignDesigner_(\'' + esc(j.job_id) + '\')" style="padding:7px 12px;background:#1A4FB0 !important;color:#fff !important;-webkit-text-fill-color:#fff !important;border:none;border-radius:6px;font-size:11px;font-weight:800;cursor:pointer">✓ Sign as Designer</button>' : '')
      +   (designerSigned && !opsSigned ? '<button onclick="_mfgSignOps_(\'' + esc(j.job_id) + '\')" style="padding:7px 12px;background:#FF6B00 !important;color:#fff !important;-webkit-text-fill-color:#fff !important;border:none;border-radius:6px;font-size:11px;font-weight:800;cursor:pointer">✓ Sign as Ops (PIN)</button>' : '')
      +   (j.status === 'ready_for_cnc' || j.status === 'in_progress' ? '<button onclick="_mfgAdvanceStage_(\'' + esc(j.job_id) + '\', \'' + esc(j.stage) + '\')" style="padding:7px 12px;background:#00C853 !important;color:#fff !important;-webkit-text-fill-color:#fff !important;border:none;border-radius:6px;font-size:11px;font-weight:800;cursor:pointer">→ Advance Stage</button>' : '')
      + '</div>'
      + '<div style="font-size:10px;color:#999 !important;-webkit-text-fill-color:#999 !important;margin-top:6px;font-family:monospace">' + esc(j.job_id) + ' · ingested ' + esc(ingestedDate) + '</div>'
      + '</div>';
  }).join('');
}

// v10.231 — proper form modal instead of 4 sequential prompt()s
// (was painful on phone — modal stacking + no Cancel + no edit).
function _openMfgIngestForm_() {
  const prior = document.getElementById('mfgIngestFormOverlay');
  if (prior) prior.remove();
  const ov = document.createElement('div');
  ov.id = 'mfgIngestFormOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:10005;display:flex;align-items:center;justify-content:center;padding:14px';
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  ov.innerHTML =
    '<div onclick="event.stopPropagation()" class="keep-dark-text" style="background:#fff !important;color:#1a1a1a !important;-webkit-text-fill-color:#1a1a1a !important;border-radius:14px !important;padding:20px !important;max-width:520px !important;width:100% !important;max-height:92vh !important;overflow-y:auto !important;box-shadow:0 8px 40px rgba(0,0,0,.5) !important">'
    + '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px">'
    +   '<div style="font-family:\'Barlow Condensed\',Arial,sans-serif !important;font-size:22px !important;font-weight:900 !important;color:#1a1a1a !important;-webkit-text-fill-color:#1a1a1a !important;text-transform:uppercase;letter-spacing:.5px">+ New Job</div>'
    +   '<button onclick="document.getElementById(\'mfgIngestFormOverlay\').remove()" style="background:none !important;border:none !important;font-size:22px !important;color:#666 !important;-webkit-text-fill-color:#666 !important;cursor:pointer">✕</button>'
    + '</div>'
    + _mfgFormField_('mfgFormOrderNum', 'Order # (Shopify)', '', 'e.g. 31501', true)
    + _mfgFormField_('mfgFormCustomer', 'Customer name', '', 'optional', false)
    + _mfgFormField_('mfgFormShopifyLink', 'Shopify admin URL', '', 'optional — auto-derived in Phase 1', false)
    // v10.249 Phase 1 client wiring — SKU populates gcode_folder_id at
    // ingest if mapped + auto-skips awaiting_designer. Optional; leave
    // blank for custom/one-off orders that need designer review.
    + _mfgFormField_('mfgFormSku', 'SKU (for gcode lookup)', '', 'optional — e.g. QBZW00-BOAZ-V2-INSTOCK. If mapped in SkuGcodeMap → designer phase auto-skipped', false)
    + _mfgFormField_('mfgFormMozaikUrl', 'Mozaik file link', '', 'Drive URL or any URL (only needed for custom/unmapped orders)', false)
    + '<label style="display:block !important;font-size:11px !important;font-weight:800 !important;color:#444 !important;-webkit-text-fill-color:#444 !important;text-transform:uppercase !important;letter-spacing:1px !important;margin:10px 0 4px !important">Notes (optional)</label>'
    + '<textarea id="mfgFormNotes" rows="2" placeholder="Anything the designer / ops should know" style="width:100% !important;padding:11px 14px !important;font-size:14px !important;font-family:inherit !important;border:1.5px solid #ccc !important;border-radius:8px !important;outline:none !important;background:#fff !important;color:#1a1a1a !important;-webkit-text-fill-color:#1a1a1a !important;resize:vertical !important;box-sizing:border-box !important"></textarea>'
    + '<div style="display:flex;gap:8px;margin-top:16px">'
    +   '<button onclick="document.getElementById(\'mfgIngestFormOverlay\').remove()" style="flex:1 !important;padding:13px !important;background:#f5f5f5 !important;color:#444 !important;-webkit-text-fill-color:#444 !important;border:1.5px solid #ccc !important;border-radius:10px !important;font-size:13px !important;font-weight:700 !important;cursor:pointer !important">Cancel</button>'
    +   '<button onclick="_mfgFormSubmit_()" style="flex:2 !important;padding:13px !important;background:linear-gradient(135deg,#1A4FB0,#003087) !important;color:#fff !important;-webkit-text-fill-color:#fff !important;border:none !important;border-radius:10px !important;font-size:14px !important;font-weight:900 !important;cursor:pointer !important;letter-spacing:.5px !important;text-transform:uppercase !important">Ingest Job</button>'
    + '</div>'
    + '</div>';
  document.body.appendChild(ov);
  setTimeout(() => { const i = document.getElementById('mfgFormOrderNum'); if (i) i.focus(); }, 50);
}

function _mfgFormField_(id, label, value, placeholder, required) {
  const reqMark = required ? ' <span style="color:#c33 !important;-webkit-text-fill-color:#c33 !important">*</span>' : '';
  return '<label style="display:block !important;font-size:11px !important;font-weight:800 !important;color:#444 !important;-webkit-text-fill-color:#444 !important;text-transform:uppercase !important;letter-spacing:1px !important;margin:10px 0 4px !important">' + label + reqMark + '</label>'
    + '<input id="' + id + '" type="text" value="' + esc(value || '') + '" placeholder="' + esc(placeholder || '') + '" autocomplete="off" style="width:100% !important;padding:11px 14px !important;font-size:14px !important;border:1.5px solid #ccc !important;border-radius:8px !important;outline:none !important;background:#fff !important;color:#1a1a1a !important;-webkit-text-fill-color:#1a1a1a !important;box-sizing:border-box !important">';
}

async function _mfgFormSubmit_() {
  const orderNumber = (document.getElementById('mfgFormOrderNum') || {}).value || '';
  if (!orderNumber.trim()) { showToast('Order # is required'); return; }
  const customerName = (document.getElementById('mfgFormCustomer') || {}).value || '';
  const shopifyLink = (document.getElementById('mfgFormShopifyLink') || {}).value || '';
  const mozaikUrl = (document.getElementById('mfgFormMozaikUrl') || {}).value || '';
  const sku = (document.getElementById('mfgFormSku') || {}).value || '';
  const notes = (document.getElementById('mfgFormNotes') || {}).value || '';
  try {
    const res = await groundApi('manufacturingIngestJob', {
      orderNumber: orderNumber.trim(),
      customerName: customerName.trim(),
      shopifyLink: shopifyLink.trim(),
      mozaikUrl: mozaikUrl.trim(),
      sku: sku.trim().toUpperCase(),  // v10.249 — server looks up SkuGcodeMap if present
      notes: notes.trim(),
      deviceId: (typeof getPackDeviceId_ === 'function' ? getPackDeviceId_() : 'unknown'),
    });
    if (!res || !res.ok) { showToast('Ingest failed: ' + ((res && res.error) || 'unknown')); return; }
    // v10.249 — clearer feedback when designer phase is auto-skipped
    // (SKU was mapped to a gcode folder).
    let msg = '✓ Job ' + res.job_id + ' ingested';
    if (res.designer_phase_skipped) msg += ' (gcode mapped, designer phase skipped — awaiting ops)';
    showToast(msg);
    document.getElementById('mfgIngestFormOverlay').remove();
    openManufacturingPanel();
  } catch (err) {
    showToast('Ingest error: ' + err.message);
  }
}

function _mfgSignDesigner_(jobId) {
  if (!confirm('Sign as Designer for ' + jobId + '?\n\nThis confirms the Mozaik file matches the spec.')) return;
  groundApi('manufacturingSignDesigner', {
    jobId: jobId,
    deviceId: (typeof getPackDeviceId_ === 'function' ? getPackDeviceId_() : 'unknown'),
  }).then(res => {
    if (!res || !res.ok) { showToast('Sign failed: ' + ((res && res.error) || 'unknown')); return; }
    showToast('✓ Signed (designer)');
    openManufacturingPanel();
  });
}

function _mfgSignOps_(jobId) {
  const pin = prompt('Manager PIN to sign as Ops:');
  if (!pin) return;
  groundApi('manufacturingSignOps', {
    jobId: jobId,
    deviceId: (typeof getPackDeviceId_ === 'function' ? getPackDeviceId_() : 'unknown'),
    managerPin: pin,
  }).then(res => {
    if (!res || !res.ok) { showToast('Sign failed: ' + ((res && res.error) || 'unknown')); return; }
    showToast('✓ Signed (ops) — job ready for CNC');
    openManufacturingPanel();
  });
}

function _mfgAdvanceStage_(jobId, currentStage) {
  // Auto-pick the next stage in the pipeline
  const order = ['queued', 'cnc', 'denester', 'drill_6', 'edgebander', 'stacker', 'done'];
  const idx = order.indexOf(currentStage);
  if (idx === -1 || idx >= order.length - 1) { showToast('Already at final stage'); return; }
  const nextStage = order[idx + 1];
  const next = MFG_STAGES.find(s => s.key === nextStage);
  if (!confirm('Advance to next stage: ' + (next ? next.label : nextStage) + '?')) return;
  groundApi('manufacturingAdvanceStage', {
    jobId: jobId,
    stage: nextStage,
    deviceId: (typeof getPackDeviceId_ === 'function' ? getPackDeviceId_() : 'unknown'),
  }).then(res => {
    if (!res || !res.ok) { showToast('Advance failed: ' + ((res && res.error) || 'unknown')); return; }
    showToast('→ Advanced to ' + (next ? next.label : nextStage));
    openManufacturingPanel();
  });
}

// ══════════════════════════════════════════════════════════════════
// v10.223 — Pick-List BOM expander (Phase 0 UI on top of v10.222 server)
// ══════════════════════════════════════════════════════════════════

// v10.228 — 3-mode panel: BOM expand / Variant resolve / Admin.
let _pickListPanelMode = 'bom';
let _pickListPickerVisibleOnly = false;  // v10.235 F2 client toggle

async function openPickListPanel(opts) {
  opts = opts || {};
  _pickListPanelMode = opts.mode || _pickListPanelMode || 'bom';
  const prior = document.getElementById('pickListOverlay');
  if (prior) prior.remove();

  const ov = document.createElement('div');
  ov.id = 'pickListOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9999;display:flex;align-items:flex-end;justify-content:center';
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };

  const MODES = [
    { key: 'bom',     label: '🧬 BOM Expand' },
    { key: 'variant', label: '🛒 Variant Resolve' },
    { key: 'admin',   label: '⚙ Admin' },
  ];

  let bodyHtml = '';
  if (_pickListPanelMode === 'bom') {
    bodyHtml = ''
      + '<div style="font-size:12px;color:#666 !important;-webkit-text-fill-color:#666 !important;line-height:1.5;margin-bottom:12px">Recursive bundle expansion from Kristine\'s sheet. Type a bundle SKU (e.g. <code>BOAZ-BUNDLE</code>) → flat element list with cumulative qty per 1 parent.</div>'
      + '<div style="display:flex;gap:8px;margin-bottom:10px">'
      +   '<input id="pickListExpandInput" type="text" placeholder="bundle SKU (e.g. BOAZ-BUNDLE)" autocomplete="off" autocapitalize="characters" style="flex:1;padding:11px 14px;font-family:\'JetBrains Mono\',monospace !important;font-size:14px;border:2px solid #1A4FB0 !important;border-radius:8px;outline:none;background:#fff !important;color:#1a1a1a !important;-webkit-text-fill-color:#1a1a1a !important">'
      +   '<button onclick="_pickListExpand_()" style="padding:11px 18px;background:#1A4FB0 !important;color:#fff !important;-webkit-text-fill-color:#fff !important;border:none;border-radius:8px;font-size:13px;font-weight:900;cursor:pointer;letter-spacing:.5px;text-transform:uppercase">Expand</button>'
      + '</div>'
      + '<div id="pickListExpandResult" style="min-height:120px;color:#1a1a1a !important;-webkit-text-fill-color:#1a1a1a !important"></div>';
  } else if (_pickListPanelMode === 'variant') {
    bodyHtml = ''
      + '<div style="font-size:12px;color:#666 !important;-webkit-text-fill-color:#666 !important;line-height:1.5;margin-bottom:12px">Resolves a Shopify variant SKU → walks the Variant Map → recursive BOM expansion across all bundles → flat element list with qtys. The keystone endpoint: "what does this order actually need from inventory?".</div>'
      + '<div style="display:flex;gap:8px;margin-bottom:10px">'
      +   '<input id="pickListVariantInput" type="text" placeholder="variant SKU (e.g. BOAZ-QUEEN)" autocomplete="off" autocapitalize="characters" style="flex:1;padding:11px 14px;font-family:\'JetBrains Mono\',monospace !important;font-size:14px;border:2px solid #1A4FB0 !important;border-radius:8px;outline:none;background:#fff !important;color:#1a1a1a !important;-webkit-text-fill-color:#1a1a1a !important">'
      +   '<button onclick="_pickListResolveVariant_()" style="padding:11px 18px;background:#9C27B0 !important;color:#fff !important;-webkit-text-fill-color:#fff !important;border:none;border-radius:8px;font-size:13px;font-weight:900;cursor:pointer;letter-spacing:.5px;text-transform:uppercase">Resolve</button>'
      + '</div>'
      // v10.235 F2 client toggle — pickerVisibleOnly filters packaging items
      // (BUMPER, PALLET, STRETCH, STRAPPING) so the list matches Kristine\'s
      // physical pick PDF format instead of the full inventory BOM.
      + '<label style="display:flex;align-items:center;gap:8px;margin-bottom:12px;cursor:pointer;font-size:13px;color:#1a1a1a !important;-webkit-text-fill-color:#1a1a1a !important;user-select:none">'
      +   '<input type="checkbox" id="pickListPickerOnly" ' + (_pickListPickerVisibleOnly ? 'checked' : '') + ' onchange="_pickListPickerVisibleOnly = this.checked; const inp = document.getElementById(\'pickListVariantInput\'); if (inp && inp.value.trim()) _pickListResolveVariant_();" style="width:18px;height:18px;cursor:pointer;accent-color:#9C27B0">'
      +   '<span>📋 <strong>Picker view</strong> — hide packaging items (BUMPER BOARD, PALLET CARDBOARD, STRAPPING). Matches Kristine\'s pick PDF format.</span>'
      + '</label>'
      + '<div id="pickListVariantResult" style="min-height:120px;color:#1a1a1a !important;-webkit-text-fill-color:#1a1a1a !important"></div>';
  } else {
    // Admin mode — ingest helpers + status
    bodyHtml = ''
      + '<div style="font-size:12px;color:#666 !important;-webkit-text-fill-color:#666 !important;line-height:1.5;margin-bottom:12px">Re-ingest from Kristine\'s sheet. Tap each in order on first-time setup or whenever the source sheet changes. Each runs in ~5-15s.</div>'
      + '<div id="pickListAdminBtns" style="display:flex;flex-direction:column;gap:8px">'
      +   _pickListAdminButton_('pickListIngestBundleBom',       '1. Ingest Bundle BOM',           '~430 rows (auto-discovers TREND tab)',      '#003087')
      +   _pickListAdminButton_('pickListIngestVariantMap',      '2. Ingest Variant Map',          '~92 rows (Shopify variant → bundle map)',    '#1A4FB0')
      +   _pickListAdminButton_('pickListIngestVendorMap',       '3. Ingest Vendor Map',           '~190 rows (element → vendor)',                '#9C27B0')
      +   _pickListAdminButton_('pickListIngestElementInventory','4. Ingest Element Inventory',    '~80 elements × 5 warehouses (slowest)',       '#FF6B00')
      + '</div>'
      + '<div id="pickListAdminResult" style="min-height:40px;margin-top:14px;color:#1a1a1a !important;-webkit-text-fill-color:#1a1a1a !important;font-size:12px;font-family:monospace !important;white-space:pre-wrap"></div>';
  }

  ov.innerHTML =
    '<div onclick="event.stopPropagation()" class="keep-dark-text" style="background:#fff !important;color:#1a1a1a !important;-webkit-text-fill-color:#1a1a1a !important;width:100%;max-width:680px;max-height:94vh;border-radius:18px 18px 0 0;padding:18px 20px 28px;overflow-y:auto;box-shadow:0 -4px 24px rgba(0,0,0,.35);box-sizing:border-box">'
    + '<div style="width:40px;height:4px;background:#ccc;border-radius:999px;margin:0 auto 14px"></div>'
    + '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:10px">'
    +   '<div style="font-family:\'Barlow Condensed\',Arial,sans-serif !important;font-size:24px !important;font-weight:900 !important;color:#1a1a1a !important;-webkit-text-fill-color:#1a1a1a !important;text-transform:uppercase;letter-spacing:.5px">🧬 Pick-List</div>'
    +   '<button onclick="document.getElementById(\'pickListOverlay\').remove()" style="background:none;border:none;font-size:24px;color:#666 !important;-webkit-text-fill-color:#666 !important;cursor:pointer;padding:0 4px">✕</button>'
    + '</div>'
    + '<div style="display:flex;gap:6px;margin-bottom:12px">'
    +   MODES.map(m => {
          const active = m.key === _pickListPanelMode;
          return '<button onclick="openPickListPanel({mode:\'' + m.key + '\'})" style="flex:1;padding:9px;background:' + (active ? '#003087' : '#f5f5f5') + ' !important;color:' + (active ? '#fff' : '#444') + ' !important;-webkit-text-fill-color:' + (active ? '#fff' : '#444') + ' !important;border:none;border-radius:8px;font-size:13px;font-weight:800;cursor:pointer;letter-spacing:.5px">' + m.label + '</button>';
        }).join('')
    + '</div>'
    + bodyHtml
    + '</div>';
  document.body.appendChild(ov);

  setTimeout(() => {
    const inp = document.getElementById(_pickListPanelMode === 'bom' ? 'pickListExpandInput' : 'pickListVariantInput');
    if (inp) {
      inp.focus();
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (_pickListPanelMode === 'bom') _pickListExpand_();
          else if (_pickListPanelMode === 'variant') _pickListResolveVariant_();
        }
      });
    }
  }, 50);
}

function _pickListAdminButton_(endpoint, label, hint, color) {
  return '<button onclick="_pickListAdminRun_(\'' + endpoint + '\', this)" style="display:flex;align-items:center;gap:12px;padding:14px 16px;background:#fff !important;color:#1a1a1a !important;-webkit-text-fill-color:#1a1a1a !important;border:1.5px solid ' + color + ' !important;border-left:5px solid ' + color + ' !important;border-radius:10px;font-size:14px;font-weight:800;cursor:pointer;text-align:left">'
    + '<div style="flex:1"><div style="color:' + color + ' !important;-webkit-text-fill-color:' + color + ' !important;text-transform:uppercase;letter-spacing:.5px;font-size:13px">' + esc(label) + '</div><div style="font-size:11px;color:#666 !important;-webkit-text-fill-color:#666 !important;font-weight:500;margin-top:2px">' + esc(hint) + '</div></div>'
    + '<span style="color:' + color + ' !important;-webkit-text-fill-color:' + color + ' !important;font-size:18px;font-weight:900">↻</span>'
    + '</button>';
}

async function _pickListAdminRun_(endpoint, btn) {
  if (!confirm('Re-ingest from Kristine\'s sheet via ' + endpoint + '?\n\nClears + re-fills the target Bedrock tab. Idempotent. Takes ~5-30s.')) return;
  const out = document.getElementById('pickListAdminResult');
  if (btn) { btn.style.opacity = '.5'; btn.style.pointerEvents = 'none'; }
  if (out) out.textContent = '⟳ Running ' + endpoint + '…';
  try {
    const res = await groundApi(endpoint, {});
    if (out) out.textContent = JSON.stringify(res, null, 2);
    if (btn) { btn.style.opacity = '1'; btn.style.pointerEvents = ''; }
    if (res && res.ok) showToast('✓ ' + endpoint + ' done');
    else showToast('⚠ ' + endpoint + ' failed: ' + ((res && res.error) || 'unknown'));
  } catch (err) {
    if (out) out.textContent = 'Error: ' + err.message;
    if (btn) { btn.style.opacity = '1'; btn.style.pointerEvents = ''; }
    showToast('⚠ ' + endpoint + ' error: ' + err.message);
  }
}

// v10.240 — picking a partial-match suggestion fills the input + re-resolves.
function _pickListResolvePickMatch_(sku) {
  const inp = document.getElementById('pickListVariantInput');
  if (inp) inp.value = sku;
  _pickListResolveVariant_();
}

async function _pickListResolveVariant_() {
  const inp = document.getElementById('pickListVariantInput');
  const out = document.getElementById('pickListVariantResult');
  if (!inp || !out) return;
  const sku = String(inp.value || '').trim().toUpperCase();
  if (!sku) { out.innerHTML = '<div style="color:#888 !important;-webkit-text-fill-color:#888 !important;font-size:13px">Type a variant SKU above.</div>'; return; }
  out.innerHTML = '<div style="color:#666 !important;-webkit-text-fill-color:#666 !important;font-size:13px">Resolving…</div>';
  try {
    const res = await groundApi('pickListResolveVariant', { variantSku: sku, pickerVisibleOnly: _pickListPickerVisibleOnly, partialOk: true });
    if (!res || !res.ok) {
      // v10.240 — surface partial-match suggestions as tappable chips
      // (Zac 19:08 EDT: "should show all matches to a partial search
      // like qpw4m or qbz or Boaz-v2").
      if (res && res.partial_match && Array.isArray(res.matches) && res.matches.length) {
        out.innerHTML = '<div style="font-size:13px;color:#1a1a1a !important;-webkit-text-fill-color:#1a1a1a !important;margin-bottom:8px">'
          + '<strong>' + res.matches.length + ' variant(s)</strong> contain <code>' + esc(sku) + '</code> — tap to resolve:</div>'
          + '<div style="display:flex;flex-direction:column;gap:4px">'
          + res.matches.map(m => '<button onclick="_pickListResolvePickMatch_(\'' + esc(m) + '\')" style="padding:9px 12px;background:#fafafa !important;color:#1a1a1a !important;-webkit-text-fill-color:#1a1a1a !important;border:1px solid #ddd !important;border-left:3px solid #9C27B0 !important;border-radius:6px;font-family:\'JetBrains Mono\',monospace !important;font-size:12px;text-align:left;cursor:pointer;font-weight:600" onmouseover="this.style.background=\'#F0F4FB\';this.style.borderColor=\'#1A4FB0\'" onmouseout="this.style.background=\'#fafafa\';this.style.borderColor=\'#ddd\'">' + esc(m) + '</button>').join('')
          + '</div>';
        return;
      }
      out.innerHTML = '<div style="color:#c33 !important;-webkit-text-fill-color:#c33 !important;font-size:13px;padding:14px">Error: ' + esc((res && res.error) || 'unknown') + '</div>';
      return;
    }
    // v10.235 F2: show picker-visible / full counts so the toggle\'s effect is visible.
    const fullCount = res.full_distinct_count != null ? res.full_distinct_count : res.distinct_count;
    const visibleCount = res.picker_visible_count != null ? res.picker_visible_count : res.distinct_count;
    const filterNote = _pickListPickerVisibleOnly
      ? ' <span style="color:#9C27B0 !important;-webkit-text-fill-color:#9C27B0 !important;font-weight:700">(picker view: ' + visibleCount + ' of ' + fullCount + ' elements shown)</span>'
      : (visibleCount !== fullCount ? ' <span style="color:#888 !important;-webkit-text-fill-color:#888 !important;font-size:11px">(' + (fullCount - visibleCount) + ' packaging items will hide in picker view)</span>' : '');
    let html = '<div style="font-size:13px;margin-bottom:10px">'
      + '<strong>' + esc(sku) + '</strong> resolves to <strong>' + res.distinct_count + '</strong> distinct element(s) across ' + (res.bundles || []).length + ' bundle(s)' + filterNote + ':'
      + '<div style="font-size:11px;color:#666 !important;-webkit-text-fill-color:#666 !important;margin-top:4px">Bundles: ' + (res.bundles || []).map(b => '<code>' + esc(b) + '</code>').join(', ') + '</div>'
      + '</div>';
    html += '<div style="margin-top:8px">';
    html += (res.elements || []).map(e => {
      // v10.235 F2: dim packaging items + pkg tag when in full-view mode
      const isPkg = e.picker_visible === false;
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:' + (isPkg ? '#f5f5f5' : '#fafafa') + ' !important;border:1px solid ' + (isPkg ? '#e0e0e0' : '#eee') + ' !important;border-radius:6px;margin-bottom:4px;font-size:13px;color:#1a1a1a !important;-webkit-text-fill-color:#1a1a1a !important;opacity:' + (isPkg ? '.6' : '1') + '">'
        + '<span style="font-family:\'JetBrains Mono\',monospace !important;font-weight:700">' + esc(e.sku) + (isPkg ? ' <span style="font-size:9px;background:#888 !important;color:#fff !important;-webkit-text-fill-color:#fff !important;padding:1px 5px;border-radius:3px;font-weight:900;letter-spacing:.5px;font-family:Arial,sans-serif !important">PKG</span>' : '') + '</span>'
        + '<span style="font-family:\'Barlow Condensed\',Arial,sans-serif !important;font-size:18px;font-weight:900;color:' + (isPkg ? '#888' : '#1A5C1A') + ' !important;-webkit-text-fill-color:' + (isPkg ? '#888' : '#1A5C1A') + ' !important">×' + e.qty + '</span>'
        + '</div>';
    }).join('');
    html += '</div>';
    // Per-bundle breakdown (debug)
    if (res.per_bundle && res.per_bundle.length) {
      html += '<details style="margin-top:12px"><summary style="font-size:11px;color:#888 !important;-webkit-text-fill-color:#888 !important;cursor:pointer;text-transform:uppercase;letter-spacing:1px;font-weight:700;padding:6px 0">per-bundle breakdown</summary>';
      html += res.per_bundle.map(b => {
        const bodyContent = b.elements
          ? '<div style="font-size:11px;color:#444 !important;-webkit-text-fill-color:#444 !important">' + b.elements.length + ' element(s)</div>'
          : '<div style="color:#c33 !important;-webkit-text-fill-color:#c33 !important;font-size:11px">' + esc(b.error || '?') + '</div>';
        return '<div style="padding:6px 10px;border-left:2px solid #ddd;margin-top:4px;font-size:12px"><strong>' + esc(b.bundle) + '</strong> ' + bodyContent + '</div>';
      }).join('');
      html += '</details>';
    }
    out.innerHTML = html;
  } catch (err) {
    out.innerHTML = '<div style="color:#c33 !important;-webkit-text-fill-color:#c33 !important;font-size:13px;padding:14px">Error: ' + esc(err.message) + '</div>';
  }
}

// ══════════════════════════════════════════════════════════════════
// v10.254 — Manufacturing Phase 2 status board (warehouse + office)
// ══════════════════════════════════════════════════════════════════
//
// Per docs/MANUFACTURING.md Phase 4 plan. Hijacks the PWA when
// ?board=warehouse or ?board=office is in the URL. Renders a
// full-screen kanban of the 5-stage CNC pipeline. Auto-refreshes
// every 30s. Designed for a wall-mounted TV or kiosk — big fonts,
// no PWA chrome, just the board.
//
// Two views (toggled by ?board= value):
//   warehouse — 5-column kanban (CNC · Denester · 6-Drill ·
//               Edgebander · Stacker). Each column shows currently-
//               running job + queued jobs for that stage.
//   office    — pipeline overview: today's jobs by status, total
//               throughput, blocked jobs needing attention. Less
//               operator-focused, more "is the line moving."

let _mfgBoardMode = '';
let _mfgBoardRefreshTimer = null;

const MFG_BOARD_STAGES = [
  { key: 'queued',     label: 'Queued',     color: '#888888' },
  { key: 'cnc',        label: 'CNC',        color: '#1A4FB0' },
  { key: 'denester',   label: 'Denester',   color: '#42a5f5' },
  { key: 'drill_6',    label: '6-Drill',    color: '#9C27B0' },
  { key: 'edgebander', label: 'Edgebander', color: '#FF6B00' },
  { key: 'stacker',    label: 'Stacker',    color: '#00C853' },
  { key: 'done',       label: 'Done',       color: '#1A5C1A' },
];

function _enterManufacturingBoardMode_(mode) {
  _mfgBoardMode = (mode === 'office') ? 'office' : 'warehouse';
  document.title = (_mfgBoardMode === 'office' ? 'Office' : 'Warehouse') + ' Board — Bedrock';
  // Hide all PWA chrome: tabs, nav, panels, version pill.
  document.body.style.background = '#0a0a0a';
  document.body.style.color = '#fff';
  document.body.style.fontFamily = "'Barlow Condensed', Arial, sans-serif";
  document.body.style.overflow = 'hidden';
  // Wipe everything in <body> except the version pill (still useful)
  // and inject the board container.
  const versionPill = document.getElementById('versionPill');
  document.body.innerHTML = '';
  if (versionPill) {
    document.body.appendChild(versionPill);
    versionPill.style.opacity = '0.35';
  }
  const root = document.createElement('div');
  root.id = 'mfgBoardRoot';
  root.style.cssText = 'position:fixed;inset:0;background:#0a0a0a;color:#fff;font-family:\'Barlow Condensed\',Arial,sans-serif;padding:16px;overflow:hidden;display:flex;flex-direction:column';
  document.body.appendChild(root);
  _renderManufacturingBoard_();
  // Auto-refresh every 30s. Wall-display use case.
  _mfgBoardRefreshTimer = setInterval(_renderManufacturingBoard_, 30000);
}

async function _renderManufacturingBoard_() {
  const root = document.getElementById('mfgBoardRoot');
  if (!root) return;
  let res;
  try { res = await groundApi('manufacturingListJobs', { limit: 200 }); }
  catch (err) {
    root.innerHTML = '<div style="margin:auto;color:#FF5252;font-size:36px;font-weight:900">Board fetch failed: ' + esc(err.message) + '</div>';
    return;
  }
  if (!res || !res.ok) {
    root.innerHTML = '<div style="margin:auto;color:#FF5252;font-size:36px;font-weight:900">Server error: ' + esc((res && res.error) || 'unknown') + '</div>';
    return;
  }
  const jobs = res.jobs || [];
  // Bucket by stage. Jobs with no stage / 'queued' / awaiting status go in the Queued bucket.
  const byStage = {};
  MFG_BOARD_STAGES.forEach(s => { byStage[s.key] = []; });
  jobs.forEach(j => {
    let stage = String(j.stage || 'queued').toLowerCase();
    if (String(j.status || '').toLowerCase() === 'done') stage = 'done';
    else if (!stage || stage === '' || stage === 'queued') stage = 'queued';
    if (!byStage[stage]) byStage[stage] = [];
    byStage[stage].push(j);
  });
  const clock = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const headerCol = '<div style="flex:0 0 auto;display:flex;justify-content:space-between;align-items:baseline;padding-bottom:14px;border-bottom:2px solid #222;margin-bottom:14px">'
    + '<div style="font-size:42px;font-weight:900;letter-spacing:2px;text-transform:uppercase;color:#fff">🏭 ' + (_mfgBoardMode === 'office' ? 'Office Board' : 'Warehouse Board') + '</div>'
    + '<div style="font-size:14px;color:#9AAAC0;font-weight:700;letter-spacing:1px;text-transform:uppercase">' + jobs.length + ' total · clock ' + clock + ' · refresh 30s</div>'
    + '</div>';
  let bodyHtml = '';
  if (_mfgBoardMode === 'office') {
    bodyHtml = _renderMfgOfficeBoard_(jobs, byStage);
  } else {
    bodyHtml = _renderMfgWarehouseBoard_(byStage);
  }
  root.innerHTML = headerCol + bodyHtml;
}

function _renderMfgWarehouseBoard_(byStage) {
  // 7-column horizontal scroller — Queued + 5 active stages + Done.
  // Each column: title + count + scrollable job-card list.
  return '<div style="flex:1;display:grid;grid-template-columns:repeat(' + MFG_BOARD_STAGES.length + ', 1fr);gap:10px;min-height:0">'
    + MFG_BOARD_STAGES.map(s => {
        const jobs = byStage[s.key] || [];
        return '<div style="display:flex;flex-direction:column;background:#15181F;border:2px solid #222;border-top:6px solid ' + s.color + ';border-radius:10px;min-height:0;overflow:hidden">'
          + '<div style="padding:12px 14px;background:#1A1F28;border-bottom:1px solid #222">'
          +   '<div style="font-size:22px;font-weight:900;letter-spacing:1.5px;text-transform:uppercase;color:' + s.color + '">' + s.label + '</div>'
          +   '<div style="font-size:32px;font-weight:900;color:#fff;line-height:1">' + jobs.length + '</div>'
          + '</div>'
          + '<div style="flex:1;overflow-y:auto;padding:8px">' + jobs.map(j => _mfgJobCardBoard_(j, s.color)).join('') + '</div>'
          + '</div>';
      }).join('')
    + '</div>';
}

function _mfgJobCardBoard_(j, accentColor) {
  const orderNum = String(j.order_number || j.job_id || '?');
  const sku = String(j.sku || '').slice(0, 24);
  const cust = String(j.customer_name || '').split(' ')[0] || '—';
  return '<div style="background:#0F1419;border:1px solid #2A3340;border-left:4px solid ' + accentColor + ';border-radius:6px;padding:8px 10px;margin-bottom:6px">'
    + '<div style="font-size:24px;font-weight:900;color:#fff;font-family:\'JetBrains Mono\',monospace;letter-spacing:1px">#' + esc(orderNum) + '</div>'
    + '<div style="font-size:11px;color:#9AAAC0;font-weight:700;margin-top:2px;text-transform:uppercase;letter-spacing:.5px">' + esc(cust) + (sku ? ' · ' + esc(sku) : '') + '</div>'
    + '</div>';
}

function _renderMfgOfficeBoard_(jobs, byStage) {
  // Office board: high-level metrics — counts per status bucket,
  // today's throughput, blocked jobs needing attention.
  const today = new Date().toISOString().slice(0, 10);
  const finishedToday = jobs.filter(j => String(j.finished_at || '').slice(0, 10) === today).length;
  const startedToday = jobs.filter(j => String(j.started_at || '').slice(0, 10) === today).length;
  const blocked = jobs.filter(j => {
    const s = String(j.status || '').toLowerCase();
    return s === 'awaiting_designer' || s === 'awaiting_ops';
  });
  const inProgress = (byStage.cnc || []).concat(byStage.denester || []).concat(byStage.drill_6 || []).concat(byStage.edgebander || []).concat(byStage.stacker || []);
  return '<div style="flex:1;display:flex;flex-direction:column;gap:14px;min-height:0">'
    + '<div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:14px">'
    +   _mfgOfficeStatCard_('Started Today', startedToday, '#1A4FB0')
    +   _mfgOfficeStatCard_('Finished Today', finishedToday, '#00C853')
    +   _mfgOfficeStatCard_('In Pipeline', inProgress.length, '#9C27B0')
    +   _mfgOfficeStatCard_('Blocked', blocked.length, blocked.length > 0 ? '#FF5252' : '#666')
    + '</div>'
    + '<div style="flex:1;display:grid;grid-template-columns:1fr 1fr;gap:14px;min-height:0">'
    +   '<div style="background:#15181F;border:2px solid #222;border-radius:10px;padding:14px;overflow:hidden;display:flex;flex-direction:column">'
    +     '<div style="font-size:20px;font-weight:900;color:#9AAAC0;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:10px">⚠ Blocked (' + blocked.length + ')</div>'
    +     '<div style="flex:1;overflow-y:auto">' + (blocked.length ? blocked.map(j => _mfgJobCardBoard_(j, '#FF5252')).join('') : '<div style="color:#666;font-size:16px">No blocked jobs.</div>') + '</div>'
    +   '</div>'
    +   '<div style="background:#15181F;border:2px solid #222;border-radius:10px;padding:14px;overflow:hidden;display:flex;flex-direction:column">'
    +     '<div style="font-size:20px;font-weight:900;color:#9AAAC0;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:10px">🔧 In Pipeline (' + inProgress.length + ')</div>'
    +     '<div style="flex:1;overflow-y:auto">' + (inProgress.length ? inProgress.map(j => _mfgJobCardBoard_(j, '#9C27B0')).join('') : '<div style="color:#666;font-size:16px">Nothing running.</div>') + '</div>'
    +   '</div>'
    + '</div>'
    + '</div>';
}

function _mfgOfficeStatCard_(label, value, color) {
  return '<div style="background:#15181F;border:2px solid #222;border-top:6px solid ' + color + ';border-radius:10px;padding:18px;text-align:center">'
    + '<div style="font-size:14px;color:#9AAAC0;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:6px">' + esc(label) + '</div>'
    + '<div style="font-size:72px;font-weight:900;color:' + color + ';line-height:1">' + value + '</div>'
    + '</div>';
}

// ══════════════════════════════════════════════════════════════════
// v10.249 — SkuGcodeMap authoring panel (Manufacturing Phase 1 UI)
// ══════════════════════════════════════════════════════════════════
//
// Surfaces the v10.238 server-side mapping. Browse existing SKU →
// gcode-folder mappings + add/edit them. When an order's SKU is
// mapped, manufacturingIngestJob skips the designer phase and goes
// straight to awaiting_ops (designer signed once when authoring).

async function openSkuGcodeMapPanel(opts) {
  opts = opts || {};
  const search = String(opts.search || '');
  const prior = document.getElementById('skuGcodeMapOverlay');
  if (prior) prior.remove();
  const ov = document.createElement('div');
  ov.id = 'skuGcodeMapOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9999;display:flex;align-items:flex-end;justify-content:center';
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  ov.innerHTML =
    '<div onclick="event.stopPropagation()" class="keep-dark-text" style="background:#fff !important;color:#1a1a1a !important;-webkit-text-fill-color:#1a1a1a !important;width:100%;max-width:680px;max-height:94vh;border-radius:18px 18px 0 0;padding:18px 20px 28px;overflow-y:auto;box-shadow:0 -4px 24px rgba(0,0,0,.35);box-sizing:border-box">'
    + '<div style="width:40px;height:4px;background:#ccc;border-radius:999px;margin:0 auto 14px"></div>'
    + '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:8px">'
    +   '<div style="font-family:\'Barlow Condensed\',Arial,sans-serif !important;font-size:22px !important;font-weight:900 !important;color:#1a1a1a !important;-webkit-text-fill-color:#1a1a1a !important;text-transform:uppercase;letter-spacing:.5px">🧬 SKU → gcode Folder Map</div>'
    +   '<button onclick="document.getElementById(\'skuGcodeMapOverlay\').remove()" style="background:none;border:none;font-size:22px;color:#666 !important;-webkit-text-fill-color:#666 !important;cursor:pointer;padding:0 4px">✕</button>'
    + '</div>'
    + '<div style="font-size:12px;color:#666 !important;-webkit-text-fill-color:#666 !important;line-height:1.5;margin-bottom:12px">Maps a cabinet SKU to its pre-baked Drive folder of gcode files. Authoring is one-time per SKU — once mapped, every future Manufacturing job for this SKU auto-skips the designer phase and goes straight to ops sign-off.</div>'
    + '<button onclick="_openSkuGcodeMapForm_()" style="width:100%;padding:13px;background:linear-gradient(135deg,#1A4FB0,#003087) !important;color:#fff !important;-webkit-text-fill-color:#fff !important;border:none;border-radius:10px;font-size:14px;font-weight:900;cursor:pointer;letter-spacing:.5px;text-transform:uppercase;margin-bottom:12px">+ New / Edit Mapping</button>'
    + '<div style="display:flex;gap:8px;margin-bottom:10px">'
    +   '<input id="skuGcodeMapSearch" type="text" value="' + esc(search) + '" placeholder="filter by SKU (substring)" oninput="_skuGcodeMapSearchInput_(this.value)" style="flex:1;padding:9px 12px;font-size:13px;font-family:\'JetBrains Mono\',monospace !important;border:1.5px solid #ccc !important;border-radius:8px;outline:none;background:#fff !important;color:#1a1a1a !important;-webkit-text-fill-color:#1a1a1a !important">'
    + '</div>'
    + '<div id="skuGcodeMapBody" style="min-height:60px;color:#666 !important;-webkit-text-fill-color:#666 !important">Loading…</div>'
    + '</div>';
  document.body.appendChild(ov);

  try {
    const res = await groundApi('skuGcodeMapList', { search: search, activeOnly: false });
    const body = document.getElementById('skuGcodeMapBody');
    if (!res || !res.ok) {
      body.innerHTML = '<div style="color:#c33 !important;-webkit-text-fill-color:#c33 !important;padding:14px">Error: ' + esc((res && res.error) || 'unknown') + '</div>';
      return;
    }
    const mappings = res.mappings || [];
    if (!mappings.length) {
      body.innerHTML = '<div style="padding:24px;text-align:center;color:#666 !important;-webkit-text-fill-color:#666 !important;background:#fafafa !important;border:1px dashed #ccc !important;border-radius:10px;font-size:13px">No SKU → gcode mappings yet. Tap <strong>+ New / Edit Mapping</strong> to author the first one.</div>';
      return;
    }
    body.innerHTML = mappings.map(m => {
      const isInactive = String(m.active || '').toUpperCase() === 'FALSE';
      const folderLink = m.drive_folder_id ? '<a href="https://drive.google.com/drive/folders/' + esc(m.drive_folder_id) + '" target="_blank" style="color:#1A4FB0 !important;-webkit-text-fill-color:#1A4FB0 !important;text-decoration:underline">Drive folder ↗</a>' : '<span style="color:#c33 !important;-webkit-text-fill-color:#c33 !important">no folder</span>';
      return '<div style="padding:10px 12px;background:' + (isInactive ? '#f5f5f5' : '#fff') + ' !important;border:1px solid #ddd !important;border-left:3px solid #1A4FB0 !important;border-radius:8px;margin-bottom:6px;font-size:13px;color:#1a1a1a !important;-webkit-text-fill-color:#1a1a1a !important;opacity:' + (isInactive ? '.55' : '1') + '">'
        + '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap">'
        +   '<span style="font-family:\'JetBrains Mono\',monospace !important;font-weight:900;font-size:13px">' + esc(m.sku) + '</span>'
        +   '<span style="font-size:11px;color:#666 !important;-webkit-text-fill-color:#666 !important;font-weight:700">rev <strong>' + esc(m.revision || 'v1.0.0') + '</strong>' + (isInactive ? ' · <span style="color:#c33 !important;-webkit-text-fill-color:#c33 !important">INACTIVE</span>' : '') + '</span>'
        + '</div>'
        + '<div style="font-size:11px;color:#666 !important;-webkit-text-fill-color:#666 !important;margin-top:4px">' + folderLink + ' · authored by ' + esc(m.authored_by || '—') + ' · ' + esc(String(m.authored_at || '').slice(0, 16).replace('T', ' ')) + '</div>'
        + (m.notes ? '<div style="font-size:11px;color:#444 !important;-webkit-text-fill-color:#444 !important;margin-top:4px;font-style:italic">' + esc(m.notes) + '</div>' : '')
        + '<div style="margin-top:8px;display:flex;gap:6px">'
        +   '<button onclick="_openSkuGcodeMapForm_(\'' + esc(m.sku) + '\')" style="padding:6px 12px;background:#fff !important;color:#1A4FB0 !important;-webkit-text-fill-color:#1A4FB0 !important;border:1px solid #1A4FB0 !important;border-radius:6px;font-size:11px;font-weight:800;cursor:pointer;text-transform:uppercase;letter-spacing:.5px">✎ Edit</button>'
        + '</div>'
        + '</div>';
    }).join('');
  } catch (err) {
    const body = document.getElementById('skuGcodeMapBody');
    if (body) body.innerHTML = '<div style="color:#c33 !important;-webkit-text-fill-color:#c33 !important;padding:14px">Error: ' + esc(err.message) + '</div>';
  }
}

let _skuGcodeMapSearchTimer = null;
function _skuGcodeMapSearchInput_(value) {
  if (_skuGcodeMapSearchTimer) clearTimeout(_skuGcodeMapSearchTimer);
  _skuGcodeMapSearchTimer = setTimeout(() => openSkuGcodeMapPanel({ search: value }), 300);
}

function _openSkuGcodeMapForm_(existingSku) {
  const isEdit = !!existingSku;
  const prior = document.getElementById('skuGcodeMapFormOverlay');
  if (prior) prior.remove();
  const ov = document.createElement('div');
  ov.id = 'skuGcodeMapFormOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:10010;display:flex;align-items:center;justify-content:center;padding:14px';
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  ov.innerHTML =
    '<div onclick="event.stopPropagation()" class="keep-dark-text" style="background:#fff !important;color:#1a1a1a !important;-webkit-text-fill-color:#1a1a1a !important;border-radius:14px;padding:20px;max-width:480px;width:100%;max-height:92vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,.5)">'
    + '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px">'
    +   '<div style="font-family:\'Barlow Condensed\',Arial,sans-serif !important;font-size:20px !important;font-weight:900 !important;color:#1a1a1a !important;-webkit-text-fill-color:#1a1a1a !important;text-transform:uppercase;letter-spacing:.5px">' + (isEdit ? '✎ Edit' : '+ New') + ' SKU Mapping</div>'
    +   '<button onclick="document.getElementById(\'skuGcodeMapFormOverlay\').remove()" style="background:none;border:none;font-size:22px;color:#666 !important;-webkit-text-fill-color:#666 !important;cursor:pointer">✕</button>'
    + '</div>'
    + _mfgFormField_('skuGcodeFormSku', 'SKU', existingSku || '', 'e.g. QBZW00-BOAZ-V2-INSTOCK', true)
    + _mfgFormField_('skuGcodeFormFolderId', 'Drive folder ID or URL', '', 'paste the folder share-URL or the ID', true)
    + _mfgFormField_('skuGcodeFormFileIds', 'File IDs JSON (optional)', '', 'e.g. [\"id1\",\"id2\"]', false)
    + '<label style="display:block !important;font-size:11px !important;font-weight:800 !important;color:#444 !important;-webkit-text-fill-color:#444 !important;text-transform:uppercase !important;letter-spacing:1px !important;margin:10px 0 4px !important">Notes (optional)</label>'
    + '<textarea id="skuGcodeFormNotes" rows="2" placeholder="e.g. uses Blum 110° hinges; switch to Hettich after 2026-08" style="width:100% !important;padding:11px 14px !important;font-size:13px !important;font-family:inherit !important;border:1.5px solid #ccc !important;border-radius:8px !important;outline:none !important;background:#fff !important;color:#1a1a1a !important;-webkit-text-fill-color:#1a1a1a !important;resize:vertical !important;box-sizing:border-box !important"></textarea>'
    + (isEdit ? '<label style="display:flex;align-items:center;gap:8px;margin-top:10px;cursor:pointer;font-size:13px;color:#1a1a1a !important;-webkit-text-fill-color:#1a1a1a !important"><input type="checkbox" id="skuGcodeFormBumpRev" style="width:18px;height:18px;cursor:pointer;accent-color:#1A4FB0">Bump revision (e.g. v1.0.0 → v1.0.1) — for hardware swaps</label>' : '')
    + '<div style="display:flex;gap:8px;margin-top:16px">'
    +   '<button onclick="document.getElementById(\'skuGcodeMapFormOverlay\').remove()" style="flex:1;padding:13px;background:#f5f5f5 !important;color:#444 !important;-webkit-text-fill-color:#444 !important;border:1.5px solid #ccc !important;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer">Cancel</button>'
    +   '<button onclick="_skuGcodeMapFormSubmit_()" style="flex:2;padding:13px;background:linear-gradient(135deg,#1A4FB0,#003087) !important;color:#fff !important;-webkit-text-fill-color:#fff !important;border:none;border-radius:10px;font-size:14px;font-weight:900;cursor:pointer;letter-spacing:.5px;text-transform:uppercase">' + (isEdit ? 'Save Changes' : 'Create Mapping') + '</button>'
    + '</div>'
    + '</div>';
  document.body.appendChild(ov);
  setTimeout(() => { const i = document.getElementById(isEdit ? 'skuGcodeFormFolderId' : 'skuGcodeFormSku'); if (i) i.focus(); }, 50);
}

async function _skuGcodeMapFormSubmit_() {
  const sku = ((document.getElementById('skuGcodeFormSku') || {}).value || '').trim().toUpperCase();
  if (!sku) { showToast('SKU required'); return; }
  const folderInput = ((document.getElementById('skuGcodeFormFolderId') || {}).value || '').trim();
  if (!folderInput) { showToast('Drive folder ID required'); return; }
  // Accept full Drive URL or just the ID. Extract the ID if it's a URL.
  const folderMatch = folderInput.match(/folders\/([a-zA-Z0-9_-]+)/);
  const folderId = folderMatch ? folderMatch[1] : folderInput;
  const fileIdsJson = ((document.getElementById('skuGcodeFormFileIds') || {}).value || '').trim();
  const notes = ((document.getElementById('skuGcodeFormNotes') || {}).value || '').trim();
  const bumpRev = !!(document.getElementById('skuGcodeFormBumpRev') || {}).checked;
  try {
    const res = await groundApi('skuGcodeMapUpsert', {
      sku: sku,
      driveFolderId: folderId,
      fileIdsJson: fileIdsJson,
      notes: notes,
      revisionBump: bumpRev,
      deviceId: (typeof getPackDeviceId_ === 'function' ? getPackDeviceId_() : 'unknown'),
    });
    if (!res || !res.ok) { showToast('Upsert failed: ' + ((res && res.error) || 'unknown')); return; }
    showToast('✓ ' + res.action + ' ' + sku + ' (rev ' + res.revision + ')');
    document.getElementById('skuGcodeMapFormOverlay').remove();
    openSkuGcodeMapPanel();
  } catch (err) {
    showToast('Upsert error: ' + err.message);
  }
}

// ══════════════════════════════════════════════════════════════════
// v10.230 — Customer Ready shadow-log inspector (Phase 1 UI)
// ══════════════════════════════════════════════════════════════════
//
// Read-only for Phase 1. Shows the CustomerReady tab rows server-side
// (listCustomerReadyLog). Status filter chips. Tap a row → expand to
// show composed subject + body preview.
//
// Send/Skip/Compose actions deferred until Phase 2 wires the real
// pipeline (auto-trigger + GmailApp send + pick-list PDF + Calendar
// event creation).

let _custReadyPanelStatusFilter = '';
let _custReadyExpandedRow = null;

async function openCustomerReadyPanel(opts) {
  opts = opts || {};
  if (opts.status != null) _custReadyPanelStatusFilter = String(opts.status);
  const prior = document.getElementById('custReadyOverlay');
  if (prior) prior.remove();

  const ov = document.createElement('div');
  ov.id = 'custReadyOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9999;display:flex;align-items:flex-end;justify-content:center';
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };

  ov.innerHTML =
    '<div onclick="event.stopPropagation()" class="keep-dark-text" style="background:#fff !important;color:#1a1a1a !important;-webkit-text-fill-color:#1a1a1a !important;width:100%;max-width:780px;max-height:94vh;border-radius:18px 18px 0 0;padding:18px 20px 28px;overflow-y:auto;box-shadow:0 -4px 24px rgba(0,0,0,.35);box-sizing:border-box">'
    + '<div style="width:40px;height:4px;background:#ccc;border-radius:999px;margin:0 auto 14px"></div>'
    + '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:10px">'
    +   '<div style="font-family:\'Barlow Condensed\',Arial,sans-serif !important;font-size:24px !important;font-weight:900 !important;color:#1a1a1a !important;-webkit-text-fill-color:#1a1a1a !important;text-transform:uppercase;letter-spacing:.5px">✅ Customer Ready</div>'
    +   '<button onclick="document.getElementById(\'custReadyOverlay\').remove()" style="background:none;border:none;font-size:24px;color:#666 !important;-webkit-text-fill-color:#666 !important;cursor:pointer;padding:0 4px">✕</button>'
    + '</div>'
    + '<div style="font-size:12px;color:#666 !important;-webkit-text-fill-color:#666 !important;line-height:1.5;margin-bottom:10px">Phase 1 shadow log — what <em>would</em> be sent. No real customer email fires until you flip the <code>CUSTREADY_LIVE</code> Script Property to <code>true</code>.</div>'
    + '<div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap">'
    +   ['', 'shadow_logged', 'pending_send', 'sent', 'skipped', 'error'].map(s => {
          const active = s === _custReadyPanelStatusFilter;
          const lbl = s === '' ? 'All' : s.replace(/_/g, ' ');
          return '<button onclick="openCustomerReadyPanel({status:\'' + s + '\'})" style="flex:1;min-width:90px;padding:7px 4px;background:' + (active ? '#003087' : '#f5f5f5') + ' !important;color:' + (active ? '#fff' : '#444') + ' !important;-webkit-text-fill-color:' + (active ? '#fff' : '#444') + ' !important;border:none;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;text-transform:uppercase;letter-spacing:.5px">' + lbl + '</button>';
        }).join('')
    + '</div>'
    + '<div id="custReadyListBody" style="min-height:60px;color:#666 !important;-webkit-text-fill-color:#666 !important">Loading…</div>'
    + '</div>';
  document.body.appendChild(ov);

  try {
    const params = _custReadyPanelStatusFilter ? { status: _custReadyPanelStatusFilter } : {};
    const res = await groundApi('listCustomerReadyLog', params);
    const body = document.getElementById('custReadyListBody');
    if (!res || !res.ok) {
      body.innerHTML = '<div style="color:#c33 !important;-webkit-text-fill-color:#c33 !important;padding:14px">Error: ' + esc((res && res.error) || 'unknown') + '</div>';
      return;
    }
    const rows = res.rows || [];
    if (!rows.length) {
      body.innerHTML = '<div style="padding:24px;text-align:center;color:#0a8a3f !important;-webkit-text-fill-color:#0a8a3f !important;background:rgba(0,200,83,.06);border:1px dashed rgba(0,200,83,.40);border-radius:10px;font-size:13px;font-weight:700">No rows yet — nothing has been shadow-logged.<br><span style="font-size:11px;font-weight:500;color:#666 !important;-webkit-text-fill-color:#666 !important">Phase 2 (auto-trigger) lands once ShipConf is live + customer-response webhook is wired.</span></div>';
      return;
    }
    body.innerHTML = rows.map(_custReadyRowHtml_).join('');
  } catch (err) {
    const body = document.getElementById('custReadyListBody');
    if (body) body.innerHTML = '<div style="color:#c33 !important;-webkit-text-fill-color:#c33 !important;padding:14px">Error: ' + esc(err.message) + '</div>';
  }
}

function _custReadyRowHtml_(r) {
  const STATUS_META = {
    shadow_logged: { color: '#888',    bg: 'rgba(120,120,120,.10)', label: 'Shadow' },
    pending_send:  { color: '#FFB300', bg: 'rgba(255,179,0,.10)',   label: 'Pending Send' },
    sent:          { color: '#1A5C1A', bg: 'rgba(26,92,26,.10)',    label: 'Sent' },
    skipped:       { color: '#8B0000', bg: 'rgba(139,0,0,.10)',     label: 'Skipped' },
    error:         { color: '#c33',    bg: 'rgba(204,51,51,.10)',   label: 'Error' },
  };
  const meta = STATUS_META[r.status] || STATUS_META.shadow_logged;
  const expanded = _custReadyExpandedRow === r.order_number;
  const subj = r.composed_subject || '(no subject)';
  const dateStr = String(r.shadow_logged_at || '').slice(0, 16).replace('T', ' ');
  const orderNum = esc(String(r.order_number || ''));
  return '<div style="padding:12px 14px;background:' + meta.bg + ' !important;border-left:3px solid ' + meta.color + ' !important;border-radius:8px;margin-bottom:6px;font-size:13px;color:#1a1a1a !important;-webkit-text-fill-color:#1a1a1a !important;cursor:pointer" onclick="_custReadyToggleRow_(\'' + orderNum + '\')">'
    + '<div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:6px">'
    +   '<div><span style="font-family:\'JetBrains Mono\',monospace !important;font-weight:900">#' + orderNum + '</span> <span style="color:#666 !important;-webkit-text-fill-color:#666 !important">' + esc(r.customer_name || '') + '</span></div>'
    +   '<span style="font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:1px;color:' + meta.color + ' !important;-webkit-text-fill-color:' + meta.color + ' !important">' + meta.label + '</span>'
    + '</div>'
    + '<div style="font-size:11px;color:#444 !important;-webkit-text-fill-color:#444 !important;margin-top:4px"><strong>' + esc(subj) + '</strong></div>'
    + '<div style="font-size:10px;color:#888 !important;-webkit-text-fill-color:#888 !important;margin-top:4px;font-family:monospace">template: ' + esc(r.template_key || '') + ' · ' + esc(dateStr) + ' by ' + esc(String(r.shadow_logged_by || '')) + (r.skipped_reason ? ' · skipped: ' + esc(r.skipped_reason) : '') + '</div>'
    + (expanded ? '<div style="margin-top:10px;padding:10px 12px;background:rgba(0,0,0,.04) !important;border:1px solid #eee !important;border-radius:6px;font-family:monospace !important;font-size:11px !important;color:#1a1a1a !important;-webkit-text-fill-color:#1a1a1a !important;white-space:pre-wrap;max-height:280px;overflow-y:auto">' + esc(String(r.composed_body_text || '(no body)')) + '</div>' : '')
    + '</div>';
}

function _custReadyToggleRow_(orderNum) {
  _custReadyExpandedRow = (_custReadyExpandedRow === orderNum) ? null : orderNum;
  openCustomerReadyPanel({});
}

// ══════════════════════════════════════════════════════════════════
// v10.226 — Purchase Orders panel (PickList Phase 3 UI)
// ══════════════════════════════════════════════════════════════════
//
// Two-mode panel:
//   Mode 'reorder' (default): list vendors needing reorder, drill
//                              into a vendor → review shortages →
//                              create + email PO
//   Mode 'history': recent PO ledger entries

let _poPanelMode = 'reorder';
let _poPanelVendorSel = '';
let _poDraftLines = [];

async function openPurchaseOrdersPanel(opts) {
  opts = opts || {};
  _poPanelMode = opts.mode || _poPanelMode || 'reorder';
  // v10.255 — fix: opts.vendor === '' (empty string from back button)
  // is a deliberate clear, not "use previous." `||` treats '' as falsy
  // and falls through to the stale state, leaving the user stuck on
  // the previously-selected vendor (Zac 09:29 EDT bug report).
  if (opts.vendor !== undefined) {
    _poPanelVendorSel = String(opts.vendor || '');
  }
  const prior = document.getElementById('poPanelOverlay');
  if (prior) prior.remove();

  const ov = document.createElement('div');
  ov.id = 'poPanelOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9999;display:flex;align-items:flex-end;justify-content:center';
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  ov.innerHTML =
    '<div onclick="event.stopPropagation()" class="keep-dark-text" style="background:#fff !important;color:#1a1a1a !important;-webkit-text-fill-color:#1a1a1a !important;width:100%;max-width:780px;max-height:94vh;border-radius:18px 18px 0 0;padding:18px 20px 28px;overflow-y:auto;box-shadow:0 -4px 24px rgba(0,0,0,.35);box-sizing:border-box">'
    + '<div style="width:40px;height:4px;background:#ccc;border-radius:999px;margin:0 auto 14px"></div>'
    + '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:10px">'
    +   '<div style="font-family:\'Barlow Condensed\',Arial,sans-serif !important;font-size:24px !important;font-weight:900 !important;color:#1a1a1a !important;-webkit-text-fill-color:#1a1a1a !important;text-transform:uppercase;letter-spacing:.5px">📑 Purchase Orders</div>'
    +   '<button onclick="document.getElementById(\'poPanelOverlay\').remove()" style="background:none;border:none;font-size:24px;color:#666 !important;-webkit-text-fill-color:#666 !important;cursor:pointer;padding:0 4px">✕</button>'
    + '</div>'
    + '<div style="display:flex;gap:6px;margin-bottom:12px">'
    +   ['reorder', 'history'].map(m => {
          const active = m === _poPanelMode;
          const lbl = m === 'reorder' ? '🔄 Reorder Needs' : '📋 PO History';
          return '<button onclick="openPurchaseOrdersPanel({mode:\'' + m + '\'})" style="flex:1;padding:9px;background:' + (active ? '#003087' : '#f5f5f5') + ' !important;color:' + (active ? '#fff' : '#444') + ' !important;-webkit-text-fill-color:' + (active ? '#fff' : '#444') + ' !important;border:none;border-radius:8px;font-size:13px;font-weight:800;cursor:pointer;letter-spacing:.5px">' + lbl + '</button>';
        }).join('')
    + '</div>'
    + '<div id="poPanelBody" style="min-height:60px;color:#666 !important;-webkit-text-fill-color:#666 !important">Loading…</div>'
    + '</div>';
  document.body.appendChild(ov);

  if (_poPanelMode === 'reorder') {
    _renderPOReorderMode_();
  } else {
    _renderPOHistoryMode_();
  }
}

async function _renderPOReorderMode_() {
  const body = document.getElementById('poPanelBody');
  if (!body) return;
  // v10.237 FIX: Zac runbook #8 — "Load failed" generic toast was unactionable.
  // Add explicit Retry button + helpful hint pointing at the most common cause
  // (un-bootstrapped inventory) when fetch rejects.
  body.innerHTML = '<div style="color:#666 !important;-webkit-text-fill-color:#666 !important;font-size:13px;padding:14px">Loading reorder needs…</div>';
  try {
    const res = await groundApi('pickListReorderByVendor', {});
    if (!res || !res.ok) {
      body.innerHTML = '<div style="color:#c33 !important;-webkit-text-fill-color:#c33 !important;padding:14px;background:rgba(204,51,51,.05);border:1px solid rgba(204,51,51,.3);border-radius:10px">'
        + '<div style="font-weight:900;margin-bottom:6px">Server returned an error</div>'
        + '<div style="font-size:13px;margin-bottom:10px;font-family:monospace !important">' + esc((res && res.error) || 'unknown') + '</div>'
        + '<button onclick="_renderPOReorderMode_()" style="padding:8px 14px;background:#1A4FB0 !important;color:#fff !important;-webkit-text-fill-color:#fff !important;border:none;border-radius:6px;font-weight:800;cursor:pointer">↻ Retry</button>'
        + '</div>';
      return;
    }
    const byVendor = res.by_vendor || {};
    const vendors = Object.keys(byVendor).sort((a, b) => byVendor[b].total_qty - byVendor[a].total_qty);
    if (!vendors.length) {
      body.innerHTML = '<div style="padding:24px;text-align:center;color:#0a8a3f !important;-webkit-text-fill-color:#0a8a3f !important;background:rgba(0,200,83,.06);border:1px dashed rgba(0,200,83,.40);border-radius:10px;font-size:13px;font-weight:700">✓ No reorder needs across any vendor.<br><span style="font-size:11px;font-weight:500;color:#666 !important;-webkit-text-fill-color:#666 !important">If you haven\'t bootstrapped yet, run runPickListInventoryIngest from the Apps Script editor first.</span></div>';
      return;
    }
    let html = '<div style="font-size:11px;color:#888 !important;-webkit-text-fill-color:#888 !important;margin-bottom:8px;text-transform:uppercase;letter-spacing:1px;font-weight:700">' + res.vendor_count + ' vendor(s) · ' + res.total_reorder_qty + ' total qty</div>';
    if (_poPanelVendorSel && byVendor[_poPanelVendorSel]) {
      // Drill-in view for selected vendor
      const v = byVendor[_poPanelVendorSel];
      _poDraftLines = v.items.map(i => ({ sku: i.element_sku, qty: i.reorder_qty, on_hand: i.on_hand, threshold: i.threshold, warehouse: i.warehouse }));
      html += '<button onclick="openPurchaseOrdersPanel({mode:\'reorder\',vendor:\'\'})" style="background:none !important;color:#003087 !important;-webkit-text-fill-color:#003087 !important;border:none !important;font-size:12px;cursor:pointer;margin-bottom:10px;padding:4px 0">‹ back to reorder list</button>';
      html += '<div style="background:#F0F4FB !important;border:1.5px solid #1A4FB0 !important;border-radius:10px;padding:12px 14px;margin-bottom:12px">';
      html += '<div style="font-family:\'Barlow Condensed\',Arial,sans-serif !important;font-size:20px;font-weight:900;color:#003087 !important;-webkit-text-fill-color:#003087 !important;text-transform:uppercase;letter-spacing:.5px">' + esc(_poPanelVendorSel) + '</div>';
      html += '<div style="font-size:12px;color:#444 !important;-webkit-text-fill-color:#444 !important;margin-top:2px">' + v.line_count + ' shortage(s) · ' + v.total_qty + ' total qty needed</div>';
      html += '</div>';
      html += '<div style="font-size:11px;color:#888 !important;-webkit-text-fill-color:#888 !important;margin-bottom:6px;text-transform:uppercase;letter-spacing:1px;font-weight:700">Edit quantities below, then create the PO.</div>';
      html += '<div id="poDraftLines">';
      _poDraftLines.forEach((l, idx) => {
        html += '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:#fafafa !important;border:1px solid #eee !important;border-radius:6px;margin-bottom:4px;font-size:13px;color:#1a1a1a !important;-webkit-text-fill-color:#1a1a1a !important">'
          + '<span style="font-family:\'JetBrains Mono\',monospace !important;font-weight:700;flex:1;min-width:0">' + esc(l.sku) + '</span>'
          + '<span style="font-size:10px;color:#888 !important;-webkit-text-fill-color:#888 !important">on-hand ' + l.on_hand + ' · threshold ' + l.threshold + '</span>'
          + '<input type="number" min="0" step="1" value="' + l.qty + '" onchange="_poDraftSetQty_(' + idx + ', this.value)" style="width:80px;padding:6px 8px;border:1.5px solid #1A4FB0 !important;border-radius:6px;font-family:\'Barlow Condensed\',Arial,sans-serif !important;font-size:18px;font-weight:900;text-align:center;color:#1a1a1a !important;-webkit-text-fill-color:#1a1a1a !important;background:#fff !important">'
          + '</div>';
      });
      html += '</div>';
      html += '<div style="margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">'
        + '<input id="poRecipient" type="email" placeholder="vendor email (optional)" style="flex:1;min-width:200px;padding:9px 12px;font-size:13px;border:1.5px solid #ccc !important;border-radius:8px;background:#fff !important;color:#1a1a1a !important;-webkit-text-fill-color:#1a1a1a !important">'
        + '<button onclick="_poCreateAndPreview_()" style="padding:10px 16px;background:#1A4FB0 !important;color:#fff !important;-webkit-text-fill-color:#fff !important;border:none;border-radius:8px;font-size:13px;font-weight:900;cursor:pointer;letter-spacing:.5px;text-transform:uppercase">Create PO + Preview</button>'
        + '</div>';
    } else {
      // Vendor list view
      html += vendors.map(v => {
        const data = byVendor[v];
        return '<div onclick="openPurchaseOrdersPanel({mode:\'reorder\',vendor:\'' + esc(v) + '\'})" style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;background:#fff !important;border:1.5px solid #ddd !important;border-radius:8px;margin-bottom:6px;cursor:pointer;color:#1a1a1a !important;-webkit-text-fill-color:#1a1a1a !important" onmouseover="this.style.background=\'#F0F4FB\';this.style.borderColor=\'#1A4FB0\'" onmouseout="this.style.background=\'#fff\';this.style.borderColor=\'#ddd\'">'
          + '<div><strong>' + esc(v) + '</strong><div style="font-size:11px;color:#666 !important;-webkit-text-fill-color:#666 !important;margin-top:2px">' + data.line_count + ' shortage(s)</div></div>'
          + '<div style="text-align:right"><div style="font-family:\'Barlow Condensed\',Arial,sans-serif !important;font-size:22px;font-weight:900;color:#FF6B00 !important;-webkit-text-fill-color:#FF6B00 !important">' + data.total_qty + '</div><div style="font-size:10px;color:#888 !important;-webkit-text-fill-color:#888 !important;text-transform:uppercase;letter-spacing:1px">total qty</div></div>'
          + '<span style="color:#999 !important;-webkit-text-fill-color:#999 !important;font-size:18px;margin-left:8px">›</span>'
          + '</div>';
      }).join('');
    }
    body.innerHTML = html;
  } catch (err) {
    // v10.237 FIX: actionable failure path. iOS "Load failed" is opaque —
    // surface likely causes + Retry button so Zac doesn't have to dig.
    body.innerHTML = '<div style="color:#c33 !important;-webkit-text-fill-color:#c33 !important;padding:14px;background:rgba(204,51,51,.05);border:1px solid rgba(204,51,51,.3);border-radius:10px">'
      + '<div style="font-weight:900;margin-bottom:6px;font-size:14px">Load failed</div>'
      + '<div style="font-size:12px;margin-bottom:8px;font-family:monospace !important">' + esc(err.message || 'unknown') + '</div>'
      + '<div style="font-size:12px;color:#666 !important;-webkit-text-fill-color:#666 !important;margin-bottom:10px;line-height:1.5">Likely causes:<br>• Network blip (most common on iOS) — tap Retry<br>• Orchestrator slow (Apps Script wakes from cold start) — Retry usually wins second attempt<br>• PickListElementInventory not bootstrapped yet — run Ingest Element Inventory under 🧬 Pick-List BOM → ⚙ Admin first</div>'
      + '<button onclick="_renderPOReorderMode_()" style="padding:10px 16px;background:#1A4FB0 !important;color:#fff !important;-webkit-text-fill-color:#fff !important;border:none;border-radius:8px;font-weight:900;cursor:pointer;font-size:13px">↻ Retry</button>'
      + '</div>';
  }
}

function _poDraftSetQty_(idx, value) {
  if (!_poDraftLines[idx]) return;
  _poDraftLines[idx].qty = Math.max(0, Number(value) || 0);
}

async function _poCreateAndPreview_() {
  const recipient = (document.getElementById('poRecipient') || {}).value || '';
  const linesToSend = _poDraftLines.filter(l => l.qty > 0);
  if (!linesToSend.length) { showToast('All quantities are 0 — nothing to order'); return; }
  try {
    const res = await groundApi('pickListCreatePO', {
      vendor: _poPanelVendorSel,
      lines: linesToSend,
      recipient: recipient.trim(),
      deviceId: (typeof getPackDeviceId_ === 'function' ? getPackDeviceId_() : 'unknown'),
    });
    if (!res || !res.ok) { showToast('Create failed: ' + ((res && res.error) || 'unknown')); return; }
    _showPOPreview_(res, recipient);
  } catch (err) {
    showToast('Create error: ' + err.message);
  }
}

function _showPOPreview_(po, recipient) {
  const prior = document.getElementById('poPreviewOverlay');
  if (prior) prior.remove();
  const ov = document.createElement('div');
  ov.id = 'poPreviewOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:10005;display:flex;align-items:center;justify-content:center;padding:14px';
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  const sendBtn = recipient
    ? '<button onclick="_poSendNow_(\'' + esc(po.po_id) + '\')" style="flex:1;padding:14px;background:linear-gradient(135deg,#1A5C1A,#00C853) !important;color:#fff !important;-webkit-text-fill-color:#fff !important;border:none;border-radius:10px;font-size:14px;font-weight:900;cursor:pointer;letter-spacing:.5px;text-transform:uppercase">✉ Send via Gmail Now</button>'
    : '';
  const mailtoBtn = po.mailto_url
    ? '<a href="' + esc(po.mailto_url) + '" style="flex:1;padding:14px;background:#fff !important;color:#003087 !important;-webkit-text-fill-color:#003087 !important;border:1.5px solid #003087 !important;border-radius:10px;font-size:13px;font-weight:800;cursor:pointer;letter-spacing:.5px;text-transform:uppercase;text-align:center;text-decoration:none">📧 Open in Mail App</a>'
    : '';
  ov.innerHTML =
    '<div onclick="event.stopPropagation()" class="keep-dark-text" style="background:#fff !important;color:#1a1a1a !important;-webkit-text-fill-color:#1a1a1a !important;border-radius:14px;padding:20px;max-width:620px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,.5)">'
    + '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px">'
    +   '<div style="font-family:\'Barlow Condensed\',Arial,sans-serif !important;font-size:22px !important;font-weight:900 !important;color:#1a1a1a !important;-webkit-text-fill-color:#1a1a1a !important;text-transform:uppercase;letter-spacing:.5px">📑 PO Draft — ' + esc(po.po_id) + '</div>'
    +   '<button onclick="document.getElementById(\'poPreviewOverlay\').remove()" style="background:none;border:none;font-size:22px;color:#666 !important;-webkit-text-fill-color:#666 !important;cursor:pointer">✕</button>'
    + '</div>'
    + '<div style="font-size:13px;color:#666 !important;-webkit-text-fill-color:#666 !important;margin-bottom:10px">' + esc(po.vendor) + ' · ' + po.line_count + ' SKU(s) · qty ' + po.total_qty + '</div>'
    + '<div style="background:#F5F7FA !important;border:1px solid #ddd !important;border-radius:8px;padding:12px 14px;margin-bottom:14px;font-family:monospace !important;font-size:12px !important;color:#1a1a1a !important;-webkit-text-fill-color:#1a1a1a !important;white-space:pre-wrap;max-height:300px;overflow-y:auto">' + esc(po.composed_body) + '</div>'
    + '<div style="display:flex;gap:8px">' + sendBtn + mailtoBtn + '</div>'
    + (recipient ? '' : '<div style="margin-top:10px;font-size:11px;color:#FF6B00 !important;-webkit-text-fill-color:#FF6B00 !important">Add a recipient email above to enable Gmail send.</div>')
    + '</div>';
  document.body.appendChild(ov);
}

async function _poSendNow_(poId) {
  if (!confirm('Send PO ' + poId + ' via Gmail now?\n\nFires a real email. Recipient is whatever you typed in the form.')) return;
  try {
    const res = await groundApi('pickListSendPOEmail', { poId: poId });
    if (!res || !res.ok) { showToast('Send failed: ' + ((res && res.error) || 'unknown')); return; }
    showToast('✓ Sent PO ' + poId + ' to ' + res.recipient);
    document.getElementById('poPreviewOverlay').remove();
    openPurchaseOrdersPanel({ mode: 'history' });
  } catch (err) {
    showToast('Send error: ' + err.message);
  }
}

async function _renderPOHistoryMode_() {
  const body = document.getElementById('poPanelBody');
  if (!body) return;
  body.innerHTML = '<div style="color:#666 !important;-webkit-text-fill-color:#666 !important;font-size:13px;padding:14px">Loading PO history…</div>';
  try {
    const res = await groundApi('pickListListPOs', {});
    if (!res || !res.ok) { body.innerHTML = '<div style="color:#c33 !important;-webkit-text-fill-color:#c33 !important;padding:14px">Error: ' + esc((res && res.error) || 'unknown') + ' <button onclick="_renderPOHistoryMode_()" style="margin-left:10px;padding:6px 12px;background:#1A4FB0 !important;color:#fff !important;-webkit-text-fill-color:#fff !important;border:none;border-radius:5px;font-weight:800;cursor:pointer">↻ Retry</button></div>'; return; }
    const pos = res.pos || [];
    if (!pos.length) {
      body.innerHTML = '<div style="padding:24px;text-align:center;color:#666 !important;-webkit-text-fill-color:#666 !important;background:#fafafa !important;border:1px dashed #ccc !important;border-radius:10px;font-size:13px">No POs yet.</div>';
      return;
    }
    body.innerHTML = pos.map(p => {
      const stColor = p.status === 'sent' ? '#1A5C1A' : p.status === 'cancelled' ? '#888' : p.status === 'received' ? '#1A4FB0' : '#FF6B00';
      return '<div style="padding:12px 14px;background:#fff !important;border:1.5px solid #ddd !important;border-left:3px solid ' + stColor + ' !important;border-radius:8px;margin-bottom:6px;font-size:13px;color:#1a1a1a !important;-webkit-text-fill-color:#1a1a1a !important">'
        + '<div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:6px">'
        +   '<div><span style="font-family:\'JetBrains Mono\',monospace !important;font-weight:900">' + esc(p.po_id) + '</span> <span style="color:#666 !important;-webkit-text-fill-color:#666 !important">' + esc(p.vendor) + '</span></div>'
        +   '<span style="font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:1px;color:' + stColor + ' !important;-webkit-text-fill-color:' + stColor + ' !important">' + esc(p.status) + '</span>'
        + '</div>'
        + '<div style="font-size:11px;color:#666 !important;-webkit-text-fill-color:#666 !important;margin-top:4px">' + p.line_count + ' SKU(s) · qty ' + p.total_qty + ' · ' + esc(String(p.created_at || '').slice(0, 16).replace('T', ' ')) + (p.recipient_email ? ' · ' + esc(p.recipient_email) : '') + '</div>'
        + '</div>';
    }).join('');
  } catch (err) {
    body.innerHTML = '<div style="color:#c33 !important;-webkit-text-fill-color:#c33 !important;padding:14px">Error: ' + esc(err.message) + '</div>';
  }
}

async function _pickListExpand_() {
  const inp = document.getElementById('pickListExpandInput');
  const out = document.getElementById('pickListExpandResult');
  if (!inp || !out) return;
  const sku = String(inp.value || '').trim().toUpperCase();
  if (!sku) { out.innerHTML = '<div style="color:#888 !important;-webkit-text-fill-color:#888 !important;font-size:13px">Type a SKU above.</div>'; return; }
  out.innerHTML = '<div style="color:#666 !important;-webkit-text-fill-color:#666 !important;font-size:13px">Expanding…</div>';
  try {
    const res = await groundApi('pickListExpandBundle', { sku: sku });
    if (!res || !res.ok) { out.innerHTML = '<div style="color:#c33 !important;-webkit-text-fill-color:#c33 !important;font-size:13px;padding:14px">Error: ' + esc((res && res.error) || 'unknown') + '</div>'; return; }
    const elements = res.elements || [];
    if (!elements.length) {
      out.innerHTML = '<div style="background:#FFF8E1 !important;border:1px solid #FFC107 !important;border-radius:8px;padding:14px;color:#5a3e00 !important;-webkit-text-fill-color:#5a3e00 !important;font-size:13px">No expansion found for <strong>' + esc(sku) + '</strong>. Either the BOM is empty (run the editor ingest) or this SKU isn\'t a known bundle parent.</div>';
      return;
    }
    let html = '<div style="font-size:13px;color:#1a1a1a !important;-webkit-text-fill-color:#1a1a1a !important;margin-bottom:8px"><strong>' + esc(sku) + '</strong> → <strong>' + elements.length + '</strong> distinct element(s):</div>';
    html += elements.map(e => '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#fafafa !important;border:1px solid #eee !important;border-radius:6px;margin-bottom:4px;font-size:13px;color:#1a1a1a !important;-webkit-text-fill-color:#1a1a1a !important">'
      + '<span style="font-family:\'JetBrains Mono\',monospace !important;font-weight:700">' + esc(e.sku) + '</span>'
      + '<span style="font-family:\'Barlow Condensed\',Arial,sans-serif !important;font-size:18px;font-weight:900;color:#1A5C1A !important;-webkit-text-fill-color:#1A5C1A !important">×' + e.qty + '</span>'
      + '</div>').join('');
    out.innerHTML = html;
  } catch (err) {
    out.innerHTML = '<div style="color:#c33 !important;-webkit-text-fill-color:#c33 !important;font-size:13px;padding:14px">Error: ' + esc(err.message) + '</div>';
  }
}

// ── Tracking — recent shipments across all sources ────────
async function openTrackingPanel(opts) {
  opts = opts || {};
  const days = Number(opts.days || 14);
  const source = String(opts.source || 'all');
  const prior = document.getElementById('trackingOverlay');
  if (prior) prior.remove();

  const ov = document.createElement('div');
  ov.id = 'trackingOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:flex-end;justify-content:center';
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  ov.innerHTML =
    '<div onclick="event.stopPropagation()" style="background:#fff;width:100%;max-width:720px;max-height:92vh;border-radius:18px 18px 0 0;padding:18px 20px 28px;overflow-y:auto;box-shadow:0 -4px 24px rgba(0,0,0,.3)">'
    + '<div style="width:40px;height:4px;background:#ccc;border-radius:999px;margin:0 auto 14px"></div>'
    + '<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:6px">'
    +   '<div style="font-family:\'Barlow Condensed\',Arial,sans-serif;font-size:24px;font-weight:900;color:#1a1a1a;text-transform:uppercase;letter-spacing:.5px">📦 Tracking</div>'
    +   '<button onclick="document.getElementById(\'trackingOverlay\').remove()" style="background:none;border:none;font-size:24px;color:#999;cursor:pointer;padding:0 4px">✕</button>'
    + '</div>'
    + '<div style="font-size:12px;color:#666;line-height:1.4;margin-bottom:12px">Recent shipments across every source. Tap a tracking number to open the carrier page.</div>'
    + '<div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">'
    + ['all', 'ground', 'cabinet', 'remake', 'mattress'].map(s => '<button onclick="openTrackingPanel({source:\'' + s + '\',days:' + days + '})" style="flex:1;min-width:60px;padding:7px 4px;background:' + (s === source ? '#003087' : '#f5f5f5') + ';color:' + (s === source ? '#fff' : '#444') + ';border:none;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;text-transform:uppercase;letter-spacing:.5px">' + s + '</button>').join('')
    + '</div>'
    + '<div style="display:flex;gap:6px;margin-bottom:12px">'
    + [7, 14, 30, 90].map(d => '<button onclick="openTrackingPanel({source:\'' + source + '\',days:' + d + '})" style="flex:1;padding:7px 4px;background:' + (d === days ? '#FFB300' : '#f5f5f5') + ';color:' + (d === days ? '#1a1a1a' : '#444') + ';border:none;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer">' + d + 'd</button>').join('')
    + '</div>'
    + '<input type="search" id="trackingFilter" placeholder="Filter by order # or customer name…" oninput="renderTrackingRows_()" style="width:100%;padding:10px;font-size:13px;border:1.5px solid #ccc;border-radius:8px;outline:none;margin-bottom:10px;-webkit-appearance:none">'
    + '<div id="trackingBody" style="min-height:60px">Loading…</div>'
    + '</div>';
  document.body.appendChild(ov);

  let res;
  try { res = await groundApi('listRecentShipments', { days: days, source: source }); }
  catch (err) {
    document.getElementById('trackingBody').innerHTML = '<div style="color:#c33;font-weight:700;padding:14px">Error: ' + esc(err.message) + '</div>';
    return;
  }
  if (!res || !res.ok) {
    document.getElementById('trackingBody').innerHTML = '<div style="color:#c33;font-weight:700;padding:14px">Error: ' + esc((res && res.error) || 'unknown') + '</div>';
    return;
  }
  const rows = res.shipments || [];
  window._trackingCache = rows;
  if (!rows.length) {
    document.getElementById('trackingBody').innerHTML = '<div style="padding:24px;text-align:center;color:#888;background:#fafafa;border-radius:10px;font-size:13px">No shipments in this view.</div>';
    return;
  }
  renderTrackingRows_();
}

function renderTrackingRows_() {
  const body = document.getElementById('trackingBody');
  if (!body) return;
  const rows = window._trackingCache || [];
  const q = String((document.getElementById('trackingFilter') || {}).value || '').trim().toLowerCase();
  const filtered = q
    ? rows.filter(r =>
        String(r.order_number || '').toLowerCase().includes(q)
        || String(r.customer_name || '').toLowerCase().includes(q)
        || String(r.tracking_number || '').toLowerCase().includes(q))
    : rows;
  if (!filtered.length) {
    body.innerHTML = '<div style="padding:18px;text-align:center;color:#888;background:#fafafa;border-radius:10px;font-size:12px">No matches for "' + esc(q) + '".</div>';
    return;
  }
  const SRC_COLORS = { ground: '#003087', cabinet: '#FFB300', remake: '#FF6B00', mattress: '#9C27B0' };
  // Sable: group rows into Today / Yesterday / This Week / Older
  // so 14 days of shipments aren't one indistinguishable scroll.
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today.getTime() - 86400000);
  const weekAgo = new Date(today.getTime() - 6 * 86400000); // last 7 days incl today
  const bucket = (iso) => {
    if (!iso) return 'Older';
    const d = new Date(String(iso).slice(0, 10) + 'T00:00:00');
    if (d >= today) return 'Today';
    if (d >= yesterday) return 'Yesterday';
    if (d >= weekAgo) return 'This Week';
    return 'Older';
  };
  const BUCKET_ORDER = ['Today', 'Yesterday', 'This Week', 'Older'];
  const grouped = { Today: [], Yesterday: [], 'This Week': [], Older: [] };
  filtered.forEach(s => grouped[bucket(s.shipped_at)].push(s));

  body.innerHTML = BUCKET_ORDER.filter(b => grouped[b].length).map(b =>
    '<div style="font-size:10px;font-weight:900;color:#888;text-transform:uppercase;letter-spacing:1.5px;margin:14px 0 6px;padding-bottom:4px;border-bottom:1px solid #eee">' + b + ' · ' + grouped[b].length + '</div>'
    + grouped[b].map(s => _renderTrackingRow_(s, SRC_COLORS)).join('')
  ).join('');
}

function _renderTrackingRow_(s, SRC_COLORS) {
  const color = SRC_COLORS[s.source] || '#666';
  const when = String(s.shipped_at || '').slice(0, 10);
  const trackingDisplay = s.tracking_number ? esc(s.tracking_number) : '—';
  // v10.96 (CS persona): CS pastes the tracking # into Shopify /
  // email constantly — give the Tracking panel a one-tap copy so
  // they don't have to drill into Lookup first. stopPropagation so
  // it doesn't also fire the row→Lookup tap. Reuses _lkCopy_.
  const trkCopyBtn = s.tracking_number
    ? '<button onclick="event.stopPropagation();_lkCopy_(this,\'' + esc(String(s.tracking_number).replace(/'/g, "\\'")) + '\')" title="Copy tracking #" style="background:transparent;border:1px solid rgba(0,0,0,.15);color:#888;font-size:10px;padding:1px 6px;border-radius:5px;cursor:pointer;margin-left:6px;font-weight:700">📋</button>'
    : '';
  const trackingNode = (s.tracking_url && s.tracking_number)
    ? '<a href="' + esc(s.tracking_url) + '" target="_blank" onclick="event.stopPropagation()" style="color:#42a5f5;text-decoration:underline;font-family:monospace;font-size:11px">' + trackingDisplay + ' ↗</a>' + trkCopyBtn
    : '<span style="font-family:monospace;font-size:11px;color:#888">' + trackingDisplay + '</span>' + trkCopyBtn;
  // v9.93: row tap → jump to Lookup pre-filled with this order #
  // (carrier-link tap still goes to the carrier page via stopPropagation).
  return '<div onclick="jumpToLookup_(\'' + esc(s.order_number) + '\')" style="display:grid;grid-template-columns:64px 1fr auto;gap:8px;align-items:center;padding:10px;background:#fafafa;border-left:3px solid ' + color + ';border-radius:8px;margin-bottom:6px;font-size:13px;cursor:pointer" title="Tap row for full order detail">'
    + '<div><div style="font-size:9px;font-weight:900;color:' + color + ';text-transform:uppercase;letter-spacing:1px">' + esc(s.source_label) + '</div><div style="font-size:10px;color:#999">' + esc(when) + '</div></div>'
    + '<div><div style="font-family:\'JetBrains Mono\',monospace;font-weight:900;color:#1a1a1a">#' + esc(s.order_number) + '</div><div style="font-size:12px;color:#444">' + esc(s.customer_name || '—') + (s.state ? ' · ' + esc(s.state) : '') + '</div></div>'
    + '<div style="text-align:right">' + (s.carrier ? '<div style="font-size:10px;color:#666;text-transform:uppercase;font-weight:700;letter-spacing:.5px">' + esc(s.carrier) + '</div>' : '') + trackingNode + '</div>'
    + '</div>';
}

function jumpToLookup_(orderNumber) {
  // Close Tracking overlay if open, switch to Lookup tab, set query, search.
  const ov = document.getElementById('trackingOverlay');
  if (ov) ov.remove();
  if (typeof switchTab === 'function') switchTab('lookup');
  setTimeout(() => {
    const inp = document.getElementById('lookupInput');
    if (inp) { inp.value = orderNumber; }
    if (typeof runLookup === 'function') runLookup();
  }, 120);
}

// ── Damage Log ────────────────────────────────────────────
// The full damage UI (openDamageLog / refreshDamageLog /
// DAMAGE_STATUSES / damageStatusLabel_ / updateDamageField) lives
// inline in index.html — predates pack.js's modularization. v9.67
// briefly tried to add a Phase 2 version here, which collided
// because the names were already declared at script-load time and
// crashed pack.js with "Identifier 'DAMAGE_STATUSES' has already
// been declared" — taking Pre-Pack / Pack / Schedule down with it.
// Reverted in v9.73; the existing index.html implementation is the
// canonical one.
const _DAMAGE_UI_LIVES_IN_INDEX_HTML_ = true;

// v9.68 attention strip on Cabinets — surfaces stalled / awaiting
// / open damage counts from the most recent Schedule + Damage data
// in localStorage. Read-only here; Schedule refresh + Damage Log
// open are responsible for writing.
// v9.86: total attention count for the version-pill red badge so
// any tab shows the global "something needs attention" signal.
function _attentionTotal_(a) {
  return (a.stalled || 0) + (a.awaiting || 0) + (a.holds || 0) + (a.damageOpen || 0);
}
function _refreshVersionPillBadge_() {
  const badge = document.getElementById('versionPillBadge');
  if (!badge) return;
  let attention = { stalled: 0, awaiting: 0, holds: 0, damageOpen: 0 };
  try { attention = Object.assign(attention, JSON.parse(localStorage.getItem('mbd_attention_v1') || '{}')); } catch(e) {}
  const total = _attentionTotal_(attention);
  if (total > 0) {
    badge.style.display = 'inline-block';
    badge.textContent = total > 99 ? '99+' : String(total);
  } else {
    badge.style.display = 'none';
  }
}
// Refresh badge every minute and on visibility change so the iPad
// updates the dot without manual refresh.
setInterval(_refreshVersionPillBadge_, 60000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') _refreshVersionPillBadge_(); });

function renderCabinetAttentionStrip_() {
  const el = document.getElementById('cabAttentionStrip');
  if (!el) return;
  let attention = { stalled: 0, awaiting: 0, holds: 0, damageOpen: 0 };
  try { attention = Object.assign(attention, JSON.parse(localStorage.getItem('mbd_attention_v1') || '{}')); } catch(e) {}
  _refreshVersionPillBadge_(); // any localStorage update also refreshes the pill badge

  const chips = [];
  if (attention.stalled > 0) {
    chips.push('<button onclick="openStalledList()" style="padding:6px 12px;background:linear-gradient(135deg,#FF5252,#B71C1C);color:#fff;border:1px solid #ff5252;border-radius:999px;font-size:11px;font-weight:900;letter-spacing:.5px;cursor:pointer;text-transform:uppercase">⚠ ' + attention.stalled + ' STALLED</button>');
  }
  if (attention.awaiting > 0) {
    chips.push('<button onclick="openAwaitingCustomerList()" style="padding:6px 12px;background:linear-gradient(135deg,#3DBEFF,#005577);color:#fff;border:1px solid #3DBEFF;border-radius:999px;font-size:11px;font-weight:900;letter-spacing:.5px;cursor:pointer;text-transform:uppercase">🔔 ' + attention.awaiting + ' AWAITING CUSTOMER</button>');
  }
  if (attention.holds > 0) {
    chips.push('<button onclick="openHoldsPanel()" style="padding:6px 12px;background:linear-gradient(135deg,#9C27B0,#4A148C);color:#fff;border:1px solid #9C27B0;border-radius:999px;font-size:11px;font-weight:900;letter-spacing:.5px;cursor:pointer;text-transform:uppercase">🚦 ' + attention.holds + ' ON HOLD</button>');
  }
  if (attention.damageOpen > 0) {
    chips.push('<button onclick="openDamageLog()" style="padding:6px 12px;background:linear-gradient(135deg,#FF6B00,#B71C1C);color:#fff;border:1px solid #FF6B00;border-radius:999px;font-size:11px;font-weight:900;letter-spacing:.5px;cursor:pointer;text-transform:uppercase">🔨 ' + attention.damageOpen + ' OPEN DAMAGE</button>');
  }
  if (!chips.length) { el.style.display = 'none'; return; }
  el.style.display = 'flex';
  el.innerHTML = chips.join('');
}


// ── Remakes (CS VP entry — Jessica) ──────────────────────
// Phase 1: list + create overlay. Jessica taps "New Remake",
// fills the customer + SKU details, hits create — orchestrator
// logs the row and emails shipping@ with structured details.
// v10.114: cache of remake rows by remake_id (populated on every
// openRemakesPanel fetch) so per-row actions can look up the full
// record without re-fetching.
let _remakesCacheById = {};

// v10.198 — stuck = pending/ready_to_ship for 5+ days. Same threshold
// as the per-row stuck chip in the renderer (line ~5587). Centralizing
// so the sort + the chip stay in lockstep.
// v10.207 — carrier-claims roll-up. Aggregates over ALL fetched rows
// (irrespective of carrier filter so the topline doesn't shift when
// Jessica drills into FedEx vs UPS). Shows only when there's at least
// one claim row; otherwise hidden so the panel stays tight for the
// non-CS-VP workflows.
function _renderRemakeClaimsRollup_(rows) {
  const el = document.getElementById('remakeClaimsRollup');
  if (!el) return;
  const claimRows = (rows || []).filter(r =>
    r && (String(r.carrier_claim_id || '').trim() || String(r.damage_source || '').toLowerCase() === 'carrier')
  );
  if (!claimRows.length) { el.style.display = 'none'; return; }

  // Aggregates
  const byCarrier = {};
  let openCount = 0;
  let recoveredUsd = 0;
  let approvedCount = 0;
  let deniedCount = 0;
  claimRows.forEach(r => {
    const carrier = String(r.damaged_carrier || 'other').toLowerCase();
    const status = String(r.carrier_claim_status || '').toLowerCase();
    const recov = Number(r.carrier_claim_recovered_usd || 0) || 0;
    if (!byCarrier[carrier]) byCarrier[carrier] = { count: 0, recovered: 0 };
    byCarrier[carrier].count += 1;
    byCarrier[carrier].recovered += recov;
    recoveredUsd += recov;
    if (status === 'open' || status === 'submitted') openCount += 1;
    if (status === 'approved') approvedCount += 1;
    if (status === 'denied') deniedCount += 1;
  });

  // $K formatter — "3.2 K" / "12 K" / "$847" for sub-1K
  const formatUsd = (n) => {
    if (n >= 1000) return '$' + (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return '$' + Math.round(n);
  };

  // Sort carriers by claim count desc
  const carrierBreakdown = Object.entries(byCarrier)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([k, v]) => '<span style="display:inline-block;margin:2px 6px 2px 0;padding:2px 8px;background:rgba(92,69,2,.08) !important;color:#5c4502 !important;-webkit-text-fill-color:#5c4502 !important;border:1px solid rgba(92,69,2,.20) !important;border-radius:999px !important;font-size:11px !important;font-weight:800 !important">'
      + esc(k.toUpperCase()) + ': ' + v.count + (v.recovered ? ' · ' + formatUsd(v.recovered) : '') + '</span>')
    .join('');

  el.style.display = '';
  el.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">'
    +   '<span style="font-family:\'Barlow Condensed\',Arial,sans-serif;font-size:14px;font-weight:900;color:#5c4502 !important;-webkit-text-fill-color:#5c4502 !important;letter-spacing:.5px;text-transform:uppercase">🛡 Carrier Claims</span>'
    +   '<span style="font-size:11px;color:#5c4502 !important;-webkit-text-fill-color:#5c4502 !important;opacity:.85">' + claimRows.length + ' total in view</span>'
    + '</div>'
    + '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:6px">'
    +   '<span style="background:rgba(255,179,0,.16) !important;color:#8b6500 !important;-webkit-text-fill-color:#8b6500 !important;border:1px solid rgba(139,101,0,.30) !important;padding:2px 9px !important;border-radius:999px !important;font-size:11px !important;font-weight:800 !important">⏳ ' + openCount + ' open/submitted</span>'
    +   (approvedCount ? '<span style="background:rgba(0,200,83,.16) !important;color:#1a5c1a !important;-webkit-text-fill-color:#1a5c1a !important;border:1px solid rgba(26,92,26,.30) !important;padding:2px 9px !important;border-radius:999px !important;font-size:11px !important;font-weight:800 !important">✓ ' + approvedCount + ' approved</span>' : '')
    +   (deniedCount ? '<span style="background:rgba(255,82,82,.16) !important;color:#a30000 !important;-webkit-text-fill-color:#a30000 !important;border:1px solid rgba(163,0,0,.30) !important;padding:2px 9px !important;border-radius:999px !important;font-size:11px !important;font-weight:800 !important">✗ ' + deniedCount + ' denied</span>' : '')
    +   (recoveredUsd ? '<span style="background:rgba(0,48,135,.10) !important;color:#003087 !important;-webkit-text-fill-color:#003087 !important;border:1px solid rgba(0,48,135,.30) !important;padding:2px 9px !important;border-radius:999px !important;font-size:11px !important;font-weight:800 !important">💵 ' + formatUsd(recoveredUsd) + ' recovered</span>' : '')
    + '</div>'
    + (carrierBreakdown ? '<div style="font-size:11px;color:#5c4502 !important;-webkit-text-fill-color:#5c4502 !important">By carrier: ' + carrierBreakdown + '</div>' : '');
}

function _remakeIsStuck_(r) {
  if (!r || !r.created_at) return false;
  const st = String(r.status || '');
  if (st !== 'pending' && st !== 'ready_to_ship') return false;
  const ageDays = (new Date() - new Date(r.created_at)) / 86400000;
  return ageDays >= 5;
}

// Stuck-remake escalate: opens a pre-filled mailto: to flag a
// remake that's been sitting too long. Server-free; uses the
// platform's mail composer (works on iPad + desktop). Pulls
// customer/SKUs/age from _remakesCacheById.
function _remakeEscalate_(remakeId) {
  const r = _remakesCacheById[remakeId];
  if (!r) { showToast('Remake details not loaded — refresh the list'); return; }
  const ageDays = r.created_at ? Math.round((new Date() - new Date(r.created_at)) / 86400000) : '?';
  const skus = (r.skus || []).map(s => s.qty + '× ' + s.sku).join(', ');
  const subject = '[Remake STUCK ' + ageDays + 'd] ' + remakeId + ' — ' + (r.customer_name || '');
  const lines = [
    'Remake has been sitting in ' + (r.status || '') + ' for ' + ageDays + ' days.',
    '',
    'Remake ID:  ' + remakeId,
    'Customer:   ' + (r.customer_name || ''),
    'Original #: ' + (r.original_order_number || ''),
    'SKUs:       ' + skus,
    'Reason:     ' + (r.reason || ''),
    'Created:    ' + (r.created_at || ''),
    r.shipstation_admin_url ? 'ShipStation: ' + r.shipstation_admin_url : '',
    '',
    'Please action or update status.',
  ].filter(Boolean);
  const mailto = 'mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(lines.join('\n'));
  window.location.href = mailto;
}

// v10.150 — persona #4 (Jessica): carrier filter chips on the Remakes
// panel so weekly batch carrier-claim filings can see all FedEx-damaged
// (or UPS-damaged etc.) orders in one view. Persisted in localStorage.
let _remakesCarrierFilter = '';
try { _remakesCarrierFilter = localStorage.getItem('mbd_remakes_carrier_filter') || ''; } catch (e) {}

function setRemakesCarrierFilter_(carrierKey, statusFilter) {
  _remakesCarrierFilter = String(carrierKey || '');
  try { localStorage.setItem('mbd_remakes_carrier_filter', _remakesCarrierFilter); } catch (e) {}
  // Re-render with same status filter (server is re-called to refresh)
  openRemakesPanel(statusFilter || 'open');
}

async function openRemakesPanel(statusFilter) {
  statusFilter = statusFilter || 'open';
  const prior = document.getElementById('remakesOverlay');
  if (prior) prior.remove();

  const ov = document.createElement('div');
  ov.id = 'remakesOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:flex-end;justify-content:center';
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  ov.innerHTML =
    '<div onclick="event.stopPropagation()" style="background:#fff;width:100%;max-width:720px;max-height:92vh;border-radius:18px 18px 0 0;padding:18px 20px 28px;overflow-y:auto;box-shadow:0 -4px 24px rgba(0,0,0,.3)">'
    + '<div style="width:40px;height:4px;background:#ccc;border-radius:999px;margin:0 auto 14px"></div>'
    + '<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:6px;gap:10px;flex-wrap:wrap">'
    +   '<div style="font-family:\'Barlow Condensed\',Arial,sans-serif;font-size:24px;font-weight:900;color:#1a1a1a;text-transform:uppercase;letter-spacing:.5px">🔧 Remakes</div>'
    // v10.245 Phase C — jump button to Damage Log panel (the two are merging).
    +   '<div style="display:flex;gap:6px;align-items:center">'
    +     '<button onclick="document.getElementById(\'remakesOverlay\').remove();openDamageLog()" title="Switch to Damage Log panel" style="background:#fff !important;color:#8B0000 !important;-webkit-text-fill-color:#8B0000 !important;border:1.5px solid #8B0000 !important;border-radius:8px;padding:7px 12px;font-size:12px;font-weight:800;cursor:pointer;letter-spacing:.4px;text-transform:uppercase">🚫 Damage Log →</button>'
    +     '<button onclick="document.getElementById(\'remakesOverlay\').remove()" style="background:none;border:none;font-size:24px;color:#444;cursor:pointer;padding:0 4px" aria-label="Close Remakes panel">✕</button>'
    +   '</div>'
    + '</div>'
    + '<div style="font-size:12px;color:#666;line-height:1.4;margin-bottom:12px">Replacement parts to ship to customers. Creating one emails the warehouse and logs to the Remakes tab.</div>'
    + '<div style="display:flex;gap:8px;margin-bottom:8px">'
    +   '<button onclick="openRemakeCreate()" style="flex:1;padding:14px;background:linear-gradient(135deg,#00C853,#1A5C1A);color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:900;cursor:pointer;letter-spacing:.5px;text-transform:uppercase">+ New Remake</button>'
    +   '<button onclick="pollRemakeShipments_()" style="padding:14px 18px;background:#fff;color:#003087;border:1.5px solid #003087;border-radius:10px;font-size:13px;font-weight:800;cursor:pointer;white-space:nowrap" title="Check ShipStation for newly-shipped remakes">🔄 Check SS</button>'
    + '</div>'
    // v10.126: damage-intake CTA. Visually distinct from "+ New Remake"
    // — uses the alert-red gradient + 🚨 icon so it's clearly the
    // "customer reported damage" path, not the routine remake flow.
    + '<button onclick="openRemakeDamageIntake()" style="width:100%;padding:13px;margin-bottom:12px;background:linear-gradient(135deg,#FF6B00,#B71C1C);color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:900;cursor:pointer;letter-spacing:.5px;text-transform:uppercase">🚨 Report Customer Damage</button>'
    // v10.207 Jessica CS-VP roll-up — populated post-fetch by
    // _renderRemakeClaimsRollup_(). Hidden if no claim data.
    + '<div id="remakeClaimsRollup" style="display:none;background:#fff8e7 !important;color:#5c4502 !important;-webkit-text-fill-color:#5c4502 !important;border:1px solid #e6c870 !important;border-radius:10px !important;padding:12px 14px !important;margin-bottom:10px !important;font-size:12px !important"></div>'
    + '<div style="display:flex;gap:6px;margin-bottom:8px">'
    + ['open', 'pending', 'ready_to_ship', 'shipped', 'all'].map(s => '<button onclick="openRemakesPanel(\'' + s + '\')" style="flex:1;padding:8px 4px;background:' + (s === statusFilter ? '#003087' : '#f5f5f5') + ';color:' + (s === statusFilter ? '#fff' : '#333') + ';border:none;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;text-transform:uppercase;letter-spacing:.5px">' + s.replace(/_/g, ' ') + '</button>').join('')
    + '</div>'
    // v10.150: carrier filter chips (Jessica's J3). Active filter is
    // applied client-side to the fetched rows below. "Any" = no filter.
    // "🚨 Damaged" = any row with damage_source set, regardless of carrier.
    + '<div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap">'
    + [
        {k: '', label: 'Any carrier', bg: '#f5f5f5', fg: '#333'},
        {k: '__damaged__', label: '🚨 Damaged', bg: '#FFE0E0', fg: '#8B0000'},
        {k: 'fedex', label: '🚚 FedEx', bg: '#f5f5f5', fg: '#333'},
        {k: 'ups', label: '📦 UPS', bg: '#f5f5f5', fg: '#333'},
        {k: 'usps', label: '✉ USPS', bg: '#f5f5f5', fg: '#333'},
        {k: 'ontrac', label: 'OnTrac', bg: '#f5f5f5', fg: '#333'},
        {k: 'lasership', label: 'LaserShip', bg: '#f5f5f5', fg: '#333'},
        {k: 'other', label: 'Other', bg: '#f5f5f5', fg: '#333'},
      ].map(c => {
        const active = _remakesCarrierFilter === c.k;
        return '<button onclick="setRemakesCarrierFilter_(\'' + c.k + '\',\'' + statusFilter + '\')" style="padding:6px 12px;background:' + (active ? '#003087' : c.bg) + ';color:' + (active ? '#fff' : c.fg) + ';border:none;border-radius:999px;font-size:11px;font-weight:700;cursor:pointer;letter-spacing:.3px">' + c.label + '</button>';
      }).join('')
    + '</div>'
    + '<div id="remakesListBody" style="min-height:60px">Loading…</div>'
    + '</div>';
  document.body.appendChild(ov);

  let res;
  try { res = await groundApi('listRemakes', { status: statusFilter }); }
  catch (err) {
    document.getElementById('remakesListBody').innerHTML = '<div style="color:#c33;font-weight:700;padding:14px">Error: ' + esc(err.message) + '</div>';
    return;
  }
  if (!res || !res.ok) {
    document.getElementById('remakesListBody').innerHTML = '<div style="color:#c33;font-weight:700;padding:14px">Error: ' + esc((res && res.error) || 'unknown') + '</div>';
    return;
  }
  // v10.114: cache the rendered remakes so per-row actions
  // (e.g. _remakeEscalate_) can look up the full record.
  _remakesCacheById = {};
  (res.rows || []).forEach(r => { if (r && r.remake_id) _remakesCacheById[r.remake_id] = r; });

  // v10.207 Jessica CS-VP roll-up: aggregate carrier-claim metrics
  // across ALL fetched rows (before client-side carrier filter), so
  // Jessica sees dollar-impact at a glance. Shows only if any row
  // has a carrier_claim_id OR damage_source='carrier'. Recovered $
  // formats as compact (12.4 K) for ops-glance readability.
  _renderRemakeClaimsRollup_(res.remakes || []);

  let rows = res.remakes || [];
  // v10.150: apply client-side carrier filter (Jessica's J3).
  if (_remakesCarrierFilter === '__damaged__') {
    rows = rows.filter(r => r && r.damage_source);
  } else if (_remakesCarrierFilter) {
    rows = rows.filter(r => r && String(r.damaged_carrier || '').toLowerCase() === _remakesCarrierFilter.toLowerCase());
  }
  // v10.198 — auto-sort so STUCK remakes (5+ days in pending/ready)
  // float to the top, then oldest-first within each bucket. Jessica
  // shouldn't have to scan the whole list to find what's overdue.
  rows = rows.slice().sort((a, b) => {
    const stuckA = _remakeIsStuck_(a) ? 1 : 0;
    const stuckB = _remakeIsStuck_(b) ? 1 : 0;
    if (stuckA !== stuckB) return stuckB - stuckA; // stuck first
    // Then by age ascending (oldest = most-overdue at top)
    const ta = a && a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b && b.created_at ? new Date(b.created_at).getTime() : 0;
    return ta - tb;
  });
  if (!rows.length) {
    const noteFilter = _remakesCarrierFilter
      ? ' for carrier filter "' + (_remakesCarrierFilter === '__damaged__' ? 'Damaged' : _remakesCarrierFilter.toUpperCase()) + '"'
      : '';
    document.getElementById('remakesListBody').innerHTML = '<div style="padding:24px;text-align:center;color:#555;background:#fafafa;border-radius:10px;font-size:13px">No remakes in this view' + esc(noteFilter) + '.</div>';
    return;
  }

  document.getElementById('remakesListBody').innerHTML = rows.map(r => {
    const statusColor = r.status === 'pending' ? '#FFB300' : r.status === 'ready_to_ship' ? '#3DBEFF' : r.status === 'shipped' ? '#00C853' : '#888';
    const skuList = (r.skus || []).map(s => esc(s.qty + '× ' + s.sku)).join(', ');
    const rushChip = r.priority === 'rush' ? '<span style="background:#ff5252;color:#fff;padding:1px 6px;border-radius:999px;font-size:9px;font-weight:900;letter-spacing:.5px;margin-left:4px">⚡ RUSH</span>' : '';
    const orderRef = r.original_order_number ? ' · #' + esc(r.original_order_number) : '';
    const ssChip = (r.shipstation_order_id && r.shipstation_admin_url)
      ? '<a href="' + esc(r.shipstation_admin_url) + '" target="_blank" style="display:inline-block;padding:1px 8px;background:#003087;color:#fff;border-radius:999px;font-size:10px;font-weight:800;text-decoration:none;margin-left:6px;letter-spacing:.5px">→ SS</a>'
      : (r.shipstation_order_id ? '<span style="display:inline-block;padding:1px 8px;background:#003087;color:#fff;border-radius:999px;font-size:10px;font-weight:800;margin-left:6px;letter-spacing:.5px">SS#' + esc(r.shipstation_order_id) + '</span>' : '');
    // Sable: stuck-remake indicator — a remake in ready_to_ship for
    // 5+ days has been ignored. Same threshold as damage stuck check.
    let stuckChip = '';
    if ((r.status === 'pending' || r.status === 'ready_to_ship') && r.created_at) {
      const ageDays = (new Date() - new Date(r.created_at)) / 86400000;
      if (ageDays >= 5) {
        stuckChip = '<span style="background:#ff5252;color:#fff;padding:1px 6px;border-radius:999px;font-size:9px;font-weight:900;letter-spacing:.5px;margin-left:4px">⚠ STUCK ' + Math.round(ageDays) + 'd</span>';
      }
    }
    return '<div style="padding:12px;background:#fafafa;border-left:3px solid ' + statusColor + ';border-radius:8px;margin-bottom:8px;font-size:13px">'
      + '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;flex-wrap:wrap;gap:4px">'
      +   '<span style="font-family:\'JetBrains Mono\',monospace;font-weight:900;color:#1a1a1a">' + esc(r.remake_id) + orderRef + ssChip + '</span>'
      +   '<span style="font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:1px;color:' + statusColor + '">' + esc(r.status).replace(/_/g, ' ') + stuckChip + rushChip + '</span>'
      + '</div>'
      + '<div style="font-weight:700;color:#1a1a1a">' + esc(r.customer_name) + '</div>'
      + '<div style="font-size:12px;color:#666;margin:4px 0">' + skuList + '</div>'
      + (r.reason ? '<div style="font-size:11px;color:#888;font-style:italic;margin-bottom:6px">"' + esc(r.reason) + '"</div>' : '')
      + '<div style="display:flex;gap:6px;margin-top:6px">'
      + (r.status === 'pending' ? '<button onclick="updateRemakeStatus_(\'' + esc(r.remake_id) + '\',\'ready_to_ship\')" style="flex:1;padding:8px;background:rgba(61,190,255,.15);color:#0099CC;border:1px solid #3DBEFF;border-radius:6px;font-size:12px;font-weight:800;cursor:pointer">Ready to Ship</button>' : '')
      + (r.status === 'ready_to_ship' ? '<button onclick="openRemakeShipModal(\'' + esc(r.remake_id) + '\')" style="flex:1;padding:8px;background:rgba(0,200,83,.15);color:#1A5C1A;border:1px solid #00C853;border-radius:6px;font-size:12px;font-weight:800;cursor:pointer">Mark Shipped</button>' : '')
      + (stuckChip ? '<button onclick="_remakeEscalate_(\'' + esc(r.remake_id) + '\')" style="padding:8px 10px;background:rgba(255,82,82,.12);color:#ff5252;border:1px solid #ff5252;border-radius:6px;font-size:12px;font-weight:800;cursor:pointer" title="Email warehouse — flag this stuck remake">↗ Escalate</button>' : '')
      + (r.status !== 'cancelled' ? '<button onclick="reprintRemakeSlip_(\'' + esc(r.remake_id) + '\')" style="padding:8px 10px;background:rgba(255,179,0,.10);color:#FFB300;border:1px solid #FFB300;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer" title="Reprint pick slip">🖨</button>' : '')
      + (r.status !== 'shipped' && r.status !== 'cancelled' ? '<button onclick="updateRemakeStatus_(\'' + esc(r.remake_id) + '\',\'cancelled\')" style="padding:8px 12px;background:rgba(255,82,82,.10);color:#c33;border:1px solid rgba(255,82,82,.4);border-radius:6px;font-size:12px;font-weight:700;cursor:pointer">Cancel</button>' : '')
      + '</div>'
      + '</div>';
  }).join('');
}

function refreshDayPlan_() {
  // v9.99: refresh all three strips (Schedule + Pre-Pack + Pack) so a
  // tap on any strip's ↻ button surfaces fresh data on every tab.
  paintDayPlanInto_('scheduleDayPlan', { forceRefresh: true });
  paintDayPlanInto_('prePackDayPlan', { forceRefresh: true });
  paintDayPlanInto_('packDayPlan', { forceRefresh: true });
  showToast('Refreshing day plan…');
}

// Render today's totals at the top of Schedule. Fire-and-forget,
// stays hidden if the fetch fails or returns nothing.
// v9.99: refactored to accept a target element so Pre-Pack and Pack
// tabs can render the same strip via paintDayPlanInto_().
async function paintScheduleDayPlan_(opts) {
  return paintDayPlanInto_('scheduleDayPlan', opts);
}

async function paintDayPlanInto_(targetElId, opts) {
  opts = opts || {};
  const el = document.getElementById(targetElId);
  if (!el) return;
  let res;
  const payload = opts.forceRefresh ? { no_cache: true } : {};
  try { res = await groundApi('getDayPlan', payload); }
  catch (e) { return; }
  if (!res || !res.ok || !res.counts) return;
  const c = res.counts;
  const totalActivity = (c.cabinet_packed || 0) + (c.cabinet_shipped || 0) + (c.cabinet_booked || 0)
    + (c.ground_packed || 0) + (c.ground_shipped || 0) + (c.remakes_created || 0) + (c.catches || 0);
  if (totalActivity === 0) { el.style.display = 'none'; return; }
  const cell = (label, val, color, onClick) => {
    const tag = onClick ? 'button' : 'div';
    const cursor = onClick ? 'cursor:pointer;' : '';
    const click = onClick ? ' onclick="' + onClick + '"' : '';
    return '<' + tag + click + ' style="background:rgba(255,255,255,.04);border:1px solid ' + color + '44;border-radius:8px;padding:6px 4px;text-align:center;min-width:62px;' + cursor + (onClick ? 'color:inherit;font:inherit;' : '') + '">'
      + '<div style="font-size:20px;font-weight:900;color:' + color + ';font-family:\'JetBrains Mono\',monospace;line-height:1">' + (val || 0) + '</div>'
      + '<div style="font-size:9px;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:.5px;margin-top:3px">' + label + '</div>'
      + '</' + tag + '>';
  };
  el.style.display = 'block';
  const savedToday = c.est_saved_today_usd || 0;
  const savedChip = savedToday > 0
    ? '<span style="margin-left:6px;padding:1px 8px;background:linear-gradient(135deg,#00C853,#1A5C1A);color:#fff;border-radius:999px;font-size:10px;font-weight:900;letter-spacing:.5px">+$' + savedToday.toLocaleString() + ' saved</span>'
    : '';
  el.innerHTML =
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span style="font-size:10px;font-weight:900;color:var(--text-dim);text-transform:uppercase;letter-spacing:1.5px">Today\'s Activity</span><span style="font-size:10px;color:var(--text-dim)">' + esc(c.date || '') + (res.cached ? ' · cached' : '') + '</span>' + savedChip + '<button onclick="refreshDayPlan_()" title="Force-refresh (bypass 60s cache)" style="margin-left:auto;background:transparent;border:none;color:var(--text-dim);font-size:13px;cursor:pointer;padding:2px 6px">↻</button></div>'
    + '<div style="display:flex;gap:6px;flex-wrap:wrap">'
    +   cell('Cab Packed', c.cabinet_packed, '#003087')
    +   cell('Cab Shipped', c.cabinet_shipped, '#1A5C1A', 'openTrackingPanel({source:\'cabinet\',days:7})')
    +   cell('Booked', c.cabinet_booked, '#FFB300')
    +   cell('Cust OK', c.cabinet_customer_ready, '#3DBEFF', 'openAwaitingCustomerList()')
    +   cell('Gnd Packed', c.ground_packed, '#003087')
    +   cell('Gnd Shipped', c.ground_shipped, '#1A5C1A', 'openTrackingPanel({source:\'ground\',days:7})')
    +   cell('Remakes', c.remakes_created, '#FF6B00', 'openRemakesPanel(\'open\')')
    +   cell('Catches', c.catches, '#c33', 'openCatchStats(7)')
    + '</div>';
}

// Awaiting-customer panel — Ken's primary triage list.
async function openAwaitingCustomerList() {
  const cache = await _ensureScheduleCache_();
  if (!cache || !cache.days) { showToast('Schedule data unavailable — check connection'); return; }
  const items = [];
  cache.days.forEach(d => {
    (d.orders || []).forEach(o => {
      if (o.source !== 'cabinet') return;
      if (o.customer_ready) return;
      const status = String(o.status || '').toLowerCase();
      if (status !== '' && status !== 'pending') return;
      const ship = new Date(o.ship_date + 'T00:00:00');
      const now = new Date(); now.setHours(0, 0, 0, 0);
      const diff = (ship - now) / (1000 * 60 * 60 * 24);
      if (diff >= -1 && diff <= 14) items.push({ o, diff });
    });
  });
  if (!items.length) { showToast('Nothing awaiting customer confirmation'); return; }
  items.sort((a, b) => a.diff - b.diff);

  const ov = document.createElement('div');
  ov.id = 'awaitingCustOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:10000;display:flex;align-items:flex-end;justify-content:center';
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  const rows = items.map(({ o, diff }) => {
    const urg = diff < 0 ? 'OVERDUE' : (diff <= 2 ? Math.round(diff) + 'd' : Math.round(diff) + 'd');
    const urgColor = diff < 0 ? '#ff5252' : (diff <= 2 ? '#FFB300' : '#3DBEFF');
    return '<div onclick="document.getElementById(\'awaitingCustOverlay\').remove();openCustomerReadyModal(\'' + esc(o.order_number) + '\',false,\'\',\'\')" style="display:flex;align-items:center;gap:10px;padding:10px;background:rgba(61,190,255,.06);border-left:3px solid #3DBEFF;border-radius:6px;font-size:13px;color:#fff;margin-bottom:4px;cursor:pointer">'
      + '<span style="font-family:\'JetBrains Mono\',monospace;font-weight:900;min-width:60px">#' + esc(o.order_number) + '</span>'
      + '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(o.customer_name || '—') + '</span>'
      + '<span style="font-size:10px;color:#9AAAC0">' + esc(o.ship_date) + '</span>'
      + '<span style="font-size:10px;font-weight:900;color:' + urgColor + '">' + esc(urg) + '</span>'
      + '<span style="color:#3DBEFF;font-size:18px;font-weight:900">›</span>'
      + '</div>';
  }).join('');

  ov.innerHTML =
    '<div onclick="event.stopPropagation()" style="background:#1a1a1a;color:#fff;width:100%;max-width:680px;max-height:85vh;border-radius:14px 14px 0 0;padding:18px 18px 24px;overflow-y:auto;box-shadow:0 -4px 24px rgba(0,0,0,.6);border-top:2px solid #3DBEFF">'
    + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px"><div style="font-family:\'Barlow Condensed\',Arial,sans-serif;font-size:24px;font-weight:900;letter-spacing:.5px;text-transform:uppercase">🔔 ' + items.length + ' Awaiting Customer</div><button onclick="document.getElementById(\'awaitingCustOverlay\').remove()" style="background:none;border:none;color:#999;font-size:24px;cursor:pointer;padding:0 4px">✕</button></div>'
    + '<div style="font-size:12px;color:#9AAAC0;margin-bottom:14px">Cabinet orders shipping within 14 days that haven\'t been confirmed with the customer yet. Tap a row to mark ready.</div>'
    + rows
    + '<button onclick="document.getElementById(\'awaitingCustOverlay\').remove()" style="width:100%;margin-top:8px;padding:12px;background:#2a2a2a;color:#aaa;border:1px solid #444;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer">Close</button>'
    + '</div>';
  document.body.appendChild(ov);
}

function openRemakeCreate() {
  const defaultBy = (function(){ try { return localStorage.getItem('mbd_ground_packer') || ''; } catch(e) { return ''; } })();
  const ov = document.createElement('div');
  ov.id = 'remakeCreateOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:10001;display:flex;align-items:center;justify-content:center;padding:14px;overflow-y:auto';
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  ov.innerHTML =
    '<div onclick="event.stopPropagation()" style="background:#fff;border-radius:14px;padding:20px;max-width:520px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,.4)">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px"><div style="font-family:\'Barlow Condensed\',Arial,sans-serif;font-size:22px;font-weight:900;color:#1a1a1a;text-transform:uppercase;letter-spacing:.5px">New Remake</div><button onclick="document.getElementById(\'remakeCreateOverlay\').remove()" style="background:none;border:none;font-size:22px;color:#999;cursor:pointer">✕</button></div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">'
    +   '<div><label style="font-size:11px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:.5px">Your name *</label><input type="text" id="rmkBy" value="' + esc(defaultBy) + '" placeholder="e.g. Jessica" style="width:100%;padding:10px;font-size:14px;border:1.5px solid #ccc;border-radius:8px;outline:none;margin-top:2px"></div>'
    +   '<div><label style="font-size:11px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:.5px">Original Order #</label><input type="text" id="rmkOrigOrder" placeholder="(optional)" style="width:100%;padding:10px;font-size:14px;border:1.5px solid #ccc;border-radius:8px;outline:none;margin-top:2px"></div>'
    + '</div>'
    + '<label style="font-size:11px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:.5px">Customer name *</label>'
    + '<input type="text" id="rmkCustName" placeholder="" style="width:100%;padding:10px;font-size:14px;border:1.5px solid #ccc;border-radius:8px;outline:none;margin:2px 0 8px">'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">'
    +   '<div><label style="font-size:11px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:.5px">Email</label><input type="email" id="rmkCustEmail" style="width:100%;padding:10px;font-size:14px;border:1.5px solid #ccc;border-radius:8px;outline:none;margin-top:2px"></div>'
    +   '<div><label style="font-size:11px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:.5px">Phone</label><input type="tel" id="rmkCustPhone" style="width:100%;padding:10px;font-size:14px;border:1.5px solid #ccc;border-radius:8px;outline:none;margin-top:2px"></div>'
    + '</div>'
    + '<label style="font-size:11px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:.5px">Ship address *</label>'
    + '<textarea id="rmkShipAddr" rows="3" placeholder="Street&#10;City, State Zip" style="width:100%;padding:10px;font-size:14px;border:1.5px solid #ccc;border-radius:8px;outline:none;margin:2px 0 8px;resize:vertical;font-family:inherit"></textarea>'
    + '<label style="font-size:11px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:.5px">Items to ship *</label>'
    + '<div id="rmkSkuRows" style="margin:4px 0 6px">'
    +   _renderRemakeSkuRow_(0)
    + '</div>'
    + '<button type="button" onclick="addRemakeSkuRow_()" style="padding:6px 12px;background:#f5f5f5;color:#444;border:1px solid #ccc;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;margin-bottom:10px">+ Add another SKU</button>'
    + '<label style="font-size:11px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:.5px;margin-top:6px;display:block">Reason</label>'
    + '<textarea id="rmkReason" rows="2" placeholder="e.g. FedEx damaged the HLR77 in transit" style="width:100%;padding:10px;font-size:14px;border:1.5px solid #ccc;border-radius:8px;outline:none;margin:2px 0 10px;resize:vertical;font-family:inherit"></textarea>'
    + '<label style="display:flex;align-items:center;gap:8px;margin-bottom:14px;cursor:pointer"><input type="checkbox" id="rmkRush" style="width:18px;height:18px"> <span style="font-size:13px;font-weight:700;color:#c33">⚡ RUSH — flag as priority</span></label>'
    + '<div style="display:flex;gap:8px">'
    +   '<button onclick="document.getElementById(\'remakeCreateOverlay\').remove()" style="flex:1;padding:12px;background:#f5f5f5;color:#444;border:none;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer">Cancel</button>'
    +   '<button onclick="submitRemakeCreate()" style="flex:2;padding:12px;background:linear-gradient(135deg,#00C853,#1A5C1A);color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:900;cursor:pointer;letter-spacing:.5px;text-transform:uppercase">Create Remake</button>'
    + '</div>'
    + '</div>';
  document.body.appendChild(ov);
  setTimeout(() => {
    const inp = document.getElementById('rmkBy');
    if (inp && !inp.value) inp.focus();
    else { const c = document.getElementById('rmkCustName'); if (c) c.focus(); }
  }, 80);
}

let _remakeSkuRowSeq = 1;
function _renderRemakeSkuRow_(idx) {
  return '<div class="rmkSkuRow" data-idx="' + idx + '" style="display:grid;grid-template-columns:60px 1fr 1fr auto;gap:6px;align-items:center;margin-bottom:6px">'
    + '<input type="number" min="1" value="1" class="rmkSkuQty" style="padding:8px;font-size:14px;border:1.5px solid #ccc;border-radius:6px;outline:none;text-align:center">'
    + '<input type="text" class="rmkSkuSku" placeholder="SKU (e.g. HLR77)" style="padding:8px;font-size:14px;border:1.5px solid #ccc;border-radius:6px;outline:none;font-family:monospace">'
    + '<input type="text" class="rmkSkuNotes" placeholder="notes (optional)" style="padding:8px;font-size:13px;border:1.5px solid #ccc;border-radius:6px;outline:none">'
    + (idx > 0 ? '<button onclick="this.closest(\'.rmkSkuRow\').remove()" style="background:none;border:none;color:#c33;font-size:18px;cursor:pointer;padding:0 4px">✕</button>' : '<span></span>')
    + '</div>';
}
function addRemakeSkuRow_() {
  const container = document.getElementById('rmkSkuRows');
  if (!container) return;
  const idx = _remakeSkuRowSeq++;
  const tmp = document.createElement('div');
  tmp.innerHTML = _renderRemakeSkuRow_(idx);
  container.appendChild(tmp.firstChild);
}

let _remakeSubmitting = false;
async function submitRemakeCreate() {
  if (_remakeSubmitting) { showToast('Creating remake… one moment'); return; }
  const by = (document.getElementById('rmkBy') || {}).value || '';
  const origOrder = (document.getElementById('rmkOrigOrder') || {}).value || '';
  const custName = (document.getElementById('rmkCustName') || {}).value || '';
  const custEmail = (document.getElementById('rmkCustEmail') || {}).value || '';
  const custPhone = (document.getElementById('rmkCustPhone') || {}).value || '';
  const shipAddr = (document.getElementById('rmkShipAddr') || {}).value || '';
  const reason = (document.getElementById('rmkReason') || {}).value || '';
  const rush = !!(document.getElementById('rmkRush') || {}).checked;

  const skus = [];
  document.querySelectorAll('.rmkSkuRow').forEach(row => {
    const qty = Number(row.querySelector('.rmkSkuQty').value || 0);
    const sku = String(row.querySelector('.rmkSkuSku').value || '').trim();
    const notes = String(row.querySelector('.rmkSkuNotes').value || '').trim();
    if (sku && qty > 0) skus.push({ sku, qty, notes });
  });

  if (!by.trim()) { showToast('Enter your name'); document.getElementById('rmkBy').focus(); return; }
  if (!custName.trim()) { showToast('Enter customer name'); document.getElementById('rmkCustName').focus(); return; }
  if (!shipAddr.trim()) { showToast('Enter ship address'); document.getElementById('rmkShipAddr').focus(); return; }
  if (!skus.length) { showToast('Add at least one SKU'); return; }

  _remakeSubmitting = true;
  try {
    const res = await groundApi('createRemake', {
      created_by: by.trim(),
      original_order_number: origOrder.trim(),
      customer_name: custName.trim(),
      customer_email: custEmail.trim(),
      customer_phone: custPhone.trim(),
      ship_address: shipAddr.trim(),
      skus: skus,
      reason: reason.trim(),
      priority: rush ? 'rush' : 'normal',
    });
    if (!res || !res.ok) { showToast('Create failed: ' + ((res && res.error) || 'unknown')); return; }
    const ov = document.getElementById('remakeCreateOverlay');
    if (ov) ov.remove();
    showToast('✓ Remake ' + res.remake_id + ' created · warehouse notified');
    openRemakesPanel('open');
  } catch (err) {
    showToast('Create error: ' + err.message);
  } finally {
    _remakeSubmitting = false;
  }
}

async function updateRemakeStatus_(remakeId, newStatus) {
  if (newStatus === 'cancelled' && !confirm('Cancel remake ' + remakeId + '?')) return;
  try {
    const res = await groundApi('updateRemakeStatus', { remake_id: remakeId, status: newStatus });
    if (!res || !res.ok) { showToast('Update failed: ' + ((res && res.error) || 'unknown')); return; }
    let msg = '✓ ' + remakeId + ' → ' + newStatus.replace(/_/g, ' ');
    if (res.print && res.print.ok) msg += ' · 🖨 pick slip printed';
    else if (res.print && !res.print.ok) msg += ' · ⚠ print failed';
    if (res.shipstation && res.shipstation.ok && !res.shipstation.skipped) msg += ' · → SS order #' + (res.shipstation.shipstation_order_id || '?');
    else if (res.shipstation && !res.shipstation.ok) msg += ' · ⚠ SS create failed';
    showToast(msg);
    openRemakesPanel('open');
  } catch (err) {
    showToast('Update error: ' + err.message);
  }
}

async function pollRemakeShipments_() {
  showToast('Checking ShipStation for shipped remakes…');
  try {
    const res = await groundApi('pollRemakeShipments', {});
    if (!res || !res.ok) { showToast('Poll failed: ' + ((res && res.error) || 'unknown')); return; }
    showToast('✓ Checked ' + (res.checked || 0) + ' · updated ' + (res.updated || 0) + (res.errors && res.errors.length ? ' · ' + res.errors.length + ' error' + (res.errors.length === 1 ? '' : 's') : ''));
    openRemakesPanel('open');
  } catch (err) {
    showToast('Poll error: ' + err.message);
  }
}

async function reprintRemakeSlip_(remakeId) {
  try {
    const res = await groundApi('printRemakePickSlip', { remake_id: remakeId });
    if (!res || !res.ok) { showToast('Print failed: ' + ((res && res.error) || 'unknown')); return; }
    showToast('🖨 Pick slip queued for ' + remakeId);
  } catch (err) {
    showToast('Print error: ' + err.message);
  }
}

// v10.126: Customer-damage intake. CS associate (Jessica usually) taps
// "🚨 Report Customer Damage" → fills in carrier+tracking, damage
// notes, uploads photos. Server creates the remake row with
// damage_source='carrier_damage', uploads photos to Drive, and sends a
// 🚨 CARRIER DAMAGE email to shipping@ + seth@ + zac@ + jessica@.
let _rmkDamagePhotos = []; // [{filename, base64, mimeType}]
let _rmkDamageSubmitting = false;
function openRemakeDamageIntake(prefill) {
  _rmkDamagePhotos = [];
  _rmkDamageSubmitting = false;
  const defaultBy = (function(){ try { return localStorage.getItem('mbd_ground_packer') || ''; } catch(e) { return ''; } })();
  const pf = prefill || {};
  const today = new Date().toISOString().slice(0, 10);
  const ov = document.createElement('div');
  ov.id = 'remakeDamageOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:10001;display:flex;align-items:center;justify-content:center;padding:14px;overflow-y:auto';
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  // v10.145: keep-dark-text exempts the modal from the global
  // dark-theme override on color:#444/#666/#888.
  ov.innerHTML =
    '<div class="keep-dark-text" onclick="event.stopPropagation()" style="background:#fff;border-radius:14px;padding:20px;max-width:560px;width:100%;max-height:92vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,.4)">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><div style="font-family:\'Barlow Condensed\',Arial,sans-serif;font-size:22px;font-weight:900;color:#B71C1C;text-transform:uppercase;letter-spacing:.5px">🚨 Customer Damage Report</div><button onclick="document.getElementById(\'remakeDamageOverlay\').remove()" style="background:none;border:none;font-size:22px;color:#5C7390;cursor:pointer">✕</button></div>'
    + '<div style="font-size:13px;color:#333;line-height:1.55;margin-bottom:14px">Use this when a customer reports their shipment arrived damaged. Creates a Remake + emails warehouse + Jessica with photos + carrier info. Files a carrier claim is a separate step (link emailed).</div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">'
    +   '<div><label style="font-size:11px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:.5px">Your name *</label><input type="text" id="rmkdBy" value="' + esc(defaultBy) + '" placeholder="e.g. Jessica" style="width:100%;padding:10px;font-size:14px;border:1.5px solid #ccc;border-radius:8px;outline:none;margin-top:2px;box-sizing:border-box"></div>'
    +   '<div><label style="font-size:11px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:.5px">Original Order # *</label><input type="text" id="rmkdOrigOrder" value="' + esc(pf.orderNumber || '') + '" placeholder="e.g. 31774" style="width:100%;padding:10px;font-size:14px;border:1.5px solid #ccc;border-radius:8px;outline:none;margin-top:2px;box-sizing:border-box"></div>'
    + '</div>'
    + '<div style="background:#FFE0E0;border:1.5px solid #B71C1C;border-radius:10px;padding:12px 14px;margin:8px 0 12px">'
    +   '<div style="font-size:11px;font-weight:900;color:#5A0000;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Damage details</div>'
    +   '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">'
    +     '<div><label style="font-size:11px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:.5px">Carrier *</label>'
    +       '<select id="rmkdCarrier" style="width:100%;padding:10px;font-size:14px;border:1.5px solid #ccc;border-radius:8px;outline:none;margin-top:2px;box-sizing:border-box;background:#fff">'
    +         '<option value="">-- pick one --</option>'
    +         '<option value="fedex">FedEx</option>'
    +         '<option value="ups">UPS</option>'
    +         '<option value="usps">USPS</option>'
    +         '<option value="ontrac">OnTrac</option>'
    +         '<option value="lasership">LaserShip</option>'
    +         '<option value="dhl">DHL</option>'
    +         '<option value="other">Other</option>'
    +       '</select></div>'
    +     '<div><label style="font-size:11px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:.5px">Damage date</label><input type="date" id="rmkdAt" value="' + esc(today) + '" style="width:100%;padding:10px;font-size:14px;border:1.5px solid #ccc;border-radius:8px;outline:none;margin-top:2px;box-sizing:border-box"></div>'
    +   '</div>'
    +   '<label style="font-size:11px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:.5px">Tracking # (of damaged shipment)</label>'
    +   '<input type="text" id="rmkdTracking" placeholder="" style="width:100%;padding:10px;font-size:14px;border:1.5px solid #ccc;border-radius:8px;outline:none;margin:2px 0 8px;font-family:monospace;box-sizing:border-box">'
    +   '<label style="font-size:11px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:.5px">Carrier claim ID (if already filed)</label>'
    +   '<input type="text" id="rmkdClaimId" placeholder="(optional — leave blank, link in email)" style="width:100%;padding:10px;font-size:14px;border:1.5px solid #ccc;border-radius:8px;outline:none;margin:2px 0 8px;font-family:monospace;box-sizing:border-box">'
    +   '<label style="font-size:11px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:.5px">Damage description / what customer reported *</label>'
    +   '<textarea id="rmkdNotes" rows="3" placeholder="e.g. Box arrived crushed; HLR77 cracked at the mounting bracket. Customer sent 3 photos." style="width:100%;padding:10px;font-size:14px;border:1.5px solid #ccc;border-radius:8px;outline:none;margin:2px 0 8px;resize:vertical;font-family:inherit;box-sizing:border-box"></textarea>'
    +   '<label style="font-size:11px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px">📷 Damage photos (uploads to Drive, linked in email)</label>'
    +   '<input type="file" id="rmkdPhotos" accept="image/*" multiple capture="environment" onchange="_rmkDamageOnPhotosSelected_(this.files)" style="font-size:13px;width:100%">'
    +   '<div id="rmkdPhotosStatus" style="font-size:12px;color:#666;margin-top:4px"></div>'
    + '</div>'
    + '<div style="font-size:11px;font-weight:900;color:#444;text-transform:uppercase;letter-spacing:1px;margin:8px 0 4px">Customer + ship-to</div>'
    + '<div style="font-size:11px;color:#888;margin-bottom:6px">For the replacement shipment we\'ll send out. If Order # above is set, you can leave these blank — we\'ll pull from the Shopify order.</div>'
    + '<input type="text" id="rmkdCustName" value="' + esc(pf.customerName || '') + '" placeholder="Customer name" style="width:100%;padding:10px;font-size:14px;border:1.5px solid #ccc;border-radius:8px;outline:none;margin-bottom:6px;box-sizing:border-box">'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:6px">'
    +   '<input type="email" id="rmkdCustEmail" value="' + esc(pf.customerEmail || '') + '" placeholder="Email" style="padding:10px;font-size:14px;border:1.5px solid #ccc;border-radius:8px;outline:none;box-sizing:border-box">'
    +   '<input type="tel" id="rmkdCustPhone" value="' + esc(pf.customerPhone || '') + '" placeholder="Phone" style="padding:10px;font-size:14px;border:1.5px solid #ccc;border-radius:8px;outline:none;box-sizing:border-box">'
    + '</div>'
    + '<textarea id="rmkdShipAddr" rows="3" placeholder="Street&#10;City, State Zip" style="width:100%;padding:10px;font-size:14px;border:1.5px solid #ccc;border-radius:8px;outline:none;margin-bottom:8px;resize:vertical;font-family:inherit;box-sizing:border-box">' + esc(pf.shipAddress || '') + '</textarea>'
    + '<div style="font-size:11px;font-weight:900;color:#444;text-transform:uppercase;letter-spacing:1px;margin:8px 0 4px">Replacement items to send *</div>'
    + '<div id="rmkdSkuRows" style="margin:4px 0 6px">'
    +   _renderRmkdSkuRow_(0)
    + '</div>'
    + '<button type="button" onclick="addRmkdSkuRow_()" style="padding:6px 12px;background:#f5f5f5;color:#444;border:1px solid #ccc;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;margin-bottom:10px">+ Add another SKU</button>'
    + '<label style="display:flex;align-items:center;gap:8px;margin-bottom:14px;cursor:pointer"><input type="checkbox" id="rmkdRush" checked style="width:18px;height:18px"> <span style="font-size:13px;font-weight:700;color:#c33">⚡ RUSH — damage replacements default to rush priority</span></label>'
    + '<div style="display:flex;gap:8px">'
    +   '<button onclick="document.getElementById(\'remakeDamageOverlay\').remove()" style="flex:1;padding:12px;background:#f5f5f5;color:#444;border:none;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer">Cancel</button>'
    +   '<button onclick="submitRemakeDamageIntake()" id="rmkdSubmitBtn" style="flex:2;padding:12px;background:linear-gradient(135deg,#FF6B00,#B71C1C);color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:900;cursor:pointer;letter-spacing:.5px;text-transform:uppercase">🚨 File Damage Report</button>'
    + '</div>'
    + '</div>';
  document.body.appendChild(ov);
  setTimeout(() => {
    const inp = document.getElementById('rmkdBy');
    if (inp && !inp.value) inp.focus();
    else { const c = document.getElementById('rmkdOrigOrder'); if (c) c.focus(); }
  }, 80);
}

let _rmkdSkuRowSeq = 1;
function _renderRmkdSkuRow_(idx) {
  return '<div class="rmkdSkuRow" data-idx="' + idx + '" style="display:grid;grid-template-columns:60px 1fr 1fr auto;gap:6px;align-items:center;margin-bottom:6px">'
    + '<input type="number" min="1" value="1" class="rmkdSkuQty" style="padding:8px;font-size:14px;border:1.5px solid #ccc;border-radius:6px;outline:none;text-align:center;box-sizing:border-box">'
    + '<input type="text" class="rmkdSkuSku" placeholder="SKU (e.g. HLR77)" style="padding:8px;font-size:14px;border:1.5px solid #ccc;border-radius:6px;outline:none;font-family:monospace;box-sizing:border-box">'
    + '<input type="text" class="rmkdSkuNotes" placeholder="notes (optional)" style="padding:8px;font-size:13px;border:1.5px solid #ccc;border-radius:6px;outline:none;box-sizing:border-box">'
    + (idx > 0 ? '<button onclick="this.closest(\'.rmkdSkuRow\').remove()" style="background:none;border:none;color:#c33;font-size:18px;cursor:pointer;padding:0 4px">✕</button>' : '<span></span>')
    + '</div>';
}
function addRmkdSkuRow_() {
  const c = document.getElementById('rmkdSkuRows');
  if (!c) return;
  const idx = _rmkdSkuRowSeq++;
  const tmp = document.createElement('div');
  tmp.innerHTML = _renderRmkdSkuRow_(idx);
  c.appendChild(tmp.firstChild);
}

async function _rmkDamageOnPhotosSelected_(fileList) {
  const status = document.getElementById('rmkdPhotosStatus');
  if (!fileList || !fileList.length) { if (status) status.textContent = ''; _rmkDamagePhotos = []; return; }
  if (status) { status.textContent = 'Compressing ' + fileList.length + ' photo' + (fileList.length === 1 ? '' : 's') + '…'; status.style.color = '#666'; }
  const out = [];
  for (let i = 0; i < fileList.length; i++) {
    const f = fileList[i];
    try {
      const dataUrl = await compressImageToJpeg_(f, 1600, 0.85);
      const comma = dataUrl.indexOf(',');
      const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
      out.push({ filename: f.name || ('damage_' + (i + 1) + '.jpg'), base64: b64, mimeType: 'image/jpeg' });
    } catch (e) {
      console.warn('photo compress failed', f.name, e);
    }
  }
  _rmkDamagePhotos = out;
  if (status) { status.textContent = '✓ ' + out.length + ' photo' + (out.length === 1 ? '' : 's') + ' ready (uploads on submit)'; status.style.color = '#1A5C1A'; }
}

async function submitRemakeDamageIntake() {
  if (_rmkDamageSubmitting) { showToast('Submitting…'); return; }
  const by = (document.getElementById('rmkdBy') || {}).value || '';
  const origOrder = (document.getElementById('rmkdOrigOrder') || {}).value || '';
  const carrier = (document.getElementById('rmkdCarrier') || {}).value || '';
  const damagedAt = (document.getElementById('rmkdAt') || {}).value || '';
  const tracking = (document.getElementById('rmkdTracking') || {}).value || '';
  const claimId = (document.getElementById('rmkdClaimId') || {}).value || '';
  const damageNotes = (document.getElementById('rmkdNotes') || {}).value || '';
  const custName = (document.getElementById('rmkdCustName') || {}).value || '';
  const custEmail = (document.getElementById('rmkdCustEmail') || {}).value || '';
  const custPhone = (document.getElementById('rmkdCustPhone') || {}).value || '';
  const shipAddr = (document.getElementById('rmkdShipAddr') || {}).value || '';
  const rush = !!(document.getElementById('rmkdRush') || {}).checked;

  const skus = [];
  document.querySelectorAll('.rmkdSkuRow').forEach(row => {
    const qty = Number(row.querySelector('.rmkdSkuQty').value || 0);
    const sku = String(row.querySelector('.rmkdSkuSku').value || '').trim();
    const notes = String(row.querySelector('.rmkdSkuNotes').value || '').trim();
    if (sku && qty > 0) skus.push({ sku, qty, notes });
  });

  if (!by.trim()) { showToast('Enter your name'); document.getElementById('rmkdBy').focus(); return; }
  if (!origOrder.trim()) { showToast('Enter original order #'); document.getElementById('rmkdOrigOrder').focus(); return; }
  if (!carrier) { showToast('Pick the damaged-shipment carrier'); document.getElementById('rmkdCarrier').focus(); return; }
  if (!damageNotes.trim()) { showToast('Describe the damage'); document.getElementById('rmkdNotes').focus(); return; }
  if (!skus.length) { showToast('Add at least one replacement SKU'); return; }
  // Customer name + ship address — optional if origOrder provided (server-side lookup TBD), but warn.
  if (!custName.trim() && !origOrder.trim()) { showToast('Enter customer name'); return; }
  if (!shipAddr.trim() && !origOrder.trim()) { showToast('Enter ship address'); return; }

  _rmkDamageSubmitting = true;
  const btn = document.getElementById('rmkdSubmitBtn');
  if (btn) { btn.disabled = true; btn.textContent = (_rmkDamagePhotos.length ? 'Uploading ' + _rmkDamagePhotos.length + ' photo(s)…' : 'Submitting…'); }

  try {
    const res = await groundApi('createRemake', {
      created_by: by.trim(),
      original_order_number: origOrder.trim(),
      customer_name: custName.trim() || ('(from order ' + origOrder.trim() + ')'),
      customer_email: custEmail.trim(),
      customer_phone: custPhone.trim(),
      ship_address: shipAddr.trim() || ('(from order ' + origOrder.trim() + ')'),
      skus,
      reason: damageNotes.trim(),
      priority: rush ? 'rush' : 'normal',
      damage_source: 'carrier_damage',
      damaged_carrier: carrier,
      damaged_tracking_number: tracking.trim(),
      damaged_at: damagedAt,
      photos: _rmkDamagePhotos,
      carrier_claim_id: claimId.trim(),
    });
    if (!res || !res.ok) {
      showToast('Damage report failed: ' + ((res && res.error) || 'unknown'));
      _rmkDamageSubmitting = false;
      if (btn) { btn.disabled = false; btn.textContent = '🚨 File Damage Report'; }
      return;
    }
    showPackBanner_('✓ Damage report filed · ' + res.remake_id + (res.photo_urls && res.photo_urls.length ? ' (' + res.photo_urls.length + ' photo' + (res.photo_urls.length === 1 ? '' : 's') + ' uploaded)' : ''), '#00e676');
    const ov = document.getElementById('remakeDamageOverlay');
    if (ov) ov.remove();
    _rmkDamagePhotos = [];
    _rmkDamageSubmitting = false;
    // Re-open Remakes panel to show the new row.
    if (typeof openRemakesPanel === 'function') openRemakesPanel('open');
  } catch (err) {
    showToast('Damage report error: ' + err.message);
    _rmkDamageSubmitting = false;
    if (btn) { btn.disabled = false; btn.textContent = '🚨 File Damage Report'; }
  }
}

function openRemakeShipModal(remakeId) {
  const ov = document.createElement('div');
  ov.id = 'remakeShipOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:10002;display:flex;align-items:center;justify-content:center;padding:18px';
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  ov.innerHTML =
    '<div onclick="event.stopPropagation()" style="background:#fff;border-radius:14px;padding:20px;max-width:380px;width:100%">'
    + '<div style="font-family:\'Barlow Condensed\',Arial,sans-serif;font-size:20px;font-weight:900;color:#1a1a1a;margin-bottom:10px;text-transform:uppercase">Mark Shipped · ' + esc(remakeId) + '</div>'
    + '<label style="font-size:11px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:.5px">Carrier</label>'
    + '<input list="rmkCarrierList" id="rmkShipCarrier" placeholder="Pick or type carrier" style="width:100%;padding:10px;font-size:14px;border:1.5px solid #ccc;border-radius:8px;outline:none;margin:2px 0 8px">'
    + '<datalist id="rmkCarrierList">'
    +   ['UPS Ground','UPS 2nd Day Air','UPS Next Day Air','FedEx Ground','FedEx Express','FedEx Freight','USPS Priority','USPS Ground Advantage','DHL','OnTrac','LaserShip','Local Delivery','MBD Truck'].map(c=>'<option value="'+c+'">').join('')
    + '</datalist>'
    + '<label style="font-size:11px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:.5px">Tracking #</label>'
    + '<input type="text" id="rmkShipTracking" style="width:100%;padding:10px;font-size:14px;font-family:monospace;border:1.5px solid #ccc;border-radius:8px;outline:none;margin:2px 0 14px">'
    + '<div style="display:flex;gap:8px">'
    +   '<button onclick="document.getElementById(\'remakeShipOverlay\').remove()" style="flex:1;padding:12px;background:#f5f5f5;color:#444;border:none;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer">Cancel</button>'
    +   '<button onclick="submitRemakeShip(\'' + esc(remakeId) + '\')" style="flex:2;padding:12px;background:#00C853;color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:900;cursor:pointer">✓ Mark Shipped</button>'
    + '</div>'
    + '</div>';
  document.body.appendChild(ov);
}

let _remakeShipping = false;
async function submitRemakeShip(remakeId) {
  if (_remakeShipping) { showToast('Marking shipped… one moment'); return; }
  const carrier = String((document.getElementById('rmkShipCarrier') || {}).value || '').trim();
  const tracking = String((document.getElementById('rmkShipTracking') || {}).value || '').trim();
  _remakeShipping = true;
  try {
    const res = await groundApi('updateRemakeStatus', {
      remake_id: remakeId,
      status: 'shipped',
      shipped_carrier: carrier,
      shipped_tracking: tracking,
    });
    if (!res || !res.ok) { showToast('Save failed: ' + ((res && res.error) || 'unknown')); return; }
    const ov1 = document.getElementById('remakeShipOverlay'); if (ov1) ov1.remove();
    showToast('✓ ' + remakeId + ' shipped');
    openRemakesPanel('open');
  } catch (err) {
    showToast('Save error: ' + err.message);
  } finally {
    _remakeShipping = false;
  }
}

// ── Catch-Rate Stats (Norm's ROI dashboard) ──────────────
// Renders ScanRejections aggregates so Norm can decide whether
// scan-to-verify is paying for itself. Default: last 30 days,
// toggleable to 7/14/30/90.
async function openCatchStats(days) {
  if (typeof days !== 'number') days = 30;
  const prior = document.getElementById('catchStatsOverlay');
  if (prior) prior.remove();

  const ov = document.createElement('div');
  ov.id = 'catchStatsOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:flex-end;justify-content:center';
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  ov.innerHTML =
    '<div onclick="event.stopPropagation()" style="background:#fff;width:100%;max-width:680px;border-radius:18px 18px 0 0;padding:18px 20px 28px;max-height:90vh;overflow-y:auto;box-shadow:0 -4px 24px rgba(0,0,0,.3)">'
    + '<div style="width:40px;height:4px;background:#ccc;border-radius:999px;margin:0 auto 14px"></div>'
    + '<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:6px">'
    +   '<div style="font-family:\'Barlow Condensed\',Arial,sans-serif;font-size:24px;font-weight:900;color:#1a1a1a;text-transform:uppercase;letter-spacing:.5px">Catch-Rate Stats</div>'
    +   '<button onclick="document.getElementById(\'catchStatsOverlay\').remove()" style="background:none;border:none;font-size:24px;color:#999;cursor:pointer;padding:0 4px">✕</button>'
    + '</div>'
    + '<div style="font-size:12px;color:#666;line-height:1.4;margin-bottom:14px">Mistakes scan-to-verify caught that would have shipped wrong without it. Multiply by your reship cost to value the system.</div>'
    + '<div style="display:flex;gap:6px;margin-bottom:14px">'
    + [7, 14, 30, 90].map(n => '<button onclick="openCatchStats(' + n + ')" style="flex:1;padding:8px;background:' + (n === days ? '#003087' : '#f5f5f5') + ';color:' + (n === days ? '#fff' : '#444') + ';border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer">' + n + 'd</button>').join('')
    + '</div>'
    + '<div id="catchStatsBody" style="font-size:14px;color:#1a1a1a">Loading…</div>'
    + '<button onclick="document.getElementById(\'catchStatsOverlay\').remove()" style="width:100%;margin-top:14px;padding:12px;background:#f5f5f5;color:#666;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer">Close</button>'
    + '</div>';
  document.body.appendChild(ov);

  const end = new Date();
  const start = new Date(); start.setDate(end.getDate() - days);
  const iso = (d) => d.toISOString().slice(0, 10);
  let res;
  try {
    res = await groundApi('getCatchRateStats', { startDate: iso(start), endDate: iso(end) });
  } catch (err) {
    document.getElementById('catchStatsBody').innerHTML = '<div style="color:#c33;font-weight:700">Error: ' + esc(err.message || 'unknown') + '</div>';
    return;
  }
  if (!res || !res.ok) {
    document.getElementById('catchStatsBody').innerHTML = '<div style="color:#c33;font-weight:700">Error: ' + esc((res && res.error) || 'unknown') + '</div>';
    return;
  }

  const total = res.total || 0;
  const byKind = res.byKind || {};
  const byDay = res.byDay || [];
  const perDay = days ? (total / days).toFixed(2) : '—';

  // Cost-savings ballpark — $200 per catch is Zac's stated floor
  // (shipping + reputational, per May 2026 conversation).
  const COST_PER_CATCH_USD = 200;
  const estSavings = total * COST_PER_CATCH_USD;
  const estMonthly = days ? Math.round((total / days) * 30 * COST_PER_CATCH_USD) : 0;

  const kindRow = (label, key, color) =>
    '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f0f0f0">'
    + '<span style="font-size:13px;color:#444">' + label + '</span>'
    + '<span style="font-size:15px;font-weight:900;color:' + color + ';font-family:\'JetBrains Mono\',monospace">' + (byKind[key] || 0) + '</span>'
    + '</div>';

  // Sparkline as a fixed-width bar chart
  const maxDay = byDay.reduce((m, d) => Math.max(m, d.total), 0) || 1;
  const sparkline = byDay.length
    ? '<div style="display:flex;gap:2px;align-items:flex-end;height:60px;background:#fafafa;padding:8px;border-radius:8px;margin:6px 0 14px">'
      + byDay.slice(-30).map(d => {
          const h = Math.max(2, Math.round(d.total / maxDay * 56));
          return '<div title="' + d.date + ': ' + d.total + '" style="flex:1;height:' + h + 'px;background:#FFB300;border-radius:2px;min-width:4px"></div>';
        }).join('')
      + '</div>'
    : '<div style="background:linear-gradient(135deg,rgba(0,200,83,.10),rgba(26,92,26,.06));border:1px solid rgba(0,200,83,.30);padding:18px;border-radius:8px;margin:6px 0 14px;text-align:center;color:#1A5C1A;font-size:13px;font-weight:700">✓ Zero catches over the last ' + days + ' days — packers shipped clean.</div>';

  document.getElementById('catchStatsBody').innerHTML =
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">'
    +   '<div style="background:linear-gradient(135deg,#FFB300,#FF9100);color:#1a1a1a;padding:14px;border-radius:10px"><div style="font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:1px;opacity:.7">Catches · ' + days + 'd</div><div style="font-size:32px;font-weight:900;font-family:\'JetBrains Mono\',monospace;line-height:1;margin-top:4px">' + total + '</div><div style="font-size:11px;font-weight:700;margin-top:4px">≈ ' + perDay + ' / day</div></div>'
    +   '<div style="background:linear-gradient(135deg,#00C853,#1A5C1A);color:#fff;padding:14px;border-radius:10px"><div style="font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:1px;opacity:.8">Est. saved (' + days + 'd)</div><div style="font-size:32px;font-weight:900;font-family:\'JetBrains Mono\',monospace;line-height:1;margin-top:4px">$' + estSavings.toLocaleString() + '</div><div style="font-size:11px;font-weight:700;margin-top:4px;opacity:.85">$' + estMonthly.toLocaleString() + '/mo run-rate</div></div>'
    + '</div>'
    + '<div style="font-size:11px;color:#888;margin-bottom:8px">At $' + COST_PER_CATCH_USD + ' avg reship cost per wrong-pack (Zac\'s stated floor). Adjust higher to factor reputation/return-handling.</div>'
    + sparkline
    + '<div style="font-family:\'Barlow Condensed\',Arial,sans-serif;font-size:14px;font-weight:900;color:#1a1a1a;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">By kind</div>'
    + kindRow('Wrong box (different physical SKU)', 'wrong_box_likely', '#c33')
    + kindRow('Unknown box (SKU not in rulebook)', 'unknown_box', '#888')
    + kindRow('Inside-item alias pending approval', 'inside_item_alias_pending', '#FFB300');
}

// ── Mobile: scrollable date-grouped list (original Phase 1 view) ──
function paintScheduleMobileList_(payload, listEl) {
  const today = payload.today;
  const isPast = (iso) => iso < today;
  const isToday = (iso) => iso === today;

  listEl.innerHTML = payload.days.map(d => {
    const past = isPast(d.date);
    const todayFlag = isToday(d.date);
    const dimStyle = past ? 'opacity:.55' : '';
    const accent = todayFlag ? '#00e676' : (past ? '#666' : '#FFB300');
    const bgAccent = todayFlag ? 'rgba(0,230,118,.10)' : 'rgba(255,255,255,.03)';
    const todayChip = todayFlag ? '<span style="padding:2px 10px;background:#00e676;color:#000;border-radius:999px;font-size:10px;font-weight:900;letter-spacing:1.5px;text-transform:uppercase">Today</span>' : '';

    const top = _scheduleSortFreight_(d.orders.filter(o => o.source !== 'ground'));
    const bottom = d.orders.filter(o => o.source === 'ground');
    // v10.9 Kim: freight booked-rollup so the day shows remaining
    // booking work at a glance. Only freight (cabinet) needs booking.
    const freightOrders = d.orders.filter(o => o.source === 'cabinet');
    const freightBooked = freightOrders.filter(o => o.booked_at).length;
    const bookRollup = freightOrders.length
      ? '<span style="margin-left:8px;padding:1px 7px;border-radius:999px;font-size:10px;font-weight:900;letter-spacing:.5px;background:' + (freightBooked >= freightOrders.length ? 'rgba(0,200,83,.18);color:#00e676' : 'rgba(255,179,0,.18);color:#FFB300') + '" title="freight orders booked / total">' + freightBooked + '/' + freightOrders.length + ' booked</span>'
      : '';

    return '<div id="sched-day-' + d.date + '" style="padding:12px 14px;background:' + bgAccent + ';border:1px solid ' + accent + '55;border-radius:12px;' + dimStyle + '">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;flex-wrap:wrap">'
      +   '<div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">'
      +     '<div style="font-family:\'JetBrains Mono\',monospace;font-size:20px;font-weight:900;color:' + accent + '">' + esc(d.date.slice(5)) + '</div>'
      +     '<div style="font-family:\'Barlow Condensed\',Arial,sans-serif;font-size:18px;font-weight:800;color:var(--text);letter-spacing:1px;text-transform:uppercase">' + _scheduleDayName_(d.date) + '</div>'
      +     todayChip + bookRollup
      +   '</div>'
      +   '<div style="font-size:11px;color:var(--text-dim);font-weight:700;letter-spacing:.5px">'
      +     d.total + ' · ' + (d.freight_count ? d.freight_count + ' freight ' : '') + (d.mattress_count ? '· ' + d.mattress_count + ' mattress ' : '') + (d.ground_count ? '· ' + d.ground_count + ' ground' : '')
      +   '</div>'
      + '</div>'
      + (top.length ? '<div style="display:flex;flex-direction:column;gap:4px">' + top.map(o => _scheduleRenderOrderRow_(o, { compact: false })).join('') + '</div>' : '')
      + (bottom.length ? '<div style="margin-top:' + (top.length ? '8' : '0') + 'px;padding-top:' + (top.length ? '8' : '0') + 'px;' + (top.length ? 'border-top:1px dashed rgba(255,255,255,.10);' : '') + 'display:flex;flex-direction:column;gap:4px">' + '<div style="font-size:9px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:2px">Ground</div>' + bottom.map(o => _scheduleRenderOrderRow_(o, { compact: false })).join('') + '</div>' : '')
      + (top.length === 0 && bottom.length === 0 ? '<div style="padding:12px;text-align:center;color:var(--text-dim);font-size:12px">(no orders)</div>' : '')
      + '</div>';
  }).join('');

  // v10.166 — only auto-scroll to "today" on the FIRST paint per
  // session, not every refresh. Zac 2026-05-21 09:51 bug: "schedule
  // auto-scrolls to weird spot on every load — not clear or helpful".
  // Block:'nearest' so if today is already in viewport we don't jump.
  if (!window._scheduleScrolledOnce) {
    window._scheduleScrolledOnce = true;
    setTimeout(() => {
      const t = document.getElementById('sched-day-' + today);
      if (t && t.scrollIntoView) t.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
  }
}

// ── Desktop: one-week calendar grid (Mon-Fri by default, toggle to Sun-Sat) ──
function paintScheduleDesktopGrid_(payload, listEl) {
  const today = payload.today;
  const todayDate = new Date(today + 'T12:00:00');
  // Anchor on Monday of the active week. JS Date.getDay(): 0=Sun..6=Sat.
  // Monday offset = (day === 0 ? -6 : 1 - day)
  const dow = todayDate.getDay();
  const mondayOffset = (dow === 0 ? -6 : 1 - dow);
  const monday = new Date(todayDate);
  monday.setDate(monday.getDate() + mondayOffset + _scheduleWeekOffset * 7);

  const dayCount = _scheduleShowWeekends ? 7 : 5;
  const startOffset = _scheduleShowWeekends ? -1 : 0; // include Sun before Monday when weekends shown
  const weekDates = [];
  for (let i = 0; i < dayCount; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + startOffset + i);
    const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    weekDates.push(iso);
  }

  // Build index of payload days by date
  const daysByDate = {};
  (payload.days || []).forEach(d => { daysByDate[d.date] = d; });

  const weekStartIso = weekDates[0];
  const weekEndIso = weekDates[weekDates.length - 1];
  const weekRangeLabel = weekStartIso.slice(5) + ' – ' + weekEndIso.slice(5);
  const isCurrentWeek = _scheduleWeekOffset === 0;

  // v10.13 pass 5: week-overview jump strip. The current 1-week grid
  // hides the rest of the ~21-day horizon behind blind Prev/Next.
  // Bucket the (already filtered) payload by week-offset so users see
  // where the workload sits and jump straight to it. Pure client-side.
  const baseMonday = new Date(todayDate);
  baseMonday.setDate(baseMonday.getDate() + mondayOffset); // offset-0 Monday
  const baseMondayMs = baseMonday.getTime();
  function _weekOffsetForIso_(iso) {
    const dd = new Date(iso + 'T12:00:00');
    const wd = dd.getDay();
    const mo2 = (wd === 0 ? -6 : 1 - wd);
    const m = new Date(dd); m.setDate(m.getDate() + mo2);
    m.setHours(12, 0, 0, 0);
    return Math.round((m.getTime() - baseMondayMs) / (7 * 86400000));
  }
  const weekBuckets = {};
  (payload.days || []).forEach(d => {
    const off = _weekOffsetForIso_(d.date);
    weekBuckets[off] = (weekBuckets[off] || 0) + (d.total || 0);
  });
  weekBuckets[_scheduleWeekOffset] = weekBuckets[_scheduleWeekOffset] || 0; // active week always shown
  const weekOffsets = Object.keys(weekBuckets).map(Number).sort((a, b) => a - b);
  const weekJumpStrip = weekOffsets.map(off => {
    const wm = new Date(baseMonday); wm.setDate(wm.getDate() + off * 7);
    const we = new Date(wm); we.setDate(we.getDate() + 4); // Mon–Fri label
    const lbl = (wm.getMonth() + 1) + '/' + wm.getDate() + '–' + (we.getMonth() + 1) + '/' + we.getDate();
    const active = off === _scheduleWeekOffset;
    const n = weekBuckets[off];
    const tag = off === 0 ? 'This wk' : (off === 1 ? 'Next wk' : lbl);
    return '<button onclick="scheduleJumpToWeek(' + off + ')" style="display:inline-flex;align-items:center;gap:5px;padding:5px 11px;border-radius:999px;font-size:12px;font-weight:800;letter-spacing:.3px;cursor:pointer;white-space:nowrap;border:1px solid ' + (active ? '#00e676;background:#00e676;color:#0a0a0a' : 'rgba(255,255,255,.18);background:rgba(255,255,255,.04);color:var(--text-dim)') + '" title="' + lbl + '">'
      + esc(tag)
      + '<span style="font-size:10px;font-weight:900;padding:0 5px;border-radius:999px;background:' + (active ? 'rgba(0,0,0,.18)' : (n ? 'rgba(255,179,0,.20);color:#FFB300' : 'rgba(255,255,255,.06)')) + '">' + n + '</span>'
      + '</button>';
  }).join('');

  // Toolbar: week nav + show-weekends toggle
  const toolbar = '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:14px;padding:10px 14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.10);border-radius:10px">'
    + '<div style="display:flex;align-items:center;gap:8px">'
    +   '<button onclick="scheduleWeekShift(-1)" class="amp-btn" style="padding:6px 12px;font-size:13px">‹ Prev</button>'
    +   '<button onclick="scheduleWeekShift(0)" class="amp-btn ' + (isCurrentWeek ? 'go' : '') + '" style="padding:6px 12px;font-size:13px">This week</button>'
    +   '<button onclick="scheduleWeekShift(1)" class="amp-btn" style="padding:6px 12px;font-size:13px">Next ›</button>'
    +   '<div style="margin-left:12px;font-family:\'Barlow Condensed\',Arial,sans-serif;font-size:18px;font-weight:800;color:var(--text);letter-spacing:.5px">' + weekRangeLabel + '</div>'
    + '</div>'
    + '<label style="display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:700;color:var(--text-dim);cursor:pointer;text-transform:uppercase;letter-spacing:.5px">'
    +   '<input type="checkbox" onchange="scheduleToggleWeekends(this.checked)" ' + (_scheduleShowWeekends ? 'checked' : '') + ' style="cursor:pointer;width:16px;height:16px;accent-color:#00e676">'
    +   'Show weekends'
    + '</label>'
    + '</div>'
    + (weekOffsets.length > 1
        ? '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.08)">'
            + '<span style="font-size:10px;font-weight:800;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-right:2px">Jump</span>'
            + weekJumpStrip
          + '</div>'
        : '');

  // Day columns
  const cellWidthPct = 100 / dayCount;
  const cells = weekDates.map(iso => {
    const d = daysByDate[iso];
    const isToday = iso === today;
    const isPast = iso < today;
    const accent = isToday ? '#00e676' : (isPast ? '#666' : '#FFB300');
    const bgAccent = isToday ? 'rgba(0,230,118,.10)' : 'rgba(255,255,255,.03)';
    const dimStyle = isPast ? 'opacity:.65' : '';
    const dayLabel = _scheduleDayName_(iso);
    const total = d ? d.total : 0;
    const top = d ? _scheduleSortFreight_(d.orders.filter(o => o.source !== 'ground')) : [];
    const bottom = d ? d.orders.filter(o => o.source === 'ground') : [];
    const todayBadge = isToday ? '<span style="padding:1px 7px;background:#00e676;color:#000;border-radius:999px;font-size:9px;font-weight:900;letter-spacing:1px;text-transform:uppercase;margin-left:4px">Today</span>' : '';
    const isWeekend = dayLabel === 'Sat' || dayLabel === 'Sun';
    const weekendChip = isWeekend ? '<span style="font-size:9px;color:#ff9800;font-weight:700;letter-spacing:1px;margin-left:4px">WKND</span>' : '';
    // v10.9 Kim: per-day freight booked rollup in the grid header.
    const gFreight = d ? d.orders.filter(o => o.source === 'cabinet') : [];
    const gBooked = gFreight.filter(o => o.booked_at).length;
    const gRollup = gFreight.length
      ? '<span style="font-size:9px;font-weight:900;padding:0 5px;border-radius:999px;background:' + (gBooked >= gFreight.length ? 'rgba(0,200,83,.18);color:#00e676' : 'rgba(255,179,0,.18);color:#FFB300') + '" title="freight booked / total">' + gBooked + '/' + gFreight.length + '</span>'
      : '';

    return '<div style="flex:1 1 ' + cellWidthPct + '%;min-width:0;padding:10px;background:' + bgAccent + ';border:1px solid ' + accent + '44;border-radius:10px;' + dimStyle + ';display:flex;flex-direction:column;gap:6px;max-height:calc(100vh - 320px);overflow-y:auto">'
      + '<div style="border-bottom:1px solid rgba(255,255,255,.10);padding-bottom:6px;margin-bottom:4px">'
      +   '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:6px">'
      +     '<div><span style="font-family:\'JetBrains Mono\',monospace;font-size:15px;font-weight:900;color:' + accent + '">' + iso.slice(5) + '</span>'
      +     ' <span style="font-family:\'Barlow Condensed\',Arial,sans-serif;font-size:14px;font-weight:800;color:var(--text);letter-spacing:.8px;text-transform:uppercase">' + dayLabel + '</span>' + todayBadge + weekendChip + '</div>'
      +     '<span style="font-size:11px;font-weight:700;color:var(--text-dim);display:flex;align-items:center;gap:4px">' + gRollup + total + '</span>'
      +   '</div>'
      + '</div>'
      + (top.length ? top.map(o => _scheduleRenderOrderRow_(o, { compact: true })).join('') : '')
      + (bottom.length
          ? (top.length ? '<div style="font-size:8px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1.5px;margin-top:4px;padding-top:4px;border-top:1px dashed rgba(255,255,255,.10)">Ground</div>' : '<div style="font-size:8px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1.5px">Ground</div>')
              + bottom.map(o => _scheduleRenderOrderRow_(o, { compact: true })).join('')
          : '')
      + (total === 0 ? '<div style="padding:14px 8px;text-align:center;color:var(--text-dim);font-size:10px;font-style:italic;opacity:.6">no orders</div>' : '')
      + '</div>';
  }).join('');

  listEl.innerHTML = toolbar
    + '<div style="display:flex;gap:8px;align-items:stretch;flex-wrap:nowrap">' + cells + '</div>';
}

function scheduleWeekShift(delta) {
  if (delta === 0) _scheduleWeekOffset = 0;
  else _scheduleWeekOffset += delta;
  if (_scheduleCache) paintSchedule_(_scheduleCache);
}

function scheduleJumpToWeek(off) {
  _scheduleWeekOffset = off;
  if (_scheduleCache) paintSchedule_(_scheduleCache);
}

function scheduleToggleWeekends(show) {
  _scheduleShowWeekends = !!show;
  if (_scheduleCache) paintSchedule_(_scheduleCache);
}

// Re-paint on viewport size change (e.g., laptop rotated, window resized).
window.addEventListener('resize', () => {
  if (!_scheduleCache) return;
  const panel = document.getElementById('tab-schedule');
  if (!panel || !panel.classList.contains('active')) return;
  paintSchedule_(_scheduleCache);
});


// ──────────────────────────────────────────────────────────────────────
// LOOKUP TAB — CS-facing order search across all workflows
// ──────────────────────────────────────────────────────────────────────

function renderLookupTab() {
  setTimeout(() => {
    const inp = document.getElementById('lookupInput');
    if (inp) inp.focus();
  }, 80);
  // v9.98: render recent searches if no current query
  renderLookupRecent_();
}

const LOOKUP_RECENT_KEY = 'mbd_lookup_recent_v1';
const LOOKUP_RECENT_MAX = 8;

function _saveLookupRecent_(query, hitCount) {
  try {
    let recent = JSON.parse(localStorage.getItem(LOOKUP_RECENT_KEY) || '[]');
    if (!Array.isArray(recent)) recent = [];
    // Drop any prior entry with the same query (we'll re-add at top)
    recent = recent.filter(r => String(r.q || '').toLowerCase() !== String(query).toLowerCase());
    recent.unshift({ q: query, n: hitCount, at: new Date().toISOString() });
    if (recent.length > LOOKUP_RECENT_MAX) recent.length = LOOKUP_RECENT_MAX;
    localStorage.setItem(LOOKUP_RECENT_KEY, JSON.stringify(recent));
  } catch (e) {}
}

function renderLookupRecent_() {
  const resultsEl = document.getElementById('lookupResults');
  if (!resultsEl) return;
  // Only render when no current results showing
  if (resultsEl.querySelector('div')) return;
  let recent = [];
  try { recent = JSON.parse(localStorage.getItem(LOOKUP_RECENT_KEY) || '[]'); } catch (e) {}
  if (!Array.isArray(recent) || !recent.length) return;
  resultsEl.innerHTML =
    '<div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px;font-weight:700">Recent searches</div>'
    + '<div style="display:flex;flex-wrap:wrap;gap:6px">'
    + recent.map(r => {
        const t = new Date(r.at);
        const age = Math.round((Date.now() - t.getTime()) / 60000);
        const ageStr = age < 1 ? 'now' : age < 60 ? age + 'm' : Math.round(age / 60) + 'h';
        return '<button onclick="rerunLookup_(\'' + esc(r.q) + '\')" style="display:inline-flex;align-items:center;gap:6px;padding:6px 10px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.15);border-radius:999px;font-size:12px;color:var(--text);cursor:pointer;font-family:inherit"><span style="font-family:\'JetBrains Mono\',monospace;font-weight:700">' + esc(r.q) + '</span><span style="font-size:10px;color:var(--text-dim)">' + r.n + '·' + ageStr + '</span></button>';
      }).join('')
    + '</div>';
}

function rerunLookup_(q) {
  const inp = document.getElementById('lookupInput');
  if (inp) inp.value = q;
  runLookup();
}

function handleLookupKey(event) {
  if (event.key === 'Enter') {
    event.preventDefault();
    runLookup();
  }
}

async function runLookup() {
  const inp = document.getElementById('lookupInput');
  const statusEl = document.getElementById('lookupStatus');
  const resultsEl = document.getElementById('lookupResults');
  if (!inp) return;
  const q = String(inp.value || '').trim().replace(/^#/, '');
  if (!q) { statusEl.textContent = 'Enter an order number'; return; }
  statusEl.textContent = 'Searching…';
  resultsEl.innerHTML = '<div style="padding:48px 24px;text-align:center;color:#42a5f5;font-size:18px;font-weight:800"><div style="font-size:36px;margin-bottom:12px;animation:mbdSpin 1s linear infinite;display:inline-block">⟳</div></div>';
  try {
    const res = await groundApi('lookupOrder', { orderNumber: q });
    if (!res || !res.ok) {
      statusEl.textContent = 'Error: ' + ((res && res.error) || 'unknown');
      resultsEl.innerHTML = '';
      return;
    }
    if (!res.hits || res.hits.length === 0) {
      statusEl.textContent = 'No matches';
      const isName = !/^\d+$/.test(q);
      const tip = isName
        ? 'Names are matched as substrings (case-insensitive). Try part of the last name only, or try the order number.'
        : 'If this order was placed recently it may not be here yet — Ground orders take ~1–2 hrs to import and cabinet orders ingest after the pick-list email. So "not here" usually means "still processing," not "lost." Otherwise double-check the number or search by customer name.';
      resultsEl.innerHTML = '<div style="padding:32px 20px;text-align:center;background:rgba(255,165,0,.08);border:1px dashed rgba(255,165,0,.4);border-radius:10px;color:#FFB300;font-weight:700">No orders found matching <strong>' + esc(q) + '</strong>.<br><span style="font-weight:500;font-size:12px;color:var(--text-dim);margin-top:6px;display:inline-block">' + tip + '</span><br><span style="font-weight:500;font-size:11px;color:var(--text-dim);opacity:.7;margin-top:4px;display:inline-block">Searched: PackingQueue · OrderPack · MattressDropships · CabinetDamage · Calendar</span></div>';
      return;
    }
    // v10.118 (Zac SchedPanels): if the only hit is a calendar entry
    // (no PackingQueue/OrderPack/Mattress row yet), synthesize a
    // cabinet/freight panel from the calendar data so the user
    // always sees BOTH panels — calendar info + cabinet/freight
    // (in a pending-picklist state until the ingest lands).
    const hits = (res.hits || []).slice();
    const calHit = hits.find(h => h && h.source === 'calendar');
    const hasOrderPanel = hits.some(h => h && (h.source === 'cabinet' || h.source === 'ground' || h.source === 'mattress'));
    if (calHit && !hasOrderPanel) {
      hits.unshift({
        source: 'cabinet',
        tab: 'PackingQueue',
        order_number: calHit.order_number,
        customer_name: '',
        customer_address: '',
        customer_phone: '',
        ship_date: calHit.ship_date,
        carrier: calHit.carrier,
        status: 'awaiting_picklist',
        task_line: calHit.label || '',
        _synthFromCalendar: true,
      });
    }
    statusEl.textContent = hits.length + ' match' + (hits.length === 1 ? '' : 'es') + ' for #' + q;
    resultsEl.innerHTML = hits.map(h => renderLookupHit_(h)).join('');
    // P3: progressively upgrade timelines to the order_events spine
    // where it has data (fire-and-forget; falls back to scavenger).
    _lkUpgradeTimelines_(res.hits);
    // v9.98: save successful searches for the recent-searches strip
    _saveLookupRecent_(q, res.hits.length);
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message;
    resultsEl.innerHTML = '';
  }
}

function renderLookupHit_(hit) {
  let body;
  if (hit.source === 'cabinet')       body = renderLookupCabinet_(hit);
  else if (hit.source === 'ground')   body = renderLookupGround_(hit);
  else if (hit.source === 'mattress') body = renderLookupMattress_(hit);
  else if (hit.source === 'damage')   body = renderLookupDamage_(hit);
  else if (hit.source === 'calendar') body = renderLookupCalendar_(hit);
  else body = '<pre style="background:rgba(0,0,0,.3);padding:10px;border-radius:8px;font-size:11px;color:var(--text)">' + esc(JSON.stringify(hit, null, 2)) + '</pre>';
  return body + _lkEmailLink_(hit);
}

// One-tap "find the email thread for this order" — opens Gmail
// searching the order # + customer (+ email if known). Pragmatic
// first slice of "pull customer/order email into Bedrock for CS":
// instant context now, zero risk, no ingestion pipeline. Source-
// agnostic so every Lookup result gets it.
function _lkEmailLink_(h) {
  const on = String((h && h.order_number) || '').trim();
  const nm = String((h && h.customer_name) || '').trim();
  const em = String((h && h.customer_email) || '').trim();
  if (!on && !nm && !em) return '';
  const parts = [];
  if (on) parts.push('"' + on + '"');
  if (em) parts.push(em);
  else if (nm) parts.push('"' + nm + '"');
  const q = encodeURIComponent(parts.join(' OR '));
  const url = 'https://mail.google.com/mail/u/0/#search/' + q;
  return '<div style="margin:-4px 0 12px;display:flex;flex-wrap:wrap;gap:8px">'
    + '<a href="' + url + '" target="_blank" rel="noopener" style="text-decoration:none;display:inline-flex;align-items:center;gap:6px;min-height:40px;padding:8px 16px;background:rgba(66,165,245,.12);color:#42a5f5;border:1px solid rgba(66,165,245,.4);border-radius:8px;font-size:13px;font-weight:800">📧 Email thread for this order</a>'
    + '</div>';
}

// Calendar-sourced order (on the operational calendar but not yet
// in PackingQueue) — closes the tap-row→Lookup dead-end.
function renderLookupCalendar_(h) {
  const hpl = (lab, on) => '<span style="font-weight:900;color:' + (on ? '#00e676' : '#5a6472') + '">' + lab + '</span>';
  return '<div style="background:rgba(0,200,83,.06);border:1px solid rgba(0,230,118,.35);border-radius:12px;padding:16px 18px;margin-bottom:12px">'
    + '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">'
    +   '<span style="font-family:\'JetBrains Mono\',monospace;font-size:20px;font-weight:900;color:var(--text)">#' + esc(String(h.order_number || '')) + '</span>'
    +   '<span style="font-size:11px;font-weight:900;letter-spacing:.5px;background:rgba(0,200,83,.18);color:#00e676;border:1px solid rgba(0,230,118,.5);padding:2px 8px;border-radius:999px">✓ ON CALENDAR</span>'
    +   '<span style="font-size:12px;color:var(--text-dim)">' + esc(String(h.calendar_name || h.tab || '')) + '</span>'
    + '</div>'
    + '<div style="display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:13px;color:var(--text)">'
    +   '<span style="color:var(--text-dim)">Ship date</span><span style="font-weight:700">' + esc(String(h.ship_date || '—')) + '</span>'
    +   '<span style="color:var(--text-dim)">Carrier</span><span style="font-weight:700">' + esc(String(h.carrier || 'TBD')) + '</span>'
    +   '<span style="color:var(--text-dim)">Fulfillment</span><span style="font-weight:900;letter-spacing:1px">' + hpl('H', h.h) + ' ' + hpl('P', h.p) + ' ' + hpl('L', h.l) + ' <span style="font-weight:400;color:var(--text-dim);font-size:11px">(picklist · packed · labels)</span></span>'
    +   '<span style="color:var(--text-dim)">Calendar entry</span><span style="font-size:12px">' + esc(String(h.label || '')) + '</span>'
    + '</div>'
    + '<div style="margin-top:10px;font-size:11px;color:var(--text-dim);font-style:italic">Not yet in PackingQueue — full pack/scan detail appears once the pick-list email lands.</div>'
    + '</div>';
}

// v9.96: order activity timeline. Takes any Lookup hit and composes
// a chronological event list from its timestamps. Pure client-side
// — uses fields already in the lookupOrder response.
function _lkTimeline_(hit) {
  if (!hit) return '';
  const events = [];
  const push = (ts, label, icon, color) => {
    if (!ts) return;
    const d = new Date(ts);
    if (isNaN(d.getTime())) return;
    events.push({ ts: d, label: label, icon: icon || '·', color: color || 'var(--text-dim)' });
  };
  // Cabinet (PackingQueue) timestamps
  if (hit.source === 'cabinet') {
    push(hit.ingested_at, 'Ingested from pick-list email', '📥', '#42a5f5');
    push(hit.hardware_packed_at, 'Hardware pre-packed' + (hit.hardware_packed_by ? ' by ' + hit.hardware_packed_by : ''), '🔧', '#FFB300');
    push(hit.started_at, 'Pack started' + (hit.started_by ? ' by ' + hit.started_by : ''), '▶', '#FF9100');
    push(hit.checker_started_at, 'Checker started' + (hit.checker_started_by ? ' by ' + hit.checker_started_by : ''), '🔍', '#ab47bc');
    push(hit.packed_at, 'Packed' + (hit.packed_by ? ' by ' + hit.packed_by : ''), '✓', '#00C853');
    push(hit.booked_at, 'Freight booked' + (hit.booking_ref ? ' · ' + hit.booking_ref : '') + (hit.booker ? ' by ' + hit.booker : ''), '📦', '#FFB300');
    push(hit.shipped_at, 'Shipped', '🚚', '#1A5C1A');
    push(hit.customer_ready_at, 'Customer confirmed ready' + (hit.customer_ready_by ? ' by ' + hit.customer_ready_by : ''), '🔔', '#3DBEFF');
    push(hit.instructions_printed_at, 'Instructions printed', '🖨', '#42a5f5');
  }
  if (hit.source === 'ground') {
    push(hit.order_date, 'Order placed', '📥', '#42a5f5');
    push(hit.locked_at, 'Locked' + (hit.locked_by ? ' by ' + hit.locked_by : ''), '🔒', '#FF9100');
    push(hit.pack_started_at, 'Pack started', '▶', '#FF9100');
    push(hit.pack_completed_at, 'Pack complete', '✓', '#00C853');
  }
  if (hit.source === 'mattress') {
    push(hit.created_at, 'Order received', '📥', '#42a5f5');
    push(hit.send_at, 'MFRM notified', '📧', '#FFB300');
    push(hit.reply_received_at, 'MFRM replied' + (hit.ken_reply_classification ? ' (' + hit.ken_reply_classification + ')' : ''), '↩', '#9C27B0');
    push(hit.mf_delivery_date ? hit.mf_delivery_date + 'T12:00:00' : '', 'MF delivery date', '🚚', '#1A5C1A');
  }
  if (hit.source === 'damage' && hit.record) {
    push(hit.record.reported_at, 'Damage reported' + (hit.record.reported_by ? ' by ' + hit.record.reported_by : ''), '🚫', '#c33');
    push(hit.record.parts_due_date ? hit.record.parts_due_date + 'T12:00:00' : '', 'Parts due', '⏳', '#FFB300');
    push(hit.record.remake_received_at, 'Remake received', '↩', '#42a5f5');
    push(hit.record.closed_at, 'Damage closed', '✓', '#0a8a3f');
  }
  // P3: wrap in an addressable container so the post-render async
  // upgrade can swap in the order_events timeline. The scavenged
  // events below are the FALLBACK (today's behavior) shown until
  // (and unless) the spine returns events for this order — zero
  // regression: if the spine is empty/inactive the fallback stays.
  const _oid = String((hit && (hit.order_number || hit.order_id
    || (hit.record && hit.record.order_number))) || '').trim();
  const _wrap = (inner) => '<div class="lk-tl" data-oid="' + esc(_oid) + '">' + inner + '</div>';
  if (!events.length) return _oid ? _wrap('') : '';
  events.sort((a, b) => b.ts - a.ts);
  const fmt = (d) => {
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return mm + '/' + dd + ' ' + hh + ':' + mi;
  };
  return _wrap(
    '<div style="margin-top:12px;padding-top:10px;border-top:1px dashed rgba(255,255,255,.10)">'
    + '<div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px;font-weight:700">Activity</div>'
    + events.map(e =>
        '<div style="display:flex;align-items:baseline;gap:8px;padding:3px 0;font-size:12px;color:var(--text)">'
        + '<span style="font-size:14px;line-height:1">' + e.icon + '</span>'
        + '<span style="font-family:\'JetBrains Mono\',monospace;color:var(--text-dim);font-size:11px;min-width:84px">' + fmt(e.ts) + '</span>'
        + '<span style="color:' + e.color + ';flex:1">' + esc(e.label) + '</span>'
        + '</div>'
      ).join('')
    + '</div>');
}

// P3 — order_events presentation (one table; replaces the per-
// source push() ladder once the spine is the source).
const _LK_EVENT_PRES = {
  'order.imported':    { icon: '📥', color: '#42a5f5', label: 'Order imported' },
  'pack.started':      { icon: '▶',  color: '#FF9100', label: 'Pack started' },
  'pack.completed':    { icon: '✓',  color: '#00C853', label: 'Packed' },
  'checker.passed':    { icon: '🔍', color: '#ab47bc', label: 'Checker passed' },
  'label.created':     { icon: '🏷️', color: '#42a5f5', label: 'Label created' },
  'freight.booked':    { icon: '📦', color: '#FFB300', label: 'Freight booked' },
  'tracking.observed': { icon: '🚚', color: '#1A5C1A', label: 'Tracking observed' },
  'shipped':           { icon: '🚚', color: '#1A5C1A', label: 'Shipped' },
  'delivered':         { icon: '🏁', color: '#0a8a3f', label: 'Delivered' },
  'hold.set':          { icon: '⏸', color: '#c33',    label: 'Hold set' },
  'hold.cleared':      { icon: '▶',  color: '#00C853', label: 'Hold cleared' },
  'cs.note':           { icon: '📝', color: '#3DBEFF', label: 'CS note' },
};

function _lkRenderSpineEvents_(oid, events) {
  const fmt = (s) => {
    const d = new Date(s); if (isNaN(d.getTime())) return '';
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return mm + '/' + dd + ' ' + hh + ':' + mi;
  };
  const sorted = events.slice().sort((a, b) => new Date(b.ts) - new Date(a.ts));
  const row = (e) => {
    const p = _LK_EVENT_PRES[e.type] || { icon: '·', color: 'var(--text-dim)', label: e.type };
    const pl = e.payload || {};
    let extra = '';
    if (e.type === 'cs.note' && pl.note) extra = ' — ' + pl.note;
    else if (e.type === 'freight.booked') extra = (pl.carrier ? ' · ' + pl.carrier : '') + (pl.booking_ref ? ' #' + pl.booking_ref : '');
    else if (e.type === 'label.created') extra = (pl.carrier ? ' · ' + pl.carrier : '') + (pl.cost ? ' · $' + pl.cost : '');
    else if (e.type === 'tracking.observed' || e.type === 'shipped') extra = pl.tracking_number ? ' · ' + pl.tracking_number : '';
    const who = pl._actor ? ' (' + pl._actor + ')' : '';
    return '<div style="display:flex;align-items:baseline;gap:8px;padding:3px 0;font-size:12px;color:var(--text)">'
      + '<span style="font-size:14px;line-height:1">' + p.icon + '</span>'
      + '<span style="font-family:\'JetBrains Mono\',monospace;color:var(--text-dim);font-size:11px;min-width:84px">' + fmt(e.ts) + '</span>'
      + '<span style="color:' + p.color + ';flex:1">' + esc(p.label + extra + who) + '</span>'
      + '</div>';
  };
  return '<div style="margin-top:12px;padding-top:10px;border-top:1px dashed rgba(255,255,255,.10)">'
    + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">'
    +   '<span style="font-size:10px;color:#3DBEFF;text-transform:uppercase;letter-spacing:1.5px;font-weight:700">Activity · live spine</span>'
    +   '<button onclick="_lkAddCsNote_(\'' + esc(oid) + '\')" style="background:rgba(61,190,255,.12);color:#3DBEFF;border:1px solid rgba(61,190,255,.4);border-radius:6px;font-size:11px;font-weight:800;padding:4px 10px;min-height:34px;cursor:pointer">➕ Note</button>'
    + '</div>'
    + sorted.map(row).join('')
    + '</div>';
}

// Post-render progressive upgrade: swap the scavenged fallback for
// the order_events timeline where the spine has data. Fire-and-
// forget; any failure leaves the fallback intact (zero regression).
async function _lkUpgradeTimelines_(hits) {
  const seen = {};
  for (const h of (hits || [])) {
    const oid = String((h && (h.order_number || h.order_id
      || (h.record && h.record.order_number))) || '').trim();
    if (!oid || seen[oid]) continue;
    seen[oid] = true;
    try {
      const res = await groundApi('orderTimeline', { order_number: oid, order_id: oid });
      if (!res || !res.ok || !res.events || !res.events.length) continue;
      document.querySelectorAll('.lk-tl[data-oid="' + (window.CSS && CSS.escape ? CSS.escape(oid) : oid) + '"]')
        .forEach((el) => { el.innerHTML = _lkRenderSpineEvents_(oid, res.events); });
    } catch (e) { /* keep fallback */ }
  }
}

async function _lkAddCsNote_(oid) {
  const note = (prompt('Add a CS note to order ' + oid + ' (logged to the order timeline):') || '').trim();
  if (!note) return;
  try {
    const by = (localStorage.getItem('mbd_ground_packer') || '').trim();
    const res = await groundApi('addCsNote', { order_id: oid, note: note, by: by });
    if (!res || !res.ok) { showToast('Note not saved: ' + ((res && res.error) || 'unknown')); return; }
    showToast('✓ Note added');
    const r2 = await groundApi('orderTimeline', { order_number: oid, order_id: oid });
    if (r2 && r2.ok && r2.events) {
      document.querySelectorAll('.lk-tl[data-oid="' + (window.CSS && CSS.escape ? CSS.escape(oid) : oid) + '"]')
        .forEach((el) => { el.innerHTML = _lkRenderSpineEvents_(oid, r2.events); });
    }
  } catch (e) { showToast('Note error: ' + e.message); }
}

// v9.94: mirror of server-side _trackingUrlFor_ for client-side
// inference. Used by Lookup to turn tracking numbers into clickable
// carrier links. Falls back to Google search if shape unrecognized.
function _trackingUrlClient_(tracking, carrier) {
  if (!tracking) return '';
  const t = String(tracking).trim();
  const c = String(carrier || '').toLowerCase();
  if (c.indexOf('fedex') !== -1) return 'https://www.fedex.com/fedextrack/?trknbr=' + encodeURIComponent(t);
  if (c.indexOf('ups') !== -1) return 'https://www.ups.com/track?tracknum=' + encodeURIComponent(t);
  if (c.indexOf('usps') !== -1 || c.indexOf('stamps') !== -1) return 'https://tools.usps.com/go/TrackConfirmAction?qtc_tLabels1=' + encodeURIComponent(t);
  if (/^1Z[0-9A-Z]{16}$/i.test(t)) return 'https://www.ups.com/track?tracknum=' + encodeURIComponent(t);
  if (/^\d{12,22}$/.test(t)) return 'https://www.fedex.com/fedextrack/?trknbr=' + encodeURIComponent(t);
  return 'https://www.google.com/search?q=' + encodeURIComponent(t + ' tracking');
}

function _lkFld(label, value, opts) {
  if (value == null || value === '') return '';
  const mono = opts && opts.mono ? "font-family:'JetBrains Mono',monospace;" : '';
  const strVal = String(value);
  // v10.94 (CS persona): the #1 CS action on a Lookup hit is calling
  // the customer about "where's my order". Any Phone field becomes a
  // tap-to-call tel: link (live on the iPad/phone CS uses; an inert
  // styled span on desktop). Copy button is preserved below.
  const _telDigits = /phone/i.test(String(label)) ? strVal.replace(/[^\d+]/g, '') : '';
  // v10.206 Jessica CS-rep persona: address fields become tap-to-open
  // Maps links. Uses generic "?q=<encoded>" URL which iOS Safari and
  // Android Chrome both resolve to native Maps. CS rep typically asks
  // "let me look up where this is shipping to" mid-call; saves a
  // copy-paste-tab-switch.
  const _isAddress = /^address$/i.test(String(label));
  let link;
  if (opts && opts.link) {
    link = '<a href="' + esc(strVal) + '" target="_blank" style="color:#42a5f5;text-decoration:underline">open ↗</a>';
  } else if (_telDigits.replace(/\D/g, '').length >= 7) {
    link = '<a href="tel:' + esc(_telDigits) + '" style="color:#42a5f5;text-decoration:underline;font-weight:700" title="Tap to call">' + esc(strVal) + ' 📞</a>';
  } else if (_isAddress) {
    const mapsUrl = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(strVal);
    link = '<a href="' + esc(mapsUrl) + '" target="_blank" rel="noopener" style="color:#42a5f5;text-decoration:underline" title="Open in Maps">' + esc(strVal) + ' 🗺</a>';
  } else {
    link = esc(strVal);
  }
  // v9.84: copy-to-clipboard button on CS-relevant fields. Activated
  // via opts.copy=true OR auto-detected by label match for the
  // common cases (tracking, email, phone, address, order numbers).
  const wantCopy = (opts && opts.copy) || /tracking|email|phone|address|order #|customer|v1 order id|company/i.test(String(label));
  const copyBtn = wantCopy
    ? '<button onclick="_lkCopy_(this,\'' + esc(strVal.replace(/'/g, '\\\'')) + '\')" title="Copy" style="background:transparent;border:1px solid rgba(255,255,255,.15);color:var(--text-dim);font-size:10px;padding:1px 7px;border-radius:5px;cursor:pointer;margin-left:6px;font-weight:700">📋</button>'
    : '';
  return '<div style="display:flex;gap:10px;padding:5px 0;border-bottom:1px dashed rgba(255,255,255,.06)">'
    + '<div style="flex:0 0 130px;font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1.2px;font-weight:700;padding-top:1px">' + label + '</div>'
    + '<div style="flex:1;font-size:13px;color:var(--text);' + mono + 'word-break:break-word;display:flex;align-items:flex-start">' + '<span style="flex:1">' + link + '</span>' + copyBtn + '</div>'
    + '</div>';
}

async function _lkCopy_(btn, value) {
  try {
    await navigator.clipboard.writeText(value);
    const orig = btn.innerHTML;
    btn.innerHTML = '✓';
    btn.style.color = '#00e676';
    btn.style.borderColor = '#00e676';
    setTimeout(() => { btn.innerHTML = orig; btn.style.color = ''; btn.style.borderColor = ''; }, 1200);
  } catch (e) {
    showToast('Copy failed (browser blocked)');
  }
}

function _lkCard(title, accent, badge, body) {
  return '<div style="background:rgba(255,255,255,.04);border:1px solid ' + accent + '55;border-radius:12px;padding:14px 16px;border-left:4px solid ' + accent + '">'
    + '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;flex-wrap:wrap">'
    +   '<div style="font-family:\'Barlow Condensed\',Arial,sans-serif;font-size:18px;font-weight:900;color:' + accent + ';letter-spacing:1px;text-transform:uppercase">' + title + '</div>'
    +   (badge ? '<div style="padding:3px 10px;background:' + accent + '22;color:' + accent + ';border:1px solid ' + accent + '55;border-radius:999px;font-size:10px;font-weight:900;letter-spacing:1.2px;text-transform:uppercase">' + badge + '</div>' : '')
    + '</div>'
    + body
    + '</div>';
}

function renderLookupCabinet_(h) {
  // v10.118 (Zac SchedPanels): when this panel was synthesized
  // from a calendar-only hit (no PackingQueue row yet), most
  // fields are empty by design — show a small pending banner so
  // the user knows why instead of seeing a sparse card.
  const pendingBanner = h._synthFromCalendar
    ? '<div style="margin:-4px 0 10px;padding:8px 10px;background:rgba(255,179,0,.10);border:1px dashed rgba(255,179,0,.55);border-radius:8px;font-size:11px;color:#FFB300;-webkit-text-fill-color:#FFB300">Awaiting pick-list email — full pack/scan/HW detail appears once it lands. Cabinet/Freight context shown from the calendar.</div>'
    : '';
  const body = ''
    + pendingBanner
    + _lkFld('Order #', h.order_number, { mono: true })
    + _lkFld('Customer', h.customer_name)
    + _lkFld('Address', h.customer_address)
    + _lkFld('Phone', h.customer_phone)
    + _lkFld('Ship date', h.ship_date)
    + _lkFld('Carrier', h.carrier || 'TBD')
    + _lkFld('Status', h.status)
    + _lkFld('Task line', h.task_line)
    + _lkFld('HW packed', h.hardware_packed_at ? (h.hardware_packed_at.slice(0, 16) + ' by ' + (h.hardware_packed_by || '?')) : '—')
    + _lkFld('Packed', h.packed_at ? (h.packed_at.slice(0, 16) + ' by ' + (h.packed_by || '?')) : '—')
    + _lkFld('Shipped', h.shipped_at ? h.shipped_at.slice(0, 16) : '—')
    + _lkFld('Pick list', h.pick_list_pdf_url, { link: true })
    + _lkFld('Instructions', h.instructions_pdf_url, { link: true })
    + _lkFld('Shopify', h.shopify_admin_url, { link: true })
    + _lkFld('Last updated', h.last_updated_at ? h.last_updated_at.slice(0, 16) : '—')
    + _lkTimeline_(h)
    + _lookupRemakeBtn_(h)
    + (h.order_number ? '<button onclick="openFedexFreightModal(\'' + esc(h.order_number) + '\')" style="margin-top:10px;width:100%;padding:12px;background:linear-gradient(180deg,#4D148C,#2D0A52);color:#fff;border:1.5px solid #7C3AED;border-radius:8px;font-size:13px;font-weight:900;letter-spacing:.5px;text-transform:uppercase;cursor:pointer">📦 FedEx Freight: Quote → Book</button>' : '');
  return _lkCard('Cabinet / Freight', '#FFB300', h.status, body);
}

function _lookupRemakeBtn_(h) {
  const payload = encodeURIComponent(JSON.stringify({
    customer_name: h.customer_name || '',
    customer_phone: h.customer_phone || '',
    ship_address: h.customer_address || h.shipping_address || '',
    original_order_number: h.order_number || '',
  }));
  return '<div style="margin-top:10px;padding-top:10px;border-top:1px dashed rgba(255,255,255,.10);display:flex;gap:6px;flex-wrap:wrap">'
    + _lookupSendTrackingBtn_(h)
    + '<button onclick="openRemakeCreateFromLookup(\'' + payload + '\')" style="flex:1;min-width:160px;padding:10px;background:linear-gradient(135deg,#FF6B00,#B71C1C);color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:900;cursor:pointer;letter-spacing:.5px;text-transform:uppercase">🔧 Create Remake</button>'
    + '</div>';
}

// v10.0: send-tracking mailto: link. Pre-composes an email in the
// user's mail app with the customer's tracking info. CS reviews +
// sends from their own mailbox so the personal touch is preserved
// (and we don't write to JS2 status — just open the compose).
function _lookupSendTrackingBtn_(h) {
  const tn = String(h.master_tracking || h.tracking_number || '').trim();
  const email = String(h.customer_email || '').trim();
  // Only show when there's something tangible to send
  if (!email && !tn) return '';
  const tnUrl = tn ? _trackingUrlClient_(tn, '') : '';
  const subj = 'Your Murphy Bed Depot order #' + (h.order_number || '') + ' has shipped';
  const lines = [];
  lines.push('Hi ' + (h.customer_name || 'there') + ',');
  lines.push('');
  lines.push('Your order #' + (h.order_number || '') + ' has shipped!');
  if (tn) {
    lines.push('');
    lines.push('Tracking number: ' + tn);
    if (tnUrl) lines.push('Track here: ' + tnUrl);
  }
  lines.push('');
  lines.push('Please be prepared to inspect each part within the first 72 hours of arrival and let us know if anything looks off.');
  lines.push('');
  lines.push('Thanks for choosing Murphy Bed Depot!');
  lines.push('Murphy Bed Depot · (904) 823-9255');
  const mailto = 'mailto:' + encodeURIComponent(email) + '?subject=' + encodeURIComponent(subj) + '&body=' + encodeURIComponent(lines.join('\n'));
  return '<a href="' + esc(mailto) + '" style="flex:1;min-width:160px;padding:10px;background:linear-gradient(135deg,#003087,#001f5c);color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:900;cursor:pointer;letter-spacing:.5px;text-transform:uppercase;text-decoration:none;text-align:center;display:inline-block;line-height:1.2" title="Compose tracking email in your mail app">✉ Send Tracking</a>';
}

// Pre-fills the Remake create modal with customer info from the
// looked-up order. Saves CS a copy-paste step.
function openRemakeCreateFromLookup(encoded) {
  let prefill = {};
  try { prefill = JSON.parse(decodeURIComponent(encoded)); } catch (e) {}
  openRemakeCreate();
  setTimeout(() => {
    const f = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
    f('rmkCustName', prefill.customer_name);
    f('rmkCustPhone', prefill.customer_phone);
    f('rmkShipAddr', prefill.ship_address);
    f('rmkOrigOrder', prefill.original_order_number);
    // Focus the SKU input — that's the only thing CS still needs to fill in
    const skuInp = document.querySelector('.rmkSkuRow .rmkSkuSku');
    if (skuInp) skuInp.focus();
  }, 120);
}

function renderLookupGround_(h) {
  // v9.94: per-package tracking now renders as a carrier link.
  const pkgRows = (h.packages || []).map(p => {
    const tn = String(p.tracking_number || '').trim();
    const tnUrl = tn ? _trackingUrlClient_(tn, p.carrier || '') : '';
    const tnHtml = tn
      ? (tnUrl
          ? '<a href="' + esc(tnUrl) + '" target="_blank" onclick="event.stopPropagation()" style="font-family:\'JetBrains Mono\',monospace;color:#FFB300;font-size:11px;text-decoration:underline">' + esc(tn) + ' ↗</a>'
          : '<span style="font-family:\'JetBrains Mono\',monospace;color:#FFB300;font-size:11px">' + esc(tn) + '</span>')
      : '<span style="font-family:\'JetBrains Mono\',monospace;color:var(--text-dim);font-size:11px">—</span>';
    return '<div style="display:flex;gap:8px;padding:4px 0;font-size:12px">'
      + '<div style="flex:0 0 40px;color:var(--text-dim);font-weight:700">#' + (p.sequence || '?') + '</div>'
      + '<div style="flex:1;color:var(--text)">' + esc(p.box_sku || '') + (p.label_text ? ' <span style="color:var(--text-dim);font-size:10px">(' + esc(p.label_text) + ')</span>' : '') + '</div>'
      + tnHtml
      + '<div style="font-size:10px;color:var(--text-dim);text-transform:uppercase">' + esc(p.scan_status || '') + '</div>'
      + '</div>';
  }).join('');
  // Master tracking → carrier link, opens in new tab.
  const masterTr = String(h.master_tracking || '').trim();
  const masterTrUrl = masterTr ? _trackingUrlClient_(masterTr, '') : '';
  const masterTrFld = masterTr
    ? '<div style="display:flex;gap:10px;padding:5px 0;border-bottom:1px dashed rgba(255,255,255,.06)"><div style="flex:0 0 130px;font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1.2px;font-weight:700;padding-top:1px">Master tracking</div><div style="flex:1;font-size:13px;color:var(--text);font-family:\'JetBrains Mono\',monospace;word-break:break-word"><a href="' + esc(masterTrUrl) + '" target="_blank" style="color:#42a5f5;text-decoration:underline">' + esc(masterTr) + ' ↗</a><button onclick="_lkCopy_(this,\'' + esc(masterTr) + '\')" title="Copy" style="background:transparent;border:1px solid rgba(255,255,255,.15);color:var(--text-dim);font-size:10px;padding:1px 7px;border-radius:5px;cursor:pointer;margin-left:6px;font-weight:700">📋</button></div></div>'
    : '';
  const body = ''
    + _lkFld('Order #', h.order_number, { mono: true })
    + _lkFld('V1 order id', h.order_id, { mono: true })
    + _lkFld('Customer', h.customer_name)
    + _lkFld('Company', h.company)
    + _lkFld('State', h.state)
    + _lkFld('Tags', h.tags)
    + _lkFld('Priority?', h.has_priority_tag ? '⚡ YES' : '—')
    + _lkFld('Ship method', h.ship_method)
    + _lkFld('Pack status', h.pack_status)
    + _lkFld('Hold reason', h.hold_reason)
    + _lkFld('Locked by', h.locked_by ? (h.locked_by + (h.locked_at ? ' at ' + String(h.locked_at).slice(0, 16) : '')) : '—')
    + masterTrFld
    + _lkFld('Pack started', h.pack_started_at ? String(h.pack_started_at).slice(0, 16) : '—')
    + _lkFld('Pack complete', h.pack_completed_at ? String(h.pack_completed_at).slice(0, 16) : '—')
    + _lkFld('Last updated', h.last_updated_at ? String(h.last_updated_at).slice(0, 16) : '—')
    + (pkgRows ? '<div style="margin-top:10px;padding-top:8px;border-top:1px dashed rgba(255,255,255,.10)"><div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:4px;font-weight:700">Packages</div>' + pkgRows + '</div>' : '')
    // v10.177 — Reprint All Labels button. Use case: MGR-bypass orders
    // that shipped but labels never made it to PrintNode (Seth queen
    // slat 2 bug 2026-05-21). Only shows for orders with packages.
    + ((h.packages && h.packages.length) ? '<div style="margin-top:10px;padding-top:8px;border-top:1px dashed rgba(255,255,255,.10);display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button onclick="reprintAllLabelsFromLookup_(\'' + esc(h.order_number) + '\', this)" style="padding:8px 14px;background:linear-gradient(135deg,#003087,#005bb5);color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:900;cursor:pointer;letter-spacing:.5px;text-transform:uppercase;box-shadow:0 2px 6px rgba(0,0,0,.35)">🖨 Reprint All Labels</button><span style="font-size:10px;color:var(--text-dim)">Re-submits each label PDF to PrintNode. Safe to retry — no ShipStation calls.</span></div>' : '')
    + _lkTimeline_(h);
  return _lkCard('Ground', '#663399', h.pack_status, body);
}

// v10.177 — Reprint button click handler. Calls reprintAllLabelsForOrder
// endpoint then surfaces per-box results in an alert (success count +
// any failures). Uses the global loader so user knows something's
// happening (per the existing R3 retry pattern).
async function reprintAllLabelsFromLookup_(orderNumber, btn) {
  if (!orderNumber) return;
  const ok = confirm('Reprint all labels for order #' + orderNumber + '?\n\nThis re-submits each label PDF to PrintNode. No ShipStation calls, no charges.');
  if (!ok) return;
  if (btn) { btn.disabled = true; btn.textContent = '⟳ Reprinting…'; }
  const loader = (typeof showGlobalLoader === 'function') ? showGlobalLoader('Reprinting labels…') : null;
  try {
    const res = await groundApi('reprintAllLabelsForOrder', { orderNumber: orderNumber });
    if (loader && loader.stop) loader.stop();
    if (btn) btn.disabled = false;
    // v10.202 — Seth persona: when reprint returns ok=false but has
    // per-box failure detail (e.g. all boxes have "No Drive PDF" because
    // MGR-bypass skipped the Drive upload step), surface that detail
    // instead of "unknown error". Also detect the MGR-bypass pattern +
    // suggest ShipStation as the manual workaround.
    if (!res || !res.ok) {
      let msg = (res && res.error) || 'unknown error';
      if (res && res.results && res.results.length) {
        const failures = res.results.filter(r => !r.ok);
        const noPdfCount = failures.filter(r => /no drive pdf|missing.*pdf/i.test(String(r.error || ''))).length;
        if (noPdfCount === failures.length && failures.length > 0) {
          // ALL boxes failed with No Drive PDF — classic MGR-bypass
          alert('⚠ No stored label PDFs for order #' + orderNumber + '.\n\n'
            + 'This usually means the order was shipped via MGR-bypass before label-PDF capture was wired up. Reprint can\'t recover labels that were never saved to Drive.\n\n'
            + 'Workaround: open ShipStation directly + reprint from there.\n\n'
            + 'Box failures (' + failures.length + '):\n'
            + failures.map(r => '  Box ' + r.sequence + ': ' + (r.error || 'No Drive PDF')).join('\n'));
          showToast('⚠ No stored label PDFs (MGR-bypass) — use ShipStation');
        } else {
          // Mixed or other failures — show detailed list
          const lines = ['⚠ Reprint failed for #' + orderNumber, '', 'Box failures:'];
          failures.forEach(r => lines.push('  Box ' + r.sequence + ': ' + (r.error || 'unknown')));
          alert(lines.join('\n'));
          showToast('⚠ Reprint failed: ' + failures.length + ' box(es)');
        }
      } else {
        showToast('⚠ Reprint failed: ' + msg);
      }
      if (btn) btn.textContent = '🖨 Reprint All Labels';
      return;
    }
    const lines = [
      '✓ Reprint complete for #' + orderNumber,
      '',
      'Printed: ' + res.printed_count + '/' + res.total_packages,
    ];
    if (res.failed_count > 0) {
      lines.push('');
      lines.push('Failures:');
      (res.results || []).filter(r => !r.ok).forEach(r => {
        lines.push('  Box ' + r.sequence + ': ' + (r.error || 'unknown'));
      });
    }
    alert(lines.join('\n'));
    showToast(res.failed_count === 0 ? ('✓ All ' + res.printed_count + ' labels sent to printer') : ('⚠ ' + res.failed_count + ' label(s) failed'));
    if (btn) btn.textContent = '🖨 Reprint All Labels';
  } catch (e) {
    if (loader && loader.stop) loader.stop();
    if (btn) { btn.disabled = false; btn.textContent = '🖨 Reprint All Labels'; }
    showToast('⚠ Reprint failed: ' + (e.message || String(e)));
  }
}

function renderLookupMattress_(h) {
  const body = ''
    + _lkFld('Order #', h.order_number, { mono: true })
    + _lkFld('Mattress SKU', h.mattress_sku, { mono: true })
    + _lkFld('Customer', h.customer_name)
    + _lkFld('Address', h.customer_address)
    + _lkFld('Phone', h.customer_phone)
    + _lkFld('MF status', h.send_status)
    + _lkFld('Reply', h.ken_reply_classification)
    + _lkFld('Ship method', h.ship_method)
    + _lkFld('Delivery date', h.mf_delivery_date)
    + _lkFld('Tracking', h.tracking_number, { mono: true })
    + _lkFld('MF order #', h.mf_order_number, { mono: true })
    + _lkFld('MBD shipped?', h.mbd_marked_shipped ? '✓ YES' : '—')
    + _lkFld('Errors', h.error_count ? (h.error_count + ' · ' + (h.last_error || '')) : '—')
    + _lkFld('Last updated', h.last_updated_at ? String(h.last_updated_at).slice(0, 16) : '—')
    + _lkTimeline_(h);
  return _lkCard('Mattress Dropship', '#00C853', h.send_status, body);
}

function renderLookupDamage_(h) {
  const rec = h.record || {};
  const body = Object.keys(rec).map(k => _lkFld(k.replace(/_/g, ' '), rec[k])).join('')
    + _lkTimeline_(h);
  return _lkCard('Damage record', '#ff5252', rec.status, body);
}
