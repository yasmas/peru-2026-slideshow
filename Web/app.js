(() => {
  'use strict';
  const trip = window.PERU_TRIP;
  if (!trip || !trip.slides?.length || !window.PERU_PLAYBACK_PLAN) return;
  let playlist = window.PERU_PLAYBACK_PLAN(trip, 'quick');
  const $ = id => document.getElementById(id);
  const stage = $('stage');
  const theater = $('theater');
  let audio = $('musicAudio');
  let standbyAudio = $('nextMusicAudio');
  const ui = {
    prev: $('prevBtn'), next: $('nextBtn'), play: $('playBtn'), playIcon: $('playIcon'),
    progress: $('progress'), fill: $('progressFill'), marker: $('progressMarker'), current: $('frameCurrent'), total: $('frameTotal'),
    chapter: $('chapterName'), kicker: $('chapterKicker'), date: $('frameDate'),
    chapters: $('chaptersBtn'), drawer: $('chapterDrawer'), closeChapters: $('closeChapters'), list: $('chapterList'),
    music: $('musicBtn'), musicState: $('musicState'), fullscreen: $('fullscreenBtn'), credit: $('trackCredit'), loading: $('loadingNote'),
    chooser: $('modeChooser'), quick: $('quickMode'), full: $('fullMode'), quickSummary: $('quickSummary'), fullSummary: $('fullSummary'), mode: $('modeBtn')
  };
  const state = { index: 0, pendingIndex: null, pendingLayer: null, transitionId: 0, playing: false, begun: false, timer: null, slideStarted: 0, remaining: 0, video: null, layer: null, track: 0, muted: false, ducked: false, raf: null, trackReady: false, finalLoop: false, incoming: null };
  const imagePreloads = new Map();
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  // Safari (macOS and iOS) only lets a video play with sound, unattended, if
  // that same element was once played inside a user gesture. Two elements are
  // unlocked by the Play tap and then reused for every clip: one plays while
  // the other preloads the next clip or holds the outgoing frame.
  const videoPool = [0, 1].map(() => {
    const video = document.createElement('video');
    video.preload = 'auto'; video.playsInline = true;
    video.setAttribute('playsinline', ''); video.setAttribute('webkit-playsinline', '');
    return video;
  });
  // iOS ignores element volume, so ordinary clips stay muted there rather
  // than playing at full volume; the flute clip keeps its own sound.
  const clipHasSound = slide => !isIOS || slide.musicVolume === 0;
  function unlockVideoPool() {
    for (const video of videoPool) {
      if (video === state.video) continue;
      video.play().catch(() => {});
      video.pause();
    }
  }
  function loadVideo(video, slide) {
    if (video._source === slide.source) return;
    video._source = slide.source; video.src = slide.source; video.load();
  }
  function acquireVideo(slide) {
    const free = videoPool.filter(video => video !== state.video);
    const video = free.find(item => item._source === slide.source && !item._layer) ||
      free.find(item => !item._layer) || free[0];
    // Very fast skipping can still have the spare element in a fading layer.
    if (video._layer) discardLayer(video._layer);
    video._listeners?.abort(); video._listeners = new AbortController();
    clearVideoWatchdog(video);
    loadVideo(video, slide);
    video.poster = slide.fallback;
    video.muted = !clipHasSound(slide); video.volume = 0.25;
    video.setAttribute('aria-label', `Trip video, ${slide.chapter}`);
    return video;
  }
  function releaseVideo(video) {
    clearVideoWatchdog(video);
    video._listeners?.abort(); video._listeners = null;
    video._layer = null; video._source = null; video._starting = false;
    video.pause(); video.removeAttribute('src'); video.removeAttribute('poster'); video.load();
    video.remove();
  }
  function clearVideoWatchdog(video) { clearTimeout(video._watchdog); video._watchdog = null; }
  function watchVideo(video, milliseconds) {
    // Never leave the show frozen on a still frame if a clip will not start.
    clearVideoWatchdog(video);
    video._watchdog = setTimeout(() => {
      video._watchdog = null;
      if (state.video !== video || !state.playing) return;
      video._starting = false;
      console.warn('Video did not start in time; continuing:', video._source);
      state.ducked = false; adjustMusic();
      ui.loading.textContent = 'This clip could not play; continuing shortly';
      ui.loading.hidden = false;
      schedule(2500);
    }, milliseconds);
  }
  function durationLabel(seconds) { return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`; }
  const fullPlan = window.PERU_PLAYBACK_PLAN(trip, 'full');
  ui.quickSummary.textContent = `${playlist.slides.length} moments · about ${durationLabel(playlist.duration)}`;
  ui.fullSummary.textContent = `${fullPlan.slides.length} moments · ${durationLabel(fullPlan.duration)}`;
  function updateModeUi() {
    ui.total.textContent = String(playlist.slides.length).padStart(3, '0');
    ui.mode.textContent = playlist.mode.toUpperCase();
    ui.mode.setAttribute('aria-label', `Switch to ${playlist.mode === 'quick' ? 'full' : 'quick'} slideshow`);
    ui.quick.setAttribute('aria-pressed', String(playlist.mode === 'quick'));
    ui.full.setAttribute('aria-pressed', String(playlist.mode === 'full'));
  }
  updateModeUi();

  function formatDate(value) {
    if (!value) return 'SEP — OCT 2026';
    const [day] = value.split(' ');
    const [year, month, date] = day.split('-');
    const monthName = { '09': 'SEP', '10': 'OCT' }[month] || month;
    return `${monthName} ${date || ''}, ${year || '2026'}`;
  }

  function photoPicture(slide) {
    const picture = document.createElement('picture');
    if (slide.format === 'avif' || slide.format === 'heic') {
      const source = document.createElement('source');
      source.type = slide.format === 'avif' ? 'image/avif' : 'image/heic';
      source.srcset = slide.source;
      picture.append(source);
    }
    const img = document.createElement('img');
    img.src = slide.format === 'jpeg' ? slide.source : slide.fallback;
    img.dataset.fallback = slide.fallback;
    if (slide.format === 'jpeg' && slide.source !== slide.fallback) {
      img.addEventListener('error', () => { img.src = slide.fallback; }, { once: true });
    }
    img.alt = slide.alt || (slide.title ? `${slide.title}: a photograph from the Peru trip` : `Peru trip photograph ${state.index + 1}`);
    img.decoding = 'async';
    img.draggable = false;
    picture.append(img);
    return picture;
  }

  function portraitPhoto(item) {
    const img = document.createElement('img');
    img.alt = item.alt;
    img.decoding = 'async';
    img.draggable = false;
    img.style.position = 'static';
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'contain';
    img.dataset.fallback = item.fallback;
    img.addEventListener('error', () => { img.src = item.fallback; }, { once: true });
    img.src = item.source;
    return img;
  }

  function applyPhotoMotion(img, slide, frame) {
    const cue = slide.motion;
    if (!cue || cue.mode === 'hold') return null;
    img.classList.add('photo-motion', `motion-${cue.mode}`);
    if (cue.mode === 'pan') img.classList.add(`pan-${cue.direction}`);
    img.style.setProperty('--motion-duration', `${slide.duration}s`);
    img.style.setProperty('--motion-min-scale', String(1 / (cue.scale || 1.025)));
    if (!cue.focus) return null;

    // Map a face in source-image coordinates into the letterboxed display box.
    // This keeps the zoom centered on the face in portrait and fullscreen views.
    const updateFocus = () => {
      const width = frame.clientWidth, height = frame.clientHeight;
      if (!img.naturalWidth || !img.naturalHeight || !width || !height) return;
      const fit = Math.min(width / img.naturalWidth, height / img.naturalHeight);
      const shownWidth = img.naturalWidth * fit, shownHeight = img.naturalHeight * fit;
      const x = ((width - shownWidth) / 2 + cue.focus[0] * shownWidth) / width * 100;
      const y = ((height - shownHeight) / 2 + cue.focus[1] * shownHeight) / height * 100;
      img.style.setProperty('--focus-x', `${x}%`);
      img.style.setProperty('--focus-y', `${y}%`);
    };
    img.addEventListener('load', updateFocus);
    const observer = new ResizeObserver(updateFocus);
    observer.observe(frame);
    if (img.complete) requestAnimationFrame(updateFocus);
    return () => { observer.disconnect(); img.removeEventListener('load', updateFocus); };
  }

  function sideScene(mode) {
    const scene = document.createElement('div'); scene.className = `side-scene ${mode}`;
    const bike = `<svg class="bike-art" viewBox="0 0 300 170" aria-hidden="true"><g fill="none" stroke="#d6b780" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><circle cx="58" cy="121" r="36"/><circle cx="245" cy="121" r="36"/><path d="M58 121l55-65 54 65H58m55-65h54l78 65m-78 0 22-53h45M97 54l-15-18m92 28 14-20 20-2m-91 13h-33m117-24 20-4"/><path d="M100 73h56l13 25h-43z" fill="#8e4b34" stroke="#d6b780"/><path d="M72 39h58m81-14 15-6"/></g><text x="111" y="88" fill="#f5e1b5" font-size="9" font-family="Arial" font-weight="bold">ROYAL ENFIELD</text><circle cx="58" cy="121" r="5" fill="#d6b780"/><circle cx="245" cy="121" r="5" fill="#d6b780"/></svg>`;
    const llama = `<svg class="llama-art" viewBox="0 0 140 180" aria-hidden="true"><path fill="#caa97b" d="M31 82q-14-15-16-3l8 22 9-4z"/><ellipse fill="#caa97b" cx="65" cy="100" rx="43" ry="30"/><path fill="#caa97b" d="M77 88q-4-28 3-48l14-12 14 10-5 23 1 31z"/><ellipse fill="#caa97b" cx="105" cy="43" rx="22" ry="13"/><path fill="#caa97b" d="M88 38l-4-26 8-4 8 27zm13-2 5-29 9 4-1 29z"/><path fill="#b89565" d="M31 119h14l-2 47H30zm29 9h13l-2 38H60zm24-2h13l4 40H87zm16-13h13l8 53h-14z"/><circle cx="114" cy="41" r="3" fill="#27211a"/><path d="M123 49q-5 5-10 2" fill="none" stroke="#513f2c" stroke-width="2"/></svg>`;
    const condor = `<svg class="condor-art" viewBox="0 0 200 90" aria-hidden="true"><path fill="#d7c49c" d="M99 48C66 20 29 18 2 25c22 5 38 12 48 23-20-7-33-4-42 3 30-1 58 10 85 26l7-10 7 10c27-16 55-27 85-26-9-7-22-10-42-3 10-11 26-18 48-23-27-7-64-5-97 23l-1-21-8-10-8 10z"/></svg>`;
    scene.innerHTML = `<div class="scene-left">${bike}<span class="fume fume-a"></span><span class="fume fume-b"></span></div><div class="scene-right">${mode === 'map-scene' ? llama : bike}<span class="fume fume-c"></span></div>${mode === 'map-scene' ? condor : ''}`;
    return scene;
  }

  function preparePhotoSequence(layer, frame, slide) {
    if (slide.layout === 'portrait-pair') return;
    const duration = slide.duration;
    const count = slide.items.length;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const move = 0.55;
    const hold = (duration - (count - 1) * move) / count;
    const direction = { incoming: 'translate(110%, 13%)', outgoing: 'translate(-110%, -13%)' };
    const easing = 'cubic-bezier(.22,.8,.25,1)';
    layer._animations = [...frame.querySelectorAll('.collage-cell')].map((cell, index) => {
      const enterStart = index ? index * hold + (index - 1) * move : 0;
      const enterEnd = index * (hold + move);
      const holdEnd = enterEnd + hold;
      if (reducedMotion) {
        const frames = index ? [
          { offset: 0, opacity: 0 },
          { offset: enterStart / duration, opacity: 0 },
          { offset: Math.min(1, (enterStart + 0.03) / duration), opacity: 1 },
        ] : [{ offset: 0, opacity: 1 }];
        frames.push({ offset: holdEnd / duration, opacity: 1 });
        if (index < count - 1) {
          frames.push({ offset: Math.min(1, (holdEnd + 0.03) / duration), opacity: 0 });
          frames.push({ offset: 1, opacity: 0 });
        }
        const animation = cell.animate(frames, { duration: duration * 1000, fill: 'both' });
        animation.pause();
        return animation;
      }
      const frames = index ? [
        { offset: 0, transform: direction.incoming },
        { offset: enterStart / duration, transform: direction.incoming, easing },
        { offset: enterEnd / duration, transform: 'translate(0, 0)' },
      ] : [{ offset: 0, transform: 'translate(0, 0)' }];
      frames.push({ offset: holdEnd / duration, transform: 'translate(0, 0)', easing });
      if (index < count - 1) {
        frames.push({ offset: (holdEnd + move) / duration, transform: direction.outgoing });
        frames.push({ offset: 1, transform: direction.outgoing });
      }
      const animation = cell.animate(frames, { duration: duration * 1000, fill: 'both', easing: 'linear' });
      animation.pause();
      return animation;
    });
  }

  function makeLayer(slide, index) {
    const layer = document.createElement('div');
    layer.className = `slide-layer ${slide.opening ? 'is-opening' : ''} ${slide.map ? 'is-map' : ''} ${slide.id === 'IMG_0877' ? 'is-portrait-ride' : ''} ${slide.title ? 'is-chapter' : ''}`;
    layer.style.setProperty('--blurred', `url("${slide.fallback}")`);
    if (slide.opening) {
      const art = document.createElement('div'); art.className = 'opening-art';
      art.append(photoPicture(slide));
      const stamp = document.createElement('div'); stamp.className = 'opening-stamp';
      stamp.innerHTML = 'PERU <span>2026</span>';
      art.append(stamp); layer.append(art);
    } else {
      if (slide.map || slide.id === 'IMG_0877') layer.append(sideScene(slide.map ? 'map-scene' : 'ride-scene'));
      const frame = document.createElement('div'); frame.className = 'media-frame';
      if (slide.kind === 'video') {
        const video = acquireVideo(slide);
        const poster = document.createElement('img');
        poster.className = 'video-placeholder'; poster.src = slide.fallback;
        poster.alt = 'Still frame from the video'; poster.decoding = 'async';
        poster.dataset.fallback = slide.fallback;
        const listen = (type, handler) => video.addEventListener(type, handler, { signal: video._listeners.signal });
        listen('playing', () => {
          poster.hidden = true;
          if (state.video === video && state.playing) {
            clearVideoWatchdog(video);
            ui.loading.hidden = true;
            state.ducked = !video.muted;
            adjustMusic();
            schedule(Math.max(500, (slide.duration - video.currentTime) * 1000));
          }
        });
        listen('waiting', () => {
          if (state.video === video && state.playing) {
            clearTimer();
            state.ducked = false;
            adjustMusic();
            watchVideo(video, 10000);
          }
        });
        listen('ended', () => { if (state.playing && state.video === video) next(); });
        if (slide.trimEnd) listen('timeupdate', () => {
          if (state.playing && state.video === video && video.currentTime >= slide.duration) {
            video.pause(); next();
          }
        });
        listen('error', () => {
          poster.hidden = false; releaseVideo(video); layer._video = null;
          if (state.video !== video) return;
          clearTimer();
          state.video = null; state.ducked = false; adjustMusic();
          if (state.playing) {
            ui.loading.textContent = 'This clip could not load; continuing shortly';
            ui.loading.hidden = false;
            schedule(2500);
          }
        });
        frame.append(video, poster); layer._video = video; video._layer = layer;
      } else if (slide.kind === 'collage') {
        frame.classList.add('collage-frame', `collage-${slide.items.length}`, `layout-${slide.layout}`);
        if (slide.layout === 'portrait-pair') {
          frame.style.display = 'flex';
          frame.style.alignItems = 'stretch';
        }
        for (const item of slide.items) {
          const cell = document.createElement('div'); cell.className = 'collage-cell';
          if (slide.layout === 'diagonal') cell.style.zIndex = String(slide.items.length - frame.childElementCount);
          if (slide.layout === 'portrait-pair') {
            cell.style.position = 'relative';
            cell.style.inset = 'auto';
            cell.style.flex = '1 1 0';
            cell.style.height = '100%';
            cell.append(portraitPhoto(item));
          } else cell.append(photoPicture(item));
          frame.append(cell);
        }
        preparePhotoSequence(layer, frame, slide);
      } else {
        const picture = photoPicture(slide);
        frame.append(picture);
        layer._cleanup = applyPhotoMotion(picture.querySelector('img'), slide, frame);
      }
      layer.append(frame);
      const mat = document.createElement('div'); mat.className = 'photo-mat'; layer.append(mat);
    }
    if (slide.kind === 'video') {
      const tag = document.createElement('span'); tag.className = 'video-tag';
      tag.innerHTML = '<b>●</b> MOTION PICTURE'; layer.append(tag);
    }
    if (slide.title) {
      const card = document.createElement('div'); card.className = 'chapter-card';
      const kicker = document.createElement('span'); kicker.className = 'chapter-kicker'; kicker.textContent = slide.kicker || 'THE JOURNEY';
      const heading = document.createElement('h1'); heading.textContent = slide.title;
      const sub = document.createElement('p'); sub.textContent = slide.subtitle || '';
      card.append(kicker, heading, sub); layer.append(card);
    } else if (slide.caption) {
      const caption = document.createElement('div'); caption.className = 'caption-card'; caption.textContent = slide.caption; layer.append(caption);
    }
    return layer;
  }

  function clearTimer() { if (state.timer) clearTimeout(state.timer); state.timer = null; }
  function schedule(milliseconds) {
    clearTimer(); state.remaining = milliseconds; state.slideStarted = performance.now();
    state.timer = setTimeout(next, milliseconds);
  }
  function updateProgress() {
    const slide = playlist.slides[state.index];
    let fraction = 0;
    if (state.playing) {
      if (state.video && state.video.duration && Number.isFinite(state.video.duration)) {
        fraction = state.video.currentTime / (slide.trimEnd ? slide.duration : state.video.duration);
        fraction = Math.min(1, fraction);
      }
      else if (state.remaining) fraction = Math.min(1, (performance.now() - state.slideStarted) / state.remaining);
    }
    const position = ((state.index + fraction) / playlist.slides.length) * 100;
    ui.fill.style.width = `${position}%`; ui.marker.style.left = `${position}%`;
    updateMusic();
    if (state.playing) state.raf = requestAnimationFrame(updateProgress);
  }

  const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, value));
  function songUrl(track) {
    const song = trip.music[track];
    return song.file + (song.cacheVersion ? `?v=${encodeURIComponent(song.cacheVersion)}` : '');
  }
  function showTrackCredit(track) {
    const song = trip.music[track];
    ui.credit.textContent = `NOW PLAYING · ${song.title.toUpperCase()} · ${song.artist.toUpperCase()}`;
  }
  function cancelIncoming() {
    state.incoming = null;
    standbyAudio.pause();
    standbyAudio.removeAttribute('src');
    standbyAudio.load();
  }
  function setTrack(number, playNow = true) {
    cancelIncoming();
    state.track = number; state.trackReady = false; state.finalLoop = false;
    audio.src = songUrl(number);
    showTrackCredit(number);
    audio.load();
    if (playNow && state.playing && audio.readyState >= 1) startTrack();
    adjustMusic();
  }
  function startTrack() {
    const song = trip.music[state.track];
    if (!state.trackReady || audio.currentTime < (song.startAt || 0) - 0.1) {
      audio.currentTime = song.startAt || 0; state.trackReady = true;
    }
    if (song.maxPlay && audio.currentTime - (song.startAt || 0) >= song.maxPlay) return;
    if (state.playing) audio.play().catch(error => { console.warn('Music playback failed:', error.name, error.message); ui.musicState.textContent = 'TAP'; });
  }
  function slideElapsed() {
    const slide = playlist.slides[state.index];
    if (!slide) return 0;
    if (state.video && Number.isFinite(state.video.currentTime)) return clamp(state.video.currentTime, 0, slide.duration);
    if (!state.remaining) return 0;
    const elapsed = slide.duration - state.remaining / 1000 + (state.playing ? (performance.now() - state.slideStarted) / 1000 : 0);
    return clamp(elapsed, 0, slide.duration);
  }
  function timeToCue(cue) {
    let seconds = -slideElapsed();
    for (let index = state.index; index < cue.index; index++) seconds += playlist.slides[index].duration;
    return Math.max(0, seconds);
  }
  function nextMusicCue() {
    return playlist.musicCues.find(cue => cue.track > state.track && cue.index > state.index);
  }
  function prepareIncoming(cue) {
    if (state.incoming?.cue.track === cue.track) return;
    cancelIncoming();
    state.incoming = { cue, started: false, starting: false };
    standbyAudio.volume = 0;
    standbyAudio.muted = state.muted;
    standbyAudio.src = songUrl(cue.track);
    standbyAudio.load();
  }
  function startIncoming() {
    const incoming = state.incoming;
    if (!incoming || incoming.started || incoming.starting || !state.playing || standbyAudio.readyState < 1) return;
    incoming.starting = true;
    standbyAudio.currentTime = trip.music[incoming.cue.track].startAt || 0;
    standbyAudio.volume = 0;
    standbyAudio.play().then(() => {
      if (state.incoming !== incoming) return;
      incoming.started = true; incoming.starting = false; adjustMusic();
    }).catch(error => {
      if (state.incoming !== incoming) return;
      incoming.starting = false;
      console.warn('Incoming music playback delayed:', error.name, error.message);
    });
  }
  function syncIncoming() {
    const cue = nextMusicCue();
    if (!cue || state.index < cue.index - (cue.fadeFrames || 2)) return;
    prepareIncoming(cue);
    if (timeToCue(cue) <= 3) startIncoming();
  }
  function commitIncoming(cue) {
    if (!state.incoming?.started || state.incoming.cue.track !== cue.track) return false;
    const outgoing = audio;
    audio = standbyAudio;
    standbyAudio = outgoing;
    state.incoming = null;
    state.track = cue.track; state.trackReady = true; state.finalLoop = false;
    standbyAudio.pause();
    standbyAudio.removeAttribute('src'); standbyAudio.load();
    showTrackCredit(cue.track);
    return true;
  }
  function updateMusic() {
    const song = trip.music[state.track];
    if (!song || !state.trackReady || !state.playing) return;
    syncIncoming();
    const elapsed = Math.max(0, audio.currentTime - (song.startAt || 0));
    if (song.maxPlay && elapsed >= song.maxPlay && !audio.paused) audio.pause();
    adjustMusic();
  }
  function adjustMusic() {
    const song = trip.music[state.track];
    const elapsed = Math.max(0, audio.currentTime - (song.startAt || 0));
    let volume = song.rampFullAt ? Math.min(1, 0.25 + 0.75 * Math.max(0, audio.currentTime - song.startAt) / (song.rampFullAt - song.startAt)) : 1;
    let oldGain = 1, newGain = 0;
    const incoming = state.incoming;
    if (incoming) {
      const cue = incoming.cue;
      const fadeStart = Math.max(0, cue.index - (cue.fadeFrames || 2));
      const fadeDuration = playlist.slides.slice(fadeStart, cue.index).reduce((sum, slide) => sum + slide.duration, 0);
      const remaining = timeToCue(cue);
      const lead = Math.min(3, fadeDuration);
      if (remaining > lead) {
        oldGain = 0.65 + 0.35 * clamp((remaining - lead) / Math.max(0.001, fadeDuration - lead));
      } else if (incoming.started) {
        const overlap = clamp((lead - remaining) / Math.max(0.001, lead));
        oldGain = 0.65 * Math.cos(overlap * Math.PI / 2);
        newGain = Math.sin(overlap * Math.PI / 2);
        const combined = Math.max(1, oldGain + newGain);
        oldGain /= combined; newGain /= combined;
      } else oldGain = 0.65;
    } else if (song.maxPlay) {
      oldGain *= clamp((song.maxPlay - elapsed) / 3);
    }
    if (state.finalLoop) volume *= Math.min(1, elapsed / 3);
    if (state.track === trip.music.length - 1 && audio.duration && Number.isFinite(audio.duration)) {
      volume *= clamp((audio.duration - audio.currentTime) / 3);
    }
    const videoMusicVolume = playlist.slides[state.index]?.musicVolume ?? 0.75;
    const videoFactor = state.ducked ? clamp(videoMusicVolume) : 1;
    audio.volume = clamp(volume * oldGain * videoFactor);
    standbyAudio.volume = clamp(newGain * videoFactor);
    audio.muted = standbyAudio.muted = state.muted || (state.ducked && videoMusicVolume === 0);
    ui.musicState.textContent = state.muted ? 'OFF' : 'ON';
    ui.music.setAttribute('aria-label', state.muted ? 'Unmute music' : 'Mute music');
  }
  function bindMusicElement(element) {
    element.addEventListener('loadedmetadata', () => {
      if (element === audio) startTrack();
      else if (element === standbyAudio && state.incoming && timeToCue(state.incoming.cue) <= 3) startIncoming();
    });
    element.addEventListener('canplay', () => {
      if (element === audio && state.playing && element.paused) startTrack();
      else if (element === standbyAudio && state.incoming && timeToCue(state.incoming.cue) <= 3) startIncoming();
    });
    element.addEventListener('seeked', () => {
      if (element === audio && state.playing && element.paused) startTrack();
    });
    element.addEventListener('ended', () => {
      if (element !== audio || state.track !== trip.music.length - 1) return;
      // The full show outlasts the final recording slightly. Make a quiet reprise.
      state.finalLoop = true;
      audio.currentTime = trip.music[state.track].startAt || 0;
      if (state.playing) audio.play().catch(() => {});
    });
  }
  bindMusicElement(audio); bindMusicElement(standbyAudio);
  setTrack(0, false);

  async function playVideo() {
    const video = state.video;
    if (!video || !state.playing || video._starting || !video.paused) return;
    video._starting = true;
    watchVideo(video, 8000);
    // Keep music audible while a streaming clip is still buffering.
    state.ducked = false; adjustMusic();
    try {
      await video.play();
    } catch (error) {
      // AbortError means a pause or source change superseded this attempt.
      if (state.video !== video || !state.playing || error.name === 'AbortError') return;
      if (!video.muted) {
        // Still blocked with sound: play silently rather than show a still.
        console.warn('Video sound blocked; playing muted:', error.name, error.message);
        video.muted = true;
        try { await video.play(); } catch (retryError) {
          console.warn('Muted video playback blocked:', retryError.name, retryError.message);
        }
      }
    } finally {
      video._starting = false;
    }
  }

  async function decodeImage(img) {
    try { await img.decode(); return; } catch (_) {
      if (img.naturalWidth) return;
      const fallback = img.dataset.fallback;
      if (!fallback) return;
      img.closest('picture')?.querySelectorAll('source').forEach(source => source.remove());
      if (img.src !== new URL(fallback, document.baseURI).href) img.src = fallback;
      try { await img.decode(); } catch (_) { /* A broken asset must not stop navigation. */ }
    }
  }

  function discardLayer(layer) {
    if (layer._discarded) return;
    layer._discarded = true;
    layer._cleanup?.();
    layer._animations?.forEach(animation => animation.cancel());
    // The pooled element may already belong to a newer layer.
    if (layer._video?._layer === layer) releaseVideo(layer._video);
    layer._video = null;
    layer.remove();
  }

  function activateSlide(index, slide, layer, initial) {
    cancelAnimationFrame(state.raf);
    if (state.video) { state.video.pause(); state.video.currentTime = 0; }
    state.video = null; state.ducked = false; state.remaining = 0;
    const old = state.layer;
    const previousIndex = state.index;
    state.index = index; state.layer = layer; state.video = layer._video || null;
    const cue = playlist.musicCues.findLast(item => item.index <= index);
    const jumped = !initial && (index < previousIndex || index > previousIndex + 1);
    if (cue && (cue.track !== state.track || jumped || (index === 0 && !initial))) {
      if (!jumped && index === cue.index && !commitIncoming(cue)) setTrack(cue.track);
      else if (jumped || index !== cue.index) setTrack(cue.track);
    }
    layer.classList.remove('preparing');
    ui.chooser.hidden = state.begun || index > 0;
    theater.classList.toggle('showing-launch', !state.begun && index === 0);
    adjustMusic();
    if (initial) { layer.style.opacity = '1'; } else {
      requestAnimationFrame(() => {
        layer.classList.add('enter', slide.transition);
        if (old) {
          // For dissolves, keep the outgoing frame fully visible underneath
          // until the incoming frame is opaque. Fading both exposes black.
          if (slide.transition !== 'dissolve') old.classList.add('exit');
          setTimeout(() => {
            discardLayer(old);
            // The outgoing clip's element is free now; preload into it.
            if (state.layer === layer) prefetchVideo(index + 1);
          }, slide.transition === 'dissolve' ? 650 : 1000);
        }
      });
    }
    ui.current.textContent = String(index + 1).padStart(3, '0');
    ui.chapter.textContent = slide.opening ? 'Peru 2026' : slide.map ? 'The route' : slide.chapter;
    const chapter = playlist.chapters.findLast(c => c.index <= index);
    ui.kicker.textContent = slide.opening ? 'PROLOGUE / THE ANDES' : slide.map ? 'PROLOGUE / THE ROUTE' : chapter?.kicker || 'VINTAGE RIDES / ANDES';
    ui.date.textContent = index < 2 ? 'SEP — OCT 2026' : formatDate(slide.date);
    ui.loading.hidden = true;
    updateChapterButtons();
    if (state.playing) {
      layer._animations?.forEach(animation => animation.play());
      if (state.video) setTimeout(playVideo, initial ? 0 : 300);
      else schedule(slide.duration * 1000);
      updateProgress();
    } else updateProgress();
    prefetch(index + 1);
  }

  function show(index, { initial = false } = {}) {
    if (index < 0 || index >= playlist.slides.length) return;
    const request = ++state.transitionId;
    clearTimer();
    ui.loading.hidden = true;
    if (state.video) state.video.pause();
    if (state.pendingLayer) discardLayer(state.pendingLayer);
    state.pendingLayer = null; state.pendingIndex = null;
    const slide = playlist.slides[index];
    const layer = makeLayer(slide, index);
    layer.classList.add('preparing');
    stage.append(layer);
    if (initial) { activateSlide(index, slide, layer, true); return; }
    state.pendingLayer = layer; state.pendingIndex = index;
    Promise.all([...layer.querySelectorAll('img')].map(decodeImage)).then(() => {
      if (request !== state.transitionId) return;
      state.pendingLayer = null; state.pendingIndex = null;
      activateSlide(index, slide, layer, false);
    });
  }

  function predecode(image, fallback) {
    if (image._predecoding) return;
    image._predecoding = true;
    image.decode().catch(async () => {
      if (image.naturalWidth || !fallback) return;
      image.src = fallback;
      try { await image.decode(); } catch (_) { /* The visible slide handles failure. */ }
    });
  }

  function prefetch(start) {
    // Keep a short rolling window; decoded HDR photos can be large on an iPad.
    const maxImages = 4;
    const keepImages = new Set();
    let imageCount = 0;
    for (let offset = 0; offset < 3 && imageCount < maxImages; offset++) {
      const index = start + offset, slide = playlist.slides[index];
      if (!slide) break;
      if (slide.kind === 'video') {
        keepImages.add(slide.fallback);
        if (!imagePreloads.has(slide.fallback)) {
          const image = new Image(); image.src = slide.fallback;
          imagePreloads.set(slide.fallback, image);
        }
        if (!offset) predecode(imagePreloads.get(slide.fallback));
        imageCount++;
      } else {
        for (const item of slide.kind === 'collage' ? slide.items : [slide]) {
          if (imageCount >= maxImages) break;
          keepImages.add(item.source);
          if (!imagePreloads.has(item.source)) {
            const image = new Image(); image.src = item.source;
            imagePreloads.set(item.source, image);
          }
          if (!offset) predecode(imagePreloads.get(item.source), item.fallback);
          imageCount++;
        }
      }
    }
    for (const key of imagePreloads.keys()) if (!keepImages.has(key)) imagePreloads.delete(key);
    prefetchVideo(start);
  }

  function prefetchVideo(start) {
    const slide = playlist.slides.slice(start, start + 3).find(item => item.kind === 'video');
    if (!slide || videoPool.some(video => video._source === slide.source)) return;
    const spare = videoPool.find(video => video !== state.video && !video._layer);
    if (spare) loadVideo(spare, slide);
  }

  function play() {
    if (state.playing) return;
    const firstStart = !state.begun;
    if (state.index === playlist.slides.length - 1 && stage.querySelector('.end-card')) { stage.querySelector('.end-card').remove(); show(0); }
    state.playing = true; state.begun = true;
    ui.chooser.hidden = true; ui.mode.hidden = true;
    theater.classList.remove('showing-launch');
    ui.playIcon.textContent = 'Ⅱ'; ui.play.setAttribute('aria-label', 'Pause slideshow');
    document.querySelector('.app-shell').classList.remove('is-paused');
    unlockVideoPool();
    if (audio.readyState >= 1) startTrack();
    else {
      // The first play() must happen inside the tap itself on iOS. The browser
      // can finish loading the recording afterward without losing that gesture.
      audio.play().catch(error => {
        if (error.name === 'AbortError') return;
        console.warn('Music playback failed:', error.name, error.message);
        ui.musicState.textContent = 'TAP';
      });
    }
    if (firstStart && state.index === 0 && !state.incoming) {
      // Unlock the second audio element in the same user gesture on iOS.
      const unlockAudio = standbyAudio;
      unlockAudio.src = songUrl(1); unlockAudio.volume = 0;
      unlockAudio.play().then(() => {
        if (state.incoming || unlockAudio !== standbyAudio) return;
        unlockAudio.pause(); unlockAudio.removeAttribute('src'); unlockAudio.load();
      }).catch(() => {
        if (state.incoming || unlockAudio !== standbyAudio) return;
        unlockAudio.removeAttribute('src'); unlockAudio.load();
      });
    }
    if (state.incoming?.started) standbyAudio.play().catch(() => {});
    state.layer?._animations?.forEach(animation => animation.play());
    if (state.pendingLayer) { /* The outgoing frame stays up until the next one is decoded. */ }
    else if (state.video) {
      // A tap may lift a mute that Safari forced on an earlier attempt.
      state.video.muted = !clipHasSound(playlist.slides[state.index]);
      playVideo();
    }
    else schedule(state.remaining || playlist.slides[state.index].duration * 1000);
    updateProgress();
  }
  function pause() {
    if (!state.playing) return;
    if (state.timer) state.remaining = Math.max(100, state.remaining - (performance.now() - state.slideStarted));
    clearTimer(); state.playing = false; cancelAnimationFrame(state.raf);
    if (state.video) { clearVideoWatchdog(state.video); state.video.pause(); }
    audio.pause(); standbyAudio.pause();
    state.layer?._animations?.forEach(animation => animation.pause());
    document.querySelector('.app-shell').classList.add('is-paused');
    ui.mode.hidden = false;
    ui.playIcon.textContent = '▶'; ui.play.setAttribute('aria-label', 'Play slideshow');
  }
  function togglePlay() { state.playing ? pause() : play(); }
  function endRide() {
    state.transitionId++;
    if (state.pendingLayer) discardLayer(state.pendingLayer);
    state.pendingLayer = null; state.pendingIndex = null;
    pause(); ui.fill.style.width = '100%'; ui.marker.style.left = '100%';
    const card = document.createElement('div'); card.className = 'end-card';
    card.innerHTML = '<span>VINTAGE RIDES / ANDES</span><h2>THE ROAD<br>GOES ON.</h2><p>AREQUIPA · COLCA · CUSCO · MACHU PICCHU · QUINCEMIL · TITICACA</p><button type="button">RIDE IT AGAIN ↗</button>';
    card.querySelector('button').addEventListener('click', () => { card.remove(); show(0); play(); });
    stage.append(card);
  }
  function next() {
    const index = state.pendingIndex ?? state.index;
    if (index + 1 >= playlist.slides.length) endRide(); else show(index + 1);
  }
  function returnToStart() {
    pause(); audio.pause();
    state.begun = false;
    show(0);
  }
  function previous() {
    stage.querySelector('.end-card')?.remove();
    const index = Math.max(0, (state.pendingIndex ?? state.index) - 1);
    if (index === 0) returnToStart(); else show(index);
  }
  function jump(index) {
    stage.querySelector('.end-card')?.remove();
    if (index === 0) returnToStart(); else show(index);
    ui.drawer.hidden = true;
  }

  function updateChapterButtons() {
    ui.list.querySelectorAll('button').forEach(button => button.classList.toggle('active', Number(button.dataset.index) <= state.index && (Number(button.dataset.next) > state.index || !button.dataset.next)));
  }
  function buildChapterButtons() {
   ui.list.replaceChildren();
   playlist.chapters.forEach((chapter, i) => {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.index = chapter.index;
    if (playlist.chapters[i + 1]) button.dataset.next = playlist.chapters[i + 1].index;
    button.innerHTML = `<span class="chapter-num">${String(i + 1).padStart(2, '0')}</span><strong>${chapter.title}</strong><small>FRAME ${String(chapter.index + 1).padStart(3, '0')}</small>`;
    button.addEventListener('click', () => jump(chapter.index)); ui.list.append(button);
   });
  }
  buildChapterButtons();

  function switchMode(mode) {
    if (state.playing || mode === playlist.mode) return;
    state.transitionId++;
    clearTimer(); cancelAnimationFrame(state.raf); audio.pause(); standbyAudio.pause();
    if (state.pendingLayer) discardLayer(state.pendingLayer);
    if (state.layer) discardLayer(state.layer);
    state.pendingLayer = null; state.pendingIndex = null; state.layer = null; state.video = null;
    stage.querySelector('.end-card')?.remove();
    imagePreloads.clear();
    videoPool.forEach(releaseVideo);
    playlist = window.PERU_PLAYBACK_PLAN(trip, mode);
    state.begun = false; state.index = 0; state.remaining = 0;
    ui.drawer.hidden = true;
    setTrack(0, false); updateModeUi(); buildChapterButtons();
    show(0, { initial: true });
  }
  ui.quick.addEventListener('click', () => switchMode('quick'));
  ui.full.addEventListener('click', () => switchMode('full'));
  ui.mode.addEventListener('click', () => switchMode(playlist.mode === 'quick' ? 'full' : 'quick'));

  ui.play.addEventListener('click', togglePlay);
  ui.next.addEventListener('click', next);
  ui.prev.addEventListener('click', previous);
  ui.progress.addEventListener('click', event => {
    const box = ui.progress.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    jump(Math.min(playlist.slides.length - 1, Math.floor(fraction * playlist.slides.length)));
  });
  ui.chapters.addEventListener('click', () => { ui.drawer.hidden = !ui.drawer.hidden; });
  ui.closeChapters.addEventListener('click', () => { ui.drawer.hidden = true; });
  ui.music.addEventListener('click', () => { state.muted = !state.muted; adjustMusic(); if (!state.muted && state.playing && audio.paused) audio.play().catch(() => {}); });
  let presentationFallback = false;
  function setPresentationFallback(active) {
    presentationFallback = active;
    document.documentElement.classList.toggle('presentation-fallback', active);
    ui.fullscreen.setAttribute('aria-label', active ? 'Exit presentation mode' : 'Enter fullscreen');
    resumeVideoAfterPresentationChange();
  }
  function resumeVideoAfterPresentationChange() {
    setTimeout(() => {
      if (state.playing && !state.pendingLayer && state.video?.paused) playVideo();
    }, 200);
  }
  document.addEventListener('fullscreenchange', resumeVideoAfterPresentationChange);
  document.addEventListener('webkitfullscreenchange', resumeVideoAfterPresentationChange);
  ui.fullscreen.addEventListener('click', async () => {
    if (presentationFallback) { setPresentationFallback(false); return; }
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) await exit.call(document);
      return;
    }
    const root = document.documentElement;
    const request = root.requestFullscreen || root.webkitRequestFullscreen;
    if (request) {
      try { await request.call(root); return; } catch (_) { /* iPhone may expose the method but reject it. */ }
    }
    setPresentationFallback(true);
  });
  stage.addEventListener('click', () => {
    if (presentationFallback) setPresentationFallback(false);
  });
  document.addEventListener('keydown', event => {
    if (event.target instanceof HTMLButtonElement && event.code === 'Space') return;
    if (['ArrowRight', 'ArrowLeft', 'Space', 'KeyF', 'KeyM', 'Escape'].includes(event.code)) event.preventDefault();
    if (event.code === 'ArrowRight') next();
    if (event.code === 'ArrowLeft') previous();
    if (event.code === 'Space') togglePlay();
    if (event.code === 'KeyF') ui.fullscreen.click();
    if (event.code === 'KeyM') ui.music.click();
    if (event.code === 'Escape') ui.drawer.hidden = true;
  });
  show(0, { initial: true });
})();
