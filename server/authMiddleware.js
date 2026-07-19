const { auth } = require('./firebaseAdmin');

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Necessary authentication.' });

    const decoded = await auth.verifyIdToken(token);
    req.uid = decoded.uid;
    req.rawIdToken = token;

    const userRecord = await auth.getUser(decoded.uid);
    req.emailVerified = !!userRecord.emailVerified;

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session.' });
  }
}

module.exports = { requireAuth };
