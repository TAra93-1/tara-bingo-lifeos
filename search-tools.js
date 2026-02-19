        async function generateTasksWithAI() {
            const goal = document.getElementById('ai-task-goal').value.trim();
            const size = parseInt(document.getElementById('ai-task-size').value);
            const category = document.getElementById('ai-task-category').value;

            if(!goal) {
                alert('请先描述你的目标!');
                return;
            }

            // 优先使用副API，没有则用主API
            let apiConfig = store.apiConfig.sub;
            if(!apiConfig.url || !apiConfig.key) {
                apiConfig = store.apiConfig.main;
            }

            if(!apiConfig.url || !apiConfig.key) {
                alert('请先在侧边栏的API设置中配置API!');
                return;
            }

            const btn = document.getElementById('btn-generate-tasks');
            const originalText = btn.innerHTML;
            btn.innerHTML = '⏳ 生成中...';
            btn.disabled = true;

            try {
                const taskCount = size * size;
                const prompt = `你作为塔拉LIFEOS的任务规划专家,请根据以下目标,生成${taskCount}个具体、可执行的任务步骤。

目标: ${goal}
任务数量: ${taskCount}个
分类: ${category}

要求:
1. 任务要具体、可执行、有明确的完成标准
2. 任务难度递进,从基础到进阶
3. 每个任务用简短的一句话描述(不超过15字)
4. 直接返回任务列表,每行一个任务,不要编号
5. 不要有任何额外说明或标题

示例输出格式:
安装Python环境
学习变量和数据类型
完成第一个Hello World
学习条件语句if-else
...`;

                // 使用副API进行简洁的任务生成（不带Vesper人格）
                const url = apiConfig.url.endsWith('/') ? apiConfig.url + 'chat/completions' : apiConfig.url + '/chat/completions';

                const res = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiConfig.key}`
                    },
                    body: JSON.stringify({
                        model: apiConfig.model,
                        messages: [
                            { role: 'system', content: '你是一个任务规划专家。请严格按照用户要求输出任务列表，每行一个任务，不要有编号、标题或额外说明。' },
                            { role: 'user', content: prompt }
                        ],
                        temperature: 0.7
                    })
                });

                if(!res.ok) {
                    const errorText = await res.text();
                    throw new Error(`API请求失败 (${res.status}): ${errorText}`);
                }

                const data = await res.json();

                if(!data.choices || !data.choices[0] || !data.choices[0].message) {
                    throw new Error('API返回格式异常');
                }

                const response = data.choices[0].message.content;
                const tasks = response.split('\n').filter(t => t.trim()).map(t => t.trim().replace(/^\d+[\.\、]\s*/, ''));

                // 自动填充到创建表单
                document.getElementById('inp-theme').value = goal.substring(0, 30);
                document.getElementById('inp-tag').value = category;
                document.getElementById('inp-size').value = size.toString();
                document.getElementById('inp-tasks').value = tasks.join('\n');

                closeModal('modal-ai-task-generator');
                alert(`Vesper: 已成功生成${tasks.length}个任务,请查看并确认!`);

            } catch(error) {
                alert('生成失败: ' + error.message);
            } finally {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        }


        // --- 战术工具栏逻辑 ---
        let selectedMood = 'Calm';

        // --- [Vesper] AI 助手战术工具栏逻辑 ---

        function aiToolSendBingo() {
            const activeProjects = store.projects.filter(p => p.status === 'active');
            if(activeProjects.length === 0) {
                alert("Vesper: 暂无活跃的 Bingo 卡。");
                return;
            }
            
            const listDiv = document.getElementById('bingo-selection-list');

            listDiv.innerHTML = activeProjects.map(p => {
                const total = p.tasks.length;
                const done = p.tasks.filter(t => t.completed).length;
                const progress = Math.round((done / total) * 100);

                return `
                    <div style="padding:10px; border-bottom:1px solid rgba(0,0,0,0.05); display:flex; align-items:center; gap:10px;" onclick="confirmAiToolSendBingo(${p.id})">
                        <div style="flex:1; cursor:pointer;">
                            <div style="font-weight:bold;">${p.theme}</div>
                            <div style="font-size:0.7rem; opacity:0.6;">进度: ${progress}% (${done}/${total})</div>
                        </div>
                        <button class="btn-sec" style="width:auto; padding:4px 10px; font-size:0.7rem;">选择</button>
                    </div>
                `;
            }).join('');

            const modal = document.getElementById('modal-select-bingo');
            const title = modal.querySelector('h3');
            if(title) title.innerText = "选择要注入的任务卡";
            
            const confirmBtn = modal.querySelector('.btn');
            if(confirmBtn) confirmBtn.style.display = 'none'; 
            
            modal.classList.add('active');
        }

        async function confirmAiToolSendBingo(pid) {
            closeModal('modal-select-bingo');
            const modal = document.getElementById('modal-select-bingo');
            const title = modal.querySelector('h3');
            if(title) title.innerText = "选择关联的 Bingo 卡";
            
            const confirmBtn = modal.querySelector('.btn');
            if(confirmBtn) {
                confirmBtn.style.display = 'block';
                confirmBtn.setAttribute('onclick', 'confirmBingoCardSelection()');
            }

            const p = store.projects.find(x => x.id === pid);
            if(!p) return;

            const total = p.tasks.length;
            const done = p.tasks.filter(t => t.completed).length;
            const progress = Math.round((done / total) * 100);
            
            let gridMd = "";
            const size = p.size;
            for(let r=0; r<size; r++) {
                gridMd += "|";
                for(let c=0; c<size; c++) {
                    const t = p.tasks[r*size + c];
                    const symbol = t.completed ? "✅" : "⬜";
                    const shortText = t.text.length > 5 ? t.text.substring(0,4)+".." : t.text;
                    gridMd += ` ${symbol} ${shortText} |`;
                }
                gridMd += "\n";
            }

            // 构建消息，包含随笔（如果有）
            let visualMsg = `**📂 Bingo Card Snapshot: ${p.theme}**\n\`\`\`\n${gridMd}\n\`\`\`\n> Progress: ${progress}%`;

            // 添加随笔内容
            if(p.journal && p.journal.trim()) {
                visualMsg += `\n\n**📝 我的随笔：**\n> ${p.journal.trim()}`;
            }

            // 如果是归档卡，添加总结
            if(p.status === 'archived' && p.summary && p.summary.trim()) {
                visualMsg += `\n\n**📋 总结：**\n> ${p.summary.trim()}`;
            }

            const input = document.getElementById('ai-input');
            input.value = visualMsg;
            await sendAiMessage();
        }

        async function aiToolSendImage(input) {
            const files = input.files;
            if(!files || files.length === 0) return;

            const chatInput = document.getElementById('ai-input');
            let currentValue = chatInput.value;

            // 处理多个文件
            let imageCount = 0;
            for(let i = 0; i < files.length; i++) {
                const file = files[i];
                const reader = new FileReader();

                reader.onload = function(e) {
                    const base64 = e.target.result;
                    // 添加图片到输入框，保留原有内容
                    if(currentValue && !currentValue.endsWith('\n')) {
                        currentValue += '\n';
                    }
                    currentValue += `![Image](${base64})\n`;
                    chatInput.value = currentValue;

                    imageCount++;
                    // 所有图片加载完成后显示提示
                    if(imageCount === files.length) {
                        showToast(`已添加 ${files.length} 张图片，点击发送按钮或AI回复按钮来发送`);
                    }
                };

                reader.readAsDataURL(file);
            }

            input.value = ''; // 清空input以便下次选择相同文件
        }

        function aiToolRollDice() {
            const problem = prompt("纠结什么？(例如: A.睡觉 B.写代码)");
            if(!problem) return;
            
            const options = problem.split(/[,，\s]+/).filter(s=>s);
            let result = "";
            if(options.length > 1) {
                const pick = options[Math.floor(Math.random() * options.length)];
                result = `🎲 骰子结果: **${pick}**`;
            } else {
                const roll = Math.floor(Math.random() * 100);
                result = `🎲 骰子点数: **${roll}**`;
            }
            
            const msg = `> ❓ 纠结: ${problem}\n\n${result}`;
            const chatInput = document.getElementById('ai-input');
            chatInput.value = msg;
            sendAiMessage();
        }

        function aiToolSendStatus() {
            const btn = document.querySelector('#modal-status-report .btn');
            if(btn) btn.setAttribute('onclick', 'confirmAiSendStatus()');
            document.getElementById('modal-status-report').classList.add('active');
        }

        function confirmAiSendStatus() {
            const energy = document.getElementById('status-energy').value;
            const msg = `[STATUS LOG]: Energy ${energy}% | Mood: ${selectedMood}`;
            
            closeModal('modal-status-report');
            const chatInput = document.getElementById('ai-input');
            chatInput.value = msg;
            sendAiMessage();
        }

        async function aiToolSendLink() {
            const url = prompt("请输入链接 URL:");
            if(!url) return;
            
            const tempId = 'ai-loading-' + Date.now();
            const chatContainer = document.getElementById('ai-chat-container');
            chatContainer.insertAdjacentHTML('beforeend', `<div id="${tempId}" style="margin-bottom:15px;"><div style="display:inline-block; background:var(--card-bg); padding:10px 15px; border-radius:12px;">Vesper 正在读取链接...</div></div>`);
            chatContainer.scrollTop = chatContainer.scrollHeight;

            try {
                const response = await fetch(`https://r.jina.ai/${url}`);
                if (!response.ok) throw new Error(`读取失败 (status: ${response.status})`);
                const text = await response.text();
                const contentPreview = text.substring(0, 3000) + (text.length > 3000 ? "...(内容过长已截断)" : "");
                
                const loadingEl = document.getElementById(tempId);
                if (loadingEl) loadingEl.remove();

                const userVisibleMsg = `🔗 我分享了一个链接：${url}\n\n请总结或基于此内容回答我的问题。`;
                const hiddenSystemPrompt = `[System: Link Content Injection]\nUser shared a link. Here is the parsed content:\n\n--- BEGIN LINK CONTENT ---\n${contentPreview}\n--- END LINK CONTENT ---`;
                
                store.aiChatHistory.push({ role: 'system', content: hiddenSystemPrompt, hidden: true });
                
                const chatInput = document.getElementById('ai-input');
                chatInput.value = userVisibleMsg;
                await sendAiMessage();

            } catch (e) {
                const loadingEl = document.getElementById(tempId);
                if (loadingEl) loadingEl.remove();
                alert("链接读取失败: " + e.message);
            }
        }

        function aiToolToggleWebSearch() {
            isAiSearchEnabled = !isAiSearchEnabled;
            const btn = document.getElementById('ai-search-toggle-btn');
            const aiStatusDiv = document.querySelector('#panel-ai-assistant .header div > div:last-child');
            if (isAiSearchEnabled) {
                btn.classList.add('active');
                if(aiStatusDiv) aiStatusDiv.textContent = '联网搜索已激活';
            } else {
                btn.classList.remove('active');
                if(aiStatusDiv) aiStatusDiv.textContent = '在线';
            }
        }

        async function aiHandleSearchAndReply(query) {
            const aiStatusDiv = document.querySelector('#panel-ai-assistant .header div > div:last-child');
            if(aiStatusDiv) aiStatusDiv.textContent = '正在联网搜索...';
            
            const input = document.getElementById('ai-input');
            input.value = '';

            try {
                const results = await performWebSearch(query);
                
                aiToolToggleWebSearch(); // Turn off search mode

                if (results === null) {
                    alert("搜索功能已关闭，请在API设置中开启。");
                    if(aiStatusDiv) aiStatusDiv.textContent = '在线';
                    return;
                }

                let systemInstruction;
                if (results.length === 0) {
                    systemInstruction = `[System Instruction]: I performed a web search for "${query}" but found no results. Inform the user about this and try to answer based on your own knowledge.`;
                } else {
                    const searchResultsText = results.map((r, i) => 
                        `[${i + 1}] ${r.title}\n"${r.snippet}"\nSource: ${r.link}`
                    ).join('\n\n');
                    systemInstruction = `[System Instruction]: I performed a web search for "${query}". The following are the top search results. Use this information to answer my query. Synthesize the information to provide a comprehensive answer, and you can cite sources using the format [number].

Web Search Results:
---
${searchResultsText}
---
`;
                }
                
                store.aiChatHistory.push({ role: 'system', content: systemInstruction, hidden: true });
                
                input.value = query;
                await sendAiMessage();

            } catch (error) {
                alert(`搜索失败: ${error.message}`);
                if(aiStatusDiv) aiStatusDiv.textContent = '在线';
                aiToolToggleWebSearch(); // Ensure search is off
            }
        }

        function toolSendBingo() {
            const activeProjects = store.projects.filter(p => p.status === 'active');
            if(activeProjects.length === 0) {
                alert("Vesper: 暂无活跃的 Bingo 卡。请先创建一个计划。");
                return;
            }
            
            const listDiv = document.getElementById('bingo-selection-list');

            listDiv.innerHTML = activeProjects.map(p => {
                const total = p.tasks.length;
                const done = p.tasks.filter(t => t.completed).length;
                const progress = Math.round((done / total) * 100);

                return `
                    <div style="padding:10px; border-bottom:1px solid rgba(0,0,0,0.05); display:flex; align-items:center; gap:10px;" onclick="confirmToolSendBingo(${p.id})">
                        <div style="flex:1; cursor:pointer;">
                            <div style="font-weight:bold;">${p.theme}</div>
                            <div style="font-size:0.7rem; opacity:0.6;">进度: ${progress}% (${done}/${total})</div>
                        </div>
                        <button class="btn-sec" style="width:auto; padding:4px 10px; font-size:0.7rem;">选择</button>
                    </div>
                `;
            }).join('');

            const modal = document.getElementById('modal-select-bingo');
            const title = modal.querySelector('h3');
            if(title) title.innerText = "选择要注入的任务卡";
            
            const confirmBtn = modal.querySelector('.btn');
            if(confirmBtn) confirmBtn.style.display = 'none'; 
            
            modal.classList.add('active');
            if (currentReadingRoom) modal.style.zIndex = '9500';
        }

        async function confirmToolSendBingo(pid) {
            closeModal('modal-select-bingo');
            const modal = document.getElementById('modal-select-bingo');
            const title = modal.querySelector('h3');
            if(title) title.innerText = "选择关联的 Bingo 卡";
            
            const confirmBtn = modal.querySelector('.btn');
            if(confirmBtn) {
                confirmBtn.style.display = 'block';
                confirmBtn.setAttribute('onclick', 'confirmBingoCardSelection()');
            }

            const p = store.projects.find(x => x.id === pid);
            if(!p) return;

            const total = p.tasks.length;
            const done = p.tasks.filter(t => t.completed).length;
            const progress = Math.round((done / total) * 100);
            
            let gridMd = "";
            const size = p.size;
            for(let r=0; r<size; r++) {
                gridMd += "|";
                for(let c=0; c<size; c++) {
                    const t = p.tasks[r*size + c];
                    const symbol = t.completed ? "✅" : "⬜";
                    const shortText = t.text.length > 5 ? t.text.substring(0,4)+".." : t.text;
                    gridMd += ` ${symbol} ${shortText} |`;
                }
                gridMd += "\n";
            }

            // 构建消息，包含随笔（如果有）
            let visualMsg = `**📂 Bingo Card Snapshot: ${p.theme}**\n\`\`\`\n${gridMd}\n\`\`\`\n> Progress: ${progress}%`;

            // 添加随笔内容
            if(p.journal && p.journal.trim()) {
                visualMsg += `\n\n**📝 我的随笔：**\n> ${p.journal.trim()}`;
            }

            // 如果是归档卡，添加总结
            if(p.status === 'archived' && p.summary && p.summary.trim()) {
                visualMsg += `\n\n**📋 总结：**\n> ${p.summary.trim()}`;
            }

            const input = document.getElementById('character-chat-input');
            input.value = visualMsg;
            await sendCharacterMessage();

            if(currentChatCharacter) {
                // 系统指令中也包含随笔和总结
                let systemInstruction = `[System Instruction]: User shared a Bingo Card snapshot. Full Data: ${JSON.stringify(p)}. Analyze progress (current: ${progress}%) and urge/encourage user based on completion status.`;

                if(p.journal && p.journal.trim()) {
                    systemInstruction += `\n\nUser's Journal/Notes: ${p.journal.trim()}`;
                }

                if(p.status === 'archived' && p.summary && p.summary.trim()) {
                    systemInstruction += `\n\nUser's Summary: ${p.summary.trim()}`;
                }

                const hiddenMsg = {
                    role: 'user',
                    content: systemInstruction,
                    timestamp: Date.now(),
                    hidden: true
                };
                currentChatCharacter.chatHistory.push(hiddenMsg);
                await saveCurrentChatState();

                triggerCharacterAIResponse();
            }
        }

        async function toolSendImage(input) {
            const files = input.files;
            if(!files || files.length === 0) return;

            const chatInput = document.getElementById('character-chat-input');
            let currentValue = chatInput.value;

            // 处理多个文件
            let imageCount = 0;
            for(let i = 0; i < files.length; i++) {
                const file = files[i];
                const reader = new FileReader();

                reader.onload = function(e) {
                    const base64 = e.target.result;
                    // 添加图片到输入框，保留原有内容
                    if(currentValue && !currentValue.endsWith('\n')) {
                        currentValue += '\n';
                    }
                    currentValue += `![Image](${base64})\n`;
                    chatInput.value = currentValue;

                    imageCount++;
                    // 所有图片加载完成后显示提示
                    if(imageCount === files.length) {
                        showToast(`已添加 ${files.length} 张图片，可以继续添加文字描述，然后点击发送按钮`);
                    }
                };

                reader.readAsDataURL(file);
            }

            input.value = ''; // 清空input以便下次选择相同文件
        }

        function toolRollDice() {
            const problem = prompt("纠结什么？(例如: A.睡觉 B.写代码)");
            if(!problem) return;
            
            const options = problem.split(/[,，\s]+/).filter(s=>s);
            let result = "";
            if(options.length > 1) {
                const pick = options[Math.floor(Math.random() * options.length)];
                result = `🎲 骰子结果: **${pick}**`;
            } else {
                const roll = Math.floor(Math.random() * 100);
                result = `🎲 骰子点数: **${roll}**`;
            }
            
            const msg = `> ❓ 纠结: ${problem}\n\n${result}`;
            const chatInput = document.getElementById('character-chat-input');
            chatInput.value = msg;
            sendCharacterMessage();
            setTimeout(() => triggerCharacterAIResponse(), 1000);
        }

        function toolSendStatus() {
            const btn = document.querySelector('#modal-status-report .btn');
            if(btn) btn.setAttribute('onclick', 'confirmSendStatus()');
            const modal = document.getElementById('modal-status-report');
            modal.classList.add('active');
            if (currentReadingRoom) modal.style.zIndex = '9500';
        }

        function selectMood(mood, el) {
            selectedMood = mood;
            document.querySelectorAll('#modal-status-report .diff-btn').forEach(b => b.classList.remove('active'));
            el.classList.add('active');
        }

        function confirmSendStatus() {
            const energy = document.getElementById('status-energy').value;
            const msg = `[STATUS LOG]: Energy ${energy}% | Mood: ${selectedMood}`;
            
            closeModal('modal-status-report');
            const chatInput = document.getElementById('character-chat-input');
            chatInput.value = msg;
            sendCharacterMessage();
            setTimeout(() => triggerCharacterAIResponse(), 1000);
        }

        async function toolSendLink() {
            const url = prompt("请输入链接 URL:");
            if(!url) return;
            
            // 1. 在界面上显示“正在读取...”
            const loadingMsg = {
                role: 'assistant',
                content: '正在读取链接内容，请稍候...',
                timestamp: Date.now(),
                isTemp: true, // Custom property to identify this as a temp message
                tempId: 'loading-' + Date.now()
            };
            appendCharacterMessage(loadingMsg);
            
            try {
                // 2. 调用 Jina Reader API
                const response = await fetch(`https://r.jina.ai/${url}`);
                
                if (!response.ok) throw new Error(`读取失败 (status: ${response.status})`);
                
                const text = await response.text();
                
                // 3. 截取
                const contentPreview = text.substring(0, 3000) + (text.length > 3000 ? "...(内容过长已截断)" : "");
                
                // 4. 移除“正在读取”提示
                const loadingEl = document.getElementById(loadingMsg.tempId);
                if (loadingEl) loadingEl.remove();

                // 5. 构造用户可见消息并发送
                const userVisibleMsg = `🔗 我分享了一个链接：${url}`;
                const userMsg = {
                    role: 'user',
                    content: userVisibleMsg,
                    timestamp: Date.now()
                };
                currentChatCharacter.chatHistory.push(userMsg);
                await saveCurrentChatState();
                appendCharacterMessage(userMsg);

                // 6. 构造隐藏的系统提示
                const hiddenSystemPrompt = `
[System: Link Content Injection]
The user shared a link. Here is the parsed content of that link:

--- BEGIN LINK CONTENT ---
${contentPreview}
--- END LINK CONTENT ---

Instruction: Read the content above. If the user asks for a summary, summarize it. If the user asks a question, answer based on this content.
        `;
                
                // 7. 触发 AI 回复，并注入上下文
                triggerCharacterAIResponse(hiddenSystemPrompt); 
                
            } catch (e) {
                // 移除“正在读取”提示
                const loadingEl = document.getElementById(loadingMsg.tempId);
                if (loadingEl) loadingEl.remove();

                alert("链接读取失败: " + e.message);
                
                // 在聊天中显示错误
                const errorMsg = {
                    role: 'assistant',
                    content: `❌ 无法读取链接 ${url} 的内容。可能是跨域限制或目标网站反爬。`,
                    timestamp: Date.now()
                };
                currentChatCharacter.chatHistory.push(errorMsg);
                await saveCurrentChatState();
                appendCharacterMessage(errorMsg);
            }
        }


        // --- [Vesper] 联网搜索功能 ---

        function toggleWebSearch() {
            isSearchEnabled = !isSearchEnabled;
            const btn = document.getElementById('search-toggle-btn');
            if (isSearchEnabled) {
                btn.classList.add('active');
                updateChatStatus('联网搜索已激活', 'thinking');
            } else {
                btn.classList.remove('active');
                updateChatStatus('在线', 'online');
            }
        }

        function toggleSearchInputs() {
            const provider = document.getElementById('search-provider-select').value;
            document.getElementById('google-search-inputs').style.display = (provider === 'google') ? 'block' : 'none';
            document.getElementById('serper-search-inputs').style.display = (provider === 'serper') ? 'block' : 'none';
            document.getElementById('zhipu-search-inputs').style.display = (provider === 'zhipu') ? 'block' : 'none';
        }

        const SearchService = {
            google: async (query, config) => {
                const url = `https://www.googleapis.com/customsearch/v1?key=${config.apiKey}&cx=${config.cx}&q=${encodeURIComponent(query)}`;
                const res = await fetch(url);
                if (!res.ok) throw new Error(`Google Search API Error: ${res.statusText}`);
                const data = await res.json();
                if (!data.items) return [];
                return data.items.map(item => ({
                    title: item.title,
                    snippet: item.snippet,
                    link: item.link
                })).slice(0, 5);
            },
            serper: async (query, config) => {
                const url = 'https://google.serper.dev/search';
                try {
                    const res = await fetch(url, {
                        method: 'POST',
                        headers: {
                            'X-API-KEY': config.apiKey,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ q: query, gl: 'cn', hl: 'zh-cn' })
                    });

                    if (!res.ok) {
                        const errorText = await res.text();
                        console.error('[Serper] API响应错误:', res.status, errorText);
                        throw new Error(`Serper API Error: ${res.status} ${res.statusText}${errorText ? ' - ' + errorText : ''}`);
                    }

                    const data = await res.json();
                    console.log('[Serper] API响应:', data);

                    if (!data.organic || data.organic.length === 0) {
                        console.warn('[Serper] 无搜索结果');
                        return [];
                    }

                    return data.organic.map(item => ({
                        title: item.title,
                        snippet: item.snippet,
                        link: item.link
                    })).slice(0, 5);
                } catch (e) {
                    console.error('[Serper] 请求失败:', e);
                    // 检查是否是 CORS 问题
                    if (e.message.includes('Failed to fetch') || e.message.includes('NetworkError')) {
                        throw new Error('Serper API 请求失败，可能是网络问题或 CORS 限制。建议检查网络连接或在服务器环境运行。');
                    }
                    throw e;
                }
            },
            zhipu: async (query, config) => {
                // Zhipu AI的搜索功能通常是直接生成答案，而不是返回链接列表。
                // 这是一个占位符实现，将来可以根据具体API进行调整。
                console.warn("Zhipu AI search is not a standard search provider and is used as a placeholder.");
                return [{
                    title: `关于“${query}”的AI生成摘要`,
                    snippet: "智普AI的搜索功能会直接返回一个生成的答案，而不是传统的搜索结果列表。此功能待后续根据其API特性进行具体实现。",
                    link: "#"
                }];
            }
        };

        async function performWebSearch(query) {
            const searchConfig = store.apiConfig.search || {};
            const provider = searchConfig.provider || 'none';

            if (provider === 'none') {
                console.log("搜索功能已关闭。");
                return null;
            }

            const config = {
                apiKey: provider === 'google' ? searchConfig.googleApiKey : (provider === 'serper' ? searchConfig.serperApiKey : searchConfig.zhipuApiKey),
                cx: searchConfig.googleCx
            };

            if (!config.apiKey) {
                throw new Error(`未配置 ${provider} 的 API Key。`);
            }
            if (provider === 'google' && !config.cx) {
                throw new Error("未配置 Google CX ID。");
            }

            try {
                let results = [];
                if (provider === 'google') {
                    results = await SearchService.google(query, config);
                } else if (provider === 'serper') {
                    results = await SearchService.serper(query, config);
                } else if (provider === 'zhipu') {
                    results = await SearchService.zhipu(query, config);
                }
                return results;
            } catch (e) {
                console.error("搜索失败:", e);
                throw e; // Re-throw to be caught by the caller
            }
        }

        // --- [Vesper Agent] 智能意图识别引擎 ---

        /**
         * 向AI询问搜索意图，AI基于上下文分析用户真正想搜什么
         * @param {string} toolType - 工具类型: 'local' (地点) 或 'web' (联网)
         * @param {Array} chatHistory - 聊天历史
         * @param {string} currentInput - 当前输入框内容(可能为空)
         * @returns {Promise<string>} - AI推断的搜索关键词
         */
        async function askAIForSearchIntent(toolType, chatHistory, currentInput = '') {
            const config = store.apiConfig?.main;
            if (!config?.url || !config?.key) {
                throw new Error('请先配置API');
            }

            const toolDescription = toolType === 'local'
                ? '地图/地点搜索工具（搜索附近的店铺、地点、场所等）'
                : '联网搜索工具（搜索网络信息、新闻、知识等）';

            // 取最近的对话作为上下文
            const recentHistory = chatHistory.slice(-6).map(msg => {
                if (msg.hidden) return null;
                return `${msg.role === 'user' ? '用户' : 'AI'}: ${msg.content.substring(0, 200)}`;
            }).filter(Boolean).join('\n');

            const systemPrompt = `你是一个意图识别引擎。用户刚刚点击了${toolDescription}。
你的任务是根据对话上下文，推断用户最可能想搜索什么。

规则：
1. 只输出搜索关键词，不要有任何解释或多余文字
2. 关键词要简洁精准，适合搜索引擎使用
3. 如果上下文提到了具体地点/话题，提取核心词
4. 如果用户当前输入框有内容，优先使用该内容
5. 如果完全无法推断，${toolType === 'local' ? '输出"周边美食"' : '输出"今日热点"'}

示例：
- 对话提到"好饿想吃面" + 地图工具 → 面馆
- 对话提到"明天要下雨吗" + 联网工具 → 天气预报
- 对话提到"五金店真难找" + 地图工具 → 五金店
- 对话提到"最近有什么好看的电影" + 联网工具 → 2024热门电影推荐`;

            const userPrompt = `对话上下文：
${recentHistory || '(无最近对话)'}

${currentInput ? `用户当前输入框内容：${currentInput}` : '用户当前输入框为空'}

请输出搜索关键词：`;

            const url = config.url.endsWith('/') ? config.url + 'chat/completions' : config.url + '/chat/completions';

            try {
                const res = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${config.key}`
                    },
                    body: JSON.stringify({
                        model: config.model,
                        messages: [
                            { role: 'system', content: systemPrompt },
                            { role: 'user', content: userPrompt }
                        ],
                        temperature: 0.3, // 低温度保证输出稳定
                        max_tokens: 50    // 只需要短输出
                    })
                });

                if (!res.ok) {
                    throw new Error(`API请求失败: ${res.status}`);
                }

                const data = await res.json();
                const intent = data.choices?.[0]?.message?.content?.trim() || '';

                // 清理可能的引号或多余符号
                return intent.replace(/^["'`]|["'`]$/g, '').trim();
            } catch (e) {
                console.error('意图识别失败:', e);
                throw e;
            }
        }

        /**
         * 智能地点搜索 - 点击按钮时切换待激活状态
         * 改为：点击按钮进入待机状态，点击发送按钮后才触发搜索
         */
        function smartLocalSearch(chatType = 'character') {
            const isAiChat = chatType === 'ai';
            const btn = document.getElementById(isAiChat ? 'ai-local-search-btn' : 'local-search-btn');
            const webSearchBtn = document.getElementById(isAiChat ? 'ai-search-toggle-btn' : 'search-toggle-btn');

            if (isAiChat) {
                // 切换状态
                isAiLocalSearchEnabled = !isAiLocalSearchEnabled;
                // 如果开启地点搜索，关闭联网搜索
                if (isAiLocalSearchEnabled) {
                    isAiSearchEnabled = false;
                    webSearchBtn?.classList.remove('active');
                    btn.classList.add('active');
                    updateAiChatStatus('地点搜索已激活，请输入内容后点击发送', 'thinking', 0);
                } else {
                    btn.classList.remove('active');
                    updateAiChatStatus('在线', 'info', 0);
                }
            } else {
                // 切换状态
                isLocalSearchEnabled = !isLocalSearchEnabled;
                // 如果开启地点搜索，关闭联网搜索
                if (isLocalSearchEnabled) {
                    isSearchEnabled = false;
                    webSearchBtn?.classList.remove('active');
                    btn.classList.add('active');
                    updateChatStatus('地点搜索已激活，请输入后点发送', 'thinking');
                } else {
                    btn.classList.remove('active');
                    updateChatStatus('在线', 'online');
                }
            }
        }

        /**
         * 智能联网搜索 - 点击按钮时切换待激活状态
         * 改为：点击按钮进入待机状态，点击发送按钮后才触发搜索
         */
        function smartWebSearch(chatType = 'character') {
            const isAiChat = chatType === 'ai';
            const btn = document.getElementById(isAiChat ? 'ai-search-toggle-btn' : 'search-toggle-btn');
            const localSearchBtn = document.getElementById(isAiChat ? 'ai-local-search-btn' : 'local-search-btn');

            if (isAiChat) {
                // 切换状态
                isAiSearchEnabled = !isAiSearchEnabled;
                // 如果开启联网搜索，关闭地点搜索
                if (isAiSearchEnabled) {
                    isAiLocalSearchEnabled = false;
                    localSearchBtn?.classList.remove('active');
                    btn.classList.add('active');
                    updateAiChatStatus('联网搜索已激活，请输入内容后点击发送', 'thinking', 0);
                } else {
                    btn.classList.remove('active');
                    updateAiChatStatus('在线', 'info', 0);
                }
            } else {
                // 切换状态
                isSearchEnabled = !isSearchEnabled;
                // 如果开启联网搜索，关闭地点搜索
                if (isSearchEnabled) {
                    isLocalSearchEnabled = false;
                    localSearchBtn?.classList.remove('active');
                    btn.classList.add('active');
                    updateChatStatus('联网搜索已激活，请输入后点发送', 'thinking');
                } else {
                    btn.classList.remove('active');
                    updateChatStatus('在线', 'online');
                }
            }
        }

        /**
         * 执行智能联网搜索 - 在发送消息时调用
         * 会先让AI分析意图，然后执行搜索
         */
        async function executeSmartWebSearch(chatType = 'character') {
            const isAiChat = chatType === 'ai';
            const inputEl = document.getElementById(isAiChat ? 'ai-input' : 'character-chat-input');
            const btn = document.getElementById(isAiChat ? 'ai-search-toggle-btn' : 'search-toggle-btn');
            const chatHistory = isAiChat ? store.aiChatHistory : (currentChatCharacter?.chatHistory || []);

            const currentInput = inputEl.value.trim();

            // 1. UI反馈：AI正在思考
            const originalPlaceholder = inputEl.placeholder;
            inputEl.value = '';
            inputEl.placeholder = '🧠 Vesper 正在分析意图并搜索...';
            inputEl.disabled = true;

            if (isAiChat) {
                updateAiChatStatus('正在分析意图...', 'thinking', 0);
            } else {
                updateChatStatus('正在分析意图...', 'thinking');
            }

            try {
                // 2. 让AI分析意图（如果输入框有内容直接使用，否则分析上下文）
                let searchQuery = currentInput;
                if (!searchQuery) {
                    searchQuery = await askAIForSearchIntent('web', chatHistory, '');
                }
                console.log(`[Vesper Agent] 联网搜索: "${searchQuery}"`);

                // 3. 恢复输入框
                inputEl.disabled = false;
                inputEl.placeholder = originalPlaceholder;

                // 4. 执行搜索
                if (isAiChat) {
                    await aiHandleSearchAndReply(searchQuery);
                    // 搜索完成后关闭搜索模式
                    isAiSearchEnabled = false;
                    btn?.classList.remove('active');
                } else {
                    await handleSearchAndReply(searchQuery);
                    // 搜索完成后关闭搜索模式
                    isSearchEnabled = false;
                    btn?.classList.remove('active');
                }

            } catch (error) {
                // 恢复状态
                inputEl.disabled = false;
                inputEl.placeholder = originalPlaceholder;
                inputEl.value = currentInput;

                if (isAiChat) {
                    updateAiChatStatus('在线', 'info', 0);
                } else {
                    updateChatStatus('在线', 'online');
                }

                alert(`搜索失败: ${error.message}`);
            }
        }

        /**
         * 执行智能地点搜索 - 在发送消息时调用
         * 会先让AI分析意图，然后执行搜索
         */
        async function executeSmartLocalSearch(chatType = 'character') {
            const isAiChat = chatType === 'ai';
            const inputEl = document.getElementById(isAiChat ? 'ai-input' : 'character-chat-input');
            const btn = document.getElementById(isAiChat ? 'ai-local-search-btn' : 'local-search-btn');
            const chatHistory = isAiChat ? store.aiChatHistory : (currentChatCharacter?.chatHistory || []);

            const currentInput = inputEl.value.trim();

            // 1. UI反馈：AI正在思考
            const originalPlaceholder = inputEl.placeholder;
            inputEl.value = '';
            inputEl.placeholder = '🧠 Vesper 正在分析意图并搜索...';
            inputEl.disabled = true;

            if (isAiChat) {
                updateAiChatStatus('正在分析意图...', 'thinking', 0);
            } else {
                updateChatStatus('正在分析意图...', 'thinking');
            }

            try {
                // 2. 让AI分析意图（如果输入框有内容直接使用，否则分析上下文）
                let searchQuery = currentInput;
                if (!searchQuery) {
                    searchQuery = await askAIForSearchIntent('local', chatHistory, '');
                }
                console.log(`[Vesper Agent] 地点搜索: "${searchQuery}"`);

                // 3. 恢复输入框
                inputEl.disabled = false;
                inputEl.placeholder = originalPlaceholder;

                // 4. 执行搜索
                if (isAiChat) {
                    await aiHandleLocalSearchAndReply(searchQuery);
                    // 搜索完成后关闭搜索模式
                    isAiLocalSearchEnabled = false;
                    btn?.classList.remove('active');
                } else {
                    await handleLocalSearchAndReply(searchQuery);
                    // 搜索完成后关闭搜索模式
                    isLocalSearchEnabled = false;
                    btn?.classList.remove('active');
                }

            } catch (error) {
                // 恢复状态
                inputEl.disabled = false;
                inputEl.placeholder = originalPlaceholder;
                inputEl.value = currentInput;

                if (isAiChat) {
                    updateAiChatStatus('在线', 'info', 0);
                } else {
                    updateChatStatus('在线', 'online');
                }

                alert(`搜索失败: ${error.message}`);
            }
        }

        // --- [Vesper] 高德地图地点搜索功能 ---

        async function performLocalSearch(keyword) {
            const apiKey = localStorage.getItem('vesper_amap_key');
            if (!apiKey) {
                throw new Error('请先在设置中配置地图 Key');
            }
            const city = localStorage.getItem('vesper_amap_city') || '';
            const url = `https://restapi.amap.com/v3/place/text?keywords=${encodeURIComponent(keyword)}&city=${encodeURIComponent(city)}&key=${apiKey}&offset=10`;

            try {
                const res = await fetch(url);
                if (!res.ok) throw new Error(`高德API请求失败: ${res.status}`);
                const data = await res.json();

                if (data.status !== '1') {
                    throw new Error(data.info || '高德API返回错误');
                }

                if (!data.pois || data.pois.length === 0) {
                    return [];
                }

                return data.pois.map(poi => ({
                    name: poi.name,
                    address: poi.address || '无详细地址',
                    type: poi.type || '',
                    tel: poi.tel || '',
                    location: poi.location || '',
                    distance: poi.distance || '',
                    cityname: poi.cityname || '',
                    adname: poi.adname || ''
                }));
            } catch (e) {
                console.error("地点搜索失败:", e);
                throw e;
            }
        }

        // 信息管理页面的地点搜索开关
        function toggleLocalSearch() {
            isLocalSearchEnabled = !isLocalSearchEnabled;
            const btn = document.getElementById('local-search-btn');
            if (isLocalSearchEnabled) {
                btn.classList.add('active');
                updateChatStatus('地点搜索已激活', 'thinking');
            } else {
                btn.classList.remove('active');
                updateChatStatus('在线', 'online');
            }
        }

        // AI助手页面的地点搜索开关
        function aiToolToggleLocalSearch() {
            isAiLocalSearchEnabled = !isAiLocalSearchEnabled;
            const btn = document.getElementById('ai-local-search-btn');
            const aiStatusDiv = document.querySelector('#panel-ai-assistant .header div > div:last-child');
            if (isAiLocalSearchEnabled) {
                btn.classList.add('active');
                if(aiStatusDiv) aiStatusDiv.textContent = '地点搜索已激活';
            } else {
                btn.classList.remove('active');
                if(aiStatusDiv) aiStatusDiv.textContent = '在线';
            }
        }

        // 信息管理页面处理地点搜索
        async function handleLocalSearchAndReply(query) {
            updateChatStatus('正在搜索地点...', 'thinking');
            const input = document.getElementById('character-chat-input');
            input.value = '';

            try {
                const results = await performLocalSearch(query);
                toggleLocalSearch(); // 关闭搜索模式

                let systemInstruction;
                if (results.length === 0) {
                    systemInstruction = `[System Instruction]: I performed a local place search for "${query}" but found no results. Inform the user about this and try to provide general information about what they're looking for.`;
                } else {
                    const searchResultsText = results.map((r, i) =>
                        `[${i + 1}] ${r.name}\n地址: ${r.address}\n类型: ${r.type}\n电话: ${r.tel || '无'}\n区域: ${r.cityname}${r.adname}`
                    ).join('\n\n');
                    systemInstruction = `[System Instruction]: I performed a local place search for "${query}" using AMAP (高德地图). Here are the results. Use this information to help the user. You can recommend places, provide directions advice, or answer questions about these locations.

Local Search Results:
---
${searchResultsText}
---
`;
                }

                if (currentChatCharacter) {
                    const hiddenMsg = {
                        role: 'user',
                        content: systemInstruction,
                        timestamp: Date.now(),
                        hidden: true
                    };
                    currentChatCharacter.chatHistory.push(hiddenMsg);
                    await saveCurrentChatState();
                }

                const userMsg = {
                    role: 'user',
                    content: `🗺️ 搜索地点: ${query}`,
                    timestamp: Date.now()
                };
                currentChatCharacter.chatHistory.push(userMsg);
                await saveCurrentChatState();
                appendCharacterMessage(userMsg);

                triggerCharacterAIResponse();

            } catch (error) {
                alert(`地点搜索失败: ${error.message}`);
                updateChatStatus('在线', 'online');
                toggleLocalSearch();
            }
        }

        // AI助手页面处理地点搜索
        async function aiHandleLocalSearchAndReply(query) {
            const aiStatusDiv = document.querySelector('#panel-ai-assistant .header div > div:last-child');
            if(aiStatusDiv) aiStatusDiv.textContent = '正在搜索地点...';

            const input = document.getElementById('ai-input');
            input.value = '';

            try {
                const results = await performLocalSearch(query);
                aiToolToggleLocalSearch(); // 关闭搜索模式

                let systemInstruction;
                if (results.length === 0) {
                    systemInstruction = `[System Instruction]: I performed a local place search for "${query}" but found no results. Inform the user about this and try to provide general information about what they're looking for.`;
                } else {
                    const searchResultsText = results.map((r, i) =>
                        `[${i + 1}] ${r.name}\n地址: ${r.address}\n类型: ${r.type}\n电话: ${r.tel || '无'}\n区域: ${r.cityname}${r.adname}`
                    ).join('\n\n');
                    systemInstruction = `[System Instruction]: I performed a local place search for "${query}" using AMAP (高德地图). Here are the results. Use this information to help the user. You can recommend places, provide directions advice, or answer questions about these locations.

Local Search Results:
---
${searchResultsText}
---
`;
                }

                store.aiChatHistory.push({ role: 'system', content: systemInstruction, hidden: true });

                input.value = `🗺️ 搜索地点: ${query}`;
                await sendAiMessage();

            } catch (error) {
                alert(`地点搜索失败: ${error.message}`);
                if(aiStatusDiv) aiStatusDiv.textContent = '在线';
                aiToolToggleLocalSearch();
            }
        }

        async function handleSearchAndReply(query) {
            updateChatStatus('正在联网搜索...', 'thinking');
            const input = document.getElementById('character-chat-input');
            input.value = ''; // Clear input after sending

            try {
                const results = await performWebSearch(query);
                
                // 无论成功与否，都先关闭搜索开关
                toggleWebSearch();

                if (results === null) {
                    alert("搜索功能已关闭，请在API设置中开启。");
                    updateChatStatus('在线', 'online');
                    return;
                }

                if (results.length === 0) {
                    // 即使没有结果，也让AI知道我们尝试搜索了
                    const noResultText = `我搜索了“${query}”，但没有找到直接相关的结果。`;
                    input.value = noResultText;
                    await sendCharacterMessage(); // This will now send as a normal message
                    triggerCharacterAIResponse();
                    return;
                }

                // 格式化搜索结果
                const searchResultsText = results.map((r, i) => 
                    `[${i + 1}] ${r.title}\n"${r.snippet}"\nSource: ${r.link}`
                ).join('\n\n');

                const systemInstruction = `[System Instruction]: I performed a web search for "${query}". The following are the top search results. Use this information to answer my query. Synthesize the information to provide a comprehensive answer, don't just list the results.

Web Search Results:
---
${searchResultsText}
---
`;
                // 将搜索结果作为一条隐藏的系统消息注入上下文
                if (currentChatCharacter) {
                    const hiddenMsg = {
                        role: 'user', // Treat as user-provided context
                        content: systemInstruction,
                        timestamp: Date.now(),
                        hidden: true // This message will not be rendered in the UI
                    };
                    currentChatCharacter.chatHistory.push(hiddenMsg);
                    await saveCurrentChatState();
                }

                // 在UI上显示用户的原始问题
                const userMsg = {
                    role: 'user',
                    content: query,
                    timestamp: Date.now()
                };
                currentChatCharacter.chatHistory.push(userMsg);
                await saveCurrentChatState();
                appendCharacterMessage(userMsg);
                
                // 触发AI回复
                triggerCharacterAIResponse();

            } catch (error) {
                alert(`搜索失败: ${error.message}`);
                updateChatStatus('在线', 'online');
                toggleWebSearch(); //确保开关关闭
            }
        }

        async function handleSearchAndReply(query) {
            updateChatStatus('正在联网搜索...', 'thinking');
            const input = document.getElementById('character-chat-input');
            input.value = ''; // Clear input after sending

            try {
                const results = await performWebSearch(query);
                
                // 无论成功与否，都先关闭搜索开关
                toggleWebSearch();

                if (results === null) {
                    alert("搜索功能已关闭，请在API设置中开启。");
                    updateChatStatus('在线', 'online');
                    return;
                }

                if (results.length === 0) {
                    // 即使没有结果，也让AI知道我们尝试搜索了
                    const noResultText = `我搜索了“${query}”，但没有找到直接相关的结果。`;
                    input.value = noResultText;
                    await sendCharacterMessage(); // This will now send as a normal message
                    triggerCharacterAIResponse();
                    return;
                }

                // 格式化搜索结果
                const searchResultsText = results.map((r, i) => 
                    `[${i + 1}] ${r.title}\n"${r.snippet}"\nSource: ${r.link}`
                ).join('\n\n');

                const systemInstruction = `[System Instruction]: I performed a web search for "${query}". The following are the top search results. Use this information to answer my query. Synthesize the information to provide a comprehensive answer, don't just list the results.

Web Search Results:
---
${searchResultsText}
---
`;
                // 将搜索结果作为一条隐藏的系统消息注入上下文
                if (currentChatCharacter) {
                    const hiddenMsg = {
                        role: 'user', // Treat as user-provided context
                        content: systemInstruction,
                        timestamp: Date.now(),
                        hidden: true // This message will not be rendered in the UI
                    };
                    currentChatCharacter.chatHistory.push(hiddenMsg);
                    await saveCurrentChatState();
                }

                // 在UI上显示用户的原始问题
                const userMsg = {
                    role: 'user',
                    content: query,
                    timestamp: Date.now()
                };
                currentChatCharacter.chatHistory.push(userMsg);
                await saveCurrentChatState();
                appendCharacterMessage(userMsg);
                
                // 触发AI回复
                triggerCharacterAIResponse();

            } catch (error) {
                alert(`搜索失败: ${error.message}`);
                updateChatStatus('在线', 'online');
                toggleWebSearch(); //确保开关关闭
            }
        }

        async function handleSearchAndReply(query) {
            updateChatStatus('正在联网搜索...', 'thinking');
            const input = document.getElementById('character-chat-input');
            input.value = ''; // Clear input after sending

            try {
                const results = await performWebSearch(query);
                
                // 无论成功与否，都先关闭搜索开关
                toggleWebSearch();

                if (results === null) {
                    alert("搜索功能已关闭，请在API设置中开启。");
                    updateChatStatus('在线', 'online');
                    return;
                }

                if (results.length === 0) {
                    // 即使没有结果，也让AI知道我们尝试搜索了
                    const noResultText = `我搜索了“${query}”，但没有找到直接相关的结果。`;
                    input.value = noResultText;
                    await sendCharacterMessage(); // This will now send as a normal message
                    triggerCharacterAIResponse();
                    return;
                }

                // 格式化搜索结果
                const searchResultsText = results.map((r, i) => 
                    `[${i + 1}] ${r.title}\n"${r.snippet}"\nSource: ${r.link}`
                ).join('\n\n');

                const systemInstruction = `[System Instruction]: I performed a web search for "${query}". The following are the top search results. Use this information to answer my query. Synthesize the information to provide a comprehensive answer, don't just list the results.

Web Search Results:
---
${searchResultsText}
---
`;
                // 将搜索结果作为一条隐藏的系统消息注入上下文
                if (currentChatCharacter) {
                    const hiddenMsg = {
                        role: 'user', // Treat as user-provided context
                        content: systemInstruction,
                        timestamp: Date.now(),
                        hidden: true // This message will not be rendered in the UI
                    };
                    currentChatCharacter.chatHistory.push(hiddenMsg);
                    await saveCurrentChatState();
                }

                // 在UI上显示用户的原始问题
                const userMsg = {
                    role: 'user',
                    content: query,
                    timestamp: Date.now()
                };
                currentChatCharacter.chatHistory.push(userMsg);
                await saveCurrentChatState();
                appendCharacterMessage(userMsg);
                
                // 触发AI回复
                triggerCharacterAIResponse();

            } catch (error) {
                alert(`搜索失败: ${error.message}`);
                updateChatStatus('在线', 'online');
                toggleWebSearch(); //确保开关关闭
            }
        }

        async function handleSearchAndReply(query) {
            updateChatStatus('正在联网搜索...', 'thinking');
            const input = document.getElementById('character-chat-input');
            input.value = ''; // Clear input after sending

            try {
                const results = await performWebSearch(query);
                
                // 无论成功与否，都先关闭搜索开关
                toggleWebSearch();

                if (results === null) {
                    alert("搜索功能已关闭，请在API设置中开启。");
                    updateChatStatus('在线', 'online');
                    return;
                }

                if (results.length === 0) {
                    // 即使没有结果，也让AI知道我们尝试搜索了
                    const noResultText = `我搜索了“${query}”，但没有找到直接相关的结果。`;
                    input.value = noResultText;
                    await sendCharacterMessage(); // This will now send as a normal message
                    triggerCharacterAIResponse();
                    return;
                }

                // 格式化搜索结果
                const searchResultsText = results.map((r, i) => 
                    `[${i + 1}] ${r.title}\n"${r.snippet}"\nSource: ${r.link}`
                ).join('\n\n');

                const systemInstruction = `[System Instruction]: I performed a web search for "${query}". The following are the top search results. Use this information to answer my query. Synthesize the information to provide a comprehensive answer, don't just list the results.

Web Search Results:
---
${searchResultsText}
---
`;
                // 将搜索结果作为一条隐藏的系统消息注入上下文
                if (currentChatCharacter) {
                    const hiddenMsg = {
                        role: 'user', // Treat as user-provided context
                        content: systemInstruction,
                        timestamp: Date.now(),
                        hidden: true // This message will not be rendered in the UI
                    };
                    currentChatCharacter.chatHistory.push(hiddenMsg);
                    await saveCurrentChatState();
                }

                // 在UI上显示用户的原始问题
                const userMsg = {
                    role: 'user',
                    content: query,
                    timestamp: Date.now()
                };
                currentChatCharacter.chatHistory.push(userMsg);
                await saveCurrentChatState();
                appendCharacterMessage(userMsg);
                
                // 触发AI回复
                triggerCharacterAIResponse();

            } catch (error) {
                alert(`搜索失败: ${error.message}`);
                updateChatStatus('在线', 'online');
                toggleWebSearch(); //确保开关关闭
            }
        }

        async function toolPerformSearch() {
            const query = prompt("请输入要搜索的内容:");
            if (!query || !query.trim()) return;

            updateChatStatus('正在联网搜索...', 'thinking');

            try {
                const results = await performWebSearch(query);
                if (results === null) {
                    alert("搜索功能已关闭，请在API设置中开启。");
                    updateChatStatus('在线', 'online');
                    return;
                }

                if (results.length === 0) {
                    alert("没有找到相关结果。");
                    updateChatStatus('在线', 'online');
                    return;
                }

                // 格式化搜索结果
                const searchResultsText = results.map((r, i) => 
                    `[${i + 1}] ${r.title}\n"${r.snippet}"\nSource: ${r.link}`
                ).join('\n\n');

                const systemInstruction = `[System Instruction]: User performed a web search for "${query}". The following are the top search results. Use this information to answer the user's next prompt. Do not just list the results; synthesize the information to provide a comprehensive answer.

Web Search Results:
---
${searchResultsText}
---
`;
                // 将搜索结果作为一条隐藏的系统消息注入上下文
                if (currentChatCharacter) {
                    const hiddenMsg = {
                        role: 'user', // Treat as user-provided context
                        content: systemInstruction,
                        timestamp: Date.now(),
                        hidden: true // This message will not be rendered in the UI
                    };
                    currentChatCharacter.chatHistory.push(hiddenMsg);
                    await saveCurrentChatState();
                }

                // 在输入框中放入提示，并触发AI回复
                const chatInput = document.getElementById('character-chat-input');
                chatInput.value = `我搜索了“${query}”，请根据搜索结果回答。`;
                
                await sendCharacterMessage();
                triggerCharacterAIResponse();

            } catch (error) {
                alert(`搜索失败: ${error.message}`);
                updateChatStatus('在线', 'online');
            }
        }


        // Redefine Context Menu Action for AI Assistant
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
                case 'hide':
                    // For AI assistant, store uses store.aiChatHistory array
                    // We need to find the message in store.aiChatHistory and mark it
                    // Note: deleteMessage uses exact content matching or index finding logic
                    // We need to implement finding it.
                    // Or simpler: just modify content to say [Withdrawn] and let it be?
                    // User wants "Withdraw (AI context has info)".
                    // If I add hidden prop, renderAiChatHistory needs update.
                    if(confirm("撤回消息 (AI仍可见)?")) {
                        // Find message in history. 
                        // Note: store.aiChatHistory contains objects {role, content}
                        // We use content to match
                        const targetContent = decodeHtmlEntities(currentContextMsgContent);
                        const foundMsg = store.aiChatHistory.find(m => m.content === targetContent);
                        if(foundMsg) {
                            foundMsg.hidden = true;
                            foundMsg.content = "[User Withdrew Message] Original: " + foundMsg.content;
                            saveData();
                            renderAiChatHistory();
                        }
                    }
                    break;
            }
        }

        async function generateSummary(character) {
            // 兼容旧入口，统一走会话安全版本
            return generateSummaryForCurrentContext(character);
        }

        async function generateSummaryForCurrentContext(character) {
            const target = character || currentChatCharacter;
            if (!target || !target.settings?.autoSummary) return;
            if (!store.apiConfig.sub.url || !store.apiConfig.sub.key) {
                console.warn('Auto Summary skipped: Sub API not configured');
                return;
            }

            const threshold = target.settings.summaryInterval || 10;
            const recentParams = Array.isArray(target.chatHistory) ? target.chatHistory.slice(-threshold) : [];
            if (recentParams.length === 0) return;

            const contextText = recentParams.map(m => `${m.role}: ${m.content}`).join('\n');
            const nowStr = new Date().toLocaleString('zh-CN', { hour12: false });
            const summaryPrompt = `[ Memory Protocol ]
【当前系统时间】 ${nowStr}

你是当前角色的后台记忆整理程序。请把最近对话整理成一条第一人称长期记忆。
要求：
1. 保留关键时间、事实、关系变化与待办事项。
2. 删除寒暄与重复信息，输出单段文本。
3. 保持第一人称视角，不要输出额外说明。

【短期对话片段】：
${contextText}`;

            const statusEl = document.getElementById('character-chat-status-bar');
            try {
                if (statusEl) {
                    statusEl.style.display = 'block';
                    statusEl.textContent = '正在整理长期记忆...';
                }

                const config = store.apiConfig.sub;
                const url = config.url.endsWith('/') ? config.url + 'chat/completions' : config.url + '/chat/completions';
                const res = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${config.key}`
                    },
                    body: JSON.stringify({
                        model: config.model,
                        messages: [{ role: 'user', content: summaryPrompt }],
                        temperature: 0.5
                    })
                });

                if (!res.ok) throw new Error('Sub API Error');
                const data = await res.json();
                const summary = data.choices?.[0]?.message?.content?.trim();
                if (!summary) return;

                const entry = `[${new Date().toLocaleString()}] ${summary}`;
                if (!Array.isArray(currentChatCharacter.longTermMemory)) currentChatCharacter.longTermMemory = [];
                currentChatCharacter.longTermMemory.push(entry);
                await persistCurrentLongTermMemory();

                if (statusEl) {
                    statusEl.textContent = '记忆已归档';
                    setTimeout(() => { statusEl.style.display = 'none'; }, 3000);
                }
            } catch (e) {
                console.error('Summary Generation Failed:', e);
                if (statusEl) statusEl.style.display = 'none';
            }
        }

        function openMemoryLibrary() {
            if(!currentChatCharacter) return;
            const list = document.getElementById('memory-library-list');
            list.innerHTML = '';
            
            if(!currentChatCharacter.longTermMemory || currentChatCharacter.longTermMemory.length === 0) {
                list.innerHTML = '<div style="text-align:center; opacity:0.5; margin-top:20px;">暂无长期记忆。聊得多了就会有的。</div>';
            } else {
                // Reverse to show newest first
                list.innerHTML = [...currentChatCharacter.longTermMemory].reverse().map((mem, index) => {
                    // mem string format: [Date] content
                    const match = mem.match(/^\[(.*?)\]\s*(.*)/);
                    let time = '', content = mem;
                    if(match) { time = match[1]; content = match[2]; }
                    const realIndex = currentChatCharacter.longTermMemory.length - 1 - index;

                    return `
                        <div style="background:rgba(0,0,0,0.03); padding:12px; border-radius:10px; margin-bottom:10px; border-left:3px solid var(--accent);">
                            <div style="font-size:0.7rem; opacity:0.5; margin-bottom:5px;">${time}</div>
                            <div style="white-space: pre-wrap; outline:none;" contenteditable="true" onblur="updateMemory(${realIndex}, this)">${content}</div>
                            <div style="text-align:right; margin-top:5px; display:flex; justify-content:flex-end; gap:10px;">
                                <span style="font-size:0.7rem; opacity:0.5;">(点击文本可直接编辑)</span>
                                <span style="font-size:0.7rem; color:#c62828; cursor:pointer;" onclick="deleteMemory(${realIndex})">删除</span>
                            </div>
                        </div>
                    `;
                }).join('');
            }
            const memModal = document.getElementById('modal-memory-library');
            memModal.classList.add('active');
            if (currentReadingRoom) memModal.style.zIndex = '9500';
        }

        async function addManualMemory() {
            if(!currentChatCharacter) return;
            const text = prompt("请输入新的记忆内容:");
            if(text && text.trim()) {
                const entry = `[${new Date().toLocaleString()}] ${text.trim()}`;
                if(!currentChatCharacter.longTermMemory) currentChatCharacter.longTermMemory = [];
                currentChatCharacter.longTermMemory.push(entry);
                await persistCurrentLongTermMemory();
                openMemoryLibrary();
            }
        }

        async function updateMemory(realIndex, el) {
            if(!currentChatCharacter) return;
            const newContent = el.innerText;
            // 保留原有时间戳
            const original = currentChatCharacter.longTermMemory[realIndex];
            const match = original.match(/^\[(.*?)\]/);
            const timePrefix = match ? match[0] : `[${new Date().toLocaleString()}]`;

            // 如果用户把时间戳也删了, 我们补上
            let finalString = newContent;
            if(!finalString.startsWith('[')) {
                finalString = `${timePrefix} ${finalString}`;
            }

            if(currentChatCharacter.longTermMemory[realIndex] !== finalString) {
                currentChatCharacter.longTermMemory[realIndex] = finalString;
                await persistCurrentLongTermMemory();
                console.log('Memory updated');
            }
        }

        async function deleteMemory(realIndex) {
            if(!currentChatCharacter) return;
            if(confirm('确定遗忘这段记忆吗？')) {
                currentChatCharacter.longTermMemory.splice(realIndex, 1);
                await persistCurrentLongTermMemory();
                openMemoryLibrary(); // Refresh
            }
        }

        // --- [Vesper] Background Activity Logic (Requirement 3) ---

        // 切换后台活动角色列表显示
        function toggleBgActivityCharacterList() {
            const checkbox = document.getElementById('bg-activity-enabled');
            const container = document.getElementById('bg-activity-character-list-container');

            if (checkbox.checked) {
                container.style.display = 'block';
                renderBgActivityCharacterList();
            } else {
                container.style.display = 'none';
            }
        }

        // 渲染后台活动角色列表
        async function renderBgActivityCharacterList() {
            const listDiv = document.getElementById('bg-activity-character-list');
            const characters = await db.characters.toArray();

            if (characters.length === 0) {
                listDiv.innerHTML = '<div style="text-align:center; opacity:0.5; padding:20px;">暂无角色</div>';
                return;
            }

            listDiv.innerHTML = '';
            characters.forEach(char => {
                const checked = char.settings?.bgActivity ? 'checked' : '';
                const charDiv = document.createElement('div');
                charDiv.style.cssText = 'display:flex; align-items:center; gap:10px; padding:8px; border-bottom:1px solid rgba(0,0,0,0.05);';
                charDiv.innerHTML = `
                    <input type="checkbox" id="bg-char-${char.id}" ${checked} style="width:auto;">
                    <label for="bg-char-${char.id}" style="flex:1; cursor:pointer; margin:0;">
                        ${escapeHtml(char.settings?.nickname || char.name)}
                    </label>
                `;
                listDiv.appendChild(charDiv);
            });
        }

        // 保存后台活动设置
        async function saveBackgroundActivitySettings() {
            const enabled = document.getElementById('bg-activity-enabled').checked;
            const interval = parseInt(document.getElementById('bg-activity-interval').value) || 60;

            // 保存到全局store
            if (!store.bgActivitySettings) store.bgActivitySettings = {};
            store.bgActivitySettings.enabled = enabled;
            store.bgActivitySettings.interval = interval;
            saveData();

            // 如果启用，更新每个角色的设置
            if (enabled) {
                const characters = await db.characters.toArray();
                for (const char of characters) {
                    const checkbox = document.getElementById(`bg-char-${char.id}`);
                    if (checkbox) {
                        if (!char.settings) char.settings = {};
                        char.settings.bgActivity = checkbox.checked;
                        await db.characters.put(char);
                    }
                }
            }

            startBackgroundLoop();
            if (enabled) {
                checkBackgroundActivities().catch(e => console.error('[后台活动] 保存设置后立即检查失败:', e));
            }

            alert('后台活动设置已保存!');
        }

        // 加载后台活动设置到UI
        async function loadBgActivitySettings() {
            const enabled = store.bgActivitySettings?.enabled || false;
            const interval = store.bgActivitySettings?.interval || 60;

            document.getElementById('bg-activity-enabled').checked = enabled;
            document.getElementById('bg-activity-interval').value = interval;

            if (enabled) {
                toggleBgActivityCharacterList();
            } else {
                const container = document.getElementById('bg-activity-character-list-container');
                if (container) container.style.display = 'none';
            }
        }

        // 云备份功能
        async function saveCloudBackupSettings(action) {
            const username = document.getElementById('github-username').value.trim();
            const repo = document.getElementById('github-repo').value.trim();
            const token = document.getElementById('github-token').value.trim();

            if (!username || !repo || !token) {
                alert('请填写完整的GitHub信息');
                return;
            }

            // 保存配置
            if (!store.cloudBackup) store.cloudBackup = {};
            store.cloudBackup.username = username;
            store.cloudBackup.repo = repo;
            store.cloudBackup.token = token;
            saveData();

            if (action === 'upload') {
                await uploadBackupToGithub(username, repo, token);
            } else if (action === 'download') {
                await downloadBackupFromGithub(username, repo, token);
            }
        }

        // === 云备份辅助函数 ===

        // 更新云备份进度条
        function updateCloudProgress(status, percent) {
            const container = document.getElementById('cloud-backup-progress');
            const statusEl = document.getElementById('cloud-backup-status');
            const barEl = document.getElementById('cloud-backup-bar');
            if (container) container.style.display = 'block';
            if (statusEl) statusEl.textContent = status;
            if (barEl) barEl.style.width = percent + '%';
        }

        function hideCloudProgress() {
            const container = document.getElementById('cloud-backup-progress');
            if (container) setTimeout(() => { container.style.display = 'none'; }, 3000);
        }

        // 将 JSON 数据编码为 GitHub API 所需的 base64 content
        // 如果数据超过 750KB，用 pako 压缩
        function encodeForGithub(jsonString) {
            const sizeKB = new Blob([jsonString]).size / 1024;
            if (sizeKB > 750 && typeof pako !== 'undefined') {
                // gzip 压缩
                const compressed = pako.gzip(jsonString);
                // Uint8Array → base64
                let binary = '';
                const chunkSize = 8192;
                for (let i = 0; i < compressed.length; i += chunkSize) {
                    binary += String.fromCharCode.apply(null, compressed.subarray(i, i + chunkSize));
                }
                return { content: btoa(binary), compressed: true, originalKB: Math.round(sizeKB), compressedKB: Math.round(compressed.length / 1024) };
            }
            // 不需要压缩
            return { content: btoa(unescape(encodeURIComponent(jsonString))), compressed: false, originalKB: Math.round(sizeKB) };
        }

        // 上传单个文件到 GitHub
        async function uploadFileToGithub(username, repo, token, filepath, content, commitMsg) {
            // 先检查文件是否已存在（需要 sha 来更新）
            let sha = null;
            try {
                const checkRes = await fetch(`https://api.github.com/repos/${username}/${repo}/contents/${filepath}`, {
                    headers: { 'Authorization': `token ${token}` }
                });
                if (checkRes.ok) {
                    const existing = await checkRes.json();
                    sha = existing.sha;
                }
            } catch (e) { /* 文件不存在，忽略 */ }

            const body = { message: commitMsg, content: content };
            if (sha) body.sha = sha;

            const res = await fetch(`https://api.github.com/repos/${username}/${repo}/contents/${filepath}`, {
                method: 'PUT',
                headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(`上传 ${filepath} 失败: ${err.message || res.status}`);
            }
            return true;
        }

        // 上传备份到GitHub（拆分多文件版本）
        async function uploadBackupToGithub(username, repo, token) {
            try {
                updateCloudProgress('正在准备备份数据...', 5);

                // 1. 收集所有数据
                const characters = await db.characters.toArray();
                const characterSessions = (await db.characterSessions.toArray()).map(normalizeCharacterSession).filter(Boolean);
                const worldBooks = await db.worldBooks.toArray();
                const worldBookCategories = await db.worldBookCategories.toArray();

                let libraryBooks = [], libraryCategories = [], readingProgress = [], bookmarks = [], readingNotes = [], readingRooms = [], memoryTables = [];
                try {
                    libraryBooks = (await db.libraryBooks.toArray()).map(b => { const { content, ...meta } = b; return meta; });
                    libraryCategories = await db.libraryCategories.toArray();
                    readingProgress = await db.readingProgress.toArray();
                    bookmarks = await db.bookmarks.toArray();
                    readingNotes = await db.readingNotes.toArray();
                    readingRooms = await db.readingRooms.toArray();
                    memoryTables = await db.memoryTables.toArray();
                } catch (e) { console.warn('[云备份] 图书馆数据获取失败（可能表不存在）:', e); }

                // 2. 构建拆分的 parts
                const storeCopy = JSON.parse(JSON.stringify(store));
                delete storeCopy.userAvatar; // 头像单独存

                const parts = {
                    core: storeCopy,
                    characters: characters.map(c => { const { avatar, ...rest } = c; return rest; }),
                    sessions: characterSessions,
                    avatars: {
                        userAvatar: store.userAvatar || null,
                        characterAvatars: characters.filter(c => c.avatar).map(c => ({ id: c.id, avatar: c.avatar }))
                    },
                    worldbooks: { worldBooks, worldBookCategories },
                    library: { libraryBooks, libraryCategories, readingProgress, bookmarks, readingNotes, readingRooms, memoryTables }
                };

                // 3. 编码每个 part
                updateCloudProgress('正在编码数据...', 15);
                const encodedParts = {};
                const manifestParts = {};
                let totalSizeKB = 0;

                for (const [name, data] of Object.entries(parts)) {
                    const jsonStr = JSON.stringify(data);
                    const encoded = encodeForGithub(jsonStr);
                    encodedParts[name] = encoded.content;
                    manifestParts[name] = { compressed: encoded.compressed, sizeKB: encoded.originalKB };
                    totalSizeKB += encoded.originalKB;
                    if (encoded.compressed) {
                        console.log(`[云备份] ${name}: ${encoded.originalKB}KB → ${encoded.compressedKB}KB (压缩)`);
                    } else {
                        console.log(`[云备份] ${name}: ${encoded.originalKB}KB`);
                    }
                }

                console.log(`[云备份] 总数据量: ${totalSizeKB}KB, 分 ${Object.keys(parts).length} 个文件`);

                // 4. 构建 manifest
                const manifest = {
                    version: 4,
                    exportDate: new Date().toISOString(),
                    parts: manifestParts,
                    totalSizeKB: totalSizeKB
                };

                // 5. 依次上传
                const folder = 'lifeos_cloud_backup';
                const partNames = ['manifest', ...Object.keys(parts)];
                const totalUploads = partNames.length;
                let completed = 0;

                // 上传 manifest
                updateCloudProgress(`上传中 (1/${totalUploads}): manifest...`, 20);
                const manifestJson = JSON.stringify(manifest, null, 2);
                const manifestEncoded = btoa(unescape(encodeURIComponent(manifestJson)));
                await uploadFileToGithub(username, repo, token, `${folder}/manifest.json`, manifestEncoded, `Cloud backup ${manifest.exportDate}`);
                completed++;

                // 上传各 part
                for (const [name, content] of Object.entries(encodedParts)) {
                    completed++;
                    const pct = 20 + Math.round((completed / totalUploads) * 75);
                    const ext = manifestParts[name].compressed ? 'json.gz' : 'json';
                    updateCloudProgress(`上传中 (${completed}/${totalUploads}): ${name}...`, pct);
                    await uploadFileToGithub(username, repo, token, `${folder}/${name}.${ext}`, content, `Backup part: ${name}`);
                }

                updateCloudProgress('备份上传成功!', 100);
                hideCloudProgress();
                alert(`云备份上传成功!\n共 ${totalUploads} 个文件, 约 ${totalSizeKB}KB`);

            } catch (e) {
                console.error('[云备份] 上传失败:', e);
                updateCloudProgress('上传失败: ' + e.message, 0);
                hideCloudProgress();
                alert('上传失败: ' + e.message);
            }
        }

        // 从 GitHub 下载文件并解码（支持 gzip 压缩）
        async function downloadAndDecode(downloadUrl, isCompressed) {
            if (isCompressed) {
                // 下载为 ArrayBuffer 再用 pako 解压
                const res = await fetch(downloadUrl);
                const buffer = await res.arrayBuffer();
                const decompressed = pako.ungzip(new Uint8Array(buffer), { to: 'string' });
                return JSON.parse(decompressed);
            } else {
                const res = await fetch(downloadUrl);
                return await res.json();
            }
        }

        // 从GitHub恢复备份（支持新多文件格式 + 旧单文件格式）
        async function downloadBackupFromGithub(username, repo, token) {
            try {
                updateCloudProgress('正在检查备份...', 5);

                // 1. 检查是否有新格式的 manifest
                let useNewFormat = false;
                let manifestData = null;

                try {
                    const manifestRes = await fetch(`https://api.github.com/repos/${username}/${repo}/contents/lifeos_cloud_backup/manifest.json`, {
                        headers: { 'Authorization': `token ${token}` }
                    });
                    if (manifestRes.ok) {
                        const manifestFile = await manifestRes.json();
                        const manifestContent = await fetch(manifestFile.download_url);
                        manifestData = await manifestContent.json();
                        if (manifestData.version && manifestData.parts) {
                            useNewFormat = true;
                        }
                    }
                } catch (e) { /* 新格式不存在，使用旧格式 */ }

                if (useNewFormat) {
                    // === 新格式：多文件恢复 ===
                    const dateStr = new Date(manifestData.exportDate).toLocaleString('zh-CN');
                    if (!confirm(`找到云备份 (${dateStr})\n总大小: ~${manifestData.totalSizeKB}KB\n\n确定要恢复吗？当前数据将被覆盖！`)) {
                        hideCloudProgress();
                        return;
                    }

                    // 获取 lifeos_cloud_backup 文件夹的文件列表
                    const folderRes = await fetch(`https://api.github.com/repos/${username}/${repo}/contents/lifeos_cloud_backup`, {
                        headers: { 'Authorization': `token ${token}` }
                    });
                    if (!folderRes.ok) throw new Error('无法读取备份文件夹');
                    const folderFiles = await folderRes.json();

                    const partNames = Object.keys(manifestData.parts);
                    const totalParts = partNames.length;
                    let completed = 0;

                    const downloadedParts = {};
                    for (const partName of partNames) {
                        completed++;
                        updateCloudProgress(`下载中 (${completed}/${totalParts}): ${partName}...`, 10 + Math.round((completed / totalParts) * 60));

                        const partInfo = manifestData.parts[partName];
                        const ext = partInfo.compressed ? 'json.gz' : 'json';
                        const filename = `${partName}.${ext}`;

                        const fileEntry = folderFiles.find(f => f.name === filename);
                        if (!fileEntry) {
                            console.warn(`[云备份] 未找到 part 文件: ${filename}, 跳过`);
                            continue;
                        }

                        downloadedParts[partName] = await downloadAndDecode(fileEntry.download_url, partInfo.compressed);
                    }

                    // 恢复数据
                    updateCloudProgress('正在恢复数据...', 75);

                    // core → store
                    if (downloadedParts.core) {
                        store = downloadedParts.core;
                    }

                    // avatars → 恢复头像
                    if (downloadedParts.avatars) {
                        if (downloadedParts.avatars.userAvatar) {
                            store.userAvatar = downloadedParts.avatars.userAvatar;
                        }
                    }

                    // characters → 恢复角色（重新合并头像）
                    if (downloadedParts.characters && downloadedParts.characters.length > 0) {
                        const avatarMap = {};
                        if (downloadedParts.avatars && downloadedParts.avatars.characterAvatars) {
                            downloadedParts.avatars.characterAvatars.forEach(a => { avatarMap[a.id] = a.avatar; });
                        }
                        const fullCharacters = downloadedParts.characters.map(c => ({
                            ...c,
                            avatar: avatarMap[c.id] || null
                        }));
                        await db.characters.clear();
                        await db.characters.bulkPut(fullCharacters);
                    }

                    // sessions → 角色多窗口会话
                    await db.characterSessions.clear();
                    if (Array.isArray(downloadedParts.sessions)) {
                        const sessionsToRestore = downloadedParts.sessions
                            .map(normalizeCharacterSession)
                            .filter(Boolean);
                        if (sessionsToRestore.length > 0) {
                            await db.characterSessions.bulkPut(sessionsToRestore);
                        }
                    }

                    // worldbooks
                    if (downloadedParts.worldbooks) {
                        if (downloadedParts.worldbooks.worldBooks && downloadedParts.worldbooks.worldBooks.length > 0) {
                            await db.worldBooks.clear();
                            await db.worldBooks.bulkPut(downloadedParts.worldbooks.worldBooks);
                        }
                        if (downloadedParts.worldbooks.worldBookCategories && downloadedParts.worldbooks.worldBookCategories.length > 0) {
                            await db.worldBookCategories.clear();
                            await db.worldBookCategories.bulkPut(downloadedParts.worldbooks.worldBookCategories);
                        }
                    }

                    // library → 图书馆数据
                    if (downloadedParts.library) {
                        const lib = downloadedParts.library;
                        updateCloudProgress('正在恢复图书馆数据...', 85);
                        try {
                            if (Array.isArray(lib.libraryBooks)) {
                                // 保留本地已有的书籍正文
                                const existingBooks = await db.libraryBooks.toArray();
                                const contentMap = {};
                                existingBooks.forEach(b => { if (b.content) contentMap[b.id] = b.content; });
                                await db.libraryBooks.clear();
                                const booksToRestore = lib.libraryBooks.map(b => {
                                    if (!b.content && contentMap[b.id]) b.content = contentMap[b.id];
                                    return b;
                                });
                                if (booksToRestore.length > 0) await db.libraryBooks.bulkPut(booksToRestore);
                            }
                            if (Array.isArray(lib.libraryCategories)) {
                                await db.libraryCategories.clear();
                                if (lib.libraryCategories.length > 0) {
                                    await db.libraryCategories.bulkPut(lib.libraryCategories);
                                }
                            }
                            if (Array.isArray(lib.readingProgress)) {
                                await db.readingProgress.clear();
                                if (lib.readingProgress.length > 0) await db.readingProgress.bulkPut(lib.readingProgress);
                            }
                            if (Array.isArray(lib.bookmarks)) {
                                await db.bookmarks.clear();
                                if (lib.bookmarks.length > 0) {
                                    await db.bookmarks.bulkPut(lib.bookmarks);
                                }
                            }
                            if (Array.isArray(lib.readingNotes)) {
                                await db.readingNotes.clear();
                                if (lib.readingNotes.length > 0) await db.readingNotes.bulkPut(lib.readingNotes);
                            }
                            if (Array.isArray(lib.readingRooms)) {
                                await db.readingRooms.clear();
                                if (lib.readingRooms.length > 0) await db.readingRooms.bulkPut(lib.readingRooms);
                            }
                            if (Array.isArray(lib.memoryTables)) {
                                await db.memoryTables.clear();
                                if (lib.memoryTables.length > 0) await db.memoryTables.bulkPut(lib.memoryTables);
                            }
                        } catch (e) {
                            console.warn('[云备份] 恢复图书馆数据失败:', e);
                        }
                    }

                    saveData();
                    updateCloudProgress('恢复成功!', 100);
                    hideCloudProgress();
                    alert('云备份恢复成功！页面将刷新...');
                    location.reload();

                } else {
                    // === 旧格式：单文件恢复（向后兼容）===
                    updateCloudProgress('使用旧格式恢复...', 20);

                    const response = await fetch(`https://api.github.com/repos/${username}/${repo}/contents/`, {
                        headers: { 'Authorization': `token ${token}` }
                    });

                    if (!response.ok) {
                        hideCloudProgress();
                        alert('获取备份列表失败');
                        return;
                    }

                    const files = await response.json();
                    const backupFiles = files.filter(f => (f.name.startsWith('lifeos_backup_') || f.name.startsWith('lifeos_full_backup_')) && f.name.endsWith('.json'));

                    if (backupFiles.length === 0) {
                        hideCloudProgress();
                        alert('未找到备份文件');
                        return;
                    }

                    const latestBackup = backupFiles.sort((a, b) => b.name.localeCompare(a.name))[0];

                    if (!confirm('确定要恢复备份吗？当前数据将被覆盖！')) {
                        hideCloudProgress();
                        return;
                    }

                    updateCloudProgress('正在下载备份...', 40);
                    const fileResponse = await fetch(latestBackup.download_url);
                    const backupData = await fileResponse.json();

                    updateCloudProgress('正在恢复数据...', 70);
                    if (backupData.version && backupData.version >= 2 && backupData.store) {
                        store = backupData.store;
                        if (backupData.characters && backupData.characters.length > 0) {
                            await db.characters.clear();
                            await db.characters.bulkPut(backupData.characters);
                        }
                        await db.characterSessions.clear();
                        if (Array.isArray(backupData.characterSessions) && backupData.characterSessions.length > 0) {
                            const sessionsToRestore = backupData.characterSessions
                                .map(normalizeCharacterSession)
                                .filter(Boolean);
                            if (sessionsToRestore.length > 0) {
                                await db.characterSessions.bulkPut(sessionsToRestore);
                            }
                        }
                        if (backupData.worldBooks && backupData.worldBooks.length > 0) {
                            await db.worldBooks.clear();
                            await db.worldBooks.bulkPut(backupData.worldBooks);
                        }
                        if (backupData.worldBookCategories && backupData.worldBookCategories.length > 0) {
                            await db.worldBookCategories.clear();
                            await db.worldBookCategories.bulkPut(backupData.worldBookCategories);
                        }
                        if (Array.isArray(backupData.libraryBooks)) {
                            const existingBooks = await db.libraryBooks.toArray();
                            const contentMap = {};
                            existingBooks.forEach(b => { if (b.content) contentMap[b.id] = b.content; });
                            await db.libraryBooks.clear();
                            const booksToRestore = backupData.libraryBooks.map(b => {
                                if (!b.content && contentMap[b.id]) b.content = contentMap[b.id];
                                return b;
                            });
                            if (booksToRestore.length > 0) await db.libraryBooks.bulkPut(booksToRestore);
                        }
                        if (Array.isArray(backupData.libraryCategories)) {
                            await db.libraryCategories.clear();
                            if (backupData.libraryCategories.length > 0) await db.libraryCategories.bulkPut(backupData.libraryCategories);
                        }
                        if (Array.isArray(backupData.readingProgress)) {
                            await db.readingProgress.clear();
                            if (backupData.readingProgress.length > 0) await db.readingProgress.bulkPut(backupData.readingProgress);
                        }
                        if (Array.isArray(backupData.bookmarks)) {
                            await db.bookmarks.clear();
                            if (backupData.bookmarks.length > 0) await db.bookmarks.bulkPut(backupData.bookmarks);
                        }
                        if (Array.isArray(backupData.readingNotes)) {
                            await db.readingNotes.clear();
                            if (backupData.readingNotes.length > 0) await db.readingNotes.bulkPut(backupData.readingNotes);
                        }
                        if (Array.isArray(backupData.readingRooms)) {
                            await db.readingRooms.clear();
                            if (backupData.readingRooms.length > 0) await db.readingRooms.bulkPut(backupData.readingRooms);
                        }
                        if (Array.isArray(backupData.memoryTables)) {
                            await db.memoryTables.clear();
                            if (backupData.memoryTables.length > 0) await db.memoryTables.bulkPut(backupData.memoryTables);
                        }
                    } else {
                        store = backupData;
                    }

                    saveData();
                    updateCloudProgress('恢复成功!', 100);
                    hideCloudProgress();
                    alert('备份恢复成功！页面将刷新...');
                    location.reload();
                }
            } catch (e) {
                console.error('[云备份] 恢复失败:', e);
                updateCloudProgress('恢复失败: ' + e.message, 0);
                hideCloudProgress();
                alert('恢复失败: ' + e.message);
            }
        }

        // 加载云备份设置到UI
        function loadCloudBackupSettings() {
            if (store.cloudBackup) {
                document.getElementById('github-username').value = store.cloudBackup.username || '';
                document.getElementById('github-repo').value = store.cloudBackup.repo || '';
                document.getElementById('github-token').value = store.cloudBackup.token || '';
            }
        }

        let backgroundLoopTimer = null;
        let isBackgroundChecking = false;
        let backgroundLoopListenersBound = false;

        function getBackgroundLoopIntervalMs() {
            const minutes = Number(store.bgActivitySettings?.interval);
            const normalizedMinutes = Number.isFinite(minutes) ? Math.max(1, Math.min(1440, minutes)) : 60;
            return normalizedMinutes * 60 * 1000;
        }

        function startBackgroundLoop() {
            if (backgroundLoopTimer) {
                clearInterval(backgroundLoopTimer);
            }

            const intervalMs = getBackgroundLoopIntervalMs();
            backgroundLoopTimer = setInterval(() => {
                checkBackgroundActivities().catch(e => {
                    console.error('[后台活动] 定时检查失败:', e);
                });
            }, intervalMs);

            if (!backgroundLoopListenersBound) {
                document.addEventListener('visibilitychange', () => {
                    if (!document.hidden) {
                        checkBackgroundActivities().catch(e => {
                            console.error('[后台活动] 可见性恢复检查失败:', e);
                        });
                    }
                });
                window.addEventListener('focus', () => {
                    checkBackgroundActivities().catch(e => {
                        console.error('[后台活动] 焦点恢复检查失败:', e);
                    });
                });
                backgroundLoopListenersBound = true;
            }

            // 启动后短延迟做一次检查，避免必须等一个完整间隔
            setTimeout(() => {
                checkBackgroundActivities().catch(e => {
                    console.error('[后台活动] 启动检查失败:', e);
                });
            }, 5000);
        }

        async function checkBackgroundActivities() {
            if (isBackgroundChecking) return;
            if (!store.bgActivitySettings?.enabled) return;

            isBackgroundChecking = true;
            try {
                const characters = await db.characters.toArray();
                const now = Date.now();
                let triggeredCount = 0;

                for (const char of characters) {
                    if (!char?.settings?.bgActivity) continue;

                    // 冷却时间 (分钟 -> 毫秒)
                    const cooldownMs = (char.settings.bgCooldown || 120) * 60 * 1000;

                    // 优先选择该角色置顶窗口；若无置顶，则选择最近活跃窗口
                    let targetSession = null;
                    let historyForCooldown = Array.isArray(char.chatHistory) ? char.chatHistory : [];
                    let lastBgTriggerTime = Number(char.lastBgTriggerTime) || 0;
                    let baseCreatedAt = Number(char.createdAt) || 0;
                    if (isCharacterSessionModeEnabled(char)) {
                        targetSession = await resolveBackgroundSessionTarget(char.id);
                        if (targetSession) {
                            historyForCooldown = Array.isArray(targetSession.chatHistory) ? targetSession.chatHistory : [];
                            lastBgTriggerTime = Number(targetSession.lastBgTriggerTime) || 0;
                            baseCreatedAt = Number(targetSession.createdAt) || baseCreatedAt;
                        }
                    }

                    const lastMsgTime = Math.max(getLatestMessageTimestamp(historyForCooldown), baseCreatedAt);
                    const lastActivity = Math.max(lastMsgTime, lastBgTriggerTime);
                    if (now - lastActivity < cooldownMs) continue;

                    const triggered = await triggerBackgroundEvent(char, targetSession);
                    if (triggered) {
                        triggeredCount++;
                        // 单次检查最多触发2个角色，避免集中打扰
                        if (triggeredCount >= 2) break;
                    }
                }
            } finally {
                isBackgroundChecking = false;
            }
        }

        async function triggerBackgroundEvent(char, targetSession = null) {
            const targetName = targetSession?.name || DEFAULT_CHARACTER_SESSION_NAME;
            const targetLabel = targetSession ? `${char.name}/${targetName}` : char.name;
            console.log(`[Vesper] Triggering background event for ${targetLabel}`);
            
            // 构造一个特殊的系统提示, 让 AI 发起话题
            const systemPrompt = `[System Command]: You are currently in "Background Active Mode". The user hasn't spoken to you for a while. 
Please initiate a conversation or send a message based on your personality, current time, or previous context.
Keep it short and natural. Don't mention you are an AI.`;
            
            // 临时构建消息列表用于API调用
            // 我们不能直接用 triggerCharacterAIResponse 因为那个函数依赖 UI 状态 (currentChatCharacter)
            
            if(!store.apiConfig.main.url || !store.apiConfig.main.key) return;

            try {
                // 构建简化的 prompt
                let history = [];
                const sourceHistory = targetSession
                    ? (Array.isArray(targetSession.chatHistory) ? targetSession.chatHistory : [])
                    : (Array.isArray(char.chatHistory) ? char.chatHistory : []);
                if (sourceHistory.length > 0) {
                    history = sourceHistory.slice(-5).map(m => {
                        // [时间戳注入] 在每条消息前添加时间戳信息
                        const msgTime = m.timestamp ? new Date(m.timestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '未知时间';
                        const timePrefix = `[消息时间: ${msgTime}]\n`;
                        return { role: m.role, content: timePrefix + m.content };
                    });
                }

                const messages = [
                    { role: 'system', content: `You are ${char.name}. ${char.description || ''} ${systemPrompt}` },
                    ...history,
                    // [Vesper Fix] 动态时间注入 - 后台活动也需要知道当前时间
                    { role: 'system', content: `[当前系统时间]: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}。根据此时间选择合适的问候或话题。` }
                ];

                const config = store.apiConfig.main;
                const url = config.url.endsWith('/') ? config.url + 'chat/completions' : config.url + '/chat/completions';
                
                const res = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${config.key}`
                    },
                    body: JSON.stringify({
                        model: config.model,
                        messages: messages,
                        temperature: 0.9 // 稍微高一点的温度, 增加随机性
                    })
                });

                if(!res.ok) throw new Error('API Error');
                const data = await res.json();
                const content = data.choices?.[0]?.message?.content;

                if (content) {
                    const now = Date.now();
                    const newMsg = {
                        role: 'assistant',
                        content: content,
                        timestamp: now
                    };

                    if (targetSession) {
                        if (!Array.isArray(targetSession.chatHistory)) targetSession.chatHistory = [];
                        targetSession.chatHistory.push(newMsg);
                        targetSession.lastBgTriggerTime = now;
                        targetSession.updatedAt = now;
                        targetSession.lastActiveAt = now;
                        await db.characterSessions.put(normalizeCharacterSession(targetSession));
                        await db.characters.update(char.id, { lastBgTriggerTime: now });
                    } else {
                        if (!Array.isArray(char.chatHistory)) char.chatHistory = [];
                        char.chatHistory.push(newMsg);
                        char.lastBgTriggerTime = now;
                        await db.characters.put(char);
                    }

                    // 如果当前正在聊这个角色且命中了同一个写入目标，直接追加到当前聊天视图
                    const isCurrentCharacterOpen = !!currentChatCharacter && !!currentEditingCharacter && currentEditingCharacter.id === char.id;
                    const isCurrentSessionTarget = !!targetSession && !!currentCharacterSession && currentCharacterSession.id === targetSession.id;
                    const isCurrentLegacyTarget = !targetSession && isCurrentCharacterOpen && !currentCharacterSession && !currentReadingRoom;
                    if (isCurrentCharacterOpen && (isCurrentSessionTarget || isCurrentLegacyTarget)) {
                        if (!Array.isArray(currentChatCharacter.chatHistory)) currentChatCharacter.chatHistory = [];
                        const currentHistory = currentChatCharacter.chatHistory;
                        const latest = currentHistory[currentHistory.length - 1];
                        if (!latest || latest.timestamp !== newMsg.timestamp || latest.content !== newMsg.content) {
                            currentHistory.push(newMsg);
                        }
                        if (isCurrentSessionTarget && currentCharacterSession) {
                            currentCharacterSession.lastBgTriggerTime = now;
                            currentCharacterSession.updatedAt = now;
                            currentCharacterSession.lastActiveAt = now;
                        }
                        appendCharacterMessage(newMsg, currentHistory.length - 1);
                        updateChatMessageCounter(currentHistory.filter(msg => !msg.hidden).length);
                        const container = document.getElementById('character-chat-messages');
                        if (container) container.scrollTop = container.scrollHeight;
                    } else {
                        const toastName = targetSession ? `${char.name} · ${targetName}` : char.name;
                        showToast(`💬 ${toastName} 发来一条新消息`);
                    }

                    // 更新角色/会话列表预览
                    await renderCharacterList();
                    if (typeof renderCharacterSessionSidebar === 'function') {
                        await renderCharacterSessionSidebar();
                    }
                    return true;
                }

            } catch (e) {
                console.error("Background event failed", e);
            }
            return false;
        }

        function showToast(msg) {
            const div = document.createElement('div');
            div.style.cssText = 'position:fixed; top:20px; left:50%; transform:translateX(-50%); background:var(--accent); color:var(--bg); padding:10px 20px; border-radius:20px; z-index:9999; font-size:0.8rem; box-shadow:var(--shadow); animation: fadeIn 0.3s forwards;';
            div.innerText = msg;
            document.body.appendChild(div);
            setTimeout(() => {
                div.style.opacity = '0';
                setTimeout(() => div.remove(), 300);
            }, 3000);
        }

        // ==================== Escape 键关闭模态框 ====================
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                // 找到最上层的 active 模态框并关闭
                const activeModals = document.querySelectorAll('.modal.active');
                if (activeModals.length > 0) {
                    // 按 z-index 降序，关闭最上层的那个
                    let topModal = activeModals[activeModals.length - 1];
                    let topZ = -1;
                    activeModals.forEach(m => {
                        const z = parseInt(getComputedStyle(m).zIndex) || 0;
                        if (z > topZ) { topZ = z; topModal = m; }
                    });
                    closeModal(topModal.id);
                    e.preventDefault();
                } else {
                    // 没有模态框时，关闭侧边栏
                    const sidebar = document.getElementById('sidebar');
                    if (sidebar && sidebar.classList.contains('open')) {
                        closeSidebar();
                        e.preventDefault();
                    }
                }
            }
        });

        window.addEventListener('DOMContentLoaded', async () => {
            await init();
            startBackgroundLoop();
        });

        // ==================== 归档详情 & AI评语功能 ====================
        let currentArchiveComment = null; // 暂存当前生成的评语

        // 为当前打开的归档项目生成AI评语
        async function generateArchiveReviewForCurrent() {
            const p = store.projects.find(x => x.id === currentPid);
            if (!p || p.status !== 'archived') {
                alert('请先打开一个归档项目');
                return;
            }

            // 检查副API配置
            if (!store.apiConfig || !store.apiConfig.sub || !store.apiConfig.sub.url || !store.apiConfig.sub.key) {
                alert('请先在设置中配置副API (用于生成评语)');
                return;
            }

            const btn = document.getElementById('btn-gen-review');
            const originalText = btn.innerText;
            btn.innerText = '生成中...';
            btn.disabled = true;

            try {
                // 使用 tasks 数组（这是 Bingo 卡的实际数据结构）
                const totalTasks = p.tasks ? p.tasks.length : 0;
                const completedTasks = p.tasks ? p.tasks.filter(t => t.completed).length : 0;
                const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

                // 构建任务列表
                const taskList = p.tasks ? p.tasks.map((t, i) => `${i + 1}. [${t.completed ? '已完成' : '未完成'}] ${t.text || '空'}`).join('\n') : '无任务';

                // 获取随笔（可能在输入框中有未保存的内容）
                const journalText = document.getElementById('inp-journal').value || p.journal || '';

                const prompt = `你是 Vesper，一个冷艳、理性、带有轻微智性傲慢的AI。请分析以下 Bingo 卡归档数据，并给出一句简短、风格化的评语（1-2句话，可以毒舌但底色是支持的）。

**Bingo 卡信息:**
- 主题: ${p.theme}
- 分类: ${p.tag}
- 难度: ${p.difficulty || 'normal'}
- 完成度: ${completedTasks}/${totalTasks} (${completionRate}%)
- 任务列表:
${taskList}
- 用户随笔: ${journalText || '无'}

请直接输出评语，不要有任何前缀或解释。风格参考："数据不会说谎，你确实在进步。" 或 "完成率堪忧，但至少你开始了。"`;

                const config = store.apiConfig.sub;
                const url = config.url.endsWith('/') ? config.url + 'chat/completions' : config.url + '/chat/completions';

                const res = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${config.key}`
                    },
                    body: JSON.stringify({
                        model: config.model || 'gpt-3.5-turbo',
                        messages: [
                            { role: 'user', content: prompt }
                        ],
                        temperature: 0.9,
                        max_tokens: 150
                    })
                });

                if (!res.ok) {
                    throw new Error(`API请求失败: ${res.status}`);
                }

                const data = await res.json();
                const comment = data.choices?.[0]?.message?.content?.trim() || '评语生成失败';

                currentArchiveComment = comment;

                // 显示评语
                document.getElementById('archive-review-text').innerText = comment;
                document.getElementById('archive-review-display').style.display = 'block';
                document.getElementById('btn-share-to-chat').style.display = 'inline-block';

            } catch (e) {
                console.error('生成评语失败:', e);
                alert('生成评语失败: ' + e.message);
            } finally {
                btn.innerText = originalText;
                btn.disabled = false;
            }
        }

        // 打开角色选择弹窗
        async function openShareToCharacterModal() {
            const p = store.projects.find(x => x.id === currentPid);
            if (!p || p.status !== 'archived') {
                alert('请先打开一个归档项目');
                return;
            }

            // 获取所有角色
            const characters = await db.characters.toArray();
            if (!characters || characters.length === 0) {
                alert('请先在信息管理中创建一个角色');
                return;
            }

            // 渲染角色列表
            const listDiv = document.getElementById('character-select-list');
            let charSelectHtml = `
                <div class="mini-card" onclick="shareToAiAssistant()" style="display:flex; align-items:center; gap:12px; padding:12px; cursor:pointer; margin-bottom:8px; border-left: 4px solid var(--accent);">
                    <img src="data:image/webp;base64,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BMYhcYBdTRiotB9FDxps/nyt5rEjV0jT6upGRixAXTfAU/lGADFIpGAXU1ATGIXGAXU1ATGH9CpA0wtLIxMT0Yc+YvWvJTzB47pjEXkyrKigfkgwi20zupqAmMQuMAupqAmMQpr1JY6OrZFCzdbZeiQNMxgDrKqagLGAy3tqzK5i4wC6moCYxC4wC6moCYwdn7mZ6lXVDTJZzwtNS5Q2LmiuAp/AtwviLbTO6moCYxC4wC6moCYxC4vR8BQM9Q3+WbfjbxFqSwFIoRQPyQYRbaZ3U1ATGIXGAXU1ATGIXGAXECt9wvaACrrBI1iPKF3Bzvi6g67HcD8ftM7qagJjELjALqagJjELjALqW68wgvSFAAWUU+/E8rqP6U9uX5XMXGAXU1ATGIXGAXU1ATGIXGAXFr0dagtFpnyKKK9vAXU1ATGIXGAXU1ATGIXGAXU1ATGIU1hF0ZmVCr4xiPifHsp/AqeI7qagJjELjALqagJjELjALqagJjELckbDlD6/BdVvkHE37i4BXmMQuMAupqAmMQuMAupqAmMQuMAupacsyaeun2iOslrFUop8L/E8rmLjALqagJjELjALqagJjELjALpsIaJ1/1srmKYF81RFndTUBMYhcYBdTUBMYhcYBdTUBMYhcX/bxQgo6Q7DiSmz9cqF1NQExiFxgF1NQExiFxgF1NQExiFxgFxAiz65u6ulM6ILb8WIF1NQExiFxgF1NQExiFxgF1NQExiFxgFxIu+w+j4iEMj/80BP5XMXGAXU1ATGIXGAXU1ATGIXGAXU1ATFRpFEKex14PS7gdATY0QuMAupqAmMQuMAupqAmMQuMAupqAmMQpw7OGEFzmy15jELjALqagJjELjALqagJjELjALqagJjCAXpRX477VmVzFxgF1NQExiFxgF1NQExiFxgF1NQExh/MrY4JzV/xw3OzupqAmMQuMAupqAmMQuMAupqAmMQuMAupori8omUXpt+8yuYuMAupqAmMQuMAupqAmMQuMAupqAmMP9yV7Feel0s6zMrmLjALqagJjELjALqagJjELjALqagJjELjALqagJjELjALqagJjELjALqagJjELjALqagJjELjALqagJjELjALqagJioAAP7FzQAAAAAAAAAAAAAABdGJPp1NV+zG2bLCQXvIX5kF2Jbm4aNgxXXPsRu5JXnFJbB69pUT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" style="width:45px; height:45px; border-radius:50%; object-fit:cover; border:2px solid var(--accent);">
                    <div style="flex:1;">
                        <div style="font-weight:bold; font-size:0.95rem; color:var(--accent);">Vesper AI</div>
                        <div style="font-size:0.75rem; opacity:0.6;">AI 助手</div>
                    </div>
                    <div style="color:var(--accent);">→</div>
                </div>
            `;

            charSelectHtml += characters.map(char => {
                const avatar = char.avatar || getAvatarPlaceholder(40);
                return `
                    <div class="mini-card" onclick="shareToCharacter('${char.id}')" style="display:flex; align-items:center; gap:12px; padding:12px; cursor:pointer; margin-bottom:8px;">
                        <img src="${avatar}" style="width:45px; height:45px; border-radius:50%; object-fit:cover; border:2px solid var(--accent);">
                        <div style="flex:1;">
                            <div style="font-weight:bold; font-size:0.95rem;">${char.name}</div>
                            <div style="font-size:0.75rem; opacity:0.6;">${char.chatHistory ? char.chatHistory.length : 0} 条消息</div>
                        </div>
                        <div style="color:var(--accent);">→</div>
                    </div>
                `;
            }).join('');
            listDiv.innerHTML = charSelectHtml;

            // 打开弹窗
            document.getElementById('modal-select-character').classList.add('active');
        }

        // 分享归档到指定角色
        async function shareToCharacter(charId) {
            const p = store.projects.find(x => x.id === currentPid);
            if (!p) {
                alert('找不到当前项目');
                return;
            }

            // 获取角色
            const targetChar = await db.characters.get(charId);
            if (!targetChar) {
                alert('找不到该角色');
                return;
            }

            // 构建分享消息
            const msg = buildShareMessage(p);

            // 关闭弹窗
            closeModal('modal-select-character');

            // 进入该角色聊天（自动按迁移模式选择 legacy/session）
            currentEditingCharacter = targetChar;
            await openCharacterChat();
            if (!currentChatCharacter) return;

            // 创建消息
            const userMsg = {
                role: 'user',
                content: msg,
                timestamp: Date.now()
            };

            // 添加到聊天历史
            if (!currentChatCharacter.chatHistory) {
                currentChatCharacter.chatHistory = [];
            }
            currentChatCharacter.chatHistory.push(userMsg);
            await saveCurrentChatState();

            renderCharacterChatHistory();

            // 滚动到底部
            setTimeout(() => {
                const container = document.getElementById('character-chat-messages');
                container.scrollTop = container.scrollHeight;
            }, 300);

            // 自动触发AI回复
            setTimeout(() => {
                triggerCharacterAIResponse();
            }, 500);

            showToast(`已发送给 ${targetChar.name}，等待回复...`);
        }

        // 分享给 AI 助手
        async function shareToAiAssistant() {
            const p = store.projects.find(x => x.id === currentPid);
            if (!p) {
                alert('找不到当前项目');
                return;
            }

            const msg = buildShareMessage(p);

            closeModal('modal-select-character');
            
            // 打开 AI 助手面板
            openSidebarPanel('ai-assistant');

            // 添加消息到 AI 历史
            const userMsg = {
                role: 'user',
                content: msg,
                timestamp: Date.now()
            };
            store.aiChatHistory.push(userMsg);
            saveData();
            
            renderAiChatHistory();

            // 自动触发 AI 回复
            setTimeout(() => {
                triggerAiAssistantResponse();
            }, 500);

            showToast(`已发送给 Vesper AI，等待回复...`);
        }

        // 构建分享消息的辅助函数
        function buildShareMessage(p) {
            // 计算完成率
            const totalTasks = p.tasks ? p.tasks.length : 0;
            const completedTasks = p.tasks ? p.tasks.filter(t => t.completed).length : 0;
            const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
            const archiveDate = p.archivedAt ? new Date(p.archivedAt).toLocaleDateString('zh-CN') : '未知';

            // 获取随笔
            const journalText = document.getElementById('inp-journal').value || p.journal || '';

            // 获取总结（仅归档卡有）
            const summaryText = document.getElementById('inp-summary') ?
                (document.getElementById('inp-summary').value || p.summary || '') :
                (p.summary || '');

            // 构建完整的任务列表
            let taskList = '';
            if (p.tasks && p.tasks.length > 0) {
                taskList += `\n\n**完整任务列表:**\n`;
                p.tasks.forEach((t, i) => {
                    taskList += `${i + 1}. [${t.completed ? '✅' : '❌'}] ${t.text}\n`;
                });
            }

            // 构建分享消息
            let msg = `**[Bingo 归档分享]**\n`;
            msg += `主题: ${p.theme}\n`;
            msg += `分类: ${p.tag}\n`;
            msg += `归档日期: ${archiveDate}\n`;
            msg += `完成度: ${completedTasks}/${totalTasks} (${completionRate}%)`;
            msg += taskList;
            if (journalText) {
                msg += `\n**用户随笔:**\n${journalText}`;
            }
            if (summaryText) {
                msg += `\n\n**归档总结:**\n${summaryText}`;
            }
            if (currentArchiveComment) {
                msg += `\n\n✨ **AI评语:**\n*${currentArchiveComment}*`;
            }

            return msg;
        }

