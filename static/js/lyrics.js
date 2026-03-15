// =====================================================================
// AudioFlow - Lyrics Module
// =====================================================================

const AudioFlowLyrics = (function() {
    // Private state
    let parsedLyrics = [];
    let currentLyricsIndex = -1;
    let lyricsUpdateInterval = null;
    let lyricsCache = new Map();
    let currentSongKey = null;
    let isFullscreenLyricsVisible = false;
    
    // DOM elements
    let lyricsContent = null;
    let lyricsLoading = null;
    let fullscreenLyricsOverlay = null;
    let fullscreenLyricsContent = null;
    let player = null;
    let socket = null;
    let roomId = null;

    function init(elements, socketInstance, room) {
        lyricsContent = elements.lyricsContent;
        lyricsLoading = elements.lyricsLoading;
        fullscreenLyricsOverlay = elements.fullscreenLyricsOverlay;
        fullscreenLyricsContent = elements.fullscreenLyricsContent;
        player = elements.player;
        socket = socketInstance;
        roomId = room;
        
        loadLyricsCacheFromStorage();
    }

    function loadLyricsCacheFromStorage() {
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('lyrics_')) {
                    const songKey = key.replace('lyrics_', '');
                    const lyrics = localStorage.getItem(key);
                    if (lyrics) {
                        lyricsCache.set(songKey, lyrics);
                    }
                }
            }
        } catch (e) {
            console.warn('Could not load lyrics cache from localStorage:', e);
        }
    }

    function generateSongKey(filename, title, artist) {
        return `${filename}|${title || ''}|${artist || ''}`;
    }

    function getCachedLyrics(songKey) {
        return lyricsCache.get(songKey);
    }

    function cacheLyrics(songKey, lyrics) {
        lyricsCache.set(songKey, lyrics);
        try {
            localStorage.setItem(`lyrics_${songKey}`, lyrics);
        } catch (e) {
            console.warn('Could not save lyrics to localStorage:', e);
        }
    }

    function parseLyrics(lyricsText) {
        const lines = lyricsText.split('\n');
        const parsed = [];
        const timestampRegex = /^\[(\d{2}):(\d{2})\.(\d{2})\]\s*(.*)$/;
        
        for (const line of lines) {
            const match = line.match(timestampRegex);
            if (match) {
                const minutes = parseInt(match[1], 10);
                const seconds = parseInt(match[2], 10);
                const centiseconds = parseInt(match[3], 10);
                const text = match[4].trim();
                
                const timeInSeconds = minutes * 60 + seconds + centiseconds / 100;
                
                if (text) {
                    parsed.push({
                        time: timeInSeconds,
                        text: text
                    });
                }
            }
        }
        
        return parsed.sort((a, b) => a.time - b.time);
    }

    function displayTimestampedLyrics(lyrics) {
        parsedLyrics = parseLyrics(lyrics);
        
        if (parsedLyrics.length === 0) {
            if (lyricsContent) {
                lyricsContent.innerHTML = `<div class="lyrics-text">${lyrics}</div>`;
            }
            return;
        }

        const lyricsHTML = parsedLyrics.map((line, index) => 
            `<div class="lyrics-line" data-index="${index}" data-time="${line.time}">${line.text}</div>`
        ).join('');
        
        if (lyricsContent) {
            lyricsContent.innerHTML = `<div class="lyrics-text">${lyricsHTML}</div>`;
        }
        
        const lyricsLines = lyricsContent ? lyricsContent.querySelectorAll('.lyrics-line') : [];
        lyricsLines.forEach(line => {
            line.addEventListener('click', () => {
                const time = parseFloat(line.dataset.time);
                if (!isNaN(time) && player) {
                    player.currentTime = time;
                    if (player.paused) {
                        player.play();
                    }
                    if (socket) {
                        socket.emit('seek', { room: roomId, time: time });
                    }
                }
            });
        });
        
        if (player && !player.paused) {
            startLyricsSync();
        }
    }

    function updateLyricsHighlight() {
        if (!player || parsedLyrics.length === 0) return;
        
        const currentTime = player.currentTime;
        let activeIndex = -1;
        
        for (let i = 0; i < parsedLyrics.length; i++) {
            if (currentTime >= parsedLyrics[i].time) {
                activeIndex = i;
            } else {
                break;
            }
        }
        
        if (activeIndex !== currentLyricsIndex) {
            currentLyricsIndex = activeIndex;
            
            const lyricsLines = document.querySelectorAll('.lyrics-content .lyrics-line');
            lyricsLines.forEach((line, index) => {
                line.classList.remove('active', 'past', 'future');
                
                if (index === activeIndex) {
                    line.classList.add('active');
                    line.scrollIntoView({ behavior: 'smooth', block: 'center' });
                } else if (index < activeIndex) {
                    line.classList.add('past');
                } else {
                    line.classList.add('future');
                }
            });
            
            if (isFullscreenLyricsVisible) {
                updateFullscreenLyricsHighlight();
            }
        }
    }

    function startLyricsSync() {
        if (lyricsUpdateInterval) {
            clearInterval(lyricsUpdateInterval);
        }
        
        lyricsUpdateInterval = setInterval(updateLyricsHighlight, 100);
    }

    function stopLyricsSync() {
        if (lyricsUpdateInterval) {
            clearInterval(lyricsUpdateInterval);
            lyricsUpdateInterval = null;
        }
        currentLyricsIndex = -1;
    }

    function clearLyricsCache() {
        lyricsCache.clear();
        try {
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('lyrics_')) {
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach(key => localStorage.removeItem(key));
            console.log('Lyrics cache cleared');
        } catch (e) {
            console.warn('Could not clear lyrics cache from localStorage:', e);
        }
    }

    function getLyricsCacheStats() {
        return {
            cachedSongs: lyricsCache.size,
            cacheKeys: Array.from(lyricsCache.keys())
        };
    }

    function showFullscreenLyrics() {
        if (!fullscreenLyricsOverlay) return;

        console.log('Showing fullscreen lyrics overlay');
        isFullscreenLyricsVisible = true;
        document.body.classList.add('lyrics-active');
        
        const membersBadge = document.querySelector('.members-badge-btn');
        const headerFullscreen = document.getElementById('header-fullscreen-btn');
        if (membersBadge) membersBadge.style.display = 'none';
        if (headerFullscreen) headerFullscreen.style.display = 'none';

        const Theme = window.AudioFlowTheme;
        if (Theme) {
            const colors = Theme.getCurrentColors();
            if (colors.dominant) {
                const [r, g, b] = colors.dominant;
                document.documentElement.style.setProperty('--lyrics-bg-color', `rgb(${r}, ${g}, ${b})`);
            } else {
                document.documentElement.style.setProperty('--lyrics-bg-color', '#0a0c10');
            }
        }

        fullscreenLyricsOverlay.style.display = 'flex';

        setTimeout(() => {
            fullscreenLyricsOverlay.classList.add('visible');
        }, 10);

        fetchLyricsForFullscreen();

        if (document.body.classList.contains('fullscreen-mode')) {
            const Fullscreen = window.AudioFlowFullscreen;
            if (Fullscreen) {
                Fullscreen.hidePlayerBox();
            }
        }
    }

    function hideFullscreenLyrics() {
        if (!fullscreenLyricsOverlay) return;
        
        isFullscreenLyricsVisible = false;
        document.body.classList.remove('lyrics-active');
        fullscreenLyricsOverlay.classList.remove('visible');
        
        const membersBadge = document.querySelector('.members-badge-btn');
        const headerFullscreen = document.getElementById('header-fullscreen-btn');
        if (membersBadge && window.innerWidth <= 1024) membersBadge.style.display = 'flex';
        if (headerFullscreen && window.innerWidth <= 600) headerFullscreen.style.display = 'flex';
        
        if (document.body.classList.contains('fullscreen-mode')) {
            const Fullscreen = window.AudioFlowFullscreen;
            if (Fullscreen) {
                Fullscreen.resetIdleTimer();
            }
        }
        
        setTimeout(() => {
            fullscreenLyricsOverlay.style.display = 'none';
        }, 300);
    }

    function toggleFullscreenLyrics() {
        if (isFullscreenLyricsVisible) {
            hideFullscreenLyrics();
        } else {
            showFullscreenLyrics();
        }
    }

    function displayFullscreenTimestampedLyrics() {
        if (!fullscreenLyricsContent || parsedLyrics.length === 0) {
            if (fullscreenLyricsContent) {
                fullscreenLyricsContent.innerHTML = '<p class="no-lyrics">No lyrics available</p>';
            }
            return;
        }

        const lyricsHTML = parsedLyrics.map((line, index) => 
            `<div class="lyrics-line" data-index="${index}" data-time="${line.time}">${line.text}</div>`
        ).join('');
        
        fullscreenLyricsContent.innerHTML = `<div class="lyrics-text">${lyricsHTML}</div>`;
        
        const fsLyricsLines = fullscreenLyricsContent.querySelectorAll('.lyrics-line');
        fsLyricsLines.forEach(line => {
            line.addEventListener('click', () => {
                const time = parseFloat(line.dataset.time);
                if (!isNaN(time) && player) {
                    player.currentTime = time;
                    if (player.paused) {
                        player.play();
                    }
                    if (socket) {
                        socket.emit('seek', { room: roomId, time: time });
                    }
                }
            });
        });
        
        if (player) {
            const currentTime = player.currentTime;
            let activeIndex = -1;
            
            for (let i = 0; i < parsedLyrics.length; i++) {
                if (currentTime >= parsedLyrics[i].time) {
                    activeIndex = i;
                } else {
                    break;
                }
            }
            
            currentLyricsIndex = activeIndex;
            updateFullscreenLyricsHighlight();
        }
    }

    function updateFullscreenLyricsHighlight() {
        if (!player || parsedLyrics.length === 0 || !isFullscreenLyricsVisible) return;
        
        const activeIndex = currentLyricsIndex;
        
        const lyricsLines = fullscreenLyricsContent ? fullscreenLyricsContent.querySelectorAll('.lyrics-line') : [];
        
        lyricsLines.forEach((line, index) => {
            line.classList.remove('active', 'past', 'future');
            
            if (index === activeIndex) {
                line.classList.add('active');
                line.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else if (index < activeIndex) {
                line.classList.add('past');
            } else {
                line.classList.add('future');
            }
        });
    }

    async function fetchLyricsForFullscreen() {
        if (!fullscreenLyricsContent) return;

        const songTitleElement = document.querySelector('#song-title');
        const songArtistElement = document.querySelector('#song-artist');
        const title = songTitleElement ? songTitleElement.textContent.trim() : '';
        const artist = songArtistElement ? songArtistElement.textContent.trim() : '';
        
        if (!artist || !title || title === 'No file selected') {
            fullscreenLyricsContent.innerHTML = '<p class="no-lyrics">No song metadata available</p>';
            return;
        }

        if (currentSongKey) {
            const cachedLyrics = getCachedLyrics(currentSongKey);
            if (cachedLyrics) {
                console.log('Loading lyrics from cache for fullscreen:', currentSongKey);
                parsedLyrics = parseLyrics(cachedLyrics);
                displayFullscreenTimestampedLyrics();
                if (player && !player.paused) {
                    startLyricsSync();
                }
                return;
            }
        }

        fullscreenLyricsContent.innerHTML = '<p class="no-lyrics">Loading lyrics...</p>';

        try {
            const response = await fetch(`/lyrics?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}`);
            const data = await response.json();

            if (data.success && data.lyrics) {
                if (currentSongKey) {
                    cacheLyrics(currentSongKey, data.lyrics);
                }
                parsedLyrics = parseLyrics(data.lyrics);
                displayFullscreenTimestampedLyrics();
                if (player && !player.paused) {
                    startLyricsSync();
                }
            } else {
                fullscreenLyricsContent.innerHTML = `<p class="no-lyrics">Lyrics not found for "${title}" by ${artist}</p>`;
            }
        } catch (error) {
            console.error('Error fetching lyrics for fullscreen:', error);
            fullscreenLyricsContent.innerHTML = '<p class="no-lyrics">Failed to fetch lyrics</p>';
        }
    }

    async function fetchAndDisplayLyrics() {
        if (!lyricsContent || !lyricsLoading) return;

        const songTitleElement = document.querySelector('#song-title');
        const songArtistElement = document.querySelector('#song-artist');
        const title = songTitleElement ? songTitleElement.textContent.trim() : '';
        const artist = songArtistElement ? songArtistElement.textContent.trim() : '';
        
        if (!artist || !title || title === 'No file selected') {
            showLyricsError('No song metadata available.');
            return;
        }

        if (currentSongKey) {
            const cachedLyrics = getCachedLyrics(currentSongKey);
            if (cachedLyrics) {
                lyricsLoading.style.display = 'none';
                lyricsContent.style.display = 'block';
                displayTimestampedLyrics(cachedLyrics);
                return;
            }
        }

        lyricsLoading.style.display = 'block';
        lyricsContent.style.display = 'none';

        try {
            const response = await fetch(`/lyrics?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}`);
            const data = await response.json();

            lyricsLoading.style.display = 'none';
            lyricsContent.style.display = 'block';

            if (data.success && data.lyrics) {
                if (currentSongKey) {
                    cacheLyrics(currentSongKey, data.lyrics);
                }
                displayTimestampedLyrics(data.lyrics);
            } else {
                showLyricsError(`Lyrics not found for "${title}" by ${artist}`);
            }
        } catch (error) {
            console.error('Error fetching lyrics:', error);
            lyricsLoading.style.display = 'none';
            lyricsContent.style.display = 'block';
            showLyricsError('Failed to fetch lyrics. Please try again.');
        }
    }

    function showLyricsError(message) {
        if (lyricsContent) {
            lyricsContent.innerHTML = `<p class="no-lyrics">${message}</p>`;
        }
    }

    function setCurrentSongKey(key) {
        currentSongKey = key;
    }

    function getCurrentSongKey() {
        return currentSongKey;
    }

    function reset(options = {}) {
        const keepVisible = !!(options && options.keepVisible);
        stopLyricsSync();
        parsedLyrics = [];
        currentLyricsIndex = -1;
        
        if (isFullscreenLyricsVisible && !keepVisible) {
            hideFullscreenLyrics();
        }
    }

    function isVisible() {
        return isFullscreenLyricsVisible;
    }

    function refreshVisibleLyrics() {
        if (isFullscreenLyricsVisible) {
            fetchLyricsForFullscreen();
        }
    }

    function getParsedLyrics() {
        return parsedLyrics;
    }

    // Public API
    return {
        init,
        generateSongKey,
        setCurrentSongKey,
        getCurrentSongKey,
        fetchAndDisplayLyrics,
        startLyricsSync,
        stopLyricsSync,
        updateLyricsHighlight,
        showFullscreenLyrics,
        hideFullscreenLyrics,
        toggleFullscreenLyrics,
        refreshVisibleLyrics,
        clearLyricsCache,
        getLyricsCacheStats,
        reset,
        isVisible,
        getParsedLyrics
    };
})();

