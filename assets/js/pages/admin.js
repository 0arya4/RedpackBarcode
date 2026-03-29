// ============================================================
// Admin Page Logic
// ============================================================

let currentAdminUser = null;
let allDrivers = [];
let currentDriverFilter = []; // array of selected driver UIDs (empty = all)
let currentSubTab = 'ready';
let postListeners = {};
let currentSearchQuery = '';
let allPostsCache = [];
let pendingPhotoPostId = null;

// ── Init ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const { userData } = await Auth.requireRole('admin');
    currentAdminUser = userData;
    document.getElementById('admin-name').textContent = userData.name || 'ئەدمین';

    await loadDrivers();
    setupNavigation();
    setupSubTabs();
    setupForms();
    setupScannerModal();
    setupPhotoCapture();
    startRealtimeListeners();
    loadStats();
  } catch (e) {
    console.error('Admin init failed:', e);
  }
});

// ── Navigation ───────────────────────────────────────────────
function setupNavigation() {
  document.querySelectorAll('.nav-item[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(tabName) {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));

  document.querySelector(`.nav-item[data-tab="${tabName}"]`).classList.add('active');
  document.getElementById(`tab-${tabName}`).classList.add('active');

  const fab = document.getElementById('admin-scan-btn');
  const mini = document.getElementById('admin-manual-btn');
  const show = tabName === 'home' ? 'flex' : 'none';
  if (fab) fab.style.display = show;
  if (mini) mini.style.display = show;

  if (tabName === 'stats') loadStats();
}

// ── Sub-tabs (inside Posts tab) ──────────────────────────────
function setupSubTabs() {
  document.querySelectorAll('.sub-tab[data-subtab]').forEach(btn => {
    btn.addEventListener('click', () => switchSubTab(btn.dataset.subtab));
  });

  document.getElementById('post-search').addEventListener('input', (e) => {
    currentSearchQuery = e.target.value.trim().toLowerCase();
    renderAllSections(allPostsCache);
  });
}

function switchSubTab(name) {
  currentSubTab = name;
  document.querySelectorAll('.sub-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.subtab-content').forEach(c => c.style.display = 'none');

  document.querySelector(`.sub-tab[data-subtab="${name}"]`).classList.add('active');
  document.getElementById(`subtab-${name}`).style.display = 'block';

  // Update count for newly visible tab
  renderAllSections(allPostsCache);
}

// ── Barcode Scanner Modal ────────────────────────────────────
function setupScannerModal() {
  document.getElementById('admin-scan-btn').addEventListener('click', openScanner);
  document.getElementById('scanner-close-btn').addEventListener('click', closeScanner);
  document.getElementById('admin-manual-btn').addEventListener('click', () => {
    document.getElementById('admin-manual-input').value = '';
    const overlay = document.getElementById('admin-manual-overlay');
    overlay.style.display = 'flex';
    setTimeout(() => document.getElementById('admin-manual-input').focus(), 100);
  });
  document.getElementById('admin-manual-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitAdminManual();
  });
}

async function submitAdminManual() {
  const val = document.getElementById('admin-manual-input').value.trim();
  if (!val) return;
  document.getElementById('admin-manual-overlay').style.display = 'none';
  await handleAdminScan(val);
}

async function openScanner() {
  Utils.openModal('modal-scanner');
  try {
    await BarcodeScanner.start('scanner-view', handleAdminScan);
  } catch (e) {
    Utils.closeModal('modal-scanner');
  }
}

async function closeScanner() {
  await BarcodeScanner.stop();
  Utils.closeModal('modal-scanner');
}

