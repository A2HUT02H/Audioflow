// =====================================================================
// AudioFlow - Queue Management Module
// =====================================================================

const AudioFlowQueue = (function() {
    // Private state
    let currentQueue = [];
    let currentQueueIndex = -1;
    let lastQueueIndex = -1;
    let queueList = null;
    let queueCount = null;
    let musicGrid = null;
    let socket = null;
    let roomId = null;
    let player = null;
    
    // Drag state
    let dragSrcIndex = null;
    let placeholderEl = null;
    let draggedElement = null;
    let isQueueDragging = false;

    function init(elements, socketInstance, room) {
        queueList = elements.queueList;
        queueCount = elements.queueCount;
        musicGrid = elements.musicGrid;
        player = elements.player;
        socket = socketInstance;
        roomId = room;
    }

    function getQueue() {
        return currentQueue;
    }

    function getQueueIndex() {
        return currentQueueIndex;
    }

    function setQueue(queue, index) {
        lastQueueIndex = currentQueueIndex;
        currentQueue = queue || [];
        currentQueueIndex = typeof index === 'number' ? index : parseInt(index, 10);
        if (isNaN(currentQueueIndex)) currentQueueIndex = -1;
    }

    function getLastQueueIndex() {
        return lastQueueIndex;
    }

    function isDragging() {
        return isQueueDragging;
    }

    function setDragging(value) {
        isQueueDragging = value;
    }

    function updateQueueCount() {
        if (queueCount) {
            const count = currentQueue.length;
            queueCount.textContent = count;
            
            if (count > 0) {
                queueCount.classList.add('visible');
                queueCount.classList.remove('pulse');
                void queueCount.offsetWidth;
                queueCount.classList.add('pulse');
            } else {
                queueCount.classList.remove('visible');
            }
        }
    }

    function updateGridPlayingState() {
        const playingItem = document.querySelector('.music-grid-item.playing');
        if (playingItem) {
            if (player.paused) {
                playingItem.classList.add('paused');
            } else {
                playingItem.classList.remove('paused');
            }
        }
    }

    function updateMusicGrid() {
        if (!musicGrid) return;

        if (currentQueue.length === 0) {
            musicGrid.innerHTML = `
                <div class="music-grid-empty">
                    <i class="fas fa-music"></i>
                    <p>No music uploaded yet</p>
                    <p class="music-grid-hint">Upload audio files to see them here</p>
                </div>
            `;
            return;
        }

        const gridHTML = currentQueue.map((item, index) => {
            const isCurrentSong = Number(index) === Number(currentQueueIndex);
            
            let coverSrc = '';
            if (item.cover) {
                coverSrc = `/uploads/${item.cover}`;
            } else if (item.image_url) {
                coverSrc = item.image_url;
            }
            
            const coverDisplay = coverSrc 
                ? `<img src="${coverSrc}" alt="Cover" class="music-grid-item-cover" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                   <div class="music-grid-item-placeholder" style="display:none;"><i class="fas fa-music"></i></div>` 
                : '<div class="music-grid-item-placeholder"><i class="fas fa-music"></i></div>';
            
            const playingVisualizer = `
                <div class="music-grid-playing-visualizer">
                    <div class="visualizer-bar"></div>
                    <div class="visualizer-bar"></div>
                    <div class="visualizer-bar"></div>
                    <div class="visualizer-bar"></div>
                </div>
            `;
            
            return `
                <div class="music-grid-item ${isCurrentSong ? 'playing' : ''}" data-index="${index}">
                    <div class="music-grid-thumb-wrapper">
                        ${coverDisplay}
                        ${isCurrentSong ? playingVisualizer : ''}
                        <div class="music-grid-hover-play"><i class="fas fa-play"></i></div>
                        <div class="music-grid-hover-delete" data-index="${index}"><i class="fas fa-trash"></i></div>
                    </div>
                    <div class="music-grid-title">${item.title || item.filename_display || item.filename}</div>
                </div>
            `;
        }).join('');

        musicGrid.innerHTML = gridHTML;

        const gridItems = musicGrid.querySelectorAll('.music-grid-item');
        gridItems.forEach(item => {
            const playBtn = item.querySelector('.music-grid-hover-play');
            if (playBtn) {
                playBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const index = parseInt(item.dataset.index);
                    loadFromQueue(index);
                });
            }
            
            const deleteBtn = item.querySelector('.music-grid-hover-delete');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const index = parseInt(deleteBtn.dataset.index);
                    item.classList.add('deleting');
                    setTimeout(() => {
                        socket.emit('remove_from_queue', { room: roomId, index: index });
                    }, 400);
                });
            }
            
            item.addEventListener('click', () => {
                const index = parseInt(item.dataset.index);
                loadFromQueue(index);
            });
        });
    }

    function updateQueueDisplay() {
        if (!queueList) return;

        if (currentQueue.length === 0) {
            queueList.innerHTML = '<p class="empty-queue">No songs in queue</p>';
            return;
        }

        const queueHTML = currentQueue.map((item, index) => {
            const isCurrentSong = Number(index) === Number(currentQueueIndex);
            const isPlaying = player && !player.paused;
            
            let coverSrc = '';
            if (item.cover) {
                coverSrc = `/uploads/${item.cover}`;
            } else if (item.image_url) {
                coverSrc = item.image_url;
            }
            
            const coverDisplay = coverSrc 
                ? `<img src="${coverSrc}" alt="Cover" class="queue-item-cover" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                   <div class="queue-item-cover" style="display:none;">🎵</div>` 
                : '<div class="queue-item-cover">🎵</div>';
            
            const isDraggable = currentQueue.length > 1;
            
            const indexOrVisualizer = (isCurrentSong && isPlaying)
                ? `<div class="queue-item-visualizer">
                       <span class="bar"></span>
                       <span class="bar"></span>
                       <span class="bar"></span>
                       <span class="bar"></span>
                   </div>`
                : `<div class="queue-item-index">${index + 1}</div>`;
            
            return `
                <div class="queue-item ${isCurrentSong ? 'current' : ''}" data-index="${index}" ${isDraggable ? 'draggable="true"' : ''}>
                    ${indexOrVisualizer}
                    <div class="queue-item-cover-wrapper">
                        ${coverDisplay}
                        <div class="queue-item-hover-play" data-index="${index}"><i class="fas fa-play"></i></div>
                    </div>
                    <div class="queue-item-info">
                        <div class="queue-item-title">${item.filename_display || item.filename}</div>
                        <div class="queue-item-status">${item.artist || ''}</div>
                    </div>
                    <div class="queue-item-actions">
                        <button class="queue-item-btn remove-btn danger" data-index="${index}" title="Remove" draggable="false">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        queueList.innerHTML = queueHTML;
        setupDragAndDrop();
        setupQueueButtonListeners();
    }

    // Drag and Drop Functions
    function createPlaceholder(height) {
        const ph = document.createElement('div');
        ph.className = 'queue-placeholder';
        ph.style.height = `${height}px`;
        ph.style.transition = 'height 160ms ease, opacity 160ms ease, margin 160ms ease';
        return ph;
    }

    function computeToIndexFromPlaceholder() {
        if (!placeholderEl || !queueList) return null;
        let idx = 0;
        for (const child of Array.from(queueList.children)) {
            if (child === placeholderEl) break;
            if (child.classList && child.classList.contains('queue-item')) idx++;
        }
        return idx;
    }

    function handleDragStart(e) {
        const itemEl = e.target.closest('.queue-item');
        if (!itemEl) return;

        if (currentQueue.length <= 1) {
            e.preventDefault();
            e.stopPropagation();
            return false;
        }

        if (e.target.closest('.queue-item-btn') || e.target.tagName.toLowerCase() === 'button') {
            e.preventDefault();
            e.stopPropagation();
            return false;
        }

        const idx = parseInt(itemEl.dataset.index, 10);
        if (isNaN(idx)) return;
        
        dragSrcIndex = idx;
        draggedElement = itemEl;
        isQueueDragging = true;
        
        e.dataTransfer.effectAllowed = 'move';
        try { 
            e.dataTransfer.setData('text/plain', String(idx)); 
        } catch (err) { 
            console.warn('DataTransfer setData failed:', err);
        }

        placeholderEl = createPlaceholder(itemEl.offsetHeight || 60);
        itemEl.parentNode.insertBefore(placeholderEl, itemEl.nextSibling);

        itemEl.classList.add('dragging');
        itemEl.style.opacity = '0.3';
        
        document.body.style.userSelect = 'none';
    }

    function handleDragEnd(e) {
        const itemEl = e.target.closest('.queue-item');
        if (!itemEl && !draggedElement) return;
        
        const targetEl = itemEl || draggedElement;
        
        dragSrcIndex = null;
        draggedElement = null;
        isQueueDragging = false;
        
        if (placeholderEl && placeholderEl.parentNode) {
            placeholderEl.parentNode.removeChild(placeholderEl);
        }
        placeholderEl = null;
        
        if (targetEl) {
            targetEl.classList.remove('dragging');
            targetEl.style.opacity = '';
        }
        
        queueList.querySelectorAll('.queue-item').forEach(item => {
            item.classList.remove('drag-over');
            item.style.transition = '';
            item.style.transform = '';
        });
        
        document.body.style.userSelect = '';
    }

    function handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        const itemEl = e.target.closest('.queue-item');
        if (!itemEl || !placeholderEl) return;

        const rect = itemEl.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const insertBefore = e.clientY < midY;
        
        const targetSibling = insertBefore ? itemEl : itemEl.nextSibling;
        if (placeholderEl.nextSibling === targetSibling) return;

        const items = Array.from(queueList.querySelectorAll('.queue-item'))
            .filter(el => el !== placeholderEl && el !== draggedElement);
        const firstRects = new Map();
        items.forEach(el => firstRects.set(el, el.getBoundingClientRect()));

        try {
            if (insertBefore) {
                itemEl.parentNode.insertBefore(placeholderEl, itemEl);
            } else {
                itemEl.parentNode.insertBefore(placeholderEl, itemEl.nextSibling);
            }
        } catch (err) {
            console.warn('Failed to move placeholder:', err);
            return;
        }

        items.forEach(el => {
            const first = firstRects.get(el);
            const last = el.getBoundingClientRect();
            if (!first || !last) return;
            
            const deltaY = first.top - last.top;
            if (deltaY === 0) return;
            
            el.style.transition = 'none';
            el.style.transform = `translateY(${deltaY}px)`;
            
            el.getBoundingClientRect();
            
            el.style.transition = 'transform 180ms ease-out';
            el.style.transform = '';
            
            const cleanup = () => {
                el.style.transition = '';
                el.removeEventListener('transitionend', cleanup);
            };
            el.addEventListener('transitionend', cleanup);
            
            setTimeout(() => {
                el.style.transition = '';
                el.removeEventListener('transitionend', cleanup);
            }, 200);
        });
    }

    function handleDrop(e) {
        e.preventDefault();
        e.stopPropagation();

        if (dragSrcIndex === null) {
            try {
                const fromIndexStr = e.dataTransfer.getData('text/plain');
                dragSrcIndex = parseInt(fromIndexStr, 10);
                if (isNaN(dragSrcIndex)) dragSrcIndex = null;
            } catch (err) {
                console.warn('Failed to get drag data:', err);
            }
        }
        
        if (dragSrcIndex === null || !placeholderEl) return;

        const toIndex = computeToIndexFromPlaceholder();
        if (toIndex === null) return;

        let effectiveTo = toIndex;
        if (toIndex > dragSrcIndex) effectiveTo = toIndex - 1;
        
        if (effectiveTo === dragSrcIndex) return;

        const moved = currentQueue.splice(dragSrcIndex, 1)[0];
        currentQueue.splice(effectiveTo, 0, moved);

        if (currentQueueIndex === dragSrcIndex) {
            currentQueueIndex = effectiveTo;
        } else if (dragSrcIndex < currentQueueIndex && effectiveTo >= currentQueueIndex) {
            currentQueueIndex -= 1;
        } else if (effectiveTo <= currentQueueIndex && dragSrcIndex > currentQueueIndex) {
            currentQueueIndex += 1;
        }

        updateQueueDisplay();
        updateMusicGrid();
        sendReorderRequest(dragSrcIndex, effectiveTo);
    }

    function setupDragAndDrop() {
        if (!queueList) return;
        
        queueList.removeEventListener('dragstart', handleDragStart);
        queueList.removeEventListener('dragend', handleDragEnd);
        queueList.removeEventListener('dragover', handleDragOver);
        queueList.removeEventListener('drop', handleDrop);

        queueList.addEventListener('dragstart', handleDragStart);
        queueList.addEventListener('dragend', handleDragEnd);
        queueList.addEventListener('dragover', handleDragOver);
        queueList.addEventListener('drop', handleDrop);
    }

    function handleButtonMouseDown(e) {
        if (e.target.closest('.queue-item-btn')) {
            e.stopPropagation();
        }
    }

    function handleQueueClick(e) {
        e.stopPropagation();
        
        const playBtn = e.target.closest('.play-btn');
        const hoverPlayBtn = e.target.closest('.queue-item-hover-play');
        const removeBtn = e.target.closest('.remove-btn');
        const queueItem = e.target.closest('.queue-item');
        
        if (playBtn || hoverPlayBtn) {
            e.preventDefault();
            const btn = playBtn || hoverPlayBtn;
            const index = parseInt(btn.dataset.index);
            if (!isNaN(index)) {
                playFromQueue(index);
            }
        } else if (removeBtn) {
            e.preventDefault();
            const index = parseInt(removeBtn.dataset.index);
            if (!isNaN(index)) {
                removeFromQueue(index);
            }
        } else if (queueItem && !e.target.closest('.queue-item-actions')) {
            const index = parseInt(queueItem.dataset.index);
            if (!isNaN(index)) playFromQueue(index);
        }
    }

    function setupQueueButtonListeners() {
        if (!queueList) return;
        
        queueList.removeEventListener('click', handleQueueClick);
        queueList.removeEventListener('mousedown', handleButtonMouseDown);
        
        queueList.addEventListener('click', handleQueueClick);
        queueList.addEventListener('mousedown', handleButtonMouseDown);
    }

    function playFromQueue(index) {
        if (index < 0 || index >= currentQueue.length) return;
        
        fetch(`/queue/${roomId}/play/${index}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        })
        .then(response => response.json())
        .then(data => {
            if (!data.success) {
                console.error('Failed to play from queue:', data.error);
            }
        })
        .catch(error => {
            console.error('Error playing from queue:', error);
        });
    }

    function removeFromQueue(index) {
        if (index < 0 || index >= currentQueue.length) return;
        
        fetch(`/queue/${roomId}/remove/${index}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' }
        })
        .then(response => response.json())
        .then(data => {
            if (!data.success) {
                console.error('Failed to remove from queue:', data.error);
            }
        })
        .catch(error => {
            console.error('Error removing from queue:', error);
        });
    }

    function sendReorderRequest(fromIndex, toIndex) {
        fetch(`/queue/${roomId}/reorder`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from_index: fromIndex, to_index: toIndex })
        })
        .then(res => res.json())
        .then(data => {
            if (!data.success) {
                console.error('Failed to reorder queue on server:', data.error);
                socket.emit('request_queue_refresh', { room: roomId });
            }
        })
        .catch(err => {
            console.error('Error sending reorder request:', err);
            socket.emit('request_queue_refresh', { room: roomId });
        });
    }

    function loadFromQueue(index) {
        if (typeof index !== 'number') return;
        if (index < 0 || index >= currentQueue.length) return;

        socket.emit('select_song', { room: roomId, index: index });
    }

    // Public API
    return {
        init,
        getQueue,
        getQueueIndex,
        setQueue,
        getLastQueueIndex,
        isDragging,
        setDragging,
        updateQueueCount,
        updateGridPlayingState,
        updateMusicGrid,
        updateQueueDisplay,
        playFromQueue,
        removeFromQueue,
        loadFromQueue
    };
})();

// Make it available globally
window.AudioFlowQueue = AudioFlowQueue;
