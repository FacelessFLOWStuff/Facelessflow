const fs = require('fs');
const path = require('path');

// Generate an ASS subtitle file for FFmpeg burn-in
function generateAssFile(subtitles, outputPath, videoWidth = 1920, videoHeight = 1080) {
  // ASS subtitle format for styled subtitles
  const header = `[Script Info]
Title: FacelessFlow Subtitles
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
PlayResX: ${videoWidth}
PlayResY: ${videoHeight}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Montserrat,52,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,3,2,2,40,40,60,1

[Events]
Format: Layer, Start, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  // Convert seconds to ASS time format: H:MM:SS.cs
  function assTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const cs = Math.floor((seconds * 100) % 100);
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  }

  const events = subtitles.map(sub => {
    const start = assTime(sub.start);
    const end = assTime(sub.end);
    const text = sub.text.replace(/\n/g, '\\N');
    return `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`;
  }).join('\n');

  const assContent = header + events + '\n';
  fs.writeFileSync(outputPath, assContent, 'utf-8');
  return outputPath;
}

// Generate a simple title card as an image using FFmpeg
function generateTitleFilter(videoTitle) {
  if (!videoTitle) return null;
  // Escape colons and commas for FFmpeg drawtext
  const escaped = videoTitle.replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/,/g, '\\,');
  return `drawtext=text='${escaped}':fontfile=/usr/share/fonts/truetype/montserrat/Montserrat-Bold.ttf:fontsize=72:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=black@0.7:boxborderw=20:enable='between(t,0,3)'`;
}

module.exports = { generateAssFile, generateTitleFilter };
