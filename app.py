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
# --- IMPORTANT: We still import 'rooms' here, but now it won't conflict ---
from flask_socketio import SocketIO, emit, join_room, leave_room, rooms
from mutagen import File as MutagenFile
from mutagen.id3 import APIC
from mutagen.mp4 import MP4Cover

# --- App and Global Variable Setup ---
thread_lock = Lock()
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Use local uploads directory (works with or without persistent disk)
if os.environ.get('RENDER'):
    # On Render, use local uploads directory (temporary, but works without persistent disk)
    UPLOAD_FOLDER = os.path.join(BASE_DIR, 'uploads')
else:
    # Local development
    UPLOAD_FOLDER = os.path.join(BASE_DIR, 'uploads')

ALLOWED_EXTENSIONS = {'mp3', 'wav', 'ogg', 'flac', 'm4a'}

app = Flask(__name__, static_url_path='/static')
app.config['SECRET_KEY'] = 'secret!'
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['JSON_AS_ASCII'] = False  # Ensure Unicode characters are not escaped in JSON responses

redis_url = os.environ.get('REDIS_URL')
socketio = SocketIO(
    app,
    async_mode='eventlet',
    message_queue=redis_url,
    ping_timeout=10,
    ping_interval=5
)

os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

# --- CHANGED: Renamed the dictionary to avoid name collision ---
rooms_data = {}

# =================================================================================
# Function Definitions
# =================================================================================

def sync_rooms_periodically():
    """A background task that periodically broadcasts the state of active rooms."""
    while True:
        with thread_lock:
            for room_id in list(rooms_data.keys()):
                room_state = rooms_data.get(room_id)
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
    """Serve uploaded files with proper Unicode handling."""
    print(f"[DEBUG] Serving file: {repr(filename)}")
    # Ensure filename is properly decoded
    try:
        import urllib.parse
        decoded_filename = urllib.parse.unquote(filename)
        print(f"[DEBUG] Decoded filename: {repr(decoded_filename)}")
        return send_from_directory(app.config['UPLOAD_FOLDER'], decoded_filename)
    except Exception as e:
        print(f"[DEBUG] Fallback to original filename due to error: {e}")
        return send_from_directory(app.config['UPLOAD_FOLDER'], filename)


