/**
 * erp321/shared.js
 * 聚水潭 ERP321 (epaas) 商品管理 - 公共工具
 */
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';

// ─── 常量 ───────────────────────────────────────────────────────
export const ERP_EPAAS_URL = 'https://www.erp321.com/epaas';
export const GOODS_IFRAME_URL = 'https://src.erp321.com/erp-web-group/erp-scm-goods/goodsInventoryManagement?tabAllow=camera&_c=jst-epaas&epaas=true';
export const API_HOST = 'https://apiweb.erp321.com';
export const API_HOST_V2 = 'https://api.erp321.com';

/** 商品列表接口查询字段（完整字段集，从浏览器侦查获得） */
export const QUERY_FIELDS = [
  'pic', 'i_id', 'sku_id', 'name', 'short_name', 'properties_value',
  'sale_price', 'cost_price', 'purchase_price', 'market_price',
  'brand', 'category', 'vc_name', 'labels',
  'sku_code', 'supplier_name', 'supplier_id',
  'purchaseQty', 'weight', 'l', 'w', 'h', 'volume', 'unit',
  'enabled', 'stock_opensync', 'remark', 'sku_tag',
  'bin_min_qty', 'bin_max_qty', 'overflow_qty',
  'pack_qty', 'pack_volume', 'bin',
  'other_price_1', 'other_price_2', 'other_price_3',
  'other_1', 'other_2', 'other_3',
  'modified', 'created', 'creator_name',
  'is_series_number', 'c_id', 'supplier_id', 'pic_big',
];

// ─── 认证 & 租户 ─────────────────────────────────────────────────
/**
 * 确保页面停留在商品管理 iframe URL 上（独立 tab 方式，绕开 iframe 嵌套）。
 * epaas 前面有阿里云 WAF（acw_tc/ssxmod_itna），必须通过 browser bridge。
 */
export async function ensureGoodsPage(page) {
  const currentUrl = await page.getCurrentUrl();
  if (!currentUrl.includes('goodsInventoryManagement')) {
    await page.goto(GOODS_IFRAME_URL);
    await page.wait(3);
  }
  // 验证登录态
  const title = await page.evaluate(`document.title`);
  if (title.includes('登录') || title.includes('login')) {
    throw new AuthRequiredError('erp321', '未检测到登录态，请先在 Chrome 登录 erp321.com/epaas');
  }
}

/**
 * 从当前页面获取租户信息（coid / uid），
 * 聚水潭把这些参数放在前端全局变量或 cookie 里。
 */
export async function getTenant(page) {
  // 聚水潭 cookie 名是 u_co_id / u_id（不是 co_id / user_id）
  // 先尝试从页面 document.cookie 读（src.erp321.com 下可读）
  const fromPage = await page.evaluate(`
    (function(){
      try {
        const coid = (document.cookie.match(/u_co_id=(\\d+)/) || [])[1] || '';
        const uid = (document.cookie.match(/u_id=(\\d+)/) || [])[1] || '';
        return { coid, uid };
      } catch(e) { return { coid: '', uid: '' }; }
    })()
  `);
  let coid = (fromPage && fromPage.coid) || '';
  let uid = (fromPage && fromPage.uid) || '';

  // 兜底：从 CDP cookie store 读取
  if (!coid) {
    const cookies = await page.getCookies({ url: 'https://src.erp321.com' });
    const cookieMap = Object.fromEntries(cookies.map(c => [c.name, c.value]));
    coid = cookieMap['u_co_id'] || '';
    uid = uid || cookieMap['u_id'] || '';
  }

  if (!coid) {
    throw new AuthRequiredError('erp321', '无法获取 coid/uid，请确认已登录 erp321.com/epaas');
  }
  return { coid, uid };
}

// ─── 安装 fetch/XHR hook ────────────────────────────────────────
/**
 * 在页面上挂 fetch + XHR 拦截，缓存到 window.__ocReq[]
 * 后续可用 readHookRequests() 读回。
 */
export async function installNetworkHook(page) {
  await page.evaluate(`
    (function(){
      if (window.__ocHook) return;
      window.__ocHook = true;
      window.__ocReq = [];
      const _f = window.fetch;
      window.fetch = async function(u, opt) {
        try {
          const body = opt && opt.body ? (typeof opt.body === 'string' ? opt.body : '[non-string]') : '';
          window.__ocReq.push({t: Date.now(), src:'fetch', url:String(u), method:(opt&&opt.method)||'GET', body});
          if (window.__ocReq.length > 100) window.__ocReq.shift();
        } catch(e) {}
        return _f.apply(this, arguments);
      };
      const _open = XMLHttpRequest.prototype.open;
      const _send = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function(m,u){ this.__ocUrl=String(u); this.__ocMethod=m; return _open.apply(this,arguments); };
      XMLHttpRequest.prototype.send = function(body){
        try {
          window.__ocReq.push({t:Date.now(), src:'xhr', url:this.__ocUrl, method:this.__ocMethod, body:typeof body==='string'?body:(body?'[non-string]':'')});
          if (window.__ocReq.length > 100) window.__ocReq.shift();
        } catch(e) {}
        return _send.apply(this, arguments);
      };
    })()
  `);
}

