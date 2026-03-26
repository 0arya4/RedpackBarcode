// ============================================================
// Driver Page Logic
// ============================================================

let currentDriverUser = null;
let currentTab = 'uncollected';
let driverPostsCache = { uncollected: [], withme: [], completed: [] };
let pendingPhotoPostId = null;
let isSupervisorMode = false;
let supervisorDriverIds = [];
let supervisorDriverFilter = []; // selected driverIds for supervisor filter (empty = all)

// ── Init ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const { user, userData } = await Auth.requireRole('driver');
    currentDriverUser = userData;
    document.getElementById('driver-name').textContent = userData.name || 'سایەق';

    // Apply pending password reset set by admin
    if (userData.pendingPassword) {
      try {
        await user.updatePassword(userData.pendingPassword);
        await db.collection('Users').doc(user.uid).update({ pendingPassword: firebase.firestore.FieldValue.delete() });
      } catch (e) {
        console.warn('Password update failed:', e);
      }
    }

    isSupervisorMode = !!(userData.supervisorOf?.length);
    supervisorDriverIds = userData.supervisorOf || [];

    setupNavigation();
    setupScanner();
    setupPhotoCapture();
    setupSearch();
    if (isSupervisorMode) setupSupervisorFilter();
    startRealtimeListeners();
  } catch (e) {
    console.error('Driver init failed:', e);
  }
});

// ── Navigation ───────────────────────────────────────────────
function setupNavigation() {
  document.querySelectorAll('.nav-item[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(tabName) {
  currentTab = tabName;

  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));

  document.querySelector(`.nav-item[data-tab="${tabName}"]`).classList.add('active');
  document.getElementById(`tab-${tabName}`).classList.add('active');

  // Hide FAB + mini button on completed tab
  const fab = document.getElementById('driver-scan-fab');
  const mini = document.getElementById('driver-manual-btn');
  const show = tabName === 'uncollected' ? 'flex' : 'none';
  fab.style.display = show;
  mini.style.display = show;

  if (isSupervisorMode) renderAllFromCache();
}

// ── Search ───────────────────────────────────────────────────
function setupSearch() {
  ['uncollected', 'withme', 'completed'].forEach(section => {
    const input = document.getElementById(`search-${section}`);
    if (!input) return;
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      const filtered = driverPostsCache[section].filter(p =>
        p.barcode?.toLowerCase().includes(q)
      );
      renderDriverList(`list-${section}`, filtered, section);
    });
  });
}

// ── Supervisor Driver Filter ──────────────────────────────────
async function setupSupervisorFilter() {
  const bar = document.getElementById('supervisor-filter-bar');
  if (!bar) return;

  bar.style.display = 'block';

  const allIds = [currentDriverUser.uid, ...supervisorDriverIds];
  const snap = await db.collection('Users').where('role', '==', 'driver').get();

  const options = snap.docs
    .filter(d => allIds.includes(d.id))
    .map(d => ({ value: d.id, label: d.data().name }));

  Utils.buildMultiSelect('supervisor-driver-filter', options, (selected) => {
    supervisorDriverFilter = selected;
    renderAllFromCache();
  });
}

function renderAllFromCache() {
  const filterPosts = posts => supervisorDriverFilter.length
    ? posts.filter(p => supervisorDriverFilter.includes(p.driverId))
    : posts;

  const fu = filterPosts(driverPostsCache.uncollected);
  const fw = filterPosts(driverPostsCache.withme);
  const fc = filterPosts(driverPostsCache.completed);

  renderDriverList('list-uncollected', fu, 'uncollected');
  renderDriverList('list-withme',      fw, 'withme');
  renderDriverList('list-completed',   fc, 'completed');

  const countEl = document.getElementById('supervisor-post-count');
  if (countEl) {
    if (supervisorDriverFilter.length) {
      countEl.style.display = 'block';
      const visibleCount = currentTab === 'uncollected' ? fu.length : currentTab === 'withme' ? fw.length : fc.length;
      countEl.textContent = `${visibleCount} پۆست دۆزرایەوە`;
    } else {
      countEl.style.display = 'none';
    }
  }
}

// ── Barcode Scanner ──────────────────────────────────────────
function setupScanner() {
  document.getElementById('driver-scan-fab').addEventListener('click', openDriverScanner);
  document.getElementById('driver-scanner-close').addEventListener('click', closeDriverScanner);
  document.getElementById('driver-manual-btn').addEventListener('click', () => {
    document.getElementById('driver-manual-input').value = '';
    const overlay = document.getElementById('driver-manual-overlay');
    overlay.style.display = 'flex';
    setTimeout(() => document.getElementById('driver-manual-input').focus(), 100);
  });
  document.getElementById('driver-manual-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitDriverManual();
  });
}

