
## AudioFlow - Synchronized Audio Listening Rooms
[AudioFlow](http://audioflow.onrender.com "AudioFlow") is a real-time web application that allows users to create listening rooms, upload audio files, and listen together in perfect synchronization, no matter where they are. It's designed to bring back the shared experience of listening to music with friends, remotely.

------------
## Features



- **Real-time Playback Sync:** Play, pause, and seek audio, and have the changes instantly reflected for everyone in the room.
- **Dynamic Room System:** Quickly create a unique room with a shareable code or join an existing one.
- **Live Member Count:** See how many people are currently in the room with you.
- **Audio Uploads:** Users can upload their own audio files (.mp3, .wav, .ogg, .flac, .m4a).
- **Automatic Cover Art Extraction:** The application automatically extracts embedded cover art from audio files.
- **🎨 Dynamic Theming:** The entire UI theme and accent colors change based on the dominant color of the current song's cover art.
- 🎵 **Audio Visualizer:** Dancing bars next to the cover art react to the frequency and bass of the playing audio.
- **Syncing:** The app uses a client-side clock synchronization and playback rate adjustment to correct for minor drifts, ensuring everyone stays perfectly in sync.

------------

This project is built with a modern Python and JavaScript stack, designed for real-time performance.
**Backend:**
- **Python 3**
- **Flask-SocketIO:** For enabling real-time, bidirectional communication 
- **Gunicorn:** Production-grade WSGI server.


**Frontend:**
- **HTML5 / CSS3**
- **Vanilla JavaScript (ES6+):** For all client-side logic and interactivity.
- **Socket.IO Client:** To connect to the Flask-SocketIO backend.
