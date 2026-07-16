const express = require('express');
const multer = require('multer');
const { db, auth } = require('./firebaseAdmin');
const { uploadBuffer, deleteAsset } = require('./cloudinaryClient');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FIREBASE_WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY;

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

      const userRef = db.collection('users').doc(req.uid);
      const userDoc = await userRef.get();
      const oldPublicId = userDoc.exists ? userDoc.data().photoPublicId : null;

      const result = await uploadBuffer(req.file.buffer, `avatars/${req.uid}`);

      // remove the old avatar only after the new one uploaded successfully
      await deleteAsset(oldPublicId);

      await userRef.set(
        { photoUrl: result.secure_url, photoPublicId: result.public_id },
        { merge: true }
      );

      return res.status(200).json({ photoUrl: result.secure_url });
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
      return res.status(401).json({ error: 'Current password is incorrect.' });
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
    const wardrobeSnap = await db.collection('users').doc(uid).collection('wardrobe').get();
    await Promise.all(
      wardrobeSnap.docs.map(async (docSnap) => {
        const { imagePublicId } = docSnap.data();
        await deleteAsset(imagePublicId); // best-effort
        await docSnap.ref.delete();
      })
    );

    const userDoc = await db.collection('users').doc(uid).get();
    const photoPublicId = userDoc.exists ? userDoc.data().photoPublicId : null;
    await deleteAsset(photoPublicId);

    await db.collection('users').doc(uid).delete();

    await auth.deleteUser(uid);

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Delete account error:', err);
    return res.status(500).json({ error: 'Could not delete the account. Please try again.' });
  }
});

module.exports = router;
