import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from './config.js';

// Verifies the monday sessionToken sent by the board view
// (Authorization: <token>). Sets req.user = { accountId, userId, label }.
export function requireMonday(req, res, next) {
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token && config.devAuthBypass) {
    req.user = { accountId: 0, userId: 0, label: 'dev' };
    return next();
  }
  for (const secret of config.mondaySecrets) {
    try {
      const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
      const dat = payload.dat || {};
      if (config.mondayAccountId && Number(dat.account_id) !== config.mondayAccountId) {
        return res.status(403).json({ error: 'This monday account is not allowed.' });
      }
      req.user = { accountId: Number(dat.account_id), userId: Number(dat.user_id), label: `monday:${dat.user_id}` };
      return next();
    } catch {
      // try the next secret
    }
  }
  return res.status(401).json({ error: 'Not signed in to monday (session token missing or invalid).' });
}

// Short-lived signed links so the slide can open in a new tab outside the iframe.
export function signDownload(packageId, userLabel, ttlSeconds = 300) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const body = `${packageId}.${exp}.${userLabel}`;
  const sig = crypto.createHmac('sha256', config.downloadSecret).update(body).digest('base64url');
  return Buffer.from(`${body}.${sig}`).toString('base64url');
}

export function verifyDownload(token, packageId) {
  try {
    const raw = Buffer.from(String(token), 'base64url').toString();
    const [id, exp, user, sig] = raw.split('.');
    const expected = crypto.createHmac('sha256', config.downloadSecret).update(`${id}.${exp}.${user}`).digest('base64url');
    if (id !== packageId || Number(exp) < Date.now() / 1000) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    return user;
  } catch {
    return null;
  }
}
