# Lucas 独立版规格

## 独立性与许可

- 从空目录编写，不读取、复制或改写 LucasTerm / EdgeTerm 的代码、图标、翻译或样式。
- 不复用旧 Wails Lucas 的实现；只读取其公开于本机的数据字段以迁移用户自己的配置。
- 使用正常第三方依赖，保留依赖许可证要求的 notices；Lucas 主体源码不要求公开。
- 不自动连接真实服务器；测试使用内存替身、临时目录或本机临时服务。

## 功能基线

1. 本地 Shell、SSH、Telnet、串口终端；多标签、分屏、缩放、搜索、复制粘贴。
2. SSH 密码、私钥、私钥口令、SSH Agent、交互式认证、跳板机和主机指纹确认。
3. 本地与 SFTP 文件管理：列表、隐藏文件、路径跳转、新建、重命名、递归删除、上传、下载、进度与取消。
4. FTP 文件管理；串口参数配置；命令保存与多会话发送。
5. 分组嵌套、排序、搜索、编辑、复制、导入 `~/.ssh/config` 和 Lucas 备份。
6. 会话录制、数据导入导出、深浅主题、字体与字号、快捷键、全屏、面板停靠。
7. 界面采用全新 Lucas 设计：大标题导航、卡片式新建连接、圆角工作区、现代配色和清晰状态反馈。

## 后端接口约定

- `App.ListState() Snapshot`：配置、分组和会话快照。
- `App.SaveProfile(Profile) error`、`DeleteProfile(id)`、`DuplicateProfile(id)`。
- `App.SaveGroup(Group) error`、`DeleteGroup(id)`、`SetGroupOrder(ids)`。
- `App.OpenSession(profileID, cols, rows)`、`OpenAdHoc(Profile, save, cols, rows)`。
- `App.Write(id, text)`、`Resize(id, cols, rows)`、`CloseSession(id)`。
- `App.ListFiles(id, path)`、`Upload(id, local, remote)`、`Download(id, remote, local)`。
- `App.Mkdir`、`RenameFile`、`DeleteFile`、`CancelTransfer`。
- `App.SetRecording(id, enabled)`、`ExportData`、`ImportData`。
- SSH 交互问题通过 `lucas:prompt` 发出，由 `App.AnswerPrompt(id, answer)` 回答。

## 验证

独立版使用 `~/Library/Application Support/Lucas 2`，与任何早期同名应用隔离。

- 存储、迁移、分组和路径处理先写失败测试，再实现。
- 会话管理验证并发读写、关闭幂等、事件顺序和资源释放。
- 前端组件和构建检查；最终打包并隔离启动，验证旧数据导入且不修改源文件。
