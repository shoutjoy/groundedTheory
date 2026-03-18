(function () {
  'use strict';

  const STORAGE_KEY = 'gtPasteContent';

  function getUrlParam(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name);
  }

  function delay(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function waitForSelector(selector, timeoutMs) {
    timeoutMs = timeoutMs || 10000;
    const start = Date.now();
    return new Promise(function (resolve) {
      function check() {
        const el = document.querySelector(selector);
        if (el) {
          resolve(el);
          return;
        }
        if (Date.now() - start > timeoutMs) {
          resolve(null);
          return;
        }
        setTimeout(check, 100);
      }
      check();
    });
  }

  function findEditor() {
    const container = document.querySelector('#viewer-container');
    const searchRoot = container || document.body;
    const textarea = searchRoot.querySelector('textarea');
    if (textarea) return { el: textarea, type: 'textarea' };
    const ce = searchRoot.querySelector('[contenteditable="true"]');
    if (ce) return { el: ce, type: 'contenteditable' };
    const cmContent = searchRoot.querySelector('.cm-content');
    if (cmContent) return { el: cmContent, type: 'codemirror' };
    const cmEditor = searchRoot.querySelector('.cm-editor');
    if (cmEditor) {
      const inner = cmEditor.querySelector('.cm-content') || cmEditor.querySelector('textarea');
      if (inner) return { el: inner, type: inner.tagName === 'TEXTAREA' ? 'textarea' : 'codemirror' };
    }
    const anyTextarea = document.querySelector('textarea');
    if (anyTextarea) return { el: anyTextarea, type: 'textarea' };
    return null;
  }

  function dispatchKey(el, key, ctrlKey, keyCode) {
    const opt = { bubbles: true, cancelable: true, key: key, code: key, keyCode: keyCode || key.charCodeAt(0), which: keyCode || key.charCodeAt(0), ctrlKey: !!ctrlKey };
    el.dispatchEvent(new KeyboardEvent('keydown', opt));
    el.dispatchEvent(new KeyboardEvent('keyup', opt));
  }

  function runPasteFlow(content) {
    if (!content || typeof content !== 'string') return;

    (async function () {
      const btnEdit = await waitForSelector('#btn-edit', 10000);
      if (btnEdit) {
        btnEdit.click();
        await delay(600);
      }

      let editorInfo = null;
      for (let i = 0; i < 50; i++) {
        await delay(150);
        editorInfo = findEditor();
        if (editorInfo) break;
      }
      if (!editorInfo) {
        chrome.storage.local.remove(STORAGE_KEY);
        return;
      }

      const el = editorInfo.el;
      el.focus();
      await delay(120);

      if (editorInfo.type === 'textarea') {
        el.select();
        el.value = '';
        el.value = content;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (editorInfo.type === 'contenteditable') {
        document.execCommand('selectAll', false, null);
        await delay(80);
        document.execCommand('delete', false, null);
        await delay(80);
        document.execCommand('insertText', false, content);
      } else {
        el.focus();
        document.execCommand('selectAll', false, null);
        await delay(80);
        document.execCommand('delete', false, null);
        await delay(80);
        if (el.isContentEditable) {
          document.execCommand('insertText', false, content);
        } else {
          el.textContent = content;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }

      await delay(300);
      const btnView = document.querySelector('#btn-view');
      if (btnView) {
        btnView.click();
      }

      chrome.storage.local.remove(STORAGE_KEY);
    })();
  }

  if (getUrlParam('from') === 'gt-assistant') {
    chrome.storage.local.get(STORAGE_KEY).then(function (data) {
      const content = data[STORAGE_KEY];
      if (content) runPasteFlow(content);
    });
  }
})();
