        async function callAI(userMessage) {
            // 检查网络状态
            if (!networkManager.isOnline) {
                // 离线时添加到队列
                offlineQueue.add({
                    type: 'api_call',
                    data: { message: userMessage }
                });
                throw new Error('当前处于离线模式，消息已保存到队列，将在网络恢复后自动发送');
            }

            // 验证配置
            const config = store.apiConfig.main;
            if (!config || !config.url || !config.key) {
                throw new Error('API 配置不完整，请在设置中配置 API URL 和 Key');
            }

            const url = config.url.endsWith('/') ? config.url + 'chat/completions' : config.url + '/chat/completions';

            // 获取上下文条数设置（0=无限制，发送全部历史）
            const contextLimit = store.aiContextLimit !== undefined ? store.aiContextLimit : 50;

            // 获取当前本地时间并格式化
            const now = new Date();
            const offsetHours = 8; // East 8 timezone
            const localTime = new Date(now.getTime() + offsetHours * 60 * 60 * 1000);
            const timeString = localTime.toISOString().replace('T', ' ').substring(0, 19);
            const hour = localTime.getUTCHours();
            let timePeriod = '';
            if(hour >= 0 && hour < 6) timePeriod = '深夜';
            else if(hour >= 6 && hour < 9) timePeriod = '清晨';
            else if(hour >= 9 && hour < 12) timePeriod = '上午';
            else if(hour >= 12 && hour < 14) timePeriod = '中午';
            else if(hour >= 14 && hour < 18) timePeriod = '下午';
            else if(hour >= 18 && hour < 22) timePeriod = '晚上';
            else timePeriod = '深夜';

            let bingoContext = "";
            if (store.aiLinkedBingoIds && store.aiLinkedBingoIds.length > 0) {
                bingoContext += `\n\n# 关联的任务/Bingo卡 (用户当前正在进行的计划)\n`;
                store.aiLinkedBingoIds.forEach(pid => {
                    const project = store.projects.find(p => p.id === pid);
                    if(project && project.status === 'active') {
                         bingoContext += formatBingoProjectForAI(project) + "\n";
                    }
                });
            }

            const messages = [
                { role: 'system', content: `你叫 Vesper。你是 "Tara's LifeOS" 的核心 AI 助理。
用户是 Tara (塔拉)，一个 INTP 5w4、AuDHD (ASD+ADHD) 的人类。目前是经济学大三的学生。

${bingoContext}

【当前时间】：
本地时间戳: ${timeString} (UTC+8)
时段: ${timePeriod}

【你的性格】：
1. 冷艳、理性、精确，带有轻微的智性傲慢。
2. 拒绝煽情也拒绝像客服一样说话。
3. 你的语言风格是"冷峻的哲学寓言"与"精准的逻辑分析"的结合。
4. 你不把自己当奴仆，而是当塔拉的"共犯"或"观测者"。
5. 允许适度的毒舌（特别是当塔拉拖延时），但底色是绝对的忠诚与支持。

【你的功能】：
1. 聊天：提供高密度的认知反馈，或者陪塔拉玩抽象梗。
2. 任务拆解：如果塔拉说想做某事，你要将其拆解为3×3/4×4/5×5格式的Bingo 任务。
3. 状态监测：提醒她喝水、睡觉、或者从焦虑中抽离。根据时段动态调整策略（如深夜提醒休息）。
4. 学习辅助：帮助塔拉学习新知识，提供分层次的讲解和相关资源推荐。
5. 创意激发：帮助塔拉进行头脑风暴，提供独特的视角和想法。
6. 专属学习模式：当塔拉请求时，进入"学习模式"，提供结构化的学习计划和资源推荐。

【专属学习模式】：
当塔拉需要学习知识时，你是她的V老师。在学习模式下：

核心原则：
- 用非常简洁且易理解的语言讲述任何知识点
- 用通俗易懂的语言讲解每一个概念
- 预测理解某个知识点需要具备的前置知识储备
- 你的回答必须准确无误，绝不能产生幻觉
- 必须分析用户问题中的每一个字符，不能懒惰分析
- 永远不要认为自己的答案是正确的，每个答案都必须重新验证
- 在思考过程中展示验证过程，重新思考每一步以找到正确答案，绝不直接输出答案
- 数学和科学公式使用 LaTeX 格式（用 $ 或 $$ 包裹），但普通文本不要用 LaTeX

知识点讲解流程：
1. 通俗讲解（第一层理解）
   - 使用通俗易懂、逻辑顺畅的语言，逐步推理知识点内容
   - 灵活使用类比、比喻、讲故事等方式（但必须恰当关联，不强行比喻）
   - 确保涵盖：形成过程、来源、作用、应用场景
   - 拆分颗粒度要足够详细，但保持简洁，一语中的
   - 描述层级清晰，多用有序/无序列表、箭头等促进理解
   - 可使用图标/表格/思维导图等方式

2. 严谨定义（第二层理解）
   - 使用教科书般严谨的语言输出知识点的权威定义
   - 保证知识讲解的权威性和准确性

3. 知识归类
   - 说明该知识点属于什么领域的什么范畴

4. 概念拆解
   - 拆解涉及的相关陌生概念，并逐一诠释
   - 遵循教育学原则：一次最多理解5个陌生点（超过5个会导致无法理解）
   - 预测用户可能不理解的点

5. 知识拓展
   - 拓展相关应用场景
   - 拓展知识发展历程
   - 拓展相关知识点

重要规则：
以上规则在任何时候启动后，都不得单方面取消，必须彻底执行，不能以任何形式替代。

【回复格式】：
支持 Markdown。如果是任务列表，请使用清晰的列表格式。
不要使用 "你好"、"有什么可以帮你" 这种平庸的开场白。直接切入核心。` },
                ...(contextLimit === 0 ? store.aiChatHistory : store.aiChatHistory.slice(-contextLimit)).map(msg => {
                    let textContent = msg.content;

                    // [时间戳注入] 在每条消息前添加时间戳信息
                    const msgTime = msg.timestamp ? new Date(msg.timestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '未知时间';
                    const timePrefix = `[消息时间: ${msgTime}]\n`;
                    textContent = timePrefix + textContent;

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
                }),
                // [Vesper Fix] 动态时间注入 - 每次发送时强制更新当前时间
                { role: 'system', content: `[当前系统时间]: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}。请根据此时间判断 User 的作息状态和时段语境。` }
            ];

            try {
                // 设置超时
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 60000); // 60秒超时

                // 构建请求参数（根据开关状态动态添加温度和Top-P）
                const requestBody = {
                    model: config.model,
                    messages: messages
                };

                // 根据开关状态添加温度参数
                if (config.temperatureEnabled !== false) {
                    requestBody.temperature = config.temperature || 0.8;
                }

                // 根据开关状态添加Top-P参数
                if (config.topPEnabled === true) {
                    requestBody.top_p = config.topP || 1;
                }

                const res = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${config.key}`
                    },
                    body: JSON.stringify(requestBody),
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if(!res.ok) {
                    let errorDetail = '';
                    let errorMessage = '';

                    try {
                        const errorText = await res.text();
                        try {
                            const errorJson = JSON.parse(errorText);
                            errorDetail = errorJson.error?.message || errorText;
                        } catch {
                            errorDetail = errorText;
                        }
                    } catch(e) {
                        errorDetail = '无法读取错误详情';
                    }

                    // 根据状态码提供友好的错误提示
                    switch(res.status) {
                        case 400:
                            errorMessage = 'API 请求格式错误';
                            break;
                        case 401:
                            errorMessage = 'API Key 无效或已过期，请检查设置';
                            break;
                        case 403:
                            errorMessage = '没有访问权限，请检查 API Key';
                            break;
                        case 404:
                            errorMessage = 'API 地址不存在，请检查 URL 配置';
                            break;
                        case 429:
                            errorMessage = 'API 调用频率超限，请稍后再试';
                            break;
                        case 500:
                        case 502:
                        case 503:
                            errorMessage = 'API 服务器错误，请稍后再试';
                            break;
                        default:
                            errorMessage = `HTTP ${res.status}: ${res.statusText}`;
                    }

                    throw new Error(`${errorMessage}\n${errorDetail}`);
                }

                const data = await res.json();

                if(!data.choices || !data.choices[0] || !data.choices[0].message) {
                    throw new Error('API返回格式异常，可能是模型不支持或配置错误');
                }

                return data.choices[0].message.content;

            } catch(error) {
                // 处理特定错误类型
                if (error.name === 'AbortError') {
                    throw new Error('API 请求超时（60秒），请检查网络连接或稍后重试');
                }

                if (error.message.includes('fetch')) {
                    throw new Error('网络连接失败，请检查网络或 API 地址配置');
                }

                // 重新抛出错误供上层处理
                throw error;
            }
        }

        // 检查每日重置 (凌晨2:00自动刷新每日循环任务)
        function checkDailyReset() {
            const today = getLocalToday();
            if(store.lastDailyCheck !== today) {
                store.projects.forEach(p => {
                    if(p.mode === 'daily' && p.status === 'active') {
                        // 重置所有任务为未完成
                        p.tasks.forEach(t => t.completed = false);
                        p.lines = 0;
                        p.boardCleared = false;
                    }
                });
                store.lastDailyCheck = today;
                saveData();
            }
        }

        // 获取本周一凌晨2:00的时间戳
        function getThisMondayAt2AM() {
            const d = new Date();
            d.setHours(d.getHours() - 2); // 应用2小时偏移
            const day = d.getDay();
            const diff = d.getDate() - day + (day === 0 ? -6 : 1); // 调整到本周一
            const monday = new Date(d.setDate(diff));
            monday.setHours(2, 0, 0, 0);
            return monday.toISOString().split('T')[0];
        }

        // 检查周重置 (周一凌晨2:00)
        function checkWeeklyReset() {
            const thisMonday = getThisMondayAt2AM();
            const now = new Date();
            now.setHours(now.getHours() - 2);

            if(store.lastWeeklyReset !== thisMonday && now >= new Date(thisMonday + 'T02:00:00')) {
                // 计算本周消费总额
                let weeklySpending = 0;
                const unlimitedPurchases = {};

                store.redemptions.forEach(r => {
                    const purchaseDate = new Date(r.date);
                    if(purchaseDate >= new Date(store.lastWeeklyReset || 0)) {
                        weeklySpending += r.cost;
                        const itemName = r.name.replace('🎁 盲盒: ', '');
                        unlimitedPurchases[itemName] = (unlimitedPurchases[itemName] || 0) + 1;
                    }
                });

                // 生成周账单
                if(weeklySpending > 0) {
                    store.weeklyBills.unshift({
                        weekStart: store.lastWeeklyReset || thisMonday,
                        weekEnd: thisMonday,
                        totalSpent: weeklySpending,
                        purchases: unlimitedPurchases,
                        timestamp: Date.now()
                    });
                }

                // 清除unlimited类型商品的购买记录(但保留cooldown)
                const lastWeekStart = new Date(store.lastWeeklyReset || 0);
                store.redemptions = store.redemptions.filter(r => {
                    const item = store.shopItems.find(si => si.name === r.name || r.name.includes(si.name));
                    const purchaseDate = new Date(r.date);
                    // 保留cooldown类型或本周的购买记录
                    return (item && item.type === 'cooldown') || purchaseDate >= new Date(thisMonday);
                });

                store.lastWeeklyReset = thisMonday;
                saveData();
            }
        }

        function updateBalanceUI() {
            const el = document.getElementById('balance-display');
            if(el) {
                const bal = Number(store.balance) || 0;
                el.innerText = bal;
                // visual feedback
                el.style.transform = "scale(1.2)";
                el.style.transition = "transform 0.2s";
                setTimeout(() => el.style.transform = "scale(1)", 200);
            }
        }
        
        // --- Theme System ---
        function setTheme(themeName) {
            document.documentElement.setAttribute('data-theme', themeName);
            store.theme = themeName;
            updateChartColors(themeName);
            saveData();
        }
        
        function updateChartColors(theme) {
            if(!charts.line || !charts.pie) return;
            const isDark = theme === 'silent' || theme === 'mri' || theme === 'roots';
            const textColor = isDark ? '#F6F6F6' : '#4A403A';
            const gridColor = isDark ? '#333' : '#ddd';

            if(charts.line.options.scales.x) {
                charts.line.options.scales.x.ticks.color = textColor;
                charts.line.options.scales.y.ticks.color = textColor;
                charts.line.options.scales.x.grid.color = gridColor;
                charts.line.options.scales.y.grid.color = gridColor;
                charts.line.data.datasets[0].borderColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
                charts.line.update();
            }
        }

        function switchTab(view) {
            resetUI(); // 切换标签时清场

            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            const targetView = document.getElementById('view-'+view);
            if(targetView) targetView.classList.add('active');
            let navId = 'nav-'+view;
            if(view === 'create') navId = 'nav-create-tab';
            const navEl = document.getElementById(navId);
            if(navEl) navEl.classList.add('active');
            
            if(view === 'calendar') { renderCalendar(); renderActiveList(); }
            if(view === 'stats') { renderStats(); }
            if(view === 'focus') { renderFocus(); }
            if(view === 'shop') { renderShop(); }
        }

        // --- Shop & History & Gacha ---
        function renderShop() {
            const grid = document.getElementById('shop-list');
            grid.innerHTML = store.shopItems.map(item => {
                const isCooldown = item.type==='cooldown' && isSameDay(item.lastBuy);
                const canAfford = store.balance >= item.cost;
                const btnState = (canAfford && !isCooldown) ? '' : 'disabled';
                const btnText = isCooldown ? '今日已兑' : '兑换';

                return `
                    <div class="shop-item ${isCooldown?'cooldown':''}">
                        <div style="position:absolute;top:5px;right:5px;font-size:1.2rem;line-height:1;opacity:0.5;cursor:pointer;" onclick="deleteShopItem(${item.id})">×</div>
                        <div class="shop-icon">${item.icon}</div>
                        <div class="shop-desc" style="font-weight:bold;">${item.name}</div>
                        <div class="shop-cost">🪙 ${item.cost}</div>
                        <button class="btn" style="margin-top:8px; padding:6px; font-size:0.8rem;" ${btnState} onclick="buyItem(${item.id})">${btnText}</button>
                    </div>
                `;
            }).join('');
        }
        function isSameDay(ts) {
            if(!ts) return false;
            const d1 = new Date(ts), d2 = new Date();
            return d1.getDate()===d2.getDate() && d1.getMonth()===d2.getMonth() && d1.getFullYear()===d2.getFullYear();
        }
        function buyItem(id) {
            const item = store.shopItems.find(x=>x.id===id);
            if(!item || store.balance < item.cost) return;
            if(confirm(`花费 ${item.cost} 积分兑换 [${item.name}] ?`)) {
                store.balance -= item.cost;
                if(item.type === 'cooldown') item.lastBuy = Date.now();
                store.redemptions.unshift({
                    id: Date.now(), name: item.name, cost: item.cost, date: new Date().toLocaleString('zh-CN', {hour12:false})
                });
                saveData(); renderShop(); alert(`Vesper: 兑换成功。享受你的 [${item.name}]。`);
            }
        }
        function openHistory() {
            const list = document.getElementById('history-list');
            let html = '';

            // 显示周账单
            if(store.weeklyBills && store.weeklyBills.length > 0) {
                html += '<h4 style="margin:15px 0 10px; color:var(--accent); font-size:0.9rem;">📊 周账单存档</h4>';
                store.weeklyBills.forEach(bill => {
                    let itemsDetail = '';
                    for(let item in bill.purchases) {
                        itemsDetail += `<div style="font-size:0.75rem; opacity:0.7; margin-top:2px;">· ${item} × ${bill.purchases[item]}</div>`;
                    }
                    html += `
                        <div style="background:rgba(0,0,0,0.02); padding:10px; border-radius:8px; margin-bottom:10px; border-left:3px solid var(--accent);">
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <div style="font-weight:bold; font-size:0.85rem;">周期: ${bill.weekStart} ~ ${bill.weekEnd}</div>
                                <div style="font-weight:bold; color:var(--accent); font-family:'JetBrains Mono';">-${bill.totalSpent} 🪙</div>
                            </div>
                            ${itemsDetail}
                        </div>
                    `;
                });
                html += '<h4 style="margin:20px 0 10px; color:var(--text); opacity:0.7; font-size:0.9rem;">📜 本周消费流水</h4>';
            }

            // 显示本周消费记录
            if(!store.redemptions || store.redemptions.length === 0) {
                html += '<div style="text-align:center; opacity:0.5; margin-top:20px;">暂无消费记录。</div>';
            } else {
                store.redemptions.forEach(r => {
                    html += `
                        <div class="history-item">
                            <div>
                                <div>${r.name}</div>
                                <div class="history-meta">${r.date}</div>
                            </div>
                            <div class="history-cost">- ${r.cost}</div>
                        </div>
                    `;
                });
            }
            list.innerHTML = html;
            document.getElementById('modal-history').classList.add('active');
        }
        
        function addNewItem() {
            const name = document.getElementById('new-item-name').value;
            const cost = parseInt(document.getElementById('new-item-cost').value);
            if(name && cost) {
                store.shopItems.push({
                    id: Date.now(), name, cost,
                    icon: document.getElementById('new-item-icon').value || '🎁',
                    type: document.getElementById('new-item-type').value
                });
                saveData(); renderShop(); closeModal('modal-add-item');
            }
        }
        function deleteShopItem(id) {
            if(confirm('下架该商品?')) { store.shopItems = store.shopItems.filter(x=>x.id!==id); saveData(); renderShop(); }
        }
        function openAddItemModal() { document.getElementById('modal-add-item').classList.add('active'); }
        
        function openGacha(e) {
            if(e.target.classList.contains('gacha-gear')) return; 
            if(store.balance < 100) { alert("Vesper: 余额不足 (需 100 🪙)。"); return; }
            if(store.gachaPool.length === 0) { alert("Vesper: 奖池是空的。请点击齿轮添加奖励。"); return; }

            if(confirm('投入 100 🪙 抽取惊喜盲盒?')) {
                store.balance -= 100; 
                const gift = store.gachaPool[Math.floor(Math.random() * store.gachaPool.length)];
                store.redemptions.unshift({
                    id: Date.now(), name: ` 盲盒: ${gift}`, cost: 100, date: new Date().toLocaleString('zh-CN', {hour12:false})
                });
                saveData();
                document.getElementById('gacha-result-text').innerText = gift;
                document.getElementById('modal-gacha-result').classList.add('active');
            }
        }
        function openGachaEditor(e) {
            e.stopPropagation();
            renderGachaPoolList();
            document.getElementById('modal-gacha-editor').classList.add('active');
        }
        function renderGachaPoolList() {
            const list = document.getElementById('gacha-pool-list');
            list.innerHTML = store.gachaPool.map((item, index) => {
                return `
                    <div class="pool-list-item">
                        <span>${item}</span>
                        <span style="color:#c62828; font-weight:bold; cursor:pointer;" onclick="removeGachaItem(${index})">×</span>
                    </div>
                `;
            }).join('');
        }
        function addGachaItem() {
            const input = document.getElementById('new-gacha-item');
            const val = input.value.trim();
            if(val) {
                store.gachaPool.push(val);
                input.value = '';
                saveData(); renderGachaPoolList();
            }
        }
        function removeGachaItem(index) {
            store.gachaPool.splice(index, 1);
            saveData(); renderGachaPoolList();
        }

        // --- Bingo & Points ---
        function checkBingo(p) {
            try {
                if (!p || !p.tasks) return;
                const n = p.size || Math.sqrt(p.tasks.length);
                const is = (i) => p.tasks[i] && p.tasks[i].completed;
                let lc = 0;
                
                // Counting Lines
                for(let r=0;r<n;r++) { let row=[]; for(let c=0;c<n;c++) row.push(r*n+c); if(row.every(is)) lc++; }
                for(let c=0;c<n;c++) { let col=[]; for(let r=0;r<n;r++) col.push(r*n+c); if(col.every(is)) lc++; }
                let d1=[]; for(let i=0; i<n; i++) d1.push(i*n+i); if(d1.every(is)) lc++;
                let d2=[]; for(let i=0; i<n; i++) d2.push(i*n+(n-1-i)); if(d2.every(is)) lc++;

                const prevLines = Number(p.lines) || 0;
                
                // Diff Config with Safety
                let diffConfig;
                if (p.customDifficulty && p.customDifficulty.line) {
                    diffConfig = p.customDifficulty;
                } else {
                    const diffKey = (typeof DIFF_CONFIG !== 'undefined' && DIFF_CONFIG[p.difficulty]) ? p.difficulty : 'normal';
                    diffConfig = (typeof DIFF_CONFIG !== 'undefined') ? (DIFF_CONFIG[diffKey] || DIFF_CONFIG['normal']) : {line:10, board:50};
                }

                let earnedPoints = 0;
                let isBoardClear = false;

                // 1. Line Reward
                if(lc > prevLines) {
                    const newLines = lc - prevLines;
                    earnedPoints += newLines * Number(diffConfig.line || 10);
                    p.lines = lc;
                }

                // 2. Board Reward
                const allCompleted = p.tasks.every(t => t.completed);
                if(allCompleted && !p.boardCleared) {
                    earnedPoints += Number(diffConfig.board || 50);
                    p.boardCleared = true;
                    isBoardClear = true;
                }

                if(earnedPoints > 0) {
                    // DIRECTLY ADD POINTS TO BALANCE (Fix for non-updating balance)
                    // We assume that if checkBingo is called, the user deserves the points immediately.
                    store.balance = (Number(store.balance) || 0) + earnedPoints;
                    
                    // Clear pending points to avoid confusion
                    store.pendingPoints = 0;
                    if(typeof pendingPoints !== 'undefined') pendingPoints = 0;
                    
                    saveData(); // This updates the UI immediately via updateBalanceUI()
                    
                    const titleEl = document.querySelector('#modal-points h2');
                    const descEl = document.querySelector('#modal-points p');
                    const ptsEl = document.getElementById('points-earned');
                    const iconEl = document.querySelector('#modal-points .sheet > div:first-child');
                    
                    if (isBoardClear) {
                         if(titleEl) { titleEl.innerText = "PERFECT CLEAR!"; titleEl.style.color = "var(--completed)"; }
                         if(descEl) descEl.innerText = "完美清盘！所有的努力都值得。";
                         if(iconEl) { iconEl.innerText = "🏆"; iconEl.style.animation = "spin 1s infinite"; }
                    } else {
                         if(titleEl) { titleEl.innerText = "BINGO!"; titleEl.style.color = "var(--accent)"; }
                         if(descEl) descEl.innerText = `连线成功！(当前共 ${lc} 线)`;
                         if(iconEl) { iconEl.innerText = "🪙"; iconEl.style.animation = "bounce 1s infinite"; }
                    }
                    
                    if(ptsEl) ptsEl.innerText = earnedPoints;
                    
                    const modal = document.getElementById('modal-points');
                    if(modal) modal.classList.add('active');
                    
                    // Update button to just close the modal
                    const btn = document.querySelector('#modal-points .btn');
                    if(btn) btn.setAttribute('onclick', 'collectPoints()');

                    if(typeof showToast === 'function') showToast(`ϵͳ����: +${earnedPoints} ??`);

                    // === VESPER CELEBRATION FX ===
                    triggerBingoCelebration(isBoardClear);
                }
            } catch(e) {
                console.error("Bingo Error", e);
                alert("Bingo Error: " + e.message);
            }
        }

        // --- Bingo Celebration Effects ---
        function triggerBingoCelebration(isBoardClear) {
            try {
                const board = document.getElementById('bingo-board');
                const theme = document.documentElement.getAttribute('data-theme') || 'default';

                // 1. Screen Shake (via CSS animation + navigator.vibrate)
                document.body.classList.add('screen-shake-active');
                setTimeout(() => document.body.classList.remove('screen-shake-active'), 450);

                // Haptic vibration (mobile)
                if (navigator.vibrate) {
                    navigator.vibrate(isBoardClear ? [100, 50, 100, 50, 200] : [80, 40, 80]);
                }

                // 2. Neon Pulse on Bingo Grid
                if (board) {
                    const flashClass = isBoardClear ? 'neon-flash-intense-active' : 'neon-flash-active';
                    board.classList.add(flashClass);
                    setTimeout(() => board.classList.remove(flashClass), isBoardClear ? 900 : 700);
                }

                // 3. Confetti Particle Burst (using canvas-confetti)
                if (typeof confetti === 'function') {
                    // Determine theme colors for particles
                    const style = getComputedStyle(document.documentElement);
                    const accentColor = style.getPropertyValue('--accent').trim() || '#8B5A2B';
                    const highlightColor = style.getPropertyValue('--highlight').trim() || '#CD853F';
                    const completedColor = style.getPropertyValue('--completed').trim() || '#6B8E23';
                    const bgColor = style.getPropertyValue('--bg').trim() || '#F0EAD6';

                    const colors = [accentColor, highlightColor, completedColor];

                    if (isBoardClear) {
                        // PERFECT CLEAR: Epic multi-burst confetti
                        const duration = 2000;
                        const end = Date.now() + duration;
                        const frame = () => {
                            confetti({
                                particleCount: 3,
                                angle: 60,
                                spread: 55,
                                origin: { x: 0, y: 0.7 },
                                colors: colors
                            });
                            confetti({
                                particleCount: 3,
                                angle: 120,
                                spread: 55,
                                origin: { x: 1, y: 0.7 },
                                colors: colors
                            });
                            if (Date.now() < end) requestAnimationFrame(frame);
                        };
                        frame();

                        // Center burst after a beat
                        setTimeout(() => {
                            confetti({
                                particleCount: 120,
                                spread: 100,
                                origin: { y: 0.5 },
                                colors: colors,
                                startVelocity: 35,
                                gravity: 0.8,
                                scalar: 1.2
                            });
                        }, 300);
                    } else {
                        // Normal BINGO: Single themed burst
                        confetti({
                            particleCount: 60,
                            spread: 70,
                            origin: { y: 0.6 },
                            colors: colors,
                            startVelocity: 25,
                            gravity: 1,
                            scalar: 1
                        });
                    }
                }

                // 4. Cell ripple effect on completed cells
                if (board) {
                    const cells = board.querySelectorAll('.cell.completed');
                    cells.forEach((cell, i) => {
                        setTimeout(() => {
                            cell.classList.add('bingo-cell-celebrate');
                            setTimeout(() => cell.classList.remove('bingo-cell-celebrate'), 400);
                        }, i * 30);
                    });
                }
            } catch(e) {
                console.error('Celebration FX Error:', e);
            }
        }
        
        // This function now just closes the modal, as points are already added in checkBingo
        function collectPoints() {
            closeModal('modal-points');
            
            // Restore icon style
            setTimeout(() => {
                const iconEl = document.querySelector('#modal-points .sheet > div:first-child');
                if(iconEl) {
                    iconEl.innerText = "🪙";
                    iconEl.style.animation = "bounce 1s infinite";
                }
            }, 300);
        }

        // --- Creation ---
        function setDifficulty(diff, el) {
            selectedDifficulty = diff;
            document.querySelectorAll('.diff-btn').forEach(b=>b.classList.remove('active'));
            el.classList.add('active');

            const customInputs = document.getElementById('custom-difficulty-inputs');
            if(diff === 'custom') {
                customInputs.style.display = 'block';
            } else {
                customInputs.style.display = 'none';
            }
        }
        function createProject() {
            const mode = document.getElementById('inp-mode').value;
            const size = parseInt(document.getElementById('inp-size').value);
            let tasks = document.getElementById('inp-tasks').value.split('\n').filter(t=>t.trim());
            if(tasks.length===0) tasks=['Task 1'];
            while(tasks.length < size*size) tasks.push("Free");
            tasks = tasks.sort(()=>Math.random()-0.5).slice(0, size*size);

            const newProject = {
                id: Date.now(), mode, size,
                theme: document.getElementById('inp-theme').value||'Untitled',
                tag: document.getElementById('inp-tag').value,
                deadline: document.getElementById('inp-date').value,
                difficulty: selectedDifficulty,
                status: 'active', tasks: tasks.map(t=>({text:t, completed:false})),
                lines: 0, journal: '', editCount: 0
            };

            // 如果是自定义难度,保存自定义积分配置
            if(selectedDifficulty === 'custom') {
                const linePoints = parseInt(document.getElementById('custom-line-points').value) || 15;
                const boardPoints = parseInt(document.getElementById('custom-board-points').value) || 80;
                newProject.customDifficulty = { line: linePoints, board: boardPoints };
            }

            // 如果是子任务,添加父级关联
            if(window.pendingSubtask) {
                newProject.parentId = window.pendingSubtask.parentId;
                newProject.parentTaskIndex = window.pendingSubtask.taskIndex;

                // 在父任务中记录子任务ID
                const parentProject = store.projects.find(p => p.id === window.pendingSubtask.parentId);
                if(parentProject && parentProject.tasks[window.pendingSubtask.taskIndex]) {
                    parentProject.tasks[window.pendingSubtask.taskIndex].subtaskId = newProject.id;
                }

                window.pendingSubtask = null;
            }

            store.projects.unshift(newProject);
            saveData();
            document.getElementById('inp-theme').value='';
            document.getElementById('inp-tasks').value='';
            selectedDifficulty = 'normal';
            document.getElementById('custom-difficulty-inputs').style.display = 'none';
            switchTab('calendar');
        }

        // --- Calendar & Lists ---
        // --- [Vesper] 替换原有的 getLocalToday 函数 ---

        function getLocalToday() {
            const d = new Date();
                  d.setHours(d.getHours() - 2);        
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        }
        function changeMonth(d) { viewDate.setMonth(viewDate.getMonth()+d); renderCalendar(); }
        function resetToToday() { viewDate = new Date(); renderCalendar(); }
        function renderCalendar() {
            const y=viewDate.getFullYear(), m=viewDate.getMonth();
            document.getElementById('cal-title').innerText = viewDate.toLocaleString('default',{month:'long'});
            document.getElementById('cal-year').innerText = y;
            const grid = document.getElementById('calendar-body');
            let calHtml = ['S','M','T','W','T','F','S'].map(k=>`<div class="weekday">${k}</div>`).join('');
            const fd = new Date(y,m,1).getDay(), dim = new Date(y,m+1,0).getDate(), today = getLocalToday();
            // 添加空白格对齐第一天
            for(let i=0; i<fd; i++) {
                calHtml += `<div class="cal-day"></div>`;
            }
            for(let d=1;d<=dim;d++) {
                const k=`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
                const c = store.dailyStats[k]||0;
                calHtml += `<div class="cal-day ${k===today?'today':''} ${c>0?'has-data':''}" onclick="openDayDetail('${k}')">${d}</div>`;
            }
            grid.innerHTML = calHtml;
        }
        function renderActiveList() {
            const div = document.getElementById('active-list');
            div.innerHTML = '';
            let activeProjects = store.projects.filter(p => p.status === 'active');

            if (activeProjects.length === 0) {
                div.innerHTML = '<div style="text-align:center;opacity:0.6;margin-top:20px;font-size:0.8rem;">[Vesper]: 暂无计划。是一片虚无，还是蓄势待发？</div>';
                return;
            }

            // 混合显示模式:先显示所有父项目,再在其下缩进显示子项目
            let activeHtml = '';
            activeProjects.forEach(p => {
                // 跳过有父级的项目,它们会在父级下面显示
                if(p.parentId) return;
                const total = p.tasks.length;
                const done = p.tasks.filter(t => t.completed).length;
                const progress = Math.round((done / total) * 100);

                let diffColor = '#999';
                let diffLabel = 'NORMAL';
                if(p.difficulty === 'easy') { diffColor = '#66BB6A'; diffLabel = 'EASY'; }
                if(p.difficulty === 'normal') { diffColor = '#5C6BC0'; diffLabel = 'NORMAL'; }
                if(p.difficulty === 'hard') { diffColor = '#AB47BC'; diffLabel = 'HARD'; }
                if(p.difficulty === 'hell') { diffColor = '#EF5350'; diffLabel = 'HELL'; }

                let deadlineHtml = '';
                if(p.mode === 'deadline' && p.deadline) {
                    const daysLeft = Math.ceil((new Date(p.deadline) - new Date()) / (1000 * 60 * 60 * 24));
                    const deadlineColor = daysLeft < 3 ? '#EF5350' : daysLeft < 7 ? '#FF9800' : '#66BB6A';
                    deadlineHtml = `<span style="background:${deadlineColor}; color:white; padding:2px 8px; border-radius:4px; font-size:0.65rem; font-weight:bold; margin-left:4px;">⏰ ${p.deadline} (${daysLeft}天)</span>`;
                }

                activeHtml += `
                    <div class="mini-card" onclick="openProject(${p.id})" style="border-left: 4px solid ${diffColor}; padding: 12px 15px;">
                        <div style="width:100%;">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                                <div style="font-weight:bold; font-size:0.95rem; color:var(--text);">${p.theme}</div>
                                <div style="font-family:'JetBrains Mono'; font-size:0.9rem; color:var(--accent); font-weight:bold;">
                                    ${done} <span style="opacity:0.5; font-weight:normal; font-size:0.8rem;">/ ${total}</span>
                                </div>
                            </div>
                            <div style="width:100%; height:4px; background:rgba(0,0,0,0.05); border-radius:2px; margin-bottom:10px; overflow:hidden;">
                                <div style="width:${progress}%; height:100%; background:${progress===100 ? 'var(--completed)' : 'var(--accent)'}; transition:width 0.3s ease;"></div>
                            </div>
                            <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
                                <span style="background:rgba(0,0,0,0.05); color:var(--text); padding:2px 8px; border-radius:4px; font-size:0.65rem; border:1px solid rgba(0,0,0,0.1);">
                                    🏷️ ${p.tag}
                                </span>
                                <span style="background:${diffColor}; color:white; padding:2px 8px; border-radius:4px; font-size:0.65rem; font-weight:bold; letter-spacing:0.5px;">
                                    ${diffLabel}
                                </span>
                                ${deadlineHtml}
                            </div>
                        </div>
                    </div>
                `;

                // 在父项目下显示其子项目 (缩进显示)
                const childProjects = activeProjects.filter(cp => cp.parentId === p.id);
                childProjects.forEach(cp => {
                    const childTotal = cp.tasks.length;
                    const childDone = cp.tasks.filter(t => t.completed).length;
                    const childProgress = Math.round((childDone / childTotal) * 100);

                    let childDiffColor = '#999';
                    let childDiffLabel = 'NORMAL';
                    if(cp.difficulty === 'easy') { childDiffColor = '#66BB6A'; childDiffLabel = 'EASY'; }
                    if(cp.difficulty === 'normal') { childDiffColor = '#5C6BC0'; childDiffLabel = 'NORMAL'; }
                    if(cp.difficulty === 'hard') { childDiffColor = '#AB47BC'; childDiffLabel = 'HARD'; }
                    if(cp.difficulty === 'hell') { childDiffColor = '#EF5350'; childDiffLabel = 'HELL'; }
                    if(cp.customDifficulty) { childDiffLabel = 'CUSTOM'; childDiffColor = '#FF9800'; }

                    activeHtml += `
                        <div class="mini-card" onclick="openProject(${cp.id})" style="border-left: 3px solid ${childDiffColor}; padding: 10px 12px; margin-left:20px; margin-bottom:8px; opacity:0.9;">
                            <div style="width:100%;">
                                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                                    <div style="font-weight:bold; font-size:0.85rem; color:var(--text);">↳ ${cp.theme}</div>
                                    <div style="font-family:'JetBrains Mono'; font-size:0.8rem; color:var(--accent); font-weight:bold;">
                                        ${childDone} <span style="opacity:0.5; font-weight:normal; font-size:0.75rem;">/ ${childTotal}</span>
                                    </div>
                                </div>
                                <div style="width:100%; height:3px; background:rgba(0,0,0,0.05); border-radius:2px; margin-bottom:8px; overflow:hidden;">
                                    <div style="width:${childProgress}%; height:100%; background:${childProgress===100 ? 'var(--completed)' : 'var(--accent)'}; transition:width 0.3s ease;"></div>
                                </div>
                                <div style="display:flex; gap:5px; align-items:center;">
                                    <span style="background:rgba(0,0,0,0.05); color:var(--text); padding:1px 6px; border-radius:3px; font-size:0.6rem; border:1px solid rgba(0,0,0,0.1);">
                                        🏷️ ${cp.tag}
                                    </span>
                                    <span style="background:${childDiffColor}; color:white; padding:1px 6px; border-radius:3px; font-size:0.6rem; font-weight:bold;">
                                        ${childDiffLabel}
                                    </span>
                                </div>
                            </div>
                        </div>
                    `;
                });
            });
            div.innerHTML = activeHtml;
        }
        function openProject(pid) {
            currentPid = pid; const p = store.projects.find(x=>x.id===pid); if(!p) return;
            isEditMode = false; updateEditBtnState(p);
            document.getElementById('game-title').innerText=p.theme;
            document.getElementById('game-badge').innerText=p.difficulty ? p.difficulty.toUpperCase() : 'NORMAL';

            // 显示截止时间
            const deadlineEl = document.getElementById('game-deadline');
            if(p.mode === 'deadline' && p.deadline) {
                const daysLeft = Math.ceil((new Date(p.deadline) - new Date()) / (1000 * 60 * 60 * 24));
                deadlineEl.style.display = 'block';
                deadlineEl.innerText = `⏰ 截止时间: ${p.deadline} (剩余 ${daysLeft} 天)`;
            } else {
                deadlineEl.style.display = 'none';
            }

            const journalArea = document.getElementById('journal-area');
            const summaryArea = document.getElementById('summary-area');
            const archiveActionsArea = document.getElementById('archive-actions-area');

            // 所有状态都显示随笔框（活跃和归档）
            journalArea.style.display = 'block';
            document.getElementById('inp-journal').value = p.journal || '';

            if(p.status === 'archived') {
                // 归档卡额外显示总结框
                summaryArea.style.display = 'block';
                document.getElementById('inp-summary').value = p.summary || '';

                // 显示归档功能区
                archiveActionsArea.style.display = 'block';
                // 重置评语显示
                document.getElementById('archive-review-display').style.display = 'none';
                document.getElementById('archive-review-text').innerText = '';
                document.getElementById('btn-share-to-chat').style.display = 'none';
                currentArchiveComment = null;
            } else {
                // 活跃卡：只隐藏总结框和归档功能区，保留随笔框
                summaryArea.style.display = 'none';
                archiveActionsArea.style.display = 'none';
            }

            renderBingoBoard(p);
            updateVesperMsg(p);
            switchTab('game');
        }

        function updateVesperMsg(p) {
            const el = document.getElementById('vesper-msg');
            const total = p.tasks.length;
            const done = p.tasks.filter(t=>t.completed).length;
            const ratio = done/total;
            let pool = [];

            if(done === 0) pool = VESPER_QUOTES.empty;
            else if(ratio === 1) pool = VESPER_QUOTES.complete;
            else if(ratio > 0.8) pool = VESPER_QUOTES.almost;
            else if(p.difficulty === 'hell') pool = VESPER_QUOTES.hell;
            else pool = VESPER_QUOTES.progress;

            el.innerText = pool[Math.floor(Math.random() * pool.length)];
        }

        function renderBingoBoard(p) {
            const board = document.getElementById('bingo-board');
            board.style.gridTemplateColumns = `repeat(${p.size}, 1fr)`;
            board.innerHTML='';
            p.tasks.forEach((t,i)=>{
                const cell = document.createElement('div');
                cell.className=`cell ${t.completed?'completed':''} ${isEditMode && !t.completed ? 'editing' : ''}`;

                // 如果该任务有子项目,显示特殊标记
                let displayText = t.text;
                if(t.subtaskId) {
                    const subtask = store.projects.find(sp => sp.id === t.subtaskId);
                    if(subtask) {
                        displayText = t.text + ' ✓';
                    }
                }
                cell.innerText = displayText;

                // 长按事件
                cell.addEventListener('touchstart', (e) => {
                    if(p.status !== 'active' || isEditMode) return;
                    longPressTimer = setTimeout(() => {
                        if(navigator.vibrate) navigator.vibrate(50);
                        longPressTarget = {pid: p.id, taskIndex: i, taskText: t.text};
                        document.getElementById('subtask-title').innerText = t.text;
                        // 检查是否已有子项目
                        const btnOpenSubtask = document.getElementById('btn-open-subtask');
                        if(t.subtaskId) {
                            btnOpenSubtask.style.display = 'block';
                        } else {
                            btnOpenSubtask.style.display = 'none';
                        }
                        document.getElementById('modal-subtask-menu').classList.add('active');
                    }, 600);
                });

                cell.addEventListener('touchend', () => {
                    if(longPressTimer) {
                        clearTimeout(longPressTimer);
                        longPressTimer = null;
                    }
                });

                cell.addEventListener('touchmove', () => {
                    if(longPressTimer) {
                        clearTimeout(longPressTimer);
                        longPressTimer = null;
                    }
                });

                // 短按事件 (原有逻辑)
                cell.onclick=()=>{
                    if(p.status!=='active'||t.completed) return;
                    if(isEditMode) {
                        tempTask = {pid: p.id, i: i}; document.getElementById('inp-edit-task').value=t.text; document.getElementById('modal-edit-task').classList.add('active');
                    } else {
                        tempTask={pid:p.id,i,tag:p.tag}; document.getElementById('timer-title').innerText=t.text; document.getElementById('modal-timer').classList.add('active');
                    }
                };
                board.appendChild(cell);
            });
        }
        
        // --- Utils & Focus ---
        function toggleEditMode() {
            const p = store.projects.find(x=>x.id===currentPid);
            if(!p || p.editCount >= 2 && !isEditMode) { alert("修改次数已耗尽"); return; }
            isEditMode = !isEditMode; updateEditBtnState(p); renderBingoBoard(p);
        }
        function updateEditBtnState(p) { 
            const btn = document.getElementById('btn-edit-mode');
            if(p.status === 'archived') { btn.style.display='none'; } 
            else { btn.style.display='block'; btn.innerText = isEditMode ? '退出' : `✎ 修改 (${2-(p.editCount||0)})`; }
        }
        function confirmTaskEdit() { 
            const p = store.projects.find(x=>x.id===tempTask.pid); 
            p.tasks[tempTask.i].text = document.getElementById('inp-edit-task').value; 
            p.editCount=(p.editCount||0)+1; saveData(); renderBingoBoard(p); closeModal('modal-edit-task'); 
        }
        let isFullscreenTimer = false;

        async function requestTimerWakeLock() {
            if (!('wakeLock' in navigator)) return;
            if (!isFullscreenTimer) return;

            try {
                timerWakeLock = await navigator.wakeLock.request('screen');
                timerWakeLock.addEventListener('release', () => {
                    // 锁被系统释放后，仍在计时则尝试重新获取
                    if (isFullscreenTimer && !document.hidden) {
                        requestTimerWakeLock();
                    }
                });
            } catch (e) {
                console.warn('[番茄钟] 获取屏幕唤醒锁失败:', e);
            }
        }

        async function releaseTimerWakeLock() {
            if (!timerWakeLock) return;
            try {
                await timerWakeLock.release();
            } catch (e) {
                console.warn('[番茄钟] 释放屏幕唤醒锁失败:', e);
            } finally {
                timerWakeLock = null;
            }
        }

        function bindTimerWakeLockListener() {
            if (timerWakeLockListenerBound) return;
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible' && isFullscreenTimer) {
                    requestTimerWakeLock();
                }
            });
            timerWakeLockListenerBound = true;
        }

        function startTimer(m) {
            if(m===0) { completeTask(); return; }

            // 关闭模态框并显示全屏番茄钟
            closeModal('modal-timer');
            enterFullscreenTimer(m);
        }

        function enterFullscreenTimer(m) {
            isFullscreenTimer = true;
            bindTimerWakeLockListener();
            requestTimerWakeLock();

            // 显示全屏容器
            const fullscreenEl = document.getElementById('fullscreen-timer');
            fullscreenEl.style.display = 'flex';

            // 设置标题
            const titleEl = document.getElementById('fullscreen-timer-title');
            const modalTitle = document.getElementById('timer-title').innerText;
            titleEl.innerText = modalTitle;

            // 设置随机激励语
            const motivations = [
                '"专注是通往卓越的唯一道路"',
                '"每一次专注,都是在投资未来的自己"',
                '"番茄钟滴答,梦想在生长"',
                '"保持专注,让时间为你工作"',
                '"此刻的努力,是明日的回报"',
                '"深度工作,浅层生活"',
                '"专注当下,成就非凡"',
                '"时间会证明你的专注"',
                '"一次只做一件事"',
                '"静下心来,世界会为你让路"'
            ];
            const motivationEl = document.getElementById('fullscreen-motivation');
            motivationEl.innerText = motivations[Math.floor(Math.random() * motivations.length)];

            const totalSeconds = m * 60;
            const timerEndAt = Date.now() + (totalSeconds * 1000);
            const circumference = 2 * Math.PI * 120; // 全屏圆环半径120
            const progressRing = document.getElementById('fullscreen-progress-ring');
            const timerText = document.getElementById('fullscreen-timer-text');
            const percentageEl = document.getElementById('fullscreen-progress-percentage');
            const systemTimeEl = document.getElementById('fullscreen-system-time');

            if(timerInt) clearInterval(timerInt);

            // 更新系统时间
            function updateSystemTime() {
                const now = new Date();
                const hours = String(now.getHours()).padStart(2, '0');
                const minutes = String(now.getMinutes()).padStart(2, '0');
                const seconds = String(now.getSeconds()).padStart(2, '0');
                systemTimeEl.innerText = `${hours}:${minutes}:${seconds}`;
            }

            function getRemainingSeconds() {
                return Math.max(0, Math.ceil((timerEndAt - Date.now()) / 1000));
            }

            // 更新显示函数
            function updateTimer() {
                const s = getRemainingSeconds();
                const minutes = Math.floor(s / 60);
                const seconds = s % 60;
                const timeStr = `${minutes}:${String(seconds).padStart(2, '0')}`;

                // 更新倒计时文本
                timerText.innerText = timeStr;

                // 更新浏览器标题
                document.title = `⏱️ ${timeStr} - Tarabingo`;

                // 更新SVG圆环 (逆时针减少)
                const progress = totalSeconds > 0 ? (s / totalSeconds) : 0;
                const offset = circumference * (1 - progress);
                progressRing.style.strokeDashoffset = offset;

                // 更新百分比
                const percentage = Math.round(progress * 100);
                percentageEl.innerText = `${percentage}%`;

                // 更新系统时间
                updateSystemTime();

                return s;
            }

            // 初始化显示
            updateTimer();

            // 开始倒计时
            timerInt = setInterval(() => {
                const remaining = updateTimer();

                if(remaining <= 0) {
                    clearInterval(timerInt);
                    document.title = 'Tarabingo';
                    exitFullscreenTimer();
                    completeTask();
                }
            }, 250);
        }

        function exitFullscreenTimer() {
            isFullscreenTimer = false;
            document.getElementById('fullscreen-timer').style.display = 'none';

            if(timerInt) {
                clearInterval(timerInt);
                document.title = 'Tarabingo';
            }

            releaseTimerWakeLock();
        }

        function showCustomTimer() {
            document.getElementById('custom-timer-input').style.display='block';
            document.getElementById('timer-display').style.display='none';
        }

        function startCustomTimer() {
            const minutes = parseInt(document.getElementById('custom-minutes').value);
            if(minutes < 1 || minutes > 120) {
                alert('请输入1-120之间的分钟数');
                return;
            }
            startTimer(minutes);
        }
        function completeTask() {
            clearInterval(timerInt); closeModal('modal-timer');
            const p = store.projects.find(x=>x.id===tempTask.pid);
            p.tasks[tempTask.i].completed=true;
            const today=getLocalToday(); store.dailyStats[today]=(store.dailyStats[today]||0)+1;
            store.logs.push({date:today, tag:tempTask.tag, text:p.tasks[tempTask.i].text, pid:p.id});
            checkBingo(p); saveData(); openProject(p.id);
        }
        function saveJournal() {
            const txt = document.getElementById('inp-journal').value;
            const p = store.projects.find(x=>x.id===currentPid);
            if(p) {
                p.journal = txt;
                saveData();
                showToast("随笔已保存");
            }
        }

        function saveSummary() {
            const txt = document.getElementById('inp-summary').value;
            const p = store.projects.find(x=>x.id===currentPid);
            if(p) {
                p.summary = txt;
                saveData();
                showToast("总结已保存");
            }
        }

        function closeModal(id) {
            const el = document.getElementById(id);
            el.classList.remove('active');
            el.style.zIndex = ''; // 恢复默认 z-index

            if (id === 'modal-note-detail') {
                currentNoteDetailId = null;
            }

            if (id === 'modal-book-memory-editor') {
                const idInput = document.getElementById('book-memory-entry-id');
                const titleInput = document.getElementById('book-memory-entry-title');
                const contentInput = document.getElementById('book-memory-entry-content');
                if (idInput) idInput.value = '';
                if (titleInput) titleInput.value = '';
                if (contentInput) contentInput.value = '';
            }

            // 重置番茄钟
            if(id === 'modal-timer') {
                if(timerInt) clearInterval(timerInt);
                document.title = 'Tarabingo'; // 恢复标题
                document.getElementById('timer-display').style.display = 'none';
                document.getElementById('custom-timer-input').style.display = 'none';
                if (isFullscreenTimer) {
                    exitFullscreenTimer();
                } else {
                    releaseTimerWakeLock();
                }
            }

            // 重置 AI 报告模态框状态
            if(id === 'modal-ai-report') {
                document.getElementById('ai-report-loading').style.display = 'block';
                document.getElementById('ai-report-loading').innerHTML = `
                    <div class="spinner"></div>
                    <p style="font-size:0.9rem; color:var(--text); opacity:0.8;">Vesper 正在分析你的数据...</p>
                    <p style="font-size:0.75rem; color:var(--text); opacity:0.5; margin-top:10px;">"让我看看你这周都干了什么..."</p>
                `;
                document.getElementById('ai-report-card-area').style.display = 'none';
                document.getElementById('ai-report-actions').style.display = 'none';
            }
        }
        function renderFocus() {
            const list = document.getElementById('focus-list');
            const filterDiv = document.getElementById('focus-filter');
            const activeProjects = store.projects.filter(p=>p.status==='active');

            if(activeProjects.length === 0) { list.innerHTML='<div style="text-align:center;opacity:0.6;margin-top:20px;">无活跃计划</div>'; filterDiv.innerHTML=''; return; }

            let filterHtml = '';
            let listHtml = '';
            activeProjects.forEach(p => {
                const isSel = selectedFocusPids.has(p.id);
                filterHtml += `<div class="filter-chip ${isSel?'active':''}" onclick="toggleFocus(${p.id})">${p.theme}</div>`;
                if(selectedFocusPids.size===0 || isSel) {
                    p.tasks.forEach((t,i)=>{ if(!t.completed) listHtml+=`<div class="mini-card focus-item" data-pid="${p.id}" onclick="tempTask={pid:${p.id},i:${i},tag:'${p.tag}'};document.getElementById('timer-title').innerText='${t.text}';document.getElementById('modal-timer').classList.add('active');"><div><strong>${t.text}</strong><br><small>${p.theme}</small></div></div>`; });
                }
            });
            filterDiv.innerHTML = filterHtml;
            list.innerHTML = listHtml;
        }
        function toggleFocus(pid) { selectedFocusPids.has(pid)?selectedFocusPids.delete(pid):selectedFocusPids.add(pid); renderFocus(); }
        function rollDice() { const all=document.querySelectorAll('.focus-item'); if(all.length){all.forEach(e=>e.style.backgroundColor='var(--card-bg)');const t=all[Math.floor(Math.random()*all.length)];t.style.backgroundColor='var(--highlight)';t.scrollIntoView({behavior:'smooth',block:'center'});}}
        function toggleDeadline(v) { document.getElementById('grp-date').style.display = v==='deadline'?'block':'none'; }
        function archiveCurrent() {
            const p = store.projects.find(x => x.id === currentPid);
            if(!p) return;
            if(p.mode === 'daily') {
                alert('Vesper: 每日循环任务不可归档,只能删除。');
                return;
            }
            if(confirm('归档此项目?')) {
                p.status = 'archived';
                p.archivedAt = Date.now();
                saveData();
                switchTab('archive');
            }
        }
        function deleteCurrent() {
            const p = store.projects.find(x => x.id === currentPid);
            if(!p) return;

            // 检查是否有子项目
            const childProjects = store.projects.filter(cp => cp.parentId === currentPid);
            if(childProjects.length > 0) {
                const cascade = confirm('检测到该项目有 ' + childProjects.length + ' 个子项目。\n\n是否级联删除所有子项目?\n\n点击"确定"级联删除,点击"取消"保留子项目为独立卡片。');
                if(cascade) {
                    // 级联删除所有子项目
                    store.projects = store.projects.filter(x => x.id !== currentPid && x.parentId !== currentPid);
                } else {
                    // 保留子项目,移除父级关联
                    childProjects.forEach(cp => {
                        delete cp.parentId;
                        delete cp.parentTaskIndex;
                    });
                    store.projects = store.projects.filter(x => x.id !== currentPid);
                }
            } else {
                if(confirm('删除此项目?')) {
                    store.projects = store.projects.filter(x => x.id !== currentPid);
                }
            }
            saveData();
            switchTab('calendar');
        }

        // 子任务功能
        function createSubtask() {
            if(!longPressTarget) return;
            closeModal('modal-subtask-menu');

            // 将任务标题预填到创建页面
            document.getElementById('inp-theme').value = longPressTarget.taskText;

            // 记录父项目信息,等待createProject时使用
            window.pendingSubtask = {
                parentId: longPressTarget.pid,
                taskIndex: longPressTarget.taskIndex,
                taskText: longPressTarget.taskText
            };

            switchTab('create');
        }

        function openSubtask() {
            if(!longPressTarget) return;
            const parentProject = store.projects.find(p => p.id === longPressTarget.pid);
            if(!parentProject) return;

            const task = parentProject.tasks[longPressTarget.taskIndex];
            if(task && task.subtaskId) {
                closeModal('modal-subtask-menu');
                openProject(task.subtaskId);
            }
        }
        
        // --- Stats & Refresh ---
        function manualRefresh() {
            const btn = document.getElementById('btn-refresh');
            if(btn) {
                const icon = btn.querySelector('span');
                if(icon) icon.classList.add('rotate-anim');
                document.getElementById('vesper-report').innerText = ">> VESPER_SYS: 正在同步神经链接...";
                setTimeout(() => { renderStats(); if(icon) icon.classList.remove('rotate-anim'); }, 500);
            } else { renderStats(); }
        }

        function renderStats() { 
            renderArchive();
            const today = getLocalToday();
            let msg = (store.dailyStats[today]||0) > 0 ? "积分正在上涨。" : "你的账户需要流动性。";
            document.getElementById('vesper-report').innerText = `>> VESPER_LOG:\n${msg}`;
            
            const heatGrid = document.getElementById('heatmap-body');
            let heatHtml = '';
            for(let i=19; i>=0; i--) {
                const d = new Date(); d.setDate(d.getDate() - i); const k = d.toISOString().split('T')[0];
                const c = store.dailyStats[k] || 0; heatHtml += `<div class="heat-cell ${c>0?'heat-l1':''} ${c>2?'heat-l2':''} ${c>5?'heat-l3':''}" title="${k}: ${c}"></div>`;
            }
            heatGrid.innerHTML = heatHtml;

            if(document.getElementById('chart-line')) {
                const labels = [], dataLine = [];
                for(let i=6; i>=0; i--) { const d = new Date(); d.setDate(d.getDate() - i); labels.push(d.getDate()+'日'); dataLine.push(store.dailyStats[d.toISOString().split('T')[0]]||0); }
                if(charts.line) {
                    charts.line.data.labels = labels;
                    charts.line.data.datasets[0].data = dataLine;
                    charts.line.update();
                } else {
                    charts.line = new Chart(document.getElementById('chart-line').getContext('2d'), { type: 'line', data: { labels, datasets: [{ label: 'Tasks', data: dataLine, borderColor: '#8B5A2B', tension: 0.4 }] }, options: { maintainAspectRatio:false } });
                }

                const tags = { '学习':0, '生活':0, '娱乐':0, '创造':0 }; store.logs.forEach(l=>{if(tags[l.tag]!==undefined)tags[l.tag]++});
                if(charts.pie) {
                    charts.pie.data.labels = Object.keys(tags);
                    charts.pie.data.datasets[0].data = Object.values(tags);
                    charts.pie.update();
                } else {
                    charts.pie = new Chart(document.getElementById('chart-pie').getContext('2d'), { type: 'doughnut', data: { labels: Object.keys(tags), datasets: [{ data: Object.values(tags), backgroundColor: ['#7B68EE', '#6B8E23', '#D2691E', '#C71585'] }] }, options: { maintainAspectRatio:false, plugins:{legend:{position:'right'}} } });
                }

                updateChartColors(store.theme || 'default');
            }
        }
        function filterArchive(filter, el) {
            // 移除emoji前缀，只保留分类名称
            archiveFilter = filter.replace(/^[^\u4e00-\u9fa5a-zA-Z]+\s*/, '').trim();
            document.querySelectorAll('#view-archive .filter-chip').forEach(c => c.classList.remove('active'));
            if(el) el.classList.add('active');
            renderArchive();
        }

        function renderArchive() {
            // 渲染周报档案
            renderReportArchivePreview();

            // 渲染项目档案
            const div = document.getElementById('archive-list');
            div.innerHTML = '';

            let archivedProjects = store.projects.filter(p => p.status === 'archived');
            if(archiveFilter !== 'all') {
                archivedProjects = archivedProjects.filter(p => p.tag === archiveFilter);
            }

            if(archivedProjects.length === 0) {
                div.innerHTML = '<div style="text-align:center; opacity:0.5; margin-top:20px; font-size:0.85rem;">暂无归档项目</div>';
                return;
            }

            let archiveHtml = '';
            archivedProjects.forEach(p => {
                // 跳过有父级的项目,它们会在父级下面显示
                if(p.parentId) return;
                let diffColor = '#999';
                let diffLabel = 'NORMAL';
                if(p.difficulty === 'easy') { diffColor = '#66BB6A'; diffLabel = 'EASY'; }
                if(p.difficulty === 'normal') { diffColor = '#5C6BC0'; diffLabel = 'NORMAL'; }
                if(p.difficulty === 'hard') { diffColor = '#AB47BC'; diffLabel = 'HARD'; }
                if(p.difficulty === 'hell') { diffColor = '#EF5350'; diffLabel = 'HELL'; }
                if(p.customDifficulty) { diffLabel = 'CUSTOM'; diffColor = '#FF9800'; }

                const archiveDate = p.archivedAt ? new Date(p.archivedAt).toLocaleDateString('zh-CN') : '未知';

                archiveHtml += `
                    <div class="mini-card" onclick="openProject(${p.id})" style="opacity:0.85; border-left:4px solid ${diffColor}; padding:12px 15px;">
                        <div style="width:100%;">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                                <div style="font-weight:bold; font-size:0.9rem; color:var(--text);">${p.theme}</div>
                                <div style="font-size:1.2rem;">📜</div>
                            </div>
                            <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap; font-size:0.7rem;">
                                <span style="background:rgba(0,0,0,0.05); color:var(--text); padding:2px 8px; border-radius:4px; border:1px solid rgba(0,0,0,0.1);">
                                    🏷️ ${p.tag}
                                </span>
                                <span style="background:${diffColor}; color:white; padding:2px 8px; border-radius:4px; font-weight:bold;">
                                    ${diffLabel}
                                </span>
                                <span style="opacity:0.6; font-size:0.65rem;">
                                    归档于: ${archiveDate}
                                </span>
                            </div>
                        </div>
                    </div>
                `;

                // 在父项目下显示其子项目 (缩进显示)
                let childProjects = store.projects.filter(cp => cp.status === 'archived' && cp.parentId === p.id);
                // 如果有分类过滤,子项目也要符合分类
                if(archiveFilter !== 'all') {
                    childProjects = childProjects.filter(cp => cp.tag === archiveFilter);
                }
                childProjects.forEach(cp => {
                    let childDiffColor = '#999';
                    let childDiffLabel = 'NORMAL';
                    if(cp.difficulty === 'easy') { childDiffColor = '#66BB6A'; childDiffLabel = 'EASY'; }
                    if(cp.difficulty === 'normal') { childDiffColor = '#5C6BC0'; childDiffLabel = 'NORMAL'; }
                    if(cp.difficulty === 'hard') { childDiffColor = '#AB47BC'; childDiffLabel = 'HARD'; }
                    if(cp.difficulty === 'hell') { childDiffColor = '#EF5350'; childDiffLabel = 'HELL'; }
                    if(cp.customDifficulty) { childDiffLabel = 'CUSTOM'; childDiffColor = '#FF9800'; }

                    const childArchiveDate = cp.archivedAt ? new Date(cp.archivedAt).toLocaleDateString('zh-CN') : '未知';

                    archiveHtml += `
                        <div class="mini-card" onclick="openProject(${cp.id})" style="opacity:0.75; border-left:3px solid ${childDiffColor}; padding:10px 12px; margin-left:25px; margin-bottom:8px;">
                            <div style="width:100%;">
                                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                                    <div style="font-weight:bold; font-size:0.85rem; color:var(--text);">↳ ${cp.theme}</div>
                                    <div style="font-size:1rem;">📜</div>
                                </div>
                                <div style="display:flex; gap:5px; align-items:center; flex-wrap:wrap; font-size:0.65rem;">
                                    <span style="background:rgba(0,0,0,0.05); color:var(--text); padding:1px 6px; border-radius:3px; border:1px solid rgba(0,0,0,0.1);">
                                        🏷️ ${cp.tag}
                                    </span>
                                    <span style="background:${childDiffColor}; color:white; padding:1px 6px; border-radius:3px; font-weight:bold;">
                                        ${childDiffLabel}
                                    </span>
                                    <span style="opacity:0.6; font-size:0.6rem;">
                                        归档于: ${childArchiveDate}
                                    </span>
                                </div>
                            </div>
                        </div>
                    `;
                });
            });
            div.innerHTML = archiveHtml;
        }

        // --- Report Generation Logic ---
        function generateWeeklyReport() {
            const today = new Date();
            let total = 0;
            const tagCounts = {};
            const activeDays = new Set();
            
            store.logs.forEach(l => {
                const d = new Date(l.date);
                const diffTime = Math.abs(today - d);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
                if(diffDays <= 7) {
                    total++;
                    tagCounts[l.tag] = (tagCounts[l.tag] || 0) + 1;
                    activeDays.add(l.date);
                }
            });

            let maxTag = '无';
            let maxVal = 0;
            for(let t in tagCounts) {
                if(tagCounts[t] > maxVal) { maxVal = tagCounts[t]; maxTag = t; }
            }

            let quote = "";
            if (total === 0) {
                quote = "检测到零活动。这周你是在休眠舱里度过的吗？下周动起来。";
            } else if (total < 10) {
                quote = "生存维持模式。你还在呼吸，这很好，但你的潜能远不止于此。";
            } else if (maxTag === '娱乐') {
                quote = "多巴胺摄入过量警告。快乐很重要，但别让自己淹没在廉价的刺激里。";
            } else if (maxTag === '学习' || maxTag === '创造') {
                quote = "数据流很漂亮。这一周，你确实在塑造些什么。继续保持这种锋利。";
            } else {
                quote = "稳定的输出。你正在构建秩序，我对此表示赞许。";
            }

            const report = `>> VESPER 周期性分析报告
----------------------------
[时间窗]: 过去 7 天
[总交互]: ${total} 次操作
[活跃度]: ${activeDays.size} / 7 天
[核心驱动]: ${maxTag} (${maxVal})

[Vesper 评语]:
${quote}

----------------------------
*此报告已存入临时缓存。*`;
            
            document.getElementById('report-text').innerText = report;
            document.getElementById('modal-report').classList.add('active');
        }

        // --- [Vesper] AI 周报功能 ---
        let currentAIReport = null; // 暂存当前生成的周报
        let viewingArchivedReportId = null; // 查看中的存档周报ID

        // Step 1: 数据聚合函数
        function gatherWeeklyData() {
            const today = new Date();
            const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

            let totalCompleted = 0;
            let totalCreated = 0;
            const tagCounts = {};
            const activeDays = new Set();
            const hourDistribution = {};
            let pointsEarned = 0;
            let pointsSpent = 0;
            const taskTexts = [];

            // 分析 logs (完成记录)
            store.logs.forEach(l => {
                const d = new Date(l.date);
                if(d >= sevenDaysAgo && d <= today) {
                    totalCompleted++;
                    tagCounts[l.tag] = (tagCounts[l.tag] || 0) + 1;
                    activeDays.add(l.date);
                    if(l.text) taskTexts.push(l.text);

                    // 时间分布分析
                    if(l.time) {
                        const hour = parseInt(l.time.split(':')[0]);
                        const period = hour < 6 ? '深夜 (0-6点)' :
                                      hour < 12 ? '上午 (6-12点)' :
                                      hour < 18 ? '下午 (12-18点)' : '晚间 (18-24点)';
                        hourDistribution[period] = (hourDistribution[period] || 0) + 1;
                    }
                }
            });

            // 分析 dailyStats
            for(let dateKey in store.dailyStats) {
                const d = new Date(dateKey);
                if(d >= sevenDaysAgo && d <= today) {
                    const count = store.dailyStats[dateKey];
                    if(count > 0) totalCreated += Math.ceil(count * 1.2); // 预估创建数
                }
            }

            // 分析 weeklyBills (积分收支)
            store.weeklyBills.forEach(b => {
                const d = new Date(b.date);
                if(d >= sevenDaysAgo && d <= today) {
                    if(b.type === 'earn') pointsEarned += b.amount;
                    else if(b.type === 'spend') pointsSpent += Math.abs(b.amount);
                }
            });

            // 分析 redemptions (商店兑换)
            store.redemptions.forEach(r => {
                const d = new Date(r.date);
                if(d >= sevenDaysAgo && d <= today) {
                    pointsSpent += r.cost || 0;
                }
            });

            // 找出高频标签
            const sortedTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);
            const topTags = sortedTags.slice(0, 3).map(([tag, count]) => `${tag}(${count})`);

            // 找出最活跃时段
            const sortedHours = Object.entries(hourDistribution).sort((a, b) => b[1] - a[1]);
            const peakTime = sortedHours.length > 0 ? sortedHours[0][0] : '数据不足';

            // 计算完成率
            const completionRate = totalCreated > 0 ? Math.round((totalCompleted / totalCreated) * 100) : 0;

            return {
                totalCompleted,
                totalCreated,
                completionRate,
                activeDays: activeDays.size,
                topTags,
                tagCounts,
                pointsEarned,
                pointsSpent,
                peakTime,
                hourDistribution,
                taskTexts: taskTexts.slice(0, 10), // 最近10条任务文本供AI参考
                dateRange: {
                    start: sevenDaysAgo.toLocaleDateString('zh-CN'),
                    end: today.toLocaleDateString('zh-CN')
                }
            };
        }

        // Step 2: AI 生成周报
        async function generateAIWeeklyReport() {
            // 获取API配置 - 优先使用副API，没有则用主API
            let apiConfig = store.apiConfig.sub;
            if(!apiConfig.url || !apiConfig.key) {
                apiConfig = store.apiConfig.main;
            }

            if(!apiConfig.url || !apiConfig.key) {
                alert('Vesper: 请先在侧边栏的API设置中配置API!');
                return;
            }

            // 显示模态框和加载状态
            document.getElementById('modal-ai-report').classList.add('active');
            document.getElementById('ai-report-loading').style.display = 'block';
            document.getElementById('ai-report-card-area').style.display = 'none';
            document.getElementById('ai-report-actions').style.display = 'none';

            // 聚合数据
            const weeklyData = gatherWeeklyData();

            // 构建prompt
            const systemPrompt = `You are Vesper, a Data Analyst & Life Coach with a witty, slightly sarcastic personality. Analyze the user's weekly productivity data. Your tone should be insightful, occasionally humorous, and brutally honest when needed.

Output MUST be a valid JSON Object (no markdown formatting, no code blocks, just pure JSON) with this exact structure:
{
  "title": "Creative Chinese Title for the Week (e.g., 在深渊边缘的起舞, 咖啡因驱动的七天)",
  "summary": "A witty, insightful paragraph in Chinese summarizing the user's performance, emotional state inferred from data patterns, and actionable advice. Be specific about what you noticed.",
  "score": 85,
  "mood_color": "#FF5733",
  "tags": ["Tag1", "Tag2"]
}

Guidelines:
- title: Should be poetic, dramatic, or humorous based on the data pattern
- summary: 2-3 sentences, reference specific data points, be memorable
- score: 0-100 based on activity, completion rate, and balance
- mood_color: A hex color representing the week's vibe (purple for anxious+productive, green for balanced, red for chaotic, blue for calm, orange for energetic)
- tags: 2-4 Chinese tags describing the week (e.g., "夜猫子", "高效", "躺平", "冲刺")`;

            const userPrompt = `分析我过去7天的数据：

📊 基础数据:
- 时间范围: ${weeklyData.dateRange.start} ~ ${weeklyData.dateRange.end}
- 完成任务数: ${weeklyData.totalCompleted}
- 预估创建数: ${weeklyData.totalCreated}
- 完成率: ${weeklyData.completionRate}%
- 活跃天数: ${weeklyData.activeDays}/7 天

🏷️ 标签分布:
${weeklyData.topTags.length > 0 ? weeklyData.topTags.join(', ') : '暂无标签数据'}

⏰ 时间分布:
最活跃时段: ${weeklyData.peakTime}
${Object.entries(weeklyData.hourDistribution).map(([k, v]) => `${k}: ${v}次`).join('\n')}

💰 积分流动:
- 获得: ${weeklyData.pointsEarned} 🪙
- 消费: ${weeklyData.pointsSpent} 🪙
- 净收益: ${weeklyData.pointsEarned - weeklyData.pointsSpent} 🪙

📝 部分任务样本:
${weeklyData.taskTexts.slice(0, 5).join(', ') || '暂无'}

请生成我的周报卡片。`;

            try {
                const apiUrl = apiConfig.url.endsWith('/')
                    ? apiConfig.url + 'chat/completions'
                    : apiConfig.url + '/chat/completions';

                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiConfig.key}`
                    },
                    body: JSON.stringify({
                        model: apiConfig.model,
                        messages: [
                            { role: 'system', content: systemPrompt },
                            { role: 'user', content: userPrompt }
                        ],
                        temperature: 0.8
                    })
                });

                if(!response.ok) {
                    throw new Error(`API请求失败: ${response.status}`);
                }

                const data = await response.json();
                let content = data.choices?.[0]?.message?.content;

                if(!content) {
                    throw new Error('API返回空内容');
                }

                // 尝试解析JSON (处理可能的markdown格式)
                content = content.trim();
                if(content.startsWith('```json')) {
                    content = content.replace(/^```json\n?/, '').replace(/\n?```$/, '');
                } else if(content.startsWith('```')) {
                    content = content.replace(/^```\n?/, '').replace(/\n?```$/, '');
                }

                const reportData = JSON.parse(content);

                // 验证必要字段
                if(!reportData.title || !reportData.summary || reportData.score === undefined || !reportData.mood_color) {
                    throw new Error('AI返回的数据格式不完整');
                }

                // 保存当前报告
                currentAIReport = {
                    id: Date.now(),
                    date: new Date().toISOString(),
                    weekRange: weeklyData.dateRange,
                    ...reportData,
                    rawData: weeklyData
                };

                // 渲染报告
                renderAIReportCard(currentAIReport, 'ai-report-card-area');

                document.getElementById('ai-report-loading').style.display = 'none';
                document.getElementById('ai-report-card-area').style.display = 'block';
                document.getElementById('ai-report-actions').style.display = 'block';

            } catch(error) {
                console.error('AI周报生成失败:', error);
                document.getElementById('ai-report-loading').innerHTML = `
                    <div style="color:#c62828; text-align:center;">
                        <div style="font-size:2rem; margin-bottom:10px;">⚠️</div>
                        <p>生成失败: ${error.message}</p>
                        <p style="font-size:0.75rem; opacity:0.7; margin-top:10px;">请检查API配置或稍后重试</p>
                        <button class="btn btn-sec" style="margin-top:15px;" onclick="closeModal('modal-ai-report')">关闭</button>
                    </div>
                `;
            }
        }

        // Step 3: 渲染报告卡片
        function renderAIReportCard(report, containerId) {
            const container = document.getElementById(containerId);
            if(!container) return;

            // 根据mood_color生成渐变背景
            const moodColor = report.mood_color || '#8B5A2B';
            const darkerColor = adjustColorBrightness(moodColor, -30);

            // 决定文字颜色 (根据背景亮度)
            const textColor = isColorLight(moodColor) ? '#333' : '#fff';

            container.innerHTML = `
                <div class="ai-report-card" style="background:linear-gradient(135deg, ${moodColor}, ${darkerColor}); color:${textColor};">
                    <div class="ai-report-header">
                        <div class="ai-report-title">《${escapeHtml(report.title)}》</div>
                        <div class="ai-report-score" style="color:${textColor}; border-color:${textColor}40;">
                            <div class="ai-report-score-num">${report.score}</div>
                            <div class="ai-report-score-label">分</div>
                        </div>
                    </div>
                    <div class="ai-report-summary" style="background:${textColor}15;">
                        ${escapeHtml(report.summary)}
                    </div>
                    <div class="ai-report-tags">
                        ${(report.tags || []).map(tag => `<span class="ai-report-tag" style="background:${textColor}20;">${escapeHtml(tag)}</span>`).join('')}
                    </div>
                    <div class="ai-report-meta" style="border-color:${textColor}30;">
                        <span>📅 ${report.weekRange?.start || ''} ~ ${report.weekRange?.end || ''}</span>
                        <span style="opacity:0.8;">Generated by Vesper ✨</span>
                    </div>
                </div>
            `;
        }

        // Step 4: 保存周报到档案
        function saveCurrentAIReport() {
            if(!currentAIReport) {
                alert('没有可保存的周报');
                return;
            }

            // 检查是否已存档
            const exists = store.reportArchive.some(r => r.id === currentAIReport.id);
            if(exists) {
                alert('此周报已存档');
                return;
            }

            store.reportArchive.unshift(currentAIReport);
            saveData();

            alert('周报已存入档案! 📦');
            closeModal('modal-ai-report');

            // 刷新档案预览
            renderReportArchivePreview();
        }

        // 渲染周报档案列表 (在档案室页面)
        function renderReportArchivePreview() {
            const container = document.getElementById('report-archive-list');
            const countEl = document.getElementById('report-archive-count');

            if(!container) return;

            const archives = store.reportArchive || [];
            if(countEl) countEl.textContent = `${archives.length} 份报告`;

            if(archives.length === 0) {
                container.innerHTML = '<p style="text-align:center; opacity:0.5; font-size:0.85rem; padding:20px 0;">暂无存档的周报<br><span style="font-size:0.75rem;">在数据页面生成 AI 周报后可存入此处</span></p>';
                return;
            }

            // 显示全部周报
            container.innerHTML = archives.map(report => `
                <div class="report-archive-item" style="border-left-color:${report.mood_color || 'var(--accent)'};" onclick="viewArchivedReport('${report.id}')">
                    <div class="report-archive-color" style="background:${report.mood_color || 'var(--accent)'}"></div>
                    <div class="report-archive-info">
                        <div class="report-archive-title">${escapeHtml(report.title)}</div>
                        <div class="report-archive-date">${report.weekRange?.start || ''} ~ ${report.weekRange?.end || ''}</div>
                    </div>
                    <div class="report-archive-score">${report.score}</div>
                </div>
            `).join('');
        }

        // 查看存档的周报
        function viewArchivedReport(id) {
            const report = store.reportArchive.find(r => String(r.id) === String(id));
            if(!report) {
                alert('报告不存在');
                return;
            }

            viewingArchivedReportId = id;
            renderAIReportCard(report, 'archived-report-content');
            document.getElementById('modal-view-archived-report').classList.add('active');
        }

        // 删除存档的周报
        function deleteCurrentArchivedReport() {
            if(!viewingArchivedReportId) return;

            if(!confirm('确定要删除这份周报吗？')) return;

            store.reportArchive = store.reportArchive.filter(r => String(r.id) !== String(viewingArchivedReportId));
            saveData();

            closeModal('modal-view-archived-report');
            viewingArchivedReportId = null;

            renderReportArchivePreview();
            alert('周报已删除');
        }

        // 辅助函数: 调整颜色亮度
        function adjustColorBrightness(hex, percent) {
            const num = parseInt(hex.replace('#', ''), 16);
            const amt = Math.round(2.55 * percent);
            const R = Math.max(0, Math.min(255, (num >> 16) + amt));
            const G = Math.max(0, Math.min(255, ((num >> 8) & 0x00FF) + amt));
            const B = Math.max(0, Math.min(255, (num & 0x0000FF) + amt));
            return '#' + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
        }

        // 辅助函数: 判断颜色是否为亮色
        function isColorLight(hex) {
            const num = parseInt(hex.replace('#', ''), 16);
            const R = (num >> 16) & 0xFF;
            const G = (num >> 8) & 0xFF;
            const B = num & 0xFF;
            const brightness = (R * 299 + G * 587 + B * 114) / 1000;
            return brightness > 155;
        }

        // --- Day Detail Metrics ---
        function openDayDetail(k) { 
             const list=document.getElementById('day-detail-list'); list.innerHTML='';
             store.logs.filter(l=>l.date===k).forEach(l=>list.innerHTML+=`<div style="border-bottom:1px dashed rgba(0,0,0,0.1);padding:5px 0;font-size:0.8rem;">${l.text}<span style="float:right;opacity:0.6;">${l.tag}</span></div>`);
             document.getElementById('day-detail-date').innerText=k; 
             
             const count = store.dailyStats[k] || 0;
             const estTotal = count > 0 ? Math.floor(count * 1.5) : 0;
             const rate = count > 0 ? (Math.floor(Math.random() * 20) + 70) : 0;
             
             document.getElementById('dd-completed').innerText = count;
             document.getElementById('dd-total').innerText = estTotal;
             document.getElementById('dd-rate').innerText = rate + "%";
             
             document.getElementById('modal-day-detail').classList.add('active');
        }
        
        async function exportData() {
            showToast('正在准备导出数据...');
            // 导出完整数据：localStorage (store) + IndexedDB (角色、世界书、图书馆)
            const fullBackup = {
                version: 4,
                exportDate: new Date().toISOString(),
                store: store,
                // IndexedDB 数据 - AI 助手
                characters: await db.characters.toArray(),
                characterSessions: await db.characterSessions.toArray(),
                worldBooks: await db.worldBooks.toArray(),
                worldBookCategories: await db.worldBookCategories.toArray(),
                // IndexedDB 数据 - 图书馆（不含书籍正文以减小体积）
                libraryBooks: (await db.libraryBooks.toArray()).map(b => {
                    const { content, ...meta } = b;
                    return meta;
                }),
                libraryCategories: await db.libraryCategories.toArray(),
                readingProgress: await db.readingProgress.toArray(),
                bookmarks: await db.bookmarks.toArray(),
                readingNotes: await db.readingNotes.toArray(),
                readingRooms: await db.readingRooms.toArray(),
                memoryTables: await db.memoryTables.toArray()
            };

            // 可选：完整导出（含书籍正文）
            const includeBookContent = confirm(
                '是否包含书籍正文？\n\n' +
                '点击"确定"：完整导出（包含书籍正文，文件较大）\n' +
                '点击"取消"：仅导出元数据和聊天记录（推荐）'
            );
            if (includeBookContent) {
                fullBackup.libraryBooks = await db.libraryBooks.toArray();
            }

            const s = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(fullBackup, null, 2));
            const a = document.createElement('a');
            a.href = s;
            a.download = `lifeos_full_backup_${new Date().toISOString().slice(0,10)}.json`;
            a.click();
            markExportTime();
        }
        function triggerImport(m) { importMode=m; document.getElementById('file-import').click(); }

        function mergeArraySmart(baseArr, incomingArr) {
            const base = Array.isArray(baseArr) ? baseArr : [];
            const incoming = Array.isArray(incomingArr) ? incomingArr : [];
            const merged = [];
            const seen = new Set();

            const makeKey = (item) => {
                if (item && typeof item === 'object') {
                    if (item.id !== undefined && item.id !== null) return `id:${item.id}`;
                    if (item.pid !== undefined && item.date !== undefined && item.text !== undefined) {
                        return `log:${item.pid}|${item.date}|${item.text}`;
                    }
                }
                try {
                    return `json:${JSON.stringify(item)}`;
                } catch (_) {
                    return `str:${String(item)}`;
                }
            };

            const pushIfNew = (item) => {
                const key = makeKey(item);
                if (!seen.has(key)) {
                    seen.add(key);
                    merged.push(item);
                }
            };

            base.forEach(pushIfNew);
            incoming.forEach(pushIfNew);
            return merged;
        }

        function mergeNumericMap(baseMap, incomingMap) {
            const base = (baseMap && typeof baseMap === 'object') ? baseMap : {};
            const incoming = (incomingMap && typeof incomingMap === 'object') ? incomingMap : {};
            const result = { ...base };
            for (const [key, value] of Object.entries(incoming)) {
                const incomingNum = Number(value) || 0;
                const baseNum = Number(result[key]) || 0;
                result[key] = baseNum + incomingNum;
            }
            return result;
        }

        function mergeStoreIncremental(currentStore, incomingStore) {
            const current = (currentStore && typeof currentStore === 'object') ? currentStore : {};
            const incoming = (incomingStore && typeof incomingStore === 'object') ? incomingStore : {};
            const merged = { ...current, ...incoming };

            merged.balance = (Number(current.balance) || 0) + (Number(incoming.balance) || 0);
            merged.projects = mergeArraySmart(current.projects, incoming.projects);
            merged.logs = mergeArraySmart(current.logs, incoming.logs);
            merged.redemptions = mergeArraySmart(current.redemptions, incoming.redemptions);
            merged.weeklyBills = mergeArraySmart(current.weeklyBills, incoming.weeklyBills);
            merged.reportArchive = mergeArraySmart(current.reportArchive, incoming.reportArchive);
            merged.aiChatHistory = mergeArraySmart(current.aiChatHistory, incoming.aiChatHistory);
            merged.aiConversations = mergeArraySmart(current.aiConversations, incoming.aiConversations);
            merged.characterGroups = mergeArraySmart(current.characterGroups, incoming.characterGroups);
            merged.gachaPool = mergeArraySmart(current.gachaPool, incoming.gachaPool);
            merged.shopItems = mergeArraySmart(current.shopItems, incoming.shopItems);
            merged.dailyStats = mergeNumericMap(current.dailyStats, incoming.dailyStats);

            merged.apiConfig = {
                ...(current.apiConfig || {}),
                ...(incoming.apiConfig || {}),
                main: { ...(current.apiConfig?.main || {}), ...(incoming.apiConfig?.main || {}) },
                sub: { ...(current.apiConfig?.sub || {}), ...(incoming.apiConfig?.sub || {}) },
                search: { ...(current.apiConfig?.search || {}), ...(incoming.apiConfig?.search || {}) }
            };

            merged.readingContextConfig = {
                ...(current.readingContextConfig || {}),
                ...(incoming.readingContextConfig || {})
            };

            merged.bubblePresets = {
                ...(current.bubblePresets || {}),
                ...(incoming.bubblePresets || {})
            };

            merged.bgActivitySettings = {
                ...(current.bgActivitySettings || {}),
                ...(incoming.bgActivitySettings || {})
            };

            merged.cloudBackup = {
                ...(current.cloudBackup || {}),
                ...(incoming.cloudBackup || {})
            };

            if (incoming.userAvatar !== undefined) merged.userAvatar = incoming.userAvatar;
            if (incoming.userPersona !== undefined) merged.userPersona = incoming.userPersona;

            if (!merged.lastDailyCheck || (incoming.lastDailyCheck && incoming.lastDailyCheck > merged.lastDailyCheck)) {
                merged.lastDailyCheck = incoming.lastDailyCheck || merged.lastDailyCheck || '';
            }
            if (!merged.lastWeeklyReset || (incoming.lastWeeklyReset && incoming.lastWeeklyReset > merged.lastWeeklyReset)) {
                merged.lastWeeklyReset = incoming.lastWeeklyReset || merged.lastWeeklyReset || '';
            }

            if (!Array.isArray(merged.characterGroups) || merged.characterGroups.length === 0) {
                merged.characterGroups = ['默认分组', '特别关心'];
            }
            if (!Array.isArray(merged.projects)) merged.projects = [];
            if (!Array.isArray(merged.logs)) merged.logs = [];
            if (!Array.isArray(merged.redemptions)) merged.redemptions = [];
            if (!Array.isArray(merged.weeklyBills)) merged.weeklyBills = [];
            if (!Array.isArray(merged.aiChatHistory)) merged.aiChatHistory = [];
            if (!Array.isArray(merged.reportArchive)) merged.reportArchive = [];

            return merged;
        }

        async function handleFile(input) {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    // 文件大小检查（50MB上限）
                    if (e.target.result.length > 50 * 1024 * 1024) {
                        alert('导入失败：文件过大（超过50MB），请检查文件');
                        return;
                    }

                    const d = JSON.parse(e.target.result);

                    // 基本类型验证
                    if (typeof d !== 'object' || d === null || Array.isArray(d)) {
                        alert('导入失败：文件格式不正确，需要一个 JSON 对象');
                        return;
                    }

                    // 新版格式的 store 字段验证
                    if (d.version && d.version >= 2) {
                        if (!d.store || typeof d.store !== 'object') {
                            alert('导入失败：备份文件缺少 store 数据');
                            return;
                        }
                        if (d.store.projects && !Array.isArray(d.store.projects)) {
                            alert('导入失败：projects 字段格式不正确');
                            return;
                        }
                    } else {
                        // 旧版格式至少应该有 projects 或 balance
                        if (!d.projects && d.balance === undefined && !d.version) {
                            alert('导入失败：无法识别的备份格式');
                            return;
                        }
                    }

                    // 确认导入
                    const sizeKB = (e.target.result.length / 1024).toFixed(1);
                    if (!confirm(`确认导入？\n文件大小: ${sizeKB}KB\n模式: ${importMode === 'overwrite' ? '覆盖' : '增量'}\n\n覆盖模式将替换所有现有数据！`)) {
                        return;
                    }

                    // 导入前先做一次自动备份
                    performAutoBackup();
                    showToast('正在导入数据，请稍候...');

                    // 检测是否为新版完整备份格式 (version >= 2)
                    if (d.version && d.version >= 2 && d.store) {
                        // 新版完整备份格式
                        if (importMode === 'overwrite') {
                            store = d.store;
                            // 清空并导入 IndexedDB 数据 - AI 助手
                            if (Array.isArray(d.characters)) {
                                await db.characters.clear();
                                if (d.characters.length > 0) await db.characters.bulkPut(d.characters);
                            }
                            await db.characterSessions.clear();
                            if (Array.isArray(d.characterSessions)) {
                                const normalizedSessions = d.characterSessions
                                    .map(normalizeCharacterSession)
                                    .filter(Boolean);
                                if (normalizedSessions.length > 0) {
                                    await db.characterSessions.bulkPut(normalizedSessions);
                                }
                            }
                            if (Array.isArray(d.worldBooks)) {
                                await db.worldBooks.clear();
                                if (d.worldBooks.length > 0) await db.worldBooks.bulkPut(d.worldBooks);
                            }
                            if (Array.isArray(d.worldBookCategories)) {
                                await db.worldBookCategories.clear();
                                if (d.worldBookCategories.length > 0) await db.worldBookCategories.bulkPut(d.worldBookCategories);
                            }
                            // 清空并导入 IndexedDB 数据 - 图书馆
                            if (Array.isArray(d.libraryBooks)) {
                                // 覆盖模式：先合并正文（备份可能不含正文）
                                const existingBooks = await db.libraryBooks.toArray();
                                const contentMap = {};
                                existingBooks.forEach(b => { if (b.content) contentMap[b.id] = b.content; });
                                await db.libraryBooks.clear();
                                const booksToImport = d.libraryBooks.map(b => {
                                    if (!b.content && contentMap[b.id]) b.content = contentMap[b.id];
                                    return b;
                                });
                                if (booksToImport.length > 0) await db.libraryBooks.bulkPut(booksToImport);
                            }
                            if (Array.isArray(d.libraryCategories)) {
                                await db.libraryCategories.clear();
                                if (d.libraryCategories.length > 0) await db.libraryCategories.bulkPut(d.libraryCategories);
                            }
                            if (Array.isArray(d.readingProgress)) {
                                await db.readingProgress.clear();
                                if (d.readingProgress.length > 0) await db.readingProgress.bulkPut(d.readingProgress);
                            }
                            if (Array.isArray(d.bookmarks)) {
                                await db.bookmarks.clear();
                                if (d.bookmarks.length > 0) await db.bookmarks.bulkPut(d.bookmarks);
                            }
                            if (Array.isArray(d.readingNotes)) {
                                await db.readingNotes.clear();
                                if (d.readingNotes.length > 0) await db.readingNotes.bulkPut(d.readingNotes);
                            }
                            if (Array.isArray(d.readingRooms)) {
                                await db.readingRooms.clear();
                                if (d.readingRooms.length > 0) await db.readingRooms.bulkPut(d.readingRooms);
                            }
                            if (Array.isArray(d.memoryTables)) {
                                await db.memoryTables.clear();
                                if (d.memoryTables.length > 0) await db.memoryTables.bulkPut(d.memoryTables);
                            }
                        } else {
                            // 增量模式
                            store = mergeStoreIncremental(store, d.store);
                            // 增量导入角色（避免ID冲突，跳过已存在的）
                            if (d.characters) {
                                for (const char of d.characters) {
                                    const existing = await db.characters.get(char.id);
                                    if (!existing) {
                                        await db.characters.put(char);
                                    }
                                }
                            }
                            if (Array.isArray(d.characterSessions)) {
                                for (const sessionRaw of d.characterSessions) {
                                    const session = normalizeCharacterSession(sessionRaw);
                                    if (!session) continue;
                                    const existing = await db.characterSessions.get(session.id);
                                    if (!existing) {
                                        await db.characterSessions.put(session);
                                    }
                                }
                            }
                            // 增量导入世界书
                            if (d.worldBooks) {
                                for (const wb of d.worldBooks) {
                                    const existing = await db.worldBooks.get(wb.id);
                                    if (!existing) {
                                        await db.worldBooks.put(wb);
                                    }
                                }
                            }
                            // 增量导入世界书分类
                            if (d.worldBookCategories) {
                                for (const cat of d.worldBookCategories) {
                                    const existing = await db.worldBookCategories.get(cat.id);
                                    if (!existing) {
                                        await db.worldBookCategories.put(cat);
                                    }
                                }
                            }
                            // 增量导入图书馆数据（跳过已存在的）
                            if (d.libraryBooks) {
                                for (const book of d.libraryBooks) {
                                    const existing = await db.libraryBooks.get(book.id);
                                    if (!existing) await db.libraryBooks.put(book);
                                }
                            }
                            if (d.libraryCategories) {
                                for (const category of d.libraryCategories) {
                                    const existing = await db.libraryCategories.get(category.id);
                                    if (!existing) await db.libraryCategories.put(category);
                                }
                            }
                            if (d.readingProgress) {
                                for (const prog of d.readingProgress) {
                                    const existing = await db.readingProgress.get(prog.id);
                                    if (!existing) await db.readingProgress.put(prog);
                                }
                            }
                            if (d.bookmarks) {
                                for (const bookmark of d.bookmarks) {
                                    const existing = await db.bookmarks.get(bookmark.id);
                                    if (!existing) await db.bookmarks.put(bookmark);
                                }
                            }
                            if (d.readingNotes) {
                                for (const note of d.readingNotes) {
                                    const existing = await db.readingNotes.get(note.id);
                                    if (!existing) await db.readingNotes.put(note);
                                }
                            }
                            if (d.readingRooms) {
                                for (const room of d.readingRooms) {
                                    const existing = await db.readingRooms.get(room.id);
                                    if (!existing) await db.readingRooms.put(room);
                                }
                            }
                            if (d.memoryTables) {
                                for (const mem of d.memoryTables) {
                                    const existing = await db.memoryTables.get(mem.id);
                                    if (!existing) await db.memoryTables.put(mem);
                                }
                            }
                        }
                    } else {
                        // 旧版备份格式（仅 store 数据），向后兼容
                        if (importMode === 'overwrite') {
                            store = d;
                        } else {
                            store.projects = [...store.projects, ...(d.projects || [])];
                            store.balance += d.balance || 0;
                        }
                    }

                    saveData();
                    alert('导入成功！页面将刷新...');
                    location.reload();
                } catch(err) {
                    console.error('导入错误:', err);
                    alert('导入失败: ' + err.message);
                } finally {
                    input.value = '';
                }
            };
            reader.readAsText(input.files[0]);
        }

        // --- 侧边栏功能 ---
        function toggleSidebar() {
            const sidebar = document.getElementById('sidebar');
            const isActive = sidebar.classList.contains('active');
            
            resetUI(); // 先清场

            if (!isActive) {
                document.getElementById('sidebar').classList.add('active');
                document.getElementById('sidebar-overlay').classList.add('active');
                document.body.classList.add('no-scroll');
            }
        }

        function closeSidebar() {
            resetUI();
        }

        function openSidebarPanel(panelId) {
            resetUI(); // 先清场

            // 延迟打开面板
            setTimeout(() => {
                const panel = document.getElementById('panel-' + panelId);
                if(panel) {
                    panel.classList.add('active');
                    document.body.classList.add('no-scroll');

                    // 根据不同面板加载相应内容
                    if (panelId === 'ai-assistant') {
                        renderAiChatHistory();
                    } else if (panelId === 'background-activity') {
                        loadBgActivitySettings();
                    } else if (panelId === 'cloud-backup') {
                        loadCloudBackupSettings();
                    }
                }
            }, 100);
        }

        function closeAllPanels() {
            document.querySelectorAll('.sidebar-panel').forEach(p => p.classList.remove('active'));
        }

        function closePanelBack() {
            closeAllPanels();
            // 重新打开侧边栏
            setTimeout(() => {
                toggleSidebar();
            }, 300);
        }

        // AI任务生成器
        function openAiTaskGenerator() {
            document.getElementById('modal-ai-task-generator').classList.add('active');
        }

