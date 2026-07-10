/**
 * erp321/import-and-pic.js
 * opencli erp321 import-and-pic — 导入 Excel + 批量修改图片（单会话组合命令）
 *
 * 流程：
 *   1. 打开商品管理页面（一次导航）
 *   2. 从 Excel 导入商品（含策略设置 + 等待完成）
 *   3. 通过 fetch API 按修改时间 ±2min 查询刚导入的商品
 *   4. 全选查询结果
 *   5. 批量修改图片（复制店铺商品图片）
 *
 * 设计：
 *   - 单 page session，不做冗余导航
 *   - 使用 MutationObserver 等待（无 page.wait 硬等）
 *   - 导入完成后以当前时间 ±2min 作为修改时间过滤条件
 */
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { GOODS_IFRAME_URL, QUERY_FIELDS, ensureGoodsPage, getTenant, selectAllGoods } from './shared.js';
import * as fs from 'node:fs';

// ─── MutationObserver-based waitFor helper ─────────────────────────────────
/**
 * 在 page.evaluate 中注入 waitFor 辅助函数。
 * 返回注入代码字符串，在 evaluate 内部调用 waitFor(predicateFn, timeoutMs)。
 */
const WAIT_FOR_HELPER = `
  function waitFor(predicateFn, timeoutMs) {
    timeoutMs = timeoutMs || 30000;
    return new Promise(function(resolve, reject) {
      var result = predicateFn();
      if (result) return resolve(result);
      var timer = null;
      var observer = new MutationObserver(function() {
        var r = predicateFn();
        if (r) {
          observer.disconnect();
          if (timer) clearTimeout(timer);
          resolve(r);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
      timer = setTimeout(function() {
        observer.disconnect();
        var lastTry = predicateFn();
        if (lastTry) resolve(lastTry);
        else reject(new Error('waitFor timeout after ' + timeoutMs + 'ms'));
      }, timeoutMs);
    });
  }
`;

