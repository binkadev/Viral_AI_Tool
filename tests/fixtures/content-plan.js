"use strict";
// Deterministic contract fixture only. Never imported by the application.
function script(count = 5) {
  const lines = ["Một mùi hương gợi phong cách riêng.", "Cận cảnh chai nước hoa nam.", "Ánh sáng làm nổi bật đường nét chai.", "Một phong cách sang trọng, tiết chế.", "Khám phá mùi hương phù hợp với bạn."];
  const beats = Array.from({ length: count }, (_, i) => ({ purpose: i === 0 ? "hook" : i === count - 1 ? "cta" : "body",
    text: lines[i % lines.length], visualIntent: `Men's perfume bottle, shot ${i + 1}, dark reflective surface, cinematic light`,
    searchQueries: [`men perfume bottle cinematic shot ${i + 1}`, `luxury fragrance close up detail ${i + 1}`],
    generationPrompt: `A men's perfume bottle on a dark reflective surface. Slow camera push in, shot ${i + 1}, close framing, restrained luxurious mood, vertical composition with room above the subject.`,
    targetKinds: ["video", "image"] }));
  return { hook: beats[0].text, body: beats.slice(1, -1).map(beat => beat.text).join("\n\n"), cta: beats.at(-1).text, beats };
}
module.exports = { script };
