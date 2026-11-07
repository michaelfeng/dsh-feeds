/**
 * dsh-feeds — Client half.
 *
 * Registers the "信息源" (Feeds) Conversation View: a split reader over the
 * user's Feedly/RSS subscriptions. The left column lists the newest items with
 * category/source filters, search, read state and day grouping; the right
 * column is an in-page reading pane backed by the Host's `feeds/article`
 * endpoint. A Sources mode manages subscriptions. All data comes from the
 * bundle's Host half through the RPC contract in CONTRACT.md; this module never
 * fetches a feed by itself.
 */
window.__ModuleLoader__.load({
  id: 'dsh-feeds',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Dictionary namespace owned by this plugin (the View tab label binds to it). */
    const NS = 'feeds';
    /** Stable identifier used for the injected stylesheet tag. */
    const PACKAGE_ID = 'dsh-feeds';
    /** Connection RPC channel of the bundle's Host half: exact `/api` Fetch routes. */
    const HOST_CHANNEL = '/api';
    /** Sentinel category that means "no category filter". */
    const ALL_CATEGORIES = '*';
    /** Durable client preferences for filters and view mode. */
    const PREFS_KEY = 'dsh-feeds:prefs:v1';
    /** Bounded client-side article cache, keyed by item id. */
    const ARTICLE_CACHE_LIMIT = 30;
    const READER_FONT_SIZES = Array.from({length:15},(_,index)=>14+index);
    /** View mode ids. */
    const MODE_FEED = 'feed';
    const MODE_SOURCES = 'sources';
    /** Select value that opens an inline new-category input. */
    const NEW_CATEGORY_VALUE = '__new_category__';
    /** Host's canonical uncategorized category name; its display label is localized. */
    const HOST_UNCATEGORIZED = '未分类';
    const categoryLabel = (name, t) => (name === HOST_UNCATEGORIZED ? t('sources.uncategorized') : name);
    const EMPTY_ITEMS = Object.freeze([]);
    const EMPTY_GROUPS = Object.freeze([]);
    const DAY_MS = 24 * 60 * 60 * 1000;
    /** Header relative-time refresh cadence. */
    const CLOCK_INTERVAL_MS = 60_000;
    /** Rich-article bounds: drop anything beyond these before rendering. */
    const MAX_ARTICLE_BLOCKS = 300;
    const MAX_BLOCK_TEXT = 4000;
    const MAX_LIST_ITEMS = 30;
    const MAX_MEDIA_TEXT = 300;
    const MAX_IMAGE_URL = 2048;

    //#region dictionaries
    /** English copy. Keys mirror locale/en.json, including the display metadata. */
    const en = {
      "meta": {
        "title": "Feeds",
        "description": "Reads your Feedly and RSS subscriptions from a global panel in the DeepSeek Harness sidebar, with an in-page reading pane, source management, search, and unread tracking."
      },
      "view.title": "Feeds",
      "view.loading": "Loading feeds…",
      "view.refreshing": "Refreshing…",
      "view.refreshingProgress": "Refreshing {done}/{total} sources…",
      "view.refreshFailed": "Could not refresh feeds. Showing the last loaded items.",
      "view.markFailed": "Could not update the read state.",
      "view.hostUnavailable": "Feeds are unavailable",
      "view.hostUnavailableText": "Could not reach the DSH host or load your subscriptions. The host half of the feeds plugin may not be loaded.",
      "view.retry": "Retry",
      "mode.label": "View mode",
      "mode.feed": "Feed",
      "mode.sources": "Sources",
      "help.button": "?",
      "help.label": "Keyboard shortcuts",
      "help.title": "Keyboard shortcuts",
      "help.close": "Close shortcuts",
      "help.next": "Next item",
      "help.prev": "Previous item",
      "help.open": "Open the original article",
      "help.toggleRead": "Toggle read/unread",
      "help.search": "Focus search",
      "help.refresh": "Refresh feeds",
      "help.escape": "Close the reading pane or clear search",
      "help.keyNext": "J / ↓",
      "help.keyPrev": "K / ↑",
      "help.keyOpen": "Enter",
      "help.keyRead": "M",
      "help.keySearch": "/",
      "help.keyRefresh": "R",
      "help.keyEscape": "Esc",
      "refresh.label": "Refresh feeds",
      "refresh.button": "Refresh",
      "search.label": "Search all cached articles",
      "search.placeholder": "Search all cached titles, summaries and sources",
      "search.clear": "Clear search",
      "filter.label": "Filter by category",
      "filter.all": "All",
      "filter.unread": "Unread",
      "filter.categoryUnread": "{name}, {count} unread",
      "filter.source": "Source: {name}",
      "filter.clearSource": "Clear source filter",
      "markAll.label": "Mark all as read",
      "notice.markedAll": "Marked {count} items as read",
      "notice.markAllFailed": "Could not update the read state for all items.",
      "notice.undo": "Undo",
      "stats.feeds": "{count} sources",
      "stats.feedsOne": "{count} source",
      "stats.unread": "{count} unread",
      "stats.failed": "{count} failed",
      "stats.lastRefresh": "Last refreshed {time}",
      "stats.lastRefreshNever": "Not refreshed yet",
      "stats.autoRefresh": "Auto-refresh every {minutes} min",
      "group.heading": "{name} · {count} items",
      "group.today": "Today",
      "group.yesterday": "Yesterday",
      "group.earlier": "Earlier",
      "item.untitled": "Untitled item",
      "item.toggleRead": "Toggle read",
      "row.sourceFilter": "Filter by source: {name}",
      "health.failed": "{count} sources failed to refresh",
      "health.failedOne": "{count} source failed to refresh",
      "health.show": "Show failed sources",
      "health.hide": "Hide failed sources",
      "health.noDetails": "No failure details were reported.",
      "empty.noFeedsTitle": "No feeds yet",
      "empty.noFeedsText": "Export your subscriptions from Feedly as an OPML file and ask DSH to import it, for example: help me import ~/Downloads/feedly-*.opml",
      "empty.noMatches": "No items match the current filters",
      "empty.noMatchesHint": "Try a different search or filter.",
      "pane.close": "Close reading pane",
      "pane.back": "Back to list",
      "pane.label": "Reading pane",
      "pane.loading": "Loading article…",
      "pane.failed": "Could not load this article.",
      "pane.fallback": "Showing the stored summary because the full article could not be read.",
      "pane.fallbackError": "Could not read the full article ({error}). Showing the summary below.",
      "pane.empty": "No readable content.",
      "pane.open": "Open original",
      "pane.summarize": "Send to chat",
      "pane.markRead": "Mark as read",
      "pane.markUnread": "Mark as unread",
      "pane.copyLink": "Copy link",
      "pane.focus": "Focus reading",
      "pane.unfocus": "Exit focus reading",
      "pane.imageFailed": "Image failed to load",
      "pane.openImage": "Open image",
      "pane.imageCount": "{count} images",
      "pane.by": "By {author}",
      "pane.dshPrompt": "First call feeds with action=\"article\", itemId=\"{itemId}\". Summarize only the returned article or excerpt, distinguishing facts from interpretation. Explicitly disclose summary-only content or extraction failures.\nTitle: {title}\nLink: {link}",
      "notice.questionCopied": "Question copied. Paste it into the input box.",
      "notice.questionInserted": "Question inserted into the input box.",
      "notice.linkCopied": "Link copied.",
      "notice.copyFailed": "Copy failed. Select the text and copy it manually.",
      "sources.failedOnly": "Only failed fetches",
      "sources.countsAria": "{unread} unread of {total} items",
      "sources.errorBadge": "Fetch failed",
      "sources.only": "Only this source",
      "sources.refresh": "Refresh",
      "sources.remove": "Unsubscribe",
      "sources.removeConfirm": "Remove “{title}”? This cannot be undone.",
      "sources.removed": "Removed {title}.",
      "sources.removeFailed": "Could not remove this source.",
      "sources.refreshFailed": "Could not refresh {title}.",
      "sources.noFailed": "No failed sources.",
      "import.title": "Import subscriptions",
      "import.path": "Current OPML: {path}",
      "import.noOpml": "No OPML imported",
      "import.hint": "Ask DSH to import your Feedly OPML export, for example: help me import ~/Downloads/feedly-*.opml",
      "import.copy": "Copy import instruction",
      "import.command": "help me import ~/Downloads/feedly-*.opml",
      "import.copied": "Import instruction copied.",
      "import.selected": "Instruction selected. Press Ctrl/Cmd+C to copy.",
      "import.copyFailed": "Copy failed. Select the instruction and copy it manually.",
      "time.justNow": "just now",
      "time.minutes": "{count} min ago",
      "time.hours": "{count} h ago",
      "time.yesterday": "Yesterday",
      "time.days": "{count} d ago",
      "time.date": "{date}",
      "stats.overview": "{feeds} sources · {items} cached articles · {unread} unread",
      "reader.settings": "Reading settings",
      "reader.font": "Text size",
      "reader.density": "List density",
      "reader.summary": "Summary",
      "reader.compact": "Compact",
      "reader.readMode": "Mark read",
      "reader.read.delay": "After reading for 2 seconds",
      "reader.read.open": "When content loads",
      "reader.read.manual": "Manually",
      "saved.label": "Read later",
      "saved.remove": "Remove from read later",
      "saved.failed": "Could not save. Previous state restored.",
      "saved.empty": "Your read-later queue is empty",
      "list.count": "Loaded {loaded} of {total}",
      "list.countLoaded": "{count} articles",
      "list.more": "Load more",
      "list.failed": "Could not load articles. Try again.",
      "markAll.loaded": "Mark {count} loaded articles read",
      "markAll.failed": "Could not update the read state.",
      "nav.label": "Reading queues and sources",
      "sources.counts": "{unread} unread · {total} cached",
      "sources.lastSuccess": "Last success: {time}",
      "sources.healthSummary": "{healthy} healthy sources · {failed} last fetches failed",
      "health.manage": "{count} sources failed · Review (cached articles remain available)",
      "pane.contentSource.feed": "Content from RSS feed",
      "pane.contentSource.web": "Content from original page",
      "pane.contentSource.summary": "Feed summary only",
      "pane.truncated": "This is a bounded excerpt of a longer article. Open the original to continue.",
      "pane.retryFull": "Retry full text",
      "pane.previous": "Previous",
      "pane.next": "Next",
      "reader.grouping": "Update layout",
      "reader.group.source": "Group by source",
      "reader.group.time": "Timeline",
      "group.updates": "{count} updates",
      "group.expand": "Show {count} more",
      "group.collapse": "Collapse updates",
      "reader.fontDecrease": "Decrease article text size",
      "reader.fontIncrease": "Increase article text size",
      "filter.reset": "Clear all filters",
      "filter.searchTerm": "Search: {query}",
      "empty.sourceRead": "No unread articles in this source",
      "empty.sourceSaved": "No matching read-later articles in this source",
      "empty.sourceCached": "This source has {count} cached articles.",
      "empty.showSourceAll": "Show all articles in this source",
      "empty.sourceFailed": "Source fetch failed; no cached articles yet",
      "empty.sourceNoCache": "No cached articles in this source yet",
      "health.currentSource": "This source failed: {error} · Review",
      "sources.management": "Source management",
      "sources.addFeed": "+ Add subscription",
      "sources.addFeedTitle": "Add subscription",
      "sources.importOpml": "Import OPML",
      "sources.newCategory": "+ New category",
      "sources.createCategory": "Create",
      "sources.category": "Category",
      "sources.categoryName": "Category name",
      "sources.categoryNamePlaceholder": "Category name",
      "sources.newCategoryNameLabel": "New category name",
      "sources.uncategorized": "Uncategorized",
      "sources.feedUrl": "Feed URL",
      "sources.feedUrlPlaceholder": "https://example.com/feed.xml",
      "sources.feedTitle": "Title",
      "sources.feedTitlePlaceholder": "Optional title",
      "sources.urlRequired": "Enter a feed URL.",
      "sources.urlInvalid": "Enter a valid http(s) URL.",
      "sources.categoryRequired": "Enter a category name.",
      "sources.categoryExists": "A category with this name already exists.",
      "sources.newCategoryOption": "+ New category…",
      "sources.addSubmit": "Add",
      "sources.save": "Save",
      "sources.cancel": "Cancel",
      "sources.rename": "Rename",
      "sources.renameCategory": "Rename category",
      "sources.deleteCategory": "Delete category",
      "sources.deleteEmpty": "Delete category “{name}”? This cannot be undone.",
      "sources.deleteWithFeeds": "Move sources from “{name}” to:",
      "sources.confirmDelete": "Delete permanently",
      "sources.categoryCountOne": "{count} source",
      "sources.deleteNeedsTarget": "Create another category first, then delete this one.",
      "sources.moveTo": "Move to",
      "sources.categoryEmpty": "No subscriptions in this category yet.",
      "sources.categoryCount": "{count} sources",
      "sources.categoryCreated": "Created category “{name}”.",
      "sources.categoryCreateFailed": "Could not create the category.",
      "sources.categoryRenamed": "Renamed category to “{name}”.",
      "sources.categoryMerged": "Merged category into “{name}”.",
      "sources.categoryRenameFailed": "Could not rename the category.",
      "sources.categoryDeleted": "Deleted category “{name}”.",
      "sources.categoryDeleteFailed": "Could not delete the category.",
      "sources.moved": "Moved “{title}” to “{category}”.",
      "sources.moveFailed": "Could not move this source.",
      "sources.addSaved": "Subscription saved.",
      "sources.addSuccess": "Fetch succeeded: {count} items.",
      "sources.addFetchFailed": "Subscription saved, but the first fetch failed: {error}",
      "sources.addRefreshing": "Subscription saved; fetching in the background…",
      "sources.addAlready": "This feed is already subscribed.",
      "sources.addFailed": "Could not add this subscription.",
      "sources.busy": "Working…",
      "sources.manageEmptyHint": "Add a subscription or import an OPML file to start reading.",
      "import.mode": "Import mode",
      "import.replace": "Replace all subscriptions",
      "import.merge": "Merge into current subscriptions",
      "import.pathLabel": "OPML file path",
      "import.pathPlaceholder": "~/Downloads/feedly.opml",
      "import.pathRequired": "Enter an OPML file path.",
      "import.run": "Import",
      "import.importing": "Importing…",
      "import.result": "Imported: {added} added · {updated} updated · {removed} removed",
      "import.failed": "Could not import this OPML file.",
      "import.started": "Sources are refreshing in the background.",
      "import.pathHint": "Absolute path, or a path starting with ~/.",
      "import.replaceWarning": "Replace removes subscriptions missing from this file and resets categories (up to {count} sources affected).",
      "import.replaceConfirm": "I understand that replace removes subscriptions missing from the file.",
      "import.confirmRequired": "Confirm the replace warning first."
    };

    /** Simplified Chinese copy, key-identical to English. */
    const zh = {
      "meta": {
        "title": "信息源",
        "description": "在 DeepSeek Harness 左侧边栏的「信息源」全局面板中阅读 Feedly/RSS 订阅，支持页内阅读、订阅源管理、搜索和未读标记。"
      },
      "view.title": "信息源",
      "view.loading": "正在加载信息源…",
      "view.refreshing": "正在刷新…",
      "view.refreshingProgress": "正在刷新 {done}/{total} 个源…",
      "view.refreshFailed": "刷新失败，当前显示上次加载的内容。",
      "view.markFailed": "更新已读状态失败。",
      "view.hostUnavailable": "信息源暂时不可用",
      "view.hostUnavailableText": "无法连接到 DSH 宿主或读取订阅源，信息源插件的 Host 部分可能没有加载。",
      "view.retry": "重试",
      "mode.label": "视图模式",
      "mode.feed": "信息流",
      "mode.sources": "订阅源",
      "help.button": "?",
      "help.label": "键盘快捷键",
      "help.title": "键盘快捷键",
      "help.close": "关闭快捷键帮助",
      "help.next": "下一条",
      "help.prev": "上一条",
      "help.open": "打开原文",
      "help.toggleRead": "切换已读/未读",
      "help.search": "聚焦搜索",
      "help.refresh": "刷新信息源",
      "help.escape": "关闭阅读面板或清空搜索",
      "help.keyNext": "J / ↓",
      "help.keyPrev": "K / ↑",
      "help.keyOpen": "Enter",
      "help.keyRead": "M",
      "help.keySearch": "/",
      "help.keyRefresh": "R",
      "help.keyEscape": "Esc",
      "refresh.label": "刷新信息源",
      "refresh.button": "刷新",
      "search.label": "搜索全部缓存文章",
      "search.placeholder": "搜索全部缓存文章的标题、摘要和来源",
      "search.clear": "清空搜索",
      "filter.label": "按分类筛选",
      "filter.all": "全部",
      "filter.unread": "未读",
      "filter.categoryUnread": "{name}，{count} 条未读",
      "filter.source": "源：{name}",
      "filter.clearSource": "清除源筛选",
      "markAll.label": "全部标为已读",
      "notice.markedAll": "已标记 {count} 条为已读",
      "notice.markAllFailed": "批量更新已读状态失败。",
      "notice.undo": "撤销",
      "stats.feeds": "{count} 个源",
      "stats.feedsOne": "{count} 个源",
      "stats.unread": "{count} 条未读",
      "stats.failed": "{count} 个源失败",
      "stats.lastRefresh": "上次刷新 {time}",
      "stats.lastRefreshNever": "尚未刷新过",
      "stats.autoRefresh": "每 {minutes} 分钟自动刷新",
      "group.heading": "{name} · {count} 条",
      "group.today": "今天",
      "group.yesterday": "昨天",
      "group.earlier": "更早",
      "item.untitled": "无标题",
      "item.toggleRead": "切换已读状态",
      "row.sourceFilter": "只看这个源：{name}",
      "health.failed": "{count} 个源抓取失败",
      "health.failedOne": "{count} 个源抓取失败",
      "health.show": "展开抓取失败的源",
      "health.hide": "收起抓取失败的源",
      "health.noDetails": "没有返回失败详情。",
      "empty.noFeedsTitle": "还没有订阅源",
      "empty.noFeedsText": "让 DSH 导入 Feedly 的 OPML 导出文件即可，例如：帮我导入 ~/Downloads/feedly-*.opml",
      "empty.noMatches": "没有符合条件的条目",
      "empty.noMatchesHint": "换个关键词或筛选条件试试。",
      "pane.close": "关闭阅读面板",
      "pane.back": "返回列表",
      "pane.label": "阅读面板",
      "pane.loading": "正在加载文章…",
      "pane.failed": "无法加载这篇文章。",
      "pane.fallback": "未能读取原文内容，以下显示订阅源保存的摘要。",
      "pane.fallbackError": "无法读取原文（{error}），以下显示摘要。",
      "pane.empty": "没有可阅读的内容。",
      "pane.open": "打开原文",
      "pane.summarize": "送入对话",
      "pane.markRead": "标为已读",
      "pane.markUnread": "标为未读",
      "pane.copyLink": "复制链接",
      "pane.focus": "专注阅读",
      "pane.unfocus": "退出专注",
      "pane.imageFailed": "图片加载失败",
      "pane.openImage": "打开图片",
      "pane.imageCount": "图片 {count} 张",
      "pane.by": "作者：{author}",
      "pane.dshPrompt": "请先调用 feeds 工具 action=\"article\", itemId=\"{itemId}\" 获取这篇文章。根据工具返回的全文或摘要总结要点，区分事实与推测；如果只有摘要或读取失败，请明确说明，不要声称已读全文。\n标题：{title}\n链接：{link}",
      "notice.questionCopied": "提问已复制，粘贴到输入框即可",
      "notice.questionInserted": "提问已插入到输入框。",
      "notice.linkCopied": "链接已复制。",
      "notice.copyFailed": "复制失败，请手动选择文本复制。",
      "sources.failedOnly": "只看抓取失败",
      "sources.countsAria": "{unread} 条未读，共 {total} 条",
      "sources.errorBadge": "抓取失败",
      "sources.only": "只看这个源",
      "sources.refresh": "刷新",
      "sources.remove": "删除订阅",
      "sources.removeConfirm": "确定要删除订阅「{title}」吗？此操作不可撤销。",
      "sources.removed": "已删除订阅「{title}」。",
      "sources.removeFailed": "删除订阅失败。",
      "sources.refreshFailed": "刷新「{title}」失败。",
      "sources.noFailed": "没有抓取失败的源。",
      "import.title": "导入订阅",
      "import.path": "当前 OPML：{path}",
      "import.noOpml": "未导入 OPML",
      "import.hint": "让 DSH 导入 Feedly 的 OPML 导出文件即可，例如：帮我导入 ~/Downloads/feedly-*.opml",
      "import.copy": "复制导入指令",
      "import.command": "帮我导入 ~/Downloads/feedly-*.opml",
      "import.copied": "导入指令已复制。",
      "import.selected": "已选中导入指令，按 ⌘C 复制。",
      "import.copyFailed": "复制失败，请手动选择指令并复制。",
      "time.justNow": "刚刚",
      "time.minutes": "{count} 分钟前",
      "time.hours": "{count} 小时前",
      "time.yesterday": "昨天",
      "time.days": "{count} 天前",
      "time.date": "{date}",
      "stats.overview": "{feeds} 个源 · {items} 条缓存文章 · {unread} 条未读",
      "reader.settings": "阅读设置",
      "reader.font": "正文字号",
      "reader.density": "列表密度",
      "reader.summary": "摘要",
      "reader.compact": "紧凑",
      "reader.readMode": "标记已读",
      "reader.read.delay": "阅读停留 2 秒后",
      "reader.read.open": "正文加载后",
      "reader.read.manual": "手动标记",
      "saved.label": "稍后读",
      "saved.remove": "移出稍后读",
      "saved.failed": "保存失败，已恢复原状态。",
      "saved.empty": "稍后读列表为空",
      "list.count": "已加载 {loaded} / {total} 条",
      "list.countLoaded": "{count} 篇",
      "list.more": "加载更多",
      "list.failed": "文章加载失败，请重试。",
      "markAll.loaded": "已加载的 {count} 条标为已读",
      "markAll.failed": "更新已读状态失败。",
      "nav.label": "阅读队列和订阅源",
      "sources.counts": "未读 {unread} · 缓存 {total}",
      "sources.lastSuccess": "最近成功：{time}",
      "sources.healthSummary": "{healthy} 个源正常 · {failed} 个源最近抓取失败",
      "health.manage": "{count} 个订阅源抓取失败 · 管理（不影响缓存阅读）",
      "pane.contentSource.feed": "内容来自 RSS 订阅",
      "pane.contentSource.web": "内容来自原文网页",
      "pane.contentSource.summary": "仅订阅摘要",
      "pane.truncated": "内容较长，当前显示节选；可打开原文继续阅读。",
      "pane.retryFull": "重新读取全文",
      "pane.previous": "上一篇",
      "pane.next": "下一篇",
      "reader.grouping": "更新排列",
      "reader.group.source": "同源聚合",
      "reader.group.time": "时间顺序",
      "group.updates": "{count} 条更新",
      "group.expand": "展开另外 {count} 条",
      "group.collapse": "收起更新",
      "reader.fontDecrease": "减小正文字号",
      "reader.fontIncrease": "增大正文字号",
      "filter.reset": "清除全部筛选",
      "filter.searchTerm": "搜索：{query}",
      "empty.sourceRead": "该来源当前没有未读文章",
      "empty.sourceSaved": "该来源没有符合条件的稍后读文章",
      "empty.sourceCached": "该来源共有 {count} 篇缓存文章。",
      "empty.showSourceAll": "查看该来源全部文章",
      "empty.sourceFailed": "该来源抓取失败，尚无缓存文章",
      "empty.sourceNoCache": "该来源尚无缓存文章",
      "health.currentSource": "当前来源抓取失败：{error} · 查看和处理",
      "sources.management": "订阅源管理",
      "sources.addFeed": "＋ 新增订阅",
      "sources.addFeedTitle": "新增订阅",
      "sources.importOpml": "导入 OPML",
      "sources.newCategory": "＋ 新建分类",
      "sources.createCategory": "创建",
      "sources.category": "分类",
      "sources.categoryName": "分类名称",
      "sources.categoryNamePlaceholder": "分类名称",
      "sources.newCategoryNameLabel": "新分类名称",
      "sources.uncategorized": "未分类",
      "sources.feedUrl": "订阅源地址",
      "sources.feedUrlPlaceholder": "https://example.com/feed.xml",
      "sources.feedTitle": "标题",
      "sources.feedTitlePlaceholder": "标题（可选）",
      "sources.urlRequired": "请输入订阅源地址。",
      "sources.urlInvalid": "请输入有效的 http(s) 地址。",
      "sources.categoryRequired": "请输入分类名称。",
      "sources.categoryExists": "该分类已存在。",
      "sources.newCategoryOption": "＋ 新建分类…",
      "sources.addSubmit": "添加",
      "sources.save": "保存",
      "sources.cancel": "取消",
      "sources.rename": "重命名",
      "sources.renameCategory": "重命名分类",
      "sources.deleteCategory": "删除分类",
      "sources.deleteEmpty": "确定删除分类「{name}」吗？此操作不可撤销。",
      "sources.deleteWithFeeds": "把「{name}」中的源移动到：",
      "sources.confirmDelete": "确认删除",
      "sources.categoryCountOne": "{count} 个源",
      "sources.deleteNeedsTarget": "请先新建另一个分类作为移动目标，再删除该分类。",
      "sources.moveTo": "把源移动到",
      "sources.categoryEmpty": "该分类暂无订阅源。",
      "sources.categoryCount": "{count} 个源",
      "sources.categoryCreated": "已创建分类「{name}」。",
      "sources.categoryCreateFailed": "创建分类失败。",
      "sources.categoryRenamed": "分类已重命名为「{name}」。",
      "sources.categoryMerged": "分类已合并到「{name}」。",
      "sources.categoryRenameFailed": "重命名分类失败。",
      "sources.categoryDeleted": "已删除分类「{name}」。",
      "sources.categoryDeleteFailed": "删除分类失败。",
      "sources.moved": "已把「{title}」移动到「{category}」。",
      "sources.moveFailed": "移动订阅源失败。",
      "sources.addSaved": "订阅已保存。",
      "sources.addSuccess": "抓取成功：{count} 条。",
      "sources.addFetchFailed": "订阅已保存，但首次抓取失败：{error}",
      "sources.addRefreshing": "订阅已保存，正在后台抓取…",
      "sources.addAlready": "这个订阅源已经订阅过了。",
      "sources.addFailed": "添加订阅失败。",
      "sources.busy": "处理中…",
      "sources.manageEmptyHint": "新增订阅或导入 OPML 文件后即可开始阅读。",
      "import.mode": "导入方式",
      "import.replace": "替换全部订阅",
      "import.merge": "合并到现有订阅",
      "import.pathLabel": "OPML 文件路径",
      "import.pathPlaceholder": "~/Downloads/feedly.opml",
      "import.pathRequired": "请输入 OPML 文件路径。",
      "import.run": "开始导入",
      "import.importing": "正在导入…",
      "import.result": "导入完成：新增 {added} 个 · 更新 {updated} 个 · 移除 {removed} 个",
      "import.failed": "导入 OPML 失败。",
      "import.started": "订阅源正在后台刷新。",
      "import.pathHint": "支持 ~/ 开头或绝对路径。",
      "import.replaceWarning": "替换会删除文件中不存在的订阅并重置分类（最多影响 {count} 个订阅源）。",
      "import.replaceConfirm": "我了解替换会删除文件中不存在的订阅。",
      "import.confirmRequired": "请先勾选替换确认。"
    };
    //#endregion

    //#region styles
    const CSS = `
.dsh-feeds-root {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-base);
}
.dsh-feeds-header {
  flex: none;
  padding: 18px 20px 8px;
}
.dsh-feeds-headerInner,
.dsh-feeds-bodyInner {
  width: 100%;
  max-width: 1160px;
  margin: 0 auto;
}
.dsh-feeds-titleRow {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.dsh-feeds-titleBlock {
  min-width: 0;
  flex: 1;
}
.dsh-feeds-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  line-height: 22px;
  color: var(--dsw-alias-label-primary);
}
.dsh-feeds-subtitle {
  margin: 2px 0 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-feeds-refreshInfo {
  margin: 1px 0 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-feeds-actions {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.dsh-feeds-segment {
  display: inline-flex;
  padding: 2px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
}
.dsh-feeds-segmentButton {
  height: 24px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  line-height: 16px;
  cursor: pointer;
  white-space: nowrap;
}
.dsh-feeds-segmentButton:hover {
  color: var(--dsw-alias-label-primary);
}
.dsh-feeds-segmentButton.isSelected {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
}
.dsh-feeds-helpWrap {
  position: relative;
  display: inline-flex;
}
.dsh-feeds-helpButton {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  line-height: 16px;
  cursor: pointer;
}
.dsh-feeds-helpButton:hover,
.dsh-feeds-helpButton[aria-expanded='true'] {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}
.dsh-feeds-helpPopover {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 40;
  width: 288px;
  padding: 10px 12px 12px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: var(--dsw-alias-bg-overlay);
}
.dsh-feeds-helpHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}
.dsh-feeds-helpTitle {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  line-height: 18px;
  color: var(--dsw-alias-label-primary);
}
.dsh-feeds-helpClose {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.dsh-feeds-helpClose:hover {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}
.dsh-feeds-helpList {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.dsh-feeds-helpRow {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-feeds-helpKey {
  flex: none;
  min-width: 30px;
  box-sizing: border-box;
  padding: 0 5px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 4px;
  text-align: center;
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-primary);
}
.dsh-feeds-helpText {
  min-width: 0;
}
.dsh-feeds-refresh {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  line-height: 16px;
  cursor: pointer;
}
.dsh-feeds-refresh:hover:not(:disabled) {
  background: var(--dsw-alias-bg-layer-2);
}
.dsh-feeds-refresh:disabled {
  color: var(--dsw-alias-label-secondary);
  cursor: default;
}
.dsh-feeds-refreshIcon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.dsh-feeds-spinner {
  display: inline-block;
  flex: none;
  width: 12px;
  height: 12px;
  border: 2px solid var(--dsw-alias-border-l2);
  border-top-color: var(--dsw-alias-brand-primary);
  border-radius: 50%;
  animation: dsh-feeds-spin 700ms linear infinite;
}
@keyframes dsh-feeds-spin {
  to { transform: rotate(360deg); }
}
.dsh-feeds-statusLine {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  font-size: 12px;
  line-height: 16px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-feeds-statusLineError {
  color: var(--dsw-alias-state-error-primary);
}
.dsh-feeds-search {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  padding: 0 10px;
  height: 38px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-2);
  transition: border-color 120ms ease;
}
.dsh-feeds-search:focus-within {
  border-color: var(--dsw-alias-brand-primary);
}
.dsh-feeds-searchIcon {
  flex: none;
  display: inline-flex;
  color: var(--dsw-alias-label-secondary);
}
.dsh-feeds-input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 14px;
  line-height: 20px;
}
.dsh-feeds-input::placeholder {
  color: var(--dsw-alias-label-secondary);
}
.dsh-feeds-input:disabled {
  cursor: default;
}
.dsh-feeds-input::-webkit-search-cancel-button {
  display: none;
}
.dsh-feeds-clear {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.dsh-feeds-clear:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-1);
}
.dsh-feeds-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
}
.dsh-feeds-chip {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  line-height: 16px;
  white-space: nowrap;
  cursor: pointer;
}
.dsh-feeds-chip:hover {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}
.dsh-feeds-chip.isSelected {
  border-color: var(--dsw-alias-brand-primary);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);
  color: var(--dsw-alias-brand-primary);
}
.dsh-feeds-chipCount {
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-feeds-chip.isSelected .dsh-feeds-chipCount {
  color: var(--dsw-alias-brand-primary);
}
.dsh-feeds-markAllButton {
  box-sizing: border-box;
  height: 26px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  line-height: 16px;
  white-space: nowrap;
  cursor: pointer;
}
.dsh-feeds-markAllButton:hover:not(:disabled) {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}
.dsh-feeds-markAllButton:disabled {
  cursor: default;
  opacity: 0.7;
}
.dsh-feeds-body {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
}
.dsh-feeds-bodyInner {
  position: relative;
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
}
.dsh-feeds-bodyInner.isFocused .dsh-feeds-listPane {
  display: none;
}
.dsh-feeds-bodyInner.isFocused .dsh-feeds-pane {
  flex: 1 1 auto;
  width: auto;
  max-width: none;
}
.dsh-feeds-listPane {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}
.dsh-feeds-listContent {
  width: 100%;
  padding: 4px 20px calc(var(--dsh-composer-height, 152px) + 24px);
}
.dsh-feeds-pageScroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}
.dsh-feeds-pageContent {
  width: 100%;
  max-width: 880px;
  margin: 0 auto;
  padding: 8px 20px calc(var(--dsh-composer-height, 152px) + 24px);
}
.dsh-feeds-noticeBar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 4px 0 8px;
  padding: 8px 12px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-feeds-noticeBarText {
  flex: 1;
  min-width: 0;
}
.dsh-feeds-noticeAction {
  flex: none;
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-brand-primary);
  font: inherit;
  font-size: 12px;
  line-height: 16px;
  cursor: pointer;
}
.dsh-feeds-noticeAction:hover {
  background: var(--dsw-alias-bg-layer-2);
}
.dsh-feeds-notice {
  margin: 4px 0 8px;
  font-size: 12px;
  line-height: 16px;
  color: var(--dsw-alias-state-error-primary);
}
.dsh-feeds-group + .dsh-feeds-group {
  margin-top: 8px;
}
.dsh-feeds-groupHead {
  position: sticky;
  top: 0;
  z-index: 2;
  margin: 0 0 2px;
  padding: 8px 12px 6px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-base);
  font-size: 12px;
  font-weight: 600;
  line-height: 16px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-feeds-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.dsh-feeds-row {
  position: relative;
  box-sizing: border-box;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 6px;
  cursor: pointer;
}
.dsh-feeds-row + .dsh-feeds-row {
  border-top: 1px solid var(--dsw-alias-border-l1);
}
.dsh-feeds-row:hover {
  background: var(--dsw-alias-bg-layer-2);
}
.dsh-feeds-row.isSelected,
.dsh-feeds-row.isSelected:hover {
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: inset 2px 0 0 var(--dsw-alias-brand-primary);
}
.dsh-feeds-dotSlot {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 10px;
  height: 18px;
  margin-top: 2px;
}
.dsh-feeds-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dsw-alias-brand-primary);
}
.dsh-feeds-rowBody {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.dsh-feeds-rowTitle {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  line-height: 18px;
  text-align: left;
  cursor: pointer;
}
.dsh-feeds-rowTitle:hover {
  text-decoration: underline;
}
.dsh-feeds-row[data-unread='false'] .dsh-feeds-rowTitle {
  color: var(--dsw-alias-label-secondary);
  font-weight: 400;
}
.dsh-feeds-rowSummary {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-feeds-rowMeta {
  display: flex;
  align-items: baseline;
  gap: 0;
  margin: 0;
  overflow: hidden;
  white-space: nowrap;
  font-size: 12px;
  line-height: 16px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-feeds-metaSeparator {
  white-space: pre;
}
.dsh-feeds-sourceLink {
  display: inline;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  line-height: 16px;
  text-align: left;
  vertical-align: baseline;
  cursor: pointer;
}
.dsh-feeds-sourceLink:hover {
  color: var(--dsw-alias-brand-primary);
  text-decoration: underline;
}
.dsh-feeds-toggle {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  margin-top: 0;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.dsh-feeds-toggle:hover {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}
.dsh-feeds-toggle[aria-pressed='true'] {
  color: var(--dsw-alias-brand-primary);
}
.dsh-feeds-health {
  margin: 6px 0 10px;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
}
.dsh-feeds-healthHead {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  line-height: 16px;
  text-align: left;
  cursor: pointer;
}
.dsh-feeds-healthHead:hover {
  background: var(--dsw-alias-bg-layer-2);
}
.dsh-feeds-healthIcon {
  flex: none;
  display: inline-flex;
  color: var(--dsw-alias-state-warn-primary);
}
.dsh-feeds-healthText {
  flex: 1;
  min-width: 0;
}
.dsh-feeds-healthChevron {
  flex: none;
  display: inline-flex;
  color: var(--dsw-alias-label-secondary);
  transition: transform 120ms ease;
}
.dsh-feeds-healthChevron.isOpen {
  transform: rotate(90deg);
}
.dsh-feeds-healthList {
  list-style: none;
  margin: 0;
  padding: 0 12px 8px;
}
.dsh-feeds-healthItem {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 4px 0;
}
.dsh-feeds-healthItem + .dsh-feeds-healthItem {
  border-top: 1px solid var(--dsw-alias-border-l1);
}
.dsh-feeds-healthFeed {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  line-height: 16px;
  color: var(--dsw-alias-label-primary);
}
.dsh-feeds-healthError {
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-secondary);
  word-break: break-word;
}
.dsh-feeds-pane {
  flex: none;
  display: flex;
  flex-direction: column;
  width: clamp(360px, 46%, 680px);
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border-left: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-base);
}
.dsh-feeds-paneHead {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.dsh-feeds-paneBack {
  display: none;
  flex: none;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  line-height: 16px;
  cursor: pointer;
}
.dsh-feeds-paneBack:hover {
  background: var(--dsw-alias-bg-layer-2);
}
.dsh-feeds-paneMeta {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  line-height: 16px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-feeds-paneClose {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.dsh-feeds-paneClose:hover {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}
.dsh-feeds-paneFocus {
  flex: none;
  display: inline-flex;
  align-items: center;
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  line-height: 16px;
  white-space: nowrap;
  cursor: pointer;
}
.dsh-feeds-paneFocus:hover {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}
.dsh-feeds-paneFocus[aria-pressed='true'] {
  border-color: var(--dsw-alias-brand-primary);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);
  color: var(--dsw-alias-brand-primary);
}
.dsh-feeds-paneScroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}
.dsh-feeds-paneInner {
  width: 100%;
  padding: 14px 16px calc(var(--dsh-composer-height, 152px) + 24px);
}
.dsh-feeds-paneTitle {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
  color: var(--dsw-alias-label-primary);
}
.dsh-feeds-paneByline {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-feeds-paneActions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}
.dsh-feeds-paneAction {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 9px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  line-height: 16px;
  white-space: nowrap;
  cursor: pointer;
}
.dsh-feeds-paneAction:hover:not(:disabled) {
  background: var(--dsw-alias-bg-layer-2);
}
.dsh-feeds-paneAction:disabled {
  color: var(--dsw-alias-label-secondary);
  cursor: default;
}
.dsh-feeds-paneNotice {
  margin: 10px 0 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-feeds-paneWarning {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 12px 0 0;
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-feeds-paneWarningIcon {
  flex: none;
  display: inline-flex;
  margin-top: 1px;
  color: var(--dsw-alias-state-warn-primary);
}
.dsh-feeds-paneBody {
  max-width: 72ch;
  margin: 14px auto 0;
  font-size: 14px;
  line-height: 1.75;
  color: var(--dsw-alias-label-primary);
  overflow-wrap: anywhere;
}
.dsh-feeds-paneParagraph {
  margin: 0 0 12px;
}
.dsh-feeds-paneParagraph:last-child {
  margin-bottom: 0;
}
.dsh-feeds-articleP {
  margin: 0 0 12px;
}
.dsh-feeds-articleH {
  margin: 20px 0 8px;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.45;
  color: var(--dsw-alias-label-primary);
}
.dsh-feeds-articleHSub {
  margin: 16px 0 6px;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.45;
  color: var(--dsw-alias-label-primary);
}
.dsh-feeds-articleQuote {
  margin: 0 0 12px;
  padding: 2px 0 2px 12px;
  border-left: 2px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 1.75;
}
.dsh-feeds-articleList {
  margin: 0 0 12px;
  padding-left: 22px;
}
.dsh-feeds-articleList li {
  margin: 0 0 4px;
}
.dsh-feeds-articleFigure {
  max-width: 100%;
  margin: 16px auto;
}
.dsh-feeds-articleImageButton {
  display: block;
  max-width: 100%;
  margin: 0 auto;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: zoom-in;
}
.dsh-feeds-articleImage {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 8px auto;
  border-radius: 8px;
}
.dsh-feeds-articleFigcaption {
  max-width: 100%;
  margin: 6px auto 0;
  text-align: center;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary);
}
.dsh-feeds-articleImageFailed {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin: 12px 0;
  padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-feeds-paneError {
  margin: 16px 0 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-state-error-primary);
}
.dsh-feeds-paneErrorActions {
  margin-top: 8px;
}
.dsh-feeds-skeletonList {
  display: flex;
  flex-direction: column;
}
.dsh-feeds-skeletonRow {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
}
.dsh-feeds-skeletonRow + .dsh-feeds-skeletonRow {
  border-top: 1px solid var(--dsw-alias-border-l1);
}
.dsh-feeds-skeletonDot {
  flex: none;
  width: 6px;
  height: 6px;
  margin-top: 7px;
  border-radius: 50%;
  background: var(--dsw-alias-bg-layer-2);
}
.dsh-feeds-skeletonBody {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dsh-feeds-skeletonLine {
  height: 12px;
  border-radius: 4px;
  background: var(--dsw-alias-bg-layer-2);
  animation: dsh-feeds-pulse 1.2s ease-in-out infinite;
}
.dsh-feeds-skeletonLineShort {
  width: 38%;
}
.dsh-feeds-skeletonLineMid {
  width: 72%;
}
.dsh-feeds-skeletonLineLong {
  width: 92%;
}
@keyframes dsh-feeds-pulse {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 0.9; }
}
.dsh-feeds-sourcesToolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 10px 0;
}
.dsh-feeds-importCard {
  margin: 4px 0 10px;
  padding: 12px 14px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
}
.dsh-feeds-importTitle {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  line-height: 18px;
  color: var(--dsw-alias-label-primary);
}
.dsh-feeds-importPath {
  margin: 2px 0 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
  overflow-wrap: anywhere;
}
.dsh-feeds-importHint {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-feeds-importCommand {
  display: block;
  margin-top: 6px;
  padding: 6px 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  background: var(--dsw-alias-bg-base);
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-primary);
  overflow-wrap: anywhere;
  user-select: text;
}
.dsh-feeds-importFooter {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 8px;
}
.dsh-feeds-importNotice {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-feeds-formCard {
  margin: 10px 0;
  padding: 12px 14px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
}
.dsh-feeds-formTitle {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
  line-height: 18px;
  color: var(--dsw-alias-label-primary);
}
.dsh-feeds-formGrid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.dsh-feeds-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1 1 220px;
  min-width: 180px;
  font-size: 12px;
  line-height: 16px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-feeds-textInput,
.dsh-feeds-select {
  box-sizing: border-box;
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 6px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 18px;
}
.dsh-feeds-textInput::placeholder {
  color: var(--dsw-alias-label-secondary);
}
.dsh-feeds-textInput:disabled,
.dsh-feeds-select:disabled {
  opacity: 0.7;
  cursor: default;
}
.dsh-feeds-formActions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}
.dsh-feeds-formNotice {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-feeds-formNotice.isError {
  color: var(--dsw-alias-state-error-primary);
}
.dsh-feeds-formNotice.isSuccess {
  color: var(--dsw-alias-label-primary);
}
.dsh-feeds-radioRow {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-feeds-radioLabel {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}
.dsh-feeds-inlineForm {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 8px 0 0;
}
.dsh-feeds-categoryHeadActions {
  display: inline-flex;
  gap: 6px;
  margin-left: auto;
}
.dsh-feeds-sourceGroupRename {
  max-width: 260px;
}
.dsh-feeds-sourceGroupName {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-feeds-sourceGroupCount {
  flex: none;
  font-weight: 400;
  color: var(--dsw-alias-label-secondary);
}
.dsh-feeds-sourceGroupHead {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dsh-feeds-categoryFormRow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 0 0 6px;
  padding: 8px 12px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-feeds-sourceEmpty {
  padding: 10px 12px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
}
.dsh-feeds-sourceCategory {
  height: 26px;
  max-width: 150px;
  padding: 0 6px;
  font-size: 12px;
}
.dsh-feeds-smallButton.isPrimary {
  border-color: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-brand-primary);
}
.dsh-feeds-smallButton.isPrimary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);
}
.dsh-feeds-smallButton:disabled {
  opacity: 0.7;
  cursor: default;
}
.dsh-feeds-sourceGroup + .dsh-feeds-sourceGroup {
  margin-top: 14px;
}
.dsh-feeds-sourceGroupHead {
  margin: 0 0 4px;
  padding: 0 2px;
  font-size: 12px;
  font-weight: 600;
  line-height: 16px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-feeds-sourceList {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  overflow: hidden;
  background: var(--dsw-alias-bg-layer-1);
}
.dsh-feeds-sourceRow {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
}
.dsh-feeds-sourceRow + .dsh-feeds-sourceRow {
  border-top: 1px solid var(--dsw-alias-border-l1);
}
.dsh-feeds-sourceMain {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.dsh-feeds-sourceTitleRow {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.dsh-feeds-sourceTitle {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
  line-height: 18px;
  color: var(--dsw-alias-label-primary);
}
.dsh-feeds-sourceBadge {
  flex: none;
  padding: 0 5px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 4px;
  font-size: 10px;
  line-height: 14px;
  color: var(--dsw-alias-state-error-primary);
  white-space: nowrap;
}
.dsh-feeds-sourceUrl {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-feeds-sourceMeta {
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-feeds-sourceActions {
  flex: none;
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.dsh-feeds-sourceAction {
  height: 24px;
  padding: 0 7px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 11px;
  line-height: 14px;
  white-space: nowrap;
  cursor: pointer;
}
.dsh-feeds-sourceAction:hover:not(:disabled) {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}
.dsh-feeds-sourceAction:disabled {
  cursor: default;
  opacity: 0.7;
}
.dsh-feeds-sourceActionDanger:hover:not(:disabled) {
  color: var(--dsw-alias-state-error-primary);
}
.dsh-feeds-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 56px 16px 32px;
  text-align: center;
  color: var(--dsw-alias-label-secondary);
}
.dsh-feeds-emptyIcon {
  display: inline-flex;
  margin-bottom: 4px;
  color: var(--dsw-alias-label-secondary);
  opacity: 0.8;
}
.dsh-feeds-emptyTitle {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
  color: var(--dsw-alias-label-primary);
}
.dsh-feeds-emptyText {
  margin: 0;
  max-width: 420px;
  font-size: 12px;
  line-height: 18px;
}
.dsh-feeds-primaryButton {
  margin-top: 6px;
  height: 30px;
  padding: 0 14px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  line-height: 16px;
  cursor: pointer;
}
.dsh-feeds-primaryButton:hover {
  border-color: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-brand-primary);
}
.dsh-feeds-smallButton {
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  line-height: 16px;
  cursor: pointer;
}
.dsh-feeds-smallButton:hover {
  background: var(--dsw-alias-bg-layer-2);
}
.dsh-feeds-srOnly {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
.dsh-feeds-root button:focus-visible,
.dsh-feeds-root input:focus-visible,
.dsh-feeds-root select:focus-visible,
.dsh-feeds-root [tabindex]:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}
@media (max-width: 899px) {
  .dsh-feeds-pane {
    position: absolute;
    inset: 0;
    width: auto;
    z-index: 20;
    border-left: 0;
  }
  .dsh-feeds-paneBack {
    display: inline-flex;
  }
  .dsh-feeds-sourceRow {
    flex-direction: column;
  }
  .dsh-feeds-sourceActions {
    justify-content: flex-start;
  }
}
@media (prefers-reduced-motion: reduce) {
  .dsh-feeds-spinner {
    animation-duration: 1600ms;
  }
  .dsh-feeds-skeletonLine {
    animation: none;
    opacity: 0.6;
  }
  .dsh-feeds-healthChevron,
  .dsh-feeds-search {
    transition: none;
  }
}
@media (max-width: 640px) {
  .dsh-feeds-header {
    padding: 14px 12px 8px;
  }
  .dsh-feeds-listContent,
  .dsh-feeds-pageContent {
    padding-left: 12px;
    padding-right: 12px;
  }
}

/* Reader layout follows the available plugin width, including host sidebars. */
.dsh-feeds-root { container-type:inline-size; font-size:14px; }
.dsh-feeds-header { padding:14px 20px 10px; border-bottom:1px solid var(--dsw-alias-border-l1); }
.dsh-feeds-headerInner,.dsh-feeds-bodyInner { max-width:none; }
.dsh-feeds-title { font-size:18px; line-height:26px; }
.dsh-feeds-readerLayout { display:flex; width:100%; min-width:0; min-height:0; }
.dsh-feeds-nav { flex:0 0 208px; overflow:auto; padding:12px 10px 32px; border-right:1px solid var(--dsw-alias-border-l1); }
.dsh-feeds-navQueues { display:flex; flex-direction:column; align-items:stretch; gap:6px; margin-bottom:14px; }
.dsh-feeds-nav details { margin:10px 0; }
.dsh-feeds-nav summary { font-size:12px; color:var(--dsw-alias-label-secondary); cursor:pointer; padding:6px 3px; }
.dsh-feeds-navSource { display:flex; align-items:center; justify-content:space-between; gap:8px; width:100%; padding:7px 8px; border:0; border-radius:6px; color:var(--dsw-alias-label-secondary); background:transparent; text-align:left; cursor:pointer; }
.dsh-feeds-navSource span:first-child { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.dsh-feeds-navSource:hover,.dsh-feeds-navSource.isSelected { background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); }
.dsh-feeds-listPane { min-width:0; }
.dsh-feeds-listContent { box-sizing:border-box; max-width:920px; margin:auto; padding-bottom:calc(var(--dsh-composer-height,152px) + 30px); }
.dsh-feeds-bodyInner.hasPane .dsh-feeds-listPane { flex:0 0 34%; max-width:400px; min-width:280px; }
.dsh-feeds-pane { width:auto; flex:1; min-width:0; }
.dsh-feeds-paneInner { max-width:800px; margin:0 auto; padding:24px 30px calc(var(--dsh-composer-height,152px) + 36px); }
.dsh-feeds-paneTitle { font-size:24px; line-height:1.4; letter-spacing:-.02em; }
.dsh-feeds-paneBody { max-width:70ch; font-size:var(--feeds-font-size,17px); line-height:1.8; }
.dsh-feeds-articleP { margin-bottom:1em; }
.dsh-feeds-articleH { font-size:1.25em; }
.dsh-feeds-articleHSub { font-size:1.1em; }
.dsh-feeds-articleQuote { font-size:inherit; }
.dsh-feeds-row { padding:13px 12px; content-visibility:auto; contain-intrinsic-size:auto 110px; }
.dsh-feeds-rowTitle { font-size:15px; line-height:21px; }
.dsh-feeds-rowSummary { font-size:13px; line-height:20px; margin:3px 0; }
.density-compact .dsh-feeds-rowSummary { display:none; }
.density-compact .dsh-feeds-row { padding-top:10px; padding-bottom:10px; contain-intrinsic-size:auto 76px; }
.dsh-feeds-listToolbar { display:flex; justify-content:space-between; align-items:center; gap:8px; padding:10px 0; color:var(--dsw-alias-label-secondary); font-size:12px; flex-wrap:wrap; }
.dsh-feeds-healthShortcut { border:0; background:transparent; color:var(--dsw-alias-label-secondary); padding:8px 0; font:inherit; font-size:12px; cursor:pointer; }
.dsh-feeds-loadMore { display:block; margin:16px auto; padding:10px 24px; border:1px solid var(--dsw-alias-border-l1); border-radius:8px; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-1); font:inherit; cursor:pointer; }
.dsh-feeds-settings { position:relative; font-size:12px; }
.dsh-feeds-settings summary { cursor:pointer; padding:6px 10px; border:1px solid var(--dsw-alias-border-l1); border-radius:6px; }
.dsh-feeds-settingsOptions { position:absolute; right:0; z-index:50; width:260px; padding:14px; border:1px solid var(--dsw-alias-border-l1); border-radius:8px; background:var(--dsw-alias-bg-overlay); }
.dsh-feeds-settingsOptions label { display:flex; flex-direction:column; gap:6px; margin-bottom:12px; color:var(--dsw-alias-label-secondary); }
.dsh-feeds-settingsOptions select { padding:6px; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-1); border:1px solid var(--dsw-alias-border-l1); border-radius:4px; }
.dsh-feeds-paneNavigation { display:flex; justify-content:space-between; padding:8px 12px; border-bottom:1px solid var(--dsw-alias-border-l1); }
.dsh-feeds-paneBody a { color:var(--dsw-alias-brand-primary); text-underline-offset:3px; }
.dsh-feeds-articleCode { overflow:auto; padding:16px; border-radius:8px; font:13px/1.65 ui-monospace,monospace; background:var(--dsw-alias-bg-layer-1); white-space:pre; tab-size:4; }
.dsh-feeds-tableScroll { max-width:100%; overflow:auto; margin:16px 0; }
.dsh-feeds-articleTable { border-collapse:collapse; font-size:.85em; min-width:100%; }
.dsh-feeds-articleTable th,.dsh-feeds-articleTable td { border:1px solid var(--dsw-alias-border-l1); padding:8px 12px; text-align:left; white-space:normal; min-width:80px; }
.dsh-feeds-articleTable th { background:var(--dsw-alias-bg-layer-1); }
.dsh-feeds-managementSummary { margin:10px 0; color:var(--dsw-alias-label-secondary); }
@container (max-width:1200px) { .dsh-feeds-nav { display:none; } }
@container (min-width:900px) { .dsh-feeds-pane { position:static; inset:auto; z-index:auto; border-left:1px solid var(--dsw-alias-border-l1); } .dsh-feeds-paneBack { display:none; } }
@container (max-width:899px) { .dsh-feeds-pane { position:absolute; inset:0; width:auto; z-index:20; border-left:0; } .dsh-feeds-paneBack { display:inline-flex; } .dsh-feeds-paneInner { padding:18px 20px calc(var(--dsh-composer-height,152px) + 24px); } }

/* Three independent scrolling surfaces, with restrained, stable scrollbars. */
.dsh-feeds-nav,.dsh-feeds-listPane,.dsh-feeds-paneScroll { overscroll-behavior:contain; scrollbar-gutter:stable; scrollbar-width:thin; scrollbar-color:var(--dsw-alias-border-l2) transparent; }
.dsh-feeds-root ::-webkit-scrollbar { width:9px; height:9px; }
.dsh-feeds-root ::-webkit-scrollbar-track { background:transparent; }
.dsh-feeds-root ::-webkit-scrollbar-thumb { border:3px solid transparent; border-radius:8px; background-color:var(--dsw-alias-border-l2); background-clip:padding-box; }
.dsh-feeds-root ::-webkit-scrollbar-thumb:hover { border-width:2px; }
.dsh-feeds-listPane { background:var(--dsw-alias-bg-layer-1); }
.dsh-feeds-pane { background:var(--dsw-alias-bg-base); }
.dsh-feeds-listToolbar { position:relative; background:var(--dsw-alias-bg-layer-1); }
.dsh-feeds-groupHead { background:var(--dsw-alias-bg-layer-1); top:0; }
.dsh-feeds-rowTitle { font-weight:600; color:var(--dsw-alias-label-primary); }
.dsh-feeds-row[data-unread='false'] .dsh-feeds-rowTitle { font-weight:500; color:var(--dsw-alias-label-secondary); }
.dsh-feeds-rowSummary { font-weight:400; color:var(--dsw-alias-label-secondary); }
.dsh-feeds-rowMeta { font-size:11px; opacity:.8; }
.dsh-feeds-row.isSelected,.dsh-feeds-row.isSelected:hover { background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,var(--dsw-alias-bg-layer-1)); }
.dsh-feeds-sourceIcon { display:inline-flex; position:relative; width:18px; height:18px; flex:0 0 18px; border-radius:4px; overflow:hidden; vertical-align:middle; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-secondary); }
.dsh-feeds-sourceIconFallback { display:flex; justify-content:center; align-items:center; position:absolute; inset:0; font-size:11px; font-weight:600; }
.dsh-feeds-sourceIconImage { display:block; position:relative; width:18px; height:18px; object-fit:contain; background:var(--dsw-alias-bg-layer-1); }
.dsh-feeds-sourceIconImage[hidden] { display:none; }
.dsh-feeds-sourceLink,.dsh-feeds-sourceTitle,.dsh-feeds-navSourceName { display:inline-flex; align-items:center; gap:7px; min-width:0; }
.dsh-feeds-navSourceName>span:last-child { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.dsh-feeds-feedCluster { margin:8px 0 16px; border:1px solid var(--dsw-alias-border-l1); border-radius:9px; overflow:clip; }
.dsh-feeds-clusterHead { display:flex; align-items:center; gap:8px; padding:9px 12px; background:var(--dsw-alias-bg-base); }
.dsh-feeds-clusterTitle { display:flex; align-items:center; gap:7px; min-width:0; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; border:0; padding:0; font:inherit; font-size:12px; font-weight:600; color:var(--dsw-alias-label-primary); background:transparent; cursor:pointer; }
.dsh-feeds-clusterCount { font-size:11px; color:var(--dsw-alias-label-secondary); white-space:nowrap; }
.dsh-feeds-clusterFold { flex:none; margin-left:auto; padding:3px 5px; border:0; font:inherit; font-size:11px; color:var(--dsw-alias-brand-primary); background:transparent; cursor:pointer; }

/* The host viewArea has auto height and lives beside the sticky composer.
   Its measured viewport/composer variables provide a definite inner height. */
.dsh-feeds-root { height:calc(var(--dsh-conversation-viewport-height,100dvh) - var(--dsh-composer-height,152px)); flex:none; }
.dsh-feeds-root.isStandalone { height:100%; min-height:0; flex:1 1 auto; }
.dsh-feeds-root.isStandalone .dsh-feeds-listContent,
.dsh-feeds-root.isStandalone .dsh-feeds-content,
.dsh-feeds-root.isStandalone .dsh-feeds-pageContent { padding-bottom:24px; }
.dsh-feeds-root.isStandalone .dsh-feeds-paneInner { padding-bottom:30px; }
.dsh-feeds-listContent,.dsh-feeds-pageContent { padding-bottom:28px; }
.dsh-feeds-paneInner { padding-bottom:32px; }
@container (max-width:899px) { .dsh-feeds-paneInner { padding-bottom:28px; } }

/* Keep width + padding inside the reading column; the host does not reset all descendants. */
.dsh-feeds-root,.dsh-feeds-root *,.dsh-feeds-root *::before,.dsh-feeds-root *::after { box-sizing:border-box; }
.dsh-feeds-pane,.dsh-feeds-paneScroll,.dsh-feeds-paneInner,.dsh-feeds-paneBody { min-width:0; }
.dsh-feeds-paneInner { width:100%; max-width:800px; padding-left:clamp(16px,3cqw,30px); padding-right:clamp(16px,3cqw,30px); }
.dsh-feeds-paneTitle { max-width:100%; overflow-wrap:anywhere; font-size:clamp(20px,calc(var(--feeds-font-size,17px) * 1.4),36px); }
.dsh-feeds-paneBody { max-width:100%; overflow-wrap:anywhere; }
.dsh-feeds-paneBody p,.dsh-feeds-paneBody li,.dsh-feeds-paneWarning { overflow-wrap:anywhere; }
.dsh-feeds-paneActions { min-width:0; max-width:100%; }
.dsh-feeds-paneAction { max-width:100%; height:auto; min-height:28px; white-space:normal; text-align:left; }
.dsh-feeds-paneNavigation { align-items:center; flex-wrap:wrap; gap:8px; }
.dsh-feeds-paneFontControls { display:flex; flex:none; align-items:center; gap:7px; }
.dsh-feeds-fontValue { min-width:42px; font-size:12px; font-variant-numeric:tabular-nums; text-align:center; color:var(--dsw-alias-label-secondary); }
.dsh-feeds-articleCode { max-width:100%; font-size:.82em; }
.dsh-feeds-tableScroll { width:100%; }
.dsh-feeds-filterSummary { display:flex; align-items:center; flex-wrap:wrap; gap:8px; padding:6px 0 0; font-size:12px; color:var(--dsw-alias-label-secondary); }
.dsh-feeds-filterSummary>span { min-width:0; overflow-wrap:anywhere; }
.dsh-feeds-settingsOptions { max-width:min(280px,calc(100vw - 32px)); max-height:70dvh; overflow-y:auto; }

/* --- minimalist list pass --- */
.dsh-feeds-bodyInner.hasPane .dsh-feeds-listPane { flex:0 0 clamp(300px,31%,380px); max-width:380px; min-width:280px; }
.dsh-feeds-listPane { background:var(--dsw-alias-bg-base); }
.dsh-feeds-listContent { padding:0 0 32px; }
.dsh-feeds-listToolbar { padding:14px 16px 8px; font-size:11px; line-height:16px; letter-spacing:.05em; color:var(--dsw-alias-label-secondary); background:transparent; }
.dsh-feeds-listToolbar>span:first-child { opacity:.72; }
.dsh-feeds-markAll { border:0; height:auto; padding:0; background:transparent; color:var(--dsw-alias-label-secondary); font:inherit; font-size:11px; letter-spacing:.02em; cursor:pointer; }
.dsh-feeds-markAll:hover:not(:disabled) { color:var(--dsw-alias-brand-primary); background:transparent; }
.dsh-feeds-markAll:disabled { opacity:.4; cursor:default; }
.dsh-feeds-groupHead { padding:18px 16px 6px; margin:0; border:0; background:var(--dsw-alias-bg-base); font-size:10.5px; font-weight:600; line-height:14px; letter-spacing:.14em; text-transform:uppercase; color:var(--dsw-alias-label-secondary); opacity:.65; }
.dsh-feeds-group + .dsh-feeds-group { margin-top:0; }
.dsh-feeds-row { padding:12px 16px 13px; gap:10px; border-radius:0; }
.dsh-feeds-row + .dsh-feeds-row { border-top:0; }
.dsh-feeds-row:hover { background:var(--dsw-alias-bg-layer-1); }
.dsh-feeds-row.isSelected,.dsh-feeds-row.isSelected:hover { background:var(--dsw-alias-bg-layer-1); box-shadow:inset 2px 0 0 var(--dsw-alias-brand-primary); }
.dsh-feeds-rowBody { gap:0; padding-right:22px; }
.dsh-feeds-rowTitle { font-size:14.5px; line-height:21px; font-weight:600; letter-spacing:-.004em; }
.dsh-feeds-rowTitle:hover { text-decoration:none; color:var(--dsw-alias-brand-primary); }
.dsh-feeds-row[data-unread='false'] .dsh-feeds-rowTitle { color:var(--dsw-alias-label-secondary); font-weight:500; }
.dsh-feeds-rowSummary { margin-top:4px; font-size:12.5px; line-height:19px; color:var(--dsw-alias-label-secondary); opacity:.86; }
.dsh-feeds-rowMeta { margin-top:6px; font-size:11px; line-height:16px; opacity:.72; }
.dsh-feeds-sourceLink { max-width:220px; color:inherit; font:inherit; background:transparent; border:0; padding:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; cursor:pointer; }
.dsh-feeds-sourceLink:hover { color:var(--dsw-alias-label-primary); text-decoration:none; }
.dsh-feeds-dotSlot { width:8px; height:21px; margin-top:0; }
.dsh-feeds-dot { width:5px; height:5px; }
.dsh-feeds-toggle { position:absolute; top:10px; right:10px; width:24px; height:24px; opacity:0; pointer-events:none; transition:opacity 120ms ease; }
.dsh-feeds-row:hover .dsh-feeds-toggle,.dsh-feeds-row.isSelected .dsh-feeds-toggle,.dsh-feeds-row:focus-within .dsh-feeds-toggle { opacity:1; pointer-events:auto; }
.dsh-feeds-feedCluster { margin:0; border:0; border-radius:0; }
.dsh-feeds-clusterHead { padding:12px 16px 4px; background:transparent; gap:8px; }
.dsh-feeds-clusterTitle { font-size:10.5px; line-height:14px; font-weight:600; letter-spacing:.12em; text-transform:uppercase; color:var(--dsw-alias-label-secondary); opacity:.8; }
.dsh-feeds-clusterTitle:hover { color:var(--dsw-alias-label-primary); }
.dsh-feeds-clusterCount { font-size:10.5px; line-height:14px; letter-spacing:.04em; opacity:.55; }
.dsh-feeds-clusterFold { color:var(--dsw-alias-label-secondary); opacity:.55; padding:2px; }
.dsh-feeds-clusterFold:hover { opacity:1; }
.dsh-feeds-healthShortcut { margin:2px 16px 8px; padding:6px 10px; font-size:11px; line-height:16px; border-radius:6px; }
.dsh-feeds-loadMore { margin:10px 16px 0; font-size:11px; }
.dsh-feeds-nav { flex-basis:196px; padding:14px 10px 32px; background:transparent; }
.dsh-feeds-nav summary { font-size:11px; letter-spacing:.02em; padding:7px 4px; opacity:.78; }
.dsh-feeds-navSource { padding:6px 8px; font-size:12px; border-radius:5px; }
.dsh-feeds-navSource:hover,.dsh-feeds-navSource.isSelected { background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); }
.dsh-feeds-navSource>span:last-child { font-size:10.5px; opacity:.6; }
@container (max-width:899px) { .dsh-feeds-bodyInner.hasPane .dsh-feeds-listPane { flex:1 1 auto; max-width:none; min-width:0; } }
`;

    /**
     * Insert this plugin's stylesheet once and return its remover.
     * @returns cleanup that removes the style element.
     */
    function insertStyles() {
      if (typeof document === 'undefined') return () => {};
      const tag = document.createElement('style');
      tag.dataset.plugin = PACKAGE_ID;
      tag.dataset.pluginCss = `${PACKAGE_ID}/client.css`;
      tag.textContent = CSS;
      document.head.appendChild(tag);
      return () => {
        tag.remove();
      };
    }
    //#endregion

    //#region helpers
    /** Describe one failed Remote result without assuming a message shape. */
    function describeFailure(error) {
      if (error === undefined || error === null) return '';
      if (typeof error === 'string') return error;
      if (typeof error.message === 'string' && error.message !== '') return error.message;
      if (typeof error.code === 'string') return error.code;
      return '';
    }

    /** A finite number or the fallback. */
    function numberOr(value, fallback) {
      return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    }

    /** A string or the fallback. */
    function stringOr(value, fallback) {
      return typeof value === 'string' ? value : fallback;
    }

    /** Collapse whitespace so multi-line feed text renders as one plain paragraph. */
    function plainText(value) {
      if (typeof value !== 'string') return '';
      return value.replace(/\s+/g, ' ').trim();
    }

    /** Keep article text as-is except for line-ending and edge whitespace normalization. */
    function articleText(value) {
      if (typeof value !== 'string') return '';
      return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    }

    /** Open one absolute URL in a new tab; a blocked popup is harmless. */
    function openUrl(url) {
      if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return;
      try {
        window.open(url, '_blank', 'noopener,noreferrer');
      } catch (error) {
        // The browser blocked the popup; nothing else to do.
      }
    }

    /** Whether a string is one absolute http(s) URL. */
    function isHttpUrl(value) {
      if (typeof value !== 'string' || value.trim() === '') return false;
      try {
        const url = new URL(value.trim());
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch (error) {
        return false;
      }
    }

    /** Localized result line for the `feeds/add` answer. */
    function addResultText(value, t) {
      if (value === null || typeof value !== 'object') return t('sources.addSaved');
      if (value.added === false) return t('sources.addAlready');
      if (typeof value.error === 'string' && value.error !== '') return t('sources.addFetchFailed', { error: value.error });
      if (value.refreshing === true) return t('sources.addRefreshing');
      if (value.fetched === true) return t('sources.addSuccess', { count: Math.max(0, numberOr(value.itemCount, 0)) });
      return t('sources.addSaved');
    }

    /** Move one feed (and its cached rows) to another category in a snapshot. */
    function moveFeedInSnapshot(snapshot, feedId, categoryName) {
      if (snapshot === null || typeof snapshot !== 'object' || !Array.isArray(snapshot.categories)) return snapshot;
      const target = plainText(categoryName);
      if (target === '') return snapshot;
      let feed = null;
      let sourceName = null;
      for (const group of snapshot.categories) {
        if (!Array.isArray(group.feeds)) continue;
        const match = group.feeds.find((entry) => entry.id === feedId);
        if (match !== undefined) {
          feed = match;
          sourceName = group.name;
          break;
        }
      }
      if (feed === null || sourceName === target) return snapshot;
      const moved = { ...feed, category: target };
      let targetExists = snapshot.categories.some((group) => group.name === target);
      const categories = snapshot.categories.map((group) => {
        if (group.name === sourceName) {
          return { ...group, unread: Math.max(0, group.unread - feed.unread), feeds: group.feeds.filter((entry) => entry.id !== feedId) };
        }
        if (group.name === target) {
          targetExists = true;
          return { ...group, unread: group.unread + feed.unread, feeds: [...group.feeds, moved] };
        }
        return group;
      });
      if (!targetExists) categories.push({ name: target, unread: feed.unread, feeds: [moved] });
      const items = Array.isArray(snapshot.items)
        ? snapshot.items.map((item) => item.feedId === feedId ? { ...item, category: target } : item)
        : snapshot.items;
      return { ...snapshot, categories, items };
    }

    /** Normalize the Host progress value, or null when it carries no total. */
    function normalizeProgress(raw) {
      if (raw === null || typeof raw !== 'object') return null;
      const total = numberOr(raw.total, 0);
      if (total <= 0) return null;
      return {
        done: Math.max(0, numberOr(raw.done, 0)),
        total: Math.max(0, total),
        errors: Math.max(0, numberOr(raw.errors, 0)),
      };
    }

    /** Epoch milliseconds or null. */
    function timeOrNull(value) {
      return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
    }

    /**
     * Narrow one Host snapshot to the fields this view renders, tolerating a
     * missing or partial payload instead of crashing the slot entry.
     * @param raw - the Host `value` envelope.
     * @returns the normalized snapshot, or null when the shape is unusable.
     */
    function normalizeSnapshot(raw, options = {}) {
      if (raw === null || typeof raw !== 'object') return null;
      if (options.requireMeta !== false) {
        if (!Array.isArray(raw.categories)) return null;
        if (raw.stats === null || typeof raw.stats !== 'object' || Array.isArray(raw.stats)) return null;
      }

      const categories = [];
      const feeds = [];
      const rawCategories = Array.isArray(raw.categories) ? raw.categories : [];
      for (const entry of rawCategories) {
        if (entry === null || typeof entry !== 'object') continue;
        const name = plainText(entry.name);
        const categoryFeeds = [];
        const rawFeeds = Array.isArray(entry.feeds) ? entry.feeds : [];
        for (const feed of rawFeeds) {
          if (feed === null || typeof feed !== 'object') continue;
          const normalizedFeed = {
            id: stringOr(feed.id, ''),
            title: plainText(feed.title) || stringOr(feed.url, ''),
            site: stringOr(feed.site, null),
            url: plainText(feed.url),
            category: plainText(feed.category) || name,
            unread: Math.max(0, numberOr(feed.unread, 0)),
            itemCount: Math.max(0, numberOr(feed.itemCount, 0)),
            error: typeof feed.error === 'string' && feed.error !== '' ? feed.error : null,
            lastFetched: timeOrNull(feed.lastFetched),
          };
          categoryFeeds.push(normalizedFeed);
          feeds.push(normalizedFeed);
        }
        categories.push({
          name,
          unread: Math.max(0, numberOr(entry.unread, 0)),
          feeds: categoryFeeds,
        });
      }

      const items = [];
      const rawItems = Array.isArray(raw.items) ? raw.items : [];
      for (const item of rawItems) {
        if (item === null || typeof item !== 'object') continue;
        if (typeof item.id !== 'string' || item.id === '') continue;
        items.push({
          id: item.id,
          feedId: stringOr(item.feedId, ''),
          feedTitle: plainText(item.feedTitle),
          category: plainText(item.category),
          title: plainText(item.title),
          link: plainText(item.link),
          summary: plainText(item.summary),
          author: stringOr(item.author, null),
          published: timeOrNull(item.published),
          fetchedAt: timeOrNull(item.fetchedAt),
          unread: item.unread !== false,
          saved: item.saved === true,
        });
      }

      const rawStats = raw.stats !== null && typeof raw.stats === 'object' ? raw.stats : {};
      const stats = {
        feeds: Math.max(0, numberOr(rawStats.feeds, feeds.length)),
        items: Math.max(0, numberOr(rawStats.items, items.length)),
        saved: Math.max(0, numberOr(rawStats.saved, 0)),
        unread: Math.max(0, numberOr(rawStats.unread, categories.reduce((sum, category) => sum + category.unread, 0))),
        failed: Math.max(0, numberOr(rawStats.failed, feeds.filter((feed) => feed.error !== null).length)),
      };

      const rawOpml = raw.opml !== null && typeof raw.opml === 'object' ? raw.opml : {};
      return {
        generatedAt: numberOr(raw.generatedAt, Date.now()),
        refreshing: raw.refreshing === true,
        progress: normalizeProgress(raw.progress),
        categories,
        items,
        stats,
        opml: {
          path: stringOr(rawOpml.path, null),
          importedAt: timeOrNull(rawOpml.importedAt),
        },
        refreshMinutes: typeof raw.refreshMinutes === 'number' && Number.isFinite(raw.refreshMinutes) && raw.refreshMinutes >= 0
          ? raw.refreshMinutes
          : null,
        lastRefreshAt: timeOrNull(raw.lastRefreshAt),
      };
    }

    /** Trim one block string to a bounded plain-text value. */
    function clampBlockText(value, limit) {
      const text = plainText(value);
      return text.length > limit ? text.slice(0, limit) : text;
    }

    /** Absolute http(s) image URL, or null for anything else. */
    function safeImageUrl(value) {
      if (typeof value !== 'string') return null;
      const trimmed = value.trim();
      if (trimmed === '' || trimmed.length > MAX_IMAGE_URL) return null;
      try {
        const url = new URL(trimmed);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        // Defence in depth: never auto-load images from local/private hosts.
        const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
        if (host === 'localhost' || host === '::1' || host === '0.0.0.0' || /^127\./.test(host) || /^10\./.test(host)
          || /^192\.168\./.test(host) || /^169\.254\./.test(host) || host.endsWith('.local') || host.endsWith('.internal')
          || /^f[cd][0-9a-f]{2}:/.test(host) || host.startsWith('::ffff:')) return null;
        const inPrivateRange = /^172\.(\d{1,3})\./.exec(host);
        if (inPrivateRange !== null) {
          const octet = Number(inPrivateRange[1]);
          if (octet >= 16 && octet <= 31) return null;
        }
        return url.href;
      } catch (error) {
        return null;
      }
    }

    /**
     * Narrow the Host rich article blocks to a safe, bounded render model.
     * Unknown or malformed blocks are dropped rather than reaching the renderer.
     * @param raw - the Host `blocks` value, possibly missing or malformed.
     * @returns a plain array of validated blocks (never null).
     */
    function normalizeBlocks(raw) {
      if (!Array.isArray(raw)) return EMPTY_ITEMS;
      const blocks = [];
      for (const block of raw) {
        if (blocks.length >= MAX_ARTICLE_BLOCKS) break;
        if (block === null || typeof block !== 'object') continue;
        if (block.type === 'code') {
          const text = typeof block.text === 'string' ? block.text.slice(0,20000) : '';
          if (text) blocks.push({type:'code',text,language:plainText(block.language).slice(0,40)});
          continue;
        }
        if (block.type === 'table') {
          const rows = Array.isArray(block.rows) ? block.rows.slice(0,60).map(row => Array.isArray(row) ? row.slice(0,12).map(cell => plainText(cell).slice(0,1000)) : []).filter(row => row.length) : [];
          if (rows.length) blocks.push({type:'table',rows,header:block.header === true});
          continue;
        }
        const links = Array.isArray(block.links) ? block.links.slice(0,50).map(link => ({text:plainText(link?.text),href:safeImageUrl(link?.href)})).filter(link => link.text && link.href) : [];
        if (block.type === 'paragraph') {
          const text = clampBlockText(block.text, MAX_BLOCK_TEXT);
          if (text !== '') blocks.push({ type: 'paragraph', text, links });
          continue;
        }
        if (block.type === 'heading') {
          const text = clampBlockText(block.text, MAX_BLOCK_TEXT);
          if (text === '') continue;
          const level = Math.min(4, Math.max(1, Math.round(numberOr(block.level, 2))));
          blocks.push({ type: 'heading', level, text, links });
          continue;
        }
        if (block.type === 'quote') {
          const text = clampBlockText(block.text, MAX_BLOCK_TEXT);
          if (text !== '') blocks.push({ type: 'quote', text, links });
          continue;
        }
        if (block.type === 'list') {
          const items = [];
          if (Array.isArray(block.items)) {
            for (const item of block.items) {
              if (items.length >= MAX_LIST_ITEMS) break;
              const text = clampBlockText(item, MAX_BLOCK_TEXT);
              if (text !== '') items.push(text);
            }
          }
          if (items.length > 0) blocks.push({ type: 'list', ordered: block.ordered === true, items });
          continue;
        }
        if (block.type === 'image') {
          const src = safeImageUrl(block.src);
          if (src === null) continue;
          blocks.push({
            type: 'image',
            src,
            alt: clampBlockText(block.alt, MAX_MEDIA_TEXT),
            caption: clampBlockText(block.caption, MAX_MEDIA_TEXT),
          });
        }
      }
      return blocks;
    }

    /** Narrow one `feeds/article` value to the fields the reading pane renders. */
    function normalizeArticle(raw) {
      if (raw === null || typeof raw !== 'object') return null;
      const rawItem = raw.item !== null && typeof raw.item === 'object' ? raw.item : {};
      const rawFeed = raw.feed !== null && typeof raw.feed === 'object' ? raw.feed : {};
      const contentKind = raw.contentKind === 'article' || raw.contentKind === 'text' || raw.contentKind === 'feed' ? raw.contentKind : 'summary';
      const derivedSource = contentKind === 'feed' ? 'feed' : contentKind === 'summary' ? 'summary' : 'web';
      return {
        item: {
          id: stringOr(rawItem.id, ''),
          title: plainText(rawItem.title),
          link: plainText(rawItem.link),
          summary: plainText(rawItem.summary),
          author: stringOr(rawItem.author, null),
          published: timeOrNull(rawItem.published),
          unread: rawItem.unread !== false,
        },
        feed: {
          id: stringOr(rawFeed.id, ''),
          title: plainText(rawFeed.title),
          category: plainText(rawFeed.category),
          site: stringOr(rawFeed.site, null),
        },
        content: articleText(raw.content),
        contentKind,
        contentSource: ['feed','web','summary'].includes(raw.contentSource) ? raw.contentSource : derivedSource,
        truncated: raw.truncated === true || (Array.isArray(raw.blocks) && raw.blocks.length > MAX_ARTICLE_BLOCKS),
        contentError: typeof raw.contentError === 'string' && raw.contentError !== '' ? raw.contentError : null,
        blocks: normalizeBlocks(raw.blocks),
      };
    }

    /**
     * Apply one read/unread decision to the snapshot, adjusting item flags,
     * category badges, and the global unread count together. Returns the same
     * snapshot when nothing changes so memoized derivations stay cached.
     */
    function applyUnread(snapshot, ids, unread) {
      if (snapshot === null || !Array.isArray(ids) || ids.length === 0) return snapshot;
      const idSet = new globalThis.Set(ids);
      const categoryDelta = new globalThis.Map();
      let totalDelta = 0;
      let changed = false;
      const items = snapshot.items.map((item) => {
        if (!idSet.has(item.id) || item.unread === unread) return item;
        changed = true;
        const delta = unread ? 1 : -1;
        totalDelta += delta;
        categoryDelta.set(item.category, (categoryDelta.get(item.category) || 0) + delta);
        return { ...item, unread };
      });
      if (!changed) return snapshot;
      const categories = snapshot.categories.map((category) => {
        const delta = categoryDelta.get(category.name) || 0;
        const feeds = category.feeds.map(feed => {
          const feedDelta = snapshot.items.filter(item => idSet.has(item.id) && item.feedId === feed.id && item.unread !== unread).reduce((sum,item) => sum + (unread ? 1 : -1),0);
          return feedDelta ? {...feed,unread:Math.max(0,feed.unread+feedDelta)} : feed;
        });
        return { ...category, feeds, unread: Math.max(0, category.unread + delta) };
      });
      return {
        ...snapshot,
        items,
        categories,
        stats: { ...snapshot.stats, unread: Math.max(0, snapshot.stats.unread + totalDelta) },
      };
    }

    /** Best available timestamp for one item: publication time, else fetch time. */
    function itemTimeOf(item) {
      if (typeof item.published === 'number' && Number.isFinite(item.published) && item.published > 0) return item.published;
      if (typeof item.fetchedAt === 'number' && Number.isFinite(item.fetchedAt) && item.fetchedAt > 0) return item.fetchedAt;
      return null;
    }

    /** Local-midnight timestamp for one epoch value. */
    function dayStartMs(ms) {
      const date = new Date(ms);
      date.setHours(0, 0, 0, 0);
      return date.getTime();
    }

    /** Day bucket key for one item timestamp. */
    function dayGroupOf(ms, nowMs) {
      const day = dayStartMs(ms);
      const today = dayStartMs(nowMs);
      if (day === today) return 'today';
      const yesterdayDate = new Date(today);
      yesterdayDate.setDate(yesterdayDate.getDate() - 1);
      if (day === yesterdayDate.getTime()) return 'yesterday';
      return 'earlier';
    }

    /** Localized day bucket heading. */
    function groupLabelOf(key, t) {
      if (key === 'today') return t('group.today');
      if (key === 'yesterday') return t('group.yesterday');
      return t('group.earlier');
    }

    /** Absolute date used for items older than one week. */
    function absoluteDateOf(ms, nowMs) {
      const date = new Date(ms);
      const sameYear = date.getFullYear() === new Date(nowMs).getFullYear();
      try {
        return new Intl.DateTimeFormat(undefined, sameYear
          ? { month: 'short', day: 'numeric' }
          : { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
      } catch {
        return '';
      }
    }

    /** Relative time copy: just now, minutes, hours, yesterday, days, then a date. */
    function relativeTimeOf(ms, nowMs, t) {
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '';
      const elapsed = Math.max(0, nowMs - ms);
      const minutes = Math.floor(elapsed / 60000);
      if (minutes < 1) return t('time.justNow');
      if (minutes < 60) return t('time.minutes', { count: minutes });
      const hours = Math.floor(elapsed / 3600000);
      if (hours < 24) return t('time.hours', { count: hours });
      const dayDiff = Math.round((dayStartMs(nowMs) - dayStartMs(ms)) / DAY_MS);
      if (dayDiff <= 1) return t('time.yesterday');
      if (dayDiff < 7) return t('time.days', { count: dayDiff });
      return t('time.date', { date: absoluteDateOf(ms, nowMs) });
    }

    /** Whether one item title or summary contains the normalized query. */
    function matchesQuery(item, needle) {
      return item.title.toLocaleLowerCase().includes(needle)
        || item.summary.toLocaleLowerCase().includes(needle);
    }

    /** "N sources" with a singular form where the copy needs one. */
    function feedsStatOf(count, t) {
      return count === 1 ? t('stats.feedsOne', { count }) : t('stats.feeds', { count });
    }

    /** "N sources failed to refresh" with a singular form. */
    function failedHealthOf(count, t) {
      return count === 1 ? t('health.failedOne', { count }) : t('health.failed', { count });
    }

    /** Whether a keyboard event target is an editable or select control. */
    function isEditableTarget(target) {
      if (target === null || typeof target !== 'object') return false;
      const tag = typeof target.tagName === 'string' ? target.tagName.toUpperCase() : '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (target.isContentEditable === true) return true;
      if (typeof target.closest === 'function') {
        try {
          if (target.closest('[contenteditable="true"]') !== null) return true;
        } catch {
          return false;
        }
      }
      return false;
    }

    /** Read the persisted filter/mode preferences; never throws. */
    function readStoredPrefs() {
      try {
        if (typeof window === 'undefined' || window.localStorage === undefined) return null;
        const raw = window.localStorage.getItem(PREFS_KEY);
        if (raw === null || raw === '') return null;
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object') return null;
        return {
          category: typeof parsed.category === 'string' && parsed.category !== '' ? parsed.category : ALL_CATEGORIES,
          unreadOnly: parsed.unreadOnly === true,
          feedId: typeof parsed.feedId === 'string' && parsed.feedId !== '' ? parsed.feedId : null,
          mode: parsed.mode === MODE_SOURCES ? MODE_SOURCES : MODE_FEED,
          savedOnly: parsed.savedOnly === true,
          groupBySource: parsed.groupBySource !== false,
          density: parsed.density === 'compact' ? 'compact' : 'summary',
          fontSize: Number.isFinite(parsed.fontSize) ? Math.max(14,Math.min(28,Math.round(parsed.fontSize))) : 17,
          readMode: ['open','delay','manual'].includes(parsed.readMode) ? parsed.readMode : 'delay',
          selectedItem: parsed.selectedItem && typeof parsed.selectedItem.id === 'string' && typeof parsed.selectedItem.title === 'string' ? parsed.selectedItem : null,
          positions: parsed.positions && typeof parsed.positions === 'object' ? Object.fromEntries(Object.entries(parsed.positions).slice(-50).filter(([key,value]) => Number.isFinite(value) && value >= 0)) : {},
          listPosition: Number.isFinite(parsed.listPosition) ? Math.max(0,parsed.listPosition) : 0,
        };
      } catch (error) {
        return null;
      }
    }

    /** Persist filter/mode preferences; never throws. */
    function persistPrefs(prefs) {
      try {
        if (typeof window === 'undefined' || window.localStorage === undefined) return;
        window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
      } catch (error) {
        // Private mode or a full quota: preferences are a convenience only.
      }
    }

    /** Read one cached article and refresh its recency; null on a miss. */
    function readArticleCache(cache, itemId) {
      const entry = cache.get(itemId);
      if (entry === undefined) return null;
      cache.delete(itemId);
      cache.set(itemId, entry);
      return entry;
    }

    /** Store one article and evict the oldest entries beyond the cache bound. */
    function writeArticleCache(cache, itemId, article) {
      cache.delete(itemId);
      cache.set(itemId, article);
      while (cache.size > ARTICLE_CACHE_LIMIT) {
        const oldest = cache.keys().next();
        if (oldest.done === true) break;
        cache.delete(oldest.value);
      }
    }

    /**
     * Copy text through the web clipboard, falling back to selecting a DOM node
     * so the user can copy manually. Resolves to 'copied' | 'selected' | 'failed'.
     */
    async function copyText(value, fallbackNode) {
      const text = typeof value === 'string' ? value : '';
      if (text === '') return 'failed';
      try {
        const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
        if (clipboard !== undefined && clipboard !== null && typeof clipboard.writeText === 'function') {
          await clipboard.writeText(text);
          return 'copied';
        }
      } catch (error) {
        // Permission denied or no secure context: try the selection fallback.
      }
      try {
        const node = fallbackNode === undefined || fallbackNode === null ? null : fallbackNode;
        if (node !== null && typeof document !== 'undefined' && typeof document.createRange === 'function') {
          const range = document.createRange();
          range.selectNodeContents(node);
          const selection = typeof window === 'undefined' || typeof window.getSelection !== 'function'
            ? null
            : window.getSelection();
          if (selection !== null) {
            selection.removeAllRanges();
            selection.addRange(range);
            if (typeof document.execCommand === 'function' && document.execCommand('copy')) return 'copied';
            return 'selected';
          }
        }
      } catch (error) {
        return 'failed';
      }
      return 'failed';
    }

    /** Split readable article text into paragraphs of lines. */
    function articleParagraphs(content) {
      if (typeof content !== 'string' || content.trim() === '') return EMPTY_ITEMS;
      const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
      const blocks = normalized.split(/\n{2,}/);
      const paragraphs = [];
      for (const block of blocks) {
        const lines = block.split('\n').filter((line) => line.trim() !== '');
        if (lines.length > 0) paragraphs.push(lines);
      }
      return paragraphs;
    }

    /** Render one paragraph's lines with a real line break between them. */
    function paragraphChildren(lines) {
      const children = [];
      lines.forEach((line, index) => {
        if (index > 0) children.push(h('br', { key: `br${index}` }));
        children.push(line);
      });
      return children;
    }
    //#endregion

    //#region icons
    function svgIcon(size, children) {
      return h('svg', {
        viewBox: '0 0 16 16',
        width: size,
        height: size,
        'aria-hidden': 'true',
        focusable: 'false',
      }, children);
    }

    function RefreshIcon() {
      return svgIcon(14, [
        h('path', {
          key: 'arc',
          d: 'M13.2 8a5.2 5.2 0 1 1-1.6-3.7',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
        }),
        h('path', {
          key: 'head',
          d: 'M13.3 2.6v2.9H10.4',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      ]);
    }

    function SearchIcon() {
      return svgIcon(14, [
        h('circle', {
          key: 'lens',
          cx: 7,
          cy: 7,
          r: 4.2,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
        }),
        h('path', {
          key: 'handle',
          d: 'M10.2 10.2 13.5 13.5',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
        }),
      ]);
    }

    function ClearIcon() {
      return svgIcon(14, [
        h('circle', {
          key: 'ring',
          cx: 8,
          cy: 8,
          r: 6,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
        }),
        h('path', {
          key: 'cross',
          d: 'M6 6l4 4M10 6l-4 4',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
        }),
      ]);
    }

    function ChevronIcon({ open }) {
      return h('svg', {
        viewBox: '0 0 16 16',
        width: 12,
        height: 12,
        'aria-hidden': 'true',
        focusable: 'false',
        className: open ? 'dsh-feeds-healthChevron isOpen' : 'dsh-feeds-healthChevron',
      }, h('path', {
        d: 'M6 4l4 4-4 4',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }));
    }

    function WarningIcon() {
      return svgIcon(14, [
        h('path', {
          key: 'triangle',
          d: 'M8 2.4 14 13H2Z',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinejoin: 'round',
        }),
        h('path', {
          key: 'stem',
          d: 'M8 6.4v3.2',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
        }),
        h('circle', { key: 'dot', cx: 8, cy: 11.3, r: 0.8, fill: 'currentColor' }),
      ]);
    }

    function MarkReadIcon() {
      return svgIcon(15, [
        h('circle', {
          key: 'ring',
          cx: 8,
          cy: 8,
          r: 6,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
        }),
        h('path', {
          key: 'check',
          d: 'M5.4 8.2 7.1 9.9 10.6 6.3',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      ]);
    }

    function MarkUnreadIcon() {
      return svgIcon(15, [
        h('circle', {
          key: 'ring',
          cx: 8,
          cy: 8,
          r: 6,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
        }),
        h('circle', { key: 'dot', cx: 8, cy: 8, r: 2.4, fill: 'currentColor' }),
      ]);
    }

    function RssIcon() {
      return h('svg', {
        viewBox: '0 0 32 32',
        width: 32,
        height: 32,
        'aria-hidden': 'true',
        focusable: 'false',
      }, [
        h('circle', { key: 'dot', cx: 9, cy: 23, r: 2.4, fill: 'currentColor' }),
        h('path', {
          key: 'inner',
          d: 'M7 15a10 10 0 0 1 10 10',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2.4,
          strokeLinecap: 'round',
        }),
        h('path', {
          key: 'outer',
          d: 'M7 9a16 16 0 0 1 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2.4,
          strokeLinecap: 'round',
        }),
      ]);
    }

    function CloseIcon() {
      return svgIcon(14, [
        h('path', {
          key: 'cross',
          d: 'M4 4l8 8M12 4l-8 8',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
        }),
      ]);
    }

    function BackIcon() {
      return svgIcon(13, [
        h('path', {
          key: 'arrow',
          d: 'M10 3 5 8l5 5',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      ]);
    }

    function ExternalIcon() {
      return svgIcon(12, [
        h('path', {
          key: 'box',
          d: 'M9.5 3.5H13V7',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
        h('path', {
          key: 'arrow',
          d: 'M13 3 7.5 8.5',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
        }),
        h('path', {
          key: 'frame',
          d: 'M11 10.5v2A1.5 1.5 0 0 1 9.5 14h-6A1.5 1.5 0 0 1 2 12.5v-6A1.5 1.5 0 0 1 3.5 5h2',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      ]);
    }

    function CopyIcon() {
      return svgIcon(12, [
        h('rect', {
          key: 'back',
          x: 5,
          y: 5,
          width: 8,
          height: 8,
          rx: 1.5,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
        }),
        h('path', {
          key: 'front',
          d: 'M3.5 10.5A1.5 1.5 0 0 1 2 9V3.5A1.5 1.5 0 0 1 3.5 2H9a1.5 1.5 0 0 1 1.5 1.5',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
        }),
      ]);
    }

    function SparkIcon() {
      return svgIcon(13, [
        h('path', {
          key: 'spark',
          d: 'M8 1.8 9.5 6l4.2 1.5L9.5 9 8 13.2 6.5 9 2.3 7.5 6.5 6Z',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinejoin: 'round',
        }),
      ]);
    }
    //#endregion

    //#region view parts
    /** One filter chip: a real toggle button with a pressed state. */
    function FilterChip({ selected, onClick, ariaLabel, title, children }) {
      return h('button', {
        type: 'button',
        className: selected ? 'dsh-feeds-chip isSelected' : 'dsh-feeds-chip',
        'aria-pressed': selected === true,
        'aria-label': ariaLabel,
        title,
        onClick,
      }, children);
    }

    /** Header segmented control for the feed/sources modes. */
    function SegmentedControl({ value, onChange, t }) {
      return h('div', { className: 'dsh-feeds-segment', role: 'group', 'aria-label': t('mode.label') }, [
        h('button', {
          key: 'feed',
          type: 'button',
          className: value === MODE_FEED ? 'dsh-feeds-segmentButton isSelected' : 'dsh-feeds-segmentButton',
          'aria-pressed': value === MODE_FEED,
          onClick: () => onChange(MODE_FEED),
        }, t('mode.feed')),
        h('button', {
          key: 'sources',
          type: 'button',
          className: value === MODE_SOURCES ? 'dsh-feeds-segmentButton isSelected' : 'dsh-feeds-segmentButton',
          'aria-pressed': value === MODE_SOURCES,
          onClick: () => onChange(MODE_SOURCES),
        }, t('mode.sources')),
      ]);
    }

    /** Header keyboard-shortcut popover. */
    function HelpPopover({ t, onClose }) {
      const rows = [
        ['help.keyNext', 'help.next'],
        ['help.keyPrev', 'help.prev'],
        ['help.keyOpen', 'help.open'],
        ['help.keyRead', 'help.toggleRead'],
        ['help.keySearch', 'help.search'],
        ['help.keyRefresh', 'help.refresh'],
        ['help.keyEscape', 'help.escape'],
      ];
      return h('div', { className: 'dsh-feeds-helpPopover', role: 'dialog', 'aria-label': t('help.title') }, [
        h('div', { key: 'head', className: 'dsh-feeds-helpHead' }, [
          h('h2', { key: 'title', className: 'dsh-feeds-helpTitle' }, t('help.title')),
          h('button', {
            key: 'close',
            type: 'button',
            className: 'dsh-feeds-helpClose',
            'aria-label': t('help.close'),
            title: t('help.close'),
            onClick: onClose,
          }, h(CloseIcon)),
        ]),
        h('ul', { key: 'list', className: 'dsh-feeds-helpList' }, rows.map(([keyLabel, description]) => h('li', {
          key: keyLabel,
          className: 'dsh-feeds-helpRow',
        }, [
          h('span', { key: 'key', className: 'dsh-feeds-helpKey' }, t(keyLabel)),
          h('span', { key: 'text', className: 'dsh-feeds-helpText' }, t(description)),
        ]))),
      ]);
    }

    /** One feed item row: unread dot, selectable body, source link, read toggle. */
    /** Source-host favicon only; failed images reveal a local letter fallback. */
    function SourceIcon({source,title}) {
      let src = '';
      try {const url=new URL(source);if(/^https?:$/.test(url.protocol))src=url.origin+'/favicon.ico';} catch {}
      const letter=Array.from(String(title||'?').trim())[0]||'?';
      return h('span',{className:'dsh-feeds-sourceIcon','aria-hidden':'true'},[
        h('span',{key:'fallback',className:'dsh-feeds-sourceIconFallback'},letter.toUpperCase()),
        src?h('img',{key:src,className:'dsh-feeds-sourceIconImage',src,alt:'',loading:'lazy',decoding:'async',referrerPolicy:'no-referrer',onError:event=>{event.currentTarget.hidden=true;}}):null,
      ]);
    }

    function FeedRow({ item, selected, nowMs, t, onSelect, onToggle, onFilterSource, registerNode, hideSource=false }) {
      const time = relativeTimeOf(itemTimeOf(item), nowMs, t);
      const meta = [];
      if (item.feedTitle !== '' && !hideSource) {
        const sourceLabel = t('row.sourceFilter', { name: item.feedTitle });
        meta.push(h('button', {
          key: 'source',
          type: 'button',
          className: 'dsh-feeds-sourceLink',
          title: sourceLabel,
          'aria-label': sourceLabel,
          onClick: (event) => {
            if (event !== null && typeof event === 'object') event.stopPropagation();
            onFilterSource(item);
          },
        }, item.feedTitle));
      }
      if (time !== '') {
        if (meta.length > 0) meta.push(h('span', { key: 'sep1', className: 'dsh-feeds-metaSeparator' }, ' · '));
        meta.push(time);
      }
      const className = selected ? 'dsh-feeds-row isSelected' : 'dsh-feeds-row';
      return h('li', {
        className,
        'data-unread': item.unread ? 'true' : 'false',
        'aria-current': selected ? 'true' : undefined,
        ref: (node) => {
          if (typeof registerNode === 'function') registerNode(item.id, node);
        },
      }, [
        h('span', { key: 'dot', className: 'dsh-feeds-dotSlot', 'aria-hidden': 'true' },
          item.unread ? h('span', { className: 'dsh-feeds-dot' }) : null),
        h('div', {
          key: 'body',
          className: 'dsh-feeds-rowBody',
          onClick: () => onSelect(item),
        }, [
          h('button', {
            key: 'title',
            type: 'button',
            className: 'dsh-feeds-rowTitle',
            'data-feeds-row-title': 'true',
            onClick: (event) => {
              if (event !== null && typeof event === 'object') event.stopPropagation();
              onSelect(item);
            },
          }, item.title === '' ? t('item.untitled') : item.title),
          item.summary === '' ? null : h('p', { key: 'summary', className: 'dsh-feeds-rowSummary' }, item.summary),
          meta.length === 0 ? null : h('p', { key: 'meta', className: 'dsh-feeds-rowMeta' }, meta),
        ]),
        h('button', {
          key: 'toggle',
          type: 'button',
          className: 'dsh-feeds-toggle',
          'aria-pressed': item.unread !== true,
          'aria-label': t('item.toggleRead'),
          title: t('item.toggleRead'),
          onClick: (event) => {
            if (event !== null && typeof event === 'object') event.stopPropagation();
            onToggle(item);
          },
        }, item.unread ? h(MarkReadIcon) : h(MarkUnreadIcon)),
      ]);
    }

    /** One day group with a sticky heading and its rows. */
    function DayGroup({ groupKey, items, nowMs, t, selectedId, onSelect, onToggle, onFilterSource, registerNode }) {
      const heading = t('group.heading', { name: groupLabelOf(groupKey, t), count: items.length });
      return h('section', { className: 'dsh-feeds-group' }, [
        h('h2', { key: 'head', className: 'dsh-feeds-groupHead' }, heading),
        h('ul', { key: 'list', className: 'dsh-feeds-list' }, items.map((item) => h(FeedRow, {
          key: item.id,
          item,
          selected: selectedId === item.id,
          nowMs,
          t,
          onSelect,
          onToggle,
          onFilterSource,
          registerNode,
        }))),
      ]);
    }

    /** Collapsible source-health warning strip. */
    function HealthStrip({ failedFeeds, count, expanded, onToggle, t }) {
      return h('div', { className: 'dsh-feeds-health' }, [
        h('button', {
          key: 'head',
          type: 'button',
          className: 'dsh-feeds-healthHead',
          'aria-expanded': expanded === true,
          title: expanded ? t('health.hide') : t('health.show'),
          onClick: onToggle,
        }, [
          h('span', { key: 'icon', className: 'dsh-feeds-healthIcon' }, h(WarningIcon)),
          h('span', { key: 'text', className: 'dsh-feeds-healthText' }, failedHealthOf(count, t)),
          h(ChevronIcon, { key: 'chevron', open: expanded === true }),
        ]),
        expanded
          ? h('ul', { key: 'body', className: 'dsh-feeds-healthList' }, failedFeeds.length === 0
            ? [h('li', { key: 'none', className: 'dsh-feeds-healthItem' },
              h('span', { className: 'dsh-feeds-healthError' }, t('health.noDetails')))]
            : failedFeeds.map((feed) => h('li', {
              key: feed.id !== '' ? feed.id : feed.url,
              className: 'dsh-feeds-healthItem',
            }, [
              h('span', { key: 'title', className: 'dsh-feeds-healthFeed' }, feed.title !== '' ? feed.title : feed.url),
              h('span', { key: 'error', className: 'dsh-feeds-healthError' }, feed.error),
            ])))
          : null,
      ]);
    }

    /** Four skeleton rows shown while the first snapshot loads. */
    function ListSkeleton({ t }) {
      const rows = [0, 1, 2, 3];
      return h('div', { className: 'dsh-feeds-skeletonList' }, [
        h('span', { key: 'status', className: 'dsh-feeds-srOnly', role: 'status' }, t('view.loading')),
        ...rows.map((index) => h('div', { key: index, className: 'dsh-feeds-skeletonRow', 'aria-hidden': 'true' }, [
          h('span', { key: 'dot', className: 'dsh-feeds-skeletonDot' }),
          h('div', { key: 'body', className: 'dsh-feeds-skeletonBody' }, [
            h('span', { key: 'line1', className: 'dsh-feeds-skeletonLine dsh-feeds-skeletonLineLong' }),
            h('span', { key: 'line2', className: 'dsh-feeds-skeletonLine dsh-feeds-skeletonLineMid' }),
            h('span', { key: 'line3', className: 'dsh-feeds-skeletonLine dsh-feeds-skeletonLineShort' }),
          ]),
        ])),
      ]);
    }

    /** Skeleton lines shown while one article loads into the reading pane. */
    function PaneSkeleton({ t }) {
      return h('div', { className: 'dsh-feeds-skeletonList' }, [
        h('span', { key: 'status', className: 'dsh-feeds-srOnly', role: 'status' }, t('pane.loading')),
        ...[0, 1, 2].map((index) => h('div', { key: index, className: 'dsh-feeds-skeletonRow', 'aria-hidden': 'true' },
          h('div', { className: 'dsh-feeds-skeletonBody' }, [
            h('span', { key: 'line1', className: 'dsh-feeds-skeletonLine dsh-feeds-skeletonLineLong' }),
            h('span', { key: 'line2', className: 'dsh-feeds-skeletonLine dsh-feeds-skeletonLineLong' }),
            h('span', { key: 'line3', className: 'dsh-feeds-skeletonLine dsh-feeds-skeletonLineMid' }),
          ]))),
      ]);
    }

    /** One rich-article image with lazy loading, click-to-open, and a failure row. */
    function ArticleImage({ block, t }) {
      const [failed, setFailed] = React.useState(false);
      React.useEffect(() => { setFailed(false); }, [block.src]);
      const openImage = () => openUrl(block.src);
      if (failed) {
        return h('div', { className: 'dsh-feeds-articleImageFailed' }, [
          h('span', { key: 'text' }, t('pane.imageFailed')),
          h('button', { key: 'open', type: 'button', className: 'dsh-feeds-smallButton', onClick: openImage }, t('pane.openImage')),
        ]);
      }
      const alt = typeof block.alt === 'string' ? block.alt : '';
      const rawCaption = typeof block.caption === 'string' ? block.caption : '';
      const label = alt !== '' ? alt : t('pane.openImage');
      const caption = rawCaption !== '' ? rawCaption : alt;
      return h('figure', { className: 'dsh-feeds-articleFigure' }, [
        h('button', {
          key: 'button',
          type: 'button',
          className: 'dsh-feeds-articleImageButton',
          'aria-label': label,
          title: label,
          onClick: openImage,
        }, h('img', {
          key: 'image',
          className: 'dsh-feeds-articleImage',
          src: block.src,
          alt,
          loading: 'lazy',
          referrerPolicy: 'no-referrer',
          onError: () => setFailed(true),
        })),
        caption === '' ? null : h('figcaption', { key: 'caption', className: 'dsh-feeds-articleFigcaption' }, caption),
      ]);
    }

    function richInline(block) {
      const text = block.text || '';
      const output = [];
      let offset = 0;
      for (const link of block.links || []) {
        const at = text.indexOf(link.text,offset);
        if (at < 0) continue;
        if (at > offset) output.push(text.slice(offset,at));
        output.push(h('a',{key:`${at}:${link.href}`,href:link.href,target:'_blank',rel:'noopener noreferrer'},link.text));
        offset = at + link.text.length;
      }
      output.push(text.slice(offset));
      return output;
    }

    /** Render one normalized article block; unknown or malformed blocks render nothing. */
    function ArticleBlock({ block, t }) {
      if (block === null || typeof block !== 'object') return null;
      if (block.type === 'code') return h('pre',{className:'dsh-feeds-articleCode'},h('code',{'data-language':block.language},block.text));
      if (block.type === 'table') return h('div',{className:'dsh-feeds-tableScroll',tabIndex:0},h('table',{className:'dsh-feeds-articleTable'},h('tbody',null,block.rows.map((row,i)=>h('tr',{key:i},row.map((cell,j)=>h(i===0&&block.header?'th':'td',{key:j},cell)))))));
      if (block.type === 'paragraph') {
        return h('p', { className: 'dsh-feeds-articleP' }, richInline(block));
      }
      if (block.type === 'heading') {
        const text = typeof block.text === 'string' ? block.text : '';
        if (text === '') return null;
        const main = block.level <= 2;
        return h(main ? 'h3' : 'h4', {
          className: main ? 'dsh-feeds-articleH' : 'dsh-feeds-articleHSub',
        }, richInline(block));
      }
      if (block.type === 'quote') {
        const text = typeof block.text === 'string' ? block.text : '';
        return text === '' ? null : h('blockquote', { className: 'dsh-feeds-articleQuote' }, richInline(block));
      }
      if (block.type === 'list') {
        const items = Array.isArray(block.items) ? block.items : EMPTY_ITEMS;
        const Tag = block.ordered === true ? 'ol' : 'ul';
        return h(Tag, { className: 'dsh-feeds-articleList' }, items.map((item, index) => h('li', {
          key: index,
        }, typeof item === 'string' ? item : '')));
      }
      if (block.type === 'image') {
        return typeof block.src === 'string' && block.src !== '' ? h(ArticleImage, { block, t }) : null;
      }
      return null;
    }

    /** Localized copy for one pane notice code. */
    function paneNoticeText(kind, t) {
      if (kind === 'questionInserted') return t('notice.questionInserted');
      if (kind === 'questionCopied') return t('notice.questionCopied');
      if (kind === 'linkCopied') return t('notice.linkCopied');
      if (kind === 'copyFailed') return t('notice.copyFailed');
      return '';
    }

    /**
     * The in-page reading pane: header metadata, title, actions, and the
     * article body. Never throws on a missing article payload.
     */
    function ReadingPane({ item, article, paneNotice, nowMs, t, focusMode, onToggleFocus, onClose, onRetry, onOpenOriginal, onSummarize, onToggleRead, onCopyLink, onSave, onPrevious, onNext, scrollRef, onScroll, fontSize, onFontSize }) {
      const matches = article !== null && article.itemId === item.id;
      const status = matches ? article.status : 'loading';
      const data = matches ? article.data : null;
      const title = item.title !== '' ? item.title : (data !== null && data.item.title !== '' ? data.item.title : t('item.untitled'));
      const link = item.link !== '' ? item.link : (data !== null ? data.item.link : '');
      const feedTitle = data !== null && data.feed.title !== '' ? data.feed.title : item.feedTitle;
      const category = data !== null && data.feed.category !== '' ? data.feed.category : item.category;
      const time = relativeTimeOf(itemTimeOf(item), nowMs, t);
      const author = data !== null && data.item.author !== null ? data.item.author : item.author;
      const metaParts = [feedTitle, category, time].filter((part) => part !== '');
      const loading = status === 'loading';
      const failed = status === 'error';
      const ready = status === 'ready' && data !== null;
      const paragraphs = ready ? articleParagraphs(data.content) : EMPTY_ITEMS;
      const blocks = ready && Array.isArray(data.blocks) ? data.blocks : EMPTY_ITEMS;
      const hasBlocks = blocks.length > 0;
      let imageCount = 0;
      if (hasBlocks) {
        for (const block of blocks) {
          if (block !== null && typeof block === 'object' && block.type === 'image') imageCount += 1;
        }
      }
      const summaryFallback = ready && data.contentKind === 'summary';
      const noticeText = paneNoticeText(paneNotice, t);
      const linkAvailable = link !== '';
      return h('aside', { className: 'dsh-feeds-pane', 'aria-label': t('pane.label'), 'aria-busy': loading }, [
        h('div', { key: 'head', className: 'dsh-feeds-paneHead' }, [
          h('button', {
            key: 'back',
            type: 'button',
            className: 'dsh-feeds-paneBack',
            'aria-label': t('pane.back'),
            title: t('pane.back'),
            onClick: onClose,
          }, [h(BackIcon, { key: 'icon' }), h('span', { key: 'label' }, t('pane.back'))]),
          h('div', { key: 'meta', className: 'dsh-feeds-paneMeta' }, metaParts.join(' · ')),
          h('button', {
            key: 'focus',
            type: 'button',
            className: 'dsh-feeds-paneFocus',
            'aria-pressed': focusMode === true,
            title: focusMode ? t('pane.unfocus') : t('pane.focus'),
            onClick: onToggleFocus,
          }, focusMode ? t('pane.unfocus') : t('pane.focus')),
          h('button', {
            key: 'close',
            type: 'button',
            className: 'dsh-feeds-paneClose',
            'aria-label': t('pane.close'),
            title: t('pane.close'),
            onClick: onClose,
          }, h(CloseIcon)),
        ]),
        h('div',{key:'navigation',className:'dsh-feeds-paneNavigation'},[
          h('button',{key:'prev',type:'button',className:'dsh-feeds-smallButton',onClick:onPrevious},t('pane.previous')),
          h('div',{key:'font-controls',className:'dsh-feeds-paneFontControls',role:'group','aria-label':t('reader.font')},[
            h('button',{key:'smaller',type:'button',className:'dsh-feeds-smallButton','aria-label':t('reader.fontDecrease'),title:t('reader.fontDecrease'),disabled:fontSize<=14,onClick:()=>onFontSize(fontSize-1)},'A−'),
            h('output',{key:'size',className:'dsh-feeds-fontValue','aria-live':'polite'},`${fontSize}px`),
            h('button',{key:'larger',type:'button',className:'dsh-feeds-smallButton','aria-label':t('reader.fontIncrease'),title:t('reader.fontIncrease'),disabled:fontSize>=28,onClick:()=>onFontSize(fontSize+1)},'A+'),
          ]),
          h('button',{key:'next',type:'button',className:'dsh-feeds-smallButton',onClick:onNext},t('pane.next')),
        ]),
        h('div', { key: 'scroll', className: 'dsh-feeds-paneScroll', ref:scrollRef, onScroll },
          h('div', { className: 'dsh-feeds-paneInner' }, [
            h('h2', { key: 'title', className: 'dsh-feeds-paneTitle' }, title),
            author === null || author === ''
              ? null
              : h('p', { key: 'byline', className: 'dsh-feeds-paneByline' }, t('pane.by', { author })),
            h('div',{key:'reading-meta',className:'dsh-feeds-paneByline'},ready ? t('pane.contentSource.'+data.contentSource) : ''),
            h('div', { key: 'actions', className: 'dsh-feeds-paneActions' }, [
              h('button',{key:'save',type:'button',className:'dsh-feeds-paneAction','aria-pressed':item.saved===true,onClick:onSave},t(item.saved?'saved.remove':'saved.label')),

              h('button', {
                key: 'open',
                type: 'button',
                className: 'dsh-feeds-paneAction',
                disabled: !linkAvailable,
                onClick: onOpenOriginal,
              }, [h(ExternalIcon, { key: 'icon' }), h('span', { key: 'label' }, t('pane.open'))]),
              h('button', {
                key: 'summarize',
                type: 'button',
                className: 'dsh-feeds-paneAction',
                onClick: onSummarize,
              }, [h(SparkIcon, { key: 'icon' }), h('span', { key: 'label' }, t('pane.summarize'))]),
              h('button', {
                key: 'read',
                type: 'button',
                className: 'dsh-feeds-paneAction',
                onClick: onToggleRead,
              }, item.unread ? t('pane.markRead') : t('pane.markUnread')),
              h('button', {
                key: 'copy',
                type: 'button',
                className: 'dsh-feeds-paneAction',
                disabled: !linkAvailable,
                onClick: onCopyLink,
              }, [h(CopyIcon, { key: 'icon' }), h('span', { key: 'label' }, t('pane.copyLink'))]),
            ]),
            ready && summaryFallback ? h('button',{key:'retry-extraction',type:'button',className:'dsh-feeds-smallButton',onClick:onRetry},t('pane.retryFull')) : null,
            noticeText === ''
              ? null
              : h('p', { key: 'notice', className: 'dsh-feeds-paneNotice', role: 'status' }, noticeText),
            loading
              ? h(PaneSkeleton, { key: 'loading', t })
              : failed
                ? h('div', { key: 'failed' }, [
                  h('p', { key: 'text', className: 'dsh-feeds-paneError' }, t('pane.failed')),
                  h('div', { key: 'actions', className: 'dsh-feeds-paneErrorActions' },
                    h('button', { type: 'button', className: 'dsh-feeds-smallButton', onClick: onRetry }, t('view.retry'))),
                ])
                : h('div', { key: 'body' }, [
                  ready && data.truncated ? h('p',{key:'truncated',className:'dsh-feeds-paneWarning'},t('pane.truncated')) : null,
                  summaryFallback
                    ? h('div', { key: 'warning', className: 'dsh-feeds-paneWarning' }, [
                      h('span', { key: 'icon', className: 'dsh-feeds-paneWarningIcon' }, h(WarningIcon)),
                      h('span', { key: 'text' },
                        data.contentError !== null
                          ? t('pane.fallbackError', { error: data.contentError })
                          : t('pane.fallback')),
                    ])
                    : null,
                  imageCount > 0
                    ? h('p', { key: 'image-count', className: 'dsh-feeds-paneNotice' }, t('pane.imageCount', { count: imageCount }))
                    : null,
                  hasBlocks
                    ? h('div', { key: 'blocks', className: 'dsh-feeds-paneBody' }, blocks.map((block, index) => h(ArticleBlock, {
                      key: index,
                      block,
                      t,
                    })))
                    : paragraphs.length === 0
                      ? h('p', { key: 'empty', className: 'dsh-feeds-paneNotice' }, t('pane.empty'))
                      : h('div', { key: 'paragraphs', className: 'dsh-feeds-paneBody' }, paragraphs.map((lines, index) => h('p', {
                        key: index,
                        className: 'dsh-feeds-paneParagraph',
                      }, paragraphChildren(lines)))),
                ]),
          ])),
      ]);
    }

    /** Inline add-subscription form. All state is owned by FeedsView. */
    function AddFeedForm({ form, categories, t, urlRef, onChange, onSubmit, onCancel }) {
      const names = [];
      const seen = new globalThis.Set();
      for (const name of (Array.isArray(categories) ? categories : [])) {
        if (typeof name === 'string' && name !== '' && name !== HOST_UNCATEGORIZED && !seen.has(name)) {
          seen.add(name);
          names.push(name);
        }
      }
      if (form.category !== NEW_CATEGORY_VALUE && form.category !== '' && form.category !== HOST_UNCATEGORIZED && !seen.has(form.category)) {
        names.unshift(form.category);
      }
      const creating = form.category === NEW_CATEGORY_VALUE;
      return h('form', {
        className: 'dsh-feeds-formCard',
        onSubmit: event => {
          event?.preventDefault?.();
          onSubmit();
        },
        onKeyDown: event => {
          const tag = typeof event?.target?.tagName === 'string' ? event.target.tagName.toUpperCase() : '';
          if (event?.key === 'Escape') {
            event.preventDefault?.();
            onCancel();
          } else if (event?.key === 'Enter' && tag !== 'BUTTON' && tag !== 'SELECT' && tag !== 'TEXTAREA') {
            event.preventDefault?.();
            onSubmit();
          }
        },
      }, [
        h('h2', { key: 'title', className: 'dsh-feeds-formTitle' }, t('sources.addFeedTitle')),
        h('div', { key: 'grid', className: 'dsh-feeds-formGrid' }, [
          h('label', { key: 'url', className: 'dsh-feeds-field' }, [
            t('sources.feedUrl'),
            h('input', {
              key: 'input',
              ref: urlRef,
              type: 'url',
              className: 'dsh-feeds-textInput',
              value: form.url,
              placeholder: t('sources.feedUrlPlaceholder'),
              'aria-label': t('sources.feedUrl'),
              disabled: form.busy,
              onChange: event => onChange({ url: event.currentTarget.value }),
            }),
          ]),
          h('label', { key: 'title', className: 'dsh-feeds-field' }, [
            t('sources.feedTitle'),
            h('input', {
              key: 'input',
              type: 'text',
              className: 'dsh-feeds-textInput',
              value: form.title,
              placeholder: t('sources.feedTitlePlaceholder'),
              'aria-label': t('sources.feedTitle'),
              disabled: form.busy,
              onChange: event => onChange({ title: event.currentTarget.value }),
            }),
          ]),
          h('label', { key: 'category', className: 'dsh-feeds-field' }, [
            t('sources.category'),
            h('select', {
              key: 'select',
              className: 'dsh-feeds-select',
              value: creating ? NEW_CATEGORY_VALUE : (form.category || ''),
              'aria-label': t('sources.category'),
              disabled: form.busy,
              onChange: event => onChange({ category: event.currentTarget.value }),
            }, [
              h('option', { key: 'uncategorized', value: '' }, t('sources.uncategorized')),
              ...names.map(name => h('option', { key: name, value: name }, categoryLabel(name, t))),
              h('option', { key: 'new', value: NEW_CATEGORY_VALUE }, t('sources.newCategoryOption')),
            ]),
          ]),
        ]),
        creating ? h('label', { key: 'new-category', className: 'dsh-feeds-field' }, [
          t('sources.newCategoryNameLabel'),
          h('input', {
            key: 'input',
            type: 'text',
            className: 'dsh-feeds-textInput',
            value: form.newCategory,
            placeholder: t('sources.categoryNamePlaceholder'),
            'aria-label': t('sources.newCategoryNameLabel'),
            disabled: form.busy,
            onChange: event => onChange({ newCategory: event.currentTarget.value }),
          }),
        ]) : null,
        form.error ? h('p', { key: 'error', className: 'dsh-feeds-formNotice isError', role: 'alert' }, form.error) : null,
        form.result ? h('p', { key: 'result', className: 'dsh-feeds-formNotice isSuccess', role: 'status' }, form.result) : null,
        h('div', { key: 'actions', className: 'dsh-feeds-formActions' }, [
          h('button', {
            key: 'submit',
            type: 'button',
            className: 'dsh-feeds-smallButton isPrimary',
            disabled: form.busy,
            onClick: onSubmit,
          }, form.busy ? t('sources.busy') : t('sources.addSubmit')),
          h('button', {
            key: 'cancel',
            type: 'button',
            className: 'dsh-feeds-smallButton',
            disabled: form.busy,
            onClick: onCancel,
          }, t('sources.cancel')),
        ]),
      ]);
    }

    /** Inline toolbar form for creating one category. */
    function NewCategoryForm({ form, t, inputRef, onChange, onSubmit, onCancel }) {
      return h('div', { className: 'dsh-feeds-formCard' }, [
        h('div', { key: 'row', className: 'dsh-feeds-inlineForm' }, [
          h('input', {
            key: 'input',
            ref: inputRef,
            type: 'text',
            className: 'dsh-feeds-textInput',
            value: form.name,
            placeholder: t('sources.categoryNamePlaceholder'),
            'aria-label': t('sources.categoryName'),
            disabled: form.busy,
            onChange: event => onChange(event.currentTarget.value),
            onKeyDown: event => {
              if (event?.key === 'Enter') {
                event.preventDefault?.();
                onSubmit();
              } else if (event?.key === 'Escape') {
                event.preventDefault?.();
                onCancel();
              }
            },
          }),
          h('button', {
            key: 'create',
            type: 'button',
            className: 'dsh-feeds-smallButton isPrimary',
            disabled: form.busy,
            onClick: onSubmit,
          }, form.busy ? t('sources.busy') : t('sources.createCategory')),
          h('button', {
            key: 'cancel',
            type: 'button',
            className: 'dsh-feeds-smallButton',
            disabled: form.busy,
            onClick: onCancel,
          }, t('sources.cancel')),
        ]),
        form.error ? h('p', { key: 'error', className: 'dsh-feeds-formNotice isError', role: 'alert' }, form.error) : null,
      ]);
    }

    /** OPML import panel: path + replace/merge mode + guidance and copy helper. */
    function ImportPanel({ snapshot, form, t, pathRef, onChange, onSubmit, onCancel, importNotice, onCopy, commandRef }) {
      const pathText = snapshot !== null && snapshot.opml.path !== null
        ? t('import.path', { path: snapshot.opml.path })
        : t('import.noOpml');
      const copyMessage = importNotice === 'copied'
        ? t('import.copied')
        : importNotice === 'selected'
          ? t('import.selected')
          : importNotice === 'failed'
            ? t('import.copyFailed')
            : '';
      return h('section', { className: 'dsh-feeds-importCard' }, [
        h('h2', { key: 'title', className: 'dsh-feeds-importTitle' }, t('import.title')),
        h('p', { key: 'path', className: 'dsh-feeds-importPath' }, pathText),
        h('div', { key: 'grid', className: 'dsh-feeds-formGrid' }, [
          h('label', { key: 'file', className: 'dsh-feeds-field' }, [
            t('import.pathLabel'),
            h('input', {
              key: 'input',
              ref: pathRef,
              type: 'text',
              className: 'dsh-feeds-textInput',
              value: form.path,
              placeholder: t('import.pathPlaceholder'),
              'aria-label': t('import.pathLabel'),
              disabled: form.busy,
              onChange: event => onChange({ path: event.currentTarget.value }),
              onKeyDown: event => {
                if (event?.key === 'Enter') {
                  event.preventDefault?.();
                  onSubmit();
                } else if (event?.key === 'Escape') {
                  event.preventDefault?.();
                  onCancel();
                }
              },
            }),
          ]),
          h('div', { key: 'mode', className: 'dsh-feeds-field' }, [
            t('import.mode'),
            h('div', { className: 'dsh-feeds-radioRow' }, ['merge', 'replace'].map(mode => h('label', {
              key: mode,
              className: 'dsh-feeds-radioLabel',
            }, [
              h('input', {
                key: 'radio',
                type: 'radio',
                name: 'feeds-import-mode',
                value: mode,
                checked: form.mode === mode,
                disabled: form.busy,
                onChange: () => onChange({ mode }),
              }),
              t('import.' + mode),
            ]))),
          ]),
        ]),
        h('p', { key: 'path-hint', className: 'dsh-feeds-importHint' }, t('import.pathHint')),
        form.mode === 'replace' ? h('div', { key: 'replace-warning', className: 'dsh-feeds-importWarning' }, [
          h('p', { key: 'text', className: 'dsh-feeds-formNotice isError', role: 'alert' },
            t('import.replaceWarning', { count: snapshot?.stats?.feeds ?? 0 })),
          h('label', { key: 'confirm', className: 'dsh-feeds-radioLabel' }, [
            h('input', {
              key: 'checkbox',
              type: 'checkbox',
              checked: form.replaceConfirmed === true,
              disabled: form.busy,
              onChange: event => onChange({ replaceConfirmed: event.currentTarget.checked }),
            }),
            t('import.replaceConfirm'),
          ]),
        ]) : null,
        h('p', { key: 'hint', className: 'dsh-feeds-importHint' }, t('import.hint')),
        h('code', { key: 'command', ref: commandRef, className: 'dsh-feeds-importCommand' }, t('import.command')),
        h('div', { key: 'footer', className: 'dsh-feeds-importFooter' }, [
          h('button', {
            key: 'run',
            type: 'button',
            className: `dsh-feeds-smallButton ${form.mode === 'replace' ? 'isDanger' : 'isPrimary'}`,
            disabled: form.busy || (form.mode === 'replace' && form.replaceConfirmed !== true),
            onClick: onSubmit,
          }, form.busy ? t('import.importing') : t('import.run')),
          h('button', {
            key: 'copy',
            type: 'button',
            className: 'dsh-feeds-smallButton',
            disabled: form.busy,
            onClick: onCopy,
          }, t('import.copy')),
          copyMessage === '' ? null : h('span', { key: 'copyNotice', className: 'dsh-feeds-importNotice', role: 'status' }, copyMessage),
        ]),
        form.error ? h('p', { key: 'error', className: 'dsh-feeds-formNotice isError', role: 'alert' }, form.error) : null,
        form.result ? h('p', { key: 'result', className: 'dsh-feeds-formNotice isSuccess', role: 'status' }, form.result) : null,
        form.result ? h('p', { key: 'started', className: 'dsh-feeds-importNotice' }, t('import.started')) : null,
      ]);
    }

    /** One subscription row in the Sources mode, with move/new-category controls. */
    function SourceRow({ feed, busy, removing, t, categories, newCategory, newCategoryRef, onOnly, onRefresh, onRemove, onMoveFeed, onStartNewCategory, onNewCategoryChange, onNewCategorySave, onNewCategoryCancel }) {
      const displayTitle = feed.title !== '' ? feed.title : feed.url;
      const counts = t('sources.counts', { unread: feed.unread, total: feed.itemCount });
      const names = [];
      for (const name of [...(Array.isArray(categories) ? categories : []), feed.category, HOST_UNCATEGORIZED]) {
        if (typeof name === 'string' && name !== '' && !names.includes(name)) names.push(name);
      }
      const creating = newCategory !== null && newCategory.feedId === feed.id;
      return h('li', { className: 'dsh-feeds-sourceRow' }, [
        h('div', { key: 'main', className: 'dsh-feeds-sourceMain' }, [
          h('div', { key: 'titleRow', className: 'dsh-feeds-sourceTitleRow' }, [
            h('span', { key: 'title', className: 'dsh-feeds-sourceTitle', title: displayTitle }, [
              h(SourceIcon, { key: 'icon', source: feed.site || feed.url, title: displayTitle }),
              h('span', { key: 'name' }, displayTitle),
            ]),
            feed.error === null
              ? null
              : h('span', { key: 'badge', className: 'dsh-feeds-sourceBadge', title: feed.error }, t('sources.errorBadge')),
            busy ? h('span', { key: 'spinner', className: 'dsh-feeds-spinner', 'aria-hidden': 'true' }) : null,
          ]),
          h('div', { key: 'url', className: 'dsh-feeds-sourceUrl', title: feed.url }, feed.url),
          h('div', {
            key: 'meta',
            className: 'dsh-feeds-sourceMeta',
            'aria-label': t('sources.countsAria', { unread: feed.unread, total: feed.itemCount }),
          }, counts),
          h('div', { key: 'freshness', className: 'dsh-feeds-sourceMeta' }, t('sources.lastSuccess', { time: feed.lastFetched ? relativeTimeOf(feed.lastFetched, Date.now(), t) : t('stats.lastRefreshNever') })),
          creating ? h('div', { key: 'new-category', className: 'dsh-feeds-inlineForm' }, [
            h('input', {
              key: 'input',
              ref: newCategoryRef,
              type: 'text',
              className: 'dsh-feeds-textInput',
              value: newCategory.value,
              placeholder: t('sources.categoryNamePlaceholder'),
              'aria-label': t('sources.newCategoryNameLabel'),
              disabled: newCategory.busy,
              onChange: event => onNewCategoryChange(event.currentTarget.value),
              onKeyDown: event => {
                if (event?.key === 'Enter') {
                  event.preventDefault?.();
                  onNewCategorySave(feed);
                } else if (event?.key === 'Escape') {
                  event.preventDefault?.();
                  onNewCategoryCancel();
                }
              },
            }),
            h('button', {
              key: 'save',
              type: 'button',
              className: 'dsh-feeds-smallButton isPrimary',
              disabled: newCategory.busy,
              onClick: () => onNewCategorySave(feed),
            }, newCategory.busy ? t('sources.busy') : t('sources.save')),
            h('button', {
              key: 'cancel',
              type: 'button',
              className: 'dsh-feeds-smallButton',
              disabled: newCategory.busy,
              onClick: onNewCategoryCancel,
            }, t('sources.cancel')),
          ]) : null,
          creating && newCategory.error ? h('p', { key: 'new-category-error', className: 'dsh-feeds-formNotice isError', role: 'alert' }, newCategory.error) : null,
        ]),
        h('div', { key: 'actions', className: 'dsh-feeds-sourceActions' }, [
          h('button', { key: 'only', type: 'button', className: 'dsh-feeds-sourceAction', 'aria-label': `${t('sources.only')} ${displayTitle}`, onClick: onOnly }, t('sources.only')),
          h('button', {
            key: 'refresh',
            type: 'button',
            className: 'dsh-feeds-sourceAction',
            'aria-label': `${t('sources.refresh')} ${displayTitle}`,
            disabled: busy,
            onClick: onRefresh,
          }, busy ? t('view.refreshing') : t('sources.refresh')),
          h('button', {
            key: 'remove',
            type: 'button',
            className: 'dsh-feeds-sourceAction dsh-feeds-sourceActionDanger',
            'aria-label': `${t('sources.remove')} ${displayTitle}`,
            disabled: removing,
            onClick: onRemove,
          }, t('sources.remove')),
          h('select', {
            key: 'category',
            className: 'dsh-feeds-select dsh-feeds-sourceCategory',
            value: feed.category,
            'aria-label': `${t('sources.category')} — ${displayTitle}`,
            disabled: busy || removing,
            onChange: event => {
              const value = event.currentTarget.value;
              if (value === NEW_CATEGORY_VALUE) onStartNewCategory(feed);
              else onMoveFeed(feed, value);
            },
          }, [
            ...names.map(name => h('option', { key: name, value: name }, categoryLabel(name, t))),
            h('option', { key: 'new', value: NEW_CATEGORY_VALUE }, t('sources.newCategoryOption')),
          ]),
        ]),
      ]);
    }

    /** One category group with inline rename/delete management. */
    function CategoryGroup({ group, categories, t, action, actionOpen, renameRef, busyIds, removingId, sourceNew, sourceNewRef, onOnly, onRefresh, onRemove, onStartRename, onStartDelete, onCategoryActionChange, onCategoryRename, onCategoryDelete, onCancelAction, onMoveFeed, onStartNewCategory, onNewCategoryChange, onNewCategorySave, onNewCategoryCancel }) {
      const renaming = action !== null && action.mode === 'rename';
      const deleting = action !== null && action.mode === 'delete';
      const targets = [];
      if (HOST_UNCATEGORIZED !== group.name) targets.push(HOST_UNCATEGORIZED);
      for (const name of (Array.isArray(categories) ? categories : [])) {
        if (name !== group.name && !targets.includes(name)) targets.push(name);
      }
      const noValidTarget = deleting && group.feeds.length > 0 && targets.length === 0;
      const targetValue = action !== null && typeof action.target === 'string' && action.target !== '' && targets.includes(action.target)
        ? action.target
        : targets[0];
      return h('section', { className: 'dsh-feeds-sourceGroup' }, [
        h('div', { key: 'head', className: 'dsh-feeds-sourceGroupHead' }, [
          renaming
            ? h('input', {
              key: 'rename',
              ref: renameRef,
              type: 'text',
              className: 'dsh-feeds-textInput dsh-feeds-sourceGroupRename',
              value: action.value,
              'aria-label': t('sources.renameCategory'),
              disabled: action.busy,
              onChange: event => onCategoryActionChange({ value: event.currentTarget.value }),
              onKeyDown: event => {
                if (event?.key === 'Enter') {
                  event.preventDefault?.();
                  onCategoryRename();
                } else if (event?.key === 'Escape') {
                  event.preventDefault?.();
                  onCancelAction();
                }
              },
            })
            : h('span', { key: 'name', className: 'dsh-feeds-sourceGroupName' }, categoryLabel(group.name, t)),
          h('span', { key: 'count', className: 'dsh-feeds-sourceGroupCount' }, (group.feeds.length === 1 ? t('sources.categoryCountOne', { count: 1 }) : t('sources.categoryCount', { count: group.feeds.length }))),
          renaming
            ? h('span', { key: 'rename-actions', className: 'dsh-feeds-categoryHeadActions' }, [
              h('button', {
                key: 'save',
                type: 'button',
                className: 'dsh-feeds-smallButton isPrimary',
                disabled: action.busy,
                onClick: onCategoryRename,
              }, action.busy ? t('sources.busy') : t('sources.save')),
              h('button', {
                key: 'cancel',
                type: 'button',
                className: 'dsh-feeds-smallButton',
                disabled: action.busy,
                onClick: onCancelAction,
              }, t('sources.cancel')),
            ])
            : deleting ? null : h('span', { key: 'actions', className: 'dsh-feeds-categoryHeadActions' }, [
              h('button', {
                key: 'rename',
                type: 'button',
                className: 'dsh-feeds-smallButton',
                'aria-label': `${t('sources.renameCategory')} ${categoryLabel(group.name, t)}`,
                disabled: action !== null || actionOpen === true,
                onClick: () => onStartRename(group.name),
              }, t('sources.rename')),
              h('button', {
                key: 'delete',
                type: 'button',
                className: 'dsh-feeds-smallButton',
                'aria-label': `${t('sources.deleteCategory')} ${categoryLabel(group.name, t)}`,
                disabled: action !== null || actionOpen === true,
                onClick: () => onStartDelete(group.name),
              }, t('sources.deleteCategory')),
            ]),
        ]),
        renaming && action.error
          ? h('p', { key: 'rename-error', className: 'dsh-feeds-formNotice isError', role: 'alert' }, action.error)
          : null,
        deleting ? h('div', {
          key: 'delete',
          className: 'dsh-feeds-categoryFormRow',
          onKeyDown: event => {
            if (event?.key === 'Escape') {
              event.preventDefault?.();
              onCancelAction();
            }
          },
        }, [
          group.feeds.length === 0
            ? h('span', { key: 'prompt' }, t('sources.deleteEmpty', { name: categoryLabel(group.name, t) }))
            : noValidTarget
              ? h('span', { key: 'prompt' }, t('sources.deleteNeedsTarget'))
              : h('span', { key: 'prompt' }, [
              t('sources.deleteWithFeeds', { name: categoryLabel(group.name, t) }),
              h('select', {
                key: 'target',
                className: 'dsh-feeds-select',
                value: targetValue,
                'aria-label': t('sources.moveTo'),
                disabled: action.busy,
                onChange: event => onCategoryActionChange({ target: event.currentTarget.value }),
              }, targets.map(name => h('option', { key: name, value: name }, categoryLabel(name, t)))),
            ]),
          h('button', {
            key: 'confirm',
            type: 'button',
            className: 'dsh-feeds-smallButton dsh-feeds-sourceActionDanger',
            disabled: action.busy || noValidTarget,
            autoFocus: true,
            onClick: onCategoryDelete,
          }, action.busy ? t('sources.busy') : t('sources.confirmDelete')),
          h('button', {
            key: 'cancel',
            type: 'button',
            className: 'dsh-feeds-smallButton',
            disabled: action.busy,
            onClick: onCancelAction,
          }, t('sources.cancel')),
          action.error ? h('span', { key: 'error', className: 'dsh-feeds-formNotice isError', role: 'alert' }, action.error) : null,
        ]) : null,
        group.feeds.length === 0
          ? h('div', { key: 'empty', className: 'dsh-feeds-sourceEmpty' }, t('sources.categoryEmpty'))
          : h('ul', { key: 'list', className: 'dsh-feeds-sourceList' }, group.feeds.map(feed => h(SourceRow, {
            key: feed.id !== '' ? feed.id : feed.url,
            feed,
            busy: busyIds.has(feed.id),
            removing: removingId === feed.id,
            t,
            categories,
            newCategory: sourceNew !== null && sourceNew.feedId === feed.id ? sourceNew : null,
            newCategoryRef: sourceNewRef,
            onOnly: () => onOnly(feed),
            onRefresh: () => onRefresh(feed),
            onRemove: () => onRemove(feed),
            onMoveFeed,
            onStartNewCategory,
            onNewCategoryChange,
            onNewCategorySave,
            onNewCategoryCancel,
          }))),
      ]);
    }

    /** Undo bar for one bulk mark-all action. */
    function MarkAllNotice({ count, t, onUndo }) {
      return h('div', { className: 'dsh-feeds-noticeBar', role: 'status' }, [
        h('span', { key: 'text', className: 'dsh-feeds-noticeBarText' }, t('notice.markedAll', { count })),
        h('button', { key: 'undo', type: 'button', className: 'dsh-feeds-noticeAction', onClick: onUndo }, t('notice.undo')),
      ]);
    }
    //#endregion

    //#region view
    /** Remove one feed (and its items) from a snapshot locally, before a re-fetch lands. */
    function removeFeedFromSnapshot(snapshot, feedId) {
      if (snapshot === null) return snapshot;
      let removed = false;
      const categories = [];
      for (const category of snapshot.categories) {
        const feeds = category.feeds.filter((feed) => feed.id !== feedId);
        if (feeds.length === category.feeds.length) {
          categories.push(category);
          continue;
        }
        removed = true;
        let unreadLost = 0;
        for (const feed of category.feeds) {
          if (feed.id === feedId) unreadLost += feed.unread;
        }
        if (feeds.length > 0) {
          categories.push({ ...category, feeds, unread: Math.max(0, category.unread - unreadLost) });
        }
      }
      if (!removed) return snapshot;
      let itemsLost = 0;
      let unreadLost = 0;
      const items = [];
      for (const item of snapshot.items) {
        if (item.feedId === feedId) {
          itemsLost += 1;
          if (item.unread) unreadLost += 1;
          continue;
        }
        items.push(item);
      }
      return {
        ...snapshot,
        categories,
        items,
        stats: {
          ...snapshot.stats,
          feeds: Math.max(0, snapshot.stats.feeds - 1),
          items: Math.max(0, snapshot.stats.items - itemsLost),
          unread: Math.max(0, snapshot.stats.unread - unreadLost),
        },
      };
    }

    /** Localized copy for one sources-panel notice. */
    function sourcesNoticeText(notice, t) {
      if (notice === null || typeof notice !== 'object') return '';
      if (notice.kind === 'removed') return t('sources.removed', { title: notice.title });
      if (notice.kind === 'removeFailed') return t('sources.removeFailed');
      if (notice.kind === 'refreshFailed') return t('sources.refreshFailed', { title: notice.title });
      return '';
    }

    /**
     * The `feeds` Conversation View: a split reader with the item list on the
     * left and an in-page reading pane on the right, plus a Sources management
     * mode. All state that comes from the Host is normalized before rendering.
     *
     * @param props - this plugin's locale seat (`t`), the standard composer
     *   `inputActions` seat, and the injected Host operations from `apply`.
     * @returns the feeds page.
     */
    function FeedsView(props) {
      const t = typeof props.t === 'function' ? props.t : key => key;
      const helpers = React.useRef(props);
      helpers.current = props;
      const prefs = React.useMemo(() => readStoredPrefs() || {}, []);
      const [snapshot, setSnapshot] = React.useState(null);
      const [status, setStatus] = React.useState('loading');
      const [boot, setBoot] = React.useState(0);
      const [category, setCategory] = React.useState(prefs.category || ALL_CATEGORIES);
      const [feedId, setFeedId] = React.useState(prefs.feedId || null);
      const [mode, setMode] = React.useState(prefs.mode || MODE_FEED);
      const [search, setSearch] = React.useState('');
      const [query, setQuery] = React.useState('');
      const [unreadOnly, setUnreadOnly] = React.useState(prefs.unreadOnly === true);
      const [savedOnly, setSavedOnly] = React.useState(prefs.savedOnly === true);
      const [density, setDensity] = React.useState(prefs.density === 'compact' ? 'compact' : 'summary');
      const [fontSize, setFontSize] = React.useState(prefs.fontSize || 17);
      const [groupBySource,setGroupBySource] = React.useState(prefs.groupBySource !== false);
      const [expandedGroups,setExpandedGroups] = React.useState({});
      const [readMode, setReadMode] = React.useState(prefs.readMode || 'delay');
      const [selected, setSelected] = React.useState(prefs.selectedItem || null);
      const [article, setArticle] = React.useState({itemId:null,status:'idle',data:null});
      const [articleRetry, setArticleRetry] = React.useState({id:null,n:0});
      const [focusMode, setFocusMode] = React.useState(false);
      const [loading, setLoading] = React.useState(false);
      const [loadingMore, setLoadingMore] = React.useState(false);
      const [page, setPage] = React.useState({total:null,nextCursor:null});
      const [epoch, setEpoch] = React.useState(0);
      const [manualRefresh, setManualRefresh] = React.useState(false);
      const [notice, setNotice] = React.useState('');
      const [listError, setListError] = React.useState(false);
      const [paneNotice, setPaneNotice] = React.useState(null);
      const [markAll, setMarkAll] = React.useState(null);
      const [helpOpen, setHelpOpen] = React.useState(false);
      const [failedOnly, setFailedOnly] = React.useState(false);
      const [busyFeeds, setBusyFeeds] = React.useState(() => new Set());
      const [removingId, setRemovingId] = React.useState(null);
      const [importNotice, setImportNotice] = React.useState(null);
      const [addForm, setAddForm] = React.useState({open:false,url:'',title:'',category:'',newCategory:'',busy:false,error:'',result:''});
      const [importForm, setImportForm] = React.useState({open:false,path:'',mode:'merge',replaceConfirmed:false,busy:false,error:'',result:''});
      const [newCategoryForm, setNewCategoryForm] = React.useState({open:false,name:'',busy:false,error:''});
      const [categoryAction, setCategoryAction] = React.useState(null);
      const [sourceNewCategory, setSourceNewCategory] = React.useState(null);
      const [managementNotice, setManagementNotice] = React.useState(null);
      const [persistTick, setPersistTick] = React.useState(0);
      const [clock, setClock] = React.useState(Date.now());
      const [visible, setVisible] = React.useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
      const alive = React.useRef(true);
      const querySeq = React.useRef(0);
      const queryController = React.useRef(null);
      const operations = React.useRef(new Map());
      const metaVersion = React.useRef(0);
      const pendingMutations = React.useRef(0);
      const metaRevision = React.useRef(null);
      const controllers = React.useRef(new Set());
      const cache = React.useRef(new Map());
      const rows = React.useRef(new Map());
      const latestSelectedItem = React.useRef(null);
      const latestVisible = React.useRef(true);
      const autoReadSuppressed = React.useRef(new globalThis.Set());
      const pendingOverlay = React.useRef(new Map());
      const scrollRef = React.useRef(null);
      const readerRef = React.useRef(null);
      const searchRef = React.useRef(null);
      const commandRef = React.useRef(null);
      const addUrlRef = React.useRef(null);
      const importPathRef = React.useRef(null);
      const newCategoryRef = React.useRef(null);
      const categoryRenameRef = React.useRef(null);
      const sourceNewRef = React.useRef(null);
      const positions = React.useRef(prefs.positions || {});
      const listPosition = React.useRef(prefs.listPosition || 0);
      const prefState = React.useRef(null);
      const initialListRestore = React.useRef(true);
      const revealSelection = React.useRef(null);
      const listAnchor = React.useRef(null);
      const shortcuts = React.useRef(null);
      const allFeeds = snapshot ? snapshot.categories.flatMap(entry => entry.feeds) : [];
      const selectedFeed = allFeeds.find(feed=>feed.id===feedId) || null;
      const items = snapshot ? snapshot.items : EMPTY_ITEMS;
      const selectedItem = selected ? items.find(item => item.id === selected.id) || selected : null;
      const refreshing = manualRefresh || snapshot?.refreshing === true;
      latestSelectedItem.current = selectedItem;
      latestVisible.current = visible;
      const filterKey = JSON.stringify([category,feedId,query,unreadOnly,savedOnly]);
      const activeFilter = React.useRef(filterKey);
      activeFilter.current = filterKey;
      const readPrefs = () => ({category,feedId,mode,unreadOnly,savedOnly,density,fontSize,readMode,groupBySource,
        selectedItem:selectedItem ? {...selectedItem,summary:''} : null,
        positions:positions.current,listPosition:listPosition.current});
      prefState.current = readPrefs;
      const persist = () => { if (prefState.current) persistPrefs(prefState.current()); };
      const rememberScroll = () => {
        if (selectedItem && readerRef.current) positions.current[selectedItem.id] = readerRef.current.scrollTop;
        if (scrollRef.current) listPosition.current = scrollRef.current.scrollTop;
        const keys = Object.keys(positions.current);
        if (keys.length > 50) delete positions.current[keys[0]];
        setPersistTick(value => value + 1);
      };
      const closePane = () => {rememberScroll();setSelected(null);setFocusMode(false);setPaneNotice(null);};
      /** Apply in-flight optimistic read/saved decisions over freshly loaded rows. */
      const applyPendingOverlay = list => {
        const pending=pendingOverlay.current;
        if(!pending.size)return list;
        const cutoff=Date.now()-30000;
        for(const [id,entry] of pending)if(entry.at<cutoff)pending.delete(id);
        if(!pending.size)return list;
        return list.map(item=>{const entry=pending.get(item.id);return entry?{...item,...(entry.unread!==undefined?{unread:entry.unread}:{}),...(entry.saved!==undefined?{saved:entry.saved}:{})}:item;});
      };
      const selectItem = (item, options = {}) => {
        if (scrollRef.current) {
          const node = rows.current.get(item.id);
          if (node) {
            const listRect = scrollRef.current.getBoundingClientRect();
            const rowRect = node.getBoundingClientRect();
            listAnchor.current = { id: item.id, offset: rowRect.top - listRect.top };
          }
        }
        if (options.reveal === true) revealSelection.current = item.id;
        rememberScroll();
        if(groupBySource) {
          const day=dayGroupOf(itemTimeOf(item)||0,clock);
          const peers=items.filter(row=>row.feedId===item.feedId&&dayGroupOf(itemTimeOf(row)||0,clock)===day);
          if(peers.findIndex(row=>row.id===item.id)>=3)setExpandedGroups(current=>({...current,[day+':'+item.feedId]:true}));
        }
        setSelected(item);setPaneNotice(null);
      };
      const onlySource = feed => {
        closePane();setSearch('');setQuery('');setCategory(feed.category || ALL_CATEGORIES);
        setFeedId(feed.feedId || feed.id);setUnreadOnly(false);setSavedOnly(false);setMode(MODE_FEED);
      };
      const resetFilters = (keepSource=false) => {
        closePane();setSearch('');setQuery('');setUnreadOnly(false);setSavedOnly(false);
        setCategory(keepSource&&selectedFeed ? selectedFeed.category : ALL_CATEGORIES);
        if(!keepSource || !selectedFeed)setFeedId(null);
      };
      const controller = () => {const c = new AbortController();controllers.current.add(c);return c;};
      const commitMeta = next => {
        // Only structural changes (refresh completion / source set) reset pagination
        // and scroll; unread/saved counter changes must not discard loaded pages.
        const revision=JSON.stringify([next.lastRefreshAt,next.categories.flatMap(group=>group.feeds.map(feed=>[feed.id,feed.lastFetched,feed.error]))]);
        if(metaRevision.current !== null && revision !== metaRevision.current)setEpoch(value=>value+1);
        metaRevision.current=revision;
        setSnapshot(current=>({...next,items:current?.items || []}));
      };
      const beginMutation=()=>{metaVersion.current++;pendingMutations.current++;};
      const endMutation=()=>{metaVersion.current++;pendingMutations.current--;};
      const fetchMeta = async signal => {
        const version=metaVersion.current;
        const result = await helpers.current.loadSnapshot?.(signal);
        if (version !== metaVersion.current || pendingMutations.current) throw new Error('stale metadata');
        if (!result?.ok) throw new Error('snapshot unavailable');
        const next = normalizeSnapshot(result.value);
        if (!next) throw new Error('invalid snapshot');
        return next;
      };
      const markItem = async (item, unread, options = {}) => {
        if (!item || item.unread === unread) return;
        if (options.auto !== true) autoReadSuppressed.current.add(item.id);
        const token = (operations.current.get(item.id) || 0) + 1;
        operations.current.set(item.id,token);
        pendingOverlay.current.set(item.id,{...(pendingOverlay.current.get(item.id)||{}),unread,at:Date.now()});
        beginMutation();
        setSnapshot(current => applyUnread(current,[item.id],unread));
        setSelected(current => current?.id === item.id ? {...current,unread} : current);
        let ok = false;
        try {ok = (await helpers.current.markItems?.([item.id],unread))?.ok === true;} catch {} finally {endMutation();}
        if (!alive.current || operations.current.get(item.id) !== token) return;
        if (!ok) {
          const previous=pendingOverlay.current.get(item.id);
          if(previous!==undefined){if(previous.saved!==undefined)pendingOverlay.current.set(item.id,{saved:previous.saved,at:Date.now()});else pendingOverlay.current.delete(item.id);}
          setSnapshot(current => applyUnread(current,[item.id],item.unread));
          setSelected(current => current?.id === item.id ? {...current,unread:item.unread} : current);
          setNotice(t('view.markFailed'));
          return;
        }
        pendingOverlay.current.set(item.id,{...(pendingOverlay.current.get(item.id)||{}),unread,at:Date.now()});
        // Auto-read should not refetch and jump the unread queue under the reader;
        // keep the row visible until the next explicit reload or filter change.
        if(unreadOnly&&unread===false&&options.auto!==true)setEpoch(value=>value+1);
      };
      const saveItem = async item => {
        if (!item) return;
        const saved = !item.saved;
        const token = (operations.current.get(`save:${item.id}`) || 0) + 1;
        operations.current.set(`save:${item.id}`,token);
        pendingOverlay.current.set(item.id,{...(pendingOverlay.current.get(item.id)||{}),saved,at:Date.now()});
        const change = value => {
          setSnapshot(current => {
            if (!current) return current;
            const previous = current.items.find(row => row.id === item.id)?.saved ?? item.saved === true;
            return {...current,items:current.items.map(row => row.id === item.id ? {...row,saved:value} : row),stats:{...current.stats,saved:Math.max(0,(current.stats.saved || 0) + (previous === value ? 0 : value ? 1 : -1))}};
          });
          setSelected(current => current?.id === item.id ? {...current,saved:value} : current);
        };
        beginMutation();change(saved);
        let ok = false;
        try {ok = (await helpers.current.saveItems?.([item.id],saved))?.ok === true;} catch {} finally {endMutation();}
        if (!alive.current || operations.current.get(`save:${item.id}`) !== token) return;
        if (!ok) {
          const previous=pendingOverlay.current.get(item.id);
          if(previous!==undefined){if(previous.unread!==undefined)pendingOverlay.current.set(item.id,{unread:previous.unread,at:Date.now()});else pendingOverlay.current.delete(item.id);}
          change(!saved);setNotice(t('saved.failed'));
          return;
        }
        pendingOverlay.current.set(item.id,{...(pendingOverlay.current.get(item.id)||{}),saved,at:Date.now()});
        if(savedOnly&&saved===false)setEpoch(value=>value+1);
      };
      const summarize = async item => {
        if (!item) return;
        const prompt = t('pane.dshPrompt',{title:item.title,link:item.link,itemId:item.id});
        try {
          const actions = helpers.current.inputActions;
          if (typeof actions?.insertText === 'function' && actions.insertText(prompt,actions.captureInsertion?.()) !== false) {
            setPaneNotice('questionInserted');return;
          }
        } catch {}
        const result = await copyText(prompt);
        if (alive.current) setPaneNotice(result === 'copied' ? 'questionCopied' : 'copyFailed');
      };
      const loadPage = async (append = false, signal, key = activeFilter.current) => {
        if (!helpers.current.loadItems) {setListError(true);setLoading(false);return;}
        const seq = ++querySeq.current;
        if (queryController.current) queryController.current.abort();
        const c = controller();queryController.current = c;
        if (signal) signal.addEventListener('abort',() => c.abort(),{once:true});
        append ? setLoadingMore(true) : setLoading(true);
        setListError(false);
        try {
          const result = await helpers.current.loadItems({
            ...(category !== ALL_CATEGORIES ? {category} : {}),...(feedId ? {feedId} : {}),
            query,unreadOnly,savedOnly,limit:80,...(append && page.nextCursor ? {cursor:page.nextCursor} : {}),
          },c.signal);
          if (!alive.current || c.signal.aborted || seq !== querySeq.current || key !== activeFilter.current) return;
          if (!result?.ok || !Array.isArray(result.value?.items)) throw new Error('items unavailable');
          const normalized = applyPendingOverlay(normalizeSnapshot({items:result.value.items},{requireMeta:false}).items);
          setSnapshot(current => {
            if (!current) return current;
            const merged = append ? [...current.items,...normalized] : normalized;
            return {...current,items:[...new Map(merged.map(item => [item.id,item])).values()]};
          });
          setPage({total:Math.max(0,Number(result.value.total) || 0),nextCursor:typeof result.value.nextCursor === 'string' ? result.value.nextCursor : null});
        } catch {
          if (alive.current && !c.signal.aborted && seq === querySeq.current) setListError(true);
        } finally {
          controllers.current.delete(c);
          if (alive.current && seq === querySeq.current) {setLoading(false);setLoadingMore(false);}
        }
      };
      const refreshNow = async feed => {
        if (refreshing) return;
        const c = controller();const version=metaVersion.current;setManualRefresh(true);setNotice('');
        if(feed?.id)setBusyFeeds(current=>new Set(current).add(feed.id));
        try {
          const result = feed ? await helpers.current.refreshFeed?.(feed.id,c.signal) : await helpers.current.refreshFeeds?.(c.signal);
          if (!alive.current || c.signal.aborted) return;
          if (!result?.ok) throw new Error('refresh failed');
          const next = normalizeSnapshot(result.value);
          if (!next) throw new Error('invalid refresh');
          if(version === metaVersion.current && !pendingMutations.current)commitMeta(next);
          else commitMeta(await fetchMeta(c.signal));
          if (!next.refreshing) setEpoch(value => value + 1);
        } catch (error) {
          if (alive.current && !c.signal.aborted && !/stale metadata/i.test(error?.message ?? '')) setNotice(t('view.refreshFailed'));
        }
        finally {controllers.current.delete(c);if(alive.current){setManualRefresh(false);if(feed?.id)setBusyFeeds(current=>{const next=new Set(current);next.delete(feed.id);return next;});}}
      };
      const markLoaded = async () => {
        const ids = items.filter(item => item.unread).map(item => item.id);
        if (!ids.length) return;
        const versions=new Map();
        for(const id of ids){const value=(operations.current.get(id)||0)+1;operations.current.set(id,value);versions.set(id,value);}
        for(const id of ids)pendingOverlay.current.set(id,{...(pendingOverlay.current.get(id)||{}),unread:false,at:Date.now()});
        beginMutation();setMarkAll({ids,count:ids.length,versions});setSnapshot(current=>applyUnread(current,ids,false));
        let ok=false;try{ok=(await helpers.current.markItems?.(ids,false))?.ok===true;}catch{}finally{endMutation();}
        if(!alive.current)return;
        if(!ok){const unchanged=ids.filter(id=>operations.current.get(id)===versions.get(id));setSnapshot(current=>applyUnread(current,unchanged,true));setMarkAll(null);setNotice(t('markAll.failed'));}
      };
      const undoMark = async () => {
        if(!markAll)return;
        const ids=markAll.ids.filter(id=>operations.current.get(id)===markAll.versions.get(id));setMarkAll(null);
        if(!ids.length)return;
        const versions=new Map();for(const id of ids){const value=(operations.current.get(id)||0)+1;operations.current.set(id,value);versions.set(id,value);}
        for(const id of ids)pendingOverlay.current.set(id,{...(pendingOverlay.current.get(id)||{}),unread:true,at:Date.now()});
        beginMutation();setSnapshot(current=>applyUnread(current,ids,true));
        let ok=false;try{ok=(await helpers.current.markItems?.(ids,true))?.ok===true;}catch{}finally{endMutation();}
        if(alive.current&&!ok){const unchanged=ids.filter(id=>operations.current.get(id)===versions.get(id));setSnapshot(current=>applyUnread(current,unchanged,false));setNotice(t('markAll.failed'));}
      };
      const removeSource = async feed => {
        if(typeof window.confirm !== 'function' || !window.confirm(t('sources.removeConfirm',{title:feed.title})))return;
        setRemovingId(feed.id);let result;
        beginMutation();
        try{result=await helpers.current.removeFeed?.(feed.id);}catch{}
        finally{endMutation();}
        if(!alive.current)return;setRemovingId(null);
        if(!result?.ok){setNotice(t('sources.removeFailed'));return;}
        closePane();if(feedId===feed.id)setFeedId(null);
        setSnapshot(current=>{
          if(!current)return current;
          const removedItems=current.items.filter(item=>item.feedId===feed.id).length;
          const removedSaved=current.items.filter(item=>item.feedId===feed.id&&item.saved).length;
          return {...current,
            categories:current.categories.map(group=>({...group,feeds:group.feeds.filter(entry=>entry.id!==feed.id)})).filter(group=>group.feeds.length),
            items:current.items.filter(item=>item.feedId!==feed.id),
            stats:{...current.stats,feeds:Math.max(0,(current.stats.feeds||0)-1),items:Math.max(0,(current.stats.items||0)-removedItems),saved:Math.max(0,(current.stats.saved||0)-removedSaved)}};
        });
        setEpoch(value=>value+1);
        try{commitMeta(await fetchMeta());}catch{/* keep the local prune */}
      };
      const runManagement = async call => {
        beginMutation();
        let result;
        try { result = await call(); }
        catch (error) { result = { ok: false, error: { message: describeFailure(error) } }; }
        finally { endMutation(); }
        return result;
      };
      const refreshManagement = async () => {
        try {
          const next = await fetchMeta();
          if (alive.current && next) commitMeta(next);
        } catch (error) { /* the optimistic/local update already reflects the change */ }
        if (alive.current) setEpoch(value => value + 1);
      };
      const toggleAddForm = () => setAddForm(current => {
        if (current.open) return { ...current, open: false, busy: false, error: '', result: '' };
        return { ...current, open: true, busy: false, error: '', result: '', category: current.category || '' };
      });
      const changeAddForm = patch => setAddForm(current => {
        const next = { ...current, ...patch };
        if (Object.hasOwn(patch, 'url') || Object.hasOwn(patch, 'title') || Object.hasOwn(patch, 'category') || Object.hasOwn(patch, 'newCategory')) next.result = '';
        return next;
      });
      const closeAddForm = () => setAddForm(current => ({ ...current, open: false, busy: false, error: '', result: '' }));
      const submitAddFeed = async () => {
        if (addForm.busy) return;
        const rawUrl = addForm.url.trim();
        if (rawUrl === '') { changeAddForm({ error: t('sources.urlRequired'), result: '' }); return; }
        const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
        if (!isHttpUrl(url)) { changeAddForm({ error: t('sources.urlInvalid'), result: '' }); return; }
        const creatingCategory = addForm.category === NEW_CATEGORY_VALUE;
        const category = creatingCategory ? addForm.newCategory.trim() : addForm.category.trim();
        if (creatingCategory && category === '') { changeAddForm({ error: t('sources.categoryRequired'), result: '' }); return; }
        const payload = {
          url,
          ...(addForm.title.trim() !== '' ? { title: addForm.title.trim() } : {}),
          ...(category !== '' ? { category } : {}),
        };
        changeAddForm({ busy: true, error: '', result: '' });
        const result = await runManagement(() => helpers.current.addFeed?.(payload));
        if (!alive.current) return;
        if (result?.ok) {
          await refreshManagement();
          if (!alive.current) return;
          changeAddForm({ url: '', title: '', newCategory: '' });
          changeAddForm({ busy: false, error: '', result: addResultText(result.value, t) });
          addUrlRef.current?.focus?.();
        } else {
          changeAddForm({ busy: false, error: describeFailure(result?.error) || t('sources.addFailed'), result: '' });
        }
      };
      const toggleImportForm = () => setImportForm(current => {
        if (current.open) return { ...current, open: false, busy: false, error: '', result: '' };
        return { ...current, open: true, busy: false, error: '', result: '', replaceConfirmed: false, path: current.path || (snapshot?.opml.path || '') };
      });
      const changeImportForm = patch => setImportForm(current => {
        const next = { ...current, ...patch };
        if (Object.hasOwn(patch, 'mode')) next.replaceConfirmed = false;
        if (Object.hasOwn(patch, 'path') || Object.hasOwn(patch, 'mode')) next.result = '';
        return next;
      });
      const closeImportForm = () => setImportForm(current => ({ ...current, open: false, busy: false, error: '', result: '' }));
      const submitImport = async () => {
        if (importForm.busy) return;
        const filePath = importForm.path.trim();
        if (filePath === '') { changeImportForm({ error: t('import.pathRequired'), result: '' }); return; }
        if (importForm.mode === 'replace' && importForm.replaceConfirmed !== true) {
          changeImportForm({ error: t('import.confirmRequired'), result: '' });
          return;
        }
        changeImportForm({ busy: true, error: '', result: '' });
        const result = await runManagement(() => helpers.current.importOpml?.({ path: filePath, mode: importForm.mode }));
        if (!alive.current) return;
        if (result?.ok) {
          await refreshManagement();
          if (!alive.current) return;
          const value = result.value !== null && typeof result.value === 'object' ? result.value : {};
          changeImportForm({
            busy: false,
            error: '',
            replaceConfirmed: false,
            result: t('import.result', {
              added: Math.max(0, numberOr(value.added, 0)),
              updated: Math.max(0, numberOr(value.updated, 0)),
              removed: Math.max(0, numberOr(value.removed, 0)),
            }),
          });
        } else {
          changeImportForm({ busy: false, error: describeFailure(result?.error) || t('import.failed'), result: '' });
        }
      };
      const toggleNewCategory = () => setNewCategoryForm(current => current.open
        ? { ...current, open: false, busy: false, error: '' }
        : { ...current, open: true, busy: false, error: '' });
      const changeNewCategory = value => setNewCategoryForm(current => ({ ...current, name: value }));
      const closeNewCategory = () => setNewCategoryForm(current => ({ ...current, open: false, busy: false, error: '' }));
      const submitNewCategory = async () => {
        if (newCategoryForm.busy) return;
        const name = newCategoryForm.name.trim();
        if (name === '') { setNewCategoryForm(current => ({ ...current, error: t('sources.categoryRequired') })); return; }
        const duplicate = (snapshot?.categories || []).some(group => group.name.toLowerCase() === name.toLowerCase());
        if (duplicate) { setNewCategoryForm(current => ({ ...current, error: t('sources.categoryExists') })); return; }
        setNewCategoryForm(current => ({ ...current, busy: true, error: '' }));
        const result = await runManagement(() => helpers.current.manageCategory?.({ op: 'create', name }));
        if (!alive.current) return;
        if (result?.ok) {
          await refreshManagement();
          if (!alive.current) return;
          const createdName = typeof result.value?.name === 'string' && result.value.name !== '' ? result.value.name : name;
          const created = result.value?.created !== false;
          setNewCategoryForm({ open: false, name: '', busy: false, error: '' });
          if (created) setAddForm(current => current.open ? { ...current, category: createdName } : current);
          setManagementNotice({
            tone: created ? 'ok' : 'error',
            text: created
              ? t('sources.categoryCreated', { name: createdName })
              : t('sources.categoryExists'),
          });
        } else {
          setNewCategoryForm(current => ({ ...current, busy: false, error: describeFailure(result?.error) || t('sources.categoryCreateFailed') }));
        }
      };
      const startCategoryRename = name => setCategoryAction({ name, mode: 'rename', value: name, target: '', busy: false, error: '' });
      const startCategoryDelete = name => setCategoryAction({ name, mode: 'delete', value: '', target: '', busy: false, error: '' });
      const changeCategoryAction = patch => setCategoryAction(current => current ? { ...current, ...patch } : current);
      const cancelCategoryAction = () => setCategoryAction(null);
      const submitCategoryRename = async () => {
        const action = categoryAction;
        if (!action || action.mode !== 'rename' || action.busy) return;
        const newName = action.value.trim();
        if (newName === '') { changeCategoryAction({ error: t('sources.categoryRequired') }); return; }
        if (newName === action.name) { cancelCategoryAction(); return; }
        changeCategoryAction({ busy: true, error: '' });
        const result = await runManagement(() => helpers.current.manageCategory?.({ op: 'rename', name: action.name, newName }));
        if (!alive.current) return;
        if (!result?.ok) {
          changeCategoryAction({ busy: false, error: describeFailure(result?.error) || t('sources.categoryRenameFailed') });
          return;
        }
        cancelCategoryAction();
        await refreshManagement();
        if (!alive.current) return;
        const finalName = typeof result.value?.name === 'string' && result.value.name !== '' ? result.value.name : newName;
        if (category === action.name) { closePane(); setCategory(finalName); }
        setManagementNotice({
          tone: 'ok',
          text: result.value?.merged === true
            ? t('sources.categoryMerged', { name: finalName })
            : t('sources.categoryRenamed', { name: finalName }),
        });
      };
      const submitCategoryDelete = async () => {
        const action = categoryAction;
        if (!action || action.mode !== 'delete' || action.busy) return;
        const group = (snapshot?.categories || []).find(entry => entry.name === action.name);
        if (!group) { cancelCategoryAction(); return; }
        const needsMove = group.feeds.length > 0;
        const targets = [];
        if (HOST_UNCATEGORIZED !== action.name) targets.push(HOST_UNCATEGORIZED);
        for (const entry of (snapshot?.categories || [])) {
          if (entry.name !== action.name && !targets.includes(entry.name)) targets.push(entry.name);
        }
        if (needsMove && targets.length === 0) {
          changeCategoryAction({ error: t('sources.deleteNeedsTarget') });
          return;
        }
        const defaultTarget = targets[0] || HOST_UNCATEGORIZED;
        const moveTo = needsMove ? (targets.includes(action.target) ? action.target.trim() : defaultTarget) : '';
        if (needsMove && (moveTo === '' || moveTo === action.name)) {
          changeCategoryAction({ error: t('sources.categoryRequired') });
          return;
        }
        changeCategoryAction({ busy: true, error: '' });
        const result = await runManagement(() => helpers.current.manageCategory?.({
          op: 'delete',
          name: action.name,
          ...(needsMove ? { moveTo } : {}),
        }));
        if (!alive.current) return;
        if (!result?.ok) {
          changeCategoryAction({ busy: false, error: describeFailure(result?.error) || t('sources.categoryDeleteFailed') });
          return;
        }
        cancelCategoryAction();
        await refreshManagement();
        if (!alive.current) return;
        if (category === action.name) { closePane(); setCategory(needsMove ? moveTo : ALL_CATEGORIES); }
        setManagementNotice({ tone: 'ok', text: t('sources.categoryDeleted', { name: action.name }) });
      };
      const moveSource = async (feed, targetRaw) => {
        const target = typeof targetRaw === 'string' ? targetRaw.trim() : '';
        if (!feed || target === '' || target === feed.category) { setSourceNewCategory(null); return { ok: true }; }
        const targetExisted = (snapshot?.categories || []).some(group => group.name === target);
        setBusyFeeds(current => new Set(current).add(feed.id));
        beginMutation();
        setSnapshot(current => moveFeedInSnapshot(current, feed.id, target));
        let result;
        try { result = await helpers.current.updateFeed?.({ feedId: feed.id, category: target }); }
        catch (error) { result = { ok: false, error: { message: describeFailure(error) } }; }
        finally { endMutation(); }
        if (!alive.current) return result;
        setBusyFeeds(current => {
          const next = new Set(current);
          next.delete(feed.id);
          return next;
        });
        if (!result?.ok) {
          setSnapshot(current => {
            const reverted = moveFeedInSnapshot(current, feed.id, feed.category);
            if (!reverted || targetExisted) return reverted;
            return { ...reverted, categories: reverted.categories.filter(group => group.name !== target || group.feeds.length > 0) };
          });
          setManagementNotice({ tone: 'error', text: t('sources.moveFailed') });
          return result;
        }
        await refreshManagement();
        if (!alive.current) return result;
        if (feedId === feed.id) setCategory(target);
        setSourceNewCategory(null);
        setManagementNotice({ tone: 'ok', text: t('sources.moved', { title: feed.title, category: target }) });
        return result;
      };
      const startSourceNewCategory = feed => setSourceNewCategory({ feedId: feed.id, value: '', busy: false, error: '' });
      const changeSourceNewCategory = value => setSourceNewCategory(current => current ? { ...current, value } : current);
      const cancelSourceNewCategory = () => setSourceNewCategory(null);
      const saveSourceNewCategory = async feed => {
        const entry = sourceNewCategory;
        if (!entry || entry.feedId !== feed.id || entry.busy) return;
        const name = entry.value.trim();
        if (name === '') {
          setSourceNewCategory(current => current ? { ...current, error: t('sources.categoryRequired') } : current);
          return;
        }
        setSourceNewCategory(current => current ? { ...current, busy: true, error: '' } : current);
        const result = await moveSource(feed, name);
        if (!alive.current) return;
        if (!result?.ok) {
          setSourceNewCategory(current => current ? { ...current, busy: false, error: describeFailure(result?.error) || t('sources.moveFailed') } : current);
        }
      };
      React.useEffect(() => {
        alive.current=true;
        return () => {alive.current=false;persist();for(const c of controllers.current)c.abort();controllers.current.clear();};
      },[]);
      React.useEffect(() => {
        const c=controller();let cancelled=false;setStatus('loading');
        const run=async()=>{
          for(let attempt=0;attempt<5;attempt++){
            if(c.signal.aborted||cancelled)return;
            try{const next=await fetchMeta(c.signal);if(cancelled||c.signal.aborted)return;commitMeta(next);setStatus('ready');return;}
            catch{if(attempt===4){if(!cancelled)setStatus('error');return;}}
            await new Promise(resolve=>{const timer=setTimeout(resolve,400*2**attempt);c.signal.addEventListener('abort',()=>{clearTimeout(timer);resolve();},{once:true});});
          }
        };void run();return()=>{cancelled=true;c.abort();controllers.current.delete(c);};
      },[boot]);
      React.useEffect(() => {
        const timer=setTimeout(()=>setQuery(search.trim()),180);return()=>clearTimeout(timer);
      },[search]);
      React.useEffect(() => {
        if(status!=='ready'||mode!==MODE_FEED)return;
        const c=new AbortController();setPage({total:null,nextCursor:null});
        void loadPage(false,c.signal,filterKey);
        return()=>c.abort();
      },[filterKey,status,mode,epoch]);
      React.useEffect(() => {
        if(status!=='ready'||!visible)return;
        let timer;const c=controller();let stopped=false;
        const poll=async()=>{
          try{
            const next=await fetchMeta(c.signal);
            if(stopped||c.signal.aborted||!alive.current)return;
            commitMeta(next);
            if(snapshot?.refreshing&&!next.refreshing)setEpoch(value=>value+1);
            timer=setTimeout(poll,next.refreshing?2000:30000);
          }catch{if(!stopped&&!c.signal.aborted)timer=setTimeout(poll,5000);}
        };
        timer=setTimeout(poll,snapshot?.refreshing?2000:30000);
        return()=>{stopped=true;clearTimeout(timer);c.abort();controllers.current.delete(c);};
      },[status,visible,snapshot?.refreshing]);
      React.useEffect(() => {
        if(typeof document==='undefined')return;
        const change=()=>{setVisible(document.visibilityState!=='hidden');if(document.visibilityState!=='hidden')setClock(Date.now());};
        document.addEventListener('visibilitychange',change);return()=>document.removeEventListener('visibilitychange',change);
      },[]);
      React.useEffect(() => {if(!visible)return;const timer=setInterval(()=>setClock(Date.now()),60000);return()=>clearInterval(timer);},[visible]);
      React.useEffect(() => {
        const names=(snapshot?.categories||[]).map(group=>group.name);
        setAddForm(current => {
          if(!current.open)return current;
          if(current.category===NEW_CATEGORY_VALUE||current.category==='')return current;
          return names.includes(current.category)?current:{...current,category:''};
        });
      },[snapshot?.categories]);
      React.useEffect(() => {if(addForm.open)addUrlRef.current?.focus?.();},[addForm.open]);
      React.useEffect(() => {
        if(!managementNotice)return;
        const timer=setTimeout(()=>setManagementNotice(null),6000);
        return()=>clearTimeout(timer);
      },[managementNotice]);
      React.useEffect(() => {if(importForm.open)importPathRef.current?.focus?.();},[importForm.open]);
      React.useEffect(() => {if(newCategoryForm.open)newCategoryRef.current?.focus?.();},[newCategoryForm.open]);
      React.useEffect(() => {if(categoryAction?.mode==='rename')categoryRenameRef.current?.focus?.();},[categoryAction?.name,categoryAction?.mode]);
      React.useEffect(() => {if(sourceNewCategory)sourceNewRef.current?.focus?.();},[sourceNewCategory?.feedId]);
      React.useEffect(() => {persist();},[category,feedId,mode,unreadOnly,savedOnly,density,fontSize,readMode,groupBySource,selected?.id]);
      React.useEffect(() => {
        if (persistTick === 0) return () => {};
        const timer = setTimeout(persist, 300);
        return () => clearTimeout(timer);
      }, [persistTick]);
      React.useEffect(() => {
        if(status!=='ready'||!snapshot)return;
        if(category!==ALL_CATEGORIES&&!snapshot.categories.some(entry=>entry.name===category))setCategory(ALL_CATEGORIES);
        if(feedId&&!selectedFeed)setFeedId(null);
        else if(selectedFeed&&category!==selectedFeed.category)setCategory(selectedFeed.category);
      },[status,snapshot?.categories,category,feedId]);
      React.useEffect(() => {
        if(!selected?.id){setArticle({itemId:null,status:'idle',data:null});return;}
        const id=selected.id,c=controller();let stopped=false;
        const hit=cache.current.get(id);
        if(hit&&Date.now()-hit.at<(hit.data.contentKind==='summary'?30000:1800000)){cache.current.delete(id);cache.current.set(id,hit);setArticle({itemId:id,status:'ready',data:hit.data});}
        else{
          setArticle({itemId:id,status:'loading',data:null});
          const force=articleRetry.id===id&&articleRetry.n>0;
          void (async()=>{
            try{
              const result=await helpers.current.loadArticle?.(id,c.signal,force);
              if(stopped||c.signal.aborted||!alive.current)return;
              const data=result?.ok?normalizeArticle(result.value):null;
              if(!data)throw new Error('article unavailable');
              cache.current.delete(id);cache.current.set(id,{at:Date.now(),data});
              if(cache.current.size>ARTICLE_CACHE_LIMIT)cache.current.delete(cache.current.keys().next().value);
              setArticle({itemId:id,status:'ready',data});
            }catch{if(!stopped&&!c.signal.aborted&&alive.current)setArticle({itemId:id,status:'error',data:null});}
            finally{controllers.current.delete(c);}
          })();
        }
        return()=>{stopped=true;c.abort();controllers.current.delete(c);};
      },[selected?.id,articleRetry.n]);
      React.useEffect(() => {
        if(!selectedItem||article.itemId!==selectedItem.id||article.status!=='ready'||readMode==='manual'||!selectedItem.unread||!visible)return;
        if(autoReadSuppressed.current.has(selectedItem.id))return;
        const timer=setTimeout(()=>{
          const item=latestSelectedItem.current;
          if(!alive.current||!latestVisible.current||!item||!item.unread||autoReadSuppressed.current.has(item.id))return;
          void markItem(item,false,{auto:true});
        },readMode==='open'?0:2000);
        return()=>clearTimeout(timer);
      },[selected?.id,article.itemId,article.status,readMode,visible]);
      React.useLayoutEffect(() => {
        if(!selected?.id)return;
        const list = scrollRef.current;
        const node = rows.current.get(selected.id);
        if(!list || !node) return;
        if(revealSelection.current===selected.id){
          revealSelection.current=null;
          node.scrollIntoView?.({block:'nearest'});
          return;
        }
        const anchor = listAnchor.current;
        if(anchor && anchor.id===selected.id){
          const listRect=list.getBoundingClientRect();
          const rowRect=node.getBoundingClientRect();
          const delta=(rowRect.top-listRect.top)-anchor.offset;
          if(Math.abs(delta)>1) list.scrollTop += delta;
        }
      },[selected?.id]);
      React.useEffect(() => {
        if(!selected?.id||article.status!=='ready')return;
        if(readerRef.current)readerRef.current.scrollTop=positions.current[selected.id]||0;
      },[selected?.id,article.itemId,article.status]);
      React.useEffect(() => {
        if(loading||!scrollRef.current)return;
        if(initialListRestore.current){scrollRef.current.scrollTop=listPosition.current;initialListRestore.current=false;}
      },[loading]);
      const move = delta => {
        if(mode!==MODE_FEED||!items.length)return;
        const i=selectedItem?items.findIndex(item=>item.id===selectedItem.id):-1;
        const next=i<0?(delta>0?0:items.length-1):Math.max(0,Math.min(items.length-1,i+delta));
        selectItem(items[next], { reveal: true });
      };
      shortcuts.current={move,open:()=>selectedItem&&openUrl(selectedItem.link),toggle:()=>selectedItem&&void markItem(selectedItem,!selectedItem.unread),refresh:()=>void refreshNow(),escape:()=>{if(helpOpen)setHelpOpen(false);else if(selectedItem)closePane();else setSearch('');}};
      React.useEffect(() => {
        if(typeof window.addEventListener!=='function')return;
        const keydown=event=>{
          if(event.metaKey||event.ctrlKey||event.altKey||isEditableTarget(event.target)||event.defaultPrevented)return;
          const tag=event.target?.tagName?.toUpperCase();
          const isControl=['BUTTON','A','SELECT','SUMMARY'].includes(tag);
          const rowTitle=event.target?.dataset?.feedsRowTitle!==undefined;
          if(isControl&&(event.key==='Enter'||event.key===' '||event.key==='Spacebar')&&!rowTitle)return;
          const k=event.key,action=shortcuts.current;
          if(k==='j'||k==='ArrowDown'){event.preventDefault();action.move(1);}
          else if(k==='k'||k==='ArrowUp'){event.preventDefault();action.move(-1);}
          else if(k==='Enter'){event.preventDefault();action.open();}
          else if(k==='m'||k==='M')action.toggle();
          else if(k==='/'){event.preventDefault();searchRef.current?.focus();}
          else if(k==='r'||k==='R'){event.preventDefault();action.refresh();}
          else if(k==='Escape')action.escape();
        };window.addEventListener('keydown',keydown);return()=>window.removeEventListener('keydown',keydown);
      },[]);
      const button=(key,label,onClick,extra={})=>h('button',{key,type:'button',className:'dsh-feeds-smallButton',onClick,...extra},label);
      const chips=[];
      if(snapshot&&mode===MODE_FEED){
        chips.push(h(FilterChip,{key:'all',selected:category===ALL_CATEGORIES&&!feedId,onClick:()=>resetFilters()},t('filter.all')));
        for(const entry of snapshot.categories)chips.push(h(FilterChip,{key:entry.name,selected:category===entry.name&&!feedId,onClick:()=>{closePane();setCategory(entry.name);setFeedId(null);}},`${categoryLabel(entry.name,t)}${entry.unread?' '+entry.unread:''}`));
        chips.push(h(FilterChip,{key:'unread',selected:unreadOnly,onClick:()=>setUnreadOnly(v=>!v)},t('filter.unread')));
        chips.push(h(FilterChip,{key:'saved',selected:savedOnly,onClick:()=>setSavedOnly(v=>!v)},t('saved.label')));
        if(feedId)chips.push(h(FilterChip,{key:'source',selected:true,onClick:()=>{closePane();setFeedId(null);}},`${allFeeds.find(feed=>feed.id===feedId)?.title||feedId} ×`));
      }
      const settings=h('details',{key:'settings',className:'dsh-feeds-settings'},[
        h('summary',{key:'label'},t('reader.settings')),
        h('div',{key:'options',className:'dsh-feeds-settingsOptions'},[
          h('label',{key:'font'},[t('reader.font'),h('select',{value:fontSize,onChange:e=>setFontSize(Number(e.currentTarget.value))},READER_FONT_SIZES.map(size=>h('option',{key:size,value:size},String(size))))]),
          h('label',{key:'density'},[t('reader.density'),h('select',{value:density,onChange:e=>setDensity(e.currentTarget.value)},['summary','compact'].map(value=>h('option',{key:value,value},t(`reader.${value}`))))]),
          h('label',{key:'group'},[t('reader.grouping'),h('select',{value:groupBySource?'source':'time',onChange:e=>setGroupBySource(e.currentTarget.value==='source')},['source','time'].map(value=>h('option',{key:value,value},t('reader.group.'+value))))]),
          h('label',{key:'read'},[t('reader.readMode'),h('select',{value:readMode,onChange:e=>setReadMode(e.currentTarget.value)},['delay','open','manual'].map(value=>h('option',{key:value,value},t(`reader.read.${value}`))))]),
        ]),
      ]);
      const head=h('div',{className:'dsh-feeds-header'},h('div',{className:'dsh-feeds-headerInner'},[
        h('div',{key:'top',className:'dsh-feeds-titleRow'},[
          h('div',{key:'title',className:'dsh-feeds-titleBlock'},[
            h('h1',{key:'h',className:'dsh-feeds-title'},t('view.title')),
            snapshot?h('p',{key:'stats',className:'dsh-feeds-subtitle'},t('stats.overview',{feeds:snapshot.stats.feeds,items:snapshot.stats.items,unread:snapshot.stats.unread})):null,
          ]),
          h('div',{key:'actions',className:'dsh-feeds-actions'},[
            h(SegmentedControl,{key:'mode',value:mode,t,onChange:value=>{if(value!==MODE_FEED)closePane();setMode(value);}}),settings,
            h('div',{key:'helpWrap',className:'dsh-feeds-helpWrap'},[
              button('help','?',()=>setHelpOpen(v=>!v),{'aria-label':t('help.label'),'aria-expanded':helpOpen}),
                  ]),
            button('refresh',refreshing?t('view.refreshing'):t('refresh.button'),()=>void refreshNow(),{disabled:refreshing||status!=='ready'}),
          ]),
        ]),
        snapshot?h('div',{key:'fresh',className:'dsh-feeds-refreshInfo',role:'status'},refreshing?(snapshot.progress?t('view.refreshingProgress',snapshot.progress):t('view.refreshing')):t(snapshot.lastRefreshAt? 'stats.lastRefresh':'stats.lastRefreshNever',{time:relativeTimeOf(snapshot.lastRefreshAt,clock,t)})):null,
        mode===MODE_FEED?h('div',{key:'search',className:'dsh-feeds-search'},[
          h(SearchIcon,{key:'icon'}),h('input',{key:'field',ref:searchRef,type:'search',className:'dsh-feeds-input',value:search,placeholder:t('search.placeholder'),'aria-label':t('search.label'),onChange:e=>{closePane();setSearch(e.currentTarget.value);}}),
          search?button('clear','×',()=>{setSearch('');setQuery('');},{'aria-label':t('search.clear')}):null,
        ]):null,
        chips.length?h('div',{key:'filters',className:'dsh-feeds-filters'},chips):null,
        mode===MODE_FEED&&(feedId||category!==ALL_CATEGORIES||unreadOnly||savedOnly||query)?h('div',{key:'filter-state',className:'dsh-feeds-filterSummary',role:'status'},[
          h('span',{key:'scope'},[selectedFeed?.title|| (category!==ALL_CATEGORIES?categoryLabel(category,t):t('filter.all')),unreadOnly?t('filter.unread'):null,savedOnly?t('saved.label'):null,query?t('filter.searchTerm',{query}):null].filter(Boolean).join(' · ')),
          button('reset',t('filter.reset'),()=>resetFilters()),
        ]):null,
        notice?h('p',{key:'notice',className:'dsh-feeds-notice',role:'alert'},notice):null,
      ]));
      let body;
      if(status==='error')body=h('div',{className:'dsh-feeds-empty'},[
        h('h2',{key:'title'},t('view.hostUnavailable')),h('p',{key:'explain'},t('view.hostUnavailableText')),
        button('retry',t('view.retry'),()=>setBoot(v=>v+1)),
      ]);
      else if(status==='loading'||!snapshot)body=h(ListSkeleton,{t});
      else if(mode===MODE_SOURCES){
        const categoryNames=snapshot.categories.map(group=>group.name);
        const groups=snapshot.categories
          .filter(group=>!failedOnly||group.feeds.some(feed=>feed.error))
          .map(group=>failedOnly?{...group,feeds:group.feeds.filter(feed=>feed.error)}:group);
        body=h('div',{className:'dsh-feeds-pageScroll'},h('div',{className:'dsh-feeds-pageContent'},[
          h('div',{key:'health',className:'dsh-feeds-managementSummary'},t('sources.healthSummary',{healthy:Math.max(0,snapshot.stats.feeds-snapshot.stats.failed),failed:snapshot.stats.failed})),
          h('div',{key:'toolbar',className:'dsh-feeds-sourcesToolbar'},[
            button('add-feed',t('sources.addFeed'),toggleAddForm,{'aria-expanded':addForm.open}),
            button('import-opml',t('sources.importOpml'),toggleImportForm,{'aria-expanded':importForm.open}),
            button('new-category',t('sources.newCategory'),toggleNewCategory,{'aria-expanded':newCategoryForm.open}),
            h(FilterChip,{key:'failed',selected:failedOnly,onClick:()=>setFailedOnly(v=>!v)},t('sources.failedOnly')),
          ]),
          newCategoryForm.open?h(NewCategoryForm,{key:'new-category-form',form:newCategoryForm,t,inputRef:newCategoryRef,onChange:changeNewCategory,onSubmit:()=>void submitNewCategory(),onCancel:closeNewCategory}):null,
          addForm.open?h(AddFeedForm,{key:'add-form',form:addForm,categories:categoryNames,t,urlRef:addUrlRef,onChange:changeAddForm,onSubmit:()=>void submitAddFeed(),onCancel:closeAddForm}):null,
          importForm.open?h(ImportPanel,{key:'import-form',snapshot,form:importForm,t,pathRef:importPathRef,onChange:changeImportForm,onSubmit:()=>void submitImport(),onCancel:closeImportForm,importNotice,onCopy:async()=>setImportNotice(await copyText(t('import.command'),commandRef.current)),commandRef}):null,
          managementNotice?h('p',{key:'manage-notice',className:managementNotice.tone==='error'?'dsh-feeds-formNotice isError':'dsh-feeds-formNotice isSuccess',role:managementNotice.tone==='error'?'alert':'status'},managementNotice.text):null,
          ...groups.map(group=>h(CategoryGroup,{key:group.name,group,categories:categoryNames,t,action:categoryAction&&categoryAction.name===group.name?categoryAction:null,actionOpen:categoryAction!==null,renameRef:categoryRenameRef,busyIds:busyFeeds,removingId,sourceNew:sourceNewCategory,sourceNewRef,onOnly:onlySource,onRefresh:feed=>void refreshNow(feed),onRemove:feed=>void removeSource(feed),onStartRename:startCategoryRename,onStartDelete:startCategoryDelete,onCategoryActionChange:changeCategoryAction,onCategoryRename:()=>void submitCategoryRename(),onCategoryDelete:()=>void submitCategoryDelete(),onCancelAction:cancelCategoryAction,onMoveFeed:(feed,category)=>void moveSource(feed,category),onStartNewCategory:startSourceNewCategory,onNewCategoryChange:changeSourceNewCategory,onNewCategorySave:feed=>void saveSourceNewCategory(feed),onNewCategoryCancel:cancelSourceNewCategory})),
          groups.length===0&&failedOnly?h('p',{key:'no-failed',className:'dsh-feeds-notice'},t('sources.noFailed')):null,
          groups.length===0&&!failedOnly?h('div',{key:'empty-manage',className:'dsh-feeds-empty'},[
            h('h2',{key:'title',className:'dsh-feeds-emptyTitle'},t('empty.noFeedsTitle')),
            h('p',{key:'hint'},t('sources.manageEmptyHint')),
          ]):null,
        ]));
      }
      else {
        const nav=h('nav',{key:'nav',className:'dsh-feeds-nav','aria-label':t('nav.label')},[
          h('div',{key:'queues',className:'dsh-feeds-navQueues'},[
            button('all',t('filter.all'),()=>resetFilters()),
            button('unread',`${t('filter.unread')} ${snapshot.stats.unread}`,()=>{closePane();setCategory(ALL_CATEGORIES);setFeedId(null);setUnreadOnly(true);setSavedOnly(false);setSearch('');setQuery('');}),
            button('saved',`${t('saved.label')} ${snapshot.stats.saved||0}`,()=>{closePane();setCategory(ALL_CATEGORIES);setFeedId(null);setUnreadOnly(false);setSavedOnly(true);setSearch('');setQuery('');}),
          ]),
          ...snapshot.categories.map(group=>h('details',{key:group.name,open:category===group.name},[
            h('summary',{key:'name'},`${categoryLabel(group.name,t)} · ${group.feeds.length}`),
            ...group.feeds.map(feed=>h('button',{key:feed.id,type:'button','data-feed-id':feed.id,className:`dsh-feeds-navSource${feedId===feed.id?' isSelected':''}`,onClick:()=>onlySource(feed),title:feed.title},[
              h('span',{key:'title',className:'dsh-feeds-navSourceName'},h('span',{key:'text'},feed.title)),feed.unread?h('span',{key:'count'},String(feed.unread)):null,
            ])),
          ])),
          button('manage',t('mode.sources'),()=>{closePane();setMode(MODE_SOURCES);}),
        ]);
        const grouped=[];
        for(const item of items){const key=dayGroupOf(itemTimeOf(item)||0,clock);let group=grouped.at(-1);if(!group||group.key!==key){group={key,items:[]};grouped.push(group);}group.items.push(item);}
        const renderRow=(item,hideSource=false)=>h(FeedRow,{key:item.id,item,hideSource,selected:selected?.id===item.id,nowMs:clock,t,onSelect:selectItem,onToggle:row=>void markItem(row,!row.unread),onFilterSource:onlySource,registerNode:(id,node)=>{if(node)rows.current.set(id,node);else rows.current.delete(id);}});
        const renderDay=group=>{
          if(!groupBySource)return h(DayGroup,{key:group.key,groupKey:group.key,items:group.items,nowMs:clock,t,selectedId:selected?.id,onSelect:selectItem,onToggle:item=>void markItem(item,!item.unread),onFilterSource:onlySource,registerNode:(id,node)=>{if(node)rows.current.set(id,node);else rows.current.delete(id);}});
          const feeds=new Map();
          for(const item of group.items){if(!feeds.has(item.feedId))feeds.set(item.feedId,[]);feeds.get(item.feedId).push(item);}
          return h('section',{key:group.key,className:'dsh-feeds-group'},[
            h('h2',{key:'day',className:'dsh-feeds-groupHead'},t('group.'+group.key)+' · '+group.items.length),
            ...[...feeds.entries()].map(([id,updates])=>{
              if(updates.length===1)return h('ul',{key:id,className:'dsh-feeds-list'},renderRow(updates[0]));
              const key=group.key+':'+id;
              const expanded=expandedGroups[key]===true;
              const shown=expanded?updates:updates.slice(0,3);
              return h('section',{key:id,className:'dsh-feeds-feedCluster'},[
                h('div',{key:'head',className:'dsh-feeds-clusterHead'},[
                  h('button',{key:'source',type:'button',className:'dsh-feeds-clusterTitle',onClick:()=>onlySource(updates[0])},updates[0].feedTitle),
                  h('span',{key:'count',className:'dsh-feeds-clusterCount'},t('group.updates',{count:updates.length})),
                  updates.length>3?h('button',{key:'fold',type:'button',className:'dsh-feeds-clusterFold','aria-expanded':expanded,'aria-label':t(expanded?'group.collapse':'group.expand',{count:updates.length-3}),onClick:()=>setExpandedGroups(current=>({...current,[key]:!expanded}))},h(ChevronIcon,{open:expanded})):null,
                ]),
                h('ul',{key:'updates',className:'dsh-feeds-list'},shown.map(item=>renderRow(item,true))),
              ]);
            }),
          ]);
        };
        const unreadLoaded=items.filter(item=>item.unread).length;
        const list=h('div',{key:'list',className:'dsh-feeds-listPane',ref:scrollRef,onScroll:rememberScroll},h('div',{className:'dsh-feeds-listContent'},[
          h('div',{key:'toolbar',className:'dsh-feeds-listToolbar'},[
            h('span',{key:'count',role:'status'},page.total===null?(listError?t('list.failed'):t('view.loading')):(page.total===items.length?t('list.countLoaded',{count:items.length}):t('list.count',{loaded:items.length,total:page.total}))),
            unreadLoaded>0?button('mark',t('markAll.label'),()=>void markLoaded(),{'aria-label':t('markAll.loaded',{count:unreadLoaded}),disabled:loading,className:'dsh-feeds-markAll'}):null,
          ]),
          markAll?h(MarkAllNotice,{key:'undo',count:markAll.count,t,onUndo:()=>void undoMark()}):null,
          (selectedFeed ? selectedFeed.error : snapshot.stats.failed)?h('button',{key:'health',type:'button',className:'dsh-feeds-healthShortcut',onClick:()=>{closePane();setFailedOnly(true);setMode(MODE_SOURCES);}},selectedFeed?t('health.currentSource',{error:selectedFeed.error}):t('health.manage',{count:snapshot.stats.failed})):null,
          loading?h(ListSkeleton,{key:'loading',t}):null,
          !loading&&!listError&&page.total!==null&&!items.length?h('div',{key:'empty',className:'dsh-feeds-empty'},[
            h('h2',{key:'title',className:'dsh-feeds-emptyTitle'},!snapshot.stats.feeds?t('empty.noFeedsTitle'):selectedFeed?(unreadOnly&&selectedFeed.unread===0?t('empty.sourceRead'):savedOnly?t('empty.sourceSaved'):selectedFeed.itemCount===0?t(selectedFeed.error?'empty.sourceFailed':'empty.sourceNoCache'):t('empty.noMatches')):t(savedOnly?'saved.empty':'empty.noMatches')),
            h('p',{key:'hint'},selectedFeed?t('empty.sourceCached',{count:selectedFeed.itemCount}):t(snapshot.stats.feeds?'empty.noMatchesHint':'empty.noFeedsText')),
            selectedFeed&&selectedFeed.itemCount>0?button('show-source',t('empty.showSourceAll'),()=>resetFilters(true)):null,
            snapshot.stats.feeds?button('clear-all',t('filter.reset'),()=>resetFilters()):null,
            selectedFeed&&selectedFeed.itemCount===0?button('refresh-source',t('sources.refresh'),()=>void refreshNow(selectedFeed),{disabled:refreshing}):null,
          ]):null,
          ...(!loading&&(!listError||items.length>0)?grouped.map(renderDay):[]),
          listError?h('p',{key:'error',className:'dsh-feeds-notice',role:'alert'},[t('list.failed'),' ',button('retry',t('view.retry'),()=>void loadPage(items.length>0&&!!page.nextCursor))]):null,
          page.nextCursor?button('more',loadingMore?t('view.loading'):t('list.more'),()=>void loadPage(true),{disabled:loadingMore||loading,className:'dsh-feeds-loadMore'}):null,
        ]));
        const pane=selectedItem?h(ReadingPane,{
          key:'pane',item:selectedItem,article,paneNotice,nowMs:clock,t,focusMode,scrollRef:readerRef,onScroll:rememberScroll,fontSize,onFontSize:size=>setFontSize(Math.max(14,Math.min(28,size))),
          onToggleFocus:()=>setFocusMode(v=>!v),onClose:closePane,
          onRetry:()=>{cache.current.delete(selectedItem.id);setArticleRetry(current=>({id:selectedItem.id,n:current.n+1}));},
          onOpenOriginal:()=>openUrl(selectedItem.link),onSummarize:()=>void summarize(selectedItem),
          onToggleRead:()=>void markItem(selectedItem,!selectedItem.unread),onSave:()=>void saveItem(selectedItem),
          onCopyLink:async()=>{const result=await copyText(selectedItem.link);if(alive.current)setPaneNotice(result==='copied'?'linkCopied':'copyFailed');},
          onPrevious:()=>move(-1),onNext:()=>move(1),
        }):null;
        body=h('div',{className:'dsh-feeds-readerLayout'},[focusMode?null:nav,h('div',{key:'split',className:`dsh-feeds-bodyInner${pane?' hasPane':''}${focusMode?' isFocused':''}`},[list,pane])]);
      }
      return h('div',{className:`dsh-feeds-root density-${density}${props.standalone===true?' isStandalone':''}`,style:{'--feeds-font-size':`${fontSize}px`}},head,h('div',{className:'dsh-feeds-body'},body));
    }
    //#endregion

    /** Sidebar panel icon (owner props: size, active). */
    function FeedsPanelIcon(props) {
      const size = typeof props?.size === 'number' && props.size > 0 ? props.size : 20;
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 64 64',
        fill: 'currentColor',
        'aria-hidden': 'true',
        focusable: 'false',
        style: { display: 'block' },
      }, [
        h('circle', { key: 'dot', cx: 18, cy: 46, r: 5.5 }),
        h('path', { key: 'arc1', d: 'M14 31a19 19 0 0 1 19 19', fill: 'none', stroke: 'currentColor', strokeWidth: 7, strokeLinecap: 'round' }),
        h('path', { key: 'arc2', d: 'M14 16a34 34 0 0 1 34 34', fill: 'none', stroke: 'currentColor', strokeWidth: 7, strokeLinecap: 'round' }),
      ]);
    }

    /** Main-panel wrapper: the reader fills the central panel instead of a conversation view. */
    function FeedsPanel(props) {
      return h(FeedsView, { ...props, standalone: true });
    }

    return {
      inject: ['slots', 'locale'],
      /**
       * Register this bundle's dictionaries, stylesheet, and the `feeds`
       * Conversation View. Everything is an effect owned by the Client run.
       * @param ctx - Client context with the slots and locale services.
       */
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'feeds: dictionaries');
        ctx.effect(() => insertStyles(), 'feeds: styles');
        const t = ctx.locale.bind(NS);

        /**
         * Call one Host RPC route, tolerating a missing Connection and any
         * transport failure. Resolves to the raw `{ ok, value | error }`
         * envelope so the view can tell "loading failed" from "empty data".
         */
        const callHost = async (endpoint, payload, signal) => {
          let rpc;
          try {
            const connection = ctx.get('connection');
            rpc = connection === undefined || connection === null ? undefined : connection.rpc;
          } catch (error) {
            console.warn('[feeds] could not read the connection service:', error);
            rpc = undefined;
          }
          if (rpc === undefined || rpc === null || typeof rpc.call !== 'function') {
            return { ok: false, error: { code: 'feeds/unavailable', message: 'The Host half is not connected.' } };
          }
          try {
            const result = await rpc.call(HOST_CHANNEL, `feeds/${endpoint}`, payload, signal);
            if (result === null || typeof result !== 'object') {
              return { ok: false, error: { code: 'feeds/invalid-response', message: 'The Host returned an invalid response.' } };
            }
            return result;
          } catch (error) {
            if (signal !== undefined && signal !== null && signal.aborted === true) {
              return { ok: false, aborted: true, error: { code: 'feeds/aborted', message: '' } };
            }
            console.warn(`[feeds] ${endpoint} failed:`, error);
            return { ok: false, error: { code: 'feeds/unavailable', message: describeFailure(error) } };
          }
        };

        const loadSnapshot = (signal) => callHost('snapshot', {compact:true}, signal);
        const loadItems = (query, signal) => callHost('items', query, signal);
        const saveItems = (ids, saved) => callHost('save', {ids,saved}, undefined);
        const refreshFeeds = (signal) => callHost('refresh', {}, signal);
        const refreshFeed = (feedId, signal) => callHost('refresh', { feedId }, signal);
        const markItems = (ids, unread) => callHost('mark', { ids, unread }, undefined);
        const loadArticle = (itemId, signal, force=false) => callHost('article', { itemId, force }, signal);
        const removeFeed = (feedId) => callHost('remove', { feedId }, undefined);
        const addFeed = (payload) => callHost('add', payload, undefined);
        const updateFeed = (payload) => callHost('update', payload, undefined);
        const manageCategory = (payload) => callHost('category', payload, undefined);
        const importOpml = (payload) => callHost('import', payload, undefined);

        // Global (user-level) entry in the left sidebar: a panel row beside
        // Plugins / Automation tasks whose id addresses the `main` panel below.
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'feeds',
          order: 20,
          locale: NS,
          label: () => t('view.title'),
        }, FeedsPanelIcon));
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'feeds',
          locale: NS,
          inject: () => ({ loadSnapshot, loadItems, saveItems, refreshFeeds, refreshFeed, markItems, loadArticle, removeFeed, addFeed, updateFeed, manageCategory, importOpml }),
        }, FeedsPanel));
      },
    };
  },
});
