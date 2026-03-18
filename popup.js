const STORAGE_KEY = 'gtResponses';
const SCRAP_STORAGE_KEY = 'gtScraps';
const PROMPTS_STORAGE_KEY = 'gtPrompts';
const stepLabels = { 1: '1단계: 개방 코딩', 2: '2단계: 축 코딩', 3: '3단계: 선택 코딩' };

const DEFAULT_PROMPTS = {
  step1: '[개방 코딩] 소스에서 현상을 라벨링하고 개념을 추출하세요. 모든 결과에 인용 근거를 포함하고 표 형식으로 정리하세요.',
  step2: '[축 코딩] 개방 코딩된 개념들을 연결하세요. 인과적 조건, 맥락, 작용/상호작용 전략, 결과라는 \'패러다임 모델\'에 맞춰 범주화하고, 각 연결의 근거를 소스에서 찾아 제시하세요.',
  step3: '[선택 코딩] 모든 범주를 통합하는 \'핵심 범주\' 하나를 도출하세요. 이를 바탕으로 전체 현상을 설명하는 스토리라인을 작성하고, 이론적 기틀을 제안하세요.'
};

function showToast(text) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2500);
}


function showView() {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-view').classList.add('active');
}

function showPromptScreen() {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-prompt').classList.add('active');
  chrome.storage.local.get(PROMPTS_STORAGE_KEY).then(data => {
    const p = data[PROMPTS_STORAGE_KEY] || DEFAULT_PROMPTS;
    document.getElementById('prompt-step1').value = p.step1 || '';
    document.getElementById('prompt-step2').value = p.step2 || '';
    document.getElementById('prompt-step3').value = p.step3 || '';
  });
}

function showMain() {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-main').classList.add('active');
}

function setRenderedPlainText(title, text) {
  const el = document.getElementById('rendered');
  el.textContent = text != null && text !== '' ? text : '(내용 없음)';
  showView();
}

function loadCombinedView() {
  chrome.storage.local.get(STORAGE_KEY).then(data => {
    const list = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
    if (list.length === 0) {
      setRenderedPlainText('합쳐서 보기', '저장된 단계별 답변이 없습니다.');
      return;
    }
    const sorted = list.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const parts = sorted.map(r => {
      const title = stepLabels[r.step] || ('단계 ' + r.step);
      return title + '\n\n' + (r.content || '').trim() + '\n';
    });
    setRenderedPlainText('합쳐서 보기', parts.join('\n---\n\n'));
  });
}

function loadScrapsView() {
  chrome.storage.local.get(SCRAP_STORAGE_KEY).then(data => {
    const list = Array.isArray(data[SCRAP_STORAGE_KEY]) ? data[SCRAP_STORAGE_KEY] : [];
    if (list.length === 0) {
      setRenderedPlainText('답변 스크랩 모아보기', '스크랩된 답변이 없습니다.');
      return;
    }
    const parts = list.map((r, i) => '[' + (i + 1) + ']\n\n' + (r.content || '').trim() + '\n');
    setRenderedPlainText('답변 스크랩 모아보기', parts.join('\n---\n\n'));
  });
}

function showPanel() {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    const tab = tabs[0];
    if (!tab || !tab.id) {
      showToast('탭을 찾을 수 없습니다.');
      return;
    }
    if (!tab.url || !tab.url.startsWith('https://notebooklm.google.com/')) {
      showToast('NotebookLM 페이지에서 열어주세요.');
      return;
    }
    chrome.tabs.sendMessage(tab.id, { action: 'showPanel' }, response => {
      if (chrome.runtime.lastError) {
        showToast('NotebookLM 페이지를 새로고침한 뒤 다시 시도하세요.');
        return;
      }
      showToast('패널을 표시했습니다.');
    });
  });
}

function sendFillPrompt(step) {
  const runImmediately = document.getElementById('chk-immediate').checked;
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    const tab = tabs[0];
    if (!tab || !tab.id) {
      showToast('탭을 찾을 수 없습니다.');
      return;
    }
    if (!tab.url || !tab.url.startsWith('https://notebooklm.google.com/')) {
      showToast('NotebookLM 페이지에서 열어주세요.');
      return;
    }
    chrome.tabs.sendMessage(tab.id, { action: 'fillPrompt', step, runImmediately }, response => {
      if (chrome.runtime.lastError) {
        showToast('NotebookLM 페이지를 새로고침한 뒤 다시 시도하세요.');
        return;
      }
      showToast(runImmediately ? '입력 후 전송했습니다.' : '채팅 입력창에 넣었습니다.');
    });
  });
}

function savePrompts() {
  const step1 = document.getElementById('prompt-step1').value.trim();
  const step2 = document.getElementById('prompt-step2').value.trim();
  const step3 = document.getElementById('prompt-step3').value.trim();
  chrome.storage.local.set({
    [PROMPTS_STORAGE_KEY]: {
      step1: step1 || DEFAULT_PROMPTS.step1,
      step2: step2 || DEFAULT_PROMPTS.step2,
      step3: step3 || DEFAULT_PROMPTS.step3
    }
  }).then(() => {
    showToast('저장되었습니다.');
    showMain();
  });
}

document.getElementById('btn-show-panel').addEventListener('click', showPanel);
document.getElementById('btn-prompt-config').addEventListener('click', showPromptScreen);
document.getElementById('btn-step1').addEventListener('click', () => sendFillPrompt(1));
document.getElementById('btn-step2').addEventListener('click', () => sendFillPrompt(2));
document.getElementById('btn-step3').addEventListener('click', () => sendFillPrompt(3));
document.getElementById('btn-combined').addEventListener('click', loadCombinedView);
document.getElementById('btn-scraps').addEventListener('click', loadScrapsView);
document.getElementById('btn-back').addEventListener('click', showMain);
document.getElementById('btn-prompt-back').addEventListener('click', showMain);
document.getElementById('btn-prompt-save').addEventListener('click', savePrompts);