@app.route('/upload', methods=['POST'])
def upload():
    """Handle audio file uploads with robust error handling and cloud storage support."""
    print(f"[DEBUG] Upload endpoint called. Upload folder: {app.config['UPLOAD_FOLDER']}")
    print(f"[DEBUG] Upload folder exists: {os.path.exists(app.config['UPLOAD_FOLDER'])}")
    
    room = request.form.get('room')
    print(f"[DEBUG] Room from request: {room}")
    print(f"[DEBUG] Available rooms: {list(rooms_data.keys())}")
    
    if not room or room not in rooms_data:
        print(f"[ERROR] Invalid room: {room}")
        return jsonify({'success': False, 'error': 'Invalid or expired room'}), 400
        
    if 'audio' not in request.files:
        return jsonify({'success': False, 'error': 'No file part in the request'}), 400

    file = request.files['audio']
    if not file.filename or file.filename == '' or not allowed_file(file.filename):
        return jsonify({'success': False, 'error': 'File not allowed or not selected'}), 400

    try:
        from werkzeug.utils import secure_filename
        import re
        # Ensure filename is not None before processing
        original_filename = file.filename
        if not original_filename:
            return jsonify({'success': False, 'error': 'Invalid filename'}), 400
        
        print(f"[DEBUG] Original filename: {repr(original_filename)}")
        print(f"[DEBUG] Original filename type: {type(original_filename)}")
        print(f"[DEBUG] Original filename length: {len(original_filename) if original_filename else 'None'}")
        
        # Test Unicode characters in original filename
        if original_filename:
            japanese_chars = [c for c in original_filename if ord(c) > 127]
            print(f"[DEBUG] Non-ASCII characters in original: {repr(japanese_chars)}")
        
        # Use a custom secure filename function that preserves Unicode characters
        def unicode_secure_filename(filename):
            # Remove path separators and other dangerous characters but keep Unicode
            print(f"[DEBUG] unicode_secure_filename input: {repr(filename)}")
            filename = re.sub(r'[/\\]', '', filename)  # Remove path separators
            filename = re.sub(r'[<>:"|?*]', '', filename)  # Remove Windows forbidden chars
            filename = filename.strip()  # Remove leading/trailing whitespace
            filename = re.sub(r'\s+', ' ', filename)  # Normalize whitespace
            print(f"[DEBUG] unicode_secure_filename output: {repr(filename)}")
            return filename if filename else None
        
        filename = unicode_secure_filename(original_filename)
        print(f"[DEBUG] Unicode secure filename: {repr(filename)}")
        print(f"[DEBUG] Unicode secure filename type: {type(filename)}")
        
        # Test Unicode preservation
        if filename:
            japanese_chars = [c for c in filename if ord(c) > 127]
            print(f"[DEBUG] Non-ASCII characters preserved: {repr(japanese_chars)}")
        
        if not filename:  # If filename is still empty, generate a random one
            filename = f"audio_{uuid.uuid4().hex[:8]}.mp3"
            print(f"[DEBUG] Generated fallback filename: {filename}")
            
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        
        # Ensure upload directory exists with proper error handling
        try:
            os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
            print(f"[DEBUG] Upload directory ensured: {app.config['UPLOAD_FOLDER']}")
        except Exception as mkdir_error:
            print(f"[ERROR] Failed to create upload directory: {mkdir_error}")
            return jsonify({'success': False, 'error': f'Directory creation failed: {str(mkdir_error)}'}), 500
        
        # Save file with error handling
        try:
            file.save(file_path)
            print(f"[DEBUG] File saved successfully: {file_path}")
        except Exception as save_error:
            print(f"[ERROR] Failed to save file: {save_error}")
            return jsonify({'success': False, 'error': f'File save failed: {str(save_error)}'}), 500
        print(f"[Room {room}] - File saved: {filename} (Original: {original_filename})")

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
            # Create audio item for queue
            audio_item = {
                'filename': filename,
                'filename_display': original_filename,
                'cover': final_cover_filename,
                'upload_time': time.time()
            }
            
            # Initialize queue if it doesn't exist
            if 'queue' not in rooms_data[room]:
                rooms_data[room]['queue'] = []
            if 'current_index' not in rooms_data[room]:
                rooms_data[room]['current_index'] = -1
            
            # Add to queue
            rooms_data[room]['queue'].append(audio_item)
            
            # If no song is currently loaded, set this as current
            if rooms_data[room]['current_file'] is None:
                rooms_data[room]['current_index'] = len(rooms_data[room]['queue']) - 1
                rooms_data[room].update({
                    'current_file': filename,
                    'current_file_display': original_filename,
                    'current_cover': final_cover_filename,
                    'is_playing': False,
                    'last_progress_s': 0,
                    'last_updated_at': time.time(),
                })
                
                # Send both filenames to client for the new current song
                emit_data = {
                    'filename': filename, 
                    'filename_display': original_filename,
                    'cover': final_cover_filename
                }
                print(f"[DEBUG] About to emit new_file with data: {repr(emit_data)}")
                socketio.emit('new_file', emit_data, to=room)
                socketio.emit('pause', {'time': 0}, to=room)
            
            # Always emit queue update
            socketio.emit('queue_update', {
                'queue': rooms_data[room]['queue'],
                'current_index': rooms_data[room]['current_index']
            }, to=room)
        
        print(f"[DEBUG] Filename being sent in JSON response: {repr(filename)}")
        return jsonify({'success': True, 'filename': filename, 'filename_display': original_filename})

    except Exception as e:
        print("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!")
        print(f"CRITICAL ERROR during file upload for room '{room}':")
        traceback.print_exc()
        print("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!")
        return jsonify({
            'success': False,
            'error': f'Upload failed: {str(e)}'
        }), 500


@app.route('/current_song')
def get_current_song():
    """Endpoint for new clients to get the currently loaded song."""
    room = request.args.get('room')
    if room and room in rooms_data:
        with thread_lock:
            return jsonify(rooms_data[room])
    return jsonify({'filename': None, 'cover': None})

