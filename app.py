from flask import Flask, render_template, request, redirect, url_for, make_response, send_from_directory, jsonify
from flask_socketio import SocketIO, emit, join_room, leave_room
import os
import time
import mimetypes
import uuid # Used for generating unique room IDs
from threading import Lock

thread_lock = Lock()

UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
ALLOWED_EXTENSIONS = {'mp3', 'wav', 'ogg', 'flac', 'm4a'}

app = Flask(__name__, static_url_path='/static')
app.config['SECRET_KEY'] = 'secret!'
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
# MODIFIED: Changed async_mode to 'eventlet' for production compatibility
socketio = SocketIO(app, async_mode='eventlet') 
# Ensure the upload folder exists
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

import base64
from mutagen import File as MutagenFile
from mutagen.id3 import ID3
from mutagen.id3._frames import APIC as ID3APIC
from mutagen.mp3 import MP3
from mutagen.flac import FLAC, Picture
from mutagen.oggvorbis import OggVorbis
from mutagen.mp4 import MP4

# In-memory state to track audio files and cover art for each room
# rooms = { 'room_id_1': {'current_file': 'song.mp3', 'current_cover': 'cover.jpg'}, ... }
rooms = {}

def sync_rooms_periodically():
    """A background task that periodically broadcasts the state of all active rooms."""
    while True:
        with thread_lock:
            # Iterate over a copy of the room keys to allow for safe modification
            for room_id in list(rooms.keys()):
                room_state = rooms.get(room_id)
                # Only sync rooms that are currently playing music
                if room_state and room_state.get('is_playing'):
                    # The server broadcasts its authoritative view of the world
                    socketio.emit('server_sync', {
                        'audio_time': room_state['last_progress_s'],
                        'server_time': room_state['last_updated_at']
                    }, room=room_id)
        # Wait for a few seconds before the next sync wave
        socketio.sleep(3) # Sync every 3 seconds

def allowed_file(filename):
    """Check if the file extension is allowed."""
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route('/uploads/<path:filename>')
def serve_file(filename):
    """Serve uploaded files with support for range requests (streaming)."""
    file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    if not os.path.exists(file_path):
        from flask import abort
        abort(404)

    range_header = request.headers.get('Range', None)
    size = os.path.getsize(file_path)
    mimetype = mimetypes.guess_type(file_path)[0] or 'application/octet-stream'

    if not range_header:
        # Serve the whole file if no range is requested
        return send_from_directory(app.config['UPLOAD_FOLDER'], filename, mimetype=mimetype)

    # Handle range request for streaming
    import re
    byte1, byte2 = 0, None
    match = re.search(r'bytes=(\d+)-(\d*)', range_header)
    if match:
        groups = match.groups()
        byte1 = int(groups[0])
        if groups[1]:
            byte2 = int(groups[1])
    
    length = size - byte1
    if byte2 is not None:
        length = byte2 - byte1 + 1
    
    data = None
    with open(file_path, 'rb') as f:
        f.seek(byte1)
        data = f.read(length)
    
    from flask import Response
    rv = Response(data, 206, mimetype=mimetype, direct_passthrough=True)
    rv.headers.add('Content-Range', f'bytes {byte1}-{byte1 + length - 1}/{size}')
    rv.headers.add('Accept-Ranges', 'bytes')
    return rv

