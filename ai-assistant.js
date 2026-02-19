        function deleteMessage(msgId) {
            const userMsg = document.getElementById(`msg-${msgId}-user`);
            const aiMsg = document.getElementById(`msg-${msgId}-ai`);
            const errorMsg = document.getElementById(`msg-${msgId}-error`);
            if(userMsg) userMsg.remove();
            if(aiMsg) aiMsg.remove();
            if(errorMsg) errorMsg.remove();

            // 从历史记录中删除对应的消息对
            const userIndex = store.aiChatHistory.findIndex((m, i) =>
                m.role === 'user' && store.aiChatHistory[i+1] && i % 2 === 0
            );
            if(userIndex !== -1) {
                store.aiChatHistory.splice(userIndex, 2);
                saveData();
            }
        }

        function retryMessage(userMessage, oldMsgId) {
            // 删除旧的AI回复和错误消息
            const aiMsg = document.getElementById(`msg-${oldMsgId}-ai`);
            const errorMsg = document.getElementById(`msg-${oldMsgId}-error`);
            if(aiMsg) aiMsg.remove();
            if(errorMsg) errorMsg.remove();

            // 从历史中删除旧的AI回复
            const lastMsg = store.aiChatHistory[store.aiChatHistory.length - 1];
            if(lastMsg && lastMsg.role === 'assistant') {
                store.aiChatHistory.pop();
                saveData();
            }

            // 重新发送
            sendAiMessage(userMessage);
        }

        function clearAllChat() {
            if(!confirm('确定清空所有聊天记录?')) return;

            store.aiChatHistory = [];
            saveData();

            const chatContainer = document.getElementById('ai-chat-container');
            chatContainer.innerHTML = '<div style="text-align:center; opacity:0.5; margin-top:100px;">Vesper 在此待命。</div>';

            alert('聊天记录已清空!');
        }

        // === AI对话窗口管理 ===
        function initAiConversations() {
            // 初始化对话列表，确保有默认对话
            if (!store.aiConversations) store.aiConversations = [];

            // 如果旧的aiChatHistory有数据，迁移到第一个对话
            if (store.aiChatHistory && store.aiChatHistory.length > 0 && store.aiConversations.length === 0) {
                const now = Date.now();
                store.aiConversations.push({
                    id: now,
                    name: '上一轮对话',
                    history: store.aiChatHistory,
                    createdAt: now,
                    updatedAt: now
                });
                store.currentAiConversationId = now;
                store.aiChatHistory = store.aiConversations[0].history; // 引用
                saveData();
            }

            // 如果没有对话，创建默认对话
            if (store.aiConversations.length === 0) {
                createNewAiConversation();
            }

            // 如果没有当前对话ID，设置为第一个
            if (!store.currentAiConversationId && store.aiConversations.length > 0) {
                store.currentAiConversationId = store.aiConversations[0].id;
                store.aiChatHistory = store.aiConversations[0].history;
            }
        }

        function createNewAiConversation(name) {
            const now = Date.now();
            const defaultName = name || new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');

            const newConv = {
                id: now,
                name: defaultName,
                history: [],
                createdAt: now,
                updatedAt: now
            };

            store.aiConversations.push(newConv);
            store.currentAiConversationId = now;
            store.aiChatHistory = newConv.history;

            saveData();
            renderAiChatHistory();
            updateAiConversationTitle();
            closeAiConversationList();

            return newConv;
        }

        function switchAiConversation(convId) {
            const conv = store.aiConversations.find(c => c.id === convId);
            if (!conv) return;

            store.currentAiConversationId = convId;
            store.aiChatHistory = conv.history;

            saveData();
            renderAiChatHistory();
            updateAiConversationTitle();
            closeAiConversationList();
        }

        function deleteAiConversation(convId) {
            const index = store.aiConversations.findIndex(c => c.id === convId);
            if (index === -1) return;

            if (store.aiConversations.length === 1) {
                alert('至少需要保留一个对话窗口');
                return;
            }

            if (!confirm('确定删除这个对话吗？')) return;

            store.aiConversations.splice(index, 1);

            // 如果删除的是当前对话，切换到第一个
            if (store.currentAiConversationId === convId) {
                store.currentAiConversationId = store.aiConversations[0].id;
                store.aiChatHistory = store.aiConversations[0].history;
            }

            saveData();
            renderAiConversationList();
            renderAiChatHistory();
            updateAiConversationTitle();
        }

        function renameAiConversation(convId) {
            const conv = store.aiConversations.find(c => c.id === convId);
            if (!conv) return;

            const newName = prompt('重命名对话:', conv.name);
            if (newName && newName.trim()) {
                conv.name = newName.trim();
                conv.updatedAt = Date.now();
                saveData();
                renderAiConversationList();
                updateAiConversationTitle();
            }
        }

        function updateAiConversationTitle() {
            const conv = store.aiConversations.find(c => c.id === store.currentAiConversationId);
            const titleEl = document.getElementById('ai-conversation-title');
            if (titleEl && conv) {
                titleEl.textContent = conv.name;
            }
        }

        let aiConvListVisible = false;

        function toggleAiConversationList() {
            if (aiConvListVisible) {
                closeAiConversationList();
            } else {
                openAiConversationList();
            }
        }

        function openAiConversationList() {
            aiConvListVisible = true;
            renderAiConversationList();

            const sidebar = document.getElementById('ai-conversation-sidebar');
            const overlay = document.getElementById('ai-conversation-overlay');

            if (sidebar) {
                sidebar.classList.add('active');
            }
            if (overlay) {
                overlay.classList.add('active');
            }
        }

        function closeAiConversationList() {
            aiConvListVisible = false;

            const sidebar = document.getElementById('ai-conversation-sidebar');
            const overlay = document.getElementById('ai-conversation-overlay');

            if (sidebar) {
                sidebar.classList.remove('active');
            }
            if (overlay) {
                overlay.classList.remove('active');
            }
        }

        function renderAiConversationList() {
            const listContainer = document.getElementById('ai-conversation-list-container');
            if (!listContainer) return;

            listContainer.innerHTML = '';

            // 添加"新对话"按钮
            const newBtn = document.createElement('div');
            newBtn.className = 'ai-conv-item ai-conv-new';
            newBtn.innerHTML = `
                <div style="font-size:1.5rem;">+</div>
                <div style="font-weight:bold;">新的对话</div>
            `;
            newBtn.onclick = () => createNewAiConversation();
            listContainer.appendChild(newBtn);

            // 渲染对话列表
            store.aiConversations.forEach(conv => {
                const item = document.createElement('div');
                item.className = 'ai-conv-item' + (conv.id === store.currentAiConversationId ? ' active' : '');

                const date = new Date(conv.updatedAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
                const msgCount = conv.history.length;

                item.innerHTML = `
                    <div style="flex:1;" onclick="switchAiConversation(${conv.id})">
                        <div style="font-weight:bold; font-size:0.95rem; margin-bottom:4px;">${escapeHtml(conv.name)}</div>
                        <div style="font-size:0.75rem; opacity:0.6;">${date} · ${msgCount}条消息</div>
                    </div>
                `;

                // 长按菜单
                let longPressTimer = null;
                item.addEventListener('touchstart', (e) => {
                    longPressTimer = setTimeout(() => {
                        showAiConvContextMenu(e, conv.id);
                    }, 500);
                });
                item.addEventListener('touchend', () => clearTimeout(longPressTimer));
                item.addEventListener('touchmove', () => clearTimeout(longPressTimer));

                item.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    showAiConvContextMenu(e, conv.id);
                });

                listContainer.appendChild(item);
            });
        }

        function showAiConvContextMenu(e, convId) {
            e.preventDefault();
            e.stopPropagation();

            const menu = document.createElement('div');
            menu.className = 'context-menu active';
            menu.style.position = 'fixed';
            menu.style.zIndex = '10000';

            const x = e.touches ? e.touches[0].clientX : e.clientX;
            const y = e.touches ? e.touches[0].clientY : e.clientY;
            menu.style.left = x + 'px';
            menu.style.top = y + 'px';

            menu.innerHTML = `
                <div class="context-menu-item" onclick="renameAiConversation(${convId}); this.parentElement.remove();">✎ 重命名</div>
                <div class="context-menu-item" style="color:#c62828;" onclick="deleteAiConversation(${convId}); this.parentElement.remove();">🗑️ 删除</div>
            `;

            document.body.appendChild(menu);

            // 点击外部关闭
            setTimeout(() => {
                const closeMenu = () => {
                    menu.remove();
                    document.removeEventListener('click', closeMenu);
                };
                document.addEventListener('click', closeMenu);
            }, 100);

            // 边界检查
            setTimeout(() => {
                const rect = menu.getBoundingClientRect();
                if (rect.right > window.innerWidth) {
                    menu.style.left = (window.innerWidth - rect.width - 10) + 'px';
                }
                if (rect.bottom > window.innerHeight) {
                    menu.style.top = (window.innerHeight - rect.height - 10) + 'px';
                }
            }, 10);
        }

        // 长按菜单相关
        let currentContextMsgId = null;
        let currentContextMsgType = null;
        let currentContextMsgContent = null;
        let currentContextUserMsg = null;

        function setupChatMessageListeners() {
            // This function is now deprecated for AI chat, 
            // as listeners are attached dynamically in renderAiChatHistory.
            // It remains for any other potential usage.
        }

        function showContextMenu(e, msgEl) {
            const menu = document.getElementById('context-menu');
            currentContextMsgId = msgEl.dataset.msgId;
            currentContextMsgType = msgEl.dataset.msgType;
            currentContextMsgContent = msgEl.dataset.msgContent;
            currentContextUserMsg = msgEl.dataset.userMsg;

            // 根据消息类型显示不同的菜单项
            const allItems = menu.querySelectorAll('.context-menu-item');
            allItems.forEach(item => item.style.display = 'flex');

            // 用户消息不显示"刷新重试"
            if(currentContextMsgType === 'user') {
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

        function contextMenuAction(action) {
            const menu = document.getElementById('context-menu');
            menu.classList.remove('active');

            switch(action) {
                case 'copy':
                    const tempTextarea = document.createElement('textarea');
                    tempTextarea.value = decodeHtmlEntities(currentContextMsgContent);
                    document.body.appendChild(tempTextarea);
                    tempTextarea.select();
                    document.execCommand('copy');
                    document.body.removeChild(tempTextarea);
                    alert('内容已复制到剪贴板');
                    break;

                case 'edit':
                    const newContent = prompt('编辑消息内容:', decodeHtmlEntities(currentContextMsgContent));
                    if(newContent && newContent.trim()) {
                        const msgEl = document.getElementById(`msg-${currentContextMsgId}-${currentContextMsgType}`);
                        if(msgEl) {
                            const contentDiv = msgEl.querySelector('.markdown-content') || msgEl.querySelector('div > div');
                            if(contentDiv) {
                                if(currentContextMsgType === 'ai') {
                                    contentDiv.innerHTML = renderMarkdown(newContent);
                                } else {
                                    contentDiv.textContent = newContent;
                                }
                                msgEl.dataset.msgContent = escapeHtml(newContent);
                                store.aiChatHistory.forEach(msg => {
                                    if(msg.content === decodeHtmlEntities(currentContextMsgContent)) {
                                        msg.content = newContent;
                                    }
                                });
                                saveData();
                            }
                        }
                    }
                    break;

                case 'retry':
                    if(currentContextMsgType === 'ai' || currentContextMsgType === 'error') {
                        retryMessage(decodeHtmlEntities(currentContextUserMsg), currentContextMsgId);
                    }
                    break;

                case 'quote':
                    const input = document.getElementById('ai-input');
                    input.value = `> ${decodeHtmlEntities(currentContextMsgContent)}\n\n`;
                    input.focus();
                    break;

                case 'delete':
                    deleteMessage(currentContextMsgId);
                    break;
            }
        }

        function decodeHtmlEntities(text) {
            const txt = document.createElement('textarea');
            txt.innerHTML = text;
            return txt.value;
        }

        // 点击其他地方关闭菜单
        document.addEventListener('click', function(e) {
            if (!e.target.closest('.context-menu') && !e.target.closest('.chat-message-bubble')) {
                document.querySelectorAll('.context-menu').forEach(menu => menu.classList.remove('active'));
            }
        });

        function openAiSettings() {
            document.getElementById('ai-context-limit').value = store.aiContextLimit !== undefined ? store.aiContextLimit : 50;
            
            const bgConfig = store.aiBgActivity || { enabled: false, interval: 60 };
            document.getElementById('ai-bg-activity-enabled').checked = bgConfig.enabled;
            document.getElementById('ai-bg-activity-interval').value = bgConfig.interval;

            document.getElementById('panel-ai-assistant').classList.remove('active');
            document.getElementById('panel-ai-settings').classList.add('active');
        }

        function closeAiSettings() {
            document.getElementById('panel-ai-settings').classList.remove('active');
            document.getElementById('panel-ai-assistant').classList.add('active');
        }

        function saveAiSettings() {
            const contextVal = parseInt(document.getElementById('ai-context-limit').value);
            store.aiContextLimit = isNaN(contextVal) ? 50 : contextVal; // 0=无限制

            store.aiBgActivity = {
                enabled: document.getElementById('ai-bg-activity-enabled').checked,
                interval: parseInt(document.getElementById('ai-bg-activity-interval').value) || 60
            };

            // AI关联的Bingo卡ID已在 confirmBingoCardSelectionForAI 函数中更新到 store
            // 此处直接保存即可
            saveData();
            alert('AI设置已保存!');
        }

        // --- AI Bingo Card Linking ---
        async function renderAILinkedBingoCards() {
            const container = document.getElementById('ai-linked-bingo-cards');
            container.innerHTML = '';
            if (!store.aiLinkedBingoIds || store.aiLinkedBingoIds.length === 0) {
                container.innerHTML = '<div style="opacity:0.5; font-size:0.8rem; padding:5px;">暂无关联的 Bingo 卡</div>';
                return;
            }
            for (const pId of store.aiLinkedBingoIds) {
                const project = store.projects.find(p => p.id === pId);
                if (project) {
                    const tag = document.createElement('div');
                    tag.style.cssText = 'background:var(--accent); color:var(--bg); padding:5px 12px; border-radius:15px; font-size:0.75rem; display:flex; align-items:center; gap:5px; margin-bottom:5px; margin-right:5px;';
                    tag.innerHTML = `${project.theme} <span style="cursor:pointer; font-weight:bold;" onclick="removeBingoCardFromAI(${pId}, event)">×</span>`;
                    container.appendChild(tag);
                }
            }
        }

        async function removeBingoCardFromAI(pId, event) {
            event.stopPropagation();
            const index = store.aiLinkedBingoIds.indexOf(pId);
            if (index > -1) {
                store.aiLinkedBingoIds.splice(index, 1);
                await renderAILinkedBingoCards();
            }
        }

        async function selectBingoCardsForAI() {
            const listDiv = document.getElementById('bingo-selection-list');
            const activeProjects = store.projects.filter(p => p.status === 'active');
            if (activeProjects.length === 0) {
                alert('暂无进行中的Bingo卡');
                return;
            }
            const linkedIds = store.aiLinkedBingoIds || [];
            listDiv.innerHTML = activeProjects.map(p => {
                const isLinked = linkedIds.includes(p.id);
                return `
                    <div style="padding:10px; border-bottom:1px solid rgba(0,0,0,0.05); display:flex; align-items:center; gap:10px;">
                        <input type="checkbox" id="bingo-check-ai-${p.id}" data-pid="${p.id}" ${isLinked ? 'checked' : ''} style="width:auto;">
                        <label for="bingo-check-ai-${p.id}" style="flex:1; cursor:pointer;">
                            <div style="font-weight:bold;">${p.theme}</div>
                            <div style="font-size:0.7rem; opacity:0.6;">${p.tag} - ${p.tasks.length}个任务</div>
                        </label>
                    </div>
                `;
            }).join('');
            // 重新绑定确认按钮的onclick事件
            document.querySelector('#modal-select-bingo .btn').setAttribute('onclick', 'confirmBingoCardSelectionForAI()');
            document.getElementById('modal-select-bingo').classList.add('active');
        }

        async function confirmBingoCardSelectionForAI() {
            const selectedIds = [];
            const checkboxes = document.querySelectorAll('#bingo-selection-list input[type="checkbox"]');
            checkboxes.forEach(cb => {
                if (cb.checked) {
                    selectedIds.push(parseInt(cb.dataset.pid));
                }
            });
            store.aiLinkedBingoIds = selectedIds;
            await renderAILinkedBingoCards();
            closeModal('modal-select-bingo');
        }

