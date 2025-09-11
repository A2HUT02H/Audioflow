# --- CRITICAL: Eventlet monkey patching must happen first ---
import eventlet
eventlet.monkey_patch()

# --- Standard Library Imports ---
import os
import time
import mimetypes
import uuid
import traceback
import urllib.parse
import re
import random
import io
from threading import Lock

# --- Third-Party Imports ---
from flask import Flask, render_template, request, redirect, url_for, send_from_directory, jsonify
# --- IMPORTANT: We still import 'rooms' here, but now it won't conflict ---
from flask_socketio import SocketIO, emit, join_room, leave_room, rooms
from mutagen import File as MutagenFile
from mutagen.id3 import APIC
from mutagen.mp4 import MP4Cover
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import syncedlyrics
from urllib.parse import urlparse
import threading
import time as _time
from collections import OrderedDict
import concurrent.futures
from PIL import Image
import io
from ytmusicapi import YTMusic
import base64
import json
try:
    from Crypto.Cipher import AES
except ImportError:
    AES = None
# --- Configure optimized HTTP session for downloads ---
def create_download_session():
    """Create an optimized requests session for downloads."""
    session = requests.Session()
    
    # Configure retry strategy
    retry_strategy = Retry(
        total=3,
        backoff_factor=1,
        status_forcelist=[429, 500, 502, 503, 504],
    )
    
    # Configure adapter with connection pooling and increased buffer sizes
    adapter = HTTPAdapter(
        max_retries=retry_strategy,
        pool_connections=20,
        pool_maxsize=40
    )
    
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    
    # Set optimized headers to mimic browser behavior
    session.headers.update({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
        'Accept': 'audio/webm,audio/ogg,audio/wav,audio/*;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
    })
    
    return session

# Global download session
download_session = create_download_session()

## Removed: server-side yt-dlp download helper and any direct YouTube fetching.

def download_with_range_requests(url, filepath, room):
    """Try to download using multiple parallel range requests for better speed."""
    try:
        print(f"[Room {room}] - Attempting parallel range request download")

        # Get file size first
        head_response = download_session.head(url, timeout=30)
        if 'Accept-Ranges' not in head_response.headers or head_response.headers['Accept-Ranges'] != 'bytes':
            print(f"[Room {room}] - Server doesn't support range requests")
            return False

        content_length = head_response.headers.get('Content-Length')
        if not content_length:
            print(f"[Room {room}] - No Content-Length header, cannot use range requests")
            return False

        total_size = int(content_length)
        if total_size < 1024 * 1024:  # Less than 1MB, not worth parallelizing
            print(f"[Room {room}] - File too small for parallel download")
            return False

        # Split into 4 chunks
        num_chunks = 4
        chunk_size = total_size // num_chunks

        def download_chunk(start, end, chunk_index):
            """Download a specific chunk of the file."""
            try:
                headers = {'Range': f'bytes={start}-{end}'}
                response = download_session.get(url, headers=headers, stream=True, timeout=120)
                response.raise_for_status()

                chunk_data = b''
                for data in response.iter_content(chunk_size=65536):  # 64KB sub-chunks
                    if data:
                        chunk_data += data

                return chunk_index, chunk_data
            except Exception as e:
                print(f"[Room {room}] - Chunk {chunk_index} download failed: {e}")
                return chunk_index, None

        # Download chunks in parallel
        start_time = time.time()
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            futures = []
            for i in range(num_chunks):
                start = i * chunk_size
                end = start + chunk_size - 1 if i < num_chunks - 1 else total_size - 1
                future = executor.submit(download_chunk, start, end, i)
                futures.append(future)

            # Collect results
            chunks = [None] * num_chunks
            for future in concurrent.futures.as_completed(futures):
                chunk_index, chunk_data = future.result()
                if chunk_data is None:
                    print(f"[Room {room}] - Parallel download failed, chunk {chunk_index} missing")
                    return False
                chunks[chunk_index] = chunk_data

        # Write chunks to file
        with open(filepath, 'wb') as f:
            for chunk_data in chunks:
                f.write(chunk_data)

        end_time = time.time()
        download_time = end_time - start_time
        speed_mbps = (total_size / 1024 / 1024) / download_time if download_time > 0 else 0
        print(f"[Room {room}] - Parallel download successful: {total_size/1024/1024:.2f}MB in {download_time:.2f}s, {speed_mbps:.2f}MB/s")
        return True

    except Exception as e:
        print(f"[Room {room}] - Parallel download failed: {e}")
        return False

# --- Load environment variables from .env file if it exists ---
try:
    from dotenv import load_dotenv
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
    if os.path.exists(env_path):
        load_dotenv(env_path)
except ImportError:
    # python-dotenv not installed, skip loading .env file
    pass

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

ALLOWED_EXTENSIONS = {'mp3', 'wav', 'ogg', 'flac', 'm4a', 'webm', 'opus', 'aac'}

app = Flask(__name__, static_url_path='/static')
app.config['SECRET_KEY'] = 'secret!'
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['JSON_AS_ASCII'] = False  # Ensure Unicode characters are not escaped in JSON responses
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100MB max file size
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 31536000  # Cache static files for 1 year

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
                    }, to=room_id)
        socketio.sleep(3)

def allowed_file(filename):
    """Check if the file's extension is in the allowed list."""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def extract_metadata(file_path):
    """
    Extracts metadata (title, artist, album) from an audio file.
    Returns a dictionary with metadata or fallback values.
    """
    try:
        audio = MutagenFile(file_path)
        if not audio:
            return {}
        
        metadata = {}
        
        # Extract title
        title = None
        if hasattr(audio, 'tags') and audio.tags:
            # Try different tag formats
            for tag_key in ['TIT2', 'TITLE', '\xa9nam', 'Title']:
                if tag_key in audio.tags:
                    title = str(audio.tags[tag_key][0]) if isinstance(audio.tags[tag_key], list) else str(audio.tags[tag_key])
                    break
        
        # Extract artist
        artist = None
        if hasattr(audio, 'tags') and audio.tags:
            # Try different tag formats
            for tag_key in ['TPE1', 'ARTIST', '\xa9ART', 'Artist']:
                if tag_key in audio.tags:
                    artist = str(audio.tags[tag_key][0]) if isinstance(audio.tags[tag_key], list) else str(audio.tags[tag_key])
                    break
        
        # Extract album
        album = None
        if hasattr(audio, 'tags') and audio.tags:
            # Try different tag formats
            for tag_key in ['TALB', 'ALBUM', '\xa9alb', 'Album']:
                if tag_key in audio.tags:
                    album = str(audio.tags[tag_key][0]) if isinstance(audio.tags[tag_key], list) else str(audio.tags[tag_key])
                    break
        
        metadata['title'] = title.strip() if title else None
        metadata['artist'] = artist.strip() if artist else None
        metadata['album'] = album.strip() if album else None
        
        return metadata
        
    except Exception as e:
        print(f"Could not extract metadata from {os.path.basename(file_path)}: {e}")
        return {}

def extract_cover_art(file_path):
    """
    Extracts cover art data and extension from an audio file.
    Returns (cover_data, cover_ext) or (None, None) if not found.
    """
    try:
        audio = MutagenFile(file_path)
        if not audio:
            return None, None

        # MP4/M4A Files
        if hasattr(audio, 'tags') and audio.tags:
            if 'covr' in audio.tags:
                covers = audio.tags['covr']
                if covers:
                    ext = 'png' if covers[0].imageformat == MP4Cover.FORMAT_PNG else 'jpg'
                    return covers[0], ext

        # FLAC Files
        if hasattr(audio, 'pictures') and audio.pictures:
            pic = audio.pictures[0]
            ext = 'png' if 'png' in pic.mime else 'jpg'
            return pic.data, ext

        # MP3 Files (ID3 Tags)
        if hasattr(audio, 'tags') and audio.tags:
            # Try APIC frames (standard for cover art)
            for tag in audio.tags.keys():
                if tag.startswith('APIC'):
                    pic = audio.tags[tag]
                    ext = 'png' if 'png' in pic.mime else 'jpg'
                    return pic.data, ext
                if tag.startswith('PIC'):
                    pic = audio.tags[tag]
                    ext = 'png' if 'png' in pic.mime else 'jpg'
                    return pic.data, ext

        # Direct attribute fallback for some formats
        if hasattr(audio, 'APIC'):
            pic = audio.APIC
            ext = 'png' if 'png' in pic.mime else 'jpg'
            return pic.data, ext
        if hasattr(audio, 'PIC'):
            pic = audio.PIC
            ext = 'png' if 'png' in pic.mime else 'jpg'
            return pic.data, ext

    except Exception as e:
        print(f"Could not extract cover art from {os.path.basename(file_path)}: {e}")
    return None, None

def get_lyrics(artist, title):
    """
    Fetches timestamped lyrics for a song using syncedlyrics.
    Returns timestamped lyrics in LRC format or None if not found.
    """
    if not artist or not title:
        return None
    
    # Clean up artist and title for better matching
    artist = artist.strip()
    title = title.strip()
    
    try:
        # Use syncedlyrics to get timestamped lyrics
        lrc_lyrics = syncedlyrics.search(f"{artist} {title}")
        
        if lrc_lyrics and lrc_lyrics.strip():
            print(f"Found timestamped lyrics for {artist} - {title}")
            return lrc_lyrics.strip()
        else:
            print(f"No timestamped lyrics found for {artist} - {title}")
            return None
            
    except Exception as e:
        print(f"Error fetching lyrics with syncedlyrics for {artist} - {title}: {e}")
        return None


