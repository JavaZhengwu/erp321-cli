/**
 * erp321/list.js
 * opencli erp321 list — 普通商品资料列表查询（纯 API 模式，无页面渲染等待）
 *
 * 真实接口：POST https://apiweb.erp321.com/webapi/ItemApi/ItemSku/GetPageListV2
 * 优化：只需要 cookie + gwfp → 直接发 fetch，不等待 DOM 渲染
 */
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { GOODS_IFRAME_URL, QUERY_FIELDS } from './shared.js';

/**
 * 轻量级 ensurePage：只确保当前页面是 src.erp321.com（用于读取 cookie + localStorage），
 * 不等待 DOM 完全渲染。比 shared.ensureGoodsPage 省 ~2s。
 */
async function ensureMinimalPage(page) {
  const url = await page.getCurrentUrl();
  if (!url.includes('src.erp321.com')) {
    await page.goto(GOODS_IFRAME_URL);
    await page.evaluate(`new Promise(function(resolve){
      if(document.readyState === 'complete' || document.readyState === 'interactive') return resolve('ready');
      document.addEventListener('DOMContentLoaded', function(){ resolve('ready'); });
      setTimeout(function(){ resolve('timeout'); }, 5000);
    })`);
  }
}

/**
 * 从 cookie + localStorage 获取 tenant info，不依赖 DOM 渲染
 */
async function getQuickTenant(page) {
  const result = await page.evaluate(`(function(){
    try {
      var coid = (document.cookie.match(/u_co_id=(\\d+)/) || [])[1] || '';
      var uid = (document.cookie.match(/u_id=(\\d+)/) || [])[1] || '';
      var gwfp = localStorage.getItem('gwfp') || '';
      return { coid: coid, uid: uid, gwfp: gwfp };
    } catch(e) { return null; }
  })()`);
  if (!result || !result.coid) {
    throw new AuthRequiredError('erp321', '无法获取 coid，请确认已登录 erp321.com/epaas');
  }
  return result;
}

cli({
  site: 'erp321',
  name: 'list',
  access: 'read',
  description: '聚水潭 ERP321 普通商品资料列表（支持关键字/SKU/分类/状态/日期筛选）',
  domain: 'src.erp321.com',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  args: [
    { name: 'keyword',    type: 'string', help: '商品名称/编码模糊匹配' },
    { name: 'sku',        type: 'string', help: 'SKU 编码精确匹配' },
    { name: 'category',   type: 'string', help: '商品分类 ID (c_id)' },
    { name: 'status',     type: 'string', default: 'on', help: 'on=启用 / off=停用 / all=全部' },
    { name: 'date_type',  type: 'string', default: 'created', help: 'created=创建日期 / modified=修改日期' },
    { name: 'date_start', type: 'string', help: '开始日期，格式 YYYY-MM-DD HH:mm:ss' },
    { name: 'date_end',   type: 'string', help: '结束日期，格式 YYYY-MM-DD HH:mm:ss' },
    { name: 'page',       type: 'int', default: 1, help: '页码' },
    { name: 'page_size',  type: 'int', default: 50, help: '每页数量（最大 200）' },
    { name: 'sort',       type: 'string', help: '排序字段，如 "modified desc"' },
  ],
  columns: ['sku_id', 'name', 'properties_value', 'sale_price', 'enabled', 'created', 'modified'],
  func: async (page, kwargs) => {
    await ensureMinimalPage(page);
    const tenant = await getQuickTenant(page);

    const enabled = kwargs.status === 'all' ? ''
                  : kwargs.status === 'off' ? '0' : '1';

    const body = {
      ip: '',
      uid: tenant.uid,
      coid: tenant.coid,
      page: {
        currentPage: kwargs.page || 1,
        pageSize: Math.min(kwargs.page_size || 50, 200),
        pageAction: 1,
      },
      data: {
        sku_type: 1,
        queryFlds: QUERY_FIELDS,
        orderBy: kwargs.sort || '',
        enabled,
        c_id: kwargs.category || '',
        ...(kwargs.keyword ? { keyword: kwargs.keyword } : {}),
        ...(kwargs.sku ? { sku_id: kwargs.sku } : {}),
        ...(kwargs.date_start ? { [`${kwargs.date_type || 'created'}_min`]: kwargs.date_start } : {}),
        ...(kwargs.date_end ? { [`${kwargs.date_type || 'created'}_max`]: kwargs.date_end } : {}),
      },
    };

    const result = await page.evaluate(`(async function(){
      var gwfp = localStorage.getItem('gwfp') || '';
      var res = await fetch(
        '//apiweb.erp321.com/webapi/ItemApi/ItemSku/GetPageListV2?__from=web_component&owner_co_id=${tenant.coid}&authorize_co_id=${tenant.coid}',
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Accept': 'application/json',
            'gwfp': gwfp
          },
          body: JSON.stringify(${JSON.stringify(body)})
        }
      );
      return res.json();
    })()`);

    if (!result || result.code !== 0) {
      throw new CommandExecutionError(
        `erp321 list 接口返回错误: code=${result?.code} msg=${result?.msg}`,
        '请确认登录态有效，或稍后重试'
      );
    }

    const items = result.data || [];
    return items.map((item, i) => ({
      ...item,
      _rank: (body.page.currentPage - 1) * body.page.pageSize + i + 1,
    }));
  },
});
