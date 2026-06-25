// ── Config check ─────────────────────────────────────────────────────────
(function () {
  const saved = localStorage.getItem('SCRIPT_URL');
  const configured = (typeof SCRIPT_URL !== 'undefined' && SCRIPT_URL && !SCRIPT_URL.includes('YOUR_APPS')) || saved;
  if (!configured) {
    document.getElementById('setup-screen').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
  } else {
    if (saved) window._scriptUrl = saved;
    document.getElementById('setup-screen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    // show dashboard tab by default
    document.querySelectorAll('.tab-view').forEach(el => el.style.display = 'none');
    const dash = document.getElementById('tab-dashboard');
    if (dash) dash.style.display = 'block';
  }
})();

function getScriptUrl() {
  return localStorage.getItem('SCRIPT_URL') ||
    (typeof SCRIPT_URL !== 'undefined' && !SCRIPT_URL.includes('YOUR_APPS') ? SCRIPT_URL : null);
}

function connectScript() {
  const url = document.getElementById('setup-url').value.trim();
  if (!url || !url.includes('script.google.com')) {
    toast('Please enter a valid Apps Script URL', 'error'); return;
  }
  localStorage.setItem('SCRIPT_URL', url);
  document.getElementById('setup-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  showTab('dashboard');
}

// ── State ─────────────────────────────────────────────────────────────────
let selected = new Set();
let filterTimer = null;
let uploadedFileId = null, uploadedFileUrl = null, uploadedFileName = null;
let allVendors = [], allExpenseHeads = [];
let currentCellMap = { vendor_name:'B2',invoice_no:'B3',invoice_date:'B4',due_date:'B5',amount:'B6',expense_head:'B7',po_number:'B8',gstin:'B9' };

// ── Init ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('app').style.display !== 'none') {
    init();
  }
});

function init() {
  loadMetrics();
  loadInvoices();
  setInterval(() => { if (document.getElementById('tab-dashboard').classList.contains('active')) loadInvoices(true); }, 60000);
}

// ── Tab navigation ────────────────────────────────────────────────────────
function showTab(tab) {
  document.querySelectorAll('.tab-view').forEach(el => { el.classList.remove('active'); el.style.display = 'none'; });
  document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
  const view = document.getElementById('tab-' + tab);
  if (view) { view.classList.add('active'); view.style.display = 'block'; }
  const link = document.querySelector('[data-tab="' + tab + '"]');
  if (link) link.classList.add('active');

  if (tab === 'dashboard') { loadMetrics(); loadInvoices(); }
  if (tab === 'tracking')  loadTracking();
  if (tab === 'settings')  loadSettings();
  if (tab === 'upload')    loadExpenseHeadsDropdowns();
}

// ── API calls ─────────────────────────────────────────────────────────────
async function get(params) {
  const url = getScriptUrl();
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(url + '?' + qs);
  return res.json();
}

async function post(params) {
  const url = getScriptUrl();
  const res = await fetch(url, {
    method: 'POST',
    body: JSON.stringify(params),
    headers: { 'Content-Type': 'text/plain' }, // avoids CORS preflight
  });
  return res.json();
}

// ── Metrics ───────────────────────────────────────────────────────────────
async function loadMetrics() {
  const data = await get({ action: 'getMetrics' }).catch(() => null);
  if (!data?.success) return;
  const m = data.metrics;
  const fmt = n => n >= 100000 ? '₹' + (n / 100000).toFixed(1) + 'L' : n >= 1000 ? '₹' + (n / 1000).toFixed(1) + 'K' : '₹' + n;

  document.getElementById('metrics-grid').innerHTML = `
    <div class="metric"><div class="metric-label">Total Invoices</div><div class="metric-value">${m.total}</div><div class="metric-sub">All time</div></div>
    <div class="metric"><div class="metric-label">Pending Validation</div><div class="metric-value" style="color:var(--warning)">${m.pending}</div><div class="metric-sub">Awaiting review</div></div>
    <div class="metric"><div class="metric-label">Validated</div><div class="metric-value" style="color:var(--success)">${m.validated}</div><div class="metric-sub">Ready for payment</div></div>
    <div class="metric"><div class="metric-label">In Payment Flow</div><div class="metric-value" style="color:var(--primary)">${m.payment}</div><div class="metric-sub">Sent for approval</div></div>
    <div class="metric"><div class="metric-label">Delayed</div><div class="metric-value" style="color:var(--danger)">${m.delayed}</div><div class="metric-sub">Past SLA</div></div>
    <div class="metric"><div class="metric-label">UTR Received</div><div class="metric-value" style="color:var(--success)">${m.utr}</div><div class="metric-sub">Paid</div></div>
    <div class="metric"><div class="metric-label">Total Amount</div><div class="metric-value" style="font-size:18px">${fmt(m.totalAmt)}</div><div class="metric-sub">All invoices</div></div>
  `;

  allVendors = data.vendors || [];
  const vs = document.getElementById('f-vendor');
  const curV = vs.value;
  vs.innerHTML = '<option value="">All vendors</option>' + allVendors.map(v => `<option ${v === curV ? 'selected' : ''}>${esc(v)}</option>`).join('');

  const ms = document.getElementById('f-month');
  const curM = ms.value;
  ms.innerHTML = '<option value="">All months</option>' + (data.months || []).map(m => `<option ${m === curM ? 'selected' : ''}>${esc(m)}</option>`).join('');
}

