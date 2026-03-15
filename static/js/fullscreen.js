// =====================================================================
// AudioFlow - Fullscreen Module
// =====================================================================

const AudioFlowFullscreen = (function() {
    // Private state
    let fullscreenIdleTimer = null;
    let isPlayerHidden = false;
    let manualDirection = null;
    let lastChangeDirection = 'next';
    
    // DOM elements
    let player = null;
    let socket = null;
    let roomId = null;

    // Constants
    const FULLSCREEN_IDLE_TIMEOUT = 2500; // ms

    function init(elements, socketInstance, room) {
        player = elements.player;
        socket = socketInstance;
        roomId = room;
        
        setupEventListeners();
    }

    function setupEventListeners() {
        // Fullscreen button
        const fullscreenBtn = document.getElementById('fullscreen-btn');
        if (fullscreenBtn) {
            fullscreenBtn.addEventListener('click', toggleFullscreen);
        }

        // Header fullscreen button (mobile duplicate)
        const headerFullscreenBtn = document.getElementById('header-fullscreen-btn');
        if (headerFullscreenBtn) {
            headerFullscreenBtn.addEventListener('click', toggleFullscreen);
        }

        // Mouse move for idle detection
        document.addEventListener('mousemove', () => {
            if (document.body.classList.contains('fullscreen-mode')) {
                resetIdleTimer();
            }
        });

        // Touch events for mobile devices
        document.addEventListener('touchstart', () => {
            if (document.body.classList.contains('fullscreen-mode')) {
                resetIdleTimer();
            }
        });

        document.addEventListener('touchmove', () => {
            if (document.body.classList.contains('fullscreen-mode')) {
                resetIdleTimer();
            }
        });

        document.addEventListener('touchend', () => {
            if (document.body.classList.contains('fullscreen-mode')) {
                resetIdleTimer();
            }
        });

        // Fullscreen change events
        document.addEventListener('fullscreenchange', handleFullscreenChange);
    }

    function toggleFullscreen() {
        const Theme = window.AudioFlowTheme;
        const Lyrics = window.AudioFlowLyrics;
        
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().then(() => {
                document.body.classList.add('fullscreen-mode');
                
                // If we already have a dominant color, apply complete theme and solid background immediately
                if (Theme) {
                    const colors = Theme.getCurrentColors();
                    if (colors.dominant) {
                        Theme.applyTheme(colors.dominant, colors.palette);
                        const [r, g, b] = colors.dominant;
                        document.body.style.background = `rgb(${r}, ${g}, ${b})`;
                        // Ensure text is visible in fullscreen - delay to allow DOM updates
                        setTimeout(() => {
                            Theme.ensureFullscreenContrast();
                        }, 100);
                    }
                }

                // Show dancing bars if music is playing (delay in fullscreen to wait for background slide)
                if (player && !player.paused) {
                    showCoverDancingBars(850); // Wait for 0.8s slide + small buffer
                }

                // Ensure overlay is visible and trigger a slide-in
                const overlay = document.getElementById('fullscreen-color-slide-overlay');
                if (overlay) {
                    overlay.style.display = ''; // allow CSS to control visibility in fullscreen-mode
                    overlay.classList.remove('stay-background');
                    const dir = lastChangeDirection || 'next';
                    triggerColorSlide(dir);
                    // Small delay to ensure prep applied, then animate in
                    setTimeout(() => {
                        triggerColorSlideIn(dir);
                    }, 80);
                }
            });
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen().then(() => {
                    // Disable player transition when exiting fullscreen
                    const customPlayer = document.querySelector('.custom-player');
                    if (customPlayer) {
                        customPlayer.classList.add('no-transition');
                        setTimeout(() => {
                            customPlayer.classList.remove('no-transition');
                        }, 50);
                    }
                    
                    // Remove fullscreen mode class when exiting fullscreen
                    document.body.classList.remove('fullscreen-mode');
                    
                    // Hide fullscreen lyrics when exiting fullscreen
                    if (Lyrics && Lyrics.isVisible()) {
                        Lyrics.hideFullscreenLyrics();
                    }
                    
                    // Reset background to default when exiting fullscreen
                    document.body.style.background = 'linear-gradient(135deg, var(--background-color-start), var(--background-color-end))';

                    // Clean up fullscreen overlay
                    cleanupOverlay();
                    
                    // Reapply theme immediately
                    if (Theme) {
                        Theme.updateThemeForPlayingState();
                    }
                });
            }
        }
    }

    function handleFullscreenChange() {
        const Theme = window.AudioFlowTheme;
        const Lyrics = window.AudioFlowLyrics;
        
        if (!document.fullscreenElement) {
            // Disable player transition when exiting fullscreen
            const customPlayer = document.querySelector('.custom-player');
            if (customPlayer) {
                customPlayer.classList.add('no-transition');
                setTimeout(() => {
                    customPlayer.classList.remove('no-transition');
                }, 50);
            }
            
            // Exited fullscreen, remove the mode class
            document.body.classList.remove('fullscreen-mode');
            document.body.classList.remove('fullscreen-idle');
            
            // Hide fullscreen lyrics when exiting fullscreen mode
            if (Lyrics && Lyrics.isVisible()) {
                Lyrics.hideFullscreenLyrics();
            }
            
            // Reset background to default when exiting fullscreen
            document.body.style.background = 'linear-gradient(135deg, var(--background-color-start), var(--background-color-end))';
            
            // Clean up overlay
            cleanupOverlay();
            
            // Restore progress bar
            restoreProgressBar();
            
            // Ensure theme is re-applied so gradient shows immediately
            if (Theme) {
                Theme.updateThemeForPlayingState();
            }
        } else {
            // Entered fullscreen, add the mode class and set solid background
            document.body.classList.add('fullscreen-mode');
            
            if (Theme) {
                const colors = Theme.getCurrentColors();
                if (colors.dominant) {
                    Theme.applyTheme(colors.dominant, colors.palette);
                    const [r, g, b] = colors.dominant;
                    document.body.style.background = `rgb(${r}, ${g}, ${b})`;
                }
            }

            // Ensure overlay is visible and trigger slide animation
            const overlay = document.getElementById('fullscreen-color-slide-overlay');
            if (overlay) {
                overlay.style.display = '';
                overlay.classList.remove('stay-background');
                const dir = lastChangeDirection || 'next';
                triggerColorSlide(dir);
                setTimeout(() => {
                    triggerColorSlideIn(dir);
                }, 80);
            }
        }
    }

    function cleanupOverlay() {
        const overlay = document.getElementById('fullscreen-color-slide-overlay');
        if (overlay) {
            overlay.classList.remove('slide-from-right', 'slide-from-left', 'slide-in', 'slide-out-right', 'slide-out-left', 'stay-background');
            overlay.style.background = '';
            overlay.style.display = 'none';
            overlay.removeAttribute('data-slide-direction');
            void document.body.offsetWidth; // Force reflow
        }
        
        const coverSection = document.querySelector('.cover-section');
        if (coverSection) {
            coverSection.classList.remove('fullscreen-cover-next-in', 'fullscreen-cover-prev-in');
        }
    }

    function restoreProgressBar() {
        const customPlayer = document.querySelector('.custom-player');
        const progressBarContainer = document.querySelector('.progress-bar-container');
        const progressBarRow = document.querySelector('.progress-bar-row');
        const totalTimeDisplay = document.getElementById('total-time');
        
        if (customPlayer) customPlayer.classList.remove('fullscreen-hide');
        if (progressBarContainer) {
            progressBarContainer.classList.remove('progress-bar-only');
            // Restore progress bar to its original parent (progress-bar-row)
            if (progressBarRow && !progressBarRow.contains(progressBarContainer)) {
                if (totalTimeDisplay) {
                    progressBarRow.insertBefore(progressBarContainer, totalTimeDisplay);
                } else {
                    progressBarRow.appendChild(progressBarContainer);
                }
            }
        }
    }

    function showPlayerBox() {
        const customPlayer = document.querySelector('.custom-player');
        const progressBarContainer = document.querySelector('.progress-bar-container');
        const progressBarRow = document.querySelector('.progress-bar-row');
        const totalTimeDisplay = document.getElementById('total-time');
        
        // Leaving idle state
        document.body.classList.remove('fullscreen-idle');
        if (customPlayer) customPlayer.classList.remove('fullscreen-hide');
        if (progressBarContainer) {
            progressBarContainer.classList.remove('progress-bar-only');
            // Restore progress bar to its original parent (progress-bar-row)
            if (progressBarRow && !progressBarRow.contains(progressBarContainer)) {
                if (totalTimeDisplay) {
                    progressBarRow.insertBefore(progressBarContainer, totalTimeDisplay);
                } else {
                    progressBarRow.appendChild(progressBarContainer);
                }
            }
        }
        isPlayerHidden = false;
    }

    function hidePlayerBox() {
        if (!document.body.classList.contains('fullscreen-mode')) return;
        
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
        
        // Sync fullscreen song info from player track info
        updateFullscreenSongInfo();
        
        isPlayerHidden = true;
    }

    function updateFullscreenSongInfo() {
        const fullscreenTitle = document.getElementById('fullscreen-song-title');
        const fullscreenArtist = document.getElementById('fullscreen-song-artist');
        const playerTitle = document.getElementById('player-track-title');
        const playerArtist = document.getElementById('player-track-artist');
        
        if (fullscreenTitle && playerTitle) {
            fullscreenTitle.textContent = playerTitle.textContent || '';
        }
        if (fullscreenArtist && playerArtist) {
            fullscreenArtist.textContent = playerArtist.textContent || '';
        }
    }

    function resetIdleTimer() {
        if (!document.body.classList.contains('fullscreen-mode')) return;
        
        showPlayerBox();
        if (fullscreenIdleTimer) clearTimeout(fullscreenIdleTimer);
        fullscreenIdleTimer = setTimeout(() => {
            hidePlayerBox();
        }, FULLSCREEN_IDLE_TIMEOUT);
    }

    function triggerSlideAnimation(direction) {
        // Handle fullscreen mode
        if (document.body.classList.contains('fullscreen-mode')) {
            triggerColorSlide(direction);
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

        // After the animation completes
        setTimeout(() => {
            coverSection.classList.remove('slide-next-out', 'slide-prev-out');
        }, 400);
    }

    function triggerSlideInAnimation(direction) {
        // Handle fullscreen mode
        if (document.body.classList.contains('fullscreen-mode')) {
            triggerColorSlideIn(direction);
            return;
        }

        // Original logic for non-fullscreen mode
        const coverSection = document.querySelector('.cover-section');
        if (!coverSection) return;

        coverSection.classList.remove('slide-next-in', 'slide-next-out', 'slide-prev-in', 'slide-prev-out');
        
        setTimeout(() => {
            if (direction === 'next') {
                coverSection.classList.add('slide-next-in');
            } else {
                coverSection.classList.add('slide-prev-in');
            }

            setTimeout(() => {
                coverSection.classList.remove('slide-next-in', 'slide-prev-in');
            }, 400);
        }, 50);
    }

    function triggerColorSlide(direction) {
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

    function triggerColorSlideIn(direction) {
        // Only work in fullscreen mode
        if (!document.body.classList.contains('fullscreen-mode')) {
            return;
        }

        const overlay = document.getElementById('fullscreen-color-slide-overlay');
        if (!overlay) return;

        const Theme = window.AudioFlowTheme;
        if (!Theme) return;
        
        const colors = Theme.getCurrentColors();
        const currentDominantColor = colors.dominant;

        // Get stored direction, manual override takes precedence
        let slideDirection = overlay.getAttribute('data-slide-direction') || direction;
        if (manualDirection && slideDirection !== manualDirection) {
            console.log('[DIR] Overriding stored direction', slideDirection, 'with manualDirection', manualDirection);
            slideDirection = manualDirection;
        }
        
        const applyColorSlide = () => {
            if (currentDominantColor) {
                const [r, g, b] = currentDominantColor;
                const bodySolid = `rgb(${r}, ${g}, ${b})`;
                overlay.style.background = bodySolid;
                
                // Also update the lyrics background color CSS variable
                document.documentElement.style.setProperty('--lyrics-bg-color', bodySolid);

                // Prepare overlay: snap to start position without transition
                overlay.classList.add('no-transition');
                overlay.classList.remove('slide-in', 'slide-from-left', 'slide-from-right');
                if (slideDirection === 'next') {
                    overlay.classList.add('slide-from-right');
                } else {
                    overlay.classList.add('slide-from-left');
                }
                void overlay.offsetWidth; // Force reflow

                setTimeout(() => {
                    // Trigger the cover slide
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
                    void overlay.offsetWidth;
                    overlay.classList.add('slide-in');

                    setTimeout(() => {
                        if (document.body.classList.contains('fullscreen-mode')) {
                            document.body.style.background = bodySolid;
                        }

                        overlay.classList.remove('slide-in', 'slide-from-left', 'slide-from-right');
                        overlay.classList.add('stay-background');
                        overlay.removeAttribute('data-slide-direction');
                        manualDirection = null;
                        
                        overlay.classList.add('no-transition');
                        void overlay.offsetWidth;
                        overlay.classList.remove('no-transition');
                        
                        const coverSection2 = document.querySelector('.cover-section');
                        if (coverSection2) {
                            coverSection2.classList.remove('fullscreen-cover-next-in', 'fullscreen-cover-prev-in');
                        }
                        
                        // Show dancing bars after slide animation completes
                        if (player && !player.paused) {
                            showCoverDancingBars(100);
                        }
                    }, 800);
                }, 50);
            } else {
                console.log('No dominant color available for slide animation');
            }
        };

        if (currentDominantColor) {
            applyColorSlide();
        } else {
            let attempts = 0;
            const maxAttempts = 40;
            const checkColors = setInterval(() => {
                attempts++;
                const updatedColors = Theme.getCurrentColors();
                if (updatedColors.dominant) {
                    clearInterval(checkColors);
                    applyColorSlide();
                } else if (attempts >= maxAttempts) {
                    clearInterval(checkColors);
                    console.log('Timeout waiting for color extraction');
                }
            }, 50);
        }
    }

    function setManualDirection(dir) {
        manualDirection = dir;
        lastChangeDirection = dir;
    }

    function getLastDirection() {
        return lastChangeDirection;
    }

    function isHidden() {
        return isPlayerHidden;
    }

    function isInFullscreen() {
        return document.body.classList.contains('fullscreen-mode');
    }

    // Dancing bars visibility helpers
    function showCoverDancingBars(delay = 0) {
        const show = () => {
            const bars = document.querySelectorAll('.cover-dancing-bars');
            bars.forEach(el => el.classList.add('visible'));
            // Kick off the visualizer animation loop
            const Visualizer = window.AudioFlowVisualizer;
            if (Visualizer) Visualizer.start();
        };

        if (delay > 0) {
            setTimeout(show, delay);
        } else {
            show();
        }
    }

    function hideCoverDancingBars() {
        const bars = document.querySelectorAll('.cover-dancing-bars');
        bars.forEach(el => el.classList.remove('visible'));
        const Visualizer = window.AudioFlowVisualizer;
        if (Visualizer) Visualizer.stop();
    }

    // Public API
    return {
        init,
        toggleFullscreen,
        showPlayerBox,
        hidePlayerBox,
        resetIdleTimer,
        triggerSlideAnimation,
        triggerSlideInAnimation,
        triggerColorSlide,
        triggerColorSlideIn,
        setManualDirection,
        getLastDirection,
        isHidden,
        isInFullscreen,
        showCoverDancingBars,
        hideCoverDancingBars,
        updateFullscreenSongInfo
    };
})();

// Make it available globally
window.AudioFlowFullscreen = AudioFlowFullscreen;
