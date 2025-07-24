# --- CRITICAL: Eventlet monkey patching must happen first ---
import eventlet
eventlet.monkey_patch()

# --- Standard Library Imports ---
import os
import time
import mimetypes
import uuid
import traceback
from threading import Lock

# --- Third-Party Imports ---
from flask import Flask, render_template, request, redirect, url_for, send_from_directory, jsonify
from flask_socketio import SocketIO, emit, join_room, leave_room
from mutagen import File as MutagenFile
from mutagen.id3 import APIC
from mutagen.mp4 import MP4Cover

# --- App and Global Variable Setup ---
thread_lock = Lock()
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_FOLDER = os.path.join(BASE_DIR, 'uploads')
ALLOWED_EXTENSIONS = {'mp3', 'wav', 'ogg', 'flac', 'm4a'}

app = Flask(__name__, static_url_path='/static')
app.config['SECRET_KEY'] = 'secret!'
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
redis_url = os.environ.get('REDIS_URL')
socketio = SocketIO(
    app,
    async_mode='eventlet',
    message_queue=redis_url,
    ping_timeout=10,      # The server will wait 10 seconds for a response
    ping_interval=5       # The server will send a ping every 5 seconds
)
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

rooms = {}

# =================================================================================
# Function Definitions
# =================================================================================

def sync_rooms_periodically():
    """A background task that periodically broadcasts the state of active rooms."""
    while True:
        with thread_lock:
            for room_id in list(rooms.keys()):
                room_state = rooms.get(room_id)
                if room_state and room_state.get('is_playing'):
                    socketio.emit('server_sync', {
                        'audio_time': room_state['last_progress_s'],
                        'server_time': room_state['last_updated_at']
                    }, room=room_id)
        socketio.sleep(3)

def allowed_file(filename):
    """Check if the file's extension is in the allowed list."""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def extract_cover_art(file_path):
    """
    Extracts cover art data and extension from an audio file.
    Returns (cover_data, cover_ext) or (None, None) if not found.
    """
    try:
        audio = MutagenFile(file_path)
        if not audio:
            print(f"[DEBUG] Mutagen could not open file: {file_path}")
            return None, None

        # MP4/M4A Files
        if hasattr(audio, 'tags') and audio.tags:
            if 'covr' in audio.tags:
                covers = audio.tags['covr']
                if covers:
                    ext = 'png' if covers[0].imageformat == MP4Cover.FORMAT_PNG else 'jpg'
                    print(f"[DEBUG] MP4 cover found, ext={ext}")
                    return covers[0], ext

        # FLAC Files
        if hasattr(audio, 'pictures') and audio.pictures:
            pic = audio.pictures[0]
            ext = 'png' if 'png' in pic.mime else 'jpg'
            print(f"[DEBUG] FLAC cover found, ext={ext}")
            return pic.data, ext

        # MP3 Files (ID3 Tags)
        if hasattr(audio, 'tags') and audio.tags:
            # Try APIC frames (standard for cover art)
            for tag in audio.tags.keys():
                if tag.startswith('APIC'):
                    pic = audio.tags[tag]
                    ext = 'png' if 'png' in pic.mime else 'jpg'
                    print(f"[DEBUG] MP3 APIC cover found, ext={ext}")
                    return pic.data, ext
                if tag.startswith('PIC'):
                    pic = audio.tags[tag]
                    ext = 'png' if 'png' in pic.mime else 'jpg'
                    print(f"[DEBUG] MP3 PIC cover found, ext={ext}")
                    return pic.data, ext

        # Direct attribute fallback for some formats
        if hasattr(audio, 'APIC'):
            pic = audio.APIC
            ext = 'png' if 'png' in pic.mime else 'jpg'
            print(f"[DEBUG] Direct APIC cover found, ext={ext}")
            return pic.data, ext
        if hasattr(audio, 'PIC'):
            pic = audio.PIC
            ext = 'png' if 'png' in pic.mime else 'jpg'
            print(f"[DEBUG] Direct PIC cover found, ext={ext}")
            return pic.data, ext

        print(f"[DEBUG] No cover art found in file: {file_path}")
    except Exception as e:
        print(f"Could not extract cover art from {os.path.basename(file_path)}: {e}")
    return None, None


