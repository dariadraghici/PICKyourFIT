const dns = require('dns').promises;

const FIREBASE_WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY;

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
