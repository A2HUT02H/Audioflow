import os
import time
import mimetypes
import uuid
import traceback
from threading import Lock

from flask import Flask, render_template, request, redirect, url_for, send_from_directory, jsonify
from flask_socketio import SocketIO, emit, join_room, leave_room
from mutagen import File as MutagenFile
from mutagen.id3 import APIC as ID3APIC
from mutagen.mp3 import MP3
from mutagen.flac import FLAC, Picture
from mutagen.mp4 import MP4, MP4Cover

# --- App and Global Variable Setup ---
thread_lock = Lock()

UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
ALLOWED_EXTENSIONS = {'mp3', 'wav', 'ogg', 'flac', 'm4a'}

app = Flask(__name__, static_url_path='/static')
app.config['SECRET_KEY'] = 'secret!'
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
socketio = SocketIO(app, async_mode='eventlet')
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

# In-memory dictionary to hold the state of all rooms
rooms = {}


# =================================================================================
# Function Definitions (Must come before they are called)
# =================================================================================

def sync_rooms_periodically():
    """A background task that periodically broadcasts the state of active rooms."""
    while True:
        with thread_lock:
            for room_id in list(rooms.keys()):
                room_state = rooms.get(room_id)
                # Only sync rooms that are currently playing music
                if room_state and room_state.get('is_playing'):
                    socketio.emit('server_sync', {
                        'audio_time': room_state['last_progress_s'],
                        'server_time': room_state['last_updated_at']
                    }, room=room_id)
        socketio.sleep(3) # Sync every 3 seconds

def allowed_file(filename):
    """Check if the file's extension is in the allowed list."""
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


# =================================================================================
# Flask Routes
# =================================================================================

@app.route('/uploads/<path:filename>')
def serve_file(filename):
    """Serve uploaded files with support for range requests (streaming)."""
    file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    if not os.path.exists(file_path):
        from flask import abort
        abort(404)
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
    if file.filename == '':
        return jsonify({'success': False, 'error': 'No file selected'}), 400

    if not allowed_file(file.filename):
        return jsonify({'success': False, 'error': f"File type not allowed. Please use one of: {', '.join(ALLOWED_EXTENSIONS)}"}), 400

    try:
        from werkzeug.utils import secure_filename
        filename = secure_filename(file.filename)
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(file_path)

        final_cover_filename = None
        try:
            audio = MutagenFile(file_path, easy=True) # Use easy=True for broad compatibility first
            cover_data = None
            cover_ext = 'jpg'
            
            # This logic attempts to find cover art in various file types
            if audio.mime and 'mp4' in audio.mime[0]:
                if 'covr' in audio:
                    cover_art_list = audio.get('covr', [])
                    if cover_art_list:
                         cover_data = cover_art_list[0]
                         if cover_art_list[0].imageformat == MP4Cover.FORMAT_PNG:
                            cover_ext = 'png'
            elif audio.mime and 'flac' in audio.mime[0]:
                if audio.pictures:
                    cover_data = audio.pictures[0].data
                    if 'png' in audio.pictures[0].mime:
                        cover_ext = 'png'
            elif audio.mime and 'mp3' in audio.mime[0]:
                audio_raw = MutagenFile(file_path) # Re-open without easy=True for detailed tags
                if 'APIC:' in audio_raw:
                    apic = audio_raw['APIC:']
                    cover_data = apic.data
                    if 'png' in apic.mime:
                        cover_ext = 'png'

            if cover_data:
                cover_filename = f"{os.path.splitext(filename)[0]}_cover.{cover_ext}"
                cover_path = os.path.join(app.config['UPLOAD_FOLDER'], cover_filename)
                with open(cover_path, 'wb') as imgf:
                    imgf.write(cover_data)
                final_cover_filename = cover_filename
        except Exception as e:
            print(f"WARNING: Non-fatal error extracting cover art for {filename}: {e}")

        # Update the shared room state atomically
        with thread_lock:
            rooms[room].update({
                'current_file': filename,
                'current_cover': final_cover_filename,
                'is_playing': False,
                'last_progress_s': 0,
                'last_updated_at': time.time(),
            })

        socketio.emit('new_file', {'filename': filename, 'cover': final_cover_filename}, room=room)
        socketio.emit('pause', {'time': 0}, room=room) # Explicitly reset all clients
        
        return jsonify({'success': True, 'filename': filename})

    except Exception as e:
        print("!!!!!!!!!!!!!!!! CRITICAL UPLOAD ERROR !!!!!!!!!!!!!!!!")
        traceback.print_exc()
        print("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!")
        return jsonify({
            'success': False,
            'error': 'An internal server error occurred while processing the file. The file may be corrupt.'
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
        'last_updated_at': time.time()
    }
    print(f"New room created: {room_id}")
    return redirect(url_for('player_room', room_id=room_id))

@app.route('/room/<string:room_id>')
def player_room(room_id):
    """Serve the main player interface for a specific room."""
    if room_id not in rooms:
        return redirect(url_for('home')) 
    return render_template('index.html', room_id=room_id)


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
            room_state = rooms[room].copy()
            if room_state['is_playing']:
                time_since_update = time.time() - room_state['last_updated_at']
                room_state['last_progress_s'] += time_since_update
            emit('room_state', room_state, room=request.sid)
    else:
        emit('error', {'message': 'Room not found.'}, room=request.sid)

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
        }, room=room)

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
                socketio.emit('pause', {'time': final_progress}, room=room)

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
            }, room=room_id)
        else:
            socketio.emit('pause', {'time': new_time}, room=room_id)

@socketio.on('sync')
def handle_sync(data):
    room = data.get('room')
    if room in rooms:
        target_timestamp = time.time() + -0.3 # 300ms buffer
        socketio.emit('scheduled_play', {
            'audio_time': data.get('time', 0),
            'target_timestamp': target_timestamp
        }, room=room)


# =================================================================================
# Application Entry Point
# =================================================================================

# Now that sync_rooms_periodically is defined above, this line will work correctly.
socketio.start_background_task(target=sync_rooms_periodically)

if __name__ == '__main__':
    # This block runs for local development
    socketio.run(app, host='0.0.0.0', port=5000, debug=True, use_reloader=False)