# =================================================================================
# Flask Routes
# =================================================================================

@app.route('/uploads/<path:filename>')
def serve_file(filename):
    """Serve uploaded files."""
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)


@app.route('/upload', methods=['POST'])
def upload():
    """Handle audio file uploads with robust error handling."""
    room = request.form.get('room')
    if not room or room not in rooms:
        return jsonify({'success': False, 'error': 'Invalid or expired room'}), 400
        
    if 'audio' not in request.files:
        return jsonify({'success': False, 'error': 'No file part in the request'}), 400

    file = request.files['audio']
    if file.filename == '' or not allowed_file(file.filename):
        return jsonify({'success': False, 'error': 'File not allowed or not selected'}), 400

    try:
        from werkzeug.utils import secure_filename
        filename = secure_filename(file.filename)
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(file_path)
        print(f"[Room {room}] - File saved: {filename}")

        final_cover_filename = None
        # --- Using the new, robust helper function ---
        cover_data, cover_ext = extract_cover_art(file_path)
        print(f"[DEBUG] Cover extraction result for '{filename}': cover_data={'YES' if cover_data else 'NO'}, cover_ext={cover_ext}")

        if cover_data:
            cover_filename = f"{os.path.splitext(filename)[0]}_cover.{cover_ext}"
            cover_path = os.path.join(app.config['UPLOAD_FOLDER'], cover_filename)
            with open(cover_path, 'wb') as imgf:
                imgf.write(cover_data)
            final_cover_filename = cover_filename
            print(f"[Room {room}] - Cover art successfully extracted and saved as '{final_cover_filename}'.")
            print(f"[DEBUG] Cover file saved at: {cover_path}")
            print(f"[DEBUG] Cover file exists after save: {os.path.exists(cover_path)}")
        else:
            print(f"[Room {room}] - No cover art found or extracted.")
        print(f"[DEBUG] Emitting new_file event with cover: {final_cover_filename}")
            
        with thread_lock:
            rooms[room].update({
                'current_file': filename,
                'current_cover': final_cover_filename,
                'is_playing': False,
                'last_progress_s': 0,
                'last_updated_at': time.time(),
            })

        socketio.emit('new_file', {'filename': filename, 'cover': final_cover_filename}, room=room)
        socketio.emit('pause', {'time': 0}, room=room)
        
        return jsonify({'success': True, 'filename': filename})

    except Exception as e:
        print("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!")
        print(f"CRITICAL ERROR during file upload for room '{room}':")
        traceback.print_exc()
        print("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!")
        return jsonify({
            'success': False,
            'error': 'A critical server error occurred. Please check the logs.'
        }), 500


@app.route('/current_song')
def get_current_song():
    """Endpoint for new clients to get the currently loaded song."""
    room = request.args.get('room')
    if room and room in rooms:
        with thread_lock:
            return jsonify(rooms[room])
    return jsonify({'filename': None, 'cover': None})

@app.route('/')
def home():
    """Serve the page for creating or joining a room."""
    return render_template('room_select.html')

@app.route('/create_room', methods=['GET', 'POST'])
def create_room():
    """Create a new room and redirect to it."""
    room_id = str(uuid.uuid4())[:6]
    rooms[room_id] = {
        'current_file': None,
        'current_cover': None,
        'is_playing': False,
        'last_progress_s': 0,
        'last_updated_at': time.time(),
        'members': 0  # Initialize member count
    }
    print(f"New room created: {room_id}")
    return redirect(url_for('player_room', room_id=room_id))

@app.route('/room/<string:room_id>')
def player_room(room_id):
    """Serve the main player interface for a specific room."""
    if room_id not in rooms:
        return redirect(url_for('home'))
    # Calculate member count, default to 1 if not tracked
    member_count = 1
    room_state = rooms.get(room_id, {})
    if 'members' in room_state and isinstance(room_state['members'], int):
        member_count = max(room_state['members'], 1)
    return render_template('index.html', room_id=room_id, member_count=member_count)


# =================================================================================
# SocketIO Event Handlers
# =================================================================================

