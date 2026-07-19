const dns = require('dns').promises;

const FIREBASE_WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY;

// Sends Firebase's built-in "verify your email" link to whatever account the
// idToken belongs to. Uses the Identity Toolkit REST API directly (same
// pattern as signInWithPassword in authRoutes.js/profileRoutes.js), so we
// don't need the Firebase client SDK in the browser. Best-effort: callers
// should not fail the whole request if this throws, just log it.
async function sendVerificationEmail(idToken) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${FIREBASE_WEB_API_KEY}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestType: 'VERIFY_EMAIL', idToken }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || 'SEND_VERIFICATION_FAILED');
  }
  return data; // { email, ... }
}

// Quick, free sanity check that the domain after the @ can actually receive
// mail (has MX records). Catches typos like "gmial.com" before we ever
// create an account or send anything. Doesn't prove the mailbox itself
// exists — only sendVerificationEmail + the user clicking the link does.
async function domainHasMx(email) {
  const domain = String(email).split('@')[1];
  if (!domain) return false;
  try {
    const records = await dns.resolveMx(domain);
    return Array.isArray(records) && records.length > 0;
  } catch (err) {
    return false;
  }
}

module.exports = { sendVerificationEmail, domainHasMx };
