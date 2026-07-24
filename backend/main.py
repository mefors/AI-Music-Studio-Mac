import os
import shutil
import librosa
import subprocess
import requests
import urllib.parse
import numpy as np
from fastapi import FastAPI, UploadFile, File, Form, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from moviepy.editor import VideoFileClip, concatenate_videoclips, AudioFileClip, VideoClip
from PIL import Image, ImageDraw, ImageFont
from typing import List, Dict, Any
from pydub import AudioSegment
from pydub.silence import detect_nonsilent
import json
from fastapi.staticfiles import StaticFiles

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = "uploads"
OUTPUT_DIR = "outputs"
PROJECTS_DIR = "projects"
ASSETS_DIR = "assets"
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(PROJECTS_DIR, exist_ok=True)
os.makedirs(ASSETS_DIR, exist_ok=True)

app.mount("/outputs", StaticFiles(directory=OUTPUT_DIR), name="outputs")
app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")

# NOT: Prodüksiyona alırken bunu ortam değişkenine (env var) taşı.
BASE_URL = "http://localhost:8000"

LOGO_PATH = os.path.join(ASSETS_DIR, "logo.png")

progress_store = {}

FONT_PATH = "Montserrat-Bold.ttf"
if not os.path.exists(FONT_PATH):
    print("Font dosyası indiriliyor...")
    try:
        import urllib.request
        font_url = "https://raw.githubusercontent.com/googlefonts/roboto/main/src/hinted/Roboto-Black.ttf"
        urllib.request.urlretrieve(font_url, FONT_PATH)
    except Exception as e:
        import platform
        FONT_PATH = "arialbd.ttf" if platform.system() == "Windows" else "Arial Bold.ttf"

# --- YENİ: KALİTE PROFİLİNE GÖRE KAPAK ÇÖZÜNÜRLÜĞÜ (Cover Studio hem üretim hem tipografi tarafında bunu kullanır) ---
COVER_SIZE_MAP = {
    "1:1":  {"fast": (1000, 1000), "high": (3000, 3000)},   # Spotify/Apple Music kalite üstü 3000x3000
    "16:9": {"fast": (1280, 720),  "high": (1920, 1080)},   # YouTube kapak
    "9:16": {"fast": (720, 1280),  "high": (1080, 1920)},   # IG Story / TikTok / Reels
}

def get_cover_dimensions(aspect_ratio, quality="fast"):
    q = quality if quality in ("fast", "high") else "fast"
    return COVER_SIZE_MAP.get(aspect_ratio, COVER_SIZE_MAP["1:1"])[q]

# --- YENİ: PLATFORMLARA ÖZEL OTOMATİK FORMAT ÜRETİMİ ---
# Kullanıcının istediği tabloyla birebir eşleşen boyutlar
SOCIAL_FORMAT_PRESETS = {
    "spotify":         {"label": "Spotify / Apple Music", "size": (3000, 3000)},
    "youtube":         {"label": "YouTube Kapak",         "size": (1280, 720)},
    "instagram_post":  {"label": "Instagram Gönderi",     "size": (1080, 1080)},
    "instagram_story": {"label": "Instagram Hikâye",      "size": (1080, 1920)},
    "tiktok_reels":    {"label": "TikTok / Reels",        "size": (1080, 1920)},
    "facebook_post":   {"label": "Facebook Gönderi",      "size": (1200, 630)},
}

# --- YENİ: GELİŞMİŞ VİSUALİZER MOTORU (Dönen Disk / Spektrum / Bas Işıkları) ---

def ffmpeg_escape_text(text):
    """ffmpeg drawtext filtresi için özel karakterleri kaçışlar."""
    return (text.replace("\\", "\\\\")
                .replace(":", "\\:")
                .replace("'", "\u2019")  # tek tırnak filtreyi bozmasın diye tipografik kesme işaretine çevrilir
                .replace("%", "\\%"))