/**
 * 读回 hook 缓存中匹配 urlPattern 的请求记录
 */
export async function readHookRequests(page, urlPattern) {
  return page.evaluate(`
    (function(){
      return window.__ocReq
        ? window.__ocReq.filter(r => r.url.includes('${urlPattern}'))
        : [];
    })()
  `);
}

// ─── 通用 DOM 操作 ──────────────────────────────────────────────
/**
 * 点击【搜 索】按钮（ref 固定是 primary btn，text="搜 索"）
 */
export async function clickSearch(page) {
  await page.evaluate(`
    (function(){
      const btn = Array.from(document.querySelectorAll('button.goods-btn-primary'))
        .find(b => b.textContent.trim().includes('搜'));
      if (btn) btn.click();
    })()
  `);
  await page.wait(3);
}

/**
 * 点击【重 置】按钮
 */
export async function clickReset(page) {
  await page.evaluate(`
    (function(){
      const btn = Array.from(document.querySelectorAll('button.goods-btn-default'))
        .find(b => b.textContent.trim().includes('重'));
      if (btn) btn.click();
    })()
  `);
  await page.wait(1);
}

/**
 * 全选当前页商品
 */
export async function selectAllGoods(page) {
  await page.evaluate(`
    (function(){
      const headerCells = Array.from(document.querySelectorAll('th'));
      const checkboxCell = headerCells.find(th => th.querySelector('input[type=checkbox], .goods-checkbox'));
      if (checkboxCell) {
        const cb = checkboxCell.querySelector('.goods-checkbox, label, span');
        if (cb) cb.click();
      }
    })()
  `);
  await page.wait(0.5);
}

/**
 * 设置日期筛选（选择日期类型 + 填开始/结束时间）
 * antd DatePicker readOnly input 必须用模拟键盘输入，
 * 然后点面板"确定"按钮才能同步 React state。
 */
export async function setDateFilter(page, dateType, startDate, endDate) {
  // 1. 打开日期类型下拉
  await page.evaluate(`
    (function(){
      const selects = Array.from(document.querySelectorAll('.goods-select'));
      const dateSelect = selects.find(s => (s.textContent||'').includes('选择日期') || (s.textContent||'').includes('修改日期') || (s.textContent||'').includes('创建日期'));
      if (dateSelect) dateSelect.querySelector('.goods-select-selector').dispatchEvent(new MouseEvent('mousedown', {bubbles:true}));
    })()
  `);
  await page.wait(0.5);

  // 2. 选择日期类型
  const typeLabel = dateType === 'created' ? '创建日期' : '修改日期';
  await page.evaluate(`
    (function(){
      const options = Array.from(document.querySelectorAll('.goods-select-item-option'));
      const target = options.find(o => o.textContent.trim() === '${typeLabel}');
      if (target) target.click();
    })()
  `);
  await page.wait(0.5);

  // 3. 填开始日期 - 用 opencli typeText 模拟键盘输入
  const minName = dateType === 'created' ? 'created_min' : 'modified_min';
  const maxName = dateType === 'created' ? 'created_max' : 'modified_max';

  // 点击开始日期 input
  await page.click(`input[name="${minName}"]`);
  await page.wait(0.3);
  await page.typeText(`input[name="${minName}"]`, startDate);
  await page.wait(0.3);
  // 点确定
  await page.evaluate(`
    (function(){
      const panel = document.querySelector('.goods-picker-dropdown:not(.goods-picker-dropdown-hidden)');
      if (panel) { const ok = panel.querySelector('.goods-btn-primary'); if(ok) ok.click(); }
    })()
  `);
  await page.wait(0.5);

  // 4. 填结束日期
  await page.click(`input[name="${maxName}"]`);
  await page.wait(0.3);
  await page.typeText(`input[name="${maxName}"]`, endDate);
  await page.wait(0.3);
  await page.evaluate(`
    (function(){
      const panel = document.querySelector('.goods-picker-dropdown:not(.goods-picker-dropdown-hidden)');
      if (panel) { const ok = panel.querySelector('.goods-btn-primary'); if(ok) ok.click(); }
    })()
  `);
  await page.wait(0.5);
}
