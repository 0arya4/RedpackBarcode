// ============================================================
// Driver Page Logic
// ============================================================

let currentDriverUser = null;
let currentTab = 'uncollected';
let driverPostsCache = { uncollected: [], withme: [], completed: [] };
let pendingPhotoPostId = null;

// ── Init ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const { userData } = await Auth.requireRole('driver');
    currentDriverUser = userData;
    document.getElementById('driver-name').textContent = userData.name || 'سایەق';

    setupNavigation();
    setupScanner();
    setupPhotoCapture();
    setupSearch();
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
  fab.style.display = tabName === 'completed' ? 'none' : 'flex';
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

  try {
    // Find post with this barcode assigned to this driver with status "ready"
    const snapshot = await db.collection('posts')
      .where('barcode', '==', barcodeValue)
      .where('driverId', '==', currentDriverUser.uid)
      .where('status', '==', 'ready')
      .limit(1)
      .get();

    if (snapshot.empty) {
      // Check if it exists but is wrong status or wrong driver
      const anySnapshot = await db.collection('posts')
        .where('barcode', '==', barcodeValue)
        .limit(1)
        .get();

      if (anySnapshot.empty) {
        Utils.showToast('ئەم باڕکۆدە لە سیستەمدا نییە', 'error');
      } else {
        const post = anySnapshot.docs[0].data();
        if (post.driverId !== currentDriverUser.uid) {
          Utils.showToast('ئەم پۆستە بۆ سایەقی تر دیاریکراوە', 'error');
        } else if (post.status === 'with_driver') {
          Utils.showToast('ئەم پۆستە پێشتر باڕکۆدکراوە', 'error');
        } else if (post.status === 'completed') {
          Utils.showToast('ئەم پۆستە تەواوبووە', 'error');
        } else {
          Utils.showToast('باڕکۆد نەدۆزرایەوە', 'error');
        }
      }
      return;
    }

    const docRef = snapshot.docs[0].ref;
    const postId = snapshot.docs[0].id;
    await docRef.update({
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

    const postId = pendingPhotoPostId;
    pendingPhotoPostId = null;

    try {
      const base64 = await compressToBase64(file);
      await db.collection('posts').doc(postId).update({ photoDriver: base64 });
      Utils.showToast('وێنە پاشەکەوتکرا ✓', 'success');
    } catch (err) {
      Utils.showToast('هەڵە: ' + err.message, 'error');
    } finally {
      Utils.showLoading(false);
    }
  });

  skipBtn.addEventListener('click', () => {
    Utils.closeModal('modal-photo-capture');
    pendingPhotoPostId = null;
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
  const driverId = currentDriverUser.uid;

  // Listen to all posts for this driver — sort client-side to avoid index requirement
  db.collection('posts')
    .where('driverId', '==', driverId)
    .onSnapshot(snapshot => {
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

      renderDriverList('list-uncollected', uncollected, 'uncollected');
      updateBadge('badge-uncollected', uncollected.length);

      renderDriverList('list-withme', withMe, 'withme');
      updateBadge('badge-withme', withMe.length);

      renderDriverList('list-completed', completed, 'completed');
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
      <button class="btn btn-success btn-full btn-complete-post" data-id="${post.id}">
        ✅ تەواوکردن
      </button>
    </div>` : '';

  return `
    <div class="post-card status-${post.status}">
      <div class="post-card-header">
        <span class="post-barcode">#${Utils.escapeHtml(post.barcode)}</span>
        <span class="badge ${Utils.statusClass(post.status)}">${Utils.statusLabel(post.status)}</span>
      </div>
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
      ${post.photoAdmin ? `<div class="post-photo"><div class="photo-label">📦 وێنەی پاکەت</div><img src="${post.photoAdmin}" alt="وێنەی ئەدمین" onclick="Utils.openPhoto(this.src)"></div>` : ''}
      ${post.photoDriver ? `<div class="post-photo"><div class="photo-label">🚗 وێنەی گەیاندن</div><img src="${post.photoDriver}" alt="وێنەی سایەق" onclick="Utils.openPhoto(this.src)"></div>` : ''}
      ${completeBtn}
    </div>`;
}