def create_vinyl_disc(cover_path, size=800):
    """'Dönen Disk' visualizer'ı için vinil plak görseli üretir.
    Kapak resmi varsa onu merkez etiketine gömer, yoksa temalı bir degrade etiket çizer."""
    disc = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(disc)
    center = size // 2

    # Plağın ana gövdesi (mat siyah)
    draw.ellipse([2, 2, size - 2, size - 2], fill=(20, 20, 24, 255))

    # Groove (plak oluğu) halkaları
    groove_start = int(size * 0.49)
    groove_end = int(size * 0.36)
    for i, r in enumerate(range(groove_start, groove_end, -6)):
        shade = 34 + (i % 3) * 6
        draw.ellipse([center - r, center - r, center + r, center + r],
                     outline=(shade, shade, shade, 160), width=1)

    # Merkez etiket (kapak veya temalı degrade)
    label_r = int(size * 0.34)
    mask = Image.new("L", (label_r * 2, label_r * 2), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, label_r * 2, label_r * 2], fill=255)

    if cover_path and os.path.exists(cover_path):
        label_img = Image.open(cover_path).convert("RGB")
        lw, lh = label_img.size
        side = min(lw, lh)
        label_img = label_img.crop(((lw - side) // 2, (lh - side) // 2, (lw + side) // 2, (lh + side) // 2))
        label_img = label_img.resize((label_r * 2, label_r * 2), Image.Resampling.LANCZOS)
    else:
        label_img = Image.new("RGB", (label_r * 2, label_r * 2), (91, 33, 182))
        grad = ImageDraw.Draw(label_img)
        for y in range(label_r * 2):
            t = y / max(1, (label_r * 2))
            grad.line([(0, y), (label_r * 2, y)], fill=(int(91 + t * 80), int(33 + t * 40), int(182 - t * 60)))

    disc.paste(label_img, (center - label_r, center - label_r), mask)
    draw.ellipse([center - label_r, center - label_r, center + label_r, center + label_r],
                 outline=(240, 240, 240, 200), width=3)

    # Merkez delik
    hole_r = max(4, int(size * 0.025))
    draw.ellipse([center - hole_r, center - hole_r, center + hole_r, center + hole_r], fill=(5, 5, 5, 255))
    draw.ellipse([center - hole_r, center - hole_r, center + hole_r, center + hole_r], outline=(60, 60, 60, 255), width=1)

    return disc


def compute_bass_envelope(audio_path, max_duration=None, bass_cutoff_hz=150):
    """Şarkının bas (150Hz altı) enerji zarfını zamana göre çıkarır (0-1 normalize).
    'Bas vuruşuna tepki veren ışıklar' özelliğinin verisini bu fonksiyon üretir."""
    y, sr = librosa.load(audio_path, sr=22050, duration=max_duration)
    n_fft, hop = 2048, 512
    S = np.abs(librosa.stft(y, n_fft=n_fft, hop_length=hop))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
    bass_mask = freqs <= bass_cutoff_hz
    if not np.any(bass_mask):
        bass_mask[:5] = True
    bass_energy = S[bass_mask, :].mean(axis=0)

    if bass_energy.max() <= 0:
        bass_norm = np.zeros_like(bass_energy)
    else:
        p95 = np.percentile(bass_energy, 95)
        p95 = p95 if p95 > 1e-6 else bass_energy.max()
        bass_norm = np.clip(bass_energy / p95, 0, 1)

    if len(bass_norm) >= 5:
        bass_norm = np.convolve(bass_norm, np.ones(5) / 5, mode="same")

    times = librosa.frames_to_time(np.arange(len(bass_norm)), sr=sr, hop_length=hop)
    return times, bass_norm


def add_bass_lights(video_path, audio_path, output_path, fps=30):
    """Render edilmiş visualizer videosunun üzerine, bas enerjisiyle nabız gibi parlayan
    köşe ışıkları bindirir (ikinci bir render geçişi). Performans için ışık katmanı
    yalnızca birkaç 'yoğunluk kovası' (0.05 adım) için hesaplanıp önbelleğe alınır."""
    base_clip = VideoFileClip(video_path)
    duration = base_clip.duration
    times, bass_norm = compute_bass_envelope(audio_path, max_duration=duration)

    W, H = base_clip.w, base_clip.h
    corners = [(0, 0), (W, 0), (0, H), (W, H)]
    glow_colors = [(255, 80, 120), (80, 170, 255), (255, 205, 60), (150, 90, 255)]
    max_radius = int(min(W, H) * 0.30)
    cache = {}

    def render_light_layer(bucket):
        img = Image.new("RGB", (W, H), (0, 0, 0))
        if bucket > 0.02:
            draw = ImageDraw.Draw(img, "RGBA")
            for (cx, cy), color in zip(corners, glow_colors):
                r = int(max_radius * (0.35 + 0.65 * bucket))
                base_alpha = int(150 * bucket)
                for i in range(6, 0, -1):
                    rr = int(r * i / 6)
                    a = int(base_alpha * (1 - i / 7))
                    if rr > 0 and a > 0:
                        draw.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=(color[0], color[1], color[2], a))
        return np.array(img, dtype=np.int16)

    def combined_make_frame(t):
        base_frame = base_clip.get_frame(t).astype(np.int16)
        intensity = float(np.interp(t, times, bass_norm)) if len(times) else 0.0
        bucket = round(intensity * 20) / 20.0
        if bucket not in cache:
            cache[bucket] = render_light_layer(bucket)
        light_frame = cache[bucket]
        if light_frame.shape[:2] != base_frame.shape[:2]:
            return base_clip.get_frame(t)
        return np.clip(base_frame + light_frame, 0, 255).astype(np.uint8)

    lit_clip = VideoClip(combined_make_frame, duration=duration).set_audio(base_clip.audio)
    preset = "ultrafast" if max(W, H) <= 1280 else "medium"
    lit_clip.write_videofile(output_path, fps=fps, codec="libx264", audio_codec="aac", preset=preset, logger=None)
    base_clip.close()
    lit_clip.close()


# --- GÜNCELLENEN: MULTI-SIZE TİPOGRAFİ MOTORU + LOGO/WATERMARK ---
# target_size artık doğrudan (genişlik, yükseklik) tuple'ı olarak alınıyor.
# Böylece hem tekli kapak (COVER_SIZE_MAP) hem de platform formatları (SOCIAL_FORMAT_PRESETS)
# aynı fonksiyonu kullanabiliyor.
def apply_typography(image_path, title, artist, target_size, add_logo=False):
    try:
        img = Image.open(image_path)

        # Merkezi baz alarak kırpma/boyutlandırma (Aspect Fill)
        img_ratio = img.width / img.height
        target_ratio = target_size[0] / target_size[1]
        
        if img_ratio > target_ratio:
            new_width = int(img.height * target_ratio)
            left = (img.width - new_width) / 2
            img = img.crop((left, 0, left + new_width, img.height))
        elif img_ratio < target_ratio:
            new_height = int(img.width / target_ratio)
            top = (img.height - new_height) / 2
            img = img.crop((0, top, img.width, top + new_height))
            
        img = img.resize(target_size, Image.Resampling.LANCZOS)
        
        draw = ImageDraw.Draw(img)
        
        # Yazı boyutlarını ana tuvale göre ölçekle
        base_scale = min(target_size) / 1000
        title_font = ImageFont.truetype(FONT_PATH, int(90 * base_scale))
        artist_font = ImageFont.truetype(FONT_PATH, int(45 * base_scale))
        
        title_text = title.upper() if title else "BILINMEYEN SARKI"
        artist_text = artist.upper() if artist else "BILINMEYEN SANATCI"

        # Şarkı Adı Ortalama
        title_bbox = draw.textbbox((0, 0), title_text, font=title_font)
        title_x = (target_size[0] - (title_bbox[2] - title_bbox[0])) / 2
        title_y = (target_size[1] / 2) - (80 * base_scale)
        
        draw.text((title_x+4, title_y+4), title_text, font=title_font, fill="black")
        draw.text((title_x, title_y), title_text, font=title_font, fill="white")

        # Sanatçı Adı Ortalama
        artist_bbox = draw.textbbox((0, 0), artist_text, font=artist_font)
        artist_x = (target_size[0] - (artist_bbox[2] - artist_bbox[0])) / 2
        artist_y = title_y + (110 * base_scale)
        
        draw.text((artist_x+3, artist_y+3), artist_text, font=artist_font, fill="black")
        draw.text((artist_x, artist_y), artist_text, font=artist_font, fill="#e2e8f0")

        # --- YENİ: Logo / Watermark Bindirme (sağ alt köşe) ---
        if add_logo and os.path.exists(LOGO_PATH):
            try:
                logo = Image.open(LOGO_PATH).convert("RGBA")
                logo_target_w = int(target_size[0] * 0.16)
                logo_ratio = logo_target_w / logo.width
                logo = logo.resize((logo_target_w, max(1, int(logo.height * logo_ratio))), Image.Resampling.LANCZOS)
                margin = int(target_size[0] * 0.035)
                pos = (target_size[0] - logo.width - margin, target_size[1] - logo.height - margin)
                img = img.convert("RGBA")
                img.paste(logo, pos, logo)
                img = img.convert("RGB")
            except Exception as e:
                print("Logo Ekleme Hatası:", e)

        img.save(image_path)
    except Exception as e:
        print("Tipografi Hatası:", e)

@app.get("/api/status")
def read_status():
    return {"status": "success", "message": "KALIA Motoru Aktif!"}

@app.get("/api/progress/{filename}")
def get_progress(filename: str):
    return {"eta": progress_store.get(filename, "")}


# --- YENİ: LOGO / WATERMARK YÖNETİMİ ---
@app.post("/api/upload-logo")
async def upload_logo(file: UploadFile = File(...)):
    with open(LOGO_PATH, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    return {"status": "success", "message": "Logo yüklendi.", "logo_url": f"{BASE_URL}/assets/logo.png?t={os.path.getmtime(LOGO_PATH)}"}

@app.get("/api/logo-status")
def logo_status():
    exists = os.path.exists(LOGO_PATH)
    return {"exists": exists, "logo_url": f"{BASE_URL}/assets/logo.png?t={os.path.getmtime(LOGO_PATH)}" if exists else None}

@app.delete("/api/logo")
def delete_logo():
    if os.path.exists(LOGO_PATH):
        os.remove(LOGO_PATH)
    return {"status": "success", "message": "Logo kaldırıldı."}


# --- YENİ: PROJE KAYDETME / YÜKLEME ---
class ProjectData(BaseModel):
    name: str
    data: Dict[str, Any]

def _safe_project_name(name: str) -> str:
    cleaned = "".join(c for c in name if c.isalnum() or c in (" ", "_", "-")).strip()
    return cleaned or "proje"

@app.post("/api/save-project")
def save_project(request: ProjectData):
    safe_name = _safe_project_name(request.name)
    file_path = os.path.join(PROJECTS_DIR, f"{safe_name}.json")
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(request.data, f, ensure_ascii=False, indent=2)
    return {"status": "success", "message": f"'{safe_name}' projesi kaydedildi.", "name": safe_name}

@app.get("/api/list-projects")
def list_projects():
    files = [f[:-5] for f in os.listdir(PROJECTS_DIR) if f.endswith(".json")]
    return {"status": "success", "projects": sorted(files)}

@app.get("/api/load-project/{name}")
def load_project(name: str):
    safe_name = _safe_project_name(name)
    file_path = os.path.join(PROJECTS_DIR, f"{safe_name}.json")
    if not os.path.exists(file_path):
        return {"status": "error", "message": "Proje bulunamadı."}
    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return {"status": "success", "data": data}

@app.delete("/api/delete-project/{name}")
def delete_project(name: str):
    safe_name = _safe_project_name(name)
    file_path = os.path.join(PROJECTS_DIR, f"{safe_name}.json")
    if os.path.exists(file_path):
        os.remove(file_path)
    return {"status": "success", "message": "Proje silindi."}

@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    # GÜVENLİK: os.path.basename ile path traversal (../../) girişimlerini engelle
    safe_filename = os.path.basename(file.filename)
    file_path = os.path.join(UPLOAD_DIR, safe_filename)
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    analysis_data = None
    valid_extensions = ('.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.wma')
    
    if safe_filename.lower().endswith(valid_extensions):
        try:
            y, sr = librosa.load(file_path, sr=None, duration=45.0)
            tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
            bpm_value = float(tempo[0]) if hasattr(tempo, "__iter__") else float(tempo)
            
            # YENİ: Enerji analizi (RMS) DJ Sıralaması için
            rms = librosa.feature.rms(y=y)
            energy = float(np.mean(rms))
            
            analysis_data = {"bpm": round(bpm_value), "energy": energy}
        except Exception as e:
            print(f"BPM Analiz Hatası: {e}")
            analysis_data = {"bpm": 120, "energy": 0.05} # Hata olursa varsayılan

    return {"status": "success", "filename": safe_filename, "message": f"'{safe_filename}' stüdyoya alındı.", "analysis": analysis_data}

# --- YENİ EKLENEN: AI ENERJİ SIRALAMASI MOTORU ---
class SortRequest(BaseModel):
    files: List[dict] # [{"filename": "a.mp3", "bpm": 120, "energy": 0.04}]

@app.post("/api/sort-playlist")
def sort_playlist(request: SortRequest):
    """Şarkıları düşük enerjiden yüksek enerjiye (ve BPM akışına) göre sıralar"""
    sorted_files = sorted(request.files, key=lambda x: (x.get("energy", 0) * 100) + x.get("bpm", 0))
    return {"status": "success", "sorted_files": sorted_files}


# --- GÜNCELLENEN: AKILLI DJ CROSSFADE MASHUP SİSTEMİ (Ayarlanabilir Süre) ---
def trim_silence_and_low_energy(audio_segment, threshold_db=-40):
    nonsilent_ranges = detect_nonsilent(audio_segment, min_silence_len=500, silence_thresh=audio_segment.dBFS + threshold_db)
    if nonsilent_ranges:
        start_trim = nonsilent_ranges[0][0] 
        end_trim = nonsilent_ranges[-1][1]  
        return audio_segment[start_trim:end_trim]
    return audio_segment

@app.post("/api/generate-mashup")
async def generate_mashup(
    files: List[str] = Form(...), # Sadece dosya adlarını alıyoruz (arayüzde sıralama yapıldığı için)
    crossfade_sec: int = Form(8),  # Arayüzden gelen geçiş süresi (saniye)
    quality: str = Form("fast")  # YENİ: "fast" -> 320kbps MP3, "high" -> kayıpsız WAV
):
    if len(files) < 2:
        return {"status": "error", "message": "Mashup için en az 2 şarkı gereklidir."}
        
    try:
        playlist = []
        for filename in files:
            file_path = os.path.join(UPLOAD_DIR, filename)
            if not os.path.exists(file_path):
                continue
                
            audio = AudioSegment.from_file(file_path)
            trimmed_audio = trim_silence_and_low_energy(audio)
            
            target_dbfs = -14.0 
            change_in_dBFS = target_dbfs - trimmed_audio.dBFS
            normalized_audio = trimmed_audio.apply_gain(change_in_dBFS)
            playlist.append(normalized_audio)
            
        if not playlist:
            raise Exception("Geçerli ses dosyası bulunamadı.")

        crossfade_ms = crossfade_sec * 1000 
        
        combined_audio = playlist[0]
        for next_song in playlist[1:]:
            cf_safe = min(crossfade_ms, len(combined_audio), len(next_song))
            combined_audio = combined_audio.append(next_song, crossfade=cf_safe)
            
        # YENİ: Final Export Ayarları -> Yüksek Kalite (WAV) / Hızlı Paylaşım (320k MP3)
        if quality == "high":
            output_filename = "KALIA_Smart_DJ_Mashup.wav"
            output_path = os.path.join(OUTPUT_DIR, output_filename)
            combined_audio.export(output_path, format="wav")
        else:
            output_filename = "KALIA_Smart_DJ_Mashup.mp3"
            output_path = os.path.join(OUTPUT_DIR, output_filename)
            combined_audio.export(output_path, format="mp3", bitrate="320k")

        return {"status": "success", "mashup_url": f"{BASE_URL}/outputs/{output_filename}"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

# --- TEK ŞARKI SİSTEMLERİ ---
class CoverRequest(BaseModel):
    filename: str; bpm: int; songTitle: str; artistName: str; theme: str; aspectRatio: str
    addLogo: bool = False        # YENİ: Logo/Watermark
    quality: str = "fast"        # YENİ: "fast" | "high" -> Final Export Ayarları

@app.post("/api/generate-cover")
def generate_cover(request: CoverRequest):
    themes = {
        "auto": "electronic dance music album cover, neon lights, dark club background" if request.bpm > 110 else "lofi hip hop album cover, cozy atmosphere",
        "club": "dj performing in a massive night club, laser lights, cinematic lighting, masterpiece, 4k",
        "tropical": "tropical summer beach party, sunset, palm trees, chill house vibes, 4k",
        "minimal": "minimalist abstract electronic music album cover, geometric shapes, 4k",
        "cinematic": "cinematic moody portrait, dark aesthetic, mysterious atmosphere, dramatic lighting, 4k"
    }
    prompt = themes.get(request.theme, themes["auto"]) + ", no text, no watermark"
    
    # API'den doğrudan istenen oranda ve kalite profiline uygun resim çek
    w, h = get_cover_dimensions(request.aspectRatio, request.quality)
        
    encoded_prompt = urllib.parse.quote(prompt)
    api_url = f"https://image.pollinations.ai/prompt/{encoded_prompt}?width={w}&height={h}&nologo=true"
    
    output_filename = f"cover_{request.filename}.jpg"
    output_path = os.path.join(OUTPUT_DIR, output_filename)
    
    response = requests.get(api_url)
    with open(output_path, "wb") as f: f.write(response.content)
    
    apply_typography(output_path, request.songTitle, request.artistName, (w, h), add_logo=request.addLogo)
    return {"status": "success", "cover_url": f"{BASE_URL}/outputs/{output_filename}"}

@app.post("/api/generate-custom-cover")
async def generate_custom_cover(file: UploadFile = File(...), songTitle: str = Form(""), artistName: str = Form(""), aspectRatio: str = Form("1:1"), addLogo: bool = Form(False), quality: str = Form("fast")):
    output_filename = f"custom_cover_{file.filename}"
    output_path = os.path.join(OUTPUT_DIR, output_filename)
    with open(output_path, "wb") as buffer: shutil.copyfileobj(file.file, buffer)

    w, h = get_cover_dimensions(aspectRatio, quality)
    apply_typography(output_path, songTitle, artistName, (w, h), add_logo=addLogo)
    return {"status": "success", "cover_url": f"{BASE_URL}/outputs/{output_filename}"}


# --- YENİ: TÜM PLATFORM FORMATLARINI TEK SEFERDE ÜRETME ---
class AllFormatsRequest(BaseModel):
    filename: str
    bpm: int = 120
    songTitle: str = ""
    artistName: str = ""
    theme: str = "auto"
    addLogo: bool = False
    formats: List[str] = None  # None -> SOCIAL_FORMAT_PRESETS içindeki hepsi üretilir

@app.post("/api/generate-cover-all-formats")
def generate_cover_all_formats(request: AllFormatsRequest):
    """AI ile TEK bir görsel konsepti üretir, sonra bunu her platform boyutunda ayrı ayrı render eder.
    (Pollinations.ai her boyut için ayrı çağrılır ki kenarlar kırpılmadan doğru kompozisyon çıksın.)"""
    themes = {
        "auto": "electronic dance music album cover, neon lights, dark club background" if request.bpm > 110 else "lofi hip hop album cover, cozy atmosphere",
        "club": "dj performing in a massive night club, laser lights, cinematic lighting, masterpiece, 4k",
        "tropical": "tropical summer beach party, sunset, palm trees, chill house vibes, 4k",
        "minimal": "minimalist abstract electronic music album cover, geometric shapes, 4k",
        "cinematic": "cinematic moody portrait, dark aesthetic, mysterious atmosphere, dramatic lighting, 4k"
    }
    prompt = themes.get(request.theme, themes["auto"]) + ", no text, no watermark"
    encoded_prompt = urllib.parse.quote(prompt)

    # Aynı kompozisyonun tüm formatlarda tutarlı olması için sabit bir seed kullanıyoruz
    seed = abs(hash(request.filename)) % 100000

    keys_to_generate = request.formats or list(SOCIAL_FORMAT_PRESETS.keys())
    results = []
    for key in keys_to_generate:
        preset = SOCIAL_FORMAT_PRESETS.get(key)
        if not preset:
            continue
        w, h = preset["size"]
        api_url = f"https://image.pollinations.ai/prompt/{encoded_prompt}?width={w}&height={h}&nologo=true&seed={seed}"

        output_filename = f"cover_{key}_{request.filename}.jpg"
        output_path = os.path.join(OUTPUT_DIR, output_filename)
        try:
            response = requests.get(api_url, timeout=60)
            with open(output_path, "wb") as f:
                f.write(response.content)
            apply_typography(output_path, request.songTitle, request.artistName, (w, h), add_logo=request.addLogo)
            results.append({
                "key": key, "label": preset["label"], "width": w, "height": h,
                "url": f"{BASE_URL}/outputs/{output_filename}"
            })
        except Exception as e:
            print(f"Format üretim hatası ({key}):", e)

    return {"status": "success", "formats": results}


@app.post("/api/generate-custom-cover-all-formats")
async def generate_custom_cover_all_formats(
    file: UploadFile = File(...),
    songTitle: str = Form(""),
    artistName: str = Form(""),
    addLogo: bool = Form(False),
    formats: str = Form(None)  # virgülle ayrılmış format anahtarları, örn: "spotify,youtube"
):
    """Kullanıcının yüklediği TEK görseli, network çağrısı yapmadan her platform boyutuna
    kırpıp (aspect-fill) yeniden boyutlandırır. AI moduna göre çok daha hızlıdır."""
    master_filename = f"master_{file.filename}"
    master_path = os.path.join(UPLOAD_DIR, master_filename)
    with open(master_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    keys_to_generate = formats.split(",") if formats else list(SOCIAL_FORMAT_PRESETS.keys())
    results = []
    for key in keys_to_generate:
        preset = SOCIAL_FORMAT_PRESETS.get(key.strip())
        if not preset:
            continue
        w, h = preset["size"]
        output_filename = f"custom_cover_{key}_{file.filename}"
        output_path = os.path.join(OUTPUT_DIR, output_filename)
        shutil.copy(master_path, output_path)
        apply_typography(output_path, songTitle, artistName, (w, h), add_logo=addLogo)
        results.append({
            "key": key, "label": preset["label"], "width": w, "height": h,
            "url": f"{BASE_URL}/outputs/{output_filename}"
        })

    return {"status": "success", "formats": results}

class VideoRequest(BaseModel):
    filename: str
    addLogo: bool = False        # Logo/Watermark
    quality: str = "fast"        # "fast" | "high" -> çözünürlük & preset

    # YENİ: Gelişmiş Visualizer Ayarları
    style: str = "waveform"          # "waveform" | "spectrum" | "cqt" | "vinyl"
    background: str = "solid"        # "solid" | "cover_static" | "cover_moving"
    bassLights: bool = False         # bas vuruşuna tepki veren köşe ışıkları
    songTitle: str = ""
    artistName: str = ""
    coverImageFilename: str = ""     # outputs/ klasöründeki üretilmiş kapak dosya adı (opsiyonel arka plan/disk kaynağı)

@app.post("/api/generate-video")
def generate_video(request: VideoRequest):
    input_path = os.path.join(UPLOAD_DIR, request.filename)
    output_filename = f"visualizer_{request.filename}.mp4"
    output_path = os.path.join(OUTPUT_DIR, output_filename)
    progress_store[request.filename] = "Hesaplanıyor..."
    disc_path = None
    try:
        audio_clip = AudioFileClip(input_path)
        total_duration_sec = audio_clip.duration
        audio_clip.close()

        # Final Export Ayarları -> Hızlı Paylaşım (720p/ultrafast) vs Yüksek Kalite (1080p/medium)
        res_map = {"fast": ("1280x720", "ultrafast", 220), "high": ("1920x1080", "medium", 320)}
        wave_size, preset, logo_w = res_map.get(request.quality, res_map["fast"])
        W, H = [int(x) for x in wave_size.split("x")]
        FPS = 30
        use_logo = request.addLogo and os.path.exists(LOGO_PATH)

        style = request.style if request.style in ("waveform", "spectrum", "cqt", "vinyl") else "waveform"
        background = request.background if request.background in ("solid", "cover_static", "cover_moving") else "solid"

        cover_path = None
        if request.coverImageFilename:
            candidate = os.path.join(OUTPUT_DIR, os.path.basename(request.coverImageFilename))
            if os.path.exists(candidate):
                cover_path = candidate
        if background != "solid" and not cover_path:
            background = "solid"  # kapak yoksa güvenli varsayılana dön

        extra_inputs = []
        filter_parts = []
        next_idx = 1  # 0: ana ses girişi

        # --- 1) ARKA PLAN KATMANI ---
        if background == "solid":
            filter_parts.append(f"color=c=black:s={W}x{H}:d={total_duration_sec:.3f}[bg]")
        else:
            extra_inputs += ["-loop", "1", "-t", f"{total_duration_sec:.3f}", "-i", cover_path]
            bg_idx = next_idx; next_idx += 1
            if background == "cover_static":
                filter_parts.append(
                    f"[{bg_idx}:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},gblur=sigma=18,eq=brightness=-0.08[bg]"
                )
            else:  # cover_moving -> yavaş yakınlaşan "Ken Burns" efekti
                total_frames = max(1, int(total_duration_sec * FPS))
                filter_parts.append(
                    f"[{bg_idx}:v]scale={W*2}:{H*2},zoompan=z='min(zoom+0.0006,1.3)':d={total_frames}:s={W}x{H}:fps={FPS},gblur=sigma=14,eq=brightness=-0.08[bg]"
                )

        # --- 2) VİSUALİZER KATMANI ---
        if style == "vinyl":
            disc_size = min(min(W, H), 900)
            disc_img = create_vinyl_disc(cover_path, size=disc_size)
            disc_path = os.path.join(OUTPUT_DIR, f"_disc_{request.filename}.png")
            disc_img.save(disc_path)

            extra_inputs += ["-loop", "1", "-t", f"{total_duration_sec:.3f}", "-i", disc_path]
            disc_idx = next_idx; next_idx += 1
            rotation_period_sec = 5  # her 5 saniyede bir tam tur (görsel olarak dengeli bir hız)
            rot_box = int(disc_size * 1.42)
            filter_parts.append(f"[{disc_idx}:v]rotate=a=2*PI*t/{rotation_period_sec}:c=none:ow={rot_box}:oh={rot_box}[discrot]")
            filter_parts.append(f"[bg][discrot]overlay=(W-w)/2:(H-h)/2:format=auto[preout]")
        else:
            if style == "waveform":
                filter_parts.append(f"[0:a]showwaves=s={W}x{H}:mode=cline:colors=0x8b5cf6:rate={FPS}[vis]")
            elif style == "spectrum":
                filter_parts.append(f"[0:a]showfreqs=s={W}x{H}:mode=bar:ascale=cbrt:fscale=log:colors=0x22d3ee|0xf472b6[vis]")
            else:  # cqt
                filter_parts.append(f"[0:a]showcqt=s={W}x{H}:bar_g=3:sono_g=1,format=yuv420p[vis]")
            # "blend=screen": siyah pikseller arka planı etkilemez, parlak dalga/spektrum üstte ışıldar
            filter_parts.append(f"[bg][vis]blend=all_mode=screen,format=yuv420p[preout]")

        # --- 3) ŞARKI ADI / SANATÇI ADI METNİ ---
        last_label = "preout"
        if request.songTitle or request.artistName:
            title_fs = max(18, int(H * 0.045))
            artist_fs = max(14, int(H * 0.028))
            if request.songTitle:
                safe_title = ffmpeg_escape_text(request.songTitle.upper())
                filter_parts.append(
                    f"[{last_label}]drawtext=fontfile='{FONT_PATH}':text='{safe_title}':fontcolor=white:"
                    f"fontsize={title_fs}:x=(w-text_w)/2:y=h-{int(H*0.16)}:shadowcolor=black:shadowx=2:shadowy=2[t1]"
                )
                last_label = "t1"
            if request.artistName:
                safe_artist = ffmpeg_escape_text(request.artistName.upper())
                filter_parts.append(
                    f"[{last_label}]drawtext=fontfile='{FONT_PATH}':text='{safe_artist}':fontcolor=0xcbd5e1:"
                    f"fontsize={artist_fs}:x=(w-text_w)/2:y=h-{int(H*0.10)}:shadowcolor=black:shadowx=1:shadowy=1[t2]"
                )
                last_label = "t2"

        # --- 4) LOGO / WATERMARK ---
        if use_logo:
            extra_inputs += ["-i", LOGO_PATH]
            logo_idx = next_idx; next_idx += 1
            filter_parts.append(f"[{logo_idx}:v]scale={logo_w}:-1[logo]")
            filter_parts.append(f"[{last_label}][logo]overlay=W-w-40:H-h-40[vout]")
            last_label = "vout"

        filter_complex = ";".join(filter_parts)
        command = ["ffmpeg", "-y", "-i", input_path] + extra_inputs + [
            "-filter_complex", filter_complex,
            "-map", f"[{last_label}]", "-map", "0:a",
            "-c:v", "libx264", "-preset", preset, "-c:a", "aac", "-shortest", output_path
        ]

        process = subprocess.Popen(command, stderr=subprocess.PIPE, universal_newlines=True, encoding='utf-8', errors='replace')
        for line in process.stderr:
            if "time=" in line and "speed=" in line:
                try:
                    time_str = line.split("time=")[1].split(" ")[0] 
                    speed_str = line.split("speed=")[1].split("x")[0].strip()
                    h, m, s = time_str.split(":")
                    processed_sec = int(h) * 3600 + int(m) * 60 + float(s)
                    speed = float(speed_str)
                    if speed > 0:
                        remaining_media_sec = total_duration_sec - processed_sec
                        eta_sec = remaining_media_sec / speed 
                        eta_m = int(max(0, eta_sec // 60))
                        eta_s = int(max(0, eta_sec % 60))
                        eta_text = f"{eta_m} dakika {eta_s} saniye"
                        progress_store[request.filename] = eta_text
                except: pass
        process.wait()

        if disc_path and os.path.exists(disc_path):
            os.remove(disc_path)

        if process.returncode != 0:
            progress_store[request.filename] = "Hata"
            return {"status": "error", "message": "Video oluşturulamadı (ffmpeg render hatası)."}

        final_output_filename = output_filename
        # --- 5) BAS IŞIKLARI (opsiyonel ikinci render geçişi) ---
        if request.bassLights:
            progress_store[request.filename] = "Bas ışıkları render ediliyor..."
            lit_filename = f"visualizer_lit_{request.filename}.mp4"
            lit_path = os.path.join(OUTPUT_DIR, lit_filename)
            add_bass_lights(output_path, input_path, lit_path, fps=FPS)
            final_output_filename = lit_filename

        progress_store[request.filename] = "Tamamlandı!"
        return {"status": "success", "video_url": f"{BASE_URL}/outputs/{final_output_filename}"}
    except Exception as e:
        progress_store[request.filename] = "Hata"
        if disc_path and os.path.exists(disc_path):
            os.remove(disc_path)
        return {"status": "error", "message": str(e)}

class BeatSyncRequest(BaseModel):
    audioFilename: str; videoFilename: str; bpm: int
    addLogo: bool = False        # YENİ: Logo/Watermark
    quality: str = "fast"        # YENİ: "fast" | "high" -> çözünürlük & encode preseti

@app.post("/api/generate-beatsync")
def generate_beatsync(request: BeatSyncRequest):
    audio_path = os.path.join(UPLOAD_DIR, request.audioFilename)
    video_path = os.path.join(UPLOAD_DIR, request.videoFilename)
    output_filename = f"beatsync_{request.audioFilename}.mp4"
    output_path = os.path.join(OUTPUT_DIR, output_filename)
    try:
        beat_duration = 60.0 / request.bpm
        video = VideoFileClip(video_path)
        audio = AudioFileClip(audio_path).subclip(0, min(AudioFileClip(audio_path).duration, 60.0))
        clips, current_time = [], 0.0
        import random
        while current_time < audio.duration:
            max_start = max(0, video.duration - beat_duration)
            clips.append(video.subclip(random.uniform(0, max_start), random.uniform(0, max_start) + beat_duration))
            current_time += beat_duration

        final_clip = concatenate_videoclips(clips).set_audio(audio)

        # YENİ: Final Export Ayarları -> Yüksek Kalite (1080p/medium) vs Hızlı Paylaşım (720p/ultrafast)
        target_height = 1080 if request.quality == "high" else 720
        preset = "medium" if request.quality == "high" else "ultrafast"
        try:
            if final_clip.h != target_height:
                final_clip = final_clip.resize(height=target_height)
        except Exception as e:
            print("Ölçekleme Hatası (orijinal çözünürlükle devam ediliyor):", e)

        # YENİ: Logo / Watermark bindirme (sağ alt köşe)
        if request.addLogo and os.path.exists(LOGO_PATH):
            try:
                from moviepy.editor import ImageClip, CompositeVideoClip
                logo_clip = (ImageClip(LOGO_PATH)
                             .set_duration(final_clip.duration)
                             .resize(width=final_clip.w * 0.16)
                             .set_position(("right", "bottom"))
                             .margin(right=20, bottom=20, opacity=0))
                final_clip = CompositeVideoClip([final_clip, logo_clip])
            except Exception as e:
                print("Beat-Sync Logo Hatası:", e)

        final_clip.write_videofile(output_path, fps=30, codec="libx264", audio_codec="aac", preset=preset, logger=None)
        return {"status": "success", "video_url": f"{BASE_URL}/outputs/{output_filename}"}
    except Exception as e: return {"status": "error", "message": str(e)}

class SocialMediaRequest(BaseModel):
    videoUrl: str

@app.post("/api/generate-social")
def generate_social_media_format(request: SocialMediaRequest):
    input_filename = request.videoUrl.split("/")[-1]
    input_path = os.path.join(OUTPUT_DIR, input_filename)
    output_filename = f"reels_{input_filename}"
    output_path = os.path.join(OUTPUT_DIR, output_filename)
    subprocess.run(["ffmpeg", "-y", "-i", input_path, "-vf", "crop=ih*9/16:ih", "-c:a", "copy", "-c:v", "libx264", "-preset", "ultrafast", output_path], check=True)
    return {"status": "success", "video_url": f"{BASE_URL}/outputs/{output_filename}"}

app.mount("/", StaticFiles(directory="dist", html=True), name="frontend")