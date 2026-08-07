const fs = require('fs');
const path = require('path');

// Find an available bold font for the title card
function findBoldFont() {
  const fontPaths = [
    '/usr/share/fonts/truetype/montserrat/Montserrat-Bold.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf',
  ];
  for (const p of fontPaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;  // FFmpeg will use its default if null
}

// Generate an ASS subtitle file for FFmpeg burn-in
function generateAssFile(subtitles, outputPath, videoWidth = 1920, videoHeight = 1080) {
  const header = `[Script Info]
Title: FacelessFlow Subtitles
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
PlayResX: ${videoWidth}
PlayResY: ${videoHeight}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,DejaVu Sans,52,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,3,2,2,40,40,60,1

[Events]
Format: Layer, Start, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

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

// Generate a title card drawtext filter for FFmpeg
function generateTitleFilter(videoTitle) {
  if (!videoTitle) return null;
  
  const fontPath = findBoldFont();
  const escaped = videoTitle.replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/,/g, '\\,');
  
  let filter = `drawtext=text='${escaped}'`;
  if (fontPath) {
    filter += `:fontfile=${fontPath.replace(/'/g, "\\'").replace(/:/g, '\\:')}`;
  }
  filter += `:fontsize=72:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=black@0.7:boxborderw=20:enable='between(t,0,3)'`;
  return filter;
}

module.exports = { generateAssFile, generateTitleFilter };
