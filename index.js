// Chat Searching
// 검색 범위: 현재 채팅 / 선택한 캐릭터의 전체 채팅 / SillyTavern 전체 채팅(모든 캐릭터)
// DOM에 렌더링됐는지, is_system(고스트)으로 숨겨졌는지와 무관하게
// 저장된 원본 메시지 배열을 대상으로 검색함.
// + 검색 결과 북마크 (localStorage)
// + 다크/라이트 테마 토글 (localStorage에 저장돼서 다음에 열 때도 유지됨)

const BOOKMARK_KEY = 'chatSearching_bookmarks_v1';
const THEME_KEY = 'chatSearching_theme_v1';

const ICONS = {
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    bookmark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-6 8-6s8 2 8 6"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="M12 2.5 15 9l7 .9-5.1 4.8L18.2 21 12 17.3 5.8 21l1.3-6.3L2 9.9 9 9l3-6.5Z"/></svg>',
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"/></svg>',
};

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

function highlightFull(text, query) {
    const escaped = escapeHtml(text);
    const escapedQuery = escapeHtml(query);
    // escapeHtml 이후 문자열 기준으로 대소문자 무시 전체 치환
    const re = new RegExp(escapedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    return escaped.replace(re, (m) => `<mark>${m}</mark>`);
}

// ---------- 테마 ----------

function getSavedTheme() {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
}

function applyTheme(theme) {
    const $panel = $('.cs-panel');
    $panel.removeClass('cs-theme-dark cs-theme-light').addClass(`cs-theme-${theme}`);
    // 다음에 누르면 반대 테마로 갈 거라는 걸 아이콘으로 보여줌
    $('#cs-theme-btn').html(theme === 'dark' ? ICONS.sun : ICONS.moon)
        .attr('title', theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환');
    localStorage.setItem(THEME_KEY, theme);
}

function toggleTheme() {
    const current = getSavedTheme();
    applyTheme(current === 'dark' ? 'light' : 'dark');
}

// ---------- 북마크 저장소 (localStorage) ----------

function makeBookmarkId(entry) {
    // 같은 캐릭터/파일/메시지 인덱스면 같은 결과로 취급
    return `${entry.avatarUrl || 'na'}::${entry.fileName || 'current'}::${entry.msgIndex ?? 'x'}`;
}

function loadBookmarks() {
    try {
        return JSON.parse(localStorage.getItem(BOOKMARK_KEY) || '[]');
    } catch (err) {
        console.warn('[chat-searching] 북마크 파싱 실패', err);
        return [];
    }
}

function saveBookmarks(list) {
    localStorage.setItem(BOOKMARK_KEY, JSON.stringify(list));
}

function isBookmarked(id) {
    return loadBookmarks().some((b) => b.id === id);
}

function addBookmark(entry) {
    const list = loadBookmarks();
    if (!list.some((b) => b.id === entry.id)) {
        list.unshift({ ...entry, savedAt: Date.now() });
        saveBookmarks(list);
    }
}

function removeBookmark(id) {
    saveBookmarks(loadBookmarks().filter((b) => b.id !== id));
}

// ---------- 검색 로직 ----------

// content 배열(원본 채팅 메시지 배열) 하나를 대상으로 검색해서 매칭된 항목들 리턴
function matchInContent(content, query, meta) {
    const matches = [];
    const lowerQuery = query.toLowerCase();
    for (let j = 0; j < content.length; j++) {
        const msg = content[j];
        if (!msg || typeof msg.mes !== 'string') continue; // 0번 메타데이터 라인 등 스킵

        const original = msg.mes;
        // ST 번역 확장은 원문(mes.mes)은 그대로 두고
        // 번역문을 mes.extra.display_text에 따로 저장해서 화면에만 보여줌.
        const translated = msg.extra?.display_text;

        const matchedOriginal = original.toLowerCase().includes(lowerQuery);
        const matchedTranslated = typeof translated === 'string' && translated.toLowerCase().includes(lowerQuery);

        if (matchedOriginal || matchedTranslated) {
            matches.push({
                ...meta,
                msgIndex: j,
                name: msg.name,
                isUser: msg.is_user,
                isSystem: msg.is_system,
                mes: matchedTranslated && !matchedOriginal ? translated : original,
                matchedTranslated,
            });
        }
    }
    return matches;
}

// 현재 열려있는 채팅(메모리 상의 context.chat)만 검색 - 서버 요청 없이 즉시 검색됨
async function searchCurrentChat(query) {
    const context = SillyTavern.getContext();
    const $results = $('#cs-results');

    const charIndex = context.characterId;
    if (charIndex === undefined || charIndex === null) {
        $results.html('<div class="cs-empty">캐릭터를 먼저 선택해줘. (그룹챗은 아직 미지원)</div>');
        return;
    }
    const character = context.characters[charIndex];
    if (!Array.isArray(context.chat) || context.chat.length === 0) {
        $results.html('<div class="cs-empty">현재 열려있는 채팅이 없어.</div>');
        return;
    }

    const matches = matchInContent(context.chat, query, {
        fileName: context.chatId || '현재 채팅',
        avatarUrl: character.avatar,
        charName: character.name,
    });

    renderResults($results, matches, query, { showCharBadge: false });
}

// 캐릭터 한 명의 전체 채팅 파일들을 검색
async function searchOneCharacterAllChats(query, character, $results, opts = {}) {
    const avatarUrl = character.avatar;
    const chName = character.name;

    let chatList;
    try {
        chatList = await fetchChatList(avatarUrl);
    } catch (err) {
        console.error('[chat-searching] 채팅 목록 실패', err);
        if (!opts.silentErrors) {
            $results.html('<div class="cs-empty">채팅 목록을 못 불러왔어. 콘솔(F12) 확인해줘.</div>');
        }
        return [];
    }

    const allMatches = [];
    for (let i = 0; i < chatList.length; i++) {
        const fileName = chatList[i].file_name;
        if (opts.onProgress) opts.onProgress(i + 1, chatList.length, fileName);

        let content;
        try {
            content = await fetchChatContent(chName, avatarUrl, fileName);
        } catch (err) {
            console.warn(`[chat-searching] ${fileName} 스킵됨`, err);
            continue;
        }
        allMatches.push(...matchInContent(content, query, { fileName, avatarUrl, charName: chName }));
    }
    return allMatches;
}

async function searchCharacterScope(query) {
    const context = SillyTavern.getContext();
    const $results = $('#cs-results');
    const avatarUrl = $('#cs-char-select').val();

    if (!avatarUrl) {
        $results.html('<div class="cs-empty">캐릭터를 선택해줘.</div>');
        return;
    }
    const character = context.characters.find((c) => c.avatar === avatarUrl);
    if (!character) {
        $results.html('<div class="cs-empty">선택한 캐릭터를 찾을 수 없어.</div>');
        return;
    }

    $results.html('<div class="cs-loading">채팅 목록 불러오는 중...</div>');
    const matches = await searchOneCharacterAllChats(query, character, $results, {
        onProgress: (i, total, fileName) => {
            $results.html(`<div class="cs-loading">${i}/${total} 채팅 파일 검색 중...<br>(${escapeHtml(fileName)})</div>`);
        },
    });

    if (!$results.find('.cs-empty').length) {
        renderResults($results, matches, query, { showCharBadge: false });
    }
}

// 모든 캐릭터의 모든 채팅을 검색 (시간 좀 걸릴 수 있음)
async function searchAllScope(query) {
    const context = SillyTavern.getContext();
    const $results = $('#cs-results');
    const characters = context.characters || [];

    if (!characters.length) {
        $results.html('<div class="cs-empty">캐릭터가 없어.</div>');
        return;
    }

    const allMatches = [];
    for (let c = 0; c < characters.length; c++) {
        const character = characters[c];
        const found = await searchOneCharacterAllChats(query, character, $results, {
            silentErrors: true,
            onProgress: (i, total, fileName) => {
                $results.html(
                    `<div class="cs-loading">캐릭터 ${c + 1}/${characters.length} (${escapeHtml(character.name)})<br>` +
                    `${i}/${total} 파일 검색 중... (${escapeHtml(fileName)})</div>`,
                );
            },
        });
        allMatches.push(...found);
    }

    renderResults($results, allMatches, query, { showCharBadge: true });
}

function currentScope() {
    return $('.cs-segment button.active').data('scope') || 'character';
}

async function runSearch(query) {
    const scope = currentScope();
    if (scope === 'current') {
        await searchCurrentChat(query);
    } else if (scope === 'character') {
        await searchCharacterScope(query);
    } else {
        await searchAllScope(query);
    }
}

// ---------- 결과 렌더링 ----------

function renderResults($container, matches, query, opts = {}) {
    $container.empty();
    if (!matches || matches.length === 0) {
        $container.html('<div class="cs-empty">일치하는 결과가 없어.</div>');
        return;
    }

    for (const match of matches) {
        const id = makeBookmarkId(match);
        const bookmarked = isBookmarked(id);
        const roleChip = match.isSystem ? '👻 숨김' : (match.isUser ? '🧑 유저' : '🤖 AI');
        const langChip = match.matchedTranslated ? '<span class="cs-chip">🌐 번역본</span>' : '';
        const charChip = opts.showCharBadge && match.charName
            ? `<span class="cs-chip cs-chip-char">${escapeHtml(match.charName)}</span>`
            : '';
        const $row = $(`
            <div class="cs-row">
                <div class="cs-meta">
                    ${charChip}
                    <span class="cs-chip">${escapeHtml(String(match.fileName))}</span>
                    <span class="cs-chip">${roleChip}</span>
                    ${langChip}
                    <span class="cs-name">${escapeHtml(match.name || '')}</span>
                    <div class="cs-star ${bookmarked ? 'cs-star-on' : ''}" title="북마크">${ICONS.star}</div>
                </div>
                <div class="cs-snippet">${highlightSnippet(match.mes, query)}</div>
                <div class="cs-expand-hint">탭해서 전체 보기</div>
            </div>
        `);

        let expanded = false;
        const $snippet = $row.find('.cs-snippet');
        const $hint = $row.find('.cs-expand-hint');
        const $star = $row.find('.cs-star');

        $row.on('click', (e) => {
            if ($(e.target).closest('.cs-star').length) return; // 별 클릭은 아래에서 따로 처리
            expanded = !expanded;
            if (expanded) {
                $snippet.html(highlightFull(match.mes, query));
                $hint.text('탭해서 접기');
            } else {
                $snippet.html(highlightSnippet(match.mes, query));
                $hint.text('탭해서 전체 보기');
            }
        });

        $star.on('click', (e) => {
            e.stopPropagation();
            if ($star.hasClass('cs-star-on')) {
                removeBookmark(id);
                $star.removeClass('cs-star-on');
            } else {
                addBookmark({ id, ...match, query });
                $star.addClass('cs-star-on');
            }
        });

        $container.append($row);
    }
}

function renderBookmarksView() {
    const $view = $('#cs-bookmarks-view');
    const bookmarks = loadBookmarks();
    $view.empty();

    if (!bookmarks.length) {
        $view.html('<div class="cs-empty">저장한 북마크가 없어.</div>');
        return;
    }

    for (const b of bookmarks) {
        const roleChip = b.isSystem ? '👻 숨김' : (b.isUser ? '🧑 유저' : '🤖 AI');
        const charChip = b.charName ? `<span class="cs-chip cs-chip-char">${escapeHtml(b.charName)}</span>` : '';
        const $row = $(`
            <div class="cs-row">
                <div class="cs-meta">
                    ${charChip}
                    <span class="cs-chip">${escapeHtml(String(b.fileName))}</span>
                    <span class="cs-chip">${roleChip}</span>
                    <span class="cs-name">${escapeHtml(b.name || '')}</span>
                    <div class="cs-star cs-star-on" title="북마크 해제">${ICONS.star}</div>
                </div>
                <div class="cs-snippet">${b.query ? highlightSnippet(b.mes, b.query) : escapeHtml(b.mes.slice(0, 160))}</div>
                <div class="cs-expand-hint">탭해서 전체 보기</div>
            </div>
        `);

        let expanded = false;
        const $snippet = $row.find('.cs-snippet');
        const $hint = $row.find('.cs-expand-hint');
        const $star = $row.find('.cs-star');

        $row.on('click', (e) => {
            if ($(e.target).closest('.cs-star').length) return;
            expanded = !expanded;
            if (expanded) {
                $snippet.html(b.query ? highlightFull(b.mes, b.query) : escapeHtml(b.mes));
                $hint.text('탭해서 접기');
            } else {
                $snippet.html(b.query ? highlightSnippet(b.mes, b.query) : escapeHtml(b.mes.slice(0, 160)));
                $hint.text('탭해서 전체 보기');
            }
        });

        $star.on('click', (e) => {
            e.stopPropagation();
            removeBookmark(b.id);
            $row.remove();
            if (!loadBookmarks().length) {
                $view.html('<div class="cs-empty">저장한 북마크가 없어.</div>');
            }
        });

        $view.append($row);
    }
}

// ---------- UI ----------

function populateCharacterSelect() {
    const context = SillyTavern.getContext();
    const $select = $('#cs-char-select');
    const characters = (context.characters || []).slice().sort((a, b) => a.name.localeCompare(b.name, 'ko'));

    $select.empty();
    for (const c of characters) {
        $select.append(`<option value="${escapeHtml(c.avatar)}">${escapeHtml(c.name)}</option>`);
    }

    // 현재 활성 캐릭터가 있으면 기본 선택값으로 지정 (기존 동작과 호환)
    if (context.characterId !== undefined && context.characterId !== null) {
        const current = context.characters[context.characterId];
        if (current) $select.val(current.avatar);
    }
}

function updateScopeUI() {
    if (currentScope() === 'character') {
        $('#cs-char-select-wrap').show();
    } else {
        $('#cs-char-select-wrap').hide();
    }
}

function buildUI() {
    const modalHtml = `
        <div id="cs-modal" class="cs-modal" style="display:none;">
            <div class="cs-panel">
                <div class="cs-header">
                    <div class="cs-title">
                        <span class="cs-eyebrow">CHAT SEARCHING</span>
                        <span class="cs-title-main">채팅 검색</span>
                    </div>
                    <div class="cs-header-actions">
                        <div id="cs-theme-btn" class="cs-icon-btn" title="테마 전환"></div>
                        <div id="cs-bookmarks-btn" class="cs-icon-btn" title="북마크 보기">${ICONS.bookmark}</div>
                        <div id="cs-close" class="cs-icon-btn" title="닫기">${ICONS.close}</div>
                    </div>
                </div>

                <div class="cs-scope-bar">
                    <div class="cs-segment">
                        <button data-scope="current">현재 채팅</button>
                        <button data-scope="character" class="active">캐릭터 전체</button>
                        <button data-scope="all">모든 캐릭터</button>
                    </div>
                    <div id="cs-char-select-wrap" class="cs-char-select-wrap">
                        ${ICONS.user}
                        <select id="cs-char-select"></select>
                    </div>
                </div>

                <div class="cs-searchbar">
                    <div class="cs-input-wrap">
                        ${ICONS.search}
                        <input id="cs-input" type="text" placeholder="검색어 입력..." />
                    </div>
                    <button id="cs-search-btn" class="menu_button">검색</button>
                </div>

                <hr class="cs-divider">

                <div id="cs-results" class="cs-results"></div>
                <div id="cs-bookmarks-view" class="cs-results" style="display:none;"></div>
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

    applyTheme(getSavedTheme());

    $('#cs-close').on('click', () => closeModal());
    $('#cs-theme-btn').on('click', () => toggleTheme());
    $('#cs-search-btn').on('click', () => {
        const query = ($('#cs-input').val() || '').trim();
        if (query) runSearch(query);
    });
    $('#cs-input').on('keydown', (e) => {
        if (e.key === 'Enter') $('#cs-search-btn').trigger('click');
    });

    $('.cs-segment button').on('click', function () {
        $('.cs-segment button').removeClass('active');
        $(this).addClass('active');
        updateScopeUI();
    });

    $('#cs-bookmarks-btn').on('click', () => {
        const showingBookmarks = $('#cs-bookmarks-view').is(':visible');
        if (showingBookmarks) {
            $('#cs-bookmarks-view').hide();
            $('#cs-results').show();
            $('.cs-scope-bar, .cs-searchbar, .cs-divider').show();
            $('#cs-bookmarks-btn').removeClass('cs-icon-btn-active');
        } else {
            renderBookmarksView();
            $('#cs-results').hide();
            $('.cs-scope-bar, .cs-searchbar, .cs-divider').hide();
            $('#cs-bookmarks-view').show();
            $('#cs-bookmarks-btn').addClass('cs-icon-btn-active');
        }
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

    // 열 때마다 캐릭터 목록/기본 선택 최신화 + 북마크 보기는 닫고 검색 화면으로 리셋
    populateCharacterSelect();
    updateScopeUI();
    $('#cs-bookmarks-view').hide();
    $('#cs-results').show();
    $('.cs-scope-bar, .cs-searchbar, .cs-divider').show();
    $('#cs-bookmarks-btn').removeClass('cs-icon-btn-active');

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
    console.log('[chat-searching] 로드됨 (v3: 새 디자인 + 다크/라이트 테마 토글)');
});