@app.route('/queue/<string:room_id>')
def get_queue(room_id):
    """Get the current queue for a room."""
    if room_id not in rooms_data:
        return jsonify({'error': 'Room not found'}), 404
    
    with thread_lock:
        queue_data = {
            'queue': rooms_data[room_id].get('queue', []),
            'current_index': rooms_data[room_id].get('current_index', -1)
        }
    return jsonify(queue_data)

@app.route('/queue/<string:room_id>/play/<int:index>', methods=['POST'])
def play_from_queue(room_id, index):
    """Play a specific song from the queue."""
    if room_id not in rooms_data:
        return jsonify({'error': 'Room not found'}), 404
    
    with thread_lock:
        queue = rooms_data[room_id].get('queue', [])
        if index < 0 or index >= len(queue):
            return jsonify({'error': 'Invalid queue index'}), 400
        
        # Update current song
        audio_item = queue[index]
        rooms_data[room_id].update({
            'current_file': audio_item['filename'],
            'current_file_display': audio_item['filename_display'],
            'current_cover': audio_item['cover'],
            'current_index': index,
            'is_playing': False,
            'last_progress_s': 0,
            'last_updated_at': time.time(),
        })
    
    # Emit new song to all clients
    emit_data = {
        'filename': audio_item['filename'],
        'filename_display': audio_item['filename_display'],
        'cover': audio_item['cover']
    }
    socketio.emit('new_file', emit_data, to=room_id)
    socketio.emit('pause', {'time': 0}, to=room_id)
    
    # Update queue status
    socketio.emit('queue_update', {
        'queue': queue,
        'current_index': index
    }, to=room_id)
    
    return jsonify({'success': True})

@app.route('/queue/<string:room_id>/remove/<int:index>', methods=['DELETE'])
def remove_from_queue(room_id, index):
    """Remove a song from the queue."""
    if room_id not in rooms_data:
        return jsonify({'error': 'Room not found'}), 404
    
    with thread_lock:
        queue = rooms_data[room_id].get('queue', [])
        current_index = rooms_data[room_id].get('current_index', -1)
        
        if index < 0 or index >= len(queue):
            return jsonify({'error': 'Invalid queue index'}), 400
        
        # Remove from queue
        queue.pop(index)
        
        # Adjust current_index if necessary
        if index == current_index:
            # If we're removing the currently playing song
            if len(queue) == 0:
                # Queue is now empty
                rooms_data[room_id].update({
                    'current_file': None,
                    'current_file_display': None,
                    'current_cover': None,
                    'current_index': -1,
                    'is_playing': False,
                    'last_progress_s': 0,
                })
                socketio.emit('new_file', {'filename': None, 'filename_display': None, 'cover': None}, to=room_id)
            elif index < len(queue):
                # Play the next song (which is now at the same index)
                audio_item = queue[index]
                rooms_data[room_id].update({
                    'current_file': audio_item['filename'],
                    'current_file_display': audio_item['filename_display'],
                    'current_cover': audio_item['cover'],
                    'current_index': index,
                    'is_playing': False,
                    'last_progress_s': 0,
                })
                socketio.emit('new_file', {
                    'filename': audio_item['filename'],
                    'filename_display': audio_item['filename_display'],
                    'cover': audio_item['cover']
                }, to=room_id)
            else:
                # Play the previous song (index decreased by 1)
                new_index = index - 1
                audio_item = queue[new_index]
                rooms_data[room_id].update({
                    'current_file': audio_item['filename'],
                    'current_file_display': audio_item['filename_display'],
                    'current_cover': audio_item['cover'],
                    'current_index': new_index,
                    'is_playing': False,
                    'last_progress_s': 0,
                })
                socketio.emit('new_file', {
                    'filename': audio_item['filename'],
                    'filename_display': audio_item['filename_display'],
                    'cover': audio_item['cover']
                }, to=room_id)
        elif index < current_index:
            # Adjust current_index down by 1
            rooms_data[room_id]['current_index'] = current_index - 1
    
    # Update queue status
    socketio.emit('queue_update', {
        'queue': rooms_data[room_id]['queue'],
        'current_index': rooms_data[room_id]['current_index']
    }, to=room_id)
    
    return jsonify({'success': True})