@app.route('/upload', methods=['POST'])
def upload():
    """Handle audio file uploads for a specific room."""
    room = request.form.get('room')
    if not room or room not in rooms:
        return jsonify({'error': 'Invalid or expired room'}), 400
        
    if 'audio' not in request.files:
        return jsonify({'error': 'No file part'}), 400

    file = request.files['audio']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400

    if file and allowed_file(file.filename):
        from werkzeug.utils import secure_filename
        filename = secure_filename(file.filename)
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(file_path)
        
        # --- FIX: Step 1 - Process the file and determine the cover art filename first ---
        # Initialize to None. It will be updated if a cover is found.
        final_cover_filename = None
        try:
            audio = MutagenFile(file_path)
            cover_data = None
            cover_ext = 'jpg'
            
            # (Your existing mutagen logic to find cover_data is perfect)
            if isinstance(audio, MP3) and audio.tags:
                for tag in audio.tags.values():
                    if isinstance(tag, ID3APIC):
                        cover_data = tag.data
                        if 'image/png' in tag.mime.lower():
                           cover_ext = 'png'
                        break
            elif isinstance(audio, FLAC) and audio.pictures:
                pic = audio.pictures[0]
                cover_data = pic.data
                if hasattr(pic, 'mime') and 'png' in pic.mime:
                    cover_ext = 'png'
            elif isinstance(audio, MP4) and audio.tags and 'covr' in audio.tags:
                covr = audio.tags.get('covr')
                if covr:
                    if covr[0].imageformat == MP4.COVER_PNG:
                         cover_ext = 'png'
                    cover_data = covr[0]
            
            if cover_data:
                # If we found data, create the filename and save the file
                cover_filename = f"{os.path.splitext(filename)[0]}_cover.{cover_ext}"
                cover_path = os.path.join(app.config['UPLOAD_FOLDER'], cover_filename)
                with open(cover_path, 'wb') as imgf:
                    imgf.write(cover_data)
                
                # Set the final filename variable for later use
                final_cover_filename = cover_filename
                print(f"Cover art for room '{room}' saved as: {final_cover_filename}")
            else:
                print(f"No cover art found in the audio file for room '{room}'")

        except Exception as e:
            print(f"Cover art extraction failed for room '{room}': {e}")
            
        # --- FIX: Step 2 - Now, update the shared room state in one atomic operation ---
        with thread_lock:
            room_state = rooms[room]
            room_state['current_file'] = filename
            # Use the final cover filename determined above
            room_state['current_cover'] = final_cover_filename
            room_state['is_playing'] = False
            room_state['last_progress_s'] = 0
            room_state['last_updated_at'] = time.time()
            print(f"New file uploaded for room '{room}'. State reset. Cover: {final_cover_filename}")

        # --- FIX: Step 3 - Notify clients using the final, correct data ---
        # Notify all clients of the new file and its cover
        socketio.emit('new_file', {'filename': filename, 'cover': final_cover_filename}, room=room)
        # Send an explicit pause command to reset all clients to 0
        socketio.emit('pause', {'time': 0}, room=room)

        return jsonify({'success': True, 'filename': filename, 'cover': final_cover_filename})

    elif file:
        return jsonify({'error': f"File type not allowed. Please use one of: {', '.join(ALLOWED_EXTENSIONS)}"}), 400

    return jsonify({'error': 'File upload failed'}), 500

@app.route('/current_song')
def get_current_song():
    """Endpoint for new clients to get the currently loaded song and cover for a room."""
    room = request.args.get('room')
    if room and room in rooms:
        return jsonify(rooms[room])
    return jsonify({'filename': None, 'cover': None})


@app.route('/')
def home():
    """Serve the page for creating or joining a room."""
    return render_template('room_select.html')

@app.route('/create_room', methods=['GET', 'POST'])
def create_room():
    """Create a new room and redirect to it."""
    room_id = str(uuid.uuid4())[:6] # Generate a short, unique room ID
    # NEW: Initialize the full room state
    rooms[room_id] = {
        'current_file': None,
        'current_cover': None,
        'is_playing': False,
        'last_progress_s': 0,
        'last_updated_at': time.time()
    }
    print(f"New room created: {room_id}")
    return redirect(url_for('player_room', room_id=room_id))


@app.route('/room/<string:room_id>')
def player_room(room_id):
    """Serve the main player interface for a specific room."""
    if room_id not in rooms:
        # Optionally, redirect to the home page with an error message
        return redirect(url_for('home')) 
    return render_template('index.html', room_id=room_id)

# --- SocketIO Events ---