// ── Invoice table ─────────────────────────────────────────────────────────
async function loadInvoices() {
  const params = { action: 'getInvoices' };
  const search = document.getElementById('f-search')?.value.trim();
  const vendor = document.getElementById('f-vendor')?.value;
  const month  = document.getElementById('f-month')?.value;
  const status = document.getElementById('f-status')?.value;
  if (search) params.search = search;
  if (vendor) params.vendor = vendor;
  if (month)  params.month  = month;
  if (status) params.status = status;

  const data = await get(params).catch(() => null);
  if (!data?.success) { document.getElementById('invoice-body').innerHTML = '<tr><td colspan="11" class="empty-state">Could not load invoices</td></tr>'; return; }

  const body = document.getElementById('invoice-body');
  if (!data.invoices.length) { body.innerHTML = '<tr><td colspan="11" class="empty-state">No invoices found</td></tr>'; updateActionBar(); return; }

  body.innerHTML = data.invoices.map(inv => {
    const isDelayed = String(inv.pay_status).includes('delayed');
    const isSel = selected.has(String(inv.id));
    const canSel = inv.status === 'validated';
    return `<tr class="${isSel ? 'row-selected' : ''} ${isDelayed ? 'row-delayed' : ''}" id="row-${inv.id}">
      <td><input type="checkbox" ${canSel ? '' : 'disabled'} ${isSel ? 'checked' : ''} onchange="toggleSelect('${inv.id}',this.checked)"></td>
      <td><span class="inv-link" onclick="showInvoiceDetail('${inv.id}')">${esc(inv.invoice_no)}</span></td>
      <td>${esc(inv.vendor_name)}</td>
      <td style="color:var(--text-secondary)">${esc(inv.expense_head || '—')}</td>
      <td style="font-weight:600">${esc(inv.amount || '—')}</td>
      <td style="color:var(--text-secondary)">${esc(inv.invoice_date || '—')}</td>
      <td style="color:${isDueSoon(inv.due_date) ? 'var(--danger)' : 'var(--text-secondary)'}">${esc(inv.due_date || '—')}</td>
      <td>${validBadge(inv)}</td>
      <td>${payBadge(inv)}</td>
      <td>${inv.utr ? `<span class="utr-pill">✓ ${esc(inv.utr)}</span>` : '<span style="color:var(--text-tertiary)">—</span>'}</td>
      <td><div style="display:flex;gap:4px;flex-wrap:wrap">
        ${inv.status === 'pending' ? `<button class="btn btn-sm" onclick="showInvoiceDetail('${inv.id}')">Verify</button>` : ''}
        ${inv.status === 'validated' ? `<button class="btn btn-sm btn-success" onclick="showInvoiceDetail('${inv.id}')">✓ View</button>` : ''}
        ${inv.status === 'payment' ? `<button class="btn btn-sm" onclick="showTrackingModal('${inv.id}')">Track</button>` : ''}
        ${inv.status === 'utr' ? `<button class="btn btn-sm" onclick="showInvoiceDetail('${inv.id}')">View</button>` : ''}
        ${inv.file_url ? `<a href="${inv.file_url}" target="_blank" class="btn btn-sm">📄</a>` : ''}
      </div></td>
    </tr>`;
  }).join('');
  updateActionBar();
}

function isDueSoon(d) { if (!d) return false; const diff = (new Date(d) - Date.now()) / 86400000; return diff >= 0 && diff <= 3; }

function validBadge(inv) {
  return inv.status === 'pending'
    ? '<span class="badge badge-pending">Pending</span>'
    : '<span class="badge badge-validated">Validated</span>';
}

