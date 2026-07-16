const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { db, auth } = require('./firebaseAdmin');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FIREBASE_WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY;

const AVATAR_ROOT = path.join(__dirname, 'uploads', 'avatars');
fs.mkdirSync(AVATAR_ROOT, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'image/png' || file.mimetype === 'image/jpeg') {
      cb(null, true);
    } else {
      cb(new Error('INVALID_FILE_TYPE'));
    }
  },
});

// Same auth guard pattern as wardrobeRoutes.js
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Autentificare necesară.' });

    const decoded = await auth.verifyIdToken(token);
    req.uid = decoded.uid;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sesiune invalidă sau expirată.' });
  }
}

async function signInWithPassword(email, password) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_WEB_API_KEY}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || 'AUTH_FAILED');
  }
  return data;
}

function removeExistingAvatarFiles(uid, keepExt) {
  ['png', 'jpg', 'jpeg'].forEach((ext) => {
    if (ext === keepExt) return;
    const p = path.join(AVATAR_ROOT, `${uid}.${ext}`);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });
}

// GET /api/profile  -> returns the logged-in user's profile from Firestore
router.get('/profile', requireAuth, async (req, res) => {
  try {
    const doc = await db.collection('users').doc(req.uid).get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Utilizator negăsit.' });
    }
    const data = doc.data();
    return res.status(200).json({
      firstName: data.firstName || '',
      lastName: data.lastName || '',
      email: data.email || '',
      photoUrl: data.photoUrl || null,
    });
  } catch (err) {
    console.error('Get profile error:', err);
    return res.status(500).json({ error: 'Nu s-a putut încărca profilul.' });
  }
});

// PUT /api/profile  body: { firstName, lastName, email }
router.put('/profile', requireAuth, async (req, res) => {
  try {
    const { firstName, lastName, email } = req.body || {};

    if (!firstName || !lastName) {
      return res.status(400).json({ error: 'Prenumele și numele sunt obligatorii.' });
    }
    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Introdu o adresă de email validă.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const userRef = db.collection('users').doc(req.uid);
    const userDoc = await userRef.get();
    const currentEmail = userDoc.exists ? userDoc.data().email : null;

    // If the email is changing, make sure nobody else already uses it,
    // then update it in Firebase Authentication too (source of truth for login).
    if (normalizedEmail !== currentEmail) {
      const existing = await db.collection('users').where('email', '==', normalizedEmail).limit(1).get();
      if (!existing.empty && existing.docs[0].id !== req.uid) {
        return res.status(409).json({ error: 'Există deja un cont cu acest email.' });
      }
      await auth.updateUser(req.uid, {
        email: normalizedEmail,
        displayName: `${firstName} ${lastName}`,
      });
    } else {
      await auth.updateUser(req.uid, { displayName: `${firstName} ${lastName}` });
    }

    await userRef.set(
      {
        firstName,
        lastName,
        email: normalizedEmail,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    return res.status(200).json({ firstName, lastName, email: normalizedEmail });
  } catch (err) {
    console.error('Update profile error:', err);
    if (err.code === 'auth/email-already-exists') {
      return res.status(409).json({ error: 'Există deja un cont cu acest email.' });
    }
    if (err.code === 'auth/invalid-email') {
      return res.status(400).json({ error: 'Adresa de email nu este validă.' });
    }
    return res.status(500).json({ error: 'Nu s-au putut salva modificările.' });
  }
});

// POST /api/profile/avatar  multipart/form-data, field name "avatar"
router.post('/profile/avatar', requireAuth, (req, res) => {
  upload.single('avatar')(req, res, async (err) => {
    if (err) {
      const msg = err.message === 'INVALID_FILE_TYPE'
        ? 'Doar imagini PNG sau JPG sunt acceptate.'
        : 'Imaginea este prea mare (limită 5MB).';
      return res.status(400).json({ error: msg });
    }
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Nicio imagine trimisă.' });
      }

      const ext = req.file.mimetype === 'image/png' ? 'png' : 'jpg';
      const fileName = `${req.uid}.${ext}`;
      const absolutePath = path.join(AVATAR_ROOT, fileName);

      removeExistingAvatarFiles(req.uid, ext);
      fs.writeFileSync(absolutePath, req.file.buffer);

      const photoUrl = `/uploads/avatars/${fileName}?v=${Date.now()}`; // cache-bust on change

      await db.collection('users').doc(req.uid).set({ photoUrl }, { merge: true });

      return res.status(200).json({ photoUrl });
    } catch (innerErr) {
      console.error('Avatar upload error:', innerErr);
      return res.status(500).json({ error: 'Nu s-a putut încărca poza.' });
    }
  });
});

// POST /api/change-password  body: { currentPassword, newPassword }
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Completează ambele câmpuri.' });
    }
    if (newPassword.length < 8 || !/[0-9]/.test(newPassword) || !/[a-zA-Z]/.test(newPassword)) {
      return res.status(400).json({
        error: 'Parola nouă trebuie să aibă minim 8 caractere și să conțină cel puțin o literă și o cifră.',
      });
    }

    const userRecord = await auth.getUser(req.uid);
    const email = userRecord.email;

    // Verify the current password is correct via Firebase's REST sign-in endpoint
    try {
      await signInWithPassword(email, currentPassword);
    } catch (verifyErr) {
      return res.status(401).json({ error: 'Parola curentă este incorectă.' });
    }

    await auth.updateUser(req.uid, { password: newPassword });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Change password error:', err);
    return res.status(500).json({ error: 'Nu s-a putut actualiza parola.' });
  }
});

// DELETE /api/delete-account
router.delete('/delete-account', requireAuth, async (req, res) => {
  const uid = req.uid;
  try {
    // 1) Delete every wardrobe item (Firestore docs + the image files on disk)
    const wardrobeSnap = await db.collection('users').doc(uid).collection('wardrobe').get();
    await Promise.all(
      wardrobeSnap.docs.map(async (docSnap) => {
        const { imageUrl } = docSnap.data();
        if (imageUrl) {
          const absolutePath = path.join(__dirname, imageUrl.split('?')[0].replace(/^\//, ''));
          fs.unlink(absolutePath, () => {}); // best-effort
        }
        await docSnap.ref.delete();
      })
    );

    // 2) Delete the avatar file, if any
    removeExistingAvatarFiles(uid, null);

    // 3) Delete the Firestore user document
    await db.collection('users').doc(uid).delete();

    // 4) Delete the Firebase Authentication account itself
    await auth.deleteUser(uid);

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Delete account error:', err);
    return res.status(500).json({ error: 'Nu s-a putut șterge contul. Încearcă din nou.' });
  }
});

module.exports = router;