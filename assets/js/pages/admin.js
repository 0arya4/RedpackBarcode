// ============================================================
// Admin Page Logic
// ============================================================

let currentAdminUser = null;
let allDrivers = [];
let currentDriverFilter = '';
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

  if (tabName === 'stats') loadStats();
}

// ── Sub-tabs (inside Posts tab) ──────────────────────────────
function setupSubTabs() {
  document.querySelectorAll('.sub-tab[data-subtab]').forEach(btn => {
    btn.addEventListener('click', () => switchSubTab(btn.dataset.subtab));
  });

  document.getElementById('driver-filter').addEventListener('change', (e) => {
    currentDriverFilter = e.target.value;
    renderAllSections(allPostsCache);
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
}

// ── Barcode Scanner Modal ────────────────────────────────────
function setupScannerModal() {
  document.getElementById('admin-scan-btn').addEventListener('click', openScanner);
  document.getElementById('scanner-close-btn').addEventListener('click', closeScanner);
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
    Utils.showToast(`باڕکۆد #${barcodeValue} پێشتر تۆمارکراوە.`, 'error');
    return;
  }

  Utils.showLoading(true);

  // Try fetching from Red Pack API
  let prefill = await RedPackAPI.getOrderByBarcode(barcodeValue);
  Utils.showLoading(false);

  // Open post form with prefilled data (or empty)
  openPostForm(barcodeValue, prefill);
}

// ── Post Form ────────────────────────────────────────────────
function setupForms() {
  document.getElementById('post-form').addEventListener('submit', handlePostFormSubmit);
  document.getElementById('driver-form').addEventListener('submit', handleDriverFormSubmit);
  document.getElementById('add-driver-btn').addEventListener('click', () => openDriverForm());
}

function openPostForm(barcode, prefill = null, existingPost = null) {
  const isEdit = !!existingPost;

  document.getElementById('post-form-title').textContent = isEdit ? 'دەستکاریکردنی پۆست' : 'پۆستی نوێ';
  document.getElementById('pf-post-id').value    = existingPost?.id || '';
  document.getElementById('pf-barcode').value    = barcode;
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
  document.getElementById('pf-price').value          = existingPost?.price         || prefill?.price         || '';
  document.getElementById('pf-quantity').value       = existingPost?.quantity      || prefill?.quantity      || 1;
  document.getElementById('pf-client-name').value    = existingPost?.clientName    || prefill?.clientName    || '';
  document.getElementById('pf-client-phone').value   = existingPost?.clientPhone   || prefill?.clientPhone   || '';
  document.getElementById('pf-address').value        = existingPost?.address       || prefill?.address       || '';
  document.getElementById('pf-note').value           = existingPost?.note          || prefill?.note          || '';

  Utils.openModal('modal-post-form');
}

async function handlePostFormSubmit(e) {
  e.preventDefault();
  const postId   = document.getElementById('pf-post-id').value;
  const barcode  = document.getElementById('pf-barcode').value;
  const driverId = document.getElementById('pf-driver').value;

  if (!driverId) { Utils.showToast('سایەق هەڵبژێرە', 'error'); return; }

  const driver = allDrivers.find(d => d.uid === driverId);
  if (!driver) { Utils.showToast('سایەق نەدۆزرایەوە', 'error'); return; }

  const data = {
    barcode,
    driverId,
    driverName:    driver.name,
    receiverPhone: document.getElementById('pf-receiver-phone').value.trim(),
    price:         Number(document.getElementById('pf-price').value),
    quantity:      Number(document.getElementById('pf-quantity').value) || 1,
    clientName:    document.getElementById('pf-client-name').value.trim(),
    clientPhone:   document.getElementById('pf-client-phone').value.trim(),
    address:       document.getElementById('pf-address').value.trim(),
    note:          document.getElementById('pf-note').value.trim(),
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
        status:          'ready',
        adminScannedAt:  firebase.firestore.FieldValue.serverTimestamp(),
        driverScannedAt: null,
        completedAt:     null,
        createdAt:       firebase.firestore.FieldValue.serverTimestamp(),
        createdBy:       currentAdminUser.uid
      });
      Utils.showToast('پۆست پاشەکەوتکرا ✓', 'success');
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
    });
}

function updateCountsAndBadges(posts) {
  const counts = { ready: 0, with_driver: 0, completed: 0 };
  posts.forEach(p => { if (counts[p.status] !== undefined) counts[p.status]++; });

  document.getElementById('stat-ready').textContent       = counts.ready;
  document.getElementById('stat-with-driver').textContent = counts.with_driver;
  document.getElementById('stat-completed').textContent   = counts.completed;
  document.getElementById('stat-total').textContent       = posts.length;

  document.getElementById('count-ready').textContent       = counts.ready;
  document.getElementById('count-with_driver').textContent = counts.with_driver;
  document.getElementById('count-completed').textContent   = counts.completed;

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
  ['ready', 'with_driver', 'completed'].forEach(status => {
    let filtered = posts.filter(p => p.status === status);
    if (currentDriverFilter) {
      filtered = filtered.filter(p => p.driverId === currentDriverFilter);
    }
    if (currentSearchQuery) {
      filtered = filtered.filter(p =>
        p.barcode?.toLowerCase().includes(currentSearchQuery)
      );
    }
    renderPostList(`subtab-${status}`, filtered, true);
  });
}

function renderHomeSummary(posts) {
  const recent = posts.slice(0, 5);
  renderPostList('home-recent-posts', recent, false);
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
  }
}