function payBadge(inv) {
  if (!inv.pay_status) return '<span style="color:var(--text-tertiary)">—</span>';
  const ps = String(inv.pay_status);
  const delayed = ps.includes('_delayed');
  const base = ps.replace('_delayed', '');
  const map = { approval1:'Pending L1',approval2:'Pending L2',approval3:'Pending Finance',finance:'Pending Finance',utr:'UTR Received',query1:'Query L1',query2:'Query L2',query_finance:'Query Finance',rejected:'Rejected' };
  const cls = { approval1:'badge-approval1',approval2:'badge-approval2',approval3:'badge-approval3',finance:'badge-finance',utr:'badge-utr',query1:'badge-query',query2:'badge-query',query_finance:'badge-query',rejected:'badge-rejected' };
  if (delayed) return `<span class="badge badge-delayed">⚠ ${map[base] || base}</span>`;
  return `<span class="badge ${cls[base] || 'badge-finance'}">${map[base] || base}</span>`;
}

function debounceFilter() { clearTimeout(filterTimer); filterTimer = setTimeout(loadInvoices, 350); }
function clearFilters() { ['f-search','f-vendor','f-month','f-status'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; }); loadInvoices(); }

// ── Selection ─────────────────────────────────────────────────────────────
function toggleSelect(id, checked) {
  if (checked) selected.add(String(id)); else selected.delete(String(id));
  const row = document.getElementById('row-' + id);
  if (row) row.classList.toggle('row-selected', checked);
  updateActionBar();
}

function toggleAll(chk) {
  document.querySelectorAll('#invoice-body input[type=checkbox]:not(:disabled)').forEach(cb => {
    const row = cb.closest('tr');
    const id = row.id.replace('row-', '');
    if (chk.checked) { selected.add(id); cb.checked = true; row.classList.add('row-selected'); }
    else { selected.delete(id); cb.checked = false; row.classList.remove('row-selected'); }
  });
  updateActionBar();
}

function clearSelection() { selected.clear(); loadInvoices(); document.getElementById('chk-all').checked = false; updateActionBar(); }

function updateActionBar() {
  const n = selected.size;
  document.getElementById('action-bar').style.display = n > 0 ? 'flex' : 'none';
  if (n > 0) document.getElementById('sel-label').textContent = n + ' invoice(s) selected';
}

// ── Invoice detail modal ──────────────────────────────────────────────────
async function showInvoiceDetail(id) {
  const data = await get({ action: 'getTrackingDetail', id }).catch(() => null);
  if (!data?.success) { toast('Could not load invoice', 'error'); return; }
  const inv = data.invoice;

  openModal('Invoice — ' + esc(inv.invoice_no), `
    <div class="detail-row"><span class="detail-label">Vendor</span><span class="detail-value">${esc(inv.vendor_name)}</span></div>
    <div class="detail-row"><span class="detail-label">Expense Head</span><span class="detail-value">${esc(inv.expense_head || '—')}</span></div>
    <div class="detail-row"><span class="detail-label">Amount</span><span class="detail-value" style="color:var(--primary)">${esc(inv.amount || '—')}</span></div>
    <div class="detail-row"><span class="detail-label">Invoice Date</span><span class="detail-value">${esc(inv.invoice_date || '—')}</span></div>
    <div class="detail-row"><span class="detail-label">Due Date</span><span class="detail-value" style="color:${isDueSoon(inv.due_date)?'var(--danger)':'inherit'}">${esc(inv.due_date || '—')}</span></div>
    <div class="detail-row"><span class="detail-label">PO Number</span><span class="detail-value">${esc(inv.po_number || '—')}</span></div>
    <div class="detail-row"><span class="detail-label">GSTIN</span><span class="detail-value">${esc(inv.gstin || '—')}</span></div>
    <div class="detail-row"><span class="detail-label">Status</span><span class="detail-value">${validBadge(inv)}</span></div>
    ${inv.utr ? `<div class="detail-row"><span class="detail-label">UTR</span><span class="detail-value"><span class="utr-pill">✓ ${esc(inv.utr)}</span></span></div>` : ''}
    ${inv.payment_date ? `<div class="detail-row"><span class="detail-label">Payment Date</span><span class="detail-value">${esc(inv.payment_date)}</span></div>` : ''}
    ${inv.remarks ? `<div style="margin-top:10px;padding:8px 12px;background:var(--bg);border-radius:var(--radius-sm);font-size:12px;color:var(--text-secondary)">${esc(inv.remarks)}</div>` : ''}
    ${inv.file_url ? `<div style="margin-top:12px"><a href="${inv.file_url}" target="_blank" class="btn btn-sm">📄 View Invoice on Drive</a></div>` : ''}
  `, `
    <button class="btn" onclick="closeModal()">Close</button>
    ${inv.status === 'pending' ? `<button class="btn btn-primary" onclick="markValidated('${inv.id}')">Mark as Validated</button>` : ''}
    ${inv.status === 'validated' ? `<span class="badge badge-validated" style="padding:6px 12px">✓ Validated</span>` : ''}
  `);
}