async function submitDriverManual() {
  const val = document.getElementById('driver-manual-input').value.trim();
  if (!val) return;
  document.getElementById('driver-manual-overlay').style.display = 'none';
  await handleDriverScan(val);
}

async function openDriverScanner() {
  Utils.openModal('modal-driver-scanner');
  try {
    await BarcodeScanner.start('driver-scanner-view', handleDriverScan);
  } catch (e) {
    Utils.closeModal('modal-driver-scanner');
  }
}

async function closeDriverScanner() {
  await BarcodeScanner.stop();
  Utils.closeModal('modal-driver-scanner');
}

async function handleDriverScan(barcodeValue) {
  await BarcodeScanner.stop();
  Utils.closeModal('modal-driver-scanner');
  Utils.showLoading(true);

  const allIds = [currentDriverUser.uid, ...supervisorDriverIds];

  try {
    // Fetch by barcode only, filter client-side to avoid composite index
    const anySnapshot = await db.collection('posts')
      .where('barcode', '==', barcodeValue)
      .get();

    if (anySnapshot.empty) {
      // No admin scan yet — verify barcode exists in Red Pack system via API
      const prefill = await RedPackAPI.getOrderByBarcode(barcodeValue);
      if (!prefill) {
        Utils.showToast('ئەم باڕکۆدە لە سیستەمدا نییە', 'error');
        return;
      }
      // API confirmed barcode is real — create post assigned to this driver
      const newRef = db.collection('posts').doc();
      await newRef.set({
        barcode:          barcodeValue,
        driverId:         currentDriverUser.uid,
        driverName:       currentDriverUser.name,
        status:           'with_driver',
        directDriverScan: true,
        photoAdmin:       null,
        adminScannedAt:   null,
        driverScannedAt:  firebase.firestore.FieldValue.serverTimestamp(),
        completedAt:      null,
        clientName:       prefill.clientName    || '',
        clientPhone:      prefill.clientPhone   || '',
        receiverPhone:    prefill.receiverPhone || '',
        address:          prefill.address       || '',
        price:            prefill.price         || 0,
        quantity:         prefill.quantity      || 1,
        note:             prefill.note          || '',
        createdAt:        firebase.firestore.FieldValue.serverTimestamp(),
        createdBy:        'driver'
      });
      switchTab('withme');
      openPhotoCaptureModal(newRef.id);
      return;
    }

    // Find a matching post: must belong to our scope AND be ready
    const matchDoc = anySnapshot.docs.find(doc => {
      const d = doc.data();
      return allIds.includes(d.driverId) && d.status === 'ready';
    });

    if (!matchDoc) {
      const post = anySnapshot.docs[0].data();
      if (!allIds.includes(post.driverId)) {
        Utils.showToast('ئەم پۆستە بۆ سایەقی تر دیاریکراوە', 'error');
      } else if (post.status === 'with_driver') {
        Utils.showToast('ئەم پۆستە پێشتر باڕکۆدکراوە', 'error');
      } else if (post.status === 'completed') {
        Utils.showToast('ئەم پۆستە تەواوبووە', 'error');
      } else {
        Utils.showToast('باڕکۆد نەدۆزرایەوە', 'error');
      }
      return;
    }

    const postId = matchDoc.id;
    await matchDoc.ref.update({
      status: 'with_driver',
      driverScannedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    Utils.showToast('پۆست وەرگیرا ✓ — لای من', 'success');
    switchTab('withme');
    openPhotoCaptureModal(postId);

  } catch (err) {
    console.error(err);
    Utils.showToast('هەڵەیەک ڕوویدا: ' + err.message, 'error');
  } finally {
    Utils.showLoading(false);
  }
}

// ── Photo Capture ────────────────────────────────────────────
function openPhotoCaptureModal(postId) {
  pendingPhotoPostId = postId;
  document.getElementById('photo-input').value = '';
  const overlay = document.getElementById('photo-overlay');
  overlay.style.display = 'flex';
}

function setupPhotoCapture() {
  const input = document.getElementById('photo-input');

  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file || !pendingPhotoPostId) return;

    document.getElementById('photo-overlay').style.display = 'none';
    Utils.showLoading(true);

    const postId = pendingPhotoPostId;
    pendingPhotoPostId = null;

    try {
      const base64 = await compressToBase64(file);
      await db.collection('posts').doc(postId).update({ photoDriver: base64 });
      Utils.showBanner('✅ پۆست هەڵگیرا و وێنە گیرا');
      switchTab('uncollected');
      setTimeout(() => openDriverScanner(), 1000);
    } catch (err) {
      Utils.showToast('هەڵە: ' + err.message, 'error');
    } finally {
      Utils.showLoading(false);
    }
  });

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

