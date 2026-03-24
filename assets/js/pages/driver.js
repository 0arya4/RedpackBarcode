// ============================================================
// Driver Page Logic
// ============================================================

let currentDriverUser = null;
let currentTab = 'uncollected';
let driverPostsCache = { uncollected: [], withme: [], completed: [] };
let pendingPhotoPostId = null;
let isSupervisorMode = false;
let supervisorDriverIds = [];
let supervisorDriverFilter = ''; // selected driverId filter for supervisor

// ── Init ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const { userData } = await Auth.requireRole('driver');
    currentDriverUser = userData;
    document.getElementById('driver-name').textContent = userData.name || 'سایەق';

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

  // Hide FAB on completed tab
  const fab = document.getElementById('driver-scan-fab');
  fab.style.display = tabName === 'uncollected' ? 'flex' : 'none';
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
  const sel = document.getElementById('supervisor-driver-filter');
  if (!bar || !sel) return;

  bar.style.display = 'block';

  // Load names for supervised driver UIDs
  const allIds = [currentDriverUser.uid, ...supervisorDriverIds];
  const snap = await db.collection('Users')
    .where('role', '==', 'driver')
    .get();

  sel.innerHTML = '<option value="">هەموو سایەقەکان</option>';
  snap.docs
    .filter(d => allIds.includes(d.id))
    .forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = d.data().name;
      sel.appendChild(opt);
    });

  sel.addEventListener('change', () => {
    supervisorDriverFilter = sel.value;
    renderAllFromCache();
  });
}

function renderAllFromCache() {
  const filter = supervisorDriverFilter;

  const filterPosts = posts => filter
    ? posts.filter(p => p.driverId === filter)
    : posts;

  renderDriverList('list-uncollected', filterPosts(driverPostsCache.uncollected), 'uncollected');
  renderDriverList('list-withme',      filterPosts(driverPostsCache.withme),      'withme');
  renderDriverList('list-completed',   filterPosts(driverPostsCache.completed),   'completed');
}

// ── Barcode Scanner ──────────────────────────────────────────
function setupScanner() {
  document.getElementById('driver-scan-fab').addEventListener('click', openDriverScanner);
  document.getElementById('driver-scanner-close').addEventListener('click', closeDriverScanner);
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
      Utils.showToast('ئەم باڕکۆدە لە سیستەمدا نییە', 'error');
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
      status:          'with_driver',
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
        const ratio  = Math.min(maxWidth / img.width, 1);
        const canvas = document.createElement('canvas');
        canvas.width  = Math.round(img.width  * ratio);
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
  const posts = driverPostsCache.withme;
  if (!posts.length) return;

  const confirmed = await Utils.confirm(`دڵنیایت لە تەواوکردنی هەموو ${posts.length} پۆستەکە؟`);
  if (!confirmed) return;

  Utils.showLoading(true);
  try {
    const batch = db.batch();
    const now   = firebase.firestore.FieldValue.serverTimestamp();
    posts.forEach(p => {
      batch.update(db.collection('posts').doc(p.id), { status: 'completed', completedAt: now });
    });
    await batch.commit();
    Utils.showToast(`${posts.length} پۆست تەواوبوون ✓`, 'success');
  } catch (err) {
    Utils.showToast('هەڵەیەک ڕوویدا', 'error');
  }
  Utils.showLoading(false);
}

// ── Complete a post ──────────────────────────────────────────
async function completePost(postId) {
  const confirmed = await Utils.confirm('دڵنیایت لە تەواوکردنی ئەم پۆستە؟');
  if (!confirmed) return;

  Utils.showLoading(true);
  try {
    await db.collection('posts').doc(postId).update({
      status:      'completed',
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
      .sort((a, b) => (b.driverScannedAt?.toMillis?.() || 0) - (a.driverScannedAt?.toMillis?.() || 0));

    const completed = posts
      .filter(p => p.status === 'completed')
      .sort((a, b) => (b.completedAt?.toMillis?.() || 0) - (a.completedAt?.toMillis?.() || 0));

    driverPostsCache.uncollected = uncollected;
    driverPostsCache.withme      = withMe;
    driverPostsCache.completed   = completed;

    // Badges always reflect total counts (unfiltered)
    updateBadge('badge-uncollected', uncollected.length);
    updateBadge('badge-withme', withMe.length);
    const completeAllBtn = document.getElementById('complete-all-btn');
    if (completeAllBtn) completeAllBtn.style.display = withMe.length > 1 ? 'block' : 'none';

    // Render with active supervisor filter if set
    const applyFilter = posts => (isSupervisorMode && supervisorDriverFilter)
      ? posts.filter(p => p.driverId === supervisorDriverFilter)
      : posts;

    renderDriverList('list-uncollected', applyFilter(uncollected), 'uncollected');
    renderDriverList('list-withme',      applyFilter(withMe),      'withme');
    renderDriverList('list-completed',   applyFilter(completed),   'completed');
  });
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
      withme:      { icon: '🚗', title: 'هیچ پۆستێک لات نییە', text: 'باڕکۆدی پۆستەکان بکە' },
      completed:   { icon: '✅', title: 'هیچ پۆستی تەواوبووێک نییە', text: '' }
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
    <div class="post-card status-${post.status}" onclick="this.classList.toggle('expanded')">
      <div class="post-card-summary">
        <div class="post-summary-main">
          <div class="post-summary-barcode">${driverTag}#${Utils.escapeHtml(post.barcode)}</div>
          <div class="post-summary-sub">${Utils.escapeHtml(post.clientName)} · ${Utils.escapeHtml(post.address)}</div>
        </div>
        <span class="badge ${Utils.statusClass(post.status)}">${Utils.statusLabel(post.status)}</span>
        <span class="post-chevron">▼</span>
      </div>
      <div class="post-card-details">
        <div class="post-card-body">
          <div class="post-row">
            <span class="label">کڵێنت:</span>
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
        ${post.photoAdmin ? `<div class="post-photo"><div class="photo-label">📦 وێنەی پاکەت</div><img src="${post.photoAdmin}" alt="وێنەی ئەدمین" onclick="event.stopPropagation();Utils.openPhoto(this.src)"></div>` : ''}
        ${post.photoDriver ? `<div class="post-photo"><div class="photo-label">🚗 وێنەی گەیاندن</div><img src="${post.photoDriver}" alt="وێنەی سایەق" onclick="event.stopPropagation();Utils.openPhoto(this.src)"></div>` : ''}
        ${completeBtn}
      </div>
    </div>`;
}
