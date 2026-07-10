'use strict';

const CONTROLLER = 'sourcecapsule:controller';

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

function pageContextLabel(pageType) {
  if (pageType === 'article') return 'Article';
  if (pageType === 'post') return 'Post or thread';
  return 'X page';
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
    showState('error', 'Open X to begin', 'Capture posts, threads, and Articles from an X tab.');
    openX.hidden = false;
    return;
  }
  const state = await sendToController(tab.id, 'get-state');
  if (!state || !state.ok) {
    showState(
      'error',
      'Refresh this X tab',
      'SourceCapsule was installed or updated after the page loaded.'
    );
    return;
  }
  const context = pageContextLabel(state.pageType);
  showState(
    'ready',
    `${context} ready`,
    state.recoveryReady === false
      ? 'Export controls are ready; passive recovery is still connecting.'
      : 'Quote, long-form, and media recovery are active.'
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
    changeFolder.textContent = 'Folder picker unavailable';
    deliveryTitle.textContent = 'ZIP delivery';
    deliveryCopy.textContent = 'This browser downloads one ZIP with the same library structure.';
    const help = document.querySelector('#folder-help');
    help.hidden = false;
    help.textContent = 'No content is lost; the folder tree is packed into the ZIP.';
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
      showFeedback((result && result.error) || 'Could not save that setting.', true);
      return;
    }
    showFeedback('Setting saved');
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
        ? 'Finish choosing the folder in the SourceCapsule prompt on the X page.'
        : (result && result.error) || 'Could not open the folder prompt. Refresh X and try again.';
  });
}

if (typeof document !== 'undefined') {
  document
    .querySelector('#open-x')
    .addEventListener('click', () => chrome.tabs.create({ url: 'https://x.com/' }));
  initPopup().catch((error) => {
    document.querySelector('#status').textContent = `SourceCapsule popup error: ${error.message}`;
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { controllerMessage, isSupportedXUrl, pageContextLabel };
}
