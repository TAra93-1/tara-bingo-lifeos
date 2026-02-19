        // ==================== 全局错误处理机制 ====================

        // 错误日志存储
        const errorLog = [];
        const MAX_ERROR_LOG = 50;

        // 错误级别
        const ErrorLevel = {
            INFO: 'info',
            WARNING: 'warning',
            ERROR: 'error',
            CRITICAL: 'critical'
        };

        // 统一错误处理函数
        function handleError(error, context = '', level = ErrorLevel.ERROR, showToUser = true) {
            const errorInfo = {
                timestamp: new Date().toISOString(),
                level: level,
                context: context,
                message: error.message || String(error),
                stack: error.stack || '',
            };

            // 记录到错误日志
            errorLog.push(errorInfo);
            if (errorLog.length > MAX_ERROR_LOG) {
                errorLog.shift(); // 保持日志数量在限制内
            }

            // 控制台输出
            console.error(`[${level.toUpperCase()}] ${context}:`, error);

            // 用户提示（根据级别和配置）
            if (showToUser) {
                let userMessage = '';
                switch(level) {
                    case ErrorLevel.CRITICAL:
                        userMessage = `严重错误: ${context}\n${error.message || '未知错误'}\n\n页面可能需要刷新。`;
                        alert(userMessage);
                        break;
                    case ErrorLevel.ERROR:
                        userMessage = `操作失败: ${context}\n${error.message || '请稍后重试'}`;
                        if (typeof showToast === 'function') {
                            showToast(userMessage);
                        } else {
                            alert(userMessage);
                        }
                        break;
                    case ErrorLevel.WARNING:
                        if (typeof showToast === 'function') {
                            showToast(`警告: ${context}`);
                        }
                        break;
                }
            }

            return errorInfo;
        }

        // 全局未捕获错误处理
        window.addEventListener('error', function(event) {
            handleError(event.error || new Error(event.message), '全局错误', ErrorLevel.ERROR, false);
        });

        // 全局未处理的 Promise 错误
        window.addEventListener('unhandledrejection', function(event) {
            handleError(event.reason || new Error('Promise rejection'), '未处理的Promise错误', ErrorLevel.ERROR, false);
        });

        // 导出错误日志（用于调试）
        function exportErrorLog() {
            const logText = errorLog.map(e =>
                `[${e.timestamp}] [${e.level}] ${e.context}: ${e.message}`
            ).join('\n');

            const blob = new Blob([logText], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `error-log-${Date.now()}.txt`;
            a.click();
            URL.revokeObjectURL(url);
        }

        // ==================== 核心配置 ====================

        const DB_KEY = 'tara_life_os_v5';

        // 初始化 Dexie IndexedDB
        const db = new Dexie('TaraLifeOSDatabase');

        db.version(1).stores({
            worldBooks: '&id, name, categoryId',
            worldBookCategories: '++id, name',
            characters: '&id, name'
        });

        // 图书馆数据库升级
        db.version(2).stores({
            worldBooks: '&id, name, categoryId',
            worldBookCategories: '++id, name',
            characters: '&id, name',
            // 图书馆相关表
            libraryBooks: '++id, title, categoryId, status, uploadDate, lastReadDate',
            libraryCategories: '++id, name, order',
            readingRooms: '++id, bookId, characterId, name, createdDate, lastActiveDate',
            readingProgress: '++id, bookId, lastPosition, percentage',
            bookmarks: '++id, bookId, position, note, createdDate',
            readingNotes: '++id, bookId, position, content, type, createdDate',
            memoryTables: '++id, bookId, type, data' // type: 'character' | 'item' | 'plot'
        });

        // 角色多窗口会话升级
        db.version(3).stores({
            worldBooks: '&id, name, categoryId',
            worldBookCategories: '++id, name',
            characters: '&id, name',
            libraryBooks: '++id, title, categoryId, status, uploadDate, lastReadDate',
            libraryCategories: '++id, name, order',
            readingRooms: '++id, bookId, characterId, name, createdDate, lastActiveDate',
            readingProgress: '++id, bookId, lastPosition, percentage',
            bookmarks: '++id, bookId, position, note, createdDate',
            readingNotes: '++id, bookId, position, content, type, createdDate',
            memoryTables: '++id, bookId, type, data',
            characterSessions: '&id, characterId, name, pinned, mountMode, mountSourceSessionId, createdAt, updatedAt, lastActiveAt'
        });

        // IndexedDB 操作包装函数（统一错误处理）
        const dbHelper = {
            async safeGet(table, key, context = '') {
                try {
                    return await db[table].get(key);
                } catch(error) {
                    handleError(error, `${context || table} 读取失败`, ErrorLevel.ERROR, true);
                    return null;
                }
            },

            async safePut(table, data, context = '') {
                try {
                    return await db[table].put(data);
                } catch(error) {
                    handleError(error, `${context || table} 保存失败`, ErrorLevel.ERROR, true);
                    throw error; // 重新抛出以便调用者处理
                }
            },

            async safeDelete(table, key, context = '') {
                try {
                    return await db[table].delete(key);
                } catch(error) {
                    handleError(error, `${context || table} 删除失败`, ErrorLevel.ERROR, true);
                    throw error;
                }
            },

            async safeToArray(table, context = '') {
                try {
                    return await db[table].toArray();
                } catch(error) {
                    handleError(error, `${context || table} 列表获取失败`, ErrorLevel.ERROR, true);
                    return [];
                }
            },

            async safeWhere(table, query, context = '') {
                try {
                    return await db[table].where(query).toArray();
                } catch(error) {
                    handleError(error, `${context || table} 查询失败`, ErrorLevel.ERROR, true);
                    return [];
                }
            }
        };

        // ==================== 语义嵌入服务 ====================

        const semanticEmbeddingService = {
            _pipeline: null,
            _loading: false,
            _loadPromise: null,
            _ready: false,
            _error: null,
            MODEL_NAME: 'Xenova/bge-small-zh-v1.5',

            async init() {
                if (this._ready) return true;
                if (this._loading) return this._loadPromise;

                this._loading = true;
                this._loadPromise = (async () => {
                    try {
                        showToast('正在加载语义模型 (~24MB)，首次需下载...');
                        console.log('[语义服务] 开始加载 Transformers.js...');

                        const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1');
                        env.allowLocalModels = false;

                        console.log('[语义服务] 加载模型:', this.MODEL_NAME);
                        this._pipeline = await pipeline('feature-extraction', this.MODEL_NAME, {
                            quantized: true
                        });

                        this._ready = true;
                        this._loading = false;
                        console.log('[语义服务] 模型加载完成');
                        showToast('语义模型已就绪');
                        return true;
                    } catch (e) {
                        this._loading = false;
                        this._error = e.message;
                        console.error('[语义服务] 模型加载失败:', e);
                        showToast('语义模型加载失败，语义触发暂不可用');
                        return false;
                    }
                })();

                return this._loadPromise;
            },

            async embed(text) {
                if (!this._ready) {
                    const ok = await this.init();
                    if (!ok) throw new Error('语义模型未就绪');
                }

                const output = await this._pipeline(text, { pooling: 'mean', normalize: true });
                return Array.from(output.data);
            },

            cosineSimilarity(a, b) {
                let dot = 0;
                for (let i = 0; i < a.length; i++) {
                    dot += a[i] * b[i];
                }
                return dot;
            },

            isReady() {
                return this._ready;
            }
        };

        function simpleHash(str) {
            let hash = 0;
            for (let i = 0; i < str.length; i++) {
                hash = ((hash << 5) - hash) + str.charCodeAt(i);
                hash |= 0;
            }
            return hash.toString(36);
        }

        // ==================== 离线模式管理 ====================

        // 网络状态管理
        const networkManager = {
            isOnline: navigator.onLine,
            listeners: new Set(),

            init() {
                // 监听网络状态变化
                window.addEventListener('online', () => {
                    this.setOnline(true);
                });

                window.addEventListener('offline', () => {
                    this.setOnline(false);
                });

                // 定期检查网络（因为某些情况下事件不可靠）
                setInterval(() => this.checkNetwork(), 30000); // 30秒检查一次

                console.log('[网络管理] 初始化完成，当前状态:', this.isOnline ? '在线' : '离线');
            },

            setOnline(status) {
                const wasOffline = !this.isOnline;
                this.isOnline = status;

                // 更新 UI
                this.updateUI();

                if (status) {
                    console.log('[网络管理] 网络已连接');
                    if (typeof showToast === 'function') {
                        showToast('网络已连接');
                    }

                    // 从离线恢复时，处理离线队列
                    if (wasOffline) {
                        offlineQueue.processQueue();
                    }
                } else {
                    console.log('[网络管理] 网络已断开');
                    if (typeof showToast === 'function') {
                        showToast('网络已断开，切换到离线模式');
                    }
                }

                // 通知所有监听器
                this.listeners.forEach(callback => callback(status));
            },

            checkNetwork() {
                // 只使用 navigator.onLine 判断网络状态
                // 不依赖外部服务验证，避免因墙导致误判
                const currentStatus = navigator.onLine;
                if (currentStatus !== this.isOnline) {
                    this.setOnline(currentStatus);
                }
            },

            updateUI() {
                // 更新状态栏的网络指示器
                const indicator = document.getElementById('network-indicator');
                if (indicator) {
                    indicator.textContent = this.isOnline ? '🟢' : '🔴';
                    indicator.title = this.isOnline ? '在线' : '离线';
                }

                // 更新 body 类名（可用于 CSS 样式）
                document.body.classList.toggle('offline-mode', !this.isOnline);
            },

            addListener(callback) {
                this.listeners.add(callback);
            },

            removeListener(callback) {
                this.listeners.delete(callback);
            }
        };

        // 离线队列管理
        const offlineQueue = {
            queue: [],
            STORAGE_KEY: 'tara_offline_queue',

            init() {
                // 从 localStorage 加载未处理的队列
                try {
                    const saved = localStorage.getItem(this.STORAGE_KEY);
                    if (saved) {
                        this.queue = JSON.parse(saved);
                        console.log(`[离线队列] 加载了 ${this.queue.length} 个待处理项`);
                    }
                } catch (error) {
                    handleError(error, '离线队列加载失败', ErrorLevel.WARNING, false);
                }
            },

            // 添加任务到队列
            add(task) {
                const queueItem = {
                    id: Date.now() + Math.random(),
                    task: task,
                    timestamp: Date.now(),
                    retryCount: 0,
                    maxRetries: 3
                };

                this.queue.push(queueItem);
                this.save();

                console.log('[离线队列] 新增任务:', task.type);
                return queueItem.id;
            },

            // 保存队列到 localStorage
            save() {
                try {
                    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.queue));
                } catch (error) {
                    handleError(error, '离线队列保存失败', ErrorLevel.WARNING, false);
                }
            },

            // 处理队列中的所有任务
            async processQueue() {
                if (!networkManager.isOnline || this.queue.length === 0) {
                    return;
                }

                console.log(`[离线队列] 开始处理 ${this.queue.length} 个任务`);
                if (typeof showToast === 'function') {
                    showToast(`正在同步 ${this.queue.length} 个离线操作...`);
                }

                const toProcess = [...this.queue];
                this.queue = [];
                this.save();

                let successCount = 0;
                let failCount = 0;

                for (const item of toProcess) {
                    try {
                        await this.executeTask(item.task);
                        successCount++;
                        console.log('[离线队列] 任务成功:', item.task.type);
                    } catch (error) {
                        console.error('[离线队列] 任务失败:', item.task.type, error);

                        // 重试逻辑
                        item.retryCount++;
                        if (item.retryCount < item.maxRetries) {
                            this.queue.push(item);
                            console.log(`[离线队列] 任务将重试 (${item.retryCount}/${item.maxRetries})`);
                        } else {
                            failCount++;
                            if (typeof handleError === 'function') {
                                handleError(error, `离线任务失败: ${item.task.type}`, ErrorLevel.WARNING, false);
                            }
                        }
                    }
                }

                this.save();

                if (successCount > 0 || failCount > 0) {
                    if (typeof showToast === 'function') {
                        showToast(`同步完成: ${successCount} 成功, ${failCount} 失败`);
                    }
                }
            },

            // 执行单个任务
            async executeTask(task) {
                switch (task.type) {
                    case 'api_call':
                        // 重新发送 API 调用
                        if (typeof callAI === 'function') {
                            // 临时绕过离线检查
                            const wasOnline = networkManager.isOnline;
                            networkManager.isOnline = true;
                            try {
                                const result = await callAI(task.data.message);
                                networkManager.isOnline = wasOnline;
                                return result;
                            } catch (error) {
                                networkManager.isOnline = wasOnline;
                                throw error;
                            }
                        }
                        break;

                    case 'character_message':
                        // 重新发送角色消息
                        if (task.data.characterId && typeof db !== 'undefined') {
                            const char = await db.characters.get(task.data.characterId);
                            if (char) {
                                // 这里可以添加重新发送逻辑
                            }
                        }
                        break;

                    default:
                        console.warn('[离线队列] 未知任务类型:', task.type);
                }
            },

            // 清空队列
            clear() {
                this.queue = [];
                this.save();
                console.log('[离线队列] 队列已清空');
            },

            // 获取队列状态
            getStatus() {
                return {
                    count: this.queue.length,
                    items: this.queue.map(item => ({
                        type: item.task.type,
                        timestamp: item.timestamp,
                        retryCount: item.retryCount
                    }))
                };
            }
        };

        let store = {
            balance: 0,
            theme: 'default',
            projects: [],
            dailyStats: {},
            logs: [],
            redemptions: [],
            weeklyBills: [],
            lastDailyCheck: '',
            lastWeeklyReset: '',
            shopItems: [
                {id:1, icon:'🛌', name:'离线一小时', cost:50, type:'unlimited'},
                {id:2, icon:'🍟', name:'外卖加个餐', cost:30, type:'unlimited'},
                {id:3, icon:'🎬', name:'看一集剧', cost:40, type:'unlimited'},
                {id:4, icon:'🚫', name:'免责推迟卡', cost:100, type:'cooldown', lastBuy:0}
            ],
            gachaPool: ['喝杯奶茶','早睡一小时','买个小玩具','发呆20分钟','听喜欢的歌','什么也不做','吃块巧克力'],
            apiConfig: {
                main: { url: '', key: '', model: 'gpt-4', temperature: 0.8 },
                sub: { url: '', key: '', model: 'gpt-3.5-turbo', temperature: 0.8 },
                search: { provider: 'google', googleApiKey: '', googleCx: '', serperApiKey: '', zhipuApiKey: '' }
            },
            aiChatHistory: [],
            aiConversations: [], // AI助手对话窗口列表 {id, name, history[], createdAt, updatedAt}
            currentAiConversationId: null, // 当前激活的对话窗口ID
            characterGroups: ['默认分组', '特别关心'], // 默认分组
            reportArchive: [], // AI 周报档案
            readingContextConfig: {
                paragraphsBefore: 3,   // 当前位置前取几个段落
                paragraphsAfter: 5,    // 当前位置后取几个段落
                maxChars: 3000         // 最大字符数上限
            }
        };
        
        let viewDate = new Date();
        let currentPid = null;
        let timerInt = null;
        let timerWakeLock = null;
        let timerWakeLockListenerBound = false;
        let tempTask = null;
        let charts = { line: null, pie: null };
        let isEditMode = false;
        let selectedFocusPids = new Set();
        let selectedDifficulty = 'normal';
        let pendingPoints = 0;
        let importMode = 'merge';
        let archiveFilter = 'all';
        let longPressTimer = null;
        let longPressTarget = null;
        let isSearchEnabled = false;
        let isAiSearchEnabled = false;
        let isLocalSearchEnabled = false;
        let isAiLocalSearchEnabled = false;
        let isAiMultiSelectMode = false;
        let selectedAiMessageIndices = new Set();
        let currentAiQuote = null;

        const DIFF_CONFIG = {
            'easy': { line: 5, board: 20 },
            'normal': { line: 10, board: 50 },
            'hard': { line: 20, board: 100 },
            'hell': { line: 50, board: 300 }
        };

        const VESPER_QUOTES = {
            empty: [
                "一片空白。就像宇宙大爆炸前的瞬间。开始吧。",
                "数据为零。你是在测试我的耐心，还是在享受虚无？",
                "没有输入。这很安全，但很无聊。"
            ],
            progress: [
                "动能检测已确认。继续。",
                "不错。熵增被暂时抑制了。",
                "这就是秩序的感觉。保持住。",
                "一个格子，一个锚点。你在夺回控制权。"
            ],
            almost: [
                "还差一点。强迫症患者会为此发疯的。",
                "只要再一步，多巴胺就会释放。",
                "收尾工作。别在这个时候停下。"
            ],
            complete: [
                "完美的闭环。数据极度舒适。",
                "执行完毕。你可以为此感到骄傲。",
                "效率峰值。休息一下，这是命令。",
                "混乱已被清除。做得好，塔拉。"
            ],
            hell: [
                "你在玩火。但我喜欢这种野心。",
                "死线模式？希望你的肾上腺素储备充足。",
                "既然选择了地狱难度，就别指望我手下留情。"
            ]
        };

        // --- 全局 UI 重置函数 ---
        function resetUI() {
            // 1. 关闭侧边栏
            document.getElementById('sidebar').classList.remove('active');
            document.getElementById('sidebar-overlay').classList.remove('active');

            // 2. 关闭聊天全屏界面
            document.getElementById('character-chat-screen').style.display = 'none';

            // 3. 关闭所有模态框和面板 (包括 sidebar-panel)
            document.querySelectorAll('.modal').forEach(el => el.classList.remove('active'));

            // 4. 关闭上下文菜单
            document.querySelectorAll('.context-menu').forEach(el => el.classList.remove('active'));

            // 4.1 关闭角色会话侧栏
            const sessionOverlay = document.getElementById('character-session-overlay');
            const sessionSidebar = document.getElementById('character-session-sidebar');
            if (sessionOverlay) sessionOverlay.classList.remove('active');
            if (sessionSidebar) sessionSidebar.classList.remove('active');
            const sessionMenu = document.getElementById('character-session-menu');
            if (sessionMenu) sessionMenu.classList.remove('active');
             
            // 5. 恢复页面滚动
            document.body.classList.remove('no-scroll');
        }

