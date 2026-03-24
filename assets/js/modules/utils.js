// ============================================================
// Utility Module
// Shared helper functions used across admin and driver pages
// ============================================================

const Utils = {

  // Format Firestore timestamp to readable date/time string
  formatDate(timestamp) {
    if (!timestamp) return '—';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const d = date.toLocaleDateString('en-GB'); // DD/MM/YYYY
    const t = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return `${d} ${t}`;
  },

  // Format price with IQD suffix
  formatPrice(amount, quantity = 1) {
    const total = Number(amount).toLocaleString();
    return `${total} IQD (${quantity} دانە)`;
  },

  // Show a toast notification
  showToast(message, type = 'info') {
    const existing = document.querySelectorAll('.toast');
    existing.forEach(t => t.remove());

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => toast.classList.add('show'));

    // Remove after 3 seconds
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  },

  // Show/hide full-screen loading overlay
  showLoading(show) {
    const loader = document.getElementById('loading-overlay');
    if (loader) loader.style.display = show ? 'flex' : 'none';
  },

  // Vibrate device on successful scan (mobile feedback)
  vibrate() {
    if ('vibrate' in navigator) navigator.vibrate(100);
  },

  // Open a modal by ID
  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('active');
      document.body.style.overflow = 'hidden';
    }
  },

  // Close a modal by ID
  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('active');
      document.body.style.overflow = '';
    }
  },

  // Close all open modals
  closeAllModals() {
    document.querySelectorAll('.modal.active').forEach(m => {
      m.classList.remove('active');
    });
    document.body.style.overflow = '';
  },

  // Confirm dialog (returns Promise<boolean>)
  confirm(message) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      overlay.innerHTML = `
        <div class="confirm-box">
          <p>${message}</p>
          <div class="confirm-actions">
            <button class="btn btn-danger" id="confirm-yes">بەڵێ</button>
            <button class="btn btn-secondary" id="confirm-no">نەخێر</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add('active'));

      overlay.querySelector('#confirm-yes').onclick = () => {
        overlay.remove();
        resolve(true);
      };
      overlay.querySelector('#confirm-no').onclick = () => {
        overlay.remove();
        resolve(false);
      };
    });
  },

  // Initialize theme from saved preference
  initTheme() {
    const saved = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', saved);
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.textContent = saved === 'dark' ? '☀️' : '🌙';
  },

  // Show a prominent top banner (for scan success)
  showBanner(message) {
    const existing = document.getElementById('success-banner');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.id = 'success-banner';
    banner.textContent = message;
    banner.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; z-index: 9998;
      background: #2E7D32; color: #fff;
      text-align: center; padding: 14px 16px;
      font-size: 1rem; font-weight: 700;
      transform: translateY(-100%);
      transition: transform 0.3s ease;
    `;
    document.body.appendChild(banner);
    requestAnimationFrame(() => banner.style.transform = 'translateY(0)');
    setTimeout(() => {
      banner.style.transform = 'translateY(-100%)';
      setTimeout(() => banner.remove(), 300);
    }, 2500);
  },

  // Open photo in fullscreen lightbox
  openPhoto(src) {
    const lb = document.createElement('div');
    lb.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
    lb.innerHTML = `<img src="${src}" style="max-width:100%;max-height:100%;border-radius:8px;object-fit:contain;">`;
    lb.addEventListener('click', () => lb.remove());
    document.body.appendChild(lb);
  },

  // Escape HTML to prevent XSS
  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  // Get status label in Kurdish
  statusLabel(status) {
    const labels = {
      ready:       'ئامادەی سایەق',
      with_driver: 'لای سایەق',
      completed:   'تەواوبوو'
    };
    return labels[status] || status;
  },

  // Get status CSS class
  statusClass(status) {
    const classes = {
      ready:       'badge-warning',
      with_driver: 'badge-info',
      completed:   'badge-success'
    };
    return classes[status] || '';
  }
};
