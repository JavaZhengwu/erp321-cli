/**
 * erp321/auth.js
 * 聚水潭 ERP321 登录态验证
 */
import { AuthRequiredError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from './site-auth.js';
import { ERP_EPAAS_URL, GOODS_IFRAME_URL } from './shared.js';

async function hasErp321Cookie(page) {
  const cookies = await page.getCookies({ url: 'https://src.erp321.com' });
  return cookies.some(c => c.name === 'u_co_id' || c.name === 'isLogin');
}

async function verifyErp321Identity(page) {
  if (!await hasErp321Cookie(page)) {
    throw new AuthRequiredError('erp321', 'erp321 登录 cookie 缺失，请先登录');
  }
  await page.goto(GOODS_IFRAME_URL);
  await page.wait(3);
  const url = await page.getCurrentUrl();
  if (url.includes('login') || url.includes('signin')) {
    throw new AuthRequiredError('erp321', 'erp321 session 已过期，请重新登录');
  }
  // 获取当前用户信息 - 使用 CDP cookie store
  const cookies = await page.getCookies({ url: 'https://src.erp321.com' });
  const cookieMap = Object.fromEntries(cookies.map(c => [c.name, c.value]));
  const coid = cookieMap['u_co_id'] || '';
  const uid = cookieMap['u_id'] || '';
  const name = cookieMap['u_name'] ? decodeURIComponent(cookieMap['u_name']) : '';
  return { user_id: uid, company_id: coid, name };
}

registerSiteAuthCommands({
  site: 'erp321',
  domain: 'erp321.com',
  loginUrl: 'https://www.erp321.com/epaas',
  columns: ['user_id', 'company_id', 'name'],
  quickCheck: hasErp321Cookie,
  verify: verifyErp321Identity,
  poll: async (page) => {
    await page.wait(3);
    return hasErp321Cookie(page);
  },
});
