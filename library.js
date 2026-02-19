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

        // escapeHtml 定义在 chat.js 中，此处不重复定义

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