async function markValidated(id) {
  const data = await post({ action: 'updateStatus', id, status: 'validated' });
  if (data?.success) { toast('Invoice validated!', 'success'); closeModal(); loadInvoices(); loadMetrics(); }
  else toast(data?.message || 'Failed', 'error');
}

// ── Payment modal ─────────────────────────────────────────────────────────
async function openPaymentModal() {
  const ids = [...selected];
  if (!ids.length) return;

  const data = await get({ action: 'getInvoices', status: 'validated' });
  const invoices = (data?.invoices || []).filter(i => ids.includes(String(i.id)));
  const total = invoices.reduce((s, i) => s + (parseFloat(i.amount_numeric) || 0), 0);
  const fmt = n => '₹' + n.toLocaleString('en-IN');

  openModal(`Send for Payment Approval — ${invoices.length} invoice(s)`, `
    <p style="font-size:12px;color:var(--text-secondary);margin-bottom:12px">
      These invoices will be packaged with the Bills Payable template and emailed to Level 1 approver.
    </p>
    ${invoices.map(inv => `<div class="detail-row"><span class="detail-label">${esc(inv.invoice_no)} — ${esc(inv.vendor_name)}</span><span class="detail-value">${esc(inv.amount)}</span></div>`).join('')}
    <div class="detail-row" style="margin-top:4px;border-top:1px solid var(--border);padding-top:8px">
      <span class="detail-label" style="font-weight:600">Total</span>
      <span class="detail-value" style="color:var(--primary);font-size:14px">${fmt(total)}</span>
    </div>
    <div style="margin-top:12px;padding:10px 14px;background:var(--primary-light);border-radius:var(--radius-sm);font-size:12px;color:var(--primary)">
      <strong>Approval flow:</strong> Level 1 → Level 2 → Finance (UTR)
    </div>
    <div style="margin-top:12px" class="form-field">
      <label>Submitted by (your name)</label>
      <input id="sent-by" placeholder="Your name">
    </div>
  `, `
    <button class="btn" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="doSendForPayment(${JSON.stringify(ids)})">Send for Payment →</button>
  `);
}

async function doSendForPayment(ids) {
  const sentBy = document.getElementById('sent-by')?.value || '';
  closeModal();
  showLoading('Filling template and sending approval email…');
  const data = await post({ action: 'sendForPayment', invoice_ids: ids, sent_by: sentBy });
  hideLoading();
  if (data?.success) {
    toast(data.message || 'Sent!', 'success');
    if (data.templateWarning) toast('Template note: ' + data.templateWarning, 'warning');
    selected.clear();
    loadInvoices(); loadMetrics();
  } else {
    toast(data?.message || 'Failed to send', 'error');
  }
}

// ── Tracking modal ────────────────────────────────────────────────────────
async function showTrackingModal(invoiceId) {
  const data = await get({ action: 'getTrackingDetail', id: invoiceId });
  if (!data?.success) { toast('Could not load tracking', 'error'); return; }
  const { invoice: inv, events, batch } = data;

  const stepLabels = ['Sent', 'L1 Approval', 'L2 Approval', 'Finance'];
  const curLevel = parseInt(batch?.current_level) || 0;
  const isComplete = batch?.status === 'completed';

  const stepsHtml = stepLabels.map((s, i) => {
    const done  = isComplete || (i === 0) || i < curLevel;
    const active = !isComplete && i === curLevel;
    const delayed = String(inv.pay_status).includes('delayed') && active;
    return `<div class="step-item ${done ? 'step-done' : ''}">
      <div class="step-dot ${done ? 'done' : active ? (delayed ? 'delayed' : 'active') : ''}">${done ? '✓' : i + 1}</div>
      <div class="step-name">${s}</div>
    </div>`;
  }).join('');

  const eventsHtml = (events || []).map(e => {
    const cls = e.status === 'approved' || e.status === 'utr_received' ? 'tl-done' : e.status === 'sent' ? 'tl-active' : 'tl-delayed';
    const statusLabel = { sent: 'Sent for approval', approved: 'Approved', queried: 'Query raised', rejected: 'Rejected', utr_received: 'UTR received' }[e.status] || e.status;
    return `<li class="${cls}"><div class="tl-dot"></div><div>
      <div class="tl-label">L${e.level} — ${statusLabel}${e.approver_name ? ' (' + esc(e.approver_name) + ')' : ''}</div>
      <div class="tl-time">${e.responded_at || e.sent_at || ''}</div>
      ${e.reply_snippet ? `<div style="font-size:11px;color:var(--text-secondary);margin-top:3px;max-width:420px">${esc(e.reply_snippet.substring(0, 140))}…</div>` : ''}
    </div></li>`;
  }).join('');

  openModal('Approval Tracking — ' + esc(inv.invoice_no), `
    <div class="detail-row"><span class="detail-label">Vendor</span><span class="detail-value">${esc(inv.vendor_name)}</span></div>
    <div class="detail-row"><span class="detail-label">Amount</span><span class="detail-value">${esc(inv.amount)}</span></div>
    ${batch ? `<div class="detail-row"><span class="detail-label">Batch</span><span class="detail-value">${esc(batch.batch_ref)}</span></div>` : ''}
    <div class="steps-row" style="margin:16px 0">${stepsHtml}</div>
    ${String(inv.pay_status).includes('delayed') ? `<div style="padding:8px 12px;background:var(--danger-light);border-radius:var(--radius-sm);font-size:12px;color:var(--danger);margin-bottom:12px">⚠ Past SLA — please follow up with the approver.</div>` : ''}
    ${eventsHtml ? `<ul class="timeline" style="margin-top:8px">${eventsHtml}</ul>` : '<p style="font-size:12px;color:var(--text-secondary);margin-top:8px">No reply events yet.</p>'}
    ${inv.utr ? `<div style="margin-top:10px"><span class="utr-pill">✓ UTR: ${esc(inv.utr)}</span></div>` : ''}
  `, `
    <button class="btn" onclick="closeModal()">Close</button>
    ${batch && batch.status !== 'completed' ? `<button class="btn btn-sm" onclick="doReminder('${batch.id}')">Send Reminder</button>` : ''}
    ${inv.status === 'payment' ? `<button class="btn btn-primary btn-sm" onclick="manualUTRModal('${inv.id}')">Record UTR Manually</button>` : ''}
  `);
}

