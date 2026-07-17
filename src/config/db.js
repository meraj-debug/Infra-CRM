import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

mongoose.set('strictQuery', true);

const OPTIONS = {
  maxPoolSize: 20,          // connection pooling
  minPoolSize: 2,
  serverSelectionTimeoutMS: 8000,
  socketTimeoutMS: 45000,
};

// Connect with bounded exponential-backoff retry so a cold Atlas cluster or a
// transient network blip doesn't crash the process on boot.
export async function connectDB(attempt = 1) {
  const MAX_ATTEMPTS = 5;
  try {
    await mongoose.connect(env.MONGODB_URI, OPTIONS);
    logger.info('MongoDB connected');
  } catch (err) {
    if (attempt >= MAX_ATTEMPTS) {
      logger.error(`MongoDB connection failed after ${attempt} attempts: ${err.message}`);
      throw err;
    }
    const delay = Math.min(1000 * 2 ** (attempt - 1), 15000);
    logger.warn(`MongoDB connect attempt ${attempt} failed (${err.message}). Retrying in ${delay}ms`);
    await new Promise((r) => setTimeout(r, delay));
    return connectDB(attempt + 1);
  }
}

mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));

// Used by the /health endpoint. 1 = connected.
export function dbHealthy() {
  return mongoose.connection.readyState === 1;
}

export async function disconnectDB() {
  await mongoose.connection.close();
  logger.info('MongoDB connection closed');
}
