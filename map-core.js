/* Geometry helpers shared by the map and its regression tests. */
(function (root) {
  'use strict';
  function validPoint(point) {
    return Array.isArray(point) && point.length === 2 && point.every(Number.isFinite) &&
      Math.abs(point[0]) <= 90 && Math.abs(point[1]) <= 180;
  }
  function decodePolyline(encoded, precision = 6) {
    if (typeof encoded !== 'string' || !Number.isInteger(precision) || precision < 0 || precision > 7) return [];
    let index = 0, lat = 0, lon = 0;
    const points = [], factor = 10 ** precision;
    function read() {
      let value = 0, shift = 0, byte;
      do {
        if (index >= encoded.length || shift > 35) throw new Error('Invalid polyline');
        byte = encoded.charCodeAt(index++) - 63;
        if (byte < 0 || byte > 63) throw new Error('Invalid polyline');
        value += (byte & 31) * 2 ** shift;
        shift += 5;
      } while (byte >= 32);
      return value % 2 ? -(value + 1) / 2 : value / 2;
    }
    try {
      while (index < encoded.length) {
        lat += read(); lon += read();
        const point = [lat / factor, lon / factor];
        if (!validPoint(point)) return [];
        points.push(point);
      }
      return points;
    } catch { return []; }
  }
  function distance(a, b) {
    const radians = Math.PI / 180;
    const x = (b[1] - a[1]) * Math.cos((a[0] + b[0]) * radians / 2);
    return Math.hypot(b[0] - a[0], x);
  }
  function positionAlong(points, fraction) {
    if (!points.length || !points.every(validPoint) || !Number.isFinite(fraction)) return null;
    const lengths = points.slice(1).map((point, i) => distance(points[i], point));
    const total = lengths.reduce((sum, length) => sum + length, 0);
    let remaining = Math.max(0, Math.min(1, fraction)) * total;
    for (let i = 0; i < lengths.length; i++) {
      if (lengths[i] > 0 && remaining <= lengths[i]) {
        const ratio = remaining / lengths[i];
        return points[i].map((value, axis) => value + (points[i + 1][axis] - value) * ratio);
      }
      remaining -= lengths[i];
    }
    return points[points.length - 1];
  }
  // Timing-based interpolation only. realTime means updated TIMES, not GPS.
  function estimatePosition(segment, now) {
    const start = Date.parse(segment.departure), end = Date.parse(segment.arrival);
    if (segment.cancelled || segment.from?.cancelled || segment.to?.cancelled ||
        !Number.isFinite(start) || !Number.isFinite(end) || end <= start || now < start || now >= end) return null;
    const points = segment.points || decodePolyline(segment.polyline, 5);
    if (points.length < 2) return null;
    return positionAlong(points, (now - start) / (end - start));
  }
  const api = { validPoint, decodePolyline, positionAlong, estimatePosition };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PassauMapCore = api;
})(typeof window === 'object' ? window : globalThis);
