const express = require('express');
const { db, auth } = require('./firebaseAdmin');
const { encodeIpKey } = require('./ipUtils');
const { sendVerificationEmail, domainHasMx } = require('./emailVerification');
const { requireAuth } = require('./authMiddleware');
const { uploadBuffer } = require('./cloudinaryClient');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ACCOUNTS_PER_IP = 2;
const FIREBASE_WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY;

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.ip || req.connection.remoteAddress || 'unknown';
}

// body: { firstName, lastName, email, password }
router.post('/signup', async (req, res) => {
  try {
    const { firstName, lastName, email, password, dataConsent, termsConsent } = req.body || {};

    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ error: 'All fields are required.' });
    }
    if (dataConsent !== true || termsConsent !== true) {
      return res.status(400).json({
        error: 'You must check both checkboxes (data processing and Terms & Conditions) to create an account.',
      });
    }
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'The email address is not valid.' });
    }
    if (password.length < 8 || !/[0-9]/.test(password) || !/[a-zA-Z]/.test(password)) {
      return res.status(400).json({
        error: 'The password must be at least 8 characters long and contain at least one letter and one digit.',
      });
    }
    if (!(await domainHasMx(email))) {
      return res.status(400).json({ error: "This email's domain does not appear to accept mail. Please check for typos." });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const ip = getClientIp(req);

    // test if the email already exists in our Firestore users collection
    const existing = await db.collection('users').where('email', '==', normalizedEmail).limit(1).get();
    if (!existing.empty) {
      return res.status(409).json({ error: 'There is already an account with this email.' });
    }

    // test if the IP has already created too many accounts
    const ipDocRef = db.collection('ipAccounts').doc(encodeIpKey(ip));
    const ipDoc = await ipDocRef.get();
    const currentCount = ipDoc.exists ? (ipDoc.data().count || 0) : 0;

    if (currentCount >= MAX_ACCOUNTS_PER_IP) {
      return res.status(429).json({
        error: 'You have reached the maximum number of accounts allowed (2) created from this network.',
      });
    }

    // create the user in Firebase Authentication
    const userRecord = await auth.createUser({
      email: normalizedEmail,
      password,
      displayName: `${firstName} ${lastName}`,
    });

    // save the user data in Firestore under "users" collection
    await db.collection('users').doc(userRecord.uid).set({
      firstName,
      lastName,
      email: normalizedEmail,
      ip,
      dataConsent: true,
      termsConsent: true,
      consentAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });

    // update the IP document to increment the count and store the UID
    await ipDocRef.set(
      {
        count: currentCount + 1,
        uids: (ipDoc.exists ? ipDoc.data().uids || [] : []).concat(userRecord.uid),
        lastUsed: new Date().toISOString(),
      },
      { merge: true }
    );

    // authenticate the user immediately after signup to return an ID token
    const { idToken } = await signInWithPassword(normalizedEmail, password);

    try {
      await sendVerificationEmail(idToken);
    } catch (verifyErr) {
      console.error('Could not send verification email:', verifyErr);
    }

    return res.status(201).json({ uid: userRecord.uid, idToken, emailVerified: false });
  } catch (err) {
    console.error('Signup error:', err);
    if (err.code === 'auth/email-already-exists') {
      return res.status(409).json({ error: 'There is already an account with this email.' });
    }
    return res.status(500).json({ error: 'Internal error. Please try again.' });
  }
});


// body: { email, password }
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'The email address is not valid.' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // check if the email exists in our Firestore users collection
    const existing = await db.collection('users').where('email', '==', normalizedEmail).limit(1).get();
    if (existing.empty) {
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }

    // test the password using Firebase REST API (Identity Toolkit)
    let idToken, localId;
    try {
      const result = await signInWithPassword(normalizedEmail, password, true);
      idToken = result.idToken;
      localId = result.localId;
    } catch (authErr) {
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }

    const userDoc = existing.docs[0].data();
    const userRecord = await auth.getUser(localId);

    return res.status(200).json({
      uid: localId,
      idToken,
      firstName: userDoc.firstName,
      lastName: userDoc.lastName,
      email: userDoc.email,
      emailVerified: !!userRecord.emailVerified,
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Internal error. Please try again.' });
  }
});

// Downloads the user's Google profile photo and re-uploads it to Cloudinary,
// so it's stored the same way as manually-uploaded avatars (and gets cleaned
// up correctly on account deletion / avatar replacement). Best-effort: on
// any failure we just skip the avatar rather than failing the signup.
async function mirrorGooglePhoto(pictureUrl, uid) {
  if (!pictureUrl) return null;
  try {
    // Google's default photo URLs are small (e.g. "=s96-c"); ask for a
    // larger version when that sizing suffix is present.
    const biggerUrl = pictureUrl.replace(/=s\d+-c$/, '=s400-c');
    const imgRes = await fetch(biggerUrl);
    if (!imgRes.ok) return null;
    const arrayBuffer = await imgRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const result = await uploadBuffer(buffer, `avatars/${uid}`);
    return { photoUrl: result.secure_url, photoPublicId: result.public_id };
  } catch (err) {
    console.error('Could not mirror Google profile photo:', err);
    return null;
  }
}

