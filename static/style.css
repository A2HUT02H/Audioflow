/* Animated sliding for long audio file names */
@keyframes slide-horizontal {
  0% { transform: translateX(0); }
  15% { transform: translateX(0); }
  45% { transform: translateX(var(--slide-distance, 0px)); }
  65% { transform: translateX(var(--slide-distance, 0px)); }
  85% { transform: translateX(0); }
  100% { transform: translateX(0); }
}

#file-name-text.long {
  animation: slide-horizontal 8s ease-in-out infinite;
  overflow: visible; 
  text-overflow: clip; 
}

/* Ensure the animation continues smoothly when playing state changes */
#file-name.playing #file-name-text.long {
  animation: slide-horizontal 8s ease-in-out infinite;
}

/* Use Inter font for button text */
.control-button, .upload-wrapper button, .sync-wrapper button, .create-new-room-button {
  font-family: 'Inter', Arial, sans-serif;
}
@import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap');

:root {
    --primary-color: #ff3232; /* Blue 500 */
    --secondary-color: #ff3dab; /* Teal 500 */
    --background-color-start: #000000; /* Gray 900 */
    --background-color-end: #000000; /* Gray 800 */
    --surface-color: rgba(31, 41, 55, 0.6); /* Gray 800 with transparency */
    --surface-border-color: rgba(75, 85, 99, 0.4); /* Gray 600 with transparency */
    --text-color: #f3f4f6; /* Gray 100 */
    --text-muted-color: #9ca3af; /* Gray 400 */
    --accent-color: #ff45b8; /* Amber 500 */
    --shadow-color: rgba(0, 0, 0, 0.5);
    --shadow-light-color: rgba(0, 0, 0, 0.3);
    --cover-art-color: #242424; /* Fallback color for cover art */
}

/* --- Universal Reset and Box-Sizing --- */
*, *::before, *::after {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    background: linear-gradient(135deg, var(--background-color-start), var(--background-color-end));
    color: var(--text-color);
    font-family: 'Noto Sans', sans-serif;
    display: flex;
    justify-content: center;
    align-items: center;
    height: 100vh;      
    padding: 0;         
    overflow: hidden;   
    margin: 0;          
}


.container {
    background-color: var(--surface-color);
    padding: 1.5rem;
    border-radius: 24px;
    border: 1px solid var(--surface-border-color);
    box-shadow: 0 12px 45px var(--shadow-color);
    width: 100%;
    max-width: 400px;
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    backdrop-filter: blur(12px); /* Glassmorphism effect */
    -webkit-backdrop-filter: blur(12px);
    
}

.main-heading {
    font-size: 60px;
    font-weight: 700;
    margin: 0;
    background: linear-gradient(90deg, var(--primary-color), var(--secondary-color));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
}

#cover-art {
    width: 220px;
    height: 220px;
    margin: 0 auto;
    border-radius: 16px;
    box-shadow: 0 8px 25px var(--shadow-light-color);
    object-fit: cover;
    transition: opacity 0.4s ease, transform 0.4s ease;
    border: 1px solid var(--surface-border-color);
    transition: opacity 0.4s ease, transform 0.4s ease, box-shadow 0.5s ease;
}

/* FIX: Container is now a stable flexbox parent */
#file-name {
    font-size: 1rem;
    font-weight: 500;
    color: var(--text-muted-color);
    padding: 0.5rem 1rem;
    background-color: rgba(28, 28, 28, 0.2);
    border-radius: 12px;
    min-height: 2.5em;
    display: flex;
    align-items: center;
    justify-content: center; /* Center by default */
    line-height: 1.4;
    transition: color 0.3s ease, border-color 0.3s ease;
    border: 2px solid transparent;
    overflow: hidden;
    position: relative; /* For proper mask positioning */
}

/* When text is overflowing and needs to slide, align to start */
#file-name.is-overflowing {
    justify-content: flex-start; /* Left align for sliding animation */
}

