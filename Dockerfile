# ---------- STAGE 1: Builder ----------
# Use a full node image for the build stage to ensure all tools are available.
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for native node modules
# This is a good practice to handle all potential C++ bindings
# RUN apk add --no-cache git python3 make g++

# Copy package.json and install all dependencies (including dev)
COPY package*.json ./
RUN npm install

# Copy the source code
COPY . .

# Generate the Prisma client in the builder stage where all dependencies are available.
RUN npx prisma generate

# Build the application
RUN npm run build

# ---------- STAGE 2: Runner ----------
# Use a minimal node image for the final, production container
FROM node:20-alpine AS runner

WORKDIR /app

# NOTE: Alpine is a very minimal OS. The Prisma query engine needs libssl to run.
# Without it, you'll get a runtime error.
RUN apk add --no-cache openssl

# Copy the entire node_modules directory from the builder stage.
# This ensures that all dependencies, including the Prisma query engine,
# are correctly copied to the final image.
COPY --from=builder /app/node_modules ./node_modules
# Copy prisma schema
COPY --from=builder /app/prisma ./prisma
# Copy the compiled application
COPY --from=builder /app/dist ./dist

# Expose the application port
EXPOSE 3000

CMD sh -c "\
  echo 'Applying Prisma migrations...' && \
  npx prisma migrate deploy && \
  echo 'Starting NestJS app...' && \
  node dist/main.js \
"