async function doReminder(batchId) {
  const data = await post({ action: 'sendReminder', batchId });
  toast(data?.success ? 'Reminder sent' : data?.message, data?.success ? 'success' : 'error');
}

function manualUTRModal(invoiceId) {
  closeModal();
  openModal('Record UTR Number', `
    <p style="font-size:12px;color:var(--text-secondary);margin-bottom:12px">Enter the UTR / transaction reference received from Finance.</p>
    <div class="form-field"><label>UTR Number *</label><input id="utr-val" placeholder="e.g. SBIN0000123456789"></div>
    <div class="form-field" style="margin-top:10px"><label>Payment Date</label><input type="date" id="utr-date" value="${new Date().toISOString().split('T')[0]}"></div>
    <div class="form-field" style="margin-top:10px"><label>Remarks (optional)</label><input id="utr-remarks" placeholder="e.g. NEFT transfer"></div>
  `, `
    <button class="btn" onclick="closeModal()">Cancel</button>
    <button class="btn btn-success" onclick="submitUTR('${invoiceId}')">Save UTR</button>
  `);
}

async function submitUTR(invoiceId) {
  const utr = document.getElementById('utr-val')?.value.trim();
  if (!utr) { toast('UTR number is required', 'error'); return; }
  const data = await post({ action: 'recordUTR', invoice_ids: [invoiceId], utr, payment_date: document.getElementById('utr-date')?.value, remarks: document.getElementById('utr-remarks')?.value });
  if (data?.success) { toast('UTR recorded!', 'success'); closeModal(); loadInvoices(); loadMetrics(); }
  else toast(data?.message || 'Failed', 'error');
}

