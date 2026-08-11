const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fakeElement() {
  return {
    style: {},
    classList: { contains() { return false; } },
    getAttribute() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    setAttribute() {},
    addEventListener() {},
    appendChild() {},
    remove() {},
  };
}

function fakeImage(attributes = {}, currentSrc = '') {
  return {
    complete: true,
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null;
    },
    addEventListener() {},
    removeEventListener() {},
    currentSrc,
    src: attributes.src || currentSrc,
  };
}

function fakeSkuRow({ vid, name, url, disabled = false }) {
  const label = {
    textContent: name,
    getAttribute(attribute) {
      return attribute === 'title' ? name : null;
    },
  };
  const image = fakeImage({ src: url }, url);
  return {
    __label: label,
    __image: image,
    classList: { contains(className) { return disabled && className === 'isDisabled'; } },
    getAttribute(attribute) {
      if (attribute === 'data-vid') return vid;
      if (attribute === 'data-disabled') return disabled ? 'true' : null;
      return null;
    },
    querySelector(selector) {
      if (selector === 'span[title], [data-sku-name]') return label;
      if (selector === 'img') return image;
      return null;
    },
    querySelectorAll() { return []; },
    scrollIntoView() {},
  };
}

const detailImages = [
  fakeImage({ 'data-src': '//img.alicdn.com/detail/first_!!633308262.jpg' }),
  fakeImage({ src: 'https://img.alicdn.com/detail/first_!!633308262.jpg?duplicate=1' }),
  fakeImage({ src: 'https://img.alicdn.com/detail/animated_!!633308262.gif' }),
  fakeImage({ src: 'https://img.alicdn.com/platform/notice_!!6000000002284-2-tps-1125-1446.png' }),
  fakeImage({ src: 'data:image/png;base64,ignored' }),
];

const detailRoot = {
  querySelectorAll(selector) {
    return selector === 'img' ? detailImages : [];
  },
};

const skuRows = [
  fakeSkuRow({
    vid: 'sku-30',
    name: '粉蓝色 长30cm【升级浮点/深层放松】',
    url: 'https://gw.alicdn.com/sku/powder-blue.jpg_.webp',
  }),
  fakeSkuRow({
    vid: 'sku-45',
    name: '樱桃粉 长45cm【升级浮点/深层放松】',
    url: 'https://gw.alicdn.com/sku/cherry-pink.png',
  }),
  fakeSkuRow({
    vid: 'sku-disabled',
    name: '浅紫色 长60cm【升级浮点/深层放松】',
    url: 'https://gw.alicdn.com/sku/disabled.webp',
    disabled: true,
  }),
];

const skuGroup = {
  parentElement: null,
  querySelectorAll(selector) {
    if (selector === '[data-vid]') return skuRows;
    if (selector === '[data-vid] span[title]') return skuRows.map(row => row.__label);
    if (selector === '[data-vid] img') return skuRows.map(row => row.__image);
    return [];
  },
};

const skuColorLabel = {
  parentElement: skuGroup,
  querySelectorAll() { return []; },
};

const documentStub = {
  readyState: 'loading',
  head: { appendChild() {} },
  body: fakeElement(),
  createElement: fakeElement,
  createTextNode(text) {
    return { text };
  },
  addEventListener() {},
  querySelector(selector) {
    return selector === '#imageTextInfo-content' ? detailRoot : null;
  },
  querySelectorAll(selector) {
    if (selector === '[title="颜色分类"]') return [skuColorLabel];
    return [];
  },
};

