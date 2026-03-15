// =====================================================================
// AudioFlow - Main Entry Point
// =====================================================================
// This file initializes all AudioFlow modules and ties them together.
// It serves as the primary entry point for the modular application.
// =====================================================================

document.addEventListener('DOMContentLoaded', () => {
    console.log('[AudioFlow] Initializing modules...');

    // --- Core Dependencies ---
    const socket = io();
    const colorThief = new ColorThief();

    // --- DOM Elements ---
    const player = document.getElementById('player');
    let secondaryPlayer = null;
    let isDualMixActive = false;
    const audioInput = document.getElementById('audio-input');
    const vocalsInput = document.getElementById('vocals-input');
    const instrumentalInput = document.getElementById('instrumental-input');
    const uploadBtn = document.getElementById('upload-btn');
    const uploadStemsBtn = document.getElementById('upload-stems-btn');
    const syncBtn = document.getElementById('sync-btn');
    const queueBtn = document.getElementById('queue-btn');
    const queueView = document.getElementById('queue-view');
    const musicGrid = document.getElementById('music-grid');
    const queueCount = document.getElementById('queue-count');
    const queueList = document.getElementById('queue-list');
    const lyricsBtn = document.getElementById('lyrics-toggle-btn');
    const lyricsModal = document.getElementById('lyrics-modal');
    const closeLyricsBtn = document.getElementById('close-lyrics');
    const lyricsContent = document.getElementById('lyrics-content');
    const lyricsLoading = document.getElementById('lyrics-loading');
    const membersSidebar = document.getElementById('members-sidebar');
    const membersSidebarList = document.getElementById('members-sidebar-list');
    const membersModal = document.getElementById('members-modal');
    const membersBadge = document.querySelector('.members-badge-btn');
    const fullscreenLyricsOverlay = document.getElementById('fullscreen-lyrics-overlay');
    const fullscreenLyricsContent = document.getElementById('fullscreen-lyrics-content');
    const fileNameDisplay = document.getElementById('file-name');
    const songTitleElement = document.getElementById('song-title');
    const songArtistElement = document.getElementById('song-artist');
    const playerTrackTitle = document.getElementById('player-track-title');
    const playerTrackArtist = document.getElementById('player-track-artist');
    const coverArt = document.getElementById('cover-art');
    const coverArtPlaceholder = document.getElementById('cover-art-placeholder');
    const dragDropOverlay = document.getElementById('drag-drop-overlay');

    // Custom Player Elements
    const playPauseBtn = document.getElementById('play-pause-btn');
    const playPauseIcon = document.getElementById('play-pause-icon');
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const loopBtn = document.getElementById('loop-btn');
    const loopIcon = document.getElementById('loop-icon');
    const shuffleBtn = document.getElementById('shuffle-btn');
    const shuffleIcon = document.getElementById('shuffle-icon');
    const currentTimeDisplay = document.getElementById('current-time');
    const totalTimeDisplay = document.getElementById('total-time');
    const progressBar = document.querySelector('.progress-bar');
    const progressFill = document.getElementById('progress-fill');
    const progressHandle = document.getElementById('progress-handle');
    const volumeBtn = document.getElementById('volume-btn');
    const volumeIcon = document.getElementById('volume-icon');
    const volumeSliderHorizontal = document.querySelector('.volume-slider-horizontal');
    const volumeFillHorizontal = document.getElementById('volume-fill-horizontal');
    const volumeHandleHorizontal = document.getElementById('volume-handle-horizontal');
    const fullscreenBtn = document.getElementById('fullscreen-btn');

    // Search Elements
    const searchBtn = document.getElementById('search-btn');
    const searchInput = document.getElementById('search-input');
    const searchModal = document.getElementById('search-modal');
    const searchResults = document.getElementById('search-results');
    const closeSearch = document.getElementById('close-search');

    // --- Get Room ID ---
    const roomId = document.body.dataset.roomId;
    if (!roomId) {
        console.error('[AudioFlow] No room ID found!');
        return;
    }

    console.log('[AudioFlow] Room ID:', roomId);

    // --- Initialize Modules ---

    // 1. Initialize Theme Module
    const Theme = window.AudioFlowTheme;
    if (Theme) {
        Theme.init({ colorThief, fileNameDisplay, coverArt });
        console.log('[AudioFlow] Theme module initialized');
    }

    // 2. Initialize Audio Visualizer Module
    const Visualizer = window.AudioFlowVisualizer;
    if (Visualizer) {
        Visualizer.init({ player });
        Visualizer.enableOnInteraction();
        console.log('[AudioFlow] Visualizer module initialized');
    }

    // 3. Initialize Player Module
    const Player = window.AudioFlowPlayer;
    if (Player) {
        Player.init({
            player,
            playPauseBtn,
            playPauseIcon,
            prevBtn,
            nextBtn,
            loopBtn,
            loopIcon,
            shuffleBtn,
            shuffleIcon,
            currentTimeDisplay,
            totalTimeDisplay,
            progressBar,
            progressFill,
            progressHandle,
            volumeBtn,
            volumeIcon,
            volumeSliderHorizontal,
            volumeFillHorizontal,
            volumeHandleHorizontal
        }, socket, roomId);
        // Initialize player controls and event listeners
        Player.initializePlayer();
        console.log('[AudioFlow] Player module initialized');
    }

    // 4. Initialize Queue Module
    const Queue = window.AudioFlowQueue;
    if (Queue) {
        Queue.init({
            queueList,
            queueCount,
            musicGrid,
            queueView,
            queueBtn,
            player,
            coverArt
        }, socket, roomId);
        console.log('[AudioFlow] Queue module initialized');
    }

    // 5. Initialize Lyrics Module
    const Lyrics = window.AudioFlowLyrics;
    if (Lyrics) {
        Lyrics.init({
            lyricsContent,
            lyricsLoading,
            fullscreenLyricsOverlay,
            fullscreenLyricsContent,
            player
        }, socket, roomId);
        console.log('[AudioFlow] Lyrics module initialized');
    }

    // 6. Initialize Fullscreen Module
    const Fullscreen = window.AudioFlowFullscreen;
    if (Fullscreen) {
        Fullscreen.init({ player }, socket, roomId);
        console.log('[AudioFlow] Fullscreen module initialized');
    }

    // 7. Initialize Upload Module
    const Upload = window.AudioFlowUpload;
    if (Upload) {
        Upload.init({
            uploadBtn,
            uploadStemsBtn,
            audioInput,
            vocalsInput,
            instrumentalInput,
            dragDropOverlay,
            songTitleElement,
            songArtistElement,
            fileNameDisplay
        }, roomId);
        console.log('[AudioFlow] Upload module initialized');
    }

    // 8. Initialize Search Module
    const Search = window.AudioFlowSearch;
    if (Search) {
        Search.init({
            searchBtn,
            searchInput,
            searchModal,
            searchResults,
            closeSearch
        }, roomId);
        console.log('[AudioFlow] Search module initialized');
    }

    // 9. Initialize Members Module
    const Members = window.AudioFlowMembers;
    if (Members) {
        Members.init({
            membersSidebarList,
            membersModal,
            membersBadge
        }, socket, roomId);
        console.log('[AudioFlow] Members module initialized');
    }

    // 10. Initialize Socket Handlers Module
    const SocketHandlers = window.AudioFlowSocketHandlers;
    if (SocketHandlers) {
        SocketHandlers.init(socket, roomId, player, {
            fileNameDisplay,
            songTitleElement,
            songArtistElement,
            playerTrackTitle,
            playerTrackArtist,
            coverArt,
            coverArtPlaceholder,
            progressFill,
            progressHandle,
            currentTimeDisplay,
            totalTimeDisplay
        });
        console.log('[AudioFlow] Socket handlers module initialized');
    }

    // --- Global Functions (for backwards compatibility) ---

    function buildUploadSource(filename) {
        return `/uploads/${encodeURIComponent(filename)}`;
    }

    function ensureSecondaryPlayer() {
        if (secondaryPlayer && secondaryPlayer.isConnected) {
            return secondaryPlayer;
        }

        secondaryPlayer = document.getElementById('player-secondary');
        if (!secondaryPlayer) {
            secondaryPlayer = document.createElement('audio');
            secondaryPlayer.id = 'player-secondary';
            secondaryPlayer.preload = 'auto';
            secondaryPlayer.style.display = 'none';
            document.body.appendChild(secondaryPlayer);
        }

        secondaryPlayer.volume = player.volume;
        secondaryPlayer.playbackRate = player.playbackRate || 1.0;
        return secondaryPlayer;
    }

    function clearSecondaryPlayer() {
        const secondary = ensureSecondaryPlayer();
        isDualMixActive = false;
        if (!secondary) return;

        try {
            secondary.pause();
        } catch (e) {
            console.warn('[AudioFlow] Secondary pause failed:', e);
        }

        secondary.removeAttribute('src');
        secondary.load();

        if (Visualizer && typeof Visualizer.clearSecondaryOutputPlayer === 'function') {
            Visualizer.clearSecondaryOutputPlayer();
        }
    }

    function syncSecondaryToPrimary(force = false) {
        if (!isDualMixActive) return;
        const secondary = ensureSecondaryPlayer();
        if (!secondary || !secondary.src) return;

        const drift = Math.abs((secondary.currentTime || 0) - (player.currentTime || 0));
        if (force || drift > 0.08) {
            try {
                secondary.currentTime = player.currentTime || 0;
            } catch (e) {
                console.warn('[AudioFlow] Secondary seek sync failed:', e);
            }
        }

        secondary.playbackRate = player.playbackRate || 1.0;
        secondary.volume = player.volume;
    }

    function startSecondaryPlayback() {
        if (!isDualMixActive) return;
        const secondary = ensureSecondaryPlayer();
        if (!secondary || !secondary.src) return;

        syncSecondaryToPrimary(true);
        const playPromise = secondary.play();
        if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch((err) => {
                console.warn('[AudioFlow] Secondary stem autoplay blocked:', err);
            });
        }
    }

    function pauseSecondaryPlayback() {
        if (!isDualMixActive) return;
        const secondary = ensureSecondaryPlayer();
        if (!secondary) return;

        try {
            secondary.pause();
        } catch (e) {
            console.warn('[AudioFlow] Secondary pause failed:', e);
        }
    }

    function shouldUseDualMix(trackOptions) {
        if (!trackOptions || typeof trackOptions !== 'object') return false;
        const role = String(trackOptions.assigned_audio_role || '').toLowerCase();
        const mixFiles = trackOptions.mix_filenames;
        if (role !== 'mix') return false;
        if (!mixFiles || typeof mixFiles !== 'object') return false;
        return !!mixFiles.vocals && !!mixFiles.instrumental;
    }
    
    // Make loadAudio available globally
    window.loadAudio = function(filename, cover, displayFilename, title, artist, proxyId, imageUrl, trackOptions) {
        console.log('[AudioFlow] loadAudio called:', { filename, title, artist, trackOptions });

        const assignedChannelMode = String(
            trackOptions && trackOptions.assigned_channel_mode
                ? trackOptions.assigned_channel_mode
                : 'stereo'
        ).toLowerCase();

        if (Visualizer && typeof Visualizer.setChannelMode === 'function') {
            Visualizer.setChannelMode(assignedChannelMode);
        }

        const dualMixRequested = shouldUseDualMix(trackOptions);
        const mixFiles = dualMixRequested ? trackOptions.mix_filenames : null;
        const primaryStemFilename = dualMixRequested ? mixFiles.vocals : null;
        const secondaryStemFilename = dualMixRequested ? mixFiles.instrumental : null;

        const mixCovers = trackOptions && typeof trackOptions.mix_covers === 'object' ? trackOptions.mix_covers : null;
        const selectedVariant = trackOptions && trackOptions.selected_audio_variant;
        const effectiveCover = cover || (mixCovers ? mixCovers[selectedVariant] || mixCovers.vocals || mixCovers.instrumental : null);
        const sourceFilename = primaryStemFilename || filename;
        
        // Handle no file case
        if (!sourceFilename && !proxyId) {
            if (Lyrics) {
                Lyrics.reset();
                if (typeof Lyrics.setCurrentSongKey === 'function') {
                    Lyrics.setCurrentSongKey(null);
                }
            }
            if (Visualizer && typeof Visualizer.setChannelMode === 'function') {
                Visualizer.setChannelMode('stereo');
            }
            songTitleElement.textContent = "No file selected";
            songArtistElement.textContent = "";
            coverArt.style.display = 'none';
            coverArt.src = '';
            if (coverArtPlaceholder) {
                coverArtPlaceholder.style.display = 'none';
            }
            clearSecondaryPlayer();
            if (Theme) Theme.resetTheme();
            return;
        }

        const keepLyricsVisible = !!(
            Lyrics &&
            typeof Lyrics.isVisible === 'function' &&
            Lyrics.isVisible()
        );

        // Determine display title
        let displayTitle = title || (displayFilename || sourceFilename);
        if (!title) {
            displayTitle = displayTitle
                .replace(/_/g, " ")
                .replace(/\.(mp3|wav|ogg|flac|m4a)$/i, "");
        }

        // Set song info
        songTitleElement.textContent = displayTitle;
        songTitleElement.title = displayTitle;

        if (artist) {
            songArtistElement.textContent = artist;
            songArtistElement.title = artist;
            songArtistElement.style.display = 'block';
        } else {
            songArtistElement.textContent = "";
            songArtistElement.style.display = 'none';
        }

        if (Lyrics) {
            Lyrics.reset({ keepVisible: keepLyricsVisible });
            if (
                typeof Lyrics.generateSongKey === 'function' &&
                typeof Lyrics.setCurrentSongKey === 'function'
            ) {
                Lyrics.setCurrentSongKey(Lyrics.generateSongKey(sourceFilename, title, artist));
            }
            if (keepLyricsVisible && typeof Lyrics.refreshVisibleLyrics === 'function') {
                Lyrics.refreshVisibleLyrics();
            }
        }

        // Update document title
        const docTitle = title && artist ? `${title} - ${artist}` : displayTitle;
        document.title = fileNameDisplay.classList.contains('playing') ? (docTitle || "AudioFlow") : "AudioFlow";

        // Set player source
        if (proxyId) {
            player.src = `/stream_proxy/${proxyId}`;
            player.currentProxyId = proxyId;
            clearSecondaryPlayer();
        } else {
            player.src = buildUploadSource(sourceFilename);
            delete player.currentProxyId;

            if (
                dualMixRequested &&
                secondaryStemFilename &&
                secondaryStemFilename !== sourceFilename
            ) {
                const secondary = ensureSecondaryPlayer();
                secondary.src = buildUploadSource(secondaryStemFilename);
                secondary.load();
                isDualMixActive = true;
                if (Visualizer && typeof Visualizer.setSecondaryOutputPlayer === 'function') {
                    Visualizer.setSecondaryOutputPlayer(secondary);
                }
            } else {
                clearSecondaryPlayer();
            }
        }
        player.load();

        // Update thumbnail
        const playerThumbnail = document.getElementById('player-thumbnail');
        if (playerThumbnail) {
            if (effectiveCover) {
                playerThumbnail.src = `/uploads/${effectiveCover}`;
                playerThumbnail.style.display = 'block';
            } else if (imageUrl) {
                playerThumbnail.src = imageUrl;
                playerThumbnail.style.display = 'block';
            } else {
                playerThumbnail.style.display = 'none';
            }
        }

        // Reset theme and update cover
        fileNameDisplay.classList.remove('playing');
        if (Fullscreen) Fullscreen.hideCoverDancingBars();
        if (Theme) Theme.resetTheme();

        // Load cover art
        if (effectiveCover) {
            if (coverArtPlaceholder) {
                coverArtPlaceholder.style.display = 'none';
            }
            coverArt.src = `/uploads/${effectiveCover}`;
            coverArt.style.display = 'block';
            coverArt.onload = handleCoverLoad;
        } else if (imageUrl) {
            if (coverArtPlaceholder) {
                coverArtPlaceholder.style.display = 'none';
            }
            const proxiedImageUrl = `/image_proxy?url=${encodeURIComponent(imageUrl)}`;
            coverArt.src = proxiedImageUrl;
            coverArt.style.display = 'block';
            coverArt.onload = handleCoverLoad;
        } else {
            coverArt.style.display = 'none';
            if (coverArtPlaceholder) {
                coverArtPlaceholder.style.display = 'block';
                coverArtPlaceholder.classList.add('visible');
            }
            if (Theme) Theme.resetTheme();
        }
    };

    function handleCoverLoad() {
        try {
            const dominantColor = colorThief.getColor(coverArt);
            const palette = colorThief.getPalette(coverArt, 3);
            
            if (Theme) {
                Theme.setCurrentColors(dominantColor, palette);
                Theme.applyTheme(dominantColor, palette);
            }
            
            const [r, g, b] = dominantColor;
            coverArt.style.boxShadow = `0 0 15px rgba(${r},${g},${b},0.6), 0 0 35px rgba(${r},${g},${b},0.4)`;
            
            // Setup 3D tilt
            const Utils = window.AudioFlowUtils;
            if (Utils && Utils.setup3DTiltEffect) {
                Utils.setup3DTiltEffect(coverArt);
            }
            
            // Trigger slide animation
            if (Fullscreen) {
                const lastDir = Fullscreen.getLastDirection();
                if (lastDir) {
                    Fullscreen.triggerSlideInAnimation(lastDir);
                }
            }
        } catch (e) {
            console.warn('[AudioFlow] Color extraction failed:', e);
            if (Theme) Theme.resetTheme();
        }
    }

    // --- Event Listeners ---

    // Sync button
    if (syncBtn) {
        syncBtn.addEventListener('click', () => {
            if (!player.src || player.src.endsWith('/null')) return;
            socket.emit('sync', { room: roomId, time: player.currentTime });
        });
    }

    // Header sync button (mobile)
    const headerSyncBtn = document.getElementById('header-sync-btn');
    if (headerSyncBtn) {
        headerSyncBtn.addEventListener('click', () => {
            if (!player.src || player.src.endsWith('/null')) return;
            socket.emit('sync', { room: roomId, time: player.currentTime });
        });
    }

    // Queue toggle button
    if (queueBtn && queueView && musicGrid) {
        queueBtn.addEventListener('click', () => {
            if (queueView.style.display === 'none') {
                queueView.style.display = 'block';
                musicGrid.style.display = 'none';
                queueBtn.classList.add('active');
            } else {
                queueView.style.display = 'none';
                musicGrid.style.display = 'grid';
                queueBtn.classList.remove('active');
            }
        });
    }

    // Lyrics button
    if (lyricsBtn) {
        lyricsBtn.addEventListener('click', () => {
            if (Lyrics) Lyrics.toggleFullscreenLyrics();
        });
    }

    // Player events
    player.addEventListener('play', () => {
        startSecondaryPlayback();
        if (SocketHandlers && SocketHandlers.isReceiving()) return;
        fileNameDisplay.classList.add('playing');
        if (Visualizer) {
            Visualizer.initAudioContext();
            Visualizer.connectAudioSource();
        }
        if (Fullscreen) Fullscreen.showCoverDancingBars();
        if (Lyrics && Lyrics.getParsedLyrics().length > 0) {
            Lyrics.startLyricsSync();
        }
        socket.emit('play', { room: roomId, time: player.currentTime });
    });

    player.addEventListener('pause', () => {
        pauseSecondaryPlayback();
        if (SocketHandlers && SocketHandlers.isReceiving()) return;
        if (player.seeking) return;
        player.playbackRate = 1.0;
        fileNameDisplay.classList.remove('playing');
        if (Fullscreen) Fullscreen.hideCoverDancingBars();
        if (Theme) Theme.updateThemeForPlayingState();
        if (Lyrics) Lyrics.stopLyricsSync();
        socket.emit('pause', { room: roomId });
    });

    player.addEventListener('ended', () => {
        pauseSecondaryPlayback();
        const isLooping = Player ? Player.getLooping() : false;
        const isShuffling = Player ? Player.getShuffling() : false;
        
        if (isLooping) {
            socket.emit('loop_restart', { room: roomId });
            player.currentTime = 0;
            player.play();
            return;
        }

        fileNameDisplay.classList.remove('playing');
        if (Fullscreen) Fullscreen.hideCoverDancingBars();

        const queue = Queue ? Queue.getQueue() : [];
        if (queue.length > 1) {
            if (isShuffling) {
                if (Fullscreen) Fullscreen.setManualDirection('next');
                socket.emit('shuffle_next', { room: roomId, auto_play: true });
            } else {
                if (Fullscreen) Fullscreen.setManualDirection('next');
                socket.emit('next_song', { room: roomId, auto_play: true });
            }
        }
    });

    player.addEventListener('seeked', () => {
        syncSecondaryToPrimary(true);
        if (SocketHandlers && SocketHandlers.isReceiving()) return;
        if (Visualizer) Visualizer.ensureAudioConnection();
        if (!player.paused && Visualizer) Visualizer.start();
        if (Lyrics) Lyrics.updateLyricsHighlight();
        socket.emit('seek', { room: roomId, time: player.currentTime });
    });

    player.addEventListener('timeupdate', () => {
        syncSecondaryToPrimary(false);
    });

    player.addEventListener('ratechange', () => {
        syncSecondaryToPrimary(true);
    });

    player.addEventListener('volumechange', () => {
        syncSecondaryToPrimary(true);
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // L key for lyrics toggle (in fullscreen)
        if (e.key === 'l' || e.key === 'L') {
            if (document.body.classList.contains('fullscreen-mode') && Lyrics) {
                Lyrics.toggleFullscreenLyrics();
            }
        }
        
        // Space for play/pause (when not in input)
        if (e.key === ' ' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
            e.preventDefault();
            if (player.paused) {
                player.play();
            } else {
                player.pause();
            }
        }
        
        // Arrow keys for seek
        if (e.key === 'ArrowLeft' && e.target.tagName !== 'INPUT') {
            player.currentTime = Math.max(0, player.currentTime - 5);
        }
        if (e.key === 'ArrowRight' && e.target.tagName !== 'INPUT') {
            player.currentTime = Math.min(player.duration || 0, player.currentTime + 5);
        }
    });

    // Resize handlers for cover positioning
    function updateCoverPositionVars() {
        const coverSection = document.querySelector('.cover-section');
        if (!coverSection) return;

        const coverEl = (coverArt && coverArt.offsetParent !== null && coverArt.style.display !== 'none')
            ? coverArt
            : coverArtPlaceholder;
        if (!coverEl) return;

        const coverWidth = coverEl.clientWidth || parseFloat(getComputedStyle(coverEl).width) || 0;
        if (!coverWidth) return;

        coverSection.style.setProperty('--cover-size', `${Math.round(coverWidth)}px`);
    }

    window.addEventListener('resize', updateCoverPositionVars);
    window.addEventListener('orientationchange', updateCoverPositionVars);
    document.addEventListener('fullscreenchange', updateCoverPositionVars);

    // Initial setup
    setTimeout(updateCoverPositionVars, 100);

    console.log('[AudioFlow] All modules initialized successfully!');
});