@socketio.on('join')
def on_join(data):
    """Client joins a room and gets the complete current state."""
    room = data['room']
    if room in rooms:
        join_room(room)
        print(f"Client {request.sid} joined room: {room}")

        # NEW: Calculate the real current progress before sending the state
        room_state = rooms[room]
        if room_state['is_playing']:
            time_since_update = time.time() - room_state['last_updated_at']
            room_state['last_progress_s'] += time_since_update
        
        room_state['last_updated_at'] = time.time()

        # Send the complete, up-to-the-second state to the new client
        emit('room_state', room_state, room=request.sid)

@socketio.on('get_server_time')
def handle_get_server_time():
    """Send server timestamp to client for synchronization."""
    emit('server_time', {'timestamp': time.time()})

@socketio.on('play')
def handle_play(data):
    """Client requests to play. The server updates the state AND broadcasts a simple 'play' event."""
    room = data.get('room')
    if room in rooms:
        current_time = data.get('time', 0)

        with thread_lock:
            room_state = rooms[room]
            if not room_state['is_playing']:
                room_state['is_playing'] = True
                room_state['last_progress_s'] = current_time
                room_state['last_updated_at'] = time.time()
                print(f"Room {room} state changed to PLAYING at {room_state['last_progress_s']:.2f}s")
        
        # --- THIS IS THE CRITICAL FIX ---
        # Broadcast a simple, direct 'play' event, just like pause and seek.
        # This is far more reliable than the complex scheduling approach.
        socketio.emit('play', {'time': current_time}, room=room)

@socketio.on('pause')
def handle_pause(data):
    """Client requests to pause. The server updates the authoritative state."""
    room = data.get('room')
    if room in rooms:
        with thread_lock:
            room_state = rooms[room]
            if room_state['is_playing']: # Prevent redundant updates
                # We need to calculate the actual progress before pausing
                time_since_update = time.time() - room_state['last_updated_at']
                final_progress = room_state['last_progress_s'] + time_since_update

                room_state['is_playing'] = False
                room_state['last_progress_s'] = final_progress
                room_state['last_updated_at'] = time.time()
                print(f"Room {room} state changed to PAUSED at {room_state['last_progress_s']:.2f}s")
                # Immediately broadcast the pause command for instant response
                socketio.emit('pause', { 'time': room_state['last_progress_s'] }, room=room)

@socketio.on('seek')
def handle_seek(data):
    """
    Handles a client seeking to a new time.
    This is a critical event that MUST update the server's authoritative state.
    """
    room_id = data.get('room')
    new_time = data.get('time')

    # Ensure the room exists and we received a valid time
    if room_id in rooms and new_time is not None:
        with thread_lock:
            # Get the current state for the room
            room_state = rooms[room_id]

            # --- THIS IS THE CRITICAL FIX ---
            # Update the authoritative server state with the new position
            room_state['last_progress_s'] = new_time
            room_state['last_updated_at'] = time.time()
            # --- END OF FIX ---

            print(f"Room {room_id} state updated by SEEK to {room_state['last_progress_s']:.2f}s")

        # Immediately broadcast the seek event to ALL clients (including the sender)
        # This ensures everyone snaps to the new, authoritative position instantly.
        # The client-side 'isReceivingUpdate' flag will prevent an echo loop.
        socketio.emit('seek', {'time': new_time}, room=room_id)

@socketio.on('sync')
def handle_sync(data):
    """
    Relay a sync event with a target absolute timestamp.
    This works identically to the 'play' handler but for manual re-syncing.
    """
    room = data.get('room')
    if room:
        emit('sync_at_timestamp', {
            'audio_time': data.get('time'),
            'target_timestamp': data.get('target_timestamp') # Relay timestamp from leader
        }, room=room, include_self=False)
        
# --- MODIFIED SECTION FOR RENDER.COM DEPLOYMENT ---

# Start the background task for periodic syncing in the main application thread.
# This ensures it runs correctly when deployed on a production server like
# Gunicorn, which is used by Render.
socketio.start_background_task(target=sync_rooms_periodically)

# This block is for running the application locally for development and testing.
# It will not be executed when deployed on Render.
if __name__ == '__main__':
    # The development server is run with use_reloader=False to prevent the
    # background task from being initialized twice.
    socketio.run(app, host='0.0.0.0', port=5000, debug=True, use_reloader=False)
