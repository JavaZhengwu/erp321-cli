/**
 * erp321/import.js
 * opencli erp321 import — 从 Excel 导入商品
 *
 * 流程：
 *   1. hover 导入按钮 → 从Excel导入商品
 *   2. 设置重复策略
 *   3. 上传文件
 *   4. 轮询等待导入完成
 */
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { GOODS_IFRAME_URL, ensureGoodsPage, getTenant } from './shared.js';
import * as fs from 'node:fs';

// ─── MutationObserver-based wait helper ───
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
  name: 'import',
  access: 'write',
  description: '聚水潭 ERP321 从 Excel 导入普通商品（支持 xlsx/xls）',
  domain: 'src.erp321.com',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  args: [
    { name: 'file', required: true, positional: true, help: '本地 Excel 文件路径（.xlsx / .xls）' },
    {
      name: 'on_duplicate',
      type: 'string',
      default: 'skip',
      help: '重复处理策略: skip=跳过 / update=更新 / update_all=全部更新',
    },
  ],
  columns: ['success_count', 'fail_count', 'skip_count'],
  func: async (page, kwargs) => {
    await ensureGoodsPage(page);
    const tenant = await getTenant(page);
    const filePath = kwargs.file;

    // 验证文件存在
    if (!fs.existsSync(filePath)) {
      throw new CommandExecutionError(`文件不存在: ${filePath}`, '请提供有效的 Excel 文件路径');
    }

    // ─── Step 1: 打开导入弹窗 ───
    // hover【导入】按钮（antd Dropdown trigger=hover）
    await page.evaluate(`
      (function(){
        var btns = document.querySelectorAll('button');
        for(var i = 0; i < btns.length; i++){
          var t = btns[i].textContent.trim();
          if(t === '导入' || (t.indexOf('导入') > -1 && t.length < 6 && btns[i].className.indexOf('dropdown-trigger') > -1)){
            btns[i].dispatchEvent(new MouseEvent('mouseenter', {bubbles:true}));
            btns[i].dispatchEvent(new MouseEvent('mouseover', {bubbles:true}));
            break;
          }
        }
      })()
    `);

    // 等待下拉菜单项出现
    const dropdownVisible = await waitFor(
      page,
      `document.querySelector('.goods-dropdown-menu-item') && document.querySelector('.goods-dropdown-menu-item').offsetParent !== null`,
      8000
    );
    if (!dropdownVisible) {
      throw new CommandExecutionError('导入下拉菜单未出现', '请确认页面已加载完成');
    }

    // 点击【从Excel导入商品】
    await page.evaluate(`
      (function(){
        var items = document.querySelectorAll('.goods-dropdown-menu-item, [class*=dropdown-menu-item]');
        for(var i = 0; i < items.length; i++){
          if(items[i].textContent.indexOf('Excel') > -1 && items[i].textContent.indexOf('商品') > -1){
            items[i].click();
            break;
          }
        }
      })()
    `);

    // 等待 Excel 导入弹窗出现
    const modalAppeared = await waitFor(
      page,
      `(function(){ var ms = document.querySelectorAll('.goods-modal'); for(var i=0;i<ms.length;i++){ var t=ms[i].querySelector('.goods-modal-title'); if(t && t.textContent.indexOf('Excel')>-1) return true; } return false; })()`,
      10000
    );
    if (!modalAppeared) {
      throw new CommandExecutionError('Excel导入弹窗未出现', '请检查页面状态');
    }

    // ─── Step 2: 设置重复策略（在 Excel 导入弹窗内） ───
    const strategyMap = { skip: '跳过，不处理', update: '更新', update_all: '全部更新' };
    const strategyLabel = strategyMap[kwargs.on_duplicate] || strategyMap.skip;

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

    // ─── Step 3: 上传文件（定位 Excel 导入弹窗内的 file input） ───
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

    // ─── Step 4: 等待导入完成（轮询 Excel 导入弹窗状态） ───
    let result = null;
    for (let i = 0; i < 120; i++) {
      const found = await waitFor(
        page,
        `(function(){ var ms = document.querySelectorAll('.goods-modal'); for(var i=0;i<ms.length;i++){ var t=ms[i].querySelector('.goods-modal-title'); if(t && t.textContent.indexOf('Excel')>-1){ var txt=ms[i].textContent||''; return txt.indexOf('导入成功')>-1||txt.indexOf('导入失败')>-1||txt.indexOf('导入完成')>-1; } } return false; })()`,
        1000
      );

      if (found) {
        result = await page.evaluate(`
          (function(){
            var modals = document.querySelectorAll('.goods-modal');
            var targetModal = null;
            for(var i = 0; i < modals.length; i++){
              var title = modals[i].querySelector('.goods-modal-title');
              if(title && title.textContent.indexOf('Excel') > -1){
                targetModal = modals[i]; break;
              }
            }
            if(!targetModal) return { done: true, text: 'modal closed' };
            var text = targetModal.textContent || '';
            var successMatch = text.match(/成功\\s*(\\d+)\\s*条/);
            var failMatch = text.match(/异常\\s*(\\d+)\\s*条|失败\\s*(\\d+)\\s*条/);
            return {
              done: true,
              success_count: successMatch ? parseInt(successMatch[1]) : 0,
              fail_count: failMatch ? parseInt(failMatch[1] || failMatch[2]) : 0,
              text: text.substring(text.indexOf('导入'), text.indexOf('导入') + 100)
            };
          })()
        `);
        break;
      }
    }

    if (!result || !result.done) {
      throw new CommandExecutionError('导入超时（120秒内未完成）', '请在浏览器中检查导入状态');
    }

    // 关闭弹窗
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

    return [{
      success_count: result.success_count || 0,
      fail_count: result.fail_count || 0,
      skip_count: result.skip_count || 0,
      message: result.text || 'done',
    }];
  },
});
