document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements & Initial Setup ---
    const socket = io();
    const colorThief = new ColorThief();
    const player = document.getElementById('player');
    const audioInput = document.getElementById('audio-input');
    const uploadBtn = document.getElementById('upload-btn');
    const syncBtn = document.getElementById('sync-btn');
    const queueBtn = document.getElementById('queue-btn');
    const queueCount = document.getElementById('queue-count');
    const queueModal = document.getElementById('queue-modal');
    const closeQueueBtn = document.getElementById('close-queue');
    const queueList = document.getElementById('queue-list');
    const lyricsBtn = document.getElementById('lyrics-btn');
    const lyricsToggleBtn = document.getElementById('lyrics-toggle-btn');
    console.log('Looking for lyrics-toggle-btn:', lyricsToggleBtn);
    const lyricsModal = document.getElementById('lyrics-modal');
    const closeLyricsBtn = document.getElementById('close-lyrics');
    const lyricsContent = document.getElementById('lyrics-content');
    const lyricsLoading = document.getElementById('lyrics-loading');
    const memberCount = document.querySelector('.member-count');
    const membersModal = document.getElementById('members-modal');
    const closeMembersBtn = document.getElementById('close-members');
    // membersList is now accessed dynamically in functions to avoid scope issues
    let fullscreenLyricsOverlay = document.getElementById('fullscreen-lyrics-overlay');
    let fullscreenLyricsContent = document.getElementById('fullscreen-lyrics-content');
    const fileNameDisplay = document.getElementById('file-name');
    const songTitleElement = document.getElementById('song-title');
    const songArtistElement = document.getElementById('song-artist');
    const coverArt = document.getElementById('cover-art');
    const coverArtPlaceholder = document.getElementById('cover-art-placeholder');
    const controlButtons = document.querySelectorAll('.control-button');
    const coverDancingBarsLeft = document.querySelector('.cover-dancing-bars.left');
    const coverDancingBarsRight = document.querySelector('.cover-dancing-bars.right');

    // Lyrics variables
    let parsedLyrics = [];
    let currentLyricsIndex = -1;
    let lyricsUpdateInterval = null;
    let lyricsCache = new Map(); // Cache lyrics by song key (filename + title + artist)
    let currentSongKey = null; // Current song identifier for lyrics
    let isFullscreenLyricsVisible = false; // Track fullscreen lyrics state

    // Keep dancing bars inside container across devices by tying CSS vars to real cover size
    function updateCoverPositionVars() {
        const coverSection = document.querySelector('.cover-section');
        if (!coverSection) return;

        // Use whichever is visible: cover image or placeholder
        const coverEl = (coverArt && coverArt.offsetParent !== null && coverArt.style.display !== 'none')
            ? coverArt
            : coverArtPlaceholder;
        if (!coverEl) return;

        const coverWidth = coverEl.clientWidth || parseFloat(getComputedStyle(coverEl).width) || 0;
        if (!coverWidth) return;

        // Set precise cover size var in px so bar positioning matches layout
        coverSection.style.setProperty('--cover-size', `${Math.round(coverWidth)}px`);

        // Derive group width from computed styles (3 bars + 2 gaps)
        const barsGroup = document.querySelector('.cover-dancing-bars.left') || document.querySelector('.cover-dancing-bars.right');
        const oneBar = barsGroup ? barsGroup.querySelector('.bar') : null;
        const barWidth = oneBar ? parseFloat(getComputedStyle(oneBar).width) : 3;
        const gap = barsGroup ? parseFloat(getComputedStyle(barsGroup).gap) : 3;
        const groupWidth = (barWidth * 3) + (gap * 2);
        coverSection.style.setProperty('--bar-group-width', `${Math.round(groupWidth)}px`);

        // Keep a conservative minimal gap (device differences can cause rounding)
        const isMobile = window.innerWidth <= 600;
        const baseGap = isMobile ? 6 : 10;
        coverSection.style.setProperty('--bar-gap', `${baseGap}px`);
    }

    // --- Custom Player Elements ---
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
    const volumePopup = document.getElementById('volume-popup');
    const volumeSliderVertical = document.querySelector('.volume-slider-vertical');
    const volumeFillVertical = document.getElementById('volume-fill-vertical');
    const volumeHandleVertical = document.getElementById('volume-handle-vertical');

    // --- State & Configuration ---
    const roomId = document.body.dataset.roomId;
    let isReceivingUpdate = false;
    let userHasJustSeeked = false;
    let seekDebounceTimer = null;
    let pingInterval;
    let currentDominantColor = null;
    let currentColorPalette = null;
    let themeUpdateTimeout;
    let isDraggingProgress = false;
    let isDraggingVolume = false;
    let lastVolume = 0.7; // Remember last volume for mute/unmute
    let lastChangeDirection = null; // Track direction of song changes
    let manualDirection = null; // Direction explicitly set by local button click
    let currentSongFile = null; // Track current song to detect automatic changes
    let isLooping = false; // Loop state
    let isShuffling = false; // Shuffle state

    let serverTimeOffset = 0;

    // --- Queue State ---
    let currentQueue = [];
    let currentQueueIndex = -1;
    let lastQueueIndex = -1; // Track previous index for direction inference

    // --- Initialize lyrics cache from localStorage ---
    loadLyricsCacheFromStorage();

    const MAX_ALLOWED_DRIFT_S = 0.5;
    const PLAYBACK_RATE_ADJUST = 0.05;

    // --- Audio Visualizer Setup ---
    let audioContext = null;
    let analyser = null;
    let leftAnalyser = null;
    let rightAnalyser = null;
    let dataArray = null;
    let leftDataArray = null;
    let rightDataArray = null;
    let source = null;
    let splitter = null;
    let animationId = null;
    let visualizerInterval = null;

    // =================================================================================
    // Clock Synchronization
    // =================================================================================
    function syncClock() {
        const startTime = Date.now();
        socket.emit('client_ping');
        socket.once('server_pong', (data) => {
            const roundTripTime = Date.now() - startTime;
            const serverTime = data.timestamp * 1000;
            const estimatedServerTime = serverTime + (roundTripTime / 2);
            serverTimeOffset = estimatedServerTime - Date.now();
            console.log(`Clock synced. RTT: ${roundTripTime}ms, Offset: ${serverTimeOffset.toFixed(2)}ms`);
        });
    }

    // =================================================================================
    // Audio Visualizer Functions
    // =================================================================================

    function initAudioContext() {
        if (!audioContext) {
            try {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
                
                // Create main analyser for fallback
                analyser = audioContext.createAnalyser();
                analyser.fftSize = 512;
                analyser.smoothingTimeConstant = 0.3;
                analyser.minDecibels = -90;
                analyser.maxDecibels = -10;
                
                // Create separate analysers for left and right channels
                leftAnalyser = audioContext.createAnalyser();
                rightAnalyser = audioContext.createAnalyser();
                
                leftAnalyser.fftSize = 512;
                leftAnalyser.smoothingTimeConstant = 0.3;
                leftAnalyser.minDecibels = -90;
                leftAnalyser.maxDecibels = -10;
                
                rightAnalyser.fftSize = 512;
                rightAnalyser.smoothingTimeConstant = 0.3;
                rightAnalyser.minDecibels = -90;
                rightAnalyser.maxDecibels = -10;
                
                // Create channel splitter for stereo separation
                splitter = audioContext.createChannelSplitter(2);
                
                const bufferLength = analyser.frequencyBinCount;
                dataArray = new Uint8Array(bufferLength);
                leftDataArray = new Uint8Array(leftAnalyser.frequencyBinCount);
                rightDataArray = new Uint8Array(rightAnalyser.frequencyBinCount);
                
                console.log('Audio context initialized with stereo channel separation for left/right dancing bars');
            } catch (e) {
                console.error('Could not initialize audio context:', e);
            }
        }
    }

    function connectAudioSource() {
        if (audioContext && analyser && leftAnalyser && rightAnalyser && splitter && !source) {
            try {
                source = audioContext.createMediaElementSource(player);
                
                // Connect to main analyser (fallback)
                source.connect(analyser);
                
                // Connect to stereo splitter
                source.connect(splitter);
                
                // Connect split channels to their respective analysers
                splitter.connect(leftAnalyser, 0); // Left channel (index 0) to left analyser
                splitter.connect(rightAnalyser, 1); // Right channel (index 1) to right analyser
                
                // Connect to destination for audio output
                source.connect(audioContext.destination);
                
                console.log('Audio source connected with stereo channel separation');
            } catch (e) {
                console.error('Could not connect audio source:', e);
                // If stereo connection fails, try fallback to mono
                if (source) {
                    try {
                        source.connect(analyser);
                        source.connect(audioContext.destination);
                        console.log('Audio source connected in mono fallback mode');
                    } catch (reconnectError) {
                        console.error('Could not reconnect audio source:', reconnectError);
                    }
                }
            }
        } else if (audioContext && analyser && source) {
            // Source already exists, make sure it's connected
            try {
                source.connect(analyser);
                source.connect(audioContext.destination);
                console.log('Existing audio source reconnected');
            } catch (e) {
                console.log('Source already connected or connection failed:', e.message);
            }
        }
    }

    function ensureAudioConnection() {
        console.log('ensureAudioConnection called');
        // Ensure audio context is active and connected
        if (audioContext && source && analyser && leftAnalyser && rightAnalyser) {
            try {
                // Check if context is suspended and resume if needed
                if (audioContext.state === 'suspended') {
                    audioContext.resume();
                }
                console.log('Stereo audio connection verified after seek');
            } catch (e) {
                console.error('Error ensuring stereo audio connection:', e);
            }
        } else {
            console.log('Reconnecting stereo audio source: context:', !!audioContext, 'source:', !!source, 'analysers:', !!leftAnalyser && !!rightAnalyser);
            // Reconnect if something is missing
            connectAudioSource();
        }
    }

    function updateVisualizerBars() {
        if (!leftAnalyser || !rightAnalyser || !leftDataArray || !rightDataArray) {
            console.log('Stereo visualizer not running: analysers or data arrays missing');
            return;
        }

        // Get frequency data for both channels
        leftAnalyser.getByteFrequencyData(leftDataArray);
        rightAnalyser.getByteFrequencyData(rightDataArray);

        const leftBars = coverDancingBarsLeft.querySelectorAll('.bar');
        const rightBars = coverDancingBarsRight.querySelectorAll('.bar');

        // Process left channel data
        const leftBass = leftDataArray[5];   // Low freq (bass)
        const leftMid = leftDataArray[15];   // Mid freq
        const leftTreble = leftDataArray[25]; // High freq (treble)

        // Process right channel data
        const rightBass = rightDataArray[5];   // Low freq (bass)
        const rightMid = rightDataArray[15];   // Mid freq
        const rightTreble = rightDataArray[25]; // High freq (treble)

        // Dynamic max height based on fullscreen mode and screen size
        const isFullscreen = document.body.classList.contains('fullscreen-mode');
        const isMobile = window.innerWidth <= 600;
        const isExtraSmall = window.innerWidth <= 400;
        
        let maxHeight;
        if (isFullscreen) {
            if (isExtraSmall) {
                maxHeight = 180; // Smaller bars for extra small mobile screens in fullscreen
            } else if (isMobile) {
                maxHeight = 220; // Medium bars for mobile screens in fullscreen
            } else {
                maxHeight = 280; // Full height bars for desktop fullscreen
            }
        } else {
            maxHeight = 180; // Default height for non-fullscreen mode
        }

        const normalize = (value, max = 255, silenceThreshold = 10) => {
            if (value < silenceThreshold) return '0px';  // Fully collapse if quiet
            return `${(value / max) * maxHeight}px`;     // Scale height with dynamic maxHeight
        };

        // Update left bars with left channel data (treble, mid, bass)
        if (leftBars.length >= 3) {
            leftBars[0].style.height = normalize(leftTreble); // Treble
            leftBars[1].style.height = normalize(leftMid);    // Mid
            leftBars[2].style.height = normalize(leftBass);   // Bass
        }

        // Update right bars with right channel data (bass, mid, treble)
        if (rightBars.length >= 3) {
            rightBars[0].style.height = normalize(rightBass);   // Bass
            rightBars[1].style.height = normalize(rightMid);    // Mid
            rightBars[2].style.height = normalize(rightTreble); // Treble
        }

        if (!player.paused) {
            animationId = requestAnimationFrame(updateVisualizerBars);
        } else {
            animationId = null;
            if (visualizerInterval) {
                clearInterval(visualizerInterval);
                visualizerInterval = null;
            }
        }
    }

    function startVisualizer() {
        console.log('startVisualizer called');
        if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume();
            console.log('Audio context resumed');
        }
        ensureAudioConnection();
        
        // Cancel any existing animation frame first
        if (animationId) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }
        
        if (!player.paused) {
            console.log('Starting visualizer animation loop');
            updateVisualizerBars();
            
            // Also start a backup interval to ensure animation continues
            if (!visualizerInterval) {
                visualizerInterval = setInterval(() => {
                    if (!animationId && !player.paused) {
                        console.log('Backup interval restarting animation');
                        updateVisualizerBars();
                    }
                }, 100); // Check every 100ms
            }
        } else {
            console.log(`Visualizer not started: paused=${player.paused}`);
        }
    }

    function stopVisualizer() {
        if (animationId) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }
        
        if (visualizerInterval) {
            clearInterval(visualizerInterval);
            visualizerInterval = null;
        }
        
        // Reset bars to minimum heights (no animation)
        const allBars = document.querySelectorAll('.cover-dancing-bars .bar');
        allBars.forEach((bar, index) => {
            // Reset to minimum heights (when audio is below 50%)
            if (bar.closest('.left')) {
                if (index === 0) bar.style.height = '10px'; // Treble minimum
                else if (index === 1) bar.style.height = '15px'; // Mid minimum
                else if (index === 2) bar.style.height = '20px'; // Bass minimum
            } else {
                if (index === 0) bar.style.height = '20px'; // Bass minimum
                else if (index === 1) bar.style.height = '15px'; // Mid minimum
                else if (index === 2) bar.style.height = '10px'; // Treble minimum
            }
        });
    }

    // =================================================================================
    // Custom Player Functions
    // =================================================================================

    function formatTime(seconds) {
        if (isNaN(seconds)) return '0:00';
        const minutes = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }

    function updateProgressBar() {
        if (isDraggingProgress) return;
        
        // Add null checks for progress elements
        if (!progressFill || !progressHandle || !currentTimeDisplay || !totalTimeDisplay) {
            console.log('Progress bar elements not yet available');
            return;
        }
        
        const progress = player.duration ? (player.currentTime / player.duration) * 100 : 0;
        progressFill.style.width = `${progress}%`;
        progressHandle.style.left = `${progress}%`;
        
        currentTimeDisplay.textContent = formatTime(player.currentTime);
        totalTimeDisplay.textContent = formatTime(player.duration);
    }

    function updateVolumeDisplay() {
        if (isDraggingVolume) return;
        
        // Add null checks for volume elements
        if (!volumeFillVertical || !volumeHandleVertical || !volumeIcon) {
            console.log('Volume elements not yet available');
            return;
        }
        
        const volumePercent = player.volume * 100;
        volumeFillVertical.style.height = `${volumePercent}%`;
        volumeHandleVertical.style.bottom = `${volumePercent}%`;
        
        // Update volume icon based on volume level
        if (player.volume === 0) {
            volumeIcon.className = 'fas fa-volume-mute';
        } else if (player.volume < 0.5) {
            volumeIcon.className = 'fas fa-volume-down';
        } else {
            volumeIcon.className = 'fas fa-volume-up';
        }
    }

    function showVolumePopup() {
        if (!volumePopup) {
            console.log('Volume popup element not yet available');
            return;
        }
        volumePopup.style.display = 'block';
        setTimeout(() => volumePopup.classList.add('show'), 10);
    }

    function hideVolumePopup() {
        if (!volumePopup) {
            console.log('Volume popup element not yet available');
            return;
        }
        volumePopup.classList.remove('show');
        setTimeout(() => volumePopup.style.display = 'none', 300);
    }

    function toggleMute() {
        if (player.volume === 0) {
            // Unmute: restore last volume
            player.volume = lastVolume > 0 ? lastVolume : 0.7;
        } else {
            // Mute: save current volume and set to 0
            lastVolume = player.volume;
            player.volume = 0;
        }
        updateVolumeDisplay();
    }

    function hideVolumePopupOnClickOutside(e) {
        if (!volumeBtn.contains(e.target) && !volumePopup.contains(e.target)) {
            hideVolumePopup();
        }
    }

    function updatePlayPauseButton() {
        if (!playPauseIcon) {
            console.log('Play/pause icon element not yet available');
            return;
        }
        
        if (player.paused) {
            playPauseIcon.className = 'fas fa-play';
        } else {
            playPauseIcon.className = 'fas fa-pause';
        }
    }

    function toggleLoop() {
        isLooping = !isLooping;
        updateLoopButton();
        console.log('Loop mode:', isLooping ? 'enabled' : 'disabled');
        
        // Synchronize loop state across all devices in the room
        socket.emit('loop_toggle', { room: roomId, isLooping: isLooping });
    }

    function updateLoopButton() {
        if (!loopBtn || !loopIcon) {
            console.log('Loop button elements not yet available');
            return;
        }
        
        if (isLooping) {
            loopBtn.classList.add('loop-active');
            
            // Apply dynamic color from progress bar
            const progressFillStyle = window.getComputedStyle(progressFill);
            const backgroundImage = progressFillStyle.backgroundImage;
            
            if (backgroundImage && backgroundImage !== 'none') {
                // Extract the gradient and apply it with lower opacity for the loop button
                const activeGradient = backgroundImage.replace(/rgba?\(([^)]+)\)/g, (match, params) => {
                    // Parse the rgba values and reduce opacity
                    const values = params.split(',').map(v => v.trim());
                    if (values.length >= 3) {
                        const alpha = values.length === 4 ? Math.min(parseFloat(values[3]) * 0.3, 0.3) : 0.3;
                        return `rgba(${values[0]}, ${values[1]}, ${values[2]}, ${alpha})`;
                    }
                    return match;
                });
                
                loopBtn.style.setProperty('background', activeGradient, 'important');
            }
        } else {
            loopBtn.classList.remove('loop-active');
            // Remove any custom background to revert to default styling
            loopBtn.style.removeProperty('background');
        }
    }

    function toggleShuffle() {
        isShuffling = !isShuffling;
        updateShuffleButton();
        console.log('Shuffle mode:', isShuffling ? 'enabled' : 'disabled');
        
        // Synchronize shuffle state across all devices in the room
        socket.emit('shuffle_toggle', { room: roomId, isShuffling: isShuffling });
    }

    function updateShuffleButton() {
        if (!shuffleBtn || !shuffleIcon) {
            console.log('Shuffle button elements not yet available');
            return;
        }
        
        if (isShuffling) {
            shuffleBtn.classList.add('shuffle-active');
            
            // Apply dynamic color from progress bar
            const progressFillStyle = window.getComputedStyle(progressFill);
            const backgroundImage = progressFillStyle.backgroundImage;
            
            if (backgroundImage && backgroundImage !== 'none') {
                // Extract the gradient and apply it with lower opacity for the shuffle button
                const activeGradient = backgroundImage.replace(/rgba?\(([^)]+)\)/g, (match, params) => {
                    // Parse the rgba values and reduce opacity
                    const values = params.split(',').map(v => v.trim());
                    if (values.length >= 3) {
                        const alpha = values.length === 4 ? Math.min(parseFloat(values[3]) * 0.3, 0.3) : 0.3;
                        return `rgba(${values[0]}, ${values[1]}, ${values[2]}, ${alpha})`;
                    }
                    return match;
                });
                
                shuffleBtn.style.setProperty('background', activeGradient, 'important');
            }
        } else {
            shuffleBtn.classList.remove('shuffle-active');
            // Remove any custom background to revert to default styling
            shuffleBtn.style.removeProperty('background');
        }
    }

    function handleProgressBarClick(e) {
        if (!player.duration) return;
        
        const rect = progressBar.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const progress = clickX / rect.width;
        const newTime = progress * player.duration;
        
        player.currentTime = newTime;
        updateProgressBar();
    }

    function handleVolumeSliderClick(e) {
        const rect = volumeSliderVertical.getBoundingClientRect();
        const clickY = e.clientY - rect.top;
        const volume = Math.max(0, Math.min(1, 1 - (clickY / rect.height))); // Inverted for vertical
        
        player.volume = volume;
        if (volume > 0) {
            lastVolume = volume;
        }
        updateVolumeDisplay();
    }

    function setupProgressDragging() {
        let startX, startProgress;

        function onMouseDown(e) {
            isDraggingProgress = true;
            startX = e.clientX;
            startProgress = player.duration ? player.currentTime / player.duration : 0;
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            e.preventDefault();
        }

        function onMouseMove(e) {
            if (!isDraggingProgress || !player.duration) return;
            
            const rect = progressBar.getBoundingClientRect();
            const deltaX = e.clientX - startX;
            const deltaProgress = deltaX / rect.width;
            const newProgress = Math.max(0, Math.min(1, startProgress + deltaProgress));
            
            const newTime = newProgress * player.duration;
            player.currentTime = newTime;
            
            const progressPercent = newProgress * 100;
            progressFill.style.width = `${progressPercent}%`;
            progressHandle.style.left = `${progressPercent}%`;
            currentTimeDisplay.textContent = formatTime(newTime);
        }

        function onMouseUp() {
            isDraggingProgress = false;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        }

        progressHandle.addEventListener('mousedown', onMouseDown);
        progressBar.addEventListener('mousedown', onMouseDown);
    }

    function setupVolumeDragging() {
        let startY, startVolume;

        function onMouseDown(e) {
            isDraggingVolume = true;
            startY = e.clientY;
            startVolume = player.volume;
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            e.preventDefault();
        }

        function onMouseMove(e) {
            if (!isDraggingVolume) return;
            
            const rect = volumeSliderVertical.getBoundingClientRect();
            const deltaY = e.clientY - startY;
            const deltaVolume = -deltaY / rect.height; // Negative because Y increases downward
            const newVolume = Math.max(0, Math.min(1, startVolume + deltaVolume));
            
            player.volume = newVolume;
            if (newVolume > 0) {
                lastVolume = newVolume;
            }
            
            const volumePercent = newVolume * 100;
            volumeFillVertical.style.height = `${volumePercent}%`;
            volumeHandleVertical.style.bottom = `${volumePercent}%`;
            
            // Update volume icon
            if (newVolume === 0) {
                volumeIcon.className = 'fas fa-volume-mute';
            } else if (newVolume < 0.5) {
                volumeIcon.className = 'fas fa-volume-down';
            } else {
                volumeIcon.className = 'fas fa-volume-up';
            }
        }

        function onMouseUp() {
            isDraggingVolume = false;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        }

        volumeHandleVertical.addEventListener('mousedown', onMouseDown);
        volumeSliderVertical.addEventListener('mousedown', onMouseDown);
    }

    // Initialize custom player
    function initCustomPlayer() {
        console.log('[DEBUG] Initializing custom player');
        
        // Check if required elements exist with detailed logging
        const requiredElements = {
            volumeFillVertical: volumeFillVertical,
            volumeHandleVertical: volumeHandleVertical,
            volumeIcon: volumeIcon,
            playPauseBtn: playPauseBtn,
            playPauseIcon: playPauseIcon,
            progressBar: progressBar,
            progressFill: progressFill,
            progressHandle: progressHandle,
            currentTimeDisplay: currentTimeDisplay,
            totalTimeDisplay: totalTimeDisplay,
            volumeBtn: volumeBtn,
            volumePopup: volumePopup,
            volumeSliderVertical: volumeSliderVertical
        };
        
        const missingElements = [];
        for (const [name, element] of Object.entries(requiredElements)) {
            if (!element) {
                missingElements.push(name);
            }
        }
        
        if (missingElements.length > 0) {
            console.error('[ERROR] Missing custom player elements:', missingElements);
            console.log('[DEBUG] Attempting to re-query missing elements...');
            
            // Try to re-query missing elements
            const requeried = {};
            missingElements.forEach(name => {
                let selector;
                switch(name) {
                    case 'volumeFillVertical': selector = '#volume-fill-vertical'; break;
                    case 'volumeHandleVertical': selector = '#volume-handle-vertical'; break;
                    case 'volumeIcon': selector = '#volume-icon'; break;
                    case 'playPauseBtn': selector = '#play-pause-btn'; break;
                    case 'playPauseIcon': selector = '#play-pause-icon'; break;
                    case 'progressBar': selector = '.progress-bar'; break;
                    case 'progressFill': selector = '#progress-fill'; break;
                    case 'progressHandle': selector = '#progress-handle'; break;
                    case 'currentTimeDisplay': selector = '#current-time'; break;
                    case 'totalTimeDisplay': selector = '#total-time'; break;
                    case 'volumeBtn': selector = '#volume-btn'; break;
                    case 'volumePopup': selector = '#volume-popup'; break;
                    case 'volumeSliderVertical': selector = '.volume-slider-vertical'; break;
                }
                requeried[name] = document.querySelector(selector);
                console.log(`[DEBUG] Re-queried ${name} (${selector}):`, !!requeried[name]);
            });
            
            // If still missing critical elements, show warning but continue with partial functionality
            if (!requeried.playPauseBtn && !playPauseBtn) {
                console.error('[CRITICAL] Play/pause button not found - custom player cannot initialize');
                return;
            }
        }
        
        console.log('[DEBUG] Custom player elements validated, proceeding with initialization');
        
        // Ensure custom player is visible and default player is hidden
        const customPlayerElement = document.querySelector('.custom-player');
        if (customPlayerElement) {
            customPlayerElement.style.display = 'block';
            customPlayerElement.style.visibility = 'visible';
            console.log('[DEBUG] Custom player visibility ensured');
        } else {
            console.error('[ERROR] Custom player container (.custom-player) not found!');
        }
        
        // Ensure default player is hidden
        if (player) {
            player.style.display = 'none';
            player.controls = false;
            console.log('[DEBUG] Default player hidden and controls disabled');
        }
        
        // Set initial volume
        player.volume = lastVolume;
        updateVolumeDisplay();
        updatePlayPauseButton();
        updateLoopButton();
        updateShuffleButton();
        updateProgressBar();

        // Play/Pause button
        playPauseBtn.addEventListener('click', () => {
            if (player.paused) {
                player.play();
            } else {
                player.pause();
            }
        });

        // Volume button (toggle mute)
        volumeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleMute();
        });

        // Show volume popup on hover
        volumeBtn.addEventListener('mouseenter', () => {
            showVolumePopup();
        });

        // Hide volume popup when mouse leaves both button and popup
        volumeBtn.addEventListener('mouseleave', (e) => {
            setTimeout(() => {
                if (!volumePopup.matches(':hover') && !volumeBtn.matches(':hover')) {
                    hideVolumePopup();
                }
            }, 100);
        });

        volumePopup.addEventListener('mouseleave', (e) => {
            setTimeout(() => {
                if (!volumePopup.matches(':hover') && !volumeBtn.matches(':hover')) {
                    hideVolumePopup();
                }
            }, 100);
        });

        // Progress bar click
        progressBar.addEventListener('click', handleProgressBarClick);
        
        // Volume slider click
        volumeSliderVertical.addEventListener('click', handleVolumeSliderClick);

        // Setup dragging
        setupProgressDragging();
        setupVolumeDragging();

        // Player event listeners for custom controls
        player.addEventListener('loadedmetadata', () => {
            updateProgressBar();
            updateCoverPositionVars();
        });

        player.addEventListener('timeupdate', () => {
            updateProgressBar();
        });

        player.addEventListener('play', () => {
            updatePlayPauseButton();
            updateCoverPositionVars();
        });

        player.addEventListener('pause', () => {
            updatePlayPauseButton();
            updateCoverPositionVars();
        });

        player.addEventListener('volumechange', () => {
            updateVolumeDisplay();
        });

        // Add error handler for stream URL refresh
        player.addEventListener('error', async (e) => {
            console.log('[DEBUG] Player error occurred:', e);
            console.log('[DEBUG] Player error code:', player.error?.code);
            console.log('[DEBUG] Player error message:', player.error?.message);
            
            // Check if this is a streamed song with proxy ID
            if (player.currentProxyId && player.currentFilename && player.currentFilename.startsWith('stream_')) {
                console.log('[DEBUG] Stream error detected, attempting to refresh URL...');
                
                try {
                    // Try to find the video_id from current queue data
                    const videoId = await findVideoIdForStream(player.currentFilename);
                    if (videoId) {
                        console.log('[DEBUG] Found video ID:', videoId, 'attempting refresh...');
                        
                        const response = await fetch('/refresh_stream_url', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                                video_id: videoId
                            })
                        });
                        
                        const result = await response.json();
                        if (result.success) {
                            console.log('[DEBUG] Successfully refreshed URL, new proxy ID:', result.proxy_id);
                            
                            // Update the player source with new proxy ID
                            player.currentProxyId = result.proxy_id;
                            player.src = `/stream_proxy/${result.proxy_id}`;
                            player.load();
                            
                            // Update queue data with new proxy ID
                            await updateQueueProxyId(player.currentFilename, result.proxy_id);
                            
                            console.log('[DEBUG] Stream URL refreshed successfully');
                        } else {
                            console.error('[ERROR] Failed to refresh stream URL:', result.error);
                        }
                    } else {
                        console.error('[ERROR] Could not find video ID for stream refresh');
                    }
                } catch (err) {
                    console.error('[ERROR] Error refreshing stream URL:', err);
                }
            }
        });
        
        console.log('[SUCCESS] Custom player initialization completed successfully!');
    }

    // Helper function to find video_id for a stream filename from queue data
    async function findVideoIdForStream(streamFilename) {
        try {
            // Check if we have current queue data in memory
            if (window.currentQueueData && window.currentQueueData.queue) {
                const item = window.currentQueueData.queue.find(q => q.filename === streamFilename);
                if (item && item.video_id) {
                    return item.video_id;
                }
            }
            
            console.log('[DEBUG] Video ID not found in queue data for:', streamFilename);
            return null;
        } catch (err) {
            console.error('[ERROR] Error finding video ID:', err);
            return null;
        }
    }

    // Helper function to update proxy ID in queue data
    async function updateQueueProxyId(streamFilename, newProxyId) {
        try {
            // Update in-memory queue data
            if (window.currentQueueData && window.currentQueueData.queue) {
                const item = window.currentQueueData.queue.find(q => q.filename === streamFilename);
                if (item) {
                    item.proxy_id = newProxyId;
                    console.log('[DEBUG] Updated queue item proxy_id for:', streamFilename);
                    
                    // Emit queue update to keep other clients in sync
                    if (socket && socket.connected) {
                        socket.emit('queue_update', {
                            queue: window.currentQueueData.queue,
                            current_index: window.currentQueueData.current_index
                        });
                    }
                }
            }
        } catch (err) {
            console.error('[ERROR] Error updating queue proxy ID:', err);
        }
    }

    // Initialize the custom player with a slight delay to ensure DOM is fully ready
    setTimeout(() => {
        console.log('[DEBUG] Attempting to initialize custom player...');
        console.log('[DEBUG] Current page URL:', window.location.href);
        console.log('[DEBUG] Current page title:', document.title);
        console.log('[DEBUG] Body dataset roomId:', document.body.dataset.roomId);
        console.log('[DEBUG] Custom player container exists:', !!document.querySelector('.custom-player'));
        console.log('[DEBUG] Audio player element exists:', !!document.getElementById('player'));
        console.log('[DEBUG] File name display exists:', !!document.getElementById('file-name'));
        console.log('[DEBUG] Upload button exists:', !!document.getElementById('upload-btn'));
        console.log('[DEBUG] All custom player elements in DOM:', {
            customPlayerContainer: !!document.querySelector('.custom-player'),
            playPauseBtn: !!document.getElementById('play-pause-btn'),
            playPauseIcon: !!document.getElementById('play-pause-icon'),
            volumeBtn: !!document.getElementById('volume-btn'),
            volumeIcon: !!document.getElementById('volume-icon'),
            volumePopup: !!document.getElementById('volume-popup'),
            volumeSliderVertical: !!document.querySelector('.volume-slider-vertical'),
            volumeFillVertical: !!document.getElementById('volume-fill-vertical'),
            volumeHandleVertical: !!document.getElementById('volume-handle-vertical'),
            progressBar: !!document.querySelector('.progress-bar'),
            progressFill: !!document.getElementById('progress-fill'),
            progressHandle: !!document.getElementById('progress-handle'),
            currentTimeDisplay: !!document.getElementById('current-time'),
            totalTimeDisplay: !!document.getElementById('total-time')
        });
        
        // Check if we're on the right page
        if (!document.body.dataset.roomId) {
            console.error('[ERROR] No room ID found in body dataset - you might be on the wrong page!');
            console.log('[DEBUG] Make sure you are accessing /room/[room_id] and not just the home page');
            return;
        }
        
        if (!document.querySelector('.custom-player')) {
            console.error('[ERROR] Custom player container not found - the page template might not be loading correctly');
            console.log('[DEBUG] Expected elements for custom player are missing from the DOM');
            console.log('[DEBUG] Attempting to create custom player HTML dynamically...');
            
            // Create the custom player HTML dynamically
            const customPlayerHTML = `
                <div class="custom-player">
                    <!-- Time display row -->
                    <div class="player-time-display">
                        <span id="current-time">0:00</span>
                        <span id="total-time">0:00</span>
                    </div>
                    
                    <!-- Main playback controls row -->
                    <div class="main-player-row">
                        <button class="control-button player-btn" id="play-pause-btn">
                            <i class="fas fa-play" id="play-pause-icon"></i>
                        </button>
                        
                        <div class="progress-bar-container">
                            <div class="progress-bar">
                                <div class="progress-fill" id="progress-fill"></div>
                                <div class="progress-handle" id="progress-handle"></div>
                            </div>
                        </div>
                        
                        <div class="volume-control">
                            <button class="control-button volume-btn" id="volume-btn">
                                <i class="fas fa-volume-up" id="volume-icon"></i>
                            </button>
                            <div class="volume-popup" id="volume-popup">
                                <div class="volume-slider-vertical">
                                    <div class="volume-fill-vertical" id="volume-fill-vertical"></div>
                                    <div class="volume-handle-vertical" id="volume-handle-vertical"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            
            // Find a suitable place to insert the custom player (after the audio element)
            const audioElement = document.getElementById('player');
            if (audioElement) {
                audioElement.insertAdjacentHTML('afterend', customPlayerHTML);
                console.log('[DEBUG] Custom player HTML created dynamically');
                
                // Wait a moment for DOM to update, then try to initialize
                setTimeout(() => {
                    console.log('[DEBUG] Retrying initialization after dynamic creation...');
                    initCustomPlayer();
                }, 200);
            } else {
                console.error('[ERROR] Cannot create custom player - audio element not found');
            }
            return;
        }
        
    initCustomPlayer();
    // Update cover-based CSS variables after layout is stable
    setTimeout(updateCoverPositionVars, 50);
    }, 100);

    // Close volume popup when clicking outside
    document.addEventListener('click', (e) => {
        const volumePopup = document.querySelector('.volume-popup');
        const volumeBtn = document.querySelector('.volume-btn');
        
        if (volumePopup && volumeBtn && 
            !volumePopup.contains(e.target) && 
            !volumeBtn.contains(e.target) &&
            volumePopup.classList.contains('show')) {
            hideVolumePopup();
        }
    });

    // Keep bar alignment updated on viewport and fullscreen changes
    window.addEventListener('resize', updateCoverPositionVars);
    window.addEventListener('orientationchange', updateCoverPositionVars);
    document.addEventListener('fullscreenchange', updateCoverPositionVars);
    // Observe body class changes (fullscreen-mode toggled via class)
    const classObserver = new MutationObserver((mutations) => {
        for (const m of mutations) {
            if (m.type === 'attributes' && m.attributeName === 'class') {
                updateCoverPositionVars();
                break;
            }
        }
    });
    classObserver.observe(document.body, { attributes: true });

    // Observe size changes of cover section and cover image/placeholder
    if ('ResizeObserver' in window) {
        const ro = new ResizeObserver(() => {
            updateCoverPositionVars();
        });
        const coverSectionEl = document.querySelector('.cover-section');
        if (coverSectionEl) ro.observe(coverSectionEl);
        if (coverArt) ro.observe(coverArt);
        if (coverArtPlaceholder) ro.observe(coverArtPlaceholder);
    }

    // =================================================================================
    // User Action Event Listeners
    // =================================================================================

    if (uploadBtn && audioInput) {
        console.log('[DEBUG] Upload button and audio input found, setting up event listeners');
        uploadBtn.addEventListener('click', () => {
            console.log('[DEBUG] Upload button clicked');
            console.log('[DEBUG] Audio input element:', audioInput);
            console.log('[DEBUG] Audio input disabled:', audioInput.disabled);
            console.log('[DEBUG] Audio input style display:', audioInput.style.display);
            audioInput.click();
            console.log('[DEBUG] Audio input click() called');
        });

        audioInput.addEventListener('change', () => {
            console.log('[DEBUG] File input changed');
            const file = audioInput.files[0];
            if (!file) {
                console.log('[DEBUG] No file selected');
                return;
            }

            console.log('[DEBUG] File selected:', file.name, 'Size:', file.size, 'Type:', file.type);
            
            // Add uploading class to prevent animation and enable proper truncation
            fileNameDisplay.classList.add('uploading');
            
            // Truncate filename for display during upload to prevent overflow
            const truncatedName = truncateFilename(file.name, 35); // Shorter limit for "Uploading: " prefix
            songTitleElement.textContent = `Uploading: ${truncatedName}`;
            songArtistElement.textContent = "";
            
            const formData = new FormData();
            formData.append('audio', file);
            formData.append('room', roomId);

            console.log('[DEBUG] Starting upload request to /upload');
            fetch('/upload', { method: 'POST', body: formData })
                .then(response => {
                    console.log('[DEBUG] Upload response status:', response.status);
                    return response.json();
                })
                .then(data => {
                    console.log('[DEBUG] Upload response data:', data);
                    // Remove uploading class when upload completes
                    fileNameDisplay.classList.remove('uploading');
                    
                    if (data.success) {
                        console.log('Upload successful. Waiting for new_file event.');
                    } else {
                        console.error('Upload failed:', data.error);
                        alert(data.error || 'Upload failed.');
                        songTitleElement.textContent = 'Upload failed.';
                        songArtistElement.textContent = "";
                    }
                }).catch(error => {
                    console.error('Upload fetch error:', error);
                    // Remove uploading class on error
                    fileNameDisplay.classList.remove('uploading');
                    alert('An unexpected error occurred during upload.');
                    songTitleElement.textContent = 'Upload error.';
                    songArtistElement.textContent = "";
                });
        });
    } else {
        console.error('[ERROR] Upload button or audio input not found!');
        console.log('[DEBUG] uploadBtn:', uploadBtn);
        console.log('[DEBUG] audioInput:', audioInput);
    }

    if (syncBtn) {
        syncBtn.addEventListener('click', () => {
            if (!player.src || player.src.endsWith('/null')) return;
            console.log('--- User initiated manual sync ---');
            socket.emit('sync', { room: roomId, time: player.currentTime });
        });
    }

    // Queue button event listener
    if (queueBtn) {
        queueBtn.addEventListener('click', () => {
            if (queueModal) {
                queueModal.style.display = 'flex';
                updateQueueDisplay();
            }
        });
    }

    // Close queue modal
    if (closeQueueBtn) {
        closeQueueBtn.addEventListener('click', () => {
            if (queueModal) {
                queueModal.style.display = 'none';
            }
        });
    }

    // Close queue modal on backdrop click
    if (queueModal) {
        queueModal.addEventListener('click', (e) => {
            if (e.target === queueModal) {
                queueModal.style.display = 'none';
            }
        });
    }

    // Lyrics button event listener (opens modal)
    if (lyricsBtn) {
        lyricsBtn.addEventListener('click', () => {
            if (lyricsModal) {
                lyricsModal.style.display = 'flex';
                fetchAndDisplayLyrics();
            }
        });
    }

    // Lyrics toggle button event listener (toggles fullscreen lyrics)
    if (lyricsToggleBtn) {
        console.log('Lyrics toggle button found, adding click handler');
        let lastClickTime = 0;
        lyricsToggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const now = Date.now();
            if (now - lastClickTime < 500) {
                console.log('Click ignored due to debounce');
                return;
            }
            lastClickTime = now;
            console.log('Lyrics toggle button clicked');
            toggleFullscreenLyrics();
        });
    } else {
        console.log('Lyrics toggle button NOT found');
    }

    // Close lyrics modal
    if (closeLyricsBtn) {
        closeLyricsBtn.addEventListener('click', () => {
            if (lyricsModal) {
                lyricsModal.style.display = 'none';
                // Stop lyrics sync when modal is closed
                stopLyricsSync();
            }
        });
    }

    // Close lyrics modal on backdrop click
    if (lyricsModal) {
        lyricsModal.addEventListener('click', (e) => {
            if (e.target === lyricsModal) {
                lyricsModal.style.display = 'none';
                // Stop lyrics sync when modal is closed
                stopLyricsSync();
            }
        });
    }

    // Member count button event listener (opens modal)
    if (memberCount) {
        memberCount.addEventListener('click', () => {
            console.log('Member count button clicked!');
            
            // Disable member modal in fullscreen mode
            if (document.body.classList.contains('fullscreen-mode')) {
                console.log('Member modal disabled in fullscreen mode');
                return;
            }
            
            if (membersModal) {
                console.log('Opening members modal');
                membersModal.style.display = 'flex';
                fetchAndDisplayMembers();
            } else {
                console.error('Members modal not found');
            }
        });
    } else {
        console.error('Member count element not found');
    }

    // Close members modal
    if (closeMembersBtn) {
        closeMembersBtn.addEventListener('click', () => {
            if (membersModal) {
                membersModal.style.display = 'none';
            }
        });
    }

    // Close members modal on backdrop click
    if (membersModal) {
        membersModal.addEventListener('click', (e) => {
            if (e.target === membersModal) {
                membersModal.style.display = 'none';
            }
        });
    }

    // Next/Previous song buttons
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            nextSong();
        });
    }

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            previousSong();
        });
    }

    // Loop button
    if (loopBtn) {
        loopBtn.addEventListener('click', () => {
            toggleLoop();
        });
    }

    // Shuffle button
    if (shuffleBtn) {
        shuffleBtn.addEventListener('click', () => {
            toggleShuffle();
        });
    }

    player.addEventListener('play', () => {
        if (isReceivingUpdate) return;
        fileNameDisplay.classList.add('playing');
        // Force re-init and connection for visualizer
        initAudioContext();
        connectAudioSource();
        showCoverDancingBars();
        updateFileNameAnimation(); // Recalculate for playing state
        // Debug log to confirm visualizer start
        console.log('Play event: visualizer should start, bars should animate.');
        // Start lyrics synchronization
        if (parsedLyrics.length > 0) {
            startLyricsSync();
        }
        socket.emit('play', { room: roomId, time: player.currentTime });
    });

    player.addEventListener('pause', () => {
        if (isReceivingUpdate || player.seeking) return;
        player.playbackRate = 1.0;
        fileNameDisplay.classList.remove('playing');
        hideCoverDancingBars();
        updateFileNameAnimation(); // Recalculate for paused state
        updateThemeForPlayingState();
        // Stop lyrics synchronization
        stopLyricsSync();
        // Ensure fullscreen contrast is maintained after pause
        if (document.body.classList.contains('fullscreen-mode')) {
            setTimeout(() => {
                ensureFullscreenContrast();
            }, 100);
        }
        socket.emit('pause', { room: roomId });
    });

    player.addEventListener('ended', () => {
        console.log('Song ended, checking for synchronized loop and shuffle modes...');
        
        // If loop mode is enabled, restart the current song for all devices
        if (isLooping) {
            console.log('Loop mode enabled, triggering restart for all devices');
            // Emit loop restart event to synchronize all devices
            socket.emit('loop_restart', { room: roomId });
            
            // Also restart locally
            player.currentTime = 0;
            player.play();
            return;
        }
        
        console.log('Loop mode disabled, checking shuffle and queue...');
        fileNameDisplay.classList.remove('playing');
        hideCoverDancingBars();
        updateFileNameAnimation(); // Recalculate for paused state
        
        // Automatically play next song if there are multiple songs in queue
        if (currentQueue.length > 1) {
            if (isShuffling) {
                console.log('Shuffle mode enabled, playing random next song');
                lastChangeDirection = 'next'; // Set direction for animation
                triggerSlideAnimation('next');
                socket.emit('shuffle_next', { room: roomId, auto_play: true });
            } else {
                console.log('Normal mode, auto-playing next song from queue');
                lastChangeDirection = 'next'; // Set direction for animation
                triggerSlideAnimation('next');
                socket.emit('next_song', { room: roomId, auto_play: true });
            }
        } else {
            console.log('No more songs in queue, staying on current song');
        }
    });

    player.addEventListener('seeking', () => {
        // Pause visualizer during seeking to prevent conflicts
        if (animationId) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }
    });

    player.addEventListener('seeked', () => {
        if (isReceivingUpdate) return;

        ensureAudioConnection();

        // Use the dedicated function to correctly start the animation loop
        if (!player.paused) {
            startVisualizer();
        }

        // Update lyrics highlight after seeking
        if (parsedLyrics.length > 0) {
            updateLyricsHighlight();
        }

        socket.emit('seek', { room: roomId, time: player.currentTime });

        userHasJustSeeked = true;
        clearTimeout(seekDebounceTimer);
        seekDebounceTimer = setTimeout(() => {
            userHasJustSeeked = false;
        }, 500);
    });

    player.addEventListener('timeupdate', () => {
        // If visualizer is off but audio is playing, restart it
        if (!animationId && !player.paused && !userHasJustSeeked) {
            console.log('[Fallback] Restarting visualizer on timeupdate');
            // Use startVisualizer to correctly begin the animation loop, not just a single frame.
            startVisualizer();
        }
    });

    // Initialize audio context on first user interaction
    function enableAudioContext() {
        initAudioContext();
        document.removeEventListener('click', enableAudioContext);
        document.removeEventListener('keydown', enableAudioContext);
    }
    document.addEventListener('click', enableAudioContext);
    document.addEventListener('keydown', enableAudioContext);

    // =================================================================================
    // Device Detection Functions
    // =================================================================================

    function getDeviceInfo() {
        const userAgent = navigator.userAgent;
        
        // Detect browser
        let browser = 'Unknown Browser';
        if (userAgent.includes('Chrome') && !userAgent.includes('Edg')) {
            browser = 'Chrome';
        } else if (userAgent.includes('Firefox')) {
            browser = 'Firefox';
        } else if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) {
            browser = 'Safari';
        } else if (userAgent.includes('Edg')) {
            browser = 'Edge';
        } else if (userAgent.includes('Opera') || userAgent.includes('OPR')) {
            browser = 'Opera';
        }
        
        // Detect OS
        let os = 'Unknown OS';
        if (userAgent.includes('Windows')) {
            os = 'Windows';
        } else if (userAgent.includes('Mac OS')) {
            os = 'macOS';
        } else if (userAgent.includes('Android')) {
            os = 'Android';
        } else if (userAgent.includes('Linux')) {
            os = 'Linux';
        } else if (userAgent.includes('iPhone') || userAgent.includes('iPad')) {
            os = 'iOS';
        }
        
        // Detect device type
        let deviceType = 'Desktop';
        if (userAgent.includes('Mobile') || userAgent.includes('Android')) {
            deviceType = 'Mobile';
        } else if (userAgent.includes('iPad') || userAgent.includes('Tablet')) {
            deviceType = 'Tablet';
        }
        
        return {
            browser,
            os,
            deviceType,
            userAgent: userAgent.substring(0, 100) // Truncate for storage
        };
    }

    // =================================================================================
    // Socket.IO Event Handlers (Commands from Server)
    // =================================================================================

    socket.on('connect', () => {
        console.log('Connected! Joining room:', roomId);
        
        // Get device information
        const deviceInfo = getDeviceInfo();
        console.log('Device info:', deviceInfo);
        
        // Send join request with device information
        socket.emit('join', { 
            room: roomId,
            deviceInfo: deviceInfo
        });
        
        syncClock();
        if (pingInterval) clearInterval(pingInterval);
        pingInterval = setInterval(syncClock, 15000);
        
        // Initialize queue display
        updateQueueCount();
        updateNextPrevButtons();
    });

    socket.on('scheduled_play', (data) => {
        isReceivingUpdate = true;
        const targetTimestamp = (data.target_timestamp * 1000) + serverTimeOffset;
        const delay = targetTimestamp - Date.now();
        player.currentTime = data.audio_time;
        
        fileNameDisplay.classList.add('playing');
        showCoverDancingBars();
        updateFileNameAnimation(); // Recalculate layout for playing state
        updateThemeForPlayingState();
    updateCoverPositionVars();
        
        if (delay > 0) {
            setTimeout(() => player.play(), delay);
        } else {
            player.play();
        }
        
        setTimeout(() => { isReceivingUpdate = false; }, delay > 0 ? delay + 100 : 100);
    });

    socket.on('pause', (data) => {
        isReceivingUpdate = true;
        player.pause();
        player.playbackRate = 1.0;
        player.currentTime = data.time;
        fileNameDisplay.classList.remove('playing');
        hideCoverDancingBars();
        updateFileNameAnimation(); // Recalculate layout for paused state
        updateThemeForPlayingState();
        // Ensure fullscreen contrast is maintained after pause
        if (document.body.classList.contains('fullscreen-mode')) {
            setTimeout(() => {
                ensureFullscreenContrast();
            }, 200);
        }
        updateCoverPositionVars();
        setTimeout(() => { isReceivingUpdate = false; }, 150);
    });

    socket.on('new_file', (data) => {
        console.log('[DEBUG] Received new_file event with data:', data);
        console.log('[DEBUG] Filename type:', typeof data.filename);
        console.log('[DEBUG] Filename repr:', JSON.stringify(data.filename));
        console.log('[DEBUG] Display filename:', JSON.stringify(data.filename_display));
        console.log('[DEBUG] Display filename type:', typeof data.filename_display);
        console.log('[DEBUG] Display filename length:', data.filename_display ? data.filename_display.length : 'null');
        
        // Test Unicode preservation
        if (data.filename_display) {
            console.log('[DEBUG] Display filename character codes:', Array.from(data.filename_display).map(c => c.charCodeAt(0)));
            console.log('[DEBUG] Display filename contains Japanese chars:', /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(data.filename_display));
        }
        
        // Determine if this is actually a song change
        const isNewSong = currentSongFile && currentSongFile !== data.filename;

        // Song change: prepare slide if fullscreen; don't override existing direction
        if (isNewSong) {
            if (!lastChangeDirection) lastChangeDirection = 'next'; // fallback
            if (document.body.classList.contains('fullscreen-mode')) {
                triggerFullscreenColorSlide(lastChangeDirection);
            }
            // Clear fixed colors so new theme can apply
            const mh = document.querySelector('.main-heading');
            const rc = document.querySelector('.room-code-display');
            const fnt = document.querySelector('#file-name-text');
            if (mh) mh.removeAttribute('data-fixed-color');
            if (rc) {
                rc.removeAttribute('data-fixed-color');
                const span = rc.querySelector('span');
                if (span) span.removeAttribute('data-fixed-color');
            }
            if (fnt) fnt.removeAttribute('data-fixed-color');
        }

        // Track current song
        currentSongFile = data.filename;

        // Use display filename if available, otherwise fallback to filename
        const displayFilename = data.filename_display || data.filename;
        console.log('[DEBUG] Final display filename for loadAudio:', JSON.stringify(displayFilename));
        
        // Check if this is a streamed song
        const isStreamedSong = data.is_stream || data.proxy_id;
        loadAudio(data.filename, data.cover, displayFilename, data.title, data.artist, data.proxy_id, data.image_url);
        
        // Ensure fullscreen contrast after song change
        if (document.body.classList.contains('fullscreen-mode')) {
            setTimeout(() => {
                ensureFullscreenContrast();
            }, 500); // Longer delay to allow theme to apply first
        }
    });

    socket.on('room_state', (data) => {
        console.log('[DEBUG] Received room_state event with data:', data);
    if (data.current_file) {
            console.log('[DEBUG] Room state filename:', JSON.stringify(data.current_file));
            console.log('[DEBUG] Room state display filename:', JSON.stringify(data.current_file_display));
            console.log('[DEBUG] Room state filename type:', typeof data.current_file);
        }
        
        // Synchronize loop and shuffle states from room state
        if (data.hasOwnProperty('isLooping')) {
            console.log('[DEBUG] Synchronizing loop state from room:', data.isLooping);
            isLooping = data.isLooping;
            updateLoopButton();
        }
        
        if (data.hasOwnProperty('is_shuffling')) {
            console.log('[DEBUG] Synchronizing shuffle state from room:', data.is_shuffling);
            isShuffling = data.is_shuffling;
            updateShuffleButton();
        }
        
        if (data.current_file) {
            const isNewSong = currentSongFile && currentSongFile !== data.current_file;
            if (isNewSong) {
                // If queue_update already inferred direction, respect it; else fallback
                if (!lastChangeDirection) lastChangeDirection = 'next';
                if (document.body.classList.contains('fullscreen-mode')) {
                    triggerFullscreenColorSlide(lastChangeDirection);
                }
                // Clear fixed colors so new theme can apply
                const mainHeadingEl = document.querySelector('.main-heading');
                const roomCodeEl = document.querySelector('.room-code-display');
                const titleEl = document.querySelector('#song-title');
                const artistEl = document.querySelector('#song-artist');
                if (mainHeadingEl) mainHeadingEl.removeAttribute('data-fixed-color');
                if (roomCodeEl) {
                    roomCodeEl.removeAttribute('data-fixed-color');
                    const span = roomCodeEl.querySelector('span');
                    if (span) span.removeAttribute('data-fixed-color');
                }
                if (titleEl) titleEl.removeAttribute('data-fixed-color');
                if (artistEl) artistEl.removeAttribute('data-fixed-color');
            }
            
            // Update current song tracker
            currentSongFile = data.current_file;
            
            // Use display filename if available, otherwise fallback to filename
            const displayFilename = data.current_file_display || data.current_file;
            loadAudio(data.current_file, data.current_cover, displayFilename, data.current_title, data.current_artist);
            let intendedTime = data.last_progress_s;
            if (data.is_playing) {
                const timeSinceUpdate = (Date.now() + serverTimeOffset) / 1000 - data.last_updated_at;
                intendedTime += timeSinceUpdate;
                const delay = 500; // Join buffer
                isReceivingUpdate = true;
                player.currentTime = intendedTime;
                
                fileNameDisplay.classList.add('playing');
                showCoverDancingBars();
                updateFileNameAnimation(); // Recalculate layout for playing state
                updateThemeForPlayingState();
                updateCoverPositionVars();
                
                setTimeout(() => player.play(), delay);
                setTimeout(() => { isReceivingUpdate = false; }, delay + 100);
            } else {
                player.currentTime = intendedTime;
                player.pause();
                hideCoverDancingBars();
                updateFileNameAnimation(); // Recalculate layout for paused state
                updateCoverPositionVars();
            }

            // If fullscreen and we set up a slide, trigger the slide-in once colors are ready
            if (document.body.classList.contains('fullscreen-mode') && lastChangeDirection) {
                // triggerFullscreenColorSlideIn will pick up direction after cover loads colors
                setTimeout(() => {
                    triggerFullscreenColorSlideIn(lastChangeDirection);
                    lastChangeDirection = null; // reset after triggering
                }, 100); // slight delay to allow loadAudio to start image load
            }
            
            // Ensure fullscreen contrast after room state change
            if (document.body.classList.contains('fullscreen-mode')) {
                setTimeout(() => {
                    ensureFullscreenContrast();
                }, 600); // Longer delay to allow all theme changes to complete
            }
        }
    });

    socket.on('member_count_update', (data) => {
        updateMemberCount(data.count);
    });

    socket.on('queue_update', (data) => {
        console.log('[DEBUG] Received queue_update:', data);
        console.log('[DEBUG] Previous queue length:', currentQueue.length, 'New queue length:', data.queue ? data.queue.length : 0);
        console.log('[DEBUG] Is uploading:', fileNameDisplay.classList.contains('uploading'));
        
        // Store queue data globally for URL refresh functionality
        window.currentQueueData = {
            queue: data.queue || [],
            current_index: typeof data.current_index === 'number' ? data.current_index : parseInt(data.current_index, 10)
        };
        if (isNaN(window.currentQueueData.current_index)) {
            window.currentQueueData.current_index = -1;
        }
        
        const prevQueueLength = currentQueue.length;
        lastQueueIndex = currentQueueIndex;
        currentQueue = data.queue || [];
	currentQueueIndex = typeof data.current_index === 'number' ? data.current_index : parseInt(data.current_index, 10);
	if (isNaN(currentQueueIndex)) currentQueueIndex = -1;

        // Handle empty queue - stop playback and clear current song
        if (currentQueue.length === 0) {
            player.pause();
            player.src = '';
            player.load();
            songTitleElement.textContent = "No file selected";
            songArtistElement.textContent = "";
            fileNameDisplay.classList.remove('playing');
            hideCoverDancingBars();
            
            // Hide both cover art and placeholder when no file is selected
            coverArt.style.display = 'none';
            coverArt.src = '';
            if (coverArtPlaceholder) {
                coverArtPlaceholder.style.display = 'none';
                coverArtPlaceholder.classList.remove('visible');
            }
            
            // Hide fullscreen button if no audio
            const fullscreenBtn = document.querySelector('.fullscreen-btn');
            if (fullscreenBtn) fullscreenBtn.style.setProperty('display', 'none', 'important');
            
            // Reset file input to allow re-uploading same file
            if (audioInput) {
                audioInput.value = '';
                console.log('[DEBUG] Reset audio input value for re-upload');
            }
            
            // Reset theme
            resetTheme();
            updateFileNameAnimation();
            updateCoverPositionVars();
            currentSongFile = null;
            currentDominantColor = null;
            currentColorPalette = null;
        }

        // Infer direction on queue index change (remote)
        if (lastQueueIndex !== -1 && currentQueueIndex !== -1 && lastQueueIndex !== currentQueueIndex) {
            const qLen = currentQueue.length;
            if (qLen > 1) {
                const oldIdx = lastQueueIndex;
                const newIdx = currentQueueIndex;
                const nextIdx = (oldIdx + 1) % qLen;
                const prevIdx = (oldIdx - 1 + qLen) % qLen;
                let inferred;
                if (newIdx === nextIdx) {
                    inferred = 'next';
                } else if (newIdx === prevIdx) {
                    inferred = 'prev';
                } else {
                    const forward = (newIdx - oldIdx + qLen) % qLen;
                    const backward = (oldIdx - newIdx + qLen) % qLen;
                    if (forward === backward) {
                        inferred = manualDirection || (newIdx > oldIdx ? 'next' : 'prev');
                    } else {
                        inferred = backward < forward ? 'prev' : 'next';
                    }
                }
                lastChangeDirection = manualDirection || inferred;
                console.log('[DIR] queue_update oldIdx:', oldIdx, 'newIdx:', newIdx, 'qLen:', qLen, 'inferred:', inferred, 'manualDirection:', manualDirection, 'used:', lastChangeDirection);
            }
        }
        updateQueueDisplay();
        updateQueueCount();
        updateNextPrevButtons();

        // If uploading, and queue length increased, show current playing filename
        if (fileNameDisplay.classList.contains('uploading') && currentQueue.length > prevQueueLength) {
            fileNameDisplay.classList.remove('uploading');
            // Show the filename of the current song (first in queue or current index)
            let item = currentQueue[currentQueueIndex];
            if (!item && currentQueue.length > 0) item = currentQueue[0];
            if (item) {
                const title = item.title || (item.filename_display || item.filename).replace(/_/g, ' ').replace(/\.(mp3|wav|ogg|flac|m4a)$/i, '');
                const artist = item.artist;
                songTitleElement.textContent = title;
                songTitleElement.title = title;
                if (artist) {
                    songArtistElement.textContent = artist;
                    songArtistElement.title = artist;
                    songArtistElement.style.display = 'block';
                } else {
                    songArtistElement.textContent = "";
                    songArtistElement.style.display = 'none';
                }
            }
        }
        
        // Handle case where queue was empty and now has content (e.g., after re-upload)
        if (fileNameDisplay.classList.contains('uploading') && prevQueueLength === 0 && currentQueue.length > 0) {
            fileNameDisplay.classList.remove('uploading');
            // Show the first song in the newly populated queue
            let item = currentQueue[0];
            if (item) {
                const title = item.title || (item.filename_display || item.filename).replace(/_/g, ' ').replace(/\.(mp3|wav|ogg|flac|m4a)$/i, '');
                const artist = item.artist;
                songTitleElement.textContent = title;
                songTitleElement.title = title;
                if (artist) {
                    songArtistElement.textContent = artist;
                    songArtistElement.title = artist;
                    songArtistElement.style.display = 'block';
                } else {
                    songArtistElement.textContent = "";
                    songArtistElement.style.display = 'none';
                }
            }
        }
    });
    socket.on('error', (data) => {
        alert(data.message);
        window.location.href = '/';
    });

    // Synchronize loop state across all devices
    socket.on('loop_state_update', (data) => {
        console.log('Received loop state update:', data.isLooping);
        isLooping = data.isLooping;
        updateLoopButton();
    });

    // Handle loop-triggered playback from other devices
    socket.on('loop_restart', (data) => {
        console.log('Loop restart triggered by another device');
        isReceivingUpdate = true;
        player.currentTime = 0;
        
        fileNameDisplay.classList.add('playing');
        showCoverDancingBars();
        updateFileNameAnimation();
        updateThemeForPlayingState();
    updateCoverPositionVars();
        
        // Start playback immediately since it's a loop restart
        player.play();
        setTimeout(() => { isReceivingUpdate = false; }, 100);
    });

    // Synchronize shuffle state across all devices
    socket.on('shuffle_state_update', (data) => {
        console.log('Received shuffle state update:', data.isShuffling);
        isShuffling = data.isShuffling;
        updateShuffleButton();
    });

    // =================================================================================
    // UI & Theme Helper Functions
    // =================================================================================
    
    function truncateFilename(filename, maxLength = 40) {
        if (!filename || filename.length <= maxLength) {
            return filename;
        }
        
        // Reserve space for "..." (3 characters)
        const availableLength = maxLength - 3;
        const frontLength = Math.ceil(availableLength / 2);
        const backLength = Math.floor(availableLength / 2);
        
        return filename.substring(0, frontLength) + '...' + filename.substring(filename.length - backLength);
    }
    
    function setup3DTiltEffect(element) {
        if (!element) return;
        
        // Add mousemove event for 3D tilt effect
        element.addEventListener('mousemove', (e) => {
            const rect = element.getBoundingClientRect();
            
            // Calculate mouse position relative to the element's center
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const centerX = element.offsetWidth / 2;
            const centerY = element.offsetHeight / 2;
            
            // Calculate tilt intensity based on element size and fullscreen mode
            const isFullscreen = document.body.classList.contains('fullscreen-mode');
            const elementSize = Math.min(element.offsetWidth, element.offsetHeight);
            
            // Base divisor for tilt calculation
            let tiltDivisor;
            if (isFullscreen) {
                // In fullscreen, use higher divisor for subtler effect on larger elements
                tiltDivisor = Math.max(30, elementSize / 11); // More subtle for larger elements
            } else {
                // Normal mode - standard tilt
                tiltDivisor = 20;
            }
            
            // Calculate rotation based on cursor position to make it tilt away
            const rotateX = (centerY - y) / tiltDivisor; // Responsive tilt
            const rotateY = (x - centerX) / tiltDivisor;
            
            // Apply only the 3D rotation
            element.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
        });
        
        // Reset the element's transformation when the mouse leaves
        element.addEventListener('mouseleave', () => {
            element.style.transform = 'rotateX(0) rotateY(0)';
        });
    }
    
    function loadAudio(filename, cover, displayFilename = null, title = null, artist = null, proxyId = null, imageUrl = null) {
        console.log('[DEBUG] loadAudio called with filename:', JSON.stringify(filename));
        console.log('[DEBUG] loadAudio called with displayFilename:', JSON.stringify(displayFilename));
        console.log('[DEBUG] loadAudio called with title:', JSON.stringify(title));
        console.log('[DEBUG] loadAudio called with artist:', JSON.stringify(artist));
        
        // Reset lyrics state when loading new audio
        stopLyricsSync();
        parsedLyrics = [];
        currentLyricsIndex = -1;
        
        // Hide fullscreen lyrics when loading new song
        if (isFullscreenLyricsVisible) {
            hideFullscreenLyrics();
        }
        
        // Set current song key for lyrics caching
        currentSongKey = generateSongKey(filename, title, artist);
        
        if (!filename) {
            songTitleElement.textContent = "No file selected";
            songArtistElement.textContent = "";
            // Hide both cover art and placeholder when no file is selected
            coverArt.style.display = 'none';
            coverArt.src = '';
            if (coverArtPlaceholder) {
                coverArtPlaceholder.style.display = 'none';
                coverArtPlaceholder.classList.remove('visible');
            }
            updateFileNameAnimation();
            updateCoverPositionVars();
            // Hide fullscreen button if no audio
            if (fullscreenBtn) fullscreenBtn.style.setProperty('display', 'none', 'important');
            return;
        }
        
        // Determine what to display for the title
        let displayTitle = title || (displayFilename || filename);
        
        // Clean up the display title if it's from filename
        if (!title) {
            displayTitle = displayTitle
                .replace(/_/g, " ")
                .replace(/\.(mp3|wav|ogg|flac|m4a)$/i, "");
        }
        
        console.log('[DEBUG] Final display title:', JSON.stringify(displayTitle));
        console.log('[DEBUG] Final display artist:', JSON.stringify(artist));
        
        // Set the song info
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
        
        // Set document title
        const docTitle = title && artist ? `${title} - ${artist}` : displayTitle;
        if (fileNameDisplay.classList.contains('playing')) {
            document.title = docTitle || "AudioFlow";
        } else {
            document.title = "AudioFlow";
        }
        // Always clear fixed colors before applying new theme
        const mainHeadingEl = document.querySelector('.main-heading');
        const roomCodeEl = document.querySelector('.room-code-display');
        if (mainHeadingEl) mainHeadingEl.removeAttribute('data-fixed-color');
        if (roomCodeEl) {
            roomCodeEl.removeAttribute('data-fixed-color');
            const span = roomCodeEl.querySelector('span');
            if (span) span.removeAttribute('data-fixed-color');
        }
        if (songTitleElement) songTitleElement.removeAttribute('data-fixed-color');
        if (songArtistElement) songArtistElement.removeAttribute('data-fixed-color');
        
        // Set player source based on whether it's a streamed song or uploaded file
        if (proxyId) {
            // Streamed song - use proxy endpoint
            player.src = `/stream_proxy/${proxyId}`;
            console.log('[DEBUG] Loading streamed audio with proxy ID:', proxyId);
            
            // Store current stream info for potential refresh
            player.currentProxyId = proxyId;
            player.currentFilename = filename;
            player.currentDisplayFilename = displayFilename;
            player.currentTitle = title;
            player.currentArtist = artist;
            player.currentImageUrl = imageUrl;
        } else {
            // Uploaded file - use uploads endpoint
            player.src = `/uploads/${encodeURIComponent(filename)}`;
            console.log('[DEBUG] Loading uploaded audio file:', filename);
            
            // Clear stream info for uploaded files
            delete player.currentProxyId;
            delete player.currentFilename;
            delete player.currentDisplayFilename;
            delete player.currentTitle;
            delete player.currentArtist;
            delete player.currentImageUrl;
        }
        
        player.load();
        fileNameDisplay.classList.remove('playing');
        coverArt.style.boxShadow = 'none';
        hideCoverDancingBars();
        resetTheme();
        hideCoverDancingBars();
        resetTheme();
    updateFileNameAnimation();
    updateCoverPositionVars();
        // Show fullscreen button when audio is loaded
        if (fullscreenBtn) fullscreenBtn.style.setProperty('display', 'flex', 'important');
        
        if (cover) {
            // Hide placeholder and show real cover art
            if (coverArtPlaceholder) {
                coverArtPlaceholder.classList.remove('visible');
                coverArtPlaceholder.style.display = 'none';
            }
            
            coverArt.src = `/uploads/${cover}`;
            coverArt.style.display = 'block';
            coverArt.onload = () => {
                try {
                    const dominantColor = colorThief.getColor(coverArt);
                    const palette = colorThief.getPalette(coverArt, 3); // Get top 3 colors
                    currentDominantColor = dominantColor;
                    currentColorPalette = palette;
                    const [r, g, b] = dominantColor;
                    coverArt.style.boxShadow = `0 0 15px rgba(${r},${g},${b},0.6), 0 0 35px rgba(${r},${g},${b},0.4)`;
                    applyTheme(dominantColor, palette);
                    updateCoverPositionVars();
                    
                    // Ensure text contrast in fullscreen mode
                    setTimeout(() => {
                        ensureFullscreenContrast();
                    }, 100);
                    
                    // Setup 3D tilt effect for cover art
                    setup3DTiltEffect(coverArt);
                    
                    // Trigger slide-in animation if this is from a song change
                    if (lastChangeDirection) {
                        triggerSlideInAnimation(lastChangeDirection);
                        lastChangeDirection = null; // Reset after use
                    }
                } catch (e) {
                    resetTheme();
                    // Still setup tilt effect even if color extraction fails
                    setup3DTiltEffect(coverArt);
                    
                    // Trigger slide-in animation if this is from a song change
                    if (lastChangeDirection) {
                        triggerSlideInAnimation(lastChangeDirection);
                        lastChangeDirection = null; // Reset after use
                    }
                }
            };
            coverArt.onerror = () => {
                // If cover art fails to load, show placeholder instead
                coverArt.style.display = 'none';
                if (coverArtPlaceholder) {
                    coverArtPlaceholder.style.display = 'block';
                    coverArtPlaceholder.classList.add('visible');
                    // Setup 3D tilt effect for placeholder
                    setup3DTiltEffect(coverArtPlaceholder);
                }
                resetTheme();
                updateCoverPositionVars();
                
                // Trigger slide-in animation if this is from a song change
                if (lastChangeDirection) {
                    triggerSlideInAnimation(lastChangeDirection);
                    lastChangeDirection = null; // Reset after use
                }
            };
        } else {
            // Check if we have a remote image URL for streamed songs
            if (imageUrl) {
                // Hide placeholder and show remote cover art
                if (coverArtPlaceholder) {
                    coverArtPlaceholder.classList.remove('visible');
                    coverArtPlaceholder.style.display = 'none';
                }
                
                // Remote streamed song cover
                coverArt.src = imageUrl;
                coverArt.style.display = 'block';
                coverArt.onload = () => {
                    try {
                        const dominantColor = colorThief.getColor(coverArt);
                        const palette = colorThief.getPalette(coverArt, 3); // Get top 3 colors
                        currentDominantColor = dominantColor;
                        currentColorPalette = palette;
                        const [r, g, b] = dominantColor;
                        coverArt.style.boxShadow = `0 0 15px rgba(${r},${g},${b},0.6), 0 0 35px rgba(${r},${g},${b},0.4)`;
                        applyTheme(dominantColor, palette);
                        updateCoverPositionVars();
                        
                        // Ensure text contrast in fullscreen mode
                        setTimeout(() => {
                            ensureFullscreenContrast();
                        }, 100);
                        
                        // Setup 3D tilt effect for cover art
                        setup3DTiltEffect(coverArt);
                        
                        // Trigger slide-in animation if this is from a song change
                        if (lastChangeDirection) {
                            triggerSlideInAnimation(lastChangeDirection);
                            lastChangeDirection = null; // Reset after use
                        }
                    } catch (e) {
                        console.error('Failed to extract color from remote cover:', e);
                        resetTheme();
                        // Still setup tilt effect even if color extraction fails
                        setup3DTiltEffect(coverArt);
                        
                        // Trigger slide-in animation if this is from a song change
                        if (lastChangeDirection) {
                            triggerSlideInAnimation(lastChangeDirection);
                            lastChangeDirection = null; // Reset after use
                        }
                    }
                };
                coverArt.onerror = () => {
                    console.warn('Remote cover art failed to load, showing placeholder');
                    // Show placeholder when remote image fails
                    coverArt.style.display = 'none';
                    if (coverArtPlaceholder) {
                        coverArtPlaceholder.style.display = 'block';
                        coverArtPlaceholder.classList.add('visible');
                        // Setup 3D tilt effect for placeholder
                        setup3DTiltEffect(coverArtPlaceholder);
                    }
                    resetTheme();
                    updateCoverPositionVars();
                    
                    // Trigger slide-in animation if this is from a song change
                    if (lastChangeDirection) {
                        triggerSlideInAnimation(lastChangeDirection);
                        lastChangeDirection = null; // Reset after use
                    }
                };
            } else {
                // No cover art available, show placeholder
                coverArt.src = '';
                coverArt.style.display = 'none';
                if (coverArtPlaceholder) {
                    coverArtPlaceholder.style.display = 'block';
                    coverArtPlaceholder.classList.add('visible');
                    // Setup 3D tilt effect for placeholder
                    setup3DTiltEffect(coverArtPlaceholder);
                }
                currentDominantColor = null;
                currentColorPalette = null;
                resetTheme();
                updateCoverPositionVars();
                
                // Trigger slide-in animation if this is from a song change
                if (lastChangeDirection) {
                    triggerSlideInAnimation(lastChangeDirection);
                    lastChangeDirection = null; // Reset after use
                }
            }
        }
    }

    function showCoverDancingBars() {
        console.log('showCoverDancingBars called');
        if (coverDancingBarsLeft) {
            coverDancingBarsLeft.classList.add('visible');
            console.log('Left bars made visible');
        } else {
            console.log('ERROR: coverDancingBarsLeft not found');
        }
        if (coverDancingBarsRight) {
            coverDancingBarsRight.classList.add('visible');
            console.log('Right bars made visible');
        } else {
            console.log('ERROR: coverDancingBarsRight not found');
        }
        
        // Initialize audio context and start visualizer
        initAudioContext();
        startVisualizer();
    updateCoverPositionVars();
    }

    function hideCoverDancingBars() {
        if (coverDancingBarsLeft) coverDancingBarsLeft.classList.remove('visible');
        if (coverDancingBarsRight) coverDancingBarsRight.classList.remove('visible');
        
        // Stop visualizer
        stopVisualizer();
    updateCoverPositionVars();
    }

    function updateThemeForPlayingState() {
        clearTimeout(themeUpdateTimeout);
        themeUpdateTimeout = setTimeout(() => {
            if (currentDominantColor) {
                applyTheme(currentDominantColor, currentColorPalette);
                // Re-ensure fullscreen contrast after theme update
                if (document.body.classList.contains('fullscreen-mode')) {
                    setTimeout(() => {
                        ensureFullscreenContrast();
                    }, 50);
                }
            } else {
                resetTheme();
            }
        }, 60);
    }
    
    function getBrightness(r, g, b) {
        return (r * 299 + g * 587 + b * 114) / 1000;
    }

    function getColorDistance(color1, color2) {
        const [r1, g1, b1] = color1;
        const [r2, g2, b2] = color2;
        
        // Calculate Euclidean distance in RGB space
        return Math.sqrt(
            Math.pow(r2 - r1, 2) + 
            Math.pow(g2 - g1, 2) + 
            Math.pow(b2 - b1, 2)
        );
    }

    function createColorShades(r, g, b) {
        // Create lighter shade (for top of gradient) - very subtle blend
        const lightR = Math.min(255, Math.round(r + (255 - r) * 0.02));
        const lightG = Math.min(255, Math.round(g + (255 - g) * 0.02));
        const lightB = Math.min(255, Math.round(b + (255 - b) * 0.02));
        
        // Original color (for middle)
        const normalR = r;
        const normalG = g;
        const normalB = b;
        
        // Create darker shade (for bottom of gradient)
        const darkR = Math.max(0, Math.round(r * 0.7));
        const darkG = Math.max(0, Math.round(g * 0.7));
        const darkB = Math.max(0, Math.round(b * 0.7));
        
        return {
            light: { r: lightR, g: lightG, b: lightB },
            normal: { r: normalR, g: normalG, b: normalB },
            dark: { r: darkR, g: darkG, b: darkB }
        };
    }

    function getSecondaryColorOrShades(dominantColor, palette) {
        if (!palette || palette.length < 2) {
            // No palette available, use shade-based approach
            const [r, g, b] = dominantColor;
            return createColorShades(r, g, b);
        }

        let secondaryColor = palette[1]; // Second color in palette
        let colorDistance = getColorDistance(dominantColor, secondaryColor);
        
        // If dominant and second colors are too similar, try third color
        if (colorDistance < 50 && palette.length >= 3) {
            const thirdColor = palette[2];
            const thirdColorDistance = getColorDistance(dominantColor, thirdColor);
            
            // Use third color if it has better contrast than second color
            if (thirdColorDistance > colorDistance) {
                secondaryColor = thirdColor;
                colorDistance = thirdColorDistance;
                console.log('Using third dominant color for better contrast');
            }
        }
        
        // If colors are still too similar (distance < 50), use shade-based approach
        if (colorDistance < 50) {
            const [r, g, b] = dominantColor;
            return createColorShades(r, g, b);
        }

        // Use secondary color for variations
        const [r, g, b] = dominantColor;
        const [sr, sg, sb] = secondaryColor;
        
        // Create variations using both dominant and secondary colors
        // But ALWAYS use darkened version of dominant color for dark shade
        return {
            light: { r: Math.min(255, Math.round((r + sr) / 2 + 5)), 
                    g: Math.min(255, Math.round((g + sg) / 2 + 5)), 
                    b: Math.min(255, Math.round((b + sb) / 2 + 5)) },
            normal: { r, g, b }, // Keep dominant as normal
            dark: { r: Math.max(0, Math.round(r * 0.7)), 
                   g: Math.max(0, Math.round(g * 0.7)), 
                   b: Math.max(0, Math.round(b * 0.7)) } // Always use darkened dominant color
        };
    }

    function applyTheme(c, palette = null) {
        const [r, g, b] = c;
        const isDarkColor = getBrightness(r, g, b) < 128;
        const shades = getSecondaryColorOrShades(c, palette);
        
        // Create three-shade gradient for container background - extended blending area
        const containerGradient = `linear-gradient(0deg, 
            rgb(${shades.dark.r}, ${shades.dark.g}, ${shades.dark.b}), 
            rgb(${shades.normal.r}, ${shades.normal.g}, ${shades.normal.b}) 40%, 
            rgb(${shades.normal.r}, ${shades.normal.g}, ${shades.normal.b}) 60%,
            rgb(${shades.normal.r}, ${shades.normal.g}, ${shades.normal.b}) 80%,
            rgb(${shades.light.r}, ${shades.light.g}, ${shades.light.b}))`;
        
        // Apply container background only when NOT in fullscreen.
        // In fullscreen, keep container transparent so the slide overlay is visible.
        const container = document.querySelector('.container');
        if (container) {
            if (!document.body.classList.contains('fullscreen-mode')) {
                container.style.background = containerGradient;
                container.style.backdropFilter = 'blur(12px)';
                container.style.webkitBackdropFilter = 'blur(12px)';
            } else {
                container.style.background = '';
                container.style.backdropFilter = '';
                container.style.webkitBackdropFilter = '';
            }
        }
        
        // Determine text and button colors based on brightness
        let textColor, buttonColor, buttonTextColor;
        if (isDarkColor) {
            // If extracted color is dark, use light version for text/buttons
            textColor = `rgb(${shades.light.r}, ${shades.light.g}, ${shades.light.b})`;
            buttonColor = `linear-gradient(90deg, rgb(${shades.light.r}, ${shades.light.g}, ${shades.light.b}), rgb(${Math.min(255, shades.light.r + 20)}, ${Math.min(255, shades.light.g + 20)}, ${Math.min(
255, shades.light.b + 20)}))`;
            buttonTextColor = `rgb(${shades.dark.r}, ${shades.dark.g}, ${shades.dark.b})`;
        } else {
            // If extracted color is light, use dark version for text/buttons
            textColor = `rgb(${shades.dark.r}, ${shades.dark.g}, ${shades.dark.b})`;
            buttonColor = `linear-gradient(90deg, rgb(${shades.dark.r}, ${shades.dark.g}, ${shades.dark.b}), rgb(${Math.max(0, shades.dark.r - 20)}, ${Math.max(0, shades.dark.g - 20)}, ${Math.max(0, shades.dark.b - 20)}))`;
            buttonTextColor = `rgb(${shades.light.r}, ${shades.light.g}, ${shades.light.b})`;
        }
        
        // Apply text colors
    const mainHeading = document.querySelector('.main-heading');
        const memberCount = document.querySelector('.member-count');
        const roomCodeDisplay = document.querySelector('.room-code-display');
        const songTitleText = document.querySelector('#song-title');
        const songArtistText = document.querySelector('#song-artist');
    let computedHeadingColor = null;

        
        if (mainHeading) {
            // Skip color application in fullscreen mode - will be handled by contrast function
            if (!document.body.classList.contains('fullscreen-mode')) {
                // Check if heading has a fixed color from dancing bars
                const fixedColor = mainHeading.getAttribute('data-fixed-color');
                if (fixedColor) {
                    // Use the stored fixed color instead of calculating new one
                    mainHeading.style.removeProperty('background');
                    mainHeading.style.removeProperty('background-image');
                    mainHeading.style.removeProperty('-webkit-background-clip');
                    mainHeading.style.removeProperty('-webkit-text-fill-color');
                    mainHeading.style.removeProperty('background-clip');
                    mainHeading.style.color = fixedColor;
                    mainHeading.style.setProperty('color', fixedColor, 'important');
                    console.log(`Using fixed heading color: ${fixedColor}`);
                    computedHeadingColor = fixedColor;
                } else {
                    // For the heading, use the opposite shade based on background brightness
                    // The background at the top is the light shade, so we need to consider its brightness
                    const topBrightness = getBrightness(shades.light.r, shades.light.g, shades.light.b);
                    let headingColor;
                    
                    if (topBrightness > 128) {
                        // Light background at top - use dark color for heading
                        headingColor = `rgb(${shades.dark.r}, ${shades.dark.g}, ${shades.dark.b})`;
                    } else {
                        // Dark background at top - use light color for heading
                        headingColor = `rgb(${shades.light.r}, ${shades.light.g}, ${shades.light.b})`;
                    }
                    
                    // Force clear any existing styles and apply new color
                    mainHeading.style.removeProperty('background');
                    mainHeading.style.removeProperty('background-image');
                    mainHeading.style.removeProperty('-webkit-background-clip');
                    mainHeading.style.removeProperty('-webkit-text-fill-color');
                    mainHeading.style.removeProperty('background-clip');
                    mainHeading.style.color = headingColor;
                    mainHeading.style.setProperty('color', headingColor, 'important');
                    
                    console.log(`Heading color set to: ${headingColor} (top brightness: ${topBrightness})`);
                    computedHeadingColor = headingColor;
                }
            }
        }
        
        if (memberCount && !document.body.classList.contains('fullscreen-mode')) {
            memberCount.style.color = textColor;
        }
        if (roomCodeDisplay && !document.body.classList.contains('fullscreen-mode')) {
            // Check if room code has a fixed color from dancing bars
            const fixedColor = roomCodeDisplay.getAttribute('data-fixed-color');
            if (fixedColor) {
                // Use the stored fixed color instead of calculating new one
                roomCodeDisplay.style.color = fixedColor;
                roomCodeDisplay.style.setProperty('color', fixedColor, 'important');
                roomCodeDisplay.style.borderColor = fixedColor;
                console.log(`Using fixed room code color: ${fixedColor}`);
                
                // Also apply to the span inside room code display
                const roomCodeSpan = roomCodeDisplay.querySelector('span');
                if (roomCodeSpan) {
                    const spanFixedColor = roomCodeSpan.getAttribute('data-fixed-color');
                    if (spanFixedColor) {
                        roomCodeSpan.style.setProperty('color', spanFixedColor, 'important');
                    }
                }
            } else {
                roomCodeDisplay.style.color = textColor;
                roomCodeDisplay.style.borderColor = textColor;
            }
        }
        // Match file name color to main heading if available
        if (songTitleText && !document.body.classList.contains('fullscreen-mode')) {
            if (computedHeadingColor) {
                songTitleText.style.setProperty('color', computedHeadingColor, 'important');
            } else {
                songTitleText.style.color = textColor;
            }
        }
        if (songArtistText && !document.body.classList.contains('fullscreen-mode')) {
            if (computedHeadingColor) {
                songArtistText.style.setProperty('color', computedHeadingColor, 'important');
            } else {
                songArtistText.style.color = textColor;
            }
        }
        
        // Style cover art placeholder if visible
        if (coverArtPlaceholder && coverArtPlaceholder.classList.contains('visible')) {
            coverArtPlaceholder.style.background = `linear-gradient(135deg, 
                rgba(${shades.light.r}, ${shades.light.g}, ${shades.light.b}, 0.15) 0%,
                rgba(${shades.normal.r}, ${shades.normal.g}, ${shades.normal.b}, 0.08) 50%,
                rgba(${shades.dark.r}, ${shades.dark.g}, ${shades.dark.b}, 0.05) 100%)`;
            coverArtPlaceholder.style.borderColor = `rgba(${shades.normal.r}, ${shades.normal.g}, ${shades.normal.b}, 0.25)`;
            coverArtPlaceholder.style.boxShadow = `0 0 15px rgba(${shades.normal.r}, ${shades.normal.g}, ${shades.normal.b}, 0.3), 0 0 35px rgba(${shades.normal.r}, ${shades.normal.g}, ${shades.normal.b}, 0.2)`;
        }
        
        // Apply button styles
        controlButtons.forEach(e => {
            e.style.background = `linear-gradient(135deg, 
                rgba(${shades.light.r}, ${shades.light.g}, ${shades.light.b}, 0.15) 0%,
                rgba(${shades.normal.r}, ${shades.normal.g}, ${shades.normal.b}, 0.08) 50%,
                rgba(${shades.dark.r}, ${shades.dark.g}, ${shades.dark.b}, 0.05) 100%)`;
            e.style.borderColor = `rgba(${shades.normal.r}, ${shades.normal.g}, ${shades.normal.b}, 0.25)`;
            
            // Enhanced contrast logic for button text
            const avgBackgroundBrightness = (getBrightness(shades.light.r, shades.light.g, shades.light.b) + 
                                           getBrightness(shades.normal.r, shades.normal.g, shades.normal.b) + 
                                           getBrightness(shades.dark.r, shades.dark.g, shades.dark.b)) / 3;
            
            // Use high contrast colors with minimum difference threshold
            if (avgBackgroundBrightness > 140) {
                // Light background - use pure black for maximum contrast
                e.style.color = 'black';
            } else if (avgBackgroundBrightness < 115) {
                // Dark background - use pure white for maximum contrast
                e.style.color = 'white';
            } else {
                // Medium brightness - use the color with highest contrast
                const lightContrast = Math.abs(avgBackgroundBrightness - getBrightness(shades.light.r, shades.light.g, shades.light.b));
                const darkContrast = Math.abs(avgBackgroundBrightness - getBrightness(shades.dark.r, shades.dark.g, shades.dark.b));
                
                if (lightContrast > darkContrast) {
                    e.style.color = `rgb(${shades.light.r}, ${shades.light.g}, ${shades.light.b})`;
                } else {
                    e.style.color = `rgb(${shades.dark.r}, ${shades.dark.g}, ${shades.dark.b})`;
                }
            }
            
            e.style.boxShadow = `
                0 8px 32px 0 rgba(${shades.dark.r}, ${shades.dark.g}, ${shades.dark.b}, 0.3),
                inset 0 1px 0 0 rgba(${shades.light.r}, ${shades.light.g}, ${shades.light.b}, 0.15),
                inset 0 -1px 0 0 rgba(${shades.light.r}, ${shades.light.g}, ${shades.light.b}, 0.08)`;
        });
        
        // Apply to create new room button
        const createRoomBtn = document.querySelector('.create-new-room-button');
        if (createRoomBtn) {
            createRoomBtn.style.background = `linear-gradient(135deg, 
                rgba(${shades.light.r}, ${shades.light.g}, ${shades.light.b}, 0.15) 0%,
                rgba(${shades.normal.r}, ${shades.normal.g}, ${shades.normal.b}, 0.08) 50%,
                rgba(${shades.dark.r}, ${shades.dark.g}, ${shades.dark.b}, 0.05) 100%)`;
            createRoomBtn.style.borderColor = `rgba(${shades.normal.r}, ${shades.normal.g}, ${shades.normal.b}, 0.25)`;
            
            // Enhanced contrast logic for create room button text
            const avgBackgroundBrightness = (getBrightness(shades.light.r, shades.light.g, shades.light.b) + 
                                           getBrightness(shades.normal.r, shades.normal.g, shades.normal.b) + 
                                           getBrightness(shades.dark.r, shades.dark.g, shades.dark.b)) / 3;
            
            if (avgBackgroundBrightness > 140) {
                createRoomBtn.style.color = 'black';
            } else if (avgBackgroundBrightness < 115) {
                createRoomBtn.style.color = 'white';
            } else {
                const lightContrast = Math.abs(avgBackgroundBrightness - getBrightness(shades.light.r, shades.light.g, shades.light.b));
                const darkContrast = Math.abs(avgBackgroundBrightness - getBrightness(shades.dark.r, shades.dark.g, shades.dark.b));
                
                if (lightContrast > darkContrast) {
                    createRoomBtn.style.color = `rgb(${shades.light.r}, ${shades.light.g}, ${shades.light.b})`;
                } else {
                    createRoomBtn.style.color = `rgb(${shades.dark.r}, ${shades.dark.g}, ${shades.dark.b})`;
                }
            }
            
            createRoomBtn.style.boxShadow = `
                0 8px 32px 0 rgba(${shades.dark.r}, ${shades.dark.g}, ${shades.dark.b}, 0.3),
                inset 0 1px 0 0 rgba(${shades.light.r}, ${shades.light.g}, ${shades.light.b}, 0.15),
                inset 0 -1px 0 0 rgba(${shades.light.r}, ${shades.light.g}, ${shades.light.b}, 0.08)`;
        }

        // Apply to exit room button (same logic as create new room button)
        const exitRoomBtn = document.querySelector('.exit-room-button');
        if (exitRoomBtn) {
            exitRoomBtn.style.background = `linear-gradient(135deg, 
                rgba(${shades.light.r}, ${shades.light.g}, ${shades.light.b}, 0.15) 0%,
                rgba(${shades.normal.r}, ${shades.normal.g}, ${shades.normal.b}, 0.08) 50%,
                rgba(${shades.dark.r}, ${shades.dark.g}, ${shades.dark.b}, 0.05) 100%)`;
            exitRoomBtn.style.borderColor = `rgba(${shades.normal.r}, ${shades.normal.g}, ${shades.normal.b}, 0.25)`;
            
            // Enhanced contrast logic for exit room button text (same as create room button)
            const avgBackgroundBrightness = (getBrightness(shades.light.r, shades.light.g, shades.light.b) + 
                                           getBrightness(shades.normal.r, shades.normal.g, shades.normal.b) + 
                                           getBrightness(shades.dark.r, shades.dark.g, shades.dark.b)) / 3;
            
            if (avgBackgroundBrightness > 140) {
                exitRoomBtn.style.color = 'black';
            } else if (avgBackgroundBrightness < 115) {
                exitRoomBtn.style.color = 'white';
            } else {
                const lightContrast = Math.abs(avgBackgroundBrightness - getBrightness(shades.light.r, shades.light.g, shades.light.b));
                const darkContrast = Math.abs(avgBackgroundBrightness - getBrightness(shades.dark.r, shades.dark.g, shades.dark.b));
                
                if (lightContrast > darkContrast) {
                    exitRoomBtn.style.color = `rgb(${shades.light.r}, ${shades.light.g}, ${shades.light.b})`;
                } else {
                    exitRoomBtn.style.color = `rgb(${shades.dark.r}, ${shades.dark.g}, ${shades.dark.b})`;
                }
            }
            
            exitRoomBtn.style.boxShadow = `
                0 8px 32px 0 rgba(${shades.dark.r}, ${shades.dark.g}, ${shades.dark.b}, 0.3),
                inset 0 1px 0 0 rgba(${shades.light.r}, ${shades.light.g}, ${shades.light.b}, 0.15),
                inset 0 -1px 0 0 rgba(${shades.light.r}, ${shades.light.g}, ${shades.light.b}, 0.08)`;
        }

        // Apply custom player styling
        const customPlayer = document.querySelector('.custom-player');
        if (customPlayer) {
            customPlayer.style.background = `linear-gradient(135deg, 
                rgba(${shades.light.r}, ${shades.light.g}, ${shades.light.b}, 0.15) 0%,
                rgba(${shades.normal.r}, ${shades.normal.g}, ${shades.normal.b}, 0.08) 50%,
                rgba(${shades.dark.r}, ${shades.dark.g}, ${shades.dark.b}, 0.05) 100%)`;
            customPlayer.style.borderColor = `rgba(${shades.normal.r}, ${shades.normal.g}, ${shades.normal.b}, 0.25)`;
            customPlayer.style.boxShadow = `
                0 8px 32px 0 rgba(${shades.dark.r}, ${shades.dark.g}, ${shades.dark.b}, 0.3),
                inset 0 1px 0 0 rgba(${shades.light.r}, ${shades.light.g}, ${shades.light.b}, 0.15),
                inset 0 -1px 0 0 rgba(${shades.light.r}, ${shades.light.g}, ${shades.light.b}, 0.08)`;
        }

        // Style time displays with enhanced contrast
        const timeDisplays = document.querySelectorAll('.player-time-display');
        timeDisplays.forEach(display => {
            // Calculate contrast against the background where time displays appear
            const backgroundBrightness = getBrightness(shades.normal.r, shades.normal.g, shades.normal.b);
            
            if (backgroundBrightness > 140) {
                display.style.color = 'black';
            } else if (backgroundBrightness < 115) {
                display.style.color = 'white';
            } else {
                // Use the color with highest contrast
                const lightBrightness = getBrightness(shades.light.r, shades.light.g, shades.light.b);
                const darkBrightness = getBrightness(shades.dark.r, shades.dark.g, shades.dark.b);
                
                const lightContrast = Math.abs(backgroundBrightness - lightBrightness);
                const darkContrast = Math.abs(backgroundBrightness - darkBrightness);
                
                if (lightContrast > darkContrast) {
                    display.style.color = `rgb(${shades.light.r}, ${shades.light.g}, ${shades.light.b})`;
                } else {
                    display.style.color = `rgb(${shades.dark.r}, ${shades.dark.g}, ${shades.dark.b})`;
                }
            }
        });

        // Style progress and volume bars
        if (progressFill) {
            progressFill.style.background = buttonColor;
        }
        if (volumeFillVertical) {
            volumeFillVertical.style.background = buttonColor;
        }

        // Style progress and volume handles
        const handles = document.querySelectorAll('.progress-handle, .volume-handle');
        handles.forEach(handle => {
            handle.style.background = buttonTextColor;
            handle.style.boxShadow = `0 2px 8px rgba(${shades.normal.r}, ${shades.normal.g}, ${shades.normal.b}, 0.4)`;
        });

        // Style progress and volume background bars
        const progressBar = document.querySelector('.progress-bar');
        const volumeSliderVertical = document.querySelector('.volume-slider-vertical');
        const volumePopup = document.querySelector('.volume-popup');
        if (progressBar) {
            progressBar.style.background = `linear-gradient(90deg, 
                rgba(${shades.light.r}, ${shades.light.g}, ${shades.light.b}, 0.12) 0%,
                rgba(${shades.normal.r}, ${shades.normal.g}, ${shades.normal.b}, 0.08) 50%,
                rgba(${shades.light.r}, ${shades.light.g}, ${shades.light.b}, 0.12) 100%)`;
            progressBar.style.borderColor = `rgba(${shades.normal.r}, ${shades.normal.g}, ${shades.normal.b}, 0.15)`;
        }
        if (volumeSliderVertical) {
            volumeSliderVertical.style.background = `linear-gradient(180deg, 
                rgba(${shades.light.r}, ${shades.light.g}, ${shades.light.b}, 0.15) 0%,
                rgba(${shades.normal.r}, ${shades.normal.g}, ${shades.normal.b}, 0.08) 50%,
                rgba(${shades.light.r}, ${shades.light.g}, ${shades.light.b}, 0.15) 100%)`;
            volumeSliderVertical.style.borderColor = `rgba(${shades.normal.r}, ${shades.normal.g}, ${shades.normal.b}, 0.15)`;
        }
        if (volumePopup) {
            volumePopup.style.background = `linear-gradient(135deg, 
                rgba(${shades.light.r}, ${shades.light.g}, ${shades.light.b}, 0.12) 0%,
                rgba(${shades.normal.r}, ${shades.normal.g}, ${shades.normal.b}, 0.06) 50%,
                rgba(${shades.dark.r}, ${shades.dark.g}, ${shades.dark.b}, 0.03) 100%)`;
            volumePopup.style.borderColor = `rgba(${shades.normal.r}, ${shades.normal.g}, ${shades.normal.b}, 0.25)`;
            volumePopup.style.boxShadow = `
                0 8px 32px 0 rgba(${shades.dark.r}, ${shades.dark.g}, ${shades.dark.b}, 0.3),
                inset 0 1px 0 0 rgba(${shades.light.r}, ${shades.light.g}, ${shades.light.b}, 0.15),
                inset 0 -1px 0 0 rgba(${shades.light.r}, ${shades.light.g}, ${shades.light.b}, 0.08)`;
        }

        // Handle file name border and bars for playing state
        if (fileNameDisplay.classList.contains('playing')) {
            fileNameDisplay.style.borderColor = textColor;
            document.documentElement.style.setProperty('--current-border-color', textColor);
            
            // Use improved secondary color selection for dancing bars
            let barColor = buttonColor; // Default fallback
            let glowColor = `${shades.normal.r},${shades.normal.g},${shades.normal.b}`;
            let barColorForHeading = textColor; // Default to textColor
            
            if (palette && palette.length >= 2) {
                let secondaryColor = palette[1];
                let colorDistance = getColorDistance(c, secondaryColor);
                
                // If dominant and second colors are too similar, try third color
                if (colorDistance < 50 && palette.length >= 3) {
                    const thirdColor = palette[2];
                    const thirdColorDistance = getColorDistance(c, thirdColor);
                    
                    if (thirdColorDistance > colorDistance) {
                        secondaryColor = thirdColor;
                        console.log('Using third dominant color for dancing bars');
                    }
                }
                
                const [sr, sg, sb] = secondaryColor;
                barColor = `linear-gradient(90deg, rgb(${sr}, ${sg}, ${sb}), rgb(${Math.min(255, sr + 20)}, ${Math.min(255, sg + 20)}, ${Math.min(255, sb + 20)}))`;
                glowColor = `${sr},${sg},${sb}`;
                barColorForHeading = `rgb(${sr}, ${sg}, ${sb})`;
            }
            
            // Set CSS variables for both dancing bars and heading - KEEP THESE PERSISTENT
            document.documentElement.style.setProperty('--current-bar-color', barColorForHeading);
            
            // Store the bar color permanently for heading and room code
            if (mainHeading) {
                mainHeading.style.setProperty('color', barColorForHeading, 'important');
                // Store as data attribute for persistence
                mainHeading.setAttribute('data-fixed-color', barColorForHeading);
            }
            if (songTitleText) {
                songTitleText.style.setProperty('color', barColorForHeading, 'important');
                songTitleText.setAttribute('data-fixed-color', barColorForHeading);
            }
            if (songArtistText) {
                songArtistText.style.setProperty('color', barColorForHeading, 'important');
                songArtistText.setAttribute('data-fixed-color', barColorForHeading);
            }
            if (roomCodeDisplay) {
                roomCodeDisplay.style.setProperty('color', barColorForHeading, 'important');
                // Store as data attribute for persistence
                roomCodeDisplay.setAttribute('data-fixed-color', barColorForHeading);
                
                // Also apply to the span inside room code display
                const roomCodeSpan = roomCodeDisplay.querySelector('span');
                if (roomCodeSpan) {
                    roomCodeSpan.style.setProperty('color', barColorForHeading, 'important');
                    roomCodeSpan.setAttribute('data-fixed-color', barColorForHeading);
                }
            }
            
            // Override with fullscreen contrast if needed
            if (document.body.classList.contains('fullscreen-mode')) {
                setTimeout(() => {
                    ensureFullscreenContrast();
                }, 50);
            }
            
            document.querySelectorAll('.cover-dancing-bars .bar').forEach(bar => {
                bar.style.background = barColor;
                bar.style.boxShadow = `0 0 8px rgb(${glowColor})`;
            });
        } else {
            fileNameDisplay.style.borderColor = '';
            document.documentElement.style.removeProperty('--current-border-color');
            // DON'T remove --current-bar-color to keep heading color persistent
            
            document.querySelectorAll('.cover-dancing-bars .bar').forEach(bar => {
                bar.style.background = '';
                bar.style.boxShadow = '';
            });
        }
        
        // Apply fullscreen contrast after all theme colors are set
        if (document.body.classList.contains('fullscreen-mode')) {
            setTimeout(() => {
                ensureFullscreenContrast();
            }, 50);
        }
    }

    function resetTheme() {
        // Don't reset anything if we're in fullscreen mode
        if (document.body.classList.contains('fullscreen-mode')) {
            return;
        }
        
        // Reset container background to default
        const container = document.querySelector('.container');
        if (container) {
            container.style.background = '';
            container.style.backdropFilter = '';
            container.style.webkitBackdropFilter = '';
        }
        
        // Reset text colors
        const mainHeading = document.querySelector('.main-heading');
        const memberCount = document.querySelector('.member-count');
        const roomCodeDisplay = document.querySelector('.room-code-display');
        const songTitleText = document.querySelector('#song-title');
        const songArtistText = document.querySelector('#song-artist');
        
        if (mainHeading) {
            // Only reset if no fixed color is stored
            const fixedColor = mainHeading.getAttribute('data-fixed-color');
            if (!fixedColor) {
                mainHeading.style.removeProperty('background');
                mainHeading.style.removeProperty('background-image');
                mainHeading.style.removeProperty('-webkit-background-clip');
                mainHeading.style.removeProperty('-webkit-text-fill-color');
                mainHeading.style.removeProperty('background-clip');
                mainHeading.style.removeProperty('color');
            }
        }
        
    if (memberCount) memberCount.style.color = '';
        if (roomCodeDisplay) {
            // Only reset if no fixed color is stored
            const fixedColor = roomCodeDisplay.getAttribute('data-fixed-color');
            if (!fixedColor) {
                roomCodeDisplay.style.color = '';
                roomCodeDisplay.style.borderColor = '';
                
                // Also reset span if no fixed color
                const roomCodeSpan = roomCodeDisplay.querySelector('span');
                if (roomCodeSpan && !roomCodeSpan.getAttribute('data-fixed-color')) {
                    roomCodeSpan.style.removeProperty('color');
                }
            }
        }
        if (songTitleText) {
            const fixedColor = songTitleText.getAttribute('data-fixed-color');
            if (!fixedColor) {
                songTitleText.style.removeProperty('color');
            }
        }
        if (songArtistText) {
            const fixedColor = songArtistText.getAttribute('data-fixed-color');
            if (!fixedColor) {
                songArtistText.style.removeProperty('color');
            }
        }
        
        // Reset cover art placeholder styling
        if (coverArtPlaceholder) {
            coverArtPlaceholder.style.background = '';
            coverArtPlaceholder.style.borderColor = '';
            coverArtPlaceholder.style.boxShadow = '';
        }
        
        // Reset button styles
        controlButtons.forEach(e => {
            e.style.background = '';
            e.style.color = '';
            e.style.borderColor = '';
            e.style.boxShadow = '';
            e.style.textShadow = '';
        });
        
        // Reset create new room button
        const createRoomBtn = document.querySelector('.create-new-room-button');
        if (createRoomBtn) {
            createRoomBtn.style.background = '';
            createRoomBtn.style.color = '';
            createRoomBtn.style.borderColor = '';
            createRoomBtn.style.boxShadow = '';
            createRoomBtn.style.textShadow = '';
        }

        // Reset exit room button
        const exitRoomBtn = document.querySelector('.exit-room-button');
        if (exitRoomBtn) {
            exitRoomBtn.style.background = '';
            exitRoomBtn.style.color = '';
            exitRoomBtn.style.borderColor = '';
            exitRoomBtn.style.boxShadow = '';
            exitRoomBtn.style.textShadow = '';
        }

        // Reset custom player styling
        const customPlayer = document.querySelector('.custom-player');
        if (customPlayer) {
            customPlayer.style.background = '';
            customPlayer.style.borderColor = '';
            customPlayer.style.boxShadow = '';
        }

        // Reset time displays
        const timeDisplays = document.querySelectorAll('.player-time-display');
        timeDisplays.forEach(display => {
            display.style.color = '';
            display.style.textShadow = '';
        });

        // Reset progress and volume bars
        if (progressFill) {
            progressFill.style.background = '';
        }
        if (volumeFillVertical) {
            volumeFillVertical.style.background = '';
        }

        // Reset handles
        const handles = document.querySelectorAll('.progress-handle, .volume-handle');
        handles.forEach(handle => {
            handle.style.background = '';
            handle.style.boxShadow = '';
        });

        // Reset background bars
        const progressBar = document.querySelector('.progress-bar');
        const volumeSliderVertical = document.querySelector('.volume-slider-vertical');
        const volumePopup = document.querySelector('.volume-popup');
        if (progressBar) {
            progressBar.style.background = '';
            progressBar.style.borderColor = '';
        }
        if (volumeSliderVertical) {
            volumeSliderVertical.style.background = '';
            volumeSliderVertical.style.borderColor = '';
        }
        if (volumePopup) {
            volumePopup.style.background = '';
            volumePopup.style.borderColor = '';
            volumePopup.style.boxShadow = '';
        }
        
        // Reset bars and borders
        document.querySelectorAll('.cover-dancing-bars .bar').forEach(bar => {
            bar.style.background = '';
            bar.style.boxShadow = '';
        });
        fileNameDisplay.style.borderColor = '';
        document.documentElement.style.removeProperty('--current-border-color');
        document.documentElement.style.removeProperty('--current-bar-color');
        currentDominantColor = null;
        currentColorPalette = null;
    }

    function updateMemberCount(count) {
        // Update the member count in the members button
        const memberCountElement = document.querySelector('.member-count');
        if (memberCountElement) {
            // Keep the icon and update the text
            memberCountElement.innerHTML = `<i class="fa-solid fa-user-group"></i> ${count}`;
            console.log(`Member count updated: ${count}`);
        }
    }

    // ===============================
    // Queue Management Functions
    // ===============================
    function updateQueueCount() {
        if (queueCount) {
            queueCount.textContent = currentQueue.length;
        }
    }

    function updateQueueDisplay() {
        if (!queueList) return;

        if (currentQueue.length === 0) {
            queueList.innerHTML = '<p class="empty-queue">No songs in queue</p>';
            return;
        }

        // Render queue items with draggable attributes for reordering
        const queueHTML = currentQueue.map((item, index) => {
            const isCurrentSong = Number(index) === Number(currentQueueIndex);
            
            // Handle cover images for both local files and remote URLs
            let coverSrc = '';
            if (item.cover) {
                // Local uploaded file cover
                coverSrc = `/uploads/${item.cover}`;
            } else if (item.image_url) {
                // Remote streamed song cover
                coverSrc = item.image_url;
            }
            
            const coverDisplay = coverSrc 
                ? `<img src="${coverSrc}" alt="Cover" class="queue-item-cover" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                   <div class="queue-item-cover" style="display:none;">🎵</div>` 
                : '<div class="queue-item-cover">🎵</div>';
            
            // Show stream indicator for streamed songs
            const streamIndicator = item.is_stream ? '<span class="stream-indicator" title="Streamed from YouTube Music">🌐</span>' : '';
            
            // Only make items draggable if there's more than one song in the queue
            const isDraggable = currentQueue.length > 1;
            
            return `
                <div class="queue-item ${isCurrentSong ? 'current' : ''}" data-index="${index}" ${isDraggable ? 'draggable="true"' : ''}>
                    ${coverDisplay}
                    <div class="queue-item-info">
                        <div class="queue-item-title">${item.filename_display || item.filename} ${streamIndicator}</div>
                        <div class="queue-item-status">${isCurrentSong ? 'Now Playing' : `#${index + 1} in queue`}</div>
                    </div>
                    <div class="queue-item-actions">
                        <button class="queue-item-btn play-btn" data-index="${index}" title="Play" draggable="false">
                            <i class="fas fa-play"></i>
                        </button>
                        <button class="queue-item-btn remove-btn danger" data-index="${index}" title="Remove" draggable="false">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        queueList.innerHTML = queueHTML;

        // Setup drag and drop with event delegation for reliability
        setupDragAndDrop();
        
        // Setup button event listeners with event delegation
        setupQueueButtonListeners();
    }

    // Drag & drop state with animated placeholder preview
    let dragSrcIndex = null;
    let placeholderEl = null;
    let draggedElement = null;

    function setupDragAndDrop() {
        // Remove any existing listeners to prevent duplicates
        queueList.removeEventListener('dragstart', handleDragStart);
        queueList.removeEventListener('dragend', handleDragEnd);
        queueList.removeEventListener('dragover', handleDragOver);
        queueList.removeEventListener('drop', handleDrop);

        // Use event delegation for reliability
        queueList.addEventListener('dragstart', handleDragStart);
        queueList.addEventListener('dragend', handleDragEnd);
        queueList.addEventListener('dragover', handleDragOver);
        queueList.addEventListener('drop', handleDrop);
    }

    function handleDragStart(e) {
        const itemEl = e.target.closest('.queue-item');
        if (!itemEl) return;

        // Prevent drag if there's only one song in the queue
        if (currentQueue.length <= 1) {
            e.preventDefault();
            e.stopPropagation();
            return false;
        }

        // Prevent drag from starting if user clicked on a button or icon
        if (e.target.closest('.queue-item-btn') || e.target.tagName.toLowerCase() === 'button') {
            e.preventDefault();
            e.stopPropagation();
            return false;
        }

        const idx = parseInt(itemEl.dataset.index, 10);
        if (isNaN(idx)) return;
        
        dragSrcIndex = idx;
        draggedElement = itemEl;
        
        e.dataTransfer.effectAllowed = 'move';
        try { 
            e.dataTransfer.setData('text/plain', String(idx)); 
        } catch (err) { 
            console.warn('DataTransfer setData failed:', err);
        }

        // Create and insert placeholder
        placeholderEl = createPlaceholder(itemEl.offsetHeight || 60);
        itemEl.parentNode.insertBefore(placeholderEl, itemEl.nextSibling);

        // Visual feedback
        itemEl.classList.add('dragging');
        itemEl.style.opacity = '0.3';
        
        // Prevent text selection
        document.body.style.userSelect = 'none';
    }

    function handleDragEnd(e) {
        const itemEl = e.target.closest('.queue-item');
        if (!itemEl && !draggedElement) return;
        
        const targetEl = itemEl || draggedElement;
        
        // Cleanup
        dragSrcIndex = null;
        draggedElement = null;
        
        if (placeholderEl && placeholderEl.parentNode) {
            placeholderEl.parentNode.removeChild(placeholderEl);
        }
        placeholderEl = null;
        
        if (targetEl) {
            targetEl.classList.remove('dragging');
            targetEl.style.opacity = '';
        }
        
        // Clear any lingering styles
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

        // Determine insertion point
        const rect = itemEl.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const insertBefore = e.clientY < midY;
        
        // Check if we need to move placeholder
        const targetSibling = insertBefore ? itemEl : itemEl.nextSibling;
        if (placeholderEl.nextSibling === targetSibling) return; // Already in position

        // FLIP animation: capture first positions of items that will move
        const items = Array.from(queueList.querySelectorAll('.queue-item'))
            .filter(el => el !== placeholderEl && el !== draggedElement);
        const firstRects = new Map();
        items.forEach(el => firstRects.set(el, el.getBoundingClientRect()));

        // Move placeholder to new position
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

        // Capture last positions and animate the difference
        items.forEach(el => {
            const first = firstRects.get(el);
            const last = el.getBoundingClientRect();
            if (!first || !last) return;
            
            const deltaY = first.top - last.top;
            if (deltaY === 0) return;
            
            // Apply inverse transform and animate back to natural position
            el.style.transition = 'none';
            el.style.transform = `translateY(${deltaY}px)`;
            
            // Force reflow
            el.getBoundingClientRect();
            
            // Animate to natural position
            el.style.transition = 'transform 180ms ease-out';
            el.style.transform = '';
            
            // Clean up after animation
            const cleanup = () => {
                el.style.transition = '';
                el.removeEventListener('transitionend', cleanup);
            };
            el.addEventListener('transitionend', cleanup);
            
            // Fallback cleanup in case transitionend doesn't fire
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

        // Compute destination index
        const toIndex = computeToIndexFromPlaceholder();
        if (toIndex === null) return;

        // Calculate effective destination
        let effectiveTo = toIndex;
        if (toIndex > dragSrcIndex) effectiveTo = toIndex - 1;
        
        // Skip if no actual change
        if (effectiveTo === dragSrcIndex) return;

        // Optimistically reorder locally
        const moved = currentQueue.splice(dragSrcIndex, 1)[0];
        currentQueue.splice(effectiveTo, 0, moved);

        // Update current index if necessary
        if (currentQueueIndex === dragSrcIndex) {
            currentQueueIndex = effectiveTo;
        } else if (dragSrcIndex < currentQueueIndex && effectiveTo >= currentQueueIndex) {
            currentQueueIndex -= 1;
        } else if (effectiveTo <= currentQueueIndex && dragSrcIndex > currentQueueIndex) {
            currentQueueIndex += 1;
        }

        updateQueueDisplay();
        sendReorderRequest(dragSrcIndex, effectiveTo);
    }

    function createPlaceholder(height) {
        const ph = document.createElement('div');
        ph.className = 'queue-placeholder';
        ph.style.height = `${height}px`;
        ph.style.transition = 'height 160ms ease, opacity 160ms ease, margin 160ms ease';
        return ph;
    }

    function computeToIndexFromPlaceholder() {
        if (!placeholderEl) return null;
        let idx = 0;
        for (const child of Array.from(queueList.children)) {
            if (child === placeholderEl) break;
            if (child.classList && child.classList.contains('queue-item')) idx++;
        }
        return idx;
    }

    function setupQueueButtonListeners() {
        console.log('Setting up queue button listeners');
        // Remove existing listeners to prevent duplicates
        queueList.removeEventListener('click', handleQueueClick);
        queueList.removeEventListener('mousedown', handleButtonMouseDown);
        
        // Use event delegation for all queue interactions
        queueList.addEventListener('click', handleQueueClick);
        queueList.addEventListener('mousedown', handleButtonMouseDown);
        console.log('Queue button listeners attached');
    }

    function handleButtonMouseDown(e) {
        // Prevent drag from starting when clicking on buttons
        if (e.target.closest('.queue-item-btn')) {
            e.stopPropagation();
            // Don't prevent default as we want the button click to work
        }
    }

    function handleQueueClick(e) {
        console.log('Queue click detected:', e.target, e.target.className);
        e.stopPropagation();
        
        const playBtn = e.target.closest('.play-btn');
        const removeBtn = e.target.closest('.remove-btn');
        const queueItem = e.target.closest('.queue-item');
        
        console.log('Button detection:', { playBtn, removeBtn, queueItem });
        
        if (playBtn) {
            e.preventDefault();
            const index = parseInt(playBtn.dataset.index);
            console.log('Play button clicked, index:', index);
            if (!isNaN(index)) {
                console.log('Playing from queue index:', index);
                playFromQueue(index);
            }
        } else if (removeBtn) {
            e.preventDefault();
            const index = parseInt(removeBtn.dataset.index);
            console.log('Remove button clicked, index:', index);
            if (!isNaN(index)) {
                console.log('Removing from queue index:', index);
                removeFromQueue(index);
            }
        } else if (queueItem && !e.target.closest('.queue-item-actions')) {
            // Only trigger play if not clicking on action buttons
            const index = parseInt(queueItem.dataset.index);
            console.log('Queue item clicked (not button), index:', index);
            if (!isNaN(index)) playFromQueue(index);
        }
    }

    // Lyrics functionality
    async function fetchAndDisplayLyrics() {
        if (!lyricsContent || !lyricsLoading) return;

        // Get current song info
        const currentSong = getCurrentSongInfo();
        if (!currentSong.artist || !currentSong.title) {
            showLyricsError('No song metadata available.');
            return;
        }

        // Check if we have cached lyrics for current song
        if (currentSongKey) {
            const cachedLyrics = getCachedLyrics(currentSongKey);
            if (cachedLyrics) {
                console.log('Loading lyrics from cache for:', currentSongKey);
                // Hide loading state
                lyricsLoading.style.display = 'none';
                lyricsContent.style.display = 'block';
                displayTimestampedLyrics(cachedLyrics);
                return;
            }
        }

        // Show loading state for web fetch
        lyricsLoading.style.display = 'block';
        lyricsContent.style.display = 'none';

        try {
            // Try fetching lyrics by artist and title
            const response = await fetch(`/lyrics?artist=${encodeURIComponent(currentSong.artist)}&title=${encodeURIComponent(currentSong.title)}`);
            const data = await response.json();

            // Hide loading state
            lyricsLoading.style.display = 'none';
            lyricsContent.style.display = 'block';

            if (data.success && data.lyrics) {
                // Cache the lyrics for future use
                if (currentSongKey) {
                    cacheLyrics(currentSongKey, data.lyrics);
                    console.log('Cached lyrics for:', currentSongKey);
                }
                displayTimestampedLyrics(data.lyrics);
            } else {
                showLyricsError(`Lyrics not found for "${currentSong.title}" by ${currentSong.artist}`);
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

    function getCurrentSongInfo() {
        // Get current song info from the displayed elements
        const title = songTitleElement ? songTitleElement.textContent.trim() : '';
        const artist = songArtistElement ? songArtistElement.textContent.trim() : '';
        
        return {
            title: title !== 'No file selected' && title !== '' ? title : null,
            artist: artist !== '' ? artist : null
        };
    }

    // Generate unique key for song identification
    function generateSongKey(filename, title, artist) {
        return `${filename}|${title || ''}|${artist || ''}`;
    }

    // Get cached lyrics for a song
    function getCachedLyrics(songKey) {
        return lyricsCache.get(songKey);
    }

    // Cache lyrics for a song
    function cacheLyrics(songKey, lyrics) {
        lyricsCache.set(songKey, lyrics);
        // Also save to localStorage for persistence across sessions
        try {
            localStorage.setItem(`lyrics_${songKey}`, lyrics);
        } catch (e) {
            console.warn('Could not save lyrics to localStorage:', e);
        }
    }

    // Load lyrics cache from localStorage
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

    // Parse timestamped lyrics from format [mm:ss.xx] lyrics text
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
                
                // Convert to total seconds
                const timeInSeconds = minutes * 60 + seconds + centiseconds / 100;
                
                if (text) { // Only add lines that have text
                    parsed.push({
                        time: timeInSeconds,
                        text: text
                    });
                }
            }
        }
        
        // Sort by time to ensure correct order
        return parsed.sort((a, b) => a.time - b.time);
    }

    // Display parsed lyrics with timestamps
    function displayTimestampedLyrics(lyrics) {
        parsedLyrics = parseLyrics(lyrics);
        
        if (parsedLyrics.length === 0) {
            // If no timestamps found, display as regular lyrics
            lyricsContent.innerHTML = `<div class="lyrics-text">${lyrics}</div>`;
            return;
        }

        // Create HTML for timestamped lyrics
        const lyricsHTML = parsedLyrics.map((line, index) => 
            `<div class="lyrics-line" data-index="${index}" data-time="${line.time}">${line.text}</div>`
        ).join('');
        
        lyricsContent.innerHTML = `<div class="lyrics-text">${lyricsHTML}</div>`;
        
        // Start lyrics synchronization if audio is playing
        if (player && !player.paused) {
            startLyricsSync();
        }
    }

    // Synchronize lyrics with current playback time
    function updateLyricsHighlight() {
        if (!player || parsedLyrics.length === 0) return;
        
        const currentTime = player.currentTime;
        let activeIndex = -1;
        
        // Find the current active lyric line
        for (let i = 0; i < parsedLyrics.length; i++) {
            if (currentTime >= parsedLyrics[i].time) {
                activeIndex = i;
            } else {
                break;
            }
        }
        
        // Update highlighting if the active line changed
        if (activeIndex !== currentLyricsIndex) {
            currentLyricsIndex = activeIndex;
            
            // Update modal lyrics
            const lyricsLines = document.querySelectorAll('.lyrics-content .lyrics-line');
            lyricsLines.forEach((line, index) => {
                line.classList.remove('active', 'past', 'future');
                
                if (index === activeIndex) {
                    line.classList.add('active');
                    // Scroll to active line
                    line.scrollIntoView({ behavior: 'smooth', block: 'center' });
                } else if (index < activeIndex) {
                    line.classList.add('past');
                } else {
                    line.classList.add('future');
                }
            });
            
            // Update fullscreen lyrics if visible
            if (isFullscreenLyricsVisible) {
                updateFullscreenLyricsHighlight();
            }
        }
    }

    // Start lyrics synchronization
    function startLyricsSync() {
        if (lyricsUpdateInterval) {
            clearInterval(lyricsUpdateInterval);
        }
        
        lyricsUpdateInterval = setInterval(updateLyricsHighlight, 100); // Update every 100ms
    }

    // Stop lyrics synchronization
    function stopLyricsSync() {
        if (lyricsUpdateInterval) {
            clearInterval(lyricsUpdateInterval);
            lyricsUpdateInterval = null;
        }
        currentLyricsIndex = -1;
    }

    // Clear lyrics cache (useful for debugging or clearing space)
    function clearLyricsCache() {
        lyricsCache.clear();
        try {
            // Remove all lyrics items from localStorage
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

    // Get cache statistics
    function getLyricsCacheStats() {
        return {
            cachedSongs: lyricsCache.size,
            cacheKeys: Array.from(lyricsCache.keys())
        };
    }

    // Show fullscreen lyrics overlay
    function showFullscreenLyrics() {
    if (!fullscreenLyricsOverlay) return;

    console.log('Showing fullscreen lyrics overlay');
    isFullscreenLyricsVisible = true;
    document.body.classList.add('lyrics-active'); // Add this line

    // Ensure the overlay is part of the layout before adding the visible class for transitions
    fullscreenLyricsOverlay.style.display = 'flex';

    // Add the 'visible' class to trigger the fade-in animation from the stylesheet
    setTimeout(() => {
        fullscreenLyricsOverlay.classList.add('visible');
    }, 10); // A small delay ensures the transition triggers correctly

    // Fetch and display the actual lyrics
    fetchLyricsForFullscreen();

    // Keep player controls visible while lyrics are shown
    if (document.body.classList.contains('fullscreen-mode')) {
        showPlayerBox();
        // Prevent the idle timer from hiding controls while lyrics are open
        if (fullscreenIdleTimer) clearTimeout(fullscreenIdleTimer);
    }
}
    // Hide fullscreen lyrics overlay
    function hideFullscreenLyrics() {
        if (!fullscreenLyricsOverlay) return;
        
        isFullscreenLyricsVisible = false;
        document.body.classList.remove('lyrics-active'); // Add this line
        fullscreenLyricsOverlay.classList.remove('visible');
        
        // Resume idle timer when lyrics are hidden
        if (document.body.classList.contains('fullscreen-mode')) {
            resetFullscreenIdleTimer();
        }
        
        setTimeout(() => {
            fullscreenLyricsOverlay.style.display = 'none';
        }, 300); // Wait for transition to complete
    }

    // Toggle fullscreen lyrics
    function toggleFullscreenLyrics() {
        if (isFullscreenLyricsVisible) {
            hideFullscreenLyrics();
        } else {
            showFullscreenLyrics();
        }
    }

    // Display timestamped lyrics in fullscreen mode
    function displayFullscreenTimestampedLyrics() {
        if (!fullscreenLyricsContent || parsedLyrics.length === 0) {
            if (fullscreenLyricsContent) {
                fullscreenLyricsContent.innerHTML = '<p class="no-lyrics">No lyrics available</p>';
            }
            return;
        }

        // Create HTML for timestamped lyrics
        const lyricsHTML = parsedLyrics.map((line, index) => 
            `<div class="lyrics-line" data-index="${index}" data-time="${line.time}">${line.text}</div>`
        ).join('');
        
        fullscreenLyricsContent.innerHTML = `<div class="lyrics-text">${lyricsHTML}</div>`;
        
        // Force immediate highlight update to sync with current playback position
        if (player) {
            // Calculate current lyrics index
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

    // Update lyrics highlighting in fullscreen mode
    function updateFullscreenLyricsHighlight() {
        if (!player || parsedLyrics.length === 0 || !isFullscreenLyricsVisible) return;
        
        // Use the current lyrics index that was already calculated
        const activeIndex = currentLyricsIndex;
        
        const lyricsLines = fullscreenLyricsContent.querySelectorAll('.lyrics-line');
        console.log('Updating fullscreen lyrics highlight. Active index:', activeIndex, 'Lines found:', lyricsLines.length);
        
        lyricsLines.forEach((line, index) => {
            line.classList.remove('active', 'past', 'future');
            
            if (index === activeIndex) {
                line.classList.add('active');
                // Scroll to active line
                line.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else if (index < activeIndex) {
                line.classList.add('past');
            } else {
                line.classList.add('future');
            }
        });
    }

    // Fetch lyrics specifically for fullscreen display
    async function fetchLyricsForFullscreen() {
        if (!fullscreenLyricsContent) return;

        // Get current song info
        const currentSong = getCurrentSongInfo();
        
        if (!currentSong.artist || !currentSong.title) {
            fullscreenLyricsContent.innerHTML = '<p class="no-lyrics">No song metadata available</p>';
            return;
        }

        // Check if we have cached lyrics for current song
        if (currentSongKey) {
            const cachedLyrics = getCachedLyrics(currentSongKey);
            if (cachedLyrics) {
                console.log('Loading lyrics from cache for fullscreen:', currentSongKey);
                parsedLyrics = parseLyrics(cachedLyrics);
                displayFullscreenTimestampedLyrics();
                // Start sync if audio is playing
                if (player && !player.paused) {
                    startLyricsSync();
                }
                return;
            }
        }

        // Show loading state
        fullscreenLyricsContent.innerHTML = '<p class="no-lyrics">Loading lyrics...</p>';

        try {
            // Try fetching lyrics by artist and title
            const response = await fetch(`/lyrics?artist=${encodeURIComponent(currentSong.artist)}&title=${encodeURIComponent(currentSong.title)}`);
            const data = await response.json();

            if (data.success && data.lyrics) {
                // Cache the lyrics for future use
                if (currentSongKey) {
                    cacheLyrics(currentSongKey, data.lyrics);
                    console.log('Cached lyrics for fullscreen:', currentSongKey);
                }
                parsedLyrics = parseLyrics(data.lyrics);
                displayFullscreenTimestampedLyrics();
                // Start sync if audio is playing
                if (player && !player.paused) {
                    startLyricsSync();
                }
            } else {
                fullscreenLyricsContent.innerHTML = `<p class="no-lyrics">Lyrics not found for "${currentSong.title}" by ${currentSong.artist}</p>`;
            }
        } catch (error) {
            console.error('Error fetching lyrics for fullscreen:', error);
            fullscreenLyricsContent.innerHTML = '<p class="no-lyrics">Failed to fetch lyrics</p>';
        }
    }

    function updateNextPrevButtons() {
        if (prevBtn) {
            prevBtn.disabled = currentQueue.length <= 1;
            prevBtn.style.opacity = currentQueue.length <= 1 ? '0.5' : '1';
        }
        if (nextBtn) {
            nextBtn.disabled = currentQueue.length <= 1;
            nextBtn.style.opacity = currentQueue.length <= 1 ? '0.5' : '1';
        }
    }

    function playFromQueue(index) {
        if (index < 0 || index >= currentQueue.length) return;
        
        fetch(`/queue/${roomId}/play/${index}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
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
            headers: {
                'Content-Type': 'application/json'
            }
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

    // Send reorder request to server
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
                // On failure, request full queue refresh (server will emit queue_update)
                socket.emit('request_queue_refresh', { room: roomId });
            }
        })
        .catch(err => {
            console.error('Error sending reorder request:', err);
            // Try to refresh queue state from server
            socket.emit('request_queue_refresh', { room: roomId });
        });
    }

    function nextSong() {
    lastChangeDirection = 'next';
    manualDirection = 'next';
    triggerFullscreenColorSlide('next');
        socket.emit('next_song', { room: roomId, auto_play: false });
    }

    function previousSong() {
    lastChangeDirection = 'prev';
    manualDirection = 'prev';
    triggerFullscreenColorSlide('prev');
        socket.emit('previous_song', { room: roomId });
    }

    function triggerSlideAnimation(direction) {
        // Handle fullscreen mode
        if (document.body.classList.contains('fullscreen-mode')) {
            triggerFullscreenColorSlide(direction);
            return;
        }

        // Original logic for non-fullscreen mode
        const coverSection = document.querySelector('.cover-section');
        if (!coverSection) return;

        // Remove any existing animation classes
        coverSection.classList.remove('slide-next-in', 'slide-next-out', 'slide-prev-in', 'slide-prev-out');
        
        // Trigger the exit animation
        if (direction === 'next') {
            coverSection.classList.add('slide-next-out');
        } else {
            coverSection.classList.add('slide-prev-out');
        }

        // After the animation completes, we'll trigger the in animation when the new song loads
        setTimeout(() => {
            coverSection.classList.remove('slide-next-out', 'slide-prev-out');
        }, 400); // Match animation duration
    }

    function triggerSlideInAnimation(direction) {
        // Handle fullscreen mode
        if (document.body.classList.contains('fullscreen-mode')) {
            triggerFullscreenColorSlideIn(direction);
            return;
        }

        // Original logic for non-fullscreen mode
        const coverSection = document.querySelector('.cover-section');
        if (!coverSection) return;

        // Remove any existing animation classes
        coverSection.classList.remove('slide-next-in', 'slide-next-out', 'slide-prev-in', 'slide-prev-out');
        
        // Small delay to ensure clean start
        setTimeout(() => {
            if (direction === 'next') {
                coverSection.classList.add('slide-next-in');
            } else {
                coverSection.classList.add('slide-prev-in');
            }

            // Clean up animation class after completion
            setTimeout(() => {
                coverSection.classList.remove('slide-next-in', 'slide-prev-in');
            }, 400);
        }, 50);
    }

    function triggerFullscreenColorSlide(direction) {
        // Only trigger in fullscreen mode
        if (!document.body.classList.contains('fullscreen-mode')) {
            console.log('Not in fullscreen mode, using regular slide animation');
            triggerSlideAnimation(direction);
            return;
        }

        console.log(`Triggering fullscreen color slide: ${direction}`);
    const overlay = document.getElementById('fullscreen-color-slide-overlay');
    const coverSection = document.querySelector('.cover-section');
        if (!overlay) {
            console.log('Fullscreen overlay not found');
            return;
        }

    // Remove any existing classes
    overlay.classList.remove('slide-from-right', 'slide-from-left', 'slide-in', 'slide-out-right', 'slide-out-left', 'stay-background');
        if (coverSection) {
            coverSection.classList.remove('fullscreen-cover-next-in', 'fullscreen-cover-prev-in');
        }
        
        // Set the starting position based on direction
        if (direction === 'next') {
            overlay.classList.add('slide-from-right');
            console.log('Set slide from right');
        } else {
            overlay.classList.add('slide-from-left');
            console.log('Set slide from left');
        }

    // Store the direction for when the new song loads
    overlay.setAttribute('data-slide-direction', direction);
    }

    function triggerFullscreenColorSlideIn(direction) {
        // Only work in fullscreen mode
        if (!document.body.classList.contains('fullscreen-mode')) {
            return;
        }

        const overlay = document.getElementById('fullscreen-color-slide-overlay');
        if (!overlay) return;

        // Get stored direction, manual override takes precedence
        let slideDirection = overlay.getAttribute('data-slide-direction') || direction;
        if (manualDirection && slideDirection !== manualDirection) {
            console.log('[DIR] Overriding stored direction', slideDirection, 'with manualDirection', manualDirection);
            slideDirection = manualDirection;
        }
        
    // Function to apply the color slide animation
        const applyColorSlide = () => {
            if (currentDominantColor) {
                const [r, g, b] = currentDominantColor;
                const shades = getSecondaryColorOrShades(currentDominantColor, currentColorPalette);
                
                // Create body background gradient for the new theme
                // Solid color (use darker shade) instead of gradient in fullscreen
                const bodySolid = `rgb(${shades.dark.r}, ${shades.dark.g}, ${shades.dark.b})`;
                overlay.style.background = bodySolid;

                // Prepare overlay: snap to start position without transition to prevent edge stutter
                overlay.classList.add('no-transition');
                overlay.classList.remove('slide-in', 'slide-from-left', 'slide-from-right');
                if (slideDirection === 'next') {
                    overlay.classList.add('slide-from-right');
                } else {
                    overlay.classList.add('slide-from-left');
                }
                // Force reflow so the browser recognizes the starting transform
                void overlay.offsetWidth;

                // Small delay to ensure CSS is applied, then start animation
                setTimeout(() => {
                    // Trigger the cover slide in the same direction as overlay
                    const coverSection = document.querySelector('.cover-section');
                    if (coverSection) {
                        coverSection.classList.remove('fullscreen-cover-next-in', 'fullscreen-cover-prev-in');
                        if (slideDirection === 'next') {
                            coverSection.classList.add('fullscreen-cover-next-in');
                        } else {
                            coverSection.classList.add('fullscreen-cover-prev-in');
                        }
                    }

                    // Enable transition and start overlay slide
                    overlay.classList.remove('no-transition');
                    // Force reflow again to apply transition state cleanly
                    void overlay.offsetWidth;
                    overlay.classList.add('slide-in');

                    // After slide-in completes, keep it in place (no slide-out)
                    setTimeout(() => {
                        // Finalize: set body background to match the new theme after the slide finishes
                        if (document.body.classList.contains('fullscreen-mode')) {
                            document.body.style.background = bodySolid;
                        }

                        // Lock overlay in place behind UI
                        overlay.classList.remove('slide-in', 'slide-from-left', 'slide-from-right');
                        overlay.classList.add('stay-background');
                        overlay.removeAttribute('data-slide-direction');
                        manualDirection = null; // consume after use
                        // Reset transform state for the next run
                        // Keep stay-background but ensure no lingering transition state
                        overlay.classList.add('no-transition');
                        void overlay.offsetWidth;
                        overlay.classList.remove('no-transition');
                        // Clean cover slide helper classes after animation completes
                        const coverSection2 = document.querySelector('.cover-section');
                        if (coverSection2) {
                            coverSection2.classList.remove('fullscreen-cover-next-in', 'fullscreen-cover-prev-in');
                        }
                    }, 800); // Wait for slide-in to complete (matches CSS 0.8s)
                }, 50);
            } else {
                console.log('No dominant color available for slide animation');
            }
        };

        // If colors are already available, apply immediately
        if (currentDominantColor) {
            applyColorSlide();
        } else {
            // Wait for colors to be extracted, then apply
            let attempts = 0;
            const maxAttempts = 40; // 2 seconds max wait
            const checkColors = setInterval(() => {
                attempts++;
                if (currentDominantColor) {
                    clearInterval(checkColors);
                    applyColorSlide();
                } else if (attempts >= maxAttempts) {
                    clearInterval(checkColors);
                    console.log('Timeout waiting for color extraction');
                }
            }, 50);
        }
    }

    // ===============================
// Fullscreen Toggle Button Logic
// ===============================
function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().then(() => {
            document.body.classList.add('fullscreen-mode');
            // If we already have a dominant color, apply complete theme and solid background immediately
            if (currentDominantColor) {
                applyTheme(currentDominantColor, currentColorPalette);
                const [r,g,b] = currentDominantColor;
                document.body.style.background = `rgb(${r}, ${g}, ${b})`;
                // Ensure text is visible in fullscreen - delay to allow DOM updates
                setTimeout(() => {
                    ensureFullscreenContrast();
                }, 100);
            }

            // Ensure overlay is visible (clear inline none set on exit) and trigger a slide-in
            const overlay = document.getElementById('fullscreen-color-slide-overlay');
            if (overlay) {
                overlay.style.display = ''; // allow CSS to control visibility in fullscreen-mode
                overlay.classList.remove('stay-background');
                const dir = lastChangeDirection || 'next';
                triggerFullscreenColorSlide(dir);
                // Small delay to ensure prep applied, then animate in
                setTimeout(() => {
                    triggerFullscreenColorSlideIn(dir);
                }, 80);
            }
        });
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen().then(() => {
                // Remove fullscreen mode class when exiting fullscreen
                document.body.classList.remove('fullscreen-mode');
                
                // Hide fullscreen lyrics when exiting fullscreen
                if (isFullscreenLyricsVisible) {
                    hideFullscreenLyrics();
                }
                
                // Reset background to default when exiting fullscreen
                document.body.style.background = 'linear-gradient(135deg, var(--background-color-start), var(--background-color-end))';

                // Clean up any fullscreen overlay
                const overlay = document.getElementById('fullscreen-color-slide-overlay');
                if (overlay) {
                    overlay.classList.remove('slide-from-right', 'slide-from-left', 'slide-in', 'slide-out-right', 'slide-out-left', 'stay-background');
                    overlay.style.background = '';
                    overlay.style.display = 'none';
                    overlay.removeAttribute('data-slide-direction');
                    // Force reflow to ensure background changes take effect immediately
                    void document.body.offsetWidth;
                }
                const coverSection = document.querySelector('.cover-section');
                if (coverSection) {
                    coverSection.classList.remove('fullscreen-cover-next-in', 'fullscreen-cover-prev-in');
                }
                // Reapply theme immediately so gradient appears without requiring user interaction
                updateThemeForPlayingState();
            });
        }
    }
}

// Listen for fullscreen changes to handle ESC key or other exits
document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) {
        // Exited fullscreen, remove the mode class
        document.body.classList.remove('fullscreen-mode');
        
        // Hide fullscreen lyrics when exiting fullscreen mode
        if (isFullscreenLyricsVisible) {
            hideFullscreenLyrics();
        }
        
        // Reset background to default when exiting fullscreen
        document.body.style.background = 'linear-gradient(135deg, var(--background-color-start), var(--background-color-end))';
        
        // Clean up any fullscreen overlay
        const overlay = document.getElementById('fullscreen-color-slide-overlay');
        if (overlay) {
            overlay.classList.remove('slide-from-right', 'slide-from-left', 'slide-in', 'slide-out-right', 'slide-out-left', 'stay-background');
            overlay.style.background = '';
            overlay.style.display = 'none';
            overlay.removeAttribute('data-slide-direction');
            // Force reflow to ensure background changes take effect immediately
            void document.body.offsetWidth;
        }
        const coverSection = document.querySelector('.cover-section');
        if (coverSection) {
            coverSection.classList.remove('fullscreen-cover-next-in', 'fullscreen-cover-prev-in');
        }
        // Ensure theme is re-applied so gradient shows immediately
        updateThemeForPlayingState();
    } else {
        // Entered fullscreen, add the mode class and set solid background
        document.body.classList.add('fullscreen-mode');
        if (currentDominantColor) {
            // Apply complete theme including solid background for fullscreen
            applyTheme(currentDominantColor, currentColorPalette);
            const [r,g,b] = currentDominantColor;
            document.body.style.background = `rgb(${r}, ${g}, ${b})`;
        }

        // Ensure overlay is visible and trigger slide animation
        const overlay2 = document.getElementById('fullscreen-color-slide-overlay');
        if (overlay2) {
            overlay2.style.display = '';
            overlay2.classList.remove('stay-background');
            const dir2 = lastChangeDirection || 'next';
            triggerFullscreenColorSlide(dir2);
            setTimeout(() => {
                triggerFullscreenColorSlideIn(dir2);
            }, 80);
        }
    }
});

const fullscreenBtn = document.getElementById('fullscreen-btn');
if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', toggleFullscreen);
}
// ===============================
// Fullscreen Idle Hide/Show Logic
// ===============================
let fullscreenIdleTimer = null;
let isPlayerHidden = false;
const FULLSCREEN_IDLE_TIMEOUT = 2500; // ms

function showPlayerBox() {
    const customPlayer = document.querySelector('.custom-player');
    const progressBarContainer = document.querySelector('.progress-bar-container');
    const playerTimeDisplay = document.querySelector('.player-time-display');
    // Leaving idle state
    document.body.classList.remove('fullscreen-idle');
    if (customPlayer) customPlayer.classList.remove('fullscreen-hide');
    if (progressBarContainer) {
        progressBarContainer.classList.remove('progress-bar-only');
        // Only move progress bar if it's not already in the correct position
        if (!customPlayer.contains(progressBarContainer)) {
            // Insert after player-time-display, which is the correct position
            if (playerTimeDisplay && playerTimeDisplay.nextSibling) {
                customPlayer.insertBefore(progressBarContainer, playerTimeDisplay.nextSibling);
            } else {
                // Fallback: insert before main-player-row
                const mainPlayerRow = customPlayer.querySelector('.main-player-row');
                if (mainPlayerRow) {
                    customPlayer.insertBefore(progressBarContainer, mainPlayerRow);
                } else {
                    customPlayer.appendChild(progressBarContainer);
                }
            }
        }
    }
    isPlayerHidden = false;
}

function hidePlayerBox() {
    if (!document.body.classList.contains('fullscreen-mode')) return;
    
    // Don't hide player controls when lyrics are visible
    if (isFullscreenLyricsVisible) return;
    
    const customPlayer = document.querySelector('.custom-player');
    const progressBarContainer = document.querySelector('.progress-bar-container');
    // Entering idle state
    document.body.classList.add('fullscreen-idle');
    if (customPlayer) customPlayer.classList.add('fullscreen-hide');
    if (progressBarContainer) {
        progressBarContainer.classList.add('progress-bar-only');
        // Move progress bar outside of custom player to keep it visible
        document.body.appendChild(progressBarContainer);
    }
    isPlayerHidden = true;
}

function resetFullscreenIdleTimer() {
    if (!document.body.classList.contains('fullscreen-mode')) return;
    
    // Don't start idle timer when lyrics are visible
    if (isFullscreenLyricsVisible) {
        showPlayerBox();
        return;
    }
    
    showPlayerBox();
    if (fullscreenIdleTimer) clearTimeout(fullscreenIdleTimer);
    fullscreenIdleTimer = setTimeout(() => {
        hidePlayerBox();
    }, FULLSCREEN_IDLE_TIMEOUT);
}

// Only activate in fullscreen mode
document.addEventListener('mousemove', (e) => {
    if (document.body.classList.contains('fullscreen-mode')) {
        resetFullscreenIdleTimer();
    }
});
// Add touch events for mobile devices
document.addEventListener('touchstart', (e) => {
    if (document.body.classList.contains('fullscreen-mode')) {
        resetFullscreenIdleTimer();
    }
});
document.addEventListener('touchmove', (e) => {
    if (document.body.classList.contains('fullscreen-mode')) {
        resetFullscreenIdleTimer();
    }
});
document.addEventListener('touchend', (e) => {
    if (document.body.classList.contains('fullscreen-mode')) {
        resetFullscreenIdleTimer();
    }
});
document.addEventListener('fullscreenchange', () => {
    if (document.body.classList.contains('fullscreen-mode')) {
        resetFullscreenIdleTimer();
    } else {
    // Ensure idle class is cleared when exiting fullscreen
    document.body.classList.remove('fullscreen-idle');
            // Reset background to gradient when exiting fullscreen
            document.body.style.background = 'linear-gradient(135deg, var(--background-color-start), var(--background-color-end))';
            // Always restore progress bar when exiting fullscreen, regardless of state
            const customPlayer = document.querySelector('.custom-player');
            const progressBarContainer = document.querySelector('.progress-bar-container');
            const playerTimeDisplay = document.querySelector('.player-time-display');
            if (customPlayer) customPlayer.classList.remove('fullscreen-hide');
            if (progressBarContainer) {
                progressBarContainer.classList.remove('progress-bar-only');
                // Ensure progress bar is back in its proper position
                if (!customPlayer.contains(progressBarContainer)) {
                    // Insert after player-time-display, which is the correct position
                    if (playerTimeDisplay && playerTimeDisplay.nextSibling) {
                        customPlayer.insertBefore(progressBarContainer, playerTimeDisplay.nextSibling);
                    } else {
                        // Fallback: insert before main-player-row
                        const mainPlayerRow = customPlayer.querySelector('.main-player-row');
                        if (mainPlayerRow) {
                            customPlayer.insertBefore(progressBarContainer, mainPlayerRow);
                        } else {
                            customPlayer.appendChild(progressBarContainer);
                        }
                    }
                }
            }
            isPlayerHidden = false;
            if (fullscreenIdleTimer) clearTimeout(fullscreenIdleTimer);
            // Clean up overlay and force reflow & reapply theme
            const overlay2 = document.getElementById('fullscreen-color-slide-overlay');
            if (overlay2) {
                overlay2.classList.remove('slide-from-right', 'slide-from-left', 'slide-in', 'slide-out-right', 'slide-out-left', 'stay-background');
                overlay2.style.background = '';
                overlay2.style.display = 'none';
                overlay2.removeAttribute('data-slide-direction');
                // Force reflow to ensure background changes take effect immediately
                void document.body.offsetWidth;
            }
            updateThemeForPlayingState();
        }
    });

    // Event listeners for global lyrics cache management
    document.addEventListener('clearLyricsCache', () => {
        clearLyricsCache();
    });

    document.addEventListener('getLyricsCacheStats', () => {
        const stats = getLyricsCacheStats();
        console.log('Lyrics cache stats:', stats);
    });

    document.addEventListener('showFullscreenLyrics', () => {
        showFullscreenLyrics();
    });

    document.addEventListener('hideFullscreenLyrics', () => {
        hideFullscreenLyrics();
    });

    document.addEventListener('toggleFullscreenLyrics', () => {
        toggleFullscreenLyrics();
    });

    // Fullscreen lyrics overlay - no click-to-close functionality
    // Only ESC key and L key can close fullscreen lyrics
    if (fullscreenLyricsOverlay) {
        console.log('Fullscreen lyrics overlay initialized - click-to-close disabled');
        // Remove any existing click handlers by cloning the element
        const newOverlay = fullscreenLyricsOverlay.cloneNode(true);
        fullscreenLyricsOverlay.parentNode.replaceChild(newOverlay, fullscreenLyricsOverlay);

        // Re-assign the variables to the new, live elements in the DOM
        fullscreenLyricsOverlay = newOverlay;
        fullscreenLyricsContent = fullscreenLyricsOverlay.querySelector('.fullscreen-lyrics-content');
    }

    // Keyboard event handlers (inside DOMContentLoaded scope for function access)
    document.addEventListener('keydown', (e) => {
        if (document.body.classList.contains('fullscreen-mode')) {
            resetFullscreenIdleTimer();
            
            // Toggle lyrics with 'L' key in fullscreen mode
            if (e.key.toLowerCase() === 'l' && !e.ctrlKey && !e.altKey && !e.metaKey) {
                e.preventDefault();
                toggleFullscreenLyrics();
            }
            
            // Close lyrics with ESC key in fullscreen mode
            if (e.key === 'Escape' && isFullscreenLyricsVisible) {
                e.preventDefault();
                hideFullscreenLyrics();
            }
        } else {
            // Global ESC key handler for closing lyrics modal
            if (e.key === 'Escape' && lyricsModal && lyricsModal.style.display === 'flex') {
                e.preventDefault();
                lyricsModal.style.display = 'none';
                stopLyricsSync();
            }
        }
        
        // Global ESC key handler for closing fullscreen lyrics (works in all modes)
        if (e.key === 'Escape' && isFullscreenLyricsVisible) {
            e.preventDefault();
            hideFullscreenLyrics();
        }
    });

    // ===============================
    // Members List Functions
    // ===============================

    // State for members list
    let currentMembers = [];

    async function fetchAndDisplayMembers() {
        // Get membersList element dynamically in case it wasn't available during initialization
        const membersList = document.getElementById('members-list');
        
        if (!membersList) {
            console.error('membersList element not found');
            return;
        }

        // Show loading state
        membersList.innerHTML = '<p class="loading-members">Loading members...</p>';

        try {
            // Request member list from server
            console.log('Requesting member list for room:', roomId);
            console.log('roomId type:', typeof roomId);
            console.log('roomId value:', roomId);
            
            if (!roomId) {
                console.error('roomId is undefined or empty');
                showMembersError('Room ID not found. Please refresh the page.');
                return;
            }
            
            socket.emit('request_member_list', { room: roomId });
        } catch (error) {
            console.error('Error requesting member list:', error);
            showMembersError('Failed to load members. Please try again.');
        }
    }

    function showMembersError(message) {
        const membersList = document.getElementById('members-list');
        if (membersList) {
            membersList.innerHTML = `<p class="no-members">${message}</p>`;
        }
    }

    function updateMembersList(members) {
        const membersList = document.getElementById('members-list');
        if (!membersList) return;
        
        currentMembers = members || [];
        
        if (currentMembers.length === 0) {
            membersList.innerHTML = '<p class="no-members">No members in this room</p>';
            return;
        }

        const membersHTML = currentMembers.map((member, index) => {
            // Generate avatar icon based on operating system
            let avatarIcon = '<i class="fas fa-user"></i>'; // Default fallback
            if (member.os) {
                switch (member.os.toLowerCase()) {
                    case 'windows':
                        avatarIcon = '<i class="fab fa-windows"></i>';
                        break;
                    case 'android':
                        avatarIcon = '<i class="fab fa-android"></i>';
                        break;
                    case 'ios':
                        avatarIcon = '<i class="fab fa-apple"></i>';
                        break;
                    case 'macos':
                        avatarIcon = '<i class="fab fa-apple"></i>';
                        break;
                    case 'linux':
                        avatarIcon = '<i class="fab fa-linux"></i>';
                        break;
                    default:
                        avatarIcon = '<i class="fas fa-desktop"></i>';
                        break;
                }
            }
            
            const memberName = member.name || `User ${index + 1}`;
            
            // Calculate relative join time
            let joinTimeText = 'Unknown';
            if (member.joinTime) {
                const joinDate = new Date(member.joinTime);
                const now = new Date();
                const diffMs = now - joinDate;
                const diffSeconds = Math.floor(diffMs / 1000);
                const diffMinutes = Math.floor(diffSeconds / 60);
                const diffHours = Math.floor(diffMinutes / 60);
                const diffDays = Math.floor(diffHours / 24);
                
                if (diffSeconds < 60) {
                    joinTimeText = diffSeconds <= 5 ? 'Just joined' : `Joined ${diffSeconds} seconds ago`;
                } else if (diffMinutes < 60) {
                    joinTimeText = diffMinutes === 1 ? 'Joined 1 minute ago' : `Joined ${diffMinutes} minutes ago`;
                } else if (diffHours < 24) {
                    joinTimeText = diffHours === 1 ? 'Joined 1 hour ago' : `Joined ${diffHours} hours ago`;
                } else {
                    joinTimeText = diffDays === 1 ? 'Joined 1 day ago' : `Joined ${diffDays} days ago`;
                }
            }
            
            // Create device info string
            let deviceInfo = '';
            if (member.browser && member.os) {
                deviceInfo = `${member.browser} • ${member.os}`;
                if (member.deviceType && member.deviceType !== 'Desktop') {
                    deviceInfo += ` • ${member.deviceType}`;
                }
            }
            
            // Create host badge if this member is the host
            const hostBadge = member.is_host ? '<div class="member-host-badge"></div>' : '';
            
            return `
                <div class="member-item">
                    <div class="member-avatar">${avatarIcon}</div>
                    <div class="member-info">
                        <div class="member-name">${memberName}</div>
                        <div class="member-device">${deviceInfo}</div>
                        <div class="member-status online">${joinTimeText}</div>
                    </div>
                    ${hostBadge}
                </div>
            `;
        }).join('');

        // Get membersList again to ensure it's current
        const membersListElement = document.getElementById('members-list');
        if (membersListElement) {
            membersListElement.innerHTML = membersHTML;
        }
    }

    // Listen for member list updates from server
    socket.on('member_list_update', (data) => {
        console.log('Received member list update:', data);
        if (data.members) {
            updateMembersList(data.members);
        }
    });

    // Listen for individual member join/leave events
    socket.on('member_joined', (data) => {
        console.log('Member joined:', data);
        // Refresh member list if modal is open
        if (membersModal && membersModal.style.display === 'flex') {
            fetchAndDisplayMembers();
        }
    });

    socket.on('member_left', (data) => {
        console.log('Member left:', data);
        // Refresh member list if modal is open
        if (membersModal && membersModal.style.display === 'flex') {
            fetchAndDisplayMembers();
        }
    });

    // Listen for host change events
    socket.on('host_changed', (data) => {
        console.log('Host changed:', data);
        // Refresh member list to update host badges
        if (membersModal && membersModal.style.display === 'flex') {
            fetchAndDisplayMembers();
        }
        // Optionally show a notification about the host change
        // You could add a toast notification here if desired
    });

    // ===============================
    // Search Functionality
    // ===============================
    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');
    const searchModal = document.getElementById('search-modal');
    const searchResults = document.getElementById('search-results');
    const closeSearch = document.getElementById('close-search');

    if (searchInput && searchBtn && searchModal && searchResults) {
        // --- Comprehensive Search Safeguards ---
        console.log('[DEBUG] Initializing search with comprehensive safeguards.');

        // 1. State variables to control search execution
        let lastSearchTime = 0;
        let searchInProgress = false;
        let userHasInteracted = false; // Becomes true only on focus/click
        let pageReady = false;

        // 2. Set input to be completely inert on load
        searchInput.value = '';
        searchInput.setAttribute('autocomplete', 'off');
        searchInput.setAttribute('autocorrect', 'off');
        searchInput.setAttribute('autocapitalize', 'off');
        searchInput.setAttribute('spellcheck', 'false');
        
        // 3. Set a delay after page load before allowing any search-related activity
        setTimeout(() => {
            pageReady = true;
            console.log('[DEBUG] Page is ready. Search can be enabled by user interaction.');
        }, 2000); // 2-second "cool-down" period after page load

        function openSearchModal() { searchModal.style.display = 'flex'; }
        function closeSearchModal() { searchModal.style.display = 'none'; }

        async function doSearch(q) {
            // --- Multi-layer validation before fetching ---
            const now = Date.now();
            if (!pageReady || !userHasInteracted || searchInProgress || (now - lastSearchTime < 1500)) {
                console.log(`[DEBUG] Search blocked. Conditions: pageReady=${pageReady}, userHasInteracted=${userHasInteracted}, searchInProgress=${searchInProgress}, timeSinceLast=${now - lastSearchTime}`);
                return;
            }
            
            const trimmedQuery = q.trim();
            if (trimmedQuery.length === 0) {
                console.log('[DEBUG] Search skipped: Query is empty.');
                return;
            }

            console.log(`[DEBUG] Executing search for: "${trimmedQuery}"`);
            lastSearchTime = now;
            searchInProgress = true;
            searchResults.innerHTML = '<p class="loading-members">Searching...</p>';

            try {
                const res = await fetch(`/search_ytmusic?q=${encodeURIComponent(trimmedQuery)}&limit=5`);
                const data = await res.json();

                if (!data.success) {
                    searchResults.innerHTML = `<p class="no-members">${data.error || 'Search failed'}</p>`;
                    return;
                }

                if (data.results && data.results.length > 0) {
                    let html = '';
                    data.results.forEach((result, index) => {
                        const md = result.metadata || {};
                        const duration = md.duration ? formatDuration(md.duration) : '';
                        html += `
                            <div class="search-result-item" style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.1);">
                                <img src="${md.image || ''}" style="width:60px;height:60px;object-fit:cover;border-radius:6px;display:${md.image ? 'block' : 'none'}" />
                                <div style="flex:1;min-width:0;">
                                    <div style="font-weight:600;font-size:0.95rem;margin-bottom:2px;">${md.title || 'Unknown'}</div>
                                    <div style="color:rgba(255,255,255,0.7);font-size:0.85rem;">${md.artist || 'Unknown'}</div>
                                </div>
                                <button class="download-btn control-button" data-index="${index}">Add</button>
                            </div>`;
                    });
                    searchResults.innerHTML = html;
                    // Add event listeners after rendering results
                    document.querySelectorAll('.download-btn').forEach(btn => {
                        btn.addEventListener('click', async (e) => {
                            const index = parseInt(e.target.getAttribute('data-index'));
                            const result = data.results[index];
                            e.target.textContent = 'Adding...';
                            e.target.disabled = true;
                            await downloadAndAddToQueue(result);
                            e.target.textContent = 'Added!';
                            setTimeout(() => {
                                e.target.textContent = 'Add';
                                e.target.disabled = false;
                            }, 2000);
                        });
                    });
                } else {
                    searchResults.innerHTML = '<p class="no-members">No results found</p>';
                }
            } catch (err) {
                console.error('Search fetch error:', err);
                searchResults.innerHTML = '<p class="no-members">An error occurred.</p>';
            } finally {
                searchInProgress = false;
            }
        }

        async function downloadAndAddToQueue(result) {
            try {
                await fetch('/add_to_queue', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        room: roomId,
                        proxy_id: result.proxy_id,
                        metadata: result.metadata,
                        video_id: result.video_id
                    })
                });
            } catch (err) {
                console.error('Failed to add song to queue:', err);
            }
        }

        function formatDuration(seconds) {
            if (!seconds) return '';
            const mins = Math.floor(seconds / 60);
            const secs = Math.round(seconds % 60);
            return `${mins}:${secs.toString().padStart(2, '0')}`;
        }

        // --- Event Listeners: The only entry points for search ---

        // Enable search ONLY when the user focuses or clicks the input
        searchInput.addEventListener('focus', () => {
            if (pageReady) {
                userHasInteracted = true;
                console.log('[DEBUG] User interaction confirmed. Search is now enabled.');
            }
        });

        // Handle search button click
        searchBtn.addEventListener('click', () => {
            openSearchModal();
            doSearch(searchInput.value);
            searchInput.value = ''; // Clear input after search
        });

        // Handle 'Enter' key in search input
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault(); // Prevent any default form submission
                openSearchModal();
                doSearch(searchInput.value);
                searchInput.value = ''; // Clear input after search
            }
        });

        // Block any form submission events directly
        if (searchInput.form) {
            searchInput.form.addEventListener('submit', (e) => {
                e.preventDefault();
                console.log('[DEBUG] Form submission explicitly blocked.');
            });
        }
        
        if (closeSearch) closeSearch.addEventListener('click', closeSearchModal);
    }
});

// Global lyrics cache management functions (accessible from console)
window.lyricsCache = {
    clear: function() {
        // Access the functions from within the DOMContentLoaded scope
        const clearEvent = new CustomEvent('clearLyricsCache');
        document.dispatchEvent(clearEvent);
        console.log('Lyrics cache cleared');
    },
    stats: function() {
        const statsEvent = new CustomEvent('getLyricsCacheStats');
        document.dispatchEvent(statsEvent);
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

// Global fullscreen lyrics functions (accessible from console)
window.fullscreenLyrics = {
    show: function() {
        if (document.body.classList.contains('fullscreen-mode')) {
            const showEvent = new CustomEvent('showFullscreenLyrics');
            document.dispatchEvent(showEvent);
        } else {
            console.log('Fullscreen lyrics only available in fullscreen mode');
        }
    },
    hide: function() {
        const hideEvent = new CustomEvent('hideFullscreenLyrics');
        document.dispatchEvent(hideEvent);
    },
    toggle: function() {
        if (document.body.classList.contains('fullscreen-mode')) {
            const toggleEvent = new CustomEvent('toggleFullscreenLyrics');
            document.dispatchEvent(toggleEvent);
        } else {
            console.log('Fullscreen lyrics only available in fullscreen mode. Press L key in fullscreen to toggle lyrics.');
        }
    }
};

// Ensures text and background colors are not too similar in fullscreen
function ensureFullscreenContrast() {
    if (!document.body.classList.contains('fullscreen-mode')) return;
    console.log('Checking fullscreen contrast...');
    const mainHeading = document.querySelector('.main-heading'); // This is the "Audioflow" heading
    const songTitleText = document.querySelector('#song-title');
    const songArtistText = document.querySelector('#song-artist');
    const roomCodeDisplay = document.querySelector('.room-code-display');
    const audioflowHeading = document.querySelector('h1.main-heading'); // More specific selector
    const memberCount = document.querySelector('.member-count'); // Member count element
    const bodyBg = window.getComputedStyle(document.body).backgroundColor;
    console.log('Body background color:', bodyBg);
    
    const bgBrightness = getCssColorBrightness(bodyBg);
    const contrastColor = bgBrightness > 128 ? 'black' : 'white';
    console.log(`Background brightness: ${bgBrightness}, using contrast color: ${contrastColor}`);
    
    // Force apply contrast color to ALL text elements regardless of similarity check
    [mainHeading, songTitleText, songArtistText, roomCodeDisplay, audioflowHeading, memberCount].forEach(el => {
        if (!el) return;
        console.log(`Force setting ${el.className || el.id || el.tagName} to ${contrastColor}`);
        el.style.setProperty('color', contrastColor, 'important');
        // Remove any conflicting attributes and CSS properties that might override
        el.removeAttribute('data-fixed-color');
        el.style.removeProperty('background');
        el.style.removeProperty('background-image');
        el.style.removeProperty('-webkit-background-clip');
        el.style.removeProperty('-webkit-text-fill-color');
        el.style.removeProperty('background-clip');
    });
    
    // Also handle room code span separately
    const roomCodeSpan = roomCodeDisplay?.querySelector('span');
    if (roomCodeSpan) {
        roomCodeSpan.style.setProperty('color', contrastColor, 'important');
        roomCodeSpan.removeAttribute('data-fixed-color');
    }
}

// Returns true if two CSS color strings are visually similar
function isColorSimilar(c1, c2) {
    const rgb1 = parseCssColor(c1);
    const rgb2 = parseCssColor(c2);
    if (!rgb1 || !rgb2) return false;
    // Use Euclidean distance in RGB space
    const dist = Math.sqrt(
        Math.pow(rgb1[0] - rgb2[0], 2) +
        Math.pow(rgb1[1] - rgb2[1], 2) +
        Math.pow(rgb1[2] - rgb2[2], 2)
    );
    return dist < 80; // threshold for similarity (increased from 60)
}

// Parses a CSS rgb/rgba color string to [r,g,b]
function parseCssColor(str) {
    if (!str) return null;
    const match = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (match) {
        return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
    }
    return null;
}

// Gets brightness of a CSS rgb/rgba color string
function getCssColorBrightness(str) {
    const rgb = parseCssColor(str);
    if (!rgb) return 255;
    return (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
}
