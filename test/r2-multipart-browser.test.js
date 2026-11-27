const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const clientSource = fs.readFileSync(path.join(root, 'r2-multipart.js'), 'utf8');

function loadClient(storage, fetch) {
  const module = { exports: {} };
  vm.runInNewContext(clientSource, {
    module, fetch, crypto, setTimeout,
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
    },
  });
  return module.exports;
}

function mockUpload() {
  const uploaded = [];
  const calls = [];
  let rejectManifest = false;
  return {
    uploaded, calls,
    rejectNextManifest() { rejectManifest = true; },
    async fetch(url, options) {
      calls.push(options.method);
      if (options.method === 'PUT') {
        const partNumber = Number(new URL(url, 'https://vault.example').searchParams.get('part'));
        uploaded.push(partNumber);
        return Response.json({ success: true, part: { partNumber, etag: `part-${partNumber}` } });
      }
      if (options.method === 'DELETE') {
        assert.equal(options.headers['X-Upload-Session'], 'upload-session');
        return Response.json({ success: true, aborted: true });
      }
      if (url.endsWith('action=complete')) {
        if (rejectManifest) {
          rejectManifest = false;
          return Response.json({ error: { code: 'STALE_PARTS' } }, { status: 409 });
        }
        assert.deepEqual(JSON.parse(options.body).parts, [
          { partNumber: 1, etag: 'part-1' }, { partNumber: 2, etag: 'part-2' },
        ]);
        return Response.json({ success: true, src: '/file/r2:completed.bin' });
      }
      return Response.json({ success: true, session: 'upload-session', partSize: 4 });
    },
  };
}

function makeFile(data) {
  return new File([data], 'sample.bin', { lastModified: 12, type: 'application/octet-stream' });
}

describe('R2 multipart browser checkpoints', function () {
  it('resumes a paused upload in a new page without uploading confirmed parts again', async function () {
    const storage = new Map();
    const mock = mockUpload();
    const file = makeFile('01234567');
    const pause = new AbortController();
    await assert.rejects(loadClient(storage, mock.fetch).upload(file, 'docs', {
      signal: pause.signal,
      onProgress: () => pause.abort(),
    }), { name: 'AbortError' });
    assert.deepEqual(mock.uploaded, [1]);
    assert.equal(storage.size, 1);

    const src = await loadClient(storage, mock.fetch).upload(file, 'docs');
    assert.equal(src, '/file/r2:completed.bin');
    assert.deepEqual(mock.uploaded, [1, 2]);
    assert.deepEqual(mock.calls, ['POST', 'PUT', 'PUT', 'POST']);
    assert.equal(storage.size, 0);
  });

  it('rejects a different file with matching attributes and can discard the old upload', async function () {
    const storage = new Map();
    const mock = mockUpload();
    const first = loadClient(storage, mock.fetch);
    const pause = new AbortController();
    await assert.rejects(first.upload(makeFile('01234567'), 'docs', {
      signal: pause.signal,
      onProgress: () => pause.abort(),
    }), { name: 'AbortError' });
    const second = loadClient(storage, mock.fetch);
    const different = makeFile('99994567');
    await assert.rejects(second.upload(different, 'docs'), /文件内容与断点不一致/);
    assert.deepEqual(mock.uploaded, [1]);
    await second.discard(different, 'docs');
    assert.deepEqual(mock.calls, ['POST', 'PUT', 'DELETE']);
    assert.equal(storage.size, 0);
  });

  it('recovers stale R2 receipts by refreshing parts in the same upload session', async function () {
    const storage = new Map();
    const mock = mockUpload();
    mock.rejectNextManifest();
    await loadClient(storage, mock.fetch).upload(makeFile('01234567'), '');
    assert.deepEqual(mock.uploaded, [1, 2, 1, 2]);
    assert.deepEqual(mock.calls, ['POST', 'PUT', 'PUT', 'POST', 'PUT', 'PUT', 'POST']);
  });
});


