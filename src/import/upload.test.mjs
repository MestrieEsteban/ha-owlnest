import test from 'node:test';
import assert from 'node:assert/strict';
import { chunks, uploadGlb, UploadError } from './upload.mjs';

test('découpe en tranches contiguës', () => {
  assert.deepEqual(chunks(10, 4), [[0, 4], [4, 8], [8, 10]]);
  assert.deepEqual(chunks(8, 4), [[0, 4], [4, 8]]);
});

/** Un faux serveur qui assemble ce qu'il reçoit, comme models.py. */
function fakeHass({ failOnce = false, status = 200 } = {}) {
  const calls = [];
  let file = new Uint8Array(0);
  let failed = false;
  return {
    calls,
    file: () => file,
    fetchWithAuth: async (path, init) => {
      calls.push(path);
      if (failOnce && !failed) { failed = true; throw new TypeError('network'); }
      if (status !== 200) return new Response(JSON.stringify({ message: 'nope' }), { status });
      const q = new URLSearchParams(path.split('?')[1]);
      const offset = Number(q.get('offset'));
      const body = new Uint8Array(init.body);
      const next = new Uint8Array(offset + body.length);
      next.set(file.subarray(0, offset));
      next.set(body, offset);
      file = next;
      const final = q.get('final') === '1';
      return new Response(JSON.stringify(final ? { url: `/owlnest_models/${q.get('name')}.glb` } : { received: file.length }));
    },
  };
}

test('envoie tout, dans l’ordre, et rend l’adresse', async () => {
  const glb = new Uint8Array(20 * 1024 * 1024).map((_, i) => i % 251);
  const hass = fakeHass();
  const seen = [];
  const url = await uploadGlb(hass, 'maison', glb, (f) => seen.push(f));
  assert.equal(url, '/owlnest_models/maison.glb');
  assert.equal(hass.calls.length, 3);
  assert.match(hass.calls[2], /final=1/);
  assert.deepEqual(hass.file(), glb);
  assert.equal(seen.at(-1), 1);
});

test('une coupure réseau est retentée', async () => {
  const hass = fakeHass({ failOnce: true });
  const url = await uploadGlb(hass, 'm', new Uint8Array([1, 2, 3]));
  assert.equal(url, '/owlnest_models/m.glb');
  assert.equal(hass.calls.length, 2);
});

test('un refus du serveur remonte avec son code', async () => {
  const hass = fakeHass({ status: 403 });
  await assert.rejects(uploadGlb(hass, 'm', new Uint8Array([1])), (err) => {
    assert.ok(err instanceof UploadError);
    assert.equal(err.status, 403);
    assert.equal(err.message, 'nope');
    return true;
  });
  assert.equal(hass.calls.length, 1);
});
