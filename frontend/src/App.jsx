import React, { useState, useEffect } from 'react';

// YENİ: Tüm fetch çağrıları artık bu sabiti kullanıyor (tek yerden değiştirilebilir)
const API_BASE = "";

// YENİ: Platform bazlı otomatik format üretim listesi (backend SOCIAL_FORMAT_PRESETS ile birebir eşleşir)
const FORMAT_LABELS = {
  spotify: { label: "Spotify / Apple Music", size: "3000 × 3000" },
  youtube: { label: "YouTube Kapak", size: "1280 × 720" },
  instagram_post: { label: "Instagram Gönderi", size: "1080 × 1080" },
  instagram_story: { label: "Instagram Hikâye", size: "1080 × 1920" },
  tiktok_reels: { label: "TikTok / Reels", size: "1080 × 1920" },
  facebook_post: { label: "Facebook Gönderi", size: "1200 × 630" },
};

function App() {
  const [serverMessage, setServerMessage] = useState("Python sunucusuna bağlanılıyor...");
  
  // YENİ: Playlist yapısı artık analiz verilerini de (BPM/Enerji) barındırıyor
  const [playlist, setPlaylist] = useState([]); 
  const [crossfadeSec, setCrossfadeSec] = useState(8); // Geçiş Süresi Slider'ı
  
  const [bpm, setBpm] = useState(null);
  const [rawVideoFilename, setRawVideoFilename] = useState("");
  
  const [songTitle, setSongTitle] = useState("");
  const [artistName, setArtistName] = useState("");
  
  const [coverMode, setCoverMode] = useState("ai"); 
  const [aiTheme, setAiTheme] = useState("auto"); 
  const [coverAspect, setCoverAspect] = useState("1:1"); // YENİ: Kapak Formatı
  const [customImageFile, setCustomImageFile] = useState(null);
  const [customImageName, setCustomImageName] = useState("");

  const [coverUrl, setCoverUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [resultVideoUrl, setResultVideoUrl] = useState("");
  const [reelsVideoUrl, setReelsVideoUrl] = useState("");

  // YENİ: Çoklu Platform Format Üretimi (Spotify/YouTube/IG/TikTok/Facebook)
  const [selectedFormats, setSelectedFormats] = useState(Object.keys(FORMAT_LABELS));
  const [allFormatsResults, setAllFormatsResults] = useState([]);
  const [isGeneratingFormats, setIsGeneratingFormats] = useState(false);

  // YENİ: Gelişmiş Visualizer Ayarları (Dönen Disk / Spektrum / Bas Işıkları)
  const [visualizerStyle, setVisualizerStyle] = useState("waveform"); // "waveform" | "spectrum" | "cqt" | "vinyl"
  const [visualizerBackground, setVisualizerBackground] = useState("solid"); // "solid" | "cover_static" | "cover_moving"
  const [bassLights, setBassLights] = useState(false);
  
  const [mashupResultUrl, setMashupResultUrl] = useState("");
  
  const [isAutoGenerating, setIsAutoGenerating] = useState(false);
  const [autoLogs, setAutoLogs] = useState([]);
  const [videoEta, setVideoEta] = useState("");

  // YENİ: Kalite Ayarları ("fast" = MP3 320k / 720p, "high" = WAV / 1080p)
  const [quality, setQuality] = useState("fast");

  // YENİ: Logo / Watermark
  const [logoUploaded, setLogoUploaded] = useState(false);
  const [useLogo, setUseLogo] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);

  // YENİ: Proje Kaydetme / Yükleme
  const [projectName, setProjectName] = useState("");
  const [savedProjects, setSavedProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState("");
  const [isProjectBusy, setIsProjectBusy] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/status`)
      .then(res => res.json())
      .then(data => setServerMessage(data.message))
      .catch(() => setServerMessage("Hata"));

    // YENİ: Açılışta logo durumunu ve kayıtlı projeleri kontrol et
    fetch(`${API_BASE}/api/logo-status`)
      .then(res => res.json())
      .then(data => { setLogoUploaded(!!data.exists); if (data.exists) setUseLogo(true); })
      .catch(() => {});

    refreshProjectList();
  }, []);

  const refreshProjectList = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/list-projects`);
      const data = await res.json();
      if (data.status === "success") setSavedProjects(data.projects);
    } catch (e) { /* Sunucu henüz ayakta değilse sessizce geç */ }
  };

  const handleAudioUpload = async (event) => {
    const files = Array.from(event.target.files).slice(0, 10);
    if (files.length === 0) return;
    
    setMashupResultUrl(""); setCoverUrl(""); setVideoUrl(""); setResultVideoUrl(""); setReelsVideoUrl("");
    setAllFormatsResults([]);
    
    // Geçici olarak yükleniyor durumu göster
    const tempPlaylist = files.map(f => ({ file: f, filename: f.name, bpm: '...', energy: 0, loading: true }));
    setPlaylist(tempPlaylist);

    // Her dosyayı backend'e atıp analiz (BPM/Enerji) verisini çekiyoruz
    const updatedPlaylist = [];
    for (let f of files) {
      const formData = new FormData(); formData.append("file", f);
      try {
        const res = await fetch(`${API_BASE}/api/upload`, { method: "POST", body: formData });
        const data = await res.json();
        updatedPlaylist.push({
            file: f,
            filename: data.filename,
            bpm: data.analysis?.bpm || 120,
            energy: data.analysis?.energy || 0,
            loading: false
        });
      } catch (e) {
        updatedPlaylist.push({ file: f, filename: f.name, bpm: 120, energy: 0, loading: false });
      }
    }
    setPlaylist(updatedPlaylist);
    
    // Tek şarkıysa BPM'i ana state'e at (Kapak/Video için)
    if (updatedPlaylist.length === 1) {
        setBpm(updatedPlaylist[0].bpm);
    } else {
        setBpm(null);
    }
  };

  const handleRawVideoUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const formData = new FormData(); formData.append("file", file);
    try {
      const res = await fetch(`${API_BASE}/api/upload`, { method: "POST", body: formData });
      const data = await res.json();
      setRawVideoFilename(data.filename);
    } catch (error) { alert("Video Yükleme Hatası"); }
  };

  const handleCustomImageUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    setCustomImageFile(file);
    setCustomImageName(file.name);
  };

  // --- YENİ: LOGO / WATERMARK YÖNETİMİ ---
  const handleLogoUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    setIsUploadingLogo(true);
    const formData = new FormData(); formData.append("file", file);
    try {
      const res = await fetch(`${API_BASE}/api/upload-logo`, { method: "POST", body: formData });
      const data = await res.json();
      if (data.status === "success") { setLogoUploaded(true); setUseLogo(true); }
    } catch (e) { alert("Logo yükleme hatası"); }
    finally { setIsUploadingLogo(false); }
  };

  const handleRemoveLogo = async () => {
    try {
      await fetch(`${API_BASE}/api/logo`, { method: "DELETE" });
      setLogoUploaded(false); setUseLogo(false);
    } catch (e) { alert("Logo kaldırma hatası"); }
  };

  // --- YENİ: PROJE KAYDETME / YÜKLEME ---
  const handleSaveProject = async () => {
    const name = projectName.trim() || `proje_${new Date().toLocaleString('tr-TR').replace(/[\/,: ]/g, '-')}`;
    const projectData = {
      playlist: playlist.map(p => ({ filename: p.filename, bpm: p.bpm, energy: p.energy })),
      crossfadeSec, songTitle, artistName, coverMode, aiTheme, coverAspect,
      quality, useLogo, rawVideoFilename,
      visualizerStyle, visualizerBackground, bassLights,
    };
    setIsProjectBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/save-project`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, data: projectData }),
      });
      const data = await res.json();
      if (data.status === "success") {
        setAutoLogs(prev => [...prev, `💾 Proje kaydedildi: ${data.name}`]);
        setProjectName("");
        setSelectedProject(data.name);
        refreshProjectList();
      } else {
        alert("Proje kaydedilemedi.");
      }
    } catch (e) { alert("Proje kaydetme hatası!"); }
    finally { setIsProjectBusy(false); }
  };

  const handleLoadProject = async () => {
    if (!selectedProject) return;
    setIsProjectBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/load-project/${encodeURIComponent(selectedProject)}`);
      const data = await res.json();
      if (data.status === "success") {
        const d = data.data || {};
        const restoredPlaylist = (d.playlist || []).map(p => ({ ...p, loading: false }));
        setPlaylist(restoredPlaylist);
        setCrossfadeSec(d.crossfadeSec ?? 8);
        setSongTitle(d.songTitle ?? "");
        setArtistName(d.artistName ?? "");
        setCoverMode(d.coverMode ?? "ai");
        setAiTheme(d.aiTheme ?? "auto");
        setCoverAspect(d.coverAspect ?? "1:1");
        setQuality(d.quality ?? "fast");
        setUseLogo(d.useLogo ?? false);
        setRawVideoFilename(d.rawVideoFilename ?? "");
        setVisualizerStyle(d.visualizerStyle ?? "waveform");
        setVisualizerBackground(d.visualizerBackground ?? "solid");
        setBassLights(d.bassLights ?? false);
        setBpm(restoredPlaylist.length === 1 ? restoredPlaylist[0].bpm : null);
        setMashupResultUrl(""); setCoverUrl(""); setVideoUrl(""); setResultVideoUrl(""); setReelsVideoUrl("");
        setAllFormatsResults([]);
        setAutoLogs([`📂 Proje yüklendi: ${selectedProject}`]);
      } else {
        alert("Proje yüklenemedi: " + data.message);
      }
    } catch (e) { alert("Proje yükleme hatası!"); }
    finally { setIsProjectBusy(false); }
  };

  const handleDeleteProject = async (name) => {
    try {
      await fetch(`${API_BASE}/api/delete-project/${encodeURIComponent(name)}`, { method: "DELETE" });
      if (selectedProject === name) setSelectedProject("");
      refreshProjectList();
    } catch (e) { alert("Proje silme hatası!"); }
  };

  // --- PLAYLIST KONTROLLERİ (Taşıma, Silme, AI Sıralama) ---
  const moveTrack = (index, direction) => {
      const newPlaylist = [...playlist];
      if (direction === 'up' && index > 0) {
          [newPlaylist[index - 1], newPlaylist[index]] = [newPlaylist[index], newPlaylist[index - 1]];
      } else if (direction === 'down' && index < newPlaylist.length - 1) {
          [newPlaylist[index + 1], newPlaylist[index]] = [newPlaylist[index], newPlaylist[index + 1]];
      }
      setPlaylist(newPlaylist);
  };

  const removeTrack = (index) => {
      const newPlaylist = playlist.filter((_, i) => i !== index);
      setPlaylist(newPlaylist);
  };

  const sortPlaylistByEnergy = async () => {
      setAutoLogs(["⚡ AI Şarkıları enerji ve tempoya göre yeniden sıralıyor..."]);
      try {
          const res = await fetch(`${API_BASE}/api/sort-playlist`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ files: playlist.map(p => ({ filename: p.filename, bpm: p.bpm, energy: p.energy })) })
          });
          const data = await res.json();
          if (data.status === "success") {
              // Gelen listeye göre state'i güncelle
              const sorted = data.sorted_files.map(sf => playlist.find(p => p.filename === sf.filename));
              setPlaylist(sorted);
              setAutoLogs(["✅ Playlist, kusursuz DJ akışı için (Düşük > Yüksek) sıralandı!"]);
          }
      } catch (e) {
          alert("Sıralama hatası!");
      }
  };


  const handleAutoMashupSingle = async () => {
    setIsAutoGenerating(true);
    setVideoEta(""); setAutoLogs(["🚀 KALIA TEK ŞARKI MODU BAŞLATILDI..."]);
    const audioFilename = playlist[0].filename;
    
    try {
      setAutoLogs(prev => [...prev, coverMode === 'ai' ? `⏳ [1/3] AI kapak çiziyor... Format: ${coverAspect}` : "⏳ [1/3] Tipografi basılıyor..."]);
      
      let dataCover;
      if (coverMode === 'ai') {
        const resCover = await fetch(`${API_BASE}/api/generate-cover`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: audioFilename, bpm: bpm || 120, songTitle: songTitle, artistName: artistName, theme: aiTheme, aspectRatio: coverAspect, addLogo: useLogo, quality: quality }),
        });
        dataCover = await resCover.json();
      } else {
        if (!customImageFile) throw new Error("Özel görsel seçilmedi!");
        const formData = new FormData();
        formData.append("file", customImageFile);
        formData.append("songTitle", songTitle);
        formData.append("artistName", artistName);
        formData.append("aspectRatio", coverAspect);
        formData.append("addLogo", useLogo);
        formData.append("quality", quality);
        const resCover = await fetch(`${API_BASE}/api/generate-custom-cover`, { method: "POST", body: formData });
        dataCover = await resCover.json();
      }

      if (dataCover.status === "success") { setCoverUrl(dataCover.cover_url); setAutoLogs(prev => [...prev, "✅ [1/3] Kapak hazır."]); }

      // Az önce üretilen kapağın dosya adını state'i beklemeden doğrudan yanıttan alıyoruz
      // (setCoverUrl henüz işlenmediği için state'e güvenmek burada yarış durumuna yol açar)
      const coverFilenameForVideo = dataCover.status === "success"
        ? dataCover.cover_url.split("/").pop().split("?")[0]
        : "";

      setAutoLogs(prev => [...prev, `⏳ [2/3] Müzik analiz ediliyor ve Visualizer başlatılıyor... (${visualizerStyle === 'vinyl' ? 'Dönen Disk' : visualizerStyle === 'spectrum' ? 'Spektrum' : visualizerStyle === 'cqt' ? 'Renkli Spektrum' : 'Dalga Formu'})`]);
      
      const etaInterval = setInterval(async () => {
        try {
          const res = await fetch(`${API_BASE}/api/progress/${encodeURIComponent(audioFilename)}`);
          const data = await res.json();
          if (data.eta) setVideoEta(data.eta);
        } catch (e) {}
      }, 1000);

      const resVis = await fetch(`${API_BASE}/api/generate-video`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: audioFilename, addLogo: useLogo, quality: quality,
          style: visualizerStyle, background: visualizerBackground, bassLights: bassLights,
          songTitle: songTitle, artistName: artistName, coverImageFilename: coverFilenameForVideo,
        }),
      });
      clearInterval(etaInterval); setVideoEta("");
      
      const dataVis = await resVis.json();
      if (dataVis.status === "success") { setVideoUrl(dataVis.video_url); setAutoLogs(prev => [...prev, "✅ [2/3] Visualizer hazır!"]); } 

      if (rawVideoFilename) {
        setAutoLogs(prev => [...prev, "⏳ [3/3] Beat-Sync işleniyor..."]);
        const resSync = await fetch(`${API_BASE}/api/generate-beatsync`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audioFilename: audioFilename, videoFilename: rawVideoFilename, bpm: bpm || 120, addLogo: useLogo, quality: quality }),
        });
        const dataSync = await resSync.json();
        if (dataSync.status === "success") { setResultVideoUrl(dataSync.video_url); setAutoLogs(prev => [...prev, "✅ [3/3] Kurgu tamamlandı."]); }
      }
      setAutoLogs(prev => [...prev, "🎉 İŞLEM BİTTİ!"]);
    } catch (error) { setAutoLogs(prev => [...prev, `❌ Hata: ${error.message}`]); } finally { setIsAutoGenerating(false); }
  };

  const handleGenerateMultiMashup = async () => {
    setIsAutoGenerating(true);
    setAutoLogs(["🚀 AUTO DJ MASHUP MODU BAŞLATILDI..."]);
    
    const formData = new FormData();
    // Yüklenen dosyaları değil, arayüzdeki mevcut sıralamayı gönderiyoruz
    playlist.forEach(track => formData.append("files", track.filename));
    formData.append("crossfade_sec", crossfadeSec.toString());
    formData.append("quality", quality);
    
    try {
        const res = await fetch(`${API_BASE}/api/generate-mashup`, { method: "POST", body: formData });
        const data = await res.json();
        if(data.status === "success") {
            setMashupResultUrl(data.mashup_url);
            setAutoLogs(prev => [...prev, `✅ [MASHUP] ${crossfadeSec} saniyelik Akıllı Crossfade uygulandı! (${quality === 'high' ? 'WAV - Yüksek Kalite' : 'MP3 320k - Hızlı Paylaşım'})`]);
            setAutoLogs(prev => [...prev, "🎉 KALIA Mashup Mix hazır!"]);
        } else {
            throw new Error(data.message);
        }
    } catch(error) { setAutoLogs(prev => [...prev, `❌ Hata: ${error.message}`]); } 
    finally { setIsAutoGenerating(false); }
  };

  // --- YENİ: ÇOKLU PLATFORM FORMAT ÜRETİMİ ---
  const toggleFormat = (key) => {
    setSelectedFormats(prev =>
      prev.includes(key) ? prev.filter(f => f !== key) : [...prev, key]
    );
  };

  const handleGenerateAllFormats = async () => {
    if (selectedFormats.length === 0) { alert("En az bir format seçmelisin."); return; }
    setIsGeneratingFormats(true);
    setAutoLogs(prev => [...prev, `📐 ${selectedFormats.length} platform formatı üretiliyor...`]);
    try {
      let data;
      if (coverMode === 'ai') {
        const res = await fetch(`${API_BASE}/api/generate-cover-all-formats`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: playlist[0].filename, bpm: bpm || 120,
            songTitle, artistName, theme: aiTheme, addLogo: useLogo,
            formats: selectedFormats,
          }),
        });
        data = await res.json();
      } else {
        if (!customImageFile) throw new Error("Özel görsel seçilmedi!");
        const formData = new FormData();
        formData.append("file", customImageFile);
        formData.append("songTitle", songTitle);
        formData.append("artistName", artistName);
        formData.append("addLogo", useLogo);
        formData.append("formats", selectedFormats.join(","));
        const res = await fetch(`${API_BASE}/api/generate-custom-cover-all-formats`, { method: "POST", body: formData });
        data = await res.json();
      }

      if (data.status === "success") {
        setAllFormatsResults(data.formats);
        setAutoLogs(prev => [...prev, `✅ ${data.formats.length} format hazır!`]);
      } else {
        throw new Error(data.message || "Bilinmeyen hata");
      }
    } catch (error) {
      setAutoLogs(prev => [...prev, `❌ Format üretme hatası: ${error.message}`]);
    } finally {
      setIsGeneratingFormats(false);
    }
  };

  const handleConvertToReels = async (sourceVideoUrl) => {
    try {
      const res = await fetch(`${API_BASE}/api/generate-social`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ videoUrl: sourceVideoUrl }),
      });
      const data = await res.json();
      if (data.status === "success") setReelsVideoUrl(data.video_url);
    } catch (error) { alert("Hata"); }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center p-6 font-sans overflow-y-auto pb-32">
      <div className="max-w-6xl w-full text-center space-y-10 mt-10">
        
        <h1 className="text-5xl md:text-6xl font-bold tracking-tight text-white">
          KALIA <span className="bg-gradient-to-r from-blue-500 to-purple-500 bg-clip-text text-transparent">STUDIO</span>
        </h1>
        <p className="text-gray-400 text-lg uppercase tracking-widest">{serverMessage}</p>

        {/* ======================================================== */}
        {/* YENİ: PROJE KAYDETME / YÜKLEME */}
        {/* ======================================================== */}
        <div className="bg-gray-900/60 p-5 rounded-2xl border border-gray-800 text-left">
          <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center">
            <span className="text-sm font-bold text-gray-400 uppercase tracking-widest whitespace-nowrap">💾 Proje</span>

            <input
              type="text" value={projectName} onChange={e => setProjectName(e.target.value)}
              placeholder="Proje adı (boş bırakılırsa otomatik verilir)"
              className="flex-1 bg-black/50 border border-gray-700 rounded-xl px-4 py-2 text-sm text-white focus:border-purple-500 outline-none"
            />
            <button onClick={handleSaveProject} disabled={isProjectBusy || playlist.length === 0}
              className="px-5 py-2 bg-purple-600/80 hover:bg-purple-600 rounded-xl text-sm font-bold transition disabled:opacity-30 disabled:cursor-not-allowed whitespace-nowrap">
              Kaydet
            </button>

            <select value={selectedProject} onChange={e => setSelectedProject(e.target.value)}
              className="bg-black/50 border border-gray-700 rounded-xl px-4 py-2 text-sm text-white outline-none min-w-[160px]">
              <option value="">Kayıtlı proje seç...</option>
              {savedProjects.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <button onClick={handleLoadProject} disabled={isProjectBusy || !selectedProject}
              className="px-5 py-2 bg-blue-600/80 hover:bg-blue-600 rounded-xl text-sm font-bold transition disabled:opacity-30 disabled:cursor-not-allowed whitespace-nowrap">
              Yükle
            </button>
            {selectedProject && (
              <button onClick={() => handleDeleteProject(selectedProject)}
                className="px-3 py-2 bg-red-900/50 text-red-400 hover:bg-red-600 hover:text-white rounded-xl text-sm font-bold transition">
                ✕
              </button>
            )}
          </div>
          <p className="text-xs text-gray-600 mt-2">Kaydettiğin bir proje; çalma listeni, crossfade süreni, metadata ve tercih ettiğin kalite/ logo ayarlarını hatırlar. Ses dosyalarının kendisi sunucuda kaldığı sürece yeniden yükleme gerekmez.</p>
        </div>
        
        <div className="grid grid-cols-1 gap-6 bg-gray-900 p-8 rounded-3xl border border-gray-800">
          <div className="text-left space-y-4">
            <h2 className="text-2xl font-bold flex items-center justify-between">
              1. Medyayı İçeri Al 
              <span className="text-xs bg-gray-800 text-gray-400 px-3 py-1 rounded-full uppercase tracking-widest">
                {playlist.length > 1 ? 'ÇOKLU DJ MODU AKTİF' : 'TEK ŞARKI MODU'}
              </span>
            </h2>
            <input type="file" id="audio-upload" className="hidden" accept=".mp3,.wav,.m4a,.aac,.flac" multiple onChange={handleAudioUpload} />
            
            <label htmlFor="audio-upload" className="block w-full py-6 text-center border-2 border-dashed border-purple-500/50 rounded-xl hover:bg-purple-500/10 cursor-pointer transition">
              <span className="block text-2xl mb-2">🎵 {playlist.length > 0 ? `${playlist.length} Şarkı Seçildi` : 'Şarkı(lar) Yükle'}</span>
              <span className="text-sm text-gray-500 font-normal">Tek şarkı (Kapak/Kurgu) veya 2-10 arası şarkı (Otomatik Mashup) seçin.</span>
            </label>
          </div>
        </div>

        {/* ======================================================== */}
        {/* TEK ŞARKI STÜDYOSU (Format Seçenekleri Eklendi) */}
        {/* ======================================================== */}
        {playlist.length === 1 && (
          <div className="space-y-10 animate-fade-in-up">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-gray-900 p-8 rounded-3xl border border-gray-800 text-left space-y-4">
                  <h2 className="text-2xl font-bold">Ham Kurgu Videosu (Opsiyonel)</h2>
                  <input type="file" id="video-upload" className="hidden" accept=".mp4" onChange={handleRawVideoUpload} />
                  <label htmlFor="video-upload" className="block w-full py-4 text-center border-2 border-dashed border-pink-500/50 rounded-xl hover:bg-pink-500/10 cursor-pointer transition">
                    {rawVideoFilename ? `🎬 ${rawVideoFilename}` : "➕ Ham Kurgu Videosu Yükle (.mp4)"}
                  </label>
                </div>
                
                <div className="bg-gray-900 p-8 rounded-3xl border border-gray-800 text-left space-y-4">
                  <h2 className="text-2xl font-bold">Metadata</h2>
                  <input type="text" value={songTitle} onChange={e=>setSongTitle(e.target.value)} placeholder="Şarkı Adı" className="w-full bg-black/50 border border-gray-700 rounded-xl p-4 text-white focus:border-blue-500 outline-none" />
                  <input type="text" value={artistName} onChange={e=>setArtistName(e.target.value)} placeholder="Sanatçı Adı" className="w-full bg-black/50 border border-gray-700 rounded-xl p-4 text-white focus:border-blue-500 outline-none" />
                  <div className="text-sm text-gray-400 mt-2">📍 {playlist[0].loading ? 'BPM Analiz Ediliyor...' : `Tespit Edilen BPM: ${playlist[0].bpm}`}</div>
                </div>
            </div>

            <div className="bg-gray-900 p-8 rounded-3xl border border-gray-800 text-left space-y-6">
              <h2 className="text-2xl font-bold">2. Albüm Kapağı Tasarımı</h2>
              
              {/* YENİ: Boyut Seçimi */}
              <div className="flex gap-2 mb-6">
                 {['1:1', '16:9', '9:16'].map(ratio => (
                    <button key={ratio} onClick={() => setCoverAspect(ratio)} className={`px-4 py-2 rounded-lg text-sm font-bold border transition ${coverAspect === ratio ? 'border-blue-500 bg-blue-500/20 text-blue-400' : 'border-gray-700 bg-black text-gray-500'}`}>
                       {ratio === '1:1' ? 'Kare (Spotify)' : ratio === '16:9' ? 'Yatay (YouTube)' : 'Dikey (Story)'}
                    </button>
                 ))}
              </div>

              <div className="flex gap-4">
                <button onClick={() => setCoverMode('ai')} className={`flex-1 py-3 rounded-xl font-bold transition ${coverMode === 'ai' ? 'bg-purple-600' : 'bg-gray-800 hover:bg-gray-700'}`}>🎨 AI Konsept Üretsin</button>
                <button onClick={() => setCoverMode('custom')} className={`flex-1 py-3 rounded-xl font-bold transition ${coverMode === 'custom' ? 'bg-blue-600' : 'bg-gray-800 hover:bg-gray-700'}`}>🖼️ Kendi Fotoğrafımı Kullan</button>
              </div>
              {coverMode === 'ai' && (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 pt-4">
                  {['auto', 'club', 'tropical', 'minimal', 'cinematic'].map(theme => (
                    <button key={theme} onClick={() => setAiTheme(theme)} className={`py-2 rounded-lg text-sm font-semibold capitalize transition border ${aiTheme === theme ? 'border-purple-500 bg-purple-500/20 text-purple-400' : 'border-gray-700 bg-black/50 text-gray-400 hover:border-gray-500'}`}>{theme === 'auto' ? 'Otomatik' : theme}</button>
                  ))}
                </div>
              )}
              {coverMode === 'custom' && (
                <div className="pt-4">
                  <input type="file" id="custom-image" className="hidden" accept=".jpg,.jpeg,.png" onChange={handleCustomImageUpload} />
                  <label htmlFor="custom-image" className="block w-full py-8 text-center border-2 border-dashed border-blue-500/50 rounded-xl hover:bg-blue-500/10 cursor-pointer transition">
                    {customImageName ? `✅ ${customImageName} seçildi.` : "📸 Bilgisayardan Fotoğraf Yükle (.jpg / .png)"}
                  </label>
                </div>
              )}
            </div>

            {/* ======================================================== */}
            {/* YENİ: OTOMATİK PLATFORM FORMATLARI (Spotify/YouTube/IG/TikTok/Facebook) */}
            {/* ======================================================== */}
            <div className="bg-gray-900 p-8 rounded-3xl border border-gray-800 text-left space-y-6">
              <h2 className="text-2xl font-bold">3. Platform Formatları</h2>
              <p className="text-sm text-gray-500">
                Tek tıkla, yukarıdaki kapak konseptini (AI veya kendi fotoğrafın) her platformun kendi boyutunda otomatik üretir.
              </p>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {Object.entries(FORMAT_LABELS).map(([key, meta]) => (
                  <button
                    key={key}
                    onClick={() => toggleFormat(key)}
                    className={`py-3 px-4 rounded-xl text-sm font-bold border transition text-left ${selectedFormats.includes(key) ? 'border-purple-500 bg-purple-500/20 text-purple-300' : 'border-gray-700 bg-black/50 text-gray-500 hover:border-gray-500'}`}
                  >
                    {meta.label}
                    <br />
                    <span className="font-normal text-xs opacity-70">{meta.size}</span>
                  </button>
                ))}
              </div>

              <button
                onClick={handleGenerateAllFormats}
                disabled={isGeneratingFormats || playlist[0].loading}
                className={`w-full py-4 rounded-2xl text-lg font-bold transition-all shadow-xl ${isGeneratingFormats || playlist[0].loading ? 'bg-gradient-to-r from-gray-700 to-gray-800 cursor-wait' : 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:scale-[1.01]'}`}
              >
                {isGeneratingFormats ? 'FORMATLAR ÜRETİLİYOR...' : `📐 ${selectedFormats.length} FORMATI ÜRET`}
              </button>

              {allFormatsResults.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 pt-4 border-t border-gray-800">
                  {allFormatsResults.map((f) => (
                    <div key={f.key} className="bg-black/50 p-3 rounded-xl border border-gray-800 flex flex-col items-center gap-2">
                      <img src={f.url} alt={f.label} className="w-full h-32 object-contain rounded-lg bg-black" />
                      <p className="text-xs text-gray-400 text-center font-semibold">{f.label}</p>
                      <p className="text-[10px] text-gray-600">{f.width} × {f.height}</p>
                      <a href={f.url} download className="w-full text-center py-1.5 bg-purple-600/20 text-purple-300 rounded-lg text-xs font-bold hover:bg-purple-600 hover:text-white transition">İndir</a>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ======================================================== */}
            {/* YENİ: LOGO / WATERMARK VE FİNAL EXPORT AYARLARI */}
            {/* ======================================================== */}
            <div className="bg-gray-900 p-8 rounded-3xl border border-gray-800 text-left space-y-6">
              <h2 className="text-2xl font-bold">4. Marka & Kalite Ayarları</h2>

              <div className="space-y-3">
                <label className="block text-sm text-gray-400 font-bold uppercase tracking-wide">🏷️ Logo / Watermark</label>
                <div className="flex items-center gap-3 flex-wrap">
                  <input type="file" id="logo-upload" className="hidden" accept=".png,.jpg,.jpeg" onChange={handleLogoUpload} />
                  <label htmlFor="logo-upload" className="px-5 py-2 bg-gray-800 hover:bg-gray-700 rounded-xl text-sm font-semibold cursor-pointer transition">
                    {isUploadingLogo ? 'Yükleniyor...' : logoUploaded ? '🔁 Logoyu Değiştir' : '⬆️ Logo Yükle (.png)'}
                  </label>
                  {logoUploaded && (
                    <button onClick={handleRemoveLogo} className="px-4 py-2 bg-red-900/50 text-red-400 hover:bg-red-600 hover:text-white rounded-xl text-sm font-semibold transition">
                      Kaldır
                    </button>
                  )}
                  <label className={`flex items-center gap-2 text-sm font-semibold ${logoUploaded ? 'text-gray-300' : 'text-gray-600'}`}>
                    <input type="checkbox" checked={useLogo} disabled={!logoUploaded}
                      onChange={e => setUseLogo(e.target.checked)}
                      className="w-4 h-4 accent-purple-500" />
                    Kapak ve videolara bindir
                  </label>
                </div>
                <p className="text-xs text-gray-600">Logo, kapağın ve visualizer/beat-sync videolarının sağ alt köşesine otantik bir watermark olarak yerleştirilir.</p>
              </div>

              <div className="pt-4 border-t border-gray-800 space-y-3">
                <label className="block text-sm text-gray-400 font-bold uppercase tracking-wide">📦 Final Export Ayarları</label>
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => setQuality('fast')} className={`py-3 rounded-xl text-sm font-bold border transition text-left px-4 ${quality === 'fast' ? 'border-green-500 bg-green-500/20 text-green-400' : 'border-gray-700 bg-black/50 text-gray-400 hover:border-gray-500'}`}>
                    ⚡ Hızlı Paylaşım<br /><span className="font-normal text-xs opacity-80">MP3 320k · 720p Video</span>
                  </button>
                  <button onClick={() => setQuality('high')} className={`py-3 rounded-xl text-sm font-bold border transition text-left px-4 ${quality === 'high' ? 'border-yellow-500 bg-yellow-500/20 text-yellow-400' : 'border-gray-700 bg-black/50 text-gray-400 hover:border-gray-500'}`}>
                    💎 Yüksek Kalite<br /><span className="font-normal text-xs opacity-80">WAV · 1080p Video · 3000px Kapak</span>
                  </button>
                </div>
              </div>
            </div>

            {/* ======================================================== */}
            {/* YENİ: GELİŞMİŞ VİSUALİZER AYARLARI (Disk/Spektrum/Bas Işıkları) */}
            {/* ======================================================== */}
            <div className="bg-gray-900 p-8 rounded-3xl border border-gray-800 text-left space-y-6">
              <h2 className="text-2xl font-bold">5. Visualizer Video Ayarları</h2>

              <div className="space-y-3">
                <label className="block text-sm text-gray-400 font-bold uppercase tracking-wide">🎛️ Görsel Stil</label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <button onClick={() => setVisualizerStyle('waveform')} className={`py-3 px-3 rounded-xl text-sm font-bold border transition ${visualizerStyle === 'waveform' ? 'border-purple-500 bg-purple-500/20 text-purple-300' : 'border-gray-700 bg-black/50 text-gray-400 hover:border-gray-500'}`}>
                    〰️ Ses Dalgası
                  </button>
                  <button onClick={() => setVisualizerStyle('spectrum')} className={`py-3 px-3 rounded-xl text-sm font-bold border transition ${visualizerStyle === 'spectrum' ? 'border-cyan-500 bg-cyan-500/20 text-cyan-300' : 'border-gray-700 bg-black/50 text-gray-400 hover:border-gray-500'}`}>
                    📊 Spektrum (Bar)
                  </button>
                  <button onClick={() => setVisualizerStyle('cqt')} className={`py-3 px-3 rounded-xl text-sm font-bold border transition ${visualizerStyle === 'cqt' ? 'border-pink-500 bg-pink-500/20 text-pink-300' : 'border-gray-700 bg-black/50 text-gray-400 hover:border-gray-500'}`}>
                    🌈 Renkli Spektrum
                  </button>
                  <button onClick={() => setVisualizerStyle('vinyl')} className={`py-3 px-3 rounded-xl text-sm font-bold border transition ${visualizerStyle === 'vinyl' ? 'border-orange-500 bg-orange-500/20 text-orange-300' : 'border-gray-700 bg-black/50 text-gray-400 hover:border-gray-500'}`}>
                    💿 Dönen Disk
                  </button>
                </div>
                <p className="text-xs text-gray-600">
                  {visualizerStyle === 'vinyl'
                    ? "Kapak görselin plağın etiketine gömülür ve şarkı boyunca döner."
                    : "Ses dalgası/spektrum, arka planın üzerinde ışıldayan bir katman olarak render edilir."}
                </p>
              </div>

              <div className="pt-4 border-t border-gray-800 space-y-3">
                <label className="block text-sm text-gray-400 font-bold uppercase tracking-wide">🖼️ Arka Plan</label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <button onClick={() => setVisualizerBackground('solid')} className={`py-3 px-4 rounded-xl text-sm font-bold border transition text-left ${visualizerBackground === 'solid' ? 'border-purple-500 bg-purple-500/20 text-purple-300' : 'border-gray-700 bg-black/50 text-gray-400 hover:border-gray-500'}`}>
                    ⬛ Sade Siyah<br /><span className="font-normal text-xs opacity-70">En hızlı, en ekonomik</span>
                  </button>
                  <button onClick={() => setVisualizerBackground('cover_static')} className={`py-3 px-4 rounded-xl text-sm font-bold border transition text-left ${visualizerBackground === 'cover_static' ? 'border-purple-500 bg-purple-500/20 text-purple-300' : 'border-gray-700 bg-black/50 text-gray-400 hover:border-gray-500'}`}>
                    🖼️ Sabit Kapak<br /><span className="font-normal text-xs opacity-70">Bulanık, sabit görsel</span>
                  </button>
                  <button onClick={() => setVisualizerBackground('cover_moving')} className={`py-3 px-4 rounded-xl text-sm font-bold border transition text-left ${visualizerBackground === 'cover_moving' ? 'border-purple-500 bg-purple-500/20 text-purple-300' : 'border-gray-700 bg-black/50 text-gray-400 hover:border-gray-500'}`}>
                    🎥 Hareketli Kapak<br /><span className="font-normal text-xs opacity-70">Yavaş yakınlaşma efekti</span>
                  </button>
                </div>
                <p className="text-xs text-gray-600">"Sabit Kapak" ve "Hareketli Kapak", 1. adımda üretilen albüm kapağını otomatik olarak kullanır.</p>
              </div>

              <div className="pt-4 border-t border-gray-800">
                <label className={`flex items-center gap-3 text-sm font-bold cursor-pointer ${bassLights ? 'text-orange-300' : 'text-gray-400'}`}>
                  <input type="checkbox" checked={bassLights} onChange={e => setBassLights(e.target.checked)} className="w-5 h-5 accent-orange-500" />
                  💡 Bas Vuruşuna Tepki Veren Işıklar
                </label>
                <p className="text-xs text-gray-600 mt-2">Şarkının bas enerjisini analiz edip köşelerde nabız gibi parlayan ışıklar ekler. İkinci bir render adımı olduğu için videoyu biraz uzatır.</p>
              </div>
            </div>

            <div className="space-y-6">
              <button onClick={handleAutoMashupSingle} disabled={isAutoGenerating || playlist[0].loading} className={`w-full py-6 rounded-3xl text-2xl font-bold transition-all shadow-2xl ${isAutoGenerating || playlist[0].loading ? 'bg-gradient-to-r from-gray-700 to-gray-800 cursor-wait' : 'bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 hover:scale-[1.02]'}`}>
                {isAutoGenerating ? 'SİSTEM ÇALIŞIYOR...' : '🚀 TEK ŞARKI YAYIN PAKETİ ÜRET'}
              </button>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* ÇOKLU ŞARKI (AUTO DJ MASHUP) STÜDYOSU (Gelişmiş Kontroller) */}
        {/* ======================================================== */}

        {playlist.length > 1 && (
          <div className="space-y-10 animate-fade-in-up">
            <div className="bg-gray-900 p-8 rounded-3xl border border-gray-800 text-left space-y-6">
              
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <h2 className="text-2xl font-bold flex items-center gap-3">🎧 Çalma Listesi <span className="text-sm font-normal text-gray-500">({playlist.length}/10)</span></h2>
                <button onClick={sortPlaylistByEnergy} className="px-6 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 rounded-full font-bold text-sm hover:scale-105 transition shadow-lg flex items-center gap-2">
                   ⚡ AI Otomatik Sırala (Enerjiye Göre)
                </button>
              </div>
              
              {/* YENİ: DJ Sıralama ve Silme Paneli */}
              <div className="space-y-2 bg-black/50 p-4 rounded-2xl border border-gray-800">
                {playlist.map((track, idx) => (
                  <div key={idx} className="flex items-center gap-4 bg-gray-900 p-3 rounded-xl border border-gray-800 hover:border-gray-600 transition group">
                    <span className="text-lg font-black text-purple-500 w-4 text-center">{idx + 1}</span>
                    
                    <div className="flex-1 min-w-0">
                        <p className="text-gray-200 font-medium truncate">{track.filename}</p>
                        {/* Analiz verisi yüklendiyse göster */}
                        <p className="text-xs text-gray-500">
                            {track.loading ? "Analiz ediliyor..." : `BPM: ${track.bpm} | Enerji: ${(track.energy*100).toFixed(1)}`}
                        </p>
                    </div>
                    
                    {/* Yön Okları ve Silme Tuşu */}
                    <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => moveTrack(idx, 'up')} disabled={idx === 0} className="w-8 h-8 flex items-center justify-center bg-gray-800 rounded-lg hover:bg-blue-600 disabled:opacity-30">▲</button>
                        <button onClick={() => moveTrack(idx, 'down')} disabled={idx === playlist.length-1} className="w-8 h-8 flex items-center justify-center bg-gray-800 rounded-lg hover:bg-blue-600 disabled:opacity-30">▼</button>
                        <button onClick={() => removeTrack(idx)} className="w-8 h-8 flex items-center justify-center bg-red-900/50 text-red-400 rounded-lg hover:bg-red-600 hover:text-white">✕</button>
                    </div>
                  </div>
                ))}
              </div>

              {/* YENİ: Geçiş (Crossfade) Süresi Ayarı */}
              <div className="pt-4 border-t border-gray-800">
                 <label className="block text-sm text-gray-400 font-bold mb-3 uppercase tracking-wide">Crossfade (Geçiş) Süresi: <span className="text-orange-400 text-lg">{crossfadeSec} Saniye</span></label>
                 <input type="range" min="1" max="15" value={crossfadeSec} onChange={(e) => setCrossfadeSec(parseInt(e.target.value))} className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-orange-500" />
                 <div className="flex justify-between text-xs text-gray-600 mt-2"><span>1sn (Sert Geçiş)</span><span>15sn (Radyo Mixi)</span></div>
              </div>

              {/* YENİ: Final Export Ayarları */}
              <div className="pt-4 border-t border-gray-800 space-y-3">
                <label className="block text-sm text-gray-400 font-bold uppercase tracking-wide">📦 Final Export Ayarları</label>
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => setQuality('fast')} className={`py-3 rounded-xl text-sm font-bold border transition text-left px-4 ${quality === 'fast' ? 'border-green-500 bg-green-500/20 text-green-400' : 'border-gray-700 bg-black/50 text-gray-400 hover:border-gray-500'}`}>
                    ⚡ Hızlı Paylaşım<br /><span className="font-normal text-xs opacity-80">MP3 320k</span>
                  </button>
                  <button onClick={() => setQuality('high')} className={`py-3 rounded-xl text-sm font-bold border transition text-left px-4 ${quality === 'high' ? 'border-yellow-500 bg-yellow-500/20 text-yellow-400' : 'border-gray-700 bg-black/50 text-gray-400 hover:border-gray-500'}`}>
                    💎 Yüksek Kalite<br /><span className="font-normal text-xs opacity-80">Kayıpsız WAV</span>
                  </button>
                </div>
              </div>

            </div>

            <div className="space-y-6">
              <button onClick={handleGenerateMultiMashup} disabled={isAutoGenerating || playlist.some(p => p.loading)} className={`w-full py-6 rounded-3xl text-2xl font-bold transition-all shadow-2xl ${isAutoGenerating || playlist.some(p => p.loading) ? 'bg-gradient-to-r from-gray-700 to-gray-800 cursor-wait' : 'bg-gradient-to-r from-orange-500 to-red-500 hover:scale-[1.02] shadow-[0_0_40px_rgba(249,115,22,0.4)]'}`}>
                {isAutoGenerating ? 'MASHUP OLUŞTURULUYOR...' : '🎛️ AUTO DJ MASHUP ÜRET'}
              </button>
            </div>
          </div>
        )}

        {/* ORTAK LOG EKRANI */}
        {autoLogs.length > 0 && (
          <div className="bg-black border border-gray-800 rounded-xl p-6 text-left font-mono text-sm h-40 overflow-y-auto relative shadow-inner w-full">
            {autoLogs.map((log, i) => <div key={i} className="text-green-400 mb-1">› {log}</div>)}
            {videoEta && videoEta !== "Tamamlandı!" && (
               <div className="text-blue-400 mt-3 font-bold animate-pulse flex items-center gap-2 border-t border-gray-800 pt-3">
                 <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                 [CANLI] Render Kalan Tahmini Süre: {videoEta}
               </div>
            )}
          </div>
        )}

        {/* ORTAK VİTRİN EKRANI */}
        {(coverUrl || videoUrl || resultVideoUrl || mashupResultUrl) && (
          <div className="pt-10 border-t border-gray-800 text-left w-full">
            <h2 className="text-3xl font-bold mb-8">KALIA Çıktıları</h2>
            
            {mashupResultUrl && (
              <div className="bg-gradient-to-br from-gray-900 to-black p-6 rounded-2xl border border-orange-500/30 mb-8 flex flex-col items-center gap-4">
                <h3 className="text-xl font-bold text-orange-400 uppercase tracking-widest">🎛️ KALIA Auto-DJ Mix</h3>
                <audio src={mashupResultUrl} controls className="w-full max-w-2xl" />
                <a href={mashupResultUrl} download className="px-6 py-2 bg-orange-600/20 text-orange-400 rounded-full text-sm font-bold hover:bg-orange-600 hover:text-white transition">İndir ({quality === 'high' ? '.wav' : '.mp3'})</a>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {coverUrl && (
                <div className="bg-gray-900 p-4 rounded-xl border border-gray-800">
                  <h3 className="text-sm text-gray-400 mb-3 uppercase tracking-widest">Albüm Kapağı</h3>
                  {/* Farklı boyutlarda kapağın yamulmadan görünmesi için object-contain yapıldı */}
                  <img src={coverUrl} className="w-full h-64 object-contain rounded-lg mb-4 bg-black" alt="Cover" />
                </div>
              )}
              {videoUrl && (
                <div className="bg-gray-900 p-4 rounded-xl border border-gray-800">
                  <h3 className="text-sm text-gray-400 mb-3 uppercase tracking-widest">Visualizer</h3>
                  <video src={videoUrl} controls className="w-full aspect-video bg-black rounded-lg mb-4" />
                  <button onClick={() => handleConvertToReels(videoUrl)} className="w-full py-2 bg-green-600/20 text-green-400 rounded-lg text-sm font-semibold hover:bg-green-600 hover:text-white transition">TikTok Formuna Çevir</button>
                </div>
              )}
              {resultVideoUrl && (
                <div className="bg-gray-900 p-4 rounded-xl border border-gray-800">
                  <h3 className="text-sm text-gray-400 mb-3 uppercase tracking-widest">Beat-Sync Kurgu</h3>
                  <video src={resultVideoUrl} controls className="w-full aspect-video bg-black rounded-lg mb-4" />
                  <button onClick={() => handleConvertToReels(resultVideoUrl)} className="w-full py-2 bg-green-600/20 text-green-400 rounded-lg text-sm font-semibold hover:bg-green-600 hover:text-white transition">TikTok Formuna Çevir</button>
                </div>
              )}
            </div>
            
            {reelsVideoUrl && (
              <div className="mt-12 bg-gray-900 p-6 rounded-2xl border border-green-500/50 shadow-lg max-w-sm mx-auto text-center">
                <h3 className="text-lg font-bold text-green-400 mb-4">Sosyal Medya Çıktısı (9:16)</h3>
                <video src={reelsVideoUrl} controls autoPlay loop className="w-full bg-black rounded-xl" />
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}

export default App;