// ── Complete all posts ───────────────────────────────────────
async function completeAllPosts() {
  let posts = driverPostsCache.withme.filter(p => !p.underReview);
  if (supervisorDriverFilter.length) posts = posts.filter(p => supervisorDriverFilter.includes(p.driverId));
  if (!posts.length) return;

  const confirmed = await Utils.confirm(`دڵنیایت لە تەواوکردنی هەموو ${posts.length} پۆستەکان؟`);
  if (!confirmed) return;

  Utils.showLoading(true);
  try {
    const batch = db.batch();
    const now = firebase.firestore.FieldValue.serverTimestamp();
    posts.forEach(p => {
      batch.update(db.collection('posts').doc(p.id), { status: 'completed', completedAt: now });
    });
    await batch.commit();
    Utils.showToast(`${posts.length} پۆستەکان تەواوبوون ✓`, 'success');
  } catch (err) {
    Utils.showToast('هەڵەیەک ڕوویدا', 'error');
  }
  Utils.showLoading(false);
}

// ── Complete a post ──────────────────────────────────────────
async function completePost(postId) {
  const post = driverPostsCache.withme.find(p => p.id === postId);
  if (post?.underReview) {
    Utils.showToast('ئەم پۆستە لەژێر بەدواداچووندایە', 'error');
    return;
  }
  const confirmed = await Utils.confirm('دڵنیایت لە تەواوکردنی ئەم پۆستە؟');
  if (!confirmed) return;

  Utils.showLoading(true);
  try {
    await db.collection('posts').doc(postId).update({
      status: 'completed',
      completedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    Utils.showToast('پۆست تەواوبوو ✓', 'success');
  } catch (err) {
    Utils.showToast('هەڵەیەک ڕوویدا', 'error');
  }
  Utils.showLoading(false);
}

// ── Real-time Listeners ──────────────────────────────────────
function startRealtimeListeners() {
  const myId = currentDriverUser.uid;
  const allIds = [myId, ...supervisorDriverIds];

  // Build query — use 'in' for supervisor, '==' for regular driver
  let query = db.collection('posts');
  if (allIds.length === 1) {
    query = query.where('driverId', '==', myId);
  } else {
    query = query.where('driverId', 'in', allIds);
  }

  query.onSnapshot(snapshot => {
    const posts = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

    const uncollected = posts
      .filter(p => p.status === 'ready')
      .sort((a, b) => (b.adminScannedAt?.toMillis?.() || 0) - (a.adminScannedAt?.toMillis?.() || 0));

    const withMe = posts
      .filter(p => p.status === 'with_driver')
      .sort((a, b) => {
        if (b.underReview && !a.underReview) return 1;
        if (a.underReview && !b.underReview) return -1;
        return (b.driverScannedAt?.toMillis?.() || 0) - (a.driverScannedAt?.toMillis?.() || 0);
      });

    const completed = posts
      .filter(p => p.status === 'completed')
      .sort((a, b) => (b.completedAt?.toMillis?.() || 0) - (a.completedAt?.toMillis?.() || 0));

    driverPostsCache.uncollected = uncollected;
    driverPostsCache.withme = withMe;
    driverPostsCache.completed = completed;

    // Badges always reflect total counts (unfiltered)
    updateBadge('badge-uncollected', uncollected.length);
    updateBadge('badge-withme', withMe.length);
    const completeAllBtn = document.getElementById('complete-all-btn');
    if (completeAllBtn) completeAllBtn.style.display = withMe.length > 1 ? 'block' : 'none';

    // Render with active supervisor filter if set
    const applyFilter = posts => (isSupervisorMode && supervisorDriverFilter.length)
      ? posts.filter(p => supervisorDriverFilter.includes(p.driverId))
      : posts;

    renderDriverList('list-uncollected', applyFilter(uncollected), 'uncollected');
    renderDriverList('list-withme', applyFilter(withMe), 'withme');
    renderDriverList('list-completed', applyFilter(completed), 'completed');

    autoCompleteOldPosts(withMe);
  });
}

async function autoCompleteOldPosts(withMePosts) {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const old = withMePosts.filter(p => {
    if (p.underReview) return false;
    const t = p.driverScannedAt?.toDate ? p.driverScannedAt.toDate() : p.driverScannedAt ? new Date(p.driverScannedAt) : null;
    return t && t < cutoff;
  });
  if (!old.length) return;
  const batch = db.batch();
  const now = firebase.firestore.FieldValue.serverTimestamp();
  old.forEach(p => batch.update(db.collection('posts').doc(p.id), { status: 'completed', completedAt: now }));
  await batch.commit();
}

function updateBadge(badgeId, count) {
  const badge = document.getElementById(badgeId);
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

// ── Render Post List ─────────────────────────────────────────
function renderDriverList(containerId, posts, section) {
  const el = document.getElementById(containerId);
  if (!el) return;

  if (posts.length === 0) {
    const emptyMessages = {
      uncollected: { icon: '📥', title: 'هیچ پۆستێک نییە', text: 'هەموو پۆستەکانت وەرگیراون' },
      withme: { icon: '🚗', title: 'هیچ پۆستێک لات نییە', text: 'باڕکۆدی پۆستەکان بکە' },
      completed: { icon: '✅', title: 'هیچ پۆستی تەواوبووێک نییە', text: '' }
    };
    const msg = emptyMessages[section] || emptyMessages.uncollected;
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${msg.icon}</div>
        <div class="empty-title">${msg.title}</div>
        ${msg.text ? `<div class="empty-text">${msg.text}</div>` : ''}
      </div>`;
    return;
  }

  el.innerHTML = posts.map(post => renderDriverPostCard(post, section)).join('');

  // Attach complete button listeners
  if (section === 'withme') {
    el.querySelectorAll('.btn-complete-post').forEach(btn => {
      btn.addEventListener('click', () => completePost(btn.dataset.id));
    });
  }
}

function renderDriverPostCard(post, section) {
  const completeBtn = section === 'withme' ? `
    <div class="post-card-footer">
      <button class="btn btn-success btn-full btn-complete-post" data-id="${post.id}" onclick="event.stopPropagation()">
        ✅ تەواوکردن
      </button>
    </div>` : '';

  const driverTag = isSupervisorMode
    ? `<span style="font-size:0.72rem;background:var(--primary);color:#fff;padding:1px 6px;border-radius:10px;margin-right:4px;">${Utils.escapeHtml(post.driverName)}</span>`
    : '';

  return `
    <div class="post-card status-${post.status}${post.underReview ? ' under-review' : ''}" onclick="this.classList.toggle('expanded')">
      <div class="post-card-summary">
        <div class="post-summary-main">
          <div class="post-summary-barcode" data-barcode="${Utils.escapeHtml(post.barcode)}">${driverTag}#${Utils.escapeHtml(post.barcode)}</div>
          <div class="post-summary-sub">${Utils.escapeHtml(post.clientName)} · ${Utils.escapeHtml(post.address)}</div>
          ${post.underReview ? `<div style="color:#C62828;font-weight:700;font-size:0.78rem;margin-top:2px;">⚠️ ئەم پۆستە لەژێر چێک کردنەوەدایە</div>` : ''}
        </div>
        <span class="badge ${Utils.statusClass(post.status)}">${Utils.statusLabel(post.status)}</span>
        <span class="post-chevron">▼</span>
      </div>
      <div class="post-card-details">
        <div class="post-card-body">
          <div class="post-row">
            <span class="label">کڵاینت:</span>
            <span class="value">${Utils.escapeHtml(post.clientName)}</span>
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
            <span class="label">باڕکۆد ئۆفیس:</span>
            <span class="value" style="font-size:0.78rem;color:var(--text-muted);">${Utils.formatDate(post.adminScannedAt)}</span>
          </div>
          ${post.driverScannedAt ? `
          <div class="post-row">
            <span class="label">باڕکۆد سایەق:</span>
            <span class="value" style="font-size:0.78rem;color:var(--text-muted);">${Utils.formatDate(post.driverScannedAt)}</span>
          </div>` : ''}
        </div>
        ${post.photoAdmin ? `<div class="post-photo"><div class="photo-label">📦 وێنەی بەریدەکە</div><img src="${post.photoAdmin}" alt="وێنەی ئەدمین" onclick="event.stopPropagation();Utils.openPhoto(this.src)"></div>` : ''}
        ${post.photoDriver ? `<div class="post-photo"><div class="photo-label">🚗 وێنەی لای سایەق</div><img src="${post.photoDriver}" alt="وێنەی سایەق" onclick="event.stopPropagation();Utils.openPhoto(this.src)"></div>` : ''}
        ${completeBtn}
      </div>
    </div>`;
}