/* NEW: This wrapper contains the indicator and text, and moves as one unit */
.file-name-wrapper {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    min-width: 0;
    flex: 1;
}

#file-name-text {
    white-space: nowrap;
    text-overflow: clip; 
    overflow: visible;
    flex-shrink: 0; /* Don't shrink the text, let it slide instead */
    min-width: 0;
}

#file-name.is-overflowing {
    justify-content: flex-start; /* Left align for sliding animation */
    /* Use a wider fade to look smoother */
    -webkit-mask-image: linear-gradient(to right, transparent, black 8%, black 92%, transparent);
    mask-image: linear-gradient(to right, transparent, black 8%, black 92%, transparent);
}


#file-name.playing {
    border-color: var(--cover-art-color, var(--accent-color));
    animation: playing-pulse 2s ease-in-out infinite;
}


@keyframes playing-pulse {
    0%, 100% { 
        box-shadow: 0 0 5px currentColor;
    }
    50% { 
        box-shadow: 0 0 15px currentColor;
    }
}

audio#player {
    width: 100%;
    accent-color: var(--primary-color);
}

.controls-section {
    display: flex;
    flex-direction: column;
    gap: 1rem;
}

.upload-wrapper, .sync-wrapper {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
}

.control-button {
    flex-grow: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 0.8rem 1.4rem;
    border: none;
    border-radius: 12px;
    background: linear-gradient(90deg, var(--primary-color), var(--secondary-color));
    color: #ffffff;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: transform 0.3s ease, box-shadow 0.3s ease, filter 0.3s ease, background 0.5s ease, color 0.5s ease; /* Added 'color' transition */
    box-shadow: 0 4px 15px var(--shadow-light-color);
}

.control-button:hover {
    transform: translateY(-3px) scale(1.02);
    box-shadow: 0 8px 25px var(--shadow-color);
    filter: brightness(1.1);
}

.control-button:active {
    transform: translateY(-1px) scale(1);
    box-shadow: 0 4px 15px var(--shadow-light-color);
    filter: brightness(1);
}

.control-button i {
    font-size: 1rem;
}

.delay-control {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background-color: rgba(0, 0, 0, 0.2);
    padding: 0.5rem 0.8rem;
    border-radius: 12px;
}

label[for="delay-input"] {
    color: var(--text-muted-color);
    font-weight: 500;
}


/* Cover Art Dancing Bars - New Effect */
.cover-section {
    position: relative;
    display: flex;
    justify-content: center;
    align-items: center;
    width: 100%;
    padding: 0 50px; /* Add padding to ensure bars stay inside container */
}

.cover-dancing-bars {
    display: none;
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    flex-direction: row; /* Changed to horizontal arrangement */
    align-items: center; /* Vertically center all bars */
    gap: 3px;
    z-index: 1;
}

.cover-dancing-bars.left {
    left: calc(50% - 110px - 10px - 15px); /* Center minus half image width minus gap minus bar group width */
}

.cover-dancing-bars.right {
    right: calc(50% - 110px - 10px - 15px); /* Center minus half image width minus gap minus bar group width */
}

.cover-dancing-bars.visible {
    display: flex;
}

.cover-dancing-bars .bar {
    width: 3px;
    background: var(--current-border-color, var(--accent-color));
    transform-origin: bottom; /* Scale from bottom for natural look */
    border-radius: 2px;
    box-shadow: 0 0 8px var(--current-border-color, var(--accent-color));
    align-self: center; /* Vertically center each bar within the flex container */
    transition: height 0.05s ease-out; /* Much faster transitions for better responsiveness */
}

/* Default heights for visualizer bars - minimum heights when audio is below 50% */
.cover-dancing-bars.left .bar:nth-child(1) { 
    height: 10px; /* Treble - minimum height */
}
.cover-dancing-bars.left .bar:nth-child(2) { 
    height: 15px; /* Mid - minimum height */
}
.cover-dancing-bars.left .bar:nth-child(3) { 
    height: 20px; /* Bass - minimum height */
}