// ── Tracking tab ──────────────────────────────────────────────────────────
async function loadTracking() {
  const el = document.getElementById('tracking-list');
  el.innerHTML = '<div class="empty-state" style="padding:40px">Loading…</div>';
  const data = await get({ action: 'getTracking' }).catch(() => null);
  if (!data?.success || !data.batches.length) { el.innerHTML = '<div class="card"><div class="empty-state">No payment batches yet. Validated invoices sent for payment will appear here.</div></div>'; return; }

  el.innerHTML = data.batches.map(batch => {
    const isDelayed  = batch.invoices.some(i => String(i.pay_status).includes('delayed'));
    const isComplete = batch.status === 'completed';
    const curLevel   = parseInt(batch.current_level) || 1;
    const stepLabels = ['Sent', 'L1', 'L2', 'Finance'];
    const steps = stepLabels.map((s, i) => {
      const done  = isComplete || i < curLevel;
      const active = !isComplete && i === curLevel;
      const delayed = isDelayed && active;
      return `<div class="step-item ${done ? 'step-done' : ''}">
        <div class="step-dot ${done ? 'done' : active ? (delayed ? 'delayed' : 'active') : ''}">${done ? '✓' : i + 1}</div>
        <div class="step-name">${s}</div>
      </div>`;
    }).join('');

    const invRows = batch.invoices.map(i => `<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:1px solid var(--border-light)"><span>${esc(i.invoice_no)} — ${esc(i.vendor_name)}</span><span>${esc(i.amount)}</span></div>`).join('');

    return `<div class="track-card ${isDelayed ? 'is-delayed' : ''} ${isComplete ? 'is-completed' : ''}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;flex-wrap:wrap;gap:8px">
        <div>
          <div style="font-weight:600;font-size:13px">${esc(batch.batch_ref)}</div>
          <div style="font-size:11px;color:var(--text-secondary);margin-top:2px">Sent ${esc(String(batch.sent_at || '').split('T')[0])} by ${esc(batch.sent_by || '—')}</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <span class="badge ${isComplete ? 'badge-utr' : isDelayed ? 'badge-delayed' : 'badge-approval1'}">${isDelayed ? '⚠ Delayed' : isComplete ? 'Completed' : 'In Progress'}</span>
          ${batch.invoices[0]?.utr ? `<span class="utr-pill">UTR: ${esc(batch.invoices[0].utr)}</span>` : ''}
        </div>
      </div>
      <div class="steps-row">${steps}</div>
      <div style="margin-top:12px">${invRows}</div>
      <div style="display:flex;gap:6px;margin-top:12px;justify-content:flex-end;flex-wrap:wrap">
        ${batch.invoices.map(i => `<button class="btn btn-sm" onclick="showTrackingModal('${i.id}')">Timeline ${esc(i.invoice_no)}</button>`).join('')}
        ${!isComplete ? `<button class="btn btn-sm" onclick="doReminder('${batch.id}')">Send Reminder</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

// ── Upload flow ───────────────────────────────────────────────────────────
async function loadExpenseHeadsDropdowns() {
  if (allExpenseHeads.length) return;
  const data = await get({ action: 'getExpenseHeads' }).catch(() => null);
  if (data?.success) allExpenseHeads = data.expenseHeads.map(h => h.name);
}

function handleDrop(e) {
  e.preventDefault();
  document.getElementById('upload-zone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) processFile(file);
}

function handleFileSelect(input) { if (input.files[0]) processFile(input.files[0]); }

async function processFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['pdf', 'jpg', 'jpeg', 'png'].includes(ext)) { toast('Only PDF, JPG, PNG allowed', 'error'); return; }

  document.getElementById('upload-step-1').style.display = 'none';
  document.getElementById('upload-loading').style.display = 'flex';
  document.getElementById('loading-msg').textContent = 'Uploading to Google Drive…';

  const base64 = await fileToBase64(file);
  document.getElementById('loading-msg').textContent = 'Extracting data with Google OCR…';

  const data = await post({ action: 'uploadInvoice', fileName: file.name, mimeType: file.type, data: base64 });

  document.getElementById('upload-loading').style.display = 'none';

  if (!data?.success) { toast(data?.message || 'Upload failed', 'error'); document.getElementById('upload-step-1').style.display = ''; return; }

  uploadedFileId  = data.fileId;
  uploadedFileUrl = data.fileUrl;
  uploadedFileName = data.fileName;

  await loadExpenseHeadsDropdowns();
  renderExtractForm(data.extracted || {});
  document.getElementById('upload-step-2').style.display = '';
}

function fileToBase64(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result.split(',')[1]);
    reader.readAsDataURL(file);
  });
}

function renderExtractForm(d) {
  const vendorOpts = ['', ...allVendors].map(v => `<option ${v === d.vendor_name ? 'selected' : ''}>${esc(v)}</option>`).join('');
  const expOpts = allExpenseHeads.map(h => `<option ${h === d.expense_head ? 'selected' : ''}>${esc(h)}</option>`).join('');
  document.getElementById('extract-form').innerHTML = `
    <div class="form-field"><label>Invoice Number *</label><input id="e-invno" value="${esc(d.invoice_no||'')}"></div>
    <div class="form-field"><label>Vendor *</label><input id="e-vendor" list="vendor-dl" value="${esc(d.vendor_name||'')}"><datalist id="vendor-dl">${vendorOpts}</datalist></div>
    <div class="form-field"><label>Expense Head</label><select id="e-expense">${expOpts}</select></div>
    <div class="form-field"><label>Amount (₹)</label><input id="e-amount" value="${esc(d.amount||'')}"></div>
    <div class="form-field"><label>Invoice Date</label><input type="date" id="e-date" value="${esc(d.invoice_date||'')}"></div>
    <div class="form-field"><label>Due Date</label><input type="date" id="e-due" value="${esc(d.due_date||'')}"></div>
    <div class="form-field"><label>GSTIN</label><input id="e-gstin" value="${esc(d.gstin||'')}"></div>
    <div class="form-field"><label>PO Number</label><input id="e-po" value="${esc(d.po_number||'')}"></div>
  `;
}

