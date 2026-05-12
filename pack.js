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
}

async function refreshPackQueue() {
  const statusEl = document.getElementById('packQueueStatus');
  statusEl.textContent = 'Loading…';
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
      statusEl.textContent = 'Error: ' + ((inflight && inflight.error) || 'unknown');
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
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message;
  }
}

function paintPackQueue_(rows, fromCache) {
  const list = document.getElementById('packQueueList');
  list.innerHTML = '';
  if (!rows.length) {
    list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-dim);background:rgba(255,255,255,.03);border:1px dashed rgba(255,255,255,.15);border-radius:10px">Today\'s pack list is empty.<br><span style="font-size:12px">Tap <strong>+ Add to List</strong> above to load today\'s orders by ship date.</span></div>';
    return;
  }
  rows.forEach(r => {
    list.appendChild(renderPackCard_(r));
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
  card.style.cssText = 'background:'+bg+';border:1px solid '+border+';border-radius:12px;padding:18px 18px;display:flex;align-items:center;gap:16px;transition:transform .1s ease';

  const shipDate = r.ship_date || '—';
  const taskLine = r.task_line || (r.order_number + ' (no task line)');
  const skuCount = packCountSkus_(r.sku_lines_json);
  const inStock = /INSTOCK/i.test(r.sku_lines_json || '');
  const hwReady = !!r.hardware_packed_at;
  const hwChip = hwReady
    ? '<span style="color:#00e676;font-weight:700" title="HW box prepped by '+esc(String(r.hardware_packed_by||''))+'">· 🔧 HW READY</span>'
    : '<span style="color:#ff9800;font-weight:700" title="Hardware pre-pack pending — see Pre-Pack tab">· 🔧 HW PENDING</span>';

  // Status chip line text
  let stateLine = '';
  if (status === 'in_progress') stateLine = packerMine ? 'YOU\'RE PACKING' : 'PACKING — ' + (r.started_by || 'other');
  else if (status === 'ready_for_check') stateLine = 'READY FOR CHECKER';
  else if (status === 'checking') stateLine = checkerMine ? 'YOU\'RE CHECKING' : 'CHECKING — ' + (r.checker_started_by || 'other');
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
    <div style="flex:0 0 96px;text-align:center;border-right:1px solid rgba(255,255,255,.10);padding-right:16px;cursor:pointer" onclick="openPackDetail('${esc(r.order_number)}')">
      <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;color:var(--text-dim);text-transform:uppercase">Ship</div>
      <div style="font-family:'JetBrains Mono',monospace;font-size:26px;font-weight:900;color:var(--green-bright);margin-top:4px;line-height:1.05">${esc(shipDate.slice(5))}</div>
      <div style="font-size:12px;color:var(--text-dim);margin-top:3px">${esc(shipDate.slice(0,4))}</div>
    </div>
    <div style="flex:1;min-width:0;cursor:pointer" onclick="openPackDetail('${esc(r.order_number)}')">
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
  if (!confirm('Release the check on order ' + orderNumber + '? Status goes back to "ready for check".')) return;
  try {
    // No dedicated server endpoint yet; revert by clearing checker fields
    // via resetPackCheckScans and then status flip. For MVP, just leave the
    // status at 'checking' and clear scans — the user can resume or another
    // device can take over by setting status manually if needed.
    const res = await groundApi('resetPackCheckScans', { orderNumber: orderNumber, deviceId: getPackDeviceId_() });
    if (!res || !res.ok) {
      showToast('Release failed: ' + ((res && res.error) || 'unknown'));
      return;
    }
    showToast('Check scans cleared — close the order to release');
    await refreshPackQueue();
    openPackDetail(orderNumber);
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
    // (If extraction failed, the stamping path still works against
    // pick_list_pdf_url as a fallback.)
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
    statusEl.textContent = pending + ' to pre-pack' + (done ? (' · ' + done + ' done in last 48h') : '')
      + ' · today=' + res.today + ' · tomorrow=' + res.tomorrow;
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message;
  }
}

function paintPrePackQueue_(rows, fromCache) {
  const list = document.getElementById('prePackQueueList');
  list.innerHTML = '';
  if (!rows.length) {
    list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-dim);background:rgba(255,255,255,.03);border:1px dashed rgba(255,255,255,.15);border-radius:10px">No hardware to pre-pack in this horizon.<br><span style="font-size:12px">Switch to <strong>All</strong> or <strong>Tomorrow</strong> to see upcoming jobs.</span></div>';
    return;
  }
  rows.forEach(r => { list.appendChild(renderPrePackCard_(r)); });
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
    return `<div style="display:flex;align-items:center;gap:12px;padding:14px;background:${accent}14;border:1.5px solid ${accent}55;border-radius:10px">
      <div style="flex:0 0 56px;text-align:center">
        <div style="font-family:'JetBrains Mono',monospace;font-size:22px;font-weight:900;color:${accent}">${scanned}/${qty}</div>
        <div style="font-size:10px;color:var(--text-dim);letter-spacing:1px;margin-top:2px">${done?'DONE':'PEND'}</div>
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-family:'Barlow Condensed',Arial,sans-serif;font-size:18px;font-weight:900;color:var(--text)">${esc(sku)}</div>
        ${l.name ? '<div style="font-size:12px;color:var(--text-dim);margin-top:2px">'+esc(l.name)+'</div>' : ''}
      </div>
      <div style="display:flex;gap:6px">
        <button onclick="bumpPrePackSku('${esc(row.order_number)}','${esc(sku)}',-1)" class="amp-btn" style="padding:6px 10px;font-size:13px">−</button>
        <button onclick="bumpPrePackSku('${esc(row.order_number)}','${esc(sku)}',1)" class="amp-btn" style="padding:6px 10px;font-size:13px">+</button>
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
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button onclick="confirmMarkHardwareReady('${esc(row.order_number)}')" ${markReadyDisabled?'disabled':''} class="amp-btn ${allScanned&&!hwReady?'go':''}" style="flex:1;min-width:200px;padding:14px;font-size:15px;font-weight:900;background:${markReadyColor};color:#000;opacity:${markReadyDisabled?'.55':'1'}">${markReadyLabel}</button>
      ${hwReady ? '<button onclick="printPrePackLabel(\''+esc(row.order_number)+'\')" class="amp-btn" style="padding:14px;font-size:14px">🖨 Reprint Label</button>' : ''}
      <button onclick="confirmResetHardwareScans('${esc(row.order_number)}')" class="amp-btn" style="padding:14px;font-size:14px">↺ Reset Scans</button>
    </div>
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
    showPrePackBanner_('Scan error: ' + err.message, '#ff5252');
  }
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
    printPrePackLabel(orderNumber);
    await refreshPrePackQueue();
    setTimeout(() => closePrePackDetail(), 800);
  } catch (err) {
    showPrePackBanner_('Mark error: ' + err.message, '#ff5252');
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
function printPrePackLabel(orderNumber) {
  const row = _prePackQueueCache.find(r => String(r.order_number) === String(orderNumber));
  if (!row) { showToast('Order not in current queue — refresh'); return; }
  const win = window.open('', '_blank');
  if (!win) { showToast('Allow popups to print label'); return; }
  const customer = String(row.customer_name || '').trim();
  const shipDate = String(row.ship_date || '').trim();
  const taskLine = String(row.task_line || '').trim();
  const tag = 'HWBOX-' + orderNumber;
  const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=0&data=' + encodeURIComponent(tag);
  win.document.write([
    '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Hardware Box Label — ' + orderNumber + '</title>',
    '<style>',
    'body{margin:0;padding:0.5in;font-family:Helvetica,Arial,sans-serif;background:#fff;color:#000}',
    '.box{border:4px solid #000;border-radius:12px;padding:28px;text-align:center}',
    '.headline{font-size:64px;font-weight:900;letter-spacing:2px;line-height:1.0;margin-bottom:8px;font-family:"Arial Black",Helvetica,sans-serif}',
    '.headline .em{color:#c00}',
    '.sub{font-size:22px;font-weight:700;margin-bottom:18px;color:#222}',
    '.body{font-size:18px;line-height:1.4;margin:16px 0;color:#222;text-align:left;display:inline-block;max-width:5.5in}',
    '.body strong{font-weight:900}',
    '.info{font-size:22px;font-weight:800;letter-spacing:.5px;margin-top:14px;padding-top:14px;border-top:2px solid #000}',
    '.info .label{font-size:11px;font-weight:700;letter-spacing:2px;color:#666;text-transform:uppercase;margin-bottom:2px}',
    '.info-row{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;margin-top:10px}',
    '.info-row > div{flex:1}',
    '.qr{margin-top:12px;display:flex;align-items:center;justify-content:center;gap:12px}',
    '.qr img{width:1.4in;height:1.4in}',
    '.qr .tag{font-family:"JetBrains Mono",Menlo,monospace;font-size:14px;font-weight:700;letter-spacing:1px}',
    '@media print{@page{size:letter;margin:0.3in}}',
    '</style></head><body><div class="box">',
    '<div class="headline"><span class="em">OPEN ME</span><br>FIRST!</div>',
    '<div class="sub">Hardware &amp; Assembly Instructions Inside</div>',
    '<div class="body">Hi! Please open <strong>this box first</strong> when your shipment arrives. Inside you\'ll find the <strong>hardware</strong> and <strong>assembly instructions</strong> you\'ll need to set up your Murphy bed cabinet.</div>',
    '<div class="info">',
    '<div class="info-row">',
    '  <div><div class="label">Order</div>#' + esc(orderNumber) + '</div>',
    '  <div><div class="label">Customer</div>' + esc(customer || '—') + '</div>',
    '  <div><div class="label">Ship Date</div>' + esc(shipDate || '—') + '</div>',
    '</div>',
    '</div>',
    '<div class="qr"><img src="' + qrUrl + '" alt="' + tag + '"><div><div class="tag">' + esc(tag) + '</div><div style="font-size:11px;color:#666;margin-top:4px">Internal scan code</div></div></div>',
    '</div>',
    '<script>window.addEventListener("load",()=>{setTimeout(()=>window.print(),400);});<\\/script>',
    '</body></html>',
  ].join('\n'));
  win.document.close();
}
