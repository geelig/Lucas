# Lucas

Lucas 是一款本地优先的终端与远程文件工作区，提供连接管理、终端、SFTP/FTP 文件管理、资源监控、命令历史和可配置外观。主体使用 Go、Wails、React、TypeScript 和 xterm.js 独立实现。

当前发布版本：**3.1.6**。

## 功能

- **连接管理**：SSH、Telnet、串口、FTP 和本地 Shell；分组、搜索、复制、拖动排序、系统图标检测。
- **终端体验**：单击定位、双击或 Enter 连接；分屏、搜索、选择复制、右键粘贴、多行粘贴确认。
- **安全保护**：主机指纹确认、密钥变更二次确认、可配置高风险命令拦截、AES-GCM 凭据加密。
- **命令配色**：命令、参数、路径、权限、文件类型、JSON、日志级别、错误、警告和成功信息均可配色。
- **文件工作区**：远程目录跟随、七列表格、上传下载、重命名、新建目录、删除和传输记录。
- **资源管理**：连接状态、用户、地址、CPU、内存、网络速率与进程管理。
- **效率工具**：常用命令、历史命令、批量发送、配置导入导出和配置目录迁移。
- **界面定制**：左右模块自由停靠、面板宽度调整、深浅主题、字体与完整颜色角色设置。

## 下载

前往 [Releases](https://github.com/geelig/Lucas/releases) 获取对应平台安装包。

| 平台 | 发布文件 | 说明 |
|---|---|---|
| macOS（Apple Silicon） | `Lucas-3.1.6-macos-arm64.zip` | 解压后打开 `Lucas.app` |
| Windows x64 | `Lucas-3.1.6-windows-amd64.zip` | 解压后运行 `Lucas.exe` |
| Linux x64 | `Lucas-3.1.6-linux-amd64.tar.gz` | 解压后运行 `Lucas` |
| HarmonyOS | 暂不提供 | 当前 Wails 目标平台不包含鸿蒙，需独立 ArkTS 适配，不以其他平台包冒充 |

Linux 解压后如缺少执行权限，可在终端执行 `chmod +x Lucas`。不同操作系统的安全策略可能要求用户确认应用来源。

## 数据与安全

- 默认数据目录：macOS 为 `~/Library/Application Support/Lucas`；其他桌面系统使用对应的用户配置目录。
- SSH 主机记录使用 `~/.ssh/known_hosts`。主机密钥变化时不会自动信任，必须核对新指纹并明确接受。
- 密码和私钥口令使用本机独立密钥加密保存，配置备份不包含这些凭据。
- 命令历史和常用命令可随备份导出并在导入时合并去重。
- 不连接任何远程服务即可使用本地 Shell、配置和外观功能。

## 从源码构建

要求：Go 1.26、Node.js 22、Wails CLI 2.17.1，以及对应平台的构建环境。

```sh
# 安装 Wails CLI
go install github.com/wailsapp/wails/v2/cmd/wails@v2.17.1

# 安装前端依赖
cd frontend && npm ci && cd ..

# 测试
go test ./...
cd frontend && npm test && cd ..

# macOS 构建、签名并输出应用
sh scripts/build.sh
```

macOS 应用输出为 `build/bin/Lucas.app`。Windows 和 Linux 使用对应原生环境执行：

```sh
wails build -platform windows/amd64
wails build -platform linux/amd64
```

跨平台 Release 由 `.github/workflows/release.yml` 在 macOS、Windows 和 Ubuntu 原生 runner 上分别构建，不使用本机交叉编译产物代替。

## 发布

推送 `v*` 标签会触发测试、三平台构建和 Release 附件上传。也可在 Actions 中手动运行 Release 工作流。

当前版本不包括 HarmonyOS 原生安装包。后续如支持，将使用独立的鸿蒙实现与真实设备验证，而不是复用不兼容的桌面二进制。

## 许可

主体代码和原创视觉资产的许可见 [LICENSE](LICENSE)。第三方框架与组件保留各自许可，详见 [NOTICE](NOTICE) 和构建生成的 `THIRD_PARTY_NOTICES.txt`。
