// =====================================================================
// AudioFlow - Theme Management Module
// =====================================================================

const AudioFlowTheme = (function() {
    // Private state
    let currentDominantColor = null;
    let currentColorPalette = null;
    let themeUpdateTimeout = null;
    let colorThief = null;

    function init(colorThiefInstance) {
        colorThief = colorThiefInstance;
    }

    function setCurrentColors(dominant, palette) {
        currentDominantColor = dominant;
        currentColorPalette = palette;
    }

    function getCurrentColors() {
        return {
            dominant: currentDominantColor,
            palette: currentColorPalette
        };
    }

    function applyTheme(c, palette = null) {
        const Utils = window.AudioFlowUtils;
        const [r, g, b] = c;
        const isDarkColor = Utils.getBrightness(r, g, b) < 128;
        const shades = Utils.getSecondaryColorOrShades(c, palette);

        // Keep fullscreen lyrics overlay color in sync with the active song theme
        // while the lyrics panel is open.
        if (document.body.classList.contains('lyrics-active')) {
            document.documentElement.style.setProperty('--lyrics-bg-color', `rgb(${r}, ${g}, ${b})`);
        }
        
        const containerGradient = `linear-gradient(0deg, 
            rgb(${shades.dark.r}, ${shades.dark.g}, ${shades.dark.b}), 
            rgb(${shades.normal.r}, ${shades.normal.g}, ${shades.normal.b}) 40%, 
            rgb(${shades.normal.r}, ${shades.normal.g}, ${shades.normal.b}) 60%,
            rgb(${shades.normal.r}, ${shades.normal.g}, ${shades.normal.b}) 80%,
            rgb(${shades.light.r}, ${shades.light.g}, ${shades.light.b}))`;
        
        const container = document.querySelector('.container');
        if (container) {
            if (document.body.classList.contains('fullscreen-mode')) {
                container.style.background = '';
                container.style.backdropFilter = '';
                container.style.webkitBackdropFilter = '';
            } else {
                container.style.background = '#000';
                container.style.backdropFilter = '';
                container.style.webkitBackdropFilter = '';
            }
        }
        
        let textColor, buttonColor, buttonTextColor;
        if (isDarkColor) {
            textColor = `rgb(${shades.light.r}, ${shades.light.g}, ${shades.light.b})`;
            buttonColor = `linear-gradient(90deg, rgb(${shades.light.r}, ${shades.light.g}, ${shades.light.b}), rgb(${Math.min(255, shades.light.r + 20)}, ${Math.min(255, shades.light.g + 20)}, ${Math.min(255, shades.light.b + 20)}))`;
            buttonTextColor = `rgb(${shades.dark.r}, ${shades.dark.g}, ${shades.dark.b})`;
        } else {
            textColor = `rgb(${shades.dark.r}, ${shades.dark.g}, ${shades.dark.b})`;
            buttonColor = `linear-gradient(90deg, rgb(${shades.dark.r}, ${shades.dark.g}, ${shades.dark.b}), rgb(${Math.max(0, shades.dark.r - 20)}, ${Math.max(0, shades.dark.g - 20)}, ${Math.max(0, shades.dark.b - 20)}))`;
            buttonTextColor = `rgb(${shades.light.r}, ${shades.light.g}, ${shades.light.b})`;
        }
        
        const mainHeading = document.querySelector('.main-heading');
        const songTitleText = document.querySelector('#song-title');
        const songArtistText = document.querySelector('#song-artist');
        const roomCodeDisplay = document.querySelector('.room-code-display');
        const coverArtPlaceholder = document.getElementById('cover-art-placeholder');
        const fileNameDisplay = document.getElementById('file-name');
        const controlButtons = document.querySelectorAll('.control-button');
        const progressFill = document.getElementById('progress-fill');
        
        if (mainHeading && !document.body.classList.contains('fullscreen-mode')) {
            mainHeading.style.removeProperty('background');
            mainHeading.style.removeProperty('background-image');
            mainHeading.style.removeProperty('-webkit-background-clip');
            mainHeading.style.removeProperty('-webkit-text-fill-color');
            mainHeading.style.removeProperty('background-clip');
            mainHeading.style.color = '#ffffff';
            mainHeading.style.setProperty('color', '#ffffff', 'important');
        }
        
        if (songTitleText && !document.body.classList.contains('fullscreen-mode')) {
            songTitleText.style.setProperty('color', '#ffffff', 'important');
        }
        if (songArtistText && !document.body.classList.contains('fullscreen-mode')) {
            songArtistText.style.setProperty('color', 'rgba(255, 255, 255, 0.7)', 'important');
        }
        
        if (coverArtPlaceholder && coverArtPlaceholder.classList.contains('visible')) {
            coverArtPlaceholder.style.background = `linear-gradient(135deg, 
                rgba(${shades.light.r}, ${shades.light.g}, ${shades.light.b}, 0.15) 0%,
                rgba(${shades.normal.r}, ${shades.normal.g}, ${shades.normal.b}, 0.08) 50%,
                rgba(${shades.dark.r}, ${shades.dark.g}, ${shades.dark.b}, 0.05) 100%)`;
            coverArtPlaceholder.style.borderColor = `rgba(${shades.normal.r}, ${shades.normal.g}, ${shades.normal.b}, 0.25)`;
            coverArtPlaceholder.style.boxShadow = `0 0 15px rgba(${shades.normal.r}, ${shades.normal.g}, ${shades.normal.b}, 0.3), 0 0 35px rgba(${shades.normal.r}, ${shades.normal.g}, ${shades.normal.b}, 0.2)`;
        }
        
        controlButtons.forEach(e => {
            e.style.background = 'transparent';
            e.style.borderColor = 'transparent';
            e.style.color = '#ffffff';
            e.style.boxShadow = 'none';
        });

        const customPlayer = document.querySelector('.custom-player');
        if (customPlayer) {
            customPlayer.style.background = '#1a1d24';
            customPlayer.style.borderColor = '#2a2d34';
            customPlayer.style.boxShadow = `
                0 -4px 18px 0 rgba(0,0,0,0.7),
                inset 0 1px 0 0 rgba(255,255,255,0.06)`;
        }

        const timeDisplays = document.querySelectorAll('.player-time-display');
        timeDisplays.forEach(display => {
            display.style.color = '#ffffff';
        });

        if (progressFill) {
            progressFill.style.background = buttonColor;
        }

        const handles = document.querySelectorAll('.progress-handle');
        handles.forEach(handle => {
            handle.style.background = buttonTextColor;
            handle.style.boxShadow = `0 2px 8px rgba(${shades.normal.r}, ${shades.normal.g}, ${shades.normal.b}, 0.4)`;
        });

        const progressBar = document.querySelector('.progress-bar');
        if (progressBar) {
            progressBar.style.background = `linear-gradient(90deg, 
                rgba(${shades.light.r}, ${shades.light.g}, ${shades.light.b}, 0.12) 0%,
                rgba(${shades.normal.r}, ${shades.normal.g}, ${shades.normal.b}, 0.08) 50%,
                rgba(${shades.light.r}, ${shades.light.g}, ${shades.light.b}, 0.12) 100%)`;
            progressBar.style.borderColor = `rgba(${shades.normal.r}, ${shades.normal.g}, ${shades.normal.b}, 0.15)`;
        }

        document.documentElement.style.setProperty('--current-border-color', textColor);

        if (fileNameDisplay && fileNameDisplay.classList.contains('playing')) {
            fileNameDisplay.style.borderColor = textColor;
            
            let barColor = buttonColor;
            let glowColor = `${shades.normal.r},${shades.normal.g},${shades.normal.b}`;
            let barColorForHeading = textColor;
            
            if (palette && palette.length >= 2) {
                let secondaryColor = palette[1];
                let colorDistance = Utils.getColorDistance(c, secondaryColor);
                
                if (colorDistance < 50 && palette.length >= 3) {
                    const thirdColor = palette[2];
                    const thirdColorDistance = Utils.getColorDistance(c, thirdColor);
                    
                    if (thirdColorDistance > colorDistance) {
                        secondaryColor = thirdColor;
                    }
                }
                
                const [sr, sg, sb] = secondaryColor;
                barColor = `linear-gradient(90deg, rgb(${sr}, ${sg}, ${sb}), rgb(${Math.min(255, sr + 20)}, ${Math.min(255, sg + 20)}, ${Math.min(255, sb + 20)}))`;
                glowColor = `${sr},${sg},${sb}`;
                barColorForHeading = `rgb(${sr}, ${sg}, ${sb})`;
            }
            
            document.documentElement.style.setProperty('--current-bar-color', barColorForHeading);
            
            if (mainHeading) {
                mainHeading.style.setProperty('color', '#ffffff', 'important');
                mainHeading.setAttribute('data-fixed-color', '#ffffff');
            }
            if (songTitleText) {
                songTitleText.style.setProperty('color', '#ffffff', 'important');
                songTitleText.setAttribute('data-fixed-color', '#ffffff');
            }
            if (songArtistText) {
                songArtistText.style.setProperty('color', 'rgba(255, 255, 255, 0.7)', 'important');
                songArtistText.setAttribute('data-fixed-color', 'rgba(255, 255, 255, 0.7)');
            }
            if (roomCodeDisplay) {
                roomCodeDisplay.style.setProperty('color', '#ffffff', 'important');
                roomCodeDisplay.setAttribute('data-fixed-color', '#ffffff');
                
                const roomCodeSpan = roomCodeDisplay.querySelector('span');
                if (roomCodeSpan) {
                    roomCodeSpan.style.setProperty('color', '#ffffff', 'important');
                    roomCodeSpan.setAttribute('data-fixed-color', '#ffffff');
                }
            }
            
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
            if (fileNameDisplay) fileNameDisplay.style.borderColor = '';
            document.documentElement.style.removeProperty('--current-border-color');
            
            document.querySelectorAll('.cover-dancing-bars .bar').forEach(bar => {
                bar.style.background = '';
                bar.style.boxShadow = '';
            });
        }
        
        if (document.body.classList.contains('fullscreen-mode')) {
            setTimeout(() => {
                ensureFullscreenContrast();
            }, 50);
        }
    }

    function resetTheme() {
        if (document.body.classList.contains('lyrics-active')) {
            document.documentElement.style.setProperty('--lyrics-bg-color', '#0a0c10');
        }

        if (document.body.classList.contains('fullscreen-mode')) {
            return;
        }
        
        const container = document.querySelector('.container');
        if (container) {
            container.style.background = '';
            container.style.backdropFilter = '';
            container.style.webkitBackdropFilter = '';
        }
        
        const mainHeading = document.querySelector('.main-heading');
        const roomCodeDisplay = document.querySelector('.room-code-display');
        const songTitleText = document.querySelector('#song-title');
        const songArtistText = document.querySelector('#song-artist');
        const coverArtPlaceholder = document.getElementById('cover-art-placeholder');
        const fileNameDisplay = document.getElementById('file-name');
        const controlButtons = document.querySelectorAll('.control-button');
        const progressFill = document.getElementById('progress-fill');
        
        if (mainHeading) {
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
        
        if (roomCodeDisplay) {
            const fixedColor = roomCodeDisplay.getAttribute('data-fixed-color');
            if (!fixedColor) {
                roomCodeDisplay.style.color = '';
                roomCodeDisplay.style.borderColor = '';
                
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
        
        if (coverArtPlaceholder) {
            coverArtPlaceholder.style.background = '';
            coverArtPlaceholder.style.borderColor = '';
            coverArtPlaceholder.style.boxShadow = '';
        }
        
        controlButtons.forEach(e => {
            e.style.background = '';
            e.style.color = '';
            e.style.borderColor = '';
            e.style.boxShadow = '';
            e.style.textShadow = '';
        });

        const customPlayer = document.querySelector('.custom-player');
        if (customPlayer) {
            customPlayer.style.background = '';
            customPlayer.style.borderColor = '';
            customPlayer.style.boxShadow = '';
        }

        const timeDisplays = document.querySelectorAll('.player-time-display');
        timeDisplays.forEach(display => {
            display.style.color = '';
            display.style.textShadow = '';
        });

        if (progressFill) {
            progressFill.style.background = '';
        }
        const volumeFillHorizontal = document.getElementById('volume-fill-horizontal');
        if (volumeFillHorizontal) {
            volumeFillHorizontal.style.background = '';
        }

        const handles = document.querySelectorAll('.progress-handle, .volume-handle-horizontal');
        handles.forEach(handle => {
            handle.style.background = '';
            handle.style.boxShadow = '';
        });

        const progressBar = document.querySelector('.progress-bar');
        const volumeSliderHorizontal = document.querySelector('.volume-slider-horizontal');
        if (progressBar) {
            progressBar.style.background = '';
            progressBar.style.borderColor = '';
        }
        if (volumeSliderHorizontal) {
            volumeSliderHorizontal.style.background = '';
            volumeSliderHorizontal.style.borderColor = '';
        }
        
        document.querySelectorAll('.cover-dancing-bars .bar').forEach(bar => {
            bar.style.background = '';
            bar.style.boxShadow = '';
        });
        if (fileNameDisplay) fileNameDisplay.style.borderColor = '';
        document.documentElement.style.removeProperty('--current-border-color');
        document.documentElement.style.removeProperty('--current-bar-color');
        currentDominantColor = null;
        currentColorPalette = null;
    }

    function updateThemeForPlayingState() {
        clearTimeout(themeUpdateTimeout);
        themeUpdateTimeout = setTimeout(() => {
            if (currentDominantColor) {
                applyTheme(currentDominantColor, currentColorPalette);
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

    function ensureFullscreenContrast() {
        if (!document.body.classList.contains('fullscreen-mode')) return;
        
        const Utils = window.AudioFlowUtils;
        const mainHeading = document.querySelector('.main-heading');
        const songTitleText = document.querySelector('#song-title');
        const songArtistText = document.querySelector('#song-artist');
        const roomCodeDisplay = document.querySelector('.room-code-display');
        const audioflowHeading = document.querySelector('h1.main-heading');
        const bodyBg = window.getComputedStyle(document.body).backgroundColor;
        
        const bgBrightness = Utils.getCssColorBrightness(bodyBg);
        const contrastColor = bgBrightness > 128 ? 'black' : 'white';
        
        [mainHeading, audioflowHeading].forEach(el => {
            if (!el) return;
            el.style.setProperty('color', 'white', 'important');
            el.removeAttribute('data-fixed-color');
            el.style.removeProperty('background');
            el.style.removeProperty('background-image');
            el.style.removeProperty('-webkit-background-clip');
            el.style.removeProperty('-webkit-text-fill-color');
            el.style.removeProperty('background-clip');
        });
        
        [songTitleText, songArtistText, roomCodeDisplay].forEach(el => {
            if (!el) return;
            el.style.setProperty('color', contrastColor, 'important');
            el.removeAttribute('data-fixed-color');
            el.style.removeProperty('background');
            el.style.removeProperty('background-image');
            el.style.removeProperty('-webkit-background-clip');
            el.style.removeProperty('-webkit-text-fill-color');
            el.style.removeProperty('background-clip');
        });
        
        const roomCodeSpan = roomCodeDisplay?.querySelector('span');
        if (roomCodeSpan) {
            roomCodeSpan.style.setProperty('color', contrastColor, 'important');
            roomCodeSpan.removeAttribute('data-fixed-color');
        }
    }

    // Public API
    return {
        init,
        setCurrentColors,
        getCurrentColors,
        applyTheme,
        resetTheme,
        updateThemeForPlayingState,
        ensureFullscreenContrast
    };
})();

// Make it available globally
window.AudioFlowTheme = AudioFlowTheme;

// Global helper function for fullscreen contrast
function ensureFullscreenContrast() {
    window.AudioFlowTheme.ensureFullscreenContrast();
}
