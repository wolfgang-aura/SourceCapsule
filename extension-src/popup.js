'use strict';

const CONTROLLER = 'sourcecapsule:controller';

const STRINGS = {
  en: {
    tagline: 'Archive X. Keep the source.',
    statusChecking: 'Checking this tab',
    statusConnecting: 'Connecting to SourceCapsule…',
    openX: 'Open X',
    libraryHeading: 'Library',
    libraryDesc: 'Choose the folder structure and files saved per post.',
    folderLayout: 'Folder layout',
    layoutDate: 'By date',
    layoutFlat: 'Flat',
    savedFiles: 'Saved files',
    contentsFull: 'Full archive',
    contentsLean: 'Lean + media',
    deliveryTitle: 'Export folder',
    deliveryCopy: 'Saved to the folder you choose on X.',
    changeFolder: 'Choose export folder',
    captureHeading: 'Capture',
    captureDesc: 'Safer defaults for complete, useful archives.',
    strictExport: 'Strict export',
    strictExportDesc: 'Retry and warn before saving gaps',
    replyContext: 'Reply context',
    replyContextDesc: 'Include the post this reply answers',
    floatingButton: 'Floating button',
    floatingButtonDesc: 'Show a draggable page-level shortcut',
    navHelp: 'Help & source',
    navPrivacy: 'Privacy',
    openXTitle: 'Open X to begin',
    openXDesc: 'Capture posts, threads, and Articles from an X tab.',
    refreshTitle: 'Refresh this X tab',
    refreshDesc: 'SourceCapsule was installed or updated after the page loaded.',
    ready: 'ready',
    recoveryConnecting: 'Export controls are ready; passive recovery is still connecting.',
    recoveryActive: 'Quote, long-form, and media recovery are active.',
    folderPickerUnavailable: 'Folder picker unavailable',
    zipDeliveryTitle: 'ZIP delivery',
    zipDeliveryCopy: 'This browser downloads one ZIP with the same library structure.',
    zipHelp: 'No content is lost; the folder tree is packed into the ZIP.',
    errorSaveSetting: 'Could not save that setting.',
    settingSaved: 'Setting saved',
    folderPickerSuccess: 'Finish choosing the folder in the SourceCapsule prompt on the X page.',
    folderPickerError: 'Could not open the folder prompt. Refresh X and try again.',
  },
  zh: {
    tagline: '存档 X，保留来源。',
    statusChecking: '正在检查此标签页',
    statusConnecting: '正在连接 SourceCapsule…',
    openX: '打开 X',
    libraryHeading: '资料库',
    libraryDesc: '选择每篇帖子的文件夹结构和保存文件。',
    folderLayout: '文件夹布局',
    layoutDate: '按日期',
    layoutFlat: '扁平',
    savedFiles: '已保存文件',
    contentsFull: '完整存档',
    contentsLean: '精简 + 媒体',
    deliveryTitle: '导出文件夹',
    deliveryCopy: '保存到您在 X 上选择的文件夹。',
    changeFolder: '选择导出文件夹',
    captureHeading: '捕获',
    captureDesc: '更安全的默认设置，确保完整有效的存档。',
    strictExport: '严格导出',
    strictExportDesc: '在保存前重试并警告缺失内容',
    replyContext: '回复上下文',
    replyContextDesc: '包含此回复所回应的帖子',
    floatingButton: '悬浮按钮',
    floatingButtonDesc: '显示可拖动的页面级快捷方式',
    navHelp: '帮助与源码',
    navPrivacy: '隐私政策',
    openXTitle: '请先打开 X',
    openXDesc: '从 X 标签页中捕获帖子、话题串和文章。',
    refreshTitle: '请刷新此 X 标签页',
    refreshDesc: 'SourceCapsule 在页面加载后被安装或更新。',
    ready: '已就绪',
    recoveryConnecting: '导出控件已就绪；被动恢复仍在连接中。',
    recoveryActive: '引用、长文及媒体恢复功能已激活。',
    folderPickerUnavailable: '文件夹选择不可用',
    zipDeliveryTitle: 'ZIP 下载',
    zipDeliveryCopy: '此浏览器将以相同的库结构下载一个 ZIP 文件。',
    zipHelp: '内容不会丢失，文件夹树已打包至 ZIP 中。',
    errorSaveSetting: '无法保存该设置。',
    settingSaved: '设置已保存',
    folderPickerSuccess: '请在 X 页面上的 SourceCapsule 提示中完成文件夹选择。',
    folderPickerError: '无法打开文件夹提示。请刷新 X 后重试。',
  },
};

let currentLang = 'en';

function applyLanguage(lang) {
  currentLang = lang;
  const strings = STRINGS[lang] || STRINGS.en;
  document.getElementById('html-root').lang = lang === 'zh' ? 'zh-CN' : 'en';
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n;
    if (strings[key] !== undefined) el.textContent = strings[key];
  });
  const btn = document.getElementById('lang-toggle');
  if (btn) btn.textContent = lang === 'zh' ? '中文' : 'EN';
}

async function initLanguage() {
  try {
    const result = await chrome.storage.local.get('uiLang');
    applyLanguage(result.uiLang || 'en');
  } catch {
    applyLanguage('en');
  }
  const btn = document.getElementById('lang-toggle');
  if (btn) {
    btn.addEventListener('click', async () => {
      const next = currentLang === 'en' ? 'zh' : 'en';
      applyLanguage(next);
      try {
        await chrome.storage.local.set({ uiLang: next });
      } catch {}
    });
  }
}

