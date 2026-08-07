FROM node:18-slim

# Install FFmpeg and fonts
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    fonts-dejavu-core \
    fonts-liberation \
    fonts-freefont-ttf \
    fontconfig \
    && rm -rf /var/lib/apt/lists/*

# Set up Montserrat font fallback (use Liberation Sans if download fails)
RUN mkdir -p /usr/share/fonts/truetype/montserrat && \
    cp /usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf /usr/share/fonts/truetype/montserrat/Montserrat-Bold.ttf && \
    cp /usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf /usr/share/fonts/truetype/montserrat/Montserrat-Regular.ttf && \
    fc-cache -f

ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV FFPROBE_PATH=/usr/bin/ffprobe
ENV NODE_ENV=production

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

RUN mkdir -p renders temp

EXPOSE 3000

CMD ["node", "server.js"]
