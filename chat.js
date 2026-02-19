
        // 删除角色
        async function deleteCharacter() {
            if(!currentEditingCharacter) return;
            if(!confirm(`确定删除角色 "${currentEditingCharacter.name}"? 聊天记录也会被删除。`)) return;

            await db.transaction('rw', db.characters, db.characterSessions, async () => {
                await db.characterSessions.where('characterId').equals(currentEditingCharacter.id).delete();
                await db.characters.delete(currentEditingCharacter.id);
            });

            if (currentCharacterSession && currentCharacterSession.characterId === currentEditingCharacter.id) {
                currentCharacterSession = null;
            }

            closeModal('modal-character-detail');
            await renderCharacterList();
            alert('角色已删除');
        }

        // 打开旧模式角色聊天界面
        async function openCharacterChatLegacy(focusInput = true) {
            if(!currentEditingCharacter) return;

            if (typeof closeCharacterSessionSidebar === 'function') closeCharacterSessionSidebar();
            if (typeof hideCharacterSessionContextMenu === 'function') hideCharacterSessionContextMenu();
            resetUI();
            document.body.classList.add('no-scroll');

            currentCharacterSession = null;
            currentReadingRoom = null;
            currentChatCharacter = currentEditingCharacter;
            updateReadingSpoilerToggle();
            const sessionBtn = document.getElementById('chat-session-btn');
            if (sessionBtn) sessionBtn.style.display = 'inline-flex';

            document.getElementById('chat-avatar').src = currentChatCharacter.avatar || getAvatarPlaceholder(40);
            document.getElementById('chat-character-name').textContent = currentChatCharacter.name;

            const visibleCount = Array.isArray(currentChatCharacter.chatHistory)
                ? currentChatCharacter.chatHistory.filter(msg => !msg.hidden).length
                : 0;
            isHistoryCollapsed = visibleCount > COLLAPSE_THRESHOLD;

            renderCharacterChatHistory();
            document.getElementById('character-chat-screen').style.display = 'flex';

            if (focusInput) {
                setTimeout(() => {
                    document.getElementById('character-chat-input').focus();
                }, 300);
            }

            if (typeof renderCharacterSessionSidebar === 'function') {
                await renderCharacterSessionSidebar();
            }
        }

        async function openCharacterSessionChat(characterId, sessionId, focusInput = true) {
            const character = await db.characters.get(characterId);
            if (!character) {
                alert('角色不存在');
                return;
            }

            if (!isCharacterSessionModeEnabled(character)) {
                currentEditingCharacter = character;
                await openCharacterChatLegacy(focusInput);
                return;
            }

            let session = await db.characterSessions.get(sessionId);
            if (!session || session.characterId !== characterId) {
                const sessions = await getCharacterSessions(characterId);
                session = sessions[0] || null;
            }
            if (!session) {
                session = await ensureCharacterPrimarySession(character);
            }
            session = normalizeCharacterSession(session);

            currentEditingCharacter = character;
            currentCharacterSession = session;
            currentReadingRoom = null;
            currentChatCharacter = {
                ...character,
                chatHistory: session.chatHistory,
                longTermMemory: session.longTermMemory
            };

            if (typeof hideCharacterSessionContextMenu === 'function') hideCharacterSessionContextMenu();
            resetUI();
            document.body.classList.add('no-scroll');
            updateReadingSpoilerToggle();
            const sessionBtn = document.getElementById('chat-session-btn');
            if (sessionBtn) sessionBtn.style.display = 'inline-flex';

            document.getElementById('chat-avatar').src = character.avatar || getAvatarPlaceholder(40);
            document.getElementById('chat-character-name').textContent = `${character.name} · ${session.name || DEFAULT_CHARACTER_SESSION_NAME}`;

            const visibleCount = Array.isArray(currentChatCharacter.chatHistory)
                ? currentChatCharacter.chatHistory.filter(msg => !msg.hidden).length
                : 0;
            isHistoryCollapsed = visibleCount > COLLAPSE_THRESHOLD;

            renderCharacterChatHistory();
            document.getElementById('character-chat-screen').style.display = 'flex';

            const now = Date.now();
            currentCharacterSession.lastActiveAt = now;
            currentCharacterSession.updatedAt = now;
            await db.characterSessions.put(normalizeCharacterSession(currentCharacterSession));

            if (focusInput) {
                setTimeout(() => {
                    document.getElementById('character-chat-input').focus();
                }, 300);
            }

            if (typeof renderCharacterSessionSidebar === 'function') {
                await renderCharacterSessionSidebar();
            }
            await renderCharacterList();
        }

        // 打开角色聊天界面（自动按迁移模式路由）
        async function openCharacterChat() {
            if(!currentEditingCharacter) return;

            const migration = await maybeMigrateLegacyCharacter(currentEditingCharacter.id, true);
            if (!migration) return;

            if (migration.mode === 'session') {
                let sessions = await getCharacterSessions(currentEditingCharacter.id);
                if (sessions.length === 0) {
                    await ensureCharacterPrimarySession(migration.character || currentEditingCharacter);
                    sessions = await getCharacterSessions(currentEditingCharacter.id);
                }
                if (sessions.length > 0) {
                    await openCharacterSessionChat(currentEditingCharacter.id, sessions[0].id);
                }
                return;
            }

            currentEditingCharacter = migration.character || currentEditingCharacter;
            await openCharacterChatLegacy(true);
        }

        // [统一保存] 根据当前模式保存聊天状态到正确的存储位置
        async function saveCurrentChatState() {
            if (!currentChatCharacter) return;
            const now = Date.now();
            if (currentReadingRoom) {
                currentReadingRoom.chatHistory = currentChatCharacter.chatHistory;
                currentReadingRoom.longTermMemory = Array.isArray(currentChatCharacter.longTermMemory) ? currentChatCharacter.longTermMemory : [];
                currentReadingRoom.lastActiveDate = now;
                await db.readingRooms.put(currentReadingRoom);
            } else if (currentCharacterSession) {
                currentCharacterSession.chatHistory = Array.isArray(currentChatCharacter.chatHistory) ? currentChatCharacter.chatHistory : [];
                currentCharacterSession.longTermMemory = Array.isArray(currentChatCharacter.longTermMemory) ? currentChatCharacter.longTermMemory : [];
                currentCharacterSession.updatedAt = now;
                currentCharacterSession.lastActiveAt = now;
                await db.characterSessions.put(normalizeCharacterSession(currentCharacterSession));
            } else {
                // 安全检查：确保 currentChatCharacter 就是角色本体，防止阅读室/会话的工作副本被误写入角色
                if (currentChatCharacter === currentEditingCharacter) {
                    await db.characters.put(currentChatCharacter);
                } else {
                    console.warn('[saveCurrentChatState] 跳过保存：currentChatCharacter 不是角色本体（可能是已关闭的阅读室/会话残留）');
                }
            }
        }

        async function saveCurrentCharacterMetaFields(fields = {}) {
            if (!currentEditingCharacter || !currentEditingCharacter.id) return;
            const payload = { ...fields };
            if (Object.keys(payload).length === 0) return;

            await db.characters.update(currentEditingCharacter.id, payload);
            currentEditingCharacter = { ...currentEditingCharacter, ...payload };

            if (currentChatCharacter && currentChatCharacter.id === currentEditingCharacter.id) {
                Object.assign(currentChatCharacter, payload);
            }
        }

        async function persistCurrentLongTermMemory() {
            if (!currentChatCharacter) return;

            if (currentReadingRoom) {
                const memory = Array.isArray(currentChatCharacter.longTermMemory) ? currentChatCharacter.longTermMemory : [];
                currentReadingRoom.longTermMemory = memory;
                await db.readingRooms.put(currentReadingRoom);
                return;
            }

            if (currentCharacterSession) {
                currentCharacterSession.longTermMemory = Array.isArray(currentChatCharacter.longTermMemory) ? currentChatCharacter.longTermMemory : [];
                currentCharacterSession.updatedAt = Date.now();
                await db.characterSessions.put(normalizeCharacterSession(currentCharacterSession));
                return;
            }

            // 安全检查：仅 legacy 模式（非阅读室/非会话的工作副本）才写角色本体
            if (currentChatCharacter === currentEditingCharacter) {
                const memory = Array.isArray(currentChatCharacter.longTermMemory) ? currentChatCharacter.longTermMemory : [];
                await saveCurrentCharacterMetaFields({ longTermMemory: memory });
            }
        }

        // 关闭角色聊天界面
        async function closeCharacterChat() {
            if (currentReadingRoom) {
                try {
                    currentReadingRoom.chatHistory = currentChatCharacter ? currentChatCharacter.chatHistory : [];
                    currentReadingRoom.longTermMemory = currentChatCharacter ? (Array.isArray(currentChatCharacter.longTermMemory) ? currentChatCharacter.longTermMemory : []) : [];
                    currentReadingRoom.lastActiveDate = Date.now();
                    await db.readingRooms.put(currentReadingRoom);
                } catch (e) {
                    console.error('[阅读室] 保存聊天记录失败:', e);
                }
                currentReadingRoom = null;
                currentChatCharacter = null;  // 立刻清理，阻断任何残留异步操作写入角色本体
                updateReadingSpoilerToggle();
            }

            if (currentCharacterSession) {
                try {
                    await saveCurrentChatState();
                } catch (e) {
                    console.error('[会话] 保存聊天记录失败:', e);
                }
            }

            if (typeof closeCharacterSessionSidebar === 'function') closeCharacterSessionSidebar();
            if (typeof hideCharacterSessionContextMenu === 'function') hideCharacterSessionContextMenu();

            const chatScreen = document.getElementById('character-chat-screen');
            chatScreen.style.display = 'none';
            chatScreen.style.zIndex = '5000';
            document.getElementById('modal-character-detail').classList.remove('active');
            currentChatCharacter = null;
            currentCharacterSession = null;

            if (chatOpenedFromCharacterManager) {
                chatOpenedFromCharacterManager = false;
                document.body.classList.remove('no-scroll');
                const panel = document.getElementById('panel-character-manager');
                if (panel) {
                    panel.classList.add('active');
                    await renderCharacterList();
                }
            } else {
                resetUI();
            }
        }

        function closeSettingsAndReturnToChat() {
            const detailModal = document.getElementById('modal-character-detail');
            detailModal.classList.remove('active');
            detailModal.style.zIndex = ''; // 恢复默认
            const chatScreen = document.getElementById('character-chat-screen');
            chatScreen.style.display = 'flex';
            // 阅读室模式下保持高 z-index
            if (currentReadingRoom) {
                chatScreen.style.zIndex = '9000';
            }
        }

        // 从聊天界面打开角色设置
        function openCharacterSettingsFromChat() {
            if(!currentChatCharacter) return;
            document.getElementById('character-chat-screen').style.display = 'none';
            openCharacterDetail(currentChatCharacter.id);
            if (currentReadingRoom) {
                const detailModal = document.getElementById('modal-character-detail');
                if (detailModal) detailModal.style.zIndex = '9500';
            }
        }

        // 全局变量：控制历史折叠
        let isHistoryCollapsed = false;
        const COLLAPSE_THRESHOLD = 120;
        const RECENT_RENDER_COUNT = 40;

        // 渲染聊天历史
        function renderCharacterChatHistory() {
            const container = document.getElementById('character-chat-messages');
            if(!currentChatCharacter || !currentChatCharacter.chatHistory || currentChatCharacter.chatHistory.length === 0) {
                container.innerHTML = `
                    <div style="text-align:center; opacity:0.6; margin-top:50px;">
                        <div style="font-size:3rem; margin-bottom:10px;">💬</div>
                        <div>${currentChatCharacter.first_mes || '开始你们的对话吧...'}</div>
                    </div>
                `;
                updateChatMessageCounter(0);
                return;
            }

            const visibleMessages = currentChatCharacter.chatHistory.filter(msg => !msg.hidden);
            const totalCount = visibleMessages.length;

            container.innerHTML = '';

            // 如果启用折叠且消息数超过阈值，只显示最近的消息
            let messagesToShow = visibleMessages;
            if (isHistoryCollapsed && totalCount > COLLAPSE_THRESHOLD) {
                // 仅渲染最近 N 条，减少长会话卡顿
                messagesToShow = visibleMessages.slice(-RECENT_RENDER_COUNT);

                // 添加"加载更多"按钮
                const loadMoreBtn = document.createElement('div');
                loadMoreBtn.style.cssText = 'text-align:center; padding:10px; margin-bottom:15px;';
                loadMoreBtn.innerHTML = `<button class="btn-sec" onclick="loadMoreHistory()" style="font-size:0.8rem;">📜 加载更多历史 (已折叠 ${totalCount - RECENT_RENDER_COUNT} 条)</button>`;
                container.appendChild(loadMoreBtn);
            }

            messagesToShow.forEach(msg => {
                // 找到消息在原始chatHistory中的真实索引
                const realIndex = currentChatCharacter.chatHistory.indexOf(msg);
                appendCharacterMessage(msg, realIndex);
            });

            // 更新消息计数器
            updateChatMessageCounter(totalCount);

            // 滚动到底部
            setTimeout(() => {
                container.scrollTop = container.scrollHeight;
            }, 100);
        }

        // 更新聊天消息计数器
        function updateChatMessageCounter(count) {
            const counter = document.getElementById('chat-message-counter');
            if (counter) {
                counter.textContent = `(${count}条)`;
            }
        }

        // 切换历史折叠状态
        function toggleHistoryCollapse() {
            if (!currentChatCharacter) return;

            const totalCount = currentChatCharacter.chatHistory.filter(msg => !msg.hidden).length;

            if (totalCount <= COLLAPSE_THRESHOLD) {
                alert(`当前对话仅${totalCount}条，无需折叠`);
                return;
            }

            isHistoryCollapsed = !isHistoryCollapsed;
            const btn = document.getElementById('chat-collapse-btn');

            if (isHistoryCollapsed) {
                btn.textContent = '📂'; // 折叠状态
                btn.title = '展开历史';
            } else {
                btn.textContent = '📋'; // 展开状态
                btn.title = '折叠历史';
            }

            renderCharacterChatHistory();
        }

        // 加载更多历史
        function loadMoreHistory() {
            isHistoryCollapsed = false;
            const btn = document.getElementById('chat-collapse-btn');
            btn.textContent = '📋';
            btn.title = '折叠历史';
            renderCharacterChatHistory();
        }

        // 追加消息到聊天界面
        function appendCharacterMessage(msg, index) {
            const container = document.getElementById('character-chat-messages');
            const messageDiv = document.createElement('div');
            
            // Handle temporary system messages
            if (msg.isTemp) {
                messageDiv.id = msg.tempId;
                messageDiv.style.cssText = `text-align:center; font-size:0.8rem; opacity:0.6; margin-bottom:15px;`;
                messageDiv.innerHTML = `<div style="display:inline-block; background:var(--card-bg); padding:5px 10px; border-radius:10px;">${escapeHtml(msg.content)}</div>`;
                container.appendChild(messageDiv);
                container.scrollTop = container.scrollHeight;
                return;
            }

            const isUser = msg.role === 'user';
            const showAvatar = currentChatCharacter.settings.showAvatar !== false; // 默认显示
            const bubbleSize = currentChatCharacter.settings.bubbleSize || 14;
            const customCssUser = currentChatCharacter.settings.bubbleCssUser || currentChatCharacter.settings.bubbleCss || '';
            const customCssAi = currentChatCharacter.settings.bubbleCssAi || currentChatCharacter.settings.bubbleCss || '';

            // 头像 URL
            const avatarUrl = isUser
                ? (store.userAvatar || getAvatarPlaceholder(40))
                : (currentChatCharacter.avatar || getAvatarPlaceholder(40));

            const alignStyle = isUser ? 'flex-end' : 'flex-start';
            const bgColor = isUser ? 'var(--accent)' : 'var(--card-bg)';
            const textColor = isUser ? 'var(--bg)' : 'var(--text)';

            // 如果没有传入index，自动计算
            if(index === undefined && currentChatCharacter) {
                index = currentChatCharacter.chatHistory.indexOf(msg);
            }

            messageDiv.style.cssText = `display:flex; justify-content:${alignStyle}; align-items:flex-start; gap:8px; margin-bottom:15px;`;

            // 头像 HTML
            const avatarHtml = `<img src="${avatarUrl}" style="width:35px; height:35px; border-radius:50%; object-fit:cover; border:1px solid rgba(0,0,0,0.1); flex-shrink:0;">`;

            let innerHTML = '';

            // 获取消息发送模式
            const msgMode = currentChatCharacter.settings.msgMode || 'split';

            // 根据消息发送模式调整气泡宽度
            // 当为完整String模式时，assistant消息占据更宽空间
            let maxWidth = '70%';
            if (msgMode === 'full' && !isUser) {
                maxWidth = '95%'; // assistant消息在完整模式下占据95%宽度
            }

            // 构建气泡样式（自定义CSS会覆盖默认样式）
            let bubbleStyle = `max-width:${maxWidth}; background:${bgColor}; color:${textColor}; padding:8px 12px; border-radius:16px; ${!isUser ? 'border-left:3px solid var(--accent);' : ''} cursor:pointer; position:relative; font-size:${bubbleSize}px;`;

            // 应用自定义CSS（如果有的话）
            const customCss = isUser ? customCssUser : customCssAi;
            if (customCss) {
                bubbleStyle += ' ' + customCss;
            }

            // 构建引用块HTML（如果有引用）
            let quoteHtml = '';
            if (msg.quote) {
                if (msg.quote.type === 'excerpt') {
                    // 书籍摘录引用 - 可滚动查看完整内容
                    let excerptBody = `<div class="excerpt-block-content">${escapeHtml(msg.quote.content)}</div>`;
                    if (msg.quote.userNote) {
                        excerptBody += `
                            <div style="font-size:0.75rem; opacity:0.6; margin-top:6px;">用户想法</div>
                            <div class="excerpt-block-content" style="border-left:2px dashed var(--highlight); font-style:italic;">${escapeHtml(msg.quote.userNote)}</div>
                        `;
                    }
                    quoteHtml = `
                        <div class="excerpt-block">
                            <div class="excerpt-block-header">
                                <span>摘录自《${escapeHtml(msg.quote.bookTitle || '未知')}》</span>
                            </div>
                            ${excerptBody}
                        </div>
                        <div class="quote-divider"></div>
                    `;
                } else {
                    // 普通消息引用
                    const quoteRoleName = msg.quote.role === 'user' ? '你' : (currentChatCharacter?.name || 'AI');
                    const quotePreview = msg.quote.content.substring(0, 80) + (msg.quote.content.length > 80 ? '...' : '');
                    quoteHtml = `
                        <div class="quote-block" onclick="scrollToMessage(${msg.quote.index})" title="点击跳转到原消息">
                            <div class="quote-block-header">↩ 引用 ${quoteRoleName}</div>
                            <div class="quote-block-content">${escapeHtml(quotePreview)}</div>
                        </div>
                        <div class="quote-divider"></div>
                    `;
                }
            }

            // 气泡 HTML
            const bubbleHtml = `
                <div class="chat-message-bubble" data-msg-index="${index}" data-msg-role="${msg.role}" data-msg-content="${escapeHtml(msg.content)}" ${msg.quote ? `data-quote-index="${msg.quote.index}"` : ''} style="${bubbleStyle}">
                    ${quoteHtml}
                    <div class="markdown-content">${renderMarkdown(msg.content)}</div>
                    <div style="font-size:${bubbleSize * 0.75}px; opacity:0.6; margin-top:5px; text-align:right;">${new Date(msg.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
                </div>
            `;

            if (isUser) {
                innerHTML = bubbleHtml + (showAvatar ? avatarHtml : '');
            } else {
                innerHTML = (showAvatar ? avatarHtml : '') + bubbleHtml;
            }

            messageDiv.innerHTML = innerHTML;
            container.appendChild(messageDiv);

            // 添加长按事件
            const bubble = messageDiv.querySelector('.chat-message-bubble');
            setupMessageLongPress(bubble);

            // 更新消息计数器
            if (currentChatCharacter) {
                const totalCount = currentChatCharacter.chatHistory.filter(msg => !msg.hidden).length;
                updateChatMessageCounter(totalCount);
            }
        }

        // 设置消息长按事件
        function setupMessageLongPress(bubble) {
            let longPressTimer = null;
            let touchStartTime = 0;

            bubble.addEventListener('touchstart', function(e) {
                touchStartTime = Date.now();
                // 多选模式下不触发长按菜单
                if (isMultiSelectMode) return;

                longPressTimer = setTimeout(() => {
                    showCharacterMessageMenu(e, bubble);
                }, 500);
            });

            bubble.addEventListener('touchend', function(e) {
                if(longPressTimer) {
                    clearTimeout(longPressTimer);
                    longPressTimer = null;
                }

                // 多选模式下，点击切换选中状态 (取消时间限制，改善手感)
                if (isMultiSelectMode) {
                    e.preventDefault();
                    e.stopPropagation();
                    const index = parseInt(bubble.dataset.msgIndex);
                    toggleMessageSelection(bubble, index);
                }
            });

            bubble.addEventListener('touchmove', function() {
                if(longPressTimer) {
                    clearTimeout(longPressTimer);
                    longPressTimer = null;
                }
            });

            // PC端右键菜单
            bubble.addEventListener('contextmenu', function(e) {
                e.preventDefault();
                if (!isMultiSelectMode) {
                    showCharacterMessageMenu(e, bubble);
                }
            });

            // PC端点击（用于多选模式）
            bubble.addEventListener('click', function(e) {
                if (isMultiSelectMode) {
                    e.preventDefault();
                    e.stopPropagation();
                    const index = parseInt(bubble.dataset.msgIndex);
                    toggleMessageSelection(bubble, index);
                }
            });
        }

        // 显示消息菜单
        let currentMessageBubble = null;

        function showCharacterMessageMenu(e, bubble) {
            currentMessageBubble = bubble;

            const menu = document.getElementById('character-message-menu');
            const msgRole = bubble.dataset.msgRole;

            // 根据消息类型显示不同的菜单项
            const allItems = menu.querySelectorAll('.context-menu-item');
            allItems.forEach(item => item.style.display = 'flex');

            // 用户消息不显示"刷新重试"
            if(msgRole === 'user') {
                allItems.forEach(item => {
                    if(item.textContent.includes('刷新重试')) {
                        item.style.display = 'none';
                    }
                });
            }

            // 显示菜单
            menu.classList.add('active');

            const x = e.touches ? e.touches[0].clientX : e.clientX;
            const y = e.touches ? e.touches[0].clientY : e.clientY;

            menu.style.left = x + 'px';
            menu.style.top = y + 'px';

            // 检查边界
            setTimeout(() => {
                const rect = menu.getBoundingClientRect();
                if(rect.right > window.innerWidth) {
                    menu.style.left = (window.innerWidth - rect.width - 10) + 'px';
                }
                if(rect.bottom > window.innerHeight) {
                    menu.style.top = (window.innerHeight - rect.height - 10) + 'px';
                }
            }, 10);
        }

        // 处理消息菜单操作
        async function handleCharacterMessageAction(action) {
            const menu = document.getElementById('character-message-menu');
            menu.classList.remove('active');

            if(!currentMessageBubble || !currentChatCharacter) return;

            const msgIndex = parseInt(currentMessageBubble.dataset.msgIndex);
            
            // 修复：直接从 chatHistory 获取完整消息对象，而不是依赖 DOM 属性（避免长文本截断）
            const targetMsg = currentChatCharacter.chatHistory[msgIndex];
            if (!targetMsg) {
                console.error("找不到对应的消息对象，索引:", msgIndex);
                return;
            }

            const msgContent = targetMsg.content;
            const msgRole = targetMsg.role;

            switch(action) {
                case 'copy':
                    // 复制消息
                    const tempTextarea = document.createElement('textarea');
                    tempTextarea.value = msgContent;
                    document.body.appendChild(tempTextarea);
                    tempTextarea.select();
                    document.execCommand('copy');
                    document.body.removeChild(tempTextarea);
                    updateChatStatus('已复制到剪贴板', 'online');
                    setTimeout(() => updateChatStatus('在线', 'online'), 2000);
                    break;

                case 'edit':
                    // 编辑消息
                    const newContent = prompt('编辑消息:', msgContent);
                    if(newContent && newContent.trim()) {
                        currentChatCharacter.chatHistory[msgIndex].content = newContent;
                        await saveCurrentChatState();
                        renderCharacterChatHistory();
                    }
                    break;

                case 'retry':
                    // 刷新重试（仅AI消息）
                    if(msgRole === 'assistant') {
                        // 删除这条AI消息
                        currentChatCharacter.chatHistory.splice(msgIndex, 1);
                        await saveCurrentChatState();
                        renderCharacterChatHistory();
                        // 重新生成
                        await triggerCharacterAIResponse();
                    }
                    break;

                case 'quote':
                    // 引用回复 - 使用新的引用系统
                    setQuotePreview(msgIndex, msgRole, msgContent);
                    document.getElementById('character-chat-input').focus();
                    break;

                case 'multiSelect':
                    // 进入多选模式
                    enterMultiSelectMode(currentMessageBubble);
                    break;

                case 'delete':
                    // 删除消息（从上下文删除，AI看不到）
                    if(confirm('确定删除这条消息?（AI将看不到此消息）')) {
                        currentChatCharacter.chatHistory.splice(msgIndex, 1);
                        await saveCurrentChatState();
                        renderCharacterChatHistory();
                    }
                    break;

                case 'hide':
                    // 撤回消息（仅UI隐藏，AI可以看到）
                    if(confirm('确定撤回这条消息?（消息会被隐藏，但AI仍能看到）')) {
                        currentChatCharacter.chatHistory[msgIndex].hidden = true;
                        await saveCurrentChatState();
                        renderCharacterChatHistory();
                    }
                    break;
            }
        }

        // 点击其他地方关闭菜单
        document.addEventListener('click', function(e) {
            const menu = document.getElementById('character-message-menu');
            if(menu && !e.target.closest('#character-message-menu') && !e.target.closest('.chat-message-bubble')) {
                menu.classList.remove('active');
            }
        });

        // --- [Vesper] 多选模式相关 ---
        let isMultiSelectMode = false;
        let selectedMessageIndices = new Set();

        function enterMultiSelectMode(initialBubble) {
            isMultiSelectMode = true;
            selectedMessageIndices.clear();

            const container = document.getElementById('character-chat-messages');
            if (container) container.classList.add('multi-select-mode');

            // 选中当前消息
            if (initialBubble) {
                const index = parseInt(initialBubble.dataset.msgIndex);
                toggleMessageSelection(initialBubble, index);
            }

            // 显示工具栏
            const toolbar = document.getElementById('multi-select-toolbar');
            if (toolbar) {
                toolbar.classList.add('active');
                toolbar.style.display = 'flex';
            }
        }

        function toggleMessageSelection(bubble, index) {
            if (selectedMessageIndices.has(index)) {
                selectedMessageIndices.delete(index);
                bubble.classList.remove('selected');
            } else {
                selectedMessageIndices.add(index);
                bubble.classList.add('selected');
            }
            updateSelectedCount();
        }

        function updateSelectedCount() {
            document.getElementById('selected-count').textContent = selectedMessageIndices.size;
        }

        function selectAllMessages() {
            const container = document.getElementById('character-chat-messages');
            container.querySelectorAll('.chat-message-bubble').forEach(bubble => {
                const index = parseInt(bubble.dataset.msgIndex);
                if (!selectedMessageIndices.has(index)) {
                    selectedMessageIndices.add(index);
                    bubble.classList.add('selected');
                }
            });
            updateSelectedCount();
        }

        function cancelMultiSelect() {
            isMultiSelectMode = false;
            selectedMessageIndices.clear();

            const container = document.getElementById('character-chat-messages');
            if (container) {
                container.classList.remove('multi-select-mode');
                // 移除选中状态
                container.querySelectorAll('.chat-message-bubble.selected').forEach(bubble => {
                    bubble.classList.remove('selected');
                });
            }

            // 隐藏工具栏
            const toolbar = document.getElementById('multi-select-toolbar');
            if (toolbar) {
                toolbar.classList.remove('active');
                toolbar.style.display = 'none';
            }
        }

        async function deleteSelectedMessages() {
            if (selectedMessageIndices.size === 0) {
                alert('请先选择要删除的消息');
                return;
            }

            if (!confirm(`确定删除选中的 ${selectedMessageIndices.size} 条消息吗？`)) {
                return;
            }

            // 按索引从大到小排序，避免删除时索引错位
            const sortedIndices = Array.from(selectedMessageIndices).sort((a, b) => b - a);

            for (const index of sortedIndices) {
                currentChatCharacter.chatHistory.splice(index, 1);
            }

            await saveCurrentChatState();
            cancelMultiSelect();
            renderCharacterChatHistory();
        }

        // --- [Vesper] 引用消息系统 ---
        let currentQuote = null; // { index, role, content }

        function setQuotePreview(msgIndex, msgRole, msgContent) {
            const roleName = msgRole === 'user' ? '你' : (currentChatCharacter?.name || 'AI');
            const preview = msgContent.substring(0, 50) + (msgContent.length > 50 ? '...' : '');

            currentQuote = {
                index: msgIndex,
                role: msgRole,
                content: msgContent
            };

            const previewEl = document.getElementById('quote-preview');
            const contentEl = document.getElementById('quote-preview-content');
            contentEl.innerHTML = `<span style="opacity:0.6;">引用 ${roleName}:</span> ${preview}`;
            previewEl.classList.add('active');
        }

        function clearQuotePreview() {
            currentQuote = null;
            const previewEl = document.getElementById('quote-preview');
            previewEl.classList.remove('active');
        }

        // 设置书籍摘录引用
        function setExcerptQuote(bookTitle, excerptText, userNote) {
            currentQuote = {
                type: 'excerpt',
                role: 'book',
                bookTitle: bookTitle,
                content: excerptText
            };
            if (userNote) {
                currentQuote.userNote = userNote;
            }

            const previewEl = document.getElementById('quote-preview');
            const contentEl = document.getElementById('quote-preview-content');

            let html = `
                <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
                    <span style="opacity:0.6; font-size:0.75rem;">摘录自《${escapeHtml(bookTitle)}》</span>
                </div>
                <div style="max-height:60px; overflow-y:auto; font-size:0.8rem; line-height:1.4; opacity:0.85; padding-right:25px; border-left:2px solid var(--accent); padding-left:8px; color:var(--text);">${escapeHtml(excerptText.substring(0, 300))}${excerptText.length > 300 ? '...' : ''}</div>
            `;

            if (userNote) {
                html += `
                    <div style="margin-top:6px; font-size:0.75rem; opacity:0.6;">用户想法</div>
                    <div style="max-height:40px; overflow-y:auto; font-size:0.8rem; line-height:1.4; opacity:0.85; padding-right:25px; border-left:2px dashed var(--highlight); padding-left:8px; font-style:italic;">${escapeHtml(userNote.substring(0, 200))}${userNote.length > 200 ? '...' : ''}</div>
                `;
            }

            contentEl.innerHTML = html;
            contentEl.style.whiteSpace = 'normal';
            previewEl.classList.add('active');
        }

        // 跳转到被引用的消息
        function scrollToMessage(msgIndex) {
            const container = document.getElementById('character-chat-messages');

            // 先展开历史（如果被折叠的话）
            if (isHistoryCollapsed) {
                isHistoryCollapsed = false;
                renderCharacterChatHistory();
                // 等待渲染后再跳转
                setTimeout(() => {
                    highlightAndScrollTo(msgIndex);
                }, 300);
            } else {
                highlightAndScrollTo(msgIndex);
            }
        }

        function highlightAndScrollTo(msgIndex) {
            const container = document.getElementById('character-chat-messages');
            const bubble = container.querySelector(`.chat-message-bubble[data-msg-index="${msgIndex}"]`);

            if (bubble) {
                bubble.scrollIntoView({ behavior: 'smooth', block: 'center' });
                // 高亮闪烁效果
                bubble.style.transition = 'box-shadow 0.3s, transform 0.3s';
                bubble.style.boxShadow = '0 0 0 3px var(--accent)';
                bubble.style.transform = 'scale(1.02)';
                setTimeout(() => {
                    bubble.style.boxShadow = 'none';
                    bubble.style.transform = 'scale(1)';
                }, 2000);
            }
        }

        // 发送消息给角色
        async function sendCharacterMessage() {
            if(!currentChatCharacter) return;

            const input = document.getElementById('character-chat-input');
            const content = input.value.trim();

            // 搜索模式：即使输入为空也可以触发（AI会分析上下文）
            if (isSearchEnabled) {
                await executeSmartWebSearch('character');
                return;
            }

            if (isLocalSearchEnabled) {
                await executeSmartLocalSearch('character');
                return;
            }

            // 普通消息模式：必须有内容
            if(!content) return;

            // 创建用户消息（支持引用）
            const userMsg = {
                role: 'user',
                content: content,
                timestamp: Date.now()
            };

            // 如果有引用，添加引用信息
            if (currentQuote) {
                if (currentQuote.type === 'excerpt') {
                    // 书籍摘录引用 - 保留完整内容
                    userMsg.quote = {
                        type: 'excerpt',
                        role: 'book',
                        bookTitle: currentQuote.bookTitle,
                        content: currentQuote.content
                    };
                    if (currentQuote.userNote) {
                        userMsg.quote.userNote = currentQuote.userNote;
                    }
                } else {
                    // 普通消息引用
                    userMsg.quote = {
                        index: currentQuote.index,
                        role: currentQuote.role,
                        content: currentQuote.content.substring(0, 200)
                    };
                }
                clearQuotePreview();
            }

            // 添加到历史
            currentChatCharacter.chatHistory.push(userMsg);

            // 按上下文统一落盘（阅读室/会话/旧模式）
            await saveCurrentChatState();

            // 显示消息
            appendCharacterMessage(userMsg);
            input.value = '';

            // 滚动到底部
            const container = document.getElementById('character-chat-messages');
            container.scrollTop = container.scrollHeight;

            // 显示AI回复按钮
            document.getElementById('character-ai-reply-btn').style.display = 'block';
        }

        // 触发AI回复 (核心函数 - 支持心声系统)
        async function triggerCharacterAIResponse(extraSystemContext) {
            if(!currentChatCharacter) return;

            if(!store.apiConfig.main.url || !store.apiConfig.main.key) {
                updateChatStatus('错误: 未配置API', 'error');
                alert('Vesper: 请先在API设置中配置主API!');
                return;
            }

            document.getElementById('character-ai-reply-btn').style.display = 'none';
            updateChatStatus('AI正在思考中...', 'thinking');

            try {
                let systemPrompt = await buildCharacterSystemPrompt();
                if (extraSystemContext) {
                    systemPrompt += "\n\n" + extraSystemContext;
                }

                // 阅读室模式：自动注入书籍上下文
                if (currentReadingRoom) {
                    const readingCtx = await buildReadingRoomContext();
                    systemPrompt += "\n\n" + readingCtx;
                    console.log('[AI调用] 阅读室上下文已注入, 长度:', readingCtx.length, '字符');
                    console.log('[AI调用] openedFromReader:', currentReadingRoom.openedFromReader);
                    // 可视反馈：让用户知道上下文是否注入
                    if (currentReadingRoom.openedFromReader && readingCtx.includes('正在阅读的内容')) {
                        updateChatStatus('📖 已同步阅读上下文', 'thinking');
                    }
                }

                // 获取上下文条数设置（短期记忆）
                // 注意：只取最近N条消息发送给AI，避免token超限和成本过高
                const maxMemory = currentChatCharacter.settings.maxMemory || 20;
                const recentHistory = currentChatCharacter.chatHistory.slice(-maxMemory);

                console.log(`[AI调用] 使用最近 ${recentHistory.length}/${currentChatCharacter.chatHistory.length} 条消息作为上下文`);

                const messages = recentHistory.map(msg => {
                    // 构建消息内容（支持引用）
                    let textContent = msg.content;

                    // [时间戳注入] 在每条消息前添加时间戳信息
                    const msgTime = msg.timestamp ? new Date(msg.timestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '未知时间';
                    const timePrefix = `[消息时间: ${msgTime}]\n`;
                    textContent = timePrefix + textContent;

                    // 如果有引用，在消息前添加引用上下文
                    if (msg.quote) {
                        if (msg.quote.type === 'excerpt') {
                            let excerptCtx = `[书籍摘录 - 《${msg.quote.bookTitle || ''}》]:\n"${msg.quote.content}"`;
                            if (msg.quote.userNote) {
                                excerptCtx += `\n[用户批注]: ${msg.quote.userNote}`;
                            }
                            textContent = excerptCtx + `\n\n${textContent}`;
                        } else {
                            const quoteRoleName = msg.quote.role === 'user' ? '用户' : currentChatCharacter.name;
                            textContent = `[引用 ${quoteRoleName} 说: "${msg.quote.content.substring(0, 100)}"]\n${textContent}`;
                        }
                    }

                    // Check for markdown image syntax: ![Image](data:image/...)
                    // Support multiple images
                    const imgRegex = /!\[Image\]\((data:image\/[^;]+;base64,[^)]+)\)/g;
                    const matches = [...textContent.matchAll(imgRegex)];

                    if (matches.length > 0) {
                        const contentParts = [];

                        // Clean text by removing all image markdown
                        const cleanText = textContent.replace(imgRegex, '').trim();
                        contentParts.push({ type: "text", text: cleanText || "Images uploaded" });

                        // Add all images
                        matches.forEach(match => {
                            contentParts.push({
                                type: "image_url",
                                image_url: { url: match[1] }
                            });
                        });

                        return {
                            role: msg.role,
                            content: contentParts
                        };
                    }
                    return { role: msg.role, content: textContent };
                });

                const apiUrl = store.apiConfig.main.url.endsWith('/')
                    ? store.apiConfig.main.url + 'chat/completions'
                    : store.apiConfig.main.url + '/chat/completions';

                // 构建请求参数（根据开关状态动态添加温度和Top-P）
                const requestBody = {
                    model: store.apiConfig.main.model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        ...messages,
                        // [Vesper Fix] 动态时间注入 - 每次发送时强制更新当前时间
                        { role: 'system', content: `[当前系统时间]: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}。请根据此时间判断 User 的作息状态和时段语境。` }
                    ]
                };

                // 根据开关状态添加温度参数
                if (store.apiConfig.main.temperatureEnabled !== false) {
                    requestBody.temperature = currentChatCharacter.settings.temperature || store.apiConfig.main.temperature || 0.8;
                }

                // 根据开关状态添加Top-P参数
                if (store.apiConfig.main.topPEnabled === true) {
                    requestBody.top_p = store.apiConfig.main.topP || 1;
                }

                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${store.apiConfig.main.key}`
                    },
                    body: JSON.stringify(requestBody)
                });

                if(!response.ok) {
                    const errorText = await response.text();
                    let errorMsg = `HTTP ${response.status}`;
                    try {
                        const errorJson = JSON.parse(errorText);
                        errorMsg = errorJson.error?.message || errorText;
                    } catch(e) {
                        errorMsg = errorText.substring(0, 100);
                    }
                    throw new Error(errorMsg);
                }

                const data = await response.json();
                const rawContent = data.choices?.[0]?.message?.content;

                if(!rawContent || rawContent.trim() === '') {
                    throw new Error('API返回空回复');
                }

                // --- 解析响应 (支持JSON和普通文本) ---
                let messagesToSend = [];
                let innerVoiceData = null;

                try {
                    // 尝试净化JSON字符串
                    let sanitized = rawContent.replace(/^```json\s*/, '').replace(/```$/, '').trim();
                    const first = sanitized.indexOf('{');
                    const last = sanitized.lastIndexOf('}');
                    if(first !== -1 && last !== -1) {
                        sanitized = sanitized.substring(first, last + 1);
                    }
                    
                    const parsed = JSON.parse(sanitized);

                    // 1. 提取消息列表
                    if (parsed.chatResponse && Array.isArray(parsed.chatResponse)) {
                        messagesToSend = parsed.chatResponse
                            .filter(m => m.type === 'text')
                            .map(m => m.content);
                    } else if (parsed.content) {
                        messagesToSend = [parsed.content];
                    }
                    
                    // 2. 提取心声
                    if (parsed.innerVoice) {
                        innerVoiceData = parsed.innerVoice;
                    }

                    // 3. 兜底: 如果解析成功但没拿到消息, 且不是纯心声更新
                    if (messagesToSend.length === 0 && !innerVoiceData) {
                         messagesToSend = [rawContent]; 
                    }

                } catch (e) {
                    // 解析失败, 说明是普通文本
                    messagesToSend = [rawContent];
                }

                if (messagesToSend.length === 0 && !innerVoiceData) messagesToSend = ["..."]; 

                // --- [Vesper] 消息发送逻辑处理 ---
                const msgMode = currentChatCharacter.settings.msgMode || 'split';
                let finalMessages = [];

                if (msgMode === 'full') {
                    // 完整发送模式: 将所有消息合并为一个
                    finalMessages = [messagesToSend.join('\n\n')];
                } else {
                    // 句子切分模式 (模拟日常对话)
                    for (const msg of messagesToSend) {
                        if (msg.includes('```') || msg.length < 50) {
                            finalMessages.push(msg);
                        } else {
                            // 优先按换行符切分
                            const parts = msg.split(/\n+/).filter(p => p.trim());
                            if (parts.length > 1) {
                                finalMessages = finalMessages.concat(parts);
                            } else {
                                // 尝试按句号切分 (仅中文/英文句号)
                                const sentences = msg.split(/([。！？.!?]+)/).reduce((acc, curr, i) => {
                                    if (i % 2 === 0) {
                                        if (curr.trim()) acc.push(curr);
                                    } else {
                                        if (acc.length > 0) acc[acc.length - 1] += curr;
                                    }
                                    return acc;
                                }, []);
                                if (sentences.length > 0) finalMessages = finalMessages.concat(sentences);
                                else finalMessages.push(msg);
                            }
                        }
                    }
                }
                // 使用处理后的消息列表
                messagesToSend = finalMessages;

                // 保存心声（仅非阅读室模式）
                if (innerVoiceData && !currentReadingRoom) {
                    currentChatCharacter.latestInnerVoice = innerVoiceData;
                    if (!currentChatCharacter.innerVoiceHistory) currentChatCharacter.innerVoiceHistory = [];
                    currentChatCharacter.innerVoiceHistory.push({
                        ...innerVoiceData,
                        timestamp: Date.now()
                    });
                    await saveCurrentCharacterMetaFields({
                        latestInnerVoice: currentChatCharacter.latestInnerVoice,
                        innerVoiceHistory: currentChatCharacter.innerVoiceHistory
                    });
                }

                // 逐条发送消息 (模拟真实聊天节奏)
                const container = document.getElementById('character-chat-messages');
                
                for (const msgContent of messagesToSend) {
                    const aiMsg = {
                        role: 'assistant',
                        content: msgContent,
                        timestamp: Date.now()
                    };

                    currentChatCharacter.chatHistory.push(aiMsg);
                    await saveCurrentChatState();

                    appendCharacterMessage(aiMsg);
                    container.scrollTop = container.scrollHeight;

                    // 模拟打字延迟 (500ms - 1500ms)
                    if (messagesToSend.length > 1) {
                        await new Promise(r => setTimeout(r, 500 + Math.random() * 1000));
                    }
                }

                updateChatStatus('在线', 'online');

                if (currentChatCharacter.settings.autoSummary) {
                    const threshold = currentChatCharacter.settings.summaryInterval || 10;
                    if (currentChatCharacter.chatHistory.length % threshold === 0) {
                        generateSummaryForCurrentContext(currentChatCharacter);
                    }
                }

            } catch(error) {
                updateChatStatus(`错误: ${error.message}`, 'error');
                document.getElementById('character-ai-reply-btn').style.display = 'block';
                console.error('AI回复失败:', error);
            }
        }

        // 更新聊天状态
        function updateChatStatus(text, type = 'online') {
            const statusEl = document.getElementById('chat-status-text');
            if(!statusEl) return;

            statusEl.textContent = text;

            // 根据类型设置颜色
            if(type === 'thinking') {
                statusEl.style.color = 'var(--accent)';
                statusEl.style.opacity = '1';
            } else if(type === 'error') {
                statusEl.style.color = '#c62828';
                statusEl.style.opacity = '1';
            } else {
                statusEl.style.color = '';
                statusEl.style.opacity = '0.6';
            }
        }

        // 构建角色系统提示词 (支持心声)
        async function buildCharacterSystemPrompt() {
            let prompt = '';

            // 1. 角色核心设定
            prompt += `# 角色核心设定\n\n`;
            prompt += `你是 ${currentChatCharacter.name}。\n\n`;

            if(currentChatCharacter.description) prompt += `## 角色描述\n${currentChatCharacter.description}\n\n`;
            if(currentChatCharacter.personality) prompt += `## 性格特点\n${currentChatCharacter.personality}\n\n`;
            if(currentChatCharacter.scenario) prompt += `## 当前场景\n${currentChatCharacter.scenario}\n\n`;
            if(currentChatCharacter.mes_example) prompt += `## 对话示例\n${currentChatCharacter.mes_example}\n\n`;

            // 2. 世界书内容注入（支持蓝灯常驻/绿灯关键词/紫灯语义触发）
            if(currentChatCharacter.settings.linkedWorldBookIds && currentChatCharacter.settings.linkedWorldBookIds.length > 0) {
                // 获取最近对话作为扫描上下文
                const scanDepth = currentChatCharacter.settings.worldBookScanDepth || 10;
                const recentMessages = currentChatCharacter.chatHistory.slice(-scanDepth);
                const contextTextRaw = recentMessages.map(m => m.content).join(' ');
                const contextText = contextTextRaw.toLowerCase(); // 用于关键词匹配

                let worldBookContent = '';
                let activatedCount = 0;

                // 预扫描：是否有需要语义匹配的条目
                let hasSemanticEntries = false;
                for (const wbId of currentChatCharacter.settings.linkedWorldBookIds) {
                    const wb = await db.worldBooks.get(wbId);
                    if (wb && wb.entries && wb.entries.some(e => e.enabled && e.triggerMode === 'semantic' && e.embedding)) {
                        hasSemanticEntries = true;
                        break;
                    }
                }

                // 如有语义条目，计算一次上下文向量
                let contextEmbedding = null;
                if (hasSemanticEntries) {
                    try {
                        contextEmbedding = await semanticEmbeddingService.embed(contextTextRaw);
                    } catch (e) {
                        console.warn('[世界书] 语义模型加载失败，跳过语义触发条目:', e.message);
                    }
                }

                const semanticThreshold = currentChatCharacter.settings.semanticThreshold || 0.55;

                for(const wbId of currentChatCharacter.settings.linkedWorldBookIds) {
                    const wb = await db.worldBooks.get(wbId);
                    if(wb && wb.entries && wb.entries.length > 0) {
                        let bookContent = '';

                        wb.entries.filter(entry => entry.enabled).forEach(entry => {
                            const triggerMode = entry.triggerMode || 'keyword';
                            let shouldActivate = false;

                            if (triggerMode === 'always') {
                                // 蓝灯常驻：始终激活
                                shouldActivate = true;
                            } else if (triggerMode === 'semantic') {
                                // 紫灯语义：余弦相似度匹配
                                if (contextEmbedding && entry.embedding) {
                                    const similarity = semanticEmbeddingService.cosineSimilarity(contextEmbedding, entry.embedding);
                                    shouldActivate = similarity >= semanticThreshold;
                                    if (shouldActivate) {
                                        console.log(`[世界书] 语义匹配: "${entry.name}" (相似度: ${similarity.toFixed(3)})`);
                                    }
                                }
                            } else {
                                // 绿灯关键词触发：检查关键词是否出现在上下文中
                                if (entry.keys && entry.keys.length > 0) {
                                    shouldActivate = entry.keys.some(key => {
                                        const keyLower = key.toLowerCase().trim();
                                        return keyLower && contextText.includes(keyLower);
                                    });
                                }
                            }

                            if (shouldActivate) {
                                bookContent += `\n### ${entry.name}\n${entry.content}\n`;
                                activatedCount++;
                            }
                        });

                        if (bookContent) {
                            worldBookContent += `## ${wb.name}\n${bookContent}\n`;
                        }
                    }
                }

                if (worldBookContent) {
                    prompt += `# 世界观设定 (必须严格遵守)\n\n`;
                    prompt += worldBookContent;
                    console.log(`[世界书] 已激活 ${activatedCount} 个条目`);
                }
            }

            // 2.5 关联 Bingo 卡注入
            if(currentChatCharacter.settings.bingoLinkIds && currentChatCharacter.settings.bingoLinkIds.length > 0) {
                prompt += `# 关联的任务/Bingo卡 (用户当前正在进行的计划)\n`;
                currentChatCharacter.settings.bingoLinkIds.forEach(pid => {
                    const project = store.projects.find(p => p.id === pid);
                    if(project && project.status === 'active') {
                        prompt += formatBingoProjectForAI(project) + "\n";
                    }
                });
                prompt += `\n`;
            }

            // 2.6 长期记忆注入：先自有记忆，再挂载引用记忆
            const ownMemories = Array.isArray(currentChatCharacter.longTermMemory) ? currentChatCharacter.longTermMemory : [];
            const ownLimitRaw = Number(currentChatCharacter.settings.pinnedMemory);
            const ownLimit = Number.isFinite(ownLimitRaw) ? Math.max(0, ownLimitRaw) : 3;
            const ownMounted = ownLimit > 0 ? ownMemories.slice(-ownLimit) : [];

            // 阅读室模式：额外注入角色本体的长期记忆（只读参考）
            let characterBaseMemories = [];
            if (currentReadingRoom && currentEditingCharacter) {
                const charMem = Array.isArray(currentEditingCharacter.longTermMemory) ? currentEditingCharacter.longTermMemory : [];
                characterBaseMemories = ownLimit > 0 ? charMem.slice(-ownLimit) : [];
            }

            const referencedMounted = currentCharacterSession
                ? await getMountedReferenceMemories(currentCharacterSession)
                : [];

            if (ownMounted.length > 0 || referencedMounted.length > 0 || characterBaseMemories.length > 0) {
                prompt += `# 长期记忆 (Long-term Memory)\n`;
                if (characterBaseMemories.length > 0) {
                    prompt += `## 角色基础记忆（只读）\n`;
                    characterBaseMemories.forEach(m => {
                        prompt += `- ${m}\n`;
                    });
                }
                if (ownMounted.length > 0) {
                    if (currentReadingRoom) prompt += `## 阅读室记忆\n`;
                    ownMounted.forEach(m => {
                        prompt += `- ${m}\n`;
                    });
                }
                referencedMounted.forEach(m => {
                    prompt += `- ${m}\n`;
                });
                prompt += `\n`;
            }

            // 3. 核心输出规则
            prompt += `# 输出规则\n`;
            prompt += `- 请以 ${currentChatCharacter.name} 的身份与我对话。\n`;
            prompt += `- 保持性格鲜明，拒绝死板的AI味。\n`;
            prompt += `- 直接输出回复内容即可，不需要JSON格式。\n`;

            // 时间感知 (如果启用)
            if (currentChatCharacter.settings.timeAwareness) {
                const now = new Date();
                const timeString = now.toLocaleString('zh-CN', { hour12: false });
                const hour = now.getHours();
                let timePeriod = '';
                if(hour >= 0 && hour < 6) timePeriod = '深夜';
                else if(hour >= 6 && hour < 9) timePeriod = '清晨';
                else if(hour >= 9 && hour < 12) timePeriod = '上午';
                else if(hour >= 12 && hour < 14) timePeriod = '中午';
                else if(hour >= 14 && hour < 18) timePeriod = '下午';
                else if(hour >= 18 && hour < 22) timePeriod = '晚上';
                else timePeriod = '深夜';

                prompt += `\n【当前时间信息】\n`;
                prompt += `系统时间: ${timeString}\n`;
                prompt += `时段: ${timePeriod}\n`;
                prompt += `(请根据当前时间调整你的问候语和状态，例如深夜提醒休息，早上问好)\n`;
            }
            
            return prompt;
        }

        // 打开心声面板
        function openInnerVoiceModal() {
            if(!currentChatCharacter) return;
            const data = currentChatCharacter.latestInnerVoice;
            
            if(!data) {
                alert('还没有捕捉到Ta的心声哦，试着再聊一句吧！');
                return;
            }

            document.getElementById('inner-voice-time').textContent = new Date().toLocaleTimeString();
            document.getElementById('iv-clothing').textContent = data.clothing || '...';
            document.getElementById('iv-behavior').textContent = data.behavior || '...';
            document.getElementById('iv-thoughts').textContent = data.thoughts || '...';
            document.getElementById('iv-naughty').textContent = data.naughtyThoughts || '...';

            const ivModal = document.getElementById('modal-inner-voice');
            ivModal.classList.add('active');
            if (currentReadingRoom) ivModal.style.zIndex = '9500';
        }

        // 监听输入框回车键
        document.addEventListener('DOMContentLoaded', function() {
            const chatInput = document.getElementById('character-chat-input');
            if(chatInput) {
                chatInput.addEventListener('keypress', function(e) {
                    if(e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        sendCharacterMessage();
                    }
                });
            }
        });

        async function init() {
            try {
                console.log('[初始化] 开始初始化...');

                console.log('[初始化] 加载数据...');
                loadData();

                console.log('[初始化] 检查日/周重置...');
                checkDailyReset();
                checkWeeklyReset();

                console.log('[初始化] 设置主题...');
                if(store.theme) setTheme(store.theme);

                console.log('[初始化] 更新UI...');
                updateBalanceUI();
                updateClock();
                setInterval(updateClock, 1000);

                console.log('[初始化] 渲染日历...');
                renderCalendar();

                console.log('[初始化] 渲染活跃列表...');
                renderActiveList();

                console.log('[初始化] 设置聊天监听器...');
                setupChatMessageListeners();

                console.log('[初始化] 初始化AI对话窗口...');
                initAiConversations();

                // 初始化世界书相关
                console.log('[初始化] 渲染世界书分类...');
                await renderWorldBookCategories();

                console.log('[初始化] 渲染世界书列表...');
                await renderWorldBookList();

                // 初始化角色列表
                console.log('[初始化] 渲染角色列表...');
                await renderCharacterList();

                // 初始化离线模式系统（带错误处理）
                console.log('[初始化] 初始化离线模式...');
                try {
                    networkManager.init();
                    offlineQueue.init();

                    // 如果有未处理的离线队列且当前在线，自动处理
                    if (networkManager.isOnline && offlineQueue.queue.length > 0) {
                        console.log('[初始化] 检测到离线队列，准备处理');
                        setTimeout(() => {
                            try {
                                offlineQueue.processQueue();
                            } catch (error) {
                                console.error('[初始化] 离线队列处理失败:', error);
                            }
                        }, 2000); // 延迟2秒处理
                    }
                } catch (error) {
                    console.error('[初始化] 离线模式初始化失败:', error);
                    // 离线模式初始化失败不应阻止页面正常运行
                }

                // 启动自动备份
                console.log('[初始化] 启动自动备份...');
                startAutoBackup();

                console.log('[初始化] ✓ 系统初始化完成');

            } catch (error) {
                console.error('[初始化] ✗ 初始化过程中发生错误:', error);
                console.error('[初始化] 错误堆栈:', error.stack);
                alert('页面初始化失败，请刷新重试。\n错误: ' + error.message);
            }
        }

        function updateClock() {
            const el = document.getElementById('sys-clock');
            if(el) el.innerText = new Date().toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit'});
        }

        function loadData() {
            try {
                // 检查 localStorage 是否可用
                if (!window.localStorage) {
                    throw new Error('localStorage 不可用，请检查浏览器设置');
                }

                const raw = localStorage.getItem(DB_KEY);
                if(raw) {
                    try {
                        const data = JSON.parse(raw);

                        // 验证数据结构
                        if (typeof data !== 'object' || data === null) {
                            throw new Error('数据格式无效');
                        }

                        store = { ...store, ...data };

                        // 确保必需字段存在（带默认值）
                        if(!store.shopItems) store.shopItems = [];
                        if(!store.redemptions) store.redemptions = [];
                        if(!store.gachaPool) store.gachaPool = ['喝杯奶茶','早睡一小时'];
                        if(!store.weeklyBills) store.weeklyBills = [];
                        if(!store.lastDailyCheck) store.lastDailyCheck = '';
                        if(!store.lastWeeklyReset) store.lastWeeklyReset = '';
                        if(!store.apiConfig) store.apiConfig = { main: { url: '', key: '', model: 'gpt-4', temperature: 0.8 }, sub: { url: '', key: '', model: 'gpt-3.5-turbo', temperature: 0.8 }, search: { provider: 'google', googleApiKey: '', googleCx: '', serperApiKey: '', zhipuApiKey: '' } };
                        if(!store.apiConfig.search) store.apiConfig.search = { provider: 'google', googleApiKey: '', googleCx: '', serperApiKey: '', zhipuApiKey: '' };
                        if(!store.aiChatHistory) store.aiChatHistory = [];
                        if(!store.characterGroups) store.characterGroups = ['默认分组', '特别关心'];
                        if(!store.bubblePresets) store.bubblePresets = {};
                        if(!store.reportArchive) store.reportArchive = [];
                        if(!store.readingContextConfig) store.readingContextConfig = { paragraphsBefore: 3, paragraphsAfter: 5, maxChars: 3000 };

                        console.log('[数据加载] 成功加载用户数据');
                    } catch(parseError) {
                        handleError(parseError, '数据解析失败', ErrorLevel.CRITICAL, true);

                        // 尝试备份损坏的数据
                        try {
                            const backupKey = `${DB_KEY}_backup_${Date.now()}`;
                            localStorage.setItem(backupKey, raw);
                            console.log(`[数据恢复] 已备份损坏数据到: ${backupKey}`);
                        } catch(backupError) {
                            console.error('[数据恢复] 备份失败:', backupError);
                        }

                        // 尝试从自动备份恢复
                        const restored = tryRestoreFromAutoBackup();
                        if (restored) {
                            store = { ...store, ...restored };
                            console.log('[数据恢复] 已从自动备份恢复');
                        } else {
                            console.log('[数据加载] 使用默认数据');
                        }
                    }
                }

                loadApiConfigToUI();
            } catch(e) {
                handleError(e, '数据加载失败', ErrorLevel.CRITICAL, true);
            }
        }

        function saveData() {
            try {
                // 检查 localStorage 是否可用
                if (!window.localStorage) {
                    throw new Error('localStorage 不可用');
                }

                // 检查存储空间
                const dataString = JSON.stringify(store);
                const dataSize = new Blob([dataString]).size;

                // localStorage 通常限制为 5-10MB
                if (dataSize > 5 * 1024 * 1024) {
                    handleError(
                        new Error(`数据量过大 (${(dataSize / 1024 / 1024).toFixed(2)}MB)`),
                        '数据保存警告',
                        ErrorLevel.WARNING,
                        true
                    );
                }

                localStorage.setItem(DB_KEY, dataString);
                updateBalanceUI();

                // 定期清理旧备份（可选）
                cleanupOldBackups();

            } catch(e) {
                if (e.name === 'QuotaExceededError') {
                    handleError(
                        new Error('存储空间已满，请清理数据或导出备份'),
                        '存储空间不足',
                        ErrorLevel.ERROR,
                        true
                    );
                } else {
                    handleError(e, '数据保存失败', ErrorLevel.ERROR, true);
                }
            }
        }

        // 清理旧备份（保留最近3个）
        function cleanupOldBackups() {
            try {
                const backupKeys = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key && key.startsWith(`${DB_KEY}_backup_`)) {
                        backupKeys.push(key);
                    }
                }

                // 按时间戳排序（键名包含时间戳）
                backupKeys.sort().reverse();

                // 保留最近3个，删除其余
                for (let i = 3; i < backupKeys.length; i++) {
                    localStorage.removeItem(backupKeys[i]);
                }
            } catch(e) {
                console.warn('[备份清理] 清理失败:', e);
            }
        }

        // ==================== 自动备份机制 ====================
        let autoBackupTimer = null;
        const AUTO_BACKUP_INTERVAL = 5 * 60 * 1000; // 5分钟
        const AUTO_BACKUP_KEY = `${DB_KEY}_auto_backup`;
        const AUTO_BACKUP_TIME_KEY = `${DB_KEY}_auto_backup_time`;

        function startAutoBackup() {
            if (autoBackupTimer) clearInterval(autoBackupTimer);
            autoBackupTimer = setInterval(() => {
                performAutoBackup();
            }, AUTO_BACKUP_INTERVAL);

            // 页面关闭/隐藏时也保存一次
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') {
                    performAutoBackup();
                }
            });
            window.addEventListener('beforeunload', () => {
                performAutoBackup();
            });

            // 检查是否需要提醒用户导出
            checkExportReminder();

            console.log('[自动备份] 已启动，间隔 5 分钟');
        }

        function performAutoBackup() {
            try {
                const dataString = JSON.stringify(store);
                const dataSize = new Blob([dataString]).size;

                // 如果数据超过 4MB，跳过自动备份避免撑爆 localStorage
                if (dataSize > 4 * 1024 * 1024) {
                    console.warn('[自动备份] 数据量过大，跳过自动快照');
                    return;
                }

                localStorage.setItem(AUTO_BACKUP_KEY, dataString);
                localStorage.setItem(AUTO_BACKUP_TIME_KEY, new Date().toISOString());
                console.log('[自动备份] 快照已保存 (' + (dataSize / 1024).toFixed(1) + 'KB)');
            } catch(e) {
                console.warn('[自动备份] 快照保存失败:', e);
            }
        }

        // 从自动备份恢复（在 loadData 检测到主数据损坏时调用）
        function tryRestoreFromAutoBackup() {
            try {
                const backupData = localStorage.getItem(AUTO_BACKUP_KEY);
                const backupTime = localStorage.getItem(AUTO_BACKUP_TIME_KEY);
                if (backupData) {
                    const parsed = JSON.parse(backupData);
                    const timeStr = backupTime ? new Date(backupTime).toLocaleString('zh-CN') : '未知时间';
                    if (confirm(`检测到数据异常！发现自动备份（${timeStr}），是否恢复？`)) {
                        return parsed;
                    }
                }
            } catch(e) {
                console.error('[自动备份] 恢复失败:', e);
            }
            return null;
        }

        // 定期提醒用户手动导出
        function checkExportReminder() {
            const lastExportKey = `${DB_KEY}_last_export`;
            const lastExport = localStorage.getItem(lastExportKey);
            const now = Date.now();
            const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

            if (!lastExport || (now - parseInt(lastExport)) > SEVEN_DAYS) {
                // 延迟提醒，不打断初始化
                setTimeout(() => {
                    showToast('已超过7天未手动导出备份，建议前往「数据归档」导出');
                }, 10000);
            }
        }

        // 标记导出时间（在 exportData 中调用）
        function markExportTime() {
            localStorage.setItem(`${DB_KEY}_last_export`, Date.now().toString());
        }

        function updateAiChatStatus(text, type = 'info', duration = 2000) {
            const statusEl = document.getElementById('ai-chat-status');
            if (!statusEl) return;
            const originalText = '在线';
            
            statusEl.textContent = text;
            if (type === 'thinking') {
                statusEl.style.color = 'var(--accent)';
            } else if (type === 'error') {
                statusEl.style.color = '#c62828';
            } else {
                 statusEl.style.color = '';
            }

            if (duration > 0) {
                setTimeout(() => {
                    statusEl.textContent = originalText;
                    statusEl.style.color = '';
                }, duration);
            }
        }

        // --- AI 助手引用功能 ---
        function setAiQuotePreview(msgIndex) {
            const msg = store.aiChatHistory[msgIndex];
            if (!msg) return;

            const roleName = msg.role === 'user' ? '你' : 'Vesper';
            const preview = msg.content.substring(0, 50) + (msg.content.length > 50 ? '...' : '');

            currentAiQuote = { index: msgIndex, role: msg.role, content: msg.content };

            const previewEl = document.getElementById('ai-quote-preview');
            const contentEl = document.getElementById('ai-quote-preview-content');
            contentEl.innerHTML = `<span style="opacity:0.6;">引用 ${roleName}:</span> ${escapeHtml(preview)}`;
            previewEl.classList.add('active');
            document.getElementById('ai-input').focus();
        }

        function clearAiQuotePreview() {
            currentAiQuote = null;
            document.getElementById('ai-quote-preview').classList.remove('active');
        }
        
        function scrollToAiMessage(msgIndex) {
            const container = document.getElementById('ai-chat-container');
            const msgDiv = container.querySelector(`.chat-message[data-msg-index="${msgIndex}"]`);

            if (msgDiv) {
                msgDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
                const bubble = msgDiv.querySelector('.chat-message-bubble');
                if (bubble) {
                    bubble.style.transition = 'outline 0.3s ease-in-out, box-shadow 0.3s ease-in-out';
                    bubble.style.outline = '2px solid var(--accent)';
                    bubble.style.boxShadow = '0 0 10px var(--accent)';
                    setTimeout(() => {
                        bubble.style.outline = 'none';
                        bubble.style.boxShadow = '';
                    }, 1500);
                }
            }
        }
        
        // --- AI 助手多选功能 ---
        function enterAiMultiSelectMode(initialBubble) {
            isAiMultiSelectMode = true;
            selectedAiMessageIndices.clear();

            const container = document.getElementById('ai-chat-container');
            if (container) container.classList.add('multi-select-mode');

            if (initialBubble) {
                const index = parseInt(initialBubble.dataset.msgIndex);
                toggleAiMessageSelection(initialBubble, index);
            }

            // 使用AI助手专用工具栏
            const toolbar = document.getElementById('ai-multi-select-toolbar');
            if (toolbar) {
                toolbar.style.display = 'flex';
            }
            updateAiSelectedCount();
        }

        function toggleAiMessageSelection(bubble, index) {
            if (selectedAiMessageIndices.has(index)) {
                selectedAiMessageIndices.delete(index);
                bubble.classList.remove('selected');
            } else {
                selectedAiMessageIndices.add(index);
                bubble.classList.add('selected');
            }
            updateAiSelectedCount();
        }
        
        function updateAiSelectedCount() {
            document.getElementById('ai-selected-count').textContent = selectedAiMessageIndices.size;
        }

        function selectAllAiMessages() {
            const container = document.getElementById('ai-chat-container');
            container.querySelectorAll('.chat-message-bubble').forEach(bubble => {
                const index = parseInt(bubble.dataset.msgIndex);
                if (!isNaN(index) && !selectedAiMessageIndices.has(index)) {
                    selectedAiMessageIndices.add(index);
                    bubble.classList.add('selected');
                }
            });
            updateAiSelectedCount();
        }

        function cancelAiMultiSelect() {
            isAiMultiSelectMode = false;
            selectedAiMessageIndices.clear();

            const container = document.getElementById('ai-chat-container');
            if (container) {
                container.classList.remove('multi-select-mode');
                container.querySelectorAll('.chat-message-bubble.selected').forEach(bubble => bubble.classList.remove('selected'));
            }

            // 隐藏AI助手专用工具栏
            const toolbar = document.getElementById('ai-multi-select-toolbar');
            if (toolbar) {
                toolbar.style.display = 'none';
            }
        }

        function deleteSelectedAiMessages() {
            if (selectedAiMessageIndices.size === 0) return;
            if (!confirm(`确定删除选中的 ${selectedAiMessageIndices.size} 条消息吗？`)) return;

            const sortedIndices = Array.from(selectedAiMessageIndices).sort((a, b) => b - a);
            sortedIndices.forEach(index => {
                store.aiChatHistory.splice(index, 1);
            });

            saveData();
            cancelAiMultiSelect();
            renderAiChatHistory();
        }


        // 初始化 Markdown 渲染器
        let md = null;
        if(typeof markdownit !== 'undefined') {
            md = markdownit({
                html: false,
                linkify: true,
                typographer: true,
                breaks: true
            });
        }

        function renderMarkdown(text) {
            if(!md) return escapeHtml(text).replace(/\n/g, '<br>');
            try {
                // 先渲染 Markdown
                let html = md.render(text);
                // 再渲染 LaTeX 公式
                html = renderLatex(html);
                return html;
            } catch(e) {
                return escapeHtml(text).replace(/\n/g, '<br>');
            }
        }

        /**
         * 渲染 LaTeX 数学公式
         * 支持格式:
         * - 行内公式: $...$ 或 \(...\)
         * - 块级公式: $$...$$ 或 \[...\]
         */
        function renderLatex(html) {
            if (typeof katex === 'undefined') {
                console.warn('KaTeX 未加载，跳过公式渲染');
                return html;
            }

            const getKatexOptions = (displayMode) => ({
                displayMode,
                throwOnError: false,
                strict: false,
                trust: true
            });

            // 用于保护已处理的公式，避免重复处理
            const placeholder = '@@LATEX_PLACEHOLDER_';
            const placeholders = [];

            // 渲染块级公式 $$...$$ (先处理块级，避免被行内匹配)
            html = html.replace(/\$\$([\s\S]*?)\$\$/g, (match, latex) => {
                try {
                    const rendered = katex.renderToString(latex.trim(), getKatexOptions(true));
                    placeholders.push(`<div class="katex-block">${rendered}</div>`);
                    return placeholder + (placeholders.length - 1) + '@@';
                } catch (e) {
                    console.warn('LaTeX 块级公式渲染失败:', e);
                    return match;
                }
            });

            // 渲染块级公式 \[...\]
            html = html.replace(/\\\[([\s\S]*?)\\\]/g, (match, latex) => {
                try {
                    const rendered = katex.renderToString(latex.trim(), getKatexOptions(true));
                    placeholders.push(`<div class="katex-block">${rendered}</div>`);
                    return placeholder + (placeholders.length - 1) + '@@';
                } catch (e) {
                    console.warn('LaTeX 块级公式渲染失败:', e);
                    return match;
                }
            });

            // 渲染行内公式 $...$ (不匹配 $$)
            html = html.replace(/(?<!\$)\$(?!\$)((?:[^$\\]|\\.)+?)\$(?!\$)/g, (match, latex) => {
                try {
                    const rendered = katex.renderToString(latex.trim(), getKatexOptions(false));
                    placeholders.push(`<span class="katex-inline">${rendered}</span>`);
                    return placeholder + (placeholders.length - 1) + '@@';
                } catch (e) {
                    console.warn('LaTeX 行内公式渲染失败:', e);
                    return match;
                }
            });

            // 渲染行内公式 \(...\)
            html = html.replace(/\\\(([\s\S]*?)\\\)/g, (match, latex) => {
                try {
                    const rendered = katex.renderToString(latex.trim(), getKatexOptions(false));
                    placeholders.push(`<span class="katex-inline">${rendered}</span>`);
                    return placeholder + (placeholders.length - 1) + '@@';
                } catch (e) {
                    console.warn('LaTeX 行内公式渲染失败:', e);
                    return match;
                }
            });

            // 还原占位符
            placeholders.forEach((content, index) => {
                html = html.replace(placeholder + index + '@@', content);
            });

            return html;
        }

        // API配置管理
        function loadApiConfigToUI() {
            if(store.apiConfig) {
                document.getElementById('main-api-url').value = store.apiConfig.main.url || '';
                document.getElementById('main-api-key').value = store.apiConfig.main.key || '';
                document.getElementById('main-api-model').value = store.apiConfig.main.model || 'gpt-4';
                document.getElementById('main-api-temp').value = store.apiConfig.main.temperature || 0.8;

                // 加载温度和Top-P的启用状态
                const tempEnabled = store.apiConfig.main.temperatureEnabled !== false; // 默认启用
                const toppEnabled = store.apiConfig.main.topPEnabled === true; // 默认禁用
                document.getElementById('main-api-temp-enabled').checked = tempEnabled;
                document.getElementById('main-api-temp').disabled = !tempEnabled;
                document.getElementById('main-api-topp-enabled').checked = toppEnabled;
                document.getElementById('main-api-topp').disabled = !toppEnabled;
                document.getElementById('main-api-topp').value = store.apiConfig.main.topP || 1;

                document.getElementById('sub-api-url').value = store.apiConfig.sub.url || '';
                document.getElementById('sub-api-key').value = store.apiConfig.sub.key || '';
                document.getElementById('sub-api-model').value = store.apiConfig.sub.model || 'gpt-3.5-turbo';

                // 加载搜索配置
                const searchConfig = store.apiConfig.search || {};
                document.getElementById('search-provider-select').value = searchConfig.provider || 'google';
                document.getElementById('google-search-api-key').value = searchConfig.googleApiKey || '';
                document.getElementById('google-search-cx').value = searchConfig.googleCx || '';
                document.getElementById('serper-api-key').value = searchConfig.serperApiKey || '';
                document.getElementById('zhipu-api-key').value = searchConfig.zhipuApiKey || '';
                toggleSearchInputs();
            }
            // 加载高德地图配置 (从 localStorage)
            document.getElementById('amap-key-input').value = localStorage.getItem('vesper_amap_key') || '';
            document.getElementById('user-city-input').value = localStorage.getItem('vesper_amap_city') || '';
            // 刷新预设下拉列表
            refreshApiPresetSelect();
        }

        // 切换API参数启用状态
        function toggleApiParam(param) {
            if (param === 'temp') {
                const enabled = document.getElementById('main-api-temp-enabled').checked;
                document.getElementById('main-api-temp').disabled = !enabled;
            } else if (param === 'topp') {
                const enabled = document.getElementById('main-api-topp-enabled').checked;
                document.getElementById('main-api-topp').disabled = !enabled;
            }
        }

        function saveApiConfig() {
            if (!store.apiConfig) store.apiConfig = {};
            store.apiConfig.main = {
                url: document.getElementById('main-api-url').value,
                key: document.getElementById('main-api-key').value,
                model: document.getElementById('main-api-model').value,
                temperature: parseFloat(document.getElementById('main-api-temp').value),
                temperatureEnabled: document.getElementById('main-api-temp-enabled').checked,
                topP: parseFloat(document.getElementById('main-api-topp').value),
                topPEnabled: document.getElementById('main-api-topp-enabled').checked
            };
            store.apiConfig.sub = {
                url: document.getElementById('sub-api-url').value,
                key: document.getElementById('sub-api-key').value,
                model: document.getElementById('sub-api-model').value,
                temperature: 0.8
            };
            // 保存搜索配置
            store.apiConfig.search = {
                provider: document.getElementById('search-provider-select').value,
                googleApiKey: document.getElementById('google-search-api-key').value,
                googleCx: document.getElementById('google-search-cx').value,
                serperApiKey: document.getElementById('serper-api-key').value,
                zhipuApiKey: document.getElementById('zhipu-api-key').value
            };
            // 保存高德地图配置到 localStorage (安全存储)
            const amapKey = document.getElementById('amap-key-input').value.trim();
            const userCity = document.getElementById('user-city-input').value.trim();
            if (amapKey) {
                localStorage.setItem('vesper_amap_key', amapKey);
            } else {
                localStorage.removeItem('vesper_amap_key');
            }
            if (userCity) {
                localStorage.setItem('vesper_amap_city', userCity);
            } else {
                localStorage.removeItem('vesper_amap_city');
            }
            saveData();
            alert('Vesper: API配置已保存!');
        }

        // 拉取模型列表
        async function fetchModels(apiType) {
            const urlInput = document.getElementById(`${apiType}-api-url`);
            const keyInput = document.getElementById(`${apiType}-api-key`);
            const modelSelect = document.getElementById(`${apiType}-api-model`);

            const url = urlInput.value.trim();
            const key = keyInput.value.trim();

            if(!url || !key) {
                alert('请先填写API地址和密钥!');
                return;
            }

            const apiUrl = url.endsWith('/') ? url + 'models' : url + '/models';

            try {
                const res = await fetch(apiUrl, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${key}`
                    }
                });

                if(!res.ok) {
                    const errorText = await res.text();
                    throw new Error(`HTTP ${res.status}: ${res.statusText}\n详细信息: ${errorText}`);
                }

                const data = await res.json();
                const models = data.data || data.models || [];

                if(models.length === 0) {
                    alert('未找到可用模型,请检查API配置');
                    return;
                }

                // 清空并填充模型列表
                modelSelect.innerHTML = '';
                models.forEach(model => {
                    const modelId = model.id || model;
                    const option = document.createElement('option');
                    option.value = modelId;
                    option.textContent = modelId;
                    modelSelect.appendChild(option);
                });

                alert(`成功拉取${models.length}个模型!`);
            } catch(error) {
                alert(`拉取模型失败:\n${error.message}`);
            }
        }

        // 测试API连接
        async function testApiConnection(apiType) {
            const urlInput = document.getElementById(`${apiType}-api-url`);
            const keyInput = document.getElementById(`${apiType}-api-key`);
            const modelSelect = document.getElementById(`${apiType}-api-model`);

            const url = urlInput.value.trim();
            const key = keyInput.value.trim();
            const model = modelSelect.value;

            if(!url || !key) {
                alert('请先填写API地址和密钥!');
                return;
            }

            const apiUrl = url.endsWith('/') ? url + 'chat/completions' : url + '/chat/completions';

            try {
                const res = await fetch(apiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${key}`
                    },
                    body: JSON.stringify({
                        model: model,
                        messages: [{ role: 'user', content: 'hi' }],
                        max_tokens: 10
                    })
                });

                if(!res.ok) {
                    const errorText = await res.text();
                    throw new Error(`HTTP ${res.status}: ${res.statusText}\n详细信息: ${errorText}`);
                }

                const data = await res.json();
                const reply = data.choices?.[0]?.message?.content || '(无响应内容)';

                alert(`✅ 连接成功!\n模型: ${model}\n响应: ${reply}`);
            } catch(error) {
                alert(`❌ 连接失败:\n${error.message}`);
            }
        }

        // 刷新预设下拉列表
        function refreshApiPresetSelect() {
            const select = document.getElementById('api-preset-select');
            select.innerHTML = '<option value="">-- 选择预设 --</option>';
            if (store.apiPresets) {
                Object.keys(store.apiPresets).forEach(name => {
                    const option = document.createElement('option');
                    option.value = name;
                    option.textContent = name;
                    select.appendChild(option);
                });
            }
        }

        // 保存API预设 (使用输入框名称)
        function saveApiPresetWithName() {
            const presetName = document.getElementById('new-preset-name').value.trim();
            if(!presetName) {
                alert('请输入预设名称!');
                return;
            }

            if(!store.apiPresets) store.apiPresets = {};

            store.apiPresets[presetName] = {
                main: {
                    url: document.getElementById('main-api-url').value,
                    key: document.getElementById('main-api-key').value,
                    model: document.getElementById('main-api-model').value,
                    temperature: parseFloat(document.getElementById('main-api-temp').value)
                },
                sub: {
                    url: document.getElementById('sub-api-url').value,
                    key: document.getElementById('sub-api-key').value,
                    model: document.getElementById('sub-api-model').value,
                    temperature: 0.8
                }
            };

            saveData();
            document.getElementById('new-preset-name').value = '';
            refreshApiPresetSelect();
            document.getElementById('api-preset-select').value = presetName;
            alert(`预设 "${presetName}" 已保存!`);
        }

        // 加载选中的API预设
        function loadSelectedApiPreset() {
            const select = document.getElementById('api-preset-select');
            const presetName = select.value;

            if(!presetName) {
                alert('请先选择一个预设!');
                return;
            }

            if(!store.apiPresets || !store.apiPresets[presetName]) {
                alert('未找到该预设!');
                return;
            }

            const preset = store.apiPresets[presetName];

            // 加载主 API 配置
            document.getElementById('main-api-url').value = preset.main.url || '';
            document.getElementById('main-api-key').value = preset.main.key || '';
            document.getElementById('main-api-temp').value = preset.main.temperature || 0.8;

            // 加载主模型 - 如果模型不在选项中，先添加该选项
            const mainModelSelect = document.getElementById('main-api-model');
            const mainModel = preset.main.model || 'gpt-4';
            if (mainModel && !Array.from(mainModelSelect.options).some(opt => opt.value === mainModel)) {
                const option = document.createElement('option');
                option.value = mainModel;
                option.textContent = mainModel;
                mainModelSelect.appendChild(option);
            }
            mainModelSelect.value = mainModel;

            // 加载副 API 配置
            document.getElementById('sub-api-url').value = preset.sub?.url || '';
            document.getElementById('sub-api-key').value = preset.sub?.key || '';

            // 加载副模型 - 如果模型不在选项中，先添加该选项
            const subModelSelect = document.getElementById('sub-api-model');
            const subModel = preset.sub?.model || 'gpt-3.5-turbo';
            if (subModel && !Array.from(subModelSelect.options).some(opt => opt.value === subModel)) {
                const option = document.createElement('option');
                option.value = subModel;
                option.textContent = subModel;
                subModelSelect.appendChild(option);
            }
            subModelSelect.value = subModel;

            alert(`已加载预设 "${presetName}"!`);
        }

        // 删除选中的API预设
        function deleteSelectedApiPreset() {
            const select = document.getElementById('api-preset-select');
            const presetName = select.value;

            if(!presetName) {
                alert('请先选择一个预设!');
                return;
            }

            if(!confirm(`确定要删除预设 "${presetName}" 吗?`)) {
                return;
            }

            if(store.apiPresets && store.apiPresets[presetName]) {
                delete store.apiPresets[presetName];
                saveData();
                refreshApiPresetSelect();
                alert(`预设 "${presetName}" 已删除!`);
            }
        }

        // 保存API预设 (旧函数保留兼容)
        function saveApiPreset() {
            const presetName = prompt('请输入预设名称:');
            if(!presetName) return;

            if(!store.apiPresets) store.apiPresets = {};

            store.apiPresets[presetName] = {
                main: {
                    url: document.getElementById('main-api-url').value,
                    key: document.getElementById('main-api-key').value,
                    model: document.getElementById('main-api-model').value,
                    temperature: parseFloat(document.getElementById('main-api-temp').value)
                },
                sub: {
                    url: document.getElementById('sub-api-url').value,
                    key: document.getElementById('sub-api-key').value,
                    model: document.getElementById('sub-api-model').value,
                    temperature: 0.8
                }
            };

            saveData();
            refreshApiPresetSelect();
            alert(`预设 "${presetName}" 已保存!`);
        }

        // 加载API预设 (旧函数保留兼容)
        function loadApiPreset() {
            if(!store.apiPresets || Object.keys(store.apiPresets).length === 0) {
                alert('暂无保存的预设!');
                return;
            }

            const presetNames = Object.keys(store.apiPresets);
            const presetName = prompt(`请选择预设:\n\n${presetNames.map((n, i) => `${i+1}. ${n}`).join('\n')}\n\n请输入预设名称:`);

            if(!presetName || !store.apiPresets[presetName]) {
                alert('未找到该预设!');
                return;
            }

            const preset = store.apiPresets[presetName];

            document.getElementById('main-api-url').value = preset.main.url;
            document.getElementById('main-api-key').value = preset.main.key;
            document.getElementById('main-api-model').value = preset.main.model;
            document.getElementById('main-api-temp').value = preset.main.temperature;

            document.getElementById('sub-api-url').value = preset.sub.url;
            document.getElementById('sub-api-key').value = preset.sub.key;
            document.getElementById('sub-api-model').value = preset.sub.model;

            alert(`已加载预设 "${presetName}"!`);
        }

        // 渲染 AI 聊天历史
        function renderAiChatHistory() {
            const container = document.getElementById('ai-chat-container');
            container.innerHTML = '';
            
            if (store.aiChatHistory.length === 0) {
                container.innerHTML = '<div style="text-align:center; opacity:0.5; margin-top:100px;">Vesper 在此待命。</div>';
                return;
            }

            store.aiChatHistory.forEach((msg, index) => {
                if (msg.hidden) return;

                const isUser = msg.role === 'user';
                
                let quoteHtml = '';
                if (msg.quote) {
                    const quoteRoleName = msg.quote.role === 'user' ? '你' : 'Vesper';
                    const quotePreview = msg.quote.content.substring(0, 80) + (msg.quote.content.length > 80 ? '...' : '');
                    quoteHtml = `
                        <div class="quote-block" onclick="scrollToAiMessage(${msg.quote.index})" title="点击跳转到原消息">
                            <div class="quote-block-header">↩ 引用 ${quoteRoleName}</div>
                            <div class="quote-block-content">${escapeHtml(quotePreview)}</div>
                        </div>
                    `;
                }

                const contentHtml = `<div class="markdown-content">${renderMarkdown(msg.content)}</div>`;
                const timeStr = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '';

                const msgDiv = document.createElement('div');
                msgDiv.className = `chat-message ${isUser ? 'user' : 'ai'}`;
                msgDiv.style.cssText = `margin-bottom:15px; text-align:${isUser ? 'right' : 'left'};`;
                msgDiv.dataset.msgIndex = index;

                const bubbleDiv = document.createElement('div');
                bubbleDiv.className = 'chat-message-bubble';
                bubbleDiv.style.cssText = `display:inline-block; background:${isUser ? 'var(--accent)' : 'var(--card-bg)'}; color:${isUser ? 'var(--bg)' : 'var(--text)'}; padding:10px 15px; border-radius:12px; max-width:80%; text-align:left; cursor:pointer; ${!isUser ? 'border-left:3px solid var(--accent);' : ''}`;

                bubbleDiv.dataset.msgIndex = index;
                bubbleDiv.dataset.msgRole = msg.role;
                bubbleDiv.dataset.msgContent = msg.content;

                bubbleDiv.innerHTML = `
                    ${quoteHtml}
                    ${contentHtml}
                    ${timeStr ? `<div style="font-size:0.7rem; opacity:0.6; margin-top:5px; text-align:right;">${timeStr}</div>` : ''}
                `;

                // Attach event listeners
                setupAiMessageLongPress(bubbleDiv);

                msgDiv.appendChild(bubbleDiv);
                container.appendChild(msgDiv);
            });

            // 滚动到底部
            setTimeout(() => {
                container.scrollTop = container.scrollHeight;
            }, 50);
        }

        // AI助手聊天功能
        async function sendAiUserMessage() {
            const input = document.getElementById('ai-input');
            let userMessage = input.value.trim();

            // 搜索模式：即使输入为空也可以触发（AI会分析上下文）
            if (isAiSearchEnabled) {
                await executeSmartWebSearch('ai');
                return;
            }

            if (isAiLocalSearchEnabled) {
                await executeSmartLocalSearch('ai');
                return;
            }

            // 普通消息模式：必须有内容
            if (!userMessage) return;

            input.value = '';

            const userMsg = {
                role: 'user',
                content: userMessage,
                timestamp: Date.now()
            };

            if (currentAiQuote) {
                userMsg.quote = {
                    index: currentAiQuote.index,
                    role: currentAiQuote.role,
                    content: currentAiQuote.content.substring(0, 200) // 限制引用长度
                };
                clearAiQuotePreview();
            }

            store.aiChatHistory.push(userMsg);
            saveData();

            renderAiChatHistory();

            // 显示AI回复按钮
            document.getElementById('ai-reply-btn').style.display = 'block';
        }

        // --- AI 助手专属事件处理 ---
        let currentAiMessageBubble = null;

        function setupAiMessageLongPress(bubble) {
            let longPressTimer = null;

            bubble.addEventListener('touchstart', function(e) {
                if (isAiMultiSelectMode) return;
                longPressTimer = setTimeout(() => {
                    showAiContextMenu(e, bubble);
                }, 500);
            });

            bubble.addEventListener('touchend', function(e) {
                clearTimeout(longPressTimer);
                if (isAiMultiSelectMode) {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleAiMessageSelection(bubble, parseInt(bubble.dataset.msgIndex));
                }
            });

            bubble.addEventListener('touchmove', () => clearTimeout(longPressTimer));

            bubble.addEventListener('contextmenu', function(e) {
                e.preventDefault();
                if (!isAiMultiSelectMode) showAiContextMenu(e, bubble);
            });
            
            bubble.addEventListener('click', function(e) {
                if (isAiMultiSelectMode) {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleAiMessageSelection(bubble, parseInt(bubble.dataset.msgIndex));
                }
            });
        }

        function showAiContextMenu(e, bubble) {
            currentAiMessageBubble = bubble;
            const menu = document.getElementById('ai-context-menu');
            if (!menu) return;
            const msgRole = bubble.dataset.msgRole;

            // Customize menu for AI chat
            const allItems = menu.querySelectorAll('.context-menu-item');
            allItems.forEach(item => item.style.display = 'flex');

            const retryItem = Array.from(allItems).find(item => item.textContent.includes('刷新回复'));
            const editItem = Array.from(allItems).find(item => item.textContent.includes('编辑消息'));
            
            if (msgRole === 'user') {
                if(retryItem) retryItem.style.display = 'none';
            } else { // AI message
                if(editItem) editItem.style.display = 'none'; // Can't edit AI message
            }
            
            menu.classList.add('active');
            const x = e.touches ? e.touches[0].clientX : e.clientX;
            const y = e.touches ? e.touches[0].clientY : e.clientY;
            menu.style.left = x + 'px';
            menu.style.top = y + 'px';

            // Boundary check
            setTimeout(() => {
                const rect = menu.getBoundingClientRect();
                if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 10) + 'px';
                if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 10) + 'px';
            }, 10);
        }

        async function handleAiContextAction(action) {
            const menu = document.getElementById('ai-context-menu');
            if(menu) menu.classList.remove('active');

            if (!currentAiMessageBubble) return;

            const msgIndex = parseInt(currentAiMessageBubble.dataset.msgIndex);
            const msg = store.aiChatHistory[msgIndex];
            if (!msg) return;

            switch(action) {
                case 'copy':
                    navigator.clipboard.writeText(msg.content).then(() => updateAiChatStatus('已复制', 'info', 1500));
                    break;
                case 'quote':
                    setAiQuotePreview(msgIndex);
                    break;
                case 'multiSelect':
                    enterAiMultiSelectMode(currentAiMessageBubble);
                    break;
                case 'retry':
                    if (msg.role === 'assistant') {
                        // Delete this AI message and trigger a new response
                        store.aiChatHistory.splice(msgIndex, 1);
                        saveData();
                        renderAiChatHistory();
                        triggerAiAssistantResponse();
                    }
                    break;
                case 'delete':
                    if (confirm('确定删除这条消息吗?')) {
                        store.aiChatHistory.splice(msgIndex, 1);
                        saveData();
                        renderAiChatHistory();
                    }
                    break;
                case 'edit':
                     if (msg.role === 'user') {
                        const newContent = prompt('编辑消息:', msg.content);
                        if (newContent && newContent.trim()) {
                            store.aiChatHistory[msgIndex].content = newContent;
                            saveData();
                            renderAiChatHistory();
                        }
                    }
                    break;
                case 'hide':
                    if (confirm('确定撤回这条消息吗? (AI仍能看到)')) {
                        store.aiChatHistory[msgIndex].hidden = true;
                        saveData();
                        renderAiChatHistory();
                    }
                    break;
            }
        }

        async function triggerAiAssistantResponse() {
            if(!store.apiConfig.main.url || !store.apiConfig.main.key) {
                alert('Vesper: 请先在API设置中配置主API!');
                return;
            }

            document.getElementById('ai-reply-btn').style.display = 'none';
            updateAiChatStatus('Vesper 正在思考...', 'thinking', 0);

            const chatContainer = document.getElementById('ai-chat-container');
            const loadingId = `ai-loading-${Date.now()}`;
            chatContainer.insertAdjacentHTML('beforeend', `<div id="${loadingId}" style="margin-bottom:15px;"><div style="display:inline-block; background:var(--card-bg); padding:10px 15px; border-radius:12px; animation: pulse 1s infinite;">...</div></div>`);
            chatContainer.scrollTop = chatContainer.scrollHeight;

            const lastUserMessage = store.aiChatHistory.filter(m => m.role === 'user').pop();
            if (!lastUserMessage) {
                 updateAiChatStatus('在线', 'info', 0);
                 const loadingEl = document.getElementById(loadingId);
                 if(loadingEl) loadingEl.remove();
                 return;
            }

            try {
                const response = await callAI(lastUserMessage.content);
                const loadingEl = document.getElementById(loadingId);
                if(loadingEl) loadingEl.remove();

                store.aiChatHistory.push({ role: 'assistant', content: response, timestamp: Date.now() });
                saveData();

                renderAiChatHistory();
                updateAiChatStatus('在线', 'info', 0);

            } catch(error) {
                const loadingEl = document.getElementById(loadingId);
                if(loadingEl) loadingEl.remove();
                chatContainer.insertAdjacentHTML('beforeend', `
                    <div class="chat-message" style="margin-bottom:15px;">
                        <div style="display:inline-block; background:#ffebee; color:#c62828; padding:10px 15px; border-radius:12px; max-width:80%;">
                            <div>错误: ${escapeHtml(error.message)}</div>
                        </div>
                    </div>
                `);
                chatContainer.scrollTop = chatContainer.scrollHeight;
                updateAiChatStatus('回复失败', 'error', 3000);
                document.getElementById('ai-reply-btn').style.display = 'block';
            }
        }

        async function sendAiMessage(retryMessage = null) {
            if (retryMessage) {
                const input = document.getElementById('ai-input');
                input.value = retryMessage;
                await sendAiUserMessage();
                await triggerAiAssistantResponse();
            } else {
                // This function is now primarily for the retry mechanism.
                // The regular send button calls sendAiUserMessage directly.
                console.warn("sendAiMessage called without retryMessage. This might be unintended.");
            }
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML.replace(/'/g, '&#39;').replace(/"/g, '"');
        }

