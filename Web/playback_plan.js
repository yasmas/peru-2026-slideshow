(() => {
  'use strict';
  function build(trip, mode) {
    const quick = mode === 'quick';
    const slides = [];
    trip.slides.forEach((original, originalIndex) => {
      let slide = { ...original, originalIndex };
      if (quick && original.kind === 'collage') {
        const items = original.items.filter(item => (item.rating ?? 3) >= 3);
        if (!items.length) return;
        if (items.length === 1) {
          slide = { ...slide, ...items[0], kind: 'photo', items: undefined,
            layout: undefined, duration: 4, motion: { mode: 'zoom-in', scale: 1.025 },
            originalIndex };
        } else slide.items = items;
      } else if (quick && (original.rating ?? 3) < 3) return;
      slides.push(slide);
    });
    const chapters = [];
    trip.chapters.forEach((chapter, chapterNumber) => {
      const end = trip.chapters[chapterNumber + 1]?.index ?? trip.slides.length;
      const index = slides.findIndex(slide => slide.originalIndex >= chapter.index && slide.originalIndex < end);
      if (index < 0) return;
      chapters.push({ ...chapter, index });
      const titleSlide = trip.slides[chapter.index];
      if (quick && titleSlide.title && !slides[index].title) {
        slides[index] = { ...slides[index], title: titleSlide.title,
          subtitle: titleSlide.subtitle, kicker: titleSlide.kicker };
      }
    });
    const musicCues = trip.musicCues.map(cue => {
      const index = slides.findIndex(slide => slide.originalIndex >= cue.index);
      return { ...cue, index: index < 0 ? slides.length - 1 : index };
    });
    return { slides, chapters, musicCues, music: trip.music, mode,
      duration: slides.reduce((total, slide) => total + slide.duration, 0) };
  }
  window.PERU_PLAYBACK_PLAN = build;
})();
