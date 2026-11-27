const assert = require('node:assert/strict');

describe('R2 public CDN URL helper', function () {
  let helper;

  before(async function () {
    helper = await import('../functions/utils/r2-public-url.js');
  });

  it('normalizes an HTTPS base URL and removes trailing slashes', function () {
    assert.equal(
      helper.normalizeR2PublicBaseUrl('https://img.example.com/assets///'),
      'https://img.example.com/assets'
    );
  });

  it('rejects unsafe or malformed public base URLs', function () {
    assert.equal(helper.normalizeR2PublicBaseUrl('javascript:alert(1)'), '');
    assert.equal(helper.normalizeR2PublicBaseUrl('https://user:pass@example.com'), '');
    assert.equal(helper.normalizeR2PublicBaseUrl('https://img.example.com/?token=x'), '');
    assert.equal(helper.normalizeR2PublicBaseUrl('not a URL'), '');
  });

  it('creates an encoded direct URL and falls back to the Pages file route when unset', function () {
    assert.equal(
      helper.getR2PublicUrl({ R2_PUBLIC_BASE_URL: 'https://img.example.com/' }, 'folder/a b.jpg'),
      'https://img.example.com/folder/a%20b.jpg'
    );
    assert.equal(
      helper.getR2PublicUrl({}, 'r2_test.jpg'),
      '/file/r2:r2_test.jpg'
    );
  });

  it('uses a short browser TTL and a longer shared-cache TTL', function () {
    assert.equal(helper.R2_PUBLIC_CACHE_CONTROL, 'public, max-age=3600, s-maxage=86400');
  });
});