function renderPostCard(post, showActions) {
  const statusBadge = `<span class="badge ${Utils.statusClass(post.status)}">${Utils.statusLabel(post.status)}</span>`;
  const actions = showActions ? `
    <div class="post-card-footer">
      <button class="btn btn-outline btn-sm btn-edit-post" data-id="${post.id}">✏️ دەستکاری</button>
      <button class="btn btn-danger btn-sm btn-delete-post" data-id="${post.id}">🗑️ سڕینەوە</button>
    </div>` : '';

  return `
    <div class="post-card status-${post.status}">
      <div class="post-card-header">
        <span class="post-barcode">#${Utils.escapeHtml(post.barcode)}</span>
        ${statusBadge}
      </div>
      <div class="post-card-body">
        <div class="post-row">
          <span class="label">سایەق:</span>
          <span class="value">${Utils.escapeHtml(post.driverName)}</span>
        </div>
        <div class="post-row">
          <span class="label">کڵێنت:</span>
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
          <span class="label">بەروار:</span>
          <span class="value" style="font-size:0.78rem;color:var(--text-muted);">${Utils.formatDate(post.adminScannedAt)}</span>
        </div>
      </div>
      ${post.photoUrl ? `<div class="post-photo"><img src="${post.photoUrl}" alt="وێنەی پۆست" onclick="window.open(this.src,'_blank')"></div>` : ''}
      ${actions}
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

function renderFilteredPosts() {
  db.collection('posts').orderBy('createdAt', 'desc').get().then(snapshot => {
    const posts = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAllSections(posts);
  });
}

// ── Driver Management ────────────────────────────────────────
async function loadDrivers() {
  allDrivers = await Auth.getAllDrivers();
  renderDriverList();
  populateDriverFilter();
}

function populateDriverFilter() {
  const sel = document.getElementById('driver-filter');
  sel.innerHTML = '<option value="">هەموو سایەقەکان</option>';
  allDrivers.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.uid;
    opt.textContent = d.name;
    sel.appendChild(opt);
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
  document.getElementById('df-name').value  = driver?.name  || '';
  document.getElementById('df-email').value = driver?.email || '';
  document.getElementById('df-password').value = '';

  // Password required only for new drivers
  const pwGroup = document.getElementById('df-password-group');
  const pwInput = document.getElementById('df-password');
  if (isEdit) {
    pwGroup.style.display = 'none';
    pwInput.required = false;
  } else {
    pwGroup.style.display = 'block';
    pwInput.required = true;
  }

  Utils.openModal('modal-driver-form');
}

async function handleDriverFormSubmit(e) {
  e.preventDefault();
  const uid      = document.getElementById('df-driver-uid').value;
  const name     = document.getElementById('df-name').value.trim();
  const email    = document.getElementById('df-email').value.trim();
  const password = document.getElementById('df-password').value;
  const isEdit   = !!uid;
  const btn      = document.getElementById('df-submit-btn');

  btn.disabled = true;
  Utils.showLoading(true);

  try {
    if (isEdit) {
      await Auth.updateDriver(uid, { name, email });
      Utils.showToast('سایەق نوێکرایەوە ✓', 'success');
    } else {
      if (password.length < 6) throw new Error('پاسوۆرد کەمترین 6 پیت دەبێت.');
      await Auth.createDriverAccount(email, password, name);
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
  const action  = isActive ? 'ناچالاককردن' : 'چالاككردن';
  const confirmed = await Utils.confirm(`دڵنیایت لە ${action}ی ئەم سایەقە؟`);
  if (!confirmed) return;

  Utils.showLoading(true);
  try {
    if (isActive) await Auth.deactivateDriver(uid);
    else          await Auth.reactivateDriver(uid);
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
  const posts    = snapshot.docs.map(d => d.data());

  const counts   = { ready: 0, with_driver: 0, completed: 0 };
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
  Utils.openModal('modal-photo-capture');
}

function setupPhotoCapture() {
  const input   = document.getElementById('photo-input');
  const takeBtn = document.getElementById('photo-take-btn');
  const skipBtn = document.getElementById('photo-skip-btn');

  takeBtn.addEventListener('click', () => input.click());

  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file || !pendingPhotoPostId) return;

    Utils.closeModal('modal-photo-capture');
    Utils.showLoading(true);

    try {
      const blob = await compressImage(file);
      const ref  = storage.ref(`posts/${pendingPhotoPostId}/photo.jpg`);
      await ref.put(blob);
      const url = await ref.getDownloadURL();
      await db.collection('posts').doc(pendingPhotoPostId).update({ photoUrl: url });
      Utils.showToast('وێنە پاشەکەوتکرا ✓', 'success');
    } catch (err) {
      Utils.showToast('هەڵە لە پاشەکەوتکردنی وێنە: ' + err.message, 'error');
    } finally {
      Utils.showLoading(false);
      pendingPhotoPostId = null;
    }
  });

  skipBtn.addEventListener('click', () => {
    Utils.closeModal('modal-photo-capture');
    pendingPhotoPostId = null;
  });
}

function compressImage(file, maxWidth = 800, quality = 0.65) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(file);
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => resolve(file);
      img.onload = () => {
        try {
          const ratio  = Math.min(maxWidth / img.width, 1);
          const canvas = document.createElement('canvas');
          canvas.width  = Math.round(img.width  * ratio);
          canvas.height = Math.round(img.height * ratio);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          // toDataURL is synchronous — never hangs unlike toBlob
          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          const bytes   = atob(dataUrl.split(',')[1]);
          const arr     = new Uint8Array(bytes.length);
          for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
          resolve(new Blob([arr], { type: 'image/jpeg' }));
        } catch (_) {
          resolve(file);
        }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}
