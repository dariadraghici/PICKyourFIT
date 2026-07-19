const express = require('express');
const { db, auth } = require('./firebaseAdmin');
const { encodeIpKey } = require('./ipUtils');
const { sendVerificationEmail, domainHasMx } = require('./emailVerification');
const { requireAuth } = require('./authMiddleware');

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
    const idToken = await signInWithPassword(normalizedEmail, password);

    // best-effort: don't fail signup if the verification email couldn't be
    // sent (e.g. transient Firebase issue) — the user can resend it later
    // from their profile page.
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

// POST /api/resend-verification — lets an already-logged-in but unverified
// user request a fresh verification email (e.g. if the first one expired
// or got lost).
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
    return res.status(500).json({ error: 'Nu s-a putut retrimite emailul de verificare. Încearcă din nou.' });
  }
});

module.exports = router;