# =================================================================================
# Flask Routes
# =================================================================================

@app.route('/metadata/<path:filename>')
def get_metadata(filename):
    """Get metadata for an existing audio file."""
    try:
        import urllib.parse
        decoded_filename = urllib.parse.unquote(filename)
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], decoded_filename)
        
        if not os.path.exists(file_path):
            return jsonify({'error': 'File not found'}), 404
            
        metadata = extract_metadata(file_path)
        return jsonify(metadata)
        
    except Exception as e:
        print(f"Error getting metadata for {filename}: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/lyrics')
def get_song_lyrics():
    """Get lyrics for a song based on artist and title parameters."""
    artist = request.args.get('artist')
    title = request.args.get('title')
    
    if not artist or not title:
        return jsonify({'error': 'Both artist and title parameters are required'}), 400
    
    try:
        lyrics = get_lyrics(artist, title)
        if lyrics:
            return jsonify({
                'success': True,
                'lyrics': lyrics,
                'artist': artist,
                'title': title
            })
        else:
            return jsonify({
                'success': False,
                'message': 'Lyrics not found',
                'artist': artist,
                'title': title
            }), 404
    except Exception as e:
        print(f"Error fetching lyrics for {artist} - {title}: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/lyrics/<path:filename>')
def get_lyrics_for_file(filename):
    """Get lyrics for a song based on its filename (extracts metadata first)."""
    try:
        import urllib.parse
        decoded_filename = urllib.parse.unquote(filename)
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], decoded_filename)
        
        if not os.path.exists(file_path):
            return jsonify({'error': 'File not found'}), 404
        
        # Extract metadata first
        metadata = extract_metadata(file_path)
        artist = metadata.get('artist')
        title = metadata.get('title')
        
        if not artist or not title:
            return jsonify({
                'success': False,
                'message': 'Could not extract artist or title from file metadata',
                'filename': decoded_filename
            }), 400
        
        # Fetch lyrics
        lyrics = get_lyrics(artist, title)
        if lyrics:
            return jsonify({
                'success': True,
                'lyrics': lyrics,
                'artist': artist,
                'title': title,
                'filename': decoded_filename
            })
        else:
            return jsonify({
                'success': False,
                'message': 'Lyrics not found',
                'artist': artist,
                'title': title,
                'filename': decoded_filename
            }), 404
            
    except Exception as e:
        print(f"Error getting lyrics for file {filename}: {e}")
        return jsonify({'error': str(e)}), 500

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


# ==================================================================
# YouTube Music search + streaming proxy support
# ==================================================================
# Configuration for YouTube Music API
USE_MOCK_API = os.environ.get('USE_MOCK_YTMUSIC', 'false').lower() == 'true'

# Simple in-memory mapping for resolved download links with expiry
# key: proxy_id, value: { 'url': original_url, 'expires_at': timestamp }
proxy_url_map = OrderedDict()
proxy_lock = threading.Lock()
PROXY_TTL = int(os.environ.get('YTMUSIC_PROXY_TTL', '300'))  # seconds

# Initialize YouTube Music API client
ytmusic = None
try:
    if not USE_MOCK_API:
        ytmusic = YTMusic()
        print("[DEBUG] YouTube Music API initialized successfully")
except Exception as e:
    print(f"[DEBUG] Failed to initialize YouTube Music API: {e}")
    print("[DEBUG] Falling back to mock mode")
    USE_MOCK_API = True

def cleanup_proxy_map():
    """Background cleaner for expired proxy entries."""
    while True:
        with proxy_lock:
            now = _time.time()
            keys = [k for k, v in proxy_url_map.items() if v['expires_at'] <= now]
            for k in keys:
                del proxy_url_map[k]
        _time.sleep(30)

# Start cleaner thread (daemon)
cleanup_thread = threading.Thread(target=cleanup_proxy_map, daemon=True)
cleanup_thread.start()

def add_proxy_url(original_url):
    """Add a resolved URL to the proxy map and return a short id."""
    proxy_id = uuid.uuid4().hex[:12]
    expires_at = _time.time() + PROXY_TTL
    with proxy_lock:
        proxy_url_map[proxy_id] = {'url': original_url, 'expires_at': expires_at}
    print(f"[DEBUG] Added proxy_id: {proxy_id} for URL: {original_url}")
    return proxy_id

def get_proxy_url(proxy_id):
    with proxy_lock:
        entry = proxy_url_map.get(proxy_id)
        print(f"[DEBUG] Looking up proxy_id: {proxy_id}, found: {entry is not None}")
        if not entry:
            print(f"[DEBUG] Available proxy_ids: {list(proxy_url_map.keys())}")
            return None
        # refresh expiry on access
        entry['expires_at'] = _time.time() + PROXY_TTL
        print(f"[DEBUG] Returning URL: {entry['url']}")
        return entry['url']

