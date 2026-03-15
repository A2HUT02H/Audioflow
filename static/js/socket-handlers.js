// =====================================================================
// AudioFlow - Socket Event Handlers Module
// =====================================================================

const AudioFlowSocketHandlers = (function() {
    // Private state
    let socket = null;
    let roomId = null;
    let player = null;
    let serverTimeOffset = 0;
    let pingInterval = null;
    let playbackHeartbeatInterval = null;
    let isReceivingUpdate = false;
    let currentSongFile = null;
    let lastQueueIndex = -1;
    let manualDirection = null;
    let lastChangeDirection = 'next';

    // DOM elements (will be set during init)
    let elements = {};

    function init(socketInstance, room, playerEl, domElements) {
        socket = socketInstance;
        roomId = room;
        player = playerEl;
        elements = domElements;

        setupSocketHandlers();
    }

    function setupSocketHandlers() {
        if (!socket) {
            console.error('Socket not initialized');
            return;
        }

        socket.on('connect', handleConnect);
        socket.on('disconnect', handleDisconnect);
        socket.on('scheduled_play', handleScheduledPlay);
        socket.on('pause', handlePause);
        socket.on('play', handlePlay);
        socket.on('new_file', handleNewFile);
        socket.on('room_state', handleRoomState);
        socket.on('member_count_update', handleMemberCountUpdate);
        socket.on('queue_update', handleQueueUpdate);
        socket.on('channel_mode_update', handleChannelModeUpdate);
        socket.on('error', handleError);
        socket.on('loop_state_update', handleLoopStateUpdate);
        socket.on('loop_restart', handleLoopRestart);
        socket.on('shuffle_state_update', handleShuffleStateUpdate);
    }

    function syncClock() {
        const t0 = Date.now();
        socket.emit('ping_for_time', { t0 }, (data) => {
            const t3 = Date.now();
            const serverTimestamp = data.server_ts * 1000;
            const rtt = t3 - t0;
            serverTimeOffset = serverTimestamp - t0 - rtt / 2;
        });
    }

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
            userAgent: userAgent.substring(0, 100)
        };
    }

    function handleConnect() {
        console.log('Connected! Joining room:', roomId);
        
        const deviceInfo = getDeviceInfo();
        console.log('Device info:', deviceInfo);
        
        socket.emit('join', { 
            room: roomId,
            deviceInfo: deviceInfo
        });
        
        syncClock();
        if (pingInterval) clearInterval(pingInterval);
        pingInterval = setInterval(syncClock, 15000);

        startPlaybackHeartbeat();
        
        // Initialize modules
        const Queue = window.AudioFlowQueue;
        const Members = window.AudioFlowMembers;
        const Player = window.AudioFlowPlayer;
        
        if (Queue) {
            Queue.updateQueueCount();
            Queue.updateMusicGrid();
        }
        if (Player) {
            Player.updateNextPrevButtons();
        }
        if (Members) {
            Members.fetchAndDisplayMembers();
        }
    }

    function handleDisconnect() {
        if (pingInterval) {
            clearInterval(pingInterval);
            pingInterval = null;
        }
        stopPlaybackHeartbeat();
    }

    function emitPlaybackHeartbeat() {
        if (!socket || !roomId || !player) return;

        const source = player.currentSrc || player.src || '';
        const hasMedia = !!(source && !source.endsWith('/null'));
        const currentTime = Number.isFinite(player.currentTime) ? player.currentTime : 0;
        const isPlaying = hasMedia && !player.paused && !player.ended;

        socket.emit('member_playback_heartbeat', {
            room: roomId,
            current_time: currentTime,
            is_playing: isPlaying,
            has_media: hasMedia
        });
    }

    function startPlaybackHeartbeat() {
        stopPlaybackHeartbeat();
        emitPlaybackHeartbeat();
        playbackHeartbeatInterval = setInterval(emitPlaybackHeartbeat, 1500);
    }

    function stopPlaybackHeartbeat() {
        if (playbackHeartbeatInterval) {
            clearInterval(playbackHeartbeatInterval);
            playbackHeartbeatInterval = null;
        }
    }

    function handleScheduledPlay(data) {
        isReceivingUpdate = true;
        const targetTimestamp = (data.target_timestamp * 1000) + serverTimeOffset;
        const delay = targetTimestamp - Date.now();
        player.currentTime = data.audio_time;
        
        if (elements.fileNameDisplay) {
            elements.fileNameDisplay.classList.add('playing');
        }
        
        const Fullscreen = window.AudioFlowFullscreen;
        const Theme = window.AudioFlowTheme;
        
        if (Fullscreen) {
            Fullscreen.showCoverDancingBars();
        }
        if (Theme) {
            Theme.updateThemeForPlayingState();
        }
        
        if (delay > 0) {
            setTimeout(() => player.play(), delay);
        } else {
            player.play();
        }
        
        setTimeout(() => { isReceivingUpdate = false; }, delay > 0 ? delay + 100 : 100);
    }

    function handlePause(data) {
        isReceivingUpdate = true;
        player.pause();
        player.playbackRate = 1.0;
        player.currentTime = data.time;
        
        if (elements.fileNameDisplay) {
            elements.fileNameDisplay.classList.remove('playing');
        }
        
        const Fullscreen = window.AudioFlowFullscreen;
        const Theme = window.AudioFlowTheme;
        
        if (Fullscreen) {
            Fullscreen.hideCoverDancingBars();
        }
        if (Theme) {
            Theme.updateThemeForPlayingState();
            if (document.body.classList.contains('fullscreen-mode')) {
                setTimeout(() => {
                    Theme.ensureFullscreenContrast();
                }, 200);
            }
        }

        emitPlaybackHeartbeat();
        
        setTimeout(() => { isReceivingUpdate = false; }, 150);
    }

    function handlePlay(data) {
        console.log('[DEBUG] Received play event from server');
        isReceivingUpdate = true;
        
        const Theme = window.AudioFlowTheme;
        const Fullscreen = window.AudioFlowFullscreen;
        const Lyrics = window.AudioFlowLyrics;
        
        player.play().then(() => {
            if (elements.fileNameDisplay) {
                elements.fileNameDisplay.classList.add('playing');
            }
            if (Fullscreen) {
                Fullscreen.showCoverDancingBars();
            }
            if (Theme) {
                Theme.updateThemeForPlayingState();
            }
            if (Lyrics) {
                Lyrics.startLyricsSync();
            }
            emitPlaybackHeartbeat();
        }).catch(err => {
            console.warn('Auto-play was prevented:', err);
        });
        
        setTimeout(() => { isReceivingUpdate = false; }, 150);
    }

    function handleNewFile(data) {
        console.log('[DEBUG] Received new_file event with data:', data);
        
        const Fullscreen = window.AudioFlowFullscreen;
        
        // Determine if this is actually a song change
        const incomingKey = data.filename || data.proxy_id || data.video_id || null;
        const isNewSong = currentSongFile && currentSongFile !== incomingKey;

        if (isNewSong) {
            if (!lastChangeDirection) lastChangeDirection = 'next';
            if (document.body.classList.contains('fullscreen-mode') && Fullscreen) {
                Fullscreen.triggerColorSlide(lastChangeDirection);
            }
            clearFixedColors();
        }

        currentSongFile = incomingKey;

        // Update player track info
        const newTitle = data.title || (data.filename_display || data.filename || 'Unknown').replace(/_/g, ' ').replace(/\.(mp3|wav|ogg|flac|m4a)$/i, '');
        const newArtist = data.artist || '';
        
        if (elements.playerTrackTitle) {
            elements.playerTrackTitle.textContent = newTitle;
            elements.playerTrackTitle.title = newTitle;
        }
        if (elements.playerTrackArtist) {
            if (newArtist) {
                elements.playerTrackArtist.textContent = newArtist;
                elements.playerTrackArtist.title = newArtist;
                elements.playerTrackArtist.style.display = 'block';
            } else {
                elements.playerTrackArtist.textContent = '';
                elements.playerTrackArtist.style.display = 'none';
            }
        }

        const displayFilename = data.filename_display || data.filename;
        
        // Call loadAudio through the global function
        if (typeof window.loadAudio === 'function') {
            window.loadAudio(
                data.filename,
                data.cover,
                displayFilename,
                data.title,
                data.artist,
                data.proxy_id,
                data.image_url,
                data
            );
        }
        
        const Theme = window.AudioFlowTheme;
        if (document.body.classList.contains('fullscreen-mode') && Theme) {
            setTimeout(() => {
                Theme.ensureFullscreenContrast();
            }, 500);
        }
    }

    function handleRoomState(data) {
        console.log('[DEBUG] Received room_state event with data:', data);
        
        const Player = window.AudioFlowPlayer;
        const Fullscreen = window.AudioFlowFullscreen;
        const Theme = window.AudioFlowTheme;
        
        // Synchronize loop and shuffle states
        if (data.hasOwnProperty('isLooping') && Player) {
            Player.setLooping(data.isLooping);
        }
        
        if (data.hasOwnProperty('is_shuffling') && Player) {
            Player.setShuffling(data.is_shuffling);
        }
        
        if (data.current_file || data.current_proxy_id) {
            const incomingKey = data.current_file || data.current_proxy_id || data.current_video_id || null;
            const isNewSong = currentSongFile && currentSongFile !== incomingKey;
            if (isNewSong) {
                if (!lastChangeDirection) lastChangeDirection = 'next';
                if (document.body.classList.contains('fullscreen-mode') && Fullscreen) {
                    Fullscreen.triggerColorSlide(lastChangeDirection);
                }
                clearFixedColors();
            }
            
            currentSongFile = incomingKey;
            
            const displayFilename = data.current_file_display || data.current_file;
            
            if (typeof window.loadAudio === 'function') {
                window.loadAudio(
                    data.current_file,
                    data.current_cover,
                    displayFilename,
                    data.current_title,
                    data.current_artist,
                    data.current_proxy_id,
                    data.current_image_url,
                    {
                        assigned_audio_role: data.current_assigned_audio_role || data.assigned_audio_role,
                        assigned_channel_mode: data.current_assigned_channel_mode || data.assigned_channel_mode,
                        selected_audio_variant: data.current_selected_audio_variant,
                        is_stem_track: data.current_is_stem_track,
                        mix_filenames: data.current_mix_filenames,
                        mix_covers: data.current_mix_covers
                    }
                );
            }
            
            let intendedTime = data.last_progress_s;
            if (data.is_playing) {
                const timeSinceUpdate = (Date.now() + serverTimeOffset) / 1000 - data.last_updated_at;
                intendedTime += timeSinceUpdate;
                const delay = 500;
                isReceivingUpdate = true;
                player.currentTime = intendedTime;
                
                if (elements.fileNameDisplay) {
                    elements.fileNameDisplay.classList.add('playing');
                }
                if (Fullscreen) {
                    Fullscreen.showCoverDancingBars();
                }
                if (Theme) {
                    Theme.updateThemeForPlayingState();
                }
                
                setTimeout(() => player.play(), delay);
                setTimeout(() => { isReceivingUpdate = false; }, delay + 100);
            } else {
                player.currentTime = intendedTime;
                player.pause();
                if (Fullscreen) {
                    Fullscreen.hideCoverDancingBars();
                }
            }

            if (document.body.classList.contains('fullscreen-mode') && lastChangeDirection && Fullscreen) {
                setTimeout(() => {
                    Fullscreen.triggerColorSlideIn(lastChangeDirection);
                    lastChangeDirection = null;
                }, 100);
            }
            
            if (document.body.classList.contains('fullscreen-mode') && Theme) {
                setTimeout(() => {
                    Theme.ensureFullscreenContrast();
                }, 600);
            }
        }
    }

    function handleMemberCountUpdate(data) {
        const badge = document.getElementById('members-badge-count') || document.querySelector('.member-count');
        if (badge) {
            badge.textContent = data.count;
        }
    }

    function handleChannelModeUpdate(data) {
        const mode = String((data && data.channel_mode) || 'stereo').toLowerCase();

        const Visualizer = window.AudioFlowVisualizer;
        if (Visualizer && typeof Visualizer.setChannelMode === 'function') {
            Visualizer.setChannelMode(mode);
        }
    }

    function handleQueueUpdate(data) {
        console.log('[DEBUG] Received queue_update:', data);
        
        const Queue = window.AudioFlowQueue;
        const Player = window.AudioFlowPlayer;
        const Theme = window.AudioFlowTheme;
        const Fullscreen = window.AudioFlowFullscreen;
        
        // Store queue data globally
        window.currentQueueData = {
            queue: data.queue || [],
            current_index: typeof data.current_index === 'number' ? data.current_index : parseInt(data.current_index, 10)
        };
        if (isNaN(window.currentQueueData.current_index)) {
            window.currentQueueData.current_index = -1;
        }
        
        const prevQueueLength = Queue ? Queue.getQueue().length : 0;
        const currentQueue = data.queue || [];
        const currentQueueIndex = typeof data.current_index === 'number' ? data.current_index : parseInt(data.current_index, 10);
        
        // Update queue module
        if (Queue) {
            Queue.setQueue(currentQueue, currentQueueIndex);
        }

        // Handle empty queue
        if (currentQueue.length === 0 || currentQueueIndex === -1) {
            player.pause();
            player.src = '';
            player.load();
            
            if (elements.songTitleElement) elements.songTitleElement.textContent = "No file selected";
            if (elements.songArtistElement) elements.songArtistElement.textContent = "";
            if (elements.fileNameDisplay) elements.fileNameDisplay.classList.remove('playing');
            
            if (Fullscreen) {
                Fullscreen.hideCoverDancingBars();
            }
            
            // Reset progress
            if (elements.progressFill) elements.progressFill.style.width = '0%';
            if (elements.progressHandle) elements.progressHandle.style.left = '0%';
            if (elements.currentTimeDisplay) elements.currentTimeDisplay.textContent = "0:00";
            if (elements.totalTimeDisplay) elements.totalTimeDisplay.textContent = "0:00";
            
            // Hide cover art
            if (elements.coverArt) {
                elements.coverArt.style.display = 'none';
                elements.coverArt.src = '';
            }
            if (elements.coverArtPlaceholder) {
                elements.coverArtPlaceholder.style.display = 'none';
                elements.coverArtPlaceholder.classList.remove('visible');
            }
            
            // Reset theme
            if (Theme) {
                Theme.resetTheme();
            }
            
            currentSongFile = null;
        }

        // Infer direction on queue index change
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
            }
        }
        
        lastQueueIndex = currentQueueIndex;
        
        // Update queue displays
        if (Queue) {
            Queue.updateQueueDisplay();
            Queue.updateQueueCount();
            Queue.updateMusicGrid();
        }
        if (Player) {
            Player.updateNextPrevButtons();
        }

        // Handle uploading state
        if (elements.fileNameDisplay && elements.fileNameDisplay.classList.contains('uploading') && currentQueue.length > prevQueueLength) {
            elements.fileNameDisplay.classList.remove('uploading');
            let item = currentQueue[currentQueueIndex];
            if (!item && currentQueue.length > 0) item = currentQueue[0];
            if (item) {
                const title = item.title || (item.filename_display || item.filename).replace(/_/g, ' ').replace(/\.(mp3|wav|ogg|flac|m4a)$/i, '');
                const artist = item.artist;
                if (elements.songTitleElement) {
                    elements.songTitleElement.textContent = title;
                    elements.songTitleElement.title = title;
                }
                if (elements.playerTrackTitle) {
                    elements.playerTrackTitle.textContent = title;
                    elements.playerTrackTitle.title = title;
                }
                if (artist) {
                    if (elements.songArtistElement) {
                        elements.songArtistElement.textContent = artist;
                        elements.songArtistElement.title = artist;
                        elements.songArtistElement.style.display = 'block';
                    }
                    if (elements.playerTrackArtist) {
                        elements.playerTrackArtist.textContent = artist;
                        elements.playerTrackArtist.title = artist;
                        elements.playerTrackArtist.style.display = 'block';
                    }
                } else {
                    if (elements.songArtistElement) {
                        elements.songArtistElement.textContent = "";
                        elements.songArtistElement.style.display = 'none';
                    }
                    if (elements.playerTrackArtist) {
                        elements.playerTrackArtist.textContent = '';
                        elements.playerTrackArtist.style.display = 'none';
                    }
                }
            }
        }
    }

    function handleError(data) {
        alert(data.message);
        window.location.href = '/';
    }

    function handleLoopStateUpdate(data) {
        console.log('Received loop state update:', data.isLooping);
        const Player = window.AudioFlowPlayer;
        if (Player) {
            Player.setLooping(data.isLooping);
        }
    }

    function handleLoopRestart(data) {
        console.log('Loop restart triggered by another device');
        isReceivingUpdate = true;
        player.currentTime = 0;
        
        if (elements.fileNameDisplay) {
            elements.fileNameDisplay.classList.add('playing');
        }
        
        const Fullscreen = window.AudioFlowFullscreen;
        const Theme = window.AudioFlowTheme;
        
        if (Fullscreen) {
            Fullscreen.showCoverDancingBars();
        }
        if (Theme) {
            Theme.updateThemeForPlayingState();
        }
        
        player.play();
        setTimeout(() => { isReceivingUpdate = false; }, 100);
    }

    function handleShuffleStateUpdate(data) {
        console.log('Received shuffle state update:', data.isShuffling);
        const Player = window.AudioFlowPlayer;
        if (Player) {
            Player.setShuffling(data.isShuffling);
        }
    }

    function clearFixedColors() {
        const mainHeading = document.querySelector('.main-heading');
        const roomCode = document.querySelector('.room-code-display');
        const songTitle = document.querySelector('#song-title');
        const songArtist = document.querySelector('#song-artist');
        
        if (mainHeading) mainHeading.removeAttribute('data-fixed-color');
        if (roomCode) {
            roomCode.removeAttribute('data-fixed-color');
            const span = roomCode.querySelector('span');
            if (span) span.removeAttribute('data-fixed-color');
        }
        if (songTitle) songTitle.removeAttribute('data-fixed-color');
        if (songArtist) songArtist.removeAttribute('data-fixed-color');
    }

    function setManualDirection(dir) {
        manualDirection = dir;
        lastChangeDirection = dir;
    }

    function isReceiving() {
        return isReceivingUpdate;
    }

    function setReceiving(value) {
        isReceivingUpdate = value;
    }

    function getServerTimeOffset() {
        return serverTimeOffset;
    }

    function getCurrentSongFile() {
        return currentSongFile;
    }

    function setCurrentSongFile(file) {
        currentSongFile = file;
    }

    // Public API
    return {
        init,
        syncClock,
        getDeviceInfo,
        setManualDirection,
        isReceiving,
        setReceiving,
        getServerTimeOffset,
        getCurrentSongFile,
        setCurrentSongFile
    };
})();

// Make it available globally
window.AudioFlowSocketHandlers = AudioFlowSocketHandlers;