cli({
  site: 'erp321',
  name: 'import-and-pic',
  access: 'write',
  description: '聚水潭 ERP321 导入 Excel 后自动批量修改图片（复制店铺商品图片，单会话完成）',
  domain: 'src.erp321.com',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  args: [
    { name: 'file', required: true, positional: true, help: '本地 Excel 文件路径（.xlsx / .xls）' },
    { name: 'shop', required: true, help: '目标店铺名称（用于复制图片）' },
    {
      name: 'on_duplicate',
      type: 'string',
      default: 'update_all',
      help: '重复处理策略: skip=跳过 / update=更新 / update_all=全部更新',
    },
    { name: 'overwrite', type: 'bool', default: true, help: '是否覆盖更新款图（默认 true）' },
  ],
  columns: ['import_success', 'import_fail', 'goods_found', 'pic_status'],
  func: async (page, kwargs) => {
    const filePath = kwargs.file;
    const shopName = kwargs.shop;
    const shouldOverwrite = kwargs.overwrite !== false;

    // 验证文件存在
    if (!fs.existsSync(filePath)) {
      throw new CommandExecutionError(`文件不存在: ${filePath}`, '请提供有效的 Excel 文件路径');
    }

    // ═══════════════════════════════════════════════════════════════
    // Phase 0: 打开商品管理页面 + 获取租户信息（仅一次导航）
    // ═══════════════════════════════════════════════════════════════
    await ensureGoodsPage(page);
    const tenant = await getTenant(page);

    // ═══════════════════════════════════════════════════════════════
    // Phase 1: 从 Excel 导入商品
    // ═══════════════════════════════════════════════════════════════

    // Step 1.1: 等待页面工具栏加载完毕（导入按钮存在）
    await page.evaluate(`
      (function(){
        ${WAIT_FOR_HELPER}
        return waitFor(function(){
          var btns = document.querySelectorAll('button');
          for(var i = 0; i < btns.length; i++){
            var t = btns[i].textContent.trim();
            if(t === '导入' || (t.indexOf('导入') > -1 && t.length < 6 && btns[i].className.indexOf('dropdown') > -1)){
              btns[i].setAttribute('data-erp321-import-btn', 'true');
              return 'ready';
            }
          }
          return null;
        }, 15000);
      })()
    `);

    // Step 1.2: 用 CDP hover 触发下拉菜单
    await page.hover('button[data-erp321-import-btn=true]');

    // Step 1.3: 等待下拉菜单出现，点击【从Excel导入商品】
    await page.evaluate(`
      (function(){
        ${WAIT_FOR_HELPER}
        return waitFor(function(){
          var items = document.querySelectorAll('.goods-dropdown-menu-item');
          for(var j = 0; j < items.length; j++){
            if(items[j].textContent.indexOf('Excel') > -1 && items[j].textContent.indexOf('商品') > -1){
              items[j].click();
              return 'clicked';
            }
          }
          return null;
        }, 5000);
      })()
    `);

    // Step 1.4: 等待 Excel 导入弹窗出现
    await page.evaluate(`
      (function(){
        ${WAIT_FOR_HELPER}
        return waitFor(function(){
          var modals = document.querySelectorAll('.goods-modal');
          for(var i = 0; i < modals.length; i++){
            var title = modals[i].querySelector('.goods-modal-title');
            if(title && title.textContent.indexOf('Excel') > -1) return 'found';
          }
          return null;
        }, 10000);
      })()
    `);

    // Step 1.4: 设置重复策略
    const strategyMap = { skip: '跳过，不处理', update: '更新', update_all: '全部更新' };
    const strategyLabel = strategyMap[kwargs.on_duplicate] || strategyMap.update_all;

    await page.evaluate(`
      (function(){
        var modals = document.querySelectorAll('.goods-modal');
        var targetModal = null;
        for(var i = 0; i < modals.length; i++){
          var title = modals[i].querySelector('.goods-modal-title');
          if(title && title.textContent.indexOf('Excel') > -1){
            targetModal = modals[i]; break;
          }
        }
        if(!targetModal) return;
        var wraps = targetModal.querySelectorAll('.goods-radio-wrapper');
        for(var j = 0; j < wraps.length; j++){
          if(wraps[j].textContent.trim() === '${strategyLabel}'){
            var input = wraps[j].querySelector('input');
            if(input) input.click();
            break;
          }
        }
      })()
    `);

    // Step 1.5: 上传文件
    await page.evaluate(`
      (function(){
        var modals = document.querySelectorAll('.goods-modal');
        for(var i = 0; i < modals.length; i++){
          var title = modals[i].querySelector('.goods-modal-title');
          if(title && title.textContent.indexOf('Excel') > -1){
            var fileInput = modals[i].querySelector('input[type=file]');
            if(fileInput) fileInput.setAttribute('data-erp321-upload', 'true');
            break;
          }
        }
      })()
    `);
    await page.uploadFiles('input[data-erp321-upload=true]', [filePath]);

    // Step 1.6: 等待导入完成（MutationObserver 监听结果文本）
    const importResult = await page.evaluate(`
      (function(){
        ${WAIT_FOR_HELPER}
        return waitFor(function(){
          var modals = document.querySelectorAll('.goods-modal');
          var targetModal = null;
          for(var i = 0; i < modals.length; i++){
            var title = modals[i].querySelector('.goods-modal-title');
            if(title && title.textContent.indexOf('Excel') > -1){
              targetModal = modals[i]; break;
            }
          }
          if(!targetModal) return { done: true, text: 'modal closed', success_count: 0, fail_count: 0 };
          var text = targetModal.textContent || '';
          var hasResult = text.indexOf('导入成功') > -1 || text.indexOf('导入失败') > -1 || text.indexOf('导入完成') > -1;
          if(!hasResult) return null;
          var successMatch = text.match(/成功\\s*(\\d+)\\s*条/);
          var failMatch = text.match(/异常\\s*(\\d+)\\s*条|失败\\s*(\\d+)\\s*条/);
          return {
            done: true,
            success_count: successMatch ? parseInt(successMatch[1]) : 0,
            fail_count: failMatch ? parseInt(failMatch[1] || failMatch[2]) : 0,
            text: text.substring(text.indexOf('导入'), text.indexOf('导入') + 100)
          };
        }, 120000);
      })()
    `);

    if (!importResult || !importResult.done) {
      throw new CommandExecutionError('导入超时（120秒内未完成）', '请在浏览器中检查导入状态');
    }

    // Step 1.7: 关闭导入弹窗
    await page.evaluate(`
      (function(){
        var modals = document.querySelectorAll('.goods-modal');
        for(var i = 0; i < modals.length; i++){
          var title = modals[i].querySelector('.goods-modal-title');
          if(title && title.textContent.indexOf('Excel') > -1){
            var closeBtn = modals[i].querySelector('[aria-label=Close], .goods-modal-close');
            if(closeBtn) closeBtn.click();
            break;
          }
        }
      })()
    `);

    // 等待弹窗关闭
    await page.evaluate(`
      (function(){
        ${WAIT_FOR_HELPER}
        return waitFor(function(){
          var modals = document.querySelectorAll('.goods-modal');
          for(var i = 0; i < modals.length; i++){
            var title = modals[i].querySelector('.goods-modal-title');
            if(title && title.textContent.indexOf('Excel') > -1){
              var wrapper = modals[i].closest('.goods-modal-wrap');
              if(wrapper && wrapper.style.display === 'none') return true;
              if(modals[i].style.display === 'none') return true;
              return null;
            }
          }
          return true;
        }, 5000);
      })()
    `);

    // ═══════════════════════════════════════════════════════════════
    // Phase 2: 按修改时间查询刚导入的商品（fetch API）
    // ═══════════════════════════════════════════════════════════════

    // 计算 ±2 分钟的时间窗口
    const now = new Date();
    const startTime = new Date(now.getTime() - 2 * 60 * 1000);
    const endTime = new Date(now.getTime() + 2 * 60 * 1000);
    const fmt = (d) => {
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    };
    const modifiedMin = fmt(startTime);
    const modifiedMax = fmt(endTime);

    const queryBody = {
      ip: '',
      uid: tenant.uid,
      coid: tenant.coid,
      page: {
        currentPage: 1,
        pageSize: 200,
        pageAction: 1,
      },
      data: {
        sku_type: 1,
        queryFlds: QUERY_FIELDS,
        orderBy: 'modified desc',
        enabled: '1',
        c_id: '',
        modified_min: modifiedMin,
        modified_max: modifiedMax,
      },
    };

    const listResult = await page.evaluate(`
      (async function(){
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
            body: JSON.stringify(${JSON.stringify(queryBody)})
          }
        );
        return res.json();
      })()
    `);

    if (!listResult || listResult.code !== 0) {
      throw new CommandExecutionError(
        `查询导入商品失败: code=${listResult?.code} msg=${listResult?.msg}`,
        '请确认登录态有效'
      );
    }

    const goodsFound = (listResult.data || []).length;
    if (goodsFound === 0) {
      return [{
        import_success: importResult.success_count || 0,
        import_fail: importResult.fail_count || 0,
        goods_found: 0,
        pic_status: 'skipped - no goods found in time window',
      }];
    }

    // ═══════════════════════════════════════════════════════════════
    // Phase 3: 全选 + 批量修改图片
    // ═══════════════════════════════════════════════════════════════

    // Step 3.1: 重新加载商品管理页面（清除 Phase 1 的 DOM 状态残留）
    // Phase 1 操作后页面上有 antd Dropdown portal 残留，会干扰后续 hover 操作
    // 通过全新导航确保页面干净——与 batch-pic 单独执行时的状态一致
    await page.goto(GOODS_IFRAME_URL);
    await page.evaluate(`
      (function(){
        ${WAIT_FOR_HELPER}
        return waitFor(function(){
          var rows = document.querySelectorAll('tbody tr');
          return rows.length > 0 ? true : null;
        }, 15000);
      })()
    `);

    // Step 3.2: 全选当前页商品
    await selectAllGoods(page);

    // Step 3.3: hover 打开"批量修改"下拉菜单
    const triggerFound = await page.evaluate(`
      (function(){
        var triggers = document.querySelectorAll('[class*=dropdown-trigger]');
        var found = false;
        for(var i = 0; i < triggers.length; i++){
          if(triggers[i].textContent.trim() === '批量修改'){
            triggers[i].dispatchEvent(new MouseEvent('mouseenter', {bubbles: true}));
            triggers[i].dispatchEvent(new MouseEvent('mouseover', {bubbles: true}));
            found = true;
            break;
          }
        }
        if(!found){
          var all = [];
          for(var j = 0; j < triggers.length; j++){
            all.push(triggers[j].textContent.trim().substring(0,20));
          }
          return JSON.stringify({found: false, triggers: all});
        }
        return JSON.stringify({found: true});
      })()
    `);

    // 确认找到了批量修改触发器
    const triggerInfo = JSON.parse(triggerFound || '{}');
    if (!triggerInfo.found) {
      throw new CommandExecutionError(
        `未找到"批量修改"按钮 (可用triggers: ${JSON.stringify(triggerInfo.triggers)})`,
        '可能商品未选中或页面未加载完毕，请重试'
      );
    }

    // 等待下拉菜单项出现（只看可见的含"修改图片"的菜单项）
    await page.evaluate(`new Promise(function(resolve){
      var check = function(){
        var items = document.querySelectorAll('.goods-dropdown-menu-item');
        for(var i = 0; i < items.length; i++){
          if(items[i].offsetParent !== null && items[i].textContent.indexOf('修改图片') > -1) return true;
        }
        return false;
      };
      if(check()) return resolve(true);
      var ob = new MutationObserver(function(){ if(check()){ ob.disconnect(); resolve(true); } });
      ob.observe(document.body, {childList:true, subtree:true, attributes:true});
      setTimeout(function(){ ob.disconnect(); resolve(false); }, 8000);
    })`);

    // Step 3.4: 点击"修改图片信息"
    await page.evaluate(`
      (function(){
        var items = document.querySelectorAll('.goods-dropdown-menu-item');
        for(var i = 0; i < items.length; i++){
          if(items[i].offsetParent !== null && items[i].textContent.trim() === '修改图片信息'){
            items[i].click();
            break;
          }
        }
      })()
    `);

    // Step 3.5: 等待图片修改弹窗出现
    const modalFound = await page.evaluate(`
      (function(){
        ${WAIT_FOR_HELPER}
        return waitFor(function(){
          var modals = document.querySelectorAll('.goods-modal');
          for(var i = 0; i < modals.length; i++){
            var text = modals[i].textContent || '';
            if(text.indexOf('图片') > -1 || text.indexOf('修改图片') > -1 || text.indexOf('批量修改') > -1) return 'found';
          }
          return null;
        }, 10000);
      })()
    `).catch(() => null);

    if (!modalFound) {
      throw new CommandExecutionError(
        '图片修改弹窗未出现',
        '可能没有选中商品、或菜单项点击失败'
      );
    }

    // Step 3.6: 切换到"复制店铺商品中的图片"
    await page.evaluate(`
      (function(){
        var modals = document.querySelectorAll('.goods-modal');
        var modal = null;
        for(var i = 0; i < modals.length; i++){
          var text = modals[i].textContent || '';
          if(text.indexOf('图片') > -1 || text.indexOf('修改图片') > -1){ modal = modals[i]; break; }
        }
        if(!modal) return;
        var spans = modal.querySelectorAll('span, div, label');
        for(var j = 0; j < spans.length; j++){
          if(spans[j].textContent.trim() === '复制店铺商品中的图片'){
            spans[j].click(); break;
          }
        }
      })()
    `);

    // 等待"复制店铺" tab 渲染完成（.goods-select 出现）
    await page.evaluate(`new Promise(function(resolve){
      var check = function(){
        var modals = document.querySelectorAll('.goods-modal');
        for(var i = 0; i < modals.length; i++){
          if(modals[i].textContent.indexOf('复制店铺') > -1 && modals[i].querySelector('.goods-select')) return true;
        }
        return false;
      };
      if(check()) return resolve(true);
      var ob = new MutationObserver(function(){ if(check()){ ob.disconnect(); resolve(true); } });
      ob.observe(document.body, {childList:true, subtree:true, attributes:true});
      setTimeout(function(){ ob.disconnect(); resolve(false); }, 5000);
    })`);

    // Step 3.7: 打开店铺选择器
    await page.evaluate(`
      (function(){
        var modals = document.querySelectorAll('.goods-modal');
        var modal = null;
        for(var i = 0; i < modals.length; i++){
          if(modals[i].textContent.indexOf('复制店铺') > -1){ modal = modals[i]; break; }
        }
        if(!modal) return;
        var selector = modal.querySelector('.goods-select .goods-select-selector') || modal.querySelector('.goods-select');
        if(selector) selector.dispatchEvent(new MouseEvent('mousedown', {bubbles:true}));
      })()
    `);

    // 等待店铺选项列表出现
    await page.evaluate(`new Promise(function(resolve){
      var check = function(){ return document.querySelectorAll('.goods-select-item-option').length > 0; };
      if(check()) return resolve(true);
      var ob = new MutationObserver(function(){ if(check()){ ob.disconnect(); resolve(true); } });
      ob.observe(document.body, {childList:true, subtree:true, attributes:true});
      setTimeout(function(){ ob.disconnect(); resolve(false); }, 5000);
    })`);

    // 等待下拉选项出现并选择店铺
    const shopSelected = await page.evaluate(`
      (function(){
        ${WAIT_FOR_HELPER}
        return waitFor(function(){
          var options = document.querySelectorAll('.goods-select-item-option, .goods-select-dropdown .goods-select-item');
          for(var i = 0; i < options.length; i++){
            if(options[i].textContent.trim().indexOf('${shopName}') > -1){
              options[i].click();
              return { selected: true, shop: options[i].textContent.trim() };
            }
          }
          return null;
        }, 5000).catch(function(){
          var options = document.querySelectorAll('.goods-select-item-option, .goods-select-dropdown .goods-select-item');
          var available = [];
          for(var j = 0; j < options.length && j < 20; j++){
            var t = options[j].textContent.trim();
            if(t) available.push(t);
          }
          return { selected: false, available: available };
        });
      })()
    `);

    if (!shopSelected || !shopSelected.selected) {
      const hint = shopSelected?.available?.length
        ? `可选店铺: ${shopSelected.available.join(', ')}`
        : '当前账号下无店铺';
      throw new CommandExecutionError(`未找到店铺 "${shopName}"`, hint);
    }

    // Step 3.8: 设置"覆盖更新款图"
    await page.evaluate(`
      (function(){
        var modals = document.querySelectorAll('.goods-modal');
        var modal = null;
        for(var i = 0; i < modals.length; i++){
          if(modals[i].textContent.indexOf('复制店铺') > -1 || modals[i].textContent.indexOf('图片') > -1){
            modal = modals[i]; break;
          }
        }
        if(!modal) return;
        var wraps = modal.querySelectorAll('.goods-checkbox-wrapper');
        for(var i = 0; i < wraps.length; i++){
          if(wraps[i].textContent.indexOf('覆盖更新款图') > -1){
            var isChecked = wraps[i].classList.contains('goods-checkbox-wrapper-checked');
            var want = ${shouldOverwrite};
            if(isChecked !== want){
              var input = wraps[i].querySelector('input');
              if(input) input.click();
            }
            break;
          }
        }
      })()
    `);

    // Step 3.9: 点击确认
    await page.evaluate(`
      (function(){
        var modals = document.querySelectorAll('.goods-modal');
        var modal = null;
        for(var i = 0; i < modals.length; i++){
          if(modals[i].textContent.indexOf('复制店铺') > -1 || modals[i].textContent.indexOf('图片') > -1){
            modal = modals[i]; break;
          }
        }
        if(!modal) return;
        var btns = modal.querySelectorAll('button');
        for(var i = 0; i < btns.length; i++){
          if(btns[i].textContent.trim() === '确 认'){
            btns[i].click(); break;
          }
        }
      })()
    `);

    // 等待确认结果（message notice 或弹窗消失）
    const picResult = await page.evaluate(`
      (function(){
        ${WAIT_FOR_HELPER}
        return waitFor(function(){
          var msgs = document.querySelectorAll('.goods-message-notice, [class*=message]');
          for(var i = 0; i < msgs.length; i++){
            if(msgs[i].offsetParent !== null && msgs[i].textContent.trim()){
              return msgs[i].textContent.trim();
            }
          }
          return null;
        }, 15000).catch(function(){ return 'submitted'; });
      })()
    `);

    return [{
      import_success: importResult.success_count || 0,
      import_fail: importResult.fail_count || 0,
      goods_found: goodsFound,
      pic_status: picResult || 'ok',
      shop: shopSelected.shop,
      overwrite: shouldOverwrite,
      time_window: `${modifiedMin} ~ ${modifiedMax}`,
    }];
  },
});