async function doSaveInvoice(status) {
  const invNo = document.getElementById('e-invno')?.value.trim();
  const vendor = document.getElementById('e-vendor')?.value.trim();
  if (!invNo || !vendor) { toast('Invoice number and vendor name are required', 'error'); return; }

  const amtStr = document.getElementById('e-amount')?.value || '';
  const amtNum = parseFloat(amtStr.replace(/[^0-9.]/g, '')) || 0;

  const data = await post({
    action: 'saveInvoice',
    invoice_no: invNo, vendor_name: vendor,
    expense_head: document.getElementById('e-expense')?.value,
    amount: amtStr, amount_numeric: amtNum,
    invoice_date: document.getElementById('e-date')?.value,
    due_date: document.getElementById('e-due')?.value,
    gstin: document.getElementById('e-gstin')?.value,
    po_number: document.getElementById('e-po')?.value,
    file_id: uploadedFileId, file_url: uploadedFileUrl, file_name: uploadedFileName,
    status,
  });

  if (data?.success) {
    toast(status === 'validated' ? 'Invoice validated and saved!' : 'Saved as pending validation', 'success');
    resetUpload();
    showTab('dashboard');
  } else {
    toast(data?.message || 'Save failed', 'error');
  }
}

function resetUpload() {
  document.getElementById('upload-step-1').style.display = '';
  document.getElementById('upload-step-2').style.display = 'none';
  document.getElementById('upload-loading').style.display = 'none';
  document.getElementById('file-input').value = '';
  uploadedFileId = uploadedFileUrl = uploadedFileName = null;
}

// ── Settings tab ──────────────────────────────────────────────────────────
async function loadSettings() {
  const data = await get({ action: 'getSettings' }).catch(() => null);
  if (!data?.success) return;
  const s = data.settings || {};

  setVal('s-a1-name',  s.APPROVER1_NAME);
  setVal('s-a1-email', s.APPROVER1_EMAIL);
  setVal('s-a2-name',  s.APPROVER2_NAME);
  setVal('s-a2-email', s.APPROVER2_EMAIL);
  setVal('s-finance-email', s.FINANCE_EMAIL);
  setVal('s-company',  s.COMPANY_NAME);
  setVal('s-sla1', s.SLA_LEVEL1_HOURS || '24');
  setVal('s-sla2', s.SLA_LEVEL2_HOURS || '24');
  setVal('s-sla-f', s.SLA_FINANCE_HOURS || '48');
  setVal('s-sheet-name', s.TEMPLATE_SHEET_NAME || 'Sheet1');

  // Template status
  const tmplEl = document.getElementById('template-status-bar');
  tmplEl.className = data.hasTemplate ? 'template-ok' : 'template-missing';
  tmplEl.textContent = data.hasTemplate ? '✓ Bills Payable template is uploaded' : '⚠ No template uploaded yet.';

  // Cell map
  try {
    if (s.CELL_MAP) currentCellMap = JSON.parse(s.CELL_MAP);
  } catch (_) {}
  renderCellMapTable();

  // Vendors
  allVendors = (data.vendors || []).map(v => v.name);
  allExpenseHeads = (data.expenseHeads || []).map(h => h.name);

  const sel = document.getElementById('v-expense');
  sel.innerHTML = '<option value="">Select…</option>' + allExpenseHeads.map(h => `<option>${esc(h)}</option>`).join('');

  renderVendorList(data.vendors || []);
  renderExpenseHeadList(data.expenseHeads || []);
}

function renderCellMapTable() {
  const fields = [
    ['vendor_name','Vendor Name'],['invoice_no','Invoice Number'],['invoice_date','Invoice Date'],
    ['due_date','Due Date'],['amount','Amount'],['expense_head','Expense Head'],
    ['po_number','PO Number'],['gstin','GSTIN'],
  ];
  document.getElementById('cell-map-body').innerHTML = fields.map(([f, label]) => `
    <tr>
      <td>${label}</td>
      <td><input class="filter-input cm-cell" data-field="${f}" value="${esc(currentCellMap[f] || '')}" style="width:72px;height:28px"></td>
      <td><input class="filter-input cm-sheet" value="${esc(document.getElementById('s-sheet-name')?.value || 'Sheet1')}" style="width:90px;height:28px" disabled></td>
    </tr>`).join('');
}

