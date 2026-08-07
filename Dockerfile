FROM node:18-slim

# Install FFmpeg and fonts
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    fonts-dejavu-core \
    fonts-liberation \
    fonts-freefont-ttf \
    fontconfig \
    wget \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create a Montserrat-like font fallback (use Liberation Sans Bold as substitute)
# We try to download Montserrat but fall back to Liberation Sans if it fails
RUN mkdir -p /usr/share/fonts/truetype/montserrat && \
    (wget -q -O /usr/share/fonts/truetype/montserrat/Montserrat-Bold.ttf \
      "https://github.com/google/fonts/raw/main/ofl/montserrat/Montserrat%5Bwght%5D.ttf" 2>/dev/null || true) && \
    (test -s /usr/share/fonts/truetype/montserrat/Montserrat-Bold.ttf || \
     cp /usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf \
        /usr/share/fonts/truetype/montserrat/Montserrat-Bold.ttf) && \
    (cp /usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf \
        /usr/share/fonts/truetype/montserrat/Montserrat-Regular.ttf 2>/dev/null || true) && \
    fc-cache -f

# Set FFmpeg paths
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV FFPROBE_PATH=/usr/bin/ffprobe
ENV NODE_ENV=production

# Create app directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy app files
COPY . .

# Create directories for renders and temp files
RUN mkdir -p renders temp

# Expose port (Railway sets PORT automatically)
EXPOSE 3000

# Start the server
CMD ["node", "server.js"]
