// ============================================================
// Auth Module
// Handles login, logout, and user session management
// ============================================================

const Auth = {

  // Convert phone number or email to valid email format
  normalizeEmail(input) {
    const v = input.trim();
    return v.includes('@') ? v : v + '@redpack.app';
  },

  // Login with email/phone and password
  async login(email, password) {
    const credential = await auth.signInWithEmailAndPassword(this.normalizeEmail(email), password);
    const userData = await this.getUserData(credential.user.uid);
    if (!userData) throw new Error('User record not found in database.');
    if (!userData.active) throw new Error('This account has been deactivated.');
    return { user: credential.user, userData };
  },

  // Logout current user
  async logout() {
    await auth.signOut();
    window.location.href = 'index.html';
  },

  // Get user document from Firestore
  async getUserData(uid) {
    const doc = await db.collection('Users').doc(uid).get();
    return doc.exists ? doc.data() : null;
  },

  // Listen to auth state changes
  onAuthStateChanged(callback) {
    return auth.onAuthStateChanged(callback);
  },

  // Create a driver account (uses secondary app to avoid logging out admin)
  async createDriverAccount(email, password, name, supervisorOf = []) {
    const normalizedEmail = this.normalizeEmail(email);
    const credential = await secondaryAuth.createUserWithEmailAndPassword(normalizedEmail, password);
    const uid = credential.user.uid;

    // Save driver data to Firestore
    await db.collection('Users').doc(uid).set({
      uid,
      name,
      email: normalizedEmail,
      role: 'driver',
      active: true,
      supervisorOf,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    // Sign out from secondary app immediately
    await secondaryAuth.signOut();

    return uid;
  },

  // Update driver account details
  async updateDriver(uid, data) {
    await db.collection('Users').doc(uid).update({
      ...data,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  },

  // Deactivate (soft-delete) a driver account
  async deactivateDriver(uid) {
    await db.collection('Users').doc(uid).update({ active: false });
  },

  // Reactivate a driver account
  async reactivateDriver(uid) {
    await db.collection('Users').doc(uid).update({ active: true });
  },

  // Get all drivers
  async getAllDrivers() {
    const snapshot = await db.collection('Users')
      .where('role', '==', 'driver')
      .get();
    const drivers = snapshot.docs.map(doc => doc.data());
    return drivers.sort((a, b) => a.name?.localeCompare(b.name) || 0);
  },

  // Guard: redirect if not logged in or wrong role
  async requireRole(expectedRole) {
    return new Promise((resolve, reject) => {
      auth.onAuthStateChanged(async (user) => {
        if (!user) {
          window.location.href = 'index.html';
          return reject('Not authenticated');
        }
        const userData = await this.getUserData(user.uid);
        if (!userData || userData.role !== expectedRole) {
          window.location.href = 'index.html';
          return reject('Wrong role');
        }
        resolve({ user, userData });
      });
    });
  }
};
