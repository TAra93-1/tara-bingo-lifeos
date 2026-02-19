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
