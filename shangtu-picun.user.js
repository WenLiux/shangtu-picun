// ==UserScript==
// @name         商图批存（京东/天猫/淘宝）
// @namespace    https://github.com/WenLiu6677/jingtu-picun
// @version      1.6.1
// @description  一键下载京东、天猫和淘宝商品详情图，并支持天猫/淘宝 SKU 图片批量保存
// @author       Wenl
// @homepageURL  https://github.com/WenLiux/shangtu-picun
// @supportURL   https://github.com/WenLiux/shangtu-picun/issues
// @downloadURL  https://raw.githubusercontent.com/WenLiux/shangtu-picun/main/shangtu-picun.user.js
// @updateURL    https://raw.githubusercontent.com/WenLiux/shangtu-picun/main/shangtu-picun.user.js
// @match        https://item.jd.com/*.html
// @match        https://item.jd.com/*
// @match        https://detail.tmall.com/item.htm*
// @match        https://item.taobao.com/item.htm*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      in.m.jd.com
// @connect      img1.360buyimg.com
// @connect      img10.360buyimg.com
// @connect      img11.360buyimg.com
// @connect      img12.360buyimg.com
// @connect      img13.360buyimg.com
// @connect      img14.360buyimg.com
// @connect      img20.360buyimg.com
// @connect      img30.360buyimg.com
// @connect      img.alicdn.com
// @connect      gw.alicdn.com
// @connect      assets.alicdn.com
// @license      CC-BY-NC-SA-4.0
// ==/UserScript==

