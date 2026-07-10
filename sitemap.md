# erp321 sitemap

> 聚水潭 ERP321 / epaas 商品管理 CLI adapter
> 侦查时间: 2026-07-08 | opencli v1.8.6 | 浏览器: Chrome via Browser Bridge

## 站点信息

- 外壳 URL: `https://www.erp321.com/epaas`（无 XHR，纯外壳）
- 业务 iframe URL: `https://src.erp321.com/erp-web-group/erp-scm-goods/goodsInventoryManagement`
- adapter 直接 open iframe URL 为独立 tab，绕开 iframe 嵌套
- 反爬: 阿里云 WAF（`acw_tc` / `ssxmod_itna` cookie），必须走 browser bridge
- 多租户: querystring `owner_co_id` / `authorize_co_id`，body 里 `uid` / `coid`

## 命令总览

| 命令 | 说明 | 类型 |
|------|------|------|
| `opencli erp321 auth status` | 登录态检查 | read |
| `opencli erp321 list` | 普通商品资料列表/筛选 | read |
| `opencli erp321 import <file>` | 从 Excel 导入商品 | write |
| `opencli erp321 batch-pic <shop>` | 批量修改图片（从店铺复制） | write |

## 接口映射

### 商品列表 (list)

```
POST https://apiweb.erp321.com/webapi/ItemApi/ItemSku/GetPageListV2
  ?__from=web_component&owner_co_id={coid}&authorize_co_id={coid}

Request Body:
{
  "ip": "",
  "uid": "{uid}",
  "coid": "{coid}",
  "page": { "currentPage": 1, "pageSize": 50, "pageAction": 1 },
  "data": {
    "sku_type": 1,
    "queryFlds": [...46个字段...],
    "orderBy": "",
    "enabled": "1",          // ""=全部, "1"=启用, "0"=停用
    "c_id": "",              // 分类 ID
    "keyword": "",           // 模糊搜索
    "sku_id": "",            // SKU 精确匹配
    "created_min": "",       // 创建日期开始
    "created_max": "",       // 创建日期结束
    "modified_min": "",      // 修改日期开始
    "modified_max": ""       // 修改日期结束
  }
}

Response: { code: 0, page: {currentPage, pageSize, count, pages, index}, data: [...] }
成功码: code === 0
count === -1 表示后端未计算总数
```

### Excel 导入 (import)

三步异步流程：

```
1. POST https://api.erp321.com/erp/webapi/ItemApi/CompanyInfo/GetOssToken
   → { data: { uploadUrl, fileUrl, contentType, docId } }

2. PUT https://jstzbstatic.erp321.com/Webapi/ItemApi/{uuid}.xlsx
   （带 OSS 签名: Expires, OSSAccessKeyId, Signature）

3. POST https://api.erp321.com/erp-tcp/webapi/ItemApi/ItemSku/ImportItemSkuV3
   → { data: { requestId, finish, successCount, failCount, skipCount, failDatas[] } }

4. 轮询 POST https://api.erp321.com/erp/webapi/ItemApi/ItemSku/GetImportItemSkuResponse
   → 每 2s 一次，直到 finish === true
   → failDatas[]: { skuId, errorType, errorMessage }
```

### 批量修改图片 (batch-pic)

纯 DOM 操作流程（无直接 API，通过 UI 交互触发）：

```
1. 全选: th checkbox → click()
2. 打开菜单: "批量修改" 触发器 → mouseenter (hover trigger)
3. 选子项: .goods-dropdown-menu-item "修改图片信息" → click()
4. 切 tab: modal 内 "复制店铺商品中的图片" → click()
5. 选店铺: .erp-selector input → click() → option → click()
6. 覆盖款图: .goods-checkbox-wrapper "覆盖更新款图" → toggle
7. 确认: button "确 认" → click()
```

## DOM 关键定位

| 元素 | 定位方式 |
|------|----------|
| 搜索按钮 | `button.goods-btn-primary` 含"搜" |
| 重置按钮 | `button.goods-btn-default` 含"重" |
| 导入按钮 | `[class*=dropdown-trigger]` text="导入" |
| 批量修改触发器 | `[class*=dropdown-trigger]` text="批量修改" |
| 日期类型下拉 | `.goods-select` 含"选择日期" text |
| 日期 picker 开始 | `input[name=created_min]` 或 `input[name=modified_min]` |
| 日期 picker 结束 | `input[name=created_max]` 或 `input[name=modified_max]` |
| 全选 checkbox | `th` 内的 `.goods-checkbox` |
| antd modal | `.goods-modal` |
| 导入 modal | `.goods-modal.modalWrap___TrpFs` |
| 图片修改 modal | `.goods-modal.pictureModal___RAwnK` |

## 已知坑

- antd Dropdown 默认 trigger=hover，用 `mouseenter` 事件展开，`click()` 无效
- antd DatePicker input 是 readOnly，`nativeInputValueSetter` 只改 DOM 不同步 React state；
  必须用 opencli `type` 模拟键盘输入，再点面板"确定"按钮
- DOM ref 会 stale（页面变化后失效），建议用 `eval` + querySelector 代替 ref 编号
- epaas iframe 在外壳 tab 切换后可能被销毁，frames 返回 []；
  解决方案：直接 open iframe URL 为独立 tab
- 导入弹窗选完文件后**自动开始导入**，不需要额外点确认按钮
- `page.count === -1` 是后端有意为之（不计算总数以提升性能）
