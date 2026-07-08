// Chat Searching
// 현재 선택된 캐릭터의 모든 채팅 파일(.jsonl)을 순회하며 텍스트 검색.
// DOM에 렌더링됐는지, is_system(고스트)으로 숨겨졌는지와 무관하게
// 저장된 원본 메시지 배열을 대상으로 검색함.

function getRequestHeadersSafe() {
    const context = SillyTavern.getContext();
    if (typeof context.getRequestHeaders === 'function') {
        return context.getRequestHeaders();
    }
    // 폴백: getRequestHeaders가 getContext에 없는 버전 대비
    const tokenMeta = document.querySelector('meta[name="csrf-token"]');
    return {
        'Content-Type': 'application/json',
        'X-CSRF-Token': tokenMeta ? tokenMeta.content : '',
    };
}

async function fetchChatList(avatarUrl) {
    const res = await fetch('/api/characters/chats', {
        method: 'POST',
        headers: getRequestHeadersSafe(),
        body: JSON.stringify({ avatar_url: avatarUrl }),
    });
    if (!res.ok) throw new Error(`chat list fetch failed: ${res.status}`);
    const data = await res.json();
    // 버전에 따라 배열 또는 객체로 올 수 있어서 둘 다 처리
    return Array.isArray(data) ? data : Object.values(data);
}

