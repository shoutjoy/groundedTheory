(function () {
  'use strict';

  const DEFAULT_PROMPTS = {
    step1: `[개방 코딩] 소스에서 현상을 라벨링하고 개념을 추출하세요. 모든 결과에 인용 근거를 포함하고 표 형식으로 정리하세요.`,
    step2: `[축 코딩] 개방 코딩된 개념들을 연결하세요. 인과적 조건, 맥락, 작용/상호작용 전략, 결과라는 '패러다임 모델'에 맞춰 범주화하고, 각 연결의 근거를 소스에서 찾아 제시하세요.`,
    step3: `[선택 코딩] 모든 범주를 통합하는 '핵심 범주' 하나를 도출하세요. 이를 바탕으로 전체 현상을 설명하는 스토리라인을 작성하고, 이론적 기틀을 제안하세요.`
  };

  const PROMPTS_STORAGE_KEY = 'gtPrompts';

  function getPrompts() {
    return chrome.storage.local.get(PROMPTS_STORAGE_KEY).then(function (data) {
      const stored = data[PROMPTS_STORAGE_KEY];
      if (stored && typeof stored.step1 === 'string' && typeof stored.step2 === 'string' && typeof stored.step3 === 'string') {
        return stored;
      }
      return DEFAULT_PROMPTS;
    });
  }

  const stepLabels = {
    1: '1단계: 개방 코딩',
    2: '2단계: 축 코딩',
    3: '3단계: 선택 코딩'
  };

  const STORAGE_KEY = 'gtResponses';
  const SCRAP_STORAGE_KEY = 'gtScraps';
  const MD_PRO_VIEWER_URL = 'https://mdproviewer.vercel.app/';

  let lastUsedStep = 1;

  // ---------- DOM 대기 및 버튼 주입 (왼쪽 하단 플로팅 패널) ----------
  function findQueryTextarea() {
    const panel = document.querySelector('section.chat-panel') || document.querySelector('chat-panel');
    if (!panel) return null;
    const box = panel.querySelector('query-box');
    return box ? box.querySelector('textarea') : null;
  }

  function findSubmitButton() {
    const panel = document.querySelector('section.chat-panel') || document.querySelector('chat-panel');
    if (!panel) return null;
    const box = panel.querySelector('query-box');
    if (!box) return null;
    const form = box.querySelector('form');
    const container = form || box;
    const buttons = container.querySelectorAll('button');
    for (const btn of buttons) {
      if (btn.type === 'submit') return btn;
      const icon = btn.querySelector('mat-icon');
      const iconText = icon ? icon.textContent.trim() : '';
      const label = (btn.getAttribute('aria-label') || '').toLowerCase();
      if (iconText === 'send' || iconText === 'arrow_upward' || iconText === 'keyboard_arrow_up' || label.includes('send') || label.includes('전송') || label.includes('제출')) {
        return btn;
      }
    }
    if (form) {
      const submit = form.querySelector('button[type="submit"]');
      if (submit) return submit;
    }
    return null;
  }

  function findLastCopyButton() {
    const panel = document.querySelector('section.chat-panel') || document.querySelector('chat-panel');
    if (!panel) return null;
    const messages = panel.querySelectorAll('chat-message');
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const actions = msg.querySelector('chat-actions') || msg.querySelector('mat-card-actions chat-actions');
      if (!actions) continue;
      const buttons = actions.querySelectorAll('button');
      let copyBtn = null;
      for (const btn of buttons) {
        const icon = btn.querySelector('mat-icon');
        const iconText = icon ? icon.textContent.trim() : '';
        if (iconText === 'content_copy' || iconText === 'copy' || btn.getAttribute('aria-label') === 'Copy') {
          copyBtn = btn;
          break;
        }
      }
      if (!copyBtn && buttons.length >= 2) {
        copyBtn = buttons[1];
      }
      if (!copyBtn && buttons.length >= 1) {
        copyBtn = buttons[0];
      }
      if (copyBtn) return copyBtn;
    }
    return null;
  }

  /** 메시지 전체 본문을 DOM에서 추출 (복사 버튼 용량 제한과 관계없이 전체 텍스트 수집) */
  function getFullMessageTextFromDOM(buttonElement) {
    const msg = buttonElement.closest('chat-message');
    if (!msg) return '';
    const card = msg.querySelector('mat-card');
    if (!card) return (msg.innerText || '').trim();
    const clone = card.cloneNode(true);
    const actions = clone.querySelector('mat-card-actions') || clone.querySelector('chat-actions');
    if (actions) actions.remove();
    const text = (clone.innerText || clone.textContent || '').trim();
    return text;
  }

  function injectUI() {
    if (document.getElementById('gt-assistant-root')) return;
    if (!document.body) return;

    const container = document.createElement('div');
    container.id = 'gt-assistant-root';
    container.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 20px;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 14px;
      border-radius: 12px;
      background: rgba(45, 47, 50, 0.96);
      border: 1px solid rgba(255, 255, 255, 0.12);
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
    `;

    const style = document.createElement('style');
    style.textContent = `
      #gt-assistant-root .gt-panel-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.1); }
      #gt-assistant-root .gt-panel-title { font-size: 13px; font-weight: 600; color: #fff; cursor: move; user-select: none; flex: 1; }
      #gt-assistant-root .gt-close { padding: 4px 8px; font-size: 11px; cursor: pointer; border: none; border-radius: 6px; background: rgba(95, 99, 104, 0.9); color: #fff; }
      #gt-assistant-root .gt-close:hover { background: rgba(95, 99, 104, 1); }
      #gt-assistant-root .gt-row { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }
      #gt-assistant-root .gt-row:last-child { margin-bottom: 0; }
      #gt-assistant-root .gt-btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; font-size: 12px; font-weight: 500; cursor: pointer; border: none; border-radius: 20px; background: rgba(95, 99, 104, 0.9); color: #fff; white-space: nowrap; transition: background 0.15s ease; }
      #gt-assistant-root .gt-btn:hover { background: rgba(95, 99, 104, 1); }
      #gt-assistant-root .gt-btn.main { background: rgba(26, 115, 232, 0.9); min-width: 140px; }
      #gt-assistant-root .gt-btn.main:hover { background: #1557b0; }
      #gt-assistant-root .gt-btn.sm { padding: 6px 10px; font-size: 11px; }
      #gt-assistant-root .gt-btn svg { width: 16px; height: 16px; flex-shrink: 0; }
      #gt-assistant-root .gt-btn.circle { width: 28px; height: 28px; padding: 0; border-radius: 50%; justify-content: center; min-width: 28px; font-size: 14px; line-height: 1; }
    `;
    document.head.appendChild(style);

    function makeBtn(iconSvg, label, onClick, cls) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gt-btn' + (cls ? ' ' + cls : '');
      btn.innerHTML = (iconSvg || '') + '<span>' + label + '</span>';
      btn.addEventListener('click', onClick);
      return btn;
    }

    const iconStep1 = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2 17h2v.5H3v1h1v.5H2v1h3v-4H2v1zm1-9h1V4H2v1h1v3zm-1 3h1.8L2 13.1v.9h3v-1H3.2L5 10.9V10H2v1zm5-6v2h14V5H7zm0 14h14v-2H7v2zm0-6h14v-2H7v2z"/></svg>';
    const iconStep2 = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 7v10l10 5 10-5V7L12 2zm0 2.18l8 4v8.64l-8-4-8 4V8.18l8-4z"/></svg>';
    const iconStep3 = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
    const iconSave = '💾 ';
    const iconDownload = '📥 ';
    const iconWindow = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59L4 18.59 5.41 20 17 8.41V12h2V3h-5z"/></svg>';

    const header = document.createElement('div');
    header.className = 'gt-panel-header';
    const title = document.createElement('div');
    title.className = 'gt-panel-title';
    title.textContent = 'GT 분석 프로세스';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'gt-close';
    closeBtn.textContent = '닫기';
    closeBtn.addEventListener('click', function () {
      container.style.display = 'none';
    });
    header.appendChild(title);
    header.appendChild(closeBtn);

    title.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      let startX = e.clientX;
      let startY = e.clientY;
      let startLeft = rect.left;
      let startTop = rect.top;
      container.style.bottom = 'auto';
      container.style.left = startLeft + 'px';
      container.style.top = startTop + 'px';
      function move(e) {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        startX = e.clientX;
        startY = e.clientY;
        startLeft += dx;
        startTop += dy;
        container.style.left = startLeft + 'px';
        container.style.top = startTop + 'px';
      }
      function stop() {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', stop);
      }
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', stop);
    });

    function makeCircleBtn(onClick) {
      const btn = makeBtn('○', '', onClick, 'circle');
      btn.title = '이것으로 보기';
      return btn;
    }

    const immediateWrap = document.createElement('div');
    immediateWrap.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:8px;';
    const immediateCheck = document.createElement('input');
    immediateCheck.type = 'checkbox';
    immediateCheck.id = 'gt-immediate-run';
    immediateCheck.checked = true;
    immediateCheck.style.cssText = 'cursor:pointer;';
    const immediateLabel = document.createElement('label');
    immediateLabel.htmlFor = 'gt-immediate-run';
    immediateLabel.style.cssText = 'color:#fff;font-size:12px;cursor:pointer;user-select:none;';
    immediateLabel.textContent = '즉시실행';
    immediateWrap.appendChild(immediateCheck);
    immediateWrap.appendChild(immediateLabel);

    function row1() {
      const r = document.createElement('div');
      r.className = 'gt-row';
      r.appendChild(makeBtn(iconStep1, '1단계: 개방 코딩', () => fillPrompt(1, immediateCheck.checked), 'main'));
      r.appendChild(makeBtn(iconSave, '답변 저장', () => saveResponse(1), 'sm'));
      r.appendChild(makeBtn(iconWindow, '새창보기', () => getLatestContentForStep(1).then(c => openMdProViewerWithCopy(c)), 'sm'));
      r.appendChild(makeCircleBtn(() => getLatestContentForStep(1).then(c => showContentViewer(stepLabels[1], c || '(내용 없음)'))));
      return r;
    }
    function row2() {
      const r = document.createElement('div');
      r.className = 'gt-row';
      r.appendChild(makeBtn(iconStep2, '2단계: 축 코딩', () => fillPrompt(2, immediateCheck.checked), 'main'));
      r.appendChild(makeBtn(iconSave, '답변 저장', () => saveResponse(2), 'sm'));
      r.appendChild(makeBtn(iconWindow, '새창보기', () => getLatestContentForStep(2).then(c => openMdProViewerWithCopy(c)), 'sm'));
      r.appendChild(makeCircleBtn(() => getLatestContentForStep(2).then(c => showContentViewer(stepLabels[2], c || '(내용 없음)'))));
      return r;
    }
    function row3() {
      const r = document.createElement('div');
      r.className = 'gt-row';
      r.appendChild(makeBtn(iconStep3, '3단계: 선택 코딩', () => fillPrompt(3, immediateCheck.checked), 'main'));
      r.appendChild(makeBtn(iconSave, '답변 저장', () => saveResponse(3), 'sm'));
      r.appendChild(makeBtn(iconWindow, '새창보기', () => getLatestContentForStep(3).then(c => openMdProViewerWithCopy(c)), 'sm'));
      r.appendChild(makeCircleBtn(() => getLatestContentForStep(3).then(c => showContentViewer(stepLabels[3], c || '(내용 없음)'))));
      return r;
    }
    function row4() {
      const r = document.createElement('div');
      r.className = 'gt-row';
      r.appendChild(makeBtn(iconSave, '답변 스크랩', scrapCurrentResponse, ''));
      r.appendChild(makeBtn('', '합쳐서 보기', showCombinedView, ''));
      r.appendChild(makeBtn(iconWindow, '새창보기', () => {
        getAllFromStorage().then(list => {
          const sorted = (list || []).slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
          const parts = sorted.map(r => (r.content || '').trim());
          openMdProViewerWithCopy(parts.join('\n\n---\n\n'));
        });
      }, 'sm'));
      r.appendChild(makeCircleBtn(() => {
        getAllFromStorage().then(list => {
          const sorted = (list || []).slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
          if (!sorted.length) {
            showContentViewer('합쳐서 보기', '저장된 단계별 답변이 없습니다.');
            return;
          }
          const parts = sorted.map(r => (stepLabels[r.step] || '단계 ' + r.step) + '\n\n' + (r.content || '').trim() + '\n');
          showContentViewer('합쳐서 보기', parts.join('\n---\n\n'));
        });
      }));
      return r;
    }
    function row5() {
      const r = document.createElement('div');
      r.className = 'gt-row';
      r.appendChild(makeBtn(iconDownload, 'MD 다운로드', downloadMd, ''));
      r.appendChild(makeBtn('', '답변 스크랩 모아보기', showScrapsView, ''));
      r.appendChild(makeBtn(iconWindow, '새창보기', () => getAllScraps().then(list => {
        const text = list.map(r => (r.content || '').trim()).join('\n\n---\n\n');
        openMdProViewerWithCopy(text);
      }), 'sm'));
      r.appendChild(makeCircleBtn(() => {
        getAllScraps().then(list => {
          if (!list.length) {
            showContentViewer('답변 스크랩 모아보기', '스크랩된 답변이 없습니다.');
            return;
          }
          const text = list.map((r, i) => '[' + (i + 1) + ']\n\n' + (r.content || '').trim() + '\n').join('\n---\n\n');
          showContentViewer('답변 스크랩 모아보기', text);
        });
      }));
      return r;
    }

    container.appendChild(header);
    container.appendChild(immediateWrap);
    container.appendChild(row1());
    container.appendChild(row2());
    container.appendChild(row3());
    container.appendChild(row4());
    container.appendChild(row5());
    document.body.appendChild(container);
  }

  function waitForDOM() {
    if (document.body) {
      injectUI();
      return;
    }
    const observer = new MutationObserver(() => {
      if (document.body) {
        observer.disconnect();
        injectUI();
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    if (document.body) injectUI();
  }

  function fillPrompt(step, runImmediately) {
    if (runImmediately === undefined) runImmediately = true;
    lastUsedStep = step;
    const textarea = findQueryTextarea();
    if (!textarea) {
      alert('쿼리 입력란이 아직 없습니다. 채팅 패널이 열린 뒤 다시 시도하세요.');
      return;
    }
    getPrompts().then(function (prompts) {
      const text = prompts['step' + step];
      textarea.value = text;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
      textarea.focus();

      if (!runImmediately) return;
      const submitBtn = findSubmitButton();
      if (submitBtn) {
        setTimeout(() => submitBtn.click(), 80);
      } else {
        const form = textarea.closest('form');
        if (form) {
          setTimeout(() => form.requestSubmit(), 80);
        }
      }
    });
  }

  // ---------- chrome.storage.local (팝업과 공유) ----------
  function saveToStorage(step, content) {
    return chrome.storage.local.get(STORAGE_KEY).then(data => {
      const list = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
      list.push({ step, content, createdAt: Date.now() });
      return chrome.storage.local.set({ [STORAGE_KEY]: list });
    });
  }

  function getAllFromStorage() {
    return chrome.storage.local.get(STORAGE_KEY).then(data =>
      Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : []
    );
  }

  function getLatestContentForStep(step) {
    return getAllFromStorage().then(list => {
      const forStep = list.filter(r => r.step === step).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      return forStep[0] ? forStep[0].content : '';
    });
  }

  function appendToScraps(content) {
    return chrome.storage.local.get(SCRAP_STORAGE_KEY).then(data => {
      const list = Array.isArray(data[SCRAP_STORAGE_KEY]) ? data[SCRAP_STORAGE_KEY] : [];
      list.push({ content, createdAt: Date.now() });
      return chrome.storage.local.set({ [SCRAP_STORAGE_KEY]: list });
    });
  }

  function getAllScraps() {
    return chrome.storage.local.get(SCRAP_STORAGE_KEY).then(data =>
      Array.isArray(data[SCRAP_STORAGE_KEY]) ? data[SCRAP_STORAGE_KEY] : []
    );
  }

  const GT_PASTE_STORAGE_KEY = 'gtPasteContent';

  function openMdProViewerWithCopy(content) {
    const text = (content && typeof content === 'string') ? content : '';
    if (text) {
      navigator.clipboard.writeText(text).catch(() => {});
      chrome.storage.local.set({ [GT_PASTE_STORAGE_KEY]: text }).then(() => {
        window.open(MD_PRO_VIEWER_URL + '?from=gt-assistant', '_blank');
      });
    } else {
      window.open(MD_PRO_VIEWER_URL, '_blank');
    }
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function markdownToHtml(md) {
    if (!md || typeof md !== 'string') return '';
    let s = escapeHtml(md).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = s.split('\n');
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const t = line.trim();
      if (t.startsWith('### ')) { out.push('<h3>' + t.slice(4) + '</h3>'); continue; }
      if (t.startsWith('## ')) { out.push('<h2>' + t.slice(3) + '</h2>'); continue; }
      if (t.startsWith('# ')) { out.push('<h1>' + t.slice(2) + '</h1>'); continue; }
      if (/^---\s*$/.test(t)) { out.push('<hr>'); continue; }
      if (/^\d+\.\s+/.test(t)) { out.push('<p>' + line.replace(/^\d+\.\s+/, '') + '</p>'); continue; }
      if (/^[-*]\s+/.test(t)) { out.push('<p>' + line.replace(/^[-*]\s+/, '') + '</p>'); continue; }
      if (t === '') { out.push('<p></p>'); continue; }
      const escaped = line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>');
      out.push('<p>' + escaped + '</p>');
    }
    return out.join('\n');
  }

  function showContentViewer(viewTitle, rawContent) {
    const existing = document.getElementById('gt-assistant-viewer');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'gt-assistant-viewer';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;padding:24px;';

    const box = document.createElement('div');
    box.style.cssText = 'background:#2d2f32;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.12);display:flex;flex-direction:column;min-width:320px;min-height:240px;width:72vw;height:70vh;max-width:900px;max-height:85vh;position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);';

    const head = document.createElement('div');
    head.style.cssText = 'padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.1);font-weight:600;color:#fff;display:flex;align-items:center;justify-content:space-between;gap:8px;cursor:move;user-select:none;flex-shrink:0;';
    head.textContent = viewTitle;

    const btns = document.createElement('div');
    btns.style.cssText = 'display:flex;align-items:center;gap:6px;';
    const btnView = document.createElement('button');
    btnView.textContent = '보기';
    btnView.style.cssText = 'padding:6px 12px;cursor:pointer;border:none;border-radius:6px;background:rgba(52,168,83,0.9);color:#fff;font-size:12px;';
    const btnSaveMd = document.createElement('button');
    btnSaveMd.textContent = 'md 저장';
    btnSaveMd.style.cssText = 'padding:6px 12px;cursor:pointer;border:none;border-radius:6px;background:rgba(95,99,104,0.9);color:#fff;font-size:12px;';
    const btnClose = document.createElement('button');
    btnClose.textContent = '닫기';
    btnClose.style.cssText = 'padding:6px 12px;cursor:pointer;border:none;border-radius:6px;background:rgba(95,99,104,0.9);color:#fff;font-size:12px;';
    btns.appendChild(btnView);
    btns.appendChild(btnSaveMd);
    btns.appendChild(btnClose);
    head.appendChild(btns);

    const body = document.createElement('div');
    body.style.cssText = 'flex:1;overflow:auto;padding:0;font-size:13px;line-height:1.6;color:#e8eaed;display:flex;flex-direction:column;min-height:0;';
    const textarea = document.createElement('textarea');
    textarea.style.cssText = 'flex:1;margin:0;padding:16px;font-size:13px;line-height:1.6;color:#e8eaed;background:#1e1e1e;border:none;border-radius:0;resize:none;font-family:inherit;white-space:pre-wrap;word-break:break-word;';
    textarea.value = rawContent && rawContent.trim() ? rawContent : '';
    textarea.placeholder = '(내용 없음)';
    const divRendered = document.createElement('div');
    divRendered.style.cssText = 'display:none;flex:1;overflow:auto;padding:16px;';
    divRendered.innerHTML = '<style>.gt-viewer h1{font-size:1.25em;margin:.8em 0 .4em}.gt-viewer h2{font-size:1.1em;margin:.7em 0 .35em}.gt-viewer h3{font-size:1em;margin:.6em 0 .3em}.gt-viewer p{margin:.4em 0}.gt-viewer hr{border:none;border-top:1px solid rgba(255,255,255,.2);margin:1em 0}</style><div class="gt-viewer">' + markdownToHtml(rawContent || '') + '</div>';
    body.appendChild(textarea);
    body.appendChild(divRendered);

    function getCurrentContent() {
      return textarea.value.trim() || '';
    }

    let viewMode = 'raw';
    btnView.addEventListener('click', () => {
      viewMode = viewMode === 'raw' ? 'rendered' : 'raw';
      textarea.style.display = viewMode === 'raw' ? 'block' : 'none';
      divRendered.style.display = viewMode === 'rendered' ? 'block' : 'none';
      if (viewMode === 'rendered') {
        divRendered.innerHTML = '<style>.gt-viewer h1{font-size:1.25em;margin:.8em 0 .4em}.gt-viewer h2{font-size:1.1em;margin:.7em 0 .35em}.gt-viewer h3{font-size:1em;margin:.6em 0 .3em}.gt-viewer p{margin:.4em 0}.gt-viewer hr{border:none;border-top:1px solid rgba(255,255,255,.2);margin:1em 0}</style><div class="gt-viewer">' + markdownToHtml(getCurrentContent()) + '</div>';
      }
      btnView.textContent = viewMode === 'raw' ? '보기' : '원문';
    });
    btnSaveMd.addEventListener('click', () => {
      const content = getCurrentContent();
      const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (viewTitle.replace(/\s+/g, '-') || 'export') + '-' + Date.now() + '.md';
      a.click();
      URL.revokeObjectURL(url);
    });
    btnClose.addEventListener('click', () => overlay.remove());

    head.addEventListener('mousedown', function (e) {
      if (e.target.tagName === 'BUTTON') return;
      if (e.button !== 0) return;
      e.preventDefault();
      const rect = box.getBoundingClientRect();
      let startX = e.clientX, startY = e.clientY, startLeft = rect.left, startTop = rect.top;
      box.style.left = startLeft + 'px';
      box.style.top = startTop + 'px';
      box.style.transform = 'none';
      function move(e) {
        startLeft += e.clientX - startX;
        startTop += e.clientY - startY;
        startX = e.clientX;
        startY = e.clientY;
        box.style.left = startLeft + 'px';
        box.style.top = startTop + 'px';
      }
      function stop() {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', stop);
      }
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', stop);
    });

    const resizeHandle = document.createElement('div');
    resizeHandle.style.cssText = 'position:absolute;right:0;bottom:0;width:20px;height:20px;cursor:nwse-resize;';
    resizeHandle.innerHTML = '<svg width="20" height="20" viewBox="0 0 20 20" fill="rgba(255,255,255,0.3)"><path d="M20 20v-4l-4 4h4z"/></svg>';
    let resizeStartX, resizeStartY, resizeStartW, resizeStartH;
    resizeHandle.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = box.getBoundingClientRect();
      resizeStartX = e.clientX;
      resizeStartY = e.clientY;
      resizeStartW = rect.width;
      resizeStartH = rect.height;
      box.style.left = rect.left + 'px';
      box.style.top = rect.top + 'px';
      box.style.transform = 'none';
      box.style.width = resizeStartW + 'px';
      box.style.height = resizeStartH + 'px';
      function move(e) {
        const w = Math.max(280, resizeStartW + (e.clientX - resizeStartX));
        const h = Math.max(200, resizeStartH + (e.clientY - resizeStartY));
        box.style.width = w + 'px';
        box.style.height = h + 'px';
      }
      function stop() {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', stop);
      }
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', stop);
    });

    box.appendChild(head);
    box.appendChild(body);
    box.appendChild(resizeHandle);
    overlay.appendChild(box);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }

  function showModal(title, bodyText) {
    showContentViewer(title, bodyText);
  }

  async function saveResponse(step) {
    const copyBtn = findLastCopyButton();
    if (!copyBtn) {
      alert('저장할 답변이 없습니다. 먼저 NotebookLM에서 답변을 받은 뒤 시도하세요.');
      return;
    }

    const domText = getFullMessageTextFromDOM(copyBtn);

    copyBtn.click();

    const delay = ms => new Promise(r => setTimeout(r, ms));
    await delay(500);

    let clipboardText = '';
    try {
      clipboardText = await navigator.clipboard.readText();
    } catch (e) {}

    const content = [domText, clipboardText].filter(Boolean).sort((a, b) => b.length - a.length)[0] || domText || clipboardText;

    if (!content.trim()) {
      alert('클립보드에서 내용을 읽지 못했습니다. 답변 영역의 복사 버튼을 한 번 직접 눌러 본 뒤 다시 "답변 저장"을 시도하세요.');
      return;
    }

    try {
      await saveToStorage(step, content);
      alert('저장되었습니다.');
    } catch (err) {
      alert('저장 실패: ' + (err && err.message ? err.message : String(err)));
    }
  }

  async function scrapCurrentResponse() {
    const copyBtn = findLastCopyButton();
    if (!copyBtn) {
      alert('저장할 답변이 없습니다. 먼저 NotebookLM에서 답변을 받은 뒤 시도하세요.');
      return;
    }
    const domText = getFullMessageTextFromDOM(copyBtn);
    copyBtn.click();
    const delay = ms => new Promise(r => setTimeout(r, ms));
    await delay(500);
    let clipboardText = '';
    try { clipboardText = await navigator.clipboard.readText(); } catch (e) {}
    const content = [domText, clipboardText].filter(Boolean).sort((a, b) => b.length - a.length)[0] || domText || clipboardText;
    if (!content.trim()) {
      alert('내용을 가져오지 못했습니다.');
      return;
    }
    try {
      await appendToScraps(content);
      alert('스크랩에 추가되었습니다.');
    } catch (err) {
      alert('저장 실패: ' + (err && err.message ? err.message : String(err)));
    }
  }

  function showCombinedView() {
    getAllFromStorage().then(list => {
      const sorted = (list || []).slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      if (sorted.length === 0) {
        showModal('합쳐서 보기', '저장된 단계별 답변이 없습니다.');
        return;
      }
      const parts = sorted.map(r => {
        const title = stepLabels[r.step] || ('단계 ' + r.step);
        return title + '\n\n' + (r.content || '').trim() + '\n';
      });
      showModal('합쳐서 보기 (1·2·3단계 통합)', parts.join('\n---\n\n'));
    });
  }

  function showScrapsView() {
    getAllScraps().then(list => {
      if (!list.length) {
        showModal('답변 스크랩 모아보기', '스크랩된 답변이 없습니다.');
        return;
      }
      const parts = list.map((r, i) => `[${i + 1}]\n\n` + (r.content || '').trim() + '\n');
      showModal('답변 스크랩 모아보기', parts.join('\n---\n\n'));
    });
  }

  function downloadMd() {
    getAllFromStorage().then(rows => {
      const sorted = (rows || []).slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      if (sorted.length === 0) {
        alert('저장된 답변이 없습니다.');
        return;
      }
      const parts = sorted.map(r => {
        const title = stepLabels[r.step] || ('단계 ' + r.step);
        return `# ${title}\n\n${(r.content || '').trim()}\n`;
      });
      const md = parts.join('\n---\n\n');
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `notebooklm-gt-${Date.now()}.md`;
      a.click();
      URL.revokeObjectURL(url);
    }).catch(err => {
      alert('다운로드 실패: ' + (err && err.message ? err.message : String(err)));
    });
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'fillPrompt' && typeof msg.step === 'number') {
      fillPrompt(msg.step, msg.runImmediately !== false);
      sendResponse({ ok: true });
    } else if (msg.action === 'showPanel') {
      const root = document.getElementById('gt-assistant-root');
      if (root) {
        root.style.display = 'flex';
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false });
      }
    }
    return true;
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForDOM);
  } else {
    waitForDOM();
  }
})();