async function handleAdminScan(barcodeValue) {
  await BarcodeScanner.stop();
  Utils.closeModal('modal-scanner');

  // Check if barcode already exists in DB
  const existing = await db.collection('posts')
    .where('barcode', '==', barcodeValue)
    .limit(1)
    .get();

  if (!existing.empty) {
    const post = existing.docs[0].data();
    if (post.status === 'with_driver' || post.status === 'completed') {
      Utils.showToast(`پێشتر سایەق باڕکۆدی کردووە — لای سایەقە #${barcodeValue}`, 'error');
    } else {
      Utils.showToast(`باڕکۆد #${barcodeValue} پێشتر تۆمارکراوە.`, 'error');
    }
    return;
  }

  Utils.showLoading(true);

  // Try fetching from Red Pack API
  let prefill = await RedPackAPI.getOrderByBarcode(barcodeValue);
  Utils.showLoading(false);

  if (prefill) {
    // Match driver by name
    const matchedDriver = allDrivers.find(d => d.active && d.name.trim() === prefill.driverName.trim());
    if (!matchedDriver) {
      Utils.showToast(`سایەق "${prefill.driverName}" لە سیستەمدا نەدۆزرایەوە`, 'error');
      openPostForm(barcodeValue, prefill);
      return;
    }

    // Auto-create post without showing form
    try {
      Utils.showLoading(true);
      const newRef = await db.collection('posts').add({
        barcode: barcodeValue,
        driverId: matchedDriver.uid,
        driverName: matchedDriver.name,
        receiverPhone: prefill.receiverPhone || '',
        price: prefill.price ?? 0,
        quantity: prefill.quantity ?? 1,
        clientName: prefill.clientName || '',
        clientPhone: prefill.clientPhone || '',
        address: prefill.address || '',
        note: prefill.note || '',
        status: 'ready',
        adminScannedAt: firebase.firestore.FieldValue.serverTimestamp(),
        driverScannedAt: null,
        completedAt: null,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        createdBy: currentAdminUser.uid
      });
      Utils.showLoading(false);
      Utils.showToast(`پۆست دروستکرا ✓ — ${matchedDriver.name}`, 'success');
      openPhotoCaptureModal(newRef.id);
    } catch (err) {
      Utils.showLoading(false);
      Utils.showToast('هەڵەیەک ڕوویدا: ' + err.message, 'error');
    }
  } else {
    // No API data — show form manually
    openPostForm(barcodeValue, null);
  }
}

// ── Post Form ────────────────────────────────────────────────
function setupForms() {
  document.getElementById('post-form').addEventListener('submit', handlePostFormSubmit);
  document.getElementById('driver-form').addEventListener('submit', handleDriverFormSubmit);
  document.getElementById('add-driver-btn').addEventListener('click', () => openDriverForm());

  document.getElementById('df-is-supervisor').addEventListener('change', (e) => {
    document.getElementById('df-supervisor-section').style.display = e.target.checked ? 'block' : 'none';
  });
}

function openPostForm(barcode, prefill = null, existingPost = null) {
  const isEdit = !!existingPost;

  document.getElementById('post-form-title').textContent = isEdit ? 'دەستکاریکردنی پۆست' : 'پۆستی نوێ';
  document.getElementById('pf-post-id').value = existingPost?.id || '';
  document.getElementById('pf-barcode').value = barcode;
  document.getElementById('pf-barcode-display').textContent = barcode;

  // Populate driver select
  const sel = document.getElementById('pf-driver');
  sel.innerHTML = '<option value="">سایەق هەڵبژێرە</option>';
  allDrivers.filter(d => d.active).forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.uid;
    opt.textContent = d.name;
    if (existingPost?.driverId === d.uid || prefill?.driverName === d.name) opt.selected = true;
    sel.appendChild(opt);
  });

  // Fill fields
  document.getElementById('pf-receiver-phone').value = existingPost?.receiverPhone || prefill?.receiverPhone || '';
  document.getElementById('pf-price').value = existingPost?.price ?? prefill?.price ?? '';
  document.getElementById('pf-quantity').value = existingPost?.quantity ?? prefill?.quantity ?? 1;
  document.getElementById('pf-client-name').value = existingPost?.clientName || prefill?.clientName || '';
  document.getElementById('pf-client-phone').value = existingPost?.clientPhone || prefill?.clientPhone || '';
  document.getElementById('pf-address').value = existingPost?.address || prefill?.address || '';
  document.getElementById('pf-note').value = existingPost?.note || prefill?.note || '';

  Utils.openModal('modal-post-form');
}

