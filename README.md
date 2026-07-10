# opencli-plugin-erp321

聚水潭 ERP（[www.erp321.com](https://www.erp321.com) / epaas）的 [OpenCLI](https://github.com/jackwener/opencli) 适配器插件。

把聚水潭后台的商品管理能力封装成命令行：商品查询、Excel 导入、批量改图，以及"导入 + 批量改图"单会话组合命令。

- 仓库：`github:JavaZhengwu/erp321-cli`
- 命令前缀：`opencli erp321 ...`
- 纯 JS 实现，跨平台（macOS / Windows / Linux），无需 esbuild

---

## 目录

- [一、前置条件](#一前置条件)
  - [macOS](#macos)
  - [Windows](#windows)
- [二、安装本插件](#二安装本插件)
- [三、命令一览](#三命令一览)
- [四、使用流程](#四使用流程)
- [五、更新与卸载](#五更新与卸载)
- [六、常见问题（FAQ）](#六常见问题faq)
- [七、实现备注](#七实现备注)

---

## 一、前置条件

本插件依赖 **Node.js**（≥ 18）和 **OpenCLI 运行时**（≥ 1.8.6）。请按你的操作系统选择对应步骤。

### macOS

**1. 安装 Node.js**

推荐用 [Homebrew](https://brew.sh)：

```bash
# 如果还没装 Homebrew，先执行官网的安装脚本
brew install node
node -v      # 确认 >= 18
npm -v
```

若不想用 Homebrew，也可到 [nodejs.org](https://nodejs.org) 下载 macOS 安装包（.pkg）双击安装。

**2. 安装 OpenCLI**

```bash
npm i -g @jackwener/opencli
opencli --version    # 需 >= 1.8.6
```

> 如果报 `EACCES` 权限错误，说明全局目录属主不对。可用 `sudo npm i -g @jackwener/opencli`，或更推荐用 nvm 管理 Node（`brew install nvm`）避免 sudo。

**3. 首次运行会用到浏览器**

登录命令（`opencli erp321 login`）会拉起一个浏览器窗口。首次使用 OpenCLI 浏览器桥接时，如果提示需要初始化，执行：

```bash
opencli browser init
opencli doctor        # 诊断浏览器桥接是否正常
```

---

### Windows

> 建议使用 **PowerShell**（不是 CMD）。以下命令都在 PowerShell 里执行。

**1. 安装 Node.js**

到 [nodejs.org](https://nodejs.org) 下载 Windows 安装包（.msi），双击安装，一路默认即可（会自动把 `node` / `npm` 加入 PATH）。

或用 winget：

```powershell
winget install OpenJS.NodeJS.LTS
```

安装后**新开一个 PowerShell 窗口**再验证：

```powershell
node -v      # 确认 >= 18
npm -v
```

**2. 安装 OpenCLI**

```powershell
npm i -g "@jackwener/opencli"
opencli --version    # 需 >= 1.8.6
```

> 若提示 `opencli` 不是可识别的命令：npm 全局 bin 目录没进 PATH。执行 `npm config get prefix` 查看路径（通常是 `C:\Users\<你>\AppData\Roaming\npm`），把它加到系统环境变量 PATH，然后重开 PowerShell。

> 若提示脚本执行被禁用（`无法加载...因为在此系统上禁止运行脚本`），以管理员身份打开 PowerShell 执行一次：
> ```powershell
> Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
> ```

**3. 首次运行会用到浏览器**

```powershell
opencli browser init
opencli doctor
```

---

## 二、安装本插件

两端命令相同：

```bash
opencli plugin install github:JavaZhengwu/erp321-cli
```

安装后校验命令是否注册成功：

```bash
opencli validate erp321
opencli list
```

在 `opencli list` 的输出里应能看到 `erp321` 分组及其下的 `login / whoami / list / import / batch-pic / import-and-pic` 六个命令。

> **Windows 提示**：`opencli list | grep erp321` 里的 `grep` 在 PowerShell 中不存在，请改用：
> ```powershell
> opencli list | Select-String erp321
> ```

安装过程中若看到一行 `⚠ esbuild not found` 的警告，**可以直接忽略**——本插件是纯 `.js`，不需要 esbuild 转译，命令仍会正常安装。

---

## 三、命令一览

| 命令 | 说明 | 主要参数 |
|------|------|----------|
| `opencli erp321 login` | 打开浏览器登录聚水潭，等待认证完成 | `--timeout <秒>` 等待登录的最长时间 |
| `opencli erp321 whoami` | 查看当前登录账号 | — |
| `opencli erp321 list` | 查询普通商品资料列表 | 见下方「list 参数」 |
| `opencli erp321 import <excel>` | 从 Excel 导入普通商品（xlsx / xls） | `--on_duplicate` 重复策略（默认 `skip`） |
| `opencli erp321 batch-pic <shop>` | 批量修改商品图片（从店铺复制） | `--overwrite` `--select_all` |
| `opencli erp321 import-and-pic <excel>` | 导入 Excel 后自动批量改图（单会话完成） | `--shop`（必填）等，见下方 |

**list 参数**

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `--keyword` | string | — | 商品名称/编码模糊匹配 |
| `--sku` | string | — | SKU 编码精确匹配 |
| `--category` | string | — | 商品分类 ID (c_id) |
| `--status` | string | `on` | `on`=启用 / `off`=停用 / `all`=全部 |
| `--date_type` | string | `created` | `created`=创建日期 / `modified`=修改日期 |
| `--date_start` | string | — | 开始日期，格式 `YYYY-MM-DD HH:mm:ss` |
| `--date_end` | string | — | 结束日期，格式 `YYYY-MM-DD HH:mm:ss` |
| `--page` | int | `1` | 页码 |
| `--page_size` | int | `50` | 每页数量（最大 200） |
| `--sort` | string | — | 排序字段，如 `"modified desc"` |

**import 参数**

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `<file>` | 位置参数 | 必填 | 本地 Excel 文件路径（.xlsx / .xls） |
| `--on_duplicate` | string | `skip` | `skip`=跳过 / `update`=更新 / `update_all`=全部更新 |

**batch-pic 参数**

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `<shop>` | 位置参数 | 必填 | 目标店铺名称（从下拉中匹配） |
| `--overwrite` | bool | `true` | 是否覆盖更新款图 |
| `--select_all` | bool | `true` | 是否全选当前页 |

**import-and-pic 参数**

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `<file>` | 位置参数 | 必填 | 本地 Excel 文件路径（.xlsx / .xls） |
| `--shop` | string | 必填 | 目标店铺名称（用于复制图片） |
| `--on_duplicate` | string | `update_all` | `skip` / `update` / `update_all` |
| `--overwrite` | bool | `true` | 是否覆盖更新款图 |

---

## 四、使用流程

### 第一步：登录（首次必做）

```bash
opencli erp321 login
```

会弹出浏览器，用你的聚水潭账号登录（账号密码或扫码）。登录成功后会话会被保存，后续命令无需重复登录。确认登录态：

```bash
opencli erp321 whoami
```

### 第二步：日常操作

**查询商品**（macOS / Linux）

```bash
# 查启用中的商品，第 1 页
opencli erp321 list --status on

# 按关键字+修改日期区间查询
opencli erp321 list --keyword "连衣裙" \
  --date_type modified \
  --date_start "2026-07-01 00:00:00" \
  --date_end "2026-07-10 23:59:59"
```

**查询商品**（Windows PowerShell，换行用反引号 `` ` ``）

```powershell
opencli erp321 list --keyword "连衣裙" `
  --date_type modified `
  --date_start "2026-07-01 00:00:00" `
  --date_end "2026-07-10 23:59:59"
```

**导入 Excel**

```bash
# macOS
opencli erp321 import ~/Downloads/goods.xlsx --on_duplicate update_all
```

```powershell
# Windows
opencli erp321 import "C:\Users\你\Downloads\goods.xlsx" --on_duplicate update_all
```

**批量改图（从某店铺复制图片）**

```bash
opencli erp321 batch-pic "某某旗舰店"
```

**导入 + 批量改图（一条命令走完）**

```bash
# macOS
opencli erp321 import-and-pic ~/Downloads/goods.xlsx --shop "某某旗舰店"
```

```powershell
# Windows
opencli erp321 import-and-pic "C:\Users\你\Downloads\goods.xlsx" --shop "某某旗舰店"
```

> **路径提示**：macOS 用 `~/Downloads/...`；Windows 用完整盘符路径并加双引号（含中文/空格时尤其必要）。

---

## 五、更新与卸载

```bash
opencli plugin update erp321      # 更新到仓库最新版
opencli plugin uninstall erp321   # 卸载
opencli plugin list               # 查看已安装插件
```

---

## 六、常见问题（FAQ）

**Q：安装时出现 `esbuild not found` 警告，有问题吗？**
没有。这是 OpenCLI 对 `.ts` 插件的通用提示，本插件是纯 `.js`，命令会正常安装和运行，忽略即可。

**Q：`opencli` 命令找不到（command not found / 不是可识别的命令）？**
npm 全局 bin 目录没进 PATH。macOS 检查 `npm config get prefix` 对应的 `bin` 是否在 PATH；Windows 把 `C:\Users\<你>\AppData\Roaming\npm` 加入系统 PATH 后重开终端。

**Q：`login` 弹不出浏览器 / 浏览器桥接报错？**
先执行 `opencli browser init`，再用 `opencli doctor` 诊断。

**Q：命令提示未登录 / 会话过期？**
重新执行 `opencli erp321 login`。

**Q：Windows 下 PowerShell 报"禁止运行脚本"？**
管理员 PowerShell 执行 `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`。

**Q：Windows 下 `opencli list | grep erp321` 没输出？**
`grep` 不是 Windows 命令，改用 `opencli list | Select-String erp321`。

---

## 七、实现备注

- 本插件安装后位于 `~/.opencli/plugins/erp321`（Windows：`%USERPROFILE%\.opencli\plugins\erp321`），与 `~/.opencli/clis/` 下的 custom override 相互独立。
- 登录命令注册器 `site-auth.js` 已内联进本仓库，插件在任何机器上都能独立运行，不依赖 OpenCLI 的 `_shared` 目录。
- `shared.js` / `site-auth.js` 为内部辅助模块，不对外注册命令。

## License

MIT
