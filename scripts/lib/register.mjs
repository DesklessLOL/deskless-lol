// Register pattern: every external fact is one record { state, value, url }.
// state is stated | absent | unconfirmed. Anything not stated is inert: value and url are both null.
export const STATES = ['stated', 'absent', 'unconfirmed'];
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function b58decodeLength(s) {
  let bytes = [0];
  for (const ch of s) {
    const v = B58.indexOf(ch);
    if (v < 0) return -1;
    let carry = v;
    for (let i = 0; i < bytes.length; i++) { carry += bytes[i] * 58; bytes[i] = carry & 0xff; carry >>= 8; }
    while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (const ch of s) { if (ch === '1') bytes.push(0); else break; }
  return bytes.length;
}
export const isSolanaAddress = s => typeof s === 'string' && s.length >= 32 && s.length <= 44 && b58decodeLength(s) === 32;

export function handleFromUrl(url) {
  const u = new URL(url);
  const seg = u.pathname.split('/').filter(Boolean);
  return seg.length ? seg[0].replace(/^@/, '') : null;
}

export function validate(reg) {
  const errs = [];
  for (const [name, r] of Object.entries(reg)) {
    if (!r || typeof r !== 'object') { errs.push(`${name}: not a record`); continue; }
    const keys = Object.keys(r).sort().join(',');
    if (keys !== 'state,url,value') errs.push(`${name}: record must have exactly state,value,url (got ${keys})`);
    if (!STATES.includes(r.state)) errs.push(`${name}: bad state ${r.state}`);
    if (r.state !== 'stated') {
      if (r.value !== null || r.url !== null) errs.push(`${name}: ${r.state} record must carry null value and null url`);
    }
  }
  for (const need of ['domain', 'chain', 'rpc', 'dex', 'dexFallback', 'ca', 'x', 'github']) if (!reg[need]) errs.push(`missing record ${need}`);
  if (reg.ca?.state === 'stated' && !isSolanaAddress(reg.ca.value)) errs.push('ca: stated value is not a 32-byte base58 address');
  if (reg.x?.state === 'stated') {
    try { const u = new URL(reg.x.url); if (!['x.com', 'twitter.com'].includes(u.hostname.replace(/^www\./, '')) || !handleFromUrl(reg.x.url)) errs.push('x: url must be an x.com profile'); } catch { errs.push('x: url invalid'); }
  }
  if (reg.github?.state === 'stated') {
    try { const u = new URL(reg.github.url); if (u.hostname.replace(/^www\./, '') !== 'github.com' || !handleFromUrl(reg.github.url)) errs.push('github: url must be a github.com profile'); } catch { errs.push('github: url invalid'); }
  }
  return errs;
}