const scriptPath = path.join(__dirname, '..', 'shangtu-picun.user.js');
let source = fs.readFileSync(scriptPath, 'utf8');
assert.match(source, /@name\s+商图批存（京东\/天猫\/淘宝）/);
assert.match(source, /@version\s+1\.6\.0/);
assert.match(source, /@connect\s+img10\.360buyimg\.com/);
assert.match(source, /@connect\s+img14\.360buyimg\.com/);
assert.match(source, /@connect\s+img30\.360buyimg\.com/);
assert.match(source, /@connect\s+img\.alicdn\.com/);
assert.match(source, /@connect\s+gw\.alicdn\.com/);
source = source.replace(
  /\}\)\(\);\s*$/,
  `globalThis.__shangtuTest = {
    PLATFORM,
    PRODUCT_ID,
    normalizeImageUrl,
    inferImageExtension,
    buildImageInfos,
    detectImageExtension,
    filterTmallPlatformAssets,
    fetchTmallImageUrls,
    safeFilenamePart,
    candidateSkuImageUrl,
    collectTmallSkuRows,
    fetchTmallSkuImageUrls,
  };
})();`,
);

const context = {
  console: { log() {}, error() {} },
  document: documentStub,
  location: {
    hostname: 'detail.tmall.com',
    pathname: '/item.htm',
    search: '?id=730408164255',
    href: 'https://detail.tmall.com/item.htm?id=730408164255',
    origin: 'https://detail.tmall.com',
  },
  URL,
  URLSearchParams,
  Blob,
  setTimeout,
  clearTimeout,
  GM_xmlhttpRequest() {},
  unsafeWindow: {},
};
context.globalThis = context;
context.window = context;

vm.runInNewContext(source, context, { filename: scriptPath });
const api = context.__shangtuTest;

assert.equal(api.PLATFORM, 'tmall');
assert.equal(api.PRODUCT_ID, '730408164255');
assert.equal(api.normalizeImageUrl('//img.alicdn.com/a.jpg'), 'https://img.alicdn.com/a.jpg');
assert.equal(api.normalizeImageUrl('data:image/png;base64,a'), null);
assert.equal(api.inferImageExtension('https://img.alicdn.com/a.jpg_.webp'), 'webp');
assert.equal(api.inferImageExtension('https://img.alicdn.com/a.jpeg'), 'jpg');
assert.equal(api.inferImageExtension('https://img10.360buyimg.com/img/jfs/a.jpg.dpg'), 'jpg');
assert.equal(api.safeFilenamePart('樱桃粉 长45cm【升级浮点/深层放松】'), '樱桃粉 长45cm【升级浮点_深层放松】');
assert.deepEqual(
  Array.from(api.filterTmallPlatformAssets([
    'https://img.alicdn.com/a_!!633308262.jpg',
    'https://img.alicdn.com/b_!!633308262.jpg',
    'https://img.alicdn.com/notice_!!6000000002284-2-tps-1125-1446.png',
  ])),
  [
    'https://img.alicdn.com/a_!!633308262.jpg',
    'https://img.alicdn.com/b_!!633308262.jpg',
  ],
);

assert.equal(api.detectImageExtension(Uint8Array.from([0xff, 0xd8, 0xff]).buffer), 'jpg');
assert.equal(
  api.detectImageExtension(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]).buffer),
  'webp',
);
assert.equal(
  api.detectImageExtension(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]).buffer),
  'gif',
);
assert.equal(
  api.detectImageExtension(Uint8Array.from([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]).buffer),
  'avif',
);

(async () => {
  const images = await api.fetchTmallImageUrls();
  assert.equal(images.length, 2);
  assert.equal(images[0].name, '730408164255_detail_01.jpg');
  assert.equal(images[1].name, '730408164255_detail_02.gif');

  const skuImages = await api.fetchTmallSkuImageUrls();
  assert.equal(skuImages.length, 2);
  assert.equal(skuImages[0].vid, 'sku-30');
  assert.equal(skuImages[0].skuName, '粉蓝色 长30cm【升级浮点/深层放松】');
  assert.equal(skuImages[0].name, '730408164255_sku_01_粉蓝色 长30cm【升级浮点_深层放松】.webp');
  assert.equal(skuImages[1].name, '730408164255_sku_02_樱桃粉 长45cm【升级浮点_深层放松】.png');
  console.log('userscript tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
