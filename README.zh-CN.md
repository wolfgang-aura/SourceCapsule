# SourceCapsule

[English](README.md) | 简体中文

**把 X/Twitter 的推文串和 Article 存成干净的 Markdown 喂给大模型，同时留一份单文件离线 HTML
存档。**

在一条推文、一条推文串或一篇 Article 上点一下，就得到一个可以直接给 AI 用的文件夹：一份可以粘贴进
Claude 或 ChatGPT 的 `.llm.md`、它引用的真实图片文件，以及一份把媒体和引用推文全部内联、完全离线也能
打开的 `.html`。不用截图，不会被复制粘贴弄乱格式，原推没了也不会只剩死链。

**为什么不直接复制粘贴或者截图？**

- **大模型读文本，不读像素。** 你拿到的是按阅读顺序排列的 Markdown，带作者、时间戳和原始链接，另外还有
  智能体真的能看的图片文件。
- **推文串很难复制。** X 会虚拟化长推文串、懒加载媒体；SourceCapsule 会自己滚动、抓取，并且如实报告
  抓到了什么、哪些没抓到。
- **它是存档，不只是提取。** 同一次点击还会生成一份自包含的离线 HTML，图片、内联视频、引用推文都嵌在
  里面，十年后仍然能打开。

## 安装（30 秒）

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 或 Violentmonkey。
2. 从
   [Greasy Fork](https://greasyfork.org/en/scripts/584577-sourcecapsule-x-article-post-self-contained-html)
   安装 SourceCapsule（会自动更新），或者打开
   [sourcecapsule.user.js](https://raw.githubusercontent.com/wolfgang-aura/SourceCapsule/main/sourcecapsule.user.js)
   点 **Install**。
3. 在 x.com 打开任意推文、推文串或 Article，点 **Save thread** / **Save article**。

源文件就是发布出去的文件：纯 JavaScript，没有生产构建步骤。

## v1.5 新增

- **回复存档（实验性）。** 抓取一条推文下面的*回复*，包括全文、作者、时间戳、父级 id 和媒体链接，输出
  成带层级的 Markdown 加一份全文 CSV。见下面的[回复存档](#回复存档实验性)。
- **更短的菜单。** 推文下拉菜单一度长到十项，常用操作反而被埋了，现在是六项。功能没有减少：
  **Save locally + create AI link** 本来就是两个仍然单独列着的操作，而 **Download ZIP (HTML + Markdown)**
  是 **Save to library** 在非 Chromium 浏览器上本来就会自动走的回退路径。
- **一张图只算一个媒体链接。** X 会用带扩展名和不带扩展名两种 URL 提供同一张图，所以被两个抓取层看到的
  图片以前会被记两次。现在两个 URL 指向同一份资源时，保留大图那个。

## v1.4.1 新增

- **AI 可读链接里的媒体是完整的。** 选 **Create AI readable link** 时，会像本地保存一样把抓到的图片和
  视频封面一起打包。分享不再依赖你先做一次本地保存。25 MB 的分享上限依旧。

## v1.4 新增

- **严格导出模式（默认开启）。** 所有恢复层跑完之后，SourceCapsule 会再走一遍成品模型，如果读者会撞上
  死路就拦下下载：引用推文没有规范永久链接、引用推文的内容没抓到、图片没能内联、视频既没有字节也没有
  封面。拦截弹窗会逐条列出坏在哪里，提供 **Copy diagnostic bundle** 按钮（自包含 JSON，含 URL、判定、
  计数和一份去掉媒体的模型骨架），必须选 **Ship it anyway** 或 **Cancel export** 才能继续。可在脚本
  管理器菜单或扩展弹窗里开关。
- **引用来源的三层恢复。** 就算 X 的 DOM 把锚点丢了，导出器也能拿到被引用推文的规范永久链接：
  (a) 从 X 自己的网页应用已经下载过的 GraphQL 响应里被动收集的 父级→被引用 三元组，(b) 对剩下的用
  syndication 池做匹配，(c) 逐条推文的 syndication 调用，复用取回的 `quoted_tweet` 数据，一次往返里
  同时补上来源 URL 和重建卡片。
- **作者主页兜底链接。** 万一每一层都没抓到，引用卡片会链到作者的 X 主页，而不是显示
  “Source URL unavailable”，读者永远不会走进死路。
- **推文串菜单的逃生口。** 每个聚焦推文的按钮下拉里现在都有 **Save full thread**，不管自动识别结果是
  什么。选它会强制完整滚动整列，所以晚加载的同作者回复一定会被抓到——“我知道这是推文串，为什么按钮写着
  Save post”这种情况一键就能解决。
- **分享 Worker 的预览。** 分享出去的胶囊在 GET 和 HEAD 上都会返回 `Content-Length`，所以 Slack、
  Discord 和 Twitter 的链接预览能正确渲染图片和页面。
- **一次到位的恢复加固。** 只含引用的 GraphQL 响应会被保留、没挂载出来的引用卡片会从父级数据重建、
  Article 里的图片能扛过虚拟化、只存在于 DOM 的投票和链接卡片在被权威数据升级时不会丢、有歧义的视频
  URL 绝不靠猜挂到某条推文上。媒体下载会做签名校验，HTTP 错误页没法冒充成一张抓到的图。
- **更清楚的控件和打包。** 重新设计的 MV3 弹窗会说明页面是否就绪、交付的是文件夹还是 ZIP，带可访问的
  开关、键盘导航、深色模式和减少动效支持。一次性的 HTML + Markdown 下载现在打在同一个 ZIP 里。

产品依然是本地优先。除非你主动选 **Create AI readable link** 并确认过期时间，否则什么都不会上传，而
回复存档根本不上传。保存和分享合并执行时，会先把本地那份写完，所以上传失败不会把它带走。分享出去的
胶囊不含原始视频、上限 25 MB，媒体放不进去时会保留来源链接。

## 怎么用

在 X 时间线、状态页或 Article 上：

- 点 **Save post**、**Save thread** 或 **Save article** 走默认的快速保存。
- 如果时间线卡片上显示 **Open post first**，先打开推文，再从状态页/Article 页保存；信息流里的预览内容
  不足以做完整存档。
- 点旁边的 **...** 可以选：
  - Save full thread（在聚焦推文页）
  - Save with note and tags
  - Copy clean Markdown
  - Create AI readable link
  - Capture replies (experimental)——在聚焦推文页
  - Download reply archive——在聚焦推文页

第一次保存到库时会让你选一个根文件夹。桌面版 Chromium 会直接写文件夹。不支持 File System Access API 的
浏览器会拿到一个结构相同的 zip。

```text
<library root>/
  _sourcecapsule-index.md
  2026-07-02/
    <handle>-<status-id>/
      <handle>-<status-id>.html
      <handle>-<status-id>.llm.md
      AI_LINK.txt              # only after an AI readable link is created
      media/
      README.txt
```

推文串抓取刻意保持诚实：它收录渐进滚动过程中可见的同作者推文，标出每条的边界，并在清单里记下
`best-effort` 完整度。X 可能虚拟化或干脆不给某些推文，所以这还不是“超长推文串里每一条都能抓到”的保证。

## 回复存档（实验性）

上面所有功能存的是一条推文和它的推文串。这个功能存的是**别人对它的回复**，输出成带层级的 Markdown 加
一份全文 CSV。

在打开的推文页上点 **...**，然后：

1. **Capture replies (experimental)**——一次点击会走完 X 的三个回复视图（Latest、Top、Relevant）并合并
   结果。大型对话要花几分钟，每个视图都会报进度。过程中请让标签页保持在前台。
2. **Download reply archive**——写出 `sourcecapsule-replies-<id>.md` 和 `.csv`。

多次运行之间回复只增不减。有内容的字段绝不会被空值覆盖，长文本永远赢，所以被截断的预览不可能盖掉完整的
长文，而在后面的视图里消失的回复也会保住已经抓到的内容。存储用 IndexedDB；写入失败会明确报错，而不是
悄悄丢掉这一轮的结果。

**回复的媒体只记链接，这是有意的**——给成千上万条回复下载媒体不在范围内。图片、视频和封面都以 URL 形式
列出，你可以自己点进去。

### 到底能抓多全？

每份存档都会报告自己抓到了什么，列出它知道存在但没能取回的回复 id，并且拒绝把 X 显示的回复数当成分母。
在三段真实对话上实测：

| X 上显示的回复数 | 抓到内容的条数 | 已知但未抓到 |
| --- | --- | --- |
| 764 | 636 | 0 |
| 670 | 537 | 0 |
| 32 | 36 | 0 |

三次都抓到了 **X 实际投递给浏览器的 100% 回复**。前两行和计数器的差额是 X 压根没给的回复，删除的、屏蔽
的、受限的，或者任何视图都没返回的，这类从原理上就无法察觉。第三行超过计数器，是因为 X 那个数字似乎只
算直接回复，而存档连回复的回复也一起抓了。

覆盖率是尽力而为，每份导出的回执里都会这么写。已删除、私密和从未投递的回复无从得知。

## AI 可读链接

脚本默认指向托管的分享服务
（`https://sourcecapsule-share.wolfgang-aura.workers.dev`）：Cloudflare Worker + R2 后端，创建链接按 IP
限流，单个包上限 25 MB，可选 1/7/30 天过期，每天清理。试用步骤：

1. 在 x.com 打开一条推文，点 SourceCapsule 按钮旁边的 **...**。
2. 点 **Create AI readable link**。
3. 保持 **7 days**，或者改成 1/30 天。
4. 确认。生成的 URL 会复制到剪贴板。
5. 把 URL 粘到新标签页打开。在胶囊 URL 后面加 `.md` 就是干净 Markdown 的端点。

链接过期后，存档副本会被删除，但链接不会变成空白：它会返回一个简短的提示页，指回 X 上的原推，你发给的
人还能找到出处。`.md` 端点返回同样内容的 Markdown 版本。这个指针只保存原推的公开永久链接、标题和作者
handle，不包含任何关于是谁创建了链接的信息，并且在过期 180 天后删除，你手动删链接的话会立刻删掉。

创建成功的链接会记在这个浏览器里，位置是 **SourceCapsule: Recent AI readable links**。过期的链接仍然
可见，只是变灰。如果链接是从本地保存回执或者“保存并分享”的合并流程里创建的，SourceCapsule 还会在保存的
Markdown 旁边写一份 `AI_LINK.txt`，这样从库文件夹里也能找回同一个链接。

### 对着本地分享服务开发

```powershell
cd SourceCapsule
npm.cmd install
npm.cmd run dev:share
```

让那个 PowerShell 窗口开着，然后在 x.com 上打开 Tampermonkey，把
**SourceCapsule: Share service URL** 设成 `http://127.0.0.1:8787`。换成别的主机还需要在脚本头部加对应的
`@connect` 授权（扩展则要在 manifest 里加 `host_permissions`）。

### 自托管分享服务

后端是一个很小的 Cloudflare Worker 加一个 R2 桶。部署细节见
[`share-worker/README.md`](share-worker/README.md)。账号体系、计费和永久链接额度是有意不放进第一版分享
功能的。

## 试用 Chrome 扩展（未打包 beta）

```powershell
cd SourceCapsule
npm.cmd run build:extension
```

然后在 Chrome 里：

1. 打开 `chrome://extensions`。
2. 打开右上角的 **Developer mode**。
3. 点 **Load unpacked**。
4. 选
   `dist\sourcecapsule-extension`。
5. 在 Tampermonkey 里对 x.com 停用 SourceCapsule 用户脚本，免得出现两个按钮。
6. 刷新一个状态页，测试快速保存、只存本条、复制 Markdown 和 AI 可读链接。

这个包通过一层很薄的兼容层复用了已经测试过的用户脚本引擎，跑通了自动化打包测试套件和真实 X 上的验证。在
单独准备 Chrome 应用商店上架之前，它一直是未打包的 beta。

## 能抓到什么

| 内容 | 结果 |
| --- | --- |
| 正文、标题、列表、链接 | 按阅读顺序保留 |
| 同作者的推文串续写 | 尽力抓取，并明确标出每条边界 |
| 图片 | 以能拿到的最高分辨率内联 |
| 引用推文 | 用 X syndication 数据重建成可选中的卡片 |
| 可下载的 MP4 | 嵌进完整的离线 HTML 存档 |
| 只有 HLS 或被拦截的视频 | 保留封面和来源链接，明确标记为不完整 |
| 智能体用的包 | Markdown 加真实的图片/封面文件；不含原始视频 |
| 某条推文的回复 | 带层级的 Markdown + 全文 CSV；媒体只给链接（实验性） |
| 出处信息 | 来源 URL、作者、时间戳、警告和抓取清单 |

存档绝不会声称自己保存了比实际更多的东西。缺失的媒体、只有预览的长文引用、不完整的视频，在渲染结果和
清单里都看得见。对于长文（note）推文，只要 X 在页面打开期间已经把全文投递到你的浏览器，SourceCapsule
就会恢复全文（不发额外请求）；否则预览会被明确标记为截断。

## 设置

在 x.com 上打开脚本管理器菜单：

- **Layout：** 按日期分文件夹（默认）或平铺。
- **Contents：** 完整存档（默认）或精简 Markdown + 媒体。
- **Strict Export：** 默认开启；在恢复重试之后拦住悄悄不完整的下载。
- **Reply Context：** 默认开启；导出一条回复时把被回复的原推附在前面。
- **Share service URL：** 开发时填 localhost，生产填你自己的 Worker 域名。
- **Change export folder：** 换一个库根目录。
- **Floating button：** 可选，默认关闭。

## 开发

环境要求：Node.js 18+。

```powershell
cd SourceCapsule
npm.cmd install
npm.cmd test
npm.cmd run lint
npm.cmd run format:check
npm.cmd run build:extension
```

自动化套件覆盖了不依赖 DOM 的渲染器、基于 jsdom 的提取和推文串行为、分享 Worker 以及扩展打包。它不能
替代在 X 真实 DOM 上的手工测试。

## 隐私与安全

- 普通保存全程留在你自己的机器上。
- 分享需要显式确认，并且必须设过期时间。
- 分享 ID 是高熵、猜不出来的，但拿到链接的人都能读。
- 分享页会发送 `noindex` 和一组严格的安全响应头。
- 服务会拒绝不支持的文件路径，每个胶囊上限 25 MB。
- 删除令牌在客户端生成，不出现在公开 URL 里。
- 过期之后只剩一条指回原公开推文的返回链接；删掉链接连它也一起删。

在身份验证和滥用防护做出来之前，不要用公开部署去分享敏感内容。“猜不出来”对 v1 测试来说是够用的访问
控制，但不能替代用户账号体系。

## v1.5 有意不做的事

- AI 摘要、对话、OCR、转写或媒体描述
- 抓取书签和批量导出
- 永久链接额度、用户账号、计费或订阅
- 托管的控制台或全文搜索
- HLS 视频重组
- 保证抓到任意长推文串里的每一条
- 下载回复里的媒体（回复存档只记链接）
- Chrome 应用商店上架

## 许可

MIT。见 [LICENSE](LICENSE)。