@app.route('/')
def home():
    """Serve the page for creating or joining a room."""
    return render_template('room_select.html')

@app.route('/create_room', methods=['GET', 'POST'])
def create_room():
    """Create a new room and redirect to it."""
    room_id = str(uuid.uuid4())[:6]
    rooms_data[room_id] = {
        'current_file': None,
        'current_file_display': None,  # Store original filename for display
        'current_cover': None,
        'is_playing': False,
        'last_progress_s': 0,
        'last_updated_at': time.time(),
        'members': 0,  # Initialize member count
        'queue': [],  # Initialize queue for multiple audio files
        'current_index': -1  # Index of currently playing song in queue
    }
    print(f"New room created: {room_id}")
    return redirect(url_for('player_room', room_id=room_id))

@app.route('/room/<string:room_id>')
def player_room(room_id):
    """Serve the main player interface for a specific room."""
    if room_id not in rooms_data:
        return redirect(url_for('home'))
    # Calculate member count, default to 1 if not tracked
    member_count = 1
    room_state = rooms_data.get(room_id, {})
    if 'members' in room_state and isinstance(room_state['members'], int):
        member_count = max(room_state['members'], 1)
    return render_template('index.html', room_id=room_id, member_count=member_count)


# =================================================================================
# SocketIO Event Handlers
# =================================================================================

@socketio.on('join')
def on_join(data):
    print(f"--- JOIN EVENT: Client {request.sid} is attempting to join room {data.get('room')} ---")
    room = data['room']
    if room in rooms_data:
        join_room(room)
        print(f"--- JOIN SUCCESS: Client {request.sid} successfully joined room {room} ---")
        print(f"Client {request.sid} joined room: {room}")
        with thread_lock:
            # Update member count
            if 'members' not in rooms_data[room]:
                rooms_data[room]['members'] = 0
            rooms_data[room]['members'] += 1
            member_count = rooms_data[room]['members']

            room_state = rooms_data[room].copy()
            if room_state['is_playing']:
                time_since_update = time.time() - room_state['last_updated_at']
                room_state['last_progress_s'] += time_since_update
            
            print(f"[DEBUG] Sending room_state with filename: {repr(room_state.get('current_file'))}")
            print(f"[DEBUG] Sending room_state with display filename: {repr(room_state.get('current_file_display'))}")
            emit('room_state', room_state)
            
            # Send queue data to the joining client
            emit('queue_update', {
                'queue': rooms_data[room].get('queue', []),
                'current_index': rooms_data[room].get('current_index', -1)
            })
            
            # Broadcast member count update to all clients in the room
            socketio.emit('member_count_update', {
                'count': member_count}, to=room)
    else:
        print(f"--- JOIN FAILED: Room {room} does not exist. ---")
        emit('error', {'message': 'Room not found.'})

@socketio.on('disconnect')
def on_disconnect():
    """Handle client disconnection and update member count"""
    print(f"Client disconnected: {request.sid}")
    for room_id in rooms(sid=request.sid):
        if room_id != request.sid:
            print(f"--- DISCONNECT: Client was in room {room_id}. Processing member count... ---")
            with thread_lock:
                if room_id in rooms_data and 'members' in rooms_data[room_id]:
                    rooms_data[room_id]['members'] -= 1

                    if rooms_data[room_id]['members'] < 0:
                        rooms_data[room_id]['members'] = 0
                    
                    new_count = rooms_data[room_id]['members']

                    leave_room(room_id)
                    print(f"Client {request.sid} left room: {room_id}, new member count: {new_count}")
                    # Emit updated member count to the room
                    socketio.emit('member_count_update', {'count': new_count}, to=room_id)
                    if new_count == 0:
                         print(f"Room {room_id} is now empty, cleaning up")
                         # Reset room state but keep the room for potential rejoins
                         rooms_data[room_id]['is_playing'] = False
                         rooms_data[room_id]['current_file'] = None
                         rooms_data[room_id]['current_file_display'] = None
                         rooms_data[room_id]['current_cover'] = None
                         # Clear the queue when room is empty
                         rooms_data[room_id]['queue'] = []
                         rooms_data[room_id]['current_index'] = -1