.cover-dancing-bars.right .bar:nth-child(1) { 
    height: 20px; /* Bass - minimum height */
}
.cover-dancing-bars.right .bar:nth-child(2) { 
    height: 15px; /* Mid - minimum height */
}
.cover-dancing-bars.right .bar:nth-child(3) { 
    height: 10px; /* Treble - minimum height */
}

/* Remove the old static animation - now using dynamic visualizer */
/*
@keyframes cover-dance {
    0%, 100% { 
        transform: scaleY(0.3);
        opacity: 0.6;
    }
    50% { 
        transform: scaleY(1.0);
        opacity: 1;
    }
}
*/

#file-name.playing #file-name-text {
    color: var(--text-color);
}

/* Responsive adjustments */
@media (max-width: 600px) {
    /* No body changes needed due to box-sizing */
    .container { 
        padding: 1.5rem; 
        gap: 1rem; 
    }
    .main-heading { font-size: 30px; }
    .sync-wrapper { 
        flex-direction: column; 
        align-items: stretch; 
        gap: 0.8rem; 
    }
    .delay-control { justify-content: center; }
}

/* --- Room Selection Page --- */
.room-selection-container {
    max-width: 450px;
    gap: 1.5rem;
}

.sub-heading {
    font-size: 1.2rem;
    color: var(--text-muted-color);
    margin-top: -10px;
    font-weight: 400;
}

.room-actions {
    display: flex;
    flex-direction: column;
    width: 100%;
    gap: 1rem;
    align-items: center;
}

.divider {
    font-weight: 500;
    color: var(--text-muted-color);
}

.join-wrapper {
    display: flex;
    flex-direction: column;
    width: 100%;
    gap: 1rem;
}

#room-id-input {
    width: 100%;
    padding: 0.8rem 1rem;
    border-radius: 12px;
    border: 1px solid var(--surface-border-color);
    background-color: rgba(255, 75, 135, 0);
    color: var(--text-color);
    font-size: 1rem;
    text-align: center;
    transition: box-shadow 0.3s ease, border-color 0.3s ease;
}

#room-id-input:focus {
    outline: none;
    border-color: var(--primary-color);
    box-shadow: 0 0 0 3px #ff000031;
}

.create-room-btn, .join-room-btn {
    width: 100%;
}

/* --- Room Code Display on Player Page --- */
.room-code-display {
    background-color: rgba(98, 98, 98, 0.1);
    color: var(--text-color);
    padding: 0.4rem 0.8rem;
    border-radius: 8px;
    font-size: 0.9rem;
    font-weight: 500;
    margin-top: 0px;
    border: 1px solid var(--surface-border-color);
}

.room-code-display span {
    font-weight: 700;
    color: var(--accent-color);
    letter-spacing: 1px;
}

/* --- New styles for Room Header Controls --- */

.room-header-controls {
    display: flex; /* This is the most important part! It aligns children in a row. */
    justify-content: center; /* Centers the group in the middle of the page */
    align-items: center; /* Vertically aligns the text and the button */
    gap: 0.75rem; /* Adds a small space between the code and the button */
    margin-top: 0.5rem;
}

.create-new-room-button {
    display: flex;
    justify-content: center;
    align-items: center;
    width: 28px;
    height: 28px;
    border-radius: 50%; /* Makes it circular */
    background: linear-gradient(135deg, var(--primary-color), var(--secondary-color));
    color: white;
    font-size: 22px;
    font-weight: bold;
    text-decoration: none;
    line-height: 28px; /* Helps vertically align the '+' */
    box-shadow: 0 2px 8px var(--shadow-light-color);
    transition: transform 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease;
}

.create-new-room-button:hover {
    transform: scale(1.1);
    filter: brightness(1.15);
    box-shadow: 0 4px 12px var(--shadow-color);
}

.create-new-room-button:active {
    transform: scale(1);
    filter: brightness(1);
}
