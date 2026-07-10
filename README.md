# opencli-plugin-erp321

聚水潭 ERP（[www.erp321.com](https://www.erp321.com) / epaas）的 [OpenCLI](https://github.com/jackwener/opencli) 适配器插件。

把聚水潭后台的商品管理能力封装成命令行：商品查询、Excel 导入、批量改图，以及"导入 + 批量改图"单会话组合命令。

## 前置条件

先安装 OpenCLI 运行时（本插件依赖它）：

```bash
npm i -g @jackwener/opencli
opencli --version   # 需 >= 1.8.6
```

## 安装

```bash
opencli plugin install github:<your-github-username>/opencli-plugin-erp321
```

安装后校验：

```bash
opencli validate erp321
opencli list | grep erp321
```

## 命令

| 命令 | 说明 |
|------|------|
| `opencli erp321 login` | 打开浏览器登录聚水潭，等待会话认证完成 |
| `opencli erp321 whoami` | 查看当前登录账号 |
| `opencli erp321 list` | 查询普通商品资料列表（支持关键字 / SKU / 分类 / 状态 / 日期筛选） |
| `opencli erp321 import <excel>` | 从 Excel 导入普通商品（xlsx / xls） |
| `opencli erp321 batch-pic` | 批量修改商品图片（从店铺复制） |
| `opencli erp321 import-and-pic` | 导入 Excel 后自动批量改图（复制店铺图片，单会话完成） |

## 使用示例

```bash
# 首次使用先登录
opencli erp321 login

# 查询商品
opencli erp321 list

# 导入 Excel
opencli erp321 import ./goods.xlsx

# 导入并批量改图（组合命令）
opencli erp321 import-and-pic --file ./goods.xlsx --shop "某店铺"
```

## 更新 / 卸载

```bash
opencli plugin update erp321      # 更新到仓库最新版
opencli plugin uninstall erp321   # 卸载
```

## 备注

- 本插件为纯 JS（`.js`）实现，安装时**无需 esbuild** 转译。安装过程中若出现 `esbuild not found` 的提示可忽略——那是对 `.ts` 插件的通用警告，不影响本插件。
- `site-auth.js` 是登录命令注册器，已内联进本仓库，插件在任何机器上都能独立运行，无需 OpenCLI 的 `_shared` 目录。
- `shared.js` / `site-auth.js` 是内部辅助模块，不对外注册命令。

## License

MIT