@socketio.on('client_ping')
def handle_client_ping():
    """Reply to a client's ping immediately for clock synchronization."""
    emit('server_pong', {'timestamp': time.time()})

@socketio.on('play')
def handle_play(data):
    room = data.get('room')
    if room in rooms_data:
        with thread_lock:
            room_state = rooms_data[room]
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
    if room in rooms_data:
        with thread_lock:
            room_state = rooms_data[room]
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
    if room_id in rooms_data and new_time is not None:
        with thread_lock:
            room_state = rooms_data[room_id]
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
    if room in rooms_data:
        target_timestamp = time.time() + -0.3 # 300ms buffer
        socketio.emit('scheduled_play', {
            'audio_time': data.get('time', 0),
            'target_timestamp': target_timestamp
        }, to=room)

@socketio.on('next_song')
def handle_next_song(data):
    """Play the next song in the queue."""
    room = data.get('room')
    auto_play = data.get('auto_play', False)  # Check if this is auto-triggered
    
    if room not in rooms_data:
        return
        
    with thread_lock:
        queue = rooms_data[room].get('queue', [])
        current_index = rooms_data[room].get('current_index', -1)
        
        if len(queue) == 0:
            return
            
        next_index = current_index + 1
        if next_index >= len(queue):
            next_index = 0  # Loop back to start
            
        # Update current song
        audio_item = queue[next_index]
        rooms_data[room].update({
            'current_file': audio_item['filename'],
            'current_file_display': audio_item['filename_display'],
            'current_cover': audio_item['cover'],
            'current_index': next_index,
            'is_playing': auto_play,  # Set playing state based on auto_play
            'last_progress_s': 0,
            'last_updated_at': time.time(),
        })
    
    # Emit new song to all clients
    emit_data = {
        'filename': audio_item['filename'],
        'filename_display': audio_item['filename_display'],
        'cover': audio_item['cover']
    }
    socketio.emit('new_file', emit_data, to=room)
    
    if auto_play:
        # If auto-playing, start playback immediately
        target_timestamp = time.time() + 0.5  # 500ms buffer for loading
        socketio.emit('scheduled_play', {
            'audio_time': 0,
            'target_timestamp': target_timestamp
        }, to=room)
    else:
        # If manually triggered, just pause at beginning
        socketio.emit('pause', {'time': 0}, to=room)
    
    # Update queue status
    socketio.emit('queue_update', {
        'queue': queue,
        'current_index': next_index
    }, to=room)

@socketio.on('previous_song')
def handle_previous_song(data):
    """Play the previous song in the queue."""
    room = data.get('room')
    if room not in rooms_data:
        return
        
    with thread_lock:
        queue = rooms_data[room].get('queue', [])
        current_index = rooms_data[room].get('current_index', -1)
        
        if len(queue) == 0:
            return
            
        prev_index = current_index - 1
        if prev_index < 0:
            prev_index = len(queue) - 1  # Loop back to end
            
        # Update current song
        audio_item = queue[prev_index]
        rooms_data[room].update({
            'current_file': audio_item['filename'],
            'current_file_display': audio_item['filename_display'],
            'current_cover': audio_item['cover'],
            'current_index': prev_index,
            'is_playing': False,
            'last_progress_s': 0,
            'last_updated_at': time.time(),
        })
    
    # Emit new song to all clients
    emit_data = {
        'filename': audio_item['filename'],
        'filename_display': audio_item['filename_display'],
        'cover': audio_item['cover']
    }
    socketio.emit('new_file', emit_data, to=room)
    socketio.emit('pause', {'time': 0}, to=room)
    
    # Update queue status
    socketio.emit('queue_update', {
        'queue': queue,
        'current_index': prev_index
    }, to=room)


# =================================================================================
# Application Entry Point
# =================================================================================

# Now that sync_rooms_periodically is defined above, this line will work correctly.
socketio.start_background_task(target=sync_rooms_periodically)

if __name__ == '__main__':
    # This block runs for local development
    socketio.run(app, host='0.0.0.0', port=5000, debug=True, use_reloader=False)
