const { auth } = require('./firebaseAdmin');

// Shared auth guard used by every route file (auth, wardrobe, profile,
// calendar, favorites).
//
// IMPORTANT: we do NOT trust `decoded.email_verified` from the ID token.
// That claim is baked into the JWT at the moment it was issued (signup or
// login) and never changes until the token is refreshed. If a user clicks
// the "verify your email" link in a later request, their Firebase Auth
// account becomes verified immediately, but any ID token issued *before*
// that click still says `email_verified: false` — and browsers keep using
// that same token (from localStorage) until the next login.
//
// To make verification take effect right away (no re-login required), we
// re-check the account's *current* status straight from Firebase Auth via
// auth.getUser(uid) on every request. This costs one extra Admin SDK call
// per request but is always accurate.
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Autentificare necesară.' });

    const decoded = await auth.verifyIdToken(token);
    req.uid = decoded.uid;
    req.rawIdToken = token;

    const userRecord = await auth.getUser(decoded.uid);
    req.emailVerified = !!userRecord.emailVerified;

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sesiune invalidă sau expirată.' });
  }
}

module.exports = { requireAuth };
