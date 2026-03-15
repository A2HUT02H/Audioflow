// =====================================================================
// AudioFlow - Utility Functions
// =====================================================================

const AudioFlowUtils = {
    // Format time in mm:ss format
    formatTime(seconds) {
        if (isNaN(seconds)) return '0:00';
        const minutes = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    },

    // Truncate filename with ellipsis in the middle
    truncateFilename(filename, maxLength = 40) {
        if (!filename || filename.length <= maxLength) {
            return filename;
        }
        
        const availableLength = maxLength - 3;
        const frontLength = Math.ceil(availableLength / 2);
        const backLength = Math.floor(availableLength / 2);
        
        return filename.substring(0, frontLength) + '...' + filename.substring(filename.length - backLength);
    },

    // Get brightness value of RGB color
    getBrightness(r, g, b) {
        return (r * 299 + g * 587 + b * 114) / 1000;
    },

    // Calculate color distance in RGB space
    getColorDistance(color1, color2) {
        const [r1, g1, b1] = color1;
        const [r2, g2, b2] = color2;
        
        return Math.sqrt(
            Math.pow(r2 - r1, 2) + 
            Math.pow(g2 - g1, 2) + 
            Math.pow(b2 - b1, 2)
        );
    },

    // Parse CSS rgb/rgba color string to [r, g, b]
    parseCssColor(str) {
        if (!str) return null;
        const match = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (match) {
            return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
        }
        return null;
    },

    // Get brightness of CSS color string
    getCssColorBrightness(str) {
        const rgb = this.parseCssColor(str);
        if (!rgb) return 255;
        return (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
    },

    // Check if two colors are similar
    isColorSimilar(c1, c2) {
        const rgb1 = this.parseCssColor(c1);
        const rgb2 = this.parseCssColor(c2);
        if (!rgb1 || !rgb2) return false;
        const dist = Math.sqrt(
            Math.pow(rgb1[0] - rgb2[0], 2) +
            Math.pow(rgb1[1] - rgb2[1], 2) +
            Math.pow(rgb1[2] - rgb2[2], 2)
        );
        return dist < 80;
    },

    // Derive a stable theme color from text when image extraction fails
    fallbackColorFromText(text) {
        if (!text) text = 'AudioFlow';
        let hash = 0;
        for (let i = 0; i < text.length; i++) {
            hash = ((hash << 5) - hash) + text.charCodeAt(i);
            hash |= 0;
        }
        const hue = Math.abs(hash) % 360;
        const saturation = 60;
        const lightness = 45;
        const h = hue / 360, s = saturation / 100, l = lightness / 100;
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };
        let r, g, b;
        if (s === 0) {
            r = g = b = l;
        } else {
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = hue2rgb(p, q, h + 1/3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1/3);
        }
        return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
    },

    // Create color shades for gradients
    createColorShades(r, g, b) {
        const lightR = Math.min(255, Math.round(r + (255 - r) * 0.02));
        const lightG = Math.min(255, Math.round(g + (255 - g) * 0.02));
        const lightB = Math.min(255, Math.round(b + (255 - b) * 0.02));
        
        const darkR = Math.max(0, Math.round(r * 0.7));
        const darkG = Math.max(0, Math.round(g * 0.7));
        const darkB = Math.max(0, Math.round(b * 0.7));
        
        return {
            light: { r: lightR, g: lightG, b: lightB },
            normal: { r, g, b },
            dark: { r: darkR, g: darkG, b: darkB }
        };
    },

    // Get secondary color or shades from palette
    getSecondaryColorOrShades(dominantColor, palette) {
        if (!palette || palette.length < 2) {
            const [r, g, b] = dominantColor;
            return this.createColorShades(r, g, b);
        }

        let secondaryColor = palette[1];
        let colorDistance = this.getColorDistance(dominantColor, secondaryColor);
        
        if (colorDistance < 50 && palette.length >= 3) {
            const thirdColor = palette[2];
            const thirdColorDistance = this.getColorDistance(dominantColor, thirdColor);
            
            if (thirdColorDistance > colorDistance) {
                secondaryColor = thirdColor;
                colorDistance = thirdColorDistance;
            }
        }
        
        if (colorDistance < 50) {
            const [r, g, b] = dominantColor;
            return this.createColorShades(r, g, b);
        }

        const [r, g, b] = dominantColor;
        const [sr, sg, sb] = secondaryColor;
        
        return {
            light: { 
                r: Math.min(255, Math.round((r + sr) / 2 + 5)), 
                g: Math.min(255, Math.round((g + sg) / 2 + 5)), 
                b: Math.min(255, Math.round((b + sb) / 2 + 5)) 
            },
            normal: { r, g, b },
            dark: { 
                r: Math.max(0, Math.round(r * 0.7)), 
                g: Math.max(0, Math.round(g * 0.7)), 
                b: Math.max(0, Math.round(b * 0.7)) 
            }
        };
    },

    // Check if file is audio file
    isAudioFile(file) {
        const config = window.AudioFlowConfig;
        if (file.type && config.ALLOWED_MIME_TYPES.some(mime => file.type.toLowerCase().includes(mime.split('/')[1]))) {
            return true;
        }
        const ext = '.' + file.name.split('.').pop().toLowerCase();
        return config.ALLOWED_EXTENSIONS.includes(ext);
    },

    // Check if dataTransfer has audio files
    hasAudioFiles(dataTransfer) {
        const types = dataTransfer && dataTransfer.types ? Array.from(dataTransfer.types) : [];
        if (types.includes('Files')) {
            if (dataTransfer.items) {
                for (let i = 0; i < dataTransfer.items.length; i++) {
                    const item = dataTransfer.items[i];
                    if (item.kind === 'file') {
                        const file = item.getAsFile();
                        if (file && this.isAudioFile(file)) return true;
                    }
                }
            }
            return true;
        }
        return false;
    },

    // Setup 3D tilt effect for an element
    setup3DTiltEffect(element) {
        if (!element) return;
        
        element.addEventListener('mousemove', (e) => {
            const rect = element.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const centerX = element.offsetWidth / 2;
            const centerY = element.offsetHeight / 2;
            
            const isFullscreen = document.body.classList.contains('fullscreen-mode');
            const elementSize = Math.min(element.offsetWidth, element.offsetHeight);
            
            let tiltDivisor;
            if (isFullscreen) {
                tiltDivisor = Math.max(30, elementSize / 11);
            } else {
                tiltDivisor = 20;
            }
            
            const rotateX = (centerY - y) / tiltDivisor;
            const rotateY = (x - centerX) / tiltDivisor;
            
            element.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
        });
        
        element.addEventListener('mouseleave', () => {
            element.style.transform = 'rotateX(0) rotateY(0)';
        });
    },

    // Generate unique key for song identification
    generateSongKey(filename, title, artist) {
        return `${filename}|${title || ''}|${artist || ''}`;
    },

    // Format duration from seconds
    formatDuration(seconds) {
        if (!seconds) return '';
        const mins = Math.floor(seconds / 60);
        const secs = Math.round(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
};

// Make it available globally
window.AudioFlowUtils = AudioFlowUtils;