// Make it available globally
window.AudioFlowLyrics = AudioFlowLyrics;

// Global lyrics cache management
window.lyricsCache = {
    clear: function() {
        const Lyrics = window.AudioFlowLyrics;
        if (Lyrics) Lyrics.clearLyricsCache();
    },
    stats: function() {
        const Lyrics = window.AudioFlowLyrics;
        if (Lyrics) {
            const stats = Lyrics.getLyricsCacheStats();
            console.log('Lyrics cache stats:', stats);
            return stats;
        }
    },
    list: function() {
        try {
            const keys = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('lyrics_')) {
                    keys.push(key.replace('lyrics_', ''));
                }
            }
            console.log('Cached lyrics for songs:', keys);
            return keys;
        } catch (e) {
            console.warn('Could not list cached lyrics:', e);
            return [];
        }
    }
};

// Global fullscreen lyrics functions
window.fullscreenLyrics = {
    show: function() {
        const Lyrics = window.AudioFlowLyrics;
        if (Lyrics && document.body.classList.contains('fullscreen-mode')) {
            Lyrics.showFullscreenLyrics();
        } else {
            console.log('Fullscreen lyrics only available in fullscreen mode');
        }
    },
    hide: function() {
        const Lyrics = window.AudioFlowLyrics;
        if (Lyrics) Lyrics.hideFullscreenLyrics();
    },
    toggle: function() {
        const Lyrics = window.AudioFlowLyrics;
        if (Lyrics && document.body.classList.contains('fullscreen-mode')) {
            Lyrics.toggleFullscreenLyrics();
        } else {
            console.log('Fullscreen lyrics only available in fullscreen mode');
        }
    }
};