async function fetchChatContent(chName, avatarUrl, fileName) {
    const res = await fetch('/api/chats/get', {
        method: 'POST',
        headers: getRequestHeadersSafe(),
        body: JSON.stringify({
            ch_name: chName,
            avatar_url: avatarUrl,
            file_name: fileName.replace(/\.jsonl$/, ''),
        }),
    });
    if (!res.ok) throw new Error(`chat content fetch failed for ${fileName}: ${res.status}`);
    return res.json(); // [0] = 메타데이터, [1..] = 실제 메시지
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

function highlightSnippet(text, query, radius = 60) {
    const lower = text.toLowerCase();
    const idx = lower.indexOf(query.toLowerCase());
    if (idx === -1) return escapeHtml(text.slice(0, radius * 2));
    const start = Math.max(0, idx - radius);
    const end = Math.min(text.length, idx + query.length + radius);
    const before = escapeHtml(text.slice(start, idx));
    const match = escapeHtml(text.slice(idx, idx + query.length));
    const after = escapeHtml(text.slice(idx + query.length, end));
    return `${start > 0 ? '…' : ''}${before}<mark>${match}</mark>${after}${end < text.length ? '…' : ''}`;
}

async function runSearch(query) {
    const context = SillyTavern.getContext();
    const $results = $('#cs-results');
    $results.empty();

    const charIndex = context.characterId;
    if (charIndex === undefined || charIndex === null) {
        $results.html('<div class="cs-empty">캐릭터를 먼저 선택해줘. (그룹챗은 아직 미지원)</div>');
        return;
    }

    const character = context.characters[charIndex];
    const avatarUrl = character.avatar;
    const chName = character.name;

    $results.html('<div class="cs-loading">채팅 목록 불러오는 중...</div>');

    let chatList;
    try {
        chatList = await fetchChatList(avatarUrl);
    } catch (err) {
        console.error('[chat-searching] 채팅 목록 실패', err);
        $results.html('<div class="cs-empty">채팅 목록을 못 불러왔어. 콘솔(F12) 확인해줘.</div>');
        return;
    }

    if (!chatList.length) {
        $results.html('<div class="cs-empty">이 캐릭터의 채팅 파일이 없어.</div>');
        return;
    }

    const allMatches = [];
    for (let i = 0; i < chatList.length; i++) {
        const fileName = chatList[i].file_name;
        $results.html(`<div class="cs-loading">${i + 1}/${chatList.length} 채팅 파일 검색 중... (${escapeHtml(fileName)})</div>`);

        let content;
        try {
            content = await fetchChatContent(chName, avatarUrl, fileName);
        } catch (err) {
            console.warn(`[chat-searching] ${fileName} 스킵됨`, err);
            continue;
        }

        for (let j = 0; j < content.length; j++) {
            const msg = content[j];
            if (!msg || typeof msg.mes !== 'string') continue; // 0번 메타데이터 라인 등 스킵
            if (msg.mes.toLowerCase().includes(query.toLowerCase())) {
                allMatches.push({
                    fileName,
                    name: msg.name,
                    isUser: msg.is_user,
                    isSystem: msg.is_system,
                    mes: msg.mes,
                });
            }
        }
    }

    if (allMatches.length === 0) {
        $results.html('<div class="cs-empty">일치하는 결과가 없어.</div>');
        return;
    }

    $results.empty();
    for (const match of allMatches) {
        const badge = match.isSystem ? '👻 숨김' : (match.isUser ? '🧑 유저' : '🤖 AI');
        const $row = $(`
            <div class="cs-row">
                <div class="cs-meta">
                    <span class="cs-file">${escapeHtml(match.fileName)}</span>
                    <span class="cs-badge">${badge}</span>
                    <span class="cs-name">${escapeHtml(match.name || '')}</span>
                </div>
                <div class="cs-snippet">${highlightSnippet(match.mes, query)}</div>
                <button class="cs-jump menu_button">이 채팅 열기</button>
            </div>
        `);
        $row.find('.cs-jump').on('click', () => jumpToChat(match.fileName));
        $results.append($row);
    }
}

async function jumpToChat(fileName) {
    try {
        // openCharacterChat은 core script.js 함수라 getContext()에는 노출 안 됨.
        // ST 버전 업데이트로 경로/함수명이 바뀌면 여기서 에러날 수 있으니
        // 콘솔에 에러 뜨면 파일명 확인 후 수동으로 열어줘.
        const core = await import('../../../../script.js');
        if (typeof core.openCharacterChat === 'function') {
            await core.openCharacterChat(fileName.replace(/\.jsonl$/, ''));
            closeModal();
            return;
        }
        throw new Error('openCharacterChat 함수를 찾을 수 없음');
    } catch (err) {
        console.error('[chat-searching] 채팅 자동 열기 실패', err);
        toastr.warning(`자동으로 못 열었어. 파일명: ${fileName}`);
    }
}

function buildUI() {
    const modalHtml = `
        <div id="cs-modal" class="cs-modal" style="display:none;">
            <div class="cs-panel">
                <div class="cs-header">
                    <span>🔍 Chat Searching</span>
                    <span id="cs-close" class="cs-close">✕</span>
                </div>
                <div class="cs-searchbar">
                    <input id="cs-input" type="text" placeholder="검색어 입력..." />
                    <button id="cs-search-btn" class="menu_button">검색</button>
                </div>
                <div id="cs-results" class="cs-results"></div>
            </div>
        </div>
    `;

    // body가 아니라 html 바로 아래에 붙임.
    // ST가 모바일에서 body(또는 그 안의 래퍼)에 transform/zoom을 걸어두면
    // position:fixed 요소가 "화면"이 아니라 그 transform된 박스 기준으로
    // 위치가 계산돼서 옆으로 밀려 보이는 문제가 생김.
    // html 바로 아래(= body의 형제)에 붙이면 그 영향권에서 벗어남.
    const wrapper = document.createElement('div');
    wrapper.innerHTML = modalHtml.trim();
    const modalEl = wrapper.firstElementChild;
    document.documentElement.appendChild(modalEl);

    $('#cs-close').on('click', () => closeModal());
    $('#cs-search-btn').on('click', () => {
        const query = ($('#cs-input').val() || '').trim();
        if (query) runSearch(query);
    });
    $('#cs-input').on('keydown', (e) => {
        if (e.key === 'Enter') $('#cs-search-btn').trigger('click');
    });

    // 확장 메뉴(퍼즐 아이콘 드롭다운)에 진입 버튼 추가
    const entryHtml = `
        <div id="cs-entry" class="list-group-item flex-container flexGap5 interactable" tabindex="0">
            <div class="fa-solid fa-magnifying-glass"></div>
            <span>Chat Searching</span>
        </div>
    `;
    $('#extensionsMenu').append(entryHtml);
    $('#cs-entry').on('click', () => {
        openModal();
    });
}

function openModal() {
    // 배경 스크롤 잠그기 (모바일에서 팝업 열릴 때 화면 밀리는 현상 방지)
    $('body').css('overflow', 'hidden');
    $('#cs-modal').show();
    // 자동 포커스는 일부러 안 함 -> 열리자마자 키보드가 뜨면서
    // 모바일 뷰포트가 줄어들어 레이아웃이 밀리는 문제가 있었음
}

function closeModal() {
    $('#cs-modal').hide();
    $('body').css('overflow', '');
}

jQuery(async () => {
    buildUI();
    console.log('[chat-searching] 로드됨');
});