(function () {
  'use strict';

  // ====================
  // 识别平台并提取商品 ID
  // ====================
  function detectPlatform() {
    if (location.hostname === 'item.jd.com') return 'jd';
    if (location.hostname === 'detail.tmall.com') return 'tmall';
    if (location.hostname === 'item.taobao.com') return 'taobao';
    return null;
  }

  function getProductId(platform) {
    if (platform === 'jd') {
      const match = location.pathname.match(/(\d+)\.html/);
      return match ? match[1] : null;
    }
    return new URLSearchParams(location.search).get('id');
  }

  const PLATFORM = detectPlatform();
  const PRODUCT_ID = getProductId(PLATFORM);
  if (!PLATFORM || !PRODUCT_ID || !/^\d+$/.test(PRODUCT_ID)) return;

  const PLATFORM_NAME = {
    jd: '京东',
    tmall: '天猫',
    taobao: '淘宝',
  }[PLATFORM];
  const PAGE_REFERER = `${location.origin}/`;

  const DOWNLOAD_CONCURRENCY = 3;
  const DOWNLOAD_RETRIES = 2;
  const DOWNLOAD_TIMEOUT = 45000;

  // ====================
  // DOM 工具
  // ====================
  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) => [...(ctx || document).querySelectorAll(sel)];

  function createEl(tag, attrs = {}, children = []) {
    const el = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'style' && typeof v === 'object') {
        Object.entries(v).forEach(([pk, pv]) => { el.style[pk] = pv; });
      } else if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (k === 'html') {
        el.innerHTML = v;
      } else {
        el.setAttribute(k, v);
      }
    });
    children.forEach(c => {
      if (typeof c === 'string') el.appendChild(document.createTextNode(c));
      else if (c) el.appendChild(c);
    });
    return el;
  }

  // ====================
  // 样式注入
  // ====================
  const CSS = `
.jd-dl-btn {
  position: fixed;
  bottom: 80px;
  right: 20px;
  z-index: 99999;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: linear-gradient(135deg, #e4393c, #c1272d);
  color: #fff;
  border: none;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(228, 57, 60, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.2s, box-shadow 0.2s;
  outline: none;
}
.jd-dl-btn:hover {
  transform: scale(1.08);
  box-shadow: 0 6px 24px rgba(228, 57, 60, 0.6);
}
.jd-dl-btn-sku {
  bottom: 142px;
  background: linear-gradient(135deg, #2563eb, #4f46e5);
  box-shadow: 0 4px 16px rgba(79, 70, 229, 0.45);
}
.jd-dl-btn-sku:hover {
  box-shadow: 0 6px 24px rgba(79, 70, 229, 0.6);
}
.jd-dl-btn-label {
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.4px;
}
.jd-dl-btn:active { transform: scale(0.95); }
.jd-dl-btn svg { width: 24px; height: 24px; fill: none; stroke: #fff; stroke-width: 2; }
.jd-dl-btn.loading { pointer-events: none; animation: jd-dl-spin 0.8s linear infinite; }
@keyframes jd-dl-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.jd-dl-overlay {
  position: fixed;
  inset: 0;
  z-index: 999999;
  background: rgba(0,0,0,0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: jd-dl-fadein 0.2s ease;
}
@keyframes jd-dl-fadein {
  from { opacity: 0; }
  to { opacity: 1; }
}

.jd-dl-panel {
  background: #1e1e2e;
  border-radius: 16px;
  width: 90vw;
  max-width: 820px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 24px 64px rgba(0,0,0,0.5);
  overflow: hidden;
  animation: jd-dl-slideup 0.25s ease;
}
@keyframes jd-dl-slideup {
  from { transform: translateY(30px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

.jd-dl-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 24px;
  border-bottom: 1px solid rgba(255,255,255,0.08);
  flex-shrink: 0;
}
.jd-dl-header h2 {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  color: #f0f0f0;
  letter-spacing: 0.3px;
}
.jd-dl-header-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}
.jd-dl-btn-zip {
  padding: 8px 18px;
  border-radius: 8px;
  border: none;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  background: linear-gradient(135deg, #e4393c, #c1272d);
  color: #fff;
  display: flex;
  align-items: center;
  gap: 6px;
}
.jd-dl-btn-zip:hover { opacity: 0.9; transform: translateY(-1px); }
.jd-dl-btn-zip:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }
.jd-dl-btn-zip svg { width: 16px; height: 16px; fill: none; stroke: #fff; stroke-width: 2; }

.jd-dl-btn-close {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: none;
  background: rgba(255,255,255,0.08);
  color: #999;
  font-size: 20px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  line-height: 1;
}
.jd-dl-btn-close:hover { background: rgba(255,255,255,0.15); color: #fff; }

.jd-dl-body {
  overflow-y: auto;
  padding: 16px 24px;
  flex: 1;
}
.jd-dl-body::-webkit-scrollbar { width: 6px; }
.jd-dl-body::-webkit-scrollbar-track { background: transparent; }
.jd-dl-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 3px; }

.jd-dl-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
}
.jd-dl-card {
  position: relative;
  border-radius: 10px;
  overflow: hidden;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.06);
  cursor: pointer;
  transition: all 0.2s;
}
.jd-dl-card:hover {
  border-color: rgba(228, 57, 60, 0.5);
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(0,0,0,0.3);
}
.jd-dl-card-img {
  width: 100%;
  aspect-ratio: 790 / 600;
  object-fit: cover;
  display: block;
  background: rgba(255,255,255,0.03);
}
.jd-dl-panel-sku .jd-dl-card-img {
  aspect-ratio: 3 / 4;
  object-fit: contain;
}
.jd-dl-card-label {
  position: absolute;
  bottom: 6px;
  right: 6px;
  background: rgba(0,0,0,0.7);
  color: #ccc;
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 4px;
  backdrop-filter: blur(4px);
}
.jd-dl-card-dl {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: rgba(228,57,60,0.85);
  border: none;
  color: #fff;
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.2s;
}
.jd-dl-card:hover .jd-dl-card-dl { opacity: 1; }

.jd-dl-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  color: #aaa;
  gap: 16px;
}
.jd-dl-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(255,255,255,0.1);
  border-top-color: #e4393c;
  border-radius: 50%;
  animation: jd-dl-spin 0.7s linear infinite;
}
.jd-dl-error {
  text-align: center;
  padding: 40px 20px;
  color: #f87171;
}
.jd-dl-error button {
  margin-top: 12px;
  padding: 8px 20px;
  border-radius: 8px;
  border: 1px solid #f87171;
  background: transparent;
  color: #f87171;
  cursor: pointer;
  font-size: 13px;
}
.jd-dl-footer {
  padding: 10px 24px 14px;
  color: #666;
  font-size: 12px;
  text-align: center;
  border-top: 1px solid rgba(255,255,255,0.06);
  flex-shrink: 0;
}

.jd-dl-toast {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999999;
  background: #2d2d3f;
  color: #e0e0e0;
  padding: 10px 24px;
  border-radius: 10px;
  font-size: 14px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  animation: jd-dl-toastin 0.3s ease, jd-dl-toastout 0.3s ease 1.7s forwards;
}
.jd-dl-toast.success { border-left: 3px solid #34d399; }
.jd-dl-toast.error { border-left: 3px solid #f87171; }
@keyframes jd-dl-toastin {
  from { opacity: 0; transform: translateX(-50%) translateY(-10px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}
@keyframes jd-dl-toastout {
  from { opacity: 1; }
  to { opacity: 0; }
}

`;

  const styleEl = createEl('style', { html: CSS });
  document.head.appendChild(styleEl);

  // ====================
  // Toast 提示
  // ====================
  function toast(msg, type = 'success') {
    const el = createEl('div', { class: `jd-dl-toast ${type}` }, [msg]);
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  // ====================
  // 核心：获取详情图 URL 列表
  // ====================
  function normalizeImageUrl(url) {
    if (!url) return null;
    const normalized = String(url).trim().replace(/&amp;/gi, '&');
    if (!normalized || /^(?:data|blob):/i.test(normalized)) return null;
    if (normalized.startsWith('//')) return `https:${normalized}`;
    try {
      return new URL(normalized, location.href).href;
    } catch (_) {
      return null;
    }
  }

  function inferImageExtension(url) {
    const path = url.replace(/[?#].*$/, '');
    const matches = [...path.matchAll(/\.(jpe?g|png|gif|webp|avif)(?=\.|_|$)/gi)];
    if (matches.length === 0) return 'jpg';
    const extension = matches[matches.length - 1][1].toLowerCase();
    return extension === 'jpeg' ? 'jpg' : extension;
  }

  function buildImageInfos(urls) {
    const seen = new Set();
    return urls
      .map(normalizeImageUrl)
      .filter(Boolean)
      .filter(url => {
        const key = url.replace(/\?.*$/, '');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((url, index) => ({
        url,
        name: `${PRODUCT_ID}_detail_${String(index + 1).padStart(2, '0')}.${inferImageExtension(url)}`,
      }));
  }

  function fetchJdImageUrls() {
    const graphextUrl = `https://in.m.jd.com/product/graphext/${PRODUCT_ID}.html`;
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: graphextUrl,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
          'Referer': PAGE_REFERER,
        },
        onload(resp) {
          if (resp.status !== 200) {
            reject(new Error(`HTTP ${resp.status}`));
            return;
          }
          const html = resp.responseText
            .replace(/\\\//g, '/')
            .replace(/&amp;/gi, '&');
          // 同时兼容完整地址、协议相对地址、查询参数及非 DPG 图片。
          const matches = html.match(/(?:https?:)?\/\/[^"'\s<>]*\.360buyimg\.com\/(?:img|imgzone)\/jfs\/[^"'\s<>?]*\.(?:jpe?g|png|webp)(?:\.dpg)?(?:\?[^"'\s<>]*)?/gi);
          if (!matches || matches.length === 0) {
            reject(new Error('未找到详情图，该商品可能没有图片描述'));
            return;
          }
          resolve(buildImageInfos(matches));
        },
        onerror(err) {
          reject(new Error('网络请求失败，请检查网络连接'));
        },
        ontimeout() {
          reject(new Error('请求超时'));
        },
        timeout: 15000,
      });
    });
  }

  const TMALL_DETAIL_SELECTORS = [
    '#imageTextInfo-content',
    '#J_DivItemDesc',
    '.desc-root',
    '.descV8-container',
    '.tb-desc-content',
  ];

  function findTmallDetailRoot() {
    for (const selector of TMALL_DETAIL_SELECTORS) {
      const root = $(selector);
      if (root) return root;
    }
    return null;
  }

  function readElementImageUrl(img) {
    const srcset = img.getAttribute('data-srcset') || img.getAttribute('srcset');
    const srcsetUrl = srcset && srcset.split(',').pop().trim().split(/\s+/)[0];
    return img.getAttribute('data-src')
      || img.getAttribute('data-ks-lazyload')
      || img.getAttribute('data-original')
      || srcsetUrl
      || img.currentSrc
      || img.src;
  }

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function safeFilenamePart(value) {
    const cleaned = cleanText(value)
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/[. ]+$/g, '');
    return (cleaned || 'sku').slice(0, 120);
  }

  function isPlaceholderImageUrl(url) {
    return !url
      || /^(?:data|blob):/i.test(url)
      || /2-tps-2-2|transparent|blank|loading/i.test(url);
  }

  function candidateSkuImageUrl(image) {
    if (!image) return null;
    const candidates = [
      image.currentSrc,
      image.src,
      image.getAttribute('data-src'),
      image.getAttribute('data-original'),
      image.getAttribute('data-lazy-src'),
    ];
    const candidate = candidates.find(url => url && !isPlaceholderImageUrl(url))
      || candidates.find(Boolean);
    return normalizeImageUrl(candidate);
  }

  function findTmallSkuGroup() {
    const labels = $$('[title="颜色分类"]').reverse();
    for (const label of labels) {
      let current = label;
      for (let level = 0; current && level < 8; level++, current = current.parentElement) {
        if (current !== document.body
          && current !== document.documentElement
          && current.querySelectorAll('[data-vid] span[title]').length > 1
          && current.querySelectorAll('[data-vid] img').length > 1) {
          return current;
        }
      }
    }

    return $$('div[class*="skuItemClip"], [data-sku-group]')
      .find(group => group.querySelectorAll('[data-vid] span[title]').length > 1) || null;
  }

  function collectTmallSkuRows() {
    const group = findTmallSkuGroup();
    if (!group) {
      throw new Error('没有找到“颜色分类” SKU 区域，请确认当前是天猫或淘宝商品详情页');
    }

    const rows = $$('[data-vid]', group)
      .map(element => {
        const label = $('span[title], [data-sku-name]', element);
        const image = $('img', element);
        return {
          element,
          vid: element.getAttribute('data-vid') || '',
          name: cleanText(label && (label.getAttribute('title') || label.textContent)),
          disabled: element.getAttribute('data-disabled') === 'true'
            || element.classList.contains('isDisabled'),
          image,
        };
      })
      .filter(row => row.name && row.image && !row.disabled && !/^\d+$/.test(row.name));

    const uniqueRows = new Map();
    rows.forEach(row => {
      const key = row.vid || row.name;
      if (!uniqueRows.has(key)) uniqueRows.set(key, row);
    });

    const result = [...uniqueRows.values()];
    if (result.length === 0) throw new Error('没有找到可售 SKU 图片');
    return result;
  }

  async function loadTmallSkuImage(row) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const image = $('img', row.element);
      const url = candidateSkuImageUrl(image);
      if (url && !isPlaceholderImageUrl(url)) return url;

      if (typeof row.element.scrollIntoView === 'function') {
        row.element.scrollIntoView({ block: 'center', inline: 'nearest' });
      }
      await wait(180);
      await new Promise(resolve => {
        const currentImage = $('img', row.element);
        if (!currentImage || currentImage.complete) {
          resolve();
          return;
        }
        const finish = () => {
          currentImage.removeEventListener('load', finish);
          currentImage.removeEventListener('error', finish);
          resolve();
        };
        currentImage.addEventListener('load', finish, { once: true });
        currentImage.addEventListener('error', finish, { once: true });
        setTimeout(finish, 1200);
      });
    }

    throw new Error(`图片未加载：${row.name}`);
  }

  async function fetchTmallSkuImageUrls() {
    const rows = collectTmallSkuRows();
    const images = [];

    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const url = await loadTmallSkuImage(row);
      images.push({
        url,
        name: `${PRODUCT_ID}_sku_${String(index + 1).padStart(2, '0')}_${safeFilenamePart(row.name)}.${inferImageExtension(url)}`,
        order: index + 1,
        vid: row.vid,
        skuName: row.name,
      });
    }

    return images;
  }

  function filterTmallPlatformAssets(urls) {
    const ownerCounts = new Map();
    urls.forEach(url => {
      const match = String(url).match(/!!(\d+)/);
      if (match) ownerCounts.set(match[1], (ownerCounts.get(match[1]) || 0) + 1);
    });
    const dominantOwner = [...ownerCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .find(([, count]) => count >= 2)?.[0];

    if (!dominantOwner) return urls;
    return urls.filter(url => {
      const ownerMatch = String(url).match(/!!(\d+)/);
      if (!ownerMatch || ownerMatch[1] === dominantOwner) return true;
      return !/!!600000000\d+-2-tps-/i.test(String(url));
    });
  }

  async function fetchTmallImageUrls() {
    const deadline = Date.now() + 15000;
    let root;

    while (Date.now() < deadline) {
      root = findTmallDetailRoot();
      if (root) {
        const urls = filterTmallPlatformAssets(
          $$('img', root).map(readElementImageUrl).filter(Boolean),
        );
        const images = buildImageInfos(urls);
        if (images.length > 0) return images;
      }
      await wait(300);
    }

    if (!root) {
      throw new Error('未找到图文详情区域，请确认商品详情已加载完成');
    }
    throw new Error('图文详情区域中没有可下载的图片');
  }

  function fetchImageUrls(kind = 'detail') {
    if (kind === 'sku') {
      if (PLATFORM === 'jd') throw new Error('SKU 图片下载目前仅支持天猫和淘宝');
      return fetchTmallSkuImageUrls();
    }
    return PLATFORM === 'jd' ? fetchJdImageUrls() : fetchTmallImageUrls();
  }

  // ====================
  // 预览面板
  // ====================
  function showPanel(imageUrls, options = {}) {
    const kind = options.kind || 'detail';
    const isSku = kind === 'sku';
    const collectionName = isSku ? 'SKU 图' : '详情图';
    // 如果已存在，先移除
    const existing = $('.jd-dl-overlay');
    if (existing) existing.remove();

    const overlay = createEl('div', { class: 'jd-dl-overlay' });

    const panel = createEl('div', {
      class: `jd-dl-panel${isSku ? ' jd-dl-panel-sku' : ''}`,
    });

    // Header
    const header = createEl('div', { class: 'jd-dl-header' }, [
      createEl('h2', {}, [`商图批存 · ${PLATFORM_NAME}${collectionName} ${imageUrls.length} ${isSku ? '个' : '张'} · 商品 ID: ${PRODUCT_ID}`]),
      createEl('div', { class: 'jd-dl-header-actions' }, [
        createEl('button', {
          class: 'jd-dl-btn-zip',
          id: 'jd-dl-zip-btn',
          html: `<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> 选择文件夹并下载`,
        }),
        createEl('button', { class: 'jd-dl-btn-close', html: '×' }),
      ]),
    ]);

    // Body — 图片网格
    const body = createEl('div', { class: 'jd-dl-body' });
    const grid = createEl('div', { class: 'jd-dl-grid' });

    imageUrls.forEach((img, i) => {
      const card = createEl('div', { class: 'jd-dl-card' }, [
        createEl('img', {
          class: 'jd-dl-card-img',
          src: img.url,
          loading: 'lazy',
          alt: img.name,
        }),
        createEl('span', { class: 'jd-dl-card-label' }, [img.name]),
        createEl('button', {
          class: 'jd-dl-card-dl',
          title: '下载此图',
          html: '↓',
          onClick(e) {
            e.stopPropagation();
            downloadSingle(img);
          },
        }),
      ]);
      // 点击卡片预览大图
      card.addEventListener('click', () => {
        window.open(img.url, '_blank');
      });
      grid.appendChild(card);
    });

    body.appendChild(grid);
    panel.appendChild(header);
    panel.appendChild(body);

    const footer = createEl('div', { class: 'jd-dl-footer' }, [
      isSku
        ? '按 SKU 名称保存 · 同步生成 CSV/JSON 清单 · By Wenl'
        : '点击图片查看原图 · 批量下载只需选择一次文件夹 · By Wenl',
    ]);
    panel.appendChild(footer);

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    // 关闭
    const closeBtn = $('.jd-dl-btn-close', panel);
    closeBtn.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', escHandler);
      }
    });

    // 批量下载按钮
    const zipBtn = $('#jd-dl-zip-btn', panel);
    zipBtn.addEventListener('click', () => downloadAll(imageUrls, zipBtn, { kind }));
  }

  // ====================
  // 单张下载使用已校验的原始字节，避免 CDN 返回格式与 URL 后缀不一致。
  // ====================
  function replaceImageExtension(name, extension) {
    return name.replace(/\.[^.]+$/, `.${extension}`);
  }

  function triggerBrowserDownload(data, name, extension) {
    const mimeTypes = {
      jpg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      avif: 'image/avif',
    };
    const blobUrl = URL.createObjectURL(new Blob([data], {
      type: mimeTypes[extension] || 'application/octet-stream',
    }));
    const link = createEl('a', {
      href: blobUrl,
      download: name,
      style: { display: 'none' },
    });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
  }

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function downloadWithRetry(imgInfo, retries = DOWNLOAD_RETRIES) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fetchImageData(imgInfo);
      } catch (err) {
        lastError = err;
        if (attempt < retries) await wait(600 * (attempt + 1));
      }
    }
    throw lastError;
  }

  // ====================
  // 单张下载
  // ====================
  async function downloadSingle(imgInfo) {
    try {
      const result = await downloadWithRetry(imgInfo);
      const actualName = replaceImageExtension(imgInfo.name, result.extension);
      triggerBrowserDownload(result.data, actualName, result.extension);
      toast(`${actualName} 下载完成`, 'success');
    } catch (err) {
      toast(`下载失败: ${imgInfo.name}`, 'error');
      console.error('[DETAIL DL] 单张下载失败:', err);
    }
  }

  // ====================
  // 批量保存 — 选择一次目录后，通过 File System Access API 直接写入文件。
  // ====================
  async function pickDownloadDirectory() {
    const options = {
      id: 'ecommerce-detail-images',
      mode: 'readwrite',
      startIn: 'downloads',
    };

    if (typeof window.showDirectoryPicker === 'function') {
      return window.showDirectoryPicker(options);
    }
    if (typeof unsafeWindow !== 'undefined' && typeof unsafeWindow.showDirectoryPicker === 'function') {
      return unsafeWindow.showDirectoryPicker(options);
    }
    throw new Error('当前浏览器不支持文件夹批量保存，请使用最新版 Chrome 或 Edge');
  }

  function detectImageExtension(buffer) {
    const bytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 12));
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const isWebp = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
      && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
    const isGif = bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46
      && bytes[3] === 0x38 && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61;
    const isAvif = bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70
      && bytes[8] === 0x61 && bytes[9] === 0x76 && bytes[10] === 0x69 && bytes[11] === 0x66;
    if (isJpeg) return 'jpg';
    if (isPng) return 'png';
    if (isWebp) return 'webp';
    if (isGif) return 'gif';
    if (isAvif) return 'avif';
    return null;
  }

  function fetchImageData(imgInfo) {
    const imageHost = (() => {
      try {
        return new URL(imgInfo.url).hostname;
      } catch (_) {
        return '未知域名';
      }
    })();

    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: imgInfo.url,
        headers: { Referer: PAGE_REFERER },
        responseType: 'arraybuffer',
        timeout: DOWNLOAD_TIMEOUT,
        async onload(resp) {
          if (resp.status < 200 || resp.status >= 300 || !resp.response) {
            reject(new Error(`图片请求失败: HTTP ${resp.status}`));
            return;
          }

          try {
            let data = resp.response;
            if (data && typeof data.arrayBuffer === 'function') {
              data = await data.arrayBuffer();
            } else if (ArrayBuffer.isView(data)) {
              data = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
            }

            if (!data || typeof data.byteLength !== 'number' || data.byteLength === 0) {
              throw new Error('图片响应为空');
            }
            const extension = detectImageExtension(data);
            if (!extension) {
              throw new Error('服务器返回的不是有效图片');
            }
            resolve({ data, extension });
          } catch (err) {
            reject(err);
          }
        },
        onerror: event => {
          const detail = event && (event.error || event.statusText);
          reject(new Error(`图片请求失败（${imageHost}）${detail ? `：${detail}` : ''}`));
        },
        ontimeout: () => reject(new Error('图片请求超时')),
      });
    });
  }

  async function writeBytesToDirectory(directoryHandle, name, data) {
    const fileHandle = await directoryHandle.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(data);
      await writable.close();
    } catch (err) {
      if (typeof writable.abort === 'function') {
        try { await writable.abort(); } catch (_) { /* ignore cleanup errors */ }
      }
      throw err;
    }

    const savedFile = await fileHandle.getFile();
    const expectedSize = data.byteLength;
    if (savedFile.size !== expectedSize) {
      throw new Error(`写入校验失败: ${savedFile.size}/${expectedSize} 字节`);
    }
    return savedFile.size;
  }

  async function saveImageToDirectory(imgInfo, directoryHandle) {
    const result = await fetchImageData(imgInfo);
    const actualName = replaceImageExtension(imgInfo.name, result.extension);
    const bytes = await writeBytesToDirectory(directoryHandle, actualName, result.data);
    return { name: actualName, bytes };
  }

  async function saveToDirectoryWithRetry(imgInfo, directoryHandle, retries = DOWNLOAD_RETRIES) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await saveImageToDirectory(imgInfo, directoryHandle);
      } catch (err) {
        lastError = err;
        if (attempt < retries) await wait(600 * (attempt + 1));
      }
    }
    throw lastError;
  }

  function csvCell(value) {
    return `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
  }

  async function saveSkuManifest(directoryHandle, rows) {
    const payload = {
      itemId: PRODUCT_ID,
      platform: PLATFORM,
      sourceUrl: location.href,
      generatedAt: new Date().toISOString(),
      count: rows.length,
      successCount: rows.filter(row => row.status === 'downloaded').length,
      failureCount: rows.filter(row => row.status !== 'downloaded').length,
      items: rows,
    };
    const csvRows = [
      ['序号', 'vid', 'SKU名称', '文件名', '图片地址', '状态', '字节数', '错误'],
      ...rows.map(row => [
        row.order,
        row.vid,
        row.skuName,
        row.filename,
        row.imageUrl,
        row.status,
        row.bytes,
        row.error,
      ]),
    ];
    const encoder = new TextEncoder();
    await writeBytesToDirectory(
      directoryHandle,
      'SKU_manifest.json',
      encoder.encode(JSON.stringify(payload, null, 2)),
    );
    await writeBytesToDirectory(
      directoryHandle,
      'SKU_manifest.csv',
      encoder.encode(`\ufeff${csvRows.map(row => row.map(csvCell).join(',')).join('\r\n')}`),
    );
  }

  async function downloadAll(imageUrls, btnEl, options = {}) {
    const total = imageUrls.length;
    if (total === 0) return;

    btnEl.disabled = true;
    const originalHtml = btnEl.innerHTML;
    btnEl.textContent = '请选择保存文件夹...';

    let directoryHandle;
    try {
      directoryHandle = await pickDownloadDirectory();
    } catch (err) {
      btnEl.disabled = false;
      btnEl.innerHTML = originalHtml;
      if (err && err.name === 'AbortError') {
        toast('已取消批量下载', 'error');
      } else {
        toast(err.message || '无法选择保存文件夹', 'error');
        console.error('[DETAIL DL] 选择文件夹失败:', err);
      }
      return;
    }

    const isSku = options.kind === 'sku';
    toast(`正在保存 ${total} ${isSku ? '个 SKU' : '张图片'}到“${directoryHandle.name}”...`, 'success');
    let nextIndex = 0;
    let completed = 0;
    let succeeded = 0;
    const failures = [];
    const manifestRows = new Array(total);

    const worker = async () => {
      while (nextIndex < total) {
        const currentIndex = nextIndex++;
        const img = imageUrls[currentIndex];
        try {
          const saved = await saveToDirectoryWithRetry(img, directoryHandle);
          succeeded++;
          if (isSku) {
            manifestRows[currentIndex] = {
              order: img.order || currentIndex + 1,
              vid: img.vid || '',
              skuName: img.skuName || '',
              filename: saved.name,
              imageUrl: img.url,
              status: 'downloaded',
              bytes: saved.bytes,
              error: '',
            };
          }
        } catch (err) {
          failures.push({ img, error: err });
          if (isSku) {
            manifestRows[currentIndex] = {
              order: img.order || currentIndex + 1,
              vid: img.vid || '',
              skuName: img.skuName || '',
              filename: img.name,
              imageUrl: img.url,
              status: 'failed',
              bytes: 0,
              error: err && err.message || String(err),
            };
          }
          console.error(`[${isSku ? 'SKU' : 'DETAIL'} DL] ${img.name} 下载失败:`, err);
        } finally {
          completed++;
          btnEl.textContent = `下载中 ${completed}/${total}`;
        }
      }
    };

    try {
      const workerCount = Math.min(DOWNLOAD_CONCURRENCY, total);
      await Promise.all(Array.from({ length: workerCount }, () => worker()));
      let manifestError = null;
      if (isSku) {
        btnEl.textContent = '正在写入 SKU 清单...';
        try {
          await saveSkuManifest(directoryHandle, manifestRows);
        } catch (err) {
          manifestError = err;
          console.error('[SKU DL] 清单写入失败:', err);
        }
      }

      if (failures.length === 0 && !manifestError) {
        toast(
          isSku
            ? `全部 ${succeeded} 个 SKU 图片及清单已保存到“${directoryHandle.name}”`
            : `全部 ${succeeded} 张图片已保存到“${directoryHandle.name}”`,
          'success',
        );
      } else {
        const firstError = manifestError
          || failures[0] && failures[0].error;
        toast(
          `${manifestError ? 'SKU 清单写入失败' : `保存失败 ${failures.length} 张`}：${firstError && firstError.message || '未知错误'}`,
          'error',
        );
      }
    } finally {
      btnEl.disabled = false;
      btnEl.innerHTML = originalHtml;
    }
  }

  // ====================
  // 加载状态弹窗
  // ====================
  function showLoading(kind = 'detail') {
    const collectionName = kind === 'sku' ? 'SKU 图片' : '详情图';
    const existing = $('.jd-dl-overlay');
    if (existing) existing.remove();

    const overlay = createEl('div', { class: 'jd-dl-overlay' });
    const panel = createEl('div', { class: 'jd-dl-panel', style: { maxWidth: '400px' } }, [
      createEl('div', { class: 'jd-dl-loading' }, [
        createEl('div', { class: 'jd-dl-spinner' }),
        createEl('span', {}, [`正在获取${collectionName}列表...`]),
        createEl('span', { style: { fontSize: '12px', color: '#666' } }, [`${PLATFORM_NAME}商品 ID: ${PRODUCT_ID}`]),
      ]),
    ]);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    return overlay;
  }

  function showError(message, retryFn) {
    const existing = $('.jd-dl-overlay');
    if (existing) existing.remove();

    const overlay = createEl('div', { class: 'jd-dl-overlay' });
    const panel = createEl('div', { class: 'jd-dl-panel', style: { maxWidth: '400px' } }, [
      createEl('div', { class: 'jd-dl-error' }, [
        createEl('p', {}, [`获取失败: ${message}`]),
        createEl('button', {
          onClick() {
            overlay.remove();
            if (retryFn) retryFn();
          },
        }, ['重试']),
      ]),
      createEl('div', { style: { textAlign: 'center', padding: '0 20px 20px' } }, [
        createEl('button', {
          style: { padding: '8px 16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: '#888', cursor: 'pointer', fontSize: '13px' },
          onClick() { overlay.remove(); },
        }, ['关闭']),
      ]),
    ]);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    // 点击遮罩关闭
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  }

  // ====================
  // 主流程：获取并展示
  // ====================
  async function fetchAndShow(kind = 'detail') {
    const loadingOverlay = showLoading(kind);
    try {
      const imageUrls = await fetchImageUrls(kind);
      loadingOverlay.remove();
      if (imageUrls.length === 0) {
        showError(`未找到任何${kind === 'sku' ? ' SKU ' : '详情'}图片`, () => fetchAndShow(kind));
      } else {
        showPanel(imageUrls, { kind });
      }
    } catch (err) {
      loadingOverlay.remove();
      showError(err.message, () => fetchAndShow(kind));
    }
  }

  // ====================
  // 注入浮动按钮
  // ====================
  function injectButton() {
    if (!$('.jd-dl-btn-detail')) {
      const detailBtn = createEl('button', {
        class: 'jd-dl-btn jd-dl-btn-detail',
        title: '下载商品详情图',
        html: `<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/><rect x="2" y="2" width="7" height="7" rx="1"/><rect x="15" y="2" width="7" height="7" rx="1"/></svg>`,
        onClick: () => fetchAndShow('detail'),
      });
      document.body.appendChild(detailBtn);
    }

    if (PLATFORM !== 'jd' && !$('.jd-dl-btn-sku')) {
      const skuBtn = createEl('button', {
        class: 'jd-dl-btn jd-dl-btn-sku',
        title: '下载全部 SKU 图片',
        html: '<span class="jd-dl-btn-label">SKU</span>',
        onClick: () => fetchAndShow('sku'),
      });
      document.body.appendChild(skuBtn);
    }
  }

  // ====================
  // 启动
  // ====================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectButton);
  } else {
    injectButton();
  }

  console.log(`[商图批存 · Wenl] 已就绪 | ${PLATFORM_NAME}商品 ID: ${PRODUCT_ID} | 右下角可下载详情图${PLATFORM === 'jd' ? '' : '或 SKU 图片'}`);
})();
