function encodeIpKey(ip) {
  return ip.replace(/[.:]/g, '_');
}

module.exports = { encodeIpKey };