async function handlePostFormSubmit(e) {
  e.preventDefault();
  const postId = document.getElementById('pf-post-id').value;
  const barcode = document.getElementById('pf-barcode').value;
  const driverId = document.getElementById('pf-driver').value;

  if (!driverId) { Utils.showToast('سایەق هەڵبژێرە', 'error'); return; }

  const driver = allDrivers.find(d => d.uid === driverId);
  if (!driver) { Utils.showToast('سایەق نەدۆزرایەوە', 'error'); return; }

  const data = {
    barcode,
    driverId,
    driverName: driver.name,
    receiverPhone: document.getElementById('pf-receiver-phone').value.trim(),
    price: Number(document.getElementById('pf-price').value),
    quantity: Number(document.getElementById('pf-quantity').value) || 1,
    clientName: document.getElementById('pf-client-name').value.trim(),
    clientPhone: document.getElementById('pf-client-phone').value.trim(),
    address: document.getElementById('pf-address').value.trim(),
    note: document.getElementById('pf-note').value.trim(),
  };

  Utils.showLoading(true);
  const btn = document.getElementById('pf-submit-btn');
  btn.disabled = true;

  try {
    if (postId) {
      // Edit existing post
      await db.collection('posts').doc(postId).update({
        ...data,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      Utils.showToast('پۆست نوێکرایەوە ✓', 'success');
      Utils.closeModal('modal-post-form');
    } else {
      // Create new post
      const newRef = await db.collection('posts').add({
        ...data,
        status: 'ready',
        adminScannedAt: firebase.firestore.FieldValue.serverTimestamp(),
        driverScannedAt: null,
        completedAt: null,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        createdBy: currentAdminUser.uid
      });
      Utils.showToast('پۆست چاککرا ✓', 'success');
      Utils.closeModal('modal-post-form');
      openPhotoCaptureModal(newRef.id);
    }
  } catch (err) {
    console.error(err);
    Utils.showToast('هەڵەیەک ڕوویدا: ' + err.message, 'error');
  } finally {
    Utils.showLoading(false);
    btn.disabled = false;
  }
}

// ── Real-time Firestore Listeners ────────────────────────────
function startRealtimeListeners() {
  // Listen to all posts — no orderBy to avoid requiring Firestore indexes
  postListeners.all = db.collection('posts')
    .onSnapshot(snapshot => {
      const posts = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      posts.sort((a, b) => {
        const aTime = a.createdAt?.toMillis?.() || 0;
        const bTime = b.createdAt?.toMillis?.() || 0;
        return bTime - aTime;
      });
      allPostsCache = posts;
      updateCountsAndBadges(posts);
      renderAllSections(posts);
      renderHomeSummary(posts);
      cleanupOldCompleted(posts);
    });
}

function updateCountsAndBadges(posts) {
  const counts = { ready: 0, with_driver: 0, completed: 0 };
  posts.forEach(p => { if (counts[p.status] !== undefined) counts[p.status]++; });

  document.getElementById('stat-ready').textContent = counts.ready;
  document.getElementById('stat-with-driver').textContent = counts.with_driver;
  document.getElementById('stat-completed').textContent = counts.completed;
  document.getElementById('stat-total').textContent = posts.length;

  document.getElementById('count-ready').textContent = counts.ready;
  document.getElementById('count-with_driver').textContent = counts.with_driver;
  document.getElementById('count-completed').textContent = counts.completed;

  const deleteAllBtn = document.getElementById('delete-all-completed-btn');
  if (deleteAllBtn) deleteAllBtn.style.display = counts.completed > 0 ? 'block' : 'none';

  const pendingCount = counts.ready + counts.with_driver;
  const badge = document.getElementById('nav-badge-posts');
  if (pendingCount > 0) {
    badge.textContent = pendingCount;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

function renderAllSections(posts) {
  const counts = {};
  ['ready', 'with_driver', 'completed'].forEach(status => {
    let filtered = posts.filter(p => p.status === status);
    if (currentDriverFilter.length) {
      filtered = filtered.filter(p => currentDriverFilter.includes(p.driverId));
    }
    if (currentSearchQuery) {
      filtered = filtered.filter(p =>
        p.barcode?.toLowerCase().includes(currentSearchQuery)
      );
    }
    // Put underReview posts first in with_driver list
    if (status === 'with_driver') {
      filtered.sort((a, b) => (b.underReview ? 1 : 0) - (a.underReview ? 1 : 0));
    }
    counts[status] = filtered.length;
    renderPostList(`list-${status}`, filtered, true);
  });

  const countEl = document.getElementById('filter-post-count');
  if (countEl) {
    const isFiltered = currentDriverFilter.length || currentSearchQuery;
    if (isFiltered) {
      countEl.style.display = 'block';
      countEl.textContent = `${counts[currentSubTab] ?? 0} پۆست دۆزرایەوە`;
    } else {
      countEl.style.display = 'none';
    }
  }
}

function renderHomeSummary(posts) {
  const recent = posts.slice(0, 5);
  renderPostList('home-recent-posts', recent, true);
}

function renderPostList(containerId, posts, showActions) {
  const el = document.getElementById(containerId);
  if (!el) return;

  if (posts.length === 0) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <div class="empty-title">هیچ پۆستێک نییە</div>
        <div class="empty-text">پۆستی نوێ باڕکۆد بکە</div>
      </div>`;
    return;
  }

  el.innerHTML = posts.map(post => renderPostCard(post, showActions)).join('');

  // Attach action button listeners
  if (showActions) {
    el.querySelectorAll('.btn-edit-post').forEach(btn => {
      btn.addEventListener('click', () => editPost(btn.dataset.id));
    });
    el.querySelectorAll('.btn-delete-post').forEach(btn => {
      btn.addEventListener('click', () => deletePost(btn.dataset.id));
    });
    el.querySelectorAll('.btn-check-post').forEach(btn => {
      btn.addEventListener('click', () => checkPost(btn.dataset.id, btn.dataset.checked === 'true'));
    });
  }
}

function driverColor(driverId) {
  if (!driverId) return '';
  let hash = 0;
  for (let i = 0; i < driverId.length; i++) {
    hash = driverId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 40%, 90%)`;
}

function renderPostCard(post, showActions) {
  const statusBadge = `<span class="badge ${Utils.statusClass(post.status)}">${Utils.statusLabel(post.status)}</span>`;
  const checkBtn = (post.status === 'with_driver' && showActions)
    ? `<button class="btn btn-sm btn-check-post" data-id="${post.id}" data-checked="${!!post.underReview}" onclick="event.stopPropagation()" style="background:${post.underReview ? '#C62828' : '#1565C0'};color:#fff;border:none;">🔍 ${post.underReview ? 'بەدواداچوون ✓' : 'بەدواداچوون'}</button>`
    : '';
  const actions = showActions ? `
    <div class="post-card-footer">
      <button class="btn btn-outline btn-sm btn-edit-post" data-id="${post.id}" onclick="event.stopPropagation()">✏️ دەستکاری</button>
      ${checkBtn}
      <button class="btn btn-danger btn-sm btn-delete-post" data-id="${post.id}" onclick="event.stopPropagation()">🗑️ سڕینەوە</button>
    </div>` : '';

  const bgColor = driverColor(post.driverId);
  return `
    <div class="post-card status-${post.status}${post.underReview ? ' under-review' : ''}" style="background:${bgColor};" onclick="this.classList.toggle('expanded')">
      <div class="post-card-summary">
        <div class="post-summary-main">
          <div class="post-summary-barcode" data-barcode="${Utils.escapeHtml(post.barcode)}">#${Utils.escapeHtml(post.barcode)}</div>
          <div class="post-summary-sub">${Utils.escapeHtml(post.driverName)} · ${Utils.escapeHtml(post.clientName)}</div>
          ${post.underReview ? `<div style="color:#C62828;font-weight:700;font-size:0.78rem;margin-top:2px;">⚠️ ئەم پۆستە لەژێر بەدواداچووندایە</div>` : ''}
        </div>
        ${statusBadge}
        <span class="post-chevron">▼</span>
      </div>
      <div class="post-card-details">
        <div class="post-card-body">
          <div class="post-row">
            <span class="label">سایەق:</span>
            <span class="value">${Utils.escapeHtml(post.driverName)}</span>
          </div>
          <div class="post-row">
            <span class="label">کڵاینت:</span>
            <span class="value">${Utils.escapeHtml(post.clientName)}${post.clientPhone ? ' — ' + Utils.escapeHtml(post.clientPhone) : ''}</span>
          </div>
          <div class="post-row">
            <span class="label">ناونیشان:</span>
            <span class="value">${Utils.escapeHtml(post.address)}</span>
          </div>
          <div class="post-row">
            <span class="label">وەرگر:</span>
            <span class="value">${Utils.escapeHtml(post.receiverPhone)}</span>
          </div>
          <div class="post-row">
            <span class="label">نرخ:</span>
            <span class="value">${Utils.formatPrice(post.price, post.quantity)}</span>
          </div>
          ${post.note ? `<div class="post-row"><span class="label">تێبینی:</span><span class="value">${Utils.escapeHtml(post.note)}</span></div>` : ''}
          <div class="post-row">
            <span class="label">کاتی باڕکۆدی ئۆفیس:</span>
            <span class="value" style="font-size:0.78rem;color:var(--text-muted);">${post.directDriverScan ? '⚠️ لە ئۆفیس باڕکۆد نەکراوە' : Utils.formatDate(post.adminScannedAt)}</span>
          </div>
          ${post.driverScannedAt ? `
          <div class="post-row">
            <span class="label"> کاتی باڕکۆدی سایەق:</span>
            <span class="value" style="font-size:0.78rem;color:var(--text-muted);">${Utils.formatDate(post.driverScannedAt)}</span>
          </div>` : ''}
        </div>
        ${post.directDriverScan ? `<div class="post-photo" style="background:var(--warning-bg,#FFF8E1);border:1px solid #FFD54F;border-radius:8px;padding:10px;font-size:0.8rem;color:#E65100;text-align:center;">⚠️ لە ئۆفیس باڕکۆد نەکراوە<br>یەکسەر سایەق باڕکۆدی کردووە</div>` : post.photoAdmin ? `<div class="post-photo"><div class="photo-label">📦 ئەدمین</div><img src="${post.photoAdmin}" alt="وێنەی ئەدمین" onclick="event.stopPropagation();Utils.openPhoto(this.src)"></div>` : ''}
        ${post.photoDriver ? `<div class="post-photo"><div class="photo-label">🚗 سایەق</div><img src="${post.photoDriver}" alt="وێنەی سایەق" onclick="event.stopPropagation();Utils.openPhoto(this.src)"></div>` : ''}
        ${post.photoComplete ? `<div class="post-photo"><div class="photo-label">✅ باڕکۆدی تەواوبوون</div><img src="${post.photoComplete}" alt="وێنەی تەواوبوون" onclick="event.stopPropagation();Utils.openPhoto(this.src)"></div>` : ''}
        ${actions}
      </div>
    </div>`;
}

async function editPost(postId) {
  Utils.showLoading(true);
  const doc = await db.collection('posts').doc(postId).get();
  Utils.showLoading(false);
  if (!doc.exists) { Utils.showToast('پۆست نەدۆزرایەوە', 'error'); return; }
  const post = { id: doc.id, ...doc.data() };
  openPostForm(post.barcode, null, post);
}

async function cleanupOldCompleted(posts) {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const batch = db.batch();
  let changes = 0;

  posts.forEach(p => {
    const t = ts => ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null;

    // Auto-delete completed posts older than 24h
    const completedAt = t(p.completedAt);
    if (p.status === 'completed' && completedAt && completedAt < cutoff) {
      batch.delete(db.collection('posts').doc(p.id));
      changes++;
    }
  });

  if (changes) {
    try { await batch.commit(); } catch (e) { console.error('cleanupOldCompleted failed:', e); }
  }
}

async function deleteAllCompleted() {
  let posts = allPostsCache.filter(p => p.status === 'completed');
  if (currentDriverFilter.length) posts = posts.filter(p => currentDriverFilter.includes(p.driverId));
  if (!posts.length) return;

  const confirmed = await Utils.confirm(`دڵنیایت لە سڕینەوەی هەموو ${posts.length} پۆستە تەواوبووەکان؟`);
  if (!confirmed) return;

  Utils.showLoading(true);
  try {
    const batch = db.batch();
    posts.forEach(p => batch.delete(db.collection('posts').doc(p.id)));
    await batch.commit();
    Utils.showToast(`${posts.length} پۆست سڕایەوە ✓`, 'success');
  } catch (err) {
    Utils.showToast('هەڵەیەک ڕوویدا', 'error');
  }
  Utils.showLoading(false);
}

async function deletePost(postId) {
  const confirmed = await Utils.confirm('دڵنیایت لە سڕینەوەی ئەم پۆستە؟');
  if (!confirmed) return;
  Utils.showLoading(true);
  try {
    await db.collection('posts').doc(postId).delete();
    Utils.showToast('پۆست سڕایەوە ✓', 'success');
  } catch (err) {
    Utils.showToast('هەڵەیەک ڕوویدا', 'error');
  }
  Utils.showLoading(false);
}

async function checkPost(postId, currentlyChecked) {
  Utils.showLoading(true);
  try {
    await db.collection('posts').doc(postId).update({ underReview: !currentlyChecked });
    Utils.showToast(!currentlyChecked ? 'پۆست لەژێر بەدواداچووندایە ✓' : 'بەدواداچوون لابرا', 'success');
  } catch (err) {
    Utils.showToast('هەڵەیەک ڕوویدا', 'error');
  }
  Utils.showLoading(false);
}

// ── Driver Management ────────────────────────────────────────
async function loadDrivers() {
  allDrivers = await Auth.getAllDrivers();
  renderDriverList();
  populateDriverFilter();
}

function populateDriverFilter() {
  const options = allDrivers.map(d => ({ value: d.uid, label: d.name }));
  Utils.buildMultiSelect('driver-filter', options, (selected) => {
    currentDriverFilter = selected;
    renderAllSections(allPostsCache);
  });
}

function renderDriverList() {
  const el = document.getElementById('drivers-list');
  if (allDrivers.length === 0) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">👤</div>
        <div class="empty-title">هیچ سایەقێک نییە</div>
        <div class="empty-text">سایەقی نوێ زیاد بکە</div>
      </div>`;
    return;
  }

  el.innerHTML = allDrivers.map(d => `
    <div class="driver-item">
      <div class="driver-info">
        <div class="driver-name">
          ${Utils.escapeHtml(d.name)}
          <span class="${d.active ? 'active-dot' : 'active-dot inactive-dot'}"></span>
          ${d.supervisorOf?.length ? `<span class="badge badge-info" style="font-size:0.68rem;padding:2px 6px;">👁️ سەرپەرشتیار</span>` : ''}
        </div>
        <div class="driver-email">${Utils.escapeHtml(d.email)}</div>
      </div>
      <div class="driver-actions">
        <button class="btn btn-outline btn-sm btn-edit-driver" data-uid="${d.uid}">✏️</button>
        <button class="btn btn-danger btn-sm btn-toggle-driver" data-uid="${d.uid}" data-active="${d.active}">
          ${d.active ? '🚫' : '✅'}
        </button>
      </div>
    </div>`).join('');

  el.querySelectorAll('.btn-edit-driver').forEach(btn => {
    btn.addEventListener('click', () => openDriverForm(btn.dataset.uid));
  });

  el.querySelectorAll('.btn-toggle-driver').forEach(btn => {
    btn.addEventListener('click', () => toggleDriver(btn.dataset.uid, btn.dataset.active === 'true'));
  });
}

function openDriverForm(uid = null) {
  const isEdit = !!uid;
  document.getElementById('driver-form-title').textContent = isEdit ? 'دەستکاریکردنی سایەق' : 'سایەقی نوێ';
  document.getElementById('df-driver-uid').value = uid || '';

  const driver = allDrivers.find(d => d.uid === uid);
  document.getElementById('df-name').value = driver?.name || '';
  document.getElementById('df-email').value = driver?.email || '';
  document.getElementById('df-password').value = '';

  // Password required only for new drivers
  const pwGroup = document.getElementById('df-password-group');
  const pwInput = document.getElementById('df-password');
  const newPwGroup = document.getElementById('df-new-password-group');
  document.getElementById('df-new-password').value = '';
  if (isEdit) {
    pwGroup.style.display = 'none';
    pwInput.required = false;
    newPwGroup.style.display = 'block';
  } else {
    pwGroup.style.display = 'block';
    pwInput.required = true;
    newPwGroup.style.display = 'none';
  }

  // Supervisor section
  const existingSupervisorOf = driver?.supervisorOf || [];
  const isSupervisor = existingSupervisorOf.length > 0;
  document.getElementById('df-is-supervisor').checked = isSupervisor;
  document.getElementById('df-supervisor-section').style.display = isSupervisor ? 'block' : 'none';

  // Populate driver checkboxes (all active drivers except the one being edited)
  const checkboxContainer = document.getElementById('df-driver-checkboxes');
  const otherDrivers = allDrivers.filter(d => d.uid !== uid && d.active);
  if (otherDrivers.length === 0) {
    checkboxContainer.innerHTML = '<div style="font-size:0.82rem;color:var(--text-muted);padding:4px;">هیچ سایەقێکی تر نییە</div>';
  } else {
    checkboxContainer.innerHTML = otherDrivers.map(d => `
      <label style="display:flex;align-items:center;gap:8px;padding:6px 4px;cursor:pointer;border-radius:6px;">
        <input type="checkbox" value="${d.uid}" class="supervisor-driver-cb"
          ${existingSupervisorOf.includes(d.uid) ? 'checked' : ''}
          style="width:16px;height:16px;cursor:pointer;accent-color:var(--primary);" />
        <span style="font-size:0.88rem;">${Utils.escapeHtml(d.name)}</span>
      </label>
    `).join('');
  }

  Utils.openModal('modal-driver-form');
}

async function handleDriverFormSubmit(e) {
  e.preventDefault();
  const uid = document.getElementById('df-driver-uid').value;
  const name = document.getElementById('df-name').value.trim();
  const email = document.getElementById('df-email').value.trim();
  const password = document.getElementById('df-password').value;
  const isEdit = !!uid;
  const btn = document.getElementById('df-submit-btn');

  // Read supervisor data
  const isSupervisor = document.getElementById('df-is-supervisor').checked;
  const supervisorOf = isSupervisor
    ? [...document.querySelectorAll('.supervisor-driver-cb:checked')].map(cb => cb.value)
    : [];

  btn.disabled = true;
  Utils.showLoading(true);

  const newPassword = document.getElementById('df-new-password').value.trim();

  try {
    if (isEdit) {
      const updateData = { name, email, supervisorOf };
      if (newPassword) {
        if (newPassword.length < 6) throw new Error('پاسوۆرد کەمترین 6 پیت دەبێت.');
        updateData.pendingPassword = newPassword;
      }
      await Auth.updateDriver(uid, updateData);
      Utils.showToast('سایەق نوێکرایەوە ✓' + (newPassword ? ' — پاسوۆرد جارێکی تر چوونەژوورەوە دەگۆڕدرێت' : ''), 'success');
    } else {
      if (password.length < 6) throw new Error('پاسوۆرد کەمترین 6 پیت دەبێت.');
      await Auth.createDriverAccount(email, password, name, supervisorOf);
      Utils.showToast('سایەقی نوێ زیادکرا ✓', 'success');
    }
    await loadDrivers();
    Utils.closeModal('modal-driver-form');
  } catch (err) {
    console.error(err);
    let msg = err.message || 'هەڵەیەک ڕوویدا';
    if (err.code === 'auth/email-already-in-use') msg = 'ئەم ئیمەیڵە پێشتر بەکارهاتووە.';
    Utils.showToast(msg, 'error');
  } finally {
    Utils.showLoading(false);
    btn.disabled = false;
  }
}

async function toggleDriver(uid, isActive) {
  const action = isActive ? 'ناچالاককردن' : 'چالاككردن';
  const confirmed = await Utils.confirm(`دڵنیایت لە ${action}ی ئەم سایەقە؟`);
  if (!confirmed) return;

  Utils.showLoading(true);
  try {
    if (isActive) await Auth.deactivateDriver(uid);
    else await Auth.reactivateDriver(uid);
    await loadDrivers();
    Utils.showToast('نوێکرایەوە ✓', 'success');
  } catch (err) {
    Utils.showToast('هەڵەیەک ڕوویدا', 'error');
  }
  Utils.showLoading(false);
}

// ── Stats ────────────────────────────────────────────────────
async function loadStats() {
  const snapshot = await db.collection('posts').get();
  const posts = snapshot.docs.map(d => d.data());

  const counts = { ready: 0, with_driver: 0, completed: 0 };
  const byDriver = {};

  posts.forEach(p => {
    if (counts[p.status] !== undefined) counts[p.status]++;
    if (p.driverName) {
      byDriver[p.driverName] = (byDriver[p.driverName] || 0) + 1;
    }
  });

  document.getElementById('stats-full').innerHTML = `
    <div class="stat-card"><div class="stat-number">${counts.ready}</div><div class="stat-label">ئامادەی سایەق</div></div>
    <div class="stat-card"><div class="stat-number">${counts.with_driver}</div><div class="stat-label">لای سایەق</div></div>
    <div class="stat-card"><div class="stat-number">${counts.completed}</div><div class="stat-label">تەواوبوو</div></div>
    <div class="stat-card"><div class="stat-number">${posts.length}</div><div class="stat-label">کۆی گشتی</div></div>
  `;

  const byDriverEl = document.getElementById('stats-by-driver');
  if (Object.keys(byDriver).length === 0) {
    byDriverEl.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;text-align:center;padding:12px;">هیچ داتایەک نییە</p>';
    return;
  }

  byDriverEl.innerHTML = Object.entries(byDriver)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);">
        <span style="font-weight:500;">${Utils.escapeHtml(name)}</span>
        <span class="badge badge-info">${count} پۆست</span>
      </div>
    `).join('');
}

// ── Photo Capture ────────────────────────────────────────────
function openPhotoCaptureModal(postId) {
  pendingPhotoPostId = postId;
  document.getElementById('photo-input').value = '';
  document.getElementById('photo-overlay').style.display = 'flex';
}

async function photoChangeHandler() {
  const input = document.getElementById('photo-input');
  const file = input.files[0];
  if (!file || !pendingPhotoPostId) return;

  document.getElementById('photo-overlay').style.display = 'none';
  Utils.showLoading(true);
  const postId = pendingPhotoPostId;
  pendingPhotoPostId = null;

  try {
    const base64 = await compressToBase64(file);
    await db.collection('posts').doc(postId).update({ photoAdmin: base64 });
    Utils.showToast('وێنە دانرا ✓', 'success');
  } catch (err) {
    Utils.showToast('هەڵە: ' + err.message, 'error');
  } finally {
    Utils.showLoading(false);
  }
}

function setupPhotoCapture() {
  document.getElementById('photo-input').addEventListener('change', photoChangeHandler);
}

function compressToBase64(file, maxWidth = 600, quality = 0.5) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Failed to load image'));
      img.onload = () => {
        const ratio = Math.min(maxWidth / img.width, 1);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * ratio);
        canvas.height = Math.round(img.height * ratio);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}
