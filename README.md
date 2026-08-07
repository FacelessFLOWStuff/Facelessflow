# FacelessFlow Render Server

Self-hosted FFmpeg-powered video rendering server. No third-party APIs, no per-minute fees.

## What It Does

Takes voiceover audio, stock footage clips, background music, subtitles, and a title — then renders a final MP4 video using FFmpeg. Built to integrate with the FacelessFlow app.

## API Endpoints

### POST /render
Submit a render job.

```json
{
  "voiceoverUrl": "https://example.com/voiceover.mp3",
  "voiceoverBase64": null,
  "clips": [
    { "url": "https://example.com/clip1.mp4", "length": 6, "transition": "fade" },
    { "url": "https://example.com/clip2.mp4", "length": 8, "transition": "fade" }
  ],
  "musicUrl": "https://example.com/music.mp3",
  "subtitles": [
    { "text": "The Mariana Trench", "start": 0, "end": 4 },
    { "text": "is the deepest place on Earth", "start": 4, "end": 8 }
  ],
  "videoTitle": "The Terrifying Truth About the Mariana Trench",
  "quality": "hd"
}
```

Response:
```json
{
  "success": true,
  "jobId": "abc123...",
  "status": "queued",
  "message": "Render job submitted. Poll GET /status/abc123... for progress."
}
```

### GET /status/:jobId
Check render progress.

Response (in progress):
```json
{
  "success": true,
  "jobId": "abc123...",
  "status": "rendering",
  "progress": 75,
  "videoUrl": null
}
```

Response (complete):
```json
{
  "success": true,
  "jobId": "abc123...",
  "status": "done",
  "progress": 100,
  "videoUrl": "https://your-server.com/videos/abc123....mp4"
}
```

### GET /videos/:filename
Download the rendered video.

### GET /health
Server health check.

## Deployment

### Railway (recommended — $5/mo)

1. Go to [railway.app](https://railway.app) and create a new project
2. Connect your GitHub repo (push the `render-server` folder)
3. Railway will detect the Dockerfile automatically
4. Add environment variables:
   - `PORT` = 3000 (Railway sets this automatically)
5. Deploy — your server URL will be `https://your-app.up.railway.app`

### Render ($7/mo)

1. Go to [render.com](https://render.com) and create a new Web Service
2. Connect your GitHub repo
3. Select Docker as the environment
4. Railway/Render will build the Dockerfile automatically
5. Deploy

### Local Development

```bash
# Install FFmpeg first (macOS: brew install ffmpeg, Ubuntu: apt install ffmpeg)
cd render-server
npm install
npm start
```

Server runs at http://localhost:3000

## Integration with FacelessFlow

Once deployed, update FacelessFlow's renderVideo backend function to point to your server URL instead of Shotstack.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 3000 | Server port |
| FFMPEG_PATH | /usr/bin/ffmpeg | FFmpeg binary path |
| FFPROBE_PATH | /usr/bin/ffprobe | FFprobe binary path |

## Cost

- Railway: $5/month (unlimited renders, you pay for compute time)
- Render: $7/month
- Local: Free (but not accessible from the internet)
- Per render: $0 (no per-minute fees)
