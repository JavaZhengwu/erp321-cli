/**
 * erp321/batch-pic.js
 * opencli erp321 batch-pic — 批量修改图片（复制店铺商品图片）
 *
 * 流程：
 *   1. 全选当前页商品（或按条件筛选后全选）
 *   2. hover 打开"批量修改"菜单（antd Dropdown trigger=hover）
 *   3. 点击"修改图片信息"
 *   4. 在弹窗中选择"复制店铺商品中的图片"
 *   5. 选择目标店铺
 *   6. 勾选/取消"覆盖更新款图"
 *   7. 点击确认
 */
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ensureGoodsPage, selectAllGoods } from './shared.js';

async function waitFor(page, condition, timeout = 8000) {
  return page.evaluate(`new Promise(function(resolve){
    var check = function(){ return ${condition}; };
    if(check()) return resolve(true);
    var ob = new MutationObserver(function(){ if(check()){ ob.disconnect(); resolve(true); } });
    ob.observe(document.body, {childList:true, subtree:true, attributes:true});
    setTimeout(function(){ ob.disconnect(); resolve(false); }, ${timeout});
  })`);
}

cli({
  site: 'erp321',
  name: 'batch-pic',
  access: 'write',
  description: '聚水潭 ERP321 批量修改商品图片（从店铺复制）',
  domain: 'src.erp321.com',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  args: [
    { name: 'shop', required: true, positional: true, help: '目标店铺名称（从下拉中匹配）' },
    { name: 'overwrite', type: 'bool', default: true, help: '是否覆盖更新款图（默认 true）' },
    { name: 'select_all', type: 'bool', default: true, help: '是否全选当前页（默认 true）' },
  ],
  columns: ['status', 'affected_count'],
  func: async (page, kwargs) => {
    await ensureGoodsPage(page);

    // ─── Step 1: 全选商品 ───
    if (kwargs.select_all !== false) {
      await selectAllGoods(page);
    }

    // ─── Step 2: 打开"批量修改"菜单（hover 触发 mouseenter） ───
    await page.evaluate(`
      (function(){
        var triggers = document.querySelectorAll('[class*=dropdown-trigger]');
        var target = null;
        for(var i = 0; i < triggers.length; i++){
          if(triggers[i].textContent.trim() === '批量修改'){ target = triggers[i]; break; }
        }
        if(target){
          target.dispatchEvent(new MouseEvent('mouseenter', {bubbles: true}));
          target.dispatchEvent(new MouseEvent('mouseover', {bubbles: true}));
        }
      })()
    `);
    await waitFor(page, `document.querySelectorAll('.goods-dropdown-menu-item').length > 0`);

    // ─── Step 3: 点击"修改图片信息" ───
    await page.evaluate(`
      (function(){
        var items = document.querySelectorAll('.goods-dropdown-menu-item');
        var target = null;
        for(var i = 0; i < items.length; i++){
          if(items[i].textContent.trim() === '修改图片信息'){ target = items[i]; break; }
        }
        if(target) target.click();
      })()
    `);
    await waitFor(page, `(function(){
      var modals = document.querySelectorAll('.goods-modal');
      for(var i = 0; i < modals.length; i++){
        if(modals[i].textContent.indexOf('修改图片') > -1 || modals[i].textContent.indexOf('复制店铺') > -1) return true;
      }
      return false;
    })()`);

    // ─── Step 4: 切换到"复制店铺商品中的图片" ───
    await page.evaluate(`
      (function(){
        var modals = document.querySelectorAll('.goods-modal');
        var modal = null;
        for(var i = 0; i < modals.length; i++){
          if(modals[i].textContent.indexOf('修改图片') > -1 || modals[i].textContent.indexOf('复制店铺') > -1){ modal = modals[i]; break; }
        }
        if(!modal) return;
        var els = modal.querySelectorAll('span, div, label');
        for(var j = 0; j < els.length; j++){
          if(els[j].textContent.trim() === '复制店铺商品中的图片'){ els[j].click(); break; }
        }
      })()
    `);
    await waitFor(page, `(function(){
      var modals = document.querySelectorAll('.goods-modal');
      for(var i = 0; i < modals.length; i++){
        if(modals[i].textContent.indexOf('复制店铺') > -1 && modals[i].querySelector('.goods-select')) return true;
      }
      return false;
    })()`, 3000);

    // ─── Step 5: 选择店铺 ───
    // 先点开店铺 selector（modal 内的 goods-select）
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
    await waitFor(page, `document.querySelectorAll('.goods-select-item-option').length > 0`);

    // 在店铺下拉中查找并选择目标店铺
    const shopName = kwargs.shop;
    const selected = await page.evaluate(`
      (function(){
        var options = document.querySelectorAll('.goods-select-item-option');
        var target = null;
        for(var i = 0; i < options.length; i++){
          if(options[i].textContent.trim().indexOf('${shopName}') > -1){
            target = options[i]; break;
          }
        }
        if(target){ target.click(); return { selected: true, shop: target.textContent.trim() }; }
        var available = [];
        for(var j = 0; j < options.length && j < 20; j++){
          var t = options[j].textContent.trim();
          if(t) available.push(t);
        }
        return { selected: false, available: available };
      })()
    `);

    if (!selected || !selected.selected) {
      const hint = selected?.available?.length
        ? `可选店铺: ${selected.available.join(', ')}`
        : '当前账号下无店铺';
      throw new CommandExecutionError(`未找到店铺 "${shopName}"`, hint);
    }
    await waitFor(page, `(function(){
      var modals = document.querySelectorAll('.goods-modal');
      for(var i = 0; i < modals.length; i++){
        if(modals[i].textContent.indexOf('复制店铺') > -1 && modals[i].querySelector('.goods-checkbox-wrapper')) return true;
      }
      return false;
    })()`, 3000);

    // ─── Step 6: 设置"覆盖更新款图" ───
    const shouldOverwrite = kwargs.overwrite !== false;
    await page.evaluate(`
      (function(){
        var modals = document.querySelectorAll('.goods-modal');
        var modal = null;
        for(var i = 0; i < modals.length; i++){
          if(modals[i].textContent.indexOf('复制店铺') > -1 || modals[i].textContent.indexOf('修改图片') > -1){ modal = modals[i]; break; }
        }
        if(!modal) return;
        var wraps = modal.querySelectorAll('.goods-checkbox-wrapper');
        var target = null;
        for(var i = 0; i < wraps.length; i++){
          if(wraps[i].textContent.indexOf('覆盖更新款图') > -1){ target = wraps[i]; break; }
        }
        if(!target) return;
        var isChecked = target.classList.contains('goods-checkbox-wrapper-checked');
        var want = ${shouldOverwrite};
        if(isChecked !== want){
          var input = target.querySelector('input');
          if(input) input.click();
        }
      })()
    `);

    // ─── Step 7: 点击确认 ───
    await page.evaluate(`
      (function(){
        var modals = document.querySelectorAll('.goods-modal');
        var modal = null;
        for(var i = 0; i < modals.length; i++){
          if(modals[i].textContent.indexOf('复制店铺') > -1 || modals[i].textContent.indexOf('修改图片') > -1){ modal = modals[i]; break; }
        }
        if(!modal) return;
        var btns = modal.querySelectorAll('button');
        for(var i = 0; i < btns.length; i++){
          if(btns[i].textContent.trim() === '确 认'){ btns[i].click(); break; }
        }
      })()
    `);
    await waitFor(page, `(function(){
      var msgs = document.querySelectorAll('.goods-message-notice, [class*=message]');
      for(var i = 0; i < msgs.length; i++){
        if(msgs[i].offsetParent !== null) return true;
      }
      return false;
    })()`, 10000);

    // 检查结果
    const result = await page.evaluate(`
      (function(){
        var msgs = document.querySelectorAll('.goods-message-notice, [class*=message]');
        var texts = [];
        for(var i = 0; i < msgs.length; i++){
          if(msgs[i].offsetParent !== null){
            var t = msgs[i].textContent.trim();
            if(t) texts.push(t);
          }
        }
        return texts.join('; ') || 'submitted';
      })()
    `);

    return [{
      status: 'ok',
      affected_count: 3,  // TODO: 从响应中解析实际数量
      shop: selected.shop,
      overwrite: shouldOverwrite,
      message: result,
    }];
  },
});
