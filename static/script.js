document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements & Initial Setup ---
    const socket = io();
    const colorThief = new ColorThief();
    const player = document.getElementById('player');
    const audioInput = document.getElementById('audio-input');
    const uploadBtn = document.getElementById('upload-btn');
    const syncBtn = document.getElementById('sync-btn');
    const fileNameDisplay = document.getElementById('file-name');
    const fileNameText = document.getElementById('file-name-text');
    const coverArt = document.getElementById('cover-art');
    const controlButtons = document.querySelectorAll('.control-button');
    const coverDancingBarsLeft = document.querySelector('.cover-dancing-bars.left');
    const coverDancingBarsRight = document.querySelector('.cover-dancing-bars.right');

    // --- State & Configuration ---
    const roomId = document.body.dataset.roomId;
    let isReceivingUpdate = false;
    let userHasJustSeeked = false;
    let seekDebounceTimer = null;
    let pingInterval;
    let currentDominantColor = null;
    let themeUpdateTimeout;

    let serverTimeOffset = 0;

    const MAX_ALLOWED_DRIFT_S = 0.5;
    const PLAYBACK_RATE_ADJUST = 0.05;

    // --- Audio Visualizer Setup ---
    let audioContext = null;
    let analyser = null;
    let dataArray = null;
    let source = null;
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
                analyser = audioContext.createAnalyser();
                analyser.fftSize = 256; // Increased from 64 for better frequency resolution
                analyser.smoothingTimeConstant = 0.3; // Reduced from 0.8 for more responsiveness
                analyser.minDecibels = -90; // Lower threshold for quiet sounds
                analyser.maxDecibels = -10; // Higher threshold for loud sounds
                
                const bufferLength = analyser.frequencyBinCount;
                dataArray = new Uint8Array(bufferLength);
                
                console.log('Audio context initialized for visualizer with enhanced sensitivity');
            } catch (e) {
                console.error('Could not initialize audio context:', e);
            }
        }
    }

    function connectAudioSource() {
        if (audioContext && analyser && !source) {
            try {
                source = audioContext.createMediaElementSource(player);
                source.connect(analyser);
                source.connect(audioContext.destination);
                console.log('Audio source connected to visualizer');
            } catch (e) {
                console.error('Could not connect audio source:', e);
                // If source already exists, it might be disconnected, try to reconnect
                if (source) {
                    try {
                        source.connect(analyser);
                        source.connect(audioContext.destination);
                        console.log('Audio source reconnected to visualizer');
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
        if (audioContext && source && analyser) {
            try {
                // Check if context is suspended and resume if needed
                if (audioContext.state === 'suspended') {
                    audioContext.resume();
                }
                console.log('Audio connection verified after seek');
            } catch (e) {
                console.error('Error ensuring audio connection:', e);
            }
        } else {
            console.log('Reconnecting audio source: context:', !!audioContext, 'source:', !!source, 'analyser:', !!analyser);
            // Reconnect if something is missing
            connectAudioSource();
        }
    }

    function updateVisualizerBars() {
        if (!analyser || !dataArray) {
            console.log('Visualizer not running: analyser or dataArray missing');
            return;
        }
        
        analyser.getByteFrequencyData(dataArray);
        
        // Calculate overall audio loudness (RMS of all frequencies)
        const squaredSum = dataArray.reduce((sum, value) => sum + (value * value), 0);
        const rms = Math.sqrt(squaredSum / dataArray.length);
        
        // Normalize to 0-1 range
        const normalized = rms / 255;
        
        // Apply exponential curve for better small-signal response
        const exponential = Math.pow(normalized, 0.6); // Lower exponent = more sensitive
        
        // Amplify small signals
        const loudness = Math.min(1, exponential * 2.5); // 2.5x amplification
        
        // Map audio levels: 50% audio = 0% bar, 100% audio = 100% bar
        let barLevel = 0;
        if (loudness > 0.5) {
            // Audio is above 50%, map 50-100% audio to 0-100% bar height
            barLevel = (loudness - 0.5) / 0.5; // Maps 0.5-1.0 to 0.0-1.0
        }
        // If loudness <= 0.5, barLevel stays 0 (no animation)
        
        // Debug log every 60 frames (about once per second at 60fps)
        if (Math.random() < 0.016) { // ~1/60 chance
            console.log(`Audio loudness: ${(loudness * 100).toFixed(1)}%, bar level: ${(barLevel * 100).toFixed(1)}%`);
        }
        
        // Define max heights for each bar (different sizes for visual variety)
        const maxHeights = {
            bass: 120,   // Tallest bar (closest to image)
            mid: 80,     // Medium bar
            treble: 50   // Shortest bar (farthest from image)
        };
        
        // Define minimum heights (shown when no animation)
        const minHeights = {
            bass: 20,    // Minimum height for bass bar
            mid: 15,     // Minimum height for mid bar
            treble: 10   // Minimum height for treble bar
        };
        
        // Calculate heights: minimum + (barLevel * range)
        const bassHeight = minHeights.bass + (barLevel * (maxHeights.bass - minHeights.bass));
        const midHeight = minHeights.mid + (barLevel * (maxHeights.mid - minHeights.mid));
        const trebleHeight = minHeights.treble + (barLevel * (maxHeights.treble - minHeights.treble));
        
        // Update left bars (reverse order: bass closest to image)
        const leftBars = coverDancingBarsLeft.querySelectorAll('.bar');
        if (leftBars.length >= 3) {
            leftBars[2].style.height = `${bassHeight}px`;    // Bass (closest)
            leftBars[1].style.height = `${midHeight}px`;     // Mid
            leftBars[0].style.height = `${trebleHeight}px`;  // Treble (farthest)
        }
        
        // Update right bars (normal order: bass closest to image)
        const rightBars = coverDancingBarsRight.querySelectorAll('.bar');
        if (rightBars.length >= 3) {
            rightBars[0].style.height = `${bassHeight}px`;    // Bass (closest)
            rightBars[1].style.height = `${midHeight}px`;     // Mid
            rightBars[2].style.height = `${trebleHeight}px`;  // Treble (farthest)
        }
        
        // Continue animation while playing
        if (!player.paused) {
            animationId = requestAnimationFrame(updateVisualizerBars);
        } else {
            console.log('Visualizer stopped: player is paused');
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
    // User Action Event Listeners
    // =================================================================================

    if (uploadBtn && audioInput) {
        uploadBtn.addEventListener('click', () => audioInput.click());

        audioInput.addEventListener('change', () => {
            const file = audioInput.files[0];
            if (!file) return;

            fileNameText.textContent = `Uploading: ${file.name}`;
            const formData = new FormData();
            formData.append('audio', file);
            formData.append('room', roomId);

            fetch('/upload', { method: 'POST', body: formData })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        console.log('Upload successful. Waiting for new_file event.');
                    } else {
                        alert(data.error || 'Upload failed.');
                        fileNameText.textContent = 'Upload failed.';
                    }
                }).catch(error => {
                    alert('An unexpected error occurred during upload.');
                    console.error('Upload fetch error:', error);
                    fileNameText.textContent = 'Upload error.';
                });
        });
    }

    if (syncBtn) {
        syncBtn.addEventListener('click', () => {
            if (!player.src || player.src.endsWith('/null')) return;
            console.log('--- User initiated manual sync ---');
            socket.emit('sync', { room: roomId, time: player.currentTime });
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

    player.addEventListener('seeking', () => {
        // Pause visualizer during seeking to prevent conflicts
        if (animationId) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }
    });

    player.addEventListener('seeked', () => {
        if (isReceivingUpdate) return;
        
        // Ensure audio visualizer connection is maintained after seek
        ensureAudioConnection();
        
        // Restart visualizer if audio is playing
        if (!player.paused && !animationId) {
            updateVisualizerBars();
        }
        
        socket.emit('seek', { room: roomId, time: player.currentTime });
        userHasJustSeeked = true;
        clearTimeout(seekDebounceTimer);
        seekDebounceTimer = setTimeout(() => {
            userHasJustSeeked = false;
        }, 2000);
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
        setTimeout(() => { isReceivingUpdate = false; }, 150);
    });

    socket.on('new_file', (data) => {
        loadAudio(data.filename, data.cover);
    });

    socket.on('room_state', (data) => {
        if (data.current_file) {
            loadAudio(data.current_file, data.current_cover);
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
                
                setTimeout(() => player.play(), delay);
                setTimeout(() => { isReceivingUpdate = false; }, delay + 100);
            } else {
                player.currentTime = intendedTime;
                player.pause();
                hideCoverDancingBars();
                updateFileNameAnimation(); // Recalculate layout for paused state
            }
        }
    });

    socket.on('member_count_update', (data) => {
        updateMemberCount(data.count);
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

    // =================================================================================
    // UI & Theme Helper Functions
    // =================================================================================
    
    function loadAudio(filename, cover) {
        if (!filename) {
            fileNameText.textContent = "No file selected.";
            updateFileNameAnimation();
            return;
        }
        fileNameText.title = filename.replace(/_/g, " ");
        fileNameText.textContent = filename.replace(/_/g, " ");
        player.src = `/uploads/${filename}`;
        
        player.load();
        
        fileNameDisplay.classList.remove('playing');
        coverArt.style.boxShadow = 'none';
        hideCoverDancingBars();
        resetTheme();
        updateFileNameAnimation(); // Check for overflow and apply animation if needed for new file

        if (cover) {
            coverArt.src = `/uploads/${cover}`;
            coverArt.style.display = 'block';
            coverArt.onload = () => {
                try {
                    const dominantColor = colorThief.getColor(coverArt);
                    currentDominantColor = dominantColor;
                    const [r, g, b] = dominantColor;
                    coverArt.style.boxShadow = `0 0 15px rgba(${r},${g},${b},0.6), 0 0 35px rgba(${r},${g},${b},0.4)`;
                    applyTheme(dominantColor);
                } catch (e) {
                    resetTheme();
                }
            };
            coverArt.onerror = () => {
                coverArt.style.display = 'none';
                resetTheme();
            };
        } else {
            coverArt.src = '';
            coverArt.style.display = 'none';
            currentDominantColor = null;
            resetTheme();
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
    }

    function hideCoverDancingBars() {
        if (coverDancingBarsLeft) coverDancingBarsLeft.classList.remove('visible');
        if (coverDancingBarsRight) coverDancingBarsRight.classList.remove('visible');
        
        // Stop visualizer
        stopVisualizer();
    }

    function updateThemeForPlayingState() {
        clearTimeout(themeUpdateTimeout);
        themeUpdateTimeout = setTimeout(() => {
            if (currentDominantColor) {
                applyTheme(currentDominantColor);
            } else {
                resetTheme();
            }
        }, 60);
    }
    
    function getBrightness(r, g, b) {
        return (r * 299 + g * 587 + b * 114) / 1000;
    }

    function applyTheme(c) {
        const [r, g, b] = c;
        const isDarkColor = getBrightness(r, g, b) < 50;
        const textColor = getBrightness(r, g, b) > 140 ? '#000' : '#FFF';
        const gradient = `linear-gradient(90deg,rgb(${r},${g},${b}),rgb(${Math.min(255,r+40)},${Math.min(255,g+40)},${Math.min(255,b+40)}))`;

        if (fileNameDisplay.classList.contains('playing')) {
            if (isDarkColor) {
                fileNameDisplay.style.borderColor = 'var(--accent-color)';
                // Update CSS custom property for playing-pulse animation
                document.documentElement.style.setProperty('--current-border-color', 'var(--accent-color)');
            } else {
                fileNameDisplay.style.borderColor = `rgb(${r},${g},${b})`;
                // Update CSS custom property for playing-pulse animation
                document.documentElement.style.setProperty('--current-border-color', `rgb(${r},${g},${b})`);
            }
        } else {
            fileNameDisplay.style.borderColor = '';
            document.documentElement.style.removeProperty('--current-border-color');
        }

        if (isDarkColor) {
            controlButtons.forEach(e => {
                e.style.background = '';
                e.style.color = ''
            });
            if (fileNameDisplay.classList.contains('playing')) {
                document.querySelectorAll('.cover-dancing-bars .bar').forEach(bar => bar.style.background = 'var(--accent-color)');
                document.querySelectorAll('.cover-dancing-bars .bar').forEach(bar => bar.style.boxShadow = '0 0 8px var(--accent-color)');
            } else {
                document.querySelectorAll('.cover-dancing-bars .bar').forEach(bar => bar.style.background = '');
                document.querySelectorAll('.cover-dancing-bars .bar').forEach(bar => bar.style.boxShadow = '');
            }
            return;
        }

        controlButtons.forEach(e => {
            e.style.background = gradient;
            e.style.color = textColor
        });
        if (fileNameDisplay.classList.contains('playing')) {
            document.querySelectorAll('.cover-dancing-bars .bar').forEach(bar => bar.style.background = gradient);
            document.querySelectorAll('.cover-dancing-bars .bar').forEach(bar => bar.style.boxShadow = `0 0 8px rgb(${r},${g},${b})`);
        } else {
            document.querySelectorAll('.cover-dancing-bars .bar').forEach(bar => bar.style.background = '');
            document.querySelectorAll('.cover-dancing-bars .bar').forEach(bar => bar.style.boxShadow = '');
        }
    }

    function resetTheme() {
        controlButtons.forEach(e => {
            e.style.background = '';
            e.style.color = ''
        });
        document.querySelectorAll('.cover-dancing-bars .bar').forEach(bar => {
            bar.style.background = '';
            bar.style.boxShadow = '';
        });
        fileNameDisplay.style.borderColor = '';
        document.documentElement.style.removeProperty('--current-border-color');
        currentDominantColor = null;
    }

    function updateMemberCount(count) {
        const memberCountElement = document.querySelector('.member-count');
        if (memberCountElement) {
            memberCountElement.innerHTML = `<i class="fa-solid fa-user-group"></i> ${count}`;
            console.log(`Member count updated: ${count}`);
        }
    }
});