function renderVendorList(vendors) {
  document.getElementById('vendor-list').innerHTML = vendors.length
    ? vendors.map(v => `<div class="vendor-row">
        <div><span style="font-weight:500">${esc(v.name)}</span>${v.gstin ? `<span style="font-size:11px;color:var(--text-secondary);margin-left:8px">${esc(v.gstin)}</span>` : ''}${v.default_expense_head ? `<span class="expense-tag">${esc(v.default_expense_head)}</span>` : ''}</div>
        <button class="btn btn-sm btn-danger" onclick="deleteVendor('${v.id}')">Delete</button>
      </div>`).join('')
    : '<p style="font-size:12px;color:var(--text-secondary)">No vendors added yet</p>';
}

function renderExpenseHeadList(heads) {
  document.getElementById('expense-head-list').innerHTML = heads.map(h => `
    <div class="vendor-row"><span>${esc(h.name)}</span><button class="btn btn-sm btn-danger" onclick="deleteHead('${h.id}')">Delete</button></div>`).join('');
}

async function saveApproverSettings() {
  const settings = {
    APPROVER1_NAME: getVal('s-a1-name'), APPROVER1_EMAIL: getVal('s-a1-email'),
    APPROVER2_NAME: getVal('s-a2-name'), APPROVER2_EMAIL: getVal('s-a2-email'),
    FINANCE_EMAIL:  getVal('s-finance-email'), COMPANY_NAME: getVal('s-company'),
    SLA_LEVEL1_HOURS: getVal('s-sla1'), SLA_LEVEL2_HOURS: getVal('s-sla2'),
    SLA_FINANCE_HOURS: getVal('s-sla-f'),
  };
  const data = await post({ action: 'saveSettings', settings });
  toast(data?.success ? 'Settings saved!' : data?.message, data?.success ? 'success' : 'error');
}

async function saveCellMap() {
  const map = {};
  document.querySelectorAll('.cm-cell').forEach(el => { if (el.value.trim()) map[el.dataset.field] = el.value.trim().toUpperCase(); });
  const sheetName = getVal('s-sheet-name') || 'Sheet1';
  const data = await post({ action: 'saveSettings', settings: { CELL_MAP: JSON.stringify(map), TEMPLATE_SHEET_NAME: sheetName } });
  toast(data?.success ? 'Cell mapping saved!' : data?.message, data?.success ? 'success' : 'error');
}

async function uploadTemplate() {
  const file = document.getElementById('template-file')?.files[0];
  if (!file) { toast('Select an .xlsx file first', 'error'); return; }
  showLoading('Uploading template to Google Drive…');
  const base64 = await fileToBase64(file);
  const data = await post({ action: 'uploadTemplate', fileName: file.name, data: base64 });
  hideLoading();
  toast(data?.success ? 'Template uploaded!' : data?.message, data?.success ? 'success' : 'error');
  if (data?.success) loadSettings();
}

async function saveVendor() {
  const name = getVal('v-name');
  if (!name) { toast('Vendor name required', 'error'); return; }
  const data = await post({ action: 'saveVendor', name, gstin: getVal('v-gstin'), email: getVal('v-email'), default_expense_head: document.getElementById('v-expense')?.value });
  if (data?.success) { toast('Vendor saved!', 'success'); document.getElementById('v-name').value = ''; document.getElementById('v-gstin').value = ''; document.getElementById('v-email').value = ''; loadSettings(); }
  else toast(data?.message, 'error');
}

async function deleteVendor(id) {
  if (!confirm('Delete this vendor?')) return;
  await post({ action: 'deleteVendor', id });
  loadSettings();
}

async function addExpenseHead() {
  const name = document.getElementById('new-head')?.value.trim();
  if (!name) { toast('Enter a name', 'error'); return; }
  const data = await post({ action: 'addExpenseHead', name });
  if (data?.success) { toast('Added!', 'success'); document.getElementById('new-head').value = ''; loadSettings(); }
  else toast(data?.message, 'error');
}

async function deleteHead(id) {
  await post({ action: 'deleteExpenseHead', id });
  loadSettings();
}

// ── Helpers ───────────────────────────────────────────────────────────────
function openModal(title, body, footer = '') {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = body;
  document.getElementById('modal-footer').innerHTML = footer;
  document.getElementById('modal-overlay').style.display = 'flex';
}
function closeModal() { document.getElementById('modal-overlay').style.display = 'none'; }

let toastTimer;
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg || '';
  el.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

function showLoading(msg = 'Processing…') { const el = document.getElementById('upload-loading'); el.querySelector('p').textContent = msg; el.style.display = 'flex'; }
function hideLoading() { document.getElementById('upload-loading').style.display = 'none'; }

function setVal(id, val) { const el = document.getElementById(id); if (el && val !== undefined) el.value = val; }
function getVal(id) { return document.getElementById(id)?.value || ''; }
function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
