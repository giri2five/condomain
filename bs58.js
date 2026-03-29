// Minimal base58 implementation (no dependencies)
(function(global) {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const BASE = 58;
  const LEADER = ALPHABET[0];

  function encode(buf) {
    if (buf.length === 0) return '';
    let digits = [0];
    for (let i = 0; i < buf.length; i++) {
      let carry = buf[i];
      for (let j = 0; j < digits.length; j++) {
        carry += digits[j] << 8;
        digits[j] = carry % BASE;
        carry = (carry / BASE) | 0;
      }
      while (carry > 0) { digits.push(carry % BASE); carry = (carry / BASE) | 0; }
    }
    let str = '';
    for (let i = 0; buf[i] === 0 && i < buf.length - 1; i++) str += LEADER;
    for (let i = digits.length - 1; i >= 0; i--) str += ALPHABET[digits[i]];
    return str;
  }

  function decode(str) {
    if (str.length === 0) return new Uint8Array(0);
    let bytes = [0];
    for (let i = 0; i < str.length; i++) {
      const value = ALPHABET.indexOf(str[i]);
      if (value < 0) throw new Error('Invalid base58 character');
      let carry = value;
      for (let j = 0; j < bytes.length; j++) {
        carry += bytes[j] * BASE;
        bytes[j] = carry & 0xff;
        carry >>= 8;
      }
      while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
    }
    for (let i = 0; str[i] === LEADER && i < str.length - 1; i++) bytes.push(0);
    return new Uint8Array(bytes.reverse());
  }

  const bs58 = { encode, decode };
  if (typeof module !== 'undefined') module.exports = bs58;
  else global.bs58 = bs58;
})(typeof globalThis !== 'undefined' ? globalThis : this);