@socketio.on('join')
def on_join(data):
    room = data['room']
    if room in rooms:
        join_room(room)
        print(f"Client {request.sid} joined room: {room}")
        with thread_lock:
            # Update member count
            if 'members' not in rooms[room]:
                rooms[room]['members'] = 0
            rooms[room]['members'] += 1
            member_count = rooms[room]['members']

            room_state = rooms[room].copy()
            if room_state['is_playing']:
                time_since_update = time.time() - room_state['last_updated_at']
                room_state['last_progress_s'] += time_since_update
            emit('room_state', room_state)
            
            # Broadcast member count update to all clients in the room
            socketio.emit('member_count_update', {
                'count': member_count}, to=room)
    else:
        emit('error', {'message': 'Room not found.'})

@socketio.on('disconnect')
def on_disconnect():
    """Handle client disconnection and update member count"""
    print(f"Client disconnected: {request.sid}")
    for room_id in rooms(sid=request.sid):
        if room_id != request.sid:
            with thread_lock:
                if room_id in rooms and 'members' in rooms[room_id]:
                    rooms[room_id]['members'] -= 1

                    if rooms[room_id]['members'] < 0:
                        rooms[room_id]['members'] = 0
                    
                    new_count = rooms[room_id]['members']

                    leave_room(room_id)
                    print(f"Client {request.sid} left room: {room_id}, new member count: {new_count}")
                    # Emit updated member count to the room
                    socketio.emit('member_count_update', {'count': new_count}, to=room_id)
                    if new_count == 0:
                         print(f"Room {room_id} is now empty, cleaning up")
                         # Reset room state but keep the room for potential rejoins
                         rooms[room_id]['is_playing'] = False
                         rooms[room_id]['current_file'] = None
                         rooms[room_id]['current_cover'] = None

@socketio.on('client_ping')
def handle_client_ping():
    """Reply to a client's ping immediately for clock synchronization."""
    emit('server_pong', {'timestamp': time.time()})

@socketio.on('play')
def handle_play(data):
    room = data.get('room')
    if room in rooms:
        with thread_lock:
            room_state = rooms[room]
            room_state['is_playing'] = True
            room_state['last_progress_s'] = data.get('time', 0)
            room_state['last_updated_at'] = time.time()
        
        target_timestamp = time.time() + 0.3 # 300ms buffer
        socketio.emit('scheduled_play', {
            'audio_time': data.get('time', 0),
            'target_timestamp': target_timestamp
        }, to=room)

@socketio.on('pause')
def handle_pause(data):
    room = data.get('room')
    if room in rooms:
        with thread_lock:
            room_state = rooms[room]
            if room_state['is_playing']:
                time_since_update = time.time() - room_state['last_updated_at']
                final_progress = room_state['last_progress_s'] + time_since_update
                room_state['is_playing'] = False
                room_state['last_progress_s'] = final_progress
                room_state['last_updated_at'] = time.time()
                socketio.emit('pause', {'time': final_progress}, to=room)

@socketio.on('seek')
def handle_seek(data):
    room_id = data.get('room')
    new_time = data.get('time')
    if room_id in rooms and new_time is not None:
        with thread_lock:
            room_state = rooms[room_id]
            was_playing = room_state['is_playing']
            room_state['last_progress_s'] = new_time
            room_state['last_updated_at'] = time.time()
        
        if was_playing:
            target_timestamp = time.time() + 0.3 # 300ms buffer
            socketio.emit('scheduled_play', {
                'audio_time': new_time,
                'target_timestamp': target_timestamp
            }, to=room_id)
        else:
            socketio.emit('pause', {'time': new_time}, to=room_id)

@socketio.on('sync')
def handle_sync(data):
    room = data.get('room')
    if room in rooms:
        target_timestamp = time.time() + -0.3 # 300ms buffer
        socketio.emit('scheduled_play', {
            'audio_time': data.get('time', 0),
            'target_timestamp': target_timestamp
        }, to=room)


# =================================================================================
# Application Entry Point
# =================================================================================

# Now that sync_rooms_periodically is defined above, this line will work correctly.
socketio.start_background_task(target=sync_rooms_periodically)

if __name__ == '__main__':
    # This block runs for local development
    socketio.run(app, host='0.0.0.0', port=5000, debug=True, use_reloader=False)