// body: { idToken }
// idToken here is a real Firebase ID token obtained client-side after
// firebase.auth().signInWithPopup(new firebase.auth.GoogleAuthProvider()).
// We verify it server-side, then either log the (already existing) user in
// or create their Firestore profile the first time they use Google.
router.post('/google-auth', async (req, res) => {
  try {
    const { idToken } = req.body || {};
    if (!idToken) {
      return res.status(400).json({ error: 'Missing Google sign-in token.' });
    }

    let decoded;
    try {
      decoded = await auth.verifyIdToken(idToken);
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired Google sign-in token.' });
    }

    if (decoded.firebase?.sign_in_provider !== 'google.com') {
      return res.status(400).json({ error: 'This endpoint only accepts Google sign-in tokens.' });
    }

    const uid = decoded.uid;
    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();

    // Existing account -> this is effectively a login.
    if (userDoc.exists) {
      const data = userDoc.data();
      return res.status(200).json({
        uid,
        idToken,
        firstName: data.firstName || '',
        lastName: data.lastName || '',
        email: data.email || decoded.email || '',
        photoUrl: data.photoUrl || null,
        emailVerified: true,
      });
    }

    // No Firestore profile yet -> this is effectively a signup.
    const normalizedEmail = (decoded.email || '').trim().toLowerCase();

    // Don't let a Google sign-in silently take over an email that already
    // has a password-based account.
    const existingByEmail = await db.collection('users').where('email', '==', normalizedEmail).limit(1).get();
    if (!existingByEmail.empty) {
      return res.status(409).json({
        error: 'There is already an account with this email. Please log in with your password instead.',
      });
    }

    const ip = getClientIp(req);
    const ipDocRef = db.collection('ipAccounts').doc(encodeIpKey(ip));
    const ipDoc = await ipDocRef.get();
    const currentCount = ipDoc.exists ? (ipDoc.data().count || 0) : 0;

    if (currentCount >= MAX_ACCOUNTS_PER_IP) {
      return res.status(429).json({
        error: 'You have reached the maximum number of accounts allowed (2) created from this network.',
      });
    }

    const fullName = (decoded.name || '').trim();
    const [firstName, ...rest] = fullName ? fullName.split(/\s+/) : ['User'];
    const lastName = rest.join(' ');

    const mirroredPhoto = await mirrorGooglePhoto(decoded.picture, uid);

    await userRef.set({
      firstName: firstName || 'User',
      lastName: lastName || '',
      email: normalizedEmail,
      ip,
      provider: 'google',
      dataConsent: true,
      termsConsent: true,
      consentAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      ...(mirroredPhoto ? { photoUrl: mirroredPhoto.photoUrl, photoPublicId: mirroredPhoto.photoPublicId } : {}),
    });

    await ipDocRef.set(
      {
        count: currentCount + 1,
        uids: (ipDoc.exists ? ipDoc.data().uids || [] : []).concat(uid),
        lastUsed: new Date().toISOString(),
      },
      { merge: true }
    );

    return res.status(201).json({
      uid,
      idToken,
      firstName: firstName || 'User',
      lastName: lastName || '',
      email: normalizedEmail,
      photoUrl: mirroredPhoto ? mirroredPhoto.photoUrl : null,
      emailVerified: true,
    });
  } catch (err) {
    console.error('Google auth error:', err);
    return res.status(500).json({ error: 'Internal error. Please try again.' });
  }
});

async function signInWithPassword(email, password, throwOnFail = false) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_WEB_API_KEY}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const data = await response.json();
  if (!response.ok) {
    if (throwOnFail) throw new Error(data.error?.message || 'AUTH_FAILED');
    throw new Error(data.error?.message || 'AUTH_FAILED');
  }
  return data; // { idToken, localId, ... }
}


router.post('/resend-verification', requireAuth, async (req, res) => {
  try {
    const userRecord = await auth.getUser(req.uid);
    if (userRecord.emailVerified) {
      return res.status(200).json({ alreadyVerified: true });
    }
    await sendVerificationEmail(req.rawIdToken);
    return res.status(200).json({ sent: true });
  } catch (err) {
    console.error('Resend verification error:', err);
    return res.status(500).json({ error: 'Could not resend verification email. Please try again.' });
  }
});

module.exports = router;
