// Chat Searching
// 검색 범위: 현재 채팅 / 선택한 캐릭터의 전체 채팅 / SillyTavern 전체 채팅(모든 캐릭터)
// DOM에 렌더링됐는지, is_system(고스트)으로 숨겨졌는지와 무관하게
// 저장된 원본 메시지 배열을 대상으로 검색함.
// + 검색 결과 북마크 (서버 측 extensionSettings에 저장 -> 폰/PC 어디서 열어도 동일하게 보임)
// + 다크/라이트 테마 토글 (마찬가지로 서버에 저장돼서 기기 상관없이 유지됨)

const SETTINGS_KEY = 'chatSearching';
// 예전 버전(로컬 저장 방식) 호환용 - 처음 한 번만 읽어서 서버로 옮기고 지움
const LEGACY_BOOKMARK_KEY = 'chatSearching_bookmarks_v1';
const LEGACY_THEME_KEY = 'chatSearching_theme_v1';

const ICONS = {
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    bookmark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-6 8-6s8 2 8 6"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="M12 2.5 15 9l7 .9-5.1 4.8L18.2 21 12 17.3 5.8 21l1.3-6.3L2 9.9 9 9l3-6.5Z"/></svg>',
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"/></svg>',
    tag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 9h16M4 15h16M10 3 7 21M17 3l-3 18"/></svg>',
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

// 현재 열려있지 않은 채팅 파일도 서버에 직접 저장 (태그 일괄 삭제용)
async function saveChatContentToFile(avatarUrl, fileName, content) {
    const res = await fetch('/api/chats/save', {
        method: 'POST',
        headers: getRequestHeadersSafe(),
        body: JSON.stringify({
            avatar_url: avatarUrl,
            file_name: fileName.replace(/\.jsonl$/, ''),
            chat: content,
            force: true,
        }),
    });
    if (!res.ok) throw new Error(`chat save failed for ${fileName}: ${res.status}`);
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

// ---------- 설정 저장소 (서버 측 extensionSettings) ----------
// ST는 extensionSettings를 계정 settings.json에 저장하기 때문에
// 폰/PC 어디서 접속하든(같은 ST 서버 계정 기준) 항상 동일한 값을 봄.

function getSettings() {
    const context = SillyTavern.getContext();
    if (!context.extensionSettings[SETTINGS_KEY] || typeof context.extensionSettings[SETTINGS_KEY] !== 'object') {
        context.extensionSettings[SETTINGS_KEY] = {};
    }
    const s = context.extensionSettings[SETTINGS_KEY];
    if (s.theme !== 'light' && s.theme !== 'dark') s.theme = 'dark';
    if (!Array.isArray(s.bookmarks)) s.bookmarks = [];
    if (typeof s.tagInsertEnabled !== 'boolean') s.tagInsertEnabled = true;
    return s;
}

function persistSettings() {
    // 디바운스로 서버에 저장(settings.json). 다른 기기에서 열면 이 값을 그대로 읽음.
    SillyTavern.getContext().saveSettingsDebounced();
}

// 예전(localStorage 전용) 버전에서 쓰던 데이터를 최초 1회만 서버로 옮겨줌
function migrateLegacyLocalStorage() {
    const settings = getSettings();
    if (settings._migratedFromLocalStorage) return;

    try {
        const legacyTheme = localStorage.getItem(LEGACY_THEME_KEY);
        if (legacyTheme === 'light' || legacyTheme === 'dark') {
            settings.theme = legacyTheme;
        }

        const legacyRaw = localStorage.getItem(LEGACY_BOOKMARK_KEY);
        if (legacyRaw) {
            const legacyBookmarks = JSON.parse(legacyRaw);
            if (Array.isArray(legacyBookmarks) && legacyBookmarks.length && !settings.bookmarks.length) {
                settings.bookmarks = legacyBookmarks;
            }
        }
    } catch (err) {
        console.warn('[chat-searching] 예전 로컬 저장 데이터 이전 실패', err);
    }

    settings._migratedFromLocalStorage = true;
    persistSettings();

    // 이전 끝났으면 옛날 키는 정리 (다음부터는 서버 값이 진짜 원본)
    localStorage.removeItem(LEGACY_THEME_KEY);
    localStorage.removeItem(LEGACY_BOOKMARK_KEY);
}

// ---------- 테마 ----------

function getSavedTheme() {
    return getSettings().theme;
}

function applyTheme(theme) {
    const $panel = $('.cs-panel');
    $panel.removeClass('cs-theme-dark cs-theme-light').addClass(`cs-theme-${theme}`);
    // 다음에 누르면 반대 테마로 갈 거라는 걸 아이콘으로 보여줌
    $('#cs-theme-btn').html(theme === 'dark' ? ICONS.sun : ICONS.moon)
        .attr('title', theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환');
    getSettings().theme = theme;
    persistSettings();
}

function toggleTheme() {
    const current = getSavedTheme();
    applyTheme(current === 'dark' ? 'light' : 'dark');
}

// ---------- 북마크 저장소 (서버 측 extensionSettings) ----------

function makeBookmarkId(entry) {
    // 같은 캐릭터/파일/메시지 인덱스면 같은 결과로 취급
    return `${entry.avatarUrl || 'na'}::${entry.fileName || 'current'}::${entry.msgIndex ?? 'x'}`;
}

function loadBookmarks() {
    return getSettings().bookmarks;
}

function saveBookmarks(list) {
    getSettings().bookmarks = list;
    persistSettings();
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

// ---------- 채팅 메시지 태그 버튼 (msg.extra.csTags에 저장) ----------
// 북마크/테마와 달리 태그는 "메시지 자체"에 속하는 데이터라서
// extensionSettings가 아니라 채팅 파일(msg.extra)에 저장함.
// 채팅 파일 자체가 서버에 있으니까 폰/PC 어디서 열어도 자동으로 같은 태그가 보임.

function getMsgExtraForTags(mesId) {
    const context = SillyTavern.getContext();
    const msg = context.chat?.[mesId];
    if (!msg) return null;
    if (!msg.extra || typeof msg.extra !== 'object') msg.extra = {};
    if (!Array.isArray(msg.extra.csTags)) msg.extra.csTags = [];
    return msg.extra;
}

async function persistChatTags() {
    const context = SillyTavern.getContext();
    try {
        if (typeof context.saveChat === 'function') {
            await context.saveChat();
        } else if (typeof context.saveChatConditional === 'function') {
            await context.saveChatConditional();
        } else {
            console.warn('[chat-searching] saveChat 함수를 못 찾았어. 태그가 서버에 저장 안 될 수 있어.');
        }
    } catch (err) {
        console.error('[chat-searching] 태그 저장 실패', err);
    }
}

function syncTagButtonActiveState(mesId) {
    const extra = getMsgExtraForTags(mesId);
    $(`.cs-tag-msg-btn[data-mesid="${mesId}"]`).toggleClass('cs-tag-msg-btn-active', !!(extra && extra.csTags.length));
}

let tagPopoverCleanup = null;

function closeTagPopover() {
    $('.cs-tag-popover').remove();
    $(document).off('click.csTagPopoverOutside');
    if (tagPopoverCleanup) {
        tagPopoverCleanup();
        tagPopoverCleanup = null;
    }
}

function positionTagPopover($pop, $anchorBtn) {
    const btnEl = $anchorBtn.get(0);
    if (!btnEl) return;
    const rect = btnEl.getBoundingClientRect();
    // visualViewport를 쓰면 모바일에서 키보드가 떠서 화면이 줄어든 상태도 반영됨
    const vv = window.visualViewport;
    const viewportHeight = vv ? vv.height : window.innerHeight;
    const viewportWidth = vv ? vv.width : window.innerWidth;
    const vvOffsetTop = vv ? vv.offsetTop : 0;
    const vvOffsetLeft = vv ? vv.offsetLeft : 0;

    // 일단 화면 밖에 그려서 실제 크기를 잰 다음, 화면(=키보드 위 보이는 영역) 안에 들어오게 좌표 계산
    $pop.css({ position: 'fixed', top: '-9999px', left: '-9999px', visibility: 'hidden', display: 'block', zIndex: 2147483647 });
    const popHeight = $pop.outerHeight();
    const popWidth = $pop.outerWidth();

    const viewportBottom = vvOffsetTop + viewportHeight;
    const viewportRight = vvOffsetLeft + viewportWidth;

    let top = rect.bottom + 4;
    if (top + popHeight > viewportBottom - 8) {
        // 아래에 공간이 부족하면 버튼 위쪽으로 띄움
        top = rect.top - popHeight - 4;
    }
    top = Math.max(vvOffsetTop + 8, Math.min(top, viewportBottom - popHeight - 8));

    let left = rect.left - 100;
    left = Math.max(vvOffsetLeft + 8, Math.min(left, viewportRight - popWidth - 8));

    $pop.css({ top, left, visibility: 'visible' });
}

function openTagPopover($anchorBtn, mesId) {
    closeTagPopover();
    const extra = getMsgExtraForTags(mesId);
    if (!extra) return;

    const $pop = $(`
        <div class="cs-tag-popover cs-theme-${getSavedTheme()}">
            <div class="cs-tag-popover-chips"></div>
            <div class="cs-tag-popover-input-row">
                <input type="text" class="cs-tag-popover-input" placeholder="태그 입력 후 Enter" />
            </div>
        </div>
    `);

    const renderChips = () => {
        const $chips = $pop.find('.cs-tag-popover-chips');
        $chips.empty();
        if (!extra.csTags.length) {
            $chips.append('<span class="cs-tag-popover-empty">아직 태그 없음</span>');
            return;
        }
        for (const tag of extra.csTags) {
            const $chip = $(`<span class="cs-tag-popover-chip">#${escapeHtml(tag)} <b class="cs-tag-popover-x">×</b></span>`);
            $chip.find('.cs-tag-popover-x').on('click', async () => {
                extra.csTags = extra.csTags.filter((t) => t !== tag);
                await persistChatTags();
                renderChips();
                syncTagButtonActiveState(mesId);
            });
            $chips.append($chip);
        }
    };
    renderChips();

    const $input = $pop.find('.cs-tag-popover-input');
    $input.on('keydown', async (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const raw = ($input.val() || '').trim().replace(/^#+/, '');
        $input.val('');
        if (!raw || extra.csTags.includes(raw)) return;
        extra.csTags.push(raw);
        await persistChatTags();
        renderChips();
        syncTagButtonActiveState(mesId);
    });

    // body가 아니라 html 바로 아래에 붙임 (모달과 동일한 이유: 모바일에서
    // body에 걸리는 transform/zoom의 영향권 밖에서 position:fixed가 화면 기준으로 계산되게 함)
    document.documentElement.appendChild($pop.get(0));
    positionTagPopover($pop, $anchorBtn);
    $input.trigger('focus');

    // 키보드가 뜨거나 접히면(visualViewport 크기 변화) 팝오버 위치도 다시 계산
    if (window.visualViewport) {
        const reposition = () => positionTagPopover($pop, $anchorBtn);
        window.visualViewport.addEventListener('resize', reposition);
        window.visualViewport.addEventListener('scroll', reposition);
        tagPopoverCleanup = () => {
            window.visualViewport.removeEventListener('resize', reposition);
            window.visualViewport.removeEventListener('scroll', reposition);
        };
    }

    setTimeout(() => {
        $(document).on('click.csTagPopoverOutside', (ev) => {
            if (!$(ev.target).closest('.cs-tag-popover, .cs-tag-msg-btn').length) {
                closeTagPopover();
            }
        });
    }, 0);
}

function addTagButtonToMessage(mesId) {
    if (!getSettings().tagInsertEnabled) return;
    const $mes = $(`.mes[mesid="${mesId}"]`);
    if (!$mes.length) return;
    const $btnRow = $mes.find('.mes_buttons');
    if (!$btnRow.length || $btnRow.find('.cs-tag-msg-btn').length) return;

    const extra = getMsgExtraForTags(Number(mesId));
    const hasTags = !!(extra && extra.csTags.length);

    const $btn = $(
        `<div class="mes_button cs-tag-msg-btn fa-solid fa-hashtag ${hasTags ? 'cs-tag-msg-btn-active' : ''}" title="태그 달기" data-mesid="${mesId}"></div>`,
    );
    // ST 내부에 "..." 전용 숨김 컨테이너가 따로 없는 버전도 있어서,
    // 컨테이너에 의존하지 않고 그냥 mes_buttons 안에 넣되 CSS로 기본 숨김 처리하고
    // "..." (extraMesButtonsHint) 클릭에 맞춰 우리 버튼만 따로 열고 닫음.
    const $hint = $btnRow.find('.extraMesButtonsHint');
    if ($hint.length) {
        $btn.insertBefore($hint);
    } else {
        $btnRow.append($btn);
    }
}

function removeAllTagButtons() {
    $('.cs-tag-msg-btn').remove();
    closeTagPopover();
}

function refreshAllMessageTagButtons() {
    removeAllTagButtons();
    if (!getSettings().tagInsertEnabled) return;
    $('#chat .mes').each(function () {
        const mesId = $(this).attr('mesid');
        if (mesId !== undefined) addTagButtonToMessage(mesId);
    });
}

function bindChatTagEvents() {
    $(document).on('click', '.cs-tag-msg-btn', function (e) {
        e.stopPropagation();
        const mesId = Number($(this).data('mesid'));
        openTagPopover($(this), mesId);
    });

    // ST의 "..." (더보기) 버튼을 누르면 우리 태그 버튼도 같이 열리고,
    // 다시 누르면 같이 닫히게 함 (ST 내부 숨김 컨테이너 클래스에 의존하지 않음)
    $(document).on('click', '.extraMesButtonsHint', function () {
        const $mes = $(this).closest('.mes');
        $mes.find('.cs-tag-msg-btn').toggleClass('cs-tag-msg-btn-open');
    });

    const context = SillyTavern.getContext();
    if (!context.eventSource || !context.event_types) {
        console.warn('[chat-searching] eventSource를 못 찾아서 메시지 태그 버튼 자동 부착이 제한될 수 있어.');
        return;
    }
    const { eventSource, event_types } = context;
    const onRendered = (mesId) => addTagButtonToMessage(mesId);
    ['MESSAGE_RENDERED', 'USER_MESSAGE_RENDERED', 'CHARACTER_MESSAGE_RENDERED'].forEach((key) => {
        if (event_types[key]) eventSource.on(event_types[key], onRendered);
    });
    if (event_types.CHAT_CHANGED) {
        eventSource.on(event_types.CHAT_CHANGED, () => setTimeout(refreshAllMessageTagButtons, 50));
    }
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

// ---------- 태그 수집 로직 (태그 클라우드 / 태그별 필터링) ----------

// content 배열 하나에서 태그가 달린 메시지만 뽑아옴
function collectTaggedMessages(content, meta) {
    const rows = [];
    for (let j = 0; j < content.length; j++) {
        const msg = content[j];
        if (!msg || typeof msg.mes !== 'string') continue;
        const tags = Array.isArray(msg.extra?.csTags) ? msg.extra.csTags : [];
        if (!tags.length) continue;
        rows.push({
            ...meta,
            msgIndex: j,
            name: msg.name,
            isUser: msg.is_user,
            isSystem: msg.is_system,
            mes: msg.extra?.display_text || msg.mes,
            tags,
        });
    }
    return rows;
}

// [ [tag, count], ... ] 형태로 많이 쓰인 순 정렬
function buildTagCounts(taggedRows) {
    const counts = new Map();
    for (const row of taggedRows) {
        for (const tag of row.tags) {
            counts.set(tag, (counts.get(tag) || 0) + 1);
        }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'));
}

function collectTaggedCurrentChat() {
    const context = SillyTavern.getContext();
    const charIndex = context.characterId;
    if (charIndex === undefined || charIndex === null || !Array.isArray(context.chat)) return [];
    const character = context.characters[charIndex];
    return collectTaggedMessages(context.chat, {
        fileName: context.chatId || '현재 채팅',
        avatarUrl: character?.avatar,
        charName: character?.name,
        isOpenChat: true,
    });
}

// 현재 열려있는 채팅 파일이면 서버에서 다시 안 긁어오고 메모리에 있는
// 실시간 데이터(context.chat)를 그대로 씀 -> 저장 직후에도 항상 최신 상태 반영
function isCurrentlyOpenChatFile(avatarUrl, fileName) {
    const context = SillyTavern.getContext();
    const charIndex = context.characterId;
    const currentAvatarUrl = (charIndex !== undefined && charIndex !== null)
        ? context.characters[charIndex]?.avatar
        : null;
    return avatarUrl === currentAvatarUrl && fileName === context.chatId;
}

async function getChatContentPreferLive(chName, avatarUrl, fileName) {
    if (isCurrentlyOpenChatFile(avatarUrl, fileName)) {
        return SillyTavern.getContext().chat;
    }
    return fetchChatContent(chName, avatarUrl, fileName);
}

async function collectTaggedOneCharacterAllChats(character, $container, opts = {}) {
    const avatarUrl = character.avatar;
    const chName = character.name;

    let chatList;
    try {
        chatList = await fetchChatList(avatarUrl);
    } catch (err) {
        console.error('[chat-searching] 채팅 목록 실패', err);
        if (!opts.silentErrors) {
            $container.html('<div class="cs-empty">채팅 목록을 못 불러왔어. 콘솔(F12) 확인해줘.</div>');
        }
        return [];
    }

    const rows = [];
    for (let i = 0; i < chatList.length; i++) {
        const fileName = chatList[i].file_name;
        if (opts.onProgress) opts.onProgress(i + 1, chatList.length, fileName);

        let content;
        try {
            content = await getChatContentPreferLive(chName, avatarUrl, fileName);
        } catch (err) {
            console.warn(`[chat-searching] ${fileName} 스킵됨`, err);
            continue;
        }
        rows.push(...collectTaggedMessages(content, {
            fileName,
            avatarUrl,
            charName: chName,
            isOpenChat: isCurrentlyOpenChatFile(avatarUrl, fileName),
        }));
    }
    return rows;
}

async function collectTaggedAllScope($container) {
    const context = SillyTavern.getContext();
    const characters = context.characters || [];
    const rows = [];
    for (let c = 0; c < characters.length; c++) {
        const character = characters[c];
        const found = await collectTaggedOneCharacterAllChats(character, $container, {
            silentErrors: true,
            onProgress: (i, total, fileName) => {
                $container.html(
                    `<div class="cs-loading">캐릭터 ${c + 1}/${characters.length} (${escapeHtml(character.name)})<br>` +
                    `${i}/${total} 파일 확인 중... (${escapeHtml(fileName)})</div>`,
                );
            },
        });
        rows.push(...found);
    }
    return rows;
}

let currentTaggedRows = [];

// 캐시된 태그 행들을 지금 선택된 스코프 기준으로 한 번 더 걸러줌
// (스코프를 바꾼 직후 등 캐시가 안 맞아떨어지는 경우에 대한 안전장치)
function rowsInCurrentScope(rows) {
    const scope = currentScope();
    if (scope === 'all') return rows;

    const context = SillyTavern.getContext();
    let avatarUrl = null;
    if (scope === 'current') {
        const charIndex = context.characterId;
        avatarUrl = (charIndex !== undefined && charIndex !== null) ? context.characters[charIndex]?.avatar : null;
    } else {
        avatarUrl = $('#cs-char-select').val();
    }
    if (!avatarUrl) return rows;
    return rows.filter((r) => r.avatarUrl === avatarUrl);
}

async function loadTagCloud() {
    const scope = currentScope();
    const $cloud = $('#cs-tag-cloud');
    const $tagResults = $('#cs-tag-results');
    $tagResults.empty();
    $cloud.html('<div class="cs-loading">태그 불러오는 중...</div>');

    let rows = [];
    if (scope === 'current') {
        rows = collectTaggedCurrentChat();
    } else if (scope === 'character') {
        const context = SillyTavern.getContext();
        const avatarUrl = $('#cs-char-select').val();
        const character = context.characters.find((c) => c.avatar === avatarUrl);
        if (!character) {
            $cloud.html('<div class="cs-empty">캐릭터를 선택해줘.</div>');
            return;
        }
        rows = await collectTaggedOneCharacterAllChats(character, $cloud, {
            onProgress: (i, total, fileName) => {
                $cloud.html(`<div class="cs-loading">${i}/${total} 채팅 파일 확인 중...<br>(${escapeHtml(fileName)})</div>`);
            },
        });
    } else {
        rows = await collectTaggedAllScope($cloud);
    }

    currentTaggedRows = rows;
    renderTagCloud(rowsInCurrentScope(rows), scope === 'all');
}

function renderTagCloud(rows, showCharBadge) {
    const $cloud = $('#cs-tag-cloud');
    const counts = buildTagCounts(rows);
    if (!counts.length) {
        $cloud.html('<div class="cs-empty">이 범위엔 태그가 하나도 없어. 채팅 메시지 옆 # 버튼으로 태그를 달아봐.</div>');
        return;
    }
    $cloud.empty();
    for (const [tag, count] of counts) {
        const $chip = $(`
            <div class="cs-tag-chip">
                <span class="cs-tag-chip-label">#${escapeHtml(tag)} <span class="cs-tag-count">${count}</span></span>
                <span class="cs-tag-chip-delete" title="이 태그 전부 삭제">${ICONS.close}</span>
            </div>
        `);
        $chip.find('.cs-tag-chip-label').on('click', () => {
            $('.cs-tag-chip').removeClass('active');
            $chip.addClass('active');
            const filtered = rowsInCurrentScope(currentTaggedRows).filter((r) => r.tags.includes(tag));
            renderResults($('#cs-tag-results'), filtered, '', { showCharBadge, tagMode: true });
        });
        $chip.find('.cs-tag-chip-delete').on('click', (e) => {
            e.stopPropagation();
            bulkDeleteTag(tag);
        });
        $cloud.append($chip);
    }
}

// 태그 하나를 스코프 안의 모든 메시지에서 한 번에 지움
async function bulkDeleteTag(tag) {
    const affected = rowsInCurrentScope(currentTaggedRows).filter((r) => r.tags.includes(tag));
    if (!affected.length) return;

    const confirmed = window.confirm(`#${tag} 태그를 ${affected.length}개 메시지에서 전부 지울까? 되돌릴 수 없어.`);
    if (!confirmed) return;

    // 같은 채팅 파일끼리 묶어서 파일당 한 번씩만 저장
    const byFile = new Map();
    for (const row of affected) {
        const key = row.isOpenChat ? '__open_chat__' : `${row.avatarUrl}::${row.fileName}`;
        if (!byFile.has(key)) {
            byFile.set(key, {
                avatarUrl: row.avatarUrl,
                fileName: row.fileName,
                charName: row.charName,
                isOpenChat: !!row.isOpenChat,
                msgIndexes: new Set(),
            });
        }
        byFile.get(key).msgIndexes.add(row.msgIndex);
    }

    const $cloud = $('#cs-tag-cloud');
    $cloud.html('<div class="cs-loading">태그 지우는 중...</div>');

    for (const { avatarUrl, fileName, charName, isOpenChat, msgIndexes } of byFile.values()) {
        try {
            if (isOpenChat) {
                for (const idx of msgIndexes) {
                    const extra = getMsgExtraForTags(idx);
                    if (extra) extra.csTags = extra.csTags.filter((t) => t !== tag);
                }
                await persistChatTags();
                refreshAllMessageTagButtons();
            } else {
                const content = await fetchChatContent(charName, avatarUrl, fileName);
                for (const idx of msgIndexes) {
                    if (content[idx]?.extra?.csTags) {
                        content[idx].extra.csTags = content[idx].extra.csTags.filter((t) => t !== tag);
                    }
                }
                await saveChatContentToFile(avatarUrl, fileName, content);
            }
        } catch (err) {
            console.error(`[chat-searching] ${fileName} 태그 일괄 삭제 실패`, err);
        }
    }

    // 서버에서 처음부터 다시 긁어오지 않고, 방금 지운 태그만 캐시에서 빼고 화면만 갱신
    for (const row of currentTaggedRows) {
        if (row.tags.includes(tag)) {
            row.tags = row.tags.filter((t) => t !== tag);
        }
    }
    $('#cs-tag-results').empty();
    renderTagCloud(rowsInCurrentScope(currentTaggedRows), currentScope() === 'all');
}

// ---------- 결과 렌더링 ----------

function plainSnippet(text, radius = 160) {
    const trimmed = text.length > radius ? `${text.slice(0, radius)}…` : text;
    return escapeHtml(trimmed);
}

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
        const tagChips = Array.isArray(match.tags)
            ? match.tags.map((t) => `<span class="cs-chip cs-chip-tag">#${escapeHtml(t)}</span>`).join('')
            : '';
        const renderSnippet = () => (opts.tagMode ? plainSnippet(match.mes) : highlightSnippet(match.mes, query));
        const renderFull = () => (opts.tagMode ? escapeHtml(match.mes) : highlightFull(match.mes, query));

        const $row = $(`
            <div class="cs-row">
                <div class="cs-meta">
                    ${charChip}
                    <span class="cs-chip">${escapeHtml(String(match.fileName))}</span>
                    <span class="cs-chip">${roleChip}</span>
                    ${langChip}
                    ${tagChips}
                    <span class="cs-name">${escapeHtml(match.name || '')}</span>
                    <div class="cs-star ${bookmarked ? 'cs-star-on' : ''}" title="북마크">${ICONS.star}</div>
                </div>
                <div class="cs-snippet">${renderSnippet()}</div>
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
                $snippet.html(renderFull());
                $hint.text('탭해서 접기');
            } else {
                $snippet.html(renderSnippet());
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

let currentView = 'search'; // 'search' | 'bookmarks' | 'tags'

function refreshTagInsertToggleUI() {
    const enabled = getSettings().tagInsertEnabled;
    $('#cs-tag-insert-state').text(enabled ? '켜짐' : '꺼짐');
    $('#cs-tag-insert-toggle').toggleClass('cs-tag-toggle-on', enabled);
}

function setView(mode) {
    currentView = mode;
    $('#cs-results').toggle(mode === 'search');
    $('#cs-bookmarks-view').toggle(mode === 'bookmarks');
    $('#cs-tags-view').toggle(mode === 'tags');

    $('.cs-searchbar').toggle(mode === 'search');
    $('.cs-scope-bar').toggle(mode === 'search' || mode === 'tags');
    $('.cs-divider').toggle(mode !== 'bookmarks');

    $('#cs-bookmarks-btn').toggleClass('cs-icon-btn-active', mode === 'bookmarks');
    $('#cs-tags-btn').toggleClass('cs-icon-btn-active', mode === 'tags');

    if (mode === 'bookmarks') renderBookmarksView();
    if (mode === 'tags') {
        refreshTagInsertToggleUI();
        loadTagCloud();
    }
}

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
                        <div id="cs-tags-btn" class="cs-icon-btn" title="태그 보기">${ICONS.tag}</div>
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
                <div id="cs-tags-view" style="display:none;">
                    <div class="cs-tag-toolbar">
                        <button id="cs-tag-insert-toggle" type="button" class="cs-tag-toggle-btn">
                            채팅에 태그 버튼 표시: <span id="cs-tag-insert-state"></span>
                        </button>
                    </div>
                    <div id="cs-tag-cloud" class="cs-tag-cloud"></div>
                    <div id="cs-tag-results" class="cs-results"></div>
                </div>
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
        if (currentView === 'tags') loadTagCloud();
    });

    $('#cs-char-select').on('change', () => {
        if (currentView === 'tags' && currentScope() === 'character') loadTagCloud();
    });

    $('#cs-bookmarks-btn').on('click', () => {
        setView(currentView === 'bookmarks' ? 'search' : 'bookmarks');
    });

    $('#cs-tags-btn').on('click', () => {
        setView(currentView === 'tags' ? 'search' : 'tags');
    });

    $('#cs-tag-insert-toggle').on('click', () => {
        const settings = getSettings();
        settings.tagInsertEnabled = !settings.tagInsertEnabled;
        persistSettings();
        refreshTagInsertToggleUI();
        refreshAllMessageTagButtons();
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

    // 열 때마다 캐릭터 목록/기본 선택 최신화 + 항상 검색 화면으로 리셋
    populateCharacterSelect();
    updateScopeUI();
    setView('search');

    $('#cs-modal').show();
    // 자동 포커스는 일부러 안 함 -> 열리자마자 키보드가 뜨면서
    // 모바일 뷰포트가 줄어들어 레이아웃이 밀리는 문제가 있었음
}

function closeModal() {
    $('#cs-modal').hide();
    $('body').css('overflow', '');
}

jQuery(async () => {
    migrateLegacyLocalStorage();
    buildUI();
    bindChatTagEvents();
    refreshAllMessageTagButtons();
    console.log('[chat-searching] 로드됨 (v5: PC 팝업 레이아웃 + 서버 저장 동기화 + 메시지 해시태그)');
});
