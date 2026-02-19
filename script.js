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

        // ==================== 角色管理功能 ====================

        let currentEditingCharacter = null;
        let currentChatCharacter = null;
        let currentCharacterSession = null;
        let chatOpenedFromCharacterManager = false;
        const characterSessionExpandState = new Set();
        let currentCharacterSessionMenuSessionId = null;
        let characterSessionMenuBound = false;
        const avatarPlaceholderCache = new Map();
        const DEFAULT_CHARACTER_SESSION_NAME = '主窗口';

        function escapeSvgText(text) {
            return String(text || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function getAvatarPlaceholder(size = 70, label = '') {
            const safeSize = Math.max(32, Math.min(256, Number(size) || 70));
            const safeLabel = String(label || '').trim().slice(0, 8);
            const cacheKey = `${safeSize}|${safeLabel}`;
            if (avatarPlaceholderCache.has(cacheKey)) {
                return avatarPlaceholderCache.get(cacheKey);
            }

            const headY = Math.floor(safeSize * 0.4);
            const headR = Math.floor(safeSize * 0.18);
            const bodyX = Math.floor(safeSize * 0.27);
            const bodyY = Math.floor(safeSize * 0.62);
            const bodyW = Math.floor(safeSize * 0.46);
            const bodyH = Math.floor(safeSize * 0.24);
            const fontSize = Math.max(10, Math.floor(safeSize * 0.13));
            const textY = Math.floor(safeSize * 0.86);
            const textElement = safeLabel
                ? `<text x="${safeSize / 2}" y="${textY}" text-anchor="middle" fill="#6f77a3" font-size="${fontSize}" font-family="sans-serif">${escapeSvgText(safeLabel)}</text>`
                : '';

            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${safeSize}" height="${safeSize}" viewBox="0 0 ${safeSize} ${safeSize}"><desc>lifeos-avatar-placeholder</desc><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#eff1ff"/><stop offset="100%" stop-color="#d8deff"/></linearGradient></defs><rect width="${safeSize}" height="${safeSize}" rx="${Math.floor(safeSize / 2)}" fill="url(#g)"/><circle cx="${Math.floor(safeSize / 2)}" cy="${headY}" r="${headR}" fill="#949ec5"/><rect x="${bodyX}" y="${bodyY}" width="${bodyW}" height="${bodyH}" rx="${Math.floor(bodyH / 2)}" fill="#949ec5"/>${textElement}</svg>`;
            const dataUri = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
            avatarPlaceholderCache.set(cacheKey, dataUri);
            return dataUri;
        }

        function isDefaultAvatarPlaceholder(src) {
            return typeof src === 'string' && src.includes('lifeos-avatar-placeholder');
        }

        function generateCharacterSessionId() {
            return `cs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        }

        function isCharacterSessionModeEnabled(character) {
            return character?.settings?.sessionMigrationDecision === 'accepted';
        }

        function normalizeCharacterSession(session) {
            if (!session) return null;
            return {
                ...session,
                id: session.id || generateCharacterSessionId(),
                characterId: session.characterId || '',
                name: (session.name || DEFAULT_CHARACTER_SESSION_NAME).trim(),
                pinned: !!session.pinned,
                chatHistory: Array.isArray(session.chatHistory) ? session.chatHistory : [],
                longTermMemory: Array.isArray(session.longTermMemory) ? session.longTermMemory : [],
                mountMode: ['blank', 'copy', 'reference'].includes(session.mountMode) ? session.mountMode : 'blank',
                mountSourceSessionId: session.mountSourceSessionId || null,
                mountMemoryCount: Number.isFinite(Number(session.mountMemoryCount))
                    ? Math.max(1, Math.min(50, Number(session.mountMemoryCount)))
                    : 3,
                createdAt: Number(session.createdAt) || Date.now(),
                updatedAt: Number(session.updatedAt) || Date.now(),
                lastActiveAt: Number(session.lastActiveAt) || Number(session.updatedAt) || Date.now()
            };
        }

        function sortCharacterSessions(sessions) {
            return [...(sessions || [])].sort((a, b) => {
                const pinnedDiff = Number(!!b.pinned) - Number(!!a.pinned);
                if (pinnedDiff !== 0) return pinnedDiff;
                const activeDiff = (Number(b.lastActiveAt) || 0) - (Number(a.lastActiveAt) || 0);
                if (activeDiff !== 0) return activeDiff;
                return (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0);
            });
        }

        async function getCharacterSessions(characterId) {
            const raw = await db.characterSessions.where('characterId').equals(characterId).toArray();
            return sortCharacterSessions(raw.map(normalizeCharacterSession).filter(Boolean));
        }

        async function getCharacterSessionsMap() {
            const all = await db.characterSessions.toArray();
            const map = {};
            all.map(normalizeCharacterSession).forEach(session => {
                if (!session?.characterId) return;
                if (!map[session.characterId]) map[session.characterId] = [];
                map[session.characterId].push(session);
            });
            Object.keys(map).forEach(characterId => {
                map[characterId] = sortCharacterSessions(map[characterId]);
            });
            return map;
        }

        async function createCharacterSession(characterId, options = {}) {
            const now = Date.now();
            const mode = ['blank', 'copy', 'reference'].includes(options.mountMode) ? options.mountMode : 'blank';
            const hydrateCopyMemory = options.hydrateCopyMemory !== false;
            let longTermMemory = Array.isArray(options.longTermMemory) ? [...options.longTermMemory] : [];
            let mountSourceSessionId = options.mountSourceSessionId || null;
            const mountMemoryCount = Number.isFinite(Number(options.mountMemoryCount))
                ? Math.max(1, Math.min(50, Number(options.mountMemoryCount)))
                : 3;

            if (hydrateCopyMemory && mode === 'copy' && mountSourceSessionId) {
                const source = await db.characterSessions.get(mountSourceSessionId);
                if (source && source.characterId === characterId) {
                    const sourceMemory = Array.isArray(source.longTermMemory) ? source.longTermMemory : [];
                    longTermMemory = sourceMemory.slice(-mountMemoryCount);
                } else {
                    mountSourceSessionId = null;
                }
            }

            const session = normalizeCharacterSession({
                id: options.id || generateCharacterSessionId(),
                characterId,
                name: (options.name || DEFAULT_CHARACTER_SESSION_NAME).trim(),
                pinned: !!options.pinned,
                chatHistory: Array.isArray(options.chatHistory) ? [...options.chatHistory] : [],
                longTermMemory,
                mountMode: mode,
                mountSourceSessionId: mode === 'blank' ? null : mountSourceSessionId,
                mountMemoryCount,
                createdAt: now,
                updatedAt: now,
                lastActiveAt: now
            });

            await db.characterSessions.put(session);
            return session;
        }

        async function ensureCharacterPrimarySession(character, seedData = null) {
            const sessions = await getCharacterSessions(character.id);
            if (sessions.length > 0) return sessions[0];
            const seeded = seedData || {};
            return createCharacterSession(character.id, {
                name: DEFAULT_CHARACTER_SESSION_NAME,
                chatHistory: Array.isArray(seeded.chatHistory) ? seeded.chatHistory : [],
                longTermMemory: Array.isArray(seeded.longTermMemory) ? seeded.longTermMemory : [],
                mountMode: 'blank'
            });
        }

        async function maybeMigrateLegacyCharacter(characterId, askUser = true, forcePrompt = false) {
            let character = await db.characters.get(characterId);
            if (!character) return null;
            if (!character.settings) character.settings = {};

            const decision = character.settings.sessionMigrationDecision;
            const legacyChat = Array.isArray(character.chatHistory) ? character.chatHistory : [];
            const legacyMemory = Array.isArray(character.longTermMemory) ? character.longTermMemory : [];
            const hasLegacyData = legacyChat.length > 0 || legacyMemory.length > 0;

            if (decision === 'rejected') {
                if (!forcePrompt) return { character, mode: 'legacy', pending: false };
                const retryMigrate = !askUser || confirm(
                    `角色 "${character.name}" 当前处于旧模式。\n\n` +
                    `是否现在迁移为多窗口会话？\n` +
                    `确定：迁移到“${DEFAULT_CHARACTER_SESSION_NAME}”并启用窗口管理\n` +
                    `取消：继续保持旧模式`
                );
                if (!retryMigrate) return { character, mode: 'legacy', pending: false };
                character.settings.sessionMigrationDecision = '';
                await db.characters.put(character);
            }

            if (decision === 'accepted') {
                let existingSessions = await getCharacterSessions(character.id);
                let seededLegacyIntoPrimary = false;
                if (existingSessions.length === 0) {
                    const createdPrimary = await ensureCharacterPrimarySession(character, {
                        chatHistory: legacyChat,
                        longTermMemory: legacyMemory
                    });
                    existingSessions = createdPrimary ? [normalizeCharacterSession(createdPrimary)] : [];
                    seededLegacyIntoPrimary = hasLegacyData;
                }

                if (hasLegacyData) {
                    if (!seededLegacyIntoPrimary && existingSessions.length > 0) {
                        const primary = normalizeCharacterSession(existingSessions[0]);
                        if (primary) {
                            primary.chatHistory = [
                                ...(Array.isArray(primary.chatHistory) ? primary.chatHistory : []),
                                ...legacyChat
                            ];
                            primary.longTermMemory = [
                                ...(Array.isArray(primary.longTermMemory) ? primary.longTermMemory : []),
                                ...legacyMemory
                            ];
                            primary.updatedAt = Date.now();
                            primary.lastActiveAt = Math.max(primary.lastActiveAt || 0, primary.updatedAt);
                            await db.characterSessions.put(primary);
                        }
                    }

                    character.chatHistory = [];
                    character.longTermMemory = [];
                    character.settings.legacyMigratedAt = Number(character.settings.legacyMigratedAt) || Date.now();
                    await db.characters.put(character);
                    character = await db.characters.get(characterId);
                }
                return { character, mode: 'session', pending: false };
            }

            if (hasLegacyData && askUser) {
                const shouldMigrate = confirm(
                    `角色 "${character.name}" 检测到旧聊天数据。\n\n` +
                    `是否迁移为多窗口会话？\n` +
                    `确定：迁移到“${DEFAULT_CHARACTER_SESSION_NAME}”\n` +
                    `取消：保持旧模式（后续可再迁移）`
                );
                if (!shouldMigrate) {
                    character.settings.sessionMigrationDecision = 'rejected';
                    await db.characters.put(character);
                    return { character, mode: 'legacy', pending: false };
                }
            } else if (hasLegacyData && !askUser) {
                return { character, mode: 'legacy', pending: true };
            }

            character.settings.sessionMigrationDecision = 'accepted';
            await db.characters.put(character);
            await ensureCharacterPrimarySession(character, {
                chatHistory: legacyChat,
                longTermMemory: legacyMemory
            });
            if (hasLegacyData) {
                character.chatHistory = [];
                character.longTermMemory = [];
            }
            character.settings.legacyMigratedAt = Date.now();
            await db.characters.put(character);
            character = await db.characters.get(characterId);
            return { character, mode: 'session', pending: false };
        }

        async function getMountedReferenceMemories(session) {
            if (!session || session.mountMode !== 'reference' || !session.mountSourceSessionId) {
                return [];
            }
            const source = await db.characterSessions.get(session.mountSourceSessionId);
            if (!source || source.characterId !== session.characterId) return [];
            const count = Number.isFinite(Number(session.mountMemoryCount))
                ? Math.max(1, Math.min(50, Number(session.mountMemoryCount)))
                : 3;
            const sourceMemories = Array.isArray(source.longTermMemory) ? source.longTermMemory.slice(-count) : [];
            const sourceName = source.name || DEFAULT_CHARACTER_SESSION_NAME;
            return sourceMemories.map(mem => `[挂载来源:${sourceName}] ${mem}`);
        }

        async function collectCharacterSessionCascadeIds(rootSessionId) {
            const sessions = (await db.characterSessions.toArray()).map(normalizeCharacterSession).filter(Boolean);
            const bySource = {};
            sessions.forEach(session => {
                if (session.mountMode === 'reference' && session.mountSourceSessionId) {
                    if (!bySource[session.mountSourceSessionId]) bySource[session.mountSourceSessionId] = [];
                    bySource[session.mountSourceSessionId].push(session.id);
                }
            });
            const queue = [rootSessionId];
            const visited = new Set();
            while (queue.length > 0) {
                const current = queue.shift();
                if (visited.has(current)) continue;
                visited.add(current);
                const children = bySource[current] || [];
                children.forEach(childId => {
                    if (!visited.has(childId)) queue.push(childId);
                });
            }
            return [...visited];
        }

        function getLatestMessageTimestamp(history) {
            if (!Array.isArray(history) || history.length === 0) return 0;
            return Number(history[history.length - 1]?.timestamp) || 0;
        }

        async function resolveBackgroundSessionTarget(characterId) {
            const sessions = await getCharacterSessions(characterId);
            if (sessions.length === 0) return null;
            const pinned = sessions.find(session => session.pinned);
            return pinned || sessions[0];
        }

        // 打开角色导入弹窗
        function openCharacterImportModal() {
            document.getElementById('modal-character-import').classList.add('active');
        }

        // 打开创建角色弹窗
        function openCreateCharacterModal() {
            // 重置表单
            document.getElementById('create-char-title').textContent = '创建角色';
            document.getElementById('create-char-name').value = '';
            document.getElementById('create-char-description').value = '';
            document.getElementById('create-char-first-mes').value = '';
            document.getElementById('create-char-avatar-preview').src = getAvatarPlaceholder(100, '点击上传');

            // 清除编辑标记
            currentEditingCharacter = null;

            document.getElementById('modal-create-character').classList.add('active');
        }

        // 预览角色头像
        function previewCharacterAvatar(input) {
            const file = input.files[0];
            if(!file) return;

            const reader = new FileReader();
            reader.onload = function(e) {
                document.getElementById('create-char-avatar-preview').src = e.target.result;
            };
            reader.readAsDataURL(file);
        }

        // 保存新创建的角色
        async function saveNewCharacter() {
            const name = document.getElementById('create-char-name').value.trim();
            const description = document.getElementById('create-char-description').value.trim();
            const firstMes = document.getElementById('create-char-first-mes').value.trim();
            const avatarSrc = document.getElementById('create-char-avatar-preview').src;

            if(!name) {
                alert('请输入角色名称');
                return;
            }

            // 如果是编辑模式
            if(currentEditingCharacter) {
                currentEditingCharacter.name = name;
                currentEditingCharacter.description = description;
                currentEditingCharacter.first_mes = firstMes;
                if(avatarSrc && !isDefaultAvatarPlaceholder(avatarSrc)) {
                    currentEditingCharacter.avatar = avatarSrc;
                }

                await db.characters.put(currentEditingCharacter);
                alert('角色信息已更新!');
            } else {
                // 创建新角色
                const newCharacter = {
                    id: 'char_' + Date.now(),
                    name: name,
                    description: description,
                    personality: '',
                    scenario: '',
                    first_mes: firstMes,
                    mes_example: '',
                    avatar: isDefaultAvatarPlaceholder(avatarSrc) ? '' : avatarSrc,
                    createdAt: Date.now(),
                    settings: {
                        maxMemory: 20,
                        temperature: 0.8,
                        linkedWorldBookIds: []
                    },
                    chatHistory: []
                };

                await db.characters.put(newCharacter);
                alert('角色创建成功!');
            }

            closeModal('modal-create-character');
            await renderCharacterList();
        }

        // 更新角色头像（在详情页）
        function updateCharacterAvatar(input) {
            const file = input.files[0];
            if(!file) return;

            const reader = new FileReader();
            reader.onload = async function(e) {
                document.getElementById('character-detail-avatar').src = e.target.result;

                if(currentEditingCharacter) {
                    currentEditingCharacter.avatar = e.target.result;
                    await db.characters.put(currentEditingCharacter);
                }
            };
            reader.readAsDataURL(file);
        }

        // 预览/更新 User 头像
        function previewUserAvatar(input) {
            const file = input.files[0];
            if(!file) return;

            const reader = new FileReader();
            reader.onload = function(e) {
                document.getElementById('user-avatar-preview').src = e.target.result;
                store.userAvatar = e.target.result;
                saveData(); // 立即保存全局设置
            };
            reader.readAsDataURL(file);
        }

        // 切换角色编辑模式
        function toggleCharacterEdit() {
            // 弹出创建/编辑对话框进行编辑
            if(!currentEditingCharacter) return;

            document.getElementById('create-char-title').textContent = '编辑角色';
            document.getElementById('create-char-name').value = currentEditingCharacter.name;
            document.getElementById('create-char-description').value = currentEditingCharacter.description || '';
            document.getElementById('create-char-first-mes').value = currentEditingCharacter.first_mes || '';
            document.getElementById('create-char-avatar-preview').src = currentEditingCharacter.avatar || getAvatarPlaceholder(100);

            closeModal('modal-character-detail');
            document.getElementById('modal-create-character').classList.add('active');
        }

        // 处理角色文件上传
        async function handleCharacterFile(input) {
            const file = input.files[0];
            if(!file) return;

            closeModal('modal-character-import');

            const fileExt = file.name.split('.').pop().toLowerCase();

            try {
                let characterData = null;
                let avatarBase64 = null;

                if(fileExt === 'png') {
                    const result = await parseCharacterPNG(file);
                    characterData = result.data;
                    avatarBase64 = result.avatar;
                } else if(fileExt === 'json') {
                    characterData = await parseCharacterJSON(file);
                }

                if(!characterData) {
                    alert('解析失败: 无效的角色卡格式');
                    return;
                }

                // 创建角色对象
                await createCharacterFromData(characterData, avatarBase64);
                alert('Vesper: 角色导入成功!');
                await renderCharacterList();

            } catch(error) {
                alert('导入失败: ' + error.message);
                console.error(error);
            }

            // 清空文件输入
            input.value = '';
        }

        // 解析PNG格式角色卡 (SillyTavern格式) - 鲁棒性增强版
        async function parseCharacterPNG(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const arrayBuffer = e.target.result;
                    const dataView = new DataView(arrayBuffer);

                    if (dataView.getUint32(0) !== 0x89504E47 || dataView.getUint32(4) !== 0x0D0A1A0A) {
                        return reject(new Error('文件不是一个有效的PNG图片。'));
                    }

                    let offset = 8;
                    let characterJson = null;

                    while (offset < dataView.byteLength) {
                        const length = dataView.getUint32(offset);
                        const type = String.fromCharCode(
                            dataView.getUint8(offset + 4),
                            dataView.getUint8(offset + 5),
                            dataView.getUint8(offset + 6),
                            dataView.getUint8(offset + 7)
                        );

                        if (type === 'tEXt') {
                            const chunkData = new Uint8Array(arrayBuffer, offset + 8, length);
                            
                            // ★★★★★【修复乱码的核心代码】★★★★★
                            // 1. 先用一个简单的编码将字节转为字符串，以便查找关键字 "chara"
                            let text = '';
                            for (let i = 0; i < chunkData.length; i++) {
                                text += String.fromCharCode(chunkData[i]);
                            }

                            // 2. 检查关键字是否存在
                            const keyword = 'chara' + String.fromCharCode(0);
                            if (text.startsWith(keyword)) {
                                // 3. 提取出关键字后面的 Base64 编码的字符串
                                const base64Data = text.substring(keyword.length);
                                try {
                                    // 4. 使用 atob() 解码 Base64，得到一个“二进制字符串”
                                    const binaryString = atob(base64Data);
                                    
                                    // 5. 将这个“二进制字符串”重新转换为原始的 UTF-8 字节数组
                                    const bytes = new Uint8Array(binaryString.length);
                                    for (let i = 0; i < binaryString.length; i++) {
                                        bytes[i] = binaryString.charCodeAt(i);
                                    }
                                    
                                    // 6. 使用 TextDecoder 将这个纯净的 UTF-8 字节数组解码为正确的字符串
                                    const decodedJsonString = new TextDecoder('utf-8').decode(bytes);
                                    
                                    // 7. 解析最终的JSON字符串
                                    characterJson = JSON.parse(decodedJsonString);
                                    break;
                                } catch (e) {
                                    console.warn('解析图片内嵌的角色数据失败，可能是数据损坏。', e);
                                }
                            }
                            // ★★★★★【核心代码结束】★★★★★
                        }
                        
                        if (type === 'IEND') break;
                        offset += 12 + length;
                    }

                    if (characterJson) {
                        const imageReader = new FileReader();
                        imageReader.onload = (imgEvent) => {
                            resolve({
                                data: characterJson,
                                avatar: imgEvent.target.result
                            });
                        };
                        imageReader.onerror = () => reject(new Error('读取图片作为头像失败。'));
                        imageReader.readAsDataURL(file);
                    } else {
                        reject(new Error('在这张PNG图片中没有找到SillyTavern角色数据。'));
                    }
                };
                reader.onerror = () => reject(new Error('读取PNG文件失败。'));
                reader.readAsArrayBuffer(file);
            });
        }

        // 解析JSON格式角色卡
        async function parseCharacterJSON(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();

                reader.onload = function(e) {
                    try {
                        const buffer = e.target.result;
                        const jsonString = new TextDecoder('utf-8').decode(new Uint8Array(buffer));
                        const data = JSON.parse(jsonString);

                        // 兼容两种格式
                        const characterData = data.data || data;
                        resolve(characterData);
                    } catch(error) {
                        reject(new Error('JSON解析失败: ' + error.message));
                    }
                };

                reader.onerror = () => reject(new Error('文件读取失败'));
                reader.readAsArrayBuffer(file);
            });
        }

        // 从角色数据创建角色对象
        async function createCharacterFromData(characterData, avatarBase64) {
            const characterName = characterData.name || characterData.char_name || '未命名角色';

            // 尝试从角色数据中获取头像
            if(!avatarBase64 && characterData.avatar) {
                avatarBase64 = characterData.avatar.startsWith('data:')
                    ? characterData.avatar
                    : 'data:image/png;base64,' + characterData.avatar;
            }

            // 创建新角色对象
            const newCharacter = {
                id: 'char_' + Date.now(),
                name: characterName,
                description: characterData.description || '',
                personality: characterData.personality || '',
                scenario: characterData.scenario || '',
                first_mes: characterData.first_mes || '',
                mes_example: characterData.mes_example || '',
                avatar: avatarBase64 || '',
                createdAt: Date.now(),
                settings: {
                    maxMemory: 20,
                    temperature: 0.8,
                    linkedWorldBookIds: []
                },
                chatHistory: [],
                // --- [Vesper] 新增: 心声系统支持 ---
                latestInnerVoice: null,
                innerVoiceHistory: []
            };

            // 保存到IndexedDB
            await db.characters.put(newCharacter);

            // 处理角色自带的世界书
            if(characterData.character_book && characterData.character_book.entries) {
                await importCharacterWorldBook(characterData.character_book, characterName, newCharacter.id);
            } else if(characterData.world_entries && Array.isArray(characterData.world_entries)) {
                await importCharacterWorldBook({ entries: characterData.world_entries }, characterName, newCharacter.id);
            }
        }

        // 导入角色自带的世界书
        async function importCharacterWorldBook(characterBook, characterName, characterId) {
            const entries = characterBook.entries || [];
            if(entries.length === 0) return;

            // 创建新的世界书
            const worldBookName = characterBook.name || `${characterName}的世界书`;

            const newWorldBook = {
                id: 'wb_' + Date.now(),
                name: worldBookName,
                categoryId: null,
                description: `从角色 "${characterName}" 导入`,
                entries: entries.filter(entry => entry.enabled !== false).map(entry => ({
                    id: 'entry_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                    name: entry.comment || (entry.keys && entry.keys[0]) || '条目',
                    keys: entry.keys || [],
                    content: entry.content || '',
                    enabled: true
                })),
                createdAt: Date.now()
            };

            // 保存世界书
            await db.worldBooks.put(newWorldBook);

            // 自动关联到角色
            const character = await db.characters.get(characterId);
            if(character) {
                character.settings.linkedWorldBookIds.push(newWorldBook.id);
                await db.characters.put(character);
            }

            console.log(`已导入世界书: ${worldBookName}, 包含 ${newWorldBook.entries.length} 个条目`);
        }

        // 快速开始聊天
        async function quickStartChat(characterId) {
            const character = await db.characters.get(characterId);
            if (!character) {
                alert('角色不存在');
                return;
            }

            const migration = await maybeMigrateLegacyCharacter(characterId, true);
            if (!migration) return;

            if (migration.mode === 'session') {
                let sessions = await getCharacterSessions(characterId);
                if (sessions.length === 0) {
                    await ensureCharacterPrimarySession(migration.character || character);
                    sessions = await getCharacterSessions(characterId);
                }
                if (sessions.length > 0) {
                    await openCharacterSessionChat(characterId, sessions[0].id);
                }
                return;
            }

            currentEditingCharacter = migration.character || character;
            currentCharacterSession = null;
            await openCharacterChatLegacy(true);
        }

        function getCharacterPreviewText(character, sessions) {
            if (Array.isArray(sessions) && sessions.length > 0) {
                const topSession = sessions[0];
                const history = Array.isArray(topSession.chatHistory) ? topSession.chatHistory : [];
                if (history.length > 0) return history[history.length - 1]?.content || '暂无消息';
            }
            const legacyHistory = Array.isArray(character?.chatHistory) ? character.chatHistory : [];
            if (legacyHistory.length > 0) return legacyHistory[legacyHistory.length - 1]?.content || '暂无消息';
            return character?.first_mes || '暂无消息';
        }

        function getSessionPreviewText(session) {
            const history = Array.isArray(session?.chatHistory) ? session.chatHistory : [];
            if (history.length === 0) return '暂无消息';
            return history[history.length - 1]?.content || '暂无消息';
        }

        async function toggleCharacterSessionExpand(characterId) {
            if (characterSessionExpandState.has(characterId)) {
                characterSessionExpandState.delete(characterId);
            } else {
                characterSessionExpandState.add(characterId);
            }
            await renderCharacterList();
        }

        // 渲染角色列表（角色行 + 会话子列表）
        async function renderCharacterList() {
            const listDiv = document.getElementById('character-list');

            try {
                const [characters, sessionMap] = await Promise.all([
                    db.characters.toArray(),
                    getCharacterSessionsMap()
                ]);

                if (characters.length === 0) {
                    listDiv.innerHTML = '<div style="text-align:center; opacity:0.5; margin-top:50px;">暂无角色,点击右上角创建或导入</div>';
                    return;
                }

                listDiv.innerHTML = '';

                const groupedChars = {};
                const ungrouped = [];
                characters.forEach(char => {
                    const group = char.settings?.group || '';
                    if (!group) {
                        ungrouped.push(char);
                    } else {
                        if (!groupedChars[group]) groupedChars[group] = [];
                        groupedChars[group].push(char);
                    }
                });

                if (ungrouped.length > 0) {
                    renderGroupSection('未分组', ungrouped, listDiv, true, sessionMap);
                }

                Object.keys(groupedChars).sort().forEach(groupName => {
                    renderGroupSection(groupName, groupedChars[groupName], listDiv, true, sessionMap);
                });
            } catch (error) {
                console.error('渲染角色列表失败:', error);
                listDiv.innerHTML = '<div style="text-align:center; color:red;">加载失败</div>';
            }
        }

        // 渲染分组区块
        function renderGroupSection(groupName, characters, container, expanded = true, sessionMap = {}) {
            const groupId = 'group-' + groupName.replace(/[^a-zA-Z0-9]/g, '-');

            const groupDiv = document.createElement('div');
            groupDiv.className = 'char-group';
            groupDiv.style.cssText = 'margin-bottom:6px;';

            const groupHeader = document.createElement('div');
            groupHeader.style.cssText = 'background:var(--card-bg); padding:7px 12px; cursor:pointer; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(0,0,0,0.1); user-select:none;';
            groupHeader.innerHTML = `
                <div style="display:flex; align-items:center; gap:8px;">
                    <span id="${groupId}-arrow" style="transition:transform 0.2s; ${expanded ? 'transform:rotate(90deg);' : ''}">▶</span>
                    <span style="font-weight:bold; font-size:0.82rem;">${escapeHtml(groupName)}</span>
                    <span style="opacity:0.5; font-size:0.7rem;">(${characters.length})</span>
                </div>
            `;

            const groupContent = document.createElement('div');
            groupContent.id = groupId;
            groupContent.style.cssText = expanded ? '' : 'display:none;';

            characters.forEach(char => {
                const sessions = Array.isArray(sessionMap[char.id]) ? sessionMap[char.id] : [];
                const isExpanded = characterSessionExpandState.has(char.id);
                const inSessionMode = isCharacterSessionModeEnabled(char);
                const previewText = getCharacterPreviewText(char, sessions);

                const wrapper = document.createElement('div');
                wrapper.className = 'character-entry';
                wrapper.innerHTML = `
                    <div class="qq-chat-item character-entry-head">
                        <img src="${char.avatar || getAvatarPlaceholder(50)}" class="qq-chat-avatar">
                        <div class="qq-chat-info" style="min-width:0;">
                            <div class="qq-chat-name">${escapeHtml(char.settings?.nickname || char.name)}</div>
                            <div class="qq-chat-desc">${escapeHtml(String(previewText).substring(0, 38))}</div>
                        </div>
                        <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                            <span style="font-size:0.72rem; opacity:0.55;">${inSessionMode ? sessions.length : 1} 窗口</span>
                            <button class="btn-sec character-entry-arrow" style="width:auto; padding:4px 8px; margin:0;">${isExpanded ? '▾' : '▸'}</button>
                        </div>
                    </div>
                    <div class="character-session-sublist" style="${isExpanded ? '' : 'display:none;'}"></div>
                `;

                const head = wrapper.querySelector('.character-entry-head');
                const arrow = wrapper.querySelector('.character-entry-arrow');
                const sublist = wrapper.querySelector('.character-session-sublist');

                head.onclick = async () => {
                    await toggleCharacterSessionExpand(char.id);
                };
                arrow.onclick = async (event) => {
                    event.stopPropagation();
                    await toggleCharacterSessionExpand(char.id);
                };

                if (inSessionMode) {
                    if (sessions.length === 0) {
                        const emptyDiv = document.createElement('div');
                        emptyDiv.style.cssText = 'padding:10px 12px; opacity:0.6; font-size:0.78rem;';
                        emptyDiv.textContent = '暂无会话，点击下方创建。';
                        sublist.appendChild(emptyDiv);
                    }

                    sessions.forEach(session => {
                        const sessionItem = document.createElement('div');
                        sessionItem.className = 'character-session-item';
                        sessionItem.innerHTML = `
                            <div class="character-session-main">
                                <div class="character-session-name">${session.pinned ? '📌 ' : ''}${escapeHtml(session.name || DEFAULT_CHARACTER_SESSION_NAME)}</div>
                                <div class="character-session-desc">${escapeHtml(String(getSessionPreviewText(session)).substring(0, 42))}</div>
                            </div>
                            <button class="btn-sec character-session-action" style="width:auto; padding:2px 7px; margin:0;">⋯</button>
                        `;
                        sessionItem.onclick = async () => {
                            chatOpenedFromCharacterManager = true;
                            const panel = document.getElementById('panel-character-manager');
                            if (panel) panel.classList.remove('active');
                            await openCharacterSessionChat(char.id, session.id);
                        };
                        const actionBtn = sessionItem.querySelector('.character-session-action');
                        actionBtn.onclick = (event) => {
                            event.stopPropagation();
                            openCharacterSessionContextMenu(event, session.id);
                        };
                        sublist.appendChild(sessionItem);
                    });

                    const createBtn = document.createElement('button');
                    createBtn.className = 'btn-sec';
                    createBtn.style.cssText = 'width:calc(100% - 20px); margin:5px 10px 8px; padding:6px 8px; font-size:0.73rem;';
                    createBtn.textContent = '+ 新建窗口';
                    createBtn.onclick = async (event) => {
                        event.stopPropagation();
                        await createCharacterSessionDialog(char.id);
                    };
                    sublist.appendChild(createBtn);
                } else {
                    const legacyItem = document.createElement('div');
                    legacyItem.className = 'character-session-item';
                    legacyItem.innerHTML = `
                        <div class="character-session-main">
                            <div class="character-session-name">旧模式聊天</div>
                            <div class="character-session-desc">当前角色还未迁移到多窗口会话</div>
                        </div>
                        <button class="btn-sec" style="width:auto; padding:2px 7px; margin:0;">进入</button>
                    `;
                    legacyItem.onclick = async () => {
                        const fullCharacter = await db.characters.get(char.id);
                        if (!fullCharacter) return;
                        chatOpenedFromCharacterManager = true;
                        currentEditingCharacter = fullCharacter;
                        currentCharacterSession = null;
                        await openCharacterChatLegacy(true);
                    };
                    sublist.appendChild(legacyItem);

                    const migrateBtn = document.createElement('button');
                    migrateBtn.className = 'btn-sec';
                    migrateBtn.style.cssText = 'width:calc(100% - 26px); margin:8px 13px 12px; padding:8px 10px; font-size:0.75rem;';
                    migrateBtn.textContent = '迁移到多窗口';
                    migrateBtn.onclick = async (event) => {
                        event.stopPropagation();
                        const result = await maybeMigrateLegacyCharacter(char.id, true, true);
                        if (result?.mode === 'session') {
                            showToast('已启用多窗口会话');
                        }
                        await renderCharacterList();
                    };
                    sublist.appendChild(migrateBtn);
                }

                groupContent.appendChild(wrapper);
            });

            groupHeader.onclick = () => {
                const content = document.getElementById(groupId);
                const arrow = document.getElementById(groupId + '-arrow');
                if (content.style.display === 'none') {
                    content.style.display = '';
                    arrow.style.transform = 'rotate(90deg)';
                } else {
                    content.style.display = 'none';
                    arrow.style.transform = 'rotate(0deg)';
                }
            };

            groupDiv.appendChild(groupHeader);
            groupDiv.appendChild(groupContent);
            container.appendChild(groupDiv);
        }

        async function promptSessionMountConfig(characterId, excludeSessionId = null, defaults = {}) {
            const rawMode = (prompt(
                '记忆模式（blank / copy / reference）',
                defaults.mountMode || 'blank'
            ) || '').trim().toLowerCase();
            const mountMode = ['blank', 'copy', 'reference'].includes(rawMode) ? rawMode : 'blank';

            if (mountMode === 'blank') {
                return {
                    mountMode,
                    mountSourceSessionId: null,
                    mountMemoryCount: Number(defaults.mountMemoryCount) || 3
                };
            }

            const sessions = await getCharacterSessions(characterId);
            const candidates = sessions.filter(session => session.id !== excludeSessionId);
            if (candidates.length === 0) {
                alert('当前没有可用的来源窗口。');
                return null;
            }

            const optionsText = candidates
                .map((session, idx) => `${idx + 1}. ${session.pinned ? '📌 ' : ''}${session.name}`)
                .join('\n');
            const selectedIndex = Number(prompt(`选择来源窗口编号：\n${optionsText}`, '1'));
            if (!Number.isFinite(selectedIndex) || selectedIndex < 1 || selectedIndex > candidates.length) {
                alert('来源窗口选择无效。');
                return null;
            }
            const source = candidates[selectedIndex - 1];

            const rawCount = Number(prompt('挂载最近几条长期记忆？(1-50)', String(defaults.mountMemoryCount || 3)));
            const mountMemoryCount = Number.isFinite(rawCount) ? Math.max(1, Math.min(50, rawCount)) : 3;

            return {
                mountMode,
                mountSourceSessionId: source.id,
                mountMemoryCount
            };
        }

        async function createCharacterSessionDialog(characterId) {
            const character = await db.characters.get(characterId);
            if (!character) {
                alert('角色不存在');
                return;
            }

            const migration = await maybeMigrateLegacyCharacter(characterId, true, true);
            if (!migration || migration.mode !== 'session') return;

            const defaultName = `窗口_${new Date().toLocaleString('zh-CN', { hour12: false }).replace(/[\\/:\\s]/g, '_')}`;
            const name = (prompt('输入新窗口名称', defaultName) || '').trim();
            if (!name) return;

            const mountConfig = await promptSessionMountConfig(characterId, null, { mountMode: 'blank', mountMemoryCount: 3 });
            if (!mountConfig) return;

            const session = await createCharacterSession(characterId, {
                name,
                pinned: false,
                chatHistory: [],
                longTermMemory: [],
                mountMode: mountConfig.mountMode,
                mountSourceSessionId: mountConfig.mountSourceSessionId,
                mountMemoryCount: mountConfig.mountMemoryCount
            });

            showToast(`已创建窗口：${session.name}`);
            await renderCharacterList();
            await renderCharacterSessionSidebar();
            await openCharacterSessionChat(characterId, session.id);
        }

        async function renameCharacterSession(sessionId) {
            const session = normalizeCharacterSession(await db.characterSessions.get(sessionId));
            if (!session) return;
            const name = (prompt('输入新的窗口名称', session.name || DEFAULT_CHARACTER_SESSION_NAME) || '').trim();
            if (!name || name === session.name) return;
            session.name = name;
            session.updatedAt = Date.now();
            await db.characterSessions.put(session);

            if (currentCharacterSession && currentCharacterSession.id === session.id) {
                currentCharacterSession.name = name;
                if (currentEditingCharacter) {
                    document.getElementById('chat-character-name').textContent = `${currentEditingCharacter.name} · ${name}`;
                }
            }

            await renderCharacterList();
            await renderCharacterSessionSidebar();
        }

        async function toggleCharacterSessionPinned(sessionId) {
            const session = normalizeCharacterSession(await db.characterSessions.get(sessionId));
            if (!session) return;
            session.pinned = !session.pinned;
            session.updatedAt = Date.now();
            await db.characterSessions.put(session);
            await renderCharacterList();
            await renderCharacterSessionSidebar();
        }

        async function duplicateCharacterSession(sessionId) {
            const source = normalizeCharacterSession(await db.characterSessions.get(sessionId));
            if (!source) return;

            const cloned = await createCharacterSession(source.characterId, {
                name: `${source.name} 副本`,
                pinned: source.pinned,
                chatHistory: Array.isArray(source.chatHistory) ? [...source.chatHistory] : [],
                longTermMemory: Array.isArray(source.longTermMemory) ? [...source.longTermMemory] : [],
                mountMode: source.mountMode,
                mountSourceSessionId: source.mountSourceSessionId,
                mountMemoryCount: source.mountMemoryCount,
                hydrateCopyMemory: false
            });

            showToast(`已复制窗口：${cloned.name}`);
            await renderCharacterList();
            await renderCharacterSessionSidebar();
            await openCharacterSessionChat(source.characterId, cloned.id);
        }

        async function updateCharacterSessionMount(sessionId) {
            const session = normalizeCharacterSession(await db.characterSessions.get(sessionId));
            if (!session) return;

            const mountConfig = await promptSessionMountConfig(session.characterId, session.id, session);
            if (!mountConfig) return;

            session.mountMode = mountConfig.mountMode;
            session.mountSourceSessionId = mountConfig.mountSourceSessionId;
            session.mountMemoryCount = mountConfig.mountMemoryCount;
            session.updatedAt = Date.now();

            if (session.mountMode === 'copy' && session.mountSourceSessionId) {
                const source = normalizeCharacterSession(await db.characterSessions.get(session.mountSourceSessionId));
                if (source) {
                    session.longTermMemory = (source.longTermMemory || []).slice(-session.mountMemoryCount);
                    if (currentCharacterSession && currentCharacterSession.id === session.id && currentChatCharacter) {
                        currentChatCharacter.longTermMemory = session.longTermMemory;
                    }
                }
            }

            await db.characterSessions.put(session);
            if (currentCharacterSession && currentCharacterSession.id === session.id) {
                currentCharacterSession = session;
            }
            await renderCharacterList();
            await renderCharacterSessionSidebar();
            showToast('窗口挂载设置已更新');
        }

        async function deleteCharacterSessionWithCascade(sessionId) {
            const session = normalizeCharacterSession(await db.characterSessions.get(sessionId));
            if (!session) return;

            const cascadeIds = await collectCharacterSessionCascadeIds(sessionId);
            const dependentCount = Math.max(0, cascadeIds.length - 1);
            const confirmText = dependentCount > 0
                ? `删除窗口 "${session.name}" 会级联删除 ${dependentCount} 个依赖窗口。\n确定继续吗？`
                : `确定删除窗口 "${session.name}" 吗？`;
            if (!confirm(confirmText)) return;
            if (dependentCount > 0 && !confirm('这是不可恢复操作，是否二次确认删除？')) return;

            await db.transaction('rw', db.characterSessions, async () => {
                await db.characterSessions.bulkDelete(cascadeIds);
            });

            const removedCurrent = currentCharacterSession && cascadeIds.includes(currentCharacterSession.id);
            await renderCharacterList();
            await renderCharacterSessionSidebar();

            if (removedCurrent) {
                const remaining = await getCharacterSessions(session.characterId);
                if (remaining.length > 0) {
                    await openCharacterSessionChat(session.characterId, remaining[0].id);
                } else {
                    await closeCharacterChat();
                }
            }
        }

        function hideCharacterSessionContextMenu() {
            const menu = document.getElementById('character-session-menu');
            if (menu) menu.classList.remove('active');
            currentCharacterSessionMenuSessionId = null;
        }

        async function openCharacterSessionContextMenu(event, sessionId) {
            const menu = document.getElementById('character-session-menu');
            if (!menu) return;
            event.preventDefault();

            currentCharacterSessionMenuSessionId = sessionId;
            const session = normalizeCharacterSession(await db.characterSessions.get(sessionId));
            const pinEl = document.getElementById('character-session-menu-pin');
            if (pinEl) pinEl.textContent = session?.pinned ? '取消置顶' : '📌 置顶';

            // 先显示以获取尺寸
            menu.style.left = '-9999px';
            menu.style.top = '-9999px';
            menu.classList.add('active');

            const menuW = menu.offsetWidth;
            const menuH = menu.offsetHeight;
            const winW = window.innerWidth;
            const winH = window.innerHeight;
            let posX = event.clientX;
            let posY = event.clientY;
            if (posX + menuW > winW - 8) posX = winW - menuW - 8;
            if (posX < 8) posX = 8;
            if (posY + menuH > winH - 8) posY = winH - menuH - 8;
            if (posY < 8) posY = 8;

            menu.style.left = `${posX}px`;
            menu.style.top = `${posY}px`;

            if (!characterSessionMenuBound) {
                document.addEventListener('click', (e) => {
                    if (!e.target.closest('#character-session-menu')) {
                        hideCharacterSessionContextMenu();
                    }
                });
                characterSessionMenuBound = true;
            }
        }

        async function handleCharacterSessionMenuAction(action) {
            const sessionId = currentCharacterSessionMenuSessionId;
            hideCharacterSessionContextMenu();
            if (!sessionId) return;

            if (action === 'rename') {
                await renameCharacterSession(sessionId);
            } else if (action === 'pin') {
                await toggleCharacterSessionPinned(sessionId);
            } else if (action === 'copy') {
                await duplicateCharacterSession(sessionId);
            } else if (action === 'mount') {
                await updateCharacterSessionMount(sessionId);
            } else if (action === 'delete') {
                await deleteCharacterSessionWithCascade(sessionId);
            }
        }

        function closeCharacterSessionSidebar() {
            const overlay = document.getElementById('character-session-overlay');
            const sidebar = document.getElementById('character-session-sidebar');
            if (overlay) overlay.classList.remove('active');
            if (sidebar) sidebar.classList.remove('active');
        }

        async function openCharacterSessionSidebar() {
            if (!currentEditingCharacter || currentReadingRoom) return;
            const overlay = document.getElementById('character-session-overlay');
            const sidebar = document.getElementById('character-session-sidebar');
            if (overlay) overlay.classList.add('active');
            if (sidebar) sidebar.classList.add('active');
            await renderCharacterSessionSidebar();
        }

        async function renderCharacterSessionSidebar() {
            const listEl = document.getElementById('character-session-sidebar-list');
            const titleEl = document.getElementById('character-session-sidebar-title');
            const createBtn = document.getElementById('character-session-sidebar-create');
            if (!listEl || !titleEl || !createBtn) return;

            if (!currentEditingCharacter || currentReadingRoom) {
                titleEl.textContent = '会话';
                listEl.innerHTML = '<div style="padding:20px; text-align:center; opacity:0.6;">当前模式不可用</div>';
                createBtn.style.display = 'none';
                return;
            }

            titleEl.textContent = `${currentEditingCharacter.name} · 会话`;
            createBtn.style.display = 'block';
            createBtn.onclick = async () => {
                await createCharacterSessionDialog(currentEditingCharacter.id);
            };

            const sessions = await getCharacterSessions(currentEditingCharacter.id);
            if (sessions.length === 0) {
                listEl.innerHTML = '<div style="padding:20px; text-align:center; opacity:0.6;">暂无会话</div>';
                return;
            }

            listEl.innerHTML = '';
            sessions.forEach(session => {
                const item = document.createElement('div');
                item.className = 'character-session-sidebar-item';
                const active = currentCharacterSession && currentCharacterSession.id === session.id;
                if (active) item.classList.add('active');
                item.innerHTML = `
                    <div class="character-session-main">
                        <div class="character-session-name">${session.pinned ? '📌 ' : ''}${escapeHtml(session.name)}</div>
                        <div class="character-session-desc">${escapeHtml(String(getSessionPreviewText(session)).substring(0, 52))}</div>
                    </div>
                    <button class="btn-sec" style="width:auto; padding:2px 7px; margin:0;">⋯</button>
                `;
                item.onclick = async () => {
                    closeCharacterSessionSidebar();
                    await openCharacterSessionChat(currentEditingCharacter.id, session.id);
                };
                const menuBtn = item.querySelector('button');
                menuBtn.onclick = (event) => {
                    event.stopPropagation();
                    openCharacterSessionContextMenu(event, session.id);
                };
                listEl.appendChild(item);
            });
        }
        
        function formatBingoProjectForAI(project) {
            const total = project.tasks.length;
            const done = project.tasks.filter(t => t.completed).length;
            let gridText = "";
            project.tasks.forEach((t, i) => {
                gridText += `- [${t.completed ? 'x' : ' '}] ${t.text}\n`;
            });

            let result = `
【关联待办/Bingo卡: ${project.theme}】
进度: ${done}/${total}
任务列表:
${gridText}`;

            // 添加随笔内容（所有状态的卡都可能有）
            if (project.journal && project.journal.trim()) {
                result += `\n> 📝 用户随笔:\n> ${project.journal.trim()}\n`;
            }

            // 添加总结内容（仅归档卡有）
            if (project.status === 'archived' && project.summary && project.summary.trim()) {
                result += `\n> 📋 归档总结:\n> ${project.summary.trim()}\n`;
            }

            return result;
        }
        // --- [Vesper] 新增聊天记录管理功能 ---
        let lastSearchKeyword = '';
        let lastSearchCharacterId = null;
        let lastSearchSessionId = null;

        function searchChatHistory() {
            if (!currentEditingCharacter) return;

            const searchInput = document.getElementById('chat-search-input');
            const keyword = searchInput.value.trim();

            if (!keyword) {
                alert('请输入搜索关键词');
                return;
            }

            lastSearchKeyword = keyword;
            lastSearchCharacterId = currentEditingCharacter.id;
            lastSearchSessionId = currentCharacterSession ? currentCharacterSession.id : null;

            const chatHistory = (currentChatCharacter && Array.isArray(currentChatCharacter.chatHistory))
                ? currentChatCharacter.chatHistory
                : (currentEditingCharacter.chatHistory || []);
            const results = [];

            chatHistory.forEach((msg, index) => {
                if (msg.content && msg.content.toLowerCase().includes(keyword.toLowerCase())) {
                    results.push({
                        index: index,
                        role: msg.role,
                        content: msg.content,
                        timestamp: msg.timestamp
                    });
                }
            });

            if (results.length === 0) {
                alert(`未找到包含"${keyword}"的聊天记录`);
                return;
            }

            // 显示搜索结果面板
            showSearchResults(results, keyword, currentChatCharacter?.name || currentEditingCharacter.name);
        }

        function showSearchResults(results, keyword, characterName) {
            const panel = document.getElementById('search-results-panel');
            const countEl = document.getElementById('search-results-count');
            const listEl = document.getElementById('search-results-list');

            countEl.textContent = `(${results.length}条)`;

            // 高亮关键词的函数
            function highlightKeyword(text, kw) {
                const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(`(${escaped})`, 'gi');
                return text.replace(regex, '<span class="search-result-keyword">$1</span>');
            }

            // 构建结果列表
            listEl.innerHTML = results.map(result => {
                const role = result.role === 'user' ? '你' : characterName;
                const preview = result.content.substring(0, 100) + (result.content.length > 100 ? '...' : '');
                const time = new Date(result.timestamp).toLocaleString();
                const highlightedPreview = highlightKeyword(escapeHtml(preview), keyword);

                return `
                    <div class="search-result-item" onclick="jumpToSearchResult(${result.index})">
                        <div class="search-result-role">${role}</div>
                        <div class="search-result-preview">${highlightedPreview}</div>
                        <div class="search-result-time">${time}</div>
                    </div>
                `;
            }).join('');

            panel.classList.add('active');
        }

        function closeSearchResults(event) {
            if (event && event.target !== event.currentTarget) return;
            document.getElementById('search-results-panel').classList.remove('active');
        }

        async function jumpToSearchResult(msgIndex) {
            // 关闭搜索面板
            closeSearchResults();

            // 确保加载正确的角色
            if (lastSearchCharacterId) {
                const character = await db.characters.get(lastSearchCharacterId);
                if (character) {
                    currentEditingCharacter = character;

                    if (lastSearchSessionId) {
                        await openCharacterSessionChat(lastSearchCharacterId, lastSearchSessionId, false);
                    } else if (isCharacterSessionModeEnabled(character)) {
                        let sessions = await getCharacterSessions(lastSearchCharacterId);
                        if (sessions.length === 0) {
                            const primary = await ensureCharacterPrimarySession(character);
                            sessions = primary ? [normalizeCharacterSession(primary)] : [];
                        }
                        if (sessions.length > 0) {
                            await openCharacterSessionChat(lastSearchCharacterId, sessions[0].id, false);
                        } else {
                            currentChatCharacter = character;
                            await openCharacterChatLegacy(false);
                        }
                    } else {
                        await openCharacterChatLegacy(false);
                    }
                }
            }

            // 关闭角色设置弹窗
            const modal = document.getElementById('modal-character-detail');
            if (modal) modal.classList.remove('active');

            // 打开聊天界面
            if (currentChatCharacter) {
                // 展开历史（确保能找到消息）
                isHistoryCollapsed = false;

                // 渲染聊天历史
                renderCharacterChatHistory();

                // 等待渲染完成后滚动到目标消息
                setTimeout(() => {
                    scrollToMessageDirect(msgIndex);
                }, 400);
            }
        }

        // 直接滚动到消息（不检查折叠状态）
        function scrollToMessageDirect(msgIndex) {
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
            } else {
                console.log('未找到消息索引:', msgIndex);
            }
        }

        function exportChatHistory() {
            if (!currentEditingCharacter) return;

            const isReadingRoom = !!currentReadingRoom;
            const isSessionMode = !!currentCharacterSession && !isReadingRoom;

            let chatHistory = [];
            let longTermMemory = [];
            let sourceName = currentEditingCharacter.name;
            const chatData = {
                characterName: currentEditingCharacter.name,
                characterId: currentEditingCharacter.id,
                exportDate: new Date().toISOString()
            };

            if (isReadingRoom) {
                chatHistory = currentReadingRoom.chatHistory || [];
                longTermMemory = Array.isArray(currentReadingRoom.longTermMemory) ? currentReadingRoom.longTermMemory : [];
                sourceName = `${currentEditingCharacter.name}_${currentReadingRoom.name}`;
                chatData.readingRoom = {
                    id: currentReadingRoom.id,
                    name: currentReadingRoom.name,
                    bookId: currentReadingRoom.bookId
                };
            } else if (isSessionMode) {
                chatHistory = currentCharacterSession.chatHistory || [];
                longTermMemory = currentCharacterSession.longTermMemory || [];
                sourceName = `${currentEditingCharacter.name}_${currentCharacterSession.name || DEFAULT_CHARACTER_SESSION_NAME}`;
                chatData.session = {
                    id: currentCharacterSession.id,
                    name: currentCharacterSession.name || DEFAULT_CHARACTER_SESSION_NAME,
                    mountMode: currentCharacterSession.mountMode || 'blank',
                    mountSourceSessionId: currentCharacterSession.mountSourceSessionId || null,
                    mountMemoryCount: Number(currentCharacterSession.mountMemoryCount) || 3
                };
            } else {
                chatHistory = currentEditingCharacter.chatHistory || [];
                longTermMemory = currentEditingCharacter.longTermMemory || [];
            }

            chatData.chatHistory = chatHistory;
            chatData.longTermMemory = longTermMemory;

            const dataStr = JSON.stringify(chatData, null, 2);
            const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
            const exportFileDefaultName = `chat_${sourceName}_${Date.now()}.json`;

            const linkElement = document.createElement('a');
            linkElement.setAttribute('href', dataUri);
            linkElement.setAttribute('download', exportFileDefaultName);
            linkElement.click();

            const sourceLabel = isReadingRoom
                ? `阅读室 "${currentReadingRoom.name}"`
                : isSessionMode
                    ? `窗口 "${currentCharacterSession.name || DEFAULT_CHARACTER_SESSION_NAME}"`
                    : `角色 "${currentEditingCharacter.name}"`;
            alert(`${sourceLabel} 聊天记录已导出\n包含 ${chatData.chatHistory.length} 条对话`);
        }

        // 聊天记录去重追加：基于 timestamp+role 去重
        function mergeChat(existing, incoming) {
            const seen = new Set();
            existing.forEach(m => { if (m.timestamp) seen.add(`${m.timestamp}|${m.role}`); });
            const newMsgs = incoming.filter(m => !m.timestamp || !seen.has(`${m.timestamp}|${m.role}`));
            return [...existing, ...newMsgs];
        }
        // 长期记忆去重追加：基于完整字符串去重
        function mergeMemory(existing, incoming) {
            const seen = new Set(existing);
            const newEntries = incoming.filter(m => !seen.has(m));
            return [...existing, ...newEntries];
        }

        function importChatHistory() {
            if (!currentEditingCharacter) return;

            const isReadingRoom = !!currentReadingRoom;
            const isSessionMode = !!currentCharacterSession && !isReadingRoom;

            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';

            input.onchange = async (e) => {
                const file = e.target.files[0];
                if (!file) return;

                const reader = new FileReader();
                reader.onload = async (event) => {
                    try {
                        const importedData = JSON.parse(event.target.result);
                        if (!importedData.chatHistory || !Array.isArray(importedData.chatHistory)) {
                            alert('导入失败：文件格式不正确');
                            return;
                        }

                        const importCount = importedData.chatHistory.length;
                        const currentHistory = isReadingRoom
                            ? (currentReadingRoom.chatHistory || [])
                            : isSessionMode
                                ? (currentCharacterSession.chatHistory || [])
                                : (currentEditingCharacter.chatHistory || []);
                        const currentCount = currentHistory.length;
                        const targetLabel = isReadingRoom
                            ? `阅读室 "${currentReadingRoom.name}"`
                            : isSessionMode
                                ? `窗口 "${currentCharacterSession.name || DEFAULT_CHARACTER_SESSION_NAME}"`
                                : `角色 "${currentEditingCharacter.name}"`;

                        const overwrite = confirm(
                            `导入到 ${targetLabel}\n\n` +
                            `当前聊天记录：${currentCount} 条\n` +
                            `导入文件包含：${importCount} 条\n\n` +
                            `点击“确定”：覆盖当前记录\n` +
                            `点击“取消”：追加到现有记录`
                        );

                        if (isReadingRoom) {
                            if (overwrite) {
                                currentReadingRoom.chatHistory = [...importedData.chatHistory];
                            } else {
                                if (!currentReadingRoom.chatHistory) currentReadingRoom.chatHistory = [];
                                currentReadingRoom.chatHistory = mergeChat(currentReadingRoom.chatHistory, importedData.chatHistory);
                            }

                            if (Array.isArray(importedData.longTermMemory) && importedData.longTermMemory.length > 0) {
                                if (overwrite) {
                                    currentChatCharacter.longTermMemory = [...importedData.longTermMemory];
                                } else {
                                    if (!Array.isArray(currentChatCharacter.longTermMemory)) currentChatCharacter.longTermMemory = [];
                                    currentChatCharacter.longTermMemory = mergeMemory(currentChatCharacter.longTermMemory, importedData.longTermMemory);
                                }
                                await persistCurrentLongTermMemory();
                            }

                            currentChatCharacter.chatHistory = currentReadingRoom.chatHistory;
                            await saveCurrentChatState();
                        } else if (isSessionMode) {
                            if (overwrite) {
                                currentChatCharacter.chatHistory = [...importedData.chatHistory];
                                currentCharacterSession.chatHistory = currentChatCharacter.chatHistory;

                                if (Array.isArray(importedData.longTermMemory)) {
                                    currentChatCharacter.longTermMemory = [...importedData.longTermMemory];
                                    currentCharacterSession.longTermMemory = currentChatCharacter.longTermMemory;
                                }

                                if (importedData.session && typeof importedData.session === 'object') {
                                    const importedMode = importedData.session.mountMode;
                                    currentCharacterSession.mountMode = ['blank', 'copy', 'reference'].includes(importedMode) ? importedMode : (currentCharacterSession.mountMode || 'blank');
                                    currentCharacterSession.mountSourceSessionId = importedData.session.mountSourceSessionId || null;
                                    currentCharacterSession.mountMemoryCount = Number.isFinite(Number(importedData.session.mountMemoryCount))
                                        ? Math.max(1, Math.min(50, Number(importedData.session.mountMemoryCount)))
                                        : (currentCharacterSession.mountMemoryCount || 3);
                                }
                            } else {
                                if (!Array.isArray(currentChatCharacter.chatHistory)) currentChatCharacter.chatHistory = [];
                                currentChatCharacter.chatHistory = mergeChat(currentChatCharacter.chatHistory, importedData.chatHistory);
                                currentCharacterSession.chatHistory = currentChatCharacter.chatHistory;

                                if (importedData.longTermMemory && importedData.longTermMemory.length > 0) {
                                    if (!Array.isArray(currentChatCharacter.longTermMemory)) currentChatCharacter.longTermMemory = [];
                                    currentChatCharacter.longTermMemory = mergeMemory(currentChatCharacter.longTermMemory, importedData.longTermMemory);
                                    currentCharacterSession.longTermMemory = currentChatCharacter.longTermMemory;
                                }
                            }

                            await saveCurrentChatState();
                            await renderCharacterList();
                            await renderCharacterSessionSidebar();
                        } else {
                            if (overwrite) {
                                currentEditingCharacter.chatHistory = [...importedData.chatHistory];
                                if (Array.isArray(importedData.longTermMemory)) {
                                    currentEditingCharacter.longTermMemory = [...importedData.longTermMemory];
                                }
                            } else {
                                if (!Array.isArray(currentEditingCharacter.chatHistory)) currentEditingCharacter.chatHistory = [];
                                currentEditingCharacter.chatHistory = mergeChat(currentEditingCharacter.chatHistory, importedData.chatHistory);
                                if (Array.isArray(importedData.longTermMemory) && importedData.longTermMemory.length > 0) {
                                    if (!Array.isArray(currentEditingCharacter.longTermMemory)) currentEditingCharacter.longTermMemory = [];
                                    currentEditingCharacter.longTermMemory = mergeMemory(currentEditingCharacter.longTermMemory, importedData.longTermMemory);
                                }
                            }
                            currentChatCharacter = currentEditingCharacter;
                            await saveCurrentChatState();
                        }

                        renderCharacterChatHistory();
                        const newCount = Array.isArray(currentChatCharacter?.chatHistory) ? currentChatCharacter.chatHistory.length : 0;
                        updateChatMessageCounter(newCount);
                        alert(`${targetLabel} 导入成功\n当前共有 ${newCount} 条聊天记录`);
                    } catch (error) {
                        console.error('导入失败:', error);
                        alert('导入失败: ' + error.message);
                    }
                };
                reader.readAsText(file);
            };

            input.click();
        }

        async function clearChatHistory() {
            if (!currentEditingCharacter) return;

            const targetLabel = currentReadingRoom
                ? `阅读室 "${currentReadingRoom.name}"`
                : currentCharacterSession
                    ? `窗口 "${currentCharacterSession.name || DEFAULT_CHARACTER_SESSION_NAME}"`
                    : `角色 "${currentEditingCharacter.name}"`;

            if (!confirm(`确定清空 ${targetLabel} 的所有聊天记录吗？`)) return;

            if (currentReadingRoom) {
                currentReadingRoom.chatHistory = [];
                if (currentChatCharacter) currentChatCharacter.chatHistory = [];
                await saveCurrentChatState();
            } else if (currentCharacterSession) {
                currentCharacterSession.chatHistory = [];
                if (currentChatCharacter) currentChatCharacter.chatHistory = [];
                await saveCurrentChatState();
                await renderCharacterList();
                await renderCharacterSessionSidebar();
            } else {
                currentEditingCharacter.chatHistory = [];
                currentChatCharacter = currentEditingCharacter;
                await saveCurrentChatState();
            }

            renderCharacterChatHistory();
            updateChatMessageCounter(0);
            alert(`${targetLabel} 聊天记录已清空`);
        }
        function populateBingoCardsDropdown() {
            const select = document.getElementById('character-detail-bingo-link');
            select.innerHTML = '<option value="">不关联</option>';
            store.projects.filter(p => p.status === 'active').forEach(p => {
                const option = document.createElement('option');
                option.value = p.id;
                option.textContent = p.theme;
                select.appendChild(option);
            });
        }

        // 打开角色详情
        async function openCharacterDetail(characterId) {
            const character = await db.characters.get(characterId);
            if(!character) {
                alert('角色不存在');
                return;
            }

            currentEditingCharacter = character;
            if (!character.settings) character.settings = {}; // Ensure settings object exists

            // --- Populate the new form ---
            
            // Identity
            document.getElementById('character-detail-avatar').src = character.avatar || getAvatarPlaceholder(70);
            document.getElementById('user-avatar-preview').src = store.userAvatar || getAvatarPlaceholder(70);
            document.getElementById('character-detail-nickname').value = character.settings.nickname || '';
            document.getElementById('character-detail-name-input').value = character.name || '';

            // 加载分组下拉选项
            loadGroupOptions();
            document.getElementById('character-detail-group').value = character.settings.group || '';

            // Persona
            document.getElementById('character-detail-description').value = character.description || '';
            document.getElementById('character-detail-user-persona').value = store.userPersona || '';
            document.getElementById('character-detail-first-mes').value = character.first_mes || '';

            // AI Core
            await renderLinkedWorldBooks(character);
            await renderLinkedBingoCards(character); // Replaced populateBingoCardsDropdown
            document.getElementById('character-detail-bg-activity').checked = character.settings.bgActivity || false;
            // bgCooldown现在以分钟为单位，如果是旧数据（小于60），转换为分钟
            const cooldown = character.settings.bgCooldown || 2;
            document.getElementById('character-detail-bg-cooldown').value = cooldown < 60 ? cooldown * 60 : cooldown;
            document.getElementById('character-max-memory').value = character.settings.maxMemory || 20;
            document.getElementById('character-worldbook-scan-depth').value = character.settings.worldBookScanDepth || 10;
            const semThreshold = character.settings.semanticThreshold || 0.55;
            document.getElementById('character-semantic-threshold').value = semThreshold;
            document.getElementById('semantic-threshold-value').textContent = semThreshold;
            document.getElementById('character-detail-pinned-memory').value = character.settings.pinnedMemory || 0;
            document.getElementById('character-detail-auto-summary').checked = character.settings.autoSummary || false;
            document.getElementById('character-detail-summary-interval').value = character.settings.summaryInterval || 10;
            document.getElementById('character-detail-time-awareness').checked = character.settings.timeAwareness === false ? false : true;
            document.getElementById('character-detail-msg-mode').value = character.settings.msgMode || 'split';

            // Appearance
            document.getElementById('character-detail-bg-follow').checked = character.settings.bgFollow === false ? false : true;
            document.getElementById('character-detail-show-avatar').checked = character.settings.showAvatar === false ? false : true;
            document.getElementById('character-detail-bubble-size').value = character.settings.bubbleSize || 14;
            document.getElementById('bubble-size-value').textContent = (character.settings.bubbleSize || 14) + 'px';
            document.getElementById('character-detail-bubble-css-user').value = character.settings.bubbleCssUser || character.settings.bubbleCss || '';
            document.getElementById('character-detail-bubble-css-ai').value = character.settings.bubbleCssAi || character.settings.bubbleCss || '';

            // 加载样式预设列表
            loadBubblePresetList();

            // 更新预览
            updateBubblePreview();

            // 设置实时预览监听器
            setupBubblePreviewListeners();

            // Records
            const messageCount = character.chatHistory ? character.chatHistory.length : 0;
            const maxMemory = character.settings.maxMemory || 20;
            const pinnedMemory = character.settings.pinnedMemory || 0;

            document.getElementById('chat-message-count').textContent = messageCount;
            document.getElementById('context-limit-display').textContent = maxMemory;
            document.getElementById('pinned-memory-display').textContent = pinnedMemory;

            // Token估算：系统提示词~500 + 上下文条数×100 + 长期记忆×50
            const estimatedTokens = 500 + (Math.min(messageCount, maxMemory) * 100) + (pinnedMemory * 50);
            document.getElementById('chat-token-estimate').textContent = '~' + estimatedTokens;

            document.getElementById('modal-character-detail').classList.add('active');
        }

        // 渲染已关联的世界书标签
        async function renderLinkedWorldBooks(character) {
            const container = document.getElementById('character-linked-worldbooks');
            container.innerHTML = '';

            if(!character.settings.linkedWorldBookIds || character.settings.linkedWorldBookIds.length === 0) {
                container.innerHTML = '<div style="opacity:0.5; font-size:0.8rem; padding:5px;">暂无关联的世界书</div>';
                return;
            }

            for(const wbId of character.settings.linkedWorldBookIds) {
                const wb = await db.worldBooks.get(wbId);
                if(wb) {
                    const tag = document.createElement('div');
                    tag.style.cssText = 'background:var(--accent); color:var(--bg); padding:5px 12px; border-radius:15px; font-size:0.75rem; display:flex; align-items:center; gap:5px; margin-bottom:5px; margin-right:5px;';
                    tag.innerHTML = `
                        ${wb.name}
                        <span style="cursor:pointer; font-weight:bold;" onclick="removeWorldBookFromCharacter('${wbId}', event)">×</span>
                    `;
                    container.appendChild(tag);
                }
            }
        }

        // 从角色移除世界书
        async function removeWorldBookFromCharacter(wbId, event) {
            event.stopPropagation();
            if(!currentEditingCharacter) return;
            const index = currentEditingCharacter.settings.linkedWorldBookIds.indexOf(wbId);
            if(index > -1) {
                currentEditingCharacter.settings.linkedWorldBookIds.splice(index, 1);
                // 仅更新内存中的对象，点击保存时才写入数据库
                await renderLinkedWorldBooks(currentEditingCharacter);
            }
        }

        // 渲染已关联的Bingo卡标签
        async function renderLinkedBingoCards(character) {
            const container = document.getElementById('character-linked-bingo-cards');
            container.innerHTML = '';

            if(!character.settings.bingoLinkIds || character.settings.bingoLinkIds.length === 0) {
                container.innerHTML = '<div style="opacity:0.5; font-size:0.8rem; padding:5px;">暂无关联的 Bingo 卡</div>';
                return;
            }

            for(const pId of character.settings.bingoLinkIds) {
                const project = store.projects.find(p => p.id === pId);
                if(project) {
                    const tag = document.createElement('div');
                    tag.style.cssText = 'background:var(--accent); color:var(--bg); padding:5px 12px; border-radius:15px; font-size:0.75rem; display:flex; align-items:center; gap:5px; margin-bottom:5px; margin-right:5px;';
                    tag.innerHTML = `
                        ${project.theme}
                        <span style="cursor:pointer; font-weight:bold;" onclick="removeBingoCardFromCharacter('${pId}', event)">×</span>
                    `;
                    container.appendChild(tag);
                }
            }
        }

        // 从角色移除Bingo卡
        async function removeBingoCardFromCharacter(pId, event) {
            event.stopPropagation();
            if(!currentEditingCharacter) return;
            const projectId = parseInt(pId);
            const index = currentEditingCharacter.settings.bingoLinkIds.indexOf(projectId);
            if(index > -1) {
                currentEditingCharacter.settings.bingoLinkIds.splice(index, 1);
                await renderLinkedBingoCards(currentEditingCharacter);
            }
        }

        // 选择Bingo卡
        async function selectBingoCardsForCharacter() {
            const listDiv = document.getElementById('bingo-selection-list');
            const activeProjects = store.projects.filter(p => p.status === 'active');

            if(activeProjects.length === 0) {
                alert('暂无进行中的Bingo卡');
                return;
            }

            const linkedIds = currentEditingCharacter.settings.bingoLinkIds || [];
            const html = activeProjects.map(p => {
                const isLinked = linkedIds.includes(p.id);
                return `<div style="padding:10px; border-bottom:1px solid rgba(0,0,0,0.05); display:flex; align-items:center; gap:10px;">
                        <input type="checkbox" id="bingo-check-${p.id}" data-pid="${p.id}" ${isLinked ? 'checked' : ''} style="width:auto;">
                        <label for="bingo-check-${p.id}" style="flex:1; cursor:pointer;">
                            <div style="font-weight:bold;">${p.theme}</div>
                            <div style="font-size:0.7rem; opacity:0.6;">${p.tag} - ${p.tasks.length}个任务</div>
                        </label>
                    </div>`;
            }).join('');
            listDiv.innerHTML = html;

            document.getElementById('modal-select-bingo').classList.add('active');
        }

        // 确认Bingo卡选择
        async function confirmBingoCardSelection() {
            if(!currentEditingCharacter) return;
            const selectedIds = [];
            const checkboxes = document.querySelectorAll('#bingo-selection-list input[type="checkbox"]');
            checkboxes.forEach(cb => {
                if(cb.checked) {
                    selectedIds.push(parseInt(cb.dataset.pid));
                }
            });
            if (!currentEditingCharacter.settings) currentEditingCharacter.settings = {};
            currentEditingCharacter.settings.bingoLinkIds = selectedIds;
            await renderLinkedBingoCards(currentEditingCharacter);
            closeModal('modal-select-bingo');
        }

        // 选择世界书
        async function selectWorldBooksForCharacter() {
            const listDiv = document.getElementById('worldbook-selection-list');
            const worldBooks = await db.worldBooks.toArray();

            if(worldBooks.length === 0) {
                alert('暂无世界书, 请先在世界书管理中创建');
                return;
            }

            listDiv.innerHTML = worldBooks.map(wb => {
                const isLinked = currentEditingCharacter.settings.linkedWorldBookIds.includes(wb.id);
                return `<div style="padding:10px; border-bottom:1px solid rgba(0,0,0,0.05); display:flex; align-items:center; gap:10px;">
                        <input type="checkbox" id="wb-check-${wb.id}" ${isLinked ? 'checked' : ''} style="width:auto;">
                        <label for="wb-check-${wb.id}" style="flex:1; cursor:pointer;">
                            <div style="font-weight:bold;">${wb.name}</div>
                            <div style="font-size:0.7rem; opacity:0.6;">${wb.entries ? wb.entries.length : 0} 个条目</div>
                        </label>
                    </div>`;
            }).join('');

            document.getElementById('modal-select-worldbooks').classList.add('active');
        }

        // 确认世界书选择
        async function confirmWorldBookSelection() {
            if(!currentEditingCharacter) return;
            const worldBooks = await db.worldBooks.toArray();
            const selectedIds = [];
            worldBooks.forEach(wb => {
                const checkbox = document.getElementById(`wb-check-${wb.id}`);
                if(checkbox && checkbox.checked) {
                    selectedIds.push(wb.id);
                }
            });
            currentEditingCharacter.settings.linkedWorldBookIds = selectedIds;
            await renderLinkedWorldBooks(currentEditingCharacter);
            closeModal('modal-select-worldbooks');
        }

        // 保存角色完整信息
        async function saveCharacterFullInfo() {
            if(!currentEditingCharacter) return;

            const name = document.getElementById('character-detail-name-input').value.trim();
            if(!name) { alert('角色名称不能为空'); return; }

            if (!currentEditingCharacter.settings) currentEditingCharacter.settings = {};

            // Identity
            currentEditingCharacter.name = name;
            currentEditingCharacter.settings.nickname = document.getElementById('character-detail-nickname').value.trim();
            currentEditingCharacter.settings.group = document.getElementById('character-detail-group').value.trim();
            
            // Persona
            currentEditingCharacter.description = document.getElementById('character-detail-description').value.trim();
            store.userPersona = document.getElementById('character-detail-user-persona').value.trim(); // User persona is global
            currentEditingCharacter.first_mes = document.getElementById('character-detail-first-mes').value.trim();
            
            // AI Core - bingoLinkIds is now an array
            // The actual saving of bingoLinkIds happens in confirmBingoCardSelection
            currentEditingCharacter.settings.bgActivity = document.getElementById('character-detail-bg-activity').checked;
            currentEditingCharacter.settings.bgCooldown = parseInt(document.getElementById('character-detail-bg-cooldown').value) || 120;
            currentEditingCharacter.settings.maxMemory = parseInt(document.getElementById('character-max-memory').value) || 20;
            currentEditingCharacter.settings.worldBookScanDepth = parseInt(document.getElementById('character-worldbook-scan-depth').value) || 10;
            currentEditingCharacter.settings.semanticThreshold = parseFloat(document.getElementById('character-semantic-threshold').value) || 0.55;
            currentEditingCharacter.settings.pinnedMemory = parseInt(document.getElementById('character-detail-pinned-memory').value) || 0;
            currentEditingCharacter.settings.autoSummary = document.getElementById('character-detail-auto-summary').checked;
            currentEditingCharacter.settings.summaryInterval = parseInt(document.getElementById('character-detail-summary-interval').value) || 10;
            currentEditingCharacter.settings.timeAwareness = document.getElementById('character-detail-time-awareness').checked;
            currentEditingCharacter.settings.msgMode = document.getElementById('character-detail-msg-mode').value;

            // Appearance
            currentEditingCharacter.settings.bgFollow = document.getElementById('character-detail-bg-follow').checked;
            currentEditingCharacter.settings.showAvatar = document.getElementById('character-detail-show-avatar').checked;
            currentEditingCharacter.settings.bubbleSize = parseInt(document.getElementById('character-detail-bubble-size').value) || 14;
            currentEditingCharacter.settings.bubbleCssUser = document.getElementById('character-detail-bubble-css-user').value.trim();
            currentEditingCharacter.settings.bubbleCssAi = document.getElementById('character-detail-bubble-css-ai').value.trim();

            await db.characters.put(currentEditingCharacter);
            saveData(); // Save global store for userPersona and userAvatar
            await renderCharacterList(); // Refresh list
            
            alert('角色信息已保存!');
        }

        async function saveAndOpenChat() {
            await saveCharacterFullInfo();
            // 由于 saveCharacterFullInfo 会关闭模态框，我们需要重新获取角色并打开聊天
            // currentEditingCharacter 在 saveCharacterFullInfo 中已经被更新并保存
            openCharacterChat();
        }

        // --- 分组管理功能 ---
        function openGroupManager() {
            loadGroupOptions(); // 先加载分组列表
            renderGroupList(); // 渲染分组管理列表
            document.getElementById('modal-group-manager').classList.add('active');
        }

        function renderGroupList() {
            const container = document.getElementById('group-list-container');
            if (!store.characterGroups || store.characterGroups.length === 0) {
                container.innerHTML = '<div style="text-align:center; opacity:0.5; padding:20px;">暂无分组</div>';
                return;
            }

            container.innerHTML = '';
            store.characterGroups.forEach((group, index) => {
                const groupDiv = document.createElement('div');
                groupDiv.style.cssText = 'display:flex; align-items:center; justify-content:space-between; padding:12px; border-bottom:1px solid rgba(0,0,0,0.05); background:var(--card-bg); margin-bottom:8px; border-radius:8px;';
                groupDiv.innerHTML = `
                    <span style="flex:1; font-size:0.95rem;">${escapeHtml(group)}</span>
                    <button class="btn-sec btn-danger" style="width:auto; padding:5px 12px; margin:0;" onclick="deleteGroup(${index})">删除</button>
                `;
                container.appendChild(groupDiv);
            });
        }

        function addNewGroup() {
            const input = document.getElementById('new-group-name');
            const groupName = input.value.trim();

            if (!groupName) {
                alert('请输入分组名称');
                return;
            }

            if (store.characterGroups.includes(groupName)) {
                alert('该分组已存在');
                return;
            }

            store.characterGroups.push(groupName);
            saveData();
            input.value = '';
            renderGroupList();
            loadGroupOptions(); // 更新角色设置页面的下拉框
            alert('分组已添加!');
        }

        function deleteGroup(index) {
            const groupName = store.characterGroups[index];
            if (!confirm(`确定删除分组 "${groupName}"?`)) return;

            store.characterGroups.splice(index, 1);
            saveData();
            renderGroupList();
            loadGroupOptions();
            alert('分组已删除');
        }

        function loadGroupOptions() {
            const select = document.getElementById('character-detail-group');
            if (!select) return;

            const currentValue = select.value;
            select.innerHTML = '<option value="">未分组</option>';

            if (store.characterGroups && store.characterGroups.length > 0) {
                store.characterGroups.forEach(group => {
                    const option = document.createElement('option');
                    option.value = group;
                    option.textContent = group;
                    select.appendChild(option);
                });
            }

            // 恢复之前的选择
            if (currentValue) {
                select.value = currentValue;
            }
        }

        // --- 气泡样式预设管理 ---
        function saveBubblePreset() {
            const nameInput = document.getElementById('bubble-preset-name');
            const presetName = nameInput.value.trim();

            if (!presetName) {
                alert('请输入预设名称');
                return;
            }

            const bubbleCssUser = document.getElementById('character-detail-bubble-css-user').value.trim();
            const bubbleCssAi = document.getElementById('character-detail-bubble-css-ai').value.trim();
            const bubbleSize = parseInt(document.getElementById('character-detail-bubble-size').value) || 14;

            if (!store.bubblePresets) store.bubblePresets = {};

            store.bubblePresets[presetName] = {
                cssUser: bubbleCssUser,
                cssAi: bubbleCssAi,
                size: bubbleSize
            };

            saveData();
            nameInput.value = '';
            loadBubblePresetList();
            alert('样式预设已保存!');
        }

        function loadBubblePresetList() {
            const select = document.getElementById('bubble-preset-select');
            if (!select) return;

            const currentValue = select.value;
            select.innerHTML = '<option value="">选择预设</option>';

            if (store.bubblePresets) {
                Object.keys(store.bubblePresets).forEach(presetName => {
                    const option = document.createElement('option');
                    option.value = presetName;
                    option.textContent = presetName;
                    select.appendChild(option);
                });
            }

            if (currentValue) {
                select.value = currentValue;
            }
        }

        function loadBubblePreset() {
            const select = document.getElementById('bubble-preset-select');
            const presetName = select.value;

            if (!presetName || !store.bubblePresets || !store.bubblePresets[presetName]) {
                return;
            }

            const preset = store.bubblePresets[presetName];
            document.getElementById('character-detail-bubble-css-user').value = preset.cssUser || preset.css || '';
            document.getElementById('character-detail-bubble-css-ai').value = preset.cssAi || preset.css || '';
            document.getElementById('character-detail-bubble-size').value = preset.size || 14;
            document.getElementById('bubble-size-value').textContent = (preset.size || 14) + 'px';

            // 更新预览
            updateBubblePreview();
        }

        function updateBubblePreview() {
            const bubbleCssUser = document.getElementById('character-detail-bubble-css-user')?.value.trim() || '';
            const bubbleCssAi = document.getElementById('character-detail-bubble-css-ai')?.value.trim() || '';
            const bubbleSize = parseInt(document.getElementById('character-detail-bubble-size')?.value) || 14;

            const userBubble = document.querySelector('.preview-bubble-user');
            const charBubble = document.querySelector('.preview-bubble-char');

            if (userBubble) {
                const userDiv = userBubble.querySelector('div');
                if (userDiv) userDiv.style.fontSize = bubbleSize + 'px';

                // 应用自定义CSS到用户气泡
                if (bubbleCssUser) {
                    userBubble.style.cssText = `max-width:70%; background:var(--accent); color:var(--bg); padding:12px 16px; border-radius:16px; ${bubbleCssUser}`;
                } else {
                    userBubble.style.cssText = `max-width:70%; background:var(--accent); color:var(--bg); padding:12px 16px; border-radius:16px;`;
                }
            }

            if (charBubble) {
                const charDiv = charBubble.querySelector('div');
                if (charDiv) charDiv.style.fontSize = bubbleSize + 'px';

                // 应用自定义CSS到角色气泡
                if (bubbleCssAi) {
                    charBubble.style.cssText = `max-width:70%; background:var(--card-bg); color:var(--text); padding:12px 16px; border-radius:16px; border-left:3px solid var(--accent); ${bubbleCssAi}`;
                } else {
                    charBubble.style.cssText = `max-width:70%; background:var(--card-bg); color:var(--text); padding:12px 16px; border-radius:16px; border-left:3px solid var(--accent);`;
                }
            }
        }

        function setupBubblePreviewListeners() {
            const cssUserTextarea = document.getElementById('character-detail-bubble-css-user');
            const cssAiTextarea = document.getElementById('character-detail-bubble-css-ai');
            const sizeRange = document.getElementById('character-detail-bubble-size');

            if (cssUserTextarea) {
                cssUserTextarea.removeEventListener('input', updateBubblePreview);
                cssUserTextarea.addEventListener('input', updateBubblePreview);
            }

            if (cssAiTextarea) {
                cssAiTextarea.removeEventListener('input', updateBubblePreview);
                cssAiTextarea.addEventListener('input', updateBubblePreview);
            }

            if (sizeRange) {
                sizeRange.removeEventListener('input', updateBubblePreview);
                sizeRange.addEventListener('input', updateBubblePreview);
            }
        }

        // 实时更新Token估算
        function updateTokenEstimate() {
            if (!currentEditingCharacter) return;

            const messageCount = currentEditingCharacter.chatHistory ? currentEditingCharacter.chatHistory.length : 0;
            const maxMemory = parseInt(document.getElementById('character-max-memory').value) || 20;
            const pinnedMemory = parseInt(document.getElementById('character-detail-pinned-memory').value) || 0;

            // 更新显示
            document.getElementById('context-limit-display').textContent = maxMemory;
            document.getElementById('pinned-memory-display').textContent = pinnedMemory;

            // Token估算：系统提示词~500 + 上下文条数×100 + 长期记忆×50
            const estimatedTokens = 500 + (Math.min(messageCount, maxMemory) * 100) + (pinnedMemory * 50);
            document.getElementById('chat-token-estimate').textContent = '~' + estimatedTokens;
        }

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

        // ==================== 世界书管理功能 ====================

        let currentWorldBookFilter = 'all';
        let currentEditingWorldBook = null;
        let currentEditingEntry = null;

        // 显示世界书选项菜单
        function showWorldBookOptions() {
            resetUI();
            document.getElementById('modal-worldbook-options').classList.add('active');
        }

        // 过滤世界书
        function filterWorldBooks(categoryId, el) {
            currentWorldBookFilter = categoryId;
            document.querySelectorAll('#worldbook-categories .filter-chip').forEach(c => c.classList.remove('active'));
            if(el) el.classList.add('active');
            renderWorldBookList();
        }

        // 渲染世界书列表
        async function renderWorldBookList() {
            const listDiv = document.getElementById('worldbook-list');

            try {
                let worldBooks = await db.worldBooks.toArray();

                // 按分类过滤
                if(currentWorldBookFilter !== 'all') {
                    worldBooks = worldBooks.filter(wb => wb.categoryId === parseInt(currentWorldBookFilter));
                }

                if(worldBooks.length === 0) {
                    listDiv.innerHTML = '<div style="text-align:center; opacity:0.5; margin-top:50px;">暂无世界书</div>';
                    return;
                }

                listDiv.innerHTML = worldBooks.map(wb => {
                    const entryCount = wb.entries ? wb.entries.length : 0;
                    const enabledCount = wb.entries ? wb.entries.filter(e => e.enabled).length : 0;

                    return `
                        <div class="mini-card" onclick="openWorldBookDetail('${wb.id}')" style="cursor:pointer;">
                            <div style="flex:1;">
                                <div style="font-weight:bold; margin-bottom:5px;">${wb.name}</div>
                                <div style="font-size:0.7rem; opacity:0.7;">
                                    ${entryCount}个条目 · ${enabledCount}个启用
                                </div>
                                ${wb.description ? `<div style="font-size:0.75rem; opacity:0.6; margin-top:5px;">${wb.description}</div>` : ''}
                            </div>
                            <div><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="11" x2="14" y2="11"/></svg></div>
                        </div>
                    `;
                }).join('');
            } catch(error) {
                console.error('渲染世界书列表失败:', error);
                listDiv.innerHTML = '<div style="text-align:center; opacity:0.5; margin-top:50px; color:red;">加载失败</div>';
            }
        }

        // 渲染分类筛选器
        async function renderWorldBookCategories() {
            const container = document.getElementById('worldbook-categories');
            const categories = await db.worldBookCategories.toArray();

            let html = '<div class="filter-chip active" onclick="filterWorldBooks(\'all\', this)">全部</div>';
            categories.forEach(cat => {
                html += `<div class="filter-chip" onclick="filterWorldBooks('${cat.id}', this)">${cat.name}</div>`;
            });

            container.innerHTML = html;
        }

        // 创建世界书
        async function createWorldBook() {
            document.querySelectorAll('.modal:not(#panel-world-book-manager)').forEach(el => el.classList.remove('active'));
            currentEditingWorldBook = null;
            document.getElementById('worldbook-edit-title').textContent = '新建世界书';
            document.getElementById('worldbook-name').value = '';
            document.getElementById('worldbook-description').value = '';

            // 加载世界书分类选项
            await loadWorldBookCategoryOptions();

            document.getElementById('modal-edit-worldbook').classList.add('active');
        }

        // 加载世界书分类选项到下拉框
        async function loadWorldBookCategoryOptions() {
            const select = document.getElementById('worldbook-category');
            try {
                const categories = await db.worldBookCategories.toArray();
                let html = '<option value="">无分类</option>';
                categories.forEach(cat => {
                    html += `<option value="${cat.id}">${cat.name}</option>`;
                });
                select.innerHTML = html;
            } catch(error) {
                console.error('加载世界书分类选项失败:', error);
                select.innerHTML = '<option value="">无分类</option>';
            }
        }

        // 保存世界书
        async function saveWorldBook() {
            const name = document.getElementById('worldbook-name').value.trim();
            const categoryId = document.getElementById('worldbook-category').value;
            const description = document.getElementById('worldbook-description').value.trim();

            if(!name) {
                alert('请输入世界书名称!');
                return;
            }

            try {
                if(currentEditingWorldBook) {
                    // 更新
                    await db.worldBooks.update(currentEditingWorldBook.id, {
                        name: name,
                        categoryId: categoryId ? parseInt(categoryId) : null,
                        description: description
                    });
                    alert('世界书已更新!');
                } else {
                    // 新建
                    const newWorldBook = {
                        id: 'wb_' + Date.now(),
                        name: name,
                        categoryId: categoryId ? parseInt(categoryId) : null,
                        description: description,
                        entries: []
                    };
                    await db.worldBooks.add(newWorldBook);
                    alert('世界书已创建!');
                }

                closeModal('modal-edit-worldbook');
                document.getElementById('panel-world-book-manager').classList.add('active');
                await renderWorldBookList();
                await renderWorldBookCategories();
            } catch(error) {
                console.error('保存世界书失败:', error);
                alert('保存失败: ' + error.message);
            }
        }

        // 打开世界书详情
        async function openWorldBookDetail(worldBookId) {
            try {
                document.querySelectorAll('.modal:not(#panel-world-book-manager)').forEach(el => el.classList.remove('active'));
                const worldBook = await db.worldBooks.get(worldBookId);
                if(!worldBook) {
                    alert('世界书不存在!');
                    return;
                }

                currentEditingWorldBook = worldBook;
                document.getElementById('worldbook-detail-title').textContent = worldBook.name;

                renderWorldBookEntries();

                document.getElementById('modal-worldbook-detail').classList.add('active');
            } catch(error) {
                console.error('打开世界书详情失败:', error);
                alert('打开失败: ' + error.message);
            }
        }

        // 渲染条目列表
        function renderWorldBookEntries() {
            const listDiv = document.getElementById('worldbook-entries-list');

            if(!currentEditingWorldBook || !currentEditingWorldBook.entries || currentEditingWorldBook.entries.length === 0) {
                listDiv.innerHTML = '<div style="text-align:center; opacity:0.5; margin-top:30px;">暂无条目</div>';
                return;
            }

            listDiv.innerHTML = currentEditingWorldBook.entries.map((entry, index) => {
                const statusColor = entry.enabled ? 'var(--completed)' : '#999';
                const statusText = entry.enabled ? '已启用' : '已禁用';

                // 触发模式指示灯
                const triggerMode = entry.triggerMode || 'keyword';
                const lightColor = triggerMode === 'always' ? '#2196F3' : triggerMode === 'semantic' ? '#9C27B0' : '#4CAF50';
                const lightTitle = triggerMode === 'always' ? '常驻触发' : triggerMode === 'semantic' ? '语义触发' : '关键词触发';

                return `
                    <div class="mini-card" onclick="editWorldBookEntry(${index})" style="cursor:pointer; opacity:${entry.enabled ? '1' : '0.6'};">
                        <div style="flex:1;">
                            <div style="display:flex; align-items:center; gap:6px; margin-bottom:3px;">
                                <span style="width:10px; height:10px; border-radius:50%; background:${lightColor}; display:inline-block; box-shadow:0 0 4px ${lightColor};" title="${lightTitle}"></span>
                                <span style="font-weight:bold;">${entry.name}</span>
                            </div>
                            <div style="font-size:0.7rem; opacity:0.7;">
                                ${triggerMode === 'always' ? '常驻' : triggerMode === 'semantic' ? '语义匹配' + (entry.embedding ? ' ✓' : ' (未生成向量)') : '关键词: ' + (entry.keys.join(', ') || '无')}
                            </div>
                            <div style="font-size:0.65rem; color:${statusColor}; margin-top:3px;">
                                ${statusText}
                            </div>
                        </div>
                        <div style="display:flex; gap:5px;">
                            <button class="btn-sec" style="width:auto; padding:5px 10px; font-size:0.7rem;" onclick="event.stopPropagation(); toggleEntryEnabled(${index})">
                                ${entry.enabled ? '禁用' : '启用'}
                            </button>
                            <button class="btn-sec" style="width:auto; padding:5px 10px; font-size:0.7rem; color:#c62828;" onclick="event.stopPropagation(); deleteWorldBookEntry(${index})">
                                删除
                            </button>
                        </div>
                    </div>
                `;
            }).join('');
        }

        // 创建新条目
        function createWorldBookEntry() {
            document.getElementById('modal-worldbook-detail').classList.remove('active');
            currentEditingEntry = null;
            document.getElementById('entry-edit-title').textContent = '新建条目';
            document.getElementById('entry-name').value = '';
            document.getElementById('entry-keys').value = '';
            document.getElementById('entry-content').value = '';
            document.getElementById('entry-enabled').checked = true;
            document.getElementById('entry-trigger-mode').value = 'keyword'; // 默认绿灯关键词模式
            updateTriggerModeUI('keyword');

            document.getElementById('modal-edit-entry').classList.add('active');
        }

        // 编辑条目
        function editWorldBookEntry(entryIndex) {
            document.getElementById('modal-worldbook-detail').classList.remove('active');
            const entry = currentEditingWorldBook.entries[entryIndex];
            currentEditingEntry = { index: entryIndex, data: entry };

            document.getElementById('entry-edit-title').textContent = '编辑条目';
            document.getElementById('entry-name').value = entry.name;
            document.getElementById('entry-keys').value = entry.keys.join(', ');
            document.getElementById('entry-content').value = entry.content;
            document.getElementById('entry-enabled').checked = entry.enabled;

            // 设置触发模式（兼容旧数据，默认为 keyword）
            const triggerMode = entry.triggerMode || 'keyword';
            document.getElementById('entry-trigger-mode').value = triggerMode;
            updateTriggerModeUI(triggerMode);

            document.getElementById('modal-edit-entry').classList.add('active');
        }

        // 更新触发模式UI显示
        function updateTriggerModeUI(mode) {
            const alwaysBtn = document.getElementById('trigger-always-btn');
            const keywordBtn = document.getElementById('trigger-keyword-btn');
            const semanticBtn = document.getElementById('trigger-semantic-btn');
            const keysInput = document.getElementById('entry-keys');
            const keysHint = document.getElementById('entry-keys-hint');

            alwaysBtn.classList.remove('active');
            keywordBtn.classList.remove('active');
            if (semanticBtn) semanticBtn.classList.remove('active');

            if (mode === 'always') {
                alwaysBtn.classList.add('active');
                keysInput.placeholder = '可选，仅用于显示';
                keysHint.textContent = '蓝灯常驻模式：条目将始终发送给AI';
            } else if (mode === 'semantic') {
                if (semanticBtn) semanticBtn.classList.add('active');
                keysInput.placeholder = '可选，仅用于显示';
                keysHint.textContent = '紫灯语义模式：AI通过语义相似度自动匹配相关条目（首次使用需下载~24MB模型）';
            } else {
                keywordBtn.classList.add('active');
                keysInput.placeholder = '例如：王国,艾尔登,首都';
                keysHint.textContent = '绿灯关键词模式：当对话中出现这些关键词时，该条目才会被激活';
            }
        }

        // 切换触发模式
        function setTriggerMode(mode) {
            document.getElementById('entry-trigger-mode').value = mode;
            updateTriggerModeUI(mode);
        }

        // 保存条目
        async function saveWorldBookEntry() {
            const name = document.getElementById('entry-name').value.trim();
            const keysText = document.getElementById('entry-keys').value.trim();
            const content = document.getElementById('entry-content').value.trim();
            const enabled = document.getElementById('entry-enabled').checked;

            const triggerMode = document.getElementById('entry-trigger-mode').value;

            if(!name) {
                alert('请输入条目名称!');
                return;
            }

            // 绿灯模式必须填写关键词
            if(triggerMode === 'keyword' && !keysText) {
                alert('关键词触发模式必须输入至少一个关键词!');
                return;
            }

            if(!content) {
                alert('请输入条目内容!');
                return;
            }

            const keys = keysText.split(',').map(k => k.trim()).filter(k => k);

            const entryData = {
                id: currentEditingEntry ? currentEditingEntry.data.id : 'entry_' + Date.now(),
                name: name,
                keys: keys,
                content: content,
                enabled: enabled,
                triggerMode: triggerMode // 'always' = 蓝灯常驻, 'keyword' = 绿灯关键词触发, 'semantic' = 紫灯语义
            };

            // 语义模式：生成向量嵌入
            if (triggerMode === 'semantic') {
                const embeddingText = name + '。' + content;
                const contentHash = simpleHash(embeddingText);

                // 如果内容没变且已有向量，跳过重新生成
                const existingEntry = currentEditingEntry ? currentEditingEntry.data : null;
                if (existingEntry && existingEntry.embedding && existingEntry.embeddingHash === contentHash) {
                    entryData.embedding = existingEntry.embedding;
                    entryData.embeddingHash = existingEntry.embeddingHash;
                    console.log('[语义服务] 内容未变，复用已有向量');
                } else {
                    try {
                        showToast('正在生成语义向量...');
                        entryData.embedding = await semanticEmbeddingService.embed(embeddingText);
                        entryData.embeddingHash = contentHash;
                        console.log('[语义服务] 向量生成成功，维度:', entryData.embedding.length);
                    } catch (embErr) {
                        console.warn('[语义服务] 向量生成失败:', embErr);
                        showToast('语义模型加载失败，条目已保存但语义触发暂不可用');
                        entryData.embedding = null;
                        entryData.embeddingHash = null;
                    }
                }
            }

            try {
                if(currentEditingEntry !== null) {
                    // 更新现有条目
                    currentEditingWorldBook.entries[currentEditingEntry.index] = entryData;
                } else {
                    // 添加新条目
                    if(!currentEditingWorldBook.entries) {
                        currentEditingWorldBook.entries = [];
                    }
                    currentEditingWorldBook.entries.push(entryData);
                }

                // 更新数据库
                await db.worldBooks.update(currentEditingWorldBook.id, {
                    entries: currentEditingWorldBook.entries
                });

                closeModal('modal-edit-entry');
                // 重新打开详情页
                document.getElementById('modal-worldbook-detail').classList.add('active');
                renderWorldBookEntries();
                alert('条目已保存!');
            } catch(error) {
                console.error('保存条目失败:', error);
                alert('保存失败: ' + error.message);
            }
        }

        // 切换条目启用状态
        async function toggleEntryEnabled(entryIndex) {
            try {
                currentEditingWorldBook.entries[entryIndex].enabled = !currentEditingWorldBook.entries[entryIndex].enabled;

                await db.worldBooks.update(currentEditingWorldBook.id, {
                    entries: currentEditingWorldBook.entries
                });

                renderWorldBookEntries();
            } catch(error) {
                console.error('切换条目状态失败:', error);
                alert('操作失败: ' + error.message);
            }
        }

        // 删除条目
        async function deleteWorldBookEntry(entryIndex) {
            if(!confirm('确定要删除这个条目吗?')) return;

            try {
                currentEditingWorldBook.entries.splice(entryIndex, 1);

                await db.worldBooks.update(currentEditingWorldBook.id, {
                    entries: currentEditingWorldBook.entries
                });

                renderWorldBookEntries();
                alert('条目已删除!');
            } catch(error) {
                console.error('删除条目失败:', error);
                alert('删除失败: ' + error.message);
            }
        }

        // 编辑当前世界书
        async function editCurrentWorldBook() {
            document.getElementById('modal-worldbook-detail').classList.remove('active');
            document.getElementById('worldbook-edit-title').textContent = '编辑世界书';
            document.getElementById('worldbook-name').value = currentEditingWorldBook.name;
            document.getElementById('worldbook-description').value = currentEditingWorldBook.description || '';

            await loadWorldBookCategoryOptions();
            document.getElementById('worldbook-category').value = currentEditingWorldBook.categoryId || '';

            document.getElementById('modal-edit-worldbook').classList.add('active');
        }

        // 删除当前世界书
        async function deleteCurrentWorldBook() {
            if(!confirm(`确定要删除世界书"${currentEditingWorldBook.name}"吗？\n这将同时删除所有条目。`)) return;

            try {
                await db.worldBooks.delete(currentEditingWorldBook.id);

                closeModal('modal-worldbook-detail');
                await renderWorldBookList();
                alert('世界书已删除!');
            } catch(error) {
                console.error('删除世界书失败:', error);
                alert('删除失败: ' + error.message);
            }
        }

        // 导入世界书
        function importWorldBook() {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.onchange = async (e) => {
                const file = e.target.files[0];
                if(!file) return;

                try {
                    const text = await file.text();
                    const data = JSON.parse(text);

                    await importWorldBookData(data);
                    alert('世界书导入成功!');
                    await renderWorldBookList();
                    await renderWorldBookCategories();
                } catch(error) {
                    console.error('导入失败:', error);
                    alert('导入失败: ' + error.message);
                }
            };
            input.click();
        }

        // 导入世界书数据（支持多种格式）
        async function importWorldBookData(data) {
            // 检测格式并提取条目
            let entries = [];
            let worldBookName = '导入的世界书';

            // 格式1: character_book (标准Tavern格式)
            if(data.character_book && data.character_book.entries) {
                entries = data.character_book.entries;
                worldBookName = data.character_book.name || worldBookName;
            }
            // 格式2: world_entries (旧格式)
            else if(data.world_entries) {
                entries = data.world_entries;
            }
            // 格式3: data.world格式
            else if(data.data && data.data.world) {
                entries = data.data.world;
            }
            // 格式4: world_info
            else if(data.world_info) {
                entries = data.world_info;
            }
            // 格式5: 直接的entries数组
            else if(Array.isArray(data.entries)) {
                entries = data.entries;
                worldBookName = data.name || worldBookName;
            }
            // 格式6: 直接就是数组
            else if(Array.isArray(data)) {
                entries = data;
            }

            if(entries.length === 0) {
                throw new Error('未找到有效的世界书条目');
            }

            // 转换条目格式
            const convertedEntries = entries.map((entry, index) => {
                // 获取名称（优先级：comment > keys合并 > 默认）
                let entryName = '未命名条目';
                if(entry.comment && entry.comment.trim()) {
                    entryName = entry.comment.trim();
                } else if(entry.keys && entry.keys.length > 0) {
                    entryName = entry.keys.join(', ');
                }

                // 获取关键词
                let keys = [];
                if(entry.keys && Array.isArray(entry.keys)) {
                    keys = entry.keys;
                } else if(entry.key) {
                    keys = [entry.key];
                }

                // 只导入有效条目（有名称、有内容、未被禁用）
                if(entryName === '未命名条目' || !entry.content) {
                    return null;
                }

                if(typeof entry.enabled !== 'undefined' && !entry.enabled) {
                    return null;
                }

                return {
                    id: 'entry_' + Date.now() + '_' + index,
                    name: entryName,
                    keys: keys,
                    content: entry.content,
                    enabled: true
                };
            }).filter(e => e !== null);

            // 创建世界书
            const newWorldBook = {
                id: 'wb_' + Date.now(),
                name: worldBookName,
                categoryId: null,
                description: `导入自文件，包含${convertedEntries.length}个条目`,
                entries: convertedEntries
            };

            await db.worldBooks.add(newWorldBook);
        }

        // 导出所有世界书
        async function exportAllWorldBooks() {
            try {
                const worldBooks = await db.worldBooks.toArray();
                if(worldBooks.length === 0) {
                    alert('暂无世界书可导出!');
                    return;
                }

                const exportData = {
                    version: 1,
                    exportDate: new Date().toISOString(),
                    worldBooks: worldBooks
                };

                const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `worldbooks_${Date.now()}.json`;
                a.click();
                URL.revokeObjectURL(url);

                alert('世界书已导出!');
            } catch(error) {
                console.error('导出失败:', error);
                alert('导出失败: ' + error.message);
            }
        }

        // 打开分类管理器
        async function openCategoryManager() {
            document.getElementById('modal-worldbook-options').classList.remove('active');
            await renderCategoryList();
            document.getElementById('modal-category-manager').classList.add('active');
        }

        // 渲染分类列表
        async function renderCategoryList() {
            const listDiv = document.getElementById('category-list');
            const categories = await db.worldBookCategories.toArray();

            if(categories.length === 0) {
                listDiv.innerHTML = '<div style="text-align:center; opacity:0.5; margin-top:30px;">暂无分类</div>';
                return;
            }

            listDiv.innerHTML = categories.map(cat => {
                return `
                    <div class="mini-card" style="padding:10px 15px;">
                        <div style="flex:1; font-weight:bold;">${cat.name}</div>
                        <button class="btn-sec" style="width:auto; padding:5px 10px; font-size:0.7rem; color:#c62828;" onclick="deleteCategory(${cat.id})">
                            删除
                        </button>
                    </div>
                `;
            }).join('');
        }

        // 创建分类
        async function createCategory() {
            const name = document.getElementById('new-category-name').value.trim();
            if(!name) {
                alert('请输入分类名称!');
                return;
            }

            try {
                await db.worldBookCategories.add({ name: name });
                document.getElementById('new-category-name').value = '';
                await renderCategoryList();
                await renderWorldBookCategories();
                alert('分类已创建!');
            } catch(error) {
                console.error('创建分类失败:', error);
                alert('创建失败: ' + error.message);
            }
        }

        // 删除分类
        async function deleteCategory(categoryId) {
            if(!confirm('确定要删除这个分类吗？\n该分类下的世界书不会被删除，但会变为无分类状态。')) return;

            try {
                // 删除分类
                await db.worldBookCategories.delete(categoryId);

                // 更新使用该分类的世界书
                const worldBooks = await db.worldBooks.where('categoryId').equals(categoryId).toArray();
                for(const wb of worldBooks) {
                    await db.worldBooks.update(wb.id, { categoryId: null });
                }

                await renderCategoryList();
                await renderWorldBookCategories();
                await renderWorldBookList();
                alert('分类已删除!');
            } catch(error) {
                console.error('删除分类失败:', error);
                alert('删除失败: ' + error.message);
            }
        }

        // ==================== 世界书管理功能结束 ====================

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
                    <img src="data:image/webp;base64,UklGRhBCAABXRUJQVlA4WAoAAAAQAAAA/wMA/wMAQUxQSBobAAAB8IBt2zMn2bYdmZkESUJvCaH3Dkrv0mzclhvbXYTbBnZzFxQbj/XW3MUSCxK7iA072EPVoPQiEASJGCCEFNInmXadx/M8b3XmKud57MvyJCImgJr93+z/Zv83+7/Z/83+b/Z/s/+b/d/s//8pcJcZV101KxP15r5bYvH/1jr53sVwl/5EA/8/hj/siHSBDyz+/2h9kgJzM6r5/3Pj70HuJf4VV0Lch/yrfg9wW/hX3g1vy/lXfxfcruQ4vAXaOkbjIZaFbOs4Lr8FtkEqPng8ru3iOD0Aa+1VvHAWqj3NcfsSqv0cPyWg5rPiR6Vi2pUcxzdg2qfxtB7TKuOpBtLSOa67INrf4ut+RPsuvnYgWkN8NQFab47zEXj273hbhmeH4u0InsXizQqg2WUc91eh2efxtxbNquOvFsyyOAH7Ytk/E+FJLDuYCIexLJoIlg/J5nFC/gHJ8hNjA5LVJ0YQyIZxgo7FsdcTZSWOlSZKGYy154TtjGIPJ86jKHYwcQ6BmC+WOFYAwxZyAi/EsK2JtA3DwokUhbDLOaGvRLCNibUJwZoSqwnAZnGCn4dfnyfal/hVn2gN8DWWE34Cen2ceKvRqz7xGsBrAtvgDOz63A4+x65GO2iErhlsi3OQa6095CNXkz00AdcFbJMX4tY3drEJtyJ2EfGh1g1sm9ej1j772AtaqZZ9WOmY9TDb6AOYVWwnRyEri+1UdUOsl22FlyPWaXspB6yxbLPj8Wqd3XwBV76I3YR8aHU72+4NaPWT/RwAq87KflRnrHqZbfhZrKqxo3KomsG2PBGpNttTPlCdEbOnSApOPcY2fR9OldvVMZgay7Y9BqU22NfnIBWI2lc4BaPuZxtfjFEn7awIos5kO1fDEWqTrfEXAHVGzN4iLfHpSbb5R/Cpxu5K4elCtv0L0Gm//X0PTpnK/qwu2LSKHfAFaPKFnKAGmu5mR7wRmcqdoQiY5rBDTsGlH5ziG1jKUk4Ry0Sl1eyYr4JSSsQ5GgKY9E920DsxqdpJjkPSfHbU3yLSMWfZC0jT2FnVaDza4zC8Do76KqeJdUWjtey4b4FRa8t5mtKwaAU78L+gKBByoiofEuWwI/8VieqcqQyI7mSHvgaHqpzqZxi6hh17HgqddK79IDSXnVudjUFFDsbbIGgqO7k1CoEKHY2/AaAJ7OzWSPzZ73C8AX7GsdNbw9Fnn+PxOvAZx85vDcWevS6Av4aekcoNxAYjz252hV8BzwR2h7FhuHPAJfB62JnMbtEaizo/uQbeDDpz2D2qaZjzi4vg7ZBzCbtJdS7ilLgK/gFwrmGXeSHeVLqNn+BmKbvOhWATaHAfZX6sWcYudCnUpIfcSG0q0nzArvRpoMmIuZPGTjizkV3qWzAzSrmVcF+UKWTXug5k5rF7VTMw5pSL4QMQcx+72oUAkxJ0N6eS8eV1drmPwUtG1O0EO6HLRna9b4HLROV+IsOw5Si74C3Qcju74t8DS0q9OypJxpWV7JL/ASu9Y24pmIEqu9g1rwaVueyeremYUu6ieD+kPMGuOhtQMsLuqqYdnnzHLvsdOJmr3FZsMpj4yth1F4LJ0+zCF0NJZsSN1bRHkm3syt8DksvZnVvTYSRQ5dL4Zz+KvM2u/VEQGW25t6YBGHKUXXwBhDzIrv4GAOkSdndVbfFjC7v8t+Hj9+z2YzPAo0WN6+OfA9jxGXvAZ6BjjvICkTHAEahgT1iYhBtvs0d8BDYmWF6haTBo+E6wZ9wJGsvYQ94BGaNiXqK+F2IcY0+5FTCWs8e8Ay7GxbxG40Cw8B1nz7kdLF5lD3oPVEy0vEjjYKAInGJPuicJJ95kj/oATJxreZXQGJBoeZo965EWGLGOPexyiLhGeRnrPIDo3MCe9lQ7fNjLHvdDeFjKXlddAw5DI56Hq7tBQ+A4e+BtSciwij3xw8BwufJG0amw0LGePfKx1qiwlz3zB6DwMHvoWyBhYtRLNQwChJbl7Kn3BvBgHXvsZXCwmL22ugIMRkU8F9f0gYIWp9iD7w4gwVr25M8Bwd/Ym6vLYWBkxKNxdW8QaFHKnn1HAAM2sId/HgLuYy+vrgGA6VFPx/XDxF/HGvb4R1pJvz3s+T8Vfq+zBrxT9F2ldEBkuuAb1MRasLSL2Gt5kjXh1mSp9x1rwxeF3hOsEW8QefMsnRCaKvAGN7FWLM0Udy1PsmbckizttrB2fFHYPcMa8kZRd42lI8IzBN24MGvJyr5irnM1a8qDrYRc4Ahryy+TZNxa1piPi7gnWGeq6wXclZbW4NA08TYuxJrzVE/h1qWGtWdha9GW/DNr0I0BybaFtehLgu0d1qR3ibW7lS6xfi/UroixNm2aItLGhVijnuol0LKqWase7ijO0k6wZt1yhjDzH2Lt+olPln3LGvZZUbaKtezdguwxpWesq8TYTRZr2tAsITYvytq2epQImxpijXuqrwAbUM9a92hX8ZVZxZp3f3vh1b6UtW9BS9GV8hNr4M8Dgsu3i7XwW0lyawNr4n+JrdWsjZcKrddZIy8RWc8onaRuFFgPKdbKsavE1d8s1syRi4XV7RZr56ZZompBjDV0cJqg+n2UtXT1aDE1L8KaumaMkLoozNq6YoSIOifMGrt8uICaGWKtXTZUPJ3dxJq7pJ9wGh9k7X28r2ia2sgavLiPYJrdxFr85FCxdG6INfmp4ULpvBBr87IRIumKCGv0qrEC6fcR1urV48XRwihr9ppJwuimGGv3hpmi6LYYa/jgHEF0l8VaPnSRGPq7Yk0fukQIPaNY28euE0Fvsc5XiwXQx6z5c6SPbwtr/2U+0ZN+mA3gW8mCp+NxNoKfthQ7PcvZEH7TRugMq2FjuK+ryJkSZINY1FfgXBlio3h8uLi5I8aGsf5cYZOn2DiG/yhq3mcTqR6QMym72VC+GBAynY+xsfw4VcQMPM0Gc0snATMzyEbzSH/xcn2EDWflROHyD4uNZ/0FouUjxQY0tkSupO5hQ/pCslDpV87GNL+tSDknyAb18ECBcnuEjerps8XJG4oNa/hqWeL7hg1srk+QZJxgI/tBmhiZXM+GdkeWEPlzhI1t+XQR8q5igxteKD/aHmLDm5ciPCbUsPHdnCk6siNsgEsmCI7XFRvh0HVSI3U7G+O8FJExsooN8rcZAuO2CBvlY6PFxUrFhjmULSs6FbGBfiNNUMxrZCN9cKiYeM1iQ133OxnR7gAb7LwUATG9jo329t7i4YkYG+7K82VDi61svlWOXzBMrGYjvraLWPh7lA15+QUyodU2NucqN0UgXFDPRn17f3HwrsWGvW6+LOh1gg38qraCIDvMRv7oRCngX8emPvqATwSMqWKDn58pAPJibPRL55q+XkfZ+K9IN3p3R1gAHp1m7lrtYhlo5bYwdFc3sRjcN8rE+TeyJGxa4jduF9SxMNzc17CttFgc1i4yadOqWCR+lGHM3rRYKFYvMmMzqlgwftHDfPm/Uiwaa7N9huuSOhaP3/Q3Wf6vFQvI4BK/sbqsgYXk5kFmKr1AsZhsWuI3UH8NsajcOso0ZR1maRnNbWWUXo2xwCy51BzNPM1Cc00PM5S8XrHYbFjiN0B/DrHo3D3O9PQ4wtLTymtldN6xWIAeu9jczK9nIZo/xMz0/JHlaCS3lYFZYbEoLVmQZFgWh1icbhphUkacYIlqrehoSpK/VixUT2f7jch9YRasOyeZj0uqWbZar2WZjV4/sXwN5rQ2F8lrFYvYimy/ociLspgtnGsibgqyqM0fYRomlLK0tVZkmISsQsUCt+GBlqagVYHFQrf4Gr8JCKyKseA9eHmS9nspysJ324V6LyfEArhgqr67tZ6FcP5IPXdZFctha1Uf/TankmVx6KnOem16CcvjhtxMfTb9JMvkhtxMPTb9JMvlYG5X/XV2KcvmUF5XvTWzlOVzKK+rvpp5imV0KC9LT11VxXK68eme+mlJA8vqyIqheumxRpbXas0kfbQ8zEK74MIkHdRijcWC+4cFAd2TsVWx8D6anapzzj7BErzs3o665pZqluKhFcN0zIsRFuUFFybplcztisX54exUfXLeKZbpNbnd9UhOA8v1yKoJ2qN9gcXC/ZsrknXGhcdZwpfmdNcVj4dYysfWzE7SD4MLFYv6H7PT9cLSepb3NbmDtUH3AouF/o5FaTrg3mqW/LV5Z3m8YbstFv87FrXybs83MgbWvzjek116VDEQHnygl8fq/l2U0dAqWJTmnZ6sZ0ysXTE7yQvdUs7I+NPS3h7n7IOK4fHAkgzPMmZPjDHSKsju6EG654cYKUNrFqR5isyvQ4yXta/NbeERuueHGDWDaxaku77e+SHGzsY1C1q5uL75IUbQpjUL2riy8/bEGEdjBdndXdb9JYrh9EDOlCSX1Ob1ekbVshUXtnA9VxZGGFtr37suy72kPVWpGGKLcme3cCG/2RNhpA3mZ/d0E0O+rFMMuPufmJvuBtJyT1qMu7EdObNbONrNhyKMv8H8JaN9jjRkZ5hxuOLtP6Q7zR8aGY1rn8lwkuGVjMjBnNaO8T6j8vGJzhAoZlyOLnGCM8IMzbkOUM/gfL/tVTA832RzbzE+R8+ytX6M0LuT7awOovhOGzufMfp0mn1VghTfaFvdGaV/9NnVtzDFZ9lVE04ttivG6c9sajhQ1drUY0DFnezpU6QaaU8FSDUJ/ibb06dINdKe/oFUne1pFFDVJdkTAdUXZNNNOHWnXX2LU2Psqi9M/eSzKzqNUreQbZ8HUlXp9kX1GHUP2fhAiNqbbGe0CqCio8neq/DpL2TzgSA6/Z1sPy2CTcuT7I8CJ4ApuoSc8XNYKp1OTjm9CpLCuW3JQRc1wVHwxe7ksBP3R4Co/uPr2pITpz1+IgZAsR05s1uQg/d6rzyGPEV5l7clFzhhXT3klK+cn0kuctGBMNRYO3JmB8h1tn75tMKYilWLMsm1LjgQQZddD47xkcvttqoWVprys7uTS773mIUnFasWtCZXfc3hGJIcfXyyj1z42E1NGFKUOyWJXHufz5vQ48ADQ8jt99kQwo0dd/Qib5j1VQgx9tzdl7xk1udhrDjwwCDynuP3xlDi54eHkledus/Ch6oVs5PI095UCg1Nqy5KIe/rfzkICtb6a9qQV87aGMWDYzl9yFvPO6yQoHHV7CTy4M8FQUBt/FM6efVh+5X8K3mkD3n7OypEn5V/eTJ5/67rY1KvJKcX6cIlNQIv+vFcP+nEgXuVrCvN6UH68bFGObdjQTLpyfOPiri6vBGkMdttiEm3H25sRbrz4TrBZuVfmEQ6dM5JoVaXN4i0acb3Sp4VLWlHWtX/dlSWrb3QR/p1YZUYs9aMI0076RcRVvd4D9K4HTcr6VX6QDvSvKnrLcm1d0EK6eDnwlKr4MIk0sUPNkisggtJK193WlhZa8aRdp5XKagirw4iLX1OuZAKLetB2npqqYAK53UjrT2pWDiF87qR9p5YLJhCeVmkxaeWCqXg411Im0/8RSBF8rqSVp9cLoyiL/Uk7X5xlSCyVg0gLX9TUArljyJt/1BYAn09mrT+v6PSZ99vSPu/aEmeXxb5yACmblJSp/TmZDKEmT+KnNql6WQQx5aJG2tFFzKM1zfImvwRZCCXxeRM4VwykymrlYypyPaTsexVJGCCD6WT0ZxTJVzUO93JeN4VlSy7ppEJ9ecrqXI620+GdGixSInkdSCDektYnnw5iAzrSiVLTiwg89rtsCCJ5KaTkb2yTopsGELGdoWSIMevIJObdVh8RHNbk+G9LSI7CoaR+fV/KTiqs31khKdXSY01WWSMX1IS4+fzyCRnHhIX0dx0Msy3RmTF1uFknpM3CIrGJX4y0r9tkhLfDiRT7V8vImqzfWSwL2yUD591J7PtzxcOFX8g8z2lTjJ82pWM+DtKKlQvIlM+qVYmrM4kg/6OQKhZRGb9vEZp8GV3Mu3J34uC+uvJxC+IyIEt/cnMp+0QAtGcZDL2d8UkQNEkMvkZxcZP5aWR4X9emb2T55P5H1dv8lZ3JAnoLzB2TdlJJASvi5q5wpEkBzN+MXEr0kgUvmHcaq4kaXhx2Kxt6EbyMHWfQVM5fhKJOcqUlZ9LUnFsgxlbl0Fy0b/NgKkcP4nGR5XpKj+XpOPskNlal0HyMfVHg6Vy/CQiXzRWtfNISl4WNVO7+5Kc7HTCRK1IJVH5oXFqWkTS8ibLLBWPI3l5VqNJ+qIdSczUg8ZI5fhJaL5riBouJ7l5s2WCikeT5BwZND8bOpHsTD1oevICJD4/MzqNvyMJeotlbkrGkQydEjI1u3uQFO1YbmZWpZIc9e82MConiUTpSuPSMI+k6VJlVopHkTz9TdSk7OlGErVHjTn5ohXJ1BZFpiTXT2L1UyMSu40k61PKfNRfQLL1Wst0lJxF0nVu1GzszSL5OiRoMta1IQnbrtxcvHcGydgWRaYi10didp2RiN1CkvYlAxG6gmTtQ8o0VE4iafsnyywcG0zydnbUJBzsQRL3zJA52N6JZG7fBlOwvjVJ3XaVZuCjM0juph43Aa8GSPImF+m/h0n6Fmg+tZjk75daT91OEvhNjRe7mmTwc9ou9FuSwjlKzwXPJTl8j9Jx9TNJEt+j9NvpMSSLb1K6rWoMSeNFSq+VDSd5fK3SaaeGkUS+wtJnp4aSTJ4X02WlQ0gqnxvTY8f6kVw+N6bDfulNknlGTH8d70OyeWZMd50aRNL5opjeKhtC8vliS2dVDCMJfZmlr6pHk4xeoHRVzViS0tcqPVU3geT0LUpHBc8mSf0XpZ8aZ5Ksfkg7heeStF6mmaIXkbx+Qyupa0lir9FJfyWZ/ZU+up+k9i5d9DSJbV+RHlrpk1vUolQHrQ6Q5G5drX82p5Ls7taoe/a0Jek9NKx3Dnch+T0jpnOO9SAJfoXSN9XDSIbfqnRNeDZJ8Sc0jZpPcvwjPfM3kuR7dMwyEuW+Yv3yiV+WUVq1btmSStK8R5NeKWxP8nxSTKec7EUS/WqlT+rOJJn+T20SPZek+vu65BaS6wf0SC4J9uQyHfJlQLJRl6D+KGxLsn1cTHeU9ybpfrXSG+HpJN+f1hpqAUn4zTrjERLxvuP64kOfjKOOQV2xK42k/ARLT5R0JTl/jdIRoYkk6V/SEdeTrN+tH54jYR+o1A3fp0g76h/RC8e7kLz/vdIJoQkk8XN1wkKS+Tv1QS4J/UCFLtgYkHrUP6oHijuR3L9a6YDG0ST5X9EBi0j2H/F+r5Pwbx/0eoWp0o+mWd6ufijJ/0c9nfoDIeB3Xu5ZgsBAlXfbloIBNNzyapU9CQUXezTrQsLBAm+WQ0AYOO3FCvxIQGda3qssg7DwDs9l/YbQcLPXeorgsEWNt9qdggc0zvJS9QMIER/3UgsJE3/0Tu8QKLZr8krFbVGBLlPeKDyRcPETb3QvAaOvzAttSkIGGhzzPuVdCRuXeh51BaFjodd5g+Cxc9jbHG+DD7TA08RmEUJu8jJPE0QGar3Lj2dgBM1SXiUyllDyba/yAOFkpTfZ5geK0ZYXaehPSPmqF7mNsLLce6wlsBxteY3a7mhBeV7jFsLLEm/xLQHmcMtLNPRGDFrmJRYTZpZ6hx1JoHGW8grBgYSab3mF+wg2fVXeYHcSbtB05QVCIwg5P/MCjxB0pjS4v/1+7KDLXF9sAqHnVrf3MsFnh6i7K2+DH3Sfu7uaELTYza0jCB1kubfGfhhCb7m3BwlEfdVu7bAfRegSl2ZNJRzd5s5WEJB2irqxynZIQk+6sasJSyvc1/cEpue4ruhZaELfua2XCU47RN3V6bZ4Qv9wV7cSola4qR8IUue4KGsqptBO9/QugWpXyy3VdkYVes0t3UOwGgi6o8NJuEI3uiJ1ASHrL27oS4LW0cr9hPphC21wPy8RuHaIup2atuhCL7md+wheA0F3c9yPL/RndzOfEPaUm9lJEHuBi7GmYgztcy+fEsgOVG6lqSfK0Fq38jzBbKeYO6lKxxl60538BwFtSsiNlCYjDT3uRm4jrK13H7/4wCbbfcwntK1wG/sJbq9wG+fjDR13F1sJcM91FWoK4lCRm1hHkDvNRUSHYQ4VuoePCXTHuYZwT9ShPW7hPYLdwcodRHrhDm11Bx8Q8A5UbiDSB3louxv4iKB3oHK+SB/soV3O9zGB70jHi/ZFH9rjdKsJfkc6XLQv/tBeZ1tDADzG0aL9EYgOOdmXBMEzHcwaiUFU7FybCYSvcK4ZKETlTvUDwfBCp7oSh6jGmX4mIP4PZ7oRiXyNTlRGUPy8Ey3FotSo89QmYxGtdp5cAuNM5TRNrdGItjjNSoLj0Q4T64lHdMRZNhEgX+IsMxCJKpzkCEHyUie5CZN8Ieeo8mESveMcTxEod1ROEWqLSrTNKT4hWJ7kEGo4LlGJM+wiYL7NGS5HJmp0ghKC5ted4AFsaq/sr6klNtFO+/uYwHmW7akR6ESVdneA4PlRu7sWn1Ki9lbjwyf62t6WE0APs7VoZ4SiY3b2LUH0nXZ2Dkb5IvZVRiD9lX09iVIjbCvWHqWoxK62EEwvtat5OBWI2lMVAfUGe8pDqvG2ZGUiFVXa0W6C6mftaD5WtVf2EySwLrSfj9Bqof2MRisK281Jgusv7eYJvDrTZqwOeEUV9vIDAfbz9rIIsTorOwn5EIuO2smXBNn32ck0zDrDso8qAu3d9vEWav3JPkahFoXtooxge51dvIhbM2xC9cEtCtrDMQLuz+zh38g1wRZUJ+Siejs4QtD9iR08hF1jbUC1wy6qTbwiAu/3Ei8Hvc5MONUJvag20YoJvlcn2lP4NSXBVBZ+UWNinSAAX5dYyxDswsTqiWAUTqRKgvDNifQehs1PpGkY5oslTiOB+P7E2YRiSxNnPoq1VokS86EYlSTKAYLxlxPlfhwbkihtcYzqEqOUgPyrxFiJZJckxhQko2gihAjKDybCTizLSYS7sSwzEdpjGVXHXxmB+efxtwrNLou/WWjmi8VblOD8ULztw7Mn4u1feNY/3gbgGQXjK0iA/n18bUG0O+PrbkRrG1+dEY1Ox1M1Qfrn8bQe066KpxsxLWDFj0rFNCqOn1IC9eXx8waqdVFxMwDV6Md4OUqwPjpe5uAabY+PHwjY+6t4UCOQjRbHwz8J29f/et8RuAeO/VqlKehGKQd/naOphO++73+N3QGC+Hui/7+sHEL5rAP/fw71JKAfsVH9v6g9kwjsM58tjv2fYsXLswjyB13/r+eX/2vhMGr2f7P/m/3f7P9m/zf7v9n/zf5v9n+z//+HwFZQOCDQJgAAsGQBnQEqAAQABD5tNphJpD+ioSFyaDPwDYlnbvx2XDKCZA0zA0Dr7+Y/gB+gH8A9riAHr1OA/AD9AP6B5AH0AfwCNAZ/9L/J/+I/xngomA7T+Qf9m/bz7EeCfAjzJ4R/sP7f7Sb+n9Ffw79C/6P+G/IT6R+hz9T/8D8//oA/hn8w/3392/1n7D9wL+8+gD+sf579s/eo/ID3Qf3L7HfkB/pX/H/9/tZ+oP6AH7aerl/1P3D/+XyQfuV+4f/X+Qn9p///+8nwAf+j1AP+3//+w/7H/wT8AP2S+t3Mz8DvdHXFWAGmrcL7AZUUQBkO/1zAIeX/+/Hd+8b5kHYoCYxC4wC6moCYxC4wC6moCYxC4wC6moCYxC4wC6moCYxC4wC6moCYxC4wC6moCYxC4wC6moCYxC4wC6moCYxC4wC6moCKofujaTGIXGAXU1ATGIXGAXU1ATGIXGAXU1ATGIW5jo84SDjDWlKuYuMAupqAmMQuMAupqAmMQuMAupqAmMQtzMwmIGjgK8xiFxgF1NQExiFxgF1NQExiFxgF1NQExh/aiwAqqLmMQuMAupqAmMQuMAupqAmMQuMAupqAmMP6hrmnamPwPtWZXMXGAXU1ATGIXGAXU1ATGIXGAXU1ATFSvbU7yPzUzupqAmMQuMAupqAmMQuMAupqAmMQuMAo+rSGd+vckpXCDnH91mVzFxgF1NQExiFxgF1NQExiFxgF1NQEU3h/DXrpwXEWax4QgXU1ATGIXGAXU1ATGIXGAXU1ATGIXGAUfVpDShhZwp2uI58SMHf7TO6moCYxC4wC6moCYxC4wC6moCYxC3LEXp4MO+4fcMWRaN1GC9x1mVzFxgF1NQExiFxgF1NQExiFxf9rW7pvdbxt428UdShS16Ai8rmLjALqagJjELjALqagJjELjALqaeTZb3HM63vuH3Cq5dnWICvMYhcYBdTUBMYhcYBdTUBMYhcYBdNoLtWqhZws4WcLOEEIzEH+DR2ZXMXGAXU1ATGIXGAXU1ATGIXGAXTYquh3o70X+GMD0st7NTO6moCYxC4wC6moCYxC4wC6moCYqPRDO1/LLxt4beoM8Qc4m4CEkOyYwXuOsyuYuMAupqAmMQuMAupqAmMHVBHihrASGmDTBpg0waYNMDCZbT5OYL3HWZXMXGAXU1ATGIXGAXU1AS8v7kF8E8RVgeb5fcvuX3L7lJqQOyb9F207qagJjELjALqagJjELjALqaeY1u50C3Bpg0waYNMGmDTBpgYQZ6NzjybPCFxgF1NQExiFxgF1NQExiFxenq0hH9HmqH3D7h9w+4fcPuH3D3Kdqu0acG8xcYBdTUBMYhcYBdTUBMYhTr7tTgVj0jVD7h9w+4fcPuH3D7h9qSH0a0aOaJqAmMQuMAupqAmMQuMAupbOtoQn7nFz2U8weYPMHmDzB5g8weWf7o/F9fTtjrMrmLjALqagJjELjALptr2ePkROofEvwlVTuO5O9HejvR3o70d6O9FuxzmCICFo/U1Gamd1NQExiFxgF1NQExg6n8CxaJqXZIP93HpmsRjUUqKVFKilRSopNmjAKRwkHGK8L81M7qagJjELjALqagIpKf1iCfNgQdpwZla8lVTtPEHduNZcvuXx7iFxgPe6RrRqn5M7qagJjELjALqaeY1u4n6IzRAMokfZM7Yc4uewlsszvR3o70d58JcRbaZ3FBi5Lwfb3DuAFpndTUBMYhcX/a1u4n6JHUqhj8glJuH+z2yBfmaxJxc9lVRRSopUUp8lyLbTO6mojerRKaSeIB7v/SFxgF1NQExVFWkBQECF9gPN+csHpT7aSvJVU7j0zWHPBpBnG3jbxqAupqAmMQuMBR9GIV2oKSr0O6DsW2md1NPJSfRnoGvjfyNANTVDBYnyhmg1ryVVO49M1iTdLxAUrrMrmLjALqagKjI1/chF9Qch2yArzGH8pjcljTfOTDQJMb5p+JAT3PkKXkrd/LrXkqqdx3Jf1dpndTUBMYhcYBdTXy0BkFAEBXinpAY1IIoQYJKV9O+nUkyteSqp3HpmsQqCFZlcxcYBdTUBMYhcYD2pj8D7VhJwlYhvM4QbqUeUJ95+PD9oGUGZWvJUYusyuYuMAupqAmMQuMApNPhO9jzC/DV3w3Hi6uOSsKTJhRjqArcrXkqqdx6ZTXDIRELjALqagJjELjALikDnlDXM7pxSZAS9hr3nbIwRO3lqcUBtpUvp6Jxc9lVTuPTNYk4uL7b41XK5i4wC6moCYwfmgtqleBbYj04AmMQuJ+egz4WehlKI6rjriciMIkOtB9QGA8k9lVTuPMXrXkpFEARbaZ3U1ATGIW54AIucQKDCbOTyMAupqAmKrUWm8/8RDQ+wH82yw+JIlbsZmVryVOkdu3iz9fFYHMymd1NQExiFPWgtvwelsSQc5jELjALqagJegvLT9dDuMdU09fFSwx8TXUmgMCXQcs3A2s7cBnKF0ab3HWZXL/CDFwfS2JIFYnlcxcYBdTUBMVXJdcTqKQk5UYRCjE1fUBgQ/aBlBmT5Qntft7pjELjAKRQijFqWschcYBdTUBMYhcYBdS3XmSOq3MdiEEiPl9T0ekPphKnRDgctM9BCsyuQEzGG3tczupqAmMQuMAupqAmMH/8C2GO6AaECyuhwZlEVyzguoxDZFV8UjALikAFt+KflcxcYBdTUBMYhcYBdTRiotB9FDxps/nyt5rEjV0jT6upGRixAXTfAU/lGADFIpGAXU1ATGIXGAXU1ATGH9CpA0wtLIxMT0Yc+YvWvJTzB47pjEXkyrKigfkgwi20zupqAmMQuMAupqAmMQpr1JY6OrZFCzdbZeiQNMxgDrKqagLGAy3tqzK5i4wC6moCYxC4wC6moCYwdn7mZ6lXVDTJZzwtNS5Q2LmiuAp/AtwviLbTO6moCYxC4wC6moCYxC4vR8BQM9Q3+WbfjbxFqSwFIoRQPyQYRbaZ3U1ATGIXGAXU1ATGIXGAXECt9wvaACrrBI1iPKF3Bzvi6g67HcD8ftM7qagJjELjALqagJjELjALqW68wgvSFAAWUU+/E8rqP6U9uX5XMXGAXU1ATGIXGAXU1ATGIXGAXFr0dagtFpnyKKK9vAXU1ATGIXGAXU1ATGIXGAXU1ATGIU1hF0ZmVCr4xiPifHsp/AqeI7qagJjELjALqagJjELjALqagJjELckbDlD6/BdVvkHE37i4BXmMQuMAupqAmMQuMAupqAmMQuMAupacsyaeun2iOslrFUop8L/E8rmLjALqagJjELjALqagJjELjALpsIaJ1/1srmKYF81RFndTUBMYhcYBdTUBMYhcYBdTUBMYhcX/bxQgo6Q7DiSmz9cqF1NQExiFxgF1NQExiFxgF1NQExiFxgFxAiz65u6ulM6ILb8WIF1NQExiFxgF1NQExiFxgF1NQExiFxgFxIu+w+j4iEMj/80BP5XMXGAXU1ATGIXGAXU1ATGIXGAXU1ATFRpFEKex14PS7gdATY0QuMAupqAmMQuMAupqAmMQuMAupqAmMQpw7OGEFzmy15jELjALqagJjELjALqagJjELjALqagJjCAXpRX477VmVzFxgF1NQExiFxgF1NQExiFxgF1NQExh/MrY4JzV/xw3OzupqAmMQuMAupqAmMQuMAupqAmMQuMAupori8omUXpt+8yuYuMAupqAmMQuMAupqAmMQuMAupqAmMP9yV7Feel0s6zMrmLjALqagJjELjALqagJjELjALqagJjELjALqagJjELjALqagJjELjALqagJjELjALqagJjELjALqagJjELjALqagJioAAP7FzQAAAAAAAAAAAAAABdGJPp1NV+zG2bLCQXvIX5kF2Jbm4aNgxXXPsRu5JXnFJbB69pUT/mdWQI6wAAAAASLucqlmZdVoQbPA7Wfmztr0fwg0K3UJ/OC3CsNyFkBn/CIE9QNFXxFKHHMg+8GqubKcFWu4FXsCLMaR0Redq38gAAAAAjO7zhJrUwIbFm+3vYTh3aJlyUQv+BNyBNyODBEHfFIeL+QDQ1aYpTkoBobL6fU9jWVmd2XjMAAAAABrKToLjJc2iLR60lfHfzxOyPH65eoL8XnaS5ESh3ZHSdYWiLznLWGVADTgkfAAAAABZqcgW0DrsvPaYSfFgw0rGt65vwq71e6VeAld4H+oOuAGkKYViJnWaJ2V18qaSmWvzidOfUg2oAAAAA4+R1mjfSy5iTaTCFZxN0eVlNTRIH0z51SOu6oEql5dZhJ0RUX0tn5LOxvzsK/nvSrywnHfb7spZ/mvIAAAAAIvuuA9egkWhhnVvPnMcDgTO9eB63tC83c+vh6Fa0Y4al5p1XQ/I9gDVZn/urdWXVDqGKV4NLi5gxvtEd02JgqQAAAACbQOhlJKVFMQQccdGWhdq2TQanSRTCCfz7fXwI85+35dzzNYNrcAXbsteLHt+84yDRA4dyWQgc26eQRUum2RLg8GqcAAAAAcTpQH6oOHjW9A3x9Wke6aWR8rezAS44fl9HWgZZ7WTF3K2vPCNOTUq8q8Z95PTpwf8lpS9LIb0hrF7rtfZgBe3wWX94qHVEVpe4oAAAAAUwfSbKL7dnH4KTFTC+tuZkJs7K4ZcmqwoSH57EjwUgP3sew3M+mr94f/aPEzf/JmDXYqQpRj3Gsf4OCSmKrsqVEQAAAAJOlSAOhiuOMMpRO7Wpd1HxxHxVxTOZhX6+T8FbfpyYApr8XbRTD1unqpdjxtJF9rmR0Nvo9gnlEGeiXVS1Al3yWlG6rCH5460VXxAAAABALZRybEUwv1A547+oINWKKf/PS8QaqrZmAx3Qd9Ke3hmF04w/cm64Q0kz6Wwv49RDnKG36AxORYI8Np7PWpWVctSmsqgd4O4AAAAAg8Pehs58NoxB7PQ6rEP6bvnipeFHH6TsoSTmetShqSkrZoCEsb6Nbdj1pR1341xTlhwBR9CbRNF28VXptEjW92Z3vIxMgRiRNDzNBgAAAALOhHz3KjSQptblTNiApQ9dHITn7AoTVJ1gy8YrQfQwArYiZmvqVhT+dmRYxlcNKosjvuazEOwsSkn2ad3sRWi1y/KXgAGTK1GzXzFUSgAAAAF1b57AGBqSXEb+wov+AiKIq3IT7F0OB6Keb+oxEYnizEwgn9Vf1lQ4E5hsgfYUZPlbgzj0T+zF5bxq7xRZ6t6mELGhao+aj55/+wJAVFRyw/IgAAAC8uCZG0QC6RpA1JlSG61WecXFmdtN29tY+rGLMw3MZmLVuRXBiQvD0SlhwsHJZLiIRMP89Hgz83Ktr7QakkQKQVyT2CUXxFbF+3IXknrge2SJUyess7dRj8y3ZAAAAHlg2hISxmOqfR28baV/oW0aWhVaVbDDKfKWS6IXTsJ1S0dAkw+ka01EbjZk3x88g3dxJvFCo5a3xmL+lR5WCpf9jYRl/oG4RlbBZTsRL6IwKFTlemkcl0ZbpMs/J/pNSgZsQAAAwZsol1lvNV/NXqF8GXoY5pnSgqHZyfVucVbAY35XNsxEv3xHYEYu9dfpLBOZ5DTEAvy9HMBf0p1HuihRQEm4xG2UnYkpB5Kj0xbgyl/PuYdYxv88e1FFiQLYFyrwEJZ6xj6EKhXzS/VT6k92sEAAAfnQ/QlXOAPjoB5ZbIfFyIqD46rm1SMhJ0P9ZQ75i5UnV7YGenpDjfhC9KoSGTgSYj6w2FG9Fhq9nymwJBiNu7yiO7lH9RBAMG3mYudyfKZQGXpNSEV+V4utELayzeZs1lHIERLWFyj2ibNvbnAIJhi6MilrCrgAALfiYXRaYbn3Iwxzw7jn4D+DYCE5SgXYpne//LIgfZfbFQTLuSGZ5yzclf2X3ANlzxksdDU4LY6hWngsO8blLlCzTALvk20dXJSsZU3LjmF+/V5TbbsXYW4kqngZ52GOzLhMSBmWzWUdqjzgSQon08LafgMi5vUnBXX1hbWuWZ3DIAADjsRrVSmOlzdBmW+oEBgF/K238XLMvETAhfelTtdMnrZDEXx5Q1g8Fo8xh0VXhcct6XIPE2PMEYmWgwpXxXubN5/lsASSxso9CMs00+VqEJDttW7568038f8qv+/KG5OlGma4f6oDcSb/4LSXzwQeD/PnSAo4wAAEpmiGXRpmjYl/CYxxr9Gzsq3AzSQzlIJKcOrPs55c4d4/quiZDzQlJIiptSt+qx2tXBgLcVLG/awiPMrMwlpRUmuJqah5ll3QMmyzKA/U1EfY04klJUB+QbhVlpySduqyX+Hn/nkWuumIzS9rgMNrZ7Vv8X0MelokJx21X51Wam8Ol4AWzJhFgAAJ07gAJpZY3UHfGGDMgltxg/+VoLAmTNdbjmforlLUePm+ll9z2OfMNEWSdnQ/VYyRVOruQ2mc20iimRO2dBweP1c2a4uHcHbExMNwyE1cEjx/IYit6CLwifdaDG1aP7yATeUMmqyAvbjtS1AKFslpAq7Bf0WJs44G67Z3jZkLEriPW+CAq/tP8kSoMXZo5T4QABKLVFLZAS8D8/8wR9cofkKsda3BMZsFdAK/gjDfA8V9+Kkpclq0h4T1CMKKhAJEh/KpWG4VBS7tqc3jRBHXzpkHfboKrd1sX3cxBxt49s+z+H5a4tWq2G5yfyO/NWy2sXielx9fDWoz52FiHEdwG708xhlooVvSftDUfnXreQ2HxC0f8zFO2CyXsJCedkJx59WX/BaS+eCDwf586QFHGAAL5sqKEKrAx45Bl3Z7LOO80Pi0h/w8SHLRCzTG7Qa+tdA3+yMJ2b8ZY24usgWj8ucujczt0Kf525sgiSBdjxrpCUxWWvcxUom1xgWq1TjNIEis5hSzzdqGJzyL1w06fE25+pzKovQZA4PDqLbmnLvgv7Mv3Gmm2QP3Z9ZkP6A52cJWqqYX82TmgTBTVeTZGzG9Rdl7nc6Zq/Dh1HvuIwQ1xCV0cl9Vf13BZrpGC2XuAv/9qd/n3MNN+jZa5AA3nJaI+0+1YPuQAE4c0+vOnsQ+UoACaw7p60XyQG7/3RAY++UEbwP7tRj+5UTKWt9jYx4jsK66OKhed/10bEvJjjSkEk+ABP8eFxzEOp/UgQU7FKivE3AVKyhVF4+fI9iYuBsBgC7yHIRBnQDdbn9XnKLAreRKGyHtHXQ4UzbuBs/8ZZxwAEK/zHSg1mcHRhaZDLhMSCIIvL767kjLbNnCiJc/xb+E3eOR6EoPzxBa19D+d2NLI8YV2dkGU814ElZdSyiZjcO1CMaqBk5o20w8AOSJ0rBZXVu39zghuBY6bFpBHmKyUPvXBCnk8ZYxnWfB8IK4Ko7QsNoF+84r7+aZg63E8E9kfC2K5av3wLCNLAQUaLCnMT1qsy1YtbhAdEwP7tc7hB2UGHxOwaloxvlEL4szJg+1JTaD6EcWZyroxiZC2l1KM3KA2alFLZ0PesjEt2BV4/1690U5X9zLz/Tp6sxhIAEWYYiecIonPaYvuEOlkeMKmUc8i9SbCZjcOtxxC0eZCNkpleuaAUF5JTsKmk194LP8/WDrgObTTtuoHhREzR6e1dzUoGurnU0U7FsnAOQqazpXsFH87vHKmuWQN91nLSSrZpOPFINGUZ+GXUq7+UoshlkVB1PmTHnlyRwpmFVYxdc3y3rDhMBJANO9u0JRGsfm/8ylH4wgqhsAEpTSSaIZKG9e0v48UB67oqwO0iDCsBwRA4pxKOCbL9QI04vZOF5+078xMdh0OBRtPKZCIYxGFrN/3p+fWz/m6V5Be1Vz11Qr21Onlk6ya6K6qXyEAABLKEY2Wzs5WCmCH9DWEN1C2un4gW3WRoNsLVYbp0LkpkdiC8kpyoeCdmd7C5vlbBtdegd9p2Zdb7l2HKc4+kPJHU7cwBXUxDf60D386aP0RsKZ7Ffnz5E0Wh+PLGJILTuX7vI5x7KrlRjUwEV7Nad+4qHYBTLkP92nvRQZv3yWKlbhhGCjVGSE9fQHSb0Krsl5W06vS4+nVLpOYwiyibm7ngAR5islmr/U2U8XK3Dt+V7HIqdttUHI67zJ5mFgfD03pgvYthGDxys/l47TOr9u0MZEQteZZTRfVmt95PVAxVUHybnZLzMDZqYN000d+Srhxx3BpnoBFFp4oPi+3ZLKpdAAAKr5m9X6IYuTlim1isDUI/Z0ULp4W6Vd+gYhu/l8qm9bN6TMwFZPxvzWjzj4uE2RPmYiyInMjhueNsVi0pmpozoYGkDomcg+kEsz5MFq9u7j8kbpX4y1V64tTbH/g2ehSOM8B049nSd0nrjKNl4V75uOvLIxBpAyjiVQTEKU36IR5VW/zG6urpsibW39ihcVYqKRYCWmxPBn7P+eyBbybAr+DwCxVsI93UQUahj/BhrKsg+ItAAAAQvgd2od/UJK73E/fyVNDazbwUM7zpw9+glxDIN/P5i+fGDcleEePAPKpjJAB43SdaFvLfOk5bKF10p2qOLwlrI6de0pH6miPQnIVjOO6Z5359t20tjfO6OgJhHVAc/jMjpACPOG8ly3cCcIlrt4DIPWh6Q4AAZcV9sJQ0VeTLLVn+VfwCxDJlwQvh4Bfnm0P+y8izqSD+fJ8w3A/D105Me46RfoSXzQfqrV3DiG0KT4na456rqPpw/w8ADz2xOSzCQA7H27iCrvEdJgyC3BQNh+9nttsJ9Y6zwiV2bKwX66m6Vm3vfN9nVAtSN5oizGuuI4t3NxZV8KMb7yYAQ/RxjBG1UNLtt1JCgaHi8ZfJhvhzSuC8OyerfpEUuEv3WLGiHxGbqv1xVwP5QhosH3US85zn3UiA+yaOJwAGBgvW++LS3Jcm6Xv2YYpKbQU2+I150nsVp5Ynj0yyH6Kux8OTsH73BncIGd/bHjobN/oMufLTfaouOV+dBO205r/u2VXjChzg2Pm91XRqfd23Ahm9FapK3p0w8R/qLekgMOYOiWk9CalnjQ1ZakYZbveSs+h9W5nbYN+/GK5DkI5GgI2RnzIGKglbmuTq+AxMpsyV7XXz8UKvm2wysZBDbh9FSYy82fy6zWvW2JZu19L06rBhe/vpa/zrtq9Sbhv4L510GuM3/j/K5x5Z/xYW0VRxiN+2N7WtX9eHleip8ukG5BBA/cslYsAV60HjGJqZr5LEEciCQPiCwARwGboQ71YfcOPIPcqgnbJko7Cs10e+6t880ldk5tykSkBduNN4QanS5ggxfDQIFn3VqY3CnKEKZviiQD7lfNHQYTKngbMCS8h6Ni9U6X1i8Sw9Of1PSfMqm6bWe8bvAKHQys2KakQAAOkyKBFJstxCb2pNzzP/1LuJ9FTjmvu+p39MvzBGk3K+BSQbMNlXSzJrfTE4rZNXAxSkc2B/5yvf0/ZJZk/YwicDPf9ez2MiEvRQ+V1oZki+6aI8bgxyQibJ8uQ1oRjJohOTrRvC1aYkn3JWHZcapaN/DttwSJJwer7sSF7TE0iXKHAGeg3ak5WBVnfUouVz6TIMjfSvRrzpPY3Vuuu2fdcH4hqobcBoIL8+96lAK7hc5R0tzMmz1Qbdat5ZpyT0nZxO8KOtBH+klVqPxhSph4QZ6ZHpmP2D7hPKUc0JSkZnyAAcKbTmbUg3KRRNc6l8TIjiodbN1oRfzmsm/CFlJRRY5fFwXvCQwmPqaVyhvsOB5BJqPEDnI3HfIWAnInCfrWKtw/1CS/3QdVRZtyiHs6cLa7+YghiIhntmOq2JXf9M1NTqVry60mcVhih8rhwAkQGS8u6+dKs76lFyufSZBkb6V6NedJ7G6t112zVQttNaHLvKqIfGksHhJGcuxgZ8E6dPVAhVVD9wz5Il1Y7pUVX6DI/Qwfx3mqVARngPsCecvQPpgAABJeFnbRMDvJ+z811UlJCFWEt50RR4LVjbqbp35wTMYsBfVTXI7r+NCLe5CwzRW3b/1DPhbjWrNPi4b1G8KVbpHp0puCZjXprlPyYRMdfyp4UtzfTxLFcRkCALyYx8zVJmTu2vfkWLD/Z0U7UDO4d+eLgkO10JqUWxJLXx9dEFoLh9vbM/anxnn8ZwJLz+CdhnlH9m8v8Tf/jWFVxaKrMRyQ97E+3DkZfI1FB+fcIM9v3lMj2Enm5NuAABuhdUv8vZ7Wb6We1cv4Dzun3o3aGxQ0E3LeY7nYwKLRXj4qRXRWp6AizKkfv4TRBTDLwGwpL4ELOCUmJ12iJ+DxHZLnpcAeyXQaFTwYAPfFLspMjh+ZsDDxLQn5UK5KNChzZu3jUcfb5x5qx3Uz5V2cML1AKvmlYG4dI+I/LN44KOyy8D4QPWKsrgifDRQU3/DZ40TT98AAAOO8jlHmBcIcIaWA7r4L+rJe9816hpB69W9D9+cHKcFrxi3TPV5eSx/yXKyjzdnc3TpIqTjd0Ugl1ZV4tD4TJ+/c0wi35lXiZ8Scm9WA1dl2Dsi60CSQJqQhnqWtFt4HYJyzJI3FX/g05I8qB7PH8y1xY0ln+l8bB8mzncoAy7Kf5cNf2d/9WDifzgLbfrMGNI/ahvwjksE4FZb8+BgAAICklptLXYBZsAh0eKTfQoumG4WA5lCPRLmToAXfMjgo3Te0PTljcwXQ22RDEEFsuFPpHUZOMI7B1sN6Qk34IT5VBov6Jbyz+3OY4CMALQO2DQ776CKuLFJyep4ZkhdXSG4aOgpeqxf/ikhfrJ3gHMmKN5Pdm9Cx/G2lmqYujXw4Pyzddcv+TGiQYrKs58paVCAyGoAACTicSiV0k1etNftTi0THZV51jsoAXUEe1twuUnN758Nucz/+kjp+hieo2PF2eaklGRcc3e/DVfXaZIrrnKbtaQ0rV/zF9Zqtgde9yz9BJ+ZO+EzA4M6P/brHQMW6SweEkXmiVEOjBKRxXwvtlswTYJzgAAGmyn02GSVZkJj8PuiVe7Z2plGVvrKvvzr6OIjRskEC31b624/EDiiFaweCV/3jfpQuewC+YtrjZ2YPGlInq9JIStNL33ZjY2u2OVeczqahQ+3duS5NWy4qdunyddepHJS85WDU6XMB30zNLkVnG8W51WWPloRDAa2wBL5uzoMSgNCCKQAAADg9YDXnpnpxJRAzAuUsuAG4Y1jBQij0CWbFaFavl4uBjzSnKax2yE26DcMPq4C5OmxsUgzYgl16mvZjm5+NZU823R6gNWPyatlxojxgdvMHxyLKwZXfKNTpcwWC11sZAo4jaQk6JCOP/wJr//gCNbkfJ116YItmxo8rmFEiC+AAAABtq3QHVWHYVtakKprgyeYkhDhSBLAoYMpfYh+rXOuniHkAD3UqY5jIJWGzrd1itz2W31ZVP7qAuht3RzfE3raDm734aYVC7Tee/5i+s1WwOve5Z+gk/MnfCZkr2L+OSW3RcLmEoih6gbIT5cIITIGu4OsAAAAD/Hyk+IOs/HNWPN/wysJvVEKDxEFMyytWOB2566eshs2Cr+m70TjL7Ky1sMtFhUrRcnifbLro2sBq8Nv/8iQUkaRZiJrXqnIVAW3I1oAdfIWzqkfuwqf0oIixYL7Yr9VLlAXkiHAAAAElHVaXLr8YPhA+nhbpQBKq+64Safo6aLHErGvCwI8DdfU6H+8k+Nwnix9WeMdZgJUu/P8aKtl/HMHN3vuzGxtg04rp58e2XXU0aYDbF0yMPhIxDmRIag8r6WXQLLPmye5OuDQr9adDRqN1nh23l6oPNHGAoh17juS/6oiFLcQAAAALAs7DV1bC8CZ5fjNUPKdTsK9xpbqD5uJeYJBa4YXht/qy1DwjzmEOBEcdv1vGplXxXTANIEQ0A/hqvrvXo6xlJIXk7f2v+g48qFVu0u92fi0ArLKkHhIdpfn64vDKnf1APOmR3h9n4TC7BQAAAAsruUxBqY6Qm7Rp9yecn8wfl82rZtZswpcIPFzk8Rs8AfVBx9/Ex2IGDVXp5V7RTCwcUrTbP1UxZuXFUoM6FJNj1ObkkyJ9etGPbf2qYi+nL67MhZAPqRtJ8zlAAAAOjCBLlL3ylj/7ZX/OZ5fbQMUczLKJFQs/IRe6Dyv1+MjtlJOvcbkN8NOI884xeu0i1/FHQGlzHhNADNmHsLZv0eHvk0QUp/p63uAG+JoaiMZmDw4XYs51rlfmTApAAAAAFmGovmevYFJHz4vTAbpApCBsDjPw3cj1corE00Mpw00zSfiE9b06FVuq1l7Mc3e/DYojRoWC3WkK4P7IMRqYwefSO63HnM3UFyV+Kxmb0O1DSshraZkNTPK9AAAAAYnSA766/4AO58Rzs1VujrjwS1xJMx9OQoqVKY/6r454i6wdmMe4jGxkRrHth7IFY+O90DWZLyvcaEYhkczS9FpQM6qJtnUAfADlWiaeBa3k+2lwId7mCwAAAAAS5TlyJXeUTJdx32VEZbAD0M9HiYCl5Tt9EfAWjj8uCC479zdd80xuBEFojka+dye0gfgE6XN5yPffOMTe8NcIjac4AVarOUBxas3J8mZUI84AAAAGbn9wsd9pi7tEK7/VlneJNtSh6k9aNzUs5TRVildO3xIRBRrMSVwQ9/2qFRwRtkaBthQ73G3dKcUc2XfQYTqxJYZkV4YJCUzaGG8WoGnUJ6gAAAAAAeRO7ek6cLYKq+D8p0D7G5tuqjlTiwH8bb9cNpObIosCGy+NOWAjkJio2+yy1rKKf//i5Swgbcrf/P+MiHF3av1KW/PFXcfN+bf9jFw48ARdOlgAAAAAgMuf01/wAW8ggvoQRW7Xeg/NaOfhz4rCixOLsgpNwiVCeAUrMOjeRRHrNtvzQe3lfqm3ulKZS2Qv7wF1JFa3O/HZs2vYnpKCgAAAAAoB0r9faQiD2U6huzDLQtpR5nQYPtInAftfiHyZDxvkmC4C/acoKP2JPGbtTSl5XQmlpeFUGJ+cAf2F5izQtPgAAAAT87CelyMKSgqbqPzZFsQ9A36u6PfOQQU9xArS73/xDXGTeKLLpmbn/o9GpfqUUVj8AAAAAaihGNjkNEtodVkGfSN9KUOdmAO0i3eQkLqCuofxWfYfkaVIe1Dzfjm2sxIAeVx7QlZ09BzNp7I3HxgbvV2lULgAAAAAJTINw29gyrlwW8C2WxO8pTITen2/9KLJlRw+G1WmpV+nv35WeP+7zmZ4Wt2dy3p9ymS3Efj6UUwAAAAAShjms6sJJRgV2UHFxKOuf+jr0TigA0FkA2IwQbAudTxCknUubGTmGYp7VLBH7mFL4KXHc7/7Ga2XGLegNl8AAAAABfmXJR5hkYP9/dYS/xHx/dt9kOBlUtwcf/m3gKo6Cd7sjQ37+ornIbn8Dh/9ViUas5w/9/Xs7NCqW8AAAAAAAAAAAAAAAAAAAA" style="width:45px; height:45px; border-radius:50%; object-fit:cover; border:2px solid var(--accent);">
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

        // ==================== LifeOS 图书馆功能 ====================

        // 全局变量
        let currentLibraryTab = 'reading-room';
        let currentBook = null;
        let currentReadingPosition = 0;
        let currentReadingPercentage = 0;
        let currentReadingPage = 1;
        let currentReadingPageCount = 1;
        let readerMode = 'scroll';
        let readerToolbarVisible = false;
        let textSelectionToolbar = null;
        let textSelectionInitialized = false;
        let currentReadingRoom = null; // 当前打开的阅读室（用于区分普通聊天和阅读室聊天）
        let snapPageTimer = null;
        let isSnappingPage = false;
        let currentNoteDetailId = null;
        let currentBookMemoryType = 'character';

        // 打开图书馆
        async function openLibraryPanel() {
            try {
                closeSidebar();
                document.getElementById('library-screen').style.display = 'flex';
                document.body.classList.add('no-scroll');

                // 加载数据
                await loadLibraryData();

                console.log('[图书馆] 已打开');
            } catch (error) {
                handleError(error, '打开图书馆失败', ErrorLevel.ERROR);
            }
        }

        // 关闭图书馆
        function closeLibrary() {
            document.getElementById('library-screen').style.display = 'none';
            document.body.classList.remove('no-scroll');
            console.log('[图书馆] 已关闭');
        }

        // 切换图书馆 Tab
        async function switchLibraryTab(tab, el) {
            try {
                currentLibraryTab = tab;

                // 隐藏所有 Tab
                document.querySelectorAll('.library-tab-content').forEach(el => {
                    el.style.display = 'none';
                });

                // 取消所有导航项的 active 状态
                document.querySelectorAll('.library-nav-item').forEach(el => {
                    el.classList.remove('active');
                });

                // 显示当前 Tab
                const tabMap = {
                    'reading-room': 'library-reading-room',
                    'bookshelf': 'library-bookshelf',
                    'personal': 'library-personal'
                };

                document.getElementById(tabMap[tab]).style.display = 'block';

                // 激活当前导航项
                const target = el || document.querySelector(`.library-nav-item[data-lib-tab="${tab}"]`);
                if (target) {
                    target.classList.add('active');
                }

                // 加载对应数据
                await loadTabData(tab);

            } catch (error) {
                handleError(error, '切换Tab失败', ErrorLevel.ERROR);
            }
        }

        // 加载图书馆数据
        async function loadLibraryData() {
            try {
                await loadTabData(currentLibraryTab);
            } catch (error) {
                handleError(error, '加载图书馆数据失败', ErrorLevel.ERROR);
            }
        }

        // 加载 Tab 数据
        async function loadTabData(tab) {
            try {
                switch(tab) {
                    case 'reading-room':
                        await loadReadingRooms();
                        break;
                    case 'bookshelf':
                        await loadBookshelf();
                        break;
                    case 'personal':
                        await loadPersonalData();
                        break;
                }
            } catch (error) {
                handleError(error, `加载${tab}数据失败`, ErrorLevel.ERROR);
            }
        }

        // 加载阅读室列表
        async function loadReadingRooms() {
            try {
                const rooms = await dbHelper.safeToArray('readingRooms', '阅读室');
                const listEl = document.getElementById('reading-room-list');

                if (!rooms || rooms.length === 0) {
                    listEl.innerHTML = '';
                    const parent = listEl.parentElement;
                    if (!parent.querySelector('.library-empty')) {
                        parent.insertAdjacentHTML('afterbegin', `
                            <div class="library-empty" style="text-align:center; padding:40px 20px;">
                                <div style="margin-bottom:15px;"><svg class="icon" style="width:2.5rem;height:2.5rem;opacity:0.2;" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg></div>
                                <p style="opacity:0.6; font-size:0.9rem;">暂无阅读室</p>
                                <p style="font-size:0.75rem; opacity:0.4; margin-top:8px;">点击上方 + 创建，或在阅读器中创建讨论室</p>
                            </div>
                        `);
                    }
                    return;
                }

                // 清空默认提示
                const parent = listEl.parentElement;
                parent.querySelector('.library-empty')?.remove();

                // 加载角色信息用于显示头像
                const characters = await db.characters.toArray();
                const charMap = {};
                characters.forEach(c => charMap[c.id] = c);

                listEl.innerHTML = rooms.map(room => {
                    const char = room.characterId ? charMap[room.characterId] : null;
                    const avatarHtml = char && char.avatar
                        ? `<img class="reading-room-avatar" src="${char.avatar}" alt="${char.name}">`
                        : `<div class="reading-room-avatar" style="background: linear-gradient(135deg, var(--accent), var(--highlight)); display: flex; align-items: center; justify-content: center;"><svg class="icon" style="width:24px;height:24px;stroke:#fff;" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg></div>`;
                    const charName = char ? char.name : '未选择角色';
                    const msgCount = room.chatHistory ? room.chatHistory.length : 0;

                    return `
                        <div class="reading-room-card" data-room-id="${room.id}" onclick="openReadingRoom(this.dataset.roomId)">
                            ${avatarHtml}
                            <div class="reading-room-info">
                                <div class="reading-room-name">${room.name || '未命名阅读室'}</div>
                                <div class="reading-room-desc">${charName} · ${msgCount}条消息 · ${new Date(room.lastActiveDate).toLocaleDateString()}</div>
                            </div>
                        </div>
                    `;
                }).join('');

                // 初始化长按事件
                setTimeout(() => initLongPressForRooms(), 100);

            } catch (error) {
                handleError(error, '加载阅读室列表失败', ErrorLevel.ERROR);
            }
        }

        // 加载书架
        async function loadBookshelf() {
            try {
                const books = await dbHelper.safeToArray('libraryBooks', '书架');
                const categories = await dbHelper.safeToArray('libraryCategories', '分类');

                // 加载分类筛选器
                const categoryChips = document.getElementById('category-chips');
                const chips = categories.map(cat => `
                    <div class="filter-chip" data-category-id="${cat.id}" onclick="filterBooksByCategory(${cat.id}, this)">${cat.name}</div>
                `).join('');
                categoryChips.innerHTML = `
                    <div class="filter-chip active" data-category-id="all" onclick="filterBooksByCategory('all', this)">全部</div>
                    ${chips}
                `;

                // 加载书籍列表
                const listEl = document.getElementById('bookshelf-list');

                if (!books || books.length === 0) {
                    listEl.innerHTML = `
                        <div class="library-empty" style="text-align:center; padding:40px 20px;">
                            <div style="margin-bottom:15px;"><svg class="icon" style="width:2.5rem;height:2.5rem;opacity:0.2;" viewBox="0 0 24 24"><path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"></path></svg></div>
                            <p style="opacity:0.6; font-size:0.9rem;">书架空空如也</p>
                            <button class="btn" style="margin-top:15px;" onclick="openImportBookModal()">导入书籍</button>
                        </div>
                    `;
                    return;
                }

                listEl.innerHTML = books.map(book => {
                    const progress = Math.min(100, Math.max(0, book.progress || 0));
                    const statusText = book.status === 'finished' ? '已读完' : '阅读中';
                    const finishedBadge = book.status === 'finished' ? `<div style="position:absolute;top:4px;right:4px;width:20px;height:20px;border-radius:50%;background:rgba(var(--accent-rgb),0.9);display:flex;align-items:center;justify-content:center;"><svg class="icon" style="width:12px;height:12px;stroke:#fff;stroke-width:3;" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg></div>` : '';
                    return `
                        <div class="book-card" data-book-id="${book.id}" onclick="openBook(this.dataset.bookId)">
                            <div class="book-card-cover" style="position:relative;">
                                <svg class="icon" style="width:1.5rem;height:1.5rem;stroke:rgba(255,255,255,0.9);" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
                                ${finishedBadge}
                            </div>
                            <div class="book-card-info">
                                <div class="book-card-title">${book.title}</div>
                                <div class="book-card-meta">
                                    ${statusText} · ${new Date(book.uploadDate).toLocaleDateString()}
                                </div>
                                <div class="book-card-progress">
                                    <div class="book-card-progress-bar" style="width: ${progress}%;"></div>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('');

                // 初始化长按事件
                setTimeout(() => initLongPressForBooks(), 100);

            } catch (error) {
                handleError(error, '加载书架失败', ErrorLevel.ERROR);
            }
        }

        // 按分类筛选书籍
        async function filterBooksByCategory(categoryId, el) {
            try {
                // 更新筛选器状态
                document.querySelectorAll('#category-chips .filter-chip').forEach(el => {
                    el.classList.remove('active');
                });
                const target = el || document.querySelector(`#category-chips .filter-chip[data-category-id="${categoryId}"]`);
                if (target) {
                    target.classList.add('active');
                }

                let books;
                if (categoryId === 'all') {
                    books = await dbHelper.safeToArray('libraryBooks', '书架');
                } else {
                    books = await dbHelper.safeWhere('libraryBooks', {categoryId: categoryId}, '分类书籍');
                }

                // 重新渲染书籍列表
                const listEl = document.getElementById('bookshelf-list');
                if (!books || books.length === 0) {
                    listEl.innerHTML = '<div style="text-align:center; padding:40px 20px; opacity:0.6;">此分类暂无书籍</div>';
                    return;
                }

                listEl.innerHTML = books.map(book => {
                    const progress = Math.min(100, Math.max(0, book.progress || 0));
                    const statusText = book.status === 'finished' ? '已读完' : '阅读中';
                    const finishedBadge = book.status === 'finished' ? `<div style="position:absolute;top:4px;right:4px;width:20px;height:20px;border-radius:50%;background:rgba(var(--accent-rgb),0.9);display:flex;align-items:center;justify-content:center;"><svg class="icon" style="width:12px;height:12px;stroke:#fff;stroke-width:3;" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg></div>` : '';
                    return `
                        <div class="book-card" data-book-id="${book.id}" onclick="openBook(this.dataset.bookId)">
                            <div class="book-card-cover" style="position:relative;">
                                <svg class="icon" style="width:1.5rem;height:1.5rem;stroke:rgba(255,255,255,0.9);" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
                                ${finishedBadge}
                            </div>
                            <div class="book-card-info">
                                <div class="book-card-title">${book.title}</div>
                                <div class="book-card-meta">
                                    ${statusText} · ${new Date(book.uploadDate).toLocaleDateString()}
                                </div>
                                <div class="book-card-progress">
                                    <div class="book-card-progress-bar" style="width: ${progress}%;"></div>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('');

                setTimeout(() => initLongPressForBooks(), 100);

            } catch (error) {
                handleError(error, '筛选书籍失败', ErrorLevel.ERROR);
            }
        }

        // 加载个人数据
        async function loadPersonalData() {
            try {
                const notes = await dbHelper.safeToArray('readingNotes', '笔记');
                const finishedBooks = await dbHelper.safeWhere('libraryBooks', {status: 'finished'}, '已读完书籍');

                // 预加载书籍信息用于显示书名
                const allBooks = await dbHelper.safeToArray('libraryBooks', '书籍') || [];
                const bookMap = {};
                allBooks.forEach(b => { bookMap[b.id] = b; });

                const svgBook = '<svg class="book-icon" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>';
                const svgArrow = '<svg class="arrow" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"></polyline></svg>';
                const svgNotepad = '<svg class="icon" style="width:2rem;height:2rem;opacity:0.2;" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
                const svgCheck = '<svg class="icon" style="width:20px;height:20px;stroke:var(--accent);" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>';

                // 加载笔记列表 - 按书分组
                const notesListEl = document.getElementById('personal-notes-list');
                if (notes && notes.length > 0) {
                    // 按 bookId 分组
                    const grouped = {};
                    notes.forEach(note => {
                        const bid = note.bookId || 'unknown';
                        if (!grouped[bid]) grouped[bid] = [];
                        grouped[bid].push(note);
                    });

                    // 每组内按时间排序
                    Object.values(grouped).forEach(group => {
                        group.sort((a, b) => (b.createdDate || 0) - (a.createdDate || 0));
                    });

                    // 按最新笔记时间排序书本分组
                    const sortedBookIds = Object.keys(grouped).sort((a, b) => {
                        const latestA = grouped[a][0]?.createdDate || 0;
                        const latestB = grouped[b][0]?.createdDate || 0;
                        return latestB - latestA;
                    });

                    notesListEl.innerHTML = sortedBookIds.map(bookId => {
                        const bookNotes = grouped[bookId];
                        const book = bookMap[bookId];
                        const bookTitle = book ? book.title : '未知书籍';
                        const noteCount = bookNotes.length;

                        const notesHtml = bookNotes.map(note => {
                            const typeLabel = note.type === 'highlight' ? '划线' : '笔记';
                            const colorDot = note.type === 'highlight' && note.color
                                ? `<span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:${getHighlightCssColor(note.color)}; margin-left:6px;"></span>`
                                : '';

                            const excerptText = note.selectionText || '';
                            const excerptHtml = excerptText
                                ? `<div style="font-size:0.83rem; margin-top:6px; padding:6px 10px; background:rgba(0,0,0,0.03); border-left:3px solid var(--accent); border-radius:0 6px 6px 0; color:var(--text); opacity:0.85; max-height:60px; overflow-y:auto; line-height:1.5;">${escapeHtml(excerptText.substring(0, 200))}${excerptText.length > 200 ? '...' : ''}</div>`
                                : '';

                            let userNoteHtml = '';
                            if (note.type === 'note') {
                                const userNote = note.userNote || '';
                                if (userNote) {
                                    userNoteHtml = `
                                        <div style="font-size:0.7rem; opacity:0.5; margin-top:6px;">我的想法</div>
                                        <div style="font-size:0.83rem; padding:6px 10px; border-left:3px dashed var(--highlight); border-radius:0 6px 6px 0; font-style:italic; max-height:60px; overflow-y:auto; line-height:1.5;">${escapeHtml(userNote.substring(0, 200))}${userNote.length > 200 ? '...' : ''}</div>
                                    `;
                                } else if (!excerptText && note.content) {
                                    userNoteHtml = `<div style="font-size:0.83rem; margin-top:6px; line-height:1.5;">${escapeHtml(note.content.substring(0, 200))}${note.content.length > 200 ? '...' : ''}</div>`;
                                }
                            }

                            return `
                                <div class="note-item" onclick="viewNote(${note.id})">
                                    <div style="display:flex; justify-content:space-between; align-items:center;">
                                        <div style="font-weight:bold; font-size:0.85rem; display:flex; align-items:center;">${typeLabel}${colorDot}</div>
                                        <div style="font-size:0.7rem; opacity:0.5;">${new Date(note.createdDate).toLocaleDateString()}</div>
                                    </div>
                                    ${excerptHtml}
                                    ${userNoteHtml}
                                </div>
                            `;
                        }).join('');

                        return `
                            <div class="note-book-group">
                                <div class="note-book-header" onclick="toggleBookNotes(this)">
                                    ${svgArrow}
                                    ${svgBook}
                                    <div class="book-title">${escapeHtml(bookTitle)}</div>
                                    <span class="note-count">${noteCount}条</span>
                                </div>
                                <div class="note-book-items">
                                    ${notesHtml}
                                </div>
                            </div>
                        `;
                    }).join('');
                } else {
                    notesListEl.innerHTML = `
                        <div class="library-empty" style="text-align:center; padding:30px 20px;">
                            <div style="margin-bottom:10px;">${svgNotepad}</div>
                            <p style="opacity:0.5; font-size:0.85rem;">暂无笔记</p>
                        </div>
                    `;
                }

                // 加载已读完书籍 - 手风琴折叠
                const finishedListEl = document.getElementById('finished-books-list');
                if (finishedBooks && finishedBooks.length > 0) {
                    const svgArrowF = '<svg class="arrow" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"></polyline></svg>';
                    finishedListEl.innerHTML = finishedBooks.map(book => `
                        <div class="note-book-group">
                            <div class="note-book-header" onclick="toggleBookNotes(this)">
                                ${svgArrowF}
                                ${svgCheck}
                                <div class="book-title">${escapeHtml(book.title)}</div>
                            </div>
                            <div class="note-book-items">
                                <div class="note-item" style="display:flex; justify-content:space-between; align-items:center;">
                                    <div>
                                        <div style="font-size:0.8rem; opacity:0.6;">完成于 ${new Date(book.lastReadDate).toLocaleDateString()}</div>
                                        <div style="font-size:0.75rem; opacity:0.4; margin-top:4px;">进度 ${Math.round(book.progress || 100)}%</div>
                                    </div>
                                    <button class="btn-sec" style="width:auto; padding:6px 14px; font-size:0.8rem;" onclick="event.stopPropagation(); openBook(${book.id})">继续阅读</button>
                                </div>
                            </div>
                        </div>
                    `).join('');
                } else {
                    finishedListEl.innerHTML = `
                        <div class="library-empty" style="text-align:center; padding:30px 20px;">
                            <div style="margin-bottom:10px;"><svg class="icon" style="width:2rem;height:2rem;opacity:0.2;" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg></div>
                            <p style="opacity:0.5; font-size:0.85rem;">还没有读完的书</p>
                        </div>
                    `;
                }

            } catch (error) {
                handleError(error, '加载个人数据失败', ErrorLevel.ERROR);
            }
        }

        // 笔记分组 折叠/展开
        function toggleBookNotes(headerEl) {
            const itemsEl = headerEl.nextElementSibling;
            const isExpanded = headerEl.classList.contains('expanded');
            if (isExpanded) {
                headerEl.classList.remove('expanded');
                itemsEl.classList.remove('expanded');
            } else {
                headerEl.classList.add('expanded');
                itemsEl.classList.add('expanded');
            }
        }

        // 添加通用 openModal 函数
        function openModal(id) {
            const el = document.getElementById(id);
            if (!el) return;
            // 统一处理阅读器相关弹窗层级
            const readerModalIds = new Set([
                'modal-reader-settings',
                'modal-reader-font',
                'modal-reader-catalog',
                'modal-reader-notes',
                'modal-reader-progress',
                'modal-book-memory',
                'modal-book-memory-editor',
                'modal-note-detail',
                'modal-room-character-picker'
            ]);
            if (currentReadingRoom) {
                // 阅读室模式下，聊天界面 z-index 为 9000，弹窗需要更高
                el.style.zIndex = '9500';
            } else if (readerModalIds.has(id)) {
                // 阅读器弹窗始终高于阅读器屏幕
                el.style.zIndex = '8000';
            } else {
                el.style.zIndex = '';
            }
            el.classList.add('active');
        }

        // 打开导入书籍弹窗
        function openImportBookModal() {
            // 加载分类选项
            loadCategoryOptions();
            openModal('modal-import-book');
        }

        // 加载分类选项
        async function loadCategoryOptions() {
            try {
                const categories = await dbHelper.safeToArray('libraryCategories', '分类');
                const selectEl = document.getElementById('import-book-category');

                if (categories && categories.length > 0) {
                    const options = categories.map(cat =>
                        `<option value="${cat.id}">${cat.name}</option>`
                    ).join('');
                    selectEl.innerHTML = `
                        <option value="">默认</option>
                        ${options}
                    `;
                }
            } catch (error) {
                handleError(error, '加载分类选项失败', ErrorLevel.WARNING);
            }
        }

        // 导入书籍文件
        async function importBookFile() {
            try {
                const titleInput = document.getElementById('import-book-title');
                const fileInput = document.getElementById('import-book-file');
                const categorySelect = document.getElementById('import-book-category');

                let title = titleInput.value.trim();
                const file = fileInput.files[0];

                if (!file) {
                    alert('请选择文件');
                    return;
                }

                const ext = file.name.split('.').pop().toLowerCase();
                let content = '';
                let format = ext === 'epub' ? 'epub' : 'txt';
                let parsedEpub = null;

                if (ext === 'epub') {
                    const zipReady = await ensureJsZip();
                    if (!zipReady) {
                        alert('EPUB 解析依赖 JSZip 未加载。\n请检查网络或将 jszip.min.js 放入 libs 目录后重试。');
                        return;
                    }
                    const libReady = await ensureEpubLib();
                    if (!libReady) {
                        alert('EPUB 解析库未加载。\n请检查网络或将 epub.min.js 放入 libs 目录后重试。');
                        return;
                    }
                    if (typeof showToast === 'function') showToast('📖 正在解析 EPUB，请稍候...');
                    parsedEpub = await parseEpubFile(file);
                    content = parsedEpub.content;
                    if (!title) {
                        title = parsedEpub.title || file.name.replace(/\.[^.]+$/, '');
                    }
                } else {
                    // 读取文件内容
                    content = await readFileAsText(file);
                }

                if (!title) {
                    alert('请输入书名');
                    return;
                }

                if (!content || !content.trim()) {
                    alert('未能读取到书籍内容，请检查文件');
                    return;
                }

                // 保存到数据库
                const bookData = {
                    title: title,
                    content: content,
                    categoryId: categorySelect.value || null,
                    status: 'reading',
                    uploadDate: Date.now(),
                    lastReadDate: Date.now(),
                    progress: 0,
                    totalLength: content.length,
                    format: format
                };

                if (parsedEpub) {
                    bookData.toc = parsedEpub.toc || [];
                    if (parsedEpub.anchorMap) bookData.anchorMap = parsedEpub.anchorMap;
                    if (parsedEpub.spineMap) bookData.spineMap = parsedEpub.spineMap;
                }

                await dbHelper.safePut('libraryBooks', bookData, '书籍');

                // 关闭弹窗并刷新书架
                closeModal('modal-import-book');

                // 清空表单
                titleInput.value = '';
                fileInput.value = '';
                categorySelect.value = '';

                // 切换到书架并刷新
                currentLibraryTab = 'bookshelf';
                document.querySelectorAll('.library-nav-item').forEach((el, index) => {
                    el.classList.toggle('active', index === 1);
                });
                document.querySelectorAll('.library-tab-content').forEach((el, index) => {
                    el.style.display = index === 1 ? 'block' : 'none';
                });

                await loadBookshelf();

                if (typeof showToast === 'function') {
                    showToast(`📖 《${title}》导入成功！`);
                }

            } catch (error) {
                handleError(error, '导入书籍失败', ErrorLevel.ERROR);
            }
        }

        // 读取文件为文本
        function readFileAsText(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.onerror = (e) => reject(new Error('文件读取失败'));
                reader.readAsText(file, 'UTF-8');
            });
        }

        const loadedScripts = new Set();
        function loadScriptOnce(src) {
            if (loadedScripts.has(src)) return Promise.resolve();
            return new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = src;
                script.onload = () => {
                    loadedScripts.add(src);
                    resolve();
                };
                script.onerror = () => reject(new Error(`脚本加载失败: ${src}`));
                document.head.appendChild(script);
            });
        }

        async function ensureJsZip() {
            if (typeof window.JSZip === 'function' || typeof window.JSZip === 'object') return true;
            try {
                await loadScriptOnce('libs/jszip.min.js');
            } catch (e) {
                console.warn('JSZip 本地库加载失败:', e);
            }
            if (typeof window.JSZip === 'function' || typeof window.JSZip === 'object') return true;
            try {
                await loadScriptOnce('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js');
            } catch (e) {
                console.warn('JSZip CDN 加载失败:', e);
            }
            return typeof window.JSZip === 'function' || typeof window.JSZip === 'object';
        }

        async function ensureEpubLib() {
            if (typeof window.ePub === 'function') return true;
            try {
                await loadScriptOnce('libs/epub.min.js');
            } catch (e) {
                console.warn('EPUB 本地库加载失败:', e);
            }
            if (typeof window.ePub === 'function') return true;
            try {
                await loadScriptOnce('https://cdn.jsdelivr.net/npm/epubjs@0.3.88/dist/epub.min.js');
            } catch (e) {
                console.warn('EPUB CDN 加载失败:', e);
            }
            return typeof window.ePub === 'function';
        }

        function readFileAsArrayBuffer(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.onerror = () => reject(new Error('文件读取失败'));
                reader.readAsArrayBuffer(file);
            });
        }

        async function parseEpubFile(file) {
            const arrayBuffer = await readFileAsArrayBuffer(file);
            if (!window.JSZip) {
                throw new Error('JSZip lib not loaded');
            }
            const book = ePub(arrayBuffer);
            await book.ready;

            let title = '';
            try {
                const metadata = await book.loaded.metadata;
                title = metadata?.title || '';
            } catch (e) {
                title = '';
            }

            let toc = [];
            try {
                const navigation = await book.loaded.navigation;
                const navItems = navigation?.toc || navigation || [];
                toc = flattenEpubToc(navItems);
            } catch (e) {
                toc = [];
            }

            const spineItems = book.spine?.spineItems || [];
            const contentParagraphs = [];
            const spineMap = {};

            for (const item of spineItems) {
                try {
                    const contents = await item.load(book.load.bind(book));
                    const doc = contents?.document || contents?.ownerDocument || contents;
                    let body = doc?.body || doc?.querySelector?.('body');
                    // 某些 EPUB 返回的 contents 本身就是 body 或文档片段
                    if (!body && doc?.nodeType === 1) body = doc;
                    if (!body && contents?.nodeType === 1) body = contents;
                    if (!body) {
                        continue;
                    }

                    const chapterTitle = extractEpubChapterTitle(body, item);
                    const startIndex = contentParagraphs.length;
                    const localParagraphs = [];
                    let headingOffset = 0;
                    if (chapterTitle) {
                        localParagraphs.push(`# ${chapterTitle}`);
                        headingOffset = 1;
                    }

                    const { paragraphs, anchors, headings } = extractEpubParagraphs(body);
                    localParagraphs.push(...paragraphs);

                    const normalizedHref = normalizeEpubHref(item.href || '');
                    if (normalizedHref) {
                        const anchorMap = {};
                        Object.keys(anchors).forEach(key => {
                            anchorMap[key] = startIndex + headingOffset + anchors[key];
                        });
                        const headingMap = (headings || []).map(item => ({
                            text: item.text,
                            index: startIndex + headingOffset + item.index
                        }));
                        if (chapterTitle) {
                            headingMap.unshift({
                                text: chapterTitle,
                                index: startIndex
                            });
                        }
                        const rangeStart = startIndex + headingOffset;
                        const rangeEnd = startIndex + localParagraphs.length - 1;
                        spineMap[normalizedHref] = {
                            startIndex: startIndex + headingOffset,
                            rangeStart,
                            rangeEnd,
                            anchors: anchorMap,
                            headings: headingMap
                        };
                    }

                    contentParagraphs.push(...localParagraphs);
                } catch (error) {
                    console.warn('EPUB 章节解析失败:', error);
                } finally {
                    if (item.unload) item.unload();
                }
            }

            // 如果 epub.js spine 方式没提取到内容，使用 JSZip 直接解析 XHTML 文件
            if (contentParagraphs.length === 0 && window.JSZip) {
                console.warn('[EPUB] epub.js spine 未提取到内容，尝试 JSZip 直接解析');
                try {
                    const zip = await JSZip.loadAsync(arrayBuffer);
                    const htmlExts = /\.(xhtml|html|htm|xml)$/i;
                    const htmlFiles = Object.keys(zip.files)
                        .filter(name => htmlExts.test(name) && !zip.files[name].dir)
                        .sort();
                    const parser = new DOMParser();
                    for (const fileName of htmlFiles) {
                        try {
                            const text = await zip.files[fileName].async('string');
                            const doc = parser.parseFromString(text, 'application/xhtml+xml');
                            // 检查是否解析出错
                            if (doc.querySelector('parsererror')) {
                                const doc2 = parser.parseFromString(text, 'text/html');
                                const body2 = doc2.body;
                                if (body2) {
                                    const { paragraphs } = extractEpubParagraphs(body2);
                                    contentParagraphs.push(...paragraphs);
                                }
                            } else {
                                const body = doc.body || doc.querySelector('body');
                                if (body) {
                                    const { paragraphs } = extractEpubParagraphs(body);
                                    contentParagraphs.push(...paragraphs);
                                }
                            }
                        } catch (e) {
                            console.warn('[EPUB] JSZip 解析文件失败:', fileName, e);
                        }
                    }
                } catch (e) {
                    console.warn('[EPUB] JSZip 回退解析失败:', e);
                }
            }

            const content = contentParagraphs.join('\n\n');
            if (!content || !content.trim()) {
                throw new Error('EPUB解析失败，可能是加密/不兼容文件');
            }

            if (toc.length > 0) {
                toc = toc.map(item => {
                    const { path, fragment } = splitEpubHref(item.href || '');
                    const spineKey = findSpineKeyForHref(path, spineMap);
                    let index = null;
                    if (spineKey && spineMap[spineKey]) {
                        const entry = spineMap[spineKey];
                        if (fragment && entry.anchors && entry.anchors[fragment] !== undefined) {
                            index = entry.anchors[fragment];
                        } else {
                            const label = normalizeEpubMatchText(item.label || '');
                            if (label && entry.headings && entry.headings.length > 0) {
                                const headingMatch = entry.headings.find(h => {
                                    const hText = normalizeEpubMatchText(h.text || '');
                                    return hText && (hText.includes(label) || label.includes(hText));
                                });
                                if (headingMatch) {
                                    index = headingMatch.index;
                                }
                            }
                            if ((index === null || index === undefined) && label && Array.isArray(contentParagraphs)) {
                                const start = Math.max(0, entry.rangeStart ?? entry.startIndex ?? 0);
                                const end = Math.min(contentParagraphs.length - 1, entry.rangeEnd ?? contentParagraphs.length - 1);
                                for (let i = start; i <= end; i++) {
                                    const raw = contentParagraphs[i] || '';
                                    if (raw.startsWith('# ')) continue;
                                    const text = normalizeEpubMatchText(raw);
                                    if (!text) continue;
                                    if (text.includes(label) || label.includes(text)) {
                                        index = i;
                                        break;
                                    }
                                }
                            }
                            if (index === null || index === undefined) {
                                index = entry.startIndex;
                            }
                        }
                    }
                    return {
                        ...item,
                        index
                    };
                });
            }
            // 构建全局 anchorMap（脚注跳转用）
            const globalAnchorMap = {};
            Object.keys(spineMap).forEach(spineHref => {
                const entry = spineMap[spineHref];
                Object.keys(entry.anchors || {}).forEach(id => {
                    globalAnchorMap[`${spineHref}#${id}`] = entry.anchors[id];
                    globalAnchorMap[`#${id}`] = entry.anchors[id]; // 同文件内引用
                });
            });

            return {
                title: title || file.name.replace(/\.[^.]+$/, ''),
                content: content || '',
                toc: toc,
                anchorMap: globalAnchorMap,
                spineMap: spineMap
            };
        }

        // 提取元素文本并保留 <a> 链接标记
        function extractTextWithLinks(el) {
            let result = '';
            el.childNodes.forEach(node => {
                if (node.nodeType === 3) { // TEXT_NODE
                    result += node.textContent;
                } else if (node.nodeType === 1) { // ELEMENT_NODE
                    const tag = node.tagName;
                    if (tag === 'A') {
                        const href = node.getAttribute('href') || '';
                        const text = node.textContent || '';
                        if (href && text.trim()) {
                            result += `{{link:${href}:${text}}}`;
                        } else {
                            result += text;
                        }
                    } else if (tag === 'SUP' || tag === 'SUB' || tag === 'SPAN' || tag === 'EM' || tag === 'STRONG' || tag === 'I' || tag === 'B') {
                        result += extractTextWithLinks(node); // 递归内联元素
                    } else {
                        result += node.textContent || '';
                    }
                }
            });
            return result;
        }

        function extractEpubParagraphs(body) {
            const paragraphs = [];
            const anchors = {};
            const headings = [];
            if (!body) return { paragraphs, anchors, headings };

            const blockTags = new Set(['H1','H2','H3','H4','H5','H6','P','LI','BLOCKQUOTE','PRE']);
            const containerTags = new Set(['DIV','SECTION','ARTICLE','ASIDE','MAIN','FIGURE','FIGCAPTION','DD','DT']);
            const skipTags = new Set(['SCRIPT','STYLE','SVG','IMG','BR','HR','NAV','TABLE']);
            const pendingAnchors = [];
            let lastParagraphIndex = -1;
            const processedNodes = new WeakSet();

            const pushAnchor = (id, index) => {
                if (!id || index < 0) return;
                if (anchors[id] === undefined) anchors[id] = index;
            };

            const queueAnchor = (id) => {
                if (!id) return;
                if (anchors[id] !== undefined) return;
                if (!pendingAnchors.includes(id)) pendingAnchors.push(id);
            };

            const collectIds = (el) => {
                if (!el || !el.getAttribute) return;
                const id = el.getAttribute('id') || el.getAttribute('name');
                if (id) queueAnchor(id);
            };

            const addParagraph = (el, text) => {
                const index = paragraphs.length;
                paragraphs.push(text);
                lastParagraphIndex = index;
                if (el.tagName && el.tagName.startsWith('H')) {
                    headings.push({ text, index });
                }
                if (pendingAnchors.length) {
                    pendingAnchors.forEach(id => pushAnchor(id, index));
                    pendingAnchors.length = 0;
                }
                const directId = el.getAttribute ? (el.getAttribute('id') || el.getAttribute('name')) : null;
                pushAnchor(directId, index);
                if (el.querySelectorAll) {
                    const descendants = el.querySelectorAll('[id],[name]');
                    descendants.forEach(desc => {
                        const did = desc.getAttribute('id') || desc.getAttribute('name');
                        pushAnchor(did, index);
                    });
                }
            };

            // 检查元素是否含有块级子元素
            const hasBlockChildren = (el) => {
                if (!el.children) return false;
                for (let i = 0; i < el.children.length; i++) {
                    const tag = el.children[i].tagName;
                    if (blockTags.has(tag) || containerTags.has(tag)) return true;
                }
                return false;
            };

            // 标记所有祖先节点已处理（避免重复提取）
            const markAncestors = (el) => {
                let parent = el.parentElement;
                while (parent && parent !== body) {
                    processedNodes.add(parent);
                    parent = parent.parentElement;
                }
            };

            // 递归提取内容
            const processNode = (el) => {
                if (!el || !el.tagName) return;
                if (skipTags.has(el.tagName)) return;
                if (processedNodes.has(el)) return;

                collectIds(el);

                // 标准块级标签 - 直接提取（保留链接标记）
                if (blockTags.has(el.tagName)) {
                    processedNodes.add(el);
                    const raw = extractTextWithLinks(el);
                    const text = normalizeEpubText(raw);
                    if (text) {
                        addParagraph(el, text);
                        markAncestors(el);
                    }
                    return;
                }

                // 容器标签（div/section等）- 检查是否为叶子容器
                if (containerTags.has(el.tagName)) {
                    if (hasBlockChildren(el)) {
                        // 有块级子元素，递归处理子元素
                        for (let i = 0; i < el.children.length; i++) {
                            processNode(el.children[i]);
                        }
                        // 处理完子元素后，检查是否有未被包裹的直接文本节点
                        const directText = getDirectTextContent(el);
                        if (directText) {
                            processedNodes.add(el);
                            addParagraph(el, directText);
                        }
                    } else {
                        // 叶子容器，没有块级子元素 - 直接提取全部文本（保留链接标记）
                        processedNodes.add(el);
                        const raw = extractTextWithLinks(el);
                        const text = normalizeEpubText(raw);
                        if (text) {
                            addParagraph(el, text);
                            markAncestors(el);
                        }
                    }
                    return;
                }

                // 其他标签：递归子节点
                if (el.children && el.children.length > 0) {
                    for (let i = 0; i < el.children.length; i++) {
                        processNode(el.children[i]);
                    }
                }
            };

            // 获取元素的直接文本节点内容（排除已处理的子元素，保留链接标记）
            const getDirectTextContent = (el) => {
                let text = '';
                for (let i = 0; i < el.childNodes.length; i++) {
                    const child = el.childNodes[i];
                    if (child.nodeType === 3) { // TEXT_NODE
                        text += child.textContent;
                    } else if (child.nodeType === 1 && !processedNodes.has(child) &&
                               !blockTags.has(child.tagName) && !containerTags.has(child.tagName)) {
                        if (child.tagName === 'A') {
                            const href = child.getAttribute('href') || '';
                            const linkText = child.textContent || '';
                            if (href && linkText.trim()) {
                                text += `{{link:${href}:${linkText}}}`;
                            } else {
                                text += linkText;
                            }
                        } else {
                            text += extractTextWithLinks(child);
                        }
                    }
                }
                return normalizeEpubText(text);
            };

            // 从 body 开始递归处理
            if (body.children && body.children.length > 0) {
                for (let i = 0; i < body.children.length; i++) {
                    processNode(body.children[i]);
                }
            }

            // 如果递归方式未提取到内容，使用兜底策略：提取所有可见文本
            if (paragraphs.length === 0) {
                const allText = normalizeEpubText(body.textContent || '');
                if (allText) {
                    const lines = allText.split(/\n+/).filter(l => l.trim());
                    lines.forEach(line => {
                        addParagraph(body, line.trim());
                    });
                }
            }

            if (pendingAnchors.length && lastParagraphIndex >= 0) {
                pendingAnchors.forEach(id => pushAnchor(id, lastParagraphIndex));
            }

            return { paragraphs, anchors, headings };
        }

        function flattenEpubToc(items, depth = 0, out = []) {
            if (!items || items.length === 0) return out;
            items.forEach(item => {
                const label = item.label || item.title || '';
                out.push({
                    label: label,
                    href: item.href || '',
                    depth: depth
                });
                if (item.subitems && item.subitems.length > 0) {
                    flattenEpubToc(item.subitems, depth + 1, out);
                }
            });
            return out;
        }

        function splitEpubHref(href) {
            if (!href) return { path: '', fragment: '' };
            const parts = href.split('#');
            const path = normalizeEpubHref(parts[0] || '');
            const fragment = parts[1] ? decodeURIComponent(parts[1]) : '';
            return { path, fragment };
        }

        function normalizeEpubHref(href) {
            return decodeURIComponent(href || '')
                .replace(/^(\.\.\/)+/, '')
                .replace(/^\.?\//, '')
                .split('#')[0];
        }

        function findSpineKeyForHref(path, spineMap) {
            if (!path) return null;
            if (spineMap[path]) return path;
            const keys = Object.keys(spineMap);
            const match = keys.find(k => k.endsWith(path));
            return match || null;
        }

        function extractEpubChapterTitle(body, item) {
            const heading = body.querySelector('h1, h2, h3, h4');
            const headingText = heading ? heading.textContent.trim() : '';
            if (headingText) return headingText;
            if (item && item.title) return item.title;
            return '';
        }

        function normalizeEpubText(text) {
            return text
                .replace(/\r/g, '')
                .replace(/\n{3,}/g, '\n\n')
                .replace(/[ \t]{2,}/g, ' ')
                .trim();
        }

        function normalizeEpubMatchText(text) {
            return (text || '')
                .toLowerCase()
                .replace(/\s+/g, '')
                .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '');
        }

        // 打开书籍（进入阅读器）
        async function openBook(bookId) {
            try {
                // 将字符串 ID 转换为数字
                const id = parseInt(bookId);
                console.log('[阅读器] 打开书籍 ID:', id, '类型:', typeof id);

                const book = await dbHelper.safeGet('libraryBooks', id, '书籍');
                if (!book) {
                    alert('书籍不存在，ID: ' + id);
                    console.error('[阅读器] 未找到书籍，ID:', id);
                    return;
                }

                currentBook = book;

                // 加载阅读进度
                const progress = await db.readingProgress.where({bookId: id}).first();
                currentReadingPosition = progress ? progress.lastPosition : 0;
                currentReadingPercentage = progress ? (progress.percentage || 0) : 0;
                currentReadingPage = progress && progress.pageIndex ? progress.pageIndex : 1;
                currentReadingPageCount = progress && progress.pageCount ? progress.pageCount : 1;
                // 读取阅读模式偏好
                if (typeof store !== 'undefined' && store.readerMode) {
                    readerMode = store.readerMode;
                } else {
                    const savedMode = localStorage.getItem('readerMode');
                    if (savedMode) readerMode = savedMode;
                }

                // 显示阅读器
                document.getElementById('reader-screen').style.display = 'flex';
                document.body.classList.add('no-scroll');

                // 设置书籍信息
                document.getElementById('reader-book-title').textContent = book.title;

                // 渲染内容
                renderReaderContent();
                updateReaderModeButtons();
                applyReaderToolbarVisibility();

                // 初始化文字选择工具栏
                initTextSelectionToolbar();

                console.log(`[阅读器] 打开书籍: ${book.title}`);

            } catch (error) {
                handleError(error, '打开书籍失败', ErrorLevel.ERROR);
            }
        }

        // 渲染段落文本，将 {{link:href:text}} 标记转为可点击链接
        function renderParagraphWithLinks(text) {
            // 先提取所有链接标记，替换为占位符
            const links = [];
            const placeholder = text.replace(/\{\{link:(.*?):(.*?)\}\}/g, (_, href, linkText) => {
                const idx = links.length;
                links.push({ href, text: linkText });
                return `\x00LINK${idx}\x00`;
            });
            // 对剩余文本做 HTML 转义
            let html = escapeHtml(placeholder);
            // 还原链接占位符为可点击的 <a> 元素
            html = html.replace(/\x00LINK(\d+)\x00/g, (_, idxStr) => {
                const link = links[parseInt(idxStr, 10)];
                if (!link) return '';
                const safeHref = escapeHtml(link.href);
                const safeText = escapeHtml(link.text);
                return `<a class="reader-footnote-link" data-href="${safeHref}" onclick="handleReaderLinkClick(this); return false;">${safeText}</a>`;
            });
            return html;
        }

        // 处理阅读器内脚注链接点击
        function handleReaderLinkClick(el) {
            const href = el.dataset.href;
            if (!currentBook || !href) return;
            const anchorMap = currentBook.anchorMap;
            if (!anchorMap) return;

            // 尝试多种匹配方式
            let targetIndex = null;

            // 1. 直接匹配 href（如 #footnote1）
            if (anchorMap[href] !== undefined) {
                targetIndex = anchorMap[href];
            }

            // 2. 如果 href 不是以 # 开头，尝试加 #
            if (targetIndex === null && !href.startsWith('#')) {
                const withHash = '#' + href;
                if (anchorMap[withHash] !== undefined) {
                    targetIndex = anchorMap[withHash];
                }
            }

            // 3. 遍历 spineMap 尝试匹配（处理相对路径）
            if (targetIndex === null && currentBook.spineMap) {
                for (const spineHref of Object.keys(currentBook.spineMap)) {
                    const fullKey = `${spineHref}${href.startsWith('#') ? '' : '#'}${href}`;
                    if (anchorMap[fullKey] !== undefined) {
                        targetIndex = anchorMap[fullKey];
                        break;
                    }
                }
            }

            if (targetIndex !== null) {
                // 复用 scrollToParagraph 确保翻页模式下页面对齐
                scrollToParagraph(targetIndex);
                // 闪烁高亮效果
                const contentEl = document.getElementById('reader-content');
                if (contentEl) {
                    const targetEl = contentEl.querySelector(`[data-paragraph="${targetIndex}"]`);
                    if (targetEl) {
                        targetEl.classList.add('reader-link-target-flash');
                        setTimeout(() => targetEl.classList.remove('reader-link-target-flash'), 2000);
                    }
                }
            }
        }

        // 渲染阅读器内容
        function renderReaderContent() {
            try {
                if (!currentBook) return;

                const contentEl = document.getElementById('reader-content');
                const content = currentBook.content || '';

                // 将内容分段显示
                const paragraphs = content.split('\n').filter(p => p.trim());
                const html = paragraphs.map((p, index) => {
                    if (p.startsWith('# ')) {
                        const title = escapeHtml(p.substring(2));
                        return `<div data-paragraph="${index}" class="reader-chapter-heading">${title}</div>`;
                    }
                    return `<p data-paragraph="${index}" style="margin-bottom:1em;">${renderParagraphWithLinks(p)}</p>`;
                }).join('');

                contentEl.innerHTML = html;

                // 应用阅读模式
                applyReaderMode();

                // 监听滚动以保存进度（在恢复进度前绑定，避免遗漏）
                contentEl.removeEventListener('scroll', saveReadingProgress);
                contentEl.addEventListener('scroll', saveReadingProgress);

                // 等待浏览器完成布局后再恢复进度，确保 scrollHeight/scrollWidth 准确
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        restoreReadingPosition(currentReadingPercentage);
                        snapReaderToPage();
                        updatePageIndicator();
                    });
                });

                // 更新进度显示
                const totalParagraphs = paragraphs.length;
                const totalEl = document.getElementById('reader-total-text');
                if (totalEl) totalEl.textContent = `${totalParagraphs}`;

                applyHighlightsForCurrentBook();

            } catch (error) {
                handleError(error, '渲染阅读内容失败', ErrorLevel.ERROR);
            }
        }

        async function applyHighlightsForCurrentBook() {
            try {
                if (!currentBook) return;
                const contentEl = document.getElementById('reader-content');
                if (!contentEl) return;

                // 先清除所有已有的高亮/笔记标记，恢复为原始渲染
                const allParagraphs = currentBook.content ? currentBook.content.split('\n').filter(p => p.trim()) : [];
                contentEl.querySelectorAll('[data-paragraph]').forEach(el => {
                    if (el.querySelector('.reading-highlight, .reading-note-mark')) {
                        const idx = parseInt(el.dataset.paragraph, 10);
                        const originalText = allParagraphs[idx] || '';
                        el.innerHTML = renderParagraphWithLinks(originalText);
                    }
                });

                const notes = await dbHelper.safeWhere('readingNotes', { bookId: currentBook.id }, '笔记');
                // 获取高亮和有位置信息的笔记
                const annotations = (notes || []).filter(n =>
                    (n.type === 'highlight' || n.type === 'note') &&
                    n.paragraphIndex !== undefined &&
                    n.startOffset !== undefined &&
                    n.endOffset !== undefined
                );
                if (annotations.length === 0) return;

                const grouped = {};
                annotations.forEach(note => {
                    const key = String(note.paragraphIndex);
                    if (!grouped[key]) grouped[key] = [];
                    grouped[key].push(note);
                });

                Object.keys(grouped).forEach(key => {
                    const paragraph = contentEl.querySelector(`[data-paragraph="${key}"]`);
                    if (!paragraph) return;
                    renderHighlightsInParagraph(paragraph, grouped[key]);
                });
            } catch (error) {
                console.error('应用高亮失败:', error);
            }
        }

        function renderHighlightsInParagraph(paragraphEl, notes) {
            const text = paragraphEl.textContent || '';
            const sorted = notes
                .filter(n => n.startOffset >= 0 && n.endOffset > n.startOffset && n.endOffset <= text.length)
                .sort((a, b) => a.startOffset - b.startOffset);

            if (sorted.length === 0) return;

            let html = '';
            let last = 0;
            sorted.forEach(note => {
                if (note.startOffset < last) return; // skip overlaps
                html += escapeHtml(text.slice(last, note.startOffset));
                if (note.type === 'note') {
                    // 笔记：虚线下划线标记
                    html += `<span class="reading-note-mark" data-note-id="${note.id}">${escapeHtml(text.slice(note.startOffset, note.endOffset))}</span>`;
                } else {
                    // 高亮：带颜色
                    const colorAttr = note.color ? ` data-color="${note.color}"` : '';
                    html += `<span class="reading-highlight" data-note-id="${note.id}"${colorAttr}>${escapeHtml(text.slice(note.startOffset, note.endOffset))}</span>`;
                }
                last = note.endOffset;
            });
            html += escapeHtml(text.slice(last));
            paragraphEl.innerHTML = html;
        }

        // HTML 转义
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // 保存阅读进度（防抖）
        let saveProgressTimer = null;
        async function saveReadingProgress() {
            try {
                if (!currentBook) return;

                const contentEl = document.getElementById('reader-content');
                if (readerMode === 'page') {
                    currentReadingPosition = contentEl.scrollLeft;
                } else {
                    currentReadingPosition = contentEl.scrollTop;
                }

                // 计算进度百分比
                const scrollSize = readerMode === 'page'
                    ? (contentEl.scrollWidth - contentEl.clientWidth)
                    : (contentEl.scrollHeight - contentEl.clientHeight);
                const percentage = scrollSize > 0 ? (currentReadingPosition / scrollSize * 100).toFixed(1) : 0;
                currentReadingPercentage = parseFloat(percentage);

                // 更新进度显示
                document.getElementById('reader-progress-text').textContent = `${percentage}%`;
                document.getElementById('reader-progress-slider').value = percentage;
                const posEl = document.getElementById('reader-position-text');
                if (posEl) posEl.textContent = `${percentage}%`;

                if (readerMode === 'page') {
                    const step = getReaderPageStep(contentEl);
                    if (step) {
                        const pageCount = Math.max(1, Math.ceil(contentEl.scrollWidth / step));
                        const pageIndex = Math.min(pageCount, Math.max(1, Math.round(currentReadingPosition / step) + 1));
                        currentReadingPage = pageIndex;
                        currentReadingPageCount = pageCount;
                    } else {
                        currentReadingPage = 1;
                        currentReadingPageCount = 1;
                    }
                    updatePageIndicator();
                    if (!isSnappingPage) {
                        clearTimeout(snapPageTimer);
                        snapPageTimer = setTimeout(() => {
                            snapReaderToPage();
                        }, 120);
                    }
                } else {
                    updatePageIndicator();
                }

                // 防抖保存
                clearTimeout(saveProgressTimer);
                saveProgressTimer = setTimeout(async () => {
                    // 修复：先查找已有记录，用其 id 来更新，避免 ++id 不断创建新记录
                    const existing = await db.readingProgress.where({bookId: currentBook.id}).first();
                    const progressData = {
                        bookId: currentBook.id,
                        lastPosition: currentReadingPosition,
                        percentage: parseFloat(percentage),
                        mode: readerMode,
                        pageIndex: currentReadingPage,
                        pageCount: currentReadingPageCount
                    };
                    if (existing && existing.id) {
                        progressData.id = existing.id; // 复用已有记录的 id
                    }
                    await db.readingProgress.put(progressData);

                    // 同时更新书籍的进度
                    await db.libraryBooks.update(currentBook.id, {
                        progress: parseFloat(percentage),
                        lastReadDate: Date.now()
                    });
                }, 1000);

            } catch (error) {
                console.error('保存进度失败:', error);
            }
        }

        // 跳转到指定进度
        function seekReaderProgress(percentage) {
            try {
                if (!currentBook) return;

                const contentEl = document.getElementById('reader-content');
                const scrollSize = readerMode === 'page'
                    ? (contentEl.scrollWidth - contentEl.clientWidth)
                    : (contentEl.scrollHeight - contentEl.clientHeight);
                const rawPosition = scrollSize * (percentage / 100);

                if (readerMode === 'page') {
                    // 直接对齐到页面边界，避免中间态的非对齐 scrollLeft
                    const step = getReaderPageStep(contentEl);
                    const position = step > 0 ? Math.round(rawPosition / step) * step : rawPosition;
                    contentEl.scrollLeft = Math.min(position, scrollSize);
                    currentReadingPosition = contentEl.scrollLeft;
                    updatePageIndicator();
                } else {
                    contentEl.scrollTop = rawPosition;
                    currentReadingPosition = rawPosition;
                }
                currentReadingPercentage = parseFloat(percentage);

            } catch (error) {
                handleError(error, '跳转进度失败', ErrorLevel.ERROR);
            }
        }

        // 退出阅读器
        async function exitReader() {
            // 立即保存当前进度（清除防抖 timer，直接写入）
            clearTimeout(saveProgressTimer);
            if (currentBook) {
                try {
                    const contentEl = document.getElementById('reader-content');
                    if (contentEl) {
                        if (readerMode === 'page') {
                            currentReadingPosition = contentEl.scrollLeft;
                        } else {
                            currentReadingPosition = contentEl.scrollTop;
                        }
                        const scrollSize = readerMode === 'page'
                            ? (contentEl.scrollWidth - contentEl.clientWidth)
                            : (contentEl.scrollHeight - contentEl.clientHeight);
                        const percentage = scrollSize > 0 ? (currentReadingPosition / scrollSize * 100).toFixed(1) : 0;
                        currentReadingPercentage = parseFloat(percentage);
                    }

                    const existing = await db.readingProgress.where({bookId: currentBook.id}).first();
                    const progressData = {
                        bookId: currentBook.id,
                        lastPosition: currentReadingPosition,
                        percentage: currentReadingPercentage,
                        mode: readerMode,
                        pageIndex: currentReadingPage,
                        pageCount: currentReadingPageCount
                    };
                    if (existing && existing.id) {
                        progressData.id = existing.id;
                    }
                    await db.readingProgress.put(progressData);
                    await db.libraryBooks.update(currentBook.id, {
                        progress: currentReadingPercentage,
                        lastReadDate: Date.now()
                    });
                } catch (e) {
                    console.error('退出时保存进度失败:', e);
                }
            }

            document.getElementById('reader-screen').style.display = 'none';
            document.body.classList.remove('no-scroll');
            currentBook = null;
            currentReadingPosition = 0;
            currentReadingPercentage = 0;
            currentReadingPage = 1;
            currentReadingPageCount = 1;
            updatePageIndicator();
            readerToolbarVisible = false;
            applyReaderToolbarVisibility();

            // 刷新书架
            if (currentLibraryTab === 'bookshelf') {
                loadBookshelf();
            }
        }

        // 点击阅读器内容区域，显示/隐藏工具栏
        document.addEventListener('DOMContentLoaded', function() {
            const readerContent = document.getElementById('reader-content');
            if (readerContent) {
                readerContent.addEventListener('click', function(e) {
                    // 点击已有高亮 -> 显示颜色切换/取消划线选择器
                    const highlightEl = e.target.closest('.reading-highlight');
                    if (highlightEl) {
                        const noteId = parseInt(highlightEl.dataset.noteId, 10);
                        if (!Number.isNaN(noteId)) {
                            showHighlightEditPicker(noteId, highlightEl);
                        }
                        return;
                    }

                    // 点击笔记虚线标记 -> 打开笔记详情
                    const noteMarkEl = e.target.closest('.reading-note-mark');
                    if (noteMarkEl) {
                        const noteId = parseInt(noteMarkEl.dataset.noteId, 10);
                        if (!Number.isNaN(noteId)) {
                            openNoteDetail(noteId);
                        }
                        return;
                    }

                    // 如果点击的是文字选择工具栏或颜色选择器，不处理
                    if (e.target.closest('.text-selection-toolbar') || e.target.closest('.highlight-color-picker')) {
                        return;
                    }

                    // 如果有文字选中，不处理
                    if (window.getSelection().toString()) {
                        return;
                    }

                    // 翻页模式：左右区域翻页，中间区域切换工具栏
                    if (readerMode === 'page') {
                        const rect = readerContent.getBoundingClientRect();
                        const x = e.clientX - rect.left;
                        const leftZone = rect.width * 0.33;
                        const rightZone = rect.width * 0.67;
                        if (x < leftZone) {
                            turnReaderPage('prev');
                            return;
                        }
                        if (x > rightZone) {
                            turnReaderPage('next');
                            return;
                        }
                    }

                    toggleReaderToolbar();
                });
            }

            document.addEventListener('keydown', (e) => {
                if (readerMode !== 'page') return;
                if (document.getElementById('reader-screen')?.style.display !== 'flex') return;
                const activeEl = document.activeElement;
                if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
                    return;
                }
                if (e.key === 'ArrowRight' || e.key === 'PageDown') {
                    turnReaderPage('next');
                    e.preventDefault();
                } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
                    turnReaderPage('prev');
                    e.preventDefault();
                }
            });

            window.addEventListener('resize', () => {
                if (document.getElementById('reader-screen')?.style.display === 'flex') {
                    applyReaderMode();
                    restoreReadingPosition(currentReadingPercentage);
                    snapReaderToPage();
                    updatePageIndicator();
                }
            });
        });

        function applyReaderToolbarVisibility() {
            const topBar = document.getElementById('reader-top-bar');
            const bottomBar = document.getElementById('reader-bottom-bar');
            const floatBtn = document.getElementById('reader-float-btn');
            const floatMenu = document.getElementById('reader-float-menu');

            if (!topBar || !bottomBar) return;

            if (readerToolbarVisible) {
                topBar.style.top = '0';
                bottomBar.style.bottom = '0';
                if (floatBtn) floatBtn.style.display = 'flex';
            } else {
                topBar.style.top = '-60px';
                bottomBar.style.bottom = '-200px';
                if (floatBtn) floatBtn.style.display = 'none';
                if (floatMenu) floatMenu.style.display = 'none';
            }
            updatePageIndicator();
        }

        // 切换阅读器工具栏显示/隐藏
        function toggleReaderToolbar() {
            readerToolbarVisible = !readerToolbarVisible;
            applyReaderToolbarVisibility();
        }

        // 打开阅读器设置
        function openReaderSettings() {
            openModal('modal-reader-settings');
            loadBookmarks();
            updateFinishedToggleUI();
            // 加载阅读上下文配置
            const rctx = store.readingContextConfig || { paragraphsBefore: 3, paragraphsAfter: 5, maxChars: 3000 };
            document.getElementById('reading-ctx-before').value = rctx.paragraphsBefore;
            document.getElementById('reading-ctx-after').value = rctx.paragraphsAfter;
            document.getElementById('reading-ctx-max-chars').value = rctx.maxChars;
        }

        // 已读完状态切换
        async function toggleBookFinished() {
            if (!currentBook) return;
            try {
                const isFinished = currentBook.status === 'finished';
                const newStatus = isFinished ? 'reading' : 'finished';
                const updateData = { status: newStatus, lastReadDate: Date.now() };
                if (newStatus === 'finished') updateData.progress = 100;

                await db.libraryBooks.update(currentBook.id, updateData);
                currentBook.status = newStatus;
                if (newStatus === 'finished') currentBook.progress = 100;

                updateFinishedToggleUI();
                if (typeof showToast === 'function') {
                    showToast(newStatus === 'finished' ? '已标记为读完' : '已取消读完标记');
                }
            } catch (error) {
                handleError(error, '更新阅读状态失败', ErrorLevel.ERROR);
            }
        }

        function updateFinishedToggleUI() {
            if (!currentBook) return;
            const isFinished = currentBook.status === 'finished';
            const toggle = document.getElementById('book-finished-toggle');
            const icon = document.getElementById('finished-toggle-icon');
            const label = document.getElementById('finished-toggle-label');
            const sw = document.getElementById('finished-toggle-switch');
            if (!toggle) return;

            if (isFinished) {
                toggle.style.background = 'rgba(var(--accent-rgb), 0.12)';
                icon.style.stroke = 'var(--accent)';
                label.textContent = '已读完';
                label.style.fontWeight = 'bold';
                label.style.color = 'var(--accent)';
                sw.style.background = 'var(--accent)';
                sw.firstElementChild.style.transform = 'translateX(18px)';
            } else {
                toggle.style.background = 'rgba(var(--accent-rgb), 0.05)';
                icon.style.stroke = 'currentColor';
                label.textContent = '标记为已读完';
                label.style.fontWeight = 'normal';
                label.style.color = 'inherit';
                sw.style.background = 'rgba(128,128,128,0.3)';
                sw.firstElementChild.style.transform = 'translateX(0)';
            }
        }

        // 保存阅读上下文配置（独立于 AI 设置）
        function saveReadingContextConfig() {
            store.readingContextConfig = {
                paragraphsBefore: parseInt(document.getElementById('reading-ctx-before').value) || 3,
                paragraphsAfter: parseInt(document.getElementById('reading-ctx-after').value) || 5,
                maxChars: parseInt(document.getElementById('reading-ctx-max-chars').value) || 3000
            };
            saveData();
            if (typeof showToast === 'function') {
                showToast('阅读上下文设置已保存');
            }
        }

        // 打开字体设置
        function openReaderFontSettings() {
            openModal('modal-reader-font');
        }

        // 更新字体大小
        function updateReaderFontSize(size) {
            document.getElementById('reader-content').style.fontSize = size + 'px';
            document.getElementById('reader-font-size-display').textContent = size + 'px';
            if (readerMode === 'page') {
                applyReaderMode();
                restoreReadingPosition(currentReadingPercentage);
                snapReaderToPage();
                updatePageIndicator();
            }
        }

        // 更新行间距
        function updateReaderLineHeight(height) {
            document.getElementById('reader-content').style.lineHeight = height;
            document.getElementById('reader-line-height-display').textContent = height;
            if (readerMode === 'page') {
                applyReaderMode();
                restoreReadingPosition(currentReadingPercentage);
                snapReaderToPage();
                updatePageIndicator();
            }
        }

        function updateReaderModeButtons() {
            const scrollBtn = document.getElementById('btn-scroll-mode');
            const pageBtn = document.getElementById('btn-page-mode');
            if (!scrollBtn || !pageBtn) return;
            scrollBtn.classList.toggle('active', readerMode === 'scroll');
            pageBtn.classList.toggle('active', readerMode === 'page');
        }

        function applyReaderMode() {
            const contentEl = document.getElementById('reader-content');
            if (!contentEl) return;

            if (readerMode === 'page') {
                contentEl.classList.add('reader-page-mode');

                // 先清除旧的列布局样式，让浏览器回到自然状态再测量
                contentEl.style.columnWidth = '';
                contentEl.style.columnGap = '';

                const height = contentEl.clientHeight || contentEl.offsetHeight;
                const clientW = contentEl.clientWidth;

                // 读取当前实际 padding
                const computed = window.getComputedStyle(contentEl);
                const paddingLeft = parseFloat(computed.paddingLeft) || 0;
                const paddingRight = parseFloat(computed.paddingRight) || 0;
                // 确保左右 padding 对称（取较大值并取整）
                const sidePadding = Math.ceil(Math.max(paddingLeft, paddingRight));
                const totalPadding = sidePadding * 2;
                contentEl.style.paddingLeft = `${sidePadding}px`;
                contentEl.style.paddingRight = `${sidePadding}px`;

                // 重新测量 clientWidth（padding 可能变了）
                const finalClientW = contentEl.clientWidth;
                // 列宽 = clientWidth - padding，确保 columnWidth + columnGap === clientWidth
                const contentWidth = finalClientW - totalPadding;

                if (contentWidth <= 10) {
                    requestAnimationFrame(applyReaderMode);
                    return;
                }

                contentEl.style.columnWidth = `${contentWidth}px`;
                contentEl.style.columnGap = `${totalPadding}px`;
                contentEl.style.height = height ? `${height}px` : '';
                contentEl.style.overflowX = 'auto';
                contentEl.style.overflowY = 'hidden';
            } else {
                contentEl.classList.remove('reader-page-mode');
                contentEl.style.columnWidth = '';
                contentEl.style.columnGap = '';
                contentEl.style.height = '';
                contentEl.style.paddingLeft = '';
                contentEl.style.paddingRight = '';
                contentEl.style.overflowX = 'hidden';
                contentEl.style.overflowY = 'auto';
            }

            updateReaderModeButtons();
        }

        function getReaderPageStep(contentEl) {
            if (!contentEl) return 0;
            // 设计上 columnWidth + columnGap === clientWidth，
            // 直接用 clientWidth 作为步长最可靠，不受浏览器列宽微调影响
            const width = contentEl.clientWidth || contentEl.offsetWidth || 0;
            return width > 0 ? width : 0;
        }

        function updatePageIndicator() {
            const indicator = document.getElementById('reader-page-indicator');
            if (!indicator) return;
            const readerVisible = document.getElementById('reader-screen')?.style.display === 'flex';
            if (readerMode !== 'page' || !readerVisible || !currentBook) {
                indicator.style.display = 'none';
                return;
            }
            const contentEl = document.getElementById('reader-content');
            if (contentEl) {
                const step = getReaderPageStep(contentEl);
                if (step) {
                    const pageCount = Math.max(1, Math.ceil(contentEl.scrollWidth / step));
                    const pageIndex = Math.min(pageCount, Math.max(1, Math.round(contentEl.scrollLeft / step) + 1));
                    currentReadingPage = pageIndex;
                    currentReadingPageCount = pageCount;
                }
            }
            indicator.style.display = 'block';
            indicator.textContent = `第 ${currentReadingPage} / ${currentReadingPageCount} 页`;
        }

        function turnReaderPage(direction) {
            const contentEl = document.getElementById('reader-content');
            if (!contentEl || readerMode !== 'page') return;
            const step = getReaderPageStep(contentEl);
            if (!step) return;
            const maxScroll = Math.max(0, contentEl.scrollWidth - contentEl.clientWidth);
            const current = contentEl.scrollLeft;
            const base = step > 0 ? Math.round(current / step) * step : current;
            let target = Math.round(base + (direction === 'prev' ? -step : step));
            if (target < 0) target = 0;
            if (target > maxScroll) target = maxScroll;
            contentEl.scrollTo({ left: target, behavior: 'smooth' });
            currentReadingPosition = target;
            if (step) {
                const pageCount = Math.max(1, Math.ceil(contentEl.scrollWidth / step));
                const pageIndex = Math.min(pageCount, Math.max(1, Math.round(target / step) + 1));
                currentReadingPage = pageIndex;
                currentReadingPageCount = pageCount;
                updatePageIndicator();
            }
            saveReadingProgress();
        }

        function snapReaderToPage() {
            if (readerMode !== 'page') return;
            const contentEl = document.getElementById('reader-content');
            if (!contentEl) return;
            const step = getReaderPageStep(contentEl);
            if (!step) return;
            const maxScroll = Math.max(0, contentEl.scrollWidth - contentEl.clientWidth);
            let target = Math.round(contentEl.scrollLeft / step) * step;
            target = Math.round(target); // 整数像素
            if (target < 0) target = 0;
            if (target > maxScroll) target = maxScroll;
            if (Math.abs(contentEl.scrollLeft - target) < 1) return;
            isSnappingPage = true;
            contentEl.scrollTo({ left: target, behavior: 'smooth' });
            currentReadingPosition = target;
            setTimeout(() => { isSnappingPage = false; }, 180);
            updatePageIndicator();
        }

        function hardSnapReaderToPage() {
            if (readerMode !== 'page') return;
            const contentEl = document.getElementById('reader-content');
            if (!contentEl) return;
            const step = getReaderPageStep(contentEl);
            if (!step) return;
            const maxScroll = Math.max(0, contentEl.scrollWidth - contentEl.clientWidth);
            let target = Math.round(contentEl.scrollLeft / step) * step;
            if (target < 0) target = 0;
            if (target > maxScroll) target = maxScroll;
            contentEl.scrollLeft = target;
            currentReadingPosition = target;
            updatePageIndicator();
            saveReadingProgress();
            if (typeof showToast === 'function') {
                showToast('✅ 已强制对齐页面');
            }
        }

        function persistReaderMode() {
            try {
                if (typeof store !== 'undefined') {
                    store.readerMode = readerMode;
                    if (typeof saveData === 'function') saveData();
                } else {
                    localStorage.setItem('readerMode', readerMode);
                }
            } catch (e) {
                console.warn('保存阅读模式失败:', e);
            }
        }

        function restoreReadingPosition(percentage) {
            const contentEl = document.getElementById('reader-content');
            if (!contentEl) return;
            const pct = Math.max(0, Math.min(100, parseFloat(percentage) || 0));

            if (readerMode === 'page') {
                const step = getReaderPageStep(contentEl);
                if (step && currentReadingPage && currentReadingPage > 0) {
                    const position = step * (currentReadingPage - 1);
                    contentEl.scrollLeft = position;
                    currentReadingPosition = position;
                } else if (step > 0) {
                    const scrollWidth = contentEl.scrollWidth - contentEl.clientWidth;
                    const rawPosition = scrollWidth > 0 ? (scrollWidth * (pct / 100)) : 0;
                    // 对齐到页面边界
                    const position = Math.round(rawPosition / step) * step;
                    contentEl.scrollLeft = Math.min(position, scrollWidth);
                    currentReadingPosition = contentEl.scrollLeft;
                }
            } else {
                const scrollHeight = contentEl.scrollHeight - contentEl.clientHeight;
                const position = scrollHeight > 0 ? (scrollHeight * (pct / 100)) : 0;
                contentEl.scrollTop = position;
                currentReadingPosition = position;
            }

            // 同步更新进度显示
            const progressText = document.getElementById('reader-progress-text');
            const progressSlider = document.getElementById('reader-progress-slider');
            const posEl = document.getElementById('reader-position-text');
            if (progressText) progressText.textContent = `${pct.toFixed(1)}%`;
            if (progressSlider) progressSlider.value = pct;
            if (posEl) posEl.textContent = `${pct.toFixed(1)}%`;
        }

        // 设置阅读模式
        function setReaderMode(mode) {
            if (mode !== 'scroll' && mode !== 'page') return;
            readerMode = mode;
            persistReaderMode();
            applyReaderMode();
            restoreReadingPosition(currentReadingPercentage);
            snapReaderToPage();
            updatePageIndicator();
        }

        // 悬浮窗菜单
        async function toggleReaderFloatMenu() {
            const menu = document.getElementById('reader-float-menu');
            if (menu.style.display === 'none') {
                // 打开时加载当前书籍的阅读室列表
                await loadExistingRoomsInFloatMenu();
                menu.style.display = 'block';
            } else {
                menu.style.display = 'none';
            }
        }

        // 加载当前书籍的已有阅读室到悬浮菜单
        async function loadExistingRoomsInFloatMenu() {
            const listEl = document.getElementById('existing-rooms-list');
            const otherListEl = document.getElementById('other-rooms-list');
            if (!listEl || !currentBook) return;

            try {
                const allRooms = await dbHelper.safeToArray('readingRooms', '阅读室');
                if (!allRooms || allRooms.length === 0) {
                    listEl.innerHTML = '<div style="padding:8px 12px; font-size:0.75rem; opacity:0.4; text-align:center;">暂无阅读室</div>';
                    if (otherListEl) otherListEl.innerHTML = '';
                    return;
                }

                const bookRooms = allRooms.filter(r => r.bookId === currentBook.id);
                const otherRooms = allRooms.filter(r => r.bookId !== currentBook.id);

                // 本书阅读室
                if (bookRooms.length === 0) {
                    listEl.innerHTML = '<div style="padding:8px 12px; font-size:0.75rem; opacity:0.4; text-align:center;">本书暂无阅读室</div>';
                } else {
                    listEl.innerHTML =
                        '<div style="padding:6px 12px 2px; font-size:0.7rem; opacity:0.5; font-weight:600;">📖 本书阅读室</div>' +
                        bookRooms.map(room => `
                            <div class="reader-float-menu-item" data-room-id="${room.id}" onclick="toggleReaderFloatMenu(); openReadingRoom(${room.id})">
                                <span>💬</span>
                                <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${room.name}</span>
                                <span style="font-size:0.7rem; opacity:0.4;">${room.chatHistory ? room.chatHistory.length : 0}条</span>
                            </div>
                        `).join('');
                }

                // 其他阅读室
                if (otherListEl) {
                    if (otherRooms.length === 0) {
                        otherListEl.innerHTML = '';
                    } else {
                        const bookIds = [...new Set(otherRooms.map(r => r.bookId).filter(Boolean))];
                        const bookTitleMap = {};
                        for (const bid of bookIds) {
                            try {
                                const book = await dbHelper.safeGet('libraryBooks', bid, '书籍');
                                bookTitleMap[bid] = book ? book.title : '未知书籍';
                            } catch (e) {
                                bookTitleMap[bid] = '未知书籍';
                            }
                        }

                        otherRooms.sort((a, b) => (b.lastActiveDate || 0) - (a.lastActiveDate || 0));

                        otherListEl.innerHTML =
                            '<div style="border-top:1px solid rgba(128,128,128,0.2); margin:6px 0;"></div>' +
                            '<div style="padding:6px 12px 2px; font-size:0.7rem; opacity:0.5; font-weight:600;">🔄 其他阅读室</div>' +
                            otherRooms.map(room => {
                                const bookTitle = bookTitleMap[room.bookId] || '未知书籍';
                                return `
                                <div class="reader-float-menu-item" data-room-id="${room.id}" onclick="toggleReaderFloatMenu(); openReadingRoom(${room.id}, true)">
                                    <span>💬</span>
                                    <div style="flex:1; overflow:hidden; min-width:0;">
                                        <div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${room.name}</div>
                                        <div style="font-size:0.65rem; opacity:0.4; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">原书:《${bookTitle}》</div>
                                    </div>
                                    <span style="font-size:0.7rem; opacity:0.4;">${room.chatHistory ? room.chatHistory.length : 0}条</span>
                                </div>`;
                            }).join('');
                    }
                }

            } catch (error) {
                console.error('[悬浮菜单] 加载阅读室列表失败:', error);
                listEl.innerHTML = '';
                if (otherListEl) otherListEl.innerHTML = '';
            }
        }

        async function createReadingRoomForBook(book, options = {}) {
            const {
                closeFloatMenu = false,
                openAfterCreate = true
            } = options;

            try {
                if (!book || !book.id) {
                    alert('请先打开一本书');
                    return;
                }

                if (closeFloatMenu) {
                    toggleReaderFloatMenu();
                }

                // 1. 选择角色
                const selectedCharId = await showCharacterPickerForRoom();
                if (!selectedCharId) return;

                // 2. 获取角色名用于默认房间名
                const character = await db.characters.get(selectedCharId);
                const charName = character ? character.name : '角色';

                const roomName = prompt('请输入阅读室名称:', `${charName} · 《${book.title}》`);
                if (!roomName) return;
                const normalizedRoomName = roomName.trim();
                if (!normalizedRoomName) {
                    alert('阅读室名称不能为空');
                    return;
                }

                // 重名保护：同一本书 + 同一个角色 + 同名时优先复用
                const existedRooms = await db.readingRooms.where('bookId').equals(book.id).toArray();
                const duplicated = (existedRooms || []).find(r =>
                    (r.characterId === selectedCharId) &&
                    ((r.name || '').trim() === normalizedRoomName)
                );
                if (duplicated) {
                    if (confirm(`阅读室"${normalizedRoomName}"已存在，是否直接打开？`)) {
                        await openReadingRoom(duplicated.id);
                    }
                    return duplicated.id;
                }

                const roomData = {
                    bookId: book.id,
                    name: normalizedRoomName,
                    createdDate: Date.now(),
                    lastActiveDate: Date.now(),
                    characterId: selectedCharId,
                    chatHistory: [],
                    spoilerMode: 'first'
                };

                const roomId = await db.readingRooms.put(roomData);

                if (typeof showToast === 'function') {
                    showToast(`阅读室"${normalizedRoomName}"创建成功`);
                }

                await loadReadingRooms();
                if (openAfterCreate) {
                    await openReadingRoom(roomId);
                }
                return roomId;

            } catch (error) {
                handleError(error, '创建阅读室失败', ErrorLevel.ERROR);
            }
        }

        // 从阅读器创建阅读室
        async function createReadingRoomFromReader() {
            if (!currentBook) {
                alert('请先打开一本书');
                return;
            }
            await createReadingRoomForBook(currentBook, {
                closeFloatMenu: true,
                openAfterCreate: true
            });
        }

        // 从图书馆创建阅读室（不要求先进入阅读器）
        async function createReadingRoomFromLibrary() {
            try {
                const books = await dbHelper.safeToArray('libraryBooks', '书籍');
                if (!books || books.length === 0) {
                    alert('请先在书架中导入至少一本书');
                    return;
                }

                let targetBook = null;
                if (books.length === 1) {
                    targetBook = books[0];
                } else {
                    const listText = books.map((b, i) => `${i + 1}. ${b.title || '未命名书籍'}`).join('\n');
                    const defaultIndex = Math.max(1, books.findIndex(b => b.id === currentBook?.id) + 1);
                    const choice = prompt(`选择要创建阅读室的书籍:\n\n${listText}\n\n请输入序号:`, String(defaultIndex || 1));
                    if (!choice) return;
                    const idx = parseInt(choice, 10) - 1;
                    if (idx < 0 || idx >= books.length) {
                        alert('无效序号');
                        return;
                    }
                    targetBook = books[idx];
                }

                if (!targetBook) return;
                await createReadingRoomForBook(targetBook, { openAfterCreate: true });
            } catch (error) {
                handleError(error, '从图书馆创建阅读室失败', ErrorLevel.ERROR);
            }
        }

        // 初始化文字选择工具栏
        let highlightColorPicker = null; // 高亮颜色选择器元素
        let currentHighlightColor = 'yellow'; // 当前选择的高亮颜色

        function initTextSelectionToolbar() {
            // 创建工具栏元素
            if (!textSelectionToolbar) {
                textSelectionToolbar = document.createElement('div');
                textSelectionToolbar.className = 'text-selection-toolbar';
                textSelectionToolbar.innerHTML = `
                    <div class="text-selection-btn" onclick="copySelectedText()">📋 复制</div>
                    <div class="text-selection-btn" onclick="showHighlightColorPicker(event)">✏️划线</div>
                    <div class="text-selection-btn" onclick="addNoteToSelection()">📝 笔记</div>
                    <div class="text-selection-btn" onclick="sendSelectionToChat()">💬 发送</div>
                `;
                document.body.appendChild(textSelectionToolbar);
            }

            // 创建颜色选择器
            if (!highlightColorPicker) {
                highlightColorPicker = document.createElement('div');
                highlightColorPicker.className = 'highlight-color-picker';
                highlightColorPicker.innerHTML = `
                    <div class="highlight-color-dot" data-color="yellow" style="background:rgba(255,235,59,0.7)" onclick="applyHighlightColor('yellow')"></div>
                    <div class="highlight-color-dot" data-color="pink" style="background:rgba(255,105,135,0.7)" onclick="applyHighlightColor('pink')"></div>
                    <div class="highlight-color-dot" data-color="blue" style="background:rgba(100,181,246,0.7)" onclick="applyHighlightColor('blue')"></div>
                    <div class="highlight-color-dot" data-color="green" style="background:rgba(129,199,132,0.7)" onclick="applyHighlightColor('green')"></div>
                    <div class="highlight-color-dot" data-color="purple" style="background:rgba(186,104,200,0.7)" onclick="applyHighlightColor('purple')"></div>
                `;
                document.body.appendChild(highlightColorPicker);
            }

            // 监听文字选择
            if (!textSelectionInitialized) {
                document.addEventListener('mouseup', handleTextSelection);
                document.addEventListener('touchend', handleTextSelection);
                textSelectionInitialized = true;
            }
        }

        // 显示高亮颜色选择器（选中新文本时）
        function showHighlightColorPicker(e) {
            if (!highlightColorPicker) return;
            const rect = textSelectionToolbar.getBoundingClientRect();
            highlightColorPicker.style.left = rect.left + 'px';
            highlightColorPicker.style.top = (rect.top - 45) + 'px';
            highlightColorPicker.classList.add('active');
            // 阻止事件冒泡导致工具栏关闭
            e && e.stopPropagation();
        }

        // 选择颜色并应用高亮
        async function applyHighlightColor(color) {
            currentHighlightColor = color;
            highlightColorPicker.classList.remove('active');
            await highlightSelectedText(color);
        }

        function getSelectionContext() {
            const selection = window.getSelection();
            if (!selection || selection.rangeCount === 0) return null;

            const range = selection.getRangeAt(0);
            const selectedText = selection.toString().trim();
            if (!selectedText) return null;

            // 找到选区起止所在的段落
            let startNode = range.startContainer;
            if (startNode.nodeType === 3) startNode = startNode.parentElement;
            let endNode = range.endContainer;
            if (endNode.nodeType === 3) endNode = endNode.parentElement;

            const startParagraph = startNode?.closest('[data-paragraph]');
            const endParagraph = endNode?.closest('[data-paragraph]');
            if (!startParagraph || !endParagraph) return null;

            // 同一段落：返回单条结果
            if (startParagraph === endParagraph) {
                const preRange = document.createRange();
                preRange.setStart(startParagraph, 0);
                preRange.setEnd(range.startContainer, range.startOffset);
                const startOffset = preRange.toString().length;
                const endOffset = startOffset + selectedText.length;
                const paragraphIndex = parseInt(startParagraph.dataset.paragraph, 10);

                return {
                    paragraphIndex,
                    startOffset,
                    endOffset,
                    selectedText,
                    segments: null // 单段落标记
                };
            }

            // 跨段落：为每个涉及的段落生成一条 segment
            const startIdx = parseInt(startParagraph.dataset.paragraph, 10);
            const endIdx = parseInt(endParagraph.dataset.paragraph, 10);
            const segments = [];

            for (let i = startIdx; i <= endIdx; i++) {
                const p = document.querySelector(`#reader-content [data-paragraph="${i}"]`);
                if (!p) continue;
                const pText = p.textContent || '';
                if (!pText.trim()) continue;

                let segStart = 0;
                let segEnd = pText.length;

                if (i === startIdx) {
                    // 第一段：从选区起点到段尾
                    const preRange = document.createRange();
                    preRange.setStart(p, 0);
                    preRange.setEnd(range.startContainer, range.startOffset);
                    segStart = preRange.toString().length;
                } else if (i === endIdx) {
                    // 最后一段：从段首到选区终点
                    const preRange = document.createRange();
                    preRange.setStart(p, 0);
                    preRange.setEnd(range.endContainer, range.endOffset);
                    segEnd = preRange.toString().length;
                }
                // 中间段落: segStart=0, segEnd=pText.length (整段)

                if (segEnd > segStart) {
                    segments.push({
                        paragraphIndex: i,
                        startOffset: segStart,
                        endOffset: segEnd,
                        selectedText: pText.slice(segStart, segEnd)
                    });
                }
            }

            if (segments.length === 0) return null;

            return {
                paragraphIndex: startIdx,
                startOffset: segments[0].startOffset,
                endOffset: segments[segments.length - 1].endOffset,
                selectedText,
                segments // 跨段落时有值
            };
        }

        // 处理文字选择
        function handleTextSelection(e) {
            const selection = window.getSelection();
            const selectedText = selection.toString().trim();

            if (selectedText && e.target.closest('#reader-content')) {
                // 显示工具栏
                const range = selection.getRangeAt(0);
                const rect = range.getBoundingClientRect();

                textSelectionToolbar.style.left = rect.left + 'px';
                textSelectionToolbar.style.top = (rect.top - 50) + 'px';
                textSelectionToolbar.classList.add('active');
            } else {
                // 隐藏工具栏和颜色选择器
                if (textSelectionToolbar && !e.target.closest('.text-selection-toolbar') && !e.target.closest('.highlight-color-picker')) {
                    textSelectionToolbar.classList.remove('active');
                    if (highlightColorPicker) highlightColorPicker.classList.remove('active');
                }
            }
        }

        // 复制选中文字
        // 显示已有高亮的编辑选择器（切换颜色/取消划线）
        let highlightEditPicker = null;
        let editingHighlightNoteId = null;

        function showHighlightEditPicker(noteId, highlightEl) {
            editingHighlightNoteId = noteId;

            if (!highlightEditPicker) {
                highlightEditPicker = document.createElement('div');
                highlightEditPicker.className = 'highlight-color-picker';
                highlightEditPicker.innerHTML = `
                    <div class="highlight-color-dot" data-color="yellow" onclick="changeHighlightColor('yellow')"></div>
                    <div class="highlight-color-dot" data-color="pink" onclick="changeHighlightColor('pink')"></div>
                    <div class="highlight-color-dot" data-color="blue" onclick="changeHighlightColor('blue')"></div>
                    <div class="highlight-color-dot" data-color="green" onclick="changeHighlightColor('green')"></div>
                    <div class="highlight-color-dot" data-color="purple" onclick="changeHighlightColor('purple')"></div>
                    <div class="highlight-remove-btn" onclick="removeHighlight()">✕</div>
                `;
                document.body.appendChild(highlightEditPicker);
            }

            // 标记当前颜色
            const currentColor = highlightEl.dataset.color || 'yellow';
            highlightEditPicker.querySelectorAll('.highlight-color-dot').forEach(dot => {
                dot.classList.toggle('active', dot.dataset.color === currentColor);
            });

            // 定位到高亮元素上方
            const rect = highlightEl.getBoundingClientRect();
            highlightEditPicker.style.left = rect.left + 'px';
            highlightEditPicker.style.top = (rect.top - 45) + 'px';
            highlightEditPicker.classList.add('active');

            // 点击其他位置关闭
            setTimeout(() => {
                const closeHandler = (ev) => {
                    if (!ev.target.closest('.highlight-color-picker')) {
                        highlightEditPicker.classList.remove('active');
                        editingHighlightNoteId = null;
                        document.removeEventListener('click', closeHandler);
                    }
                };
                document.addEventListener('click', closeHandler);
            }, 10);
        }

        // 切换已有高亮的颜色
        async function changeHighlightColor(newColor) {
            if (!editingHighlightNoteId) return;
            try {
                await db.readingNotes.update(editingHighlightNoteId, { color: newColor });
                if (highlightEditPicker) highlightEditPicker.classList.remove('active');
                editingHighlightNoteId = null;
                await applyHighlightsForCurrentBook();
                if (typeof showToast === 'function') showToast('✅ 颜色已更换');
            } catch (error) {
                console.error('更改高亮颜色失败:', error);
            }
        }

        // 取消划线
        async function removeHighlight() {
            if (!editingHighlightNoteId) return;
            try {
                await dbHelper.safeDelete('readingNotes', editingHighlightNoteId, '笔记');
                if (highlightEditPicker) highlightEditPicker.classList.remove('active');
                editingHighlightNoteId = null;
                await applyHighlightsForCurrentBook();
                if (typeof showToast === 'function') showToast('🗑️ 划线已取消');
                loadReaderNotesList();
                loadPersonalData();
            } catch (error) {
                console.error('取消划线失败:', error);
            }
        }

        // 复制选中文字
        function copySelectedText() {
            const selectedText = window.getSelection().toString();
            navigator.clipboard.writeText(selectedText).then(() => {
                if (typeof showToast === 'function') {
                    showToast('✅ 已复制');
                }
                textSelectionToolbar.classList.remove('active');
            }).catch(err => {
                alert('复制失败');
            });
        }

        // 高亮选中文字（支持颜色）
        async function highlightSelectedText(color) {
            try {
                if (!currentBook) return;
                const ctx = getSelectionContext();
                if (!ctx) {
                    if (typeof showToast === 'function') {
                        showToast('请选择文本后再划线');
                    }
                    return;
                }

                const highlightColor = color || currentHighlightColor || 'yellow';
                const now = Date.now();

                if (ctx.segments) {
                    // 跨段落：为每个段落分别创建高亮
                    for (const seg of ctx.segments) {
                        await dbHelper.safePut('readingNotes', {
                            bookId: currentBook.id,
                            position: currentReadingPosition,
                            content: seg.selectedText,
                            selectionText: ctx.selectedText,
                            type: 'highlight',
                            color: highlightColor,
                            createdDate: now,
                            paragraphIndex: seg.paragraphIndex,
                            startOffset: seg.startOffset,
                            endOffset: seg.endOffset,
                            groupId: now // 同一次选区的标识，方便关联
                        }, '笔记');
                    }
                } else {
                    // 单段落
                    await dbHelper.safePut('readingNotes', {
                        bookId: currentBook.id,
                        position: currentReadingPosition,
                        content: ctx.selectedText,
                        selectionText: ctx.selectedText,
                        type: 'highlight',
                        color: highlightColor,
                        createdDate: now,
                        paragraphIndex: ctx.paragraphIndex,
                        startOffset: ctx.startOffset,
                        endOffset: ctx.endOffset
                    }, '笔记');
                }

                // 在界面上标记高亮
                applyHighlightsForCurrentBook();

                if (typeof showToast === 'function') {
                    showToast('✅ 已划线');
                }

                textSelectionToolbar.classList.remove('active');
                if (highlightColorPicker) highlightColorPicker.classList.remove('active');
                window.getSelection().removeAllRanges();

            } catch (error) {
                handleError(error, '划线失败', ErrorLevel.ERROR);
            }
        }

        // 为选中文字添加笔记
        async function addNoteToSelection() {
            try {
                if (!currentBook) return;
                const ctx = getSelectionContext();
                if (!ctx) {
                    if (typeof showToast === 'function') {
                        showToast('请选择文本后再添加笔记');
                    }
                    return;
                }

                const noteContent = prompt('请输入笔记:', '');
                if (!noteContent) return;

                const now = Date.now();

                if (ctx.segments) {
                    // 跨段落：为每个段落创建虚线标记，但笔记内容只存在第一条
                    for (let i = 0; i < ctx.segments.length; i++) {
                        const seg = ctx.segments[i];
                        const isFirst = i === 0;
                        await dbHelper.safePut('readingNotes', {
                            bookId: currentBook.id,
                            position: currentReadingPosition,
                            content: isFirst ? `"${ctx.selectedText}"\n\n${noteContent}` : seg.selectedText,
                            selectionText: ctx.selectedText,
                            userNote: isFirst ? noteContent : '',
                            type: 'note',
                            createdDate: now,
                            paragraphIndex: seg.paragraphIndex,
                            startOffset: seg.startOffset,
                            endOffset: seg.endOffset,
                            groupId: now
                        }, '笔记');
                    }
                } else {
                    // 单段落
                    await dbHelper.safePut('readingNotes', {
                        bookId: currentBook.id,
                        position: currentReadingPosition,
                        content: `"${ctx.selectedText}"\n\n${noteContent}`,
                        selectionText: ctx.selectedText,
                        userNote: noteContent,
                        type: 'note',
                        createdDate: now,
                        paragraphIndex: ctx.paragraphIndex,
                        startOffset: ctx.startOffset,
                        endOffset: ctx.endOffset
                    }, '笔记');
                }

                // 刷新高亮/笔记标记显示
                applyHighlightsForCurrentBook();

                if (typeof showToast === 'function') {
                    showToast('✅ 笔记已保存');
                }

                textSelectionToolbar.classList.remove('active');
                window.getSelection().removeAllRanges();

            } catch (error) {
                handleError(error, '添加笔记失败', ErrorLevel.ERROR);
            }
        }

        // 发送选中文字到聊天室
        async function sendSelectionToChat() {
            const selectedText = window.getSelection().toString().trim();
            if (!selectedText || !currentBook) return;

            textSelectionToolbar.classList.remove('active');

            // 获取当前书籍的阅读室列表
            const allRooms = await dbHelper.safeToArray('readingRooms', '阅读室');
            const bookRooms = allRooms ? allRooms.filter(r => r.bookId === currentBook.id) : [];

            if (bookRooms.length === 0) {
                if (confirm(`《${currentBook.title}》还没有阅读室。\n\n要创建一个吗？`)) {
                    await createReadingRoomFromReader();
                    // 创建后设置摘录引用
                    if (currentReadingRoom) {
                        setExcerptQuote(currentBook.title, selectedText);
                    }
                }
                return;
            }

            // 打开阅读室后设置摘录引用
            const openRoomAndSetExcerpt = async (roomId) => {
                await openReadingRoom(roomId);
                setTimeout(() => {
                    setExcerptQuote(currentBook.title, selectedText);
                    document.getElementById('character-chat-input')?.focus();
                }, 500);
            };

            if (bookRooms.length === 1) {
                await openRoomAndSetExcerpt(bookRooms[0].id);
            } else {
                // 多个阅读室，让用户选择
                const roomNames = bookRooms.map((r, i) => `${i + 1}. ${r.name}`).join('\n');
                const choice = prompt(`选择要发送到的阅读室:\n\n${roomNames}\n\n请输入序号:`, '1');
                if (!choice) return;

                const idx = parseInt(choice) - 1;
                if (idx >= 0 && idx < bookRooms.length) {
                    await openRoomAndSetExcerpt(bookRooms[idx].id);
                }
            }
        }

        // 添加书签
        async function addBookmark() {
            try {
                if (!currentBook) {
                    alert('请先打开一本书');
                    return;
                }

                const note = prompt('书签备注（可选）:', '');

                await dbHelper.safePut('bookmarks', {
                    bookId: currentBook.id,
                    position: currentReadingPosition,
                    percentage: currentReadingPercentage,
                    mode: readerMode,
                    note: note || '',
                    createdDate: Date.now()
                }, '书签');

                if (typeof showToast === 'function') {
                    showToast('✅ 书签已添加');
                }

                loadBookmarks();

            } catch (error) {
                handleError(error, '添加书签失败', ErrorLevel.ERROR);
            }
        }

        // 加载书签列表
        async function loadBookmarks() {
            try {
                if (!currentBook) return;

                const bookmarks = await dbHelper.safeWhere('bookmarks', {bookId: currentBook.id}, '书签');
                const listEl = document.getElementById('bookmarks-list');

                if (!bookmarks || bookmarks.length === 0) {
                    listEl.innerHTML = '<div style="opacity:0.5; font-size:0.85rem; padding:10px 0;">暂无书签</div>';
                    return;
                }

                const svgBookmark = '<svg class="icon" style="width:14px;height:14px;stroke:var(--accent);" viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>';
                const svgTrash = '<svg class="icon" style="width:14px;height:14px;" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';

                listEl.innerHTML = bookmarks.map((bm, index) => `
                    <div class="mini-card" style="cursor:pointer; margin-top:8px;" onclick="goToBookmark(${bm.position}, ${bm.percentage || 0}, '${bm.mode || 'scroll'}')">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <span style="font-size:0.85rem; display:flex; align-items:center; gap:5px;">${svgBookmark} 书签 ${index + 1}${bm.note ? ': ' + escapeHtml(bm.note) : ''}</span>
                            <div style="display:flex; align-items:center; gap:8px;">
                                <span style="font-size:0.7rem; opacity:0.6;">${new Date(bm.createdDate).toLocaleDateString()}</span>
                                <span style="opacity:0.4; padding:4px; border-radius:6px; transition:opacity 0.2s;" onclick="event.stopPropagation(); deleteBookmark(${bm.id})" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.4'">${svgTrash}</span>
                            </div>
                        </div>
                    </div>
                `).join('');

            } catch (error) {
                handleError(error, '加载书签失败', ErrorLevel.ERROR);
            }
        }

        async function deleteBookmark(bookmarkId) {
            if (!confirm('确定要删除这个书签吗？')) return;
            try {
                await dbHelper.safeDelete('bookmarks', bookmarkId, '书签');
                if (typeof showToast === 'function') showToast('书签已删除');
                loadBookmarks();
            } catch (error) {
                handleError(error, '删除书签失败', ErrorLevel.ERROR);
            }
        }

        // 跳转到书签位置
        function goToBookmark(position, percentage = 0, mode = 'scroll') {
            const contentEl = document.getElementById('reader-content');
            if (!contentEl) return;

            if (readerMode === 'page') {
                if (mode === 'page') {
                    contentEl.scrollLeft = position || 0;
                } else {
                    const scrollWidth = contentEl.scrollWidth - contentEl.clientWidth;
                    contentEl.scrollLeft = scrollWidth * (percentage / 100);
                }
                currentReadingPosition = contentEl.scrollLeft;
                snapReaderToPage();
                updatePageIndicator();
            } else {
                if (mode === 'scroll') {
                    contentEl.scrollTop = position || 0;
                } else {
                    const scrollHeight = contentEl.scrollHeight - contentEl.clientHeight;
                    contentEl.scrollTop = scrollHeight * (percentage / 100);
                }
                currentReadingPosition = contentEl.scrollTop;
            }

            closeModal('modal-reader-settings');

            if (typeof showToast === 'function') {
                showToast('📍 已跳转到书签位置');
            }
        }

        // 在书中搜索
        async function searchInBook() {
            try {
                if (!currentBook) return;

                const keyword = document.getElementById('reader-search-input').value.trim();
                if (!keyword) {
                    alert('请输入搜索关键词');
                    return;
                }

                const content = currentBook.content || '';
                const lines = content.split('\n');
                const results = [];

                lines.forEach((line, index) => {
                    if (line.includes(keyword)) {
                        results.push({
                            lineNumber: index,
                            content: line
                        });
                    }
                });

                const resultsEl = document.getElementById('search-results');

                if (results.length === 0) {
                    resultsEl.innerHTML = '<div style="opacity:0.5; font-size:0.85rem; padding:10px 0;">未找到相关内容</div>';
                    return;
                }

                resultsEl.innerHTML = `
                    <div style="margin-bottom:10px; font-size:0.85rem; opacity:0.7;">找到 ${results.length} 处结果</div>
                    ${results.slice(0, 10).map(r => `
                        <div class="mini-card" style="cursor:pointer; margin-top:8px;" onclick="goToLine(${r.lineNumber})">
                            <div style="font-size:0.85rem;">${highlightKeyword(r.content, keyword)}</div>
                        </div>
                    `).join('')}
                `;

            } catch (error) {
                handleError(error, '搜索失败', ErrorLevel.ERROR);
            }
        }

        // 高亮关键词
        function highlightKeyword(text, keyword) {
            return escapeHtml(text).replace(new RegExp(escapeRegExp(keyword), 'gi'),
                match => `<mark style="background:rgba(255,235,59,0.5);">${match}</mark>`);
        }

        // 转义正则表达式特殊字符
        function escapeRegExp(string) {
            return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }

        // 跳转到指定行
        function goToLine(lineNumber) {
            const paragraphIndex = mapLineToParagraphIndex(lineNumber);
            closeModal('modal-reader-settings');
            if (paragraphIndex === null) return;
            scrollToParagraph(paragraphIndex);
            if (typeof showToast === 'function') {
                showToast(`📍 已跳转到第 ${lineNumber + 1} 行`);
            }
        }

        function mapLineToParagraphIndex(lineNumber) {
            if (!currentBook) return null;
            const lines = (currentBook.content || '').split('\n');
            let paragraphIndex = -1;
            for (let i = 0; i <= lineNumber && i < lines.length; i++) {
                if (lines[i].trim()) paragraphIndex++;
            }
            return paragraphIndex >= 0 ? paragraphIndex : null;
        }

        function scrollToParagraph(paragraphIndex) {
            const contentEl = document.getElementById('reader-content');
            const paragraph = document.querySelector(`#reader-content [data-paragraph="${paragraphIndex}"]`);
            if (paragraph && contentEl) {
                if (readerMode === 'page') {
                    const step = getReaderPageStep(contentEl);
                    if (step > 0) {
                        // 用 getBoundingClientRect 计算段落在滚动区域中的真实位置
                        // 避免 offsetLeft 受 offsetParent 不同导致的偏差
                        const containerRect = contentEl.getBoundingClientRect();
                        const paragraphRect = paragraph.getBoundingClientRect();
                        const absLeft = paragraphRect.left - containerRect.left + contentEl.scrollLeft;
                        // 对齐到最近的页面边界（step 的整数倍）
                        const pageIndex = Math.max(0, Math.floor(absLeft / step));
                        let target = pageIndex * step;
                        const maxScroll = Math.max(0, contentEl.scrollWidth - contentEl.clientWidth);
                        target = Math.min(target, maxScroll);
                        contentEl.scrollLeft = target;
                        currentReadingPosition = target;
                    }
                    updatePageIndicator();
                    saveReadingProgress();
                } else {
                    paragraph.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    currentReadingPosition = contentEl.scrollTop;
                }
            }
        }

        // 打开记忆表格管理器
        function openMemoryTableManager() {
            if (!currentBook) {
                alert('请先打开一本书');
                return;
            }
            const typeSelect = document.getElementById('book-memory-type');
            if (typeSelect) typeSelect.value = currentBookMemoryType || 'character';
            loadBookMemoryEntries();
            openModal('modal-book-memory');
        }

        // 打开目录
        function openReaderCatalog() {
            if (!currentBook) {
                alert('请先打开一本书');
                return;
            }
            buildReaderCatalog();
            openModal('modal-reader-catalog');
        }

        // 打开笔记列表
        function openReaderNotes() {
            if (!currentBook) {
                alert('请先打开一本书');
                return;
            }
            loadReaderNotesList();
            openModal('modal-reader-notes');
        }

        // 打开进度管理
        function openReaderProgress() {
            if (!currentBook) {
                alert('请先打开一本书');
                return;
            }
            updateReaderProgressModal();
            openModal('modal-reader-progress');
        }

        function updateProgressFromModal(value) {
            seekReaderProgress(value);
            const label = document.getElementById('reader-progress-modal-value');
            if (label) label.textContent = `${value}%`;
        }

        function updateReaderProgressModal() {
            let percentage = currentBook?.progress || 0;
            const contentEl = document.getElementById('reader-content');
            if (contentEl) {
                const scrollSize = readerMode === 'page'
                    ? (contentEl.scrollWidth - contentEl.clientWidth)
                    : (contentEl.scrollHeight - contentEl.clientHeight);
                const currentPos = readerMode === 'page' ? contentEl.scrollLeft : contentEl.scrollTop;
                percentage = scrollSize > 0 ? (currentPos / scrollSize * 100).toFixed(1) : 0;
            }
            const slider = document.getElementById('reader-progress-modal-slider');
            if (slider) slider.value = percentage;
            const label = document.getElementById('reader-progress-modal-value');
            if (label) label.textContent = `${percentage}%`;
            const info = document.getElementById('reader-progress-info');
            if (info) info.textContent = `当前进度: ${percentage}%`;
        }

        function buildReaderCatalog() {
            const listEl = document.getElementById('reader-catalog-list');
            if (!listEl || !currentBook) return;

            if (currentBook.format === 'epub' && Array.isArray(currentBook.toc) && currentBook.toc.length > 0) {
                const tocItems = currentBook.toc;
                const paragraphs = currentBook.content.split('\n').filter(p => p.trim());
                const titleMap = {};
                paragraphs.forEach((p, i) => {
                    const line = p.replace(/^#+\s*/, '').trim();
                    const key = normalizeTocTitle(line);
                    if (key && titleMap[key] === undefined) {
                        titleMap[key] = i;
                    }
                });

                listEl.innerHTML = tocItems.map(item => {
                    const mappedIndex = Number.isFinite(item.index) ? item.index : null;
                    const targetIndex = mappedIndex !== null ? mappedIndex : (titleMap[normalizeTocTitle(item.label)] ?? null);
                    const indent = item.depth ? `padding-left:${item.depth * 14}px;` : '';
                    const disabled = targetIndex === null ? 'opacity:0.5; cursor:default;' : '';
                    const onClick = targetIndex === null
                        ? ''
                        : `onclick="scrollToParagraph(${targetIndex}); closeModal('modal-reader-catalog')"`;
                    return `
                        <div class="mini-card" style="cursor:pointer; margin-bottom:8px; ${indent} ${disabled}" ${onClick}>
                            <div style="font-weight:bold;">${escapeHtml(item.label || '未命名')}</div>
                        </div>
                    `;
                }).join('');
                return;
            }

            const paragraphs = (currentBook.content || '').split('\n').filter(p => p.trim());
            const catalog = [];

            const isHeading = (text) => {
                const t = text.trim();
                if (t.length === 0 || t.length > 40) return false;
                if (/^#{1,6}\s+/.test(t)) return true;
                if (/^第.{1,9}章/.test(t)) return true;
                if (/^chapter\s+\d+/i.test(t)) return true;
                if (/^(序|前言|引子|后记|尾声)/.test(t)) return true;
                if (/^\d+[、.]\s?/.test(t) && t.length <= 20) return true;
                return false;
            };

            paragraphs.forEach((p, idx) => {
                if (isHeading(p)) {
                    catalog.push({ title: p.trim(), index: idx });
                }
            });

            if (catalog.length === 0) {
                listEl.innerHTML = '<div style="opacity:0.5; text-align:center; padding:20px;">暂无目录</div>';
                return;
            }

            listEl.innerHTML = catalog.map(item => `
                <div class="mini-card" style="cursor:pointer; margin-bottom:8px;" onclick="scrollToParagraph(${item.index}); closeModal('modal-reader-catalog')">
                    <div style="font-weight:bold;">${escapeHtml(item.title)}</div>
                </div>
            `).join('');
        }

        function normalizeTocTitle(text) {
            return (text || '')
                .toLowerCase()
                .replace(/\s+/g, '')
                .replace(/[^\w\u4e00-\u9fa5]/g, '');
        }

        async function loadReaderNotesList() {
            if (!currentBook) return;
            const listEl = document.getElementById('reader-notes-list');
            if (!listEl) return;

            const notes = await dbHelper.safeWhere('readingNotes', { bookId: currentBook.id }, '笔记');
            if (!notes || notes.length === 0) {
                listEl.innerHTML = '<div style="opacity:0.5; text-align:center; padding:20px;">暂无笔记</div>';
                return;
            }

            notes.sort((a, b) => (b.createdDate || 0) - (a.createdDate || 0));

            listEl.innerHTML = notes.map(note => {
                const typeLabel = note.type === 'highlight' ? '划线' : '笔记';
                const colorDot = note.type === 'highlight' && note.color
                    ? `<span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:${getHighlightCssColor(note.color)}; margin-left:6px;"></span>`
                    : '';

                // 原文摘录区域（不可修改样式）
                const excerptText = note.selectionText || '';
                const excerptHtml = excerptText
                    ? `<div style="font-size:0.83rem; margin-top:6px; padding:6px 10px; background:rgba(0,0,0,0.03); border-left:3px solid var(--accent); border-radius:0 6px 6px 0; color:var(--text); opacity:0.85; max-height:60px; overflow-y:auto; line-height:1.5;">${escapeHtml(excerptText.substring(0, 200))}${excerptText.length > 200 ? '...' : ''}</div>`
                    : '';

                // 用户笔记区域
                let userNoteHtml = '';
                if (note.type === 'note') {
                    // 优先用 userNote 字段，兼容旧笔记从 content 中解析
                    let userNote = note.userNote || '';
                    if (!userNote && excerptText && note.content) {
                        const prefix = `"${excerptText}"\n\n`;
                        if (note.content.startsWith(prefix)) {
                            userNote = note.content.substring(prefix.length);
                        } else if (note.content !== excerptText) {
                            userNote = note.content;
                        }
                    }
                    if (userNote) {
                        userNoteHtml = `
                            <div style="font-size:0.7rem; opacity:0.5; margin-top:6px;">我的想法</div>
                            <div style="font-size:0.83rem; padding:6px 10px; border-left:3px dashed var(--highlight); border-radius:0 6px 6px 0; font-style:italic; max-height:60px; overflow-y:auto; line-height:1.5;">${escapeHtml(userNote.substring(0, 200))}${userNote.length > 200 ? '...' : ''}</div>
                        `;
                    } else if (!excerptText && note.content) {
                        // 没有原文的独立笔记
                        userNoteHtml = `<div style="font-size:0.83rem; margin-top:6px; line-height:1.5;">${escapeHtml(note.content.substring(0, 200))}${note.content.length > 200 ? '...' : ''}</div>`;
                    }
                }

                return `
                    <div class="mini-card" style="margin-bottom:10px;">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <div style="font-weight:bold; display:flex; align-items:center;">${typeLabel}${colorDot}</div>
                            <div style="font-size:0.7rem; opacity:0.6;">${new Date(note.createdDate).toLocaleDateString()}</div>
                        </div>
                        ${excerptHtml}
                        ${userNoteHtml}
                        <div style="display:flex; gap:8px; margin-top:8px; flex-wrap:wrap;">
                            <button class="btn-sec" style="width:auto; padding:4px 8px; font-size:0.7rem;" onclick="goToNotePosition(${note.id})">定位</button>
                            <button class="btn-sec" style="width:auto; padding:4px 8px; font-size:0.7rem;" onclick="openNoteDetail(${note.id})">查看/编辑</button>
                            <button class="btn-sec" style="width:auto; padding:4px 8px; font-size:0.7rem;" onclick="sendNoteToChat(${note.id})">发送</button>
                            <button class="btn-sec" style="width:auto; padding:4px 8px; font-size:0.7rem; color:#c62828;" onclick="deleteNote(${note.id})">删除</button>
                        </div>
                    </div>
                `;
            }).join('');
        }

        async function addManualReaderNote() {
            if (!currentBook) {
                alert('请先打开一本书');
                return;
            }
            const noteContent = prompt('请输入笔记内容:', '');
            if (!noteContent) return;

            await dbHelper.safePut('readingNotes', {
                bookId: currentBook.id,
                position: currentReadingPosition,
                content: noteContent.trim(),
                type: 'note',
                createdDate: Date.now()
            }, '笔记');

            if (typeof showToast === 'function') showToast('✅ 笔记已保存');
            loadReaderNotesList();
            loadPersonalData();
        }

        async function openNoteDetail(noteId) {
            const note = await dbHelper.safeGet('readingNotes', noteId, '笔记');
            if (!note) {
                alert('笔记不存在');
                return;
            }

            currentNoteDetailId = note.id;
            const book = await dbHelper.safeGet('libraryBooks', note.bookId, '书籍');
            const metaEl = document.getElementById('note-detail-meta');
            const typeLabel = note.type === 'highlight' ? '划线' : '笔记';
            const bookTitle = book ? book.title : '未知书籍';
            if (metaEl) metaEl.textContent = `《${bookTitle}》 · ${typeLabel} · ${new Date(note.createdDate).toLocaleString()}`;

            // 原文摘录区域
            const excerptSection = document.getElementById('note-detail-excerpt');
            const excerptTextEl = document.getElementById('note-detail-excerpt-text');
            const excerptText = note.selectionText || '';
            if (excerptText && excerptSection && excerptTextEl) {
                excerptTextEl.textContent = excerptText;
                excerptSection.style.display = 'block';
            } else if (excerptSection) {
                excerptSection.style.display = 'none';
            }

            // 用户笔记区域
            const contentEl = document.getElementById('note-detail-content');
            const userNoteLabel = document.getElementById('note-detail-usernote-label');

            if (note.type === 'note') {
                // 笔记类型：解析用户笔记
                let userNote = note.userNote || '';
                if (!userNote && excerptText && note.content) {
                    const prefix = `"${excerptText}"\n\n`;
                    if (note.content.startsWith(prefix)) {
                        userNote = note.content.substring(prefix.length);
                    } else if (note.content !== excerptText) {
                        userNote = note.content;
                    }
                }
                if (contentEl) contentEl.value = userNote;
                if (userNoteLabel) userNoteLabel.style.display = excerptText ? 'block' : 'none';
                if (contentEl) contentEl.placeholder = '写下你的想法...';
            } else {
                // 划线类型：没有用户笔记区域内容，但允许添加
                if (contentEl) contentEl.value = '';
                if (userNoteLabel) userNoteLabel.style.display = 'none';
                if (contentEl) contentEl.placeholder = '可以为这段划线添加笔记...';
            }

            openModal('modal-note-detail');
        }

        async function saveNoteDetail() {
            if (!currentNoteDetailId) return;
            const contentEl = document.getElementById('note-detail-content');
            const newUserNote = contentEl ? contentEl.value.trim() : '';

            // 获取当前笔记以保留原文信息
            const note = await dbHelper.safeGet('readingNotes', currentNoteDetailId, '笔记');
            if (!note) return;

            const excerptText = note.selectionText || '';
            const updateData = { updatedDate: Date.now() };

            if (note.type === 'note') {
                if (!newUserNote && !excerptText) {
                    alert('笔记内容不能为空');
                    return;
                }
                updateData.userNote = newUserNote;
                // 同时更新 content 保持兼容
                updateData.content = excerptText
                    ? `"${excerptText}"\n\n${newUserNote}`
                    : newUserNote;
            } else {
                // 划线类型：如果用户添加了笔记，升级为笔记类型
                if (newUserNote) {
                    updateData.type = 'note';
                    updateData.userNote = newUserNote;
                    updateData.content = excerptText
                        ? `"${excerptText}"\n\n${newUserNote}`
                        : newUserNote;
                }
            }

            await db.readingNotes.update(currentNoteDetailId, updateData);

            if (typeof showToast === 'function') showToast('✅ 笔记已更新');
            loadReaderNotesList();
            loadPersonalData();
            applyHighlightsForCurrentBook();
        }

        async function deleteNoteDetail() {
            if (!currentNoteDetailId) return;
            await deleteNote(currentNoteDetailId);
            closeModal('modal-note-detail');
            currentNoteDetailId = null;
        }

        async function deleteNote(noteId) {
            if (!confirm('确定要删除这条笔记吗？')) return;
            await dbHelper.safeDelete('readingNotes', noteId, '笔记');
            if (typeof showToast === 'function') showToast('🗑️ 笔记已删除');
            loadReaderNotesList();
            loadPersonalData();
            applyHighlightsForCurrentBook();
        }

        async function goToNotePosition(noteId) {
            const note = await dbHelper.safeGet('readingNotes', noteId, '笔记');
            if (!note) return;

            if (!currentBook || currentBook.id !== note.bookId) {
                await openBook(note.bookId);
            }

            setTimeout(() => {
                if (note.paragraphIndex !== undefined && note.paragraphIndex !== null) {
                    scrollToParagraph(note.paragraphIndex);
                } else if (note.position !== undefined && note.position !== null) {
                    const contentEl = document.getElementById('reader-content');
                    if (contentEl) contentEl.scrollTop = note.position;
                }
                closeModal('modal-reader-notes');
            }, 300);
        }

        // 获取高亮颜色对应的 CSS 颜色值（用于展示色点）
        function getHighlightCssColor(colorName) {
            const map = {
                yellow: 'rgba(255, 235, 59, 0.7)',
                pink: 'rgba(255, 105, 135, 0.7)',
                blue: 'rgba(100, 181, 246, 0.7)',
                green: 'rgba(129, 199, 132, 0.7)',
                purple: 'rgba(186, 104, 200, 0.7)'
            };
            return map[colorName] || map.yellow;
        }

        function extractNoteExcerpt(note) {
            if (note.selectionText) return note.selectionText;
            const content = note.content || '';
            const match = content.match(/^"([\s\S]*?)"/);
            if (match && match[1]) return match[1];
            return '';
        }

        async function sendNoteToChat(noteId = null) {
            const targetId = noteId || currentNoteDetailId;
            if (!targetId) return;

            const note = await dbHelper.safeGet('readingNotes', targetId, '笔记');
            if (!note) return;

            const book = await dbHelper.safeGet('libraryBooks', note.bookId, '书籍');
            const bookTitle = book ? book.title : '未知书籍';
            const excerpt = extractNoteExcerpt(note);

            // 提取用户笔记内容
            let userNote = '';
            if (note.type === 'note') {
                // 优先使用新的 userNote 字段
                if (note.userNote) {
                    userNote = note.userNote;
                } else {
                    // 兼容旧格式：从 content 中提取
                    const content = note.content || '';
                    const match = content.match(/^"[\s\S]*?"\s*\n\s*\n([\s\S]*)$/);
                    if (match && match[1]) {
                        userNote = match[1].trim();
                    } else if (!content.startsWith('"')) {
                        userNote = content.trim();
                    }
                }
            }

            // 设置摘录引用（不自动发送，用户可继续输入）
            const setupQuoteAndFocus = () => {
                setExcerptQuote(bookTitle, excerpt || note.content, userNote || undefined);
                const input = document.getElementById('character-chat-input');
                if (input) input.focus();
            };

            // 优先发送到当前聊天
            if (currentChatCharacter) {
                const sameBook = !currentReadingRoom || currentReadingRoom.bookId === note.bookId;
                if (sameBook || confirm('当前聊天与该书籍不一致，仍要发送吗？')) {
                    setupQuoteAndFocus();
                    return;
                }
            }

            // 读取对应书籍的阅读室列表
            const rooms = await db.readingRooms.where('bookId').equals(note.bookId).toArray();
            if (rooms && rooms.length > 0) {
                const roomNames = rooms.map((r, i) => `${i + 1}. ${r.name}`).join('\n');
                const choice = prompt(`选择要发送到的阅读室:\n\n${roomNames}\n\n请输入序号:`, '1');
                if (!choice) return;
                const idx = parseInt(choice) - 1;
                if (idx >= 0 && idx < rooms.length) {
                    await openReadingRoom(rooms[idx].id);
                    setTimeout(() => setupQuoteAndFocus(), 500);
                }
                return;
            }

            // 没有阅读室，尝试发送到普通聊天
            const characters = await db.characters.toArray();
            if (!characters || characters.length === 0) {
                alert('没有可发送的聊天室，请先创建角色或阅读室');
                return;
            }
            const charNames = characters.map((c, i) => `${i + 1}. ${c.name}`).join('\n');
            const cChoice = prompt(`选择要发送到的角色聊天:\n\n${charNames}\n\n请输入序号:`, '1');
            if (!cChoice) return;
            const cIdx = parseInt(cChoice) - 1;
            if (cIdx >= 0 && cIdx < characters.length) {
                currentEditingCharacter = characters[cIdx];
                openCharacterChat();
                setTimeout(() => setupQuoteAndFocus(), 500);
            }
        }

        async function loadBookMemoryEntries() {
            if (!currentBook) return;
            const listEl = document.getElementById('book-memory-list');
            if (!listEl) return;

            const typeSelect = document.getElementById('book-memory-type');
            const type = typeSelect ? typeSelect.value : currentBookMemoryType;
            currentBookMemoryType = type;

            const entries = await db.memoryTables.where('bookId').equals(currentBook.id).toArray();
            const filtered = (entries || []).filter(e => e.type === type);

            if (filtered.length === 0) {
                listEl.innerHTML = '<div style="opacity:0.5; text-align:center; padding:20px;">暂无记忆条目</div>';
                return;
            }

            filtered.sort((a, b) => (b.updatedDate || b.createdDate || 0) - (a.updatedDate || a.createdDate || 0));

            listEl.innerHTML = filtered.map(entry => `
                <div class="mini-card" style="margin-bottom:10px;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div style="font-weight:bold;">${escapeHtml(entry.title || '未命名')}</div>
                        <div style="font-size:0.7rem; opacity:0.6;">${new Date(entry.updatedDate || entry.createdDate).toLocaleDateString()}</div>
                    </div>
                    <div class="markdown-content" style="font-size:0.85rem; margin-top:6px;">${renderMarkdown(entry.content || '')}</div>
                    <div style="display:flex; gap:8px; margin-top:8px;">
                        <button class="btn-sec" style="width:auto; padding:4px 8px; font-size:0.7rem;" onclick="editBookMemoryEntry(${entry.id})">编辑</button>
                        <button class="btn-sec" style="width:auto; padding:4px 8px; font-size:0.7rem; color:#c62828;" onclick="deleteBookMemoryEntry(${entry.id})">删除</button>
                    </div>
                </div>
            `).join('');
        }

        function openBookMemoryEntryEditor(entry = null) {
            const titleEl = document.getElementById('book-memory-editor-title');
            const idInput = document.getElementById('book-memory-entry-id');
            const titleInput = document.getElementById('book-memory-entry-title');
            const contentInput = document.getElementById('book-memory-entry-content');
            const typeSelect = document.getElementById('book-memory-type');
            if (!titleEl || !idInput || !titleInput || !contentInput) return;

            if (entry) {
                idInput.value = entry.id ?? '';
                titleInput.value = entry.title || '';
                contentInput.value = entry.content || '';
                titleEl.textContent = '编辑记忆条目';
                if (entry.type && typeSelect) {
                    typeSelect.value = entry.type;
                    currentBookMemoryType = entry.type;
                }
            } else {
                idInput.value = '';
                titleInput.value = '';
                contentInput.value = '';
                titleEl.textContent = '新增记忆条目';
            }

            openModal('modal-book-memory-editor');
            setTimeout(() => titleInput.focus(), 30);
        }

        async function addBookMemoryEntry() {
            if (!currentBook) {
                alert('请先打开一本书');
                return;
            }
            openBookMemoryEntryEditor();
        }

        async function editBookMemoryEntry(entryId) {
            try {
                const id = Number(entryId);
                const key = Number.isNaN(id) ? entryId : id;
                const entry = await dbHelper.safeGet('memoryTables', key, '记忆库');
                if (!entry) {
                    alert('条目不存在，可能已被删除');
                    return;
                }
                openBookMemoryEntryEditor(entry);
            } catch (error) {
                handleError(error, '编辑记忆条目失败', ErrorLevel.ERROR);
            }
        }

        async function saveBookMemoryEntryFromModal() {
            try {
                if (!currentBook) {
                    alert('请先打开一本书');
                    return;
                }

                const idInput = document.getElementById('book-memory-entry-id');
                const titleInput = document.getElementById('book-memory-entry-title');
                const contentInput = document.getElementById('book-memory-entry-content');
                const typeSelect = document.getElementById('book-memory-type');
                if (!idInput || !titleInput || !contentInput) return;

                const normalizedTitle = (titleInput.value || '').trim();
                const normalizedContent = (contentInput.value || '').trim();
                if (!normalizedTitle) {
                    alert('条目名称不能为空');
                    titleInput.focus();
                    return;
                }
                if (!normalizedContent) {
                    alert('条目内容不能为空');
                    contentInput.focus();
                    return;
                }

                const type = typeSelect ? typeSelect.value : currentBookMemoryType;
                const now = Date.now();
                const idRaw = (idInput.value || '').trim();

                if (idRaw) {
                    const id = Number(idRaw);
                    const key = Number.isNaN(id) ? idRaw : id;
                    const existing = await dbHelper.safeGet('memoryTables', key, '记忆库');
                    if (!existing) {
                        alert('条目不存在，可能已被删除');
                        closeModal('modal-book-memory-editor');
                        await loadBookMemoryEntries();
                        return;
                    }
                    await dbHelper.safePut('memoryTables', {
                        ...existing,
                        id: key,
                        bookId: currentBook.id,
                        type: type,
                        title: normalizedTitle,
                        content: normalizedContent,
                        createdDate: existing.createdDate || now,
                        updatedDate: now
                    }, '记忆库');
                    if (typeof showToast === 'function') showToast('✅ 记忆条目已更新');
                } else {
                    await dbHelper.safePut('memoryTables', {
                        bookId: currentBook.id,
                        type: type,
                        title: normalizedTitle,
                        content: normalizedContent,
                        createdDate: now,
                        updatedDate: now
                    }, '记忆库');
                    if (typeof showToast === 'function') showToast('✅ 记忆条目已添加');
                }

                closeModal('modal-book-memory-editor');
                await loadBookMemoryEntries();
            } catch (error) {
                handleError(error, '保存记忆条目失败', ErrorLevel.ERROR);
            }
        }

        async function deleteBookMemoryEntry(entryId) {
            try {
                if (!confirm('确定要删除这条记忆吗？')) return;
                const id = Number(entryId);
                await dbHelper.safeDelete('memoryTables', Number.isNaN(id) ? entryId : id, '记忆库');
                if (typeof showToast === 'function') showToast('✅ 记忆条目已删除');
                await loadBookMemoryEntries();
            } catch (error) {
                handleError(error, '删除记忆条目失败', ErrorLevel.ERROR);
            }
        }

        async function summarizeBookRange() {
            if (!currentBook) {
                alert('请先打开一本书');
                return;
            }
            if (!store.apiConfig?.sub?.url || !store.apiConfig?.sub?.key) {
                alert('请先在设置中配置副API');
                return;
            }

            const startInput = document.getElementById('book-memory-range-start');
            const endInput = document.getElementById('book-memory-range-end');
            const startPct = Math.max(0, Math.min(100, parseFloat(startInput.value)));
            const endPct = Math.max(0, Math.min(100, parseFloat(endInput.value)));

            if (Number.isNaN(startPct) || Number.isNaN(endPct) || endPct <= startPct) {
                alert('请输入正确的范围（结束百分比需大于开始百分比）');
                return;
            }

            if (!currentBook.content || typeof currentBook.content !== 'string') {
                alert('当前书籍缺少正文内容，无法执行总结');
                return;
            }

            const total = currentBook.content.length;
            const startIdx = Math.floor(total * (startPct / 100));
            const endIdx = Math.floor(total * (endPct / 100));
            let snippet = currentBook.content.slice(startIdx, endIdx);
            if (!snippet.trim()) {
                alert('所选范围没有可总结的内容，请调整范围');
                return;
            }
            const maxLen = 6000;
            if (snippet.length > maxLen) {
                snippet = snippet.slice(0, maxLen) + '\n...[内容过长已截断]';
            }

            const typeSelect = document.getElementById('book-memory-type');
            const type = typeSelect ? typeSelect.value : currentBookMemoryType;
            const typeLabelMap = { character: '人物', item: '物品', plot: '剧情' };
            const typeLabel = typeLabelMap[type] || '剧情';

            const summaryPrompt = `请根据以下书籍片段，总结出${typeLabel}相关的信息，输出为简洁要点。如果没有相关内容，请输出“无”。\n\n书籍片段:\n${snippet}`;

            try {
                const apiUrl = store.apiConfig.sub.url.endsWith('/')
                    ? store.apiConfig.sub.url + 'chat/completions'
                    : store.apiConfig.sub.url + '/chat/completions';

                const res = await fetch(apiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${store.apiConfig.sub.key}`
                    },
                    body: JSON.stringify({
                        model: store.apiConfig.sub.model,
                        messages: [{ role: 'user', content: summaryPrompt }],
                        temperature: 0.3
                    })
                });

                if (!res.ok) throw new Error('副API调用失败');
                const data = await res.json();
                const summary = data.choices?.[0]?.message?.content?.trim();

                if (summary) {
                    await dbHelper.safePut('memoryTables', {
                        bookId: currentBook.id,
                        type: type,
                        title: `AI总结 ${startPct}%~${endPct}%`,
                        content: summary,
                        createdDate: Date.now(),
                        rangeStart: startPct,
                        rangeEnd: endPct,
                        aiGenerated: true
                    }, '记忆库');

                    if (typeof showToast === 'function') showToast('✅ 记忆库已更新');
                    await loadBookMemoryEntries();
                }
            } catch (error) {
                handleError(error, 'AI总结失败', ErrorLevel.ERROR);
            }
        }

        function getReadingSpoilerMode() {
            return currentReadingRoom?.spoilerMode || 'first';
        }

        function updateReadingSpoilerToggle() {
            const toggleEl = document.getElementById('reading-spoiler-toggle');
            if (!toggleEl) return;
            if (!currentReadingRoom) {
                toggleEl.style.display = 'none';
                return;
            }
            toggleEl.style.display = 'inline-flex';
            const mode = getReadingSpoilerMode();
            if (mode === 'first') {
                toggleEl.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';
                toggleEl.title = '阅读状态：初读模式';
            } else {
                toggleEl.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
                toggleEl.title = '阅读状态：重温模式';
            }
        }

        async function toggleReadingSpoilerMode() {
            if (!currentReadingRoom) return;
            currentReadingRoom.spoilerMode = getReadingSpoilerMode() === 'first' ? 'reread' : 'first';
            await db.readingRooms.put(currentReadingRoom);
            updateReadingSpoilerToggle();
            if (typeof showToast === 'function') {
                showToast(currentReadingRoom.spoilerMode === 'first' ? '已切换为初读模式' : '已切换为重温模式');
            }
        }

        // 打开阅读室（集成角色聊天系统）
        async function openReadingRoom(roomId, keepCurrentBook = false) {
            try {
                const id = parseInt(roomId);
                console.log('[阅读室] 打开 ID:', id);

                const room = await dbHelper.safeGet('readingRooms', id, '阅读室');
                if (!room) {
                    alert('阅读室不存在');
                    return;
                }

                // 阅读室模式与角色会话模式互斥，避免上下文串线
                currentCharacterSession = null;
                if (typeof closeCharacterSessionSidebar === 'function') closeCharacterSessionSidebar();
                if (typeof hideCharacterSessionContextMenu === 'function') hideCharacterSessionContextMenu();

                // 初始化聊天历史
                if (!room.chatHistory) room.chatHistory = [];

                // 检查是否关联了角色
                if (!room.characterId) {
                    // 没有角色，让用户选择
                    const selectedCharId = await showCharacterPickerForRoom();
                    if (!selectedCharId) return; // 用户取消

                    room.characterId = selectedCharId;
                    await db.readingRooms.put(room);
                }

                // 加载角色数据
                const character = await db.characters.get(room.characterId);
                if (!character) {
                    alert('关联的角色不存在，请重新选择');
                    room.characterId = null;
                    await db.readingRooms.put(room);
                    return;
                }

                // 加载关联的书籍信息（用于上下文注入）
                // keepCurrentBook=true 时保留当前正在阅读的书作为上下文（从阅读器进入其他书的阅读室）
                if (!keepCurrentBook && room.bookId && (!currentBook || currentBook.id !== room.bookId)) {
                    const book = await dbHelper.safeGet('libraryBooks', room.bookId, '书籍');
                    if (book) currentBook = book;
                }

                // 设置阅读室模式
                if (!room.spoilerMode) {
                    room.spoilerMode = 'first';
                    await db.readingRooms.put(room);
                }
                currentReadingRoom = room;
                // 标记是否从阅读器内进入（悬浮按钮），用于决定是否注入书本上下文
                currentReadingRoom.openedFromReader =
                    document.getElementById('reader-screen')?.style.display === 'flex';
                console.log('[阅读室] openedFromReader:', currentReadingRoom.openedFromReader,
                    'reader-screen display:', document.getElementById('reader-screen')?.style.display);
                updateReadingSpoilerToggle();
                const sessionBtn = document.getElementById('chat-session-btn');
                if (sessionBtn) sessionBtn.style.display = 'none';

                // 创建角色的工作副本，使用阅读室的聊天历史和阅读室自己的长期记忆
                currentChatCharacter = {
                    ...character,
                    chatHistory: room.chatHistory,
                    longTermMemory: Array.isArray(room.longTermMemory) ? room.longTermMemory : []
                };

                // 设置聊天界面
                document.body.classList.add('no-scroll');
                document.getElementById('chat-avatar').src = character.avatar || getAvatarPlaceholder(40);
                document.getElementById('chat-character-name').textContent = currentReadingRoom.openedFromReader
                    ? `${character.name} · ${room.name} 📖`
                    : `${character.name} · ${room.name}`;

                // 渲染聊天历史
                renderCharacterChatHistory();

                // 显示聊天界面（z-index 需要在阅读器和图书馆之上）
                const chatScreen = document.getElementById('character-chat-screen');
                chatScreen.style.display = 'flex';
                chatScreen.style.zIndex = '9000';

                // 聚焦输入框
                setTimeout(() => {
                    document.getElementById('character-chat-input').focus();
                }, 300);

                console.log('[阅读室] 已打开:', room.name, '角色:', character.name);

                if (currentReadingRoom.openedFromReader) {
                    showToast('📖 同步阅读模式 — AI 会读取当前页面内容');
                }

            } catch (error) {
                handleError(error, '打开阅读室失败', ErrorLevel.ERROR);
            }
        }

        // 角色选择器弹窗（用于阅读室）
        function showCharacterPickerForRoom() {
            return new Promise(async (resolve) => {
                try {
                    const characters = await db.characters.toArray();
                    if (!characters || characters.length === 0) {
                        alert('还没有创建任何角色，请先在角色管理中创建角色');
                        resolve(null);
                        return;
                    }

                    // 创建选择器弹窗
                    const modal = document.getElementById('modal-room-character-picker');
                    const listEl = document.getElementById('room-character-list');

                    listEl.innerHTML = characters.map(char => `
                        <div class="mini-card" style="display:flex; align-items:center; gap:12px; padding:12px; cursor:pointer; margin-bottom:8px;" data-char-id="${char.id}">
                            <img src="${char.avatar || getAvatarPlaceholder(40)}" style="width:40px; height:40px; border-radius:50%; object-fit:cover; border:2px solid var(--accent);">
                            <div style="flex:1;">
                                <div style="font-weight:bold; font-size:0.95rem;">${char.name}</div>
                                <div style="font-size:0.75rem; opacity:0.6; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${char.description?.substring(0, 50) || '无描述'}</div>
                            </div>
                        </div>
                    `).join('');

                    // 绑定点击事件
                    listEl.querySelectorAll('[data-char-id]').forEach(el => {
                        el.onclick = () => {
                            const charId = el.dataset.charId;
                            closeModal('modal-room-character-picker');
                            resolve(charId);
                        };
                    });

                    // 取消按钮
                    modal.querySelector('.btn-sec').onclick = () => {
                        closeModal('modal-room-character-picker');
                        resolve(null);
                    };

                    openModal('modal-room-character-picker');

                } catch (error) {
                    console.error('[阅读室] 角色选择失败:', error);
                    resolve(null);
                }
            });
        }

        // 构建阅读室上下文（注入到AI系统提示中）
        // 获取当前阅读器中用户正在阅读的段落索引
        function getCurrentVisibleParagraphIndex() {
            const contentEl = document.getElementById('reader-content');
            if (!contentEl) return 0;

            const paragraphs = contentEl.querySelectorAll('[data-paragraph]');
            if (paragraphs.length === 0) return 0;

            if (readerMode === 'page') {
                // 翻页模式：通过 scrollLeft 和页宽计算
                const viewLeft = contentEl.scrollLeft;
                const viewRight = viewLeft + contentEl.clientWidth;
                const viewCenter = (viewLeft + viewRight) / 2;
                let closest = 0;
                let closestDist = Infinity;
                paragraphs.forEach(p => {
                    const pCenter = p.offsetLeft + p.offsetWidth / 2;
                    const dist = Math.abs(pCenter - viewCenter);
                    if (dist < closestDist) {
                        closestDist = dist;
                        closest = parseInt(p.dataset.paragraph) || 0;
                    }
                });
                return closest;
            } else {
                // 滚动模式：通过 scrollTop 和 viewport 中心计算
                const viewTop = contentEl.scrollTop;
                const viewCenter = viewTop + contentEl.clientHeight / 2;
                let closest = 0;
                let closestDist = Infinity;
                paragraphs.forEach(p => {
                    const pCenter = p.offsetTop + p.offsetHeight / 2;
                    const dist = Math.abs(pCenter - viewCenter);
                    if (dist < closestDist) {
                        closestDist = dist;
                        closest = parseInt(p.dataset.paragraph) || 0;
                    }
                });
                return closest;
            }
        }

        async function buildReadingRoomContext() {
            console.log('[阅读上下文] buildReadingRoomContext 被调用',
                'openedFromReader:', currentReadingRoom?.openedFromReader,
                'currentBook:', currentBook?.title,
                'readerVisible:', document.getElementById('reader-screen')?.style.display);
            // 非阅读器入口（从图书馆列表直接进入），不注入书本上下文
            if (!currentReadingRoom?.openedFromReader) {
                // 仍然返回基本阅读室信息
                let context = '\n# 阅读室模式\n\n';
                context += '你现在处于"阅读室"聊天模式。\n';
                if (currentReadingRoom && currentReadingRoom.name) {
                    context += `阅读室名称: ${currentReadingRoom.name}\n`;
                }
                const spoilerMode = currentReadingRoom?.spoilerMode || 'first';
                if (spoilerMode === 'first') {
                    context += '【初读模式】请避免剧透。\n';
                } else {
                    context += '【重温模式】允许结合全书讨论。\n';
                }
                return context;
            }

            // === 从阅读器悬浮按钮进入：注入完整书本上下文 ===
            let context = '\n# 阅读室模式 - 同步阅读上下文\n\n';
            context += '你现在正在陪伴用户阅读。你可以看到用户当前正在阅读的书页内容，请像一位一起读书的朋友一样与用户讨论。\n\n';

            const spoilerMode = currentReadingRoom?.spoilerMode || 'first';
            if (spoilerMode === 'first') {
                context += '【初读模式】请严格避免透露任何超出用户当前阅读进度的剧情与信息，只讨论已读内容。\n\n';
            } else if (spoilerMode === 'reread') {
                context += '【重温模式】允许结合全书进行讨论，但仍需尊重用户当下的问题与关注点。\n\n';
            }

            if (currentBook) {
                context += `## 当前书籍\n`;
                context += `- 书名: 《${currentBook.title}》\n`;

                // 基于段落提取当前阅读位置附近的内容
                if (currentBook.content) {
                    const config = store.readingContextConfig || { paragraphsBefore: 3, paragraphsAfter: 5, maxChars: 3000 };
                    const allParagraphs = currentBook.content.split('\n').filter(p => p.trim());
                    const totalParagraphs = allParagraphs.length;
                    const currentIdx = getCurrentVisibleParagraphIndex();

                    const startIdx = Math.max(0, currentIdx - config.paragraphsBefore);
                    const endIdx = Math.min(totalParagraphs - 1, currentIdx + config.paragraphsAfter);

                    // 收集段落，尊重最大字符数限制
                    let collected = [];
                    let totalChars = 0;
                    for (let i = startIdx; i <= endIdx; i++) {
                        const pText = allParagraphs[i];
                        if (totalChars + pText.length > config.maxChars && collected.length > 0) {
                            break;
                        }
                        collected.push({ index: i, text: pText, isCurrent: i === currentIdx });
                        totalChars += pText.length;
                    }

                    const progressPct = totalParagraphs > 1 ? Math.round((currentIdx / (totalParagraphs - 1)) * 100) : 0;
                    context += `- 当前阅读进度: ${progressPct}%（第 ${currentIdx + 1} / ${totalParagraphs} 段）\n\n`;

                    if (collected.length > 0) {
                        context += `## 用户当前正在阅读的内容（第 ${startIdx + 1}~${startIdx + collected.length} 段）\n\n`;
                        collected.forEach(cp => {
                            if (cp.isCurrent) {
                                context += `>>> [用户当前阅读位置] ${cp.text}\n\n`;
                            } else {
                                context += `${cp.text}\n\n`;
                            }
                        });
                        console.log(`[阅读上下文] 注入 ${collected.length} 个段落 (${totalChars} 字符) - 《${currentBook.title}》`);
                    }
                }

                context += '请基于以上内容与用户讨论。如果用户提到了书中的人物、情节或概念，尽量结合上下文给出有深度的回答。\n';

                // 读取记忆库（如有）
                try {
                    const memoryEntries = await db.memoryTables.where('bookId').equals(currentBook.id).toArray();
                    if (memoryEntries && memoryEntries.length > 0) {
                        const group = { character: [], item: [], plot: [] };
                        memoryEntries.forEach(entry => {
                            if (group[entry.type]) group[entry.type].push(entry);
                        });
                        const renderMemoryGroup = (label, items) => {
                            if (!items || items.length === 0) return;
                            context += `\n### ${label}\n`;
                            items.slice(0, 5).forEach(it => {
                                const title = it.title || '未命名';
                                const desc = (it.content || '').slice(0, 500);
                                context += `- ${title}: ${desc}\n`;
                            });
                        };
                        context += `\n## 阅读记忆库\n`;
                        renderMemoryGroup('人物', group.character);
                        renderMemoryGroup('物品', group.item);
                        renderMemoryGroup('剧情', group.plot);
                    }
                } catch (e) {
                    console.warn('读取记忆库失败:', e);
                }
            }

            if (currentReadingRoom && currentReadingRoom.name) {
                context += `\n阅读室名称: ${currentReadingRoom.name}\n`;
            }

            return context;
        }

        // 查看笔记
        async function viewNote(noteId) {
            try {
                await openNoteDetail(noteId);
            } catch (error) {
                handleError(error, '查看笔记失败', ErrorLevel.ERROR);
            }
        }

        // 检查数据库表是否存在
        async function checkLibraryDatabase() {
            try {
                console.log('[图书馆] 数据库版本:', db.verno);
                console.log('[图书馆] 表列表:', Object.keys(db._dbSchema));

                // 测试访问各个表
                const books = await db.libraryBooks.count();
                const categories = await db.libraryCategories.count();
                console.log('[图书馆] 数据库检查通过 - 书籍:', books, '分类:', categories);
            } catch (error) {
                console.error('[图书馆] 数据库检查失败:', error);
                console.error('[图书馆] 可能需要清除浏览器数据并刷新页面');
                alert('图书馆数据库初始化失败\n\n请按 Ctrl+Shift+Del 清除浏览器数据后刷新页面\n\n或在开发者工具中执行: indexedDB.deleteDatabase("TaraLifeOSDatabase")');
            }
        }

        // 页面加载时检查数据库
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', checkLibraryDatabase);
        } else {
            checkLibraryDatabase();
        }

        // ==================== 书籍和阅读室管理功能 ====================

        let currentContextBook = null;
        let currentContextRoom = null;

        // 初始化长按事件（在书籍加载后调用）
        function initLongPressForBooks() {
            document.querySelectorAll('.book-card').forEach(card => {
                let touchStartTime = 0;
                let touchTimer = null;

                card.addEventListener('touchstart', (e) => {
                    touchStartTime = Date.now();
                    touchTimer = setTimeout(() => {
                        e.preventDefault();
                        const bookId = card.dataset.bookId;
                        showBookContextMenu(bookId, e.touches[0].clientX, e.touches[0].clientY);
                    }, 500);
                });

                card.addEventListener('touchend', () => clearTimeout(touchTimer));
                card.addEventListener('touchmove', () => clearTimeout(touchTimer));

                card.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    const bookId = card.dataset.bookId;
                    showBookContextMenu(bookId, e.clientX, e.clientY);
                });
            });
        }

        // 初始化阅读室长按事件
        function initLongPressForRooms() {
            document.querySelectorAll('.reading-room-card').forEach(card => {
                let touchTimer = null;

                card.addEventListener('touchstart', (e) => {
                    touchTimer = setTimeout(() => {
                        e.preventDefault();
                        const roomId = card.dataset.roomId;
                        showRoomContextMenu(roomId, e.touches[0].clientX, e.touches[0].clientY);
                    }, 500);
                });

                card.addEventListener('touchend', () => clearTimeout(touchTimer));
                card.addEventListener('touchmove', () => clearTimeout(touchTimer));

                card.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    const roomId = card.dataset.roomId;
                    showRoomContextMenu(roomId, e.clientX, e.clientY);
                });
            });
        }

        // 显示书籍上下文菜单
        function showBookContextMenu(bookId, x, y) {
            currentContextBook = parseInt(bookId);
            const menu = document.getElementById('book-context-menu');
            document.getElementById('room-context-menu').classList.remove('active');
            menu.style.left = x + 'px';
            menu.style.top = y + 'px';
            menu.classList.add('active');
        }

        // 显示阅读室上下文菜单
        function showRoomContextMenu(roomId, x, y) {
            currentContextRoom = parseInt(roomId);
            const menu = document.getElementById('room-context-menu');
            document.getElementById('book-context-menu').classList.remove('active');
            menu.style.left = x + 'px';
            menu.style.top = y + 'px';
            menu.classList.add('active');
        }

        // 隐藏所有上下文菜单
        function hideAllContextMenus() {
            document.getElementById('book-context-menu')?.classList.remove('active');
            document.getElementById('room-context-menu')?.classList.remove('active');
        }

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.context-menu')) hideAllContextMenus();
        });

        // 重命名书籍
        async function renameBook() {
            try {
                hideAllContextMenus();
                if (!currentContextBook) return;

                const book = await dbHelper.safeGet('libraryBooks', currentContextBook, '书籍');
                if (!book) return alert('书籍不存在');

                const newName = prompt('请输入新书名:', book.title);
                if (!newName || newName.trim() === '' || newName === book.title) return;

                await db.libraryBooks.update(currentContextBook, { title: newName.trim() });
                if (typeof showToast === 'function') showToast('✅ 重命名成功');

                await loadBookshelf();
                initLongPressForBooks();
            } catch (error) {
                handleError(error, '重命名书籍失败', ErrorLevel.ERROR);
            }
        }

        // 删除书籍
        async function deleteBook() {
            try {
                hideAllContextMenus();
                if (!currentContextBook) return;

                const book = await dbHelper.safeGet('libraryBooks', currentContextBook, '书籍');
                if (!book) return alert('书籍不存在');

                if (!confirm(`确定要删除《${book.title}》吗？`)) return;

                const choice = prompt(
                    `删除选项:\n1. 删除书籍及所有数据\n2. 删除书籍但保留笔记\n\n请输入 1 或 2:`,
                    '1'
                );
                if (!choice) return;

                await db.libraryBooks.delete(currentContextBook);
                await db.readingProgress.where({ bookId: currentContextBook }).delete();
                await db.bookmarks.where({ bookId: currentContextBook }).delete();
                await db.readingRooms.where({ bookId: currentContextBook }).delete();
                if (choice !== '2') {
                    await db.readingNotes.where({ bookId: currentContextBook }).delete();
                }

                if (typeof showToast === 'function') showToast('🗑️ 已删除');

                await loadBookshelf();
                initLongPressForBooks();
            } catch (error) {
                handleError(error, '删除书籍失败', ErrorLevel.ERROR);
            }
        }

        // 移动书籍到分组
        async function moveBookToCategory() {
            try {
                hideAllContextMenus();
                if (!currentContextBook) return;

                const categories = await dbHelper.safeToArray('libraryCategories', '分类');
                const listEl = document.getElementById('category-list-for-move');

                if (!categories || categories.length === 0) {
                    listEl.innerHTML = `<div style="text-align:center; padding:40px 20px;"><p style="opacity:0.6; margin-bottom:15px;">还没有创建分组</p><button class="btn-sec" onclick="closeModal('modal-move-to-category'); openLibCategoryManager();">去创建</button></div>`;
                } else {
                    listEl.innerHTML = `
                        <div class="mini-card" style="cursor:pointer; margin-bottom:10px;" onclick="moveBookToCategoryConfirm(null)">
                            <div>默认（无分组）</div>
                        </div>
                        ${categories.map(cat => `<div class="mini-card" style="cursor:pointer; margin-bottom:10px;" onclick="moveBookToCategoryConfirm(${cat.id})"><div>${cat.name}</div></div>`).join('')}
                    `;
                }

                openModal('modal-move-to-category');
            } catch (error) {
                handleError(error, '加载分类失败', ErrorLevel.ERROR);
            }
        }

        // 确认移动到分组
        async function moveBookToCategoryConfirm(categoryId) {
            try {
                if (!currentContextBook) return;
                await db.libraryBooks.update(currentContextBook, { categoryId: categoryId });
                closeModal('modal-move-to-category');
                if (typeof showToast === 'function') showToast('✅ 已移动');
                await loadBookshelf();
                initLongPressForBooks();
            } catch (error) {
                handleError(error, '移动书籍失败', ErrorLevel.ERROR);
            }
        }

        // 重命名阅读室
        async function renameReadingRoom() {
            try {
                hideAllContextMenus();
                if (!currentContextRoom) return;

                const room = await dbHelper.safeGet('readingRooms', currentContextRoom, '阅读室');
                if (!room) return alert('阅读室不存在');

                const newName = prompt('请输入新名称:', room.name);
                if (!newName || newName.trim() === '' || newName === room.name) return;

                await db.readingRooms.update(currentContextRoom, { name: newName.trim() });
                if (typeof showToast === 'function') showToast('✅ 重命名成功');

                await loadReadingRooms();
                initLongPressForRooms();
            } catch (error) {
                handleError(error, '重命名阅读室失败', ErrorLevel.ERROR);
            }
        }

        // 删除阅读室
        async function deleteReadingRoom() {
            try {
                hideAllContextMenus();
                if (!currentContextRoom) return;

                const room = await dbHelper.safeGet('readingRooms', currentContextRoom, '阅读室');
                if (!room) return alert('阅读室不存在');

                if (!confirm(`确定要删除"${room.name}"吗？`)) return;

                await db.readingRooms.delete(currentContextRoom);
                if (typeof showToast === 'function') showToast('🗑️ 已删除');

                await loadReadingRooms();
                initLongPressForRooms();
            } catch (error) {
                handleError(error, '删除阅读室失败', ErrorLevel.ERROR);
            }
        }

        // ==================== 分类管理 ====================

        async function openLibCategoryManager() {
            try {
                await loadLibCategoryManager();
                openModal('modal-lib-category-manager');
            } catch (error) {
                handleError(error, '打开分类管理失败', ErrorLevel.ERROR);
            }
        }

        async function loadLibCategoryManager() {
            try {
                const categories = await dbHelper.safeToArray('libraryCategories', '分类');
                const listEl = document.getElementById('lib-category-manager-list');

                if (!categories || categories.length === 0) {
                    listEl.innerHTML = '<div style="text-align:center; padding:40px 20px; opacity:0.5; font-size:0.85rem;">暂无分类</div>';
                    return;
                }

                listEl.innerHTML = categories.map(cat => `
                    <div class="mini-card" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                        <div style="font-weight:bold;">${cat.name}</div>
                        <div style="display:flex; gap:10px;">
                            <span style="cursor:pointer; opacity:0.6;" onclick="editLibCategory(${cat.id}, '${cat.name.replace(/'/g, "\\'")}')">✏️</span>
                            <span style="cursor:pointer; opacity:0.6; color:#c62828;" onclick="deleteLibCategory(${cat.id}, '${cat.name.replace(/'/g, "\\'")}')">🗑️</span>
                        </div>
                    </div>
                `).join('');
            } catch (error) {
                handleError(error, '加载分类列表失败', ErrorLevel.ERROR);
            }
        }

        function showAddCategoryInput() {
            document.getElementById('lib-add-category-input').style.display = 'block';
            document.getElementById('new-lib-category-name').value = '';
            document.getElementById('new-lib-category-name').focus();
        }

        function cancelAddCategory() {
            document.getElementById('lib-add-category-input').style.display = 'none';
        }

        async function confirmAddCategory() {
            try {
                const name = document.getElementById('new-lib-category-name').value.trim();
                if (!name) return alert('请输入分类名称');

                await dbHelper.safePut('libraryCategories', { name: name, order: Date.now() }, '分类');
                if (typeof showToast === 'function') showToast('✅ 分类已创建');

                cancelAddCategory();
                await loadLibCategoryManager();
            } catch (error) {
                handleError(error, '创建分类失败', ErrorLevel.ERROR);
            }
        }

        async function editLibCategory(categoryId, currentName) {
            try {
                const newName = prompt('请输入新分类名:', currentName);
                if (!newName || newName.trim() === '' || newName === currentName) return;

                await db.libraryCategories.update(categoryId, { name: newName.trim() });
                if (typeof showToast === 'function') showToast('✅ 分类已更新');

                await loadLibCategoryManager();
            } catch (error) {
                handleError(error, '编辑分类失败', ErrorLevel.ERROR);
            }
        }

        async function deleteLibCategory(categoryId, categoryName) {
            try {
                const booksInCategory = await db.libraryBooks.where({ categoryId: categoryId }).count();
                let confirmMsg = `确定要删除分类"${categoryName}"吗？`;
                if (booksInCategory > 0) confirmMsg += `\n\n此分类下有 ${booksInCategory} 本书\n删除后这些书将移至默认分组`;

                if (!confirm(confirmMsg)) return;

                await db.libraryCategories.delete(categoryId);

                if (booksInCategory > 0) {
                    const books = await db.libraryBooks.where({ categoryId: categoryId }).toArray();
                    for (const book of books) {
                        await db.libraryBooks.update(book.id, { categoryId: null });
                    }
                }

                if (typeof showToast === 'function') showToast('🗑️ 分类已删除');

                await loadLibCategoryManager();
                await loadBookshelf();
            } catch (error) {
                handleError(error, '删除分类失败', ErrorLevel.ERROR);
            }
        }

        console.log('[LifeOS图书馆] 模块已加载');

        // ==================== Emoji → SVG 图标替换系统 ====================
        // 统一线条风格 SVG，stroke="currentColor" 跟随主题色
        const _S = (d, vb='0 0 24 24') => `<svg class="ico" viewBox="${vb}">${d}</svg>`;
        const ICON_MAP = {
            '🪙': _S('<circle cx="12" cy="12" r="9"/><path d="M9 12h6M12 9v6"/><path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18" stroke-dasharray="2 2"/>'),
            '📑': _S('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/>'),
            '🎲': _S('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="16" cy="16" r="1" fill="currentColor" stroke="none"/>'),
            '🎯': _S('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>'),
            '⚙️': _S('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
            '⚙': _S('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
            '📚': _S('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="11" x2="14" y2="11"/>'),
            '🏠': _S('<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>'),
            '🎮': _S('<rect x="2" y="6" width="20" height="12" rx="2"/><line x1="6" y1="12" x2="10" y2="12"/><line x1="8" y1="10" x2="8" y2="14"/><circle cx="16" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1" fill="currentColor" stroke="none"/>'),
            '🎨': _S('<circle cx="13.5" cy="6.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="17.5" cy="10.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="8.5" cy="7.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="6.5" cy="12" r="1.5" fill="currentColor" stroke="none"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.04-.24-.3-.39-.65-.39-1.04 0-.83.67-1.5 1.5-1.5H16c3.31 0 6-2.69 6-6 0-5.17-4.49-9-10-9z"/>'),
            '📝': _S('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>'),
            '📋': _S('<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="12" y2="16"/>'),
            '📤': _S('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>'),
            '📥': _S('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
            '📦': _S('<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>'),
            '📜': _S('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/><line x1="8" y1="9" x2="10" y2="9"/>'),
            '🎁': _S('<polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>'),
            '🗑️': _S('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>'),
            '🗑': _S('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>'),
            '✎': _S('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>'),
            '💬': _S('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
            '☑️': _S('<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>'),
            '☑': _S('<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>'),
            '⇆': _S('<polyline points="17 1 21 5 17 9"/><line x1="3" y1="5" x2="21" y2="5"/><polyline points="7 23 3 19 7 15"/><line x1="21" y1="19" x2="3" y2="19"/>'),
            '💡': _S('<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>'),
            '📈': _S('<polyline points="22 12 18 8 13 13 9 9 2 16"/><polyline points="16 8 22 8 22 14"/>'),
            '🎬': _S('<rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/><line x1="17" y1="17" x2="22" y2="17"/>'),
            '✨': _S('<path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"/>'),
            '📊': _S('<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>'),
            '🏷️': _S('<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>'),
            '🏷': _S('<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>'),
            '💰': _S('<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>'),
            '💾': _S('<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>'),
            '📂': _S('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>'),
            '📁': _S('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>'),
            '📖': _S('<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>'),
            '🏆': _S('<path d="M6 9H3V4h3"/><path d="M18 9h3V4h-3"/><path d="M6 4h12v6a6 6 0 0 1-12 0V4z"/><path d="M9 20h6"/><path d="M12 16v4"/>'),
            '🔗': _S('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
            '✏️': _S('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>'),
            '✏': _S('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>'),
            '📍': _S('<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>'),
            '🛌': _S('<path d="M3 7v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7"/><path d="M3 11h18"/><path d="M7 11V7a2 2 0 0 1 2-2h1"/>'),
            '🍟': _S('<path d="M7 22L5 8l4-1M17 22l2-14-4-1"/><path d="M9 7l1-5h4l1 5"/><path d="M8 8h8l-1 14H9L8 8z"/>'),
            '🚫': _S('<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>'),
            '🌙': _S('<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'),
            '💭': _S('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><circle cx="9" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="13" cy="10" r="1" fill="currentColor" stroke="none"/>'),
            '➕': _S('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
        };

        // 构建正则（按长度倒序排列，先匹配带变体选择符的 emoji）
        const _emojiKeys = Object.keys(ICON_MAP).sort((a, b) => b.length - a.length);
        const _emojiRegex = new RegExp(_emojiKeys.map(k => k.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|'), 'g');

        // 替换文本节点中的 emoji
        function replaceEmojiInNode(node) {
            if (node.nodeType === Node.TEXT_NODE) {
                const text = node.textContent;
                if (!_emojiRegex.test(text)) return;
                _emojiRegex.lastIndex = 0;
                const span = document.createElement('span');
                span.innerHTML = text.replace(_emojiRegex, m => ICON_MAP[m] || m);
                node.parentNode.replaceChild(span, node);
            } else if (node.nodeType === Node.ELEMENT_NODE &&
                       !['SCRIPT','STYLE','TEXTAREA','INPUT','SVG','svg'].includes(node.tagName)) {
                // 遍历子节点的快照（因为替换会修改 childNodes）
                Array.from(node.childNodes).forEach(replaceEmojiInNode);
            }
        }

        // 初次替换
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(() => replaceEmojiInNode(document.body), 100);
        });
        // 如果 DOM 已经加载完毕则直接执行
        if (document.readyState !== 'loading') {
            setTimeout(() => replaceEmojiInNode(document.body), 100);
        }

        // 监听动态内容变化
        const _emojiObserver = new MutationObserver(mutations => {
            mutations.forEach(m => {
                m.addedNodes.forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) {
                        replaceEmojiInNode(node);
                    }
                });
            });
        });
        _emojiObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });

        console.log('[LifeOS] Emoji→SVG 图标系统已加载');