@app.route('/register_proxy', methods=['POST'])
def register_proxy():
    """Register an arbitrary upstream URL and get a short-lived proxy_id.

    Body JSON: { "url": "https://example.com/file" }
    Returns: { success: true, proxy_id, expires_in }
    """
    try:
        data = request.get_json(silent=True) or {}
        url = data.get('url')
        if not url or not isinstance(url, str):
            return jsonify({'success': False, 'error': 'url is required'}), 400
        # Basic scheme validation; we do not fetch here
        parsed = urlparse(url)
        if parsed.scheme not in ('http', 'https'):
            return jsonify({'success': False, 'error': 'Unsupported URL scheme'}), 400
        proxy_id = add_proxy_url(url)
        return jsonify({'success': True, 'proxy_id': proxy_id, 'expires_in': PROXY_TTL})
    except Exception as e:
        print(f"[DEBUG] register_proxy error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

def enhance_youtube_thumbnail_quality(url, video_id=None):
    """
    Get YouTube thumbnail using the high-quality URL format and extract video ID if needed.
    Uses the format: https://img.youtube.com/vi/{video_id}/maxresdefault.jpg
    """
    try:
        # If video_id is provided directly, use it
        if video_id:
            print(f"[DEBUG] Using provided video_id: {video_id}")
            return f"https://img.youtube.com/vi/{video_id}/maxresdefault.jpg"
        
        # Extract video ID from any YouTube URL
        if not url or 'youtube' not in url.lower() and 'ytimg' not in url.lower():
            return url
        
        extracted_video_id = None
        
        # Try multiple patterns to extract video ID
        patterns = [
            r'/vi/([^/]+)/',              # i.ytimg.com format
            r'vi/([^/]+)/[^/]+\.jpg',     # Alternative ytimg format
            r'videoId[=/]([a-zA-Z0-9_-]{11})',  # Direct video ID
            r'v[=/]([a-zA-Z0-9_-]{11})',  # YouTube URL format
            r'([a-zA-Z0-9_-]{11})',       # Any 11-character string (video ID pattern)
        ]
        
        for pattern in patterns:
            match = re.search(pattern, url)
            if match:
                potential_id = match.group(1)
                # Validate it's a proper YouTube video ID (11 characters, alphanumeric + _ -)
                if len(potential_id) == 11 and re.match(r'^[a-zA-Z0-9_-]+$', potential_id):
                    extracted_video_id = potential_id
                    break
        
        if extracted_video_id:
            high_quality_url = f"https://img.youtube.com/vi/{extracted_video_id}/maxresdefault.jpg"
            print(f"[DEBUG] Generated high-quality URL: {high_quality_url}")
            return high_quality_url
        
        print(f"[DEBUG] Could not extract video ID from URL: {url}")
        return url
        
    except Exception as e:
        print(f"[DEBUG] Error enhancing thumbnail URL: {e}")
        return url

def crop_image_to_square(image_data):
    """
    Crop a rectangular image to 1:1 square ratio from the center.
    Automatically detects and removes black bars by scanning pixel brightness.
    """
    try:
        # Open image from bytes
        img = Image.open(io.BytesIO(image_data))
        
        # Convert to RGB if needed for consistent processing
        if img.mode in ('RGBA', 'LA', 'P'):
            background = Image.new('RGB', img.size, (255, 255, 255))
            if img.mode == 'P':
                img = img.convert('RGBA')
            if img.mode in ('RGBA', 'LA'):
                background.paste(img, mask=img.split()[-1] if img.mode == 'RGBA' else None)
            else:
                background.paste(img)
            img = background
        
        width, height = img.size
        print(f"[DEBUG] Original image dimensions: {width}x{height}")
        
        # Convert to numpy array for efficient processing
        import numpy as np
        img_array = np.array(img)
        
        # Calculate brightness for each pixel (luminance)
        if len(img_array.shape) == 3:
            # RGB image - calculate luminance using standard weights
            brightness = np.dot(img_array[...,:3], [0.299, 0.587, 0.114])
        else:
            # Grayscale image
            brightness = img_array
        
        # Define black bar threshold (adjust as needed)
        black_threshold = 30  # Pixels with brightness below this are considered "black"
        
        # Detect horizontal black bars (letterbox)
        def detect_horizontal_bars():
            row_means = np.mean(brightness, axis=1)
            non_black_rows = np.where(row_means > black_threshold)[0]
            if len(non_black_rows) > 0:
                top_crop = non_black_rows[0]
                bottom_crop = non_black_rows[-1] + 1
                return top_crop, bottom_crop
            return 0, height
        
        # Detect vertical black bars (pillarbox)
        def detect_vertical_bars():
            col_means = np.mean(brightness, axis=0)
            non_black_cols = np.where(col_means > black_threshold)[0]
            if len(non_black_cols) > 0:
                left_crop = non_black_cols[0]
                right_crop = non_black_cols[-1] + 1
                return left_crop, right_crop
            return 0, width
        
        # Detect and remove black bars
        top_crop, bottom_crop = detect_horizontal_bars()
        left_crop, right_crop = detect_vertical_bars()
        
        # Apply detected crops
        if top_crop > 0 or bottom_crop < height or left_crop > 0 or right_crop < width:
            print(f"[DEBUG] Detected black bars - cropping to: left={left_crop}, top={top_crop}, right={right_crop}, bottom={bottom_crop}")
            img = img.crop((left_crop, top_crop, right_crop, bottom_crop))
            width, height = img.size
            print(f"[DEBUG] After black bar removal: {width}x{height}")
        
        # If already square after black bar removal, return as-is
        if width == height:
            output = io.BytesIO()
            img.save(output, format='JPEG', quality=90, optimize=True)
            return output.getvalue()
        
        # Calculate crop dimensions for center square from the remaining content
        size = min(width, height)
        left = (width - size) // 2
        top = (height - size) // 2
        right = left + size
        bottom = top + size
        
        # Crop to square
        cropped_img = img.crop((left, top, right, bottom))
        print(f"[DEBUG] Final square crop: {size}x{size}")
        
        # Save as JPEG
        output = io.BytesIO()
        cropped_img.save(output, format='JPEG', quality=90, optimize=True)
        return output.getvalue()
        
    except ImportError:
        print("[DEBUG] NumPy not available - falling back to basic center crop")
        return crop_image_to_square_basic(image_data)
    except Exception as e:
        print(f"[DEBUG] Error in smart cropping: {e} - falling back to basic crop")
        return crop_image_to_square_basic(image_data)

def crop_image_to_square_basic(image_data):
    """
    Basic center crop fallback when NumPy is not available.
    """
    try:
        # Open image from bytes
        img = Image.open(io.BytesIO(image_data))
        
        # Get dimensions
        width, height = img.size
        print(f"[DEBUG] Basic crop - Original dimensions: {width}x{height}")
        
        # If already square, return as-is
        if width == height:
            output = io.BytesIO()
            img.save(output, format='JPEG', quality=90)
            return output.getvalue()
        
        # Calculate crop dimensions for center square
        size = min(width, height)
        left = (width - size) // 2
        top = (height - size) // 2
        right = left + size
        bottom = top + size
        
        # Crop to square
        cropped_img = img.crop((left, top, right, bottom))
        print(f"[DEBUG] Basic cropped to square: {size}x{size}")
        
        # Convert to RGB if needed (removes alpha channel)
        if cropped_img.mode in ('RGBA', 'LA'):
            background = Image.new('RGB', cropped_img.size, (255, 255, 255))
            background.paste(cropped_img, mask=cropped_img.split()[-1] if cropped_img.mode == 'RGBA' else None)
            cropped_img = background
        
        # Save as JPEG
        output = io.BytesIO()
        cropped_img.save(output, format='JPEG', quality=90, optimize=True)
        return output.getvalue()
        
    except Exception as e:
        print(f"[DEBUG] Error in basic cropping: {e}")
        return image_data  # Return original if cropping fails

def get_youtube_audio_url(video_id):
    """Deprecated: server must not resolve YouTube audio URLs. Always return None."""
    return None

def stream_remote_range(url):
    """Stream remote content while supporting Range requests from the client.
    This function proxies the upstream URL and yields chunks.
    """
    print(f"[DEBUG] stream_remote_range called with URL: {url}")
    # Determine client's range header
    range_header = request.headers.get('Range')
    headers = {}
    if range_header:
        headers['Range'] = range_header
        print(f"[DEBUG] Client sent Range header: {range_header}")

    # Stream from upstream
    print(f"[DEBUG] Making request to upstream URL...")
    # Use the optimized shared session; allow redirects
    upstream = download_session.get(url, headers=headers, stream=True, timeout=20, allow_redirects=True)
    # Some upstreams (Invidious instances) may reject Range for tiny probes. If 403/416 and we had Range, retry without Range.
    if upstream.status_code in (403, 416) and 'Range' in headers:
        try:
            print(f"[DEBUG] Upstream returned {upstream.status_code} for ranged request. Retrying without Range...")
            upstream.close()
        except Exception:
            pass
        hdr_no_range = {k: v for k, v in headers.items() if k.lower() != 'range'}
        upstream = download_session.get(url, headers=hdr_no_range, stream=True, timeout=20, allow_redirects=True)
    print(f"[DEBUG] Upstream response status: {upstream.status_code}")
    print(f"[DEBUG] Upstream response headers: {dict(upstream.headers)}")

    # Build response headers
    upstream_headers = {}
    for h in ['Content-Type', 'Content-Length', 'Accept-Ranges', 'Content-Range']:
        if h in upstream.headers:
            upstream_headers[h] = upstream.headers[h]

    # Ensure a sensible Content-Type for audio if missing
    if 'Content-Type' not in upstream_headers:
        import mimetypes
        guessed, _ = mimetypes.guess_type(url)
        if guessed and guessed.startswith('audio/'):
            upstream_headers['Content-Type'] = guessed
        else:
            # Common fallbacks for youtube streams
            ct = 'audio/mp4'
            if '.mp3' in url:
                ct = 'audio/mpeg'
            elif '.webm' in url:
                ct = 'audio/webm'
            upstream_headers['Content-Type'] = ct

    # Ensure Range support headers
    if range_header and 'Accept-Ranges' not in upstream_headers:
        upstream_headers['Accept-Ranges'] = 'bytes'

    # CORS headers so the audio element can use the stream
    upstream_headers['Access-Control-Allow-Origin'] = '*'
    upstream_headers['Access-Control-Allow-Headers'] = 'Range, Origin, Accept, Content-Type'
    upstream_headers['Access-Control-Expose-Headers'] = 'Content-Range, Accept-Ranges, Content-Length, Content-Type'
    # Light caching to avoid revalidation on chunks
    upstream_headers.setdefault('Cache-Control', 'public, max-age=600')

    def generate():
        try:
            for chunk in upstream.iter_content(chunk_size=65536):
                if chunk:
                    yield chunk
        finally:
            try:
                upstream.close()
            except:
                pass

    # If upstream forbids access, avoid leaking a 403 to the browser which can confuse UI; map to 502 so frontend retries instance/itag
    status = upstream.status_code
    if status == 403:
        status = 502
    return generate(), status, upstream_headers


@app.route('/search_ytmusic')
def search_ytmusic():
    """Search via YouTube Music API. Returns metadata and a proxy id for streaming.

    Query params: q (search term)
    """
    print(f"[DEBUG] USE_MOCK_API: {USE_MOCK_API}")
    
    q = request.args.get('q')
    if not q:
        return jsonify({'success': False, 'error': 'q parameter required'}), 400

    # Mock API for testing when no real API is available
    if USE_MOCK_API:
        # Return mock data for testing - multiple results
        search_limit = 5 # Hardcoded to 5 results
        mock_results = []
        
        for i in range(min(search_limit, 3)):  # Generate up to 3 mock results
            mock_data = {
                'title': f'Mock Song {i+1} - {q}',
                'artist': f'Mock Artist {i+1}',
                'image': 'https://via.placeholder.com/300x300.png?text=Mock+Cover',
                'download': 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',  # Free test MP3
                'duration': 180 + i * 30,  # Different durations
                'album': f'Mock Album {i+1}' if i > 0 else ''
            }
            
            proxy_id = add_proxy_url(mock_data['download'])
            mock_results.append({
                'proxy_id': proxy_id,
                'metadata': {
                    'title': mock_data['title'],
                    'artist': mock_data['artist'],
                    'image': mock_data['image'],
                    'duration': mock_data['duration'],
                    'album': mock_data['album']
                },
                'video_id': f'mock_video_{i+1}',
                'expires_in': PROXY_TTL
            })
        
        return jsonify({
            'success': True,
            'results': mock_results,
            'total': len(mock_results),
            'note': 'Using mock data for testing'
        })

    # Real YouTube Music API code
    try:
        if not ytmusic:
            return jsonify({'success': False, 'error': 'YouTube Music API not available'}), 500

        # Search for songs - get multiple results
        search_limit = 5  # Hardcoded to 5 results
        search_results = ytmusic.search(q, filter='songs', limit=search_limit)

        if not search_results:
            return jsonify({'success': False, 'error': 'No results found'}), 404

        # Process up to 5 results
        processed_results = []
        for song in search_results[:5]:
            video_id = song.get('videoId')

            if not video_id:
                continue  # Skip results without video ID

            # Extract metadata
            artists = song.get('artists', [])
            if isinstance(artists, list) and artists:
                artist_str = ', '.join([artist.get('name', 'Unknown') for artist in artists])
            else:
                artist_str = 'Unknown Artist'

            # Get thumbnail - use the specific format with video_id for high quality
            thumbnails = song.get('thumbnails', [])
            image_url = ''
            if video_id:
                # Use the specific YouTube thumbnail format
                image_url = enhance_youtube_thumbnail_quality(None, video_id)
                print(f"[DEBUG] Using high-quality thumbnail URL: {image_url}")
            elif thumbnails:
                # Fallback to thumbnails from API and enhance them
                sorted_thumbnails = sorted(thumbnails, key=lambda x: (x.get('width', 0) * x.get('height', 0)), reverse=True)
                if sorted_thumbnails:
                    best_thumbnail = sorted_thumbnails[0]
                    raw_url = best_thumbnail.get('url', '')
                    print(f"[DEBUG] Selected thumbnail: {best_thumbnail.get('width', 'unknown')}x{best_thumbnail.get('height', 'unknown')} - {raw_url}")
                    image_url = enhance_youtube_thumbnail_quality(raw_url)
                else:
                    raw_url = thumbnails[-1].get('url', '')
                    image_url = enhance_youtube_thumbnail_quality(raw_url)

            metadata = {
                'title': song.get('title', 'Unknown Title'),
                'artist': artist_str,
                'image': image_url,
                'image_url': image_url,
                'duration': song.get('duration_seconds'),
                'album': song.get('album', {}).get('name', '') if song.get('album') else ''
            }

            # Do not resolve audio URLs server-side; client will handle via third-party API
            processed_results.append({
                'metadata': metadata,
                'video_id': video_id
            })

        if not processed_results:
            return jsonify({'success': False, 'error': 'No valid results found'}), 404

        return jsonify({
            'success': True,
            'results': processed_results,
            'total': len(processed_results)
        })

    except Exception as e:
        print(f"Error querying YouTube Music API: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


# ==================================================================
# JioSaavn integration (unofficial)
# ==================================================================

JIOSAAVN_BASE = 'https://www.jiosaavn.com'
JIOSAAVN_API = 'https://www.jiosaavn.com/api.php'

def _jio_headers():
    return {
        'User-Agent': download_session.headers.get('User-Agent'),
        'Accept': 'application/json, text/plain,*/*',
        'Referer': 'https://www.jiosaavn.com/',
        'Origin': 'https://www.jiosaavn.com'
    }

def _upgrade_image_quality(image_url):
    """Upgrade JioSaavn image quality to highest available resolution"""
    if not image_url:
        return image_url
    
    # Upgrade to 500x500 (highest confirmed quality supported by JioSaavn)
    # Handle different patterns that JioSaavn uses
    for old_size in ["50x50", "150x150", "300x300"]:
        if old_size in image_url:
            image_url = image_url.replace(old_size, "500x500")
            break
    
    return image_url

def _decrypt_jiosaavn_url(encrypted_url: str) -> str:
    """Decrypt JioSaavn URL using DES encryption like vendz/jiosaavn-api"""
    if not encrypted_url:
        return encrypted_url
    if encrypted_url.startswith('http://') or encrypted_url.startswith('https://'):
        return encrypted_url
    
    try:
        # Use DES encryption like vendz repo
        from pyDes import des, ECB, PAD_PKCS5
        import base64
        
        des_cipher = des(b"38346591", ECB, b"\0\0\0\0\0\0\0\0", pad=None, padmode=PAD_PKCS5)
        enc_url = base64.b64decode(encrypted_url.strip())
        dec_url = des_cipher.decrypt(enc_url, padmode=PAD_PKCS5).decode('utf-8')
        # Replace 96kbps with 320kbps like vendz
        dec_url = dec_url.replace("_96.mp4", "_320.mp4")
        return dec_url
    except Exception as e:
        print(f"[DEBUG] DES decryption failed: {e}")
        # Fallback to original approach if DES fails
        try:
            b = base64.b64decode(encrypted_url)
            if b and AES:
                key = b"38346591b33b8f58"  # 16 bytes
                cipher = AES.new(key, AES.MODE_ECB)
                decrypted = cipher.decrypt(b)
                pad_len = decrypted[-1]
                if isinstance(pad_len, int) and 1 <= pad_len <= 16:
                    decrypted = decrypted[:-pad_len]
                url = decrypted.decode('utf-8', errors='ignore').strip('\x00')
                if url.startswith('http'):
                    return url
        except Exception:
            pass
        # Final fallback: simple base64 -> text
        try:
            decoded = base64.b64decode(encrypted_url).decode('utf-8', errors='ignore')
            if decoded.startswith('http'):
                return decoded
        except Exception:
            pass
    
    return encrypted_url

def _pick_jiosaavn_media(song_obj: dict, preferred=['320kbps','160kbps','128kbps']):
    """Pick best media URL using vendz approach with proper fallbacks"""
    # Try encrypted_media_url first (most reliable)
    if song_obj.get('encrypted_media_url'):
        decrypted_url = _decrypt_jiosaavn_url(song_obj['encrypted_media_url'])
        if decrypted_url and decrypted_url.startswith('http'):
            return decrypted_url
    
    # Try media_preview_url with vendz format logic
    media_url = song_obj.get('media_preview_url')
    if media_url:
        try:
            # Use vendz approach: replace preview with aac, then build quality variants
            song_url = media_url.replace('preview', 'aac')
            song_url = song_url.replace('_96_p.mp4', '_96.mp4')
            
            # Build quality variants like vendz
            if '320kbps' in preferred and song_obj.get('320kbps') == 'true':
                song_url_320 = song_url.replace('_96.mp4', '_320.mp4')
                return song_url_320
            elif '160kbps' in preferred:
                song_url_160 = song_url.replace('_96.mp4', '_160.mp4')
                return song_url_160
            else:
                return song_url
        except Exception:
            pass
    
    # Try direct media_url field
    if song_obj.get('media_url'):
        media_url = song_obj['media_url']
        if media_url.startswith('http'):
            return media_url
        else:
            # Try to decrypt if it looks encrypted
            decrypted = _decrypt_jiosaavn_url(media_url)
            if decrypted and decrypted.startswith('http'):
                return decrypted
    
    return None

@app.route('/search_jiosaavn')
def search_jiosaavn():
    """Search songs on JioSaavn using autocomplete.get like vendz/jiosaavn-api"""
    q = request.args.get('q')
    if not q:
        return jsonify({'success': False, 'error': 'q parameter required'}), 400
    
    # Use vendz autocomplete.get endpoint for consistency
    params = {
        '__call': 'autocomplete.get',
        'query': q,
        '_format': 'json',
        '_marker': '0',
        'cc': 'in',
        'includeMetaTags': '1'
    }
    try:
        r = download_session.get(JIOSAAVN_API, params=params, headers=_jio_headers(), timeout=10)
        if r.status_code != 200:
            return jsonify({'success': False, 'error': f'upstream {r.status_code}'}), 502
        
        # Try multiple JSON parsing approaches for robustness
        data = None
        
        # First try: Parse as-is (sometimes works)
        try:
            data = r.json()
        except json.JSONDecodeError:
            pass
        
        # Second try: Decode unicode escapes like vendz (most common)
        if not data:
            try:
                text_data = r.text.encode().decode('unicode-escape')
                data = json.loads(text_data)
            except json.JSONDecodeError:
                pass
        
        # Third try: Clean problematic characters before parsing
        if not data:
            try:
                # Clean the text by fixing common JSON issues
                cleaned_text = r.text
                # Replace problematic escape sequences
                cleaned_text = cleaned_text.replace('\\"', '"')
                cleaned_text = cleaned_text.replace('\\/', '/')
                # Try to parse cleaned text
                data = json.loads(cleaned_text)
            except json.JSONDecodeError:
                pass
        
        # Fourth try: Use regex to extract valid JSON structure
        if not data:
            try:
                import re
                # Extract the main JSON structure
                match = re.search(r'\{.*\}', r.text, re.DOTALL)
                if match:
                    json_text = match.group(0)
                    data = json.loads(json_text)
            except (json.JSONDecodeError, AttributeError):
                pass
        
        if not data:
            print(f"[DEBUG] JioSaavn JSON parsing failed for query: {q}")
            print(f"[DEBUG] Response text preview: {r.text[:200]}...")
            return jsonify({'success': False, 'error': 'failed to parse response'}), 502
        
        songs = data.get('songs', {}).get('data', [])
        results = []
        for s in songs[:12]:
            # Format like vendz approach
            more_info = s.get('more_info', {})
            results.append({
                'id': s.get('id'),
                'title': s.get('title') or s.get('song'),
                'artist': (more_info.get('primary_artists') or 
                          more_info.get('singers') or 
                          s.get('primary_artists') or 
                          s.get('singers') or 
                          s.get('music')),
                'album': s.get('album'),
                'image': _upgrade_image_quality(s.get('image') or ''),
                'duration': s.get('duration', '0'),
                'language': more_info.get('language') or s.get('language'),
                'encrypted_media_url': s.get('encrypted_media_url'),
                'media_preview_url': s.get('media_preview_url'),
                'has_lyrics': s.get('has_lyrics', 'false'),
                '320kbps': s.get('320kbps', 'false')
            })
        return jsonify({'success': True, 'results': results, 'total': len(results)})
    except Exception as e:
        print(f"[DEBUG] JioSaavn search error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/resolve_jiosaavn')
def resolve_jiosaavn():
    """Resolve a JioSaavn song id to a direct audio URL (not proxied yet).
    Query params: id, quality(optional: 320kbps|160kbps|128kbps)
    Returns: metadata + (optional) proxy_id if register=1 provided.
    """
    song_id = request.args.get('id')
    encrypted_override = request.args.get('encrypted_media_url')
    preview_override = request.args.get('media_preview_url')
    if not song_id and not encrypted_override and not preview_override:
        return jsonify({'success': False, 'error': 'id or media url param required'}), 400
    quality = request.args.get('quality') or '320kbps'
    register_flag = request.args.get('register') == '1'
    params = None
    if song_id:
        params = {
            '__call': 'song.getDetails',
            'pids': song_id,
            '_format': 'json',
            '_marker': '0'
        }
    try:
        song = None
        if params:
            r = download_session.get(JIOSAAVN_API, params=params, headers=_jio_headers(), timeout=10)
            if r.status_code == 200:
                # Try multiple JSON parsing approaches for robustness
                data = None
                
                # First try: Parse as-is
                try:
                    data = r.json()
                except json.JSONDecodeError:
                    pass
                
                # Second try: Decode unicode escapes like vendz
                if not data:
                    try:
                        text_data = r.text.encode().decode('unicode-escape')
                        data = json.loads(text_data)
                    except json.JSONDecodeError:
                        pass
                
                # Third try: Clean problematic characters
                if not data:
                    try:
                        cleaned_text = r.text.replace('\\"', '"').replace('\\/', '/')
                        data = json.loads(cleaned_text)
                    except json.JSONDecodeError:
                        print(f"[DEBUG] JioSaavn resolve JSON parsing failed for song_id: {song_id}")
                        print(f"[DEBUG] Response preview: {r.text[:200]}...")
                
                # song.getDetails returns {song_id: song_data}, not {songs: [song_data]}
                if data and song_id in data:
                    song = data[song_id]
            else:
                print(f"[DEBUG] song.getDetails upstream status {r.status_code}, will fallback to provided urls if any")
        # Build a synthetic song dict if API failed but overrides provided
        if not song and (encrypted_override or preview_override):
            song = {
                'title': None,
                'album': None,
                'image': None,
                'more_info': {
                    'primary_artists': None,
                    'encrypted_media_url': encrypted_override
                },
                'media_url': encrypted_override,
                'media_preview_url': preview_override
            }
        if not song:
            return jsonify({'success': False, 'error': 'song not found'}), 404
        tried = [quality, '320kbps', '160kbps', '128kbps']
        ordered = []
        for q in tried:
            if q not in ordered:
                ordered.append(q)
        media_url = None
        selected_quality = None
        for q in ordered:
            candidate = _pick_jiosaavn_media(song, [q])
            if candidate and candidate.startswith('http'):
                media_url = candidate
                selected_quality = q
                break
        if not media_url:
            return jsonify({'success': False, 'error': 'Could not derive media url'}), 500
        proxy_id = None
        if register_flag:
            proxy_id = add_proxy_url(media_url)
        meta = {
            'title': song.get('title'),
            'artist': (song.get('more_info', {}).get('primary_artists') or 
                      song.get('more_info', {}).get('singers') or
                      song.get('primary_artists') or 
                      song.get('singers') or 
                      song.get('music')),
            'album': song.get('album'),
            'image': _upgrade_image_quality(song.get('image')),
            'language': song.get('language'),
            'year': song.get('year')
        }
        return jsonify({'success': True, 'media_url': media_url, 'proxy_id': proxy_id, 'quality': selected_quality, 'metadata': meta})
    except Exception as e:
        print(f"[DEBUG] JioSaavn resolve error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

# Universal endpoint like vendz/jiosaavn-api
@app.route('/result')
def universal_result():
    """Universal endpoint supporting song name, song link, album link, playlist link like vendz"""
    query = request.args.get('query', '').strip()
    lyrics = request.args.get('lyrics', 'false').lower() == 'true'
    
    if not query:
        return jsonify({'success': False, 'message': 'You need to enter a query', 'data': []})
    
    try:
        # Check if it's a JioSaavn URL
        if query.startswith('http') and 'saavn.com' in query:
            # For URLs, we'd need to extract song ID and use song.getDetails
            # This is a simplified version - full implementation would parse all URL types
            return jsonify({'success': False, 'message': 'URL parsing not yet implemented', 'data': []})
        else:
            # Treat as search query using autocomplete.get like vendz
            params = {
                '__call': 'autocomplete.get',
                'query': query,
                '_format': 'json',
                '_marker': '0',
                'cc': 'in',
                'includeMetaTags': '1'
            }
            
            r = download_session.get(JIOSAAVN_API, params=params, headers=_jio_headers(), timeout=10)
            if r.status_code != 200:
                return jsonify({'success': False, 'message': f'upstream {r.status_code}', 'data': []})
            
            # Try multiple JSON parsing approaches for robustness
            data = None
            
            # First try: Parse as-is
            try:
                data = r.json()
            except json.JSONDecodeError:
                pass
            
            # Second try: Decode unicode escapes like vendz
            if not data:
                try:
                    text_data = r.text.encode().decode('unicode-escape')
                    data = json.loads(text_data)
                except json.JSONDecodeError:
                    pass
            
            # Third try: Clean problematic characters
            if not data:
                try:
                    cleaned_text = r.text.replace('\\"', '"').replace('\\/', '/')
                    data = json.loads(cleaned_text)
                except json.JSONDecodeError:
                    print(f"[DEBUG] Universal endpoint JSON parsing failed for query: {query}")
                    return jsonify({'success': False, 'message': 'failed to parse response', 'data': []})
            
            songs = data.get('songs', {}).get('data', [])
            results = []
            
            for s in songs:
                # Get song details to have full metadata like vendz format_song
                song_id = s.get('id')
                if song_id:
                    try:
                        details_params = {
                            '__call': 'song.getDetails',
                            'pids': song_id,
                            '_format': 'json',
                            '_marker': '0'
                        }
                        detail_r = download_session.get(JIOSAAVN_API, params=details_params, headers=_jio_headers(), timeout=5)
                        if detail_r.status_code == 200:
                            detail_text = detail_r.text.encode().decode('unicode-escape')
                            detail_data = json.loads(detail_text)
                            songs_list = detail_data.get('songs', [])
                            if songs_list:
                                song_detail = songs_list[0]
                                # Format like vendz with full metadata
                                formatted_song = {
                                    'id': song_detail.get('id'),
                                    'title': song_detail.get('title') or song_detail.get('song'),
                                    'album': song_detail.get('album'),
                                    'year': song_detail.get('year'),
                                    'duration': song_detail.get('duration', '0'),
                                    'language': song_detail.get('language'),
                                    'has_lyrics': song_detail.get('has_lyrics', 'false'),
                                    'singers': song_detail.get('singers', '').split(', ') if song_detail.get('singers') else [],
                                    'primary_artists': song_detail.get('primary_artists'),
                                    'image': _upgrade_image_quality(song_detail.get('image') or ''),
                                    '320kbps': song_detail.get('320kbps', 'false'),
                                    'encrypted_media_url': song_detail.get('encrypted_media_url'),
                                    'media_preview_url': song_detail.get('media_preview_url')
                                }
                                
                                # Try to get direct download URL
                                media_url = _pick_jiosaavn_media(song_detail, ['320kbps', '160kbps', '128kbps'])
                                if media_url:
                                    formatted_song['url'] = media_url
                                
                                # Add lyrics if requested
                                if lyrics and song_detail.get('has_lyrics') == 'true':
                                    try:
                                        lyrics_params = {
                                            '__call': 'lyrics.getLyrics',
                                            'lyrics_id': song_id,
                                            '_format': 'json',
                                            '_marker': '0',
                                            'ctx': 'web6dot0',
                                            'api_version': '4'
                                        }
                                        lyrics_r = download_session.get(JIOSAAVN_API, params=lyrics_params, headers=_jio_headers(), timeout=5)
                                        if lyrics_r.status_code == 200:
                                            lyrics_data = lyrics_r.json()
                                            formatted_song['lyrics'] = lyrics_data.get('lyrics', '')
                                    except:
                                        pass
                                
                                results.append(formatted_song)
                    except:
                        # If details failed, use basic search result
                        results.append({
                            'id': s.get('id'),
                            'title': s.get('title') or s.get('song'),
                            'album': s.get('album'),
                            'singers': [],
                            'primary_artists': s.get('primary_artists'),
                            'image': _upgrade_image_quality(s.get('image') or ''),
                            'duration': s.get('duration', '0'),
                            'language': s.get('language'),
                        })
            
            return jsonify({
                'success': True,
                'data': results,
                'query': query
            })
    
    except Exception as e:
        print(f"[DEBUG] Universal result error: {e}")
        return jsonify({'success': False, 'message': str(e), 'data': []})


@app.route('/stream_proxy/<proxy_id>')
def stream_proxy(proxy_id):
    """Stream the proxied URL associated with proxy_id. Supports Range proxying."""
    print(f"[DEBUG] stream_proxy called with proxy_id: {proxy_id}")
    url = get_proxy_url(proxy_id)
    print(f"[DEBUG] get_proxy_url returned: {url}")
    if not url:
        print(f"[DEBUG] No URL found for proxy_id: {proxy_id}")
        return jsonify({'success': False, 'error': 'Invalid or expired proxy id'}), 404

    try:
        print(f"[DEBUG] Attempting to stream URL: {url}")
        gen, status, headers = stream_remote_range(url)
        print(f"[DEBUG] stream_remote_range returned status: {status}")
        # Return a streamed response
        from flask import Response
        return Response(gen, status=status, headers=headers)
    except Exception as e:
        print(f"Error streaming proxy url: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/image_proxy')
def image_proxy():
    """Proxy remote images so the frontend can safely read pixels (CORS-friendly)."""
    from flask import Response
    import mimetypes
    img_url = request.args.get('url')
    if not img_url:
        return jsonify({'success': False, 'error': 'url query param required'}), 400
    try:
        # Stream image from upstream
        r = download_session.get(img_url, stream=True, timeout=15)
        if r.status_code >= 400:
            return jsonify({'success': False, 'error': f'upstream returned {r.status_code}'}), 502

        # Determine content-type
        ct = r.headers.get('Content-Type')
        if not ct:
            guessed, _ = mimetypes.guess_type(img_url)
            ct = guessed or 'image/jpeg'

        def generate():
            try:
                for chunk in r.iter_content(chunk_size=16384):
                    if chunk:
                        yield chunk
            finally:
                try:
                    r.close()
                except:
                    pass

        headers = {
            'Content-Type': ct,
            'Cache-Control': 'public, max-age=1800',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Expose-Headers': 'Content-Length, Content-Type'
        }
        # Pass through content-length if present
        if 'Content-Length' in r.headers:
            headers['Content-Length'] = r.headers['Content-Length']

        return Response(generate(), status=200, headers=headers)
    except Exception as e:
        print(f"[DEBUG] image_proxy error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/add_to_queue', methods=['POST'])
def add_to_queue():
    """Add a searched song to the queue for streaming (no download)."""
    data = request.get_json()
    room = data.get('room')
    proxy_id = data.get('proxy_id')
    metadata = data.get('metadata', {})
    video_id = data.get('video_id')

    if not room or room not in rooms_data:
        return jsonify({'success': False, 'error': 'Invalid or expired room'}), 400

    if not proxy_id:
        return jsonify({'success': False, 'error': 'Proxy ID required'}), 400

    url = get_proxy_url(proxy_id)
    if not url:
        return jsonify({'success': False, 'error': 'Invalid or expired proxy ID'}), 400

    try:
        title = metadata.get('title') or 'Unknown Title'
        artist = metadata.get('artist') or 'Unknown Artist'
        album = metadata.get('album', '')
        image_url = metadata.get('image')

        with thread_lock:
            audio_item = {
                'filename': None,
                'filename_display': f"{title} - {artist}",
                'cover': None,
                'upload_time': time.time(),
                'title': title,
                'artist': artist,
                'album': album,
                'proxy_id': proxy_id,
                'is_stream': True,
                'image_url': image_url,
                'video_id': video_id
            }
            if 'queue' not in rooms_data[room]:
                rooms_data[room]['queue'] = []
            if 'current_index' not in rooms_data[room]:
                rooms_data[room]['current_index'] = -1
            rooms_data[room]['queue'].append(audio_item)
            if rooms_data[room]['current_file'] is None:
                rooms_data[room]['current_index'] = len(rooms_data[room]['queue']) - 1
                rooms_data[room].update({
                    'current_file': None,
                    'current_file_display': audio_item['filename_display'],
                    'current_cover': None,
                    'current_title': title,
                    'current_artist': artist,
                    'current_album': album,
                    'is_playing': False,
                    'last_progress_s': 0,
                    'last_updated_at': time.time(),
                    'current_proxy_id': proxy_id,
                    'current_is_stream': True,
                    'current_image_url': image_url
                })
                emit_data = {
                    'filename': None,
                    'filename_display': audio_item['filename_display'],
                    'cover': None,
                    'title': title,
                    'artist': artist,
                    'album': album,
                    'proxy_id': proxy_id,
                    'is_stream': True,
                    'image_url': image_url,
                    'video_id': video_id
                }
                socketio.emit('new_file', emit_data, to=room)
                socketio.emit('pause', {'time': 0}, to=room)
            socketio.emit('queue_update', {
                'queue': rooms_data[room]['queue'],
                'current_index': rooms_data[room]['current_index']
            }, to=room)
        return jsonify({
            'success': True,
            'message': 'Song added to queue for streaming',
            'display_name': audio_item['filename_display'],
            'filename': None
        })
    except Exception as e:
        print(f"ERROR adding song to queue for room '{room}': {str(e)}")
        return jsonify({
            'success': False,
            'error': f'Failed to add to queue: {str(e)}'
        }), 500


@app.route('/upload', methods=['POST'])
def upload():
    """Handle audio file uploads with optimized performance."""
    room = request.form.get('room')
    
    if not room or room not in rooms_data:
        return jsonify({'success': False, 'error': 'Invalid or expired room'}), 400
        
    if 'audio' not in request.files:
        return jsonify({'success': False, 'error': 'No file part in the request'}), 400

    file = request.files['audio']
    if not file.filename or file.filename == '' or not allowed_file(file.filename):
        return jsonify({'success': False, 'error': 'File not allowed or not selected'}), 400

    try:
        import re
        original_filename = file.filename
        if not original_filename:
            return jsonify({'success': False, 'error': 'Invalid filename'}), 400
        
        # Use a custom secure filename function that preserves Unicode characters
        def unicode_secure_filename(filename):
            # Remove path separators and other dangerous characters but keep Unicode
            filename = re.sub(r'[/\\]', '', filename)  # Remove path separators
            filename = re.sub(r'[<>:"|?*]', '', filename)  # Remove Windows forbidden chars
            filename = filename.strip()  # Remove leading/trailing whitespace
            filename = re.sub(r'\s+', ' ', filename)  # Normalize whitespace
            return filename if filename else None
        
        filename = unicode_secure_filename(original_filename)
        
        if not filename:  # If filename is still empty, generate a random one
            filename = f"audio_{uuid.uuid4().hex[:8]}.mp3"
            
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        
        # Ensure upload directory exists
        os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
        
        # Save file
        file.save(file_path)
        print(f"[Room {room}] - File saved: {filename}")

        # Prefer client-provided metadata if present, else extract from file
        client_title = request.form.get('title')
        client_artist = request.form.get('artist')
        client_album = request.form.get('album')
        client_image_url = request.form.get('image_url')
        client_video_id = request.form.get('video_id')

        # Extract metadata from file as fallback
        metadata = extract_metadata(file_path)
        print(f"[Room {room}] - Metadata extracted: {metadata}")

        final_cover_filename = None
        # Extract cover art
        cover_data, cover_ext = extract_cover_art(file_path)

        if cover_data:
            cover_filename = f"{os.path.splitext(filename)[0]}_cover.{cover_ext}"
            cover_path = os.path.join(app.config['UPLOAD_FOLDER'], cover_filename)
            with open(cover_path, 'wb') as imgf:
                imgf.write(cover_data)
            final_cover_filename = cover_filename
            print(f"[Room {room}] - Cover art extracted.")
        else:
            print(f"[Room {room}] - No cover art found.")
            
        with thread_lock:
            # Create audio item for queue
            audio_item = {
                'filename': filename,
                'filename_display': original_filename,
                'cover': final_cover_filename,
                'upload_time': time.time(),
                'title': client_title or metadata.get('title'),
                'artist': client_artist or metadata.get('artist'),
                'album': client_album or metadata.get('album'),
                # align with stream fields for UI consistency
                'is_stream': False,
                'image_url': client_image_url,
                'video_id': client_video_id
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
                    'current_title': audio_item.get('title'),
                    'current_artist': audio_item.get('artist'),
                    'current_album': audio_item.get('album'),
                    'is_playing': False,
                    'last_progress_s': 0,
                    'last_updated_at': time.time(),
                    'current_is_stream': False,
                    'current_image_url': client_image_url
                })
                
                # Send both filenames to client for the new current song
                emit_data = {
                    'filename': filename, 
                    'filename_display': original_filename,
                    'cover': final_cover_filename,
                    'title': audio_item.get('title'),
                    'artist': audio_item.get('artist'),
                    'album': audio_item.get('album'),
                    'is_stream': False,
                    'image_url': client_image_url,
                    'video_id': client_video_id
                }
                socketio.emit('new_file', emit_data, to=room)
                socketio.emit('pause', {'time': 0}, to=room)
            
            # Always emit queue update
            socketio.emit('queue_update', {
                'queue': rooms_data[room]['queue'],
                'current_index': rooms_data[room]['current_index']
            }, to=room)
        
        return jsonify({'success': True, 'filename': filename, 'filename_display': original_filename})

    except Exception as e:
        print(f"ERROR during file upload for room '{room}': {str(e)}")
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
            room_data = rooms_data[room].copy()
            # Ensure metadata fields exist
            if 'current_title' not in room_data:
                room_data['current_title'] = None
            if 'current_artist' not in room_data:
                room_data['current_artist'] = None
            if 'current_album' not in room_data:
                room_data['current_album'] = None
            return jsonify(room_data)
    return jsonify({'filename': None, 'cover': None, 'title': None, 'artist': None, 'album': None})

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
            'current_file': audio_item.get('filename'),
            'current_file_display': audio_item.get('filename_display'),
            'current_cover': audio_item.get('cover'),
            'current_title': audio_item.get('title'),
            'current_artist': audio_item.get('artist'),
            'current_album': audio_item.get('album'),
            'current_index': index,
            'is_playing': False,
            'last_progress_s': 0,
            'last_updated_at': time.time(),
            # stream-aware state
            'current_proxy_id': audio_item.get('proxy_id'),
            'current_is_stream': audio_item.get('is_stream', False),
            'current_image_url': audio_item.get('image_url')
        })
    
    # Emit new song to all clients
    emit_data = {
        'filename': audio_item.get('filename'),
        'filename_display': audio_item.get('filename_display'),
        'cover': audio_item.get('cover'),
        'title': audio_item.get('title'),
        'artist': audio_item.get('artist'),
        'album': audio_item.get('album'),
        # stream fields
        'proxy_id': audio_item.get('proxy_id'),
        'is_stream': audio_item.get('is_stream', False),
        'image_url': audio_item.get('image_url'),
        'video_id': audio_item.get('video_id')
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
                    'current_title': None,
                    'current_artist': None,
                    'current_album': None,
                    'current_index': -1,
                    'is_playing': False,
                    'last_progress_s': 0,
                })
                socketio.emit('new_file', {
                    'filename': None, 
                    'filename_display': None, 
                    'cover': None,
                    'title': None,
                    'artist': None,
                    'album': None
                }, to=room_id)
            elif index < len(queue):
                # Play the next song (which is now at the same index)
                audio_item = queue[index]
                rooms_data[room_id].update({
                    'current_file': audio_item['filename'],
                    'current_file_display': audio_item['filename_display'],
                    'current_cover': audio_item['cover'],
                    'current_title': audio_item.get('title'),
                    'current_artist': audio_item.get('artist'),
                    'current_album': audio_item.get('album'),
                    'current_index': index,
                    'is_playing': False,
                    'last_progress_s': 0,
                })
                socketio.emit('new_file', {
                    'filename': audio_item['filename'],
                    'filename_display': audio_item['filename_display'],
                    'cover': audio_item['cover'],
                    'title': audio_item.get('title'),
                    'artist': audio_item.get('artist'),
                    'album': audio_item.get('album')
                }, to=room_id)
            else:
                # Play the previous song (index decreased by 1)
                new_index = index - 1
                audio_item = queue[new_index]
                rooms_data[room_id].update({
                    'current_file': audio_item['filename'],
                    'current_file_display': audio_item['filename_display'],
                    'current_cover': audio_item['cover'],
                    'current_title': audio_item.get('title'),
                    'current_artist': audio_item.get('artist'),
                    'current_album': audio_item.get('album'),
                    'current_index': new_index,
                    'is_playing': False,
                    'last_progress_s': 0,
                })
                socketio.emit('new_file', {
                    'filename': audio_item['filename'],
                    'filename_display': audio_item['filename_display'],
                    'cover': audio_item['cover'],
                    'title': audio_item.get('title'),
                    'artist': audio_item.get('artist'),
                    'album': audio_item.get('album')
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

@app.route('/queue/<string:room_id>/reorder', methods=['POST'])
def reorder_queue(room_id):
    """Reorder songs in the queue."""
    if room_id not in rooms_data:
        return jsonify({'error': 'Room not found'}), 404
    
    data = request.get_json()
    if not data or 'from_index' not in data or 'to_index' not in data:
        return jsonify({'error': 'Missing from_index or to_index'}), 400
    
    from_index = data['from_index']
    to_index = data['to_index']
    
    with thread_lock:
        queue = rooms_data[room_id].get('queue', [])
        current_index = rooms_data[room_id].get('current_index', -1)
        
        if from_index < 0 or from_index >= len(queue) or to_index < 0 or to_index >= len(queue):
            return jsonify({'error': 'Invalid queue indices'}), 400
        
        # Remove item from current position
        item = queue.pop(from_index)
        
        # Insert item at new position
        queue.insert(to_index, item)
        
        # Adjust current_index if necessary
        if current_index == from_index:
            # If we moved the currently playing song
            rooms_data[room_id]['current_index'] = to_index
        elif from_index < current_index <= to_index:
            # If we moved an item from before current to after current
            rooms_data[room_id]['current_index'] = current_index - 1
        elif to_index <= current_index < from_index:
            # If we moved an item from after current to before current
            rooms_data[room_id]['current_index'] = current_index + 1
    
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
        'member_list': {},  # Store detailed member information
        'queue': [],  # Initialize queue for multiple audio files
        'current_index': -1,  # Index of currently playing song in queue
        'is_shuffling': False,  # Shuffle state
        'isLooping': False  # Loop state synchronized across devices
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
    # Get session ID using the emit context 
    try:
        from flask import has_request_context, g
        session_id = getattr(g, 'sid', str(uuid.uuid4()))
    except:
        session_id = str(uuid.uuid4())
    
    print(f"--- JOIN EVENT: Client {session_id} is attempting to join room {data.get('room')} ---")
    room = data['room']
    if room in rooms_data:
        join_room(room)
        print(f"--- JOIN SUCCESS: Client {session_id} successfully joined room {room} ---")
        print(f"Client {session_id} joined room: {room}")
        with thread_lock:
            # Update member count and list
            if 'members' not in rooms_data[room]:
                rooms_data[room]['members'] = 0
            if 'member_list' not in rooms_data[room]:
                rooms_data[room]['member_list'] = {}
            if 'host_id' not in rooms_data[room]:
                rooms_data[room]['host_id'] = None
            
            # Check if this is the first member (becomes host)
            is_host = len(rooms_data[room]['member_list']) == 0
            if is_host:
                rooms_data[room]['host_id'] = session_id
            
            # Add member to the list
            device_info = data.get('deviceInfo', {})
            browser = device_info.get('browser', 'Unknown Browser')
            os = device_info.get('os', 'Unknown OS')
            device_type = device_info.get('deviceType', 'Desktop')
            
            # Create a more descriptive name
            default_name = f"{browser} on {os}"
            if device_type != 'Desktop':
                default_name = f"{browser} ({device_type})"
            
            member_info = {
                'id': request.sid,
                'name': device_info.get('userName') or default_name,
                'browser': browser,
                'os': os,
                'deviceType': device_type,
                'joinTime': time.time() * 1000,  # JavaScript timestamp
                'is_host': is_host
            }
            rooms_data[room]['member_list'][request.sid] = member_info
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
            
            # Broadcast member list update to all clients in the room
            socketio.emit('member_list_update', {
                'members': list(rooms_data[room].get('member_list', {}).values())
            }, to=room)
            socketio.emit('member_list_update', {
                'members': list(rooms_data[room].get('member_list', {}).values())
            }, to=room)
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
                    # Check if the leaving member was the host
                    was_host = rooms_data[room_id].get('host_id') == request.sid
                    
                    # Remove member from member list
                    if 'member_list' in rooms_data[room_id] and request.sid in rooms_data[room_id]['member_list']:
                        del rooms_data[room_id]['member_list'][request.sid]
                    
                    rooms_data[room_id]['members'] -= 1

                    if rooms_data[room_id]['members'] < 0:
                        rooms_data[room_id]['members'] = 0
                    
                    new_count = rooms_data[room_id]['members']

                    # If host left and there are still members, assign new host
                    if was_host and new_count > 0:
                        # Get the first remaining member as new host
                        remaining_members = list(rooms_data[room_id]['member_list'].keys())
                        if remaining_members:
                            new_host_id = remaining_members[0]
                            rooms_data[room_id]['host_id'] = new_host_id
                            # Update the new host's member info
                            if new_host_id in rooms_data[room_id]['member_list']:
                                rooms_data[room_id]['member_list'][new_host_id]['is_host'] = True
                            print(f"Host transferred from {request.sid} to {new_host_id}")
                            # Emit host change notification
                            socketio.emit('host_changed', {
                                'new_host_id': new_host_id,
                                'new_host_name': rooms_data[room_id]['member_list'][new_host_id]['name']
                            }, to=room_id)

                    leave_room(room_id)
                    print(f"Client {request.sid} left room: {room_id}, new member count: {new_count}")
                    # Emit updated member count to the room
                    socketio.emit('member_count_update', {'count': new_count}, to=room_id)
                    # Also emit updated member list
                    socketio.emit('member_list_update', {
                        'members': list(rooms_data[room_id].get('member_list', {}).values())
                    }, to=room_id)
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
                         # Reset shuffle and loop states
                         rooms_data[room_id]['is_shuffling'] = False
                         rooms_data[room_id]['isLooping'] = False

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
    """Play the next song in the queue, considering shuffle mode."""
    room = data.get('room')
    auto_play = True  # Always auto-play on next

    if room not in rooms_data:
        return

    with thread_lock:
        queue = rooms_data[room].get('queue', [])
        current_index = rooms_data[room].get('current_index', -1)
        is_shuffling = rooms_data[room].get('is_shuffling', False)

        if len(queue) == 0:
            return

        # Determine next index based on shuffle mode
        if is_shuffling and len(queue) > 1:
            import random
            available_indices = [i for i in range(len(queue)) if i != current_index]
            next_index = random.choice(available_indices) if available_indices else 0
        else:
            next_index = current_index + 1
            if next_index >= len(queue):
                next_index = 0

        audio_item = queue[next_index]
        rooms_data[room].update({
            'current_file': audio_item.get('filename'),
            'current_file_display': audio_item.get('filename_display'),
            'current_cover': audio_item.get('cover'),
            'current_title': audio_item.get('title'),
            'current_artist': audio_item.get('artist'),
            'current_album': audio_item.get('album'),
            'current_index': next_index,
            'is_playing': auto_play,
            'last_progress_s': 0,
            'last_updated_at': time.time(),
            'current_proxy_id': audio_item.get('proxy_id'),
            'current_is_stream': audio_item.get('is_stream', False),
            'current_image_url': audio_item.get('image_url')
        })

    emit_data = {
        'filename': audio_item.get('filename'),
        'filename_display': audio_item.get('filename_display'),
        'cover': audio_item.get('cover'),
        'title': audio_item.get('title'),
        'artist': audio_item.get('artist'),
        'album': audio_item.get('album'),
        'proxy_id': audio_item.get('proxy_id'),
        'is_stream': audio_item.get('is_stream', False),
        'image_url': audio_item.get('image_url'),
        'video_id': audio_item.get('video_id')
    }
    socketio.emit('new_file', emit_data, to=room)

    # Always auto-play
    target_timestamp = time.time() + 0.5
    socketio.emit('scheduled_play', {
        'audio_time': 0,
        'target_timestamp': target_timestamp
    }, to=room)

    socketio.emit('queue_update', {
        'queue': queue,
        'current_index': next_index
    }, to=room)

@socketio.on('previous_song')
def handle_previous_song(data):
    """Play the previous song in the queue."""
    room = data.get('room')
    auto_play = True  # Always auto-play on previous

    if room not in rooms_data:
        return

    with thread_lock:
        queue = rooms_data[room].get('queue', [])
        current_index = rooms_data[room].get('current_index', -1)

        if len(queue) == 0:
            return

        prev_index = current_index - 1
        if prev_index < 0:
            prev_index = len(queue) - 1

        audio_item = queue[prev_index]
        rooms_data[room].update({
            'current_file': audio_item.get('filename'),
            'current_file_display': audio_item.get('filename_display'),
            'current_cover': audio_item.get('cover'),
            'current_title': audio_item.get('title'),
            'current_artist': audio_item.get('artist'),
            'current_album': audio_item.get('album'),
            'current_index': prev_index,
            'is_playing': auto_play,
            'last_progress_s': 0,
            'last_updated_at': time.time(),
            'current_proxy_id': audio_item.get('proxy_id'),
            'current_is_stream': audio_item.get('is_stream', False),
            'current_image_url': audio_item.get('image_url')
        })

    emit_data = {
        'filename': audio_item.get('filename'),
        'filename_display': audio_item.get('filename_display'),
        'cover': audio_item.get('cover'),
        'title': audio_item.get('title'),
        'artist': audio_item.get('artist'),
        'album': audio_item.get('album'),
        'proxy_id': audio_item.get('proxy_id'),
        'is_stream': audio_item.get('is_stream', False),
        'image_url': audio_item.get('image_url'),
        'video_id': audio_item.get('video_id')
    }
    socketio.emit('new_file', emit_data, to=room)

    # Always auto-play
    target_timestamp = time.time() + 0.5
    socketio.emit('scheduled_play', {
        'audio_time': 0,
        'target_timestamp': target_timestamp
    }, to=room)

    socketio.emit('queue_update', {
        'queue': queue,
        'current_index': prev_index
    }, to=room)

@socketio.on('loop_toggle')
def handle_loop_toggle(data):
    """Handle loop state toggle and synchronize across all devices."""
    room = data.get('room')
    is_looping = data.get('isLooping', False)
    
    if room not in rooms_data:
        return
        
    with thread_lock:
        rooms_data[room]['isLooping'] = is_looping
        
    print(f"[Room {room}] Loop state changed to: {is_looping}")
    
    # Broadcast loop state to all devices in the room
    socketio.emit('loop_state_update', {
        'isLooping': is_looping
    }, to=room)

@socketio.on('loop_restart')
def handle_loop_restart(data):
    """Handle loop restart and synchronize across all devices."""
    room = data.get('room')
    
    if room not in rooms_data:
        return
        
    with thread_lock:
        # Reset progress and ensure playing state
        rooms_data[room]['last_progress_s'] = 0
        rooms_data[room]['is_playing'] = True
        rooms_data[room]['last_updated_at'] = time.time()
    
    print(f"[Room {room}] Loop restart triggered")
    
    # Broadcast loop restart to all devices
    socketio.emit('loop_restart', {}, to=room)

@socketio.on('shuffle_toggle')
def handle_shuffle_toggle(data):
    """Handle shuffle state toggle and synchronize across all devices."""
    room = data.get('room')
    is_shuffling = data.get('isShuffling', False)
    
    if room not in rooms_data:
        return
        
    with thread_lock:
        rooms_data[room]['is_shuffling'] = is_shuffling
        
    print(f"[Room {room}] Shuffle state changed to: {is_shuffling}")
    
    # Broadcast shuffle state to all devices in the room
    socketio.emit('shuffle_state_update', {
        'isShuffling': is_shuffling
    }, to=room)

@socketio.on('shuffle_next')
def handle_shuffle_next(data):
    """Play a random song from the queue when shuffle is enabled."""
    room = data.get('room')
    auto_play = data.get('auto_play', False)
    
    if room not in rooms_data:
        return
        
    with thread_lock:
        queue = rooms_data[room].get('queue', [])
        current_index = rooms_data[room].get('current_index', -1)
        
        if len(queue) <= 1:
            return  # Can't shuffle with 0 or 1 songs
            
        # Generate a random index different from current
        import random
        available_indices = [i for i in range(len(queue)) if i != current_index]
        if not available_indices:
            return
            
        random_index = random.choice(available_indices)
        
        # Update current song
        audio_item = queue[random_index]
        rooms_data[room].update({
            'current_file': audio_item['filename'],
            'current_file_display': audio_item['filename_display'],
            'current_cover': audio_item['cover'],
            'current_title': audio_item.get('title'),
            'current_artist': audio_item.get('artist'),
            'current_album': audio_item.get('album'),
            'current_index': random_index,
            'is_playing': auto_play,
            'last_progress_s': 0,
            'last_updated_at': time.time(),
        })
    
    print(f"[Room {room}] Shuffle: Playing random song at index {random_index}")
    
    # Emit new song to all clients
    emit_data = {
        'filename': audio_item['filename'],
        'filename_display': audio_item['filename_display'],
        'cover': audio_item['cover'],
        'title': audio_item.get('title'),
        'artist': audio_item.get('artist'),
        'album': audio_item.get('album')
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
        'current_index': random_index
    }, to=room)


@socketio.on('request_member_list')
def handle_request_member_list(data):
    """Handle request for member list"""
    room = data.get('room')
    print(f"[DEBUG] request_member_list received for room: {room}")
    if room in rooms_data:
        with thread_lock:
            member_list = list(rooms_data[room].get('member_list', {}).values())
            print(f"[DEBUG] Found {len(member_list)} members: {member_list}")
            emit('member_list_update', {'members': member_list})
    else:
        print(f"[DEBUG] Room {room} not found in rooms_data")
        emit('member_list_update', {'members': []})


@socketio.on('reorder_queue')
def handle_reorder_queue(data):
    """Handle queue reordering from drag-and-drop"""
    room = data.get('room')
    new_order = data.get('new_order', [])
    
    if room in rooms_data and new_order:
        with thread_lock:
            # Update the queue with the new order
            rooms_data[room]['queue'] = new_order
            
            # Emit the updated queue to all clients in the room
            socketio.emit('queue_update', {
                'queue': new_order,
                'current_index': rooms_data[room].get('current_queue_index', 0)
            }, to=room)

# =================================================================================
# Application Entry Point
# =================================================================================

# Now that sync_rooms_periodically is defined above, this line will work correctly.
socketio.start_background_task(target=sync_rooms_periodically)

if __name__ == '__main__':
    # This block runs for local development
    socketio.run(app, host='0.0.0.0', port=5001, debug=True, use_reloader=False)
