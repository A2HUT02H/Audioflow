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
    const fileNameDisplay = document.getElementById('file-name');
    const fileNameText = document.getElementById('file-name-text');
    const coverArt = document.getElementById('cover-art');
    const coverArtPlaceholder = document.getElementById('cover-art-placeholder');
    const controlButtons = document.querySelectorAll('.control-button');
    const coverDancingBarsLeft = document.querySelector('.cover-dancing-bars.left');
    const coverDancingBarsRight = document.querySelector('.cover-dancing-bars.right');

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
    let isLooping = false; // Loop state
    let isShuffling = false; // Shuffle state

    let serverTimeOffset = 0;

    // --- Queue State ---
    let currentQueue = [];
    let currentQueueIndex = -1;

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
        
        console.log('[SUCCESS] Custom player initialization completed successfully!');
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
            audioInput.click();
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
            fileNameText.textContent = `Uploading: ${truncatedName}`;
            
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
                        fileNameText.textContent = 'Upload failed.';
                    }
                }).catch(error => {
                    console.error('Upload fetch error:', error);
                    // Remove uploading class on error
                    fileNameDisplay.classList.remove('uploading');
                    alert('An unexpected error occurred during upload.');
                    fileNameText.textContent = 'Upload error.';
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
        socket.emit('play', { room: roomId, time: player.currentTime });
    });

    player.addEventListener('pause', () => {
        if (isReceivingUpdate || player.seeking) return;
        player.playbackRate = 1.0;
        fileNameDisplay.classList.remove('playing');
        hideCoverDancingBars();
        updateFileNameAnimation(); // Recalculate for paused state
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
                socket.emit('shuffle_next', { room: roomId, auto_play: true });
            } else {
                console.log('Normal mode, auto-playing next song from queue');
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
    // Socket.IO Event Handlers (Commands from Server)
    // =================================================================================

    socket.on('connect', () => {
        console.log('Connected! Joining room:', roomId);
        socket.emit('join', { room: roomId });
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
        
        // Use display filename if available, otherwise fallback to filename
        const displayFilename = data.filename_display || data.filename;
        console.log('[DEBUG] Final display filename for loadAudio:', JSON.stringify(displayFilename));
        loadAudio(data.filename, data.cover, displayFilename);
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
            // Use display filename if available, otherwise fallback to filename
            const displayFilename = data.current_file_display || data.current_file;
            loadAudio(data.current_file, data.current_cover, displayFilename);
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
        }
    });

    socket.on('member_count_update', (data) => {
        updateMemberCount(data.count);
    });

    socket.on('queue_update', (data) => {
        console.log('[DEBUG] Received queue_update:', data);
        const prevQueueLength = currentQueue.length;
        currentQueue = data.queue || [];
    currentQueueIndex = typeof data.current_index === 'number' ? data.current_index : parseInt(data.current_index, 10);
    if (isNaN(currentQueueIndex)) currentQueueIndex = -1;
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
                let displayName = item.filename_display || item.filename;
                fileNameText.textContent = displayName.replace(/_/g, ' ');
                fileNameText.title = displayName;
            }
        }
    });

    socket.on('server_sync', (data) => {
        if (userHasJustSeeked || player.paused || isReceivingUpdate || player.seeking) {
            return;
        }
        const timeSinceServerUpdate = ((Date.now() + serverTimeOffset) / 1000) - data.server_time;
        const serverProgress = data.audio_time + timeSinceServerUpdate;
        const clientProgress = player.currentTime;
        const drift = clientProgress - serverProgress;

        if (Math.abs(drift) > MAX_ALLOWED_DRIFT_S) {
            player.currentTime = serverProgress;
            player.playbackRate = 1.0;
        } else if (Math.abs(drift) > 0.08) {
            player.playbackRate = (drift > 0) ? 1.0 - PLAYBACK_RATE_ADJUST : 1.0 + PLAYBACK_RATE_ADJUST;
        } else {
            player.playbackRate = 1.0;
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
    
    function loadAudio(filename, cover, displayFilename = null) {
        console.log('[DEBUG] loadAudio called with filename:', JSON.stringify(filename));
        console.log('[DEBUG] loadAudio called with displayFilename:', JSON.stringify(displayFilename));
        console.log('[DEBUG] loadAudio filename type:', typeof filename);
        console.log('[DEBUG] loadAudio displayFilename type:', typeof displayFilename);
        
        if (!filename) {
            fileNameText.textContent = "No file selected.";
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
        
        // Use display filename if provided, otherwise use the regular filename
        let nameForDisplay = displayFilename || filename;
        
        console.log('[DEBUG] Name for display before processing:', JSON.stringify(nameForDisplay));
        
        // Don't modify the display name - use it exactly as received
        console.log('[DEBUG] Final display name:', JSON.stringify(nameForDisplay));
        console.log('[DEBUG] Display name contains Japanese:', /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(nameForDisplay));
        
        // Set the display text directly without modifications
        let finalDisplayText = nameForDisplay.replace(/_/g, " ");
        console.log('[DEBUG] Final display text:', JSON.stringify(finalDisplayText));
        
        fileNameText.title = finalDisplayText;
        fileNameText.textContent = finalDisplayText;
        player.src = `/uploads/${encodeURIComponent(filename)}`;
        player.load();
        fileNameDisplay.classList.remove('playing');
        coverArt.style.boxShadow = 'none';
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
                    
                    // Setup 3D tilt effect for cover art
                    setup3DTiltEffect(coverArt);
                } catch (e) {
                    resetTheme();
                    // Still setup tilt effect even if color extraction fails
                    setup3DTiltEffect(coverArt);
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
        
        // Apply container background
        const container = document.querySelector('.container');
        if (container) {
            container.style.background = containerGradient;
            container.style.backdropFilter = 'blur(12px)';
            container.style.webkitBackdropFilter = 'blur(12px)';
        }
        
        // Determine text and button colors based on brightness
        let textColor, buttonColor, buttonTextColor;
        if (isDarkColor) {
            // If extracted color is dark, use light version for text/buttons
            textColor = `rgb(${shades.light.r}, ${shades.light.g}, ${shades.light.b})`;
            buttonColor = `linear-gradient(90deg, rgb(${shades.light.r}, ${shades.light.g}, ${shades.light.b}), rgb(${Math.min(255, shades.light.r + 20)}, ${Math.min(255, shades.light.g + 20)}, ${Math.min(255, shades.light.b + 20)}))`;
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
        const fileNameText = document.querySelector('#file-name-text');
        
        if (mainHeading) {
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
            }
        }
        
        if (memberCount) memberCount.style.color = textColor;
        if (roomCodeDisplay) {
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
        if (fileNameText) fileNameText.style.color = textColor;
        
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
    }

    function resetTheme() {
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
        const fileNameText = document.querySelector('#file-name-text');
        
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
        if (fileNameText) fileNameText.style.color = '';
        
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
        const memberCountElement = document.querySelector('.member-count');
        if (memberCountElement) {
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

        const queueHTML = currentQueue.map((item, index) => {
            const isCurrentSong = Number(index) === Number(currentQueueIndex);
            const coverSrc = item.cover ? `/uploads/${item.cover}` : '';
            const coverDisplay = item.cover 
                ? `<img src="${coverSrc}" alt="Cover" class="queue-item-cover">` 
                : '<div class="queue-item-cover">🎵</div>';
            
            return `
                <div class="queue-item ${isCurrentSong ? 'current' : ''}" data-index="${index}">
                    ${coverDisplay}
                    <div class="queue-item-info">
                        <div class="queue-item-title">${item.filename_display || item.filename}</div>
                        <div class="queue-item-status">${isCurrentSong ? 'Now Playing' : `#${index + 1} in queue`}</div>
                    </div>
                    <div class="queue-item-actions">
                        <button class="queue-item-btn play-btn" data-index="${index}" title="Play">
                            <i class="fas fa-play"></i>
                        </button>
                        <button class="queue-item-btn remove-btn danger" data-index="${index}" title="Remove">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        queueList.innerHTML = queueHTML;

        // Add event listeners to queue item buttons
        queueList.querySelectorAll('.play-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(btn.dataset.index);
                playFromQueue(index);
            });
        });

        queueList.querySelectorAll('.remove-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(btn.dataset.index);
                removeFromQueue(index);
            });
        });

        // Add click listeners to queue items themselves
        queueList.querySelectorAll('.queue-item').forEach(item => {
            item.addEventListener('click', () => {
                const index = parseInt(item.dataset.index);
                playFromQueue(index);
            });
        });
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

    function nextSong() {
        socket.emit('next_song', { room: roomId, auto_play: false });
    }

    function previousSong() {
        socket.emit('previous_song', { room: roomId });
    }

    function updateFileNameAnimation() {
        if (!fileNameText || !fileNameDisplay) return;
        
        const containerWidth = fileNameDisplay.offsetWidth - 40; // Account for padding
        const textWidth = fileNameText.scrollWidth;
        
        // Remove existing classes
        fileNameText.classList.remove('long');
        fileNameDisplay.classList.remove('is-overflowing');
        
        // Reset animation styles
        fileNameText.style.removeProperty('--slide-duration');
        fileNameText.style.removeProperty('--slide-distance');
        
        if (textWidth > containerWidth) {
            // Text is overflowing, set up animation
            fileNameDisplay.classList.add('is-overflowing');
            fileNameText.classList.add('long');
            
            const slideDistance = -(textWidth - containerWidth + 20); // Extra space for smooth transition
            const duration = Math.max(8, Math.abs(slideDistance) / 10); // Increased divisor for faster animation
            
            fileNameText.style.setProperty('--slide-distance', `${slideDistance}px`);
            fileNameText.style.setProperty('--slide-duration', `${duration}s`);
        }
    }

// ===============================
// Fullscreen Toggle Button Logic
// ===============================
function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().then(() => {
            // Add fullscreen mode class when entering fullscreen
            document.body.classList.add('fullscreen-mode');
        });
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen().then(() => {
                // Remove fullscreen mode class when exiting fullscreen
                document.body.classList.remove('fullscreen-mode');
            });
        }
    }
}

// Listen for fullscreen changes to handle ESC key or other exits
document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) {
        // Exited fullscreen, remove the mode class
        document.body.classList.remove('fullscreen-mode');
    }
});

const fullscreenBtn = document.getElementById('fullscreen-btn');
if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', toggleFullscreen);
}
});