describe('R2 public URL integration in the upload page', function () {
  function loadPage(storage = new Map()) {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const script = html.match(/<script>\s*(const LOCAL_PREVIEW_PAGE[\s\S]*?)<\/script>/);
    assert.ok(script, 'upload page script should exist');
    let options;
    vm.runInNewContext(script[1], {
      document: { location: { origin: 'https://vault.example' } },
      console: { error() {} },
      AbortController,
      URL,
      KVaultR2Multipart: { async upload() { return '/file/r2:unused.jpg'; } },
      localStorage: {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
      },
      fetch: async () => ({
        ok: true,
        json: async () => ({
          publicBaseUrl: '',
          r2PublicBaseUrl: 'https://img.example.com',
          uploadLimits: {},
          r2: { connected: true, enabled: true, configured: true },
        }),
      }),
      Vue: function Vue(config) { options = config; },
    });
    return Object.assign({}, options.data, options.methods);
  }

  it('maps existing R2 proxy history links to the custom domain while leaving Telegram on Pages', function () {
    const page = loadPage();
    page.baseURL = 'https://vault.example';
    page.r2PublicBaseUrl = 'https://img.example.com';
    assert.equal(
      page.getCleanFileUrl({ path: '/file/r2:r2_existing.jpg', usedPublicBaseUrl: false }),
      'https://img.example.com/r2_existing.jpg'
    );
    assert.equal(
      page.getCleanFileUrl({ path: 'https://img.example.com/r2_new.jpg', storageType: 'r2' }),
      'https://img.example.com/r2_new.jpg'
    );
    assert.equal(
      page.getCleanFileUrl({ path: '/file/telegram-file.jpg', usedPublicBaseUrl: false }),
      'https://vault.example/file/telegram-file.jpg'
    );
    assert.equal(
      page.getDownloadFileUrl({ path: 'https://img.example.com/r2_new.jpg', storageType: 'r2' }),
      'https://vault.example/file/r2:r2_new.jpg'
    );
  });

  it('switches to R2 once by default, then remembers a later manual Telegram choice', async function () {
    const storage = new Map([['storageMode', 'telegram']]);
    const page = loadPage(storage);
    await page.checkStorageTarget();
    assert.equal(page.storageMode, 'r2');
    assert.equal(storage.get('storageMode'), 'r2');
    assert.equal(storage.get('kvault:r2-default-storage-v1'), '1');

    storage.set('storageMode', 'telegram');
    await page.checkStorageTarget();
    assert.equal(page.storageMode, 'telegram');
  });
});

describe('Pages upload queue routing', function () {
  it('selects native multipart only for authenticated Pages R2 uploads above 100 MiB', async function () {
    const MiB = 1024 ** 2;
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const script = html.match(/<script>\s*(const LOCAL_PREVIEW_PAGE[\s\S]*?)<\/script>/)[1];
    let options;
    const calls = [];
    vm.runInNewContext(script, {
      document: { location: { origin: 'https://vault.example' } },
      console: { error() {} },
      AbortController,
      KVaultR2Multipart: {
        async upload(file, folder) {
          calls.push([file.size, folder]);
          return '/file/r2:multipart.bin';
        },
      },
      Vue: function Vue(config) { options = config; },
    });
    const page = Object.assign({}, options.data, options.methods, {
      isAuthenticated: true,
      uploadLimits: { r2: { maxBytes: 100 * MiB, multipartMaxBytes: 20 * 1024 ** 3 } },
      prepareUploadItem: async () => {},
      chunkedUpload: async () => calls.push('legacy'),
      handleUploadSuccess: (_item, src) => calls.push(src),
    });
    const item = (size, storageMode = 'r2') => ({ status: 'waiting', file: { size }, storageMode, folderPath: 'docs' });
    await page.uploadFile(item(100 * MiB));
    await page.uploadFile(item(100 * MiB + 1));
    page.isGuest = true;
    const guest = item(100 * MiB + 1);
    await page.uploadFile(guest);
    assert.equal(guest.status, 'error');
    assert.deepEqual(calls, ['legacy', [100 * MiB + 1, 'docs'], '/file/r2:multipart.bin']);
  });
});
