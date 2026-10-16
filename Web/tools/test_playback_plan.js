const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const web = path.resolve(__dirname, '..');
const trip = JSON.parse(fs.readFileSync(path.join(web, 'manifest.json'), 'utf8'));
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(web, 'playback_plan.js'), 'utf8'), context);
const build = context.window.PERU_PLAYBACK_PLAN;
const full = build(trip, 'full');
const quick = build(trip, 'quick');

assert.equal(full.slides.length, trip.slides.length);
assert.equal(JSON.stringify(full.slides.map(s => s.id)), JSON.stringify(trip.slides.map(s => s.id)));
assert.ok(quick.slides.length < full.slides.length);
for (const slide of quick.slides) {
  const items = slide.kind === 'collage' ? slide.items : [slide];
  assert.ok(items.every(item => (item.rating ?? 3) >= 3), slide.id);
}
for (const chapter of quick.chapters) {
  assert.ok(quick.slides[chapter.index].chapter === chapter.title);
}
for (const plan of [full, quick]) {
  assert.equal(plan.musicCues.length, trip.music.length);
  for (const cue of plan.musicCues) {
    const originalCue = trip.musicCues[cue.track];
    const firstSurvivor = plan.slides.findIndex(slide => slide.originalIndex >= originalCue.index);
    assert.ok(cue.index >= 0 && cue.index < plan.slides.length);
    assert.equal(cue.anchorId, trip.slides[originalCue.index].id);
    assert.equal(cue.index, firstSurvivor);
    if (cue.track > 0) {
      assert.equal(cue.fadeFrames, 2);
      assert.ok(cue.index >= 2);
      assert.ok(plan.slides[cue.index - 2].duration + plan.slides[cue.index - 1].duration > 3);
    }
  }
}
assert.equal(quick.slides[quick.musicCues[1].index].id, 'DSCF0272');
assert.equal(quick.slides[quick.musicCues[5].index].id, 'DSCF0638');
assert.equal(quick.slides[quick.chapters.find(c => c.title === 'Machu Picchu').index].title, 'Machu Picchu');
console.log(`Playback plans OK: Full ${full.slides.length} frames, Quick ${quick.slides.length} frames`);