function controllerMessage(action, value) {
  return { type: CONTROLLER, version: 1, action, ...(value === undefined ? {} : { value }) };
}

function isSupportedXUrl(value) {
  try {
    const url = new URL(value);
    return ['x.com', 'twitter.com', 'mobile.x.com', 'mobile.twitter.com'].includes(url.hostname);
  } catch {
    return false;
  }
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function sendToController(tabId, action, value) {
  if (!Number.isInteger(tabId)) return { ok: false, error: 'No active tab is available.' };
  try {
    return await chrome.tabs.sendMessage(tabId, controllerMessage(action, value));
  } catch (error) {
    return { ok: false, error: error.message || 'SourceCapsule is not available on this tab.' };
  }
}

function setChecked(name, value) {
  const input = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (input) input.checked = true;
}

function t(key) {
  return (STRINGS[currentLang] || STRINGS.en)[key] || key;
}

const PAGE_CONTEXT_LABELS = {
  en: { article: 'Article', post: 'Post or thread', default: 'X page' },
  zh: { article: '文章', post: '帖子或话题串', default: 'X 页面' },
};

function pageContextLabel(pageType) {
  const labels = PAGE_CONTEXT_LABELS[currentLang] || PAGE_CONTEXT_LABELS.en;
  if (pageType === 'article') return labels.article;
  if (pageType === 'post') return labels.post;
  return labels.default;
}

async function initPopup() {
  const status = document.querySelector('#status');
  const statusTitle = document.querySelector('#status-title');
  const statusCard = document.querySelector('#status-card');
  const settings = document.querySelector('#settings');
  const openX = document.querySelector('#open-x');
  const saveFeedback = document.querySelector('#save-feedback');
  const showState = (state, title, message) => {
    statusCard.dataset.state = state;
    statusTitle.textContent = title;
    status.textContent = message;
  };
  let feedbackTimer = null;
  const showFeedback = (message, error = false) => {
    clearTimeout(feedbackTimer);
    saveFeedback.textContent = message;
    saveFeedback.classList.toggle('error', error);
    if (!error) feedbackTimer = setTimeout(() => (saveFeedback.textContent = ''), 1800);
  };
  document.querySelector('#version').textContent = `v${chrome.runtime.getManifest().version}`;
  const tab = await activeTab();
  if (!tab || !isSupportedXUrl(tab.url || '')) {
    showState('error', t('openXTitle'), t('openXDesc'));
    openX.hidden = false;
    return;
  }
  const state = await sendToController(tab.id, 'get-state');
  if (!state || !state.ok) {
    showState('error', t('refreshTitle'), t('refreshDesc'));
    return;
  }
  const context = pageContextLabel(state.pageType);
  showState(
    'ready',
    `${context} ${t('ready')}`,
    state.recoveryReady === false ? t('recoveryConnecting') : t('recoveryActive')
  );
  settings.hidden = false;
  setChecked('layout', state.prefs.layout);
  setChecked('contents', state.prefs.contents);
  document.querySelector('#floating-button').checked = state.prefs.floatingButton;
  document.querySelector('#strict-export').checked = state.prefs.strictExport !== false;
  document.querySelector('#reply-context').checked = state.prefs.replyContext !== false;
  const changeFolder = document.querySelector('#change-folder');
  const deliveryTitle = document.querySelector('#delivery-title');
  const deliveryCopy = document.querySelector('#delivery-copy');
  if (state.folderPickerSupported === false) {
    changeFolder.disabled = true;
    changeFolder.textContent = t('folderPickerUnavailable');
    deliveryTitle.textContent = t('zipDeliveryTitle');
    deliveryCopy.textContent = t('zipDeliveryCopy');
    const help = document.querySelector('#folder-help');
    help.hidden = false;
    help.textContent = t('zipHelp');
  }

  settings.addEventListener('change', async (event) => {
    const target = event.target;
    let value;
    if (target.name === 'layout') value = { key: 'layout', value: target.value };
    else if (target.name === 'contents') value = { key: 'contents', value: target.value };
    else if (target.id === 'floating-button')
      value = { key: 'floatingButton', value: target.checked };
    else if (target.id === 'strict-export') value = { key: 'strictExport', value: target.checked };
    else if (target.id === 'reply-context') value = { key: 'replyContext', value: target.checked };
    else return;
    target.disabled = true;
    const result = await sendToController(tab.id, 'set-preference', value);
    target.disabled = false;
    if (!result || !result.ok) {
      showFeedback((result && result.error) || t('errorSaveSetting'), true);
      return;
    }
    showFeedback(t('settingSaved'));
  });
  changeFolder.addEventListener('click', async () => {
    changeFolder.disabled = true;
    const result = await sendToController(tab.id, 'pick-folder');
    changeFolder.disabled = false;
    const help = document.querySelector('#folder-help');
    help.hidden = false;
    help.classList.toggle('error', !(result && result.ok));
    help.textContent =
      result && result.ok
        ? t('folderPickerSuccess')
        : (result && result.error) || t('folderPickerError');
  });
}

if (typeof document !== 'undefined') {
  document
    .querySelector('#open-x')
    .addEventListener('click', () => chrome.tabs.create({ url: 'https://x.com/' }));
  initLanguage();
  initPopup().catch((error) => {
    document.querySelector('#status').textContent = `SourceCapsule popup error: ${error.message}`;
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { controllerMessage, isSupportedXUrl, pageContextLabel };
}
