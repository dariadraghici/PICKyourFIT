const express = require('express');
const multer = require('multer');
const { db, auth } = require('./firebaseAdmin');
const { uploadBuffer, deleteAsset } = require('./cloudinaryClient');
const { encodeIpKey } = require('./ipUtils');
const { sendVerificationEmail } = require('./emailVerification');
const { requireAuth } = require('./authMiddleware');

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

// Unverified accounts can't touch their personal info (name/email/avatar)
// until they confirm the email address.
function requireVerified(req, res, next) {
  if (!req.emailVerified) {
    return res.status(403).json({
      error: 'Trebuie să-ți verifici adresa de email înainte de a modifica informațiile personale.',
    });
  }
  next();
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
      emailVerified: req.emailVerified,
    });
  } catch (err) {
    console.error('Get profile error:', err);
    return res.status(500).json({ error: 'Could not load the profile.' });
  }
});

// PUT /api/profile  body: { firstName, lastName, email }
router.put('/profile', requireAuth, requireVerified, async (req, res) => {
  try {
    const { firstName, lastName, email } = req.body || {};

    if (!firstName || !lastName) {
      return res.status(400).json({ error: 'First name and last name are required.' });
    }
    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
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
        return res.status(409).json({ error: 'There is already an account with this email.' });
      }
      await auth.updateUser(req.uid, {
        email: normalizedEmail,
        displayName: `${firstName} ${lastName}`,
        emailVerified: false,
      });
      // best-effort: user keeps their access, they just need to re-verify
      // the new address before touching personal info again.
      try {
        await sendVerificationEmail(req.rawIdToken);
      } catch (verifyErr) {
        console.error('Could not send verification email after email change:', verifyErr);
      }
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

    return res.status(200).json({
      firstName,
      lastName,
      email: normalizedEmail,
      emailVerified: normalizedEmail !== currentEmail ? false : req.emailVerified,
    });
  } catch (err) {
    console.error('Update profile error:', err);
    if (err.code === 'auth/email-already-exists') {
      return res.status(409).json({ error: 'There is already an account with this email.' });
    }
    if (err.code === 'auth/invalid-email') {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    return res.status(500).json({ error: 'Could not save the changes.' });
  }
});

// POST /api/profile/avatar  multipart/form-data, field name "avatar"
router.post('/profile/avatar', requireAuth, requireVerified, (req, res) => {
  upload.single('avatar')(req, res, async (err) => {
    if (err) {
      const msg = err.message === 'INVALID_FILE_TYPE'
        ? 'Only PNG or JPG images are accepted.'
        : 'The image is too large (max 5MB).';
      return res.status(400).json({ error: msg });
    }
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No image uploaded.' });
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
      return res.status(500).json({ error: 'Could not upload the image.' });
    }
  });
});

// POST /api/change-password  body: { currentPassword, newPassword }
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Please fill in all fields.' });
    }
    if (newPassword.length < 8 || !/[0-9]/.test(newPassword) || !/[a-zA-Z]/.test(newPassword)) {
      return res.status(400).json({
        error: 'New password must be at least 8 characters long and contain at least one letter and one digit.',
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
    return res.status(500).json({ error: 'Could not update the password.' });
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
    const userData = userDoc.exists ? userDoc.data() : null;
    const photoPublicId = userData ? userData.photoPublicId : null;
    await deleteAsset(photoPublicId);

    // Free up the IP slot this account was counted against, so the same
    // network can create another account in its place.
    if (userData && userData.ip) {
      const ipDocRef = db.collection('ipAccounts').doc(encodeIpKey(userData.ip));
      const ipDoc = await ipDocRef.get();
      if (ipDoc.exists) {
        const ipData = ipDoc.data();
        const remainingUids = (ipData.uids || []).filter((storedUid) => storedUid !== uid);
        const newCount = Math.max(remainingUids.length, (ipData.count || 0) - 1, 0);

        if (newCount <= 0 && remainingUids.length === 0) {
          await ipDocRef.delete();
        } else {
          await ipDocRef.set(
            { count: newCount, uids: remainingUids },
            { merge: true }
          );
        }
      }
    }

    await db.collection('users').doc(uid).delete();

    await auth.deleteUser(uid);

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Delete account error:', err);
    return res.status(500).json({ error: 'Could not delete the account. Please try again.' });
  }
});

module.exports = router;
