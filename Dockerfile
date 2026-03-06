# -----------------------------
# 1. Base Image
# -----------------------------
FROM node:20-alpine

# -----------------------------
# 2. Set working directory
# -----------------------------
WORKDIR /app

# -----------------------------
# 3. Install dependencies first (cache layers)
# -----------------------------
COPY package*.json ./
RUN npm install --production

# -----------------------------
# 4. Copy app source
# -----------------------------
COPY . .

# -----------------------------
# 5. Expose port
# -----------------------------
EXPOSE 2009

# -----------------------------
# 6. Start the server
# -----------------------------
CMD ["node", "index.js"]