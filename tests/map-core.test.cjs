const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../map-core.js');

test('decodes provider polyline precision and rejects malformed coordinates', () => {
  assert.deepEqual(core.decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5), [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
  assert.deepEqual(core.decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 6)[0], [3.85, -12.02]);
  assert.deepEqual(core.decodePolyline('_'), []);
  assert.deepEqual(core.decodePolyline('invalid unicode ☺'), []);
  assert.equal(core.validPoint([NaN, 13]), false);
});
test('positions follow distance along the shape instead of point count', () => {
  assert.deepEqual(core.positionAlong([[0, 0], [0, 1], [0, 10]], 0.5), [0, 5]);
  assert.deepEqual(core.positionAlong([[0, 0], [0, 0]], 0.5), [0, 0]);
});
test('only estimates active segments, excluding cancelled and invalid times', () => {
  const segment = {departure:'2026-11-17T10:00:00Z',arrival:'2026-11-17T10:10:00Z',points:[[0,0],[0,10]]};
  assert.deepEqual(core.estimatePosition(segment, Date.parse('2026-11-17T10:05:00Z')), [0,5]);
  assert.equal(core.estimatePosition(segment, Date.parse('2026-11-17T09:59:00Z')), null);
  assert.equal(core.estimatePosition(segment, Date.parse('2026-11-17T10:10:00Z')), null);
  assert.equal(core.estimatePosition({...segment, cancelled:true}, Date.parse('2026-11-17T10:05:00Z')), null);
  assert.equal(core.estimatePosition({...segment, departure:'invalid'}, Date.now()), null);
  assert.equal(core.estimatePosition({...segment, points:[]}, Date.parse('2026-11-17T10:05:00Z')), null);
});
