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

async function initPopup() {
  const status = document.querySelector('#status');
  const settings = document.querySelector('#settings');
  const openX = document.querySelector('#open-x');
  document.querySelector('#version').textContent = `v${chrome.runtime.getManifest().version}`;
  const tab = await activeTab();
  if (!tab || !isSupportedXUrl(tab.url || '')) {
    status.textContent = 'SourceCapsule runs on X. Open X to capture a post, thread, or Article.';
    openX.hidden = false;
    return;
  }
  const state = await sendToController(tab.id, 'get-state');
  if (!state || !state.ok) {
    status.textContent =
      'This X tab needs refreshing after SourceCapsule was installed or updated.';
    return;
  }
  status.textContent = 'SourceCapsule is ready on this page.';
  settings.hidden = false;
  setChecked('layout', state.prefs.layout);
  setChecked('contents', state.prefs.contents);
  document.querySelector('#floating-button').checked = state.prefs.floatingButton;
  const changeFolder = document.querySelector('#change-folder');
  if (state.folderPickerSupported === false) {
    changeFolder.disabled = true;
    changeFolder.textContent = 'Folder selection unavailable';
    const help = document.querySelector('#folder-help');
    help.hidden = false;
    help.textContent = 'This browser saves each library capture as a ZIP download instead.';
  }

  settings.addEventListener('change', async (event) => {
    const target = event.target;
    let value;
    if (target.name === 'layout') value = { key: 'layout', value: target.value };
    else if (target.name === 'contents') value = { key: 'contents', value: target.value };
    else if (target.id === 'floating-button')
      value = { key: 'floatingButton', value: target.checked };
    else return;
    const result = await sendToController(tab.id, 'set-preference', value);
    if (!result || !result.ok) status.textContent = result.error || 'Could not save that setting.';
  });
  changeFolder.addEventListener('click', async () => {
    const result = await sendToController(tab.id, 'pick-folder');
    const help = document.querySelector('#folder-help');
    help.hidden = false;
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
  module.exports = { controllerMessage, isSupportedXUrl };
}
