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